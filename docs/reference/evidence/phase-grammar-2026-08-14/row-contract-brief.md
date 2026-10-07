# ROW BRIEF — row-contract: the phase-level campaign grammar contract

You are the contract row for the campaign-as-DSL rung (the operator's north-star directive).
Today the #170 DSL expresses ONE wave per spec. The contract you write specifies the PHASE
level: an entire methodology pipeline (ground → spec → red-team → suite → blue-team →
remediate → impl → validate → return-to-orchestrator) as ONE dynamic workflow script.

**Read first:** the operator's requirement text + the nine subtasks, recorded at
`docs/reference/evidence/workflow-dsl-2026-08-13/` (the #170 closure comment's north-star
section — fetch it via the issue if `gh` works, else the campaign's commit messages reference
it); the current grammar + interpreter: `impl/src/workflow-dsl.mjs` (the compiler) and
`impl/src/workflow-interpreter.mjs` (the drive loop) — NUL discipline on application.mjs /
coordination-store.mjs (`grep -an`/`sed -n` only).

**The contract must decide (Ring-2 form: ground truths → decisions → closed refusal vocabulary
→ red-first acceptance pins → open questions):**
1. **Phase syntax** in the line grammar (a `phase <name>` block holding member directives;
   per-phase rosters; members re-cast across phases).
2. **Phase outcomes as first-class values** — a declared extraction from a phase's harvest
   (e.g. `outcome <name> from <harvested-file> line <pattern>`), never a prose read.
3. **Conditional gating** — `phase fold { when: <expr over prior outcomes> }`; the predicate
   vocabulary is CLOSED (equality/negation over named outcomes; no eval).
4. **Orchestrator checkpoints** as a phase kind (park the campaign, deliver the decision
   packet upward, resume on answer — riding the existing decision/attention machinery).
5. **Context couplings** per phase per member: loose (file refs) / shared (partition —
   note the #158 precondition honestly) / tight (cell — #102 precondition).
6. **Mid-flight amendment** (a running campaign's later phases editable without re-driving
   settled ones) and the **brittleness guard** (phases are templates; checkpoints carry
   judgment).
7. The refusal vocabulary (closed `workflow_*` extensions) and the acceptance pins (RED at
   HEAD at named stages; green only for a correct impl — including a two-phase end-to-end pin:
   phase B's member starts only after phase A's outcome satisfies its `when:`).

**Deliverable:** `docs/reference/evidence/phase-grammar-2026-08-14/phase-grammar-contract.md`
ONLY (plus the shared publish — or the recorded refusal). Your `[attempt: <salt> <role>]`
line VERBATIM in the first five lines. Judgment calls recorded; authority-class ambiguity →
DECISION_REQUEST with options.
