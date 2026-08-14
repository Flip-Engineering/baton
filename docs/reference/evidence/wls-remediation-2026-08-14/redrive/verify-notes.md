WLS-VERIFY v1
[attempt: fcf701fa-a66e-44f5-b0ff-c365cc7085f2 coordinator]

VERDICT: needs-fix — the application.mjs single-pass index itself is SOUND (non-vacuously
verified RED→GREEN: 62 reads → 3 reads), and the four adjacents are green; but the committed
WLS-1 pin is VACUOUS — it passes the pre-fix tree, so it never exercises the defect. Per the
pin-vacuity guard that is a "failed pin": the fixture must be extended to register fake wave
records before it guards the regression.

## Measured splits

WLS-1 pin (`impl/test/waves-list-scaling-red.test.mjs`):
- pre-fix tree (base ce9ab88f): 1/1 PASS, 20.5 s — GREEN for the wrong reason (empty registry, no members).
- fixed tree: 1/1 PASS, 63.9 s — GREEN, still on the empty registry.

Non-vacuous read-count probe (my own fixture: 3 open waves × 10 string-roster members = 30 members,
spying `coordination.events` + `eventsView`, then one `waves.list`):
- pre-fix: eventsCalls = 62  (30 members × 2 scans — `_runIdForWaveMember` + `_runWaveRoute` — plus 2 readiness-reconcile reads). RED.
- fixed (hash 8822212): eventsCalls = 3  (2 readiness-reconcile + 1 `_steeringRegisteredIndex` build). GREEN, ≤4.

Row-fix instrumentation (independent, from fix-notes.md; 20 waves × 5 members = 80 members):
- pre-fix: 162 reads (2 reconcile + 80 × 2); fixed: 3 reads (2 reconcile + 1 index). Corroborates RED→GREEN.

Adjacents (all against the fixed tree):
- wave-observability-red: 30/30 PASS (my run).
- workflow-dsl-red: 35/35 PASS (my run).
- workflow-dsl-package-red: 12/12 PASS (my run).
- workflow-as-data-red: 30/30 per row-fix report. My full-suite re-run under fleet load (75
  concurrent `node --test` processes) hit 6 flaky failures — W1-02, W2-01, W3-checkpoint,
  W3-elevate, W3-elevate-bounds, W3-signal (24/30) — all at 180–800 s durations; W1-02 re-run in
  isolation PASSES, confirming load-induced flakiness, not a fix-caused regression (the fix is
  localized to the waves_list roster projection; these tests are workflow-spec-validation +
  policy-timing — the W3-* stages are wall-clock stall/claim/elevate/signal deadlines).

NUL discipline: NUL byte count in `impl/src/application.mjs` is 3 before and 3 after the fix
(additive-only edits held).

## Pin-vacuity guard

The committed pin is vacuous: `waves-list-scaling-red.test.mjs` spies on both accessors but
registers no waves or members (the "Fatten the log" comment at lines 103–105 is never implemented
in code), so at HEAD the per-member path never executes and `eventsCalls <= 4` is met for the
wrong reason. I confirmed this directly: the pin is GREEN on the pre-fix tree (1/1). The honest
demonstration that the defect is real at HEAD and bounded after the fix is the populated-registry
probe above (62 → 3), which the guard requires. The pin as committed must be extended (record
`wave.started` + `steering.registered` records) before it is a real regression guard — that test
edit lives in `impl/test/`, outside this coordinator's scope.

## Live check

Not performed. A resident is running (PID 39573, `node impl/scripts/baton.mjs serve
impl/scripts/resident.deployment.mjs`) but it serves the main-repo pre-fix code; the fix is
uncommitted in a sibling worktree and not merged to the main repo. Restarting the resident onto
the fixed code is a destructive, shared-infrastructure action outside this coordinator's scope,
so I did not restart it. Verified by the suites alone, per the brief.

## Fix review (fixed tree, hash 8822212)

`_steeringRegisteredIndex()` builds, in one `eventsView()` pass, `byRunId` (runId →
{waveId, waveRole, route}) and `byWaveRole` (waveId → Map(waveRole → runId)) from
`steering.registered` records; `_runWaveId` / `_runWaveRole` / `_runWaveRoute` /
`_runIdForWaveMember` take an optional prebuilt index (lazy-build when omitted), and `waveList`,
`waveProgress`, `waves.attach`, and `assertWaveStartReplayable` build the index once per
invocation. First-defined-per-field reproduces the prior scan order, `_runWaveRoute` still
`clone`s, no clocks, no cross-invocation cache. Correct.
