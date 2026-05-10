# SocialManager — Personal Social Media Manager

A self-hosted, local-first social media management platform. Aggregate feeds from all your platforms, compose and cross-post content, schedule posts with per-account timezone support, and get AI-powered suggestions via a local Ollama instance — all from one privacy-first dashboard.

---

## Features

- **Unified Feed** — Pull feeds from Twitter/X, Mastodon, Bluesky, LinkedIn, Instagram, Facebook, Reddit, YouTube and Pinterest into a single TweetDeck-style dashboard
- **Cross-post** — Write once, publish to multiple platforms simultaneously with per-account targeting
- **Scheduler** — Schedule posts for a specific date/time; BullMQ handles retries with idempotent delivery (no duplicate posts)
- **Per-account Timezone** — Each account stores its own timezone; the compose view converts scheduled times correctly
- **Media Library** — Upload images and videos from your device; pick from the library in Compose
- **Draft Saving** — Save posts and return to them later from the Drafts tab
- **Content Calendar** — Month/week calendar view of scheduled posts in the Scheduler
- **Account Profiles** — Store business context (name, industry, audience, tone, hashtags) per account for AI context injection
- **AI Assistance** — Multi-provider: local [Ollama](https://ollama.ai) (llama3.2, llava, etc.), OpenAI (GPT-4o), Groq (Llama, Mixtral), or Google Gemini; draft generation, hashtag suggestions, image captions; streams directly into the editor
- **Analytics & Insights** — Publishing stats, 30-day activity chart, platform breakdown, per-account filtering, engagement heatmap, best posting times, and top posts (crawled from platform APIs)
- **Scheduling Suggestions** — Optimal posting times suggested in Compose, based on your engagement history or industry defaults
- **Token Expiry Warnings** — Dashboard banner when Meta tokens are within 7 days of expiry
- **Token Encryption** — OAuth tokens stored AES-256-GCM encrypted at rest
- **Structured Logging** — Pino JSON logging across all services with consistent fields
- **Multi-language UI** — English and Turkish built-in; adding a new language is a single file
- **Microservices** — Each platform is an independent service, easy to add or remove
- **Fully local** — No SaaS, no subscriptions. Runs entirely on your machine via Docker

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Vue 3, TypeScript, Vite, Tailwind CSS, Pinia, Vue Router, vue-i18n |
| API Gateway | Node.js / Fastify 4 |
| Platform Services | Node.js / Fastify (one per platform) |
| Database | MongoDB 6 |
| Job Queue | Redis + BullMQ |
| AI | [Ollama](https://ollama.ai) (local) · OpenAI · Groq · Google Gemini |
| Logging | Pino (structured JSON) |
| Reverse Proxy | Nginx |
| Containerization | Docker Compose |

---

## Services

| Service | Port | Description |
| --- | --- | --- |
| `nginx` | 8081 | Reverse proxy — main entry point |
| `ui` | — | Vue 3 frontend (Vite dev server) |
| `gateway` | 8084 | REST API gateway |
| `socket` | 8085 | WebSocket server (real-time feed updates) |
| `feed-aggregator` | 3010 | Polls feeds from all platforms periodically |
| `scheduler` | 3011 | Scheduled post management (BullMQ) |
| `twitter` | 3001 | Twitter/X integration |
| `linkedin` | 3002 | LinkedIn integration |
| `mastodon` | 3003 | Mastodon integration |
| `bluesky` | 3004 | Bluesky (AT Protocol) integration |
| `instagram` | 3005 | Instagram Graph API |
| `facebook` | 3006 | Facebook Pages Graph API |
| `pinterest` | 3008 | Pinterest API v5 |
| `mongodb` | 27018 | Database |
| `redis` | 6379 | Cache & job queue |
| `messageBroker` | 5672 / 15672 | RabbitMQ (legacy, largely unused) |

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

Edit `.env` and fill in your API credentials. Minimum required fields:

```env
APP_BASE_URL=http://localhost:8081

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your_64_hex_char_key_here

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

Open **<http://localhost:8081>** in your browser.

### 4. (Optional) Connect AI

SocialManager supports four AI providers. Switch between them at any time in **Settings → AI Integration**.

#### Ollama (local, free)

Run Ollama on your host machine and pull a model:

```bash
ollama pull llama3.2      # text generation
ollama pull llava         # image captioning (vision)
```

In Settings, set the Ollama endpoint to `http://host.docker.internal:11434`, test the connection, and click **Save**.

#### Cloud providers (OpenAI · Groq · Gemini)

Go to **Settings → AI Integration** and open the card for the provider you want:

| Provider | Where to get a key |
| --- | --- |
| OpenAI (GPT-4o, GPT-4o-mini) | [platform.openai.com](https://platform.openai.com) |
| Groq (Llama 3, Mixtral) | [console.groq.com](https://console.groq.com) |
| Google Gemini (2.0 Flash, 1.5 Pro) | [aistudio.google.com](https://aistudio.google.com) |

Paste your API key and click **Connect & Set Active**. Keys are stored AES-256-GCM encrypted in MongoDB — no `.env` editing required. Only one provider is active at a time; switch with the **Set as Active** button on any configured card.

---

## Platform Connection Guide

| Platform | API Cost | Feed | Post | Notes |
| --- | --- | --- | --- | --- |
| Mastodon | Free | ✅ | ✅ | Easiest — open REST API |
| Bluesky | Free | ✅ | ✅ | App Password auth, no OAuth needed |
| Reddit | Free | ✅ | ✅ | Register an app at reddit.com/prefs/apps |
| Twitter/X | Paid ($100/mo Basic) | ⚠️ | ✅ | Free tier limited; OAuth 2.0 in pipeline |
| LinkedIn | Free | ⚠️ | ✅ | Personal feed read not available; env var token for now |
| Instagram | Free | ✅ | ✅ | Business/Creator account + Facebook Page required |
| Facebook | Free | ✅ | ✅ | Facebook Page required (personal timelines not supported) |
| YouTube | Free | ✅ | ❌ | Subscription feed only; publishing in pipeline |
| Pinterest | Free | ✅ | ✅ | OAuth via Settings UI; boards as destinations; image required for pins |
| TikTok | Free | — | — | In pipeline |
| Google Business | Free | — | — | In pipeline |

---

## Instagram & Facebook Setup (Facebook Developer App)

Both Instagram and Facebook share **one Facebook Developer App**. You set it up once, then connect everything from the Settings UI — no token copying required. Tokens are stored encrypted (AES-256-GCM) in MongoDB.

### Prerequisites

- A [Facebook Developer account](https://developers.facebook.com/)
- A **Facebook Page** (personal timelines are not supported by the Graph API)
- For Instagram: a **Business or Creator Instagram account** linked to that Facebook Page

### Step 1 — Create a Facebook App

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps/) and click **Create App**
2. Choose **Business** as the app type
3. In **Settings > Basic**, note down your **App ID** and **App Secret**

### Step 2 — Add Products & Permissions

**Facebook Login for Business:**

- Under **Client OAuth Settings**, add to **Valid OAuth Redirect URIs**:

  ```text
  http://localhost:8081/api/auth/meta/callback
  ```

**Required permissions** (Development mode — no App Review needed for your own accounts):

| Permission | Used for |
| --- | --- |
| `pages_manage_posts` | Post to Facebook Page |
| `pages_read_engagement` | Read Facebook Page feed |
| `instagram_basic` | Read Instagram media |
| `instagram_content_publish` | Publish Instagram posts |
| `instagram_manage_insights` | Required alongside content_publish |

### Step 3 — Connect from the Settings UI

1. Open <http://localhost:8081/settings>
2. Enter your App ID and App Secret → **Save**
3. Click **Connect with Facebook & Instagram**
4. Authorise the app on Facebook's OAuth page
5. Select which Pages and Instagram accounts to manage → **Connect Selected**

Tokens are stored encrypted in MongoDB — no `.env` editing required.

### Token Notes

| Token | Expiry | How it is handled |
| --- | --- | --- |
| Short-lived user token | 1–2 hours | Exchanged automatically during OAuth |
| Long-lived user token | ~60 days | Stored encrypted; reconnect via Settings when it expires |
| Page access token | Never expires | Fetched during OAuth and stored encrypted |

> A banner appears in the Dashboard and Settings when any Meta token expires within 7 days.
>
> **Instagram publishing:** Every post requires at least one `imageUrl` or `videoUrl`. Text-only posts are not supported by the Instagram Graph API.

---

## LinkedIn Setup

LinkedIn currently uses a **personal access token** stored in `.env`. A full OAuth 2.0 flow is in the pipeline.

### Step 1 — Create a LinkedIn App

1. Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) and click **Create App**
2. Fill in the app name, LinkedIn Page (required — create a company page if you don't have one), and logo
3. Under the **Products** tab, request access to:
   - **Share on LinkedIn** — enables posting to your profile/page
   - **Sign In with LinkedIn using OpenID Connect** — enables OAuth login (needed for the upcoming OAuth flow)
4. Under **Auth**, note your **Client ID** and **Client Secret**
5. Add your redirect URI under **OAuth 2.0 Settings**:

   ```text
   http://localhost:8081/api/auth/linkedin/callback
   ```

### Step 2 — Generate an Access Token

Until the OAuth flow is built, generate a token manually:

1. Use the [LinkedIn Token Generator](https://www.linkedin.com/developers/tools/oauth/token-generator) in the developer portal
2. Select scopes: `w_member_social`, `r_liteprofile`, `r_emailaddress`
3. Copy the generated access token

### Step 3 — Add to `.env`

```env
LINKEDIN_ACCESS_TOKEN=your_token_here
```

> **Note:** Manual tokens expire after 60 days. A full OAuth 2.0 connection flow (similar to the Meta flow) is planned in the pipeline — once built, you will connect LinkedIn from the Settings UI with one click and tokens will be refreshed automatically.

---

## Pinterest Setup

Pinterest uses a standard OAuth 2.0 authorization code flow. Tokens are stored encrypted (AES-256-GCM) in MongoDB. Each Pinterest board becomes a separate posting destination in Compose.

### What you need

- A [Pinterest Developer account](https://developers.pinterest.com/)
- A Pinterest user account with at least one board

### Create a Pinterest App

1. Go to [developers.pinterest.com/apps](https://developers.pinterest.com/apps/) and click **New App**
2. Fill in the app name and description; select **Web** as the platform
3. Under **App settings**, note your **Client ID** and **Client Secret**

### Configure the Redirect URI and Scopes

In your app's **Authentication** settings, add to **Redirect URIs**:

```text
http://localhost:8081/api/auth/pinterest/callback
```

**Required scopes:**

| Scope | Used for |
| --- | --- |
| `pins:read` | Read existing pins |
| `pins:write` | Create new pins |
| `boards:read` | List boards for destination picker |
| `user_accounts:read` | Verify connected account |

### Connect from the Settings UI

1. Open <http://localhost:8081/settings>
2. In the **Pinterest** card, enter your Client ID and Client Secret → **Save App Credentials**
3. Click **Connect with Pinterest**
4. Authorise the app on Pinterest's OAuth page
5. Back in Settings, check the boards you want to use → **Save Board Selection**

Each selected board now appears as a destination in the Compose view.

### Posting Notes

- **Image is required** — Pinterest's API does not support text-only pins. Always attach an image URL in Compose before selecting a Pinterest board as a destination.
- The post content becomes both the pin **title** (first 100 characters) and the **description**.
- Tokens are stored encrypted — no `.env` editing required.

---

## Adding a New Language

1. Create `ui/src/locales/xx.ts` (copy `en.ts` and translate)
2. In `ui/src/locales/index.ts`:

   ```ts
   import xx from './xx'
   // Add to messages: { en, tr, xx }
   // Add to SUPPORTED_LOCALES: { code: 'xx', label: '...', flag: '🇽🇽' }
   ```

3. Done — the language appears in the NavBar dropdown automatically

---

## Adding a New Platform

1. Create `services/{platform}/` with `index.js`, `package.json`, `Dockerfile`
2. Extend `BasePlatformService` and implement `fetchFeed()`, `publishPost()`, `getStatus()`
3. Add the service to `docker-compose.yml`
4. Add the service URL to `feed-aggregator` and `scheduler` environment variables and `PLATFORM_SERVICES` maps
5. Add platform metadata to `PLATFORM_META` in `ui/src/stores/platforms.ts`
6. Add platform name to the `activePlatforms` default set in `ui/src/stores/feed.ts`
7. Add `platforms.{key}` to both locale files (`en.ts`, `tr.ts`)

---

## Project Structure

```text
.
├── services/
│   ├── utils/               # Shared: BasePlatformService, MongoDB, RabbitMQ, logger, crypto
│   │   ├── BasePlatformService.js
│   │   ├── MongoDBConnector.js
│   │   ├── RabbitMQConnector.js
│   │   ├── RabbitMQListener.js
│   │   ├── RabbitMQProducer.js
│   │   ├── logger.js        # Pino createLogger(service) factory
│   │   └── crypto.js        # AES-256-GCM encryptToken / decryptToken
│   ├── gateway/             # API gateway (credentials, OAuth, post dispatch, AI, media, drafts)
│   ├── socket/              # WebSocket server
│   ├── feed-aggregator/     # Periodic feed polling
│   ├── scheduler/           # BullMQ scheduled post worker
│   ├── twitter/
│   ├── linkedin/
│   ├── mastodon/
│   ├── bluesky/
│   ├── instagram/
│   ├── facebook/
│   └── pinterest/
├── ui/
│   └── src/
│       ├── views/           # Dashboard, Compose, Scheduler (+ calendar/drafts), Settings, Media
│       ├── components/
│       ├── stores/          # Pinia: feed, compose, platforms, ai
│       ├── utils/           # timezone.ts (IANA list + UTC conversion)
│       ├── locales/         # i18n: en, tr
│       └── router/
├── docker-compose.yml
├── nginx.conf
├── .env.example
└── CLAUDE.md                # Developer context for AI coding sessions
```

---

## License

[LICENSE.txt](LICENSE.txt)
