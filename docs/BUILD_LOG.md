# Build log

Short, dated notes on what was built where. The hackathon submission needs the Codex session ID of the main build thread; record it here.

| Date (IST) | Where | What |
|---|---|---|
| 2026-11-01 | Devin (planning) | Idea selection, competitor scan, SPEC.md, AGENTS.md, scaffold |
| 2026-11-02 | Codex thread `01a19bb2-bbac-7c91-8817-b6709c1a0823` | Took over the first cut; installed locked dependencies; audited live readiness; fixed demo/hybrid isolation from ambient OpenAI keys, serialized persistence, broadcaster OAuth ownership, refresh coalescing, repeated online events, EventSub socket lifecycle/deduplication and connection reporting; added regression tests. Registered Ledger Receipts after owner completed 2FA. Real broadcaster OAuth, 7/7 subscriptions, chat commands, due pinning, cleanup and restart passed. Added DeepSeek extraction with no new dependencies; 12/12 bounded paid cases passed (8,970 input / 531 output tokens, peak upper estimate $0.0033282). Free suite now has 18 tests. Live clips, real follow and microphone latency pending. |
