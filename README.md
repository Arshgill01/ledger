# Ledger

**Chat keeps the receipts.**

Ledger listens to a Twitch stream, logs every promise the streamer makes ("if we hit 50 subs I'll eat the ghost pepper"), tracks the condition through Twitch EventSub, and calls in the debt when it comes due: pinned chat message, a clip as the receipt, and a `!paid` / `!cap` vote. Debts carry over to the next stream.

Built for the Codex x TwitchCon Hackathon 2026 with OpenAI Codex. See `SPEC.md` for the full spec and `AGENTS.md` for working rules.

## Try it in 60 seconds (no keys)

```sh
npm install
npm run demo
```

Open http://localhost:3000. Demo mode plays a synthetic stream: scripted transcript lines, fake chat, a fake follow goal and raid. Every surface shows a DEMO badge. Nothing connects to Twitch or OpenAI.

- Overlay (OBS browser source): http://localhost:3000/overlay
- Streamer panel: http://localhost:3000/panel
- Public ledger: http://localhost:3000/ledger

## Live mode

1. Register an app at https://dev.twitch.tv/console/apps with redirect `http://localhost:3000/auth/callback`.
2. `cp .env.example .env` and fill `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_CHANNEL`, `OPENAI_API_KEY`.
3. `npm run dev`, open http://localhost:3000/panel, click **Connect Twitch**, then **Start mic**.
4. Add http://localhost:3000/overlay as a browser source in OBS (1920x1080, transparent).

## Status

Scaffold. See `docs/BUILD_LOG.md`.
