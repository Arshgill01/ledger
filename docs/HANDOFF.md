# Ledger handoff — cloud review and local live verification

Updated Nov 2, 2026 by the local Codex session, expanding Devin's first-cut handoff. Read `SPEC.md`, `AGENTS.md`, then this file. Product requirements live in SPEC; this file records implementation evidence, unresolved risks, and the next work order. `docs/EXECPLAN.md` tracks the local execution history; `docs/BUILD_LOG.md` records provenance.

The owner is moving between machines and wants a cloud agent to **inspect the combined implementation and plan, recommend priorities first, then harden and fix confirmed bugs, with frontend work after the core is reliable**. Local Codex will pull the cloud work and resume credentialed checks at home. Do not wait for local credentials to review, reproduce, test, or fix offline defects.

SPEC's deadline is **Nov 2, 2026, 2:00 PM PT (Nov 3, 3:30 AM IST)**. Plan backwards from recording and upload; recheck the actual event rules before submission. This handoff is not evidence that a submission has happened.

## 1. Start here

```sh
git status --short
git log -5 --oneline
npm ci
npm run typecheck
npm test
npm run demo
```

After the cloud P0 pass (branch `fix/p0-access-boundary-audio-queue`) the suite has **35 passing tests**. `npm test` uses local mocks/servers and no paid model calls. The demo works without credentials, uses in-memory persistence, and must remain visibly synthetic on every surface. Do not use local `.env` or `data/` files from the owner's Mac in cloud work; they are deliberately absent from git.

Entry points: `src/index.ts` selects mode and wires sources; `src/runtime.ts` serializes state persistence and executes effects; `src/engine/ledger.ts` is the pure reducer. HTTP/WS exposure is in `src/server/http.ts`; recording is in `public/panel/panel.js`. Use `SPEC.md §12` for the rest of the map.

## 2. What is implemented versus actually verified

| Area | Evidence as of this handoff | Remaining uncertainty |
|---|---|---|
| Reducer, commands, persistence | Offline tests for lifecycle, voting, duplicates, duplicate stream-online events, serialized saves and recovery after save failure. Devin's incoming pepper-versus-pizza duplicate fix is retained. | See condition/state edge cases below; do not call the engine complete. |
| Demo | Full synthetic fixture previously reached PAID and WELCHED, with fake receipts and carryover. Automated child-process smoke serves all surfaces, submits typed text and blocks outbound fetch even with keys configured. | OBS rendering remains unverified. |
| OAuth | Real broadcaster OAuth succeeded for `clasher1110`. Wrong broadcaster is rejected before saving; concurrent token refreshes are coalesced and covered by mocked tests. | Expiry/401 behavior has not been exercised against a naturally expired real token. |
| EventSub | **All 7 subscriptions accepted by real Twitch**; real chat messages reached the app. Local WS tests cover malformed JSON, duplicate notifications, Twitch-directed socket handoff without resubscription, and revocation. | Real follow/raid/sub/bits delivery and a real Twitch-directed reconnect have not been exercised. |
| Chat and pin | With owner permission: real `!iou Ledger setup test — no real promise`, `!owed`, `!due`; bot replies observed. Pin verified using `GET /helix/chat/pins`. Removed only the test pin and voided its IOU. | Live voting with independent viewers remains unverified. |
| Restart | Restart restored broadcaster auth, 7/7 subscriptions, persisted VOID test IOU and original auto-clip setting. Credential files are gitignored and mode 0600. | Power loss/crash recovery and durable side-effect replay are untested. |
| DeepSeek extraction | **12/12 real provider cases passed**, including negatives and duplicate suppression. 8,970 input / 531 output tokens; peak cache-miss upper estimate $0.0033282; 0.91–3.18 s extraction latency. See `docs/AI_EVALUATION.md`. | Small synthetic text set, one repetition; not broad accuracy or microphone latency. |
| OpenAI extraction | Existing Chat Completions path remains; mocked structured-output test passes. | No real OpenAI extraction call made in this local session. |
| Speech + mic | Bounded serial queue (`src/speech.ts`) with unit tests for slow processing, overflow, failure recovery, session change and age-out. Headless Chromium with a fake mic device and **stubbed** OpenAI HTTP (9 s per call, one injected 400): segments processed in order, backlog capped at 4, drops counted identically on server and panel, the failure surfaced, the stamp reached the public overlay. | **No real microphone or real transcription call, no real latency measurement.** The fake-device tone is not speech. |
| Access boundary | Public/operator split with tests for denied and allowed REST, WS, cross-origin and CSRF-shaped requests; headless sign-in flow (wrong key refused, right key opens the panel, cookieless overlay context gets 401 on `/api/state`). | Not tried through a real tunnel (ngrok/cloudflared) or in OBS's browser source. |
| Frontend | Devin reported 1920×1080 headless screenshots; local Firefox panel showed LIVE, Twitch connected, stream offline, mic OFF, persisted VOID test record. | No OBS test, comprehensive browser pass, or paid receipt animation verification. |

