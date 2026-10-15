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

## Content planning

Content Plan includes an optional campaign context box (up to 20,000 characters). Add the feature to highlight, campaign goals, or numbered text for an introduction series. This context accompanies both brief generation and every platform’s post generation, remains in the recoverable background job, and is saved with the calendar. Changing campaign inputs clears a previously reviewed brief so the next approval uses the current context. Model output should still be reviewed before publishing.

Video shorts for Instagram and Facebook are planned in [the product roadmap](ROADMAP.md). The future workflow will separate script writing from video generation, with provider/model selection, captions, preview, and publishing review.

## Claude app connector (MCP)

Connect SocialManager to Claude conversations using your Claude account. Claude writes the content in the conversation and calls SocialManager tools to save it. This workflow does not use an Anthropic text-generation API key. Organisation/compliance-management credentials are not generation credentials.

Server setup:

1. Run `node scripts/configure-connector.cjs --url https://your-manager-domain.example/mcp`. It writes a salted password hash to the ignored `.env` and a generated password to the ignored `.connector-owner-password` file. The password is not printed. Use `--secret-file /private/path` to store it elsewhere, or `--rotate` to change it and invalidate existing connector-owner browser sessions.
2. Rebuild and start the connector, gateway, UI, and proxy: `docker compose build connector gateway ui`, then `docker compose up -d connector gateway ui`. Recreate Nginx after updating its bind-mounted configuration: `docker compose up -d --no-deps --force-recreate nginx`.
3. Open Global Settings → Claude app connector. Add the displayed URL as a custom connector in Claude. Use OAuth and **Register automatically** when prompted for the OAuth client registration method.
4. Sign in with the connector owner password, select the workspaces, and approve the requested permissions. Reading/drafts are selected by default; publishing and scheduling are explicit additional permissions.

On this installation the connector URL is `https://manager.tazz.com.au/mcp`. Its owner password is stored privately at `/home/social-media-manager-rollbacks/mcp-admin-password`. Retrieve it in your own terminal over SSH; do not paste it into a chat or commit it.

The connector supports reading brand profiles, connected destinations, uploaded media, plans, drafts, and scheduled-post history; saving plans and draft batches; and optionally preparing and executing publishing/scheduling previews. A post preview binds the exact content, accounts, media, workspace, and time. Claude must present it and obtain explicit user confirmation before calling the execution tool. Completed results are cached; a lost dispatch response remains uncertain and requires checking the account or Scheduler before making another submission. The connector never silently retries an uncertain public post.

Only media already uploaded to the authorised workspace may be used by connector posting tools. OAuth access tokens expire after one hour, refresh tokens rotate, grants expire after 30 days, and replaying a used refresh token revokes its grant. Revoke connections immediately at `/connector`. Tokens/codes/browser sessions are hashed at rest; OAuth client secrets are encrypted. Connector authorization does not change the app's existing authentication or network access model.

In **Content Plan**, choose the month/platforms, enter campaign context, and click **Copy Claude prompt**. Paste it into Claude with the connector enabled. Claude can save its plan and return a workspace-specific link. Open it from **Saved plans** or the returned link. The other Generate buttons continue to use the configured API/local provider; MCP does not turn a Claude chat subscription into an automatic server-side generation API.

The endpoint uses the official MCP SDK with Streamable HTTP, OAuth discovery, PKCE, dynamic client registration, and revocation. Remote clients require internet access to the HTTPS URL. No additional host port is published. Configure the existing external proxy to preserve `Authorization`, `Accept`, and MCP headers and route `/mcp`, `/connector`, `/authorize`, `/token`, `/register`, `/revoke`, and the OAuth `/.well-known/` paths to this stack. This deployment's Nginx configuration includes those routes.

## AI configuration

Ollama, Anthropic Claude, OpenAI, Groq, Gemini, and OpenAI-compatible endpoints are supported. Image generation supports the configured OpenAI, Gemini, xAI, or local image server. Keys are encrypted in MongoDB. A saved key or installed SDK does not prove that a provider accepts the credential: test with a real request. Provider authentication and stream errors are surfaced to the UI. Each configured cloud provider has a live Test Connection action; a static model list does not count as a successful connection.

AI providers and app credentials in Global Settings are shared across workspaces; social account tokens are workspace-specific. Account profiles, drafts, calendars, media ownership, competitor data, feeds, analytics, and publishing receipts are isolated by workspace. This is data separation within the existing self-hosted access model, not a new authentication or user permission system. Network exposure and access controls are unchanged.

## Publishing and analytics

Background AI briefs, calendars, bulk drafts, and competitor scrapes persist payloads, progress, checkpoints, and results in MongoDB and use BullMQ for execution and restart recovery. Completed job records expire after two days. No decrypted provider key is stored in a job. Completed calendar stages and inserted bulk drafts are reused after interruption; a crash during an unfinished provider request may repeat that generation request.

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

Uploads verify allowed media signatures and remove rejected or unregistered files. Scheduling rejects nonexistent daylight-saving times; a repeated hour resolves to its earlier occurrence.

The root workspace lock supports reproducible CI. The install script links shared backend utilities for local development. `npm run check` runs gateway regression tests, scheduler retry tests, UI publishing tests, live-feed isolation tests, TypeScript/production UI build, and JavaScript syntax checks. CI performs these checks and validates Compose configuration. Service lockfiles are also committed because each backend image installs independently.

For UI development, `npm run dev --workspace ui` starts Vite on port 5173. Use the Docker gateway/proxy for API access; production uses the compiled UI image. When upgrading dependencies, update the root lock and each affected service's independent lock, run checks and the audit, then rebuild the affected images.

## Server operations

This installation deploys at `cloud@192.168.8.80:/home/social-media-manager`. The application remains reachable through its existing port 8081. `/home/rack` belongs to a different application.

Before each phase deployment, save the previous Git commit, tag the running images, and back up MongoDB. Phase backups live under `/home/social-media-manager-rollbacks`. Database archives and the original environment snapshot are encrypted with AES-256-GCM; recovery material is private, outside the repository. The archive format is `SMMBACKUP1` followed by a 12-byte nonce and authenticated ciphertext, with AAD `social-manager-backup:v1`.

Rollback requires the matching code, images, environment key, and data snapshot. Never overwrite the encryption key or restore an older database casually. Retired containers and dependency volumes can remain stopped for rollback; do not broadly prune host resources shared with other applications.
