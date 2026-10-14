# Codebase review and remediation record

Reviewed the Vue UI, gateway/API and OAuth flows, AI adapters, platform publishers, scheduler, feed/socket services, shared storage/encryption helpers, Docker deployment, dependencies, and the live MongoDB/Redis installation. Checks avoid making public social posts.

## Findings and delivered fixes

| Phase | Finding | Change | Commit |
| --- | --- | --- | --- |
| 1 | Rack-X omitted by Meta account listing; discovery state lost on reload | Paginated discovery, business portfolios, persisted pending choices, direct authorized Page URL/ID lookup with linked Instagram, safe warnings | `31bdc80` |
| 1 | Claude package hidden by stale dependency volume; untranslated global buttons | Locked gateway install/dependency checks; corrected EN/TR labels and UI build errors | `31bdc80` |
| 2 | Partial publishing looked successful; scheduled retries could resend successes | Durable per-destination receipts, stable request IDs, preserved failures, bounded retry policy, validation, supported destination choices | `8813499` |
| 3 | Profiles/media/cache/background operations crossed workspace boundaries; invalid encryption key left credentials plaintext | Scoped IDs and queries, media ownership checks, workspace deletion coordination, OAuth state hardening, private URL fetch protection, encrypted credential migration | `d3a2712` |
| 4 | Analytics missed immediate posts and miscounted partial outcomes; streamed provider errors looked successful | Unified analytics, confirmed-destination statistics, scoped hashtag reconciliation, safer CSV exports; robust UTF-8 streaming and propagated errors | `df4431c` |
| 5 | Mutable source/dependency volumes, old runtime/dependencies, unused RabbitMQ pipeline, unscoped live events | Node 24/Fastify 5, locked production images, compiled UI, health checks, CI, current dependencies, direct workspace-scoped Socket.IO notifications; legacy services stopped | `4665225` |
| 5 follow-up | Nginx variable assignments skipped by rewrite; bind-mounted configuration retained old inode after Git update | Set targets before rewrite and recreate proxy to load current file; live API checks passed | `0225487` |
| 6 | In-memory AI/scrape work lost status after restart; provider model fallback suggested a valid connection; upload/timezone/TikTok outcome gaps | Durable BullMQ work with Mongo checkpoints, live provider tests, media signatures/cleanup, DST validation, TikTok completion checks with uncertain-outcome protection | Phase 6 commit |

## Meta evidence

The original `/me/accounts` response omitted Rack-X despite a valid user token. Direct lookup of Page `1389753804217664` resolved Rack-X and linked Instagram `17841417760948202` (`rackx.app`). This was an incomplete Meta enumeration/discovery problem as well as persisted UI state, rather than simply a browser cache problem. Browser verification now shows both accounts selected in the Rack-X workspace.

## Credential handling

The deployment had an invalid encryption key and 44 plaintext secret fields. A valid private recovery key was installed, records were migrated, and verification found 44 encrypted fields and no remaining plaintext fields at that point. Older plaintext backup archives were encrypted and their originals removed after checking recovery integrity. Subsequent key changes stay encrypted. Secrets were not committed or printed.

Global Settings deliberately shares AI/provider and app credentials across workspaces. Social account credentials and business content use workspace scope. Authentication and network access were kept unchanged as requested; workspace separation does not introduce per-user permissions.

## Validation

The final automated checks cover gateway routes/Meta/OAuth/isolation/analytics/streaming/background jobs/uploads, scheduler retries and uncertain outcomes, Compose result handling, Sydney DST transitions, live Socket.IO isolation, and TikTok asynchronous status handling. TypeScript and the production UI build pass. Browser smoke checks cover Settings, Global Settings, Feed, Compose, Content Plan, and Analytics without JavaScript errors. Live checks verify API/proxy routes and active container health. No public posts were sent to test delivery.

The production dependency audit reports zero vulnerabilities. The full development audit still reports 19 moderate findings, all propagated from the Jest coverage/config chain to `sprintf-js`. npm proposes an incompatible downgrade of Jest; this was not applied. The vulnerable formatter is absent from production images. Reassess when the test dependency chain has a supported upstream fix.

## Remaining external checks and operating limits

- The replacement saved Claude credential still receives Anthropic HTTP 401, `x-api-key header is required`. Instrumentation confirms the saved key is present in that header for both SDK and direct fetch requests; no whitespace or proxy environment setting explains it. Claude generation remains unverified pending resolution of the provider authentication response. The new connection test reports the failure explicitly.
- No live publishing smoke test was performed. Provider permissions, publicly reachable media URLs, Pinterest board selection, and TikTok domain/app approval remain account-specific prerequisites. Twitter/X, Mastodon, and Bluesky adapters explicitly reject media until an upload implementation exists.
- Confirmed successes are not retried. A provider timeout or still-processing TikTok upload is retained as uncertain, requiring account review before resending. This favors avoiding duplicate public posts. A failed or uncertain first comment is separate from the main post outcome.
- AI jobs reuse completed checkpoints after restart. A crash during an unfinished provider call can repeat that AI request; generation providers do not offer universal idempotency. Completed job history expires after two days.
- The Docker host has roughly 4.3 GB free after rebuilding. Backups and rollback images were retained; capacity cleanup needs a separate targeted retention decision because the host also runs other applications.
- Source changes are committed locally and transferred to the deployment by Git bundle. Remote Git hosting is not updated by this deployment process.
