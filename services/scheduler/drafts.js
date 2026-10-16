const { ObjectId } = require('mongodb');
const { createHash } = require('crypto');
const { validatePost, scheduleDelay, accountKey } = require('./utils/publishing');
const { getWorkspaceCredential } = require('./utils/credentials');
const { naiveDatetimeToUtc } = require('./utils/timezone');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const draftJobId = (workspaceId, draftId) => 'draft_' + digest([workspaceId, draftId]).slice(0,40);
const fail = (reason, message) => { throw Object.assign(new Error(message), { reason }); };
const idSchema = { type: 'string', pattern: '^[a-f0-9]{24}$' };
const timezoneSchema = { type: 'string', minLength: 1, maxLength: 100 };

async function availableAccounts(db, workspaceId) {
  const accounts = [];
  for (const [platform, field] of [['facebook','pages'], ['instagram','accounts'], ['pinterest','boards']]) {
    const credentials = await getWorkspaceCredential(db, platform, workspaceId);
    for (const account of credentials?.[field] || []) if (account.selected) accounts.push({ key: platform + ':' + account.id, name: account.name || account.username || account.id });
  }
  const tiktok = await getWorkspaceCredential(db, 'tiktok', workspaceId);
  if (tiktok?.accessToken) accounts.push({ key: 'tiktok', name: tiktok.username || 'TikTok' });
  for (const platform of ['twitter','mastodon','bluesky']) {
    const credential = await getWorkspaceCredential(db, platform, workspaceId);
    const envKey = { twitter: 'TWITTER_ACCESS_TOKEN', mastodon: 'MASTODON_ACCESS_TOKEN', bluesky: 'BLUESKY_APP_PASSWORD' }[platform];
    if (credential || (workspaceId === 'default' && process.env[envKey])) accounts.push({ key: platform, name: platform });
  }
  return accounts;
}

