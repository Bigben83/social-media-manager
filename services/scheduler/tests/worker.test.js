const { test } = require('node:test');
const assert = require('node:assert/strict');
const fakeDb = require('../../gateway/tests/fakeDb');
const { createPostProcessor } = require('../worker');
const { validatePost, scheduleDelay } = require('../utils/publishing');
async function setup(post) {
  const db = fakeDb(); await db.collection('workspaces').insertOne({ _id: 'test' });
  const calls = [];
  const process = createPostProcessor({ getDb: async () => db, axios: { post: async (...args) => { calls.push(args); return post(...args); } }, log: { info() {} } });
  const job = { id: 'job', attemptsMade: 0, opts: { attempts: 3 }, data: { workspaceId: 'test', content: 'Post', destinations: [{ platform: 'facebook', accountId: 'one' }, { platform: 'facebook', accountId: 'two' }] } };
  await db.collection('scheduled_jobs').insertOne({ bullJobId: 'job', workspaceId: 'test', status: 'pending' });
  return { db, process, calls, job };
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
test('rejects malformed and unsupported destinations before publishing', () => {
  assert.equal(validatePost('Post', [{ platform: 'facebook', accountId: 'one' }]), null);
  assert(validatePost('Post', [{ platform: 'youtube' }]));
  assert(validatePost('Post', [{ platform: 'tiktok', imageUrl: 'https://example.com/photo.jpg' }]));
  assert(validatePost('Post', [{ platform: 'facebook', accountId: 'one' }, { platform: 'facebook', accountId: 'one' }]));
});
test('scheduling rejects invalid and timezone-less dates', () => {
  assert.throws(() => scheduleDelay('not-a-date'));
  assert.throws(() => scheduleDelay('2026-10-20T09:00'));
  assert.throws(() => scheduleDelay('2026-99-99T09:00:00Z'));
  assert.equal(scheduleDelay('2026-10-20T09:00:00+11:00', Date.parse('2026-10-19T21:00:00Z')), 3600000);
});
