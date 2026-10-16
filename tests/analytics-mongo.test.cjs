const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { historyPipeline, normalizePost, summaryAccumulator } = require('../services/gateway/analytics');

// Run against a disposable database: MONGO_TEST_URI=mongodb://... node --test tests/analytics-mongo.test.cjs
test('native history aggregation deduplicates receipts and isolates workspaces/accounts', { skip: !process.env.MONGO_TEST_URI }, async () => {
  const client = await MongoClient.connect(process.env.MONGO_TEST_URI);
  const db = client.db(`analytics_test_${require('crypto').randomUUID().replaceAll('-', '')}`);
  try {
    const date = new Date();
    const appPost = (id, workspaceId, platform, accountId, postId, placement) => ({ _id: id, workspaceId, type: 'immediate', status: 'published', content: id, publishedAt: date,
      destinations: [{ platform, accountId, ...(placement && { instagramPlacement: placement }) }],
      platformResults: { [`${platform}:${accountId}${placement ? ':' + placement : ''}`]: { success: true, postId } } });
    await db.collection('posts').insertMany([
      appPost('fb-app', 'a', 'facebook', 'page', '123'),
      appPost('ig-app', 'a', 'instagram', 'ig', '456', 'reel'),
      appPost('other-ws', 'b', 'instagram', 'ig', 'external'),
      appPost('other-account', 'a', 'instagram', 'different', 'external'),
    ]);
    await db.collection('scheduled_jobs').insertOne({ ...appPost('scheduled', 'a', 'instagram', 'ig', '789'), status: 'completed', completedAt: date });
    const metric = (id, platform, accountId, postId, workspaceId = 'a') => ({ _id: id, workspaceId, platform, accountId, postId, publishedAt: date, fetchedAt: date, content: id });
    await db.collection('post_metrics').insertMany([
      metric('fb-known', 'facebook', 'page', 'page_123'),
      metric('ig-known', 'instagram', 'ig', '456'),
      metric('scheduled-known', 'instagram', 'ig', '789'),
      metric('external-old', 'instagram', 'ig', 'external'),
      { ...metric('external-new', 'instagram', 'ig', 'external'), fetchedAt: new Date(date.getTime() + 1000) },
      metric('only-in-b', 'instagram', 'ig', 'private', 'b'),
    ]);
    const rows = await db.collection('scheduled_jobs').aggregate(historyPipeline('a')).toArray();
    assert.equal(rows.length, 5); // four app posts, one native post
    const imported = rows.filter(r => r.type === 'imported');
    assert.deepEqual(imported.map(r => r._id), ['external-new']);
    assert.equal(imported[0].platformResults['instagram:ig'].postId, 'external');
    const filtered = await db.collection('scheduled_jobs').aggregate(historyPipeline('a', { platform: 'instagram', accountId: 'ig' })).toArray();
    assert.equal(filtered.length, 3);
    const summary = summaryAccumulator(); filtered.forEach(row => summary.add(normalizePost(row)));
    assert.equal(summary.result().imported, 1);
    assert.equal(summary.result().deliveries, 2);
    assert.equal(summary.result().successRate, 100);
    assert.equal((await db.collection('scheduled_jobs').aggregate(historyPipeline('a', null, '2000-01')).toArray()).length, 0);
  } finally { await db.dropDatabase(); await client.close(); }
});

test('history sync uses one active job per workspace and resumes its persisted cursor after restart', { skip: !process.env.MONGO_TEST_URI }, async () => {
  const client = await MongoClient.connect(process.env.MONGO_TEST_URI);
  const db = client.db(`analytics_sync_test_${require('crypto').randomUUID().replaceAll('-', '')}`);
  const app = require('fastify')();
  const { registerAnalyticsSync } = require('../services/gateway/analyticsSync');
  const { createBackgroundJobs } = require('../services/gateway/jobs');
  const handlers = {}, queue = { add: async () => {}, getJob: async () => null };
  const jobs = createBackgroundJobs({ getDb: async () => db, queue, handlers });
  let failed = false;
  const http = { get: async (_url, { params }) => {
    if (params.after === 'cursor') {
      if (!failed) { failed = true; throw new Error('network failure'); }
      return { data: { data: [{ id: '2', created_time: '2020-01-01T00:00:00Z' }] } };
    }
    return { data: { data: [{ id: '1', created_time: '2021-01-01T00:00:00Z' }], paging: { next: 'ignored', cursors: { after: 'cursor' } } } };
  } };
  app.addHook('preHandler', async request => { request.workspaceId = request.headers['x-workspace-id'] || 'a'; });
  registerAnalyticsSync(app, { getDb: async () => db, jobs, handlers, http, getCredentials: async () => ({ pages: [{ id: 'page', selected: true, accessToken: 'encrypted' }] }), decryptToken: () => 'token' });
  try {
    await db.collection('workspaces').insertOne({ _id: 'a' });
    await app.ready();
    const requests = await Promise.all(Array.from({ length: 8 }, () => app.inject({ method: 'POST', url: '/analytics/crawl', payload: { history: 'all', account: 'facebook:page' } })));
    assert.ok(requests.every(r => r.statusCode === 202));
    const ids = new Set(requests.map(r => r.json().jobId)); assert.equal(ids.size, 1);
    const id = [...ids][0];
    await assert.rejects(jobs.process({ data: { id } }), /Some accounts/);
    const saved = await jobs.get(id, 'a');
    assert.equal(saved.checkpoint.accounts['facebook:page'].after, 'cursor');
    assert.equal(saved.progress.count, 1);
    const restarted = createBackgroundJobs({ getDb: async () => db, queue, handlers });
    assert.equal(await restarted.retry(id, 'a'), true);
    await restarted.process({ data: { id } });
    assert.equal((await restarted.get(id, 'a')).result.total, 2);
    assert.equal(await db.collection('post_metrics').countDocuments({ workspaceId: 'a' }), 2);
    const summary = summaryAccumulator();
    for (const doc of await db.collection('scheduled_jobs').aggregate(historyPipeline('a')).toArray()) summary.add(normalizePost(doc));
    assert.equal(summary.result().total, 2);
    assert.equal(summary.result().deliveries, 0);
  } finally { await app.close(); await db.dropDatabase(); await client.close(); }
});
