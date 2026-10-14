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
beforeAll(async () => { await app.ready(); await new Promise(resolve => setImmediate(resolve)); });
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
