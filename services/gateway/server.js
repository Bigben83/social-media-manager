require('dotenv').config();
const { createLogger } = require('./utils/logger');
const log = createLogger('gateway');
const app = require('fastify')({ logger: log });
const multipart = require('@fastify/multipart');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { ObjectId } = require('mongodb');
const { getDb } = require('./utils/MongoDBConnector');
const { encryptToken, decryptToken, warnIfNoKey } = require('./utils/crypto');
const RabbitMQProducer = require('./utils/RabbitMQProducer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/uploads';
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.avi']);
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } });

const GRAPH_API = 'https://graph.facebook.com/v22.0';

// The public base URL of this app (used for OAuth redirect_uri)
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:8081';

// ─── CORS ────────────────────────────────────────────────────────────────────

app.addHook('onSend', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type');
});

app.options('*', async (request, reply) => {
  reply.code(204).send();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getCredentials(id) {
  const db = await getDb();
  return db.collection('platform_credentials').findOne({ _id: id });
}

async function setCredentials(id, data) {
  const db = await getDb();
  await db.collection('platform_credentials').updateOne(
    { _id: id },
    { $set: { _id: id, ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteCredentials(id) {
  const db = await getDb();
  await db.collection('platform_credentials').deleteOne({ _id: id });
}

// ─── Media Upload & Library ───────────────────────────────────────────────────

app.post('/upload', async (request, reply) => {
  const folder = request.query.folder || null;
  const data = await request.file();
  if (!data) return reply.code(400).send({ error: 'No file provided' });

  const ext = path.extname(data.filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    data.file.resume();
    return reply.code(400).send({ error: `File type "${ext}" is not allowed. Allowed: jpg, jpeg, png, gif, webp, mp4, mov, avi` });
  }

  const filename = `${crypto.randomUUID()}${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  try {
    await pipeline(data.file, fs.createWriteStream(filepath));
  } catch (err) {
    app.log.error({ action: 'media_upload', outcome: 'failure', err: err.message });
    return reply.code(500).send({ error: 'Failed to save file' });
  }

  const stat = fs.statSync(filepath);
  const record = {
    filename,
    originalName: data.filename,
    url: `/media/${filename}`,
    mimetype: data.mimetype,
    size: stat.size,
    folder: folder || null,
    uploadedAt: new Date(),
  };

  try {
    const db = await getDb();
    await db.collection('media_files').insertOne(record);
  } catch (err) {
    app.log.error({ action: 'media_metadata_save', outcome: 'failure', err: err.message });
  }

  return { url: record.url, filename, originalName: data.filename, mimetype: data.mimetype, size: stat.size, folder: record.folder };
});

// List uploaded media files, newest first; optionally filter by folder
// folder=__none__ → unorganized (null/missing); folder=<name> → that folder; omit → all
app.get('/media-library', async (request) => {
  const db = await getDb();
  const { folder } = request.query;
  const query = {};
  if (folder === '__none__') {
    query.$or = [{ folder: { $exists: false } }, { folder: null }, { folder: '' }];
  } else if (folder) {
    query.folder = folder;
  }
  const files = await db.collection('media_files').find(query).sort({ uploadedAt: -1 }).toArray();
  return { files };
});

// List custom folders with per-folder file counts
app.get('/media-folders', async () => {
  const db = await getDb();
  const [folders, counts] = await Promise.all([
    db.collection('media_folders').find({}).sort({ createdAt: 1 }).toArray(),
    db.collection('media_files').aggregate([
      { $group: { _id: { $ifNull: ['$folder', '__none__'] }, count: { $sum: 1 } } },
    ]).toArray(),
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  const total = counts.reduce((s, c) => s + c.count, 0);
  return {
    folders: folders.map((f) => ({ name: f.name, count: countMap[f.name] || 0 })),
    totalCount: total,
    unorganizedCount: countMap['__none__'] || 0,
    folderCounts: countMap,
  };
});

// Create a custom folder
app.post('/media-folders', async (request, reply) => {
  const { name } = request.body || {};
  if (!name?.trim()) return reply.code(400).send({ error: 'Folder name is required' });
  const trimmed = name.trim();
  const db = await getDb();
  if (await db.collection('media_folders').findOne({ name: trimmed })) {
    return reply.code(409).send({ error: 'Folder already exists' });
  }
  await db.collection('media_folders').insertOne({ name: trimmed, createdAt: new Date() });
  return { name: trimmed };
});

// Delete a custom folder; files in it become unorganized
app.delete('/media-folders/:name', async (request, reply) => {
  const name = decodeURIComponent(request.params.name);
  const db = await getDb();
  await db.collection('media_folders').deleteOne({ name });
  await db.collection('media_files').updateMany({ folder: name }, { $set: { folder: null } });
  return { success: true };
});

// Update a file's folder assignment
app.patch('/media/:filename', async (request, reply) => {
  const { filename } = request.params;
  if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
    return reply.code(400).send({ error: 'Invalid filename' });
  }
  const { folder } = request.body || {};
  const db = await getDb();
  const result = await db.collection('media_files').updateOne(
    { filename },
    { $set: { folder: folder || null } },
  );
  if (!result.matchedCount) return reply.code(404).send({ error: 'File not found' });
  return { success: true };
});

// Delete a media file from disk and database
app.delete('/media/:filename', async (request, reply) => {
  const { filename } = request.params;

  // Prevent path traversal
  if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
    return reply.code(400).send({ error: 'Invalid filename' });
  }

  const filepath = path.join(UPLOAD_DIR, filename);
  try {
    fs.unlinkSync(filepath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      app.log.error({ action: 'media_delete', outcome: 'failure', err: err.message });
      return reply.code(500).send({ error: 'Failed to delete file' });
    }
    // Already gone from disk — still clean up DB record
  }

  const db = await getDb();
  await db.collection('media_files').deleteOne({ filename });

  return { success: true };
});

// ─── Drafts ──────────────────────────────────────────────────────────────────

app.post('/drafts', async (request, reply) => {
  const { content = '', mediaUrl = '', scheduledAt = '', destinations = [] } = request.body || {};
  const db = await getDb();
  const now = new Date();
  const result = await db.collection('drafts').insertOne({
    content, mediaUrl, scheduledAt, destinations, createdAt: now, updatedAt: now,
  });
  const draft = await db.collection('drafts').findOne({ _id: result.insertedId });
  return reply.code(201).send(draft);
});

app.get('/drafts', async () => {
  const db = await getDb();
  const drafts = await db.collection('drafts').find({}).sort({ updatedAt: -1 }).toArray();
  return { drafts };
});

app.get('/drafts/:id', async (request, reply) => {
  const { id } = request.params;
  let oid;
  try { oid = new ObjectId(id); } catch { return reply.code(400).send({ error: 'Invalid draft ID' }); }
  const db = await getDb();
  const draft = await db.collection('drafts').findOne({ _id: oid });
  if (!draft) return reply.code(404).send({ error: 'Draft not found' });
  return draft;
});

app.put('/drafts/:id', async (request, reply) => {
  const { id } = request.params;
  let oid;
  try { oid = new ObjectId(id); } catch { return reply.code(400).send({ error: 'Invalid draft ID' }); }
  const { content = '', mediaUrl = '', scheduledAt = '', destinations = [] } = request.body || {};
  const db = await getDb();
  const result = await db.collection('drafts').updateOne(
    { _id: oid },
    { $set: { content, mediaUrl, scheduledAt, destinations, updatedAt: new Date() } }
  );
  if (!result.matchedCount) return reply.code(404).send({ error: 'Draft not found' });
  return { success: true };
});

app.delete('/drafts/:id', async (request, reply) => {
  const { id } = request.params;
  let oid;
  try { oid = new ObjectId(id); } catch { return reply.code(400).send({ error: 'Invalid draft ID' }); }
  const db = await getDb();
  await db.collection('drafts').deleteOne({ _id: oid });
  return { success: true };
});

// ─── Meta Token Expiry & Auto-Refresh ────────────────────────────────────────

let _tokenExpiryCache = null;
let _tokenExpiryCacheAt = 0;
const TOKEN_EXPIRY_TTL = 60 * 60 * 1000; // 1 hour
const TOKEN_REFRESH_THRESHOLD_DAYS = 7;  // refresh when ≤ this many days remain

app.get('/meta/token-expiry', async (request, reply) => {
  if (_tokenExpiryCache && Date.now() - _tokenExpiryCacheAt < TOKEN_EXPIRY_TTL) {
    return _tokenExpiryCache;
  }

  const appCred = await getCredentials('meta_app');
  if (!appCred?.appId || !appCred?.appSecret) return { accounts: [] };
  const plainAppSecret = decryptToken(appCred.appSecret);
  if (!plainAppSecret) return { accounts: [] };

  const ig = await getCredentials('instagram');
  const selectedAccounts = (ig?.accounts || []).filter((a) => a.selected && a.accessToken);
  if (!selectedAccounts.length) return { accounts: [] };

  const appToken = `${appCred.appId}|${plainAppSecret}`;
  const accounts = [];

  for (const account of selectedAccounts) {
    const plainToken = decryptToken(account.accessToken);
    if (!plainToken) continue;
    try {
      const res = await axios.get(`${GRAPH_API}/debug_token`, {
        params: { input_token: plainToken, access_token: appToken },
        timeout: 10000,
      });
      const data = res.data.data;
      const expiresAt = data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null;
      const daysLeft = expiresAt
        ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
      accounts.push({ id: account.id, username: account.username, expiresAt, daysLeft, isValid: !!data.is_valid });
    } catch (err) {
      app.log.warn({ action: 'token_expiry_check', platform: 'instagram', username: account.username, outcome: 'failure', err: err.message });
    }
  }

  _tokenExpiryCache = { accounts, checkedAt: new Date().toISOString() };
  _tokenExpiryCacheAt = Date.now();
  return _tokenExpiryCache;
});

// Refresh Instagram long-lived tokens that are within TOKEN_REFRESH_THRESHOLD_DAYS of expiry.
// Called by the scheduler's daily BullMQ job; can also be triggered manually from Settings.
app.post('/meta/token-refresh', async (request, reply) => {
  const appCred = await getCredentials('meta_app');
  if (!appCred?.appId || !appCred?.appSecret) {
    return reply.code(400).send({ success: false, error: 'Meta app credentials not configured' });
  }
  const plainAppSecret = decryptToken(appCred.appSecret);
  if (!plainAppSecret) {
    return reply.code(500).send({ success: false, error: 'Failed to decrypt app secret' });
  }

  const ig = await getCredentials('instagram');
  const allAccounts = ig?.accounts || [];
  const selectedAccounts = allAccounts.filter((a) => a.selected && a.accessToken);
  if (!selectedAccounts.length) {
    return { success: true, refreshed: 0, skipped: 0, errors: 0 };
  }

  const appToken = `${appCred.appId}|${plainAppSecret}`;
  const refreshed = [];
  const skipped = [];
  const errors = [];

  for (const account of selectedAccounts) {
    const plainToken = decryptToken(account.accessToken);
    if (!plainToken) {
      errors.push({ username: account.username, error: 'decrypt_failed' });
      continue;
    }

    // Check current token expiry via debug_token
    let daysLeft = null;
    try {
      const debugRes = await axios.get(`${GRAPH_API}/debug_token`, {
        params: { input_token: plainToken, access_token: appToken },
        timeout: 10000,
      });
      const data = debugRes.data.data;
      if (!data.is_valid) {
        app.log.warn({ action: 'token_refresh', platform: 'instagram', username: account.username, outcome: 'skip', reason: 'invalid_token' });
        errors.push({ username: account.username, error: 'token_invalid' });
        continue;
      }
      // expires_at is a Unix timestamp; null means never-expiring (page token etc.)
      daysLeft = data.expires_at
        ? Math.ceil((data.expires_at * 1000 - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
    } catch (err) {
      app.log.warn({ action: 'token_refresh', platform: 'instagram', username: account.username, step: 'debug_token', outcome: 'failure', err: err.message });
      errors.push({ username: account.username, error: err.message });
      continue;
    }

    // Token never expires or has plenty of time — skip
    if (daysLeft !== null && daysLeft > TOKEN_REFRESH_THRESHOLD_DAYS) {
      skipped.push({ username: account.username, daysLeft });
      continue;
    }

    // Refresh: exchange current long-lived token for a new one
    try {
      const refreshRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appCred.appId,
          client_secret: plainAppSecret,
          fb_exchange_token: plainToken,
        },
        timeout: 15000,
      });
      // Mutates the element inside allAccounts (same object reference)
      account.accessToken = encryptToken(refreshRes.data.access_token);
      refreshed.push({ username: account.username, previousDaysLeft: daysLeft });
      app.log.info({ action: 'token_refresh', platform: 'instagram', username: account.username, outcome: 'success', previousDaysLeft: daysLeft });
    } catch (err) {
      app.log.error({ action: 'token_refresh', platform: 'instagram', username: account.username, outcome: 'failure', err: err.message });
      errors.push({ username: account.username, error: err.message });
    }
  }

  if (refreshed.length > 0) {
    await setCredentials('instagram', { accounts: allAccounts });
    _tokenExpiryCache = null; // force fresh expiry check on next poll
  }

  app.log.info({ action: 'token_refresh', platform: 'meta', outcome: 'complete', refreshed: refreshed.length, skipped: skipped.length, errors: errors.length });
  return { success: true, refreshed: refreshed.length, skipped: skipped.length, errors: errors.length };
});

// ─── Account Profiles ────────────────────────────────────────────────────────

app.get('/profiles', async () => {
  const db = await getDb();
  const profiles = await db.collection('account_profiles').find({}).toArray();
  return { profiles };
});

app.get('/profiles/:accountKey', async (request, reply) => {
  const { accountKey } = request.params;
  const db = await getDb();
  const profile = await db.collection('account_profiles').findOne({ _id: accountKey });
  return profile ?? { _id: accountKey };
});

app.put('/profiles/:accountKey', async (request, reply) => {
  const { accountKey } = request.params;
  const {
    businessName = '', description = '', websiteUrl = '', industry = '',
    targetAudience = '', toneOfVoice = '', keywords = '', hashtags = '',
    postingGuidelines = '',
  } = request.body || {};
  const db = await getDb();
  await db.collection('account_profiles').updateOne(
    { _id: accountKey },
    { $set: { businessName, description, websiteUrl, industry, targetAudience, toneOfVoice, keywords, hashtags, postingGuidelines, updatedAt: new Date() } },
    { upsert: true }
  );
  return { success: true };
});

// ─── AI / Multi-provider ─────────────────────────────────────────────────────

const DEFAULT_OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://ollama:11434';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

const PROVIDER_MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  groq:   ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
};

const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  groq:   'https://api.groq.com/openai/v1',
};

// Returns decrypted runtime config for the currently active provider
async function getActiveProviderConfig() {
  const aiConfig = await getCredentials('ai_config');
  const provider = aiConfig?.provider || 'ollama';
  if (provider === 'openai' || provider === 'groq') {
    const doc = await getCredentials(`${provider}_config`);
    return {
      provider,
      apiKey: doc?.apiKey ? decryptToken(doc.apiKey) : null,
      model: doc?.model || PROVIDER_MODELS[provider][0],
      baseUrl: PROVIDER_BASE_URLS[provider],
    };
  }
  if (provider === 'gemini') {
    const doc = await getCredentials('gemini_config');
    return {
      provider,
      apiKey: doc?.apiKey ? decryptToken(doc.apiKey) : null,
      model: doc?.model || PROVIDER_MODELS.gemini[0],
    };
  }
  return {
    provider: 'ollama',
    endpoint: aiConfig?.endpoint || DEFAULT_OLLAMA_ENDPOINT,
    model: aiConfig?.model || DEFAULT_OLLAMA_MODEL,
    visionModel: aiConfig?.visionModel || 'llava',
  };
}

function buildOpenAIMessages(prompt, system) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  return messages;
}

// Gemini encodes system as a leading user/model conversation pair
function buildGeminiContents(prompt, system) {
  const contents = [];
  if (system) {
    contents.push({ role: 'user',  parts: [{ text: system }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });
  return contents;
}

app.get('/ai/config', async () => {
  const config = await getCredentials('ai_config');
  return {
    provider:    config?.provider    || 'ollama',
    endpoint:    config?.endpoint    || DEFAULT_OLLAMA_ENDPOINT,
    model:       config?.model       || DEFAULT_OLLAMA_MODEL,
    visionModel: config?.visionModel || 'llava',
    enabled:     config?.enabled     ?? true,
  };
});

app.put('/ai/config', async (request, reply) => {
  const { provider = 'ollama', endpoint, model, visionModel = 'llava', enabled = true } = request.body || {};
  if (provider === 'ollama' && !endpoint) return reply.code(400).send({ error: 'endpoint is required for Ollama' });
  await setCredentials('ai_config', { provider, endpoint, model, visionModel, enabled });
  return { success: true };
});

// ─── Provider management routes ───────────────────────────────────────────────

app.get('/ai/providers', async () => {
  const aiConfig = await getCredentials('ai_config');
  const active = aiConfig?.provider || 'ollama';
  const [openaiDoc, groqDoc, geminiDoc] = await Promise.all([
    getCredentials('openai_config'),
    getCredentials('groq_config'),
    getCredentials('gemini_config'),
  ]);
  return {
    active,
    providers: [
      {
        name: 'ollama',
        configured: true,
        active: active === 'ollama',
        endpoint: aiConfig?.endpoint || DEFAULT_OLLAMA_ENDPOINT,
        model: aiConfig?.model || DEFAULT_OLLAMA_MODEL,
        visionModel: aiConfig?.visionModel || 'llava',
      },
      {
        name: 'openai',
        configured: !!openaiDoc?.apiKey,
        active: active === 'openai',
        model: openaiDoc?.model || PROVIDER_MODELS.openai[0],
        apiKeyHint: openaiDoc?.apiKey ? `sk-...${decryptToken(openaiDoc.apiKey).slice(-4)}` : null,
      },
      {
        name: 'groq',
        configured: !!groqDoc?.apiKey,
        active: active === 'groq',
        model: groqDoc?.model || PROVIDER_MODELS.groq[0],
        apiKeyHint: groqDoc?.apiKey ? `gsk_...${decryptToken(groqDoc.apiKey).slice(-4)}` : null,
      },
      {
        name: 'gemini',
        configured: !!geminiDoc?.apiKey,
        active: active === 'gemini',
        model: geminiDoc?.model || PROVIDER_MODELS.gemini[0],
        apiKeyHint: geminiDoc?.apiKey ? `AIza...${decryptToken(geminiDoc.apiKey).slice(-4)}` : null,
      },
    ],
  };
});

// PUT /ai/provider/:name — save credentials and optionally set as active
// ollama body: { endpoint, model, visionModel, setActive? }
// others body: { apiKey, model, setActive? }
app.put('/ai/provider/:name', async (request, reply) => {
  const { name } = request.params;
  const { apiKey, model, endpoint, visionModel, setActive = false } = request.body || {};

  if (name === 'ollama') {
    if (!endpoint) return reply.code(400).send({ error: 'endpoint is required for Ollama' });
    const existing = await getCredentials('ai_config') || {};
    await setCredentials('ai_config', {
      ...existing,
      provider: setActive ? 'ollama' : (existing.provider || 'ollama'),
      endpoint,
      model: model || DEFAULT_OLLAMA_MODEL,
      visionModel: visionModel || 'llava',
    });
  } else if (['openai', 'groq', 'gemini'].includes(name)) {
    if (!apiKey) return reply.code(400).send({ error: 'apiKey is required' });
    await setCredentials(`${name}_config`, {
      apiKey: encryptToken(apiKey),
      model: model || PROVIDER_MODELS[name][0],
    });
    if (setActive) {
      const existing = await getCredentials('ai_config') || {};
      await setCredentials('ai_config', { ...existing, provider: name });
    }
  } else {
    return reply.code(404).send({ error: `Unknown provider: ${name}` });
  }

  return { success: true };
});

// DELETE /ai/provider/:name — remove provider credentials; falls back to ollama if it was active
app.delete('/ai/provider/:name', async (request, reply) => {
  const { name } = request.params;
  if (name === 'ollama') return reply.code(400).send({ error: 'Cannot remove Ollama provider' });
  if (!['openai', 'groq', 'gemini'].includes(name)) return reply.code(404).send({ error: `Unknown provider: ${name}` });
  const db = await getDb();
  await db.collection('platform_credentials').deleteOne({ _id: `${name}_config` });
  const aiConfig = await getCredentials('ai_config') || {};
  if (aiConfig.provider === name) {
    await setCredentials('ai_config', { ...aiConfig, provider: 'ollama' });
  }
  return { success: true };
});

// POST /ai/provider/:name/models — list models for a provider (test without saving key)
app.post('/ai/provider/:name/models', async (request, reply) => {
  const { name } = request.params;
  const { apiKey: bodyApiKey, endpoint: bodyEndpoint } = request.body || {};

  if (name === 'ollama') {
    const aiConfig = await getCredentials('ai_config');
    const ep = bodyEndpoint || aiConfig?.endpoint || DEFAULT_OLLAMA_ENDPOINT;
    try {
      const res = await axios.get(`${ep}/api/tags`, { timeout: 5000 });
      return { models: (res.data.models || []).map((m) => m.name) };
    } catch (err) {
      return reply.code(503).send({ error: 'Could not reach Ollama', detail: err.message });
    }
  }
  if (['openai', 'groq', 'gemini'].includes(name)) {
    return { models: PROVIDER_MODELS[name] };
  }
  return reply.code(404).send({ error: `Unknown provider: ${name}` });
});

app.get('/ai/models', async (request, reply) => {
  const config = await getCredentials('ai_config');
  const provider = config?.provider || 'ollama';
  if (provider !== 'ollama') {
    return { models: PROVIDER_MODELS[provider] || [], provider };
  }
  const endpoint = request.query.endpoint || config?.endpoint || DEFAULT_OLLAMA_ENDPOINT;
  try {
    const res = await axios.get(`${endpoint}/api/tags`, { timeout: 5000 });
    const models = (res.data.models || []).map((m) => m.name);
    return { models, endpoint };
  } catch (err) {
    return reply.code(503).send({ error: 'Could not reach Ollama — check the endpoint', detail: err.message });
  }
});

app.post('/ai/generate', async (request, reply) => {
  const { prompt, system, model: reqModel } = request.body || {};
  if (!prompt?.trim()) return reply.code(400).send({ error: 'prompt is required' });

  const pconf = await getActiveProviderConfig();
  const model = reqModel || pconf.model;

  try {
    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 90000 });
      return { text: res.data.response, model, done: res.data.done };
    }

    if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return reply.code(503).send({ error: `${pconf.provider} API key not configured` });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
      return { text: res.data.choices[0]?.message?.content || '', model, done: true };
    }

    if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { timeout: 90000 },
      );
      return { text: res.data.candidates?.[0]?.content?.parts?.[0]?.text || '', model, done: true };
    }

    return reply.code(400).send({ error: `Unknown provider: ${pconf.provider}` });
  } catch (err) {
    const status = err.response?.status || 503;
    return reply.code(status).send({ error: 'AI generation failed', detail: err.message });
  }
});

const CAPTION_PROMPT = 'Generate an engaging, concise social media caption for this image. Write only the caption text with relevant hashtags. No explanations or preamble.';

// Vision caption — supports ollama, openai, gemini (groq has no vision)
app.post('/ai/caption', async (request, reply) => {
  const { imageUrl, model: reqModel } = request.body || {};
  if (!imageUrl) return reply.code(400).send({ error: 'imageUrl is required' });

  const pconf = await getActiveProviderConfig();

  let imageBase64, imageMime;
  try {
    let imageBuffer;
    if (imageUrl.startsWith('/media/')) {
      const filename = path.basename(imageUrl);
      imageBuffer = fs.readFileSync(path.join(UPLOAD_DIR, filename));
    } else {
      const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
      imageBuffer = Buffer.from(imgRes.data);
      imageMime = imgRes.headers['content-type'] || 'image/jpeg';
    }
    imageBase64 = imageBuffer.toString('base64');
    if (!imageMime) imageMime = 'image/jpeg';
  } catch (err) {
    return reply.code(400).send({ error: 'Could not load image', detail: err.message });
  }

  try {
    const model = reqModel || pconf.visionModel || pconf.model;

    if (pconf.provider === 'ollama') {
      const res = await axios.post(`${pconf.endpoint}/api/generate`, {
        model, prompt: CAPTION_PROMPT, images: [imageBase64], stream: false,
      }, { timeout: 90000 });
      return { caption: res.data.response, model };
    }

    if (pconf.provider === 'openai') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'OpenAI API key not configured' });
      const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'text', text: CAPTION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
        ]}],
        stream: false,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
      return { caption: res.data.choices[0]?.message?.content || '', model };
    }

    if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return reply.code(503).send({ error: 'Gemini API key not configured' });
      const geminiModel = model || 'gemini-1.5-flash';
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${pconf.apiKey}`,
        { contents: [{ role: 'user', parts: [
          { text: CAPTION_PROMPT },
          { inlineData: { mimeType: imageMime, data: imageBase64 } },
        ]}]},
        { timeout: 90000 },
      );
      return { caption: res.data.candidates?.[0]?.content?.parts?.[0]?.text || '', model: geminiModel };
    }

    return reply.code(400).send({ error: `Provider ${pconf.provider} does not support vision captions` });
  } catch (err) {
    const status = err.response?.status || 503;
    return reply.code(status).send({ error: 'Caption generation failed', detail: err.message });
  }
});

// SSE streaming endpoint — normalized data: { token, done } format for all providers
app.post('/ai/stream', async (request, reply) => {
  const { prompt, system, model: reqModel } = request.body || {};
  if (!prompt?.trim()) return reply.code(400).send({ error: 'prompt is required' });

  const pconf = await getActiveProviderConfig();
  const model = reqModel || pconf.model;

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('X-Accel-Buffering', 'no');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  const writeToken = (token, done = false) => reply.raw.write(`data: ${JSON.stringify({ token, done })}\n\n`);
  const writeError = (msg) => { reply.raw.write(`data: ${JSON.stringify({ error: msg, done: true })}\n\n`); reply.raw.end(); };

  try {
    if (pconf.provider === 'ollama') {
      const ollamaRes = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: true }, { responseType: 'stream', timeout: 120000 });
      ollamaRes.data.on('data', (chunk) => {
        try {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            const data = JSON.parse(line);
            writeToken(data.response || '', !!data.done);
          }
        } catch (_) {}
      });
      ollamaRes.data.on('end', () => reply.raw.end());
      ollamaRes.data.on('error', (err) => writeError(err.message));
      return;
    }

    if (pconf.provider === 'openai' || pconf.provider === 'groq') {
      if (!pconf.apiKey) return writeError(`${pconf.provider} API key not configured`);
      const upstreamRes = await axios.post(`${pconf.baseUrl}/chat/completions`, {
        model, messages: buildOpenAIMessages(prompt, system), stream: true,
      }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, responseType: 'stream', timeout: 120000 });
      upstreamRes.data.on('data', (chunk) => {
        try {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') { writeToken('', true); return; }
            const data = JSON.parse(payload);
            const token = data.choices?.[0]?.delta?.content || '';
            if (token) writeToken(token);
          }
        } catch (_) {}
      });
      upstreamRes.data.on('end', () => reply.raw.end());
      upstreamRes.data.on('error', (err) => writeError(err.message));
      return;
    }

    if (pconf.provider === 'gemini') {
      if (!pconf.apiKey) return writeError('Gemini API key not configured');
      const geminiRes = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${pconf.apiKey}`,
        { contents: buildGeminiContents(prompt, system) },
        { responseType: 'stream', timeout: 120000 },
      );
      geminiRes.data.on('data', (chunk) => {
        try {
          for (const line of chunk.toString().split('\n').filter(Boolean)) {
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));
            const token = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (token) writeToken(token);
          }
        } catch (_) {}
      });
      geminiRes.data.on('end', () => { writeToken('', true); reply.raw.end(); });
      geminiRes.data.on('error', (err) => writeError(err.message));
      return;
    }

    writeError(`Unknown provider: ${pconf.provider}`);
  } catch (err) {
    writeError(err.message);
  }
});

// ─── Bulk AI Draft Generation ─────────────────────────────────────────────────

// POST /ai/bulk-draft — kick off a batch; returns batchId immediately (non-blocking)
// Body: { topics: string[], destinations: Destination[], tone?: string, model?: string }
app.post('/ai/bulk-draft', async (request, reply) => {
  const { topics, destinations = [], tone = '', model: reqModel } = request.body || {};
  if (!Array.isArray(topics) || !topics.length) return reply.code(400).send({ error: 'topics array is required' });

  const filteredTopics = topics.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
  if (!filteredTopics.length) return reply.code(400).send({ error: 'No valid topics provided' });

  const db = await getDb();
  const batchId = new ObjectId();
  const now = new Date();

  await db.collection('bulk_draft_batches').insertOne({
    _id: batchId,
    total: filteredTopics.length,
    completed: 0,
    failed: 0,
    status: 'processing',
    createdAt: now,
    updatedAt: now,
  });

  const selectedDests = destinations.filter((d) => d.selected);
  const toneClause = tone ? `Write in a ${tone} tone.` : '';
  const system = `You are a social media content writer. Create engaging, concise posts that perform well. ${toneClause} Write only the post text with relevant hashtags. No explanations or preamble.`;

  // Fire-and-forget — process topics sequentially in the background
  (async () => {
    const pconf = await getActiveProviderConfig();
    const model = reqModel || pconf.model;

    for (const topic of filteredTopics) {
      try {
        const prompt = `Write a social media post about: ${topic}`;
        let content = '';

        if (pconf.provider === 'ollama') {
          const res = await axios.post(`${pconf.endpoint}/api/generate`, { model, prompt, system, stream: false }, { timeout: 90000 });
          content = res.data.response || '';
        } else if (pconf.provider === 'openai' || pconf.provider === 'groq') {
          if (!pconf.apiKey) throw new Error(`${pconf.provider} API key not configured`);
          const res = await axios.post(`${pconf.baseUrl}/chat/completions`, {
            model, messages: buildOpenAIMessages(prompt, system), stream: false,
          }, { headers: { Authorization: `Bearer ${pconf.apiKey}` }, timeout: 90000 });
          content = res.data.choices[0]?.message?.content || '';
        } else if (pconf.provider === 'gemini') {
          if (!pconf.apiKey) throw new Error('Gemini API key not configured');
          const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${pconf.apiKey}`,
            { contents: buildGeminiContents(prompt, system) },
            { timeout: 90000 },
          );
          content = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        if (content.trim()) {
          const draftNow = new Date();
          await db.collection('drafts').insertOne({
            content: content.trim(),
            mediaUrl: '',
            scheduledAt: '',
            destinations: selectedDests,
            batchId: batchId.toString(),
            topic,
            createdAt: draftNow,
            updatedAt: draftNow,
          });
        }

        await db.collection('bulk_draft_batches').updateOne(
          { _id: batchId },
          { $inc: { completed: 1 }, $set: { updatedAt: new Date() } },
        );
      } catch (err) {
        log.error({ action: 'bulk_draft_topic', topic, outcome: 'failure', err: err.message });
        await db.collection('bulk_draft_batches').updateOne(
          { _id: batchId },
          { $inc: { failed: 1 }, $set: { updatedAt: new Date() } },
        );
      }
    }

    await db.collection('bulk_draft_batches').updateOne(
      { _id: batchId },
      { $set: { status: 'done', updatedAt: new Date() } },
    );
    log.info({ action: 'bulk_draft_batch', batchId: batchId.toString(), total: filteredTopics.length, outcome: 'success' });
  })().catch((err) => {
    log.error({ action: 'bulk_draft_batch', batchId: batchId.toString(), outcome: 'failure', err: err.message });
    getDb().then((d) => d.collection('bulk_draft_batches').updateOne(
      { _id: batchId },
      { $set: { status: 'failed', updatedAt: new Date() } },
    )).catch(() => {});
  });

  return reply.code(202).send({ batchId: batchId.toString() });
});

