# DSH-COMPARISON FOUNDRY — shared frame (2026-08-13)

Every member reads this first. This wave answers one question for the baton campaign: **what
does DeepSeek Harness (dsh, the Cordis-plugin harness) know that baton should — and what must
baton refuse to learn from it?** The ground-truth package is
`docs/reference/evidence/dsh-comparison-2026-08-13/dsh-digest/` (its README orients you; the
docs are current but the project is a fast-moving developer preview).

## The shared laws (bind every member)

- **Cite both sides.** Every proposal names the dsh mechanism (digest file + section/symbol)
  AND the baton target (issue number, `impl/src` module, or evidence dir) it would change. A
  proposal with no baton landing-zone is decoration — mark it OUT-OF-SCOPE yourself.
- **Verdict per candidate:** ADOPT / ADAPT (the idea is right, the shape must change — say the
  shape) / REJECT (one line why) / ALREADY-HAVE (name the landed equivalent).
- **Baton's standing vetoes:** no wall-clock controls · honesty over comfort (a surface that
  can lie is worse than none) · machine channels stay sterile · additive-only on closed
  vocabularies · no per-worker heaviness · the methodology chain governs impl · **baton's
  multi-agent primitive is the WAVE (fenced worktrees, content-addressed pins, the
  coordination store) — dsh's primitives are single-agent-centric; every candidate must be
  evaluated for what it means across a swarm, not one agent.**
- **THE ATTEMPT-ECHO LAW (#171):** your `[attempt: <salt> <role>]` line VERBATIM in your
  report's first five lines.
- Judgment calls are yours — record them. Authority-class ambiguity → DECISION_REQUEST with
  options. Publish to `shared` when complete — or record the exact refusal (evidence, #158).

## Row assignments

- `row-dsh-arch` → the framework/architecture layer → `dsh-arch.md`
- `row-dsh-lifecycle` → the agent lifecycle + injection/context layer → `dsh-lifecycle.md`
- `row-dsh-seams` → the capability-seam + composition layer → `dsh-seams.md`
- `row-dsh-redteam` → the scope-creep red-team → `dsh-redteam.md`
- `coordinator` → merge + apply the rubric → `dsh-qa.md`
