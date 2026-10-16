const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('mongodb');
const { createCancellation } = require('../services/scheduler/cancellation');
const { createPostProcessor } = require('../services/scheduler/worker');

test('real Mongo cancellation is idempotent and cannot race a publishing claim', { skip: !process.env.MONGO_TEST_URI }, async () => {
  const client = await MongoClient.connect(process.env.MONGO_TEST_URI);
  const db = client.db(`cancel_test_${require('crypto').randomUUID().replaceAll('-', '')}`);
  try {
    await db.collection('workspaces').insertOne({ _id: 'a' });
    const row = { _id: 'cancel', postId: 'cancel', bullJobId: 'cancel', workspaceId: 'a', status: 'pending', content: 'Preserved post', firstComment: 'Preserved first comment', scheduledAt: new Date('2099-01-01'), destinations: [{ platform: 'facebook', accountId: 'page' }] };
    await db.collection('scheduled_jobs').insertOne(row);
    const queue = { getJob: async () => ({ data: { workspaceId: 'a' }, getState: async () => 'delayed', remove: async () => {} }) };
    const cancellation = createCancellation({ getDb: async () => db, getQueue: () => queue });
    const result = await Promise.all(Array.from({ length: 12 }, () => cancellation.cancel('a', 'cancel')));
    assert.equal(new Set(result.map(r => r.draftId)).size, 1);
    assert.equal(await db.collection('drafts').countDocuments({ workspaceId: 'a' }), 1);
    let sends = 0;
    const worker = createPostProcessor({ getDb: async () => db, axios: { post: async () => { sends++; return { data: { success: true, result: { postId: 'native' } } }; } }, log: { info() {} } });
    await worker({ id: 'cancel', data: row, attemptsMade: 0 });
    assert.equal(sends, 0);
    const draftId = new ObjectId(result[0].draftId);
    await db.collection('drafts').updateOne({ _id: draftId }, { $set: { content: 'New edit' } });
    await cancellation.cancel('a', 'cancel');
    assert.equal((await db.collection('drafts').findOne({ _id: draftId })).content, 'New edit');
    await assert.rejects(cancellation.cancel('b', 'cancel'), e => e.statusCode === 404);
    // In a true simultaneous claim, only cancellation or publishing may win.
    for (let i = 0; i < 6; i++) {
      const id = 'race-' + i, current = { ...row, _id: id, postId: id, bullJobId: id };
      await db.collection('scheduled_jobs').insertOne(current);
      const before = sends;
      const [cancelled] = await Promise.allSettled([cancellation.cancel('a', id), worker({ id, data: current, attemptsMade: 0 })]);
      if (cancelled.status === 'fulfilled') {
        assert.equal(sends, before);
        assert.equal((await db.collection('scheduled_jobs').findOne({ _id: id })).status, 'cancelled');
      } else {
        assert.equal(cancelled.reason.statusCode, 409);
        assert.equal(sends, before + 1);
      }
    }
  } finally { await db.dropDatabase(); await client.close(); }
});
