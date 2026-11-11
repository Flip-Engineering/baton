# ROW BRIEF — row-impl-interpreter: the phase driver in the workflow interpreter

You are the interpreter-impl row for the campaign-as-DSL rung. **Await-inputs discipline:**
poll (30s cadence) for BOTH `phase-grammar-contract.md` AND `suite-notes.md` in this
directory; read both IN FULL before writing code. The suite
`impl/test/workflow-phases-red.test.mjs` must go green at its named interpreter/driver stages
by your hand — and ONLY because the driver is correct.

**Your file partition (the trust gate kills out-of-scope writes):**
`impl/src/workflow-interpreter.mjs` ONLY, plus
`docs/reference/evidence/phase-grammar-2026-08-14/redrive2/**`. row-impl-compiler owns
`impl/src/workflow-dsl.mjs` — never touch it. If the contract forces a shared-file change,
STOP and DECISION_REQUEST with options instead.

**Read first:** the contract + suite; `impl/src/workflow-interpreter.mjs` in full (the drive
loop, harvest verdicts, steering lanes, idempotency-key identity at `:525`'s base-commit
machinery — #168 notes). Match its idioms.

**Implement:** the contract's phase semantics — phase sequencing (a phase's members admit
only when its `when:` over prior outcomes evaluates true), outcome extraction at phase
settle (from the phase's harvest per the declared `outcome` line), checkpoint phases (park
the campaign: emit the decision packet through the EXISTING decision/attention machinery,
resume on answer), per-phase roster casting (a member role re-cast across phases is a new
admission carrying the declared coupling), and mid-flight amendment (an amended later phase
recompiles and drives WITHOUT re-driving settled phases — settled outcomes are read from the
ledger, never recomputed). Quiescence-derived settle only: NO new wall-clock caps (#163 law
— evidence gates, not clocks).

**Acceptance:** the new suite's interpreter stages green incl. the two-phase end-to-end pin;
ALL existing interpreter/workflow suites stay green (run them, paste counts).

Deliverable note: `docs/reference/evidence/phase-grammar-2026-08-14/redrive2/impl-interpreter-notes.md`
— decisions, anchors, suite counts, judgment calls. `[attempt: <salt> row-impl-interpreter]`
verbatim in its first five lines.
