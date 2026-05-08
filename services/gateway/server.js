require('dotenv').config();
const app = require('fastify')({ logger: false });
const multipart = require('@fastify/multipart');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { ObjectId } = require('mongodb');
const { getDb } = require('./utils/MongoDBConnector');
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
    console.error('[Gateway] Upload write error:', err.message);
    return reply.code(500).send({ error: 'Failed to save file' });
  }

  const stat = fs.statSync(filepath);
  const record = {
    filename,
    originalName: data.filename,
    url: `/media/${filename}`,
    mimetype: data.mimetype,
    size: stat.size,
    uploadedAt: new Date(),
  };

  try {
    const db = await getDb();
    await db.collection('media_files').insertOne(record);
  } catch (err) {
    console.error('[Gateway] Media metadata save error:', err.message);
  }

  return { url: record.url, filename, originalName: data.filename, mimetype: data.mimetype, size: stat.size };
});

// List all uploaded media files, newest first
app.get('/media-library', async () => {
  const db = await getDb();
  const files = await db.collection('media_files').find({}).sort({ uploadedAt: -1 }).toArray();
  return { files };
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
      console.error('[Gateway] Delete error:', err.message);
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
  return reply.code(anyFailed ? 207 : 200).send({ results: output });
});

// ─── Legacy post route ────────────────────────────────────────────────────────

let rabbitMQProducer = new RabbitMQProducer();

app.post('/', async (request, reply) => {
  try {
    await rabbitMQProducer.sendMessage('formatter', request.body.message);
    reply.send({ status: 'ok' });
  } catch (error) {
    console.error('Error handling POST request:', error);
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
  await setCredentials('meta_app', { appId, appSecret });
  return { success: true };
});

// Get Meta App config (secret is masked for UI display)
app.get('/credentials/meta-app', async () => {
  const cred = await getCredentials('meta_app');
  if (!cred) return { configured: false };
  return { configured: true, appId: cred.appId, appSecretHint: `****${cred.appSecret.slice(-4)}` };
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

    const redirectUri = `${APP_BASE_URL}/api/auth/meta/callback`;

    // Exchange code for short-lived token
    const shortRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
      params: {
        client_id: appCred.appId,
        client_secret: appCred.appSecret,
        redirect_uri: redirectUri,
        code,
      },
    });

    // Upgrade to long-lived user token (~60 days)
    const longRes = await axios.get(`${GRAPH_API}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appCred.appId,
        client_secret: appCred.appSecret,
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
        accessToken: page.access_token,
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
            accessToken: userToken,
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
    console.error('[Gateway] Meta OAuth error:', err.response?.data || err.message);
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

  return { success: true, facebookPages: fbPages.filter((p) => p.selected).length, instagramAccounts: igAccounts.filter((a) => a.selected).length };
});

// Disconnect all Meta platforms
app.delete('/credentials/meta', async () => {
  await deleteCredentials('facebook');
  await deleteCredentials('instagram');
  await deleteCredentials('meta_discovery');
  return { success: true };
});

// ─── Credential Status ────────────────────────────────────────────────────────

// Aggregate connection status for all DB-managed platforms
app.get('/credentials', async () => {
  const [metaApp, fb, ig] = await Promise.all([
    getCredentials('meta_app'),
    getCredentials('facebook'),
    getCredentials('instagram'),
  ]);

  const fbPages = (fb?.pages || []).filter((p) => p.selected);
  const igAccounts = (ig?.accounts || []).filter((a) => a.selected);

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
  };
});

module.exports = app;
