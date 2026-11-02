# Handoff — second pass over the plan and the code

Written Nov 1, 2026 after the first implementation pass. For the agent (Codex cloud thread, Claude, human) that picks this up. Read `SPEC.md` and `AGENTS.md` first; this file is the honest list of what is thin, what is unverified, what is open, and where you have freedom.

**Deadline: Nov 2, 2026, 2:00 PM PT (Nov 3, 3:30 AM IST).** Budget time backwards from the video.

---

## 1. What exists and how far it has been exercised

| Area | State | Verified how |
|---|---|---|
| Engine reducer `src/engine/ledger.ts` | complete for SPEC §4.1–4.4 | 8 `node:test` cases, demo fixture end to end |
| Demo mode (`npm run demo`) | complete, keyless, seeded carry-over IOU | full fixture run: stamp → progress → DUE (pin + clip) → `!paid` quorum → PAID; `!due` → `!cap` → WELCHED; `!owed`, `!receipts` replies |
| Overlay / panel / public ledger | functional, styled | screenshots in a 1920×1080 headless Chrome; **never loaded inside OBS yet** |
| Twitch auth (`src/twitch/auth.ts`) | written to the docs | **never run against Twitch** |
| Helix wrapper, EventSub WS client | written to the docs | **never run against Twitch** |
| Chat commands | complete | demo fixture only |
| OpenAI extraction (`src/engine/extract.ts`) | written, JSON-schema output | **never called with a real key**; the prompt has not been tuned |
| OpenAI transcription (`src/engine/transcribe.ts`) + mic capture in panel | written | **never run end to end** |
| Heuristic extractor (`src/engine/heuristic.ts`) | works for the fixture phrasings | typed lines in demo mode |

Everything in bold is the first thing a live-credentials session should do. Expect small API-shape mistakes there; the shapes were taken from the public Helix/EventSub docs on Nov 1.

## 2. Known gaps and risks, ranked

### Must fix before the demo video
1. **Mutating endpoints are unauthenticated.** `POST /api/event`, `/api/transcript`, `/api/audio`, `/api/demo/*` accept anything from anyone who can reach the port. Fine on localhost. **If `PUBLIC_URL` is exposed (ngrok/cloudflared) so `!receipts` is clickable, chat can mutate the ledger and read the mic transcript over `/ws`.** Options: bind mutating routes to loopback only; or an `ADMIN_TOKEN` header the panel sends; and send the public ledger a reduced snapshot (no `transcript`, no `chat`). Pick one and do it.
2. **Audio chunks are dropped while a transcription is in flight** (`busy` flag in `src/index.ts`). With 4 s chunks and ~2–4 s API latency this loses speech regularly. Queue chunks (bounded, e.g. 3) instead of dropping.
3. **Live-mode smoke test has not happened.** OAuth → `!owed` reply → typed promise → real follow moves the bar → `!due` → pinned message visible in Twitch chat → clip appears. Each step can fail on a detail (scope missing, `pin` rejected because the token user is not the broadcaster, clip 404 when offline).
4. **Transcription is hard-coded to `language: 'en'`.** Remove or make configurable before anyone non-English tries it.

### Should fix
5. `tick` (time-based DUE for absolute deadlines like "by Friday") only runs in the live poll loop every 60 s. Demo mode never ticks. Fine for the video, wrong in general.
6. `stream.offline` calls in `time` IOUs by regex on the label (`end of stream|tonight|...`). Make the extractor emit a canonical label (`end_of_stream`) and match on that.
7. The extractor always emits `window: 'stream'` for count conditions. "If I ever hit 1000 followers" should be `forever`. Add it to the schema.
8. Paid/void IOUs are not sent to the LLM as context, so "remember when I ate the pepper" can be re-logged. Include recently settled IOUs in the prompt as "already settled, ignore".
9. The pinned-message id is recovered by regex (`IOU #(\d+)`) on the chat text in `Runtime.execute`. Carry `iouId` on the `say` effect instead.
10. Broadcaster/mod votes count like anyone else's. Probably exclude the broadcaster from `!paid`.
11. Two IOUs becoming DUE within 20 minutes: Twitch allows one mod-pinned message, so the second pin replaces the first. Acceptable; mention in README.
12. No `PENDING` edit UI in the panel (the reducer supports `edits`).
13. No CI. A GitHub Actions workflow running `npm run typecheck && npm test` is cheap and judges notice.
14. `typescript` resolved to 7.x at install time. It typechecks fine; if anything odd shows up, pin `^5.6`.

