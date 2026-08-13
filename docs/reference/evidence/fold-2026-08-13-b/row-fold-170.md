# ROW BRIEF — row-fold170: fold the #170 workflow-DSL contract (HIGH — gates the next serialized impl)

Read `docs/reference/evidence/fold-2026-08-13-b/foundry-brief.md` first — it binds you, INCLUDING
the blind-QA law (row report governs on conflict). Your material:

- Contract: `docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` (FULL read)
- Red-team: `docs/reference/evidence/workflow-dsl-2026-08-13/redteam-170.md` — **4 blockers + A2-A6 + N1-N5, all binding**:
  - B1: stale `workflow.json:12,25,38,51,64` citation → re-verify/re-cite or cite semantically.
  - B2: Appendix A does not lower to the `workflow.json` object (4 byte-mismatch classes) →
    regenerate Appendix A from the actual JSON bytes AND pin the expected IR as an immutable
    committed fixture, not a live doc.
  - B3: the round-trip law is self-contradictory (pure-function compiler vs repoRoot realpath
    containment) → pick one: compiler does realpath containment when repoRoot is provided (the
    round-trip pin always passes it) with the "pure function" claim scoped, OR weaken the promise
    to lexical admission-time rules. Record the choice.
  - B4: the `{line, field, expected}` triple cannot ride the wire as specified (D2 never sets
    `detail`; MCP LANE_CRAFTED forwards only `cause?.detail`, `mcp-northbound.mjs:1651-1654`) →
    D2 sets `detail: { line, field, expected }` on the throw; P9/§3 pin the wire shape.
  - Amendments A2 (scope accumulation rule), A3 (R1's expected vocabulary), A4 (S1 grep too
    narrow — readFile/openSync/realpathSync), A5 (closure proof + S4 negative pin: directive
    vocabulary DISJOINT from baton-attached dispatch fields — cite interpreter randomUUID at
    workflow-interpreter.mjs:506 etc.), A6 (resolve OQ2/B3 in-contract).
  - Notes N1-N5 (P10 sequences after #160 R3; render-surface-docs path; waves.compile registry
    row + waves.run `web`-addition sequencing; shared-publish not performable; **name the DSL's
    own suite file** — G6's borrowed shape is not a home).
- QA: `docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md` §1 — the §1.4 set:
  H1 (Appendix A byte-identity precondition — subsumes row B2), H2 (compiler≡interpreter
  constants source-scan pin or shared module; name the OQ2 duplication risk), H3 (one-line
  residual: `signalOnMembersDone` roles / `answerDecisions` keys are not cross-validated — a DSL
  typo there is a silent no-op), ship the sound remainder + fix the OQ6 `waves.run` registry
  surface set (add `web`) without a ghost row.

**TOP-ORCHESTRATOR DECISION (law):** DR-2 (OQ1, the `waves.compile` seam home): **option (a)** —
a new direct-port command beside `waves.run` (application.mjs:12560-12573 seam family) PLUS a new
read-only MCP tool `baton_waves_compile`. One seam, one authorization story, all four surfaces.

Deliverables per the shared frame: the folded contract in place +
`docs/reference/evidence/workflow-dsl-2026-08-13/fold-170.md` (attempt line in the FIRST FIVE
lines).