The seven subscriptions are chat.message, chat.notification, follow v2, cheer, raid, stream.online, stream.offline. Accepted subscriptions do not prove that every event type has fired. Real clip creation was deliberately skipped while offline; auto-clip was temporarily disabled only for the pin test and then restored.

## 3. Current local setup and provider decision

The owner registered the confidential Twitch application **Ledger Receipts**, callback `http://localhost:3000/auth/callback`, and completed 2FA and broadcaster OAuth. Bot writes use the broadcaster's account; a separate bot account is not an open implementation choice for this baseline.

On the owner's Mac, `.env` selects `RECEIPTS_MODE=live` and `EXTRACTION_PROVIDER=deepseek`. The server was left at `http://localhost:3000`, connected to Twitch, offline stream, microphone off. Recheck the process after returning; an old process does not reload edited code unless started with the watcher. `.env` and `data/auth.json` stay local. Never copy them into this handoff, a PR, logs, or git.

- **Extraction:** user asked to spend their existing ~$2.96 DeepSeek balance first. Implemented `deepseek-flash` via the existing OpenAI SDK, fixed base URL `https://api.deepseek.com`, Responses JSON schema, thinking off, output cap 1,024 tokens, no DeepSeek automatic retries. No new dependency.
- **Transcription:** still OpenAI `gpt-4o-mini-transcribe`. A separate OpenAI client prevents sending its key to DeepSeek. DeepSeek's extraction path does not implement speech-to-text.
- **Default for fresh clones:** extraction provider remains OpenAI (`gpt-4.1-mini`); DeepSeek is selected explicitly. Model/provider defaults are documented in SPEC and `.env.example`.
- **Hybrid/demo:** instantiate no AI clients, even with ambient keys. Hybrid is real Twitch with heuristics/manual IOUs; demo is synthetic and keyless.
- **Spending boundary:** the completed extraction evaluation was authorized up to $0.25. That is not authorization for cloud agents to run unlimited model calls or change paid services. A proposed $0.05 OpenAI speech test and a request to start a real stream were still unanswered when this handoff was prepared. Do not treat them as approvals.

## 4. Priorities for the cloud agent

### P0 — public/private boundary — implemented (cloud), needs local acceptance

Implemented: loopback bind by default (`HOST`); public `GET /api/public/state` and WS `/ws` with a redacted view (`src/server/views.ts`); operator-only `GET /api/state`, WS `/ws/operator`, every POST, and `/auth/login`. Operator sign-in uses a key from `OPERATOR_KEY` or a generated `data/operator.key` (0600, never logged or served), exchanged on the panel for an HttpOnly SameSite=Strict HMAC cookie. Requests and WS handshakes with a foreign `Origin` get 403; JSON routes require `application/json` (415 otherwise). `/api/event` is an allowlist (`src/server/actions.ts`): actors are set by the server; receipts, votes, extracted promises and Twitch metrics can't be injected; fake metrics and stream end work in demo only. `/auth/callback` stays public (OAuth state). Demo has no sign-in but keeps the Origin checks and allowlist. Spec §6.4 and README document it.

