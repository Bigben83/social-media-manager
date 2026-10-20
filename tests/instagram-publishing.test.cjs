const { test } = require('node:test');
const assert = require('node:assert/strict');
const fakeDb = require('../services/gateway/tests/fakeDb');
const { createInstagramPublisher } = require('../services/instagram/publishing');
const { validateMetadata } = require('../services/instagram/media');
async function fixture() {
  const db = fakeDb(), jobs = [], calls = [];
  await db.collection('workspaces').insertOne({ _id: 'one' });
  const state = { status: 'FINISHED', failPoll: false, failPublish: false, rejectPublish: false, notReady: false, business: true };
  const request = {
    get: async (url) => {
      if (url.endsWith('/ig')) return { data: { account_type: state.business ? 'BUSINESS' : 'MEDIA_CREATOR' } };
      if (state.failPoll) { state.failPoll = false; throw Object.assign(new Error('lost poll'), { code: 'ECONNRESET' }); }
      return { data: { status_code: state.status } };
    },
    post: async (url, _, options) => {
      calls.push({ url, params: options.params });
      if (url.endsWith('/media_publish') && state.notReady) { state.notReady = false; throw { response: { status: 400, data: { error: { code: 9007, error_subcode: 2207027, message: 'Media ID is not available' } } } }; }
      if (url.endsWith('/media_publish') && state.rejectPublish) throw { response: { status: 400, data: { error: { message: 'Publishing permission denied' } } } };
      if (url.endsWith('/media_publish') && state.failPublish) { state.failPublish = false; throw Object.assign(new Error('lost publish'), { code: 'ETIMEDOUT' }); }
      return { data: { id: url.endsWith('/media') ? 'container' : 'post' } };
    },
  };
  const queue = { add: async (_, data) => { jobs.push({ data }); }, getJob: async () => null };
  const publisher = createInstagramPublisher({ getDb: async () => db, queue, request, getAccounts: async ws => ws === 'one' ? [{ id: 'ig', accessToken: 'private-token' }] : [], resolveMediaUrl: value => value, delay: async () => {}, maxPolls: 2 });
  const body = { accountId: 'ig', instagramPlacement: 'reel', videoUrl: 'https://media.example/reel.mp4', content: 'Caption' };
  return { db, jobs, calls, state, publisher, body, row: () => db.collection('instagram_deliveries').findOne({ _id: 'one:key' }) };
}
test('Instagram acceptance is pending; duplicate requests enqueue once and finish with a receipt', async () => {
  const f = await fixture();
  assert.equal((await f.publisher.submit('one', 'key', f.body)).processing, true);
  await f.publisher.submit('one', 'key', f.body); assert.equal(f.jobs.length, 1);
  await f.publisher.process(f.jobs[0]);
  assert.equal((await f.row()).status, 'published');
  assert.equal((await f.publisher.submit('one', 'key', f.body)).success, true);
  assert.equal(f.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
  assert.equal(JSON.stringify(await f.row()).includes('private-token'), false);
  await assert.rejects(f.publisher.submit('one', 'key', { ...f.body, content: 'changed' }), /changed/);
});
test('processing resumes the saved container after a network error', async () => {
  const f = await fixture(); await f.publisher.submit('one', 'key', f.body);
  f.state.failPoll = true;
  await assert.rejects(f.publisher.process(f.jobs[0]), /lost poll/);
  assert.equal((await f.row()).containerId, 'container');
  await f.publisher.process(f.jobs[0]);
  assert.equal((await f.row()).status, 'published');
  assert.equal(f.calls.filter(c => c.url.endsWith('/media')).length, 1);
});
test('a lost publish response is reconciled from container status without resending', async () => {
  const f = await fixture(); await f.publisher.submit('one', 'key', f.body);
  f.state.failPublish = true; await assert.rejects(f.publisher.process(f.jobs[0]), /lost publish/);
  f.state.status = 'PUBLISHED'; await f.publisher.process(f.jobs[0]);
  assert.equal((await f.row()).status, 'published');
  assert.equal(f.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
});
test('an unconfirmed publish remains uncertain and never repeats the mutation', async () => {
  const f = await fixture(); await f.publisher.submit('one', 'key', f.body);
  f.state.failPublish = true; await assert.rejects(f.publisher.process(f.jobs[0]));
  await f.publisher.process(f.jobs[0]); await f.publisher.process(f.jobs[0]);
  assert.equal((await f.row()).status, 'uncertain');
  assert.equal(f.calls.filter(c => c.url.endsWith('/media_publish')).length, 1);
});

test('an explicit Instagram rejection is a known failure, distinct from a lost response', async () => {
  const f = await fixture(); await f.publisher.submit('one', 'key', f.body);
  f.state.rejectPublish = true; await f.publisher.process(f.jobs[0]);
  assert.equal((await f.row()).status, 'failed');
  assert.equal((await f.row()).error, 'Publishing permission denied');
});

test('9007 waits and retries the same media container without recreating it', async () => {
  const f = await fixture(); await f.publisher.submit('one', 'key', f.body);
  f.state.notReady = true;
  await assert.rejects(f.publisher.process(f.jobs[0]), err => err.processing === true);
  assert.equal((await f.row()).stage, 'processing');
  await f.publisher.process(f.jobs[0]);
  assert.equal((await f.row()).status, 'published');
  assert.equal(f.calls.filter(c => c.url.endsWith('/media')).length, 1);
  assert.equal(f.calls.filter(c => c.url.endsWith('/media_publish')).length, 2);
});

test('images wait for a finished container before media_publish, just like videos', async () => {
  const f = await fixture(); await f.publisher.submit('one', 'key', { accountId: 'ig', imageUrl: '/media/image.jpg', content: 'Caption' });
  f.state.status = 'IN_PROGRESS';
  await assert.rejects(f.publisher.process(f.jobs[0]), err => err.processing === true);
  assert.equal(f.calls.filter(c => c.url.endsWith('/media_publish')).length, 0);
  f.state.status = 'FINISHED'; await f.publisher.process(f.jobs[0]);
  assert.equal((await f.row()).status, 'published');
});
test('Stories verify Business eligibility and omit caption/comment publishing', async () => {
  const f = await fixture(), body = { accountId: 'ig', instagramPlacement: 'story', imageUrl: '/media/story.jpg', content: 'Internal text', firstComment: 'Do not send' };
  await f.publisher.submit('one', 'key', body); await f.publisher.process(f.jobs[0]);
  assert.equal(f.calls[0].params.media_type, 'STORIES');
  assert.equal(f.calls[0].params.caption, undefined);
  assert.equal(f.calls.length, 2);
  const other = await fixture(); other.state.business = false;
  await other.publisher.submit('one', 'key', body); await other.publisher.process(other.jobs[0]);
  assert.equal((await other.row()).status, 'failed'); assert.equal(other.calls.length, 0);
});
test('recovery restores missing queued work, but deleted workspaces cannot publish', async () => {
  const f = await fixture(); await f.publisher.submit('one', 'key', f.body);
  await f.publisher.recover(); assert.equal(f.jobs.length, 2);
  await f.db.collection('workspaces').deleteOne({ _id: 'one' });
  await f.publisher.process(f.jobs[0]); assert.equal((await f.row()).status, 'failed'); assert.equal(f.calls.length, 0);
});
test('decoded metadata rejects wrong ratios, codecs and Story durations', () => {
  const video = { codec: 'h264', width: 1080, height: 1920, duration: 30, fps: 30 };
  validateMetadata(video, 'reel', true);
  assert.throws(() => validateMetadata({ ...video, width: 1024, height: 1536 }, 'reel', true), /9:16/);
  assert.throws(() => validateMetadata({ ...video, duration: 61 }, 'story', true), /duration/);
  assert.throws(() => validateMetadata({ ...video, codec: 'vp9' }, 'reel', true), /H.264/);
  validateMetadata({ codec: 'mjpeg', width: 1080, height: 1440, size: 1000 }, 'feed', false);
});
