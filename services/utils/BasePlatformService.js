const Fastify = require('fastify');
const RabbitMQConnector = require('./RabbitMQConnector');

/**
 * BasePlatformService — tüm platform servisleri bu sınıftan extend eder.
 *
 * Her platform servisi şu metodları override etmeli:
 *   - fetchFeed()        → platform API'sinden feed çeker
 *   - publishPost(post)  → platforma içerik gönderir
 *   - getStatus()        → bağlantı durumu döner
 *   - authenticate(code) → OAuth callback işler
 */
class BasePlatformService extends RabbitMQConnector {
  constructor(platformName) {
    super();
    this.platformName = platformName;
    this.app = Fastify({ logger: false });
    this._setupRoutes();
  }

  /** HTTP route'ları kaydet — platform servisleri override edebilir */
  _setupRoutes() {
    this.app.get('/status', async () => {
      return this.getStatus();
    });

    this.app.get('/feed', async (request, reply) => {
      try {
        const items = await this.fetchFeed(request.query);
        return { success: true, platform: this.platformName, count: items.length, items };
      } catch (err) {
        reply.code(500).send({ success: false, error: err.message });
      }
    });

    this.app.post('/post', async (request, reply) => {
      try {
        const result = await this.publishPost(request.body);
        return { success: true, platform: this.platformName, result };
      } catch (err) {
        reply.code(500).send({ success: false, error: err.message });
      }
    });

    this.app.get('/auth/callback', async (request, reply) => {
      try {
        const result = await this.authenticate(request.query);
        return { success: true, platform: this.platformName, result };
      } catch (err) {
        reply.code(500).send({ success: false, error: err.message });
      }
    });
  }

  /** HTTP sunucusunu başlat */
  async start(port = 3000) {
    await this.connect();
    await this.app.listen({ port, host: '0.0.0.0' });
    console.log(`[${this.platformName}] Service started on port ${port}`);
  }

  // ─── Alt sınıfların override edeceği metodlar ───────────────────────────────

  /** @returns {{ connected: boolean, platform: string, username?: string }} */
  async getStatus() {
    return { connected: false, platform: this.platformName };
  }

  /** @returns {Array<FeedItem>} normalize edilmiş feed öğeleri */
  async fetchFeed() {
    throw new Error(`[${this.platformName}] fetchFeed() implement edilmedi`);
  }

  /** @param {{ content: string, media?: Array, tags?: Array }} post */
  async publishPost() {
    throw new Error(`[${this.platformName}] publishPost() implement edilmedi`);
  }

  /** @param {{ code: string, state?: string }} query — OAuth callback params */
  async authenticate() {
    throw new Error(`[${this.platformName}] authenticate() implement edilmedi`);
  }

  // ─── Yardımcı metodlar ───────────────────────────────────────────────────────

  /**
   * Normalize edilmiş feed öğesi oluştur.
   * Platform servisleri bu şablonu kullanarak veriyi standartlaştırır.
   */
  normalizeFeedItem({
    originalId,
    author,
    content,
    contentHtml = null,
    media = [],
    links = [],
    platformTags = [],
    metrics = {},
    url = null,
    createdAt = new Date(),
  }) {
    return {
      platform: this.platformName,
      originalId: String(originalId),
      author: {
        name: author.name || '',
        username: author.username || '',
        avatar: author.avatar || null,
        profileUrl: author.profileUrl || null,
      },
      content,
      contentHtml,
      media,
      links,
      tags: [],
      platformTags,
      metrics: {
        likes: metrics.likes || 0,
        comments: metrics.comments || 0,
        shares: metrics.shares || 0,
        views: metrics.views || 0,
        bookmarks: metrics.bookmarks || 0,
      },
      url,
      createdAt: new Date(createdAt),
      fetchedAt: new Date(),
    };
  }
}

module.exports = BasePlatformService;
