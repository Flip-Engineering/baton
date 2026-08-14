# WLS fix-notes — row-fix

[attempt: 36e2504c-7750-45d8-8659-4cc021b76cd7 row-fix]

## Mechanism

`waves.list` (the observe verb) builds its roster projection from the coordination
event log. At HEAD the projection re-read the full log once per roster member: the
legacy string-roster branch called `_runIdForWaveMember` (one `eventsView()` scan) and
`_runWaveRoute` (a second scan) per member; the object-roster branch called
`_runIdForWaveMember` per member. Over a fat ledger (87k events) and a big roster that
is O(members × events) log reads inside one command budget — the bus 503s
(`temporarily_unavailable`) and the orchestrator loses the roster exactly when the fleet
is biggest.

The fix (additive, `impl/src/application.mjs`):

- Added `_waveMemberSteeringIndex()` — a single event-log pass over `eventsView()` that
  builds BOTH directions of the steering index: `byRunId` (runId → `{ waveId, waveRole,
  route }`) and `runIdByMember` ((waveId, waveRole) → runId). The composite key is
  `${waveId}|${waveRole}`; `|` cannot appear in either field (waveId is `wave:` + 32 hex,
  waveRole is `validId` `[A-Za-z0-9._:-]`), so the key is unambiguous.
- `waveList` now builds this index ONCE per invocation (`const steering =
  this._waveMemberSteeringIndex()`) and serves every member from the maps instead of the
  per-member helpers. The route recovery clones from `byRunId.get(runId).route` exactly
  as `_runWaveRoute` did (route → `clone`, absent → null).

Same output shape, same honesty: the index is event-log-derived and rebuilt per
invocation (no cross-call cache that could go stale), no clocks. The `_runWaveId` /
`_runWaveRole` / `_runWaveRoute` / `_runIdForWaveMember` helpers are untouched and still
serve `waveProgress`, `assertWaveStartReplayable`, and the other call sites.

## Before/after call counts (instrumented)

Instrumentation: a spy counts `coordination.events()` + `coordination.eventsView()` calls
combined (the WLS-1 structural metric — total log reads regardless of accessor). Fixture
seeds 20 open `wave.started` registry rows with a legacy role-only string roster of 5
members each; `waves.list` pages 16 rows → 80 members rendered. (This is the interpreter
seam shape that actually drives the per-member scan path.)

- **Before (HEAD): 163 log reads.** 160 are per-member full-log scans (2 × 80 string
  members: `_runIdForWaveMember` + `_runWaveRoute` each re-read `eventsView()`), plus 3
  fixed reads from the ready/reconcile path (`_reconcileRunControls`,
  `_reconcileWorkflowMemberStops`, one `events()` in the startup path). The per-member
  term scales with roster size — the defect.
- **After (fix): 4 log reads**, constant across 2, 5, and 20 members per wave. 1 is the
  single-pass `_waveMemberSteeringIndex()` build; the other 3 are the same fixed
  ready/reconcile reads (unchanged, unrelated to `waves.list`). The per-member term is
  gone.

## Acceptance — all green

- `node --test impl/test/waves-list-scaling-red.test.mjs` — GREEN (WLS-1, 1/1).
- `wave-observability-red` — 30/30.
- `workflow-as-data-red` — 30/30.
- `workflow-dsl-red` — 35/35.
- `workflow-dsl-package-red` — 12/12.
- Bonus read-path guard: `event-log-read-scaling-red` (ELRS-1/ELRS-2) — 2/2 (zero
  cloning reads still holds; `waves.list` rides the frozen view only).

## Anything not green — nothing, with one caveat

Nothing failed. One honesty note for the verifier: the shipped WLS-1 test's fixture does
not seed any wave registry rows (its `waveRegistry()` is empty), so its `eventsCalls <= 4`
assertion is trivially satisfiable at HEAD (0 member reads → 0 log reads) — it would be
green even without this fix. The instrumented counts above use a populated string-roster
fixture, which is what actually exercises the per-member path and shows the 163 → 4
collapse. The coordinator brief already flags this as the pin-vacuity guard; the
structural defect itself is fixed regardless of whether the shipped pin is strengthened.
