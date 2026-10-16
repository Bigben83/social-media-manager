'use strict';
const { accountFilter } = require('./analytics');
const GRAPH_API = 'https://graph.facebook.com/v22.0';
const active = { type: 'analytics_sync', status: { $in: ['queued', 'running'] } };
const publicJob = job => job ? { jobId: job._id, status: job.status, progress: job.progress, result: job.result, error: job.error, updatedAt: job.updatedAt } : null;

function createAnalyticsSync({ getDb, getCredentials, decryptToken, http }) {
  return async (job, context) => {
    const { workspaceId: ws, payload } = job;
    const db = await getDb();
    const states = structuredClone(context.checkpoint.accounts || {});
    const filter = accountFilter(payload.account);
    async function accountsFor(platform) {
      const credentials = await getCredentials(ws, platform);
      return (platform === 'facebook' ? credentials?.pages : credentials?.accounts) || [];
    }
    // Freeze the account list for recovery; tokens are always read from the
    // current workspace credentials and never stored in the job/checkpoint.
    if (!context.checkpoint.accounts) {
      for (const platform of ['facebook', 'instagram']) {
        if (filter && filter.platform !== platform) continue;
        for (const account of await accountsFor(platform)) {
          if (!account.selected || !account.accessToken || (filter?.accountId && filter.accountId !== account.id)) continue;
          states[`${platform}:${account.id}`] = { platform, accountId: account.id, name: account.name || account.username || account.id, count: 0, pages: 0, after: null, done: false, insightsUnavailable: 0 };
        }
      }
      if (!Object.keys(states).length) throw new Error('No selected Facebook or Instagram accounts are available. Connect an account in Settings.');
      await context.saveCheckpoint({ accounts: states });
    }
    const progress = async step => context.setProgress({ step, count: Object.values(states).reduce((n, s) => n + s.count, 0), completed: Object.values(states).filter(s => s.done).length, total: Object.keys(states).length,
      errors: Object.values(states).filter(s => s.error).map(s => ({ account: s.name, error: s.error })),
      insightsUnavailable: Object.values(states).reduce((n, s) => n + s.insightsUnavailable, 0) });
    for (const state of Object.values(states)) {
      if (state.done) continue;
      delete state.error;
      let runPages = 0;
      try {
        do {
          await context.assertWorkspace();
          const account = (await accountsFor(state.platform)).find(a => a.id === state.accountId && a.selected);
          const token = account?.accessToken && decryptToken(account.accessToken);
          if (!token) throw new Error('account_unavailable');
          await progress(state.name);
          const facebook = state.platform === 'facebook';
          const res = await http.get(`${GRAPH_API}/${encodeURIComponent(state.accountId)}/${facebook ? 'posts' : 'media'}`, {
            params: { fields: facebook ? 'id,message,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares' : 'id,caption,timestamp,like_count,comments_count,permalink,media_type,media_product_type', limit: 100, access_token: token, ...(state.after && { after: state.after }) }, timeout: 30000,
          });
          if (!Array.isArray(res.data?.data)) throw new Error('invalid_response');
          let unavailable = 0;
          for (const post of res.data.data) {
            await context.assertWorkspace();
            const publishedAt = new Date(facebook ? post.created_time : post.timestamp);
            if (!post.id || !Number.isFinite(publishedAt.getTime())) throw new Error('invalid_response');
            const likes = (facebook ? post.reactions?.summary?.total_count : post.like_count) ?? null;
            const comments = (facebook ? post.comments?.summary?.total_count : post.comments_count) ?? null;
            const shares = facebook ? post.shares?.count ?? 0 : null;
            let reach = null, saves = null;
            if (!facebook) {
              try {
                const insights = await http.get(`${GRAPH_API}/${encodeURIComponent(post.id)}/insights`, { params: { metric: 'reach,saved', access_token: token }, timeout: 10000 });
                for (const metric of insights.data?.data || []) {
                  if (metric.name === 'reach') reach = metric.values?.[0]?.value ?? null;
                  if (metric.name === 'saved') saves = metric.values?.[0]?.value ?? null;
                }
                if (reach === null || saves === null) unavailable++;
              } catch { unavailable++; }
            }
            await context.assertWorkspace();
            await db.collection('post_metrics').updateOne({ workspaceId: ws, platform: state.platform, accountId: state.accountId, postId: post.id }, { $set: {
              workspaceId: ws, platform: state.platform, accountId: state.accountId, accountName: state.name, postId: post.id,
              content: (facebook ? post.message : post.caption) || null, publishedAt, permalink: (facebook ? post.permalink_url : post.permalink) || null,
              mediaType: post.media_type || null, mediaProductType: post.media_product_type || null,
              metrics: { likes, comments, shares, views: null, reach, saves, engagementTotal: (likes || 0) + (comments || 0) + (shares || 0) },
              hourOfDay: publishedAt.getUTCHours(), dayOfWeek: publishedAt.getUTCDay(), fetchedAt: new Date(),
            } }, { upsert: true });
          }
          const after = res.data.paging?.next ? res.data.paging.cursors?.after : null;
          if (res.data.paging?.next && (!after || after === state.after)) throw new Error('invalid_pagination');
          // Commit the cursor only after the whole page is saved. Replaying an
          // interrupted page safely updates the same native post identities.
          state.count += res.data.data.length; state.pages++; state.insightsUnavailable += unavailable;
          state.after = after; state.done = payload.history !== 'all' || !after;
          await context.saveCheckpoint({ accounts: states });
          await progress(state.name);
          if (++runPages >= 1000 && !state.done) throw new Error('page_limit');
        } while (!state.done);
      } catch (err) {
        await context.assertWorkspace();
        // Never persist Axios errors/URLs: they can contain access tokens.
        const code = err.response?.data?.error?.code;
        state.error = err.message === 'account_unavailable' ? 'Account unavailable. Reconnect or select it in Settings.'
          : err.message === 'page_limit' ? 'Page limit reached. Retry to continue from the saved cursor.'
          : ['invalid_response', 'invalid_pagination'].includes(err.message) ? 'Meta returned an incomplete page. Retry to continue.'
          : code === 190 ? 'Access expired. Reconnect the account in Settings.'
          : [10, 200].includes(code) ? 'Meta denied access. Check the account permissions in Settings.'
          : 'Could not fetch account history from Meta. Check permissions or retry later.';
        await context.saveCheckpoint({ accounts: states });
        await progress(state.name);
      }
    }
    if (Object.values(states).some(s => s.error)) throw new Error('Some accounts could not be synced. Retry to continue from saved progress.');
    await progress('');
    return { total: Object.values(states).reduce((n, s) => n + s.count, 0), accounts: Object.values(states).map(({ name, count, insightsUnavailable }) => ({ name, count, insightsUnavailable })), history: payload.history };
  };
}

