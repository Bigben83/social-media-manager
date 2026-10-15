const { test } = require('node:test');
const assert = require('node:assert/strict');
const fakeDb = require('../../gateway/tests/fakeDb');
const { repairDraftMedia } = require('../repair-draft-media');

test('legacy draft repair is scoped to owned unambiguous attachments, defaults to dry run and preserves edits', async () => {
  const db = fakeDb(), origin = 'https://manager.example';
  await db.collection('media_files').insertOne({ filename: 'owned.png', workspaceId: 'one' });
  await db.collection('media_files').insertOne({ filename: 'private.png', workspaceId: 'two' });
  const original = { _id: 'fix', workspaceId: 'one', source: 'mcp', mediaUrl: '', content: 'Keep the text', updatedAt: new Date(), mcpFingerprint: 'keep-retry-key', destinations: [{ imageUrl: origin + '/media/owned.png' }] };
  const cases = [original,
    { ...original, _id: 'private', destinations: [{ imageUrl: origin + '/media/private.png' }] },
    { ...original, _id: 'external', destinations: [{ imageUrl: 'https://other.example/media/owned.png' }] },
    { ...original, _id: 'mixed', destinations: [{ imageUrl: '/media/owned.png' }, { imageUrl: '/media/another.png' }] },
    { ...original, _id: 'text', destinations: [] },
    { ...original, _id: 'edited', mediaUrl: '/media/replacement.png' },
    { ...original, _id: 'manual', source: 'manual' },
  ];
  for (const item of cases) await db.collection('drafts').insertOne(item);
  assert.deepEqual(await repairDraftMedia(db, origin), { inspected: 5, eligible: 1, repaired: 0, skipped: 4 });
  assert.equal((await db.collection('drafts').findOne({ _id: 'fix' })).mediaUrl, '');
  assert.equal((await repairDraftMedia(db, origin, true)).repaired, 1);
  const repaired = await db.collection('drafts').findOne({ _id: 'fix' });
  assert.equal(repaired.mediaUrl, origin + '/media/owned.png');
  assert.equal(repaired.content, original.content); assert.equal(repaired.mcpFingerprint, original.mcpFingerprint); assert.equal(repaired.updatedAt, original.updatedAt);
  assert.equal((await db.collection('drafts').findOne({ _id: 'edited' })).mediaUrl, '/media/replacement.png');
  assert.equal((await repairDraftMedia(db, origin, true)).repaired, 0);
});
