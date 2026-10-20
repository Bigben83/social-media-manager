const { test } = require('node:test');
const assert = require('node:assert/strict');
const fakeDb = require('../../gateway/tests/fakeDb');
const { createPostProcessor } = require('../worker');
const { validatePost, scheduleDelay } = require('../utils/publishing');
const { deliveryKey } = require('../utils/publishing');
async function setup(post) {
  const db = fakeDb(); await db.collection('workspaces').insertOne({ _id: 'test' });
  const calls = [];
  const preparation = { fail: null, calls: 0 };
  const process = createPostProcessor({ getDb: async () => db, axios: { post: async (...args) => { calls.push(args); return post(...args); } }, log: { info() {} }, preparePost: async (_, destinations) => { preparation.calls++; if (preparation.fail) throw preparation.fail; return destinations.map(d => d.platform === 'instagram' && d.imageUrl ? { ...d, imageUrl: '/media/prepared.jpg' } : d); } });
  const job = { id: 'job', attemptsMade: 0, opts: { attempts: 3 }, data: { workspaceId: 'test', content: 'Post', destinations: [{ platform: 'facebook', accountId: 'one' }, { platform: 'facebook', accountId: 'two' }] } };
  await db.collection('scheduled_jobs').insertOne({ bullJobId: 'job', workspaceId: 'test', status: 'pending' });
  return { db, process, calls, job, preparation };
}
test('retries transient failures while skipping destinations already published', async () => {
  let fail = true;
  const { db, process, calls, job } = await setup(async (url, body) => {
    if (body.accountId === 'two' && fail) throw Object.assign(new Error('temporary'), { response: { status: 503 } });
    return { data: { success: true, result: { postId: body.accountId } } };
  });
  await assert.rejects(process(job), /Retryable/);
  assert.equal((await db.collection('posts').findOne({ _id: 'scheduled:test:job' })).platformResults['facebook:one'].success, true);
  fail = false; job.attemptsMade = 1; await process(job);
  assert.equal(calls.length, 3);
  assert.equal((await db.collection('scheduled_jobs').findOne({ bullJobId: 'job' })).status, 'published');
});
test('does not resend after a timeout with an uncertain publishing outcome', async () => {
  const { process, calls, job } = await setup(async () => { throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }); });
  const results = await process(job); assert.equal(results['facebook:one'].uncertain, true);
  await process(job); assert.equal(calls.length, 2);
});
test('does not publish from a deleted workspace', async () => {
  const { db, process, calls, job } = await setup(async () => ({ data: { success: true } }));
  await db.collection('workspaces').deleteOne({ _id: 'test' });
  await process(job); assert.equal(calls.length, 0);
});

test('Instagram processing defers the job and reconciles the same durable receipt', async () => {
  const { db, process, calls, job } = await setup(async () => ({ data: { success: false, processing: true } }));
  const destination = { platform: 'instagram', accountId: 'ig', instagramPlacement: 'reel', videoUrl: '/media/reel.mp4' };
  job.data.destinations = [destination];
  let deferred = 0; job.moveToDelayed = async () => { deferred++; };
  await assert.rejects(process(job), /bullmq:movedToDelayed/);
  assert.equal(deferred, 1);
  await db.collection('instagram_deliveries').insertOne({ _id: 'test:' + deliveryKey('scheduled:test:job', destination), workspaceId: 'test', status: 'published', result: { postId: 'reel' } });
  await process(job);
  assert.equal(calls.length, 1);
  assert.equal((await db.collection('scheduled_jobs').findOne({ bullJobId: 'job' })).status, 'published');
});
test('rejects malformed and unsupported destinations before publishing', () => {
  assert.equal(validatePost('Post', [{ platform: 'facebook', accountId: 'one' }]), null);
  assert(validatePost('Post', [{ platform: 'youtube' }]));
  assert(validatePost('Post', [{ platform: 'tiktok', imageUrl: 'https://example.com/photo.jpg' }]));
  assert(validatePost('Post', [{ platform: 'facebook', accountId: 'one' }, { platform: 'facebook', accountId: 'one' }]));
});

test('queued legacy PNG is prepared before Facebook and retries retain the prepared URL', async () => {
  const { db, process, calls, job, preparation } = await setup(async (_, body) => ({ data: { success: true, result: { postId: body.accountId } } }));
  job.data.destinations.push({ platform: 'instagram', accountId: 'ig', imageUrl: '/media/legacy.png' });
  await process(job);
  assert.equal(preparation.calls, 1);
  assert.equal(calls[2][1].imageUrl, '/media/prepared.jpg');
  assert.equal((await db.collection('posts').findOne({ _id: 'scheduled:test:job' })).preparedDestinations[2].imageUrl, '/media/prepared.jpg');
  await process(job);
  assert.equal(calls.length, 3);
});

test('preflight rejection prevents all queued destinations from sending', async () => {
  const { db, process, calls, job, preparation } = await setup(async () => { throw new Error('Must not dispatch'); });
  job.data.destinations.push({ platform: 'instagram', accountId: 'ig', imageUrl: '/media/bad.png' });
  preparation.fail = { response: { status: 400, data: { error: 'Wrong image ratio' } } };
  await process(job);
  assert.equal(calls.length, 0);
  const row = await db.collection('scheduled_jobs').findOne({ bullJobId: 'job' });
  assert.equal(row.status, 'failed');
  assert.match(row.failReason, /Wrong image ratio/);
});

test('a preflight timeout is retryable without an uncertain public outcome', async () => {
  const { db, process, calls, job, preparation } = await setup(async () => ({ data: { success: true, result: { postId: 'ok' } } }));
  job.data.destinations.push({ platform: 'instagram', accountId: 'ig', imageUrl: '/media/original.png' });
  preparation.fail = Object.assign(new Error('Preflight timed out'), { code: 'ETIMEDOUT' });
  await assert.rejects(process(job), /timed out/);
  assert.equal(calls.length, 0);
  const result = (await db.collection('scheduled_jobs').findOne({ bullJobId: 'job' })).platformResults['instagram:ig'];
  assert.equal(result.uncertain, false); assert.equal(result.retryable, true);
  preparation.fail = null; job.attemptsMade = 1; await process(job);
  assert.equal(calls.length, 3);
});
test('scheduling rejects invalid and timezone-less dates', () => {
  assert.throws(() => scheduleDelay('not-a-date'));
  assert.throws(() => scheduleDelay('2026-10-20T09:00'));
  assert.throws(() => scheduleDelay('2026-99-99T09:00:00Z'));
  assert.equal(scheduleDelay('2026-10-20T09:00:00+11:00', Date.parse('2026-10-19T21:00:00Z')), 3600000);
});
