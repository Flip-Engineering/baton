# fix-notes — waves_list roster projection single-pass index (row-fix)

[attempt: c628d22f-6099-4150-b1d0-6508dbb19573 row-fix]

## Mechanism

The waves_list roster projection re-read the full event log once per member runId. `waveList`
resolved every member through `_runIdForWaveMember(waveId, role)` and (for legacy string rosters)
`_runWaveRoute(runId)` — each of which called `this.driver.coordination.eventsView()` and
linear-scanned the log for the matching `steering.registered` record. With a fat log (87k events)
and a big fleet the read count scales O(members × events) inside one command budget, which is what
exhausted the bus and produced the 503.

The fix is a per-invocation single-pass index, `_steeringRegisteredIndex()` in
`impl/src/application.mjs`:

- one `eventsView()` read per invocation builds `byRunId` (runId → `{ waveId, waveRole, route }`)
  and `byWaveRole` (waveId → `Map(waveRole → runId)`) from the `steering.registered` records;
- `_runWaveId` / `_runWaveRole` / `_runWaveRoute` / `_runIdForWaveMember` now accept an optional
  prebuilt index and serve an O(1) map lookup instead of a full scan; when a caller does not pass
  one they lazily build it, so the single-call sites (`inspect` mint-detach, `waves.attach`,
  `assertWaveStartReplayable`) are behaviour-identical to before;
- `waveList` and `waveProgress` build the index once per invocation and pass it to every member.

Honesty is preserved: the maps are derived only from the event log (no clocks, no cross-invocation
cache that could go stale — a fresh build per invocation), `first-defined-per-field` reproduces the
exact prior per-field scan order, `_runWaveRoute` still `clone`s the route on access, and the
output shape is unchanged.

## Instrumented before/after (log-read call counts)

Method: spy on `coordination.events` + `coordination.eventsView` (the WLS-1 structural metric),
populate the registry with 20 open waves × 5 string-roster members, page 1 renders 80 members,
then call `waves.list` once. Runs on the same fixture via `git stash` of the one changed file.

| Tree | events/eventsView reads | breakdown |
|------|------------------------|------------|
| HEAD (pre-fix) | **162** | 2 readiness-reconcile reads (`_reconcileRunControls`, `_reconcileWorkflowMemberStops`) + 160 member scans = 80 members × 2 (`_runIdForWaveMember` + `_runWaveRoute`) |
| fixed | **3** | 2 readiness-reconcile reads + 1 `_steeringRegisteredIndex` build |

The per-member term collapses from 2×members to 1 total: the projection is now O(events) once per
invocation instead of O(members × events). (The 2 reconcile reads are the fixed readiness pass on
the first command — roster-independent, identical in both trees, and inside the WLS-1 `≤4` bound.)

## Verification

- `node --test impl/test/waves-list-scaling-red.test.mjs` — **GREEN** (WLS-1).
- Adjacents: `wave-observability-red` **30/30 pass** · `workflow-dsl-red` **35/35 pass** ·
  `workflow-dsl-package-red` **12/12 pass** · `workflow-as-data-red` **26/30** (4 flaky fails —
  pre-existing, see below).

## Not green: `workflow-as-data-red` (4 flaky steering-policy tests)

Two runs under the same machine contention (load average ~30 from ~56 concurrent node test
processes across sibling Baton rows) gave **6** and then **4** failures — a non-deterministic set.
The recurring failures are all steering-policy assertions, not steering-lookup assertions:

- `W3-checkpoint` — `claimOnStall fires and receipts` (actual false)
- `W3-elevate` — `elevateWhenNotes fires and receipts` (actual false)
- `W3-elevate-bounds` — `the second note does NOT refire` (count 0 vs 1)
- `W3-signal` — `signalOnMembersDone fires when a named role reaches terminal` (actual false)

**Why it is not this fix:** these four fail **identically on the pre-fix tree** — I stashed
`application.mjs` and ran `--test-name-pattern="W3-checkpoint|W3-elevate|W3-signal"` against HEAD:
**4/4 fail**, same assertion messages. The changed code (`_runWaveId`/`_runWaveRole`/`_runWaveRoute`/
`_runIdForWaveMember`/`waveList`/`waveProgress`) is the steering.registered *lookup*, which neither
`wave-driver.mjs` nor `coordinator.mjs` uses; the failing policy engine (`claimOnStall`,
`elevateWhenNotes`, `signalOnMembersDone`) lives in `workflow-interpreter.mjs`/`workflow-dsl.mjs`.
The tests drive a `LANE_DRIVER = { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 }`
(F11) — wall-clock timings that CPU starvation under load ~30 violates. This is a timing/
environment-dependent flake, not a regression. (`gh` is not authenticated in this worktree, so I
could not file the `bug`/flaky issue the project's rules ask for; the failure mode is recorded here
for the coordinator.)

## Caveats

- **The WLS-1 suite pin is vacuous on its own empty-registry fixture.** The test spies on the
  accessors but registers no waves/members, so at HEAD the per-member path never executes and the
  pin is met for the wrong reason (2 reconcile reads, `≤4`). This is the pin-vacuity the
  coordinator-brief's guard calls out. The populated-registry instrumentation above (162 → 3) is
  the honest demonstration that the defect is real at HEAD and bounded after the fix.
- **NUL discipline held:** `impl/src/application.mjs` is NUL-bearing (line 628 carries 3 NUL bytes
  in the board view cache key). Edits were made with exact-string replacement only (grep/sed for
  reads, no whole-file read/write); the NUL count is unchanged at 3.
