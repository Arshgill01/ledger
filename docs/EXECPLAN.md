# Live-readiness handoff

Codex thread: `01a19bb2-bbac-7c91-8817-b6709c1a0823`.

## Scope and assumptions

Continue the first cut toward the SPEC §11 live demo. Keep the existing stack and all hard commitments. No PLANS.md exists in this repository. Dependencies are installed from the lockfile; do not add packages without a demonstrated need. Twitch credentials and broadcaster OAuth are required before real chat, follows, pinning, and clips can be verified. An environment OpenAI key exists; do not print it or spend against it during synthetic verification.

## Execution

1. Establish the baseline with `npm ci`, `npm run typecheck`, and `npm test`.
2. Fix confirmed live-readiness blockers with regression coverage: demo must not instantiate OpenAI; concurrent runtime events must persist in order; wrong-account OAuth must fail before storing credentials or connecting; concurrent refreshes must share one exchange; repeated stream-online notifications must not reset progress.
3. Run the synthetic demo and exercise panel, overlay, public ledger, typed extraction, due, voting, and receipts. Preserve explicit synthetic labels.
4. Review Twitch EventSub/reconnect and clip behavior against official documentation, record gaps, and harden critical paths.
5. Run typecheck/tests and a demo smoke test after edits. Record verified behavior and outstanding live dependencies in README/BUILD_LOG.
6. Once credentials are available, run hybrid mode first: broadcaster OAuth, `!iou`, `!owed`, follow progress, due/pin, live clip, voting, restart persistence. Then verify mic/transcription latency with real OpenAI. Record actual outcomes; mocks are not live evidence.

## Initial audit

- Demo currently creates an OpenAI client whenever a key exists, allowing typed demo input to leave the synthetic path.
- Runtime dispatch saves can overlap against one JSON temporary filename and emit stale state out of order.
- OAuth accepts another user's credentials and merely warns; SPEC requires broadcaster-owned tokens.
- Refresh requests are not coalesced, allowing rotating refresh tokens to race.
- Repeated stream-online events reset progress; forever counters are not separately represented.
- EventSub message parsing/async callbacks can reject without handling; reconnect timers and old sockets need explicit lifecycle ownership; subscription failures still report success.
- Each OAuth reconnect creates another stream polling interval.
- Audio handler silently drops chunks when busy; panel does not surface non-2xx audio responses.
- Public HTTP mutation routes have no authorization and the server binds all interfaces. Do not expose a tunnel as a public ledger before addressing access control.
- Approval editing, configurable overlay anchor, receipt flip, and public clip embeds remain spec gaps; current public receipts use links/thumbnails.
- Extractor has no adversarial transcript evaluation; model quality and real microphone latency are unverified.

## Progress

- [x] Read SPEC, repository rules, README, handoff, and relevant implementation.
- [x] Install locked dependencies (`npm ci`: 11 packages; audit reported zero vulnerabilities).
- [x] Complete first regression slice: 14 tests pass, including zero-outbound demo HTTP smoke coverage and local EventSub reconnect/deduplication. Synthetic fixture reached PAID/WELCHED with fake receipts at localhost:3000. Browser visual review remains pending.
- [x] Register Twitch app after owner completed 2FA; store credentials only in gitignored .env. Broadcaster OAuth, seven subscriptions, labeled !iou / !owed / !due, real pin, pin removal, void, and restart persistence passed.
- [ ] Real follow, live clip, and microphone latency remain unverified.
- [x] Add DeepSeek extraction using existing SDK, retaining separate OpenAI transcription. User requested existing DeepSeek credits first. Offline tests before a bounded provider run: maximum $0.25, no automatic retries, immutable inputs/artifacts and stop on failed smoke gate. Offline suite passed (18 tests). Real DeepSeek evaluation passed 12/12, 12 requests, peak cost upper estimate $0.0033282, latency 0.91–3.18 s. Immutable run artifacts: data/evals/deepseek-20261102-01. Select DeepSeek locally after verification.

## Cloud handoff and remote synchronization (Nov 2)

User requested publishing all verified local work and expanding Devin's new docs/HANDOFF.md before a cloud review/hardening/design session. Preserve the incoming duplicate-promise fix.

- [ ] Checkpoint the local implementation without credentials or local runtime artifacts.
- [ ] Integrate origin/main, resolving overlapping README and engine/test changes without losing either slice.
- [ ] Reconcile HANDOFF, kickoff prompt and verification status; prioritize unauthenticated public API/WS exposure and dropped audio. Record local/cloud responsibilities, remaining decisions, evidence and test commands.
- [ ] Run typecheck, tests, keyless demo smoke and staged secret checks; commit and push main. Verify the remote SHA matches the local HEAD.

This pass publishes and documents the state; it does not claim to fix the access-control or audio-queue gaps. The cloud agent should propose its plan before implementation and preserve the live verification steps for the local session.