async function mediaUrl(db, workspaceId, value, origin) {
  let url;
  try { url = new URL(value, origin); } catch { fail('invalid_media', 'Invalid attachment URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('invalid_media', 'Invalid attachment URL');
  if (url.origin === origin && url.pathname.startsWith('/media/')) {
    const filename = /^\/media\/([a-zA-Z0-9_.-]+)$/.exec(url.pathname)?.[1];
    if (!filename || !await db.collection('media_files').findOne({ filename, workspaceId })) fail('invalid_media', 'Attachment is missing or belongs to another workspace');
  } else if (!/^https?:\/\//.test(value)) fail('invalid_media', 'Use a Media Library URL or an absolute image/video URL');
  return url.href;
}

async function prepareDraft(db, workspaceId, draftId, timezone, origin, now = Date.now()) {
  const draft = await db.collection('drafts').findOne({ _id: new ObjectId(draftId), workspaceId });
  if (!draft) fail('not_found', 'Draft was not found in this workspace');
  if (!draft.scheduledAt) fail('missing_date', 'Set a planned date before scheduling this draft');
  let scheduledAt;
  try { scheduledAt = /(?:Z|[+-]\d{2}:\d{2})$/.test(draft.scheduledAt) ? new Date(draft.scheduledAt).toISOString() : naiveDatetimeToUtc(draft.scheduledAt, timezone); }
  catch (err) { fail('invalid_date', err.message); }
  try { scheduleDelay(scheduledAt, now); } catch (err) { fail('past_date', err.message); }
  const selected = (draft.destinations || []).filter(d => d.selected);
  if (!draft.content?.trim() && !selected.every(d => d.platform === 'instagram' && d.instagramPlacement === 'story')) fail('missing_content', 'Add post content before scheduling');
  if (!selected.length) fail('no_destinations', 'Select at least one publishing account');
  const available = await availableAccounts(db, workspaceId);
  const destinations = [], accounts = [];
  for (const destination of selected) {
    const account = available.find(a => a.key === accountKey(destination));
    if (!account) fail('disconnected_account', 'A selected publishing account is no longer connected to this workspace');
    accounts.push({ platform: destination.platform, accountId: destination.accountId, name: account.name, instagramPlacement: destination.instagramPlacement });
    const output = { platform: destination.platform, ...(destination.accountId && { accountId: destination.accountId }), ...(destination.instagramPlacement && { instagramPlacement: destination.instagramPlacement }), ...(destination.shareToFeed !== undefined && { shareToFeed: destination.shareToFeed }) };
    if (destination.coverUrl) output.coverUrl = await mediaUrl(db, workspaceId, destination.coverUrl, origin);
    if (draft.mediaUrl) {
      const field = /\.(mp4|mov|avi|webm)(?:[?#]|$)/i.test(draft.mediaUrl) ? 'videoUrl' : 'imageUrl';
      output[field] = await mediaUrl(db, workspaceId, draft.mediaUrl, origin);
    } else for (const field of ['imageUrl','videoUrl']) if (destination[field]) output[field] = await mediaUrl(db, workspaceId, destination[field], origin);
    if (destination.link) output.link = destination.link;
    destinations.push(output);
  }
  const error = validatePost(draft.content, destinations);
  if (error) fail('invalid_post', error);
  const payload = { content: draft.content, firstComment: draft.firstComment || '', scheduledAt, destinations };
  return { draft, accounts, payload, revision: digest({ updatedAt: draft.updatedAt, payload }) };
}

function registerDraftScheduling(app, { getDb, getQueue, publicUrl, log }) {
  const origin = new URL(publicUrl || process.env.APP_BASE_URL || process.env.MCP_PUBLIC_URL || 'http://localhost:8081').origin;
  async function context(request) {
    const workspaceId = request.headers['x-workspace-id'] || 'default';
    if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(workspaceId)) fail('invalid_request', 'Invalid workspace ID');
    try { new Intl.DateTimeFormat('en', { timeZone: request.body.timezone }); } catch { fail('invalid_request', 'Choose a valid timezone'); }
    const db = await getDb(), workspace = await db.collection('workspaces').findOne({ _id: workspaceId });
    if (!workspace || workspace.deleting) fail('unavailable', 'Workspace is unavailable');
    return { db, workspaceId };
  }
  const errorResult = (draftId, err) => ({ draftId, success: false, reason: err.reason || 'queue_error', error: err.reason ? err.message : 'Scheduling could not be confirmed. Retry the same drafts; existing jobs will be reused.' });
  async function finish(db, workspaceId, row) {
    let retained = true;
    try {
      await db.collection('drafts').deleteOne({ _id: new ObjectId(row.sourceDraftId), workspaceId, updatedAt: row.sourceDraftUpdatedAt });
      retained = !!await db.collection('drafts').findOne({ _id: new ObjectId(row.sourceDraftId), workspaceId });
    } catch (err) { log?.warn({ action: 'scheduled_draft_cleanup', outcome: 'failure', err: err.message }); }
    return { draftId: row.sourceDraftId, success: true, jobId: row.bullJobId, scheduledAt: row.scheduledAt, draftRetained: retained };
  }
  async function scheduleOne(db, workspaceId, item, timezone) {
    const queue = getQueue(), postId = draftJobId(workspaceId, item.draftId), query = { _id: postId, workspaceId };
    let row = await db.collection('scheduled_jobs').findOne(query);
    if (!row) {
      const prepared = await prepareDraft(db, workspaceId, item.draftId, timezone, origin);
      if (prepared.revision !== item.revision) fail('changed', 'Draft changed after review. Review it again before scheduling.');
      row = { _id: postId, postId, bullJobId: postId, workspaceId, type: 'one-time', ...prepared.payload, scheduledAt: new Date(prepared.payload.scheduledAt), sourceDraftId: item.draftId, sourceDraftRevision: prepared.revision, sourceDraftUpdatedAt: prepared.draft.updatedAt, status: 'pending', queueState: 'preparing', attempts: 0, maxAttempts: 3, createdAt: new Date() };
      try { await db.collection('scheduled_jobs').insertOne(row); }
      catch (err) { if (err.code !== 11000) throw err; row = await db.collection('scheduled_jobs').findOne(query); }
    }
    if (row.sourceDraftRevision !== item.revision) fail('already_scheduled', 'An earlier version of this draft already has a scheduled job. Review Scheduled before making another copy.');
    if (row.status === 'cancelled') fail('already_scheduled', 'This draft already has a cancelled job. Review Scheduled before scheduling another copy.');
    // A lost response or interrupted cleanup must never create another delivery.
    if (row.queueState === 'queued' || ['processing','published','partial','completed'].includes(row.status)) return finish(db, workspaceId, row);
    const queued = await queue.getJob(postId);
    await db.collection('scheduled_jobs').updateOne({ ...query, status: 'failed', queueState: 'retryable', attempts: 0 }, { $set: { status: 'pending' } });
    if (!queued) {
      const delay = scheduleDelay(new Date(row.scheduledAt).toISOString());
      try {
        await queue.add('scheduled-post', { postId, workspaceId, content: row.content, destinations: row.destinations, firstComment: row.firstComment || undefined, media: [] }, { jobId: postId, delay, attempts: 3, backoff: { type: 'exponential', delay: 60000 } });
      } catch (err) {
        await db.collection('scheduled_jobs').updateOne({ ...query, status: 'pending', attempts: 0 }, { $set: { status: 'failed', queueState: 'retryable', failReason: 'Could not confirm queue submission; retry this draft' } });
        throw err;
      }
    }
    await db.collection('scheduled_jobs').updateOne(query, { $set: { queueState: 'queued' } });
    return finish(db, workspaceId, row);
  }
  app.post('/drafts/preview', { schema: { body: { type: 'object', additionalProperties: false, required: ['draftIds','timezone'], properties: { draftIds: { type: 'array', minItems: 1, maxItems: 500, uniqueItems: true, items: idSchema }, timezone: timezoneSchema } } } }, async (request, reply) => {
    let ctx; try { ctx = await context(request); } catch (err) { return reply.code(400).send({ error: err.message }); }
    const items = [];
    for (const draftId of request.body.draftIds) {
      try {
        const prepared = await prepareDraft(ctx.db, ctx.workspaceId, draftId, request.body.timezone, origin);
        const existing = await ctx.db.collection('scheduled_jobs').findOne({ _id: draftJobId(ctx.workspaceId, draftId), workspaceId: ctx.workspaceId });
        if (existing && existing.sourceDraftRevision !== prepared.revision) fail('already_scheduled', 'An earlier version of this draft already has a scheduled job');
        items.push({ draftId, ready: true, revision: prepared.revision, ...prepared.payload, accounts: prepared.accounts });
      } catch (err) { items.push({ ...errorResult(draftId, err), ready: false }); }
    }
    return { success: true, items };
  });
  app.post('/drafts/schedule', { schema: { body: { type: 'object', additionalProperties: false, required: ['items','timezone','confirmation'], properties: { items: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object', additionalProperties: false, required: ['draftId','revision'], properties: { draftId: idSchema, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } }, timezone: timezoneSchema, confirmation: { const: 'SCHEDULE' } } } } }, async (request, reply) => {
    let ctx; try { ctx = await context(request); } catch (err) { return reply.code(400).send({ error: err.message }); }
    if (new Set(request.body.items.map(item => item.draftId)).size !== request.body.items.length) return reply.code(400).send({ error: 'Duplicate draft selection' });
    const results = [];
    for (const item of request.body.items) {
      try { results.push(await scheduleOne(ctx.db, ctx.workspaceId, item, request.body.timezone)); }
      catch (err) { log?.warn({ action: 'schedule_draft', workspaceId: ctx.workspaceId, draftId: item.draftId, outcome: 'failure', err: err.message }); results.push(errorResult(item.draftId, err)); }
    }
    return { success: results.every(r => r.success), scheduled: results.filter(r => r.success).length, results };
  });
}

module.exports = { registerDraftScheduling, prepareDraft, draftJobId };
