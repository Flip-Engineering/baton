# #79 SUITE-FOLD BRIEF — fold the blue-team findings into the worker-delivery-push suite

You are folding a blue-team report into the worker-delivery-push red-first suite. Read fully, in
order: (1) `suite-blueteam.md` (NEEDS-FOLD — 8 findings F1-F8, each with its concrete fix);
(2) `impl/test/worker-delivery-push-red.test.mjs` (your primary edit target); (3)
`worker-delivery-push-contract.md` (v1.1 — edit ONLY if a finding requires contract movement;
v1.2 note if so); (4) `suite-draft-notes.md` (update).

## Priorities (all per the report's concrete fixes)

- **F1** — add the row that ENFORCES the never-pushed-kinds law (an orchestrator-only kind
  presented for push refuses/never renders — `ORCHESTRATOR_ONLY_KINDS` must not be dead code).
- **F2** — the D2 overflow/spill ROUND TRIP row (overflow → digest-cited spill → the worker
  resolves it); if the naive fixture is green-side-blocked, re-shape the fixture per the report.
- **F3** — the dedup row must survive a driver RESTART (a second instance over the same durable
  store — an in-memory Set must FAIL).
- **F4** — the delivered-then-read receipt pinned in both cases per the report.
- **F5** — the verdict push pinned per-WORKER (run-wide scoping fails) AND an adversarial raw
  tail (home path/JWT content in the fixture) never crosses.
- **F6-F8** — the refusal-family firing row; the push-qualified answer kinds row; the A2
  renderPrompt position pin.
- Suite stays red-first: PINs green, capability rows RED at named stages. Run twice from the
  repo root, record both splits. No clocks; sorted-key literals ACTUAL order; `localeCompare`
  banned; NUL discipline; hermetic.

## Deliverables (edit ONLY these)

`impl/test/worker-delivery-push-red.test.mjs` ·
`docs/reference/evidence/worker-delivery-push-2026-08-07/suite-draft-notes.md` ·
`docs/reference/evidence/worker-delivery-push-2026-08-07/suite-fold-2.md` (finding → resolution
map, all 8) · `worker-delivery-push-contract.md` (v1.2 ONLY if required).
