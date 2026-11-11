# ROW BRIEF — row-suite: red-first acceptance suite for the phase-level grammar

You are the suite row for the campaign-as-DSL rung. row-contract is writing
`phase-grammar-contract.md` in this directory. **Await-inputs discipline:** poll for that
file's existence (`test -f`, 30s cadence, no clock-capped give-up — quiescence is the
contract's absence, not elapsed time); when it appears, read it IN FULL and write the
red-first suite it names.

**Read first:** the contract (when landed); the existing DSL suites for harness-fake and
named-stage conventions — `impl/test/workflow-surface-red.test.mjs` and the workflow-as-data
suites (`ls impl/test/workflow-*.test.mjs`); the compiler `impl/src/workflow-dsl.mjs` and
interpreter `impl/src/workflow-interpreter.mjs` (NUL discipline on application.mjs /
coordination-store.mjs: `grep -an`/`sed -n` only).

**Deliverables:**
1. `impl/test/workflow-phases-red.test.mjs` — RED at HEAD, every pin at a named stage, hermetic
   (suite law: no clocks, no absolute line-window anchors, sorted-key literals in ACTUAL order,
   `localeCompare` banned, `watchdog.stallMs: 60_000` with its comment, namespace imports for
   invented surfaces). Must include the contract's acceptance set, at minimum:
   - phase syntax compiles (per-phase rosters, members re-cast across phases);
   - `outcome` extraction is declarative (from a harvested file + line pattern, never prose);
   - `when:` gating — the closed predicate vocabulary (equality/negation over named outcomes);
     unknown predicates refuse with the contract's closed code;
   - the two-phase end-to-end pin: phase B's member starts ONLY after phase A's outcome
     satisfies its `when:` (drive the interpreter with marker members);
   - an orchestrator-checkpoint phase parks the campaign and surfaces the decision packet;
   - mid-flight amendment: a later phase edited without re-driving settled phases.
2. `docs/reference/evidence/phase-grammar-2026-08-14/redrive3/suite-notes.md` — pin map (stage → row →
   contract section), your RED-verification output, and every judgment call recorded.

Your `[attempt: <salt> row-suite]` line VERBATIM in the first five lines of BOTH deliverables.
Do not edit any existing suite. Authority-class ambiguity → DECISION_REQUEST with options.
