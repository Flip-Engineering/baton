# ROW BRIEF — row-impl-compiler: phase directives in the DSL compiler

You are the compiler-impl row for the campaign-as-DSL rung. **Await-inputs discipline:** poll
(30s cadence) for BOTH `phase-grammar-contract.md` AND `suite-notes.md` in this directory;
read both IN FULL before writing code. The suite `impl/test/workflow-phases-red.test.mjs`
must go green at its named compiler stages by your hand — and ONLY because the compiler is
correct.

**Your file partition (the trust gate kills out-of-scope writes):**
`impl/src/workflow-dsl.mjs` ONLY, plus `docs/reference/evidence/phase-grammar-2026-08-14/**`.
row-impl-interpreter owns `impl/src/workflow-interpreter.mjs` — never touch it. If the
contract forces a shared-file change, STOP and DECISION_REQUEST with options instead.

**Read first:** the contract + suite; `impl/src/workflow-dsl.mjs` in full (the #170 grammar:
16 directives, pure compile, closed refusal vocabulary `workflow_*`). Match its idioms —
line grammar, exact-token errors, no new dependencies.

**Implement:** the contract's phase syntax — `phase <name>` blocks holding member directives,
per-phase rosters with members re-cast across phases, `outcome <name> from <file> line
<pattern>` declarations, `when:` gating with the CLOSED predicate vocabulary (parse-time
refusal of anything outside it), checkpoint phase kind, per-phase-per-member coupling
declarations (loose/shared/tight — shared/tight compile with the contract's precondition
notes, never silently dropped), and the compiled-spec shape the interpreter consumes.
Mid-flight amendment is interpreter-side; your compiler must make the spec diffable per the
contract (phase-addressed identity).

**Acceptance:** the new suite's compiler stages green; ALL existing DSL/workflow suites stay
green (`node --test impl/test/workflow-*.test.mjs` and the grammar suites — run them, paste
counts). Byte-cost: keep refusal messages inside the closed vocabulary.

Deliverable note: `docs/reference/evidence/phase-grammar-2026-08-14/impl-compiler-notes.md` —
decisions, anchors, suite counts, judgment calls. `[attempt: <salt> row-impl-compiler]`
verbatim in its first five lines.
