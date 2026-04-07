require('dotenv').config();
const Fastify = require('fastify');
const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const axios = require('axios');
const { getDb, connect } = require('./utils/MongoDBConnector');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

const PLATFORM_SERVICES = {
  twitter:  process.env.TWITTER_SERVICE_URL  || 'http://twitter:3001',
  linkedin: process.env.LINKEDIN_SERVICE_URL || 'http://linkedin:3002',
  mastodon: process.env.MASTODON_SERVICE_URL || 'http://mastodon:3003',
  bluesky:  process.env.BLUESKY_SERVICE_URL  || 'http://bluesky:3004',
};

const app = Fastify({ logger: false });
let postQueue;
let redis;

// ─── Job Worker ──────────────────────────────────────────────────────────────

async function processPostJob(job) {
  const { postId, content, platforms, media = [] } = job.data;
  console.log(`[Scheduler] Job ${job.id} çalışıyor: ${platforms.join(', ')}`);

  const db = await getDb();
  const results = {};

  for (const platform of platforms) {
    const serviceUrl = PLATFORM_SERVICES[platform];
    if (!serviceUrl) {
      results[platform] = { success: false, error: 'Bilinmeyen platform' };
      continue;
    }
    try {
      const response = await axios.post(`${serviceUrl}/post`, { content, media }, { timeout: 30000 });
      results[platform] = { success: true, ...response.data.result };
    } catch (err) {
      results[platform] = { success: false, error: err.message };
    }
  }

  // MongoDB güncelle
  await db.collection('posts').updateOne(
    { _id: postId },
    {
      $set: {
        status: Object.values(results).every((r) => r.success) ? 'published' : 'failed',
        publishedAt: new Date(),
        platformResults: results,
      },
    }
  );

  await db.collection('scheduled_jobs').updateOne(
    { bullJobId: String(job.id) },
    {
      $set: {
        status: 'completed',
        completedAt: new Date(),
      },
    }
  );

  return results;
}

// ─── HTTP Endpoints ──────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'scheduler' }));

// Yeni zamanlanmış gönderi oluştur
app.post('/schedule', async (request, reply) => {
  const { postId, content, platforms, scheduledAt, media = [] } = request.body;

  if (!content || !platforms?.length || !scheduledAt) {
    return reply.code(400).send({ error: 'content, platforms ve scheduledAt zorunlu' });
  }

  const delay = new Date(scheduledAt).getTime() - Date.now();
  if (delay < 0) {
    return reply.code(400).send({ error: 'scheduledAt geçmiş bir tarih olamaz' });
  }

  const job = await postQueue.add(
    'scheduled-post',
    { postId, content, platforms, media },
    { delay, attempts: 3, backoff: { type: 'exponential', delay: 60000 } }
  );

  // MongoDB kayıt
  const db = await getDb();
  await db.collection('scheduled_jobs').insertOne({
    postId,
    type: 'one-time',
    scheduledAt: new Date(scheduledAt),
    platforms,
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    bullJobId: String(job.id),
    createdAt: new Date(),
  });

  return { success: true, jobId: job.id, scheduledAt };
});

// Zamanlanmış görevleri listele
app.get('/jobs', async (request) => {
  const { status = 'pending' } = request.query;
  const db = await getDb();
  const jobs = await db
    .collection('scheduled_jobs')
    .find({ status })
    .sort({ scheduledAt: 1 })
    .toArray();
  return { success: true, count: jobs.length, jobs };
});

// Görevi iptal et
app.delete('/jobs/:jobId', async (request, reply) => {
  const { jobId } = request.params;
  const job = await postQueue.getJob(jobId);
  if (!job) return reply.code(404).send({ error: 'Job bulunamadı' });

  await job.remove();

  const db = await getDb();
  await db.collection('scheduled_jobs').updateOne(
    { bullJobId: jobId },
    { $set: { status: 'cancelled' } }
  );

  return { success: true, jobId };
});

// ─── Başlatma ────────────────────────────────────────────────────────────────

async function start() {
  await connect();

  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  postQueue = new Queue('post-queue', { connection: redis });

  const worker = new Worker('post-queue', processPostJob, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error(`[Scheduler] Job ${job?.id} başarısız:`, err.message);
  });

  await app.listen({ port: process.env.PORT || 3011, host: '0.0.0.0' });
  console.log('[Scheduler] Started on port 3011');
}

start().catch(console.error);
