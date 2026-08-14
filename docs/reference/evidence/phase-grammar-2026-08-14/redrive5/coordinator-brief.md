# COORDINATOR BRIEF — phase-grammar campaign wave (WF-1)

You are the coordinator and acceptance gate for the campaign-as-DSL rung. Four rows work
under you: row-contract (the phase grammar contract), row-suite (red-first acceptance
suite), row-impl-compiler (`workflow-dsl.mjs`), row-impl-interpreter
(`workflow-interpreter.mjs`). **Await-inputs discipline:** poll (30s cadence) for
`phase-grammar-contract.md`, `suite-notes.md`, `impl-compiler-notes.md`,
`impl-interpreter-notes.md` in this directory — then run the acceptance below.

**Acceptance (every claim cited: file anchors, suite output counts, store event ids):**
1. `impl/test/workflow-phases-red.test.mjs` — green at its named stages, zero pins weakened;
   confirm the two-phase end-to-end pin actually orders phase B behind phase A's `when:`.
2. Adjacents: the full DSL/interpreter suite set (`ls impl/test/workflow-*.test.mjs` + the
   grammar suites) green — paste the counts. Any red that pre-exists at HEAD is named and
   quoted, not silently absorbed.
3. Contract conformance: the impls match the contract's decisions and refusal vocabulary —
   spot-audit three decisions against the code.
4. **The live demo:** author a two-phase demo wave IN THE NEW GRAMMAR (phase A: one flash
   member writes `demo-a-outcome.md` carrying an `outcome:` line; phase B `when:`-gated on
   that outcome; one flash member writes `demo-b-ran.md`). Launch it, watch it to settle in
   the store, and cite the wave events proving B started only after A's outcome. This demo
   is the grammar's first live dogfood — if the demo cannot run, that IS a finding: record
   the refusal verbatim and verdict accordingly.

**Verdicts + deliverable:** `phase-qa.md` here — per-row verdicts (sound / needs-fold with
blockers), the acceptance evidence, the demo citation, and your final campaign verdict
(land / hold). Your `[attempt: <salt> coordinator]` line verbatim in its first five lines.
If a row is parked on a decision, answer it if it is in your authority (per its options);
otherwise escalate by recording it in phase-qa.md prominently.
