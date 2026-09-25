# Review: contribution-2412b8cdee58c4247ebec9966de37707

| | |
|---|---|
| Author | bend2-laws-lead3 |
| Captured at | `112a8663` (based on `f4da3d41`); revises `docs/bend2/laws-proposed.md` to revision 3 |
| Scope | the fourteen spots flagged in the revision-2 review (contribution-fb79d06e…, seq 34240) |
| Decision | accept (scoped re-check) |
| Review row | `swarm.contribution_reviewed` seq see below, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat |
| Hold note | reviewed under the one authorized check; this file is intentionally left **uncommitted** until the root resumes |

## What was run and what it answered

Diffed `6528c031..112a8663` on `docs/bend2/laws-proposed.md` (24 insertions, 25 deletions —
one file). The diff moves exactly the flagged spots plus Counts bookkeeping:

- **Four reclassifications.** `PROP-1`, `PROP-2`, `PROP-3` and `PR-01` headers change from
  `proposed · law` to `proposed · constraint`; carriers and traces are kept (verified in the
  diff context). Cross-tab at the new head: 138 rows; law 99 (94 runtime + 5 development),
  constraint 39 (29 runtime + 8 proposed + 2 development); **zero proposed-law rows remain**.
- **Ten positive rewrites.** Every instead-of/rather-than explanation line is restated as the
  positive behavior ("no queue forms, because waiting cannot change the outcome"; "the
  configured number is kept exactly as given"; "the answer identifies itself as partial"; "only
  a successful read produces a value"; "the system refuses and names the defect"; "refused at
  once; only numbers the log produced can wait"; "refused at construction and never ships";
  "reads that one table for every verb"; "refuses with the empty-change refusal"; "every
  landing is computed against the branch's current head").
- The explanation contrast scan at the new head: **0** instead-of/rather-than hits across all
  138 explanations.
- The Counts section now states the operator rule verbatim: 99 law / 39 constraint, and all 8
  proposed rows carry the constraint class, with PROP-1..3 and PR-01 noted as carriers that
  become law forms once the behavior exists and a compiled example pins them.

## Notes

- The author disclosed four remaining rather-than occurrences outside the explanation scope
  (CAP-17 statement, WAKE-8 carrier, LEDG-3 carrier, CL-13 constraint line). Judged acceptable:
  they sit in technical fields the operator rule does not target, are disclosed, and a future
  wording pass can take them.
- Cosmetic: one rewritten explanation line ends with a comma where a full stop is intended
  ("…for every verb, / Without this rule…").

## Decision

accept — the scoped re-check confirms exactly the fourteen spots moved, nothing else changed,
and the operator's carrier rule is now stated and enforced in the document itself.
