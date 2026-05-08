# SocialManager — Personal Social Media Manager

A self-hosted, local-first social media management platform. Aggregate feeds from all your platforms, compose and cross-post content, schedule posts, and get AI-powered suggestions — all from one dashboard.

---

## Features

- **Unified Feed** — Pull feeds from Twitter/X, Mastodon, Bluesky, LinkedIn, Instagram, Reddit and YouTube into a single dashboard
- **Filter & Tag** — Filter your feed by platform or custom tags
- **Cross-post** — Write once, publish to multiple platforms simultaneously
- **Scheduler** — Schedule posts for a specific date/time with BullMQ job queue
- **AI Assistance** — Grammar correction and platform-specific content adaptation (T5 model, runs locally)
- **Multi-language UI** — English and Turkish built-in; adding a new language is a single file
- **Microservices** — Each platform is an independent service, easy to add or remove
- **Fully local** — No SaaS, no subscriptions. Runs entirely on your machine via Docker

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3, TypeScript, Vite, Tailwind CSS, Pinia, Vue Router, vue-i18n |
| API Gateway | Node.js / Fastify |
| Message Broker | RabbitMQ |
| Database | MongoDB |
| Job Queue | Redis + BullMQ |
| AI Service | Python / HappyTransformer (T5) |
| Platform SDKs | twitter-api-v2, masto, @atproto/api |
| Reverse Proxy | Nginx |
| Containerization | Docker Compose |

---

## Services

| Service | Port | Description |
|---------|------|-------------|
| `nginx` | 8081 | Reverse proxy — main entry point |
| `ui` | — | Vue 3 frontend (Vite dev server) |
| `gateway` | 8084 | REST API gateway |
| `socket` | 8085 | WebSocket server (real-time feed updates) |
| `formatter` | — | Platform-specific content formatter |
| `ai-grammar-correction` | — | AI grammar correction (T5) |
| `feed-aggregator` | 3010 | Pulls feeds from all platforms periodically |
| `scheduler` | 3011 | Scheduled post management (BullMQ) |
| `twitter` | 3001 | Twitter/X integration |
| `linkedin` | 3002 | LinkedIn integration |
| `mastodon` | 3003 | Mastodon integration |
| `bluesky` | 3004 | Bluesky (AT Protocol) integration |
| `mongodb` | 27018 | Database |
| `redis` | 6379 | Cache & job queue |
| `messageBroker` | 5672 / 15672 | RabbitMQ (+ management UI) |

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/mehmetkirkoca/social-media-manager.git
cd social-media-manager
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your API credentials for the platforms you want to use. You can start with just Mastodon or Bluesky — both have free, open APIs.

```env
# Mastodon (easiest — get token from instance Settings > Development)
MASTODON_INSTANCE_URL=https://mastodon.social
MASTODON_ACCESS_TOKEN=your_token_here

# Bluesky (use an App Password from Settings > App Passwords)
BLUESKY_IDENTIFIER=yourhandle.bsky.social
BLUESKY_APP_PASSWORD=your_app_password_here
```

### 3. Start the application

```bash
docker compose up -d
```

Open **http://localhost:8081** in your browser.

---

## Platform Connection Guide

| Platform | API Cost | Feed | Post | Notes |
|----------|----------|------|------|-------|
| Mastodon | Free | ✅ | ✅ | Easiest — open REST API |
| Bluesky | Free | ✅ | ✅ | App Password auth, no OAuth needed |
| Reddit | Free | ✅ | ✅ | Register an app at reddit.com/prefs/apps |
| Twitter/X | Paid ($100/mo Basic) | ⚠️ | ✅ | Free tier very limited |
| LinkedIn | Free | ⚠️ | ✅ | Personal feed read not available via API |
| Instagram | Free | ✅ | ✅ | Business/Creator account + Facebook Page required |
| Facebook | Free | ✅ | ✅ | Facebook Page required (personal timelines not supported) |
| YouTube | Free | ✅ | ❌ | Subscription feed read-only |

---

## Instagram & Facebook Setup (Facebook Developer App)

Both Instagram and Facebook share **one Facebook Developer App**. You set it up once, then connect everything from the Settings UI — no token copying required.

### Prerequisites

