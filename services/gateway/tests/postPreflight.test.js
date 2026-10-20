jest.mock('../utils/MongoDBConnector', () => ({ getDb: jest.fn() }));
jest.mock('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const fakeDb = require('./fakeDb');
const { getDb } = require('../utils/MongoDBConnector');
process.env.LOG_LEVEL = 'silent';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.APP_BASE_URL = 'https://manager.example';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'post-preflight-'));
const db = fakeDb();
getDb.mockResolvedValue(db);
const app = require('../server');
const destination = { platform: 'instagram', accountId: 'ig', instagramPlacement: 'feed', imageUrl: '/media/original.png' };
const payload = { content: 'Caption', destinations: [{ platform: 'facebook', accountId: 'page', imageUrl: '/media/original.png' }, destination] };
const send = (url, body, workspace = 'one', key) => app.inject({ method: 'POST', url, payload: body, headers: { 'x-workspace-id': workspace, ...(key && { 'idempotency-key': key }) } });
beforeAll(async () => {
  for (const _id of ['one', 'two']) await db.collection('workspaces').insertOne({ _id });
  await db.collection('platform_credentials').insertOne({ _id: 'one:instagram', accounts: [{ id: 'ig', selected: true, accessToken: 'private' }] });
  await app.ready();
});
beforeEach(() => { axios.post.mockReset(); });
afterAll(async () => { await app.close(); fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true }); });
async function image(filename, width = 1080, height = 1440) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#446688' } }).png().toBuffer();
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, filename), bytes);
  await db.collection('media_files').updateOne({ filename, workspaceId: 'one' }, { $set: { filename, workspaceId: 'one' } }, { upsert: true });
  return bytes;
}
test('PNG becomes a cached JPEG at the same dimensions before dispatch; original and Facebook stay intact', async () => {
  const bytes = await image('original.png');
  const preview = await send('/post/preflight', payload);
  expect(preview.statusCode).toBe(200);
  const destinations = preview.json().destinations;
  expect(destinations[0]).toEqual(payload.destinations[0]);
  expect(destinations[1].imageUrl).toMatch(/\.jpg$/);
  const filename = path.basename(destinations[1].imageUrl);
  const meta = await sharp(fs.readFileSync(path.join(process.env.UPLOAD_DIR, filename))).metadata();
  expect(meta).toMatchObject({ width: 1080, height: 1440, format: 'jpeg' });
  expect(fs.readFileSync(path.join(process.env.UPLOAD_DIR, 'original.png'))).toEqual(bytes);
  expect((await send('/post/preflight', payload)).json().destinations).toEqual(destinations);
  expect(axios.post).not.toHaveBeenCalled();
  axios.post.mockResolvedValue({ data: { success: true, result: [{ postId: 'published' }] } });
  const posted = await send('/post', payload, 'one', 'one-post');
  expect(posted.statusCode).toBe(200);
  expect(axios.post.mock.calls.find(c => c[0].includes('instagram'))[1].imageUrl).toBe(destinations[1].imageUrl);
  await send('/post', payload, 'one', 'one-post');
  expect(axios.post).toHaveBeenCalledTimes(2);
});
test('a wrong ratio prevents every destination from publishing and records a repeatable failure', async () => {
  await image('wrong.png', 1024, 1536);
  const body = { ...payload, destinations: [payload.destinations[0], { ...destination, imageUrl: '/media/wrong.png' }] };
  const first = await send('/post', body, 'one', 'bad-ratio');
  expect(first.statusCode).toBe(400);
  expect(first.json()).toMatchObject({ preflight: true, success: false });
  expect(first.json().error).toContain('3:4');
  expect((await send('/post', body, 'one', 'bad-ratio')).json()).toEqual(first.json());
  expect(axios.post).not.toHaveBeenCalled();
});
test('foreign workspace media and disconnected accounts cannot pass preflight', async () => {
  await db.collection('platform_credentials').insertOne({ _id: 'two:instagram', accounts: [{ id: 'ig', selected: true, accessToken: 'other-private' }] });
  const denied = await send('/post/preflight', payload, 'two');
  expect(denied.statusCode).toBe(400);
  expect(denied.json().error).toContain('workspace');
  const disconnected = await send('/post/preflight', { content: 'Caption', destinations: [{ ...destination, accountId: 'missing' }] });
  expect(disconnected.statusCode).toBe(400);
  expect(disconnected.json().error).toContain('connected');
  expect(axios.post).not.toHaveBeenCalled();
});
test('legacy destinations still undergo format conversion and decoded ratio validation', async () => {
  const legacy = { ...destination }; delete legacy.instagramPlacement;
  const result = await send('/post/preflight', { content: 'Caption', destinations: [legacy] });
  expect(result.statusCode).toBe(200);
  expect(result.json().destinations[0].imageUrl).toMatch(/\.jpg$/);
});
