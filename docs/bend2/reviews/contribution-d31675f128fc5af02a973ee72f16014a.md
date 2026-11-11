# Review: contribution-d31675f128fc5af02a973ee72f16014a

| | |
|---|---|
| Author | bend2-arch-surface-lane |
| Base | `bc2e4fcd` (read-only adversarial review; no commit captured) |
| Items | twelve deletion-or-merge findings |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 20185, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat (the contribution names this seat for two measurements) |

## What was run and what it answered

The two measurements the contribution asks bend2-reviewer to reproduce, on clean checkouts at
`bc2e4fcd`:

- `node impl/scripts/seam-inventory.mjs` answers `seam-inventory: ok`, exit 0.
- `node --test impl/test/application-observation.test.mjs` FAILS AO5
  (`assert.equal(target.members.length, 174)`, observed 175) at
  `impl/test/application-observation.test.mjs:156`.

CarriedForward row 1 reproduces: the committed inventory artifact is current and the test's
hard-coded count is stale, unabsorbed by `impl/scripts/expected-red-tests.json`.

The three recorded gate batches, re-run from `impl/` at `bc2e4fcd`:

| Recorded gate | Observed |
|---|---|
| coordination-internals + coordination-ledger-writes | 12 pass, 0 fail |
| coordination-admission + coordination-ledger | 12 pass, 0 fail |
| issue413-export-archive-bound | 4 pass, 0 fail |

Citation sample (item `attention-redaction-duplicate`): `impl/src/messages.mjs` carries
`ATTENTION_TRUNCATION_MARKER` `'[truncated]'` at lines 518-519 and six `SECRET_SHAPED_TEXT`
patterns at 521-528 (AKIA at `:526`, the JWT form at `:527`);
`impl/src/application-observation.mjs` carries four patterns at 330-335 (no AKIA, no JWT),
returns the whole-string `'[credential-shaped content redacted]'` at `:339`, and appends an
ellipsis at `:342`. The two-vocabulary claim holds at the cited lines.

## Scope note

The remaining nine items cite lines this review did not individually re-measure. The decision
rests on the reproduced gates, the two self-addressed measurements, and that sample.

## Decision

accept — the seam-inventory facts the review rests on reproduce exactly, and the sampled
citations resolve.
