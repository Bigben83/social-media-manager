require('dotenv').config();
const axios = require('axios');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');

const GRAPH_API = 'https://graph.facebook.com/v22.0';

class InstagramService extends BasePlatformService {
  constructor() {
    super('instagram');
  }

  // Read selected Instagram Business Accounts from MongoDB.
  // Falls back to env vars for backwards compatibility.
  async _getAccounts() {
    try {
      const db = await getDb();
      const cred = await db.collection('platform_credentials').findOne({ _id: 'instagram' });
      const dbAccounts = (cred?.accounts || []).filter((a) => a.selected);
      if (dbAccounts.length > 0) return dbAccounts;
    } catch (_) { /* fall through */ }

    // Env var fallback (legacy single-account mode)
    const { INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID } = process.env;
    if (INSTAGRAM_ACCESS_TOKEN && INSTAGRAM_BUSINESS_ACCOUNT_ID) {
      return [{ id: INSTAGRAM_BUSINESS_ACCOUNT_ID, accessToken: INSTAGRAM_ACCESS_TOKEN }];
    }

    return [];
  }

  async getStatus() {
    const accounts = await this._getAccounts();
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

  async fetchFeed({ limit = 20 } = {}) {
    const accounts = await this._getAccounts();
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
          { platform: 'instagram', originalId: item.originalId },
          { $set: item },
          { upsert: true }
        );
      }
    } catch (err) {
      console.error('[Instagram] MongoDB write error:', err.message);
    }

    return allItems;
  }

  // Instagram requires media (image_url or video_url) — text-only posts are not supported.
  async publishPost({ content, imageUrl, videoUrl, accountId } = {}) {
    const allAccounts = await this._getAccounts();
    if (allAccounts.length === 0) throw new Error('No Instagram accounts connected');

    if (!imageUrl && !videoUrl) {
      throw new Error('Instagram requires imageUrl or videoUrl — text-only posts are not supported by the Graph API');
    }

    // If a specific account is requested, target only that account
    const accounts = accountId ? allAccounts.filter((a) => a.id === accountId) : allAccounts;
    if (accounts.length === 0) throw new Error(`Instagram account ${accountId} not found or not connected`);

    const results = [];
    for (const account of accounts) {
      const containerParams = {
        caption: content,
        access_token: account.accessToken,
      };
      if (videoUrl) {
        containerParams.media_type = 'REELS';
        containerParams.video_url = videoUrl;
      } else {
        containerParams.image_url = imageUrl;
      }

      const containerRes = await axios.post(
        `${GRAPH_API}/${account.id}/media`,
        null,
        { params: containerParams }
      );
      const publishRes = await axios.post(
        `${GRAPH_API}/${account.id}/media_publish`,
        null,
        { params: { creation_id: containerRes.data.id, access_token: account.accessToken } }
      );
      results.push({ accountId: account.id, username: account.username, postId: publishRes.data.id });
    }

    return results;
  }
}

const service = new InstagramService();
service.start(process.env.PORT || 3005);
