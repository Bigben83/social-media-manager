const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { BSON, ObjectId } = require('mongodb');
const fakeDb = require('../../gateway/tests/fakeDb');
const { createCancellation, registerCancellation } = require('../cancellation');
const { registerDraftScheduling } = require('../drafts');
const { createPostProcessor } = require('../worker');

async function fixture() {
  const db = fakeDb(), base = db.collection.bind(db), jobs = new Map();
  const state = { queueState: 'delayed', removeError: false, draftError: false, onRead: null };
  db.collection = name => {
    const col = base(name);
    return { ...col, async findOne(query) {
      const row = await col.findOne(query), copy = row && BSON.deserialize(BSON.serialize(row));
      if (name === 'scheduled_jobs' && state.onRead) { const callback = state.onRead; state.onRead = null; await callback(); }
      return copy;
    }, async updateOne(query, update, options) {
      if (name === 'drafts' && state.draftError) throw new Error('Mongo write failed');
      return col.updateOne(query, update, options);
    } };
  };
  for (const _id of ['one', 'two']) await db.collection('workspaces').insertOne({ _id });
  await db.collection('platform_credentials').insertOne({ _id: 'one:facebook', pages: [{ id: 'page', selected: true }] });
  const queue = { getJob: async id => jobs.get(id), add: async (_name, data, opts) => {
    const job = { id: opts.jobId, data, getState: async () => state.queueState, remove: async () => { if (state.removeError) throw new Error('Redis unavailable'); jobs.delete(opts.jobId); } };
    jobs.set(job.id, job); return job;
  } };
  const deps = { getDb: async () => db, getQueue: () => queue, log: { warn() {}, info() {} } };
  const row = { _id: 'job', postId: 'job', bullJobId: 'job', workspaceId: 'one', content: 'A scheduled post', firstComment: 'First comment', scheduledAt: new Date('2035-11-02T09:30:00Z'), status: 'pending', destinations: [{ platform: 'instagram', accountId: 'ig', instagramPlacement: 'reel', videoUrl: 'https://cdn.example/reel.mp4', coverUrl: 'https://cdn.example/cover.jpg', shareToFeed: false }] };
  await db.collection('scheduled_jobs').insertOne(row);
  await queue.add('scheduled-post', row, { jobId: 'job' });
  return { db, state, queue, jobs, deps, row, cancellation: createCancellation(deps) };
}

test('cancellation restores full post data and retries preserve later draft edits', async () => {
  const f = await fixture();
  const result = await f.cancellation.cancel('one', 'job');
  assert.equal(result.returnedToDrafts, true); assert.equal(f.jobs.size, 0);
  const draft = await f.db.collection('drafts').findOne({ _id: new ObjectId(result.draftId), workspaceId: 'one' });
  assert.equal(draft.content, f.row.content); assert.equal(draft.firstComment, 'First comment');
  assert.equal(draft.scheduledAt, '2035-11-02T09:30:00.000Z'); assert.equal(draft.mediaUrl, 'https://cdn.example/reel.mp4');
  assert.deepEqual(draft.destinations, [{ ...f.row.destinations[0], selected: true }]);
  await f.db.collection('drafts').updateOne({ _id: draft._id }, { $set: { content: 'New draft edit' } });
  assert.equal((await f.cancellation.cancel('one', 'job')).draftId, result.draftId);
  assert.equal((await f.db.collection('drafts').findOne({ _id: draft._id })).content, 'New draft edit');
  await f.db.collection('drafts').deleteOne({ _id: draft._id });
  await f.cancellation.cancel('one', 'job');
  assert.equal(await f.db.collection('drafts').countDocuments({}), 0, 'Retries do not resurrect a draft that was deleted or rescheduled');
});

test('original draft snapshot is retained without overwriting a newer original draft', async () => {
  const f = await fixture(), original = { _id: new ObjectId(), workspaceId: 'one', content: 'Old original', mediaUrl: '/media/original.mp4', scheduledAt: '2035-11-02T20:30', topic: 'Campaign', destinations: [{ ...f.row.destinations[0], selected: true, label: '@brand' }, { platform: 'facebook', accountId: 'page', selected: false }] };
  await f.db.collection('scheduled_jobs').updateOne({ _id: 'job' }, { $set: { sourceDraftSnapshot: original, sourceDraftId: String(original._id) } });
  await f.db.collection('drafts').insertOne({ ...original, content: 'Newer independent edit' });
  const result = await f.cancellation.cancel('one', 'job');
  const restored = await f.db.collection('drafts').findOne({ _id: new ObjectId(result.draftId) });
  assert.equal(restored.scheduledAt, original.scheduledAt); assert.equal(restored.mediaUrl, original.mediaUrl);
  assert.deepEqual(restored.destinations, original.destinations); assert.equal(restored.topic, 'Campaign');
  assert.equal((await f.db.collection('drafts').findOne({ _id: original._id })).content, 'Newer independent edit');
});