function registerAnalyticsSync(app, deps) {
  const { jobs, handlers, getDb } = deps;
  handlers.analytics_sync = createAnalyticsSync(deps);
  app.addHook('onReady', async () => {
    const db = await getDb();
    await db.collection('ai_jobs').createIndex({ workspaceId: 1, type: 1 }, { name: 'one_active_analytics_sync', unique: true, partialFilterExpression: active });
    await db.collection('post_metrics').createIndex({ workspaceId: 1, platform: 1, accountId: 1, postId: 1 });
  });
  app.get('/analytics/sync', async request => {
    const db = await getDb();
    const running = await db.collection('ai_jobs').findOne({ workspaceId: request.workspaceId, ...active });
    const latest = running || (await db.collection('ai_jobs').find({ workspaceId: request.workspaceId, type: 'analytics_sync' }).sort({ createdAt: -1 }).limit(1).toArray())[0];
    return { job: publicJob(latest) };
  });
  app.post('/analytics/crawl', async (request, reply) => {
    const { history = 'recent', account } = request.body || {};
    if (!['recent', 'all'].includes(history)) return reply.code(400).send({ error: 'Choose recent or all history' });
    try { accountFilter(account); } catch { return reply.code(400).send({ error: 'Invalid account filter' }); }
    const db = await getDb();
    const existing = await db.collection('ai_jobs').findOne({ workspaceId: request.workspaceId, ...active });
    if (existing) return reply.code(202).send({ success: true, ...publicJob(existing) });
    try {
      const job = await jobs.submit(request.workspaceId, 'analytics_sync', { history, ...(account && { account }) });
      return reply.code(202).send({ success: true, ...publicJob(job) });
    } catch (err) {
      if (err.code !== 11000) throw err;
      const job = await db.collection('ai_jobs').findOne({ workspaceId: request.workspaceId, ...active });
      if (!job) throw err;
      return reply.code(202).send({ success: true, ...publicJob(job) });
    }
  });
  app.post('/analytics/sync/:id/retry', async (request, reply) => {
    const job = await jobs.get(request.params.id, request.workspaceId);
    if (!job || job.type !== 'analytics_sync') return reply.code(404).send({ error: 'Sync not found' });
    try {
      if (!await jobs.retry(job._id, request.workspaceId)) return reply.code(409).send({ error: 'Sync is still finishing. Try again shortly.' });
    } catch (err) { if (err.code === 11000) return reply.code(409).send({ error: 'Another sync is already running.' }); throw err; }
    return reply.code(202).send(publicJob(await jobs.get(job._id, request.workspaceId)));
  });
}
module.exports = { createAnalyticsSync, registerAnalyticsSync };
