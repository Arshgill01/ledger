# Ledger — Product & Technical Spec

> **Chat keeps the receipts.**
> Ledger listens to a Twitch stream, logs every promise the streamer makes, tracks the conditions through Twitch EventSub, and calls in the debt when it comes due.

Built for the **Codex x TwitchCon Hackathon** (submission deadline **Nov 2, 2026, 2:00 PM PT**). This file is the single source of truth for *what* we are building and *why*. `AGENTS.md` covers *how we work*. `README.md` covers *how to run it*.

Sections marked **[HARD]** are commitments: the demo, the judging story, and the submission depend on them. Everything else is a default — any contributor (human or agent) may change it if the result is better and the hard commitments still hold. If you change a default, update this file in the same change.

---

## 0. One-paragraph pitch

Streamers make promises constantly. *"If we hit 50 subs tonight I'll eat the ghost pepper."* *"I owe chat a song."* *"I will finish this boss before I sleep."* Everyone forgets them except chat, and chat has no receipts. Ledger is the receipt. It transcribes the streamer's mic in near-real-time, an LLM pulls out promises with their conditions, and an **IOU stamp lands on the overlay before the streamer finishes the sentence**. Conditions resolve automatically from Twitch events (subs, follows, bits, raids, stream end). When a debt comes due, Ledger pins it in chat, clips the moment as the receipt, and chat votes `!paid` or `!cap`. Debts carry across streams, which turns a running joke into a reason to come back.

## 1. Why this wins (judging map)

