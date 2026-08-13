# Issue #154 — the harvest mustContain verdict bug: fix notes

- **Root cause (one sentence):** `harvestOne` wrote the named `code` on the MISS paths only, so a
  mustContain matching the file's first line receipted `matched: true` with NO `harvest_ok` — the
  pass read as a coded miss to any consumer keying off the receipt code (the #147 dogfood's
  `matched:false`/`harvest_miss`/WAVE-INCOMPLETE symptom).
- **Fix:** `impl/src/workflow-interpreter.mjs` `harvestOne` — the two PASS-path returns now carry
  `code: 'harvest_ok'`, symmetric with the miss paths' `harvest_miss` (the miss code is never
  written for a match). Retrieval, the steering lanes, and the D6 receipt shape are untouched.
- **Red row:** `impl/test/workflow-as-data-red.test.mjs` W4-05 (stage
  `harvest-match-evaluation-missing`) — a wave whose harvest declares `mustContain` matching the
  file's first line asserts `matched: true / code: harvest_ok / WAVE-OK`; confirmed failing at HEAD.
- **Green proof:** W4-05 passes; the full suite is 30/30 (26 red + 4 green guards); the adjacents
  `wave-observability-red` and `worker-orchestrated-swarm-red` stay green.
