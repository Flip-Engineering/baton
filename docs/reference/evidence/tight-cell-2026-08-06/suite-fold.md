# Fold summary — tight-cell red suite (blue-team verdict → red-first rows)

Date: 2026-08-06
Authority: `suite-blueteam.md` (verdict NOT-READY — blockers B1–B7, teeth T1–T6, drifts D1–D6)
Edit target: `impl/test/tight-cell-red.test.mjs` (suite, now at 30 red / 9 green)
Method: every blocker's asserted anchor re-verified against the working tree before folding
(NUL-safe `grep -an` / `sed -n` on `application.mjs` / `coordination-store.mjs`; plain reads on
`coordinator.mjs` / `wave.mjs` / `messages.mjs`). No implementation file was modified — the
working tree still fails red exactly where the suite says it should (blocked at the closed-member
`group` key set, `application.mjs:11598`). The suite was re-run from the repo root until the split
was exact and stable: **39 tests / 9 pass / 30 fail**, identical across consecutive runs, every red
row failing at its own named stage (30 distinct stages, none shared across tests).

## Before → after split

| | tests | pass | fail |
|---|---|---|---|
| Before (blue-team record) | 33 | 9 | 24 |
| After (folded suite) | 39 | 9 | 30 |

The 9 pins are unchanged and stay green for the same legitimate reasons (re-verified); no red row
was weakened to make room — the six new rows are additions, and the two rewrites (TC-05 steering
predicate, TC-23b pin) make rows *more* passable-on-correct-implementation, never more green today.

## Blocker → change map

### B1 — TC-05 `steering.registered` predicate can never match → FOLDED
- The filter was `e.kind === 'steering.registered' && …`, which never matches any event
  (`recordDriver` wraps every event as `{kind:'driver.recorded', payload:{kind:'steering.registered', …}}`,
  `coordination-store.mjs:13102-13108`), so `steering.length` was always 0 and the row could never
  go green even on a correct implementation.
- Fix applied: the predicate is now the two-level form
  `e.kind === 'driver.recorded' && e.payload?.kind === 'steering.registered' && e.payload?.runId === view.runId`
  (test line 565). The count assertion is unchanged — the row goes green only when the cell run is
  steering-registered exactly once.

### B2 — TC-02 never tested a seatless group → FOLDED
- `startCellRun` unconditionally injected `seat: SEAT` (`group: { seat: SEAT, size, …group }`), so
  the "seatless" group actually carried a seat and `wave_group_seat_missing` was unreachable.
- Fix applied: `startCellRun` gained an `omitSeat` option (test line 458-460) that skips the
  default seat when the caller sends a genuinely seatless group. TC-02 now passes
  `group: { size: 2 }, omitSeat: true` (test line 487) — the row sends what it claims to test.

### B3 — Seven admission-only rows got their promised post-mint bindings → FOLDED
The blue-team's T3 finding: D1, D2, D3, D4, TC-08, TC-22, TC-23a were each a single `assert.ok(sent.ok)`
blocked at the transport seam — an implementation that mints the cell but implements *none* of the
depth/board/trust behavior would go green. The header's promised "post-mint behavioral bindings"
did not exist. Fix applied: every one of the seven rows now ends in the behavioral assertion the
contract names, after the mint assertion so a wrong mint still lands on the mint stage first:

