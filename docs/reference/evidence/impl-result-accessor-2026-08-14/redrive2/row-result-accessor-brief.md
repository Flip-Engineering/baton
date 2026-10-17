# ROW BRIEF — row-result-accessor: the run.result() materialization surface (#99+#179)

The suite is your contract: `impl/test/harvest-accessor-red.test.mjs` — RED at HEAD at named
stages. Read it in full first. Origin evidence (operator-level pain): a run's result section
came back empty while the pin existed in refs/baton/results — the orchestrator was probing
pins with `git cat-file`. A `run.result()`-class accessor returning the preserved SHA (and
its materialization state) closes that probe-by-hand class.

**Your file partition:** `impl/src/application.mjs` (ADDITIVE ONLY — the accessor seam;
another wave owns a different application.mjs leg this window — keep hunks disjoint, new
methods over edits) + the northbound/CLI surfaces ONLY if the suite's pins name them (cite
the stage) + `docs/reference/evidence/impl-result-accessor-2026-08-14/**`. Never touch
workflow-*.mjs / application-cli.mjs (owned elsewhere). Never edit the acceptance suite.

**Acceptance:** the suite green at every named stage; adjacents green-unchanged:
`wave-observability-red` 30/30, `waves-list-scaling-red` (WLS-1 may be RED-by-design — name
it, don't absorb), `event-log-read-scaling-red` 2/2 (paste counts). Notes:
`docs/reference/evidence/impl-result-accessor-2026-08-14/notes-row-result-accessor.md` —
`[attempt: <salt> row-result-accessor]` verbatim in its first five lines. DECISION_REQUEST
on authority-class ambiguity.
