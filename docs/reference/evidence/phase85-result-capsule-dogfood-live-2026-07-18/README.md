# Phase 85 provider-result capsule dogfood

This evidence runner uses Baton's concise `openBaton().workflow()` surface to dispatch the same red
provider-result capsule contract to two exact Codex routes in parallel:

- `codex` / `gpt-5.6-sol` / `high` as the bounded implementation route;
- `codex` / `gpt-5.6-sol` / `xhigh` as the adversarial implementation/review route.

The runner supplies no caller-managed token, dollar, wall-time, export-file, or export-byte budgets.
It retains every Candidate patch, records route and attempt evidence, then invokes Baton's unified
Run stop and requires every observed process to be closed with zero remaining worker ownership.

Run from the repository root with:

```sh
rtk proxy node docs/reference/evidence/phase85-result-capsule-dogfood-live-2026-07-18/run.mjs
```