| row | post-mint binding added |
|---|---|
| D1 | member 2's `CONTEXT_READ` of kind scratchpad must SERVE member 1's task-tier note (`'D1 MATE TASK NOTE'` in the read result) — the read port extends to the cell's task tiers, never stays on `(runId, ['shared'])`. |
| D2 | two members write the shared tier with per-member receipts (`scope === 'shared'`, distinct entryIds); a stale-fence write refuses exactly as today; no `kg.*` event mints from the direct write. |
| D3 | member 0's reply to the cell broadcast appears framed in member 1's NEXT prompt (`'D3 MEMBER-0 REPLY'`), with depth 1 per member. |
| D4 | `group.worktree:'shared'` produces ONE shared tree — every member's worktree path resolves to a single set (size 1), never per-member trees. |
| TC-08 | a `waves.send(claimGrant)` to the cell runId mints exactly SIZE grants with distinct `(workerId, taskId, taskVersion)` coordinates (never `_taskByRun`'s first task, `coordination-store.mjs:15011-15016`). |
| TC-22 | SIZE mints under one send idempotencyKey all succeed (per-member caller keys); an exact retry replays; a changed-content retry for the same send refuses `board_replay_conflict`. |
| TC-23a | the non-listed (non-editing) member's task brief carries `analysis: true` while the listed (editing) member's does NOT — the division is per-member, never all-or-nothing. |

### B4 — The quorum rows did not fail the first-node-settles shallow behavior → FOLDED
- Special-attention Q1: the six source rows (TC-11/12/13/14/20/26) are token checks; a wrong
  implementation that keeps `projection.nodes[0]` truth and merely *names* the aggregate block
  passed them.
- Fix applied: new **TC-20b** (test line 625, stage `cell-quorum-behavioral-missing`) runs the
  contract TC-20 oracle behaviorally with `waveFixture({ pausable:false })`, size-3/quorum-2:
  - worker #1 (index 0, the node a `nodes[0]` implementation keys on) rests while #2/#3 still run →
    the cell must NOT settle (any terminal phase is a failure);
  - a live worker (w1) dies while quorum is reachable (`lost=1` is NOT `> size-quorum=1`) → the cell
    must NOT fail;
  - rest w2 → `survived=2=quorum < size=3` → `degraded` terminal with `cell.degraded: true` and
    `cell.lost` receipting the killed member with its per-member cause.

### B5 — TC-15 did not fail a first-completer capture → FOLDED
- Special-attention Q2: TC-15 is a single source-token check for `cell.captures`; a
  first-completer implementation that receipts digests but keeps the first worker's result would
  pass.
- Fix applied: new **TC-15b** (test line 788, stage `collector-result-law-behavioral-missing`) runs
  the distinguishing law (Decision 7): size-2 cell, `pausable:false`; the non-collector (index 1)
  completes AND commits BEFORE the collector (index 0), each writing DISTINCT content. Asserts the
  wave outcome has exactly ONE entry whose `resultSha` equals the COLLECTOR's (index 0) capture
  digest even though index 1 completed first, and `cell.captures` carries every member's digest
  sorted by member index.

### B6 — Contract rows TC-10, TC-16, TC-19, TC-25 were missing → FOLDED
Four new red rows, each added at its own named stage (all fail today, most at the cell mint):

| row | stage | what it pins |
|---|---|---|
| TC-10 (test 1023) | `partial-delivery-honesty-missing` | a cell send with a dead member receipts `delivered < size`, `targetCount = size`, and NEVER throws — per-worker delivery truth in the message record (Decision 5). |
| TC-16 (test 679) | `cell-no-clock-law-missing` | the cell aggregate block is CLOSED at `{size, quorum, survived, lost, degraded}` — `assert.deepEqual(Object.keys(cell).sort(), …)` fails on ANY leaked time/TTL/turn/elapsed field or cadence-dependent truth (Decision 6, TC-16; campaign no-clock law). |
| TC-19 (test 836) | `cell-end-to-end-loop-missing` | the WHOLE #74 loop is executable: mint, size grants with distinct member coordinates, broadcast receipt (`delivered`/`targetCount`), worker-attributed claim + report on the SAME worker stream, one collective terminal, one collective `resultSha` matching `/^[a-f0-9]{40,64}$/u` — keyed on durable ids/digests/events, never clocks (contract lines 768-772). |
| TC-25 (test 711) | `quiescence-ordering-missing` | a quorum terminal mints with a LIVE member: the live member's grant is revoked (`board.grant_revoked`), its worktree captured checkpoint-only (`worktree.captured` under its taskId) and receipted BEFORE the outcome mints, and the whole-run stop reaps the remainder (Decision 8 / TC-25 oracle). |

### B7 — TC-23b pin was vacuous → FOLDED (with the literal fix rejected on the code)
- The old pin's brief `{analysis:true, requiredEffects:[]}` left the required-effect gate inert
  regardless of `analysis` (`coordinator.mjs:12839-12849`), so it stayed green even if the TG5
  hatch were removed entirely.
- The blue-team's literal fix — brief `{analysis:true, requiredEffects:['repository_edit']}` — is
  **rejected by the code**: the BU-2-1 brief validator (`messages.mjs:92-98`) refuses
  `analysis:true` WITH `repository_edit` in `requiredEffects` as a self-contradiction at
  construction (`ValidationError`), so no implementation can ever see that pair through the
  validator. The `!analysis` guard at `coordinator.mjs:12842` is precisely a runtime backstop
  against that contradictory state.
- Fix applied: the pin injects the contradictory brief post-spawn
  (`task.brief = Object.freeze({ …task.brief, analysis:true, requiredEffects:['repository_edit'] })`,
  test 1293 — the spread is re-set explicitly because `analysis` is non-enumerable on the frozen
  brief), then asserts a diffless capture is NOT policy-killed. **Non-vacuousness was proven**: with
  the `!analysis` guard temporarily removed from `coordinator.mjs`, the pin correctly goes red
  (`status === 'failed'`); with the guard restored it stays green. TC-23c remains the negative
  control (same `requiredEffects`, NO `analysis` → `policy_failure`).

## Drift corrections (blue-team D1, D4)

- **D1 (header mechanism wrong):** the suite header and the TC-04/TC-05 assertions claimed "the
  group-only member never starts a run". Verified wrong — the member DOES start a ONE-worker run
  today (`wave.mjs:204-207` builds a default route and `baton.runs.start` succeeds; the handle's
  `runs` getter filters truthy `entry.run`). The header ground-truth note and both assertion
  messages now state the honest mechanism: the red failure is at the SIZE worker count
  (`ownership.workerIds.length === 2/3`), which is exactly the stage the contract names.
- **D4 (survived token):** the header's "every impl/src file" absence claim was false for
  `survived` — it exists in `coordinator.mjs:449,481-482` as the mutation-survival token
  (`survivedMutants`). Header now scopes the cell-vocabulary absence claim to the non-survived
  tokens and states that `survived` exists only in the mutation-survival sense, never as a cell
  aggregate field.

## Rejected / deferred items (with reasons)

- **B7 literal fix — REJECTED on the code.** The blue-team's proposed brief
  `{analysis:true, requiredEffects:['repository_edit']}` cannot exist: BU-2-1
  (`messages.mjs:92-98`) refuses the pair as a self-contradiction at construction. The pin
  therefore asserts the gate's runtime behavior against the injected contradictory state instead,
  which is the only reachable form of the row's intent. Documented in the test (lines 1282-1289).
- **T4 (composition-shortcut source assertion) — DEFERRED.** The blue-team asked for a mint check
  that the cell plan carries no v3 workflow record / role catalog / `attempts` / budget division
  and identical `exactPlanRoutes(group.seat)` routes. TC-04/TC-05 already assert distinct worker
  identity under one runId and one `steering.registered`, and the cell-vocabulary absence is
  pinned; the *route-equality / no-composition* check is source assertion over the mint branch that
  does not yet exist. Deferred to the implementation wave (it can only be written once the cell
  branch's actual shape is known), rather than guessed at a stage the suite would not verify.
- **T5 (TC-01 thin) — ACCEPTED AS-IS.** TC-01 pins admission + the detached single-member receipt
  shape; closed-shape *rejection* is TC-02/TC-03's duty and the missing `wave_group_invalid` row
  remains a named contract gap (already flagged in the blue-team coverage map).
- **T6 (TC-17 over-pins the number) — ACCEPTED AS-IS.** `MAX_CELL_SIZE === 64` is the contract's
  named bound and `TC-17b` pins the derivation anchors (`wave.mjs:163` member ceiling and
  `MAX_WAVE_PROGRESS_BYTES`); the documentation/derivation half of the campaign law stays a
  gap noted in the coverage map. The number is not silent: its derivation anchors are asserted.
- **D6 / TC-18 "byte-identical" naming — ACCEPTED AS-IS (naming note).** The pins are
  property-identity regression pins, not literal byte comparisons; the header already described
  them as property pins.

## Run record (exact, after fold)

```
$ node --test impl/test/tight-cell-red.test.mjs
ℹ tests 39
ℹ suites 0
ℹ pass 9
ℹ fail 30
exit code 1
```

Stable across consecutive runs (identical 9/30 split each time). Every red row fails at its own
named stage — 30 distinct stage names, none shared across tests (verified by extracting
`stage[…]` literals and `assertTokenInApplication` stage args per test block). The 9 pins
(TC-07, TC-09b, TC-17b, TC-18, TC-18a, TC-22b, TC-23b, TC-23c, D-loose) are green for the same
legitimate reasons the blue team scored them (7 SOUND + 1 SOUND-with-caveat + TC-23b now
non-vacuous).

No implementation file was modified by this fold (`git status` shows only
`impl/test/tight-cell-red.test.mjs` changed; `impl/src/*` restored clean after the guard-removal
verification for B7). The execution contract of the harness is unchanged.
