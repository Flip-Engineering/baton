# FOLD FOUNDRY — shared frame (multi-member contract-fold workflow, 2026-08-13)

Every member reads this first. This wave FOLDS four red-teamed contracts in parallel — one per
row. Each row's raw material is already landed in the contract's own evidence dir: the contract,
its adversarial red-team (`redteam-<issue>.md`, same dir), and the coordinator QA
(`docs/reference/evidence/review-foundry-2026-08-13/review-qa.md`) whose fold instruction set is
quoted in your row brief.

## The shared laws (bind every member)

- **The fold resolves, it does not relitigate.** Every blocker/amendment in your red-team report
  and every numbered instruction in the QA's fold instruction set gets exactly one of: FOLDED
  (the contract text changed — cite the new section), STRUCK (the QA struck it as a false alarm —
  cite), or ESCALATED (you cannot resolve it honestly — say why). No silent drops.
- **Top-orchestrator decisions are law** (quoted in your row brief where applicable).
- **Every citation you touch gets re-verified this session** (`grep -an`/`sed -n` on
  `application.mjs` + `coordination-store.mjs` — NUL discipline; plain grep elsewhere). The
  red-team's citation fixes are instructions to APPLY, with the fix re-verified before writing.
- The contract keeps its own structure and versioning convention: bump its version line
  (vN → vN+1), and append a `## Fold record` section: date, the red-team report path, the QA
  section, each blocker → FOLDED/STRUCK/ESCALATED with one line each, and the top-orchestrator
  decisions applied.
- No clocks anywhere. Sorted-key literals ACTUAL order; `localeCompare` banned.
- **Escalation posture:** authority-class ambiguity → DECISION_REQUEST with 2–4 options + free
  response. Judgment calls are yours — record them in the fold notes.
- **THE ATTEMPT-ECHO LAW (#171):** your objective opens with an `[attempt: <salt> <role>]` line.
  Your fold-notes file MUST carry that line VERBATIM in its header — the wave's harvest refuses
  to attribute content without it.

## Deliverables

1. The folded contract, IN PLACE at its current path (version bumped, fold record appended).
2. `fold-<issue>.md` in the same dir — the blocker→resolution map (the harvest artifact).
