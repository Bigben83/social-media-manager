require('dotenv').config();
const axios = require('axios');
const BasePlatformService = require('./utils/BasePlatformService');
const { getDb } = require('./utils/MongoDBConnector');

const GRAPH_API = 'https://graph.facebook.com/v22.0';

class FacebookService extends BasePlatformService {
  constructor() {
    super('facebook');
  }

  // Read selected Facebook Pages from MongoDB.
  // Falls back to env vars for backwards compatibility.
  async _getPages() {
    try {
      const db = await getDb();
      const cred = await db.collection('platform_credentials').findOne({ _id: 'facebook' });
      const dbPages = (cred?.pages || []).filter((p) => p.selected);
      if (dbPages.length > 0) return dbPages;
    } catch (_) { /* fall through */ }

    // Env var fallback (legacy single-page mode)
    const { FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID } = process.env;
    if (FACEBOOK_PAGE_ACCESS_TOKEN && FACEBOOK_PAGE_ID) {
      return [{ id: FACEBOOK_PAGE_ID, accessToken: FACEBOOK_PAGE_ACCESS_TOKEN }];
    }

    return [];
  }

  async getStatus() {
    const pages = await this._getPages();
    if (pages.length === 0) {
      return { connected: false, platform: 'facebook', error: 'No Facebook Pages connected — use Settings to connect via Facebook OAuth' };
    }
    try {
      const first = pages[0];
      const res = await axios.get(`${GRAPH_API}/${first.id}`, {
        params: {
          fields: 'id,name,username,picture',
          access_token: first.accessToken,
        },
      });
      return {
        connected: true,
        platform: 'facebook',
        username: res.data.username || res.data.name,
        displayName: res.data.name,
        avatar: res.data.picture?.data?.url,
        pageCount: pages.length,
      };
    } catch (err) {
      return { connected: false, platform: 'facebook', error: err.response?.data?.error?.message || err.message };
    }
  }

  async fetchFeed({ limit = 20 } = {}) {
    const pages = await this._getPages();
    if (pages.length === 0) throw new Error('No Facebook Pages connected');

    const allItems = [];

    for (const page of pages) {
      const res = await axios.get(`${GRAPH_API}/${page.id}/feed`, {
        params: {
          fields: 'id,message,story,full_picture,created_time,permalink_url,likes.summary(true),comments.summary(true),shares',
          limit: Math.min(Number(limit), 100),
          access_token: page.accessToken,
        },
      });

      const items = (res.data.data || []).map((post) =>
        this.normalizeFeedItem({
          originalId: post.id,
          author: {
            name: page.name || '',
            username: page.name || '',
          },
          content: post.message || post.story || '',
          media: post.full_picture ? [{ url: post.full_picture, type: 'image' }] : [],
          metrics: {
            likes: post.likes?.summary?.total_count || 0,
            comments: post.comments?.summary?.total_count || 0,
            shares: post.shares?.count || 0,
          },
          url: post.permalink_url,
          createdAt: post.created_time,
        })
      );

      allItems.push(...items);
    }

    try {
      const db = await getDb();
      const col = db.collection('feeds');
      for (const item of allItems) {
        await col.updateOne(
          { platform: 'facebook', originalId: item.originalId },
          { $set: item },
          { upsert: true }
        );
      }
    } catch (err) {
      console.error('[Facebook] MongoDB write error:', err.message);
    }

    return allItems;
  }

  async publishPost({ content, link, imageUrl } = {}) {
    const pages = await this._getPages();
    if (pages.length === 0) throw new Error('No Facebook Pages connected');
    if (!content) throw new Error('content is required');

    const results = [];
    for (const page of pages) {
      const params = { message: content, access_token: page.accessToken };
      if (link) params.link = link;
      if (imageUrl) params.picture = imageUrl;

      const res = await axios.post(`${GRAPH_API}/${page.id}/feed`, null, { params });
      results.push({ pageId: page.id, pageName: page.name, postId: res.data.id });
    }

    return results;
  }
}

const service = new FacebookService();
service.start(process.env.PORT || 3006);