Residual / not done: the key has no rotation UI (delete the file and restart; existing cookies stop working). Login has only a 400 ms failure delay as throttling (the key is 192-bit random; a weak `OPERATOR_KEY` is refused under 24 chars). The public ledger shows every OPEN/DUE/PAID/WELCHED IOU of the channel by design; quotes are public receipts. Behind a tunnel that rewrites `Host`, set `PUBLIC_URL` to the tunnel origin or browser POSTs get 403.

### P0 — speech loss and observable failures — implemented (cloud), needs real-mic measurement

Implemented: `src/speech.ts` bounded FIFO (4 waiting + 1 in flight), serial transcription+extraction, newest segment rejected with 429 + `Retry-After` when full. Segments from an older mic session, or waiting > 60 s, are skipped as stale. Failures are counted with `lastError` and the worker continues. Status goes to the panel over `/ws/operator`. Provider clients are time-boxed (speech 20 s / 1 retry; extraction 30 s; DeepSeek still 0 retries) because one hung call would otherwise stall the queue for the SDK's 10-minute default. Panel: serial uploads through a 3-slot client queue, session-guarded segment loop (fixes a double-recorder race on fast stop→start), `AudioContext` closed and tracks stopped on stop, every non-2xx/network error shown, mic disabled with a reason when no speech backend exists. Stop does not discard the final captured segment.

Not done: real-mic latency, and whether 4-deep is the right bound for real provider latency. Measure locally before tuning.

### P1 — state and integration correctness

Review and reproduce before changing behavior:

- `forever` count conditions share counters that reset for a new stream; extraction always emits `window: 'stream'`. Fixing only the schema will not fix lifetime progress. Define semantics and migration for existing JSON state if changed.
- `stream.offline` relies on human label regex for time conditions; absolute deadlines depend on a 60 s tick in the connected Twitch polling loop. Demo does not tick. Check reconnecting while already offline and stale persisted `streamId`.
- Runtime saves state before effects, but effects are detached and not durably replayed. Restart/failure between DUE and chat/clip completion can lose a receipt. Assess the narrow demo risk before proposing an outbox or a storage replacement.
- EventSub now reports subscription failures and deduplicates a bounded set of notification IDs. Review partial subscription state through reconnect/revocation, stale old-socket control frames, keepalive recovery, and start/stop races; local socket tests are not real reconnect evidence.
- Twitch chat.notification may include gift-related notices with overlapping totals. Verify documented event shapes/counting before changing sub progress. Shared Chat is outside v1; do not silently accept events from other channels as local commitments.
- Duplicate detection is intentionally cheap after model dedup. Devin fixed pepper/pizza false matches; test distinct stakes/conditions as well as paraphrases. Avoid aggressive fuzzy matching that swallows real commitments.
- Only OPEN/DUE/PENDING IOUs go to the extractor. Review retrospective mentions of settled promises and whether recent settlements should be context. Any changed prompt/schema needs an updated offline contract and, later, bounded paid requalification.
- ~~A pin receipt's IOU ID is inferred from message text~~ Fixed in the cloud pass: `say` effects carry `iouId`. Simultaneous due receipts and replacement pin behaviour are still unreviewed.
- CI: `.github/workflows/ci.yml` (npm ci, typecheck, test) was added in the cloud pass if the push was accepted; check the branch.

Do not downgrade TypeScript or migrate persistence just because the original handoff listed those as possibilities. Current locked dependencies install and typecheck successfully. Broadcaster/mod votes currently follow the ordinary one-user rule; changing weighting or exclusion is a product decision, not a confirmed bug.

### P2 — frontend/demo polish after reliability

- Pending approval supports edits in the reducer but no edit control in the panel.
- Overlay lacks `?anchor=` and a paid receipt flip; public ledger uses clip links/thumbnails instead of embeds. Check SPEC §6 against actual code. Some overlay behavior is under a [HARD] section: do not waive it as cosmetic without a conversation.
- Check overlay contrast on bright/dark game scenes, long text, dense due boards, 1920×1080 OBS transparency and animations. A sound cue is optional; do not add unlicensed assets.
- Surface API errors, backend/provider availability and reconnect state clearly. Preserve existing plain HTML/CSS/JS unless a concrete need justifies new dependencies. Prefer targeted polish over a framework rewrite.
- Public clip embeds require correct parent/hosting behavior; do not show fake live receipts when a clip is unavailable.

