# ROW BRIEF — row-plan-object: the orchestrator plan object as a first-class citizen (#161)

The suite is your contract: `impl/test/orchestrator-plan-object-red.test.mjs` — RED at HEAD
at named stages. Read it in full first. Origin: the orchestrator's own campaign plan state
currently lives OUTSIDE baton (in the harness tracker) — the most important task structure
in the system isn't a baton citizen. The contract (fold v2.0, on the issue) makes it one:
durable, worker-queryable, steerable by the orchestrator.

**Your file partition:** `impl/src/coordination-store.mjs` (the plan-object kinds/folds if
the suite names them) + any NEW module the suite names +
`docs/reference/evidence/impl-plan-object-2026-08-14/**`. application.mjs seam edits ONLY if
the suite's pins force them and ONLY additive (another wave owns an application.mjs leg this
window — keep hunks disjoint; if the suite forces a shared region, DECISION_REQUEST).
NUL discipline on coordination-store.mjs (`grep -an`/`sed -n` only, never disturb NUL bytes).
Never edit the acceptance suite.

**Acceptance:** the suite green at every named stage; adjacents green-unchanged:
`orchestrator-wake-red`, `cross-deployment-knowledge-red`, `kg-activation-red` (paste counts —
any of these RED at HEAD stays RED-by-design and you NAME it, not absorb it). Notes:
`docs/reference/evidence/impl-plan-object-2026-08-14/notes-row-plan-object.md` —
`[attempt: <salt> row-plan-object]` verbatim in its first five lines. DECISION_REQUEST on
authority-class ambiguity.
