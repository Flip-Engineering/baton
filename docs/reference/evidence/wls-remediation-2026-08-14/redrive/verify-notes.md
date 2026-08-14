WLS-VERIFY v1

[attempt: c628d22f-6099-4150-b1d0-6508dbb19573 coordinator]

# verify-notes — waves_list single-pass index (coordinator verification)

VERDICT: **sound** — the waves_list per-member full-log scan is fixed. The row-fix's code landed
on disk in a sibling worktree (the #174 law), and independent measurement confirms the read count
collapses from O(members × events) to a single per-invocation pass: **162 → 3** event-log reads on
the same 20-wave × 5-member fixture. Output shape and event-log-derived honesty are unchanged, and
the fix-relevant wave-observability rows all stay green. One residual: the committed WLS-1 pin is
**vacuous** (empty-registry fixture — see Pin-vacuity below), so the structural guard only works
through the seeded fixture quoted here; the committed test should be extended to seed the registry.

## Signal + on-disk verification (#174)

No literal signal arrived in-session, so per the #174 law I verified on disk across sibling
worktrees at `../../wt/ws-*/`. The row-fix settled in `ws-5e62ad1144887d073c81e848e9ec9c1a`
(attempt `c628d22f-… row-fix`, same wave attempt id as this coordinator):
- `impl/src/application.mjs` — modified (52+/40−): adds `_steeringRegisteredIndex()` and threads an
  optional prebuilt index through `_runWaveId` / `_runWaveRole` / `_runWaveRoute` /
  `_runIdForWaveMember`; `waveList` and `waveProgress` build the index once per invocation.
- `redrive/fix-notes.md` — present, mechanism + 162→3 table + WLS-1/adjacent claims.
- A second, parallel attempt (`ws-94f395642fb70118c4b4beb36d656160`, attempt `0bac5d81-… row-fix`)
  implements the same single-pass index with a 4-map + composite-key shape (100 → 1 reads, 10-wave
  fixture). I verified the `c628d22f` row (my wave) end-to-end; the two implementations are
  semantically equivalent (both first-record-wins, both output-identical).
- NUL discipline held: `application.mjs` carries 3 NUL bytes before and after (all on the board-view
  cache key, line 628) — verified by byte count, not disturbed.

## Measured splits (independent instrumentation)

Method: spy on `coordination.events` **and** `coordination.eventsView` (the WLS-1 structural
metric); seed the registry with 20 open waves × 5 string-roster members; call `waves.list` once.
Same harness run against the pre-fix tree (this worktree) and the fixed tree (row-fix worktree).

```
PRE-FIX  (ws-691a2043, HEAD 09200e9): reads = 162  → RED   (> 4 bound)
  = 2 readiness-reconcile reads + 160 member scans (80 members in page × 2: _runIdForWaveMember + _runWaveRoute)
POST-FIX (ws-5e62ad, fixed):         reads = 3    → GREEN (≤ 4 bound)
  = 2 readiness-reconcile reads + 1 _steeringRegisteredIndex build
```

`waves.list` answered `resolved` with 16 wave rows in both runs — output shape unchanged. This
matches the row-fix's own 162 → 3 table exactly (independent cross-check).

## Acceptance

- `node --test impl/test/waves-list-scaling-red.test.mjs` — **GREEN** (WLS-1 pin) in both trees.
  Caveat: the pin's committed fixture registers no waves, so on the empty registry it is met for the
  wrong reason (see Pin-vacuity).
- Adjacents (my measured splits):
  - `wave-observability-red` **30/30** pass (pre-fix tree). In the fixed tree I re-ran the
    fix-relevant rows serially — A1-1 (waves_start), A1-5 (waves_list round-trip), A2-3
    (registry projection), A2-4 (legacy string roster no-run read), A3-1 (rows exact shape +
    paging) — **5/5 pass**, confirming no regression on the read/write surface the fix touches.
  - `workflow-dsl-red` **35/35** pass (both trees).
  - `workflow-dsl-package-red` **12/12** pass (pre-fix tree).
  - `workflow-as-data-red` **26/30** in my pre-fix-tree run under heavy fleet contention: the four
    failures are all steering-policy W3 rows (W3-checkpoint / W3-elevate / W3-elevate-bounds /
    W3-signal) — stall/checkpoint/elevate/signal timing lanes, orthogonal to the waves_list
    projection read path, and they reproduce in the **pre-fix** tree (they are not a fix
    regression). The row-fix reports 30/30 from a quieter run. Flagged as timing-sensitive, not
    caused by this fix.

## Pin-vacuity guard (the coordinator brief's added requirement)

The committed WLS-1 pin spies on both accessors but seeds **no** wave records, so on the empty
registry the per-member path never executes and `eventsCalls ≤ 4` holds for the wrong reason — the
pin does not, by itself, exercise the defect. I extended the fixture in a standalone harness
(20 waves × 5 string-roster members) so the per-member path genuinely executes, and confirmed:

- RED against the pre-fix tree: **162 reads** (quoted above).
- GREEN only with the single-pass index: **3 reads** (quoted above).

Both runs are quoted verbatim in the splits table. The committed test file is outside both members'
scope, so the fixture extension is documented here rather than landed — follow-up: seed the
registry in `impl/test/waves-list-scaling-red.test.mjs` so the pin stays non-vacuous.

## Live check

No resident is running in this sandbox (`pgrep`/`lsof` show only fleet test runners, no
`resident-authority` / `application-host` process), so I could not restart a resident onto the
fixed code and drive a live `baton waves list`. Live check deferred; verification is by the suites
and the instrumented harness alone (per the brief's fallback).

## Authority / open items

- The committed WLS-1 pin should be strengthened to seed the registry fixture (needs `impl/test/`
  scope — neither coordinator nor row-fix holds it). Escalation surface: this is the one
  non-green/left-open item and it is test-only, not the fix.