### Cosmetic / design debt
15. Overlay has no sound cue, no receipt "flip" animation on PAID, no `?anchor=` support (SPEC §6.1 lists them as defaults).
16. Overlay "THE LEDGER" title is white with a shadow; on a bright game scene it may vanish. Consider a dark pill.
17. Panel shows no error when `/api/audio` fails (bad key, quota). Surface `status` lines more prominently.
18. Receipt card width is fixed at 360 px; long promises wrap to 3 lines and push the board up. Cap text at two lines with ellipsis or scale the font.

## 3. Things that are deliberately open (your call)

- **Realtime vs chunked transcription.** Chunked is implemented; the Realtime WS API would cut stamp latency from ~6 s to ~2 s. Only worth it if rehearsal shows the stamp landing after the moment has passed.
- **Default extraction mode.** `auto` is the default because the stamp moment is the demo. If the live extractor is noisy, flip the default to `approval` and show the approve click in the video instead.
- **Models.** `gpt-4.1-mini` / `gpt-4o-mini-transcribe` are placeholders. Anything that passes the fixture transcript plus ten adversarial lines you write is fine.
- **Persistence.** JSON file via `Store`. SQLite welcome.
- **Frontend stack.** Plain HTML/JS by choice (judges read it). If a design pass wants a framework, keep the overlay dependency-free; it runs inside OBS's embedded Chromium.
- **Fixture content.** The synthetic stream is 77 s and tells the whole story. Rewrite it freely as long as it still shows: carry-over, stamp, progress, DUE with pin and clip, vote, WELCHED.
- **Naming.** The product is "Ledger", chat bot replies as the broadcaster's own account. Rename or add a bot persona if it reads better on stream.
- **Shared Chat / collab mode.** SPEC §8 lists it as nice-to-have. Nobody else in the field uses Shared Chat; if the core is solid by Monday morning IST, this is the differentiator to add.
- **Vote weighting.** Subs/VIPs counting double is a small, fun change if there is time.

## 4. Questions worth a decision before building further

1. Does the broadcaster run the OAuth flow, or a separate bot account? Pinning requires broadcaster or mod; the current code assumes the broadcaster token. A bot account must be modded first.
2. Will `!receipts` link be public during the video? If yes, gap #1 must be fixed first.
3. Does the demo channel have followers available to trigger a real `channel.follow`? If not, the live segment should use a typed/`!iou` promise and a `!due` from a mod, which is honest and still shows pin + clip.
4. Is the streamer in the video speaking English? Decides gap #4.
5. Do we show `PENDING`/approval in the video at all? Simpler story: no.

## 5. Verification checklist for a live-credentials session

```
[ ] cp .env.example .env, fill keys, npm run dev
[ ] /panel → Connect Twitch → redirected back, pill says "twitch: connected"
[ ] status log shows "EventSub subscribed" with no "subscribe ... failed" lines
[ ] type "!owed" in real Twitch chat → bot reply threads under it
[ ] type a promise in the panel textarea → IOU stamped on /overlay within 2 s
[ ] Start mic, say a promise → transcript line appears, IOU stamped (note latency)
[ ] follow from an alt account → follows counter and card bar move
[ ] !due <n> from a mod → pinned message appears in Twitch chat, clip link appears in panel within ~60 s (channel must be live)
[ ] !paid from 5 accounts or Mark paid in panel → PAID stamp, payoff clip
[ ] restart server → ledger persisted from data/ledger-<channel>.json
[ ] add /overlay as OBS browser source → transparent, animations smooth
```

## 6. Submission checklist (from the Devpost rules and the Nov 1 organiser update)

- Repo public or shared with testing@devpost.com; no keys committed; `README` runs from a fresh clone.
- Video ≤ 3 min on YouTube (unlisted OK, private not), real footage on Twitch, a segment showing Codex building it.
- Description: features, functionality, how Codex was used.
- Codex session ID of the main build thread (`/status`).
- After submitting: do not touch the repo, video or links until winners are announced. Copy the repo to keep working.
