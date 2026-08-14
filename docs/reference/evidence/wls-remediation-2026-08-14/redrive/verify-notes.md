WLS-VERIFY v1

# verify-notes — coordinator: verify the waves_list fix (v4-pro seat)

[attempt: f2d402be-7a91-4fa6-a623-9f97ed246ee5 coordinator]

VERDICT: **sound**

## What was verified

The row-fix's single-pass steering index (`_steeringIndex` in `impl/src/application.mjs`),
serving `waves.list` / `waves.progress` per-member lookups from one per-invocation pass over the
event log instead of a full `eventsView()` scan per member runId. Verified on disk per the #174
law in the sibling row-fix worktree `ws-94f395642fb70118c4b4beb36d656160` (attempt
`0bac5d81-1295-4c3d-8375-86d71a97dc0a row-fix`), whose `fix-notes.md` settled while this
verification ran. A second, structurally distinct implementation
(`_steeringRegisteredIndex`, worktree `ws-5e62ad1144887d073c81e848e9ec9c1a`) was spot-checked
and agrees on the pin.

## Pin-vacuity guard (required before the verdict)

The shipped WLS-1 pin's fixture seeds **no** open waves, so `eventsCalls <= 4` passes vacuously
on the empty registry (no members -> no per-member scans). I extended the fixture to register
**4 open string-roster waves x 6 members** (24 string members, the interpreter-seam shape that
drives `_runIdForWaveMember` + `_runWaveRoute` per member) plus 40 padding
`steering.registered` records, spying on BOTH `coordination.events` and `coordination.eventsView`:

| tree | combined events+eventsView reads in one `waves.list` | result |
|------|-------------------------------------------------------|--------|
| pre-fix (this worktree, HEAD `09200e9`) | **50** (2 per string member + 2 readiness baseline) | **RED** — assertion `<= 4` fails ("read the event log 50 times") |
| fixed `_steeringIndex` (ws-94f395) | **3** (1 index build + 2 readiness baseline) | **GREEN** (pass 1 / fail 0) |
| fixed `_steeringRegisteredIndex` (ws-5e62ad) | **3** | **GREEN** (pass 1 / fail 0) |

The pin is not vacuous: it exercises the per-member path and flips RED -> GREEN only with the
single-pass index.

## Measured acceptance splits (run against the fixed tree, ws-94f395)

- `waves-list-scaling-red` (WLS-1 pin): **1/1 GREEN**
- `wave-observability-red`: **30/30 GREEN**
- `workflow-dsl-red`: **35/35 GREEN**
- `workflow-dsl-package-red`: **12/12 GREEN**
- `workflow-as-data-red`: **24/30 (6 fail)** on the fixed tree; the pre-fix main repo
  (`HEAD 09200e9`) run was **26/30 (4 fail: `W3-checkpoint`, `W3-elevate`, `W3-elevate-bounds`,
  `W3-signal`)** — every failure lands in the wall-clock-driven `W3` steering-policy section
  (nudge-on-checkpoint / claim-on-stall / elevate-when-notes / signal-on-members-done), and the
  pass/fail delta is run-to-run flake under the fleet-wide test load. The suite never calls
  `waves.list`/`waves.progress` (no reference anywhere in the file), and the fix is confined to
  the roster-projection read path as an additive optional index (all other callers of
  `_runWaveId/_runWaveRole/_runIdForWaveMember` still take the verbatim old scan), so the fix
  cannot affect this suite. Not a regression; the timing flakes are flagged separately.

## Live check

Not performed. The running resident (`node impl/scripts/baton.mjs serve
impl/scripts/resident.deployment.mjs`, PID 39573) is a harness-owned shared process serving the
**main repo at HEAD `09200e9` (pre-fix)**; the fix exists only in sibling worktrees and is not
committed to the served repo, so the resident cannot be restarted onto the fixed code without
disrupting the other active wave members. Verified by the suites alone, per the brief's fallback.

## Basis for the verdict

The fix reduces the roster projection from O(members) full-log reads to a single per-invocation
index build while preserving output shape and event-log-derived honesty (first-record-wins
mirrors the prior per-field early return). WLS-1 is green on a non-vacuous fixture, the three
fast adjacents are green-unchanged at their pinned splits, and the fourth adjacent's only
observed failures are timing flakes that reproduce at HEAD.
