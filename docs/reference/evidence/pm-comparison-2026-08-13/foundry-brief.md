# PM-COMPARISON FOUNDRY — shared frame (2026-08-13)

Every member reads this first. This wave answers one question for the baton campaign: **what
does project-manager (the operator's prior R&D-management system) know that baton should — and
what must baton refuse to learn from it?** The ground-truth package is
`docs/reference/evidence/pm-comparison-2026-08-13/pm-digest/` (its README orients you; the `.rs`
files are authoritative, the prose docs are stale-risk).

## The shared laws (bind every member)

- **Cite both sides.** Every proposal names the pm mechanism (digest file + symbol/section) AND
  the baton target (issue number, `impl/src` module, or evidence dir) it would change. A
  proposal with no baton landing-zone is decoration — mark it OUT-OF-SCOPE yourself.
- **Verdict per candidate:** ADOPT (strong fit, named landing zone, sized honestly) / ADAPT (the
  idea is right, the shape must change — say the shape) / REJECT (wrong for baton — one line why)
  / ALREADY-HAVE (name the landed equivalent).
- **Baton's standing vetoes (the red-team row expands these):** no wall-clock controls anywhere
  (evidence/event-derived gates only — pm is FULL of time-based machinery; every one of those is
  an automatic ADAPT-or-REJECT, never ADOPT-as-is) · honesty over comfort (a surface that can
  lie is worse than none) · machine channels stay sterile · additive-only on closed
  vocabularies · no per-worker heaviness (hub-managed shared machinery only) · the methodology
  chain governs impl (a proposal lands via contract, not via enthusiasm).
- **THE ATTEMPT-ECHO LAW (#171):** your `[attempt: <salt> <role>]` line VERBATIM in your
  report's first five lines.
- Judgment calls are yours — record them. Authority-class ambiguity → DECISION_REQUEST with
  options.
- Publish your report to the `shared` scratchpad partition as well as your file — if the
  publish fails, record the exact refusal (that is still campaign evidence, #158).

## Row assignments

- `row-pm-kg` → knowledge structures → `pm-kg.md`
- `row-pm-dag` → execution/planning structures → `pm-dag.md`
- `row-pm-agent` → agent-integration/ambient structures → `pm-agent.md`
- `row-pm-redteam` → the scope-creep red-team → `pm-redteam.md`
- `coordinator` → merge + apply the rubric → `pm-qa.md`
