const { ObjectId } = require('mongodb');
const { createHash } = require('crypto');
const { deliveryKey } = require('./utils/publishing');

const returnedDraftId = (ws, jobId) => new ObjectId(createHash('sha256').update(JSON.stringify(['cancelled-schedule', ws, jobId])).digest('hex').slice(0, 24));
const conflict = message => Object.assign(new Error(message), { statusCode: 409 });

function draftFromJob(row) {
  const snapshot = row.sourceDraftSnapshot || {};
  const destinations = snapshot.destinations || (row.destinations || (row.platforms || []).map(platform => ({ platform }))).map(d => ({ ...d, selected: true }));
  const urls = [...new Set(destinations.filter(d => d.selected).map(d => d.videoUrl || d.imageUrl).filter(Boolean))];
  return { ...snapshot, _id: new ObjectId(row.returnedDraftId), workspaceId: row.workspaceId,
    content: row.content || '', firstComment: row.firstComment || '', destinations,
    mediaUrl: snapshot.mediaUrl || row.mediaUrl || (urls.length === 1 ? urls[0] : ''),
    ...(row.media && { media: row.media }),
    scheduledAt: snapshot.scheduledAt || (row.scheduledAt ? new Date(row.scheduledAt).toISOString() : ''),
    restoredFromJobId: row.bullJobId, createdAt: snapshot.createdAt || new Date(), updatedAt: new Date(),
  };
}

