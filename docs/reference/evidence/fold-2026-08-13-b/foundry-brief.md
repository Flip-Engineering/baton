# FOLD FOUNDRY wave-b — shared frame (multi-member contract-fold workflow, 2026-08-13)

Every member reads this first. This wave FOLDS five red-teamed contracts in parallel — one per
row. Your raw material is landed: the contract, its red-team report (`redteam-<issue>.md` in the
SAME dir as the contract), and the wave-b coordinator QA
(`docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md`).

**CRITICAL CONTEXT — the QA was blind.** The wave-b coordinator wrote its §1–§5 verdicts WITHOUT
the row reports (the #174 member-blindness instance; it said so honestly in its §7). Where the QA
and your row report conflict, **the row report governs** (it is the deeper, code-cited pass). The
QA's fold instruction sets are still binding — they are largely disjoint from the row blockers —
but "SOUND with one amendment" from the QA never cancels a row blocker.

## The shared laws (bind every member)

- **The fold resolves, it does not relitigate.** Every blocker/amendment/note in your row report
  and every numbered instruction in the QA's fold set gets exactly one of: FOLDED (contract text
  changed — cite the new section), STRUCK (with the evidence), or ESCALATED (why). No silent drops.
- **Top-orchestrator decisions are law** (quoted in your row brief where applicable).
- **Every citation you touch gets re-verified this session** (`grep -an`/`sed -n` on
  `application.mjs` + `coordination-store.mjs` — NUL discipline; plain grep elsewhere). Both the
  red-team's fixes and the QA's are instructions to APPLY, each re-verified before writing.
- The contract keeps its own structure and versioning convention: bump its version line
  (vN → vN+1), and append a `## Fold record` section: date, the red-team report path, the QA
  section, each item → FOLDED/STRUCK/ESCALATED with one line each, top-orchestrator decisions
  applied.
- No clocks anywhere. Sorted-key literals ACTUAL order; `localeCompare` banned.
- **Escalation posture:** authority-class ambiguity → DECISION_REQUEST with 2–4 options + free
  response. Judgment calls are yours — record them in the fold notes.
- **THE ATTEMPT-ECHO LAW (#171):** your objective opens with an `[attempt: <salt> <role>]` line.
  Your fold-notes file MUST carry that line VERBATIM **in its first five lines** — the harvest
  refuses attribution without it.

## Deliverables

1. The folded contract, IN PLACE at its current path (version bumped, fold record appended).
2. `fold-<issue>.md` in the same dir — the blocker→resolution map (the harvest artifact).
