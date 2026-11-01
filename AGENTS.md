# AGENTS.md — how to work in this repo

For any coding agent (Codex, Claude, Devin, Cursor, etc.) and any human. Read `SPEC.md` first; it is the source of truth for the product. This file is about working style and a small set of hard rules.

## Hard rules (do not break)

1. **Hackathon integrity.** This repo is a Codex x TwitchCon Hackathon entry. Everything here was created during the submission period. Do not import code written before Oct 23, 2026 except standard libraries and npm packages.
2. **No secrets in git.** Keys live in `.env` (gitignored). `.env.example` lists every variable with a comment. Never log tokens; the Helix wrapper redacts `Authorization` headers.
3. **`npm run demo` must always work from a fresh clone with no keys.** If a change breaks demo mode, it is not done. Demo mode is clearly labelled as synthetic on every surface; never present fixture data as live.
4. **The engine stays pure.** `src/engine/ledger.ts` is a reducer: `(state, event) → { state, effects }`. No I/O, no timers, no Twitch or OpenAI calls inside it. Side effects are executed by the runtime from the returned `effects`. Tests in `test/` cover the reducer.
5. **Respect Twitch's rules.** Use documented Helix/EventSub only, honour rate limits, no scraping, no undocumented endpoints. The user token belongs to the broadcaster who ran the OAuth flow; never store or act on tokens for anyone else.
6. **Keep `SPEC.md` true.** If you change a default (model, transport, layout, persistence), edit the spec in the same commit. Hard commitments in the spec (`[HARD]`) need a conversation before changing.
7. **Record the Codex session.** Substantial code changes happen in the main Codex thread whose session ID is submitted. If you work in another tool, keep the change small or make sure it's reproduced/reviewed in that thread. Note the thread in `docs/BUILD_LOG.md`.

## Defaults, not rules (improve freely)

These are the current choices. Change them if you have a better one; just keep the hard rules and update the spec.

- Node 22+, TypeScript (strict), ESM, `tsx` to run, no build step. Minimal dependencies: `ws`, `openai`. Add a dependency when it clearly saves time or risk; avoid frameworks for the frontend.
- Plain HTML/CSS/JS in `public/`. A single `shared.css`. No bundler.
- JSON file persistence via the `Store` interface. SQLite is welcome if you want it.
- Chunked `MediaRecorder` → `audio.transcriptions` for speech. Realtime WS is a welcome upgrade.
- `gpt-4.1-mini` for extraction with JSON schema output. Any model that is faster/cheaper and passes the fixture transcript is fine.
- Tests use `node:test` (`npm test`). Add tests for engine behaviour you change; UI tests are optional.
- Commit messages: short imperative subject, body explains *why* when non-obvious. Branches: `feat/<thing>`, `fix/<thing>`; direct commits to `main` are fine for a two-day hackathon as long as `npm run typecheck && npm test` pass.

## Working style

- Prefer small, complete vertical slices (event → engine → overlay) over broad scaffolding.
- Before adding a feature, check the demo video plan in `SPEC.md §11`. If it isn't on screen in the video and isn't a hard rule, it can wait.
- When you hit an undocumented Twitch behaviour, write what you observed in `docs/TWITCH_NOTES.md` so the next agent doesn't rediscover it.
- Leave `// TODO(name): why` only with a reason. No commented-out code.
- It is a hackathon: ship, then polish. But don't ship something that lies to the viewer (fake progress, fake clips) in live mode.

## Quick commands

```sh
npm install
npm run demo        # zero-key synthetic stream at http://localhost:3000
npm run dev         # live mode, needs .env
npm run typecheck
npm test
```

## Where things are

See `SPEC.md §12`. Entry point `src/index.ts`. Overlay `public/overlay/`. Fixture `fixtures/demo-stream.json`.