function createCancellation({ getDb, getQueue, log }) {
  async function finish(db, row) {
    const current = await db.collection('scheduled_jobs').findOne({ _id: row._id, workspaceId: row.workspaceId });
    if (current?.status === 'cancelled' && current.draftReturnedAt) return { success: true, jobId: current.bullJobId, draftId: current.returnedDraftId, returnedToDrafts: true };
    if (current?.status !== 'cancelling') throw conflict('Cancellation is no longer pending. Refresh scheduled posts.');
    const workspace = await db.collection('workspaces').findOne({ _id: row.workspaceId });
    if (!workspace || workspace.deleting) throw conflict('Workspace is unavailable');
    const draft = draftFromJob(row);
    // A retry must preserve any edits made after the first restoration.
    try { await db.collection('drafts').updateOne({ _id: draft._id, workspaceId: row.workspaceId }, { $setOnInsert: draft }, { upsert: true }); }
    catch (err) { if (err.code !== 11000 || !await db.collection('drafts').findOne({ _id: draft._id, workspaceId: row.workspaceId })) throw err; }
    await db.collection('scheduled_jobs').updateOne({ _id: row._id, workspaceId: row.workspaceId, status: 'cancelling' }, { $set: { status: 'cancelled', draftReturnedAt: new Date() } });
    return { success: true, jobId: row.bullJobId, draftId: String(draft._id), returnedToDrafts: true };
  }
  async function cancel(workspaceId, jobId) {
    const db = await getDb();
    const query = { bullJobId: jobId, workspaceId };
    let row = await db.collection('scheduled_jobs').findOne(query);
    if (!row) throw Object.assign(new Error('Scheduled post was not found in this workspace'), { statusCode: 404 });
    if (row.status === 'cancelled' && row.draftReturnedAt) return { success: true, jobId, draftId: row.returnedDraftId, returnedToDrafts: true };
    if (row.status === 'cancelling') return finish(db, row);
    if (!['pending', 'failed', 'cancelled'].includes(row.status)) throw conflict('Publishing has already started or finished. This post cannot be returned to Drafts.');
    const workspace = await db.collection('workspaces').findOne({ _id: workspaceId });
    if (!workspace || workspace.deleting) throw conflict('Workspace is unavailable');
    const queue = getQueue(), job = await queue.getJob(jobId);
    if (job && (job.data?.workspaceId || 'default') !== workspaceId) throw conflict('The queue entry belongs to another workspace. Refresh scheduled posts before trying again.');
    if (job && await job.getState() === 'active') throw conflict('Publishing is active. Wait for it to finish before changing this post.');
    const postId = row.postId || job?.data?.postId || `scheduled:${workspaceId}:${jobId}`;
    const receipt = await db.collection('posts').findOne({ _id: postId, workspaceId });
    if (['processing', 'published', 'partial'].includes(receipt?.status)) throw conflict('Delivery has already started or finished. Check its outcome before creating another post.');
    if ([...Object.values(row.platformResults || {}), ...Object.values(receipt?.platformResults || {})].some(r => r.success || r.uncertain || r.processing)) throw conflict('Some deliveries have published or their outcome is unknown. Check the accounts before creating another post.');
    for (const destination of row.destinations || []) {
      if (destination.platform !== 'instagram') continue;
      const delivery = await db.collection('instagram_deliveries').findOne({ _id: `${workspaceId}:${deliveryKey(postId, destination)}`, workspaceId });
      if (delivery && (delivery.status !== 'failed' || delivery.uncertain)) throw conflict('Instagram delivery has started. Check its outcome before creating another post.');
    }
    const draftId = String(returnedDraftId(workspaceId, jobId));
    // The worker claims pending rows with the opposite conditional update.
    // Exactly one side can win before any provider request is dispatched.
    const claimed = await db.collection('scheduled_jobs').updateOne({ ...query, status: row.status }, { $set: { status: 'cancelling', returnedDraftId: draftId, cancellationRequestedAt: new Date(), ...(row.media === undefined && job?.data?.media && { media: job.data.media }) } });
    if (!claimed.matchedCount) {
      row = await db.collection('scheduled_jobs').findOne(query);
      if (row?.status === 'cancelled' && row.draftReturnedAt) return { success: true, jobId, draftId: row.returnedDraftId, returnedToDrafts: true };
      if (row?.status === 'cancelling') return finish(db, row);
      throw conflict('Publishing has started. Refresh the scheduled posts before trying again.');
    }
    row = await db.collection('scheduled_jobs').findOne(query);
    // A Redis outage cannot re-enable publishing: the durable cancellation and
    // worker claim guard prevent the leftover queue entry from sending anything.
    if (job) try { await job.remove(); } catch { log?.warn({ action: 'cancel_queue_cleanup', workspaceId, jobId, outcome: 'deferred' }); }
    return finish(db, row);
  }
  async function recover() {
    const db = await getDb();
    for (const row of await db.collection('scheduled_jobs').find({ status: 'cancelling' }).toArray()) {
      try { await finish(db, row); }
      catch (err) { log?.warn({ action: 'cancel_draft_recovery', jobId: row.bullJobId, outcome: 'deferred', err: err.message }); }
    }
  }
  return { cancel, recover };
}

function registerCancellation(app, deps) {
  const cancellation = createCancellation(deps);
  let timer, recovery;
  const recover = () => recovery || (recovery = cancellation.recover().finally(() => { recovery = null; }));
  app.addHook('onReady', async () => { await recover(); timer = setInterval(() => recover().catch(err => deps.log?.warn({ action: 'cancel_recovery', err: err.message })), 30000); timer.unref(); });
  app.addHook('onClose', async () => { clearInterval(timer); if (recovery) await recovery; });
  app.delete('/jobs/:jobId', async (request, reply) => {
    const ws = request.headers['x-workspace-id'] || 'default';
    if (typeof ws !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(ws)) return reply.code(400).send({ error: 'Invalid workspace ID' });
    try { return await cancellation.cancel(ws, request.params.jobId); }
    catch (err) { return reply.code(err.statusCode || 503).send({ error: err.statusCode ? err.message : 'Could not finish returning this post to Drafts. Retry; saved cancellation progress will be recovered.' }); }
  });
  return cancellation;
}
module.exports = { createCancellation, registerCancellation, draftFromJob, returnedDraftId };
