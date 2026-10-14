require('dotenv').config();
const Fastify = require('fastify');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const axios = require('axios');
const { randomUUID } = require('crypto');
const { getDb, connect, disconnect } = require('./utils/MongoDBConnector');
const { createLogger } = require('./utils/logger');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway:8084';

const { validatePost, scheduleDelay } = require('./utils/publishing');
const { createPostProcessor } = require('./worker');

const log = createLogger('scheduler');
const app = Fastify({ loggerInstance: log });
let postQueue;
let redis;
let postWorker;
let systemWorker;
let systemQueue;

// ─── Job Worker ──────────────────────────────────────────────────────────────

const processPostJob = createPostProcessor({ getDb, axios, log });

// ─── System Job Worker ────────────────────────────────────────────────────────

async function processSystemJob(job) {
  const routes = { 'meta-token-refresh': '/meta/token-refresh', 'metrics-crawl': '/analytics/crawl', 'competitor-scrape': '/competitors/scrape-all' };
  if (!routes[job.name]) return;
  const db = await getDb(); const workspaces = await db.collection('workspaces').find({}).toArray();
  const results = [];
  for (const workspace of workspaces) {
    if (workspace.deleting) continue;
    try {
      const response = await axios.post(GATEWAY_URL + routes[job.name], {}, { timeout: 300000, headers: { 'X-Workspace-Id': workspace._id } });
      results.push({ workspaceId: workspace._id, success: true, ...response.data });
    } catch (err) { results.push({ workspaceId: workspace._id, success: false }); log.warn({ action: job.name, workspaceId: workspace._id, outcome: 'failure', err: err.message }); }
  }
  return results;
}

// ─── HTTP Endpoints ──────────────────────────────────────────────────────────

app.get('/health', async () => ({ status: 'ok', service: 'scheduler' }));

// Create a scheduled post.
// Body: { content, scheduledAt, destinations: [{ platform, accountId?, imageUrl?, videoUrl?, link? }] }
// Legacy { platforms: string[] } still accepted for backwards compatibility.
app.post('/schedule', async (request, reply) => {
  const { content, destinations, platforms, scheduledAt, media = [], firstComment } = request.body || {};
  const postId = randomUUID();
  const workspaceId = request.headers['x-workspace-id'] || 'default';

  const destList = destinations || (platforms || []).map((p) => ({ platform: p }));

  const db = await getDb();
  const workspace = await db.collection('workspaces').findOne({ _id: workspaceId });
  if (!workspace || workspace.deleting) return reply.code(409).send({ error: 'Workspace is unavailable' });
  const error = validatePost(content, destList);
  if (error) return reply.code(400).send({ error });

  let delay;
  try { delay = scheduleDelay(scheduledAt); }
  catch (err) { return reply.code(400).send({ error: err.message }); }

  await db.collection('scheduled_jobs').insertOne({
    _id: postId, postId, type: 'one-time', content, firstComment,
    scheduledAt: new Date(scheduledAt), destinations: destList,
    status: 'pending', attempts: 0, maxAttempts: 3, bullJobId: postId, workspaceId, createdAt: new Date(),
  });
  try {
    const job = await postQueue.add('scheduled-post',
      { postId, content, destinations: destList, media, firstComment: firstComment?.trim() || undefined, workspaceId },
      { jobId: postId, delay, attempts: 3, backoff: { type: 'exponential', delay: 60000 } });
    return { success: true, jobId: job.id, postId, scheduledAt };
  } catch (err) {
    await db.collection('scheduled_jobs').updateOne({ _id: postId, workspaceId }, { $set: { status: 'failed', failReason: 'Could not enqueue post' } });
    return reply.code(503).send({ error: 'Could not enqueue post; retry scheduling' });
  }

});

// Zamanlanmış görevleri listele
app.get('/jobs', async (request) => {
  const { status = 'pending' } = request.query;
  const workspaceId = request.headers['x-workspace-id'] || 'default';
  const db = await getDb();
  // Include legacy jobs without workspaceId (backwards compat)
  const filter = { status, workspaceId };
  const jobs = await db
    .collection('scheduled_jobs')
    .find(filter)
    .sort({ scheduledAt: 1 })
    .toArray();
  return { success: true, count: jobs.length, jobs };
});

