const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { ObjectId, BSON } = require('mongodb');
const fakeDb = require('../../gateway/tests/fakeDb');
const { registerDraftScheduling, prepareDraft, draftJobId } = require('../drafts');
const { naiveDatetimeToUtc } = require('../utils/timezone');
const id = 'a'.repeat(24), otherId = 'b'.repeat(24), origin = 'https://manager.example';

async function fixture(run) {
  const db = fakeDb(), baseCollection = db.collection.bind(db);
  db.collection = name => { const col = baseCollection(name); return { ...col, async findOne(query) { const row = await col.findOne(query); return row && BSON.deserialize(BSON.serialize(row)); } }; };
  for (const _id of ['one','two']) await db.collection('workspaces').insertOne({ _id });
  await db.collection('platform_credentials').insertOne({ _id: 'one:facebook', pages: [{ id: 'page-one', name: 'Example page', selected: true }] });
  await db.collection('platform_credentials').insertOne({ _id: 'one:instagram', accounts: [{ id: 'ig-one', username: 'example', selected: true }] });
  await db.collection('media_files').insertOne({ filename: 'owned.png', workspaceId: 'one' });
  await db.collection('media_files').insertOne({ filename: 'private.png', workspaceId: 'two' });
  const draft = { _id: new ObjectId(id), workspaceId: 'one', content: 'Ready draft', mediaUrl: '/media/owned.png', firstComment: 'First comment', scheduledAt: '2035-11-02T09:30', destinations: [{ platform: 'facebook', accountId: 'page-one', selected: true }], updatedAt: new Date('2026-10-15T01:00:00Z') };
  await db.collection('drafts').insertOne(draft);
  await db.collection('drafts').insertOne({ ...draft, _id: new ObjectId(otherId), workspaceId: 'two' });
  const jobs = new Map(), calls = [], state = { fail: '', beforeAdd: null };
  const queue = { async getJob(jobId) { return jobs.get(jobId); }, async add(name, data, options) {
    calls.push({ name, data, options }); if (state.beforeAdd) await state.beforeAdd();
    if (state.fail === 'before') { state.fail = ''; throw new Error('Redis unavailable'); }
    if (!jobs.has(options.jobId)) jobs.set(options.jobId, { id: options.jobId, data, opts: options });
    if (state.fail === 'after') { state.fail = ''; throw new Error('Queue response lost'); }
    return jobs.get(options.jobId);
  } };
  const app = Fastify(); registerDraftScheduling(app, { getDb: async () => db, getQueue: () => queue, publicUrl: origin, log: { warn() {} } });
  const request = async (path, body, workspace = 'one') => app.inject({ method: 'POST', url: '/drafts/' + path, headers: { 'x-workspace-id': workspace }, payload: { timezone: 'Australia/Sydney', ...body } });
  const preview = async (ids = [id]) => (await request('preview', { draftIds: ids })).json();
  const schedule = async items => (await request('schedule', { items: items.map(item => ({ draftId: item.draftId, revision: item.revision })), confirmation: 'SCHEDULE' })).json();
  try { await run({ db, draft, request, preview, schedule, jobs, calls, state }); }
  finally { await app.close(); }
}

test('bulk preview validates dates/accounts/media without queueing and preserves timezone conversion', () => fixture(async ({ preview, jobs }) => {
  const result = await preview(); assert.equal(result.items[0].ready, true); assert.equal(jobs.size, 0);
  assert.equal(result.items[0].scheduledAt, '2035-11-01T22:30:00.000Z'); assert.equal(result.items[0].destinations[0].imageUrl, origin + '/media/owned.png');
  assert.equal(result.items[0].firstComment, 'First comment'); assert.equal(result.items[0].accounts[0].name, 'Example page');
  assert.equal(naiveDatetimeToUtc('2026-07-02T09:30','Australia/Sydney'), '2026-07-01T23:30:00.000Z');
  assert.equal(naiveDatetimeToUtc('2026-04-05T02:30','Australia/Sydney'), '2026-04-04T15:30:00.000Z');
  assert.throws(() => naiveDatetimeToUtc('2026-10-04T02:30','Australia/Sydney'), /does not exist/);
}));

test('scheduling moves drafts to a single durable delayed job and retries cannot duplicate it', () => fixture(async ({ db, preview, schedule, jobs, calls }) => {
  const items = (await preview()).items; const first = await schedule(items); assert.equal(first.scheduled, 1);
  assert.equal(await db.collection('drafts').findOne({ _id: new ObjectId(id) }), null); assert.equal(jobs.size, 1);
  const row = await db.collection('scheduled_jobs').findOne({ _id: draftJobId('one', id) }); assert.equal(row.queueState, 'queued'); assert.equal(row.sourceDraftId, id); assert.equal(row.status, 'pending');
  assert.equal(calls[0].data.firstComment, 'First comment'); assert.equal(calls[0].data.destinations[0].imageUrl, origin + '/media/owned.png'); assert.ok(calls[0].options.delay > 0);
  assert.equal((await schedule(items)).scheduled, 1); assert.equal(calls.length, 1); assert.equal(jobs.size, 1);
}));

