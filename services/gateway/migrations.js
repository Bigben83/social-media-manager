const { encryptToken, decryptToken } = require('./utils/crypto');
const SECRET_FIELDS = new Set(['accessToken','refreshToken','appSecret','clientSecret','apiKey','password','appPassword','bearerToken','accessSecret','codeVerifier']);
function encryptFields(value, field) {
  if (Array.isArray(value)) return value.map(item => encryptFields(item));
  if (value && typeof value === 'object' && !(value instanceof Date) && !value._bsontype) return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,encryptFields(item,key)]));
  if (SECRET_FIELDS.has(field) && typeof value === 'string' && value) {
    if (value.startsWith('ENC:v1:') && decryptToken(value) === null) throw new Error('Stored ciphertext cannot be decrypted; restore the original encryption key');
    return encryptToken(value);
  }
  return value;
}
async function repairScopedData(db) {
  for (const name of ['account_profiles','hashtag_stats']) {
    const collection = db.collection(name);
    for (const doc of await collection.find({}).toArray()) {
      const ws = doc.workspaceId || 'default';
      const id = String(doc._id);
      const newId = id.startsWith(`${ws}:`) ? id : `${ws}:${id}`;
      if (newId === id) continue;
      if (!await collection.findOne({ _id: newId })) await collection.insertOne({ ...doc, _id: newId, workspaceId: ws });
      await collection.deleteOne({ _id: doc._id });
    }
  }
  const folders = db.collection('media_folders');
  for (const folder of await folders.find({ workspaceId: { $exists: false } }).toArray()) {
    const files = await db.collection('media_files').find({ folder: folder.name }).toArray();
    const owners = new Set(files.map(file => file.workspaceId || 'default'));
    if (!owners.size) owners.add('default');
    for (const ws of owners) {
      const id = `${ws}:${folder.name}`;
      if (!await folders.findOne({ _id: id })) await folders.insertOne({ ...folder, _id: id, workspaceId: ws });
    }
    await folders.deleteOne({ _id: folder._id });
  }
  for (const doc of await db.collection('platform_credentials').find({}).toArray()) {
    const encrypted = encryptFields(doc);
    const { _id, ...fields } = encrypted;
    await db.collection('platform_credentials').updateOne({ _id }, { $set: fields });
  }
  await db.collection('oauth_states').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('feeds').createIndex({ workspaceId: 1, platform: 1, originalId: 1 });
  await db.collection('posts').createIndex({ workspaceId: 1, publishedAt: -1 });
  await db.collection('scheduled_jobs').createIndex({ workspaceId: 1, status: 1, scheduledAt: 1 });
  await db.collection('post_metrics').createIndex({ workspaceId: 1, platform: 1, accountId: 1, publishedAt: -1 });
}
module.exports = { repairScopedData, encryptFields };