// Görevi iptal et
app.delete('/jobs/:jobId', async (request, reply) => {
  const { jobId } = request.params;
  const workspaceId = request.headers['x-workspace-id'] || 'default';

  const db = await getDb();
  const jobDoc = await db.collection('scheduled_jobs').findOne({
    bullJobId: jobId,
    workspaceId,
  });
  if (!jobDoc) return reply.code(404).send({ error: 'Job bulunamadı' });

  const job = await postQueue.getJob(jobId);
  if (job) await job.remove();

  await db.collection('scheduled_jobs').updateOne(
    { bullJobId: jobId, workspaceId },
    { $set: { status: 'cancelled' } }
  );

  return { success: true, jobId };
});

app.delete('/workspaces/:id/jobs', async (request, reply) => {
  const ws = request.headers['x-workspace-id'] || 'default';
  if (ws !== request.params.id) return reply.code(403).send({ error: 'Workspace mismatch' });
  const wasPaused = await postQueue.isPaused(); await postQueue.pause();
  try {
    const active = await postQueue.getJobs(['active']);
    if (active.some(job => (job.data.workspaceId || 'default') === ws)) return reply.code(409).send({ error: 'Wait for active publishing to finish before deleting the workspace' });
    const db = await getDb();
    for (const row of await db.collection('scheduled_jobs').find({ workspaceId: ws }).toArray()) {
      const job = await postQueue.getJob(row.bullJobId); if (job) await job.remove();
    }
    return { success: true };
  } finally { if (!wasPaused) await postQueue.resume(); }
});

// ─── Başlatma ────────────────────────────────────────────────────────────────

async function start() {
  await connect();

  redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

  postQueue = new Queue('post-queue', { connection: redis });

  const worker = postWorker = new Worker('post-queue', processPostJob, { connection: redis });
  worker.on('failed', async (job, err) => {
    log.error({ action: 'job_process', jobId: job?.id, outcome: 'failure', err: err.message });
    if (job?.id && job.attemptsMade >= (job.opts.attempts || 1)) {
      try {
        const db = await getDb();
        await db.collection('scheduled_jobs').updateOne(
          { bullJobId: String(job.id), workspaceId: job.data.workspaceId || 'default', status: 'processing' },
          { $set: { status: 'failed', failedAt: new Date(), failReason: err.message } }
        );
      } catch (_) { /* non-fatal */ }
    }
  });

  // Daily system jobs (housekeeping, token refresh, etc.)
  systemQueue = new Queue('system-queue', { connection: redis });
  systemWorker = new Worker('system-queue', processSystemJob, { connection: redis });
  systemWorker.on('failed', (job, err) => {
    log.error({ action: 'system_job', jobId: job?.id, jobName: job?.name, outcome: 'failure', err: err.message });
  });

  // Register daily system jobs — BullMQ deduplicates by repeat key on restart
  await systemQueue.add(
    'meta-token-refresh',
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 }, removeOnComplete: 5, removeOnFail: 5 }
  );
  log.info({ action: 'system_job_register', job: 'meta-token-refresh', interval: '24h', outcome: 'success' });

  await systemQueue.add(
    'metrics-crawl',
    {},
    { repeat: { every: 24 * 60 * 60 * 1000 }, removeOnComplete: 5, removeOnFail: 5 }
  );
  log.info({ action: 'system_job_register', job: 'metrics-crawl', interval: '24h', outcome: 'success' });

  await systemQueue.add(
    'competitor-scrape',
    {},
    { repeat: { every: 7 * 24 * 60 * 60 * 1000 }, removeOnComplete: 5, removeOnFail: 5 }
  );
  log.info({ action: 'system_job_register', job: 'competitor-scrape', interval: '7d', outcome: 'success' });

  await app.listen({ port: process.env.PORT || 3011, host: '0.0.0.0' });
  log.info({ action: 'service_start', port: 3011, outcome: 'success' }, 'Scheduler started');
}

if (require.main === module) {
  start().catch(err => { log.error({ action: 'service_start', outcome: 'failure', err: err.message }); process.exit(1); });
  const shutdown = async () => {
    try {
      await Promise.all([postWorker?.close(), systemWorker?.close()]);
      await Promise.all([postQueue?.close(), systemQueue?.close(), app.close()]);
      await redis?.quit(); await disconnect(); process.exit(0);
    } catch { process.exit(1); }
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}

module.exports = { app, processPostJob };
