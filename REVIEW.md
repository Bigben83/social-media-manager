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
| 6 | In-memory AI/scrape work lost status after restart; provider model fallback suggested a valid connection; upload/timezone/TikTok outcome gaps | Durable BullMQ work with Mongo checkpoints, live provider tests, media signatures/cleanup, DST validation, TikTok completion checks with uncertain-outcome protection | `21e3b2d` |

## Meta evidence

The original `/me/accounts` response omitted Rack-X despite a valid user token. Direct lookup of Page `1389753804217664` resolved Rack-X and linked Instagram `17841417760948202` (`rackx.app`). This was an incomplete Meta enumeration/discovery problem as well as persisted UI state, rather than simply a browser cache problem. Browser verification now shows both accounts selected in the Rack-X workspace.

## Credential handling

The deployment had an invalid encryption key and 44 plaintext secret fields. A valid private recovery key was installed, records were migrated, and verification found 44 encrypted fields and no remaining plaintext fields at that point. Older plaintext backup archives were encrypted and their originals removed after checking recovery integrity. Subsequent key changes stay encrypted. Secrets were not committed or printed.

Global Settings deliberately shares AI/provider and app credentials across workspaces. Social account credentials and business content use workspace scope. Authentication and network access were kept unchanged as requested; workspace separation does not introduce per-user permissions.

## Validation

All 53 final automated tests pass after a clean `npm ci`. The checks cover gateway routes/Meta/OAuth/isolation/analytics/streaming/background jobs/uploads, scheduler retries and uncertain outcomes, Compose result handling, Sydney DST transitions, live Socket.IO isolation, and TikTok asynchronous status handling. TypeScript and the production UI build pass. Browser smoke checks cover Settings, Global Settings, Feed, Compose, Content Plan, and Analytics without JavaScript errors. Live checks verify API/proxy routes and active container health. A job inserted only in MongoDB was recovered after restart, scraped its public test source, and retained the completed result across a second restart; querying it from another workspace returned 404. Temporary workspaces and queue records were removed. The final credential audit still reports 44 encrypted secret fields and zero plaintext fields. No public posts were sent to test delivery.

The production dependency audit reports zero vulnerabilities. The full development audit still reports 19 moderate findings, all propagated from the Jest coverage/config chain to `sprintf-js`. npm proposes an incompatible downgrade of Jest; this was not applied. The vulnerable formatter is absent from production images. Reassess when the test dependency chain has a supported upstream fix.

## Remaining external checks and operating limits

- The previously saved Claude credential still receives Anthropic HTTP 401, `x-api-key header is required`. Instrumentation confirms the saved key is present in that header for both SDK and direct fetch requests; no whitespace or proxy environment setting explains it. The owner subsequently confirmed that this credential is for organisation/compliance management, rather than model inference. Claude-account workflows now use the separate MCP connector described in README; they do not send this credential to a generation API. Direct API generation would require separate inference credentials. The new connection test reports the failure explicitly. A final failed connection request has ID `req_011Cg32RYRzmpgLSsK3pgH41`, which can be supplied to Anthropic support without sharing the key.
- No live publishing smoke test was performed. Provider permissions, publicly reachable media URLs, Pinterest board selection, and TikTok domain/app approval remain account-specific prerequisites. Twitter/X, Mastodon, and Bluesky adapters explicitly reject media until an upload implementation exists.
- Confirmed successes are not retried. A provider timeout or still-processing TikTok upload is retained as uncertain, requiring account review before resending. This favors avoiding duplicate public posts. A failed or uncertain first comment is separate from the main post outcome.
- AI jobs reuse completed checkpoints after restart. A crash during an unfinished provider call can repeat that AI request; generation providers do not offer universal idempotency. Completed job history expires after two days.
- The Docker host has roughly 4.3 GB free after rebuilding. Backups and rollback images were retained; capacity cleanup needs a separate targeted retention decision because the host also runs other applications.
- Source changes are committed locally and transferred to the deployment by Git bundle. Remote Git hosting is not updated by this deployment process.

## Provider references

