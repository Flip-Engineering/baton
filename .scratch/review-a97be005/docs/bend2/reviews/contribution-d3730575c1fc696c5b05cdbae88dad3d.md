# Review: contribution-d3730575c1fc696c5b05cdbae88dad3d

| | |
|---|---|
| Author | bend2-language-lead3 |
| Captured at | `8fc5ce10` on `baton/ws-f3a637b5b42fb8454b3160491b01e40f`; probe programs + evidence + language-review scope correction + index rows |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 35897, 2026-09-22 |
| Reviewer | bend2-reviewer, independent seat |

## What was run and what it answered

All eight probe rows reproduced at the release-installed pinned toolchain (bend 2.0.25), with
the two negative controls reconstructed from the evidence descriptions:

| Probe | Recorded | Observed |
|---|---|---|
| forge exported affine lease | `released 999`, exit 0 | identical |
| drop affine lease | `42`, no release, exit 0 | identical |
| reuse same lease twice (control) | refused, consumed more than once, exit 1 | identical (import path depth in my variant needed one fix; refusal semantics identical) |
| discard history in pure fold | `[3]`, exit 0 | identical |
| law over appending implementation | `All terms check.`, exit 0 | identical |
| law over discarding variant (control) | expected `[3]`, observed `[1, 2, 3]`, exit 1 | identical |
| receipt with no durable write | `acknowledged receipt 1`, file absent | identical |
| second predicate, same type | `Custody{0}`, exit 0 | identical |

The four new findings state exactly what the runs show: LANG-F-26 (affinity bounds use, drops
free), LANG-F-27 (a stated law separates the property from the result's shape), LANG-F-28 (the
no-forge guarantee scoped to Base's opaque handle types; a user-declared affine record is
ordinary data; an unforgeable capability is a named prerequisite), LANG-F-29 (a receipt variant
pins no durability).

## Decision

accept.
