# #79 IMPL BRIEF — implement the worker delivery push (attention + verdicts down the worker's own channel)

Implement the #79 epic: make `impl/test/worker-delivery-push-red.test.mjs` green with ZERO
weakening edits — 32 rows: **11 PINs stay green, 21 RED rows go green at their named stages**.
Read fully, in order: (1) `worker-delivery-push-contract.md` (the folded contract — D1 the
`## Pending attention` brief section, D2 the shape-only ITEM COUNT bound + digest-cited spill,
D3 identity-addressed qualification, D4 durable replay-derived delivered-then-read receipts,
D5 idempotent dedup by durable item id, D6 the TG4 verdict push of the ALREADY-sanitized
`{gate, detail}`); (2) `contract-fold.md` + `suite-fold-2.md` (the folded oracles); (3)
`impl/test/worker-delivery-push-red.test.mjs` (the header carries the row inventory + invented
signatures).

## Carried scope (from the AX triage, #111-F3)

The corrective nudge must coach: a worker refused for analysis-only output currently gets the
literal `Continue the current turn.` (`wave-driver.mjs:37`) with no reason. Fold in the
sanitized `{liveness counts, reason: no in-scope diff}` coaching shape per the triage comment
on this issue (TG4's sanitized `{gate, detail}` discipline applies — never raw gate
internals).

## Laws + verify

Campaign law: no clocks as controls; scanners shape-only; `localeCompare` banned; sorted-key
literals ACTUAL order; NUL discipline (`grep -an`/`sed -n` on `application.mjs` +
`coordination-store.mjs`); byte literals ONLY in `limits.mjs`. **#141 boundary-commit law:
commit at natural subsystem boundaries.** Error payloads ride ONLY lane-crafted codes.
Verify: `node --test impl/test/worker-delivery-push-red.test.mjs` from the repo root until
32/32, then the adjacents (`briefing-pack-red`, `orchestrator-wake-red`, `issue10-waiting-vocabulary-red`,
`worker-orchestrated-swarm-red`). Deliverables: the impl/src edits + your boundary commits;
record your split in
`docs/reference/evidence/worker-delivery-push-2026-08-07/impl-79-notes.md`.
