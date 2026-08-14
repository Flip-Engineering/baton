WLS-VERIFY v1

[attempt: 0bac5d81-1295-4c3d-8375-86d71a97dc0a coordinator]

## VERDICT

**sound** — the waves_list roster projection fix is correct, the WLS-1 pin is real (non-vacuous),
and the four named adjacents are green-unchanged except for five workflow-as-data steering-policy
tests that reproduce identically at the pre-fix base (environmental, not fix-caused).

## The fix on disk (#174 law — verified in the sibling worktree, silence is not death)

The row member's fix is uncommitted in sibling worktree
`ws-94f395642fb70118c4b4beb36d656160` (`git status`: ` M impl/src/application.mjs` +
`?? .../redrive/fix-notes.md`). Reviewed the diff (base `09200e9` → working tree):

- New private helper `_steeringIndex()` — ONE `eventsView()` pass builds four maps
  (`waveIdByRunId`, `roleByRunId`, `routeByRunId`, `runIdByWaveRole`), `.has()`-guarded
  first-record-wins (mirrors the old scans' early `return`).
- The four per-member helpers `_runWaveId` / `_runWaveRole` / `_runWaveRoute` /
  `_runIdForWaveMember` gain an OPTIONAL trailing `index` param (default `null`); present → serve
  from the maps, absent → the verbatim bare scan, so single-run attach/inspect lanes are unchanged.
- `waveList` and `waveProgress` build `const index = this._steeringIndex()` once per invocation
  and pass it through every member lookup.
- NUL discipline honored: `application.mjs` carries exactly 3 NUL bytes in both the base and the
  fixed tree (measured `0x00` count 3 → 3). Blast radius confirmed by grep: the only module that
  references any of the touched symbols (`_steeringIndex`, `_runWaveId`, `_runWaveRole`,
  `_runWaveRoute`, `_runIdForWaveMember`, `waveList`, `waveProgress`) is `application.mjs` itself —
  the workflow interpreter / wave-driver / lane modules never call them.

## WLS-1 pin — non-vacuous (pin-vacuity guard)

The shipped fixture is empty-registry, so its pin cannot distinguish the fix from a no-op. I
extended it (4 legacy string-roster `wave.started` waves × 5 roles = 20 members, spy on
`events` + `eventsView` combined, in `/tmp/wls-verify/extended-wls.test.mjs`) so the per-member
projection path genuinely executes:

- **RED (pre-fix tree, base `09200e9`)**: `eventsCalls=42` → `AssertionError: stage[waves-list-index-missing]: waves_list read the event log 42 times in one call … at HEAD the projection scans per member (_runIdForWaveMember/_runWaveRoute); the fix builds a single-pass index per invocation`.
- **GREEN (row member's `_steeringIndex` fix)**: `eventsCalls=3` → pass, `≤ 4` holds.

The shipped `impl/test/waves-list-scaling-red.test.mjs` is also green on the fixed tree (1/1).

## Measured splits — adjacents (run against the fixed tree)

| suite | result |
|-------|--------|
| wave-observability-red | **30/30** pass |
| workflow-as-data-red | **25/30** pass (5 fail — see below) |
| workflow-dsl-red | **35/35** pass |
| workflow-dsl-package-red | **12/12** pass |

## Not green and why

`workflow-as-data-red` fails 5 tests (W2-01, W3-checkpoint, W3-elevate, W3-elevate-bounds,
W3-signal), all `AssertionError`s of the form *"<steering policy> fires and receipts"* with
`actual: false/0/''` vs `expected: true/1/<40-hex>` — the interpreter lane's timing-sensitive
steering-policy firing did not occur within its window under extreme machine load (dozens of
concurrent `node --test` suites; individual test durations inflated to 150–500 s).

These are **not caused by the fix**. Proof: the same five tests were re-run against the **pre-fix
base** (`ws-0ffda69c876db2b6112a6f176b7b0064/impl`, `--test-name-pattern` filter) and **all 5
failed identically** (5/5 fail, exit 1). The touched symbols are unreferenced outside
`application.mjs` (grep above), so the fix has no path to influence the interpreter-lane tests.

## Live check

Not performed against a fixed resident. The resident (`node impl/scripts/baton.mjs serve
impl/scripts/resident.deployment.mjs`, PID 39573) is running the committed pre-fix `master` code
(HEAD `09200e9`; `_steeringIndex` grep count 0 in the main repo's `impl/src/application.mjs`).
Restarting it onto the fixed code would require committing the uncommitted worktree fix to the
main tree and cycling the shared resident — a destructive action outside this coordinator's scope.
Per the brief's fallback, verification is by the suites alone.
