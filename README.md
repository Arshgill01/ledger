# Ledger

**Chat keeps the receipts.**

Ledger listens to a Twitch stream, logs every promise the streamer makes ("if we hit 50 subs I'll eat the ghost pepper"), tracks the condition through Twitch EventSub, and calls in the debt when it comes due: pinned chat message, a clip as the receipt, and a `!paid` / `!cap` vote. Debts carry over to the next stream.

Built for the Codex x TwitchCon Hackathon 2026 with OpenAI Codex. See `SPEC.md` for the full spec and `AGENTS.md` for working rules.

## Try it in 60 seconds (no keys)

```sh
npm install
npm run demo
```

Open http://localhost:3000. Demo mode plays a synthetic stream: scripted transcript lines, fake chat, a fake follow goal and raid. Every surface shows a DEMO badge. Nothing connects to Twitch or any AI provider.

- Overlay (OBS browser source): http://localhost:3000/overlay
- Streamer panel: http://localhost:3000/panel
- Public ledger: http://localhost:3000/ledger

## Live mode

1. Register an app at https://dev.twitch.tv/console/apps with redirect `http://localhost:3000/auth/callback`.
2. `cp .env.example .env` and fill `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_CHANNEL`. For extraction, use `OPENAI_API_KEY` (default), or set `EXTRACTION_PROVIDER=deepseek` and `DEEPSEEK_API_KEY`. Microphone transcription still requires `OPENAI_API_KEY`.
3. `npm run dev`, open http://localhost:3000/panel and sign in with the operator key from `data/operator.key` (created on first start, mode 0600; or set `OPERATOR_KEY`). Click **Connect Twitch**, then **Start mic**.
4. Add http://localhost:3000/overlay as a browser source in OBS (1920x1080, transparent).

Twitch requires two-factor authentication on the developer account before registering an app. Choose a **Confidential** client and complete Ledger's OAuth flow as the same broadcaster named in `TWITCH_CHANNEL`; other accounts are rejected.

To verify Twitch before using AI, set `RECEIPTS_MODE=hybrid` in `.env`. This mode makes no AI calls, even if keys are present in the environment. Use `!iou <promise>` as the broadcaster/mod or log promises from the panel. Microphone transcription and model extraction require live mode. Speech-to-text uses OpenAI `gpt-4o-mini-transcribe`. Promise extraction supports OpenAI `gpt-4.1-mini` or DeepSeek `deepseek-flash` through its Responses API with JSON schema, thinking disabled, and a 1,024-token output limit. DeepSeek cannot replace the speech-to-text step; without an OpenAI key, use typed transcripts or `!iou`. Local transcription is not integrated.

### Who can see and do what

| Surface | Access | Data |
|---|---|---|
| `/overlay`, `/ledger`, `/` (`/api/public/state`, `/ws`) | anyone who can reach the server | IOUs that are OPEN/DUE/PAID/WELCHED, vote **counts**, clip links. No transcript, chat, status log, voter ids, PENDING or VOID IOUs. |
| `/panel` (`/api/state`, `/ws/operator`, every POST, `/auth/login`) | operator only in live/hybrid | everything, plus all mutations |

- The server binds `127.0.0.1` by default. Set `HOST=0.0.0.0` only for a two-PC setup.
- Operators sign in once on the panel with the operator key. The browser gets an HttpOnly, SameSite=Strict cookie derived from the key; the key is never served in page JS and never logged.
- Requests and WebSocket handshakes carrying another site's `Origin` are refused, and JSON APIs require `Content-Type: application/json`, so a website the streamer visits can't drive or read the local server.
- The panel can only send the actions it shows. Votes, receipts, extracted promises and Twitch metrics can't be injected over HTTP; demo-only fake metrics are refused outside demo mode.
- Demo mode has no operator sign-in (synthetic data, no providers, loopback only), but the Origin checks and action allowlist still apply.
- To share the public ledger through a tunnel (ngrok/cloudflared), set `PUBLIC_URL` to the tunnel URL. The overlay and ledger work without sign-in; the panel still needs the key. This path is covered by tests, but no tunnel has been tried for real yet.

## How it works

```
mic → 4s audio segments → bounded server queue (serial) → OpenAI transcription → promise extraction (JSON schema) → IOU stamped on overlay
Twitch EventSub (follows / subs / bits / raid / stream.offline) → condition progress → DUE
DUE → Send Chat Message with pin:true + Create Clip (the receipt) → chat votes !paid / !cap → PAID or WELCHED
```

The engine (`src/engine/ledger.ts`) is a pure reducer with tests (`npm test`). Everything with side effects (Twitch, AI providers, files) lives outside it.

## Chat commands

`!owed` board · `!paid [n]` / `!cap [n]` vote · `!iou <text>` (mods) · `!due <n>` (mods) · `!void <n>` (mods) · `!receipts` link

## Status

Codex handoff in progress: regression coverage includes concurrent persistence, broadcaster-only OAuth, coalesced token refresh, duplicate stream events, synthetic-mode isolation, and EventSub socket handoff/deduplication. On Nov 2, real broadcaster OAuth, all seven EventSub subscriptions, `!iou`, `!owed`, `!due`, chat pinning, test cleanup, and restart persistence passed on `clasher1110`. Real clips, follow events, and microphone latency remain unverified. Start cloud work with `docs/HANDOFF.md`; see `docs/BUILD_LOG.md` and `docs/EXECPLAN.md` for progress and remaining gaps.

## Extraction evaluation

`npm test` uses mocks and makes no paid model calls. The separate DeepSeek evaluation sends synthetic transcripts to the real provider. It stops at the first failure, has no retries, and saves requests, responses, hashes, usage and timing under gitignored `data/evals/`.

```sh
mkdir -p data/evals
node --import tsx scripts/eval-extraction.mjs --prepare data/evals/UNIQUE-RUN
# Review manifest.json before this explicit paid command (12 calls, ceiling $0.25).
node --import tsx scripts/eval-extraction.mjs --run data/evals/UNIQUE-RUN
```

Nov 2 result: 12/12 cases passed, including the demo follow promise, count metrics, time/event conditions, quoted chat, sarcasm, duplicate suppression, and prompt injection. Usage was 8,970 input / 531 output tokens, at most $0.0033282 at peak cache-miss rates; extraction latency was 0.91–3.18 s. These synthetic text cases do not establish general accuracy or end-to-end microphone latency. Rates: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).
