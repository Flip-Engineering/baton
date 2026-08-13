# Issue #154 — the harvest mustContain verdict fix

- **Contract:** `workflow-as-data-contract.md` v1.2 (D4/D6) · **Suite:** `workflow-as-data-red.test.mjs` (30 rows) · **Date:** 2026-08-13.

## Root cause (one sentence)

`harvestOne`'s success path returned `{ ok: true, matched: true }` with **no `code`**, so a `mustContain` that MATCHED was receipted as an unnamed (silent) success — only the miss path carried a named evidence line (`harvest_miss`), leaving a matched harvest indistinguishable from a missing one on the wire.

## Fix

Both success returns now carry `code: 'harvest_ok'` (the named mirror of `harvest_miss`), so a matched `mustContain` receipts `matched: true, code: harvest_ok` and the wave stays `WAVE-OK`.

## Verification

`node --test impl/test/workflow-as-data-red.test.mjs` → 30/30; adjacents `wave-observability-red` + `worker-orchestrated-swarm-red` stay green.
