jest.mock('../utils/MongoDBConnector', () => ({ getDb: jest.fn() }));
jest.mock('../ai', () => ({ ...jest.requireActual('../ai'), generateText: jest.fn() }));
jest.mock('../analytics', () => ({ ...jest.requireActual('../analytics'), loadAuditHistory: jest.fn() }));
const fs = require('fs'), os = require('os'), path = require('path');
const fakeDb = require('./fakeDb');
const { getDb } = require('../utils/MongoDBConnector');
const { generateText } = require('../ai');
const { loadAuditHistory } = require('../analytics');
process.env.LOG_LEVEL = 'silent';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smm-audit-tests-'));
const db = fakeDb(); getDb.mockResolvedValue(db);
const app = require('../server');
const request = (url, payload = {}) => app.inject({ method: 'POST', url, headers: { 'x-workspace-id': 'a' }, payload });
const nativePosts = platform => [1, 2, 3].map(i => ({ _id: `native-${i}`, type: 'imported', content: 'Follow us #news', status: 'published', publishedAt: new Date(), destinations: [{ platform, accountId: 'account' }] }));
const historyFor = (posts, mode = 'recent') => ({ posts, imported: posts.length, appSuccessRate: null, period: { mode, sampleSize: posts.length, recentCount: mode === 'recent' ? posts.length : 0, recent7Count: mode === 'recent' ? posts.length : 0, start: posts[0]?.publishedAt.toISOString() || null, end: posts[0]?.publishedAt.toISOString() || null, limited: posts.length < 3 } });
beforeAll(async () => { await app.ready(); await db.collection('workspaces').insertOne({ _id: 'a' }); });
afterAll(async () => { await app.close(); fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); });
beforeEach(() => { generateText.mockReset(); loadAuditHistory.mockReset(); });

test('brand audit accepts native history and does not claim an app delivery success rate', async () => {
  loadAuditHistory.mockResolvedValue(historyFor(nativePosts('instagram')));
  generateText.mockResolvedValue(JSON.stringify({ score: 80, summary: 'Imported history included' }));
  const response = await request('/analytics/audit?account=instagram:account');
  expect(response.statusCode).toBe(200);
  expect(response.json().stats).toMatchObject({ postsLast30: 3, successRate: null, platforms: ['instagram'] });
  expect(loadAuditHistory.mock.calls[0].slice(0, 3)).toEqual([db, 'a', { platform: 'instagram', accountId: 'account' }]);
  const prompt = generateText.mock.calls[0][1].prompt;
  expect(prompt).toContain('Imported native posts: 3');
  expect(prompt).toContain('no app deliveries in this period');
});

test.each(['instagram', 'facebook'])('channel audit uses native %s history and distinguishes missing format metadata', async platform => {
  loadAuditHistory.mockResolvedValue(historyFor(nativePosts(platform)));
  generateText.mockResolvedValue(JSON.stringify({ score: 70, sections: [], topActions: [] }));
  await db.collection('post_metrics').insertOne({ workspaceId: 'a', platform, accountId: 'account', publishedAt: new Date(), metrics: { engagementTotal: 10 } });
  const response = await request('/ai/channel-audit', { accountKey: `${platform}:account` });
  expect(response.statusCode).toBe(200);
  expect(loadAuditHistory.mock.calls[0].slice(0, 3)).toEqual([db, 'a', { platform, accountId: 'account' }]);
  const prompt = generateText.mock.calls[0][1].prompt;
  expect(prompt).toContain(platform === 'instagram' ? '100% (3/3 posts have known format)' : 'unknown (0/3 posts have known format)');
  // Metrics use their publication timestamp, including imports without createdAt.
  expect(prompt).toContain('Average engagement per post: 10');
});

test('audit explains missing history and rejects malformed account filters before generation', async () => {
  loadAuditHistory.mockResolvedValue(historyFor([]));
  expect((await request('/analytics/audit')).statusCode).toBe(400);
  expect((await request('/ai/channel-audit', { accountKey: { platform: 'instagram' } })).statusCode).toBe(400);
  expect(generateText).not.toHaveBeenCalled();
});

test.each(['/analytics/audit', '/ai/channel-audit'])('%s accepts sparse historical evidence with an explicit period', async url => {
  const posts = nativePosts('instagram').slice(0, 1);
  posts[0].publishedAt = new Date('2024-01-01');
  loadAuditHistory.mockResolvedValue(historyFor(posts, 'historical'));
  generateText.mockResolvedValue(JSON.stringify({ score: 50, sections: [], topActions: [] }));
  const response = await request(url);
  expect(response.statusCode).toBe(200);
  expect(response.json().historyPeriod).toMatchObject({ mode: 'historical', sampleSize: 1, limited: true, recentCount: 0 });
  expect(generateText.mock.calls[0][1].prompt).toContain('Older posts describe historical content only');
  if (url === '/analytics/audit') expect(response.json().stats).toMatchObject({ postsLast30: 0, postsLast7: 0, postsPerWeek: 0 });
  else expect(generateText.mock.calls[0][1].prompt).toContain('unknown (only one post)');
});

test.each(['/analytics/audit', '/ai/channel-audit'])('%s reports provider failure separately from missing posts', async url => {
  loadAuditHistory.mockResolvedValue(historyFor(nativePosts('instagram')));
  generateText.mockRejectedValue(new Error('Provider authentication failed'));
  const response = await request(url);
  expect(response.statusCode).toBe(503);
  expect(response.json().detail).toBe('Provider authentication failed');
  expect(response.json().error).not.toContain('posts');
});
