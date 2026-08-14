# FIX NOTES — waves_list roster projection: per-member full-log scans → single-pass index

[attempt: fcf701fa-a66e-44f5-b0ff-c365cc7085f2 row-fix]

## Mechanism

The waves_list / waves.progress roster projections recovered each member's waveId / waveRole /
route / runId by re-scanning the whole coordination log per member. `_runWaveId`,
`_runWaveRole`, `_runWaveRoute`, and `_runIdForWaveMember` each opened
`this.driver.coordination.eventsView()` and linear-scanned it; `waves.list` called the pair
`_runIdForWaveMember` + `_runWaveRoute` once per string-roster member (and
`_runIdForWaveMember` once per object-roster member), so a fat log × roster is O(members ×
events) inside one command budget — the 87k-event furnace that 503s `temporarily_unavailable`.

The fix builds the lookup ONCE per invocation and serves every member from it. Added
`_runWaveIndex()` — a single `eventsView()` pass over the `driver.recorded` /
`steering.registered` records building two maps:

- `byRunId`: runId → { waveId, waveRole, route }
- `byWaveRole`: waveId → Map(waveRole → runId)

`_runWaveId` / `_runWaveRole` / `_runWaveRoute` / `_runIdForWaveMember` now take an optional
`index` (default null). When an index is supplied they answer from the maps (first-match-wins,
preserving the old per-record iteration order — the steering.registered record is idempotency-keyed
`run.steering_registered:${runId}`, so there is exactly one per runId, making the maps exact);
when null they keep the original scan unchanged for their other (non-roster, single-lookup)
call sites. `waveList` and `waveProgress` build the index once per invocation and pass it to
every member lookup. `_runWaveRoute` still `clone`s on access, so the returned route object is
fresh per call as before.

Honesty properties preserved: the index is derived from the event log only (no clocks), and it
is rebuilt on every invocation — never cached across calls, so it cannot go stale. Output shape
is unchanged (same members, same nulls, same route/scope renders). The change is additive — the
pre-fix scan paths remain as the no-index fallback.

## Before/after call counts (instrumented)

Instrumented by a scratch harness (spy wrapping `coordination.events` + `coordination.eventsView`,
counting total log reads) over a fixture of 20 open waves × 5 legacy string-array members = 100
members. `waves.list` pages ≤16 rows, so one invocation walks 16 waves = 80 members.

| tree | events/eventsView reads in one `waves.list` | composition |
|------|----------------------------------------------|-------------|
| HEAD (pre-fix) | 162 | 2 per member (`_runIdForWaveMember` + `_runWaveRoute`) × 80 members = 160, + 2 constant admission-path reads |
| fixed | 3 | 1 index build (`_runWaveIndex`), + the same 2 constant admission-path reads — no per-member component |

The read count is now a small constant independent of roster size (162 → 3); scaling the roster
no longer scales the log reads.

## Verification

- `node --test test/waves-list-scaling-red.test.mjs` — GREEN (WLS-1 pin, 1/1).
- `node --test test/wave-observability-red.test.mjs` — GREEN 30/30.
- `node --test test/workflow-dsl-red.test.mjs` — GREEN 35/35.
- `node --test test/workflow-dsl-package-red.test.mjs` — GREEN 12/12.
- `node --test test/workflow-as-data-red.test.mjs` — 26/30 (4 pre-existing failures; see below).

`impl/src/application.mjs` syntax check passes (`node --check`) and the NUL-byte count is
unchanged at 3 (the NUL-bearing `cacheKey` template literal on line 628 is untouched).

## Not green — and why

`workflow-as-data-red` is 26/30, not 30/30. Four W3 steering-policy tests fail:

- W3-checkpoint (`claimOnStall fires and receipts`)
- W3-elevate (`elevateWhenNotes fires and receipts`)
- W3-elevate-bounds (`the second note does NOT refire` — elevation count 0 !== 1)
- W3-signal (`signalOnMembersDone fires when a named role reaches terminal`)

These are NOT caused by this fix. Evidence: the identical four tests were run against the
pre-fix tree (`git show HEAD:impl/src/application.mjs` swapped in) and failed the same way
(4/4 fail, same assertion messages). The steering policies live in `workflow-interpreter.mjs`
/ `workflow-dsl.mjs` (nudge/claim/elevate/signal), driven off `run.status`/`run.inspect`/
`run.scratchpad.*`/`run.message.send` — none of which touches `_runWaveId`/`_runWaveRole`/
`_runWaveRoute`/`_runIdForWaveMember`/`waveList`/`waveProgress`. The changed helpers are
backward-compatible (optional `index` defaults to the original scan), so any caller that does
not pass an index behaves byte-for-byte as before. The four failures are timing-sensitive
steering receipts (stall/checkpoint/elevate-dedup/signal windows) and reproduce identically at
HEAD on this machine; they are out of this row's scope (`workflow-interpreter.mjs` is not in the
permitted edit set) and are reported here rather than left undetected.
