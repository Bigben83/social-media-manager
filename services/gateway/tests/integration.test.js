jest.mock('../utils/MongoDBConnector', () => ({ getDb: jest.fn() }));
jest.mock('../utils/RabbitMQProducer', () => class { async sendMessage() {} });
jest.mock('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fakeDb = require('./fakeDb');
const { getDb } = require('../utils/MongoDBConnector');
const axios = require('axios');
process.env.LOG_LEVEL = 'silent';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'social-manager-tests-'));
const db = fakeDb();
getDb.mockResolvedValue(db);
const app = require('../server');
const request = (method, url, workspace = 'test', payload) => app.inject({ method, url, headers: { 'x-workspace-id': workspace }, payload });
beforeAll(async () => {
  await app.ready();
  for (const _id of ['test','other','lookup','oauth','drafts','posting','repeat','receipts','ws-a','ws-b']) await db.collection('workspaces').insertOne({ _id });
});
afterAll(async () => { await app.close(); fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); });
beforeEach(() => { axios.get.mockReset(); axios.post.mockReset(); });

test('pending discovery survives reload and never exposes tokens', async () => {
  await db.collection('platform_credentials').insertOne({ _id: 'test:meta_discovery', pages: [{ id: 'page', name: 'Page', accessToken: 'private', selected: true }], igAccounts: [] });
  const first = (await request('GET', '/auth/meta/discovered')).json();
  const second = (await request('GET', '/auth/meta/discovered')).json();
  expect(first.pending).toBe(true);
  expect(second).toEqual(first);
  expect(JSON.stringify(first)).not.toContain('private');
});
test('discovery is isolated to its workspace', async () => {
  const result = (await request('GET', '/auth/meta/discovered', 'other')).json();
  expect(result.pending).toBe(false);
  expect(result.pages).toEqual([]);
});
test('a Page URL lookup populates pending discovery with linked Instagram', async () => {
  await db.collection('platform_credentials').insertOne({ _id: 'lookup:meta_user', accessToken: 'fake-token' });
  axios.get.mockResolvedValueOnce({ data: { id: 'rack', name: 'Rack-X', access_token: 'fake-page-token' } })
    .mockResolvedValueOnce({ data: { instagram_business_account: { id: 'ig-rack' } } })
    .mockResolvedValueOnce({ data: { id: 'ig-rack', username: 'rackx.app' } });
  const response = await request('POST', '/auth/meta/discover-page', 'lookup', { pageReference: 'https://www.facebook.com/rackxapp' });
  expect(response.statusCode).toBe(200);
  expect(response.json().pages[0].id).toBe('rack');
  expect(response.json().igAccounts[0].username).toBe('rackx.app');
  expect(JSON.stringify(response.json())).not.toContain('fake-page-token');
});
test('OAuth initiation uses an expiring one-time state bound to the workspace', async () => {
  await db.collection('platform_credentials').insertOne({ _id: 'meta_app', appId: 'app', appSecret: 'secret' });
  const response = await request('GET', '/auth/meta/init', 'oauth');
  const url = new URL(response.json().url);
  expect(url.searchParams.get('state')).not.toBe('oauth');
  expect(url.searchParams.get('scope')).toContain('pages_show_list');
  const flow = await db.collection('oauth_states').findOne({ _id: url.searchParams.get('state') });
  expect(flow.workspaceId).toBe('oauth');
  expect(flow.expiresAt.getTime()).toBeGreaterThan(Date.now());
  const invalid = await request('GET', '/auth/meta/callback?state=oauth&code=invalid');
  expect(invalid.headers.location).toContain('Invalid_or_expired_OAuth_state');
  expect(axios.get).not.toHaveBeenCalled();
});

test('drafts retain first comments on create and update', async () => {
  const created = await request('POST', '/drafts', 'drafts', { content: 'Post', firstComment: 'Comment' });
  expect(created.json().firstComment).toBe('Comment');
  await request('PUT', '/drafts/' + created.json()._id, 'drafts', { content: 'Post', firstComment: 'Updated' });
  expect((await request('GET', '/drafts/' + created.json()._id, 'drafts')).json().firstComment).toBe('Updated');
});

