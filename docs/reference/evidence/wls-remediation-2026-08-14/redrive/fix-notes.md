# fix-notes — row-fix: the waves_list roster projection's per-member full-log scans

[attempt: 0bac5d81-1295-4c3d-8375-86d71a97dc0a row-fix]

## Mechanism

The defect was in the waves_list / waves.progress roster projections: each per-member lookup
(`_runWaveId`, `_runWaveRole`, `_runWaveRoute`, `_runIdForWaveMember`) did its own full pass
over `this.driver.coordination.eventsView()`, so a roster of N members cost N full-log scans
(waves.list: runId + route per string member) inside one command's bus budget. Over a fat log
(~87k events at incident) the command overran the budget and the bus answered
503 `temporarily_unavailable`.

The fix adds one private helper, `_steeringIndex()` (`impl/src/application.mjs`), that builds
the projection lookup **once per invocation** in a single pass over the frozen event view:

- `waveIdByRunId`   — runId → waveId
- `roleByRunId`     — runId → waveRole
- `routeByRunId`    — runId → route
- `runIdByWaveRole` — `${waveId}\0${waveRole}` → runId (the reverse lookup)

Each map only admits `steering.registered` (`driver.recorded`) records with a string runId, and
uses `.has()`-guarded `set` so **first-record-wins** — the exact semantics of the old scans'
early `return`, so the maps answer identically to the per-run scans they replace. The four
helpers gained an optional trailing `index` parameter: when present they serve from the maps
(no log read); when absent the verbatim old scan remains, so the single-run attach/inspect
lanes are byte-for-byte unchanged.

`waveList` and `waveProgress` now build `const index = this._steeringIndex()` once and pass it
through every member lookup. The build is strictly per-invocation — no cross-call cache, so it
can never go stale; output shape and event-log-derived honesty are unchanged.

NUL discipline honored: `application.mjs` still carries exactly its 3 pre-existing NUL bytes
(all on line 628, a cache-key separator — untouched). The reverse-map key uses the source-level
escape `\0` (backslash-zero), not a literal NUL byte, matching the file's existing `join('\0')`
idiom. Edits were `grep -an`/`sed -n` + exact-string Edit only; no whole-file read.

## Before / after — instrumented call counts

Spy on `coordination.eventsView` (the read the projection uses at HEAD), fixture of 10 open
waves × 5 string-roster members = 50 members plus 500 padding `steering.registered` records
(510-event log; the live incident shape was ~87k — same scaling, measured on a fast fixture):

| path | reads per invocation |
|------|----------------------|
| before (HEAD) | **100** — 2 full-log scans per string member (`_runIdForWaveMember` + `_runWaveRoute`), linear in roster size |
| after (this fix) | **1** — the single `_steeringIndex()` build, constant regardless of roster size |

Object-member rosters add 1 scan per member at HEAD (runId lookup only); the fix removes that
too. `waveProgress` had the same per-member defect (`_runWaveId` filter + `_runWaveRole`) and is
wired identically.

## Verification

- `node --test impl/test/waves-list-scaling-red.test.mjs` — **GREEN** (WLS-1, the bounded-read
  pin; spies on both `events` and `eventsView`, asserts `<= 4`).
- `node --test impl/test/event-log-read-scaling-red.test.mjs` — **GREEN 2/2** (ELRS-1/ELRS-2:
  the read surface performs zero cloning `events()` reads).
- `wave-observability-red` — **30/30 GREEN** (the suite that exercises waves.list/waves.progress
  output shape: A3-1, A6-4, A6-5, the D2.4 roster pins, all green).
- `workflow-dsl-red` — **35/35 GREEN**.
- `workflow-dsl-package-red` — **12/12 GREEN**.
- `workflow-as-data-red` — **26/30** (4 drive-policy failures, see below; not caused by this fix).

## Not green / caveats

`workflow-as-data-red` failed 4 of 30 tests on the verification run:
**W3-checkpoint, W3-elevate, W3-elevate-bounds, W3-signal** — all `stage[policy-missing:*]`
workflow-**drive** steering tests (nudge-on-checkpoint, elevate-when-notes, signal-on-members-done).

These are not caused by this fix and are non-deterministic under the current fleet CPU
contention, for three independent reasons:

1. **The suite never touches the changed code.** `workflow-as-data-red.test.mjs` has **0**
   references to `waves.list` / `waves.progress` (verified by grep); the drive loop in
   `workflow-interpreter.mjs` polls members via `inspect` + `steering`, not the roster
   projections this fix rewired.
2. **The failures are non-deterministic across runs.** Two consecutive runs failed *different*
   subsets: run 1 → {W3-elevate-bounds, W3-signal}; run 2 → {W3-checkpoint, W3-elevate,
   W3-elevate-bounds, W3-signal}. `W3-elevate` passed in run 1 and failed in run 2. A deterministic
   regression fails the same set every run.
3. **They are timing-sensitive drive-loop assertions** (durations 85s–178s each), driven by the
   workflow driver's wall-clock cadence caps, which fire early when the event loop is starved by
   hundreds of concurrent `node --test` processes across sibling worktrees (the exact bus-starvation
   condition the WLS fix targets). Not a code determinism issue, and no numeric limit belongs here
   (operator ruling: no arbitrary retry/cap controls).

Action per the "failing tests must be resolved" rule: `gh` is not authenticated in this
environment, so the flaky-issue list/file path is unavailable; this note is the record. The
verifier can re-run `workflow-as-data-red` on a quieter machine and should see 30/30 (or a
different flaky subset) — either way the subset varies, which is the flakiness signature, not a
WLS regression.
