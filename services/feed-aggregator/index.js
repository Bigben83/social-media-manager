require('dotenv').config();
const Fastify = require('fastify');
const axios = require('axios');
const cron = require('node-cron');
const { getDb } = require('./utils/MongoDBConnector');
const { createLogger } = require('./utils/logger');

const FEED_REFRESH_INTERVAL = process.env.FEED_REFRESH_INTERVAL || '*/5 * * * *';

const PLATFORM_SERVICES = {
  twitter:   process.env.TWITTER_SERVICE_URL   || 'http://twitter:3001',
  mastodon:  process.env.MASTODON_SERVICE_URL  || 'http://mastodon:3003',
  bluesky:   process.env.BLUESKY_SERVICE_URL   || 'http://bluesky:3004',
  instagram: process.env.INSTAGRAM_SERVICE_URL || 'http://instagram:3005',
  facebook:  process.env.FACEBOOK_SERVICE_URL  || 'http://facebook:3006',
  pinterest: process.env.PINTEREST_SERVICE_URL || 'http://pinterest:3008',
  tiktok:    process.env.TIKTOK_SERVICE_URL    || 'http://tiktok:3007',
};

const log = createLogger('feed-aggregator');
const app = Fastify({ loggerInstance: log });


// ─── Feed Çekme ──────────────────────────────────────────────────────────────

async function fetchPlatformFeed(platform, serviceUrl, workspaceId = 'default') {
  try {
    const response = await axios.get(`${serviceUrl}/feed`, {
      timeout: 15000,
      headers: { 'X-Workspace-Id': workspaceId },
    });
    const items = (response.data.items || []).map(item => ({ ...item, workspaceId }));
    log.info({ action: 'feed_fetch', platform, count: items.length, outcome: 'success' });

    // WebSocket üzerinden UI'ya bildir
    if (items.length > 0) {
      try { await axios.post(`${process.env.SOCKET_SERVICE_URL || 'http://socket:8084'}/events/feed`, { workspaceId, platform, items: items.slice(0, 100), fetchedAt: new Date() }, { timeout: 5000 }); }
      catch (err) { log.warn({ action: 'feed_notify', err: err.message }); }
    }

    return items;
  } catch (err) {
    log.error({ action: 'feed_fetch', platform, outcome: 'failure', err: err.message });
    return [];
  }
}

// Resolve all workspace IDs so the cron refreshes feeds for every workspace,
// not just 'default'. Falls back to ['default'] if the DB is unavailable.
async function getAllWorkspaceIds() {
  try {
    const db = await getDb();
    const rows = await db.collection('workspaces').find({}, { projection: { _id: 1 } }).toArray();
    const ids = rows.map((r) => r._id).filter(Boolean);
    return ids.length ? ids : ['default'];
  } catch {
    return ['default'];
  }
}

async function fetchAllFeeds(workspaceId) {
  const workspaceIds = workspaceId ? [workspaceId] : await getAllWorkspaceIds();
  log.info({ action: 'feed_fetch_all', workspaces: workspaceIds.length }, 'Fetching feeds for all workspaces');

  const summary = {};
  for (const wsId of workspaceIds) {
    const results = await Promise.allSettled(
      Object.entries(PLATFORM_SERVICES).map(([platform, url]) =>
        fetchPlatformFeed(platform, url, wsId)
      )
    );
    Object.keys(PLATFORM_SERVICES).forEach((platform, i) => {
      const count = results[i].status === 'fulfilled' ? results[i].value.length : 0;
      summary[`${wsId}:${platform}`] = count;
    });
  }

  log.info({ action: 'feed_fetch_all', outcome: 'success', summary });
  return summary;
}

// ─── HTTP Endpoints ──────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'feed-aggregator' }));

app.post('/fetch', async (request, reply) => {
  const { platform } = request.body || {};
  const workspaceId = request.headers['x-workspace-id'] || 'default';
  if (platform && PLATFORM_SERVICES[platform]) {
    const items = await fetchPlatformFeed(platform, PLATFORM_SERVICES[platform], workspaceId);
    return { success: true, platform, count: items.length };
  }
  if (platform) return reply.code(400).send({ error: 'Unsupported platform' });
  const summary = await fetchAllFeeds(workspaceId);
  return { success: true, summary };
});

app.get('/feeds', async (request, reply) => {
  const { platform, tag, limit = 50, skip = 0 } = request.query;
  const workspaceId = request.headers['x-workspace-id'] || 'default';
  if (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 200 || !Number.isSafeInteger(Number(skip)) || Number(skip) < 0) return reply.code(400).send({ error: 'Invalid pagination' });
  const db = await getDb();
  const col = db.collection('feeds');

  // Legacy items (no workspaceId field) only visible in the default workspace to
  // avoid cross-workspace feed bleed.
  const legacyClause = workspaceId === 'default' ? [{ workspaceId: { $exists: false } }] : [];
  const filter = { $or: [{ workspaceId }, ...legacyClause] };
  if (platform) filter.platform = platform;
  if (tag) filter.tags = tag;

  const items = await col
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(Number(skip))
    .limit(Number(limit))
    .toArray();

  return { success: true, count: items.length, items };
});

app.get('/platform-status', async (request) => {
  const workspaceId = request.headers['x-workspace-id'] || 'default';
  const statuses = await Promise.allSettled(
    Object.entries(PLATFORM_SERVICES).map(async ([platform, url]) => {
      const response = await axios.get(`${url}/status`, {
        timeout: 5000,
        headers: { 'X-Workspace-Id': workspaceId },
      });
      return { platform, ...response.data };
    })
  );

  return statuses.map((r, i) => {
    const platform = Object.keys(PLATFORM_SERVICES)[i];
    return r.status === 'fulfilled'
      ? r.value
      : { platform, connected: false, error: r.reason.message };
  });
});

// ─── Başlatma ────────────────────────────────────────────────────────────────

async function start() {
  // Periyodik feed yenileme
  cron.schedule(FEED_REFRESH_INTERVAL, () => {
    fetchAllFeeds().catch((err) => log.error({ action: 'feed_fetch_all', outcome: 'failure', err: err.message }));
  });

  await app.listen({ port: process.env.PORT || 3010, host: '0.0.0.0' });
  log.info({ action: 'service_start', outcome: 'success', cronInterval: FEED_REFRESH_INTERVAL }, 'Feed aggregator started');

  // İlk çalıştırma
  setTimeout(() => fetchAllFeeds(), 5000);
}

start().catch((err) => { log.error({ action: 'service_start', outcome: 'failure', err: err.message }); process.exit(1); });