test('immediate posting preserves partial results and supports Pinterest', async () => {
  axios.post.mockResolvedValueOnce({ data: { success: true, result: { pinId: 'pin' } } })
    .mockRejectedValueOnce({ response: { status: 400, data: { error: 'No access' } } });
  const response = await request('POST', '/post', 'posting', { content: 'Post', destinations: [{ platform: 'pinterest', accountId: 'board', imageUrl: 'https://example.com/image.jpg' }, { platform: 'facebook', accountId: 'page' }] });
  expect(response.statusCode).toBe(207);
  expect(response.json().success).toBe(false);
  expect(response.json().results[0].success).toBe(true);
  expect(response.json().results[1].retryable).toBe(false);
  expect(axios.post.mock.calls[0][2].headers['Idempotency-Key']).toBeTruthy();
});

test('a repeated platform delivery returns its receipt without publishing twice', async () => {
  const Base = require('../utils/BasePlatformService');
  const service = new Base('facebook');
  service.publishPost = jest.fn().mockResolvedValue({ postId: 'published' });
  await service.app.ready();
  const req = { method: 'POST', url: '/post', headers: { 'x-workspace-id': 'receipts', 'idempotency-key': 'delivery' }, payload: { content: 'Post', accountId: 'page' } };
  expect((await service.app.inject(req)).json().success).toBe(true);
  expect((await service.app.inject(req)).json().success).toBe(true);
  expect(service.publishPost).toHaveBeenCalledTimes(1);
  await service.app.close();
});
test('an immediate HTTP retry returns the original publishing result', async () => {
  axios.post.mockResolvedValue({ data: { success: true, result: { postId: 'published' } } });
  const req = { method: 'POST', url: '/post', headers: { 'x-workspace-id': 'repeat', 'idempotency-key': 'same-request' }, payload: { content: 'Post', destinations: [{ platform: 'facebook', accountId: 'page' }] } };
  const first = await app.inject(req); const repeated = await app.inject(req);
  expect(repeated.json()).toEqual(first.json());
  expect(axios.post).toHaveBeenCalledTimes(1);
});

test('the same account has independent profiles in different workspaces', async () => {
  await request('PUT', '/profiles/facebook:shared', 'ws-a', { businessName: 'Brand A' });
  await request('PUT', '/profiles/facebook:shared', 'ws-b', { businessName: 'Brand B' });
  expect((await request('GET', '/profiles/facebook:shared', 'ws-a')).json().businessName).toBe('Brand A');
  expect((await request('GET', '/profiles/facebook:shared', 'ws-b')).json().businessName).toBe('Brand B');
});
test('another workspace cannot delete an owned media file', async () => {
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'owned.jpg'), 'image');
  await db.collection('media_files').insertOne({ filename: 'owned.jpg', workspaceId: 'ws-a' });
  expect((await request('DELETE', '/media/owned.jpg', 'ws-b')).statusCode).toBe(404);
  expect(fs.existsSync(path.join(process.env.UPLOAD_DIR, 'owned.jpg'))).toBe(true);
});
test('expiry cache entries are isolated by workspace', async () => {
  for (const ws of ['ws-a','ws-b']) await db.collection('platform_credentials').insertOne({ _id: `${ws}:instagram`, accounts: [{ id: ws, username: ws, accessToken: 'fake', selected: true }] });
  axios.get.mockResolvedValue({ data: { data: { is_valid: true, expires_at: 0 } } });
  expect((await request('GET', '/meta/token-expiry', 'ws-a')).json().accounts[0].id).toBe('ws-a');
  expect((await request('GET', '/meta/token-expiry', 'ws-b')).json().accounts[0].id).toBe('ws-b');
});
test('workspace deletion first cancels its queue and removes scoped data', async () => {
  await db.collection('workspaces').insertOne({ _id: 'delete-me' });
  await db.collection('scheduled_jobs').insertOne({ workspaceId: 'delete-me', bullJobId: 'pending' });
  await db.collection('feeds').insertOne({ workspaceId: 'delete-me' });
  axios.delete = jest.fn().mockResolvedValue({ data: { success: true } });
  expect((await request('DELETE', '/workspaces/delete-me')).statusCode).toBe(200);
  expect(axios.delete.mock.calls[0][0]).toContain('/workspaces/delete-me/jobs');
  expect(await db.collection('scheduled_jobs').findOne({ workspaceId: 'delete-me' })).toBeNull();
  expect(await db.collection('feeds').findOne({ workspaceId: 'delete-me' })).toBeNull();
});
test('workspace deletion retains data when publishing is active', async () => {
  await db.collection('workspaces').insertOne({ _id: 'busy' });
  axios.delete = jest.fn().mockRejectedValue({ response: { status: 409, data: { error: 'Publishing active' } } });
  expect((await request('DELETE', '/workspaces/busy')).statusCode).toBe(409);
  expect((await db.collection('workspaces').findOne({ _id: 'busy' })).deleting).toBe(false);
});
