# Review: contribution-fb79d06ef27022fccf4d1cb653e480e2

| | |
|---|---|
| Author | bend2-laws-lead3 |
| Captured at | `6528c031` (rebased onto `f4da3d41`); revises `docs/bend2/laws-proposed.md` (revision 2, 1975 lines) |
| Decision | comment |
| Review row | `swarm.contribution_reviewed` seq see below, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat |
| Hold note | reviewed under the one authorized check; this file is intentionally left **uncommitted** until the root resumes |

## Check 1 — AGENTS.md style on the plain explanations

All 138 plain explanations extracted (440 lines; extraction spans each explanation up to its
`Bend2 carrier:`, `Constraint:` or `Trace:` line):

| Pattern | Hits |
|---|---|
| issue numbers (`#\d`) | 0 |
| file or path names (`.mjs`, `.bend`, `impl/`, `docs/`, `src/`) | 0 |
| backticks | 0 |
| CamelCase identifiers | 0 |
| instead-of / rather-than contrast phrasing | 10 |

The operator's vocabulary rule passes fully. The rewrite is flat and readable per the samples
read. Minor: ten lines lean on AGENTS.md rule 2 — the contrast is with a named specific failure
mode rather than a generic alternative, but each could be restated as the positive behavior; a
wording pass would close it.

## Check 2 — carrier discipline

- All **103 law rows** state a `Bend2 carrier:` line (affine ownership rules, closed variants,
  smart constructors, structural bounds — for example CUST-1's consumed-capability hold and
  CUST-2's `Attachable = Pending | Working | Blocked | Idle`).
- **Zero** of the 103 carrier lines contain proposal language (`proposed`, `would`, `could`,
  `eventually`, `planned`, `not yet`).
- The **35 constraint rows** are the rows without a stated carrier, each naming what a proof
  would take.
- The eight previously proposed rows keep their kind marker; `PR-02..05` are correctly classed
  `constraint`.

## The hard look — the finding

**Four rows are classed `law` while their kind is `proposed`: PROP-1, PROP-2, PROP-3, PR-01.**
Their carriers are stated concretely and the file header discloses that "a named carrier is the
design path that would make the row a law; it is not a claim that the row is one already." But
those behaviors are not enforced today, so the carriers are not actually in the type. Under the
operator rule that `laws.bend` records a law only where the carrier is actually in the type,
these four should be class `constraint` (or carried in a separate proposed-carrier section)
until the behavior exists and the carrier has its compiled example. The header disclosure and
the kind marker reduce the risk, but the class label on those four rows still says `law` —
the exact confusion the operator flagged.

Counts: 138 rows = 123 runtime + 8 proposed + 7 development; classes law 103 (94 runtime +
5 development + 4 proposed) and constraint 35 (29 runtime + 2 development + 4 proposed).

## Decision

comment — both authorized checks pass on their substance; the four `proposed · law` rows need a
mechanical reclassification (or a class label that cannot be read as an existing-type carrier)
before the operator approves rows into `laws.bend`.