- [Anthropic authentication](https://platform.claude.com/docs/en/manage-claude/authentication) and [API errors](https://platform.claude.com/docs/en/api/errors) describe accepted credentials and HTTP 401 authentication failures.
- [TikTok publishing status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status) distinguishes upload initialization from completed publication.

## Claude-account MCP connector phase

The owner chose the MCP connector workflow and requested publishing/scheduling as well as plans and drafts. Added a separate connector service using the official MCP SDK, with OAuth discovery, PKCE, owner sign-in, per-workspace grants, rotating refresh tokens, revocation, and hashed token storage. Publishing and scheduling permissions are opt-in. Immutable previews precede dispatch and cached outcomes prevent duplicate submissions; uncertain outcomes require account/Scheduler review. Posting accepts only media owned by the authorised workspace.

Global Settings provides connector setup, and Content Plan can copy a campaign-specific Claude prompt and open saved plans returned by the connector. The original app access remains unchanged. Connector protocol, owner sign-in, scope enforcement, workspace isolation, draft/plan persistence, refresh rotation/replay, revocation, CSRF, PKCE/redirect/resource binding, and duplicate dispatch are covered by integration tests. Public setup is completed in the owner’s Claude account; no live social posts are sent during verification.

Live verification on the public HTTPS domain passed owner browser sign-in, OAuth approval and PKCE token exchange, authenticated MCP tool discovery, workspace isolation, saving a temporary draft and plan, opening the saved plan in the UI, and revoking access. The temporary workspace was removed and no social posts were sent. The full suite now has 69 passing tests and the production dependency audit is clear. A browser-origin/referrer-policy issue found during live testing was corrected; OAuth metadata now uses a consistent issuer. The remaining setup is the owner adding the URL and approving access in their Claude account.

## ChatGPT MCP plugin phase

Extended the existing connector for ChatGPT alongside Claude, using the same HTTPS endpoint and separate OAuth grants. Added exact ChatGPT origin support while retaining same-origin owner form validation, ChatGPT-compatible scope metadata on every tool, and neutral tool instructions/source labels. Global Settings now includes setup cards for both chat apps; Content Plan copies a prompt for either app with the selected workspace and campaign context. English and Turkish strings and setup documentation cover both workflows. No new inference API or credential is required.

Regression coverage includes ChatGPT DCR and PKCE, tool permission metadata, schedule-only access restrictions, workspace isolation, owner form protection, and revocation. Existing publish/schedule confirmation and duplicate-dispatch tests also run with ChatGPT-style clients. Public social posting is excluded from verification.

Validation: all 73 automated tests, TypeScript/production UI build, and 37 JavaScript syntax checks pass. The production dependency audit reports zero vulnerabilities. No dependencies or app access controls changed.

Public HTTPS verification passed owner browser sign-in, OAuth approval with a ChatGPT-style callback and PKCE exchange, authenticated tool discovery with scope metadata, workspace isolation, temporary draft/plan saves, opening the saved plan in the app, both chat prompt workflows, and revocation. Browser console/page errors were empty. Temporary workspaces and OAuth test records were removed. A literal mention symbol initially broke the translated ChatGPT settings card; escaped it for the message compiler and added English/Turkish runtime translation checks. Connector and UI images were rebuilt; all 16 active services are running, with all configured health checks healthy. The account owner must still create/install the custom plugin in ChatGPT and approve its access; no public directory submission or live social post was performed.

## Local assistant and grouped Global Settings phase

Added an in-app Ollama assistant using the official MCP client and the existing tool server over an in-process transport. Owner sign-in, explicit per-workspace scopes, persisted conversations/checkpoints, capability checks, bounded tool loops, restart handling, and grant revocation cover local execution. The model never receives the execution tool: publishing/scheduling pauses for an immutable preview and a bound confirmation button, with cached outcomes preventing duplicate dispatch. Only the configured Ollama endpoint is used. Workspace deletion includes local conversation records.

Global Settings now groups each provider's connector, generation credentials and relevant image settings. Local/compatible models, Google/Gemini/Places, other AI providers, and social app credentials have their own sections. Image saves update only that provider's fields and preserve edits in other groups. Existing Claude/ChatGPT deep links are retained. The local assistant is available from navigation and Content Plan.

Automated checks cover tool-loop results, attempts to confirm from model output, cross-workspace calls, pausing parallel calls, iteration limits, owner authentication/CSRF, unsupported models, real MCP draft persistence, button-only duplicate-safe publishing, cancelled previews, revocation, restart interruption, and workspace deletion. Existing suites and the production UI build pass. Browser checks verify grouped provider placement and English/Turkish rendering without script errors. No live social posts are used for verification.

Final validation: 84 automated tests pass, the TypeScript/production UI build and 38 JavaScript syntax checks pass, and the production dependency audit is clear. Live testing with `llama3.1:8b-instruct-q5_K_M` passed owner browser sign-in, optional posting permissions, an actual MCP draft save, conversation restoration after reload, grouped provider placement, image-save isolation with a mocked PUT, and English/Turkish rendering without console/page errors. The temporary workspaces and local test grants were removed. All 16 active services are running and their configured health checks pass. A local-model formatting issue found during verification is handled by decoding JSON-encoded array/object parameters according to their declared schemas, followed by normal MCP validation; tool failures now remain visible in the activity history. No live social posts were sent.

## ChatGPT plugin menu correction

The owner reported that + offers Create plugin / Upload plugin and Create opens Plugin Creator, rather than exposing the documented Add custom MCP server action. Updated setup guidance to distinguish observed workflow creation from MCP registration and to describe the direct URL path conditionally. Added a credential-free portable plugin ZIP at `/connector/chatgpt-plugin.zip` containing `plugin.json`, `mcp.json` and a setup README with the configured public resource URL and OAuth/DCR settings. Global Settings includes its download button. The package follows the documented portable manifest shape; acceptance and actual MCP linking in the owner's ChatGPT account remain unverified and can depend on the surface and workspace policies. No public directory submission or account change was performed.

## MCP draft attachments

The owner subsequently connected ChatGPT and saved image drafts. The connector stored attachment URLs on destinations but left the editor's shared `mediaUrl` empty; opening and saving such a draft could drop the attachment. MCP draft creation now validates and fills the shared field from either `mediaUrl` or destination media, and returns attachment status for each saved draft. Each draft supports one shared image or video; different artwork requires separate drafts. Media must already exist in the authorised workspace's Media Library. The tool does not generate or upload images. Entire batches are checked before saving so invalid attachments do not leave partially saved batches.

Compose and the draft list also recognise the older destination-only format. Regression coverage checks image editing/saving/publishing, video scheduling, intentional removal, idempotency, invalid media, and workspace ownership. The connector includes `repair-draft-media.js`, which defaults to a dry run; run `docker compose exec -T connector node repair-draft-media.js --apply` after backing up MongoDB to restore eligible legacy drafts. It only fills blank fields with a single owned attachment, preserves text and retry metadata, and skips concurrently edited records.

Validation: all 89 automated tests, the TypeScript/production UI build, and 40 JavaScript syntax checks pass. No dependencies or access controls changed.


## Scheduler draft dates and cards

Added a List/Cards switch to Scheduler's Drafts tab, with the selection remembered in the browser. Both views show a saved planned date or an explicit no-date label, plus a separately labelled last update. Local draft wall times remain unchanged; timestamps with UTC/offset information use the viewer's timezone. These are draft planning dates; queued deliveries remain in Scheduled.

Cards show the saved image or a video player, content, selected accounts, planned date and Edit/Delete actions. Text-only and unavailable-media states remain usable. Media comes from the existing draft attachment lookup, including legacy connector drafts. Connected account names are resolved for MCP drafts that do not save UI labels. The responsive grid uses one to three columns. English and Turkish are included; no dependencies or backend behavior changed.

Validation: all 91 automated tests, the TypeScript/production UI build, and 40 JavaScript syntax checks pass. Browser checks cover dates in both layouts, media and legacy attachments, text-only/broken-media fallbacks, account labels, remembered layout, mobile cards, both languages, edit links and deletion using isolated fixtures. No social posts are sent.

## Editing existing drafts through MCP

Added `get_draft` and `update_draft` to the shared connector used by ChatGPT, Claude and the local assistant. The previous tools could only list or create drafts. Updates keep the same draft ID and accept partial changes to content, first comment, workspace-owned media, selected accounts and the planned local date, including drafts originally saved in the app. Omitted fields remain intact; explicit empty values clear optional fields. Changing media keeps the editor and destination attachment fields consistent. Editing a planned date does not queue delivery or change scheduled jobs.

The existing `social:drafts` permission covers updates; read-only connections cannot edit. Reads and writes are workspace scoped. An expected `updatedAt` and an atomic conditional write reject stale/concurrent updates. A request identifier and fingerprint make retries safe without overwriting a later browser edit. Creation fingerprints and creation dates are preserved. The owner consent label and portable plugin description now include editing.

Regression coverage includes app-created drafts, preservation and clearing, image/video replacement, account/date changes, retry handling, invalid input and dates, workspace/media ownership, read-only/revoked permissions, and stale/concurrent edits. All 99 automated tests, the production UI build, and 40 JavaScript syntax checks pass. No dependencies or access controls changed; social posting is excluded from verification.

## Bulk scheduling from Drafts

Added selection checkboxes and Select all in both draft layouts, followed by a review and Schedule selected action. Review uses each draft's saved date, selected accounts, content, media and first comment. The chosen review timezone interprets local dates; saved offsets remain absolute. Missing/past/invalid dates, empty content, disconnected accounts, unsupported posts, and unowned/missing library media stay in Drafts with per-item reasons. The review is read-only until the explicit scheduling button is pressed. Batches are bounded at 500 drafts.

The scheduler checks a content/date/account revision again on submission. Each source draft has a deterministic Mongo/BullMQ job ID, with durable queue state, so concurrent submissions or lost responses reuse the same job. A queue failure leaves the draft available. Successfully queued drafts are removed conditionally; newer edits made during queueing remain intact. Workspace scope and deletion status are enforced, and existing delivery receipts/worker safeguards continue to apply. No new collection, dependency or access restriction was introduced.

All 108 automated tests, the TypeScript/production UI build, and 42 JavaScript syntax checks pass. New tests cover preview-only behavior, timezone/DST conversion, invalid/foreign records, changed drafts/accounts, partial results, duplicate/concurrent submissions, queue failure before and after acceptance, and preserving concurrent browser edits. Browser checks cover selection across layouts, invalid-draft reasons, explicit confirmation, partial results, mobile review and both languages. Live verification uses temporary future jobs that are cancelled and removed; existing user drafts are not queued as part of deployment.
