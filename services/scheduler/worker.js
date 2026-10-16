const { PLATFORM_SERVICES, destinationKey, deliveryKey, failureResult } = require('./utils/publishing');
const { instagramDeliveryResult } = require('./utils/instagramDelivery');

function createPostProcessor({ getDb, axios, log }) {
  return async function processPostJob(job) {
    const { content, destinations, platforms, media = [], firstComment, workspaceId = 'default' } = job.data;
    const postId = job.data.postId || `scheduled:${workspaceId}:${job.id}`;
    const destList = destinations || (platforms || []).map(platform => ({ platform }));
    const db = await getDb();
    const workspace = await db.collection('workspaces').findOne({ _id: workspaceId });
    const scheduled = await db.collection('scheduled_jobs').findOne({ bullJobId: String(job.id), workspaceId });
    if (!workspace || workspace.deleting || ['cancelled', 'cancelling'].includes(scheduled?.status)) return { cancelled: true };
    const claim = await db.collection('scheduled_jobs').updateOne({ bullJobId: String(job.id), workspaceId, status: { $in: ['pending', 'failed', 'processing'] } }, { $set: { status: 'processing', attempts: job.attemptsMade + 1 } });
    if (scheduled && !claim.matchedCount) return { cancelled: true };
    const existing = await db.collection('posts').findOne({ _id: postId, workspaceId });
    const results = { ...(existing?.platformResults || {}) };
    for (const dest of destList) {
      const key = destinationKey(dest);
      if (dest.platform === 'instagram') {
        const delivery = await db.collection('instagram_deliveries').findOne({ _id: `${workspaceId}:${deliveryKey(postId, dest)}`, workspaceId });
        if (delivery) {
          const outcome = instagramDeliveryResult(delivery);
          results[key] = { ...(outcome.result?.[0] || outcome), success: outcome.success, ...(outcome.processing && { processing: true }) };
          await save();
          continue;
        }
      }
      if (results[key]?.success || results[key]?.uncertain || results[key]?.retryable === false) continue;
      // Persist before dispatch: a restarted worker must not resend an unconfirmed request.
      results[key] = { success: false, uncertain: true, retryable: false, error: 'Publishing outcome is unknown. Check the account before retrying.' };
      await save();
      try {
        const url = PLATFORM_SERVICES[dest.platform];
        if (!url) throw Object.assign(new Error('Unsupported publishing platform'), { response: { status: 400 } });
        const response = await axios.post(`${url}/post`, { content, ...dest, media, firstComment }, { timeout: 120000, headers: { 'X-Workspace-Id': workspaceId, 'Idempotency-Key': deliveryKey(postId, dest) } });
        if (response.data.processing) { results[key] = { ...response.data, retryable: true, uncertain: false }; await save(); continue; }
        if (response.data.success !== true) throw Object.assign(new Error(response.data.error || 'Publishing failed'), { response: { status: response.data.retryable ? 503 : 400, data: response.data } });
        const raw = response.data.result;
        results[key] = { ...(Array.isArray(raw) ? raw[0] : raw), success: true };
      } catch (err) { results[key] = failureResult(err); }
      await save();
    }
    const entries = Object.values(results);
    const processing = entries.some(result => result.processing);
    const allOk = entries.length > 0 && entries.every(result => result.success);
    const anyOk = entries.some(result => result.success);
    const retry = entries.some(result => !result.success && result.retryable && !result.uncertain);
    const finalAttempt = job.attemptsMade + 1 >= (job.opts?.attempts || 1);
    const status = processing ? 'processing' : retry && !finalAttempt ? 'pending' : allOk ? 'published' : anyOk ? 'partial' : 'failed';
    await db.collection('posts').updateOne({ _id: postId, workspaceId }, { $set: { status, ...(anyOk && { publishedAt: new Date() }) } });
    await db.collection('scheduled_jobs').updateOne({ bullJobId: String(job.id), workspaceId }, { $set: { status, platformResults: results, ...(!processing && !(retry && !finalAttempt) && { completedAt: new Date() }) } });
    if (processing && job.moveToDelayed) {
      await job.moveToDelayed(Date.now() + 10000, job.token);
      const { DelayedError } = require('bullmq');
      throw new DelayedError();
    }
    if (retry) throw new Error('Retryable publishing failure');
    log.info({ action: 'job_process', jobId: job.id, status, outcome: allOk ? 'success' : 'failure' });
    return results;

    async function save() {
      await db.collection('posts').updateOne({ _id: postId, workspaceId }, { $set: { content, destinations: destList, firstComment, type: 'scheduled', status: 'processing', platformResults: results, workspaceId }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    }
  };
}
module.exports = { createPostProcessor };