// GET /ai/bulk-draft/:batchId — poll batch progress
app.get('/ai/bulk-draft/:batchId', async (request, reply) => {
  const { batchId } = request.params;
  let oid;
  try { oid = new ObjectId(batchId); } catch { return reply.code(400).send({ error: 'Invalid batchId' }); }
  const db = await getDb();
  const batch = await db.collection('bulk_draft_batches').findOne({ _id: oid });
  if (!batch) return reply.code(404).send({ error: 'Batch not found' });
  return {
    batchId: batch._id.toString(),
    total: batch.total,
    completed: batch.completed,
    failed: batch.failed,
    status: batch.status,
    processed: batch.completed + batch.failed,
  };
});

// ─── Platform service URLs ────────────────────────────────────────────────────

const PLATFORM_SERVICES = {
  twitter:   process.env.TWITTER_SERVICE_URL   || 'http://twitter:3001',
  linkedin:  process.env.LINKEDIN_SERVICE_URL  || 'http://linkedin:3002',
  mastodon:  process.env.MASTODON_SERVICE_URL  || 'http://mastodon:3003',
  bluesky:   process.env.BLUESKY_SERVICE_URL   || 'http://bluesky:3004',
  instagram: process.env.INSTAGRAM_SERVICE_URL || 'http://instagram:3005',
  facebook:  process.env.FACEBOOK_SERVICE_URL  || 'http://facebook:3006',
};

