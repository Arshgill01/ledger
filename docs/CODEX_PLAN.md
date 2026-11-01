# Codex build plan

The hackathon judges "how well it uses Codex" and requires the session ID of the Codex thread where most of the build happened. Devin produced the first cut on Nov 1 (planning, spec, scaffold, first implementation). The plan below is how to make the Codex thread the real home of the build, with footage for the video.

## Kickoff prompt (paste into a fresh Codex thread, in the repo)

> Read SPEC.md and AGENTS.md. This repo is a Codex x TwitchCon hackathon entry called Ledger. Audit the current implementation against SPEC.md §4–§8 and list the gaps. Then, slice by slice, implement and verify: (1) run `npm run demo`, exercise the overlay/panel/ledger pages and fix any rough edges you find; (2) harden the Twitch layer in `src/twitch/` (EventSub reconnect, token refresh, `pin` on Send Chat Message, clip polling) and add tests where the engine is involved; (3) improve the promise extractor prompt in `src/engine/extract.ts` against the transcript lines in `fixtures/demo-stream.json` plus ten new tricky lines you write (sarcasm, reading chat aloud, duplicates); (4) upgrade the overlay stamp moment per SPEC.md §6.1; (5) update README with real screenshots. Keep `npm run typecheck && npm test` green and keep demo mode keyless. Record each decision that changes a default in SPEC.md.

## Things to show on camera (15–20 s in the video)

- Codex reading SPEC.md and proposing the slice plan.
- Codex editing `src/twitch/eventsub.ts` or `src/engine/ledger.ts` and running `npm test`.
- `/status` output with the session ID visible.

## Suggested order for the remaining hours

1. Live-mode smoke test on the real channel (OAuth, chat reply to `!owed`, a typed promise, a real follow moving the bar, `!due` → pinned message + clip).
2. Mic path with a real OpenAI key: latency check; switch to Realtime transcription only if chunked is visibly slow.
3. Overlay polish (sound cue, receipt flip animation).
4. Record the demo (OBS: game/scene + overlay + Twitch chat popout + panel), then the Codex segment.
5. README screenshots, BUILD_LOG, submit with 3+ hours of buffer for YouTube processing.
