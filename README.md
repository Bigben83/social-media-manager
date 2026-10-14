# SocialManager

Self-hosted social media management for separate brands and workspaces. The UI supports English and Turkish. The application uses Vue 3, Fastify 5 on Node 24, MongoDB 7, Redis/BullMQ, and Nginx.

## Supported integrations

Facebook Pages, linked professional Instagram accounts, Twitter/X, Mastodon, Bluesky, Pinterest, and TikTok have publishing adapters. Provider permissions, account type, and media accessibility still apply. LinkedIn, Reddit, and YouTube are unavailable and hidden from connection/publishing choices. Their old source is retained for reference; their containers are not part of production.

Twitter/X, Mastodon, and Bluesky currently publish text only. Requests with media are rejected rather than dropping attachments. Instagram requires an image or video; TikTok requires a video. Pinterest needs an image and a board. Facebook supports text, links, images, and videos. A timeout can leave a provider outcome uncertain: check the account before resending. The UI preserves failed destinations and shows per-account results.

## Run with Docker

1. Copy `.env.example` to `.env` and set `APP_BASE_URL` to the URL registered with your providers.
2. Generate and privately store a 32-byte encryption key:

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Set `ENCRYPTION_KEY` to the resulting 64 hexadecimal characters. An invalid key prevents startup. Preserve this key with backups; changing it without migrating encrypted credentials makes them unreadable.
3. Run `docker compose build` then `docker compose up -d`.
4. Open `http://localhost:8081` and configure accounts in Settings and AI providers in Global Settings.

Production images contain application code and locked dependencies. The UI serves compiled assets with Nginx, without the Vite development server. Rebuild changed services to apply source or dependency changes. Nginx resolves container names through Docker DNS so service recreation does not leave stale upstream IPs.

Persistent data resides in `mongodb-data`, `redis-data`, and `media_uploads`. Redis enables append-only persistence. Backend health checks use `/health`. Scheduler shutdown allows 150 seconds for active deliveries. Do not delete volumes during normal updates.

## Facebook and Instagram discovery

Select the intended workspace before connecting Meta. OAuth uses a short-lived, one-time state bound to that workspace. Discovery follows paginated Page listings and accessible business portfolios. It persists pending selections across reloads.

Meta can omit a Page from its account listing even when a direct lookup is authorized. In **Choose Pages & Accounts to Connect**, use **Find Page** with its Facebook URL or numeric Page ID, then select the Page and linked Instagram account and click **Connect Selected**. Refresh fetches discovery again. Permission errors appear as warnings; refresh cannot grant missing Meta permissions. Instagram must be a professional account linked to the Facebook Page.

## AI configuration

Ollama, Anthropic Claude, OpenAI, Groq, Gemini, and OpenAI-compatible endpoints are supported. Image generation supports the configured OpenAI, Gemini, xAI, or local image server. Keys are encrypted in MongoDB. A saved key or installed SDK does not prove that a provider accepts the credential: test with a real request. Provider authentication and stream errors are surfaced to the UI.

Provider settings follow workspace scope, with the existing global defaults where configured. Account profiles, drafts, calendars, media ownership, competitor data, feeds, analytics, and publishing receipts are isolated by workspace. This is data separation within the existing self-hosted access model, not a new authentication or user permission system. Network exposure and access controls are unchanged.

## Publishing and analytics

Immediate publishing and scheduling use stable per-destination identifiers and stored delivery receipts. Known temporary failures can retry; confirmed successes are skipped. Uncertain outcomes require review. Invalid dates and unsupported destinations are rejected before delivery. Workspace deletion first checks/cancels its scheduled work and retains data if publishing is active.

Analytics combine immediate and scheduled posts, count confirmed destination outcomes, include partial failures, and support account filters and CSV export. CSV output escapes spreadsheet formulas. Hashtag metrics are scoped per workspace/account and avoid accumulating the same engagement repeatedly.

Live feed notifications use Socket.IO rooms per workspace. The aggregator sends bounded events directly to the socket service. Legacy RabbitMQ, formatter, LinkedIn, and grammar containers have been retired; no production service depends on them.

## Development and verification

Install Node 24 or later, then run:

```sh
npm ci
npm run check
npm audit --omit=dev
```

The root workspace lock supports reproducible CI. The install script links shared backend utilities for local development. `npm run check` runs gateway regression tests, scheduler retry tests, UI publishing tests, live-feed isolation tests, TypeScript/production UI build, and JavaScript syntax checks. CI performs these checks and validates Compose configuration. Service lockfiles are also committed because each backend image installs independently.

For UI development, `npm run dev --workspace ui` starts Vite on port 5173. Use the Docker gateway/proxy for API access; production uses the compiled UI image. When upgrading dependencies, update the root lock and each affected service's independent lock, run checks and the audit, then rebuild the affected images.

## Server operations

This installation deploys at `cloud@192.168.8.80:/home/social-media-manager`. The application remains reachable through its existing port 8081. `/home/rack` belongs to a different application.

Before each phase deployment, save the previous Git commit, tag the running images, and back up MongoDB. Phase backups live under `/home/social-media-manager-rollbacks`. Database archives and the original environment snapshot are encrypted with AES-256-GCM; recovery material is private, outside the repository. The archive format is `SMMBACKUP1` followed by a 12-byte nonce and authenticated ciphertext, with AAD `social-manager-backup:v1`.

Rollback requires the matching code, images, environment key, and data snapshot. Never overwrite the encryption key or restore an older database casually. Retired containers and dependency volumes can remain stopped for rollback; do not broadly prune host resources shared with other applications.