// Direct multi-platform post endpoint.
// Body: { content: string, destinations: Array<{ platform, accountId?, imageUrl?, videoUrl?, link? }> }
app.post('/post', async (request, reply) => {
  const { content, destinations = [] } = request.body || {};
  if (!content?.trim()) return reply.code(400).send({ error: 'content is required' });
  if (!destinations.length) return reply.code(400).send({ error: 'destinations must not be empty' });

  const results = await Promise.allSettled(
    destinations.map(async ({ platform, accountId, imageUrl, videoUrl, link }) => {
      const serviceUrl = PLATFORM_SERVICES[platform];
      if (!serviceUrl) throw new Error(`Unknown platform: ${platform}`);
      const res = await axios.post(`${serviceUrl}/post`, { content, accountId, imageUrl, videoUrl, link }, { timeout: 30000 });
      return { platform, accountId, ...res.data };
    })
  );

  const output = results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { platform: destinations[i].platform, accountId: destinations[i].accountId, success: false, error: r.reason?.message }
  );

  const anyFailed = output.some((r) => !r.success);
  const anySucceeded = output.some((r) => r.success);
  const postStatus = anyFailed && anySucceeded ? 'partial' : anyFailed ? 'failed' : 'published';

  // Record the post for analytics
  try {
    const db = await getDb();
    await db.collection('posts').insertOne({
      _id: crypto.randomUUID(),
      type: 'immediate',
      content,
      destinations,
      platformResults: Object.fromEntries(
        output.map((r) => [
          r.accountId ? `${r.platform}:${r.accountId}` : r.platform,
          { success: r.success, ...(r.error && { error: r.error }) },
        ])
      ),
      status: postStatus,
      publishedAt: new Date(),
      createdAt: new Date(),
    });
  } catch (err) {
    app.log.warn({ action: 'post_record', outcome: 'failure', err: err.message });
  }

  return reply.code(anyFailed ? 207 : 200).send({ results: output });
});

