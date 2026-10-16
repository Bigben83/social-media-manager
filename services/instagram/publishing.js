const { createHash, randomUUID } = require('crypto');
const { instagramPlacement, instagramValidation, instagramContainerParams } = require('./utils/instagram');
const { instagramDeliveryResult: deliveryResult } = require('./utils/instagramDelivery');
const GRAPH_API = 'https://graph.facebook.com/v22.0';
const terminal = ['published', 'failed', 'uncertain', 'cancelled'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const queueId = id => createHash('sha256').update(id).digest('hex');
function createInstagramPublisher({ getDb, queue, request, getAccounts, resolveMediaUrl, validateMedia = async () => {}, delay = sleep, maxPolls = 240 }) {
  const collection = async () => (await getDb()).collection('instagram_deliveries');
  async function submit(workspaceId, key, body) {
    const error = instagramValidation(body);
    if (error || !body.accountId || (!body.imageUrl && !body.videoUrl)) throw Object.assign(new Error(error || 'Choose one connected account and an attachment'), { statusCode: 400 });
    const col = await collection(), id = `${workspaceId}:${key || randomUUID()}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const row = { _id: id, workspaceId, fingerprint, body, status: 'queued', stage: 'queued', createdAt: new Date(), updatedAt: new Date() };
    try { await col.insertOne(row); }
    catch (err) {
      if (err.code !== 11000) throw err;
      const existing = await col.findOne({ _id: id, workspaceId });
      if (existing.fingerprint !== fingerprint) throw Object.assign(new Error('Publishing request changed'), { statusCode: 409 });
      return deliveryResult(existing);
    }
    // Mongo is written first. Startup recovery re-enqueues a lost Redis submission.
    try { await queue.add('publish', { id }, { jobId: queueId(id), attempts: 5, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: { age: 172800 }, removeOnFail: { age: 172800 } }); }
    catch { /* recover() will resume this persisted request */ }
    return deliveryResult(row);
  }
  async function process(job) {
    const col = await collection(), row = await col.findOne({ _id: job.data.id });
    if (!row || terminal.includes(row.status)) return;
    const scope = { _id: row._id, workspaceId: row.workspaceId };
    const runToken = randomUUID();
    const claim = await col.updateOne({ ...scope, runToken: row.runToken || { $exists: false } }, { $set: { runToken } });
    if (!claim.matchedCount) return;
    const save = async patch => {
      const saved = await col.updateOne({ ...scope, runToken }, { $set: { ...patch, updatedAt: new Date() } });
      if (!saved.matchedCount) throw new Error('Delivery ownership changed; stop this worker');
      Object.assign(row, patch);
    };
    const assertWorkspace = async () => {
      const workspace = await (await getDb()).collection('workspaces').findOne({ _id: row.workspaceId });
      if (!workspace || workspace.deleting) throw Object.assign(new Error('Workspace is unavailable'), { validation: true });
    };
    try {
      await assertWorkspace();
      const account = (await getAccounts(row.workspaceId)).find(a => a.id === row.body.accountId);
      if (!account) throw Object.assign(new Error('Instagram account is no longer connected'), { validation: true });
      const token = account.accessToken, placement = instagramPlacement(row.body);
      const getContainer = () => request.get(`${GRAPH_API}/${row.containerId}`, { params: { fields: 'status_code,status', access_token: token }, timeout: 15000 });
      const published = async postId => {
        await save({ status: 'published', stage: 'published', result: { accountId: account.id, postId: postId || null, containerId: row.containerId, placement, publishedAt: new Date().toISOString() } });
      };
      if (row.stage === 'publishing') {
        // A worker died or lost the publish response. Never issue media_publish again.
        const status = (await getContainer()).data.status_code;
        if (status === 'PUBLISHED') await published();
        else await save({ status: 'uncertain', error: 'Instagram publish response was interrupted. Check the account before creating another post.' });
        return;
      }
      if (!row.containerId) {
        await validateMedia(row.body, row.workspaceId);
        if (placement === 'story') {
          const profile = await request.get(`${GRAPH_API}/${account.id}`, { params: { fields: 'account_type', access_token: token }, timeout: 15000 });
          if (profile.data.account_type !== 'BUSINESS') throw Object.assign(new Error('Instagram Stories publishing requires a Business account'), { validation: true });
        }
        await assertWorkspace();
        const created = await request.post(`${GRAPH_API}/${account.id}/media`, null, { params: { ...instagramContainerParams(row.body, resolveMediaUrl), access_token: token }, timeout: 30000 });
        if (!created.data.id) throw Object.assign(new Error('Instagram did not return a media container'), { validation: true });
        await save({ containerId: created.data.id, status: 'processing', stage: 'processing' });
      }
      for (let poll = 0; poll < maxPolls; poll++) {
        await assertWorkspace();
        const status = (await getContainer()).data;
        if (status.status_code === 'PUBLISHED') { await published(); return; }
        if (['ERROR', 'EXPIRED'].includes(status.status_code)) throw Object.assign(new Error(status.status || 'Instagram could not process this media'), { validation: true });
        if (status.status_code === 'FINISHED') {
          await assertWorkspace();
          await save({ stage: 'publishing' });
          const response = await request.post(`${GRAPH_API}/${account.id}/media_publish`, null, { params: { creation_id: row.containerId, access_token: token }, timeout: 30000 });
          if (!response.data.id) throw new Error('Instagram did not confirm the published media ID');
          await published(response.data.id);
          if (placement !== 'story' && row.body.firstComment?.trim()) {
            try { await request.post(`${GRAPH_API}/${response.data.id}/comments`, null, { params: { message: row.body.firstComment.trim(), access_token: token }, timeout: 10000 }); }
            catch { await save({ commentWarning: 'Published, but the first comment could not be confirmed. Check the account before adding it again.' }); }
          }
          return;
        }
        await save({ progress: status.status_code || 'IN_PROGRESS' });
        await delay(5000);
      }
      throw Object.assign(new Error('Instagram is still processing this container'), { processing: true });
    } catch (err) {
      if (row.stage === 'publishing') {
        // Read the same container on a retry; the public mutation is never replayed.
        throw err;
      }
      const permanent = err.validation || (err.response?.status >= 400 && err.response.status < 500 && err.response.status !== 429);
      if (permanent) {
        const message = err.response?.data?.error?.message || err.message;
        const ratioHint = row.body.instagramPlacement === 'feed' ? ' If Meta rejects 3:4, review a separate 4:5 export or publish the preserved 3:4 original in Instagram.' : '';
        await save({ status: 'failed', error: message + ratioHint });
        return;
      }
      throw err;
    }
  }
  async function recover() {
    const col = await collection();
    await col.createIndex({ workspaceId: 1, status: 1 });
    for (const row of await col.find({ status: { $in: ['queued','processing'] } }).toArray()) {
      const id = queueId(row._id), existing = await queue.getJob(id);
      if (existing && ['failed','completed'].includes(await existing.getState())) await existing.remove();
      else if (existing) continue;
      await queue.add('publish', { id: row._id }, { jobId: id, attempts: 5, backoff: { type: 'exponential', delay: 10000 } });
    }
  }
  async function failed(job, err) {
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      const col = await collection(), row = await col.findOne({ _id: job.data.id });
      if (row && !terminal.includes(row.status)) await col.updateOne({ _id: row._id }, { $set: { status: row.stage === 'publishing' ? 'uncertain' : 'failed', error: row.stage === 'publishing' ? 'Check Instagram before retrying: the publish result is unknown.' : (err.processing ? 'Instagram processing exceeded the delivery window; no publish was attempted.' : 'Instagram delivery could not complete. Review the attachment and account access.'), updatedAt: new Date() } });
    }
  }
  return { submit, process, recover, failed };
}
module.exports = { createInstagramPublisher, deliveryResult };