## 5. Decisions already made, and decisions still needed

Settled: single broadcaster-owned token; local Twitch channel `clasher1110`; DeepSeek first for extraction; no public exposure before access control; pure reducer; zero-key synthetic demo; one main Codex build thread with provenance preserved.

Still needs owner input or local verification: speech provider choice (short existing OpenAI test versus a local implementation), language(s) to support, when a real test stream can run, availability of a consenting independent follower/viewer for real events, public link requirement for the recording, and whether approval mode appears in the video. Keep auto extraction as the current default pending measured quality. Do not block unrelated offline hardening on these answers.

Changes to defaults are allowed when justified and SPEC is updated; [HARD] commitments require discussion. Keep dependencies minimal, ask before new paid services/heavy dependencies, and do not add Shared Chat, weighted voting or multi-tenant hosting ahead of the core demo.

## 6. Local acceptance checks when the owner is home

Already done: OAuth, seven accepted subscriptions, `!iou`, `!owed`, `!due`, actual pin verification/removal, test IOU void, persisted restart, real DeepSeek extraction cases. Do not repeat these just to make a cloud checklist look complete.

Still to do against the cloud changes:

- Pull the reviewed commits into a clean checkout; run `npm ci`, `npm run typecheck`, `npm test`; restart the local process and verify Twitch reconnects with existing local auth.
- Test the private/public boundary before exposing a ledger URL. In a normal browser: `/panel` asks for the key from `data/operator.key`; after sign-in, Connect Twitch still completes (the callback redirect is cross-site, and the panel recovers by checking its session). `/overlay` in OBS loads without sign-in. `curl -s localhost:3000/api/state` → 401; `curl -s localhost:3000/api/public/state` → redacted JSON. If a tunnel is used, set `PUBLIC_URL` to it and repeat from another device.
- After speech spending/provider choice is resolved, test mic → transcript → model → stamp, measuring complete latency. Watch the panel's `server queue n/4 · dropped · failed` line for real backpressure behaviour. Short synthetic audio can validate transport separately; it is not a real microphone test.
- With the broadcaster live and explicit permission for labeled test output: verify due clip and payoff clip appear through Get Clips and the UI; pin/settle/void clean up as appropriate. Do not clip unrelated live content.
- Use a consenting real viewer/follower to verify count progress and voting; never present injected metric events as real Twitch delivery.
- Load overlay inside OBS; verify transparency, stamp, progress, DUE, paid receipt and carryover. Record a real demo plus the main Codex build segment; show synthetic flows as synthetic.

## 7. Cloud work contract and return report

Start with a prioritized recommendation grounded in file paths/reproductions, separating confirmed defects from untested hypotheses and product choices. Then implement small complete slices, P0 first, with an ExecPlan for multi-step work. Use `fix/<topic>` or `feat/<topic>` branches if several cloud threads will work concurrently; assign non-overlapping files/responsibilities and do not overwrite another thread's edits. Do not force-push the shared main branch.

Keep `docs/BUILD_LOG.md` updated with the cloud thread's actual ID; preserve local main thread **`01a19bb2-bbac-7c91-8817-b6709c1a0823`**. Commit reviewable changes, update this handoff as gaps close, and return commit/branch IDs, exact validation commands and outcomes, behavioral changes, migrations/new env requirements, and remaining local acceptance steps. Do not include credentials or imply mocks establish real Twitch/OpenAI behavior.

If available in the next environment: use `review` for the initial audit, `diagnose` for difficult reproductions, `run-bounded-llm-experiment` before paid requalification, and relevant frontend skills for the later design pass. These suggestions do not substitute for the repository rules or require installing extra tooling.

## 8. Submission checklist

The original Devin handoff listed: public/shared repo, processed YouTube video ≤3 min (unlisted OK), feature/functionality and Codex description, main Codex session ID, and no post-submission changes until judging ends. Verify these against the actual current Devpost rules before submission. Neither agent has submitted or uploaded a video as part of this local session. If submission has happened meanwhile, confirm the permitted editing window before further publication.
