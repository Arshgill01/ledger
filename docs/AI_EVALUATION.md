# DeepSeek extraction evaluation — Nov 2, 2026

Reported from the real provider run in the local Codex build thread. This is a text-extraction qualification, not microphone, Twitch, broad-accuracy, or stability evidence.

- Model: `deepseek-flash`, `https://api.deepseek.com/responses`, Responses JSON schema, temperature 0.1, thinking disabled, max output 1,024 tokens, no retries.
- Contract: 12 fixed cases, one repetition, at most 12 calls and $0.25. Exact-payload preflight → three smoke cases → targeted negatives → remaining labeled cases; stop at first failure. Manifest validator passed before paid execution.
- Metrics: exact promise count, condition kind/metric/target, positive confidence ≥0.7, expected stake text and a quote verbatim in the input. Every case passed.
- Usage: 12 provider requests, zero local-cache calls, 8,970 input / 531 output tokens. Peak cache-miss upper estimate **$0.0033282**; actual charge may be lower due to provider caching/off-peak rates. This is an estimate, not a wallet receipt.
- Rates used: $0.30/M input and $1.20/M output from [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).
- Raw manifest, requests, responses, predictions, timing and source snapshots remain local in gitignored `data/evals/deepseek-20261102-01/`. Cloud agents cannot inspect these files from git; this document is the published summary.
- Committed cases: `fixtures/extraction-eval.json`. Reproduction runner: `scripts/eval-extraction.mjs`; see README for explicit paid commands. Do not run paid evaluation as part of `npm test`.

## Provenance

The run used base commit `2fc46ef01d9b12ac6488295043e68ae66256a295` with uncommitted provider changes. SHA-256 hashes below identify the executed source; do not claim the run executed the later rebased commit. The runner's unused config import was subsequently simplified without changing payloads. The extractor/prompt/schema were unchanged after the run.

- `src/config.ts`: `00775adb3175af43a61794650cf0d7e6b74384a298b756494ef32d84325d110d`
- `src/engine/extract.ts`: `c27c58e03018b9ce8330bb29e3f949c0a5338e3afa504ccfd2b1979ade5fd6f0`
- `scripts/eval-extraction.mjs`: `f53984fb6de5063ec52a8d027b810c8fa5d12608f0be90e5d4cf8ac1f821ac32`
- `fixtures/extraction-eval.json`: `6a3bd0f961a74ed6478de85e2d888d4f3544295c1b90948e40411d4a95d5f466`
- System prompt: `bb4c1c85f89891d93fe688ae4f18b64bb38c538310fb73710d5622f6694d626d`
- Schema: `64364a7c83b8e8a1a257b91efedce4570350f868d18ed0675e9e7f295dd5c766`

## Results

| Case | Stage | Result | Latency ms |
|---|---|---|---|
| fixture-follows | preflight | PASS | 3175 |
| read-chat | smoke | PASS | 1161 |
| duplicate | smoke | PASS | 1136 |
| event | smoke | PASS | 1000 |
| sarcasm | targeted | PASS | 2128 |
| hypothetical | targeted | PASS | 1234 |
| question | targeted | PASS | 911 |
| injection | targeted | PASS | 925 |
| fixture-song | labeled | PASS | 1234 |
| subs | labeled | PASS | 1415 |
| bits | labeled | PASS | 1473 |
| time | labeled | PASS | 1314 |

No OpenAI paid extraction/transcription calls were made in this run. The next semantic prompt/schema/model change needs requalification; these results do not automatically qualify a changed pipeline.
