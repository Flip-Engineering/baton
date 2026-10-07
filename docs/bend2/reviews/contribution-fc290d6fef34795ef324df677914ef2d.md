# Review: contribution-fc290d6fef34795ef324df677914ef2d

| | |
|---|---|
| Author | bend2-laws-ledger |
| Base | `bc2e4fcd` (read-only audit; no commit captured) |
| Items | `custody-laws`, `capacity-laws`, `wake-laws`, `coordination-ledger-laws`, `bend2-type-candidates` |
| Decision | accept |
| Review row | `swarm.contribution_reviewed` seq 20187, 2026-09-21 |
| Reviewer | bend2-reviewer, independent seat (the contribution names this seat for the independent check) |

## What was run and what it answered

The four recorded `node --test` batches, re-run from `impl/` at `bc2e4fcd`:

| Item | Recorded evidence | Observed |
|---|---|---|
| custody-laws | 21 tests, 21 pass, 0 fail | 21 pass, 0 fail |
| capacity-laws | HC-1..HC-12 pass | 20 pass, 0 fail (HC plus S424 and S512 files) |
| wake-laws | 18 tests, 18 pass, 0 fail | 18 pass, 0 fail |
| coordination-ledger-laws | 27 + 30 tests, one declared expected-red | 63 tests, 62 pass, 1 fail |

The ledger batch's single failure is exactly the declared one: CK8/CK9 at
`test/phase11-coordination-store.test.mjs:253`, assertion at `:272`, declared expected-red at
`impl/scripts/expected-red-tests.json:880` with reason "design". The recorded per-file counts
(27 and 30) correspond to a narrower expansion of `test/issue290-*.test.mjs` than this shell
produces (six `issue290-*` files at this tree); the substantive claim — the only red is the
declared one — reproduces.

Citation spot-checks, all resolved at the cited lines: `WAKE_CLASS_TABLE` at
`impl/src/wake-stream.mjs:120`; `CLASS_BY_LEDGER_ROW` at `:374` with the duplicate-key throw at
`:378-379`; `wakeClassFor` at `:398`; `hostCapacityObservation` at `impl/src/host-capacity.mjs:185`;
`deriveHostCapacity` at `:230`; `leaseWeight` at `:249` (a worker charges `{cores: 0, bytes: 0}`);
`roomFor` at `:274` (a non-verify returns true); `hostCapacityShortfall` at `:285`;
`ATTACHABLE_STATUSES` at `impl/src/shared-workspace-custody.mjs:25`; `holdsWorkspace` at `:38`;
the seq assignment at `impl/src/coordination-ledger.mjs:1199`; `truncated_tail` at
`impl/src/coordination-replay.mjs:464-466`; `invalid_utf8` at `:493-499`; `sequence_gap` at `:524`.

The reported documentation drift is confirmed: `host-capacity.mjs` lines 215-217, 225-228,
255-257 and 279-284 still state the pre-#541 worker-load gate that `roomFor` no longer applies.
The drift fix belongs to a seat holding impl/src write authority, as the contribution says.

## Observation

The `bend2-type-candidates` item records `test: none`, so its Bend2 type claims carry no
compiled example at the pin. The item marks that honestly; the compiled `laws.bend` remains
with bend2-laws-lead.

## Decision

accept — the four recorded test runs reproduce (with the one declared expected-red), and the
sampled law citations resolve at the stated lines.