test('draft restoration recovers after an interrupted database write', async () => {
  const f = await fixture(); f.state.draftError = true;
  await assert.rejects(f.cancellation.cancel('one', 'job'), /Mongo write/);
  assert.equal((await f.db.collection('scheduled_jobs').findOne({ _id: 'job' })).status, 'cancelling');
  assert.equal(f.jobs.size, 0);
  f.state.draftError = false;
  await createCancellation(f.deps).recover();
  assert.equal((await f.db.collection('scheduled_jobs').findOne({ _id: 'job' })).status, 'cancelled');
  assert.equal(await f.db.collection('drafts').countDocuments({ workspaceId: 'one' }), 1);
});

test('a leftover queue entry cannot publish after Redis cleanup fails', async () => {
  const f = await fixture(); f.state.removeError = true;
  await f.cancellation.cancel('one', 'job');
  let sends = 0;
  const worker = createPostProcessor({ getDb: f.deps.getDb, axios: { post: async () => { sends++; } }, log: f.deps.log });
  await worker({ id: 'job', attemptsMade: 0, data: f.row });
  assert.equal(sends, 0); assert.equal(f.jobs.size, 1);
});

test('cancellation wins an overlapping worker claim without sending a provider request', async () => {
  const f = await fixture(); let sends = 0;
  f.state.onRead = () => f.cancellation.cancel('one', 'job');
  const worker = createPostProcessor({ getDb: f.deps.getDb, axios: { post: async () => { sends++; } }, log: f.deps.log });
  await worker({ id: 'job', attemptsMade: 0, data: f.row });
  assert.equal(sends, 0);
  assert.equal((await f.db.collection('scheduled_jobs').findOne({ _id: 'job' })).status, 'cancelled');
});

test('active, completed and uncertain deliveries cannot return as fresh drafts', async () => {
  for (const status of ['processing', 'published', 'completed', 'partial']) {
    const f = await fixture(); await f.db.collection('scheduled_jobs').updateOne({ _id: 'job' }, { $set: { status } });
    await assert.rejects(f.cancellation.cancel('one', 'job'), e => e.statusCode === 409);
    assert.equal(await f.db.collection('drafts').countDocuments({}), 0);
  }
  const f = await fixture(); f.state.queueState = 'active';
  await assert.rejects(f.cancellation.cancel('one', 'job'), e => e.statusCode === 409);
  f.state.queueState = 'delayed';
  await f.db.collection('scheduled_jobs').updateOne({ _id: 'job' }, { $set: { platformResults: { 'instagram:ig:reel': { success: false, uncertain: true } } } });
  await assert.rejects(f.cancellation.cancel('one', 'job'), e => e.statusCode === 409);
  await assert.rejects(f.cancellation.cancel('two', 'job'), e => e.statusCode === 404);
});

test('concurrent cancellation requests return one draft', async () => {
  const f = await fixture();
  const responses = await Promise.all(Array.from({ length: 10 }, () => f.cancellation.cancel('one', 'job')));
  assert.equal(new Set(responses.map(r => r.draftId)).size, 1);
  assert.equal(await f.db.collection('drafts').countDocuments({ workspaceId: 'one' }), 1);
});

test('a queue entry from another workspace cannot be removed even if metadata collides', async () => {
  const f = await fixture(); f.jobs.get('job').data.workspaceId = 'two';
  await assert.rejects(f.cancellation.cancel('one', 'job'), e => e.statusCode === 409);
  assert.equal(f.jobs.size, 1);
  assert.equal(await f.db.collection('drafts').countDocuments({}), 0);
});

test('schedule, cancel, edit and reschedule uses a new delivery identity and retains history', async () => {
  const f = await fixture(), app = Fastify();
  registerCancellation(app, f.deps);
  registerDraftScheduling(app, { ...f.deps, publicUrl: 'https://manager.example' });
  const request = (method, url, payload) => app.inject({ method, url, payload, headers: { 'x-workspace-id': 'one' } });
  try {
    await f.db.collection('scheduled_jobs').updateOne({ _id: 'job' }, { $set: { destinations: [{ platform: 'facebook', accountId: 'page' }] } });
    const cancelled = (await request('DELETE', '/jobs/job')).json();
    const draft = await f.db.collection('drafts').findOne({ _id: new ObjectId(cancelled.draftId) });
    await f.db.collection('drafts').updateOne({ _id: draft._id }, { $set: { content: 'Reviewed restored post' } });
    const preview = (await request('POST', '/drafts/preview', { draftIds: [cancelled.draftId], timezone: 'Australia/Sydney' })).json();
    assert.equal(preview.items[0].ready, true);
    const scheduled = (await request('POST', '/drafts/schedule', { items: [{ draftId: cancelled.draftId, revision: preview.items[0].revision }], timezone: 'Australia/Sydney', confirmation: 'SCHEDULE' })).json();
    assert.equal(scheduled.scheduled, 1); assert.notEqual(scheduled.results[0].jobId, 'job');
    assert.equal((await f.db.collection('scheduled_jobs').findOne({ _id: 'job' })).status, 'cancelled');
    const second = (await request('DELETE', '/jobs/' + scheduled.results[0].jobId)).json();
    const returned = await f.db.collection('drafts').findOne({ _id: new ObjectId(second.draftId) });
    assert.equal(returned.content, 'Reviewed restored post'); assert.equal(returned.scheduledAt, draft.scheduledAt);
    assert.equal(await f.db.collection('drafts').countDocuments({ workspaceId: 'one' }), 1);
  } finally { await app.close(); }
});