| Criterion | How Ledger scores |
|---|---|
| **Innovation / Idea** (tie-breaker #1) | No other entry in the field does promise tracking. Closest is "chat dares the streamer" (opposite direction). Not a chat game, not a boss fight, not a recap. |
| **Potential impact** | Useful (retention loop: viewers return to collect; streamers stop forgetting goals) *and* entertaining (the stamp moment, the debt board, the `!cap` vote). |
| **Technological implementation** | Realtime speech → structured extraction → EventSub-driven state machine → Helix writes (send+pin, clips). Uses the 2026 `pin` parameter on Send Chat Message. Built in Codex; the build is visible in the video. |
| **Design / fun to watch** | The overlay is the product. A crowd gets "IOU #7 stamped" in three seconds. |

## 2. Constraints that shape every decision **[HARD]**

1. **Deadline**: Nov 2, 2026, 2:00 PM PT. Video must be on YouTube (public or unlisted) and processed before then.
2. **Codex**: the Codex session ID of the main build thread is a required submission field, and "how well does it use Codex" is a judged criterion. The main implementation must happen in a Codex thread and the video must show it.
3. **Must run on a non-Affiliate Twitch account.** Polls, Predictions, Channel Points, Hype Train, Power-ups, and Tier 2/3-only features (GIFs in chat) are out. Chat, EventSub, raids, clips, pinned messages, announcements are in.
4. **Must be demoable solo**: one streamer, one mic, one OBS, a browser. No dependency on real raids or a crowd.
5. **Must run from a fresh clone with no keys** in a clearly labelled demo mode (judges test repos). Live mode needs a Twitch app + OpenAI key.
6. **Repo contains no secrets.** `.env` only, `.env.example` committed.

## 3. Personas

- **Streamer** (primary). Small-to-mid channel. Talks a lot, makes bets with chat. Wants zero-effort: start it, forget it, be reminded on stream.
- **Chat / viewers**. Want to hold the streamer to it. Use `!owed`, vote `!paid` / `!cap`, come back next stream to collect.
- **Mod**. Can log or dismiss IOUs manually, resolve disputes.
- **Judge** (meta-persona). Clones the repo, runs `npm run demo`, watches a 3-minute video.

## 4. Core loop **[HARD]**

```
mic audio ──► transcription ──► promise extraction (LLM) ──► IOU created (OPEN)
                                                                  │
   Twitch EventSub (subs/follows/bits/raid/stream.offline) ───────┤ progress updates
                                                                  ▼
                                                        condition met ──► DUE
                                                                  │
                           pin message in chat + create clip (the receipt) + overlay alarm
                                                                  │
                     streamer marks paid  OR  chat votes !paid / !cap  ──► PAID | WELCHED
                                                                  │
                                           persisted ledger, shown next stream
```

### 4.1 IOU lifecycle

| State | Meaning | Enters via | Leaves via |
|---|---|---|---|
| `PENDING` | Extracted, waiting for streamer approval (only in approval mode) | extraction | approve → `OPEN`, dismiss → deleted |
| `OPEN` | Logged, condition not yet met | extraction (auto mode), approval, `!iou` by mod | condition met → `DUE`; streamer voids → `VOID` |
| `DUE` | Condition met. Debt is callable. | condition evaluator, streamer "call it in", mod `!due <n>` | `!paid` majority or streamer → `PAID`; `!cap` majority or deadline passed → `WELCHED` |
| `PAID` | Settled, with receipt clip if available | vote / streamer | terminal |
| `WELCHED` | Streamer did not deliver | vote / deadline | streamer can reopen → `DUE` |
| `VOID` | Mis-extraction or joke retracted | streamer / mod | terminal |

### 4.2 IOU data model

```ts
interface IOU {
  id: number;                 // human-friendly sequence, shown as "IOU #7"
  channel: string;            // broadcaster login
  text: string;               // normalized promise, first person: "eat the ghost pepper"
  quote: string;              // verbatim transcript fragment that produced it
  stake: string;              // short noun phrase for the overlay: "ghost pepper"
  condition: Condition;
  state: 'PENDING' | 'OPEN' | 'DUE' | 'PAID' | 'WELCHED' | 'VOID';
  createdAt: string;          // ISO
  dueAt?: string;             // when it became DUE
  settledAt?: string;
  streamId?: string;          // Twitch stream id if live
  receipt?: { clipId?: string; clipUrl?: string; messageId?: string };
  votes: { paid: string[]; cap: string[] };  // user ids, deduped
  source: 'speech' | 'chat' | 'manual' | 'fixture';
}

type Condition =
  | { kind: 'count'; metric: 'subs' | 'follows' | 'bits' | 'raiders' | 'viewers'; target: number; progress: number; window: 'stream' | 'forever' }
  | { kind: 'time'; deadline: string; label: string }        // "before I sleep" → end of stream; "by Friday" → ISO
  | { kind: 'event'; label: string }                         // "if I die here" — resolved manually or by chat
  | { kind: 'none' };                                        // unconditional: "I owe chat a song"
```

`count` metrics reset per stream when `window === 'stream'`. `progress` is driven by EventSub. `viewers` uses Get Streams polling (cheap, 60 s).

### 4.3 Promise extraction

- Input: rolling transcript window (last ~45 s of text, with timestamps) + list of currently open IOUs (to avoid duplicates) + stream context (title, category).
- Output: JSON matching the schema in `src/engine/schema.ts` — zero or more `{ text, quote, stake, condition, confidence }`.
- Rules the prompt must enforce:
  - Only commitments made by the streamer about their own future behaviour. Not hypotheticals about others, not reading chat aloud, not sarcasm when clearly marked.
  - Normalize to first person, present tense, no trailing punctuation.
  - Never re-emit a promise already in the open list (fuzzy match by meaning).
  - `confidence` 0-1. Auto mode logs ≥ 0.7; below that goes to `PENDING`.
- Model: default `gpt-4.1-mini` via Chat Completions with `response_format: json_schema`. Swap freely if cheaper/faster/better.
- Transcription: default is browser `MediaRecorder` chunks (4 s, webm/opus) POSTed to the server, server calls OpenAI `audio.transcriptions` (`gpt-4o-mini-transcribe`). Target end-to-end stamp latency ≤ 6 s. Upgrade path: OpenAI Realtime transcription over WebSocket for ≤ 2 s. Either is acceptable; the stamp must visibly land while the moment is still fresh.

### 4.4 Condition evaluation

| EventSub type | Updates |
|---|---|
| `channel.subscribe`, `channel.subscription.gift`, `channel.subscription.message` (or `channel.chat.notification` sub/resub/gift notices) | `subs` += n |
| `channel.follow` v2 | `follows` += 1 |
| `channel.cheer` | `bits` += amount |
| `channel.raid` (to_broadcaster) | `raiders` = max(raiders, viewers) |
| `stream.offline` | all `time` conditions with label `end of stream` → `DUE`; `window: 'stream'` counters snapshot and reset |
| `channel.chat.message` | commands (§5), and feeds `source: 'chat'` IOUs when a mod uses `!iou` |

Evaluation is pure and synchronous: `evaluate(ledger, event) → { ledger', effects[] }`. Effects (`pin`, `clip`, `say`, `overlay`) are executed by the runtime. This keeps the engine testable without Twitch.

### 4.5 When a debt comes due **[HARD, the demo moment]**

1. Overlay: alarm state on the IOU card (shake + "DUE" stamp + sound cue optional).
2. Chat: `Send Chat Message` with `pin: true` — `📜 IOU #7 is DUE: @streamer owes chat "eat the ghost pepper" (50 subs hit). Vote !paid or !cap.` Pinned 20 min (Twitch fixed).
3. Clip: `Create Clip` on the broadcaster. Store `clipId`; resolve `clipUrl` via `Get Clips` after a few seconds. This is the **receipt** for the condition-met moment. A second clip is taken when the streamer marks it paid (the payoff).
4. Votes open: `!paid` / `!cap`, one vote per user id, majority of ≥ `VOTE_QUORUM` (default 5) decides, or the streamer decides from the panel. Streamer decision always wins.

## 5. Chat commands

| Command | Who | Effect |
|---|---|---|
| `!owed` / `!ledger` | anyone | Replies with open + due IOUs (max 3, then "and N more at <ledger url>") |
| `!iou <text>` | broadcaster, mods | Manually log an IOU (`condition: none`) |
| `!due <n>` | broadcaster, mods | Force IOU n to `DUE` |
| `!paid <n>` / `!cap <n>` | anyone | Vote on a `DUE` IOU (n optional if exactly one is DUE) |
| `!void <n>` | broadcaster, mods | Void an IOU |
| `!receipts` | anyone | Link to the public ledger page |

Replies use `reply_parent_message_id` so they thread under the asker. Rate-limit replies to one per command per 10 s per channel.

## 6. Surfaces

### 6.1 Overlay `/overlay` **[HARD]**
- Transparent OBS browser source, 1920×1080 safe, content anchored bottom-left by default (configurable via query `?anchor=`).
- Shows: the **debt board** (open + due IOUs, max 5, compact cards with progress bars for `count` conditions) and a **stamp animation** when a new IOU lands (big rubber-stamp "IOU #7" + stake text, 2.5 s, then slides into the board).
- Due state: card turns alarm colour, "DUE" stamp, vote tally live.
- Paid state: card flips to a receipt (clip thumbnail if available), then leaves after 15 s.
- Never shows PII beyond the broadcaster's display name and voter counts.

### 6.2 Streamer panel `/panel`
- Connect Twitch (OAuth), mic start/stop with live transcript, mode toggle (auto / approval), pending queue (approve / edit / dismiss), open & due list (call in, mark paid, void), settings (quorum, auto-pin, auto-clip), demo controls when in demo mode.
- Plain HTML/JS, no framework required. Keep it readable; judges will open it.

### 6.3 Public ledger `/ledger/:channel`
- Read-only history: paid (with clip embeds), welched, open. This is the link `!receipts` posts. Shareable, works without Twitch auth.

## 7. Modes **[HARD]**

| Mode | Trigger | Twitch | OpenAI | Purpose |
|---|---|---|---|---|
| `live` | `.env` has Twitch + OpenAI keys | real EventSub WS + Helix | real | The real product and the demo video |
| `demo` | `npm run demo` or `RECEIPTS_MODE=demo` | none; fixture emits fake chat/sub/raid events on a timeline | none; fixture carries pre-extracted promises | Judges run it with zero setup. Overlay/panel/ledger show "DEMO" badge. |
| `hybrid` | Twitch keys but no OpenAI key | real | none; promises only via `!iou` and panel | Debug Twitch wiring without spending tokens |

Demo mode must be *honest*: labelled on every surface, and the README says exactly what is synthetic.

## 8. Twitch integration details

- **Auth**: Authorization Code Grant with local redirect `http://localhost:3000/auth/callback`. Single user token for the broadcaster (acts as both broadcaster and bot). Scopes: `user:read:chat user:write:chat user:bot channel:bot moderator:manage:chat_messages clips:edit channel:read:subscriptions moderator:read:followers bits:read`. Token + refresh token stored in `data/auth.json` (gitignored). Refresh on 401.
- **EventSub**: WebSocket transport (`wss://eventsub.wss.twitch.tv/ws`). Subscribe after `session_welcome` via `POST /helix/eventsub/subscriptions` with `transport.session_id`. Handle `session_reconnect` and keepalive timeouts. Types in §4.4 plus `channel.chat.message` (condition `broadcaster_user_id` + `user_id`).
- **Helix writes**: `POST /helix/chat/messages` (with `pin`), `POST /helix/clips`, `GET /helix/clips`, `GET /helix/streams`.
- **Shared Chat**: out of scope for v1. If time permits: when `source_broadcaster_user_id` differs, tag the IOU with the source channel (two streamers betting against each other). Nice-to-have, not required.

## 9. Persistence
- `data/ledger.json` written atomically after every state change (write temp, rename). One file per channel is fine. SQLite is acceptable if someone prefers it; keep the `Store` interface in `src/engine/store.ts`.
- Must survive restarts and carry IOUs across streams (that is the retention story).

## 10. Non-goals for the hackathon
- Multi-tenant hosting, accounts, billing.
- Extensions (panel/overlay Extension review takes days).
- Perfect speech accuracy. Approval mode exists for a reason.
- Mobile layouts.

## 11. Demo video plan (3 min) **[HARD]**
0:00–0:20 Problem in one breath: streamers promise, everyone forgets, chat has no receipts.
0:20–1:20 Live on Twitch: streamer talks, says a promise, **stamp lands**; `!owed` in real chat; a second promise with a sub/follow condition; follow happens; card progress moves.
1:20–2:10 Condition met → DUE: pinned message appears in real Twitch chat, clip created, chat votes `!paid`, receipt flips.
2:10–2:40 Next-stream carryover: panel shows yesterday's debt still open; the retention hook in one sentence.
2:40–3:00 Codex: 15–20 s of the actual Codex thread building the EventSub client / overlay, session ID visible.

## 12. Repo layout (default, not a rule)
```
SPEC.md  AGENTS.md  README.md  .env.example
src/
  index.ts              boot: pick mode, start server, start sources
  config.ts             env parsing, mode detection
  server/http.ts        static + REST + WebSocket broadcast
  twitch/auth.ts        OAuth code grant, token store, refresh
  twitch/helix.ts       thin fetch wrapper for Helix
  twitch/eventsub.ts    WS client, subscriptions, reconnect
  twitch/commands.ts    chat command parsing + replies
  engine/types.ts       IOU, Condition, LedgerEvent
  engine/ledger.ts      pure reducer: evaluate(state, event) → {state, effects}
  engine/store.ts       Store interface + JSON implementation
  engine/extract.ts     transcript → promises (OpenAI)
  engine/transcribe.ts  audio chunk → text (OpenAI)
  demo/fixture.ts       scripted timeline for demo mode
public/
  overlay/  panel/  ledger/  shared.css
fixtures/demo-stream.json
test/ledger.test.ts     reducer tests (node:test)
```

## 13. Open questions (decide by doing; record the decision here)
- Realtime transcription vs chunked: start chunked; move if latency is visibly bad in rehearsal.
- Should `PENDING` be the default on first run? Current default: **auto mode**, because the stamp-before-the-sentence-ends moment is the demo. Approval mode is one toggle away.
- Sound cue on stamp: yes if a royalty-free asset is available; otherwise silent.
