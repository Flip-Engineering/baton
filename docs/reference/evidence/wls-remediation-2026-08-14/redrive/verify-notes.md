WLS-VERIFY v1
[attempt: 36e2504c-7750-45d8-8659-4cc021b76cd7 coordinator]

## VERDICT: sound

The waves_list single-pass index fix in `impl/src/application.mjs` is sound: the per-member
full-log scan defect is genuinely fixed (extended-fixture read count collapses 42 → 3), the
four named adjacents are green-unchanged, and the change is additive-only with the NUL bytes
undisturbed. The committed WLS-1 pin itself is vacuous (empty-registry fixture — see
pin-vacuity guard below), so the GREEN/red proof below uses a populated string-roster fixture
that actually exercises the per-member path.

## Measured splits

### WLS-1 pin — RED against the pre-fix tree, GREEN only with the single-pass index

The shipped `impl/test/waves-list-scaling-red.test.mjs` seeds no registry rows (its
`waveRegistry()` is empty), so `eventsCalls <= 4` passes at HEAD for the wrong reason — no
members → no per-member scans. To make the pin genuine I extended the fixture to record one
OPEN `wave.started` row with a legacy string-array roster of 20 members (no
`steering.registered` binds → no-run render, no early `wave_not_found` refusal), so the
per-member scan path runs for every member. Instrumentation is the WLS-1 metric: total
`coordination.events()` + `coordination.eventsView()` calls across one `waves.list`.

Pre-fix tree (HEAD, my worktree `ws-df9b4abce` — before the row landed):
```
{
  "eventsCalls": 42,
  "bound": false,
  "MEMBER_COUNT": 20,
  "outcome": "answered",
  "waves": 1,
  "memberCount": 20,
  "rosterRoles": ["member-0", "member-1", "member-2"]
}
```
42 = 20 members × 2 full-log scans (`_runIdForWaveMember` + `_runWaveRoute`) + 2 fixed reads.
`bound: false` — RED.

Fixed tree (row-fix worktree `ws-e7feafa2` — `_waveMemberSteeringIndex()` single-pass build):
```
{
  "eventsCalls": 3,
  "bound": true,
  "MEMBER_COUNT": 20,
  "outcome": "answered",
  "waves": 1,
  "memberCount": 20,
  "rosterRoles": ["member-0", "member-1", "member-2"]
}
```
3 = 1 single-pass index build + 2 fixed reads. `bound: true` — GREEN. The same 20 members are
rendered (`memberCount: 20`), so the per-member path genuinely executed in both runs.

Committed pin: `node --test impl/test/waves-list-scaling-red.test.mjs` → 1/1 pass at both HEAD
and the fixed tree (vacuous; see below).

### Adjacents — green-unchanged (pre-fix baseline == post-fix)

| suite | pre-fix | post-fix (fixed tree) |
|---|---|---|
| wave-observability-red | 30/30 | 30/30 |
| workflow-as-data-red | 30/30 | 30/30 |
| workflow-dsl-red | 35/35 | 35/35 |
| workflow-dsl-package-red | 12/12 | 12/12 |

All exit 0, zero failures. The fix does not move any adjacent.

### NUL integrity (fix-brief discipline)

`application.mjs` NUL byte count: 3 (pre-fix) → 3 (fixed). Diff is additive-only
(36 insertions, 3 deletions; numstat `36\t3\timpl/src/application.mjs`). The 3 removed lines
are the two `_runIdForWaveMember`/`_runWaveRoute` call sites in the string branch and the one
`_runIdForWaveMember` call in the object branch — none NUL-bearing. Existing NUL bytes are
undisturbed.

## Live-check outcome

NOT performed — verified by the suites alone. The live check requires restarting the campaign
resident onto the fixed code, which I cannot do:

1. The resident (PID 39573, `node impl/scripts/baton.mjs serve impl/scripts/resident.deployment.mjs`,
   up since 02:00, ~28 min CPU) serves the MAIN repo
   (`/Users/wahargis/Development/Experiments/baton`), not a worktree. The fix is unmerged — it
   lives only in the row-fix worktree `ws-e7feafa2`.
2. `node impl/scripts/baton.mjs waves list` from the main repo returns
   `✦ baton: cli_config_invalid: user connection profile is unavailable` — the resident's
   connection profile (`resident-4421cf292504-672ef8abad50.json`) is absent from the connection
   directory, so the CLI cannot reach the resident at all.
3. Restarting the live orchestrator to load unmerged worktree code would disrupt the in-flight
   fleet (the resident is orchestrating this wave and its siblings). That is an
   authority-class action I was not asked to take against the shared resident, and the brief
   explicitly allows the suites-alone fallback.

## Pin-vacuity guard — finding

The shipped WLS-1 pin does not exercise the defect: its fixture registers zero `wave.started`
rows and zero `steering.registered` records, so `eventsCalls` stays 0 at HEAD and the `<= 4`
assertion is trivially green. The row-fix notes flag the same thing independently. My
extended fixture (above) makes the pin genuine — RED at HEAD (42), GREEN only with the
single-pass index (3) — so the defect and the fix are both actually demonstrated. The fix
itself is sound; the shipped pin should be strengthened (seed an open registry row with a
string-array roster) to guard against regression, but that is a test-hygiene follow-up, not a
blocker for this verdict.

## Laws

Cited evidence only; all measurements are from read-and-run (the scaffold is a scratch
instrumentation file, not a committed deliverable). No clocks, no fabrication.
