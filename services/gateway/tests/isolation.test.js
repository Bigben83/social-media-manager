process.env.LOG_LEVEL = 'silent';
process.env.ENCRYPTION_KEY = 'b'.repeat(64);
const fakeDb = require('./fakeDb');
const { repairScopedData, encryptFields } = require('../migrations');
const { encryptToken, decryptToken } = require('../utils/crypto');
const { isPublicAddress, publicTarget } = require('../utils/externalFetch');
const { getWorkspaceCredential } = require('../utils/credentials');

test('credential encryption fails closed on malformed keys', () => {
  const key = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'not-a-valid-key';
  expect(() => encryptToken('secret')).toThrow('64 hexadecimal');
  process.env.ENCRYPTION_KEY = key;
  expect(decryptToken(encryptToken('secret'))).toBe('secret');
});
test('migration scopes old records and encrypts nested secrets without damaging dates', async () => {
  const db = fakeDb(); const now = new Date();
  await db.collection('account_profiles').insertOne({ _id: 'facebook:shared', workspaceId: 'ws-a', businessName: 'A' });
  await db.collection('hashtag_stats').insertOne({ _id: 'facebook:shared||#tag', workspaceId: 'ws-a' });
  await db.collection('platform_credentials').insertOne({ _id: 'ws-a:facebook', pages: [{ accessToken: 'secret' }], updatedAt: now });
  await repairScopedData(db); await repairScopedData(db);
  expect((await db.collection('account_profiles').findOne({ _id: 'ws-a:facebook:shared' })).businessName).toBe('A');
  const credentials = await db.collection('platform_credentials').findOne({ _id: 'ws-a:facebook' });
  expect(decryptToken(credentials.pages[0].accessToken)).toBe('secret');
  expect(credentials.updatedAt).toEqual(now);
});
test('encryption migration rejects unreadable ciphertext', () => {
  expect(() => encryptFields({ apiKey: 'ENC:v1:invalid' })).toThrow('cannot be decrypted');
});
test('legacy credentials never fall through into a different workspace', async () => {
  const db = fakeDb(); await db.collection('platform_credentials').insertOne({ _id: 'facebook', pages: [] });
  expect(await getWorkspaceCredential(db, 'facebook', 'ws-b')).toBeNull();
  expect(await getWorkspaceCredential(db, 'facebook', 'default')).not.toBeNull();
});
test('external content cannot reach private addresses, mixed DNS results, or credential URLs', async () => {
  for (const ip of ['127.0.0.1','192.168.8.80','169.254.169.254','::1','::ffff:127.0.0.1']) expect(isPublicAddress(ip)).toBe(false);
  expect(isPublicAddress('93.184.216.34')).toBe(true);
  await expect(publicTarget('http://example.com', async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])).rejects.toThrow('Private network');
  await expect(publicTarget('http://user:password@example.com')).rejects.toThrow('public HTTP');
});
