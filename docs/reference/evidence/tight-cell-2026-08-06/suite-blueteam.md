# Tight-cell (#102) red-first suite — blue-team verification report

Contract: `docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md` (v1.1 + v1.2
context-depth amendment appended).
Suite: `impl/test/tight-cell-red.test.mjs`.
Date: 2026-08-06. Verifier: blue team (independent of the suite author and the contract author).

**Verdict: NOT-READY.** The run split is exactly as claimed (24 red / 9 green), every red row
fails at its own named stage, and the 9 pins are green for genuinely legitimate reasons on the
current machinery — but two red rows are **provably un-passable** as written (they can never go
green even on a correct implementation), one pin is vacuous, and a large share of the red rows
are admission-only or source-token-only assertions that a **plausible wrong implementation can
satisfy without implementing the named behavior**. The four depth rows and three board/trust
rows go green the moment the cell mint lands, before any of the depth / per-worker-grant /
per-member-key / editing-division behavior exists. Blockers are numbered at the end.

---

## 1. Run record (exact)

```
$ node --test impl/test/tight-cell-red.test.mjs
ℹ tests 33
ℹ suites 0
ℹ pass 9
ℹ fail 24
exit code 1
```

Stable across two consecutive runs (identical 9/24 split both times). The suite's own header
claims "stable across three consecutive runs (pass 9 / fail 24 each)" — consistent with what
was observed here.

Failing rows — 24 distinct stage names, none shared, each named in its assertion:

