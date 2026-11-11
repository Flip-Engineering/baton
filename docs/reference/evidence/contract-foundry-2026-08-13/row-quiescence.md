# ROW BRIEF — row-quiescence: contract for issue #163 (de-clock the wave completion)

Read `foundry-brief.md` first (the shared frame binds you). Your contract:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md`.

## The problem (verify, then contract)

The interpreter's drive loop bounds waves by wall clock (`hardCapMs`; the shipped production
cadence supplies 3h after the #153 repair). The campaign control law bans clocks as
controls. Read: `impl/src/workflow-interpreter.mjs` (the drive loop, `DEFAULT_DRIVER`,
`normalizeDriver`, the early-break on stuck decisions), `impl/src/application.mjs`
(PRODUCTION_WORKFLOW_DRIVER), and the #67 in-flight-gate pattern (the evidence-derived
liveness machinery to mirror — `REARM_KINDS`, `meaningfulEventAt`).

## Your contract must answer

- **D1 — the quiescence bound.** The wave ends when the full roster produces no meaningful
  events across a declared evidence window (derive the window from the roster's own event
  cadence, never a bare constant) OR a member terminalizes unrecoverably. Pin the exact
  quiescence predicate (which event kinds reset it — the `meaningfulEventAt` semantics) and
  the honest verdict shape a quiesced wave returns (NOT WAVE-INCOMPLETE-by-clock — a named
  quiescence verdict with per-member last-meaningful-event evidence).
- **D2 — the migration.** How the shipped cadence changes (what `PRODUCTION_WORKFLOW_DRIVER`
  becomes), what stays a suite-only backstop, and the suite impact (the interpreter's own
  suite runs on the fast pinned policy — it must not slow).
- **D3 — the honesty edge cases.** A roster that goes quiet mid-harvest; a member that
  re-wakes after quiescence was declared (can it? decide and pin); the stuck-decision
  early-break's place in the new law.
- Refusal vocabulary + red-first acceptance pins + open questions, per the frame.
