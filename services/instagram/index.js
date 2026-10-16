require('dotenv').config();
const axios = require('axios');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');
const { decryptToken, warnIfNoKey } = require('./utils/crypto');
const { getWorkspaceCredential } = require('./utils/credentials');
const { createInstagramPublisher } = require('./publishing');
const { createMediaValidator } = require('./media');

const GRAPH_API = 'https://graph.facebook.com/v22.0';
// Instagram's Container API requires a publicly accessible image URL.
// If APP_BASE_URL is set to a public domain, relative /media/ paths are resolved against it.
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

function resolveInstagramMediaUrl(url) {
  if (!url) return url;
  if (url.startsWith('/')) {
    if (!APP_BASE_URL) {
      throw new Error('Instagram requires a publicly accessible image URL. Set APP_BASE_URL to your public domain (e.g. https://social.example.com) to post images from the media library.');
    }
    const full = `${APP_BASE_URL}${url}`;
    if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(full)) {
      throw new Error(`Instagram requires a publicly accessible image URL. The app (${APP_BASE_URL}) is not reachable from the internet. Use an external image URL or deploy to a public server.`);
    }
    return full;
  }
  // Already a full URL — warn if it looks local but still try
  if (/https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
    throw new Error(`Instagram requires a publicly accessible image URL. "${url}" is not reachable from the internet. Use an external image URL or deploy to a public server.`);
  }
  return url;
}

class InstagramService extends BasePlatformService {
  constructor() {
    super('instagram');
    let queue, worker, connection, recovery;
    this.publisher = createInstagramPublisher({ getDb, request: axios, getAccounts: ws => this._getAccounts(ws), resolveMediaUrl: resolveInstagramMediaUrl, validateMedia: createMediaValidator({ getDb, resolveMediaUrl: resolveInstagramMediaUrl }), queue: { add: (...args) => queue.add(...args), getJob: (...args) => queue.getJob(...args) } });
    this.handlePublish = async (request, reply, workspaceId, key) => {
      try {
        const result = await this.publisher.submit(workspaceId, key, request.body || {});
        return reply.code(result.processing ? 202 : result.success ? 200 : result.uncertain ? 409 : 400).send({ platform: 'instagram', ...result });
      } catch (err) { return reply.code(err.statusCode || 503).send({ success: false, error: err.statusCode ? err.message : 'Instagram delivery is unavailable', retryable: !err.statusCode }); }
    };
    this.app.addHook('onReady', async () => {
      if (process.env.NODE_ENV === 'test') return;
      const { Queue, Worker } = require('bullmq');
      const Redis = require('ioredis');
      connection = new Redis(process.env.REDIS_URL || 'redis://redis:6379', { maxRetriesPerRequest: null });
      connection.on('error', err => this.log.error({ action: 'instagram_redis', err: err.message }));
      queue = new Queue('instagram-publish', { connection });
      worker = new Worker('instagram-publish', job => this.publisher.process(job), { connection, concurrency: 2, lockDuration: 120000 });
      worker.on('error', err => this.log.error({ action: 'instagram_worker', err: err.message }));
      worker.on('failed', (job, err) => { void this.publisher.failed(job, err).catch(error => this.log.error({ action: 'instagram_failure_save', err: error.message })); });
      await this.publisher.recover();
      recovery = setInterval(() => { void this.publisher.recover().catch(err => this.log.error({ action: 'instagram_recover', err: err.message })); }, 30000);
      recovery.unref();
    });
    this.app.addHook('onClose', async () => { clearInterval(recovery); if (worker) await worker.close(); if (queue) await queue.close(); if (connection) await connection.quit(); });
  }

  // Read selected Instagram Business Accounts from MongoDB.
  // Falls back to env vars for backwards compatibility.
  async _getAccounts(workspaceId = 'default') {
    try {
      const db = await getDb();
      const cred = await getWorkspaceCredential(db, 'instagram', workspaceId);
      const dbAccounts = (cred?.accounts || []).filter((a) => a.selected);
      if (cred && dbAccounts.length === 0) return [];
      if (dbAccounts.length > 0) {
        return dbAccounts.map((a) => ({ ...a, accessToken: decryptToken(a.accessToken) })).filter((a) => a.accessToken);
      }
    } catch (_) { /* fall through */ }

    if (workspaceId !== 'default') return [];
    // Env var fallback (legacy single-account mode)
    const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID } = process.env;
    if (INSTAGRAM_ACCESS_TOKEN && INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      return [{ id: INSTAGRAM_BUSINESS_ACCOUNT_ID, accessToken: INSTAGRAM_ACCESS_TOKEN }];
    }

    return [];
  }

  async getStatus(workspaceId = 'default') {
    const accounts = await this._getAccounts(workspaceId);
    if (accounts.length === 0) {
      return { connected: false, platform: 'instagram', error: 'No Instagram accounts connected — use Settings to connect via Facebook OAuth' };
    }
    try {
      const first = accounts[0];
      const res = await axios.get(`${GRAPH_API}/${first.id}`, {
        params: {
          fields: 'id,name,username,profile_picture_url',
          access_token: first.accessToken,
        },
      });
      return {
        connected: true,
        platform: 'instagram',
        username: res.data.username || res.data.name,
        displayName: res.data.name,
        avatar: res.data.profile_picture_url,
        accountCount: accounts.length,
      };
    } catch (err) {
      return { connected: false, platform: 'instagram', error: err.response?.data?.error?.message || err.message };
    }
  }

  async fetchFeed({ limit = 20, workspaceId = 'default' } = {}) {
    const accounts = await this._getAccounts(workspaceId);
    if (accounts.length === 0) throw new Error('No Instagram accounts connected');

    const allItems = [];

    for (const account of accounts) {
      const res = await axios.get(`${GRAPH_API}/${account.id}/media`, {
        params: {
          fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,username',
          limit: Math.min(Number(limit), 100),
          access_token: account.accessToken,
        },
      });

      const items = (res.data.data || []).map((post) =>
        this.normalizeFeedItem({
          originalId: post.id,
          workspaceId,
          accountId: account.id,
          author: {
            name: post.username || account.username || '',
            username: post.username || account.username || '',
            profileUrl: `https://www.instagram.com/${post.username || account.username || ''}/`,
          },
          content: post.caption || '',
          media: post.media_url
            ? [{
                url: post.media_url,
                type: (post.media_type || 'IMAGE').toLowerCase(),
                thumbnail: post.thumbnail_url || post.media_url,
              }]
            : [],
          metrics: {
            likes: post.like_count || 0,
            comments: post.comments_count || 0,
          },
          url: post.permalink,
          createdAt: post.timestamp,
        })
      );

      allItems.push(...items);
    }

    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of allItems) {
        await col.updateOne(
          { platform: 'instagram', originalId: item.originalId, workspaceId },
          { $set: { ...item, workspaceId } },
          { upsert: true }
        );
      }
    } catch (err) {
      this.app.log.error({ action: 'feed_write', platform: 'instagram', outcome: 'failure', err: err.message });
    }

    return allItems;
  }

}

if (require.main === module) {
  const service = new InstagramService();
  warnIfNoKey('instagram');
  service.start(process.env.PORT || 3005);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.app.close().then(() => process.exit(0)));
}
module.exports = { InstagramService, resolveInstagramMediaUrl };