test('invalid drafts and workspace selections remain untouched with per-draft reasons', () => fixture(async ({ db, draft, preview, jobs }) => {
  const cases = [
    [{ scheduledAt: '' }, 'missing_date'], [{ scheduledAt: '2020-01-01T09:00' }, 'past_date'], [{ scheduledAt: '2035-02-30T09:00' }, 'invalid_date'],
    [{ destinations: [] }, 'no_destinations'], [{ content: '' }, 'missing_content'], [{ mediaUrl: '/media/private.png' }, 'invalid_media'],
    [{ mediaUrl: '/media/missing.png' }, 'invalid_media'], [{ destinations: [{ platform: 'facebook', accountId: 'foreign', selected: true }] }, 'disconnected_account'],
    [{ mediaUrl: '', destinations: [{ platform: 'instagram', accountId: 'ig-one', selected: true }] }, 'invalid_post'],
  ];
  for (const [changes, reason] of cases) {
    await db.collection('drafts').updateOne({ _id: new ObjectId(id) }, { $set: { ...draft, ...changes } });
    const result = (await preview()).items[0]; assert.equal(result.ready, false); assert.equal(result.reason, reason);
    assert.ok(await db.collection('drafts').findOne({ _id: new ObjectId(id) }));
  }
  assert.equal((await preview([otherId])).items[0].reason, 'not_found'); assert.equal(jobs.size, 0);
}));

test('draft or account changes after review require a fresh preview', () => fixture(async ({ db, preview, schedule, jobs }) => {
  const items = (await preview()).items;
  await db.collection('drafts').updateOne({ _id: new ObjectId(id) }, { $set: { content: 'Newer edit', updatedAt: new Date() } });
  assert.equal((await schedule(items)).results[0].reason, 'changed'); assert.equal(jobs.size, 0);
  const latest = (await preview()).items;
  await db.collection('platform_credentials').updateOne({ _id: 'one:facebook' }, { $set: { pages: [] } });
  assert.equal((await schedule(latest)).results[0].reason, 'disconnected_account'); assert.equal(jobs.size, 0);
}));

test('queue failures retain the draft and recover using the same job identifier', async () => {
  for (const failure of ['before','after']) await fixture(async ({ db, preview, schedule, jobs, calls, state }) => {
    const items = (await preview()).items; state.fail = failure;
    assert.equal((await schedule(items)).results[0].success, false); assert.ok(await db.collection('drafts').findOne({ _id: new ObjectId(id) }));
    assert.equal((await schedule(items)).scheduled, 1); assert.equal(jobs.size, 1);
    assert.equal(new Set(calls.map(call => call.options.jobId)).size, 1);
    const row = await db.collection('scheduled_jobs').findOne({ _id: draftJobId('one',id) }); assert.equal(row.status, 'pending'); assert.equal(row.queueState, 'queued');
  });
});

test('partial batches schedule valid drafts and keep failed drafts available', () => fixture(async ({ db, draft, preview, schedule, jobs }) => {
  const badId = 'c'.repeat(24); await db.collection('drafts').insertOne({ ...draft, _id: new ObjectId(badId), scheduledAt: '' });
  const review = await preview([id,badId]); assert.equal(review.items.filter(item => item.ready).length, 1);
  // A draft becoming invalid between preview and confirmation does not block other valid entries.
  await db.collection('drafts').updateOne({ _id: new ObjectId(badId) }, { $set: { scheduledAt: draft.scheduledAt } });
  const ready = (await preview([id,badId])).items; await db.collection('drafts').updateOne({ _id: new ObjectId(badId) }, { $set: { scheduledAt: '' } });
  const result = await schedule(ready); assert.equal(result.success, false); assert.equal(result.scheduled, 1); assert.equal(jobs.size, 1); assert.ok(await db.collection('drafts').findOne({ _id: new ObjectId(badId) }));
}));

test('concurrent submissions deduplicate and a newer browser edit is kept after queueing', () => fixture(async ({ db, preview, schedule, jobs, state }) => {
  const items = (await preview()).items;
  state.beforeAdd = async () => db.collection('drafts').updateOne({ _id: new ObjectId(id) }, { $set: { content: 'Newer browser edit', updatedAt: new Date() } });
  const results = await Promise.all([schedule(items), schedule(items)]);
  assert.equal(jobs.size, 1); assert.ok(results.some(result => result.scheduled === 1));
  assert.equal((await db.collection('drafts').findOne({ _id: new ObjectId(id) })).content, 'Newer browser edit');
  assert.ok(results.some(result => result.results[0].draftRetained));
}));

test('malformed requests, foreign workspaces and deleting workspaces never queue jobs', () => fixture(async ({ db, request, preview, jobs }) => {
  assert.equal((await request('preview', { draftIds: ['bad'] })).statusCode, 400);
  assert.equal((await request('preview', { draftIds: [id], timezone: 'Invalid/Zone' })).statusCode, 400);
  assert.equal((await request('preview', { draftIds: [id] }, 'missing')).statusCode, 400);
  assert.equal((await request('preview', { draftIds: [id] }, 'bad workspace')).statusCode, 400);
  const item = (await preview()).items[0];
  assert.equal((await request('schedule', { items: [item] })).statusCode, 400);
  assert.equal((await request('schedule', { items: [{ draftId: id, revision: item.revision }, { draftId: id, revision: item.revision }], confirmation: 'SCHEDULE' })).statusCode, 400);
  await db.collection('workspaces').updateOne({ _id: 'one' }, { $set: { deleting: true } });
  assert.equal((await request('preview', { draftIds: [id] })).statusCode, 400); assert.equal(jobs.size, 0);
}));

test('absolute dates and per-destination videos are preserved for scheduling', () => fixture(async ({ db }) => {
  await db.collection('drafts').updateOne({ _id: new ObjectId(id) }, { $set: { scheduledAt: '2035-11-01T22:30:00Z', mediaUrl: '', destinations: [{ platform: 'instagram', accountId: 'ig-one', selected: true, videoUrl: 'https://cdn.example/clip.mp4' }] } });
  const prepared = await prepareDraft(db,'one',id,'America/New_York',origin);
  assert.equal(prepared.payload.scheduledAt,'2035-11-01T22:30:00.000Z'); assert.equal(prepared.payload.destinations[0].videoUrl,'https://cdn.example/clip.mp4');
}));