// ─── Legacy post route ────────────────────────────────────────────────────────

let rabbitMQProducer = new RabbitMQProducer();

app.post('/', async (request, reply) => {
  try {
    await rabbitMQProducer.sendMessage('formatter', request.body.message);
    reply.send({ status: 'ok' });
  } catch (error) {
    app.log.error({ action: 'legacy_post', outcome: 'failure', err: error.message });
    reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// ─── Meta App Credentials ────────────────────────────────────────────────────

// Save Facebook App ID + Secret (entered by user in Settings UI)
app.post('/credentials/meta-app', async (request, reply) => {
  const { appId, appSecret } = request.body || {};
  if (!appId || !appSecret) {
    return reply.code(400).send({ error: 'appId and appSecret are required' });
  }
  await setCredentials('meta_app', { appId, appSecret: encryptToken(appSecret) });
  return { success: true };
});

// Get Meta App config (secret is masked for UI display)
app.get('/credentials/meta-app', async () => {
  const cred = await getCredentials('meta_app');
  if (!cred) return { configured: false };
  const plainSecret = decryptToken(cred.appSecret) || '';
  return { configured: true, appId: cred.appId, appSecretHint: plainSecret ? `****${plainSecret.slice(-4)}` : '****' };
});

// ─── Meta OAuth Flow ──────────────────────────────────────────────────────────

// Return the Facebook OAuth URL to redirect the user to
app.get('/auth/meta/init', async (request, reply) => {
  const cred = await getCredentials('meta_app');
  if (!cred?.appId) {
    return reply.code(400).send({ error: 'Save your Facebook App ID and Secret first' });
  }

  const redirectUri = `${APP_BASE_URL}/api/auth/meta/callback`;
  const scopes = [
    'pages_manage_posts',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_insights',
  ].join(',');

  const url = `https://www.facebook.com/v22.0/dialog/oauth?client_id=${cred.appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code`;
  return { url };
});

// OAuth callback — Facebook redirects here after user authorises
app.get('/auth/meta/callback', async (request, reply) => {
  const { code, error: oauthError } = request.query;

  if (oauthError) {
    return reply.redirect(`${APP_BASE_URL}/settings?meta_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code) {
    return reply.redirect(`${APP_BASE_URL}/settings?meta_error=no_code`);
  }

  try {
    const appCred = await getCredentials('meta_app');
    if (!appCred?.appId) throw new Error('App credentials not configured');
    const appSecret = decryptToken(appCred.appSecret);
    if (!appSecret) throw new Error('Failed to decrypt app secret');

    const redirectUri = `${APP_BASE_URL}/api/auth/meta/callback`;

    // Exchange code for short-lived token
    const shortRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
      params: {
        client_id: appCred.appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code,
      },
    });

    // Upgrade to long-lived user token (~60 days)
    const longRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appCred.appId,
        client_secret: appSecret,
        fb_exchange_token: shortRes.data.access_token,
      },
    });
    const userToken = longRes.data.access_token;

    // Fetch all managed Facebook Pages
    const pagesRes = await axios.get(`${GRAPH_API}/me/accounts`, {
      params: { access_token: userToken, fields: 'id,name,access_token,picture' },
    });

    const pages = [];
    const igAccounts = [];

    for (const page of pagesRes.data.data || []) {
      pages.push({
        id: page.id,
        name: page.name,
        accessToken: encryptToken(page.access_token),
        picture: page.picture?.data?.url || null,
        selected: false,
      });

      // Check for linked Instagram Business Account
      try {
        const igRes = await axios.get(`${GRAPH_API}/${page.id}`, {
          params: {
            fields: 'instagram_business_account',
            access_token: page.access_token,
          },
        });
        if (igRes.data.instagram_business_account?.id) {
          const igId = igRes.data.instagram_business_account.id;
          // Fetch IG account details
          const igProfile = await axios.get(`${GRAPH_API}/${igId}`, {
            params: {
              fields: 'id,username,name,profile_picture_url',
              access_token: userToken,
            },
          });
          igAccounts.push({
            id: igId,
            username: igProfile.data.username || igProfile.data.name,
            name: igProfile.data.name,
            avatar: igProfile.data.profile_picture_url || null,
            accessToken: encryptToken(userToken),
            pageId: page.id,
            selected: false,
          });
        }
      } catch (_) {
        // Page has no linked Instagram account — skip
      }
    }

    // Store discovery results for the UI to pick from
    await setCredentials('meta_discovery', { pages, igAccounts, discoveredAt: new Date() });

    reply.redirect(`${APP_BASE_URL}/settings?meta_discovery=1`);
  } catch (err) {
    app.log.error({ action: 'meta_oauth_callback', platform: 'meta', outcome: 'failure', err: err.response?.data?.error?.message || err.message });
    reply.redirect(`${APP_BASE_URL}/settings?meta_error=${encodeURIComponent(err.message)}`);
  }
});

// Return pending discovery results so the UI can render the page picker
app.get('/auth/meta/discovered', async () => {
  const discovery = await getCredentials('meta_discovery');
  if (!discovery) return { pages: [], igAccounts: [] };
  return { pages: discovery.pages || [], igAccounts: discovery.igAccounts || [] };
});

// User has chosen which pages/accounts to connect
app.post('/auth/meta/save', async (request, reply) => {
  const { selectedPageIds = [], selectedIgAccountIds = [] } = request.body || {};

  const discovery = await getCredentials('meta_discovery');
  if (!discovery) return reply.code(400).send({ error: 'No discovery data found — reconnect via OAuth' });

  const fbPages = (discovery.pages || []).map((p) => ({
    ...p,
    selected: selectedPageIds.includes(p.id),
  }));

  const igAccounts = (discovery.igAccounts || []).map((a) => ({
    ...a,
    selected: selectedIgAccountIds.includes(a.id),
  }));

  await setCredentials('facebook', { pages: fbPages });
  await setCredentials('instagram', { accounts: igAccounts });
  await deleteCredentials('meta_discovery');
  _tokenExpiryCache = null; // invalidate cache after reconnect

  return { success: true, facebookPages: fbPages.filter((p) => p.selected).length, instagramAccounts: igAccounts.filter((a) => a.selected).length };
});

// Disconnect all Meta platforms
app.delete('/credentials/meta', async () => {
  await deleteCredentials('facebook');
  await deleteCredentials('instagram');
  await deleteCredentials('meta_discovery');
  return { success: true };
});

// ─── Pinterest OAuth Flow ─────────────────────────────────────────────────────

const PINTEREST_API = 'https://api.pinterest.com/v5';
const PINTEREST_AUTH_URL = 'https://www.pinterest.com/oauth/';
const PINTEREST_TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';

app.post('/credentials/pinterest-app', async (request, reply) => {
  const { clientId, clientSecret } = request.body || {};
  if (!clientId || !clientSecret) {
    return reply.code(400).send({ error: 'clientId and clientSecret are required' });
  }
  await setCredentials('pinterest_app', { clientId, clientSecret: encryptToken(clientSecret) });
  log.info({ action: 'pinterest_app_save', outcome: 'success' });
  return { success: true };
});

app.get('/credentials/pinterest-app', async () => {
  const cred = await getCredentials('pinterest_app');
  if (!cred) return { configured: false };
  const plain = decryptToken(cred.clientSecret) || '';
  return { configured: true, clientId: cred.clientId, clientSecretHint: plain ? `****${plain.slice(-4)}` : '****' };
});

app.get('/auth/pinterest/init', async (request, reply) => {
  const cred = await getCredentials('pinterest_app');
  if (!cred?.clientId) {
    return reply.code(400).send({ error: 'Save your Pinterest Client ID and Secret first' });
  }
  const redirectUri = `${APP_BASE_URL}/api/auth/pinterest/callback`;
  const scopes = 'pins:read,pins:write,boards:read,user_accounts:read';
  const url = `${PINTEREST_AUTH_URL}?client_id=${cred.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scopes}`;
  return { url };
});

app.get('/auth/pinterest/callback', async (request, reply) => {
  const { code, error: oauthError } = request.query;

  if (oauthError) {
    return reply.redirect(`${APP_BASE_URL}/settings?pinterest_error=${encodeURIComponent(oauthError)}`);
  }
  if (!code) {
    return reply.redirect(`${APP_BASE_URL}/settings?pinterest_error=no_code`);
  }

  try {
    const appCred = await getCredentials('pinterest_app');
    if (!appCred?.clientId) throw new Error('App credentials not configured');
    const clientSecret = decryptToken(appCred.clientSecret);
    if (!clientSecret) throw new Error('Failed to decrypt client secret');

    const redirectUri = `${APP_BASE_URL}/api/auth/pinterest/callback`;
    const basicAuth = Buffer.from(`${appCred.clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await axios.post(
      PINTEREST_TOKEN_URL,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000,
      }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;
    const tokenExpiry = new Date(Date.now() + (expires_in || 30 * 24 * 60 * 60) * 1000).toISOString();

    const [userRes, boardsRes] = await Promise.all([
      axios.get(`${PINTEREST_API}/user_account`, {
        headers: { Authorization: `Bearer ${access_token}` },
        timeout: 10000,
      }),
      axios.get(`${PINTEREST_API}/boards`, {
        headers: { Authorization: `Bearer ${access_token}` },
        params: { page_size: 100 },
        timeout: 15000,
      }),
    ]);

    const boards = (boardsRes.data.items || []).map((b) => ({
      id: b.id,
      name: b.name,
      privacy: b.privacy,
      selected: false,
    }));

    await setCredentials('pinterest', {
      userId: userRes.data.username,
      username: userRes.data.username,
      displayName: userRes.data.business_name || userRes.data.username,
      avatar: userRes.data.profile_image,
      accessToken: encryptToken(access_token),
      refreshToken: refresh_token ? encryptToken(refresh_token) : null,
      tokenExpiry,
      boards,
    });

    log.info({ action: 'pinterest_oauth_callback', username: userRes.data.username, boards: boards.length, outcome: 'success' });
    reply.redirect(`${APP_BASE_URL}/settings?pinterest_connected=1`);
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    log.error({ action: 'pinterest_oauth_callback', outcome: 'failure', err: msg });
    reply.redirect(`${APP_BASE_URL}/settings?pinterest_error=${encodeURIComponent(msg)}`);
  }
});

app.post('/credentials/pinterest/boards', async (request, reply) => {
  const { selectedBoardIds = [] } = request.body || {};
  const cred = await getCredentials('pinterest');
  if (!cred) return reply.code(400).send({ error: 'Pinterest not connected' });

  const boards = (cred.boards || []).map((b) => ({ ...b, selected: selectedBoardIds.includes(b.id) }));
  await setCredentials('pinterest', { ...cred, boards });
  log.info({ action: 'pinterest_boards_save', selected: boards.filter((b) => b.selected).length, outcome: 'success' });
  return { success: true, selected: boards.filter((b) => b.selected).length };
});

app.delete('/credentials/pinterest', async () => {
  await deleteCredentials('pinterest');
  return { success: true };
});

// ─── Credential Status ────────────────────────────────────────────────────────

// Aggregate connection status for all DB-managed platforms
app.get('/credentials', async () => {
  const [metaApp, fb, ig, pinterest] = await Promise.all([
    getCredentials('meta_app'),
    getCredentials('facebook'),
    getCredentials('instagram'),
    getCredentials('pinterest'),
  ]);

  const fbPages = (fb?.pages || []).filter((p) => p.selected);
  const igAccounts = (ig?.accounts || []).filter((a) => a.selected);
  const pinterestBoards = (pinterest?.boards || []).filter((b) => b.selected);

  return {
    metaApp: { configured: !!(metaApp?.appId) },
    facebook: {
      connected: fbPages.length > 0,
      pages: fbPages.map(({ id, name, picture }) => ({ id, name, picture })),
    },
    instagram: {
      connected: igAccounts.length > 0,
      accounts: igAccounts.map(({ id, username, avatar }) => ({ id, username, avatar })),
    },
    pinterest: {
      connected: pinterestBoards.length > 0,
      username: pinterest?.username || null,
      boards: pinterestBoards.map(({ id, name, privacy }) => ({ id, name, privacy })),
      allBoards: (pinterest?.boards || []).map(({ id, name, privacy, selected }) => ({ id, name, privacy, selected })),
    },
  };
});

// ─── Schedule Suggestions ────────────────────────────────────────────────────

// [dayOfWeek (0=Sun), hourUTC] pairs — research-based best-practice defaults
const INDUSTRY_DEFAULTS = {
  facebook:  [[2,9],[3,9],[4,9],[2,12],[4,10]],
  instagram: [[1,11],[2,11],[3,11],[2,14],[3,14]],
  twitter:   [[2,9],[3,9],[4,9],[2,12],[3,12]],
  linkedin:  [[2,8],[3,8],[4,8],[3,12],[4,12]],
  mastodon:  [[2,10],[3,10],[4,10],[1,11],[2,11]],
  bluesky:   [[1,10],[2,10],[3,10],[1,11],[2,11]],
  reddit:    [[1,7],[2,7],[3,7],[4,7],[0,9]],
  youtube:   [[4,12],[5,12],[6,12],[4,15],[5,15]],
  pinterest: [[5,12],[6,14],[0,15],[5,20],[6,20]],
};
const DEFAULT_SLOTS = [[2,9],[3,9],[4,9],[2,12],[3,12]];

// Returns the next UTC Date that falls on `dayOfWeek` at `hourUTC`:00,
// at least `afterMs` milliseconds in the future.
function nextOccurrence(dayOfWeek, hourUTC, afterMs) {
  const candidate = new Date(afterMs);
  candidate.setUTCHours(hourUTC, 0, 0, 0);

  const daysAhead = (dayOfWeek - candidate.getUTCDay() + 7) % 7;
  if (daysAhead === 0 && candidate.getTime() <= afterMs) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  } else {
    candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
  }
  return candidate;
}

const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

app.get('/schedule/suggestions', async (request, reply) => {
  const { platform, accountId } = request.query;
  if (!platform) return reply.code(400).send({ error: 'platform is required' });

  const db = await getDb();
  const query = { platform, ...(accountId && { accountId }) };
  const dataPoints = await db.collection('post_metrics').countDocuments(query);

  let slots;
  let source;

  if (dataPoints >= 10) {
    const agg = await db.collection('post_metrics').aggregate([
      { $match: query },
      { $group: {
        _id: { day: '$dayOfWeek', hour: '$hourOfDay' },
        avgEngagement: { $avg: '$metrics.engagementTotal' },
        count: { $sum: 1 },
      }},
      { $sort: { avgEngagement: -1 } },
      { $limit: 5 },
    ]).toArray();
    slots = agg.map((r) => [r._id.day, r._id.hour]);
    source = 'history';
  } else {
    slots = INDUSTRY_DEFAULTS[platform] || DEFAULT_SLOTS;
    source = 'default';
  }

  // 30-minute lead time so the user has time to finish writing
  const afterMs = Date.now() + 30 * 60 * 1000;
  const suggestions = slots
    .map(([day, hour]) => {
      const dt = nextOccurrence(day, hour, afterMs);
      const h12 = hour % 12 || 12;
      const ampm = hour < 12 ? 'am' : 'pm';
      return {
        utc: dt.toISOString(),
        dayOfWeek: day,
        hour,
        label: `${DAY_ABBR[day]} ${h12}${ampm}`,
      };
    })
    .sort((a, b) => new Date(a.utc) - new Date(b.utc))
    .slice(0, 4);

  app.log.info({ action: 'schedule_suggestions', platform, source, count: suggestions.length });
  return { source, suggestions };
});

// ─── Analytics Metrics Crawl ─────────────────────────────────────────────────

async function crawlFacebookMetrics(db) {
  const fb = await getCredentials('facebook');
  const pages = (fb?.pages || []).filter((p) => p.selected && p.accessToken);
  if (!pages.length) return { count: 0 };

  let count = 0;
  for (const page of pages) {
    const token = decryptToken(page.accessToken);
    if (!token) continue;
    try {
      const res = await axios.get(`${GRAPH_API}/${page.id}/posts`, {
        params: {
          fields: 'id,message,created_time,reactions.summary(total_count),comments.summary(total_count),shares',
          limit: 100,
          access_token: token,
        },
        timeout: 30000,
      });
      for (const post of res.data.data || []) {
        const likes    = post.reactions?.summary?.total_count || 0;
        const comments = post.comments?.summary?.total_count || 0;
        const shares   = post.shares?.count || 0;
        const publishedAt = new Date(post.created_time);
        await db.collection('post_metrics').updateOne(
          { platform: 'facebook', postId: post.id },
          {
            $set: {
              platform: 'facebook',
              accountId: page.id,
              accountName: page.name,
              postId: post.id,
              content: post.message || null,
              publishedAt,
              metrics: { likes, comments, shares, views: 0, saves: 0, engagementTotal: likes + comments + shares },
              hourOfDay: publishedAt.getUTCHours(),
              dayOfWeek: publishedAt.getUTCDay(),
              fetchedAt: new Date(),
            },
          },
          { upsert: true }
        );
        count++;
      }
    } catch (err) {
      app.log.warn({ action: 'metrics_crawl', platform: 'facebook', pageId: page.id, outcome: 'failure', err: err.message });
    }
  }
  return { count };
}

async function crawlInstagramMetrics(db) {
  const ig = await getCredentials('instagram');
  const accounts = (ig?.accounts || []).filter((a) => a.selected && a.accessToken);
  if (!accounts.length) return { count: 0 };

  let count = 0;
  for (const account of accounts) {
    const token = decryptToken(account.accessToken);
    if (!token) continue;
    try {
      const mediaRes = await axios.get(`${GRAPH_API}/${account.id}/media`, {
        params: { fields: 'id,caption,timestamp,like_count,comments_count', limit: 100, access_token: token },
        timeout: 30000,
      });
      for (const media of mediaRes.data.data || []) {
        const likes    = media.like_count    || 0;
        const comments = media.comments_count || 0;
        const publishedAt = new Date(media.timestamp);
        let views = 0;
        let saves = 0;
        try {
          const insRes = await axios.get(`${GRAPH_API}/${media.id}/insights`, {
            params: { metric: 'reach,saved', access_token: token },
            timeout: 10000,
          });
          for (const ins of insRes.data.data || []) {
            if (ins.name === 'reach') views = ins.values?.[0]?.value || 0;
            if (ins.name === 'saved') saves = ins.values?.[0]?.value || 0;
          }
        } catch (_) {}
        await db.collection('post_metrics').updateOne(
          { platform: 'instagram', postId: media.id },
          {
            $set: {
              platform: 'instagram',
              accountId: account.id,
              accountName: account.username,
              postId: media.id,
              content: media.caption || null,
              publishedAt,
              metrics: { likes, comments, shares: 0, views, saves, engagementTotal: likes + comments },
              hourOfDay: publishedAt.getUTCHours(),
              dayOfWeek: publishedAt.getUTCDay(),
              fetchedAt: new Date(),
            },
          },
          { upsert: true }
        );
        count++;
      }
    } catch (err) {
      app.log.warn({ action: 'metrics_crawl', platform: 'instagram', accountId: account.id, outcome: 'failure', err: err.message });
    }
  }
  return { count };
}

app.post('/analytics/crawl', async () => {
  const db = await getDb();
  const results = {};
  for (const [platform, crawler] of [['facebook', crawlFacebookMetrics], ['instagram', crawlInstagramMetrics]]) {
    try {
      results[platform] = await crawler(db);
    } catch (err) {
      app.log.error({ action: 'metrics_crawl', platform, outcome: 'failure', err: err.message });
      results[platform] = { count: 0, error: err.message };
    }
  }
  const total = Object.values(results).reduce((sum, r) => sum + (r.count || 0), 0);
  app.log.info({ action: 'metrics_crawl', outcome: 'complete', total });
  return { success: true, total, byPlatform: results };
});

app.get('/analytics/insights', async (request) => {
  const filter = parseAccountFilter(request.query.account);
  const metricsMatch = filter
    ? { platform: filter.platform, ...(filter.accountId && { accountId: filter.accountId }) }
    : {};
  const db = await getDb();
  const total = await db.collection('post_metrics').countDocuments(metricsMatch);
  if (total === 0) return { empty: true };

  const [byHourRaw, byDayRaw, topPosts, platformComparison, heatmapRaw] = await Promise.all([
    db.collection('post_metrics').aggregate([
      { $match: metricsMatch },
      { $group: { _id: '$hourOfDay', avgEngagement: { $avg: '$metrics.engagementTotal' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    db.collection('post_metrics').aggregate([
      { $match: metricsMatch },
      { $group: { _id: '$dayOfWeek', avgEngagement: { $avg: '$metrics.engagementTotal' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    db.collection('post_metrics').find(metricsMatch).sort({ 'metrics.engagementTotal': -1 }).limit(5).toArray(),
    db.collection('post_metrics').aggregate([
      { $match: metricsMatch },
      { $group: {
        _id: '$platform',
        avgEngagement: { $avg: '$metrics.engagementTotal' },
        avgLikes:      { $avg: '$metrics.likes' },
        avgComments:   { $avg: '$metrics.comments' },
        avgShares:     { $avg: '$metrics.shares' },
        totalPosts:    { $sum: 1 },
      }},
      { $sort: { avgEngagement: -1 } },
    ]).toArray(),
    db.collection('post_metrics').aggregate([
      { $match: metricsMatch },
      { $group: {
        _id: { day: '$dayOfWeek', hour: '$hourOfDay' },
        avgEngagement: { $avg: '$metrics.engagementTotal' },
        count: { $sum: 1 },
      }},
    ]).toArray(),
  ]);

  const byHour = Array.from({ length: 24 }, (_, h) => {
    const e = byHourRaw.find((r) => r._id === h);
    return { hour: h, avgEngagement: Math.round(e?.avgEngagement || 0), count: e?.count || 0 };
  });
  const byDay = Array.from({ length: 7 }, (_, d) => {
    const e = byDayRaw.find((r) => r._id === d);
    return { day: d, avgEngagement: Math.round(e?.avgEngagement || 0), count: e?.count || 0 };
  });
  const heatmap = Array.from({ length: 7 * 24 }, (_, i) => {
    const day  = Math.floor(i / 24);
    const hour = i % 24;
    const e = heatmapRaw.find((r) => r._id.day === day && r._id.hour === hour);
    return { day, hour, avg: Math.round(e?.avgEngagement || 0), count: e?.count || 0 };
  });

  return {
    empty: false,
    total,
    byHour,
    byDay,
    heatmap,
    topPosts: topPosts.map((p) => ({
      platform: p.platform, accountName: p.accountName, postId: p.postId,
      content: p.content, publishedAt: p.publishedAt, metrics: p.metrics,
    })),
    platformComparison: platformComparison.map((p) => ({
      platform: p._id,
      avgEngagement: Math.round(p.avgEngagement),
      avgLikes:      Math.round(p.avgLikes),
      avgComments:   Math.round(p.avgComments),
      avgShares:     Math.round(p.avgShares),
      totalPosts:    p.totalPosts,
    })),
  };
});

// ─── Analytics ────────────────────────────────────────────────────────────────

// Parse "platform" or "platform:accountId" filter strings from the account query param.
function parseAccountFilter(account) {
  if (!account) return null;
  const idx = account.indexOf(':');
  if (idx === -1) return { platform: account };
  return { platform: account.slice(0, idx), accountId: account.slice(idx + 1) };
}

// Build a MongoDB match fragment for scheduled_jobs given an account filter.
function sjFilter(filter) {
  if (!filter) return {};
  return {
    'destinations.platform': filter.platform,
    ...(filter.accountId && { 'destinations.accountId': filter.accountId }),
  };
}

// Build a MongoDB match fragment for posts (type:immediate) given an account filter.
function ipFilter(filter) {
  if (!filter) return {};
  return {
    'destinations.platform': filter.platform,
    ...(filter.accountId && { 'destinations.accountId': filter.accountId }),
  };
}

app.get('/analytics/summary', async (request) => {
  const filter = parseAccountFilter(request.query.account);
  const db = await getDb();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);

  // Post-unwind filter for scheduled_jobs platform breakdown — re-applies the
  // account filter after $unwind so a job targeting multiple platforms only
  // counts the platform(s) that match the filter.
  const unwindFilter = filter ? [{ $match: sjFilter(filter) }] : [];

  const [
    schedCompleted, schedFailed,
    immPublished, immFailed,
    recentSched, recentImm,
    schedPlatformRaw, immPlatformRaw,
    schedDayRaw, immDayRaw,
  ] = await Promise.all([
    db.collection('scheduled_jobs').countDocuments({ status: 'completed', ...sjFilter(filter) }),
    db.collection('scheduled_jobs').countDocuments({ status: 'failed', ...sjFilter(filter) }),
    db.collection('posts').countDocuments({ type: 'immediate', status: { $in: ['published', 'partial'] }, ...ipFilter(filter) }),
    db.collection('posts').countDocuments({ type: 'immediate', status: 'failed', ...ipFilter(filter) }),
    db.collection('scheduled_jobs').countDocuments({ status: 'completed', completedAt: { $gte: sevenDaysAgo }, ...sjFilter(filter) }),
    db.collection('posts').countDocuments({ type: 'immediate', publishedAt: { $gte: sevenDaysAgo }, ...ipFilter(filter) }),
    // Platform breakdown from scheduled_jobs destinations
    db.collection('scheduled_jobs').aggregate([
      { $match: { status: 'completed', ...sjFilter(filter) } },
      { $unwind: '$destinations' },
      ...unwindFilter,
      { $group: { _id: '$destinations.platform', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray(),
    // Platform breakdown from immediate posts platformResults
    db.collection('posts').aggregate([
      { $match: { type: 'immediate', ...ipFilter(filter) } },
      { $project: { results: { $objectToArray: { $ifNull: ['$platformResults', {}] } } } },
      { $unwind: '$results' },
      { $match: { 'results.v.success': true } },
      { $project: { platform: { $arrayElemAt: [{ $split: ['$results.k', ':'] }, 0] } } },
      { $group: { _id: '$platform', count: { $sum: 1 } } },
    ]).toArray(),
    // Activity by day from scheduled_jobs (using completedAt)
    db.collection('scheduled_jobs').aggregate([
      { $match: { status: 'completed', completedAt: { $gte: thirtyDaysAgo }, ...sjFilter(filter) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
    // Activity by day from immediate posts
    db.collection('posts').aggregate([
      { $match: { type: 'immediate', publishedAt: { $gte: thirtyDaysAgo }, ...ipFilter(filter) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$publishedAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
  ]);

  const dayMap = {};
  for (const { _id, count } of [...schedDayRaw, ...immDayRaw]) {
    dayMap[_id] = (dayMap[_id] || 0) + count;
  }
  const byDay = Object.entries(dayMap).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

  const platformMap = {};
  for (const { _id, count } of [...schedPlatformRaw, ...immPlatformRaw]) {
    if (_id) platformMap[_id] = (platformMap[_id] || 0) + count;
  }

  const published = schedCompleted + immPublished;
  const failed    = schedFailed    + immFailed;
  const total     = published + failed;
  const successRate = total > 0 ? Math.round((published / total) * 100) : 0;
  const recentCount = recentSched + recentImm;

  return { total, published, failed, partial: 0, successRate, byPlatform: platformMap, byDay, recentCount };
});

app.get('/analytics/posts', async (request) => {
  const limit  = Math.min(parseInt(request.query.limit || '20', 10), 100);
  const skip   = parseInt(request.query.skip || '0', 10);
  const filter = parseAccountFilter(request.query.account);
  const db = await getDb();

  const sjMatch = { status: { $in: ['completed', 'failed'] }, ...sjFilter(filter) };
  const ipMatch = { type: 'immediate', ...ipFilter(filter) };

  const [scheduledJobs, immediatePosts, schedTotal, immTotal] = await Promise.all([
    db.collection('scheduled_jobs')
      .find(sjMatch)
      .sort({ completedAt: -1, scheduledAt: -1 })
      .skip(skip)
      .limit(limit)
      .project({ content: 1, destinations: 1, status: 1, completedAt: 1, scheduledAt: 1 })
      .toArray(),
    db.collection('posts')
      .find(ipMatch)
      .sort({ publishedAt: -1 })
      .project({ content: 1, destinations: 1, platformResults: 1, status: 1, publishedAt: 1 })
      .toArray(),
    db.collection('scheduled_jobs').countDocuments(sjMatch),
    db.collection('posts').countDocuments(ipMatch),
  ]);

  const normalised = [
    ...scheduledJobs.map((j) => ({
      _id: String(j._id),
      type: 'scheduled',
      content: j.content || null,
      destinations: j.destinations || [],
      platformResults: null,
      status: j.status === 'completed' ? 'published' : 'failed',
      publishedAt: j.completedAt || j.scheduledAt,
    })),
    ...immediatePosts.map((p) => ({
      _id: String(p._id),
      type: 'immediate',
      content: p.content || null,
      destinations: p.destinations || [],
      platformResults: p.platformResults || null,
      status: p.status,
      publishedAt: p.publishedAt,
    })),
  ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
   .slice(0, limit);

  return { posts: normalised, total: schedTotal + immTotal };
});

module.exports = app;
