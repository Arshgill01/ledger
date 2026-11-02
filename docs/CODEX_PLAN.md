# Codex build plan

The hackathon judges "how well it uses Codex" and requires the session ID of the Codex thread where most of the build happened. Devin produced the first cut on Nov 1 (planning, spec, scaffold, first implementation). The plan below is how to make the Codex thread the real home of the build, with footage for the video.

## Kickoff prompt (paste into a fresh Codex thread, in the repo)

> Read SPEC.md, AGENTS.md and docs/HANDOFF.md first. Inspect the current code and tests, including the local Codex changes and Devin's duplicate-promise fix. First return prioritized recommendations with file paths and reproductions, distinguishing confirmed bugs, untested behavior and product choices. Then harden in small verified slices: (1) separate private mutations/transcripts from public REST/WS reads before any tunnel; (2) replace silent audio dropping with a bounded ordered queue and visible failures; (3) address reproduced state/integration defects; (4) polish the overlay/panel/public ledger against SPEC after reliability. Keep the engine pure, the demo keyless and explicitly synthetic, and tests free of paid calls. Preserve existing live evidence: OAuth/chat/pin/restart and the 12-case DeepSeek extraction run passed; real speech, follows, clips and OBS still need local verification. Do not ask for the owner's secrets in cloud. Keep an ExecPlan, update SPEC for defaults and BUILD_LOG with your actual thread ID, commit scoped changes, and return exact validation commands, branch/commit IDs and local acceptance steps. Keep the current stack unless a concrete need justifies new dependencies.


## Things to show on camera (15–20 s in the video)

- Codex reading SPEC.md and proposing the slice plan.
- Codex editing `src/twitch/eventsub.ts` or `src/engine/ledger.ts` and running `npm test`.
- `/status` output with the session ID visible.

## Work split

Cloud: follow the priority order and return contract in `docs/HANDOFF.md §§4–7`. Recommendations come first; focus implementation on verified failures rather than replacing the stack.

Local after the owner returns: pull the cloud changes, run free checks, restart with the existing gitignored credentials, then complete the remaining speech/live-clip/follow/OBS checks. Keep synthetic and real evidence distinct. See `docs/HANDOFF.md §6`; do not re-register the app or repeat 2FA.