- A [Facebook Developer account](https://developers.facebook.com/)
- A **Facebook Page** (personal timelines are not supported by the Graph API)
- For Instagram: a **Business or Creator Instagram account** linked to that Facebook Page

---

### Step 1 — Create a Facebook App

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps/) and click **Create App**
2. Choose **Business** as the app type and give it a name (e.g. `SocialManager Local`)
3. In **Settings > Basic**, note down your **App ID** and **App Secret**

---

### Step 2 — Add Products & Permissions

In your app dashboard:

#### Facebook Login for Business

- Products > **Facebook Login for Business** > Set Up
- Under **Client OAuth Settings**, add to **Valid OAuth Redirect URIs**:

  ```text
  http://localhost:8081/api/auth/meta/callback
  ```

  (If hosting remotely, replace `http://localhost:8081` with your `APP_BASE_URL`)

#### Instagram Graph API

- Products > **Instagram Graph API** > Set Up

#### Required Permissions

Enable in Development mode — no App Review needed for your own accounts:

| Permission | Used for |
|------------|----------|
| `pages_manage_posts` | Post to Facebook Page |
| `pages_read_engagement` | Read Facebook Page feed |
| `instagram_basic` | Read Instagram media |
| `instagram_content_publish` | Publish Instagram posts |
| `instagram_manage_insights` | Required alongside content_publish |

---

### Step 3 — Connect from the Settings UI

1. Open <http://localhost:8081/settings>
2. In the **Facebook & Instagram** card, enter your App ID and App Secret → **Save**
3. Click **Connect with Facebook & Instagram** — this redirects you to Facebook's OAuth page
4. Authorise the app
5. You are returned to Settings with a **page picker** listing all your Facebook Pages and linked Instagram accounts
6. Check the ones you want to manage → **Connect Selected**

That's it. Tokens are stored in MongoDB — no `.env` editing required. You can connect multiple Pages and Instagram accounts simultaneously.

---

### Token Notes

| Token | Expiry | How it is handled |
| --- | --- | --- |
| Short-lived user token | 1–2 hours | Exchanged automatically during OAuth |
| Long-lived user token | ~60 days | Stored in MongoDB; reconnect via Settings when it expires |
| Page access token | Never expires | Fetched during OAuth and stored; does not need refreshing |

> **Instagram publishing:** Instagram does not support text-only posts via the Graph API. Every post requires at least one image URL (`imageUrl`) or video URL (`videoUrl`) in addition to the caption. The compose view will need these fields when targeting Instagram.

---

## Adding a New Language

1. Create `ui/src/locales/xx.ts` (copy `en.ts` and translate)
2. In `ui/src/locales/index.ts`:
   ```ts
   import xx from './xx'
   // Add to messages: { en, tr, xx }
   // Add to SUPPORTED_LOCALES: { code: 'xx', label: '...', flag: '🇽🇽' }
   ```
3. Done — language will appear in the NavBar dropdown automatically

---

## Adding a New Platform

1. Create `services/{platform}/` with `index.js`, `package.json`, `Dockerfile`
2. Extend `BasePlatformService` and implement `fetchFeed()`, `publishPost()`, `getStatus()`
3. Add the service to `docker-compose.yml`
4. Add the service URL to `feed-aggregator` and `scheduler` environment variables
5. Add platform metadata to `ui/src/stores/platforms.ts`

---

## Project Structure

```
.
├── services/
│   ├── utils/               # Shared: RabbitMQ, MongoDB, BasePlatformService
│   ├── gateway/             # API gateway
│   ├── socket/              # WebSocket server
│   ├── formatter/           # Content formatter
│   ├── ai_grammar_correction/
│   ├── feed-aggregator/
│   ├── scheduler/
│   ├── twitter/
│   ├── linkedin/
│   ├── mastodon/
│   └── bluesky/
├── ui/
│   └── src/
│       ├── views/           # Dashboard, Compose, Scheduler, Settings
│       ├── components/
│       ├── stores/          # Pinia: feed, compose, platforms
│       ├── locales/         # i18n: en, tr
│       └── router/
├── docs/                    # Architecture, roadmap, platform guides (gitignored)
├── docker-compose.yml
├── nginx.conf
└── .env.example
```

---

## License

[LICENSE.txt](LICENSE.txt)
