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
| Instagram | Free | ⚠️ | ⚠️ | Business/Creator account required |
| YouTube | Free | ✅ | ❌ | Subscription feed read-only |

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