| stage | test | fails at line | failing assertion |
|---|---|---|---|
| group-field-admission-missing | TC-01 | 349 | `sent.ok` (group key refused → `application_wave_start_invalid`) |
| group-seat-missing-refusal | TC-02 | 365 | `sent.code === 'wave_group_seat_missing'` (actual: `application_wave_start_invalid`) |
| group-route-conflict-refusal | TC-03 | 381 | transport `sent.code === 'wave_group_route_conflict'` (actual: `application_wave_start_invalid`) |
| cell-mint-missing | TC-04 | 408 | `ownership.workerIds.length === 2` (actual: **1**) |
| cell-identity-missing | TC-05 | 424 | `ids.length === 3` (actual: **1**) |
| cell-spawn-refusal-missing | TC-06 | 438 | source token `cell_spawn_refused` absent |
| per-worker-grant-mint-missing | TC-08 | 755 | `sent.ok` (blocked at mint) |
| cell-broadcast-receipt-missing | TC-09 | 593 | `sent.ok` (blocked at mint) |
| cell-quorum-aggregate-missing | TC-11 | 450 | source token `cell: { size` absent |
| cell-below-quorum-terminal-missing | TC-12 | 462 | source token `cell_below_quorum` absent |
| cell-exact-breach-missing | TC-13 | 470 | source token `cell_exact_breach` absent |
| cell-member-lost-missing | TC-14 | 477 | source token `cell_member_lost` absent |
| first-node-truth-missing | TC-20 | 485 | source token `cell.degraded` absent |
| survivor-set-missing | TC-26 | 493 | source token `cell.lost` absent |
| collector-result-law-missing | TC-15 | 505 | source token `cell.captures` absent |
| per-member-reply-slot-missing | TC-21 | 533 | `delivered.length === 1` for member 2 (actual: 0 — member 2's reply refused `message_depth_exceeded`) |
| cell-size-bound-missing | TC-17 | 801 | `waveModule.MAX_CELL_SIZE === 64` (actual: `undefined`) |
| per-member-mint-key-missing | TC-22 | 765 | `sent.ok` (blocked at mint) |
| cell-editing-division-missing | TC-23a | 722 | `sent.ok` (blocked at mint) |
| cell-delivery-mode-gate-missing | TC-24 | 611 | source token `wave_cell_delivery_unsupported` absent |
| cell-mate-task-tier-read-missing | D1 | 674 | `sent.ok` (blocked at mint) |
| direct-shared-write-missing | D2 | 686 | `sent.ok` (blocked at mint) |
| cell-reply-visibility-missing | D3 | 697 | `sent.ok` (blocked at mint) |
| shared-worktree-option-missing | D4 | 708 | `sent.ok` (blocked at mint) |

Passing rows (9 pins): TC-07, TC-09b, TC-17b, TC-18, TC-18a, TC-22b, TC-23b, TC-23c, D-loose.

**Every red row fails at its own named stage** — verified by cross-referencing each failing
assertion line against the test source. None fails on a fixture/setup error before the named
assertion (the `waveFixture`/`coordinatorSetup` fixtures are exercised green by the pins, so the
fixtures themselves are sound). The transport-seam rows all fail with the *correct red-state
diagnosis*: the `group` key is refused wholesale at `_normalizeWaveStart`'s closed member key set
(`application.mjs:11596-11600`, keys `['role','objective','exact','scope']`) with
`application_wave_start_invalid` — exactly the contract's ground truth 3.

Source-token absence claims were re-verified NUL-safe (`grep -an`) against `application.mjs`:
`cell_spawn_refused`, `cell: { size`, `cell_below_quorum`, `cell_exact_breach`, `cell_member_lost`,
`cell.degraded`, `cell.lost`, `cell.captures`, `wave_cell_delivery_unsupported` — **0 hits each**.
`survived` has **0 hits in application.mjs** (it does exist in `coordinator.mjs` in the mutation-
survival sense — see drift finding D4).

NUL discipline honored by this verifier: `application.mjs` (3 NUL bytes) and
`coordination-store.mjs` (3 NUL bytes) were read only via targeted `sed -n` ranges and
`grep -an`; `coordinator.mjs` and `claude-session.mjs` are NUL-free plain text (perl byte count).

---

## 2. Coverage map — contract decision/requirement → enforcing test(s)

Legend: 🔴 red row, ✅ pin (green today). **GAP** = no test in this suite.

### Decision 1 — closed `group` field `{editing?, quorum?, seat, size, strict?}`
| requirement | test |
|---|---|
| `waves.start` accepts the closed `group` field | 🔴 TC-01 |
| group without `seat` → `wave_group_seat_missing` | 🔴 TC-02 *(broken — see blockers B2)* |
| member route + `group.seat` → `wave_group_route_conflict` at BOTH seams | 🔴 TC-03 |
| `MAX_CELL_SIZE` named count bound = 64 | 🔴 TC-17 |
| derivation anchors (`wave.mjs` member ceiling 64, `MAX_WAVE_PROGRESS_BYTES`) | ✅ TC-17b |
| `wave_group_invalid` — malformed closed shape incl. `strict:true`+`quorum<size` contradiction, out-of-range `editing` indexes | **GAP** |
| `seat` is a route object and ONLY a route object | **GAP** |
| `editing` closed sorted array of member indexes, default ALL | **GAP** (admission only via TC-23a; shape rules unasserted) |

### Decision 2 — N-spawns-one-run, identity, per-worker receipts, trust-gate propagation
| requirement | test |
|---|---|
| cell member starts ONE run, size homogeneous plan nodes | 🔴 TC-04 |
| size distinct workerIds / taskIds / task.runId under one runId, `steering.registered` once | 🔴 TC-05 *(steering assert un-passable — blockers B1)* |
| per-worker spawn refusal recorded `cell_spawn_refused`, never aborts run | 🔴 TC-06 |
| never-started worker receipted `cell_member_lost` | 🔴 TC-14 |
| `group.editing` → `analysis:true` on non-listed briefs | 🔴 TC-23a *(admission-only — blockers B3)* |
| node keys `cell:<waveRole>:<index>` distinct/stable/sorted | **GAP** (mentioned in TC-04 message only, never asserted) |
| NO workflow record / role catalog / `attempts` / strategy/workspace/join / budget division | **GAP** — nothing asserts the cell is *not* a composition |
| IDENTICAL routes + objective on every node | **GAP** |
| wave handle `cell` sub-view `{role, runId, size, workers:[{workerId,taskId,taskVersion,spawnError}]}` | **GAP** |
| `wave_cell_start_invalid` (malformed cell run request) | **GAP** |

### Decision 3 — shared-horizon law
| requirement | test |
|---|---|
| run-scoped nodes serve every worker of the run; foreign runs refuse | ✅ TC-07 |
| cell-mate task-tier read (v1.2 D-depth-1) | 🔴 D1 *(admission-only — blockers B3)* |

### Decision 4 — self-division via board (per-worker grants)
| requirement | test |
|---|---|
| claimGrant to cell runId mints size per-worker grants | 🔴 TC-08 *(admission-only — blockers B3)* |
| per-member mint keys `<sendKey>:<workerId>` — no `board_replay_conflict` | 🔴 TC-22 *(admission-only — blockers B3)* |
| today's first-worker resolution seam | ✅ TC-22b |
| report owner CAS (second worker cannot report on first's claim) | **GAP** in this suite (relies on #78's `board-workerhalf` suite; contract's TC-08 oracle names it) |
| `board_worker_scope_refused` constant | **GAP** in this suite (inherited #78 vocabulary) |

### Decision 5 — broadcast receipts, reply law, delivery modes
| requirement | test |
|---|---|
| cell send routes C5 `{runId}` fan-out, receipt `delivered`/`targetCount=size` | 🔴 TC-09 (has a real post-mint behavioral follow-up at 598-607 — the best-formed blocked row) |
| C5 fan-out exists at the coordinator seam | ✅ TC-09b |
| per-member reply slots; member's 2nd reply refuses `message_depth_exceeded` | 🔴 TC-21 (behavioral, coordinator seam — good teeth) |
| non-cell single-worker reply lane byte-identical | ✅ TC-18a |
| `now`/`turn` to cell refuses `wave_cell_delivery_unsupported`; nudge-only | 🔴 TC-24 |
| **TC-10** — partial delivery (`delivered < size`) is an honest receipt, no throw | **GAP** — entire row missing from suite |
| fence CAS dropped for cell sends (named loss) | **GAP** — no assertion that a cell send carries no fence |

### Decision 6 — quorum terminal semantics (kernel work)
| requirement | test |
|---|---|
| cell aggregate `{size, quorum, survived, lost, degraded}` derived over ALL nodes | 🔴 TC-11 *(source-only — teeth T1)* |
| `lost > size - quorum` → `cell_below_quorum` | 🔴 TC-12 *(source-only)* |
| `strict:true` + any loss → `cell_exact_breach` | 🔴 TC-13 *(source-only)* |
| never-started worker → `cell_member_lost` receipted | 🔴 TC-14 *(source-only)* |
| **TC-20** — worker #1's terminal neither settles nor fails the cell (first-node truth) | 🔴 TC-20 *(source-only — teeth T1, the special-attention case)* |
| **TC-26** — `survived` = `{completed, result_ready}`; stopped/denied count as losses | 🔴 TC-26 *(source-only)* |
| **TC-25** — quiescence ordering law (grant revoke → checkpoint capture → run stop → outcome mint) | **GAP** — entire row missing from suite |
| degraded phase VALUE; cell.lost per-member causes | source tokens only (see rows above) |

### Decision 7 — designated-collector law
| requirement | test |
|---|---|
| `cell.captures` per-member digests; collector index 0; resultSha = collector pin | 🔴 TC-15 *(source-only — teeth T2, the special-attention case)* |
| collector NOT first-completer → resultSha still collector's digest | **GAP** (no behavioral test) |
| degraded outcome names covered survivors + whether collector survived | **GAP** |
| below-quorum / exact-breach → `resultSha: null` | **GAP** |

### Decision 8 — failure vocabulary (closed code set)
| code/phase | test |
|---|---|
| `wave_group_invalid` | **GAP** |
| `wave_group_seat_missing` | 🔴 TC-02 *(broken)* |
| `wave_group_route_conflict` | 🔴 TC-03 |
| `wave_cell_start_invalid` | **GAP** |
| `wave_cell_delivery_unsupported` | 🔴 TC-24 |
| `cell_spawn_refused` | 🔴 TC-06 |
| `cell_member_lost` | 🔴 TC-14 |
| `cell_below_quorum` | 🔴 TC-12 |
| `cell_exact_breach` | 🔴 TC-13 |
| `'degraded'` phase | 🔴 TC-11/TC-20 (tokens) |
| composed codes (`context_scope_forbidden`, `message_depth_exceeded`, `run_not_active`, …) | ✅ TC-07 / TC-18a / TC-21 (+ #78 & bd3 suites) |

### Decision 9 — the red-first suite
The suite itself is the deliverable. See teeth/verdict sections.

### Contract table rows absent from the suite
**TC-10, TC-16 (no clocks/turn limits), TC-19 (end-to-end #74 loop), TC-25** have no red row.
TC-16's "no clock/TTL/turn field" and the campaign "No Arbitrary Numeric Limits" documentation
half of TC-17 are unpinned (TC-17 pins the *number* 64 but never verifies the derivation or the
documentation is present — a hard-coded `64` with no comment passes it).

### v1.2 context-depth amendment
| depth | row | note |
|---|---|---|
| D-depth-1 cell-mate task tiers | 🔴 D1 | admission-only — no post-mint read assertion |
| D-depth-2 direct shared-tier writes + cell nonce | 🔴 D2 | admission-only — no write assertion |
| D-depth-3 message visibility to cell-mates | 🔴 D3 | admission-only — no visibility assertion |
| D-depth-4 `group.worktree:'shared'` | 🔴 D4 | admission-only — no capture assertion |
| D-loose default unchanged | ✅ D-loose | sound (see §3) |
| honesty invariants (UNTRUSTED framing, zero promotion weight, BD3-A intersect-after) | **GAP** | no depth test asserts them |

---

## 3. Per-pin verdicts (FALSE-GREEN hunt)

Each green pin is scored against the question: *could it pass for the wrong reason — vacuous
assertion, staged setup that cannot fail, or asserting the fixture rather than the system?*

| pin | verdict | evidence |
|---|---|---|
| **TC-07** shared-horizon law | **SOUND** | Real machinery exercised: knowledge node seeded under `run:cell` serves worker 2 via `_runHorizonNodeIds` (`coordinator.mjs:11060-11078`, intersect after lookup at `10634-10657`); foreign-run node absent from the result body; foreign finding-by-id read throws `context_scope_forbidden` (`coordinator.mjs:10653-10657`) → `ok:false`, `result` matches `/scope|…/`. The refusal-code regex is loose (`/scope\|horizon\|not_found/`) — a hypothetical `not_found` masquerade would also pass — but the *no-leak* assertion (`!body.includes('foreign-run secret')`) is the load-bearing check and is sound. |
| **TC-09b** C5 fan-out receipt | **SOUND** | Direct `sendMessage({to:{runId:'run:fan'}})` against the real fan-out (`coordinator.mjs:6835`), both workers ack via the scripted adapter, receipt `{result:'sent', delivered:2, targetCount:2}` (`coordinator.mjs:6893-6897`). Cannot pass without the fan-out existing. |
| **TC-17b** derivation anchors | **SOUND** | `MAX_WAVE_PROGRESS_BYTES` is a real export (`wave.mjs:21`); `/membersInput\.length > 64/u` matches `wave.mjs:163` verbatim. |
| **TC-18** loose form byte-identical | **SOUND** (name overstates) | Starts a real loose wave (member-level `harness/model/effort`), asserts one run/one worker via `run.status().ownership.workerIds` and `coordinator.list()`, then sends `now`/`turn`/`nudge` — all accepted, all targeting the single worker, with the first-worker lane (`application.mjs:11523-11524`). Not *literally* byte-identical (no stored baseline / diff); it is a property-identity pin on the contract's named loose surfaces. Non-vacuous: `workerIds.length` must be exactly 1 (a not-yet-spawned worker yields 0 and fails). Does not verify the *delivery mode was honored* (only that it was accepted) nor the fence CAS path — both acceptable for this pin's stated scope, but worth noting. |
| **TC-18a** single-reply slot | **SOUND** | Real reply lane: first reply admitted, second reply refused `message_depth_exceeded`, reply-to-reply refused — all against the actual `parent.depth >= 1 \|\| parent.reply` gate (`coordinator.mjs:12467-12470`) and single-slot write (`coordinator.mjs:12511`), observed via `message.delivered` / `message.rejected` events. |
| **TC-22b** first-worker resolution | **SOUND** | Two live workers under `run:two`; `waves.send` resolves `worker[0]` (`application.mjs:11523-11524`), receipt is `{schemaVersion, runId, result, target}` with **no** `delivered`/`targetCount`, exactly one prompt to worker 1. This is precisely the seam the per-member mint must replace. |
| **TC-23b** analysis hatch | **VACUOUS** | The brief is `{analysis:true, requiredEffects:[]}`. The required-effect gate fires only when `!brief.analysis && requiredEffects.includes('repository_edit')` (`coordinator.mjs:12839-12849`) — with `requiredEffects:[]` the gate is inert *regardless of `analysis`*. The assertion `status !== 'failed'` would pass even if `analysis:true` were completely ignored (or removed). It does **not** isolate the TG5 hatch. Fix in blocker B7. |
| **TC-23c** safe direction | **SOUND** | Brief `{requiredEffects:['repository_edit']}`, diffless capture → gate fires → `required_effect_absent` → `policy_failure` → task `failed` (`coordinator.mjs:12839-12849,13719-13723`). Directly pins that an idle editing member is still killed — the safe direction. (The member is a plain loose worker, not literally a cell `editing` member; adequate for the baseline.) |
| **D-loose** task-tier invisibility | **SOUND** | `writeScratchpad` lands the note with matching worker auth (`coordination-store.mjs:13783+`), the read port constructs `(runId, 'shared')` server-side (`coordinator.mjs:10701-10703`) with `runId` derived from the worker's task (`coordinator.mjs:10584`) — so the read *succeeds* and the worker-tier note genuinely does not serve. Not vacuous: had the read refused with `context_scope_forbidden`, the body would still omit the note, but the fixture's read resolves `runId` and returns a served result, so the isolation is what is actually being observed. |

**Net: 7 SOUND, 1 VACUOUS (TC-23b), 1 SOUND-with-caveat (TC-18).** No pin is a staged-wrong
false green; TC-23b is the one pin that would stay green under a broken implementation of what it
claims to pin.

---

## 4. Teeth flags — would a plausible WRONG implementation actually fail the red row?

### T1 (HIGH) — the quorum row set does NOT fail the first-node-settles-the-cell shallow behavior
**Special-attention Q1: the answer is NO.** All six quorum rows (TC-11, 12, 13, 14, 20, 26) are
`assertTokenInApplication` source-string checks against `application.mjs`. A wrong implementation
that keeps `projection.nodes[0]` as the sole source of phase/terminal/result
(`application.mjs:7393-7404`, ground truth 13) and *names* the vocabulary — e.g. emits
`cell: { size, quorum, survived: nodes[0].terminal ? 1 : 0, lost: [], degraded: false }` in the
outcome — would land every asserted token (`cell: { size`, `survived`, `cell.degraded`, `cell.lost`,
`cell_below_quorum`, `cell_exact_breach`, `cell_member_lost`) and pass all six rows while the
cell still settles/fails on worker #1's terminal. The one behavioral probe the contract's TC-20
oracle demands — *worker #1 resting while #2/#3 still run does not settle the cell; worker #1
dying while quorum is reachable does not fail it* — has no behavioral test anywhere in the suite.

### T2 (HIGH) — the collector-law row does NOT fail a first-completer capture
**Special-attention Q2: the answer is NO.** TC-15 is a single source-token check for `cell.captures`.
A wrong implementation that keeps the run result as the FIRST worker's capture
(`application.mjs:7393-7404`, ground truth 11/13) and merely *receipts* a per-member
`cell.captures` digest list would pass TC-15. The distinguishing law — `resultSha` equals the
*collector's* (member index 0) pin **even when the collector is not the first completer**, with
siblings checkpoint-only — is never behaviorally asserted.

### T3 (HIGH) — seven red rows go green on the cell mint alone, before the named behavior exists
**Special-attention Q3: D1-D4 are "covered" only as names.** D1, D2, D3, D4, TC-08, TC-22, TC-23a
are each a **single `assert.ok(sent.ok)`** blocked at the transport seam. Once the group field is
admitted and the cell run can be minted, all seven go green **immediately** — with no per-worker
grants (TC-08), no per-member mint keys (TC-22), no `analysis:true` propagation (TC-23a), and
none of the four depth behaviors (D1-D4) existing. The suite header states: *"the post-mint
behavioral bindings follow the mint assertion so a wrong implementation that mints the cell but
not the depth lands on the depth assertion"* — **there are no such follow-up assertions in the
code.** The header is aspirational; the rows are admission-only. TC-09 is the single well-formed
blocked-behavioral row (it has real post-mint assertions at 598-607).

### T4 (MEDIUM) — TC-04/TC-05 do not distinguish the cell branch from a composition shortcut
A wrong implementation that reuses the composition idiom (`application.mjs:4481-4491` — N nodes
under one run) would satisfy TC-04 (workerIds.length === size) and TC-05 (distinct workerIds /
distinct taskIds / every task.runId === cellRunId / one steering.registered) while violating
Decision 2's forswears: the v3 workflow record, role catalog, `attempts` block, strategy/
workspace/join, per-node route variation, and `workflowNodeBudget` division. Nothing asserts "no
workflow record / no role catalog / identical routes and objective per node / no budget
division". If the composition branch is reachable for a group-only member, the mint rows would
not catch the shortcut.

### T5 (LOW) — TC-01 only pins admission + detached receipt shape
TC-01 asserts the call succeeds and the receipt is `{schemaVersion, waveId, members:[{role, runId}]}`
(a shape the current `startWave` already returns, `application.mjs:11469-11472`). It does not
assert closed-shape *rejection* of a malformed `group` — that duty falls to TC-02/TC-03 (and the
missing `wave_group_invalid` row). Acceptable, but thin on its own.

### T6 (LOW) — TC-17 over-pins the number, under-pins the law
`waveModule.MAX_CELL_SIZE === 64` forces exactly 64, while the contract's OQ5 explicitly allows
re-derivation from the byte math ("the number must be re-derived… and named") if the run-view
bounds require a smaller cap. The campaign "No Arbitrary Numeric Limits" law also requires the
number to be *documented with its derivation* — the test checks neither documentation nor
derivation; a naked `export const MAX_CELL_SIZE = 64` passes.

---

## 5. Drift findings — suite header vs contract surface names

| # | finding | evidence |
|---|---|---|
| D1 | Header claim *"the group-only member never starts a run (startError recorded, wave.mjs:204-207)"* is **false**. The group-only member **does** start a run today. | TC-04 fails at line 408 with `1 !== 2`, and TC-05 at line 424 with `1 !== 3` — meaning `wave.runs.get('cell')` was truthy (line 404/419 passed) and `entry.run` was set. `createWave`'s loop builds `route = {harness, model, effort}` (all `undefined` for a group-only member) and calls `baton.runs.start` successfully (`wave.mjs:193-212`); the handle `runs` getter filters only truthy `entry.run` (`wave.mjs:504-507`). The run starts with one worker. The *red-state conclusion* ("one member → one run/one worker") is correct; the stated *mechanism* is wrong. |
| D2 | Header claim of post-mint behavioral bindings on the D rows (and TC-08/22/23a) is **false** — no such assertions exist (see T3). | D1-D4 end at their single `assert.ok(sent.ok)`; TC-08 at 755, TC-22 at 765, TC-23a at 722. |
| D3 | Row inventory silently omits contract table rows **TC-10, TC-16, TC-19, TC-25**. The inventory block (lines 43-78) jumps TC-10, TC-16, TC-19, TC-25 without note. | Contract table `tight-cell-contract.md:739-766` lists TC-01..TC-26; the suite implements 20 of the 26 plus D1-D4, and pins TC-07/09b/17b/18/18a/22b/23b/23c/D-loose. |
| D4 | Header line 142 *"every token below is verified ABSENT from every impl/src file today"* is **false for `survived`**: it exists in `coordinator.mjs` (mutation-survival: `survivedMutants`, `coordinator.mjs:449,481-482`). The *assertions* are safe because `assertTokenInApplication` reads `application.mjs` only, where `survived` is genuinely absent — but the header's "every impl/src file" phrasing overstates. |
| D5 | TC-02's `// no seat` comment is **false**: `startCellRun` unconditionally injects `seat: SEAT` (`group: { seat: SEAT, size, ...group }`, line 336), so the "seatless" group sent by TC-02 actually carries `seat: SEAT`. This is not just a comment bug — it makes the row un-passable (blocker B2). |
| D6 | "byte-identical" naming (TC-18/18a) overstates the mechanism — the pins are property-identity regression pins, not literal byte comparisons. Acceptable design, worth a naming note. |

---

## 6. Final verdict: **NOT-READY**

The suite is honestly red today (24/9, all at named stages, no fixture false-reds) and its pins
are, with one exception, genuinely green on the existing machinery. But it is not a gate the
implementation wave can be held to: two rows cannot pass even on a correct implementation, most
of the named cell/board/depth behaviors have no behavioral assertion that a wrong implementation
would trip, and four contract rows are absent. Blockers below are ordered by severity.

### Blockers

**B1 — TC-05's `steering.registered` predicate can never match; the row can never go green.**
- What: `const steering = fx.coordination.events().filter((e) => e.kind === 'steering.registered' && …)` (line 432). `steering.registered` is written via `recordDriver('steering.registered', …)` (`application.mjs:4515-4530`), and `recordDriver` appends an event whose kind is **`driver.recorded`** with **`payload.kind === 'steering.registered'`** (`coordination-store.mjs:13102-13108`; event shape `{kind: 'driver.recorded', payload: {kind: 'steering.registered', …}}` at `coordination-store.mjs:1458+`). Every other reader in the tree uses the two-level predicate (`coordinator.mjs:2124`, `coordinator.mjs:11255`).
- Why: `e.kind === 'steering.registered'` never matches any event, so `steering.length` is always 0 and `assert.equal(steering.length, 1)` fails even after a correct cell implementation records steering exactly once.
- Fix: filter `e.kind === 'driver.recorded' && e.payload?.kind === 'steering.registered' && e.payload?.runId === view.runId`.

**B2 — TC-02 never tests a seatless group; the row can never go green.**
- What: `startCellRun` builds `group: { seat: SEAT, size, ...group }` (line 336), so TC-02's `group: { size: 2 }` (comment `// no seat`) actually sends `group: { seat: SEAT, size: 2 }`. A correct implementation accepts that group (seat present), so `sent.ok` becomes `true` and the first assertion `assert.equal(sent.ok, false)` (line 362) fails.
- Why: the row's premise ("group without its closed route seat") is not what the row sends; the seat-injecting helper makes the wave_group_seat_missing refusal unreachable.
- Fix: give `startCellRun` a way to omit the seat (e.g. pass `group: { seat: undefined, size: 2 }`, or add an option like `seat: null` that skips the default), so TC-02 sends a genuinely seatless group.

**B3 — Seven red rows (D1, D2, D3, D4, TC-08, TC-22, TC-23a) are admission-only: they go green on the cell mint and never pin the named behavior.**
- What: each is a single `assert.ok(sent.ok)` blocked at the transport seam (D1:674, D2:686, D3:697, D4:708, TC-08:755, TC-22:765, TC-23a:722). The header claims "the post-mint behavioral bindings follow the mint assertion" — no such assertions exist.
- Why: an implementation that admits `group` and mints the cell run — but implements **none** of the four context depths, **no** per-worker grants, **no** per-member mint keys, and **no** `analysis:true` editing division — passes all seven rows. The suite would report the depth/board/trust work as pinned when it is not.
- Fix: add the post-mint behavioral assertions the header promises: D1 — member 2 `CONTEXT_READ` of member 1's task-tier note (no elevation); D2 — two members write the shared tier with per-member receipts, a stale-fence write refuses, no KG candidate mints; D3 — a member's reply to the cell broadcast appears framed in a cell-mate's next frame; D4 — `group.worktree:'shared'` produces one worktree/capture; TC-08 — `waves.send(claimGrant)` mints exactly `size` grants with distinct `(workerId, taskId, taskVersion)`; TC-22 — `size` mints under one send idempotencyKey succeed, and a changed-content retry for the same member refuses `board_replay_conflict`; TC-23a — the non-listed member's task brief carries `analysis: true` while a listed member's does not.

**B4 — The quorum rows do not fail the first-node-settles shallow behavior (special-attention Q1).**
- What: TC-11/12/13/14/20/26 are source-token assertions only (§4 T1).
- Why: a wrong implementation that keeps `nodes[0]` terminal truth and only *names* the aggregate block passes all six. The contract's TC-20 oracle — worker #1 resting must not settle the cell, worker #1 dying must not fail it while quorum is reachable — is behaviorally untested.
- Fix: add at least one behavioral quorum row (TC-20's oracle): mint a size-3/quorum-2 cell, rest worker #1 only, assert no outcome mints while #2/#3 are live; then kill worker #1 while quorum is reachable, assert the cell does not fail; then reach `quorum <= survived < size` and assert `degraded` with `cell.lost` receipted. This row must exercise the aggregate, never `nodes[0]`.

**B5 — TC-15 does not fail a first-completer capture (special-attention Q2).**
- What: TC-15 is a source-token check for `cell.captures` only (§4 T2).
- Why: a first-completer implementation that keeps the first worker's result as `resultSha` and additionally receipted `cell.captures` digests would pass.
- Fix: add a behavioral collector-law row: size ≥ 2 cell where a non-collector (index 1) completes and commits before the collector (index 0); assert the wave outcome's single entry has `resultSha` equal to the **collector's** capture digest, and `cell.captures` carries every member's digest sorted by member index.

**B6 — Contract rows TC-10, TC-16, TC-19, TC-25 are missing from the suite.**
- What: no red row for partial-delivery honesty (TC-10), no-clocks/turn-limits (TC-16), the end-to-end #74 loop (TC-19), or the quiescence ordering law (TC-25).
- Why: TC-19 is the only row that proves the *whole* cell loop (shared board → contend → claim → report → `completed`/`degraded` → single collective result) is executable; TC-25 pins the "never mint while a member still writes" ordering (grant revoke → checkpoint capture → run stop → outcome); TC-10 pins the honest `delivered < targetCount` receipt shape; TC-16 pins the campaign no-clock law for the new vocabulary.
- Fix: add the four rows per their contract oracles. TC-19's receipt must record wave/member binding, one runId + size worker identities, size grants with member coordinates, worker-attributed claim/report events, the broadcast receipt, the collective terminal, and the single collective `resultSha`, keyed on durable ids/digests/events (never clocks).

**B7 — TC-23b pin is vacuous (does not pin the `analysis:true` hatch).**
- What: brief is `{analysis:true, requiredEffects:[]}`; the required-effect gate is inert with an empty `requiredEffects` regardless of `analysis` (`coordinator.mjs:12839-12849`).
- Why: the pin would stay green if the TG5 hatch were removed entirely.
- Fix: make the pin isolate the hatch — brief `{analysis:true, requiredEffects:['repository_edit']}` with a diffless capture → assert the task is **not** policy-killed. Keep TC-23c as the negative control (same brief without `analysis:true` → policy-killed).

### Non-blocking observations
- **T4 (medium):** add a source assertion or a mint check that the cell plan carries no v3 workflow record / role catalog / `attempts` block / budget division, and that all node routes equal `exactPlanRoutes(group.seat)` — otherwise the composition shortcut is invisible to TC-04/TC-05.
- **T6 (low):** TC-17 should also assert the derivation/documentation of `MAX_CELL_SIZE` (or accept a re-derived value per contract OQ5).
- **D1 (drift):** fix the header's "group-only member never starts a run" claim — the member *does* start a one-worker run today; the red failure is at the worker count, which is the honest stage.

The suite's split (24 red / 9 green), its stage discipline, and its pin discipline are genuine.
The blockers above are about **green-state soundness** (B1/B2 make correct implementations fail)
and **green-state teeth** (B3/B4/B5 let wrong implementations pass), not about the current red
state — which is exactly what a blue-team gate review of a red-first suite is for.
