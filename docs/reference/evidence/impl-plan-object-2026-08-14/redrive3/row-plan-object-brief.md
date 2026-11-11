# ROW BRIEF — row-plan-object (wave-b, the SURFACE leg): the orchestrator plan object (#161)

Wave-a LANDED the store-fold leg (verified sound: F1–F3 + pins green; `impl/src/orchestrator-plan.mjs`
+ the coordination-store folds are on master). The suite
`impl/test/orchestrator-plan-object-red.test.mjs` is **8/47** — the 39 remaining RED rows are the
SURFACE leg, your work: the plan.read / plan.write command ports in application.mjs, the CLI
verbs, the MCP tools, the web refusal + divergence ledger, the registry rows, and the generated
docs (CLI.md/MCP.md) — exactly the rows the suite names. Read the suite in full first; read
wave-a's `notes-row-plan-object.md` + `verify-notes.md` in this dir for the landed substrate
(the five plan.* event kinds, the fold, the batch registration) your surface serves.

**Your file partition:** `impl/src/application.mjs` (additive hunks), `impl/src/application-cli.mjs`,
`impl/src/mcp-northbound.mjs`, `impl/src/web-northbound.mjs`, `impl/CLI.md`, `impl/MCP.md`, and
`docs/reference/evidence/impl-plan-object-2026-08-14/**`. NUL discipline on application.mjs
(`grep -an`/`sed -n`, latin1-aware tooling; the 3 NUL bytes on the cacheKey line must survive —
count them before and after). Never edit the acceptance suite. Do not reopen the landed store
fold unless a suite pin forces it (DECISION_REQUEST first).

**Acceptance:** the suite green at every named stage (47/47 incl. wave-a's 8); adjacents
green-unchanged: `orchestrator-wake-red`, `cross-deployment-knowledge-red`, `kg-activation-red`
(paste counts — RED-at-HEAD rows stay RED-by-design and you NAME them). Notes:
`docs/reference/evidence/impl-plan-object-2026-08-14/redrive1/notes-row-plan-object.md` —
`[attempt: <salt> row-plan-object]` verbatim in its first five lines. DECISION_REQUEST on
authority-class ambiguity.
