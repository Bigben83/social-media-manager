const { randomUUID } = require('crypto');

// Mongo stores the recoverable payload/checkpoints; Redis provides locking and
// stalled-worker recovery. Payloads never contain decrypted provider credentials.
function createBackgroundJobs({ getDb, queue, handlers = {}, log = { error() {} } }) {
  const collection = async () => (await getDb()).collection('ai_jobs');
  const options = { attempts: 1, removeOnComplete: { age: 172800 }, removeOnFail: { age: 172800 } };
  async function enqueue(doc) { await queue.add(doc.type, { id: doc._id }, { ...options, jobId: doc._id }); }
  async function submit(workspaceId, type, payload) {
    if (!handlers[type]) throw new Error('Unknown background job type');
    const doc = { _id: randomUUID(), workspaceId, type, payload, checkpoint: {}, status: 'queued', progress: { step: '', completed: 0, total: 0 }, result: null, error: null, createdAt: new Date(), updatedAt: new Date() };
    const col = await collection();
    await col.insertOne(doc);
    try { await enqueue(doc); }
    catch (err) { await col.updateOne({ _id: doc._id }, { $set: { error: 'Queue unavailable; job will resume when the gateway recovers', updatedAt: new Date() } }); throw Object.assign(new Error('Background queue unavailable; request recorded for recovery'), { statusCode: 503 }); }
    return doc;
  }
  async function get(id, workspaceId) { return (await collection()).findOne({ _id: id, workspaceId }); }
  async function process(job) {
    const col = await collection();
    const doc = await col.findOne({ _id: job.data.id });
    if (!doc || ['done', 'failed', 'cancelled'].includes(doc.status)) return;
    const scope = { _id: doc._id, workspaceId: doc.workspaceId };
    async function assertWorkspace() {
      const workspace = await (await getDb()).collection('workspaces').findOne({ _id: doc.workspaceId });
      const current = await col.findOne(scope);
      if (!workspace || workspace.deleting || !current || current.status === 'cancelled') throw new Error('Workspace or job no longer available');
    }
    const save = async fields => { await assertWorkspace(); await col.updateOne(scope, { $set: { ...fields, updatedAt: new Date() } }); };
    try {
      await save({ status: 'running', error: null });
      const checkpoint = { ...doc.checkpoint };
      const result = await handlers[doc.type](doc, {
        checkpoint,
        assertWorkspace,
        setProgress: async progress => { doc.progress = { ...doc.progress, ...progress }; await save({ progress: doc.progress }); },
        saveCheckpoint: async patch => { Object.assign(checkpoint, patch); await save({ checkpoint }); },
      });
      await save({ status: 'done', result, expiresAt: new Date(Date.now() + 172800000) });
      return result;
    } catch (err) {
      if ((await col.findOne(scope))?.status === 'cancelled') return;
      await col.updateOne(scope, { $set: { status: 'failed', error: err.message, updatedAt: new Date(), expiresAt: new Date(Date.now() + 172800000) } });
      log.error({ action: 'background_job', jobId: doc._id, type: doc.type, err: err.message });
      throw err;
    }
  }
  async function recover() {
    const col = await collection();
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await col.createIndex({ workspaceId: 1, status: 1 });
    for (const doc of await col.find({ status: { $in: ['queued', 'running'] } }).toArray()) {
      const existing = await queue.getJob(doc._id);
      if (!existing) await enqueue(doc);
      else if (['completed','failed'].includes(await existing.getState())) {
        await existing.remove();
        await enqueue(doc);
      }
    }
  }
  async function cancel(id, workspaceId) {
    const result = await (await collection()).updateOne({ _id: id, workspaceId, status: { $in: ['queued', 'running'] } }, { $set: { status: 'cancelled', updatedAt: new Date(), expiresAt: new Date(Date.now() + 172800000) } });
    return !!result.matchedCount;
  }
  async function retry(id, workspaceId) {
    const col = await collection(), doc = await col.findOne({ _id: id, workspaceId, status: 'failed' });
    if (!doc) return false;
    const old = await queue.getJob(id);
    if (old) { if (!['failed', 'completed'].includes(await old.getState())) return false; await old.remove(); }
    const claimed = await col.updateOne({ _id: id, workspaceId, status: 'failed' }, { $set: { status: 'queued', error: null, expiresAt: null } });
    if (!claimed.matchedCount) return false;
    await enqueue(doc);
    return true;
  }
  return { submit, get, process, recover, cancel, retry };
}

function registerBackgroundJobs(app, getDb, handlers, log) {
  let queue, worker, connection;
  const proxy = { add: (...args) => queue.add(...args), getJob: (...args) => queue.getJob(...args) };
  const jobs = createBackgroundJobs({ getDb, queue: proxy, handlers, log });
  app.addHook('onReady', async () => {
    if (process.env.NODE_ENV === 'test') return;
    const { Queue, Worker } = require('bullmq');
    const Redis = require('ioredis');
    connection = new Redis(process.env.REDIS_URL || 'redis://redis:6379', { maxRetriesPerRequest: null });
    connection.on('error', err => log.error({ action: 'background_redis', err: err.message }));
    queue = new Queue('background-ai', { connection });
    worker = new Worker('background-ai', job => jobs.process(job), { connection, concurrency: 2, lockDuration: 120000 });
    worker.on('error', err => log.error({ action: 'background_worker', err: err.message }));
    worker.on('failed', (job, err) => log.error({ action: 'background_failed', jobId: job?.id, err: err.message }));
    await jobs.recover();
  });
  app.addHook('onClose', async () => { if (worker) await worker.close(); if (queue) await queue.close(); if (connection) await connection.quit(); });
  return jobs;
}
module.exports = { createBackgroundJobs, registerBackgroundJobs };
