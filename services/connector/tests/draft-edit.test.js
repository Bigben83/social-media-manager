const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId, BSON } = require('mongodb');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createToolServer } = require('../tools');
const fakeDb = require('../../gateway/tests/fakeDb');
const origin = 'https://manager.example';
const draftId = 'a'.repeat(24), foreignId = 'b'.repeat(24);

async function fixture(callback, scopes = ['social:read', 'social:drafts']) {
  const db = fakeDb(), baseCollection = db.collection.bind(db);
  // Mongo returns independent snapshots; the simple shared fake normally returns live references.
  db.collection = name => { const col = baseCollection(name); return { ...col, async findOne(query) { const row = await col.findOne(query); return row && BSON.deserialize(BSON.serialize(row)); } }; };
  await db.collection('workspaces').insertOne({ _id: 'one', name: 'One' });
  await db.collection('workspaces').insertOne({ _id: 'two', name: 'Two' });
  await db.collection('platform_credentials').insertOne({ _id: 'one:facebook', pages: [{ id: 'page-one', name: 'Page', selected: true }] });
  await db.collection('platform_credentials').insertOne({ _id: 'two:facebook', pages: [{ id: 'page-two', selected: true }] });
  for (const filename of ['owned.png', 'replacement.png', 'clip.mp4']) await db.collection('media_files').insertOne({ workspaceId: 'one', filename });
  await db.collection('media_files').insertOne({ workspaceId: 'two', filename: 'private.png' });
  const original = { _id: new ObjectId(draftId), workspaceId: 'one', content: 'Original app draft', firstComment: 'Keep the comment', mediaUrl: origin + '/media/owned.png', scheduledAt: '2026-11-02T09:30', destinations: [{ key: 'facebook:page-one', platform: 'facebook', accountId: 'page-one', label: 'Page', color: '#1877F2', selected: true, imageUrl: origin + '/media/owned.png' }], createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'), mcpFingerprint: 'preserve-create-retry-metadata' };
  await db.collection('drafts').insertOne(original);
  await db.collection('drafts').insertOne({ ...original, _id: new ObjectId(foreignId), workspaceId: 'two' });
  const grant = { scopes: [...scopes], workspaceIds: ['one'] }, dispatches = [];
  const server = createToolServer({ db, auth: { scopes, extra: { grantId: 'test-grant' } }, provider: { getGrant: async () => grant }, publicOrigin: origin, callGateway: async (...args) => { dispatches.push(args); }, callScheduler: async (...args) => { dispatches.push(args); } });
  const client = new Client({ name: 'draft-edit-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  const invoke = (name, args) => client.callTool({ name, arguments: { workspaceId: 'one', ...args } });
  const data = result => { assert.equal(result.isError, undefined, result.content?.[0]?.text); return JSON.parse(result.content[0].text); };
  const read = async () => data(await invoke('get_draft', { draftId })).draft;
  const update = async (changes, extra = {}) => invoke('update_draft', { draftId, requestId: 'edit-one', expectedUpdatedAt: (await read()).updatedAt, changes, ...extra });
  try { await callback({ db, client, invoke, data, read, update, grant, dispatches, original }); }
  finally { await client.close(); await server.close(); }
}

test('draft edits keep the same app draft, preserve omitted fields and are retry-safe', () => fixture(async ({ invoke, data, read, dispatches }) => {
  const before = await read();
  const args = { draftId, requestId: 'text-edit', expectedUpdatedAt: before.updatedAt, changes: { content: 'Updated in this conversation', firstComment: 'Updated comment' } };
  const edited = data(await invoke('update_draft', args));
  assert.equal(edited.draftId, draftId); assert.equal(edited.draft.content, args.changes.content); assert.equal(edited.replayed, false);
  assert.equal(edited.draft.firstComment, 'Updated comment');
  for (const key of ['mediaUrl', 'scheduledAt', 'createdAt', 'mcpFingerprint']) assert.equal(edited.draft[key], before[key]);
  assert.deepEqual(edited.draft.destinations, before.destinations); assert.ok(new Date(edited.draft.updatedAt) > new Date(before.updatedAt));
  assert.match(edited.url, /compose\?draft=a+&workspace=one$/);
  const retry = data(await invoke('update_draft', args)); assert.equal(retry.replayed, true); assert.equal(retry.draft.updatedAt, edited.draft.updatedAt);
  assert.equal((await invoke('update_draft', { ...args, changes: { content: 'Different edit' } })).isError, true);
  assert.equal((await read()).content, args.changes.content); assert.equal(dispatches.length, 0);
}));

test('media replacement and removal stay consistent on the editor and destination fields', () => fixture(async ({ data, read, update }) => {
  let edited = data(await update({ mediaUrl: '/media/replacement.png' }));
  assert.equal(edited.draft.mediaUrl, origin + '/media/replacement.png'); assert.equal(edited.draft.destinations[0].imageUrl, edited.draft.mediaUrl); assert.equal(edited.hasMedia, true);
  edited = data(await update({ destinations: [{ platform: 'facebook', accountId: 'page-one', videoUrl: '/media/clip.mp4' }] }, { requestId: 'video-edit' }));
  assert.equal(edited.draft.mediaUrl, origin + '/media/clip.mp4'); assert.equal(edited.draft.destinations[0].videoUrl, edited.draft.mediaUrl); assert.equal(edited.draft.destinations[0].imageUrl, undefined);
  edited = data(await update({ mediaUrl: '', firstComment: '', scheduledAt: '' }, { requestId: 'remove-fields' }));
  assert.equal(edited.hasMedia, false); assert.equal(edited.draft.mediaUrl, ''); assert.equal(edited.draft.destinations[0].videoUrl, undefined); assert.equal(edited.draft.destinations[0].imageUrl, undefined);
  assert.equal((await read()).firstComment, ''); assert.equal((await read()).scheduledAt, '');
}));

test('draft dates and account selections can change without queueing a post or losing media', () => fixture(async ({ data, update, dispatches }) => {
  let edited = data(await update({ scheduledAt: '2026-11-05T14:45', destinations: [] }));
  assert.equal(edited.draft.scheduledAt, '2026-11-05T14:45'); assert.deepEqual(edited.draft.destinations, []); assert.equal(edited.hasMedia, true);
  edited = data(await update({ destinations: [{ platform: 'facebook', accountId: 'page-one' }] }, { requestId: 'reselect' }));
  assert.equal(edited.draft.destinations[0].selected, true); assert.equal(edited.draft.destinations[0].imageUrl, edited.draft.mediaUrl); assert.equal(dispatches.length, 0);
}));

test('edits reject other workspaces, missing drafts, unowned media and unknown destinations without changes', () => fixture(async ({ invoke, read, update }) => {
  const before = await read();
  for (const args of [{ draftId: foreignId }, { workspaceId: 'two', draftId: foreignId }, { draftId: 'c'.repeat(24) }]) {
    assert.equal((await invoke('get_draft', args)).isError, true);
    assert.equal((await update({ content: 'Denied' }, args)).isError, true);
  }
  for (const changes of [{ mediaUrl: '/media/private.png' }, { mediaUrl: '/media/missing.png' }, { mediaUrl: 'https://other.example/media/owned.png' }, { destinations: [{ platform: 'facebook', accountId: 'page-two' }] }, { mediaUrl: '/media/owned.png', destinations: [{ platform: 'facebook', accountId: 'page-one', videoUrl: '/media/clip.mp4' }] }, { mediaUrl: '', destinations: [{ platform: 'facebook', accountId: 'page-one', imageUrl: '/media/owned.png' }] }]) assert.equal((await update(changes)).isError, true);
  assert.deepEqual(await read(), before);
}));

test('empty patches, unknown fields, invalid dates and blank content are rejected', () => fixture(async ({ read, update }) => {
  const before = await read();
  for (const changes of [{}, { content: ' ' }, { unknown: 'ignored' }, { scheduledAt: '2026-02-30T09:00' }, { scheduledAt: '2026-11-05T25:00' }, { scheduledAt: '2026-11-05T09:00Z' }]) assert.equal((await update(changes)).isError, true);
  assert.deepEqual(await read(), before);
}));

test('stale versions and retries after a manual edit cannot overwrite the newer draft', () => fixture(async ({ db, invoke, data, read }) => {
  const before = await read(), args = { draftId, requestId: 'stale-edit', expectedUpdatedAt: before.updatedAt, changes: { content: 'Chat edit' } };
  const edited = data(await invoke('update_draft', args));
  assert.equal((await invoke('update_draft', { ...args, requestId: 'another-edit' })).isError, true);
  await db.collection('drafts').updateOne({ _id: new ObjectId(draftId) }, { $set: { content: 'Newer browser edit', updatedAt: new Date(new Date(edited.draft.updatedAt).getTime() + 1000) } });
  assert.equal((await invoke('update_draft', args)).isError, true); assert.equal((await read()).content, 'Newer browser edit');
}));

test('a concurrent edit between reading and saving causes a conflict', () => fixture(async ({ db, update, read }) => {
  const collection = db.collection.bind(db); let raced = false;
  db.collection = name => { const col = collection(name); if (name !== 'drafts') return col; return { ...col, async updateOne(query, mutation, options) {
    if (mutation.$set?.mcpLastEdit && !raced) { raced = true; await col.updateOne({ _id: new ObjectId(draftId) }, { $set: { content: 'Concurrent edit', updatedAt: new Date(Date.now() + 1000) } }); }
    return col.updateOne(query, mutation, options);
  } }; };
  assert.equal((await update({ content: 'Must not replace concurrent text' })).isError, true); assert.equal((await read()).content, 'Concurrent edit');
}));

test('draft edit tools respect read-only grants and current scope revocation', async () => {
  await fixture(async ({ client, invoke }) => { const tools = (await client.listTools()).tools; assert.ok(tools.some(t => t.name === 'get_draft')); assert.ok(!tools.some(t => t.name === 'update_draft')); assert.equal((await invoke('update_draft', { draftId, requestId: 'no-write', expectedUpdatedAt: '2026-10-01T00:00:00Z', changes: { content: 'Denied' } })).isError, true); }, ['social:read']);
  await fixture(async ({ client, grant, read, update }) => { const tool = (await client.listTools()).tools.find(t => t.name === 'update_draft'); assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['social:read', 'social:drafts'] }]); assert.equal(tool.annotations.idempotentHint, true); const before = await read(); grant.scopes = ['social:read']; assert.equal((await update({ content: 'Revoked' })).isError, true); assert.deepEqual(await read(), before); });
});
