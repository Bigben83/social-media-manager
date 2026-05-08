require('dotenv').config();
const Fastify = require('fastify');
const axios = require('axios');
const cron = require('node-cron');
const { getDb } = require('./utils/MongoDBConnector');
const RabbitMQProducer = require('./utils/RabbitMQProducer');

const FEED_REFRESH_INTERVAL = process.env.FEED_REFRESH_INTERVAL || '*/5 * * * *'; // Her 5 dakika

// Platform servis URL'leri (docker network içinde)
const PLATFORM_SERVICES = {
  twitter:   process.env.TWITTER_SERVICE_URL   || 'http://twitter:3001',
  linkedin:  process.env.LINKEDIN_SERVICE_URL  || 'http://linkedin:3002',
  mastodon:  process.env.MASTODON_SERVICE_URL  || 'http://mastodon:3003',
  bluesky:   process.env.BLUESKY_SERVICE_URL   || 'http://bluesky:3004',
  instagram: process.env.INSTAGRAM_SERVICE_URL || 'http://instagram:3005',
  facebook:  process.env.FACEBOOK_SERVICE_URL  || 'http://facebook:3006',
};

const app = Fastify({ logger: false });
let producer;

// ─── Feed Çekme ──────────────────────────────────────────────────────────────

async function fetchPlatformFeed(platform, serviceUrl) {
  try {
    const response = await axios.get(`${serviceUrl}/feed`, { timeout: 15000 });
    const items = response.data.items || [];
    console.log(`[FeedAggregator] ${platform}: ${items.length} öğe çekildi`);

    // WebSocket üzerinden UI'ya bildir
    if (producer && items.length > 0) {
      await producer.sendMessage('feed.items', JSON.stringify({ platform, items, fetchedAt: new Date() }));
    }

    return items;
  } catch (err) {
    console.error(`[FeedAggregator] ${platform} feed hatası:`, err.message);
    return [];
  }
}

async function fetchAllFeeds() {
  console.log('[FeedAggregator] Tüm platformlardan feed çekiliyor...');

  const results = await Promise.allSettled(
    Object.entries(PLATFORM_SERVICES).map(([platform, url]) =>
      fetchPlatformFeed(platform, url)
    )
  );

  const summary = {};
  Object.keys(PLATFORM_SERVICES).forEach((platform, i) => {
    summary[platform] = results[i].status === 'fulfilled' ? results[i].value.length : 0;
  });

  console.log('[FeedAggregator] Tamamlandı:', summary);
  return summary;
}

// ─── HTTP Endpoints ──────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'feed-aggregator' }));

app.post('/fetch', async (request) => {
  const { platform } = request.body || {};
  if (platform && PLATFORM_SERVICES[platform]) {
    const items = await fetchPlatformFeed(platform, PLATFORM_SERVICES[platform]);
    return { success: true, platform, count: items.length };
  }
  const summary = await fetchAllFeeds();
  return { success: true, summary };
});

app.get('/feeds', async (request) => {
  const { platform, tag, limit = 50, skip = 0 } = request.query;
  const db = await getDb();
  const col = db.collection('feeds');

  const filter = {};
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

app.get('/platform-status', async () => {
  const statuses = await Promise.allSettled(
    Object.entries(PLATFORM_SERVICES).map(async ([platform, url]) => {
      const response = await axios.get(`${url}/status`, { timeout: 5000 });
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
  producer = new RabbitMQProducer();
  await producer.connect();

  // Periyodik feed yenileme
  cron.schedule(FEED_REFRESH_INTERVAL, () => {
    fetchAllFeeds().catch(console.error);
  });

  await app.listen({ port: process.env.PORT || 3010, host: '0.0.0.0' });
  console.log(`[FeedAggregator] Started. Cron: ${FEED_REFRESH_INTERVAL}`);

  // İlk çalıştırma
  setTimeout(() => fetchAllFeeds(), 5000);
}

start().catch(console.error);
