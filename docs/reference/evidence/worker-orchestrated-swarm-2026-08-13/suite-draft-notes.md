# Issue #74 — worker-orchestrated swarm rung: red-first suite draft notes

- **Suite:** `impl/test/worker-orchestrated-swarm-red.test.mjs`
- **Contract:** `contract-fold.md` v1.1 (source of truth — the fold-map + D1.2/D1.3/D1.4 +
  the narrowed A5), `worker-orchestrated-swarm-contract.md` v1.0 (the D/G grounding it keeps),
  `contract-redteam.md` (the attack surface). The v1.1 acceptance pins are A1–A10 + the folded
  laws D1.2 / D1.3 / D1.4 / D2 / D3 / D4.
- **Date:** 2026-08-13
- **Split (verified):** `node --test impl/test/worker-orchestrated-swarm-red.test.mjs` from the
  repo root at HEAD `c910836`, run twice — **tests 15 · pass 8 · fail 7**, stable across both
  runs. Every red row fails at its NAMED stage (assert message names the stage); the eight green
  rows are the substrate pins and MUST stay green.
- **Done-when (from the dispatch):** "Baton preserves exact route, result, and cleanup truth."
  The green legs pin exact-route profile admission (A6/P-A9), result truth (`resultSha` +
  `report` + the truthful steering trail, P-A3g/A3), and cleanup truth (every fixture tears down
  its mkdtemp repo + log dir in `t.after`, no residue). The red rows are the three laws that must
  land for that preservation to be enforceable: D1.2 (read law), D1.3 (truthful trail), D2 (the
  authority boundary).

## Invented surfaces (all absent at HEAD; accessed absence-proof)

Every invented surface is driven through surfaces that EXIST at HEAD (`waves.run`
`application.mjs:12512`, `waves.start` `:12502`, `waves.list` `:12508`,
`run.scratchpad.read` `:12470`, `run.answer` `:12574`, `runs.list` `:12536`, the standalone
`implementContractRecipe` `recipes.mjs:549`). The invented behavior is asserted BEHAVIORALLY —
a missing code at HEAD is a red assertion, never a load-time crash (no invented export is
imported statically).

| Surface | Exact signature | Where pinned |
|---|---|---|
| The restricting authorize at the deployment seam (D1.2) | `authorize(request) → boolean` installed at `application-deployment.mjs:1998` (permissive `async () => true` at HEAD) — a sibling `worker:<role>` read draws `application_unauthorized` | A1 (coordinator partition), A2 (any member partition) |
| The truthful denied/raced answer record (D1.3) | `steering[]` entry `{trigger:'answerDecisions', role, requestId, optionId?, outcome:'denied', refusal:<code>}` — key NOT in `answeredKeys`, ask stays pending | A3 (denied via the authorize seam), A3b (raced via a throwing adapter) |
| The `coordinator_authority_forbidden` refusal (D2/A5) | `{code:'coordinator_authority_forbidden', detail:{attempted, gracefulPath}}` — the worker seat reaches a waves.* authority verb | A5 |
| The coordinator route in the `waves.list` roster (D3/A6) | roster member `{role, route:{harness, model, effort}, scope}` — the seat map | A6 |
| The v1.1 example spec's `kind:'brief'` / `kind:'result'` in the steering policy (D4/A8) | `messageOnSpawn.kind` / `signalOnMembersDone.message.kind` accepted by the interpreter | A8 |

## Row map

### Red rows (must FAIL at HEAD at the named stage)

| Row | Stage | Green when |
|---|---|---|
| A1 | `coordinator-read-law-missing` | `implementContractRecipe` admits `role:'coordinator'` with the heavy route preserved (closed recipe fields `{members,name,policy,version}`) **and** the coordinator's wave enforces D1.2 — a sibling read of the coordinator's `worker:coordinator` partition refuses `application_unauthorized`. At HEAD the recipe admits the role but the coordinator is indistinguishable from any row: the sibling read SUCCEEDS → RED |
| A2 | `read-law-missing` | the D1.2 read law is installed: a member reads `worker:<ownId>` + `shared` (both GREEN at HEAD), a sibling `worker:<role>` read refuses `application_unauthorized` at the restricting authorize. At HEAD `application-deployment.mjs:1998` is `async () => true`, so the sibling read SUCCEEDS → RED |
| A3 | `steering-trail-falsified` | a DENIED decision answer (the authorize seam refuses `run.answer` for the waves.run principal) records `{outcome:'denied', refusal:'application_unauthorized'}` and leaves the ask pending. At HEAD `answerDecision` swallows the throw and records `{outcome:'answered'}` (workflow-interpreter.mjs:806-808) — and the key was marked handled before the attempt (`:698`) → RED |
| A3b | `steering-trail-falsified` | a RACED answer delivery (a throwing adapter surfaces `application_run_stopped`) records `{outcome:'denied', refusal:'application_run_stopped'}`. At HEAD the same `try { await handle.answer(...) } catch {}` masks the code and records `'answered'` → RED |
| A5 | `coordinator-authority-forbidden-missing` | a worker-seat principal (`baton:worker:w-1`) reaching `waves.start` draws `coordinator_authority_forbidden` with `{attempted:'waves.start', gracefulPath}`. GREEN leg: the top orchestrator CAN start a wave (the boundary narrows only the worker seat). At HEAD the direct port dispatches before any authority check (`:12502`) and the default authorize is permissive — the worker-seat `waves.start` SUCCEEDS → RED |
| A6 | `seat-route-hidden` | the roster that `waves.run` mints and `waves.list` renders exposes the coordinator's heavy route. GREEN leg: a member route OUTSIDE the deployment profile refuses `wave_member_invalid` with the inner `application_route_not_allowed` preserved (`detail.cause.code` — each member rides the same exact-route admission ordinary `run.start` uses). At HEAD the registry view renders `route:null` for every member (role-only string roster, wave.mjs:180) — the coordinator's seat is HIDDEN → RED |
| A8 | `composition-example-refused` | the VERBATIM v1.1 example spec (coordinator + rows, `kind:'brief'`/`kind:'result'`, objectiveRef-only members, FILE harvest path) drives through `waves.run` to the D6 receipt `WAVE-OK`. At HEAD the example's message kinds are NOT in the interpreter's closed set `['inform','query','steer']` (workflow-interpreter.mjs:44) — the spec refuses `workflow_steering_unknown` before any wave starts → RED |

### Green guards / pins (must stay green at HEAD)

| Row | Pin |
|---|---|
| P-A4 | a coordinator-seat worker has NO baton connection — `discoverBatonConnection` (with a repo authority referencing a missing profile) draws the byte-identical absence refusal `cli_config_invalid: user connection profile is unavailable` (`application-cli.mjs:126`, label call site `:257`), plus static anchors for `readConnectionJson` (`:149`) |
| P-A5-static | the waves.* direct ports (`waves.start` `:12502`, `waves.list` `:12508`, `waves.run` `:12512`) dispatch BEFORE the recursive-session gate throw (`run_orchestrator_command_forbidden`, `:12527-12532`); the #12 codes are NOT claimed for waves.* verbs — the order is pinned so a future widening is caught |
| P-A7 | `WAITING_ON_KINDS` stays the byte-unchanged closed five (`capacity_ceiling, dispatch_pending, plan_approval, provider_stalled, spawning`, actual order); a settled member's `run.status` carries the SINGLE `waitingOn` projection with the honest `null` (never a fabricated `'working'`) |
| P-A8-dir | a DIRECTORY harvest path lands `harvest_miss` → `WAVE-INCOMPLETE` with `basis = manifestDigest` — the file-not-directory law (D4) is pinned at its refusal shape |
| P-A9 | the D6 receipt is EXACTLY the seven sorted keys `{basis, harvest, manifestDigest, outcomes, steering, verdict, waveId}` (workflow-interpreter.mjs:594-602); `WAVE-OK` → `basis:'completed'`; `outcomes` is audit-shaped (per-member `{role, phase, terminal, resultSha, report?}`); the heavy coordinator settles `work_completed` |
| P-A10 | refusal constancy: the facade capability refusal `application_unauthorized` (`application.mjs:3215`), the #105 boundary `message_depth_exceeded` (`coordinator.mjs:12589`), and the reply frame `'body,inReplyTo'` (`claude-session.mjs:161`) stay byte-unchanged; the D6 receipt return is a literal object (no assembled sorted-key list); no clock enters any refusal |
| P-D1.4 | the escalation sequence is concurrency-bounded (roster ≤64, polled in parallel) and sequentially UNCAPPED — the drive loop stays `while (pending.size > 0 && Date.now() - startedAt < driver.hardCapMs)`, no numeric iteration counter |
| P-A3g | the A3 GREEN side: a DELIVERED decision answer records `outcome:'answered'` only AFTER `handle.answer` returns (the onAnswerEdits land, the member settles) — the machinery works when not denied |

## Design decisions made in the draft (beyond the contract's text)

1. **A1's RED is the D1.2 enforcement, not the recipe admission.** The green leg — the recipe
   admits `role:'coordinator'` with the heavy route and the D6 receipt carries its per-row
   outcome — passes at HEAD. The red is that nothing distinguishes the coordinator: a sibling
   read of `worker:coordinator` succeeds. The green condition is therefore that the coordinator's
   wave enforces D1.2 at the deployment seam (the restricting authorize that
   `application-deployment.mjs:1998` leaves `async () => true`), stage
   `coordinator-read-law-missing`.

2. **`waves.list` NEVER exposes a route at HEAD — the two-seam roster discrepancy.** `createWave`
   (the interpreter/recipe seam, `wave.mjs:180`) mints a role-only STRING roster
   (`members.map((m) => m.role)`); `startWave` (the direct `waves.start` port,
   `application.mjs:11610-11614`) mints the OBJECT roster `[{role, route, scope}]`. The registry
   read side (`waveList`, `application.mjs:11728-11734`) renders string members as
   `route: null, scope: null` and object members WITHOUT route/scope at all (`role, liveness,
   phase, progressClass, attentionCount`). So regardless of which seam minted the wave, the top
   orchestrator cannot see which member is the heavyweight coordinator. The D3 green condition
   (the roster + `waves.list` expose the coordinator's route) needs the registry view to carry
   routes — a registry change, not just a mint-side change.

3. **The D1.3 human-settlement leg is DOCUMENTED, not driven.** The contract's "a later human
   answer settles it" leg requires a live, parked member. After a wave settles and closes, the
   member run is stopped, and `run.answer` draws `application_run_stopped`
   (`_assertRunMutable`, `application.mjs:4246`) — a hermetic mock cannot drive a post-settle
   human answer to a successful settlement. The suite pins the observable truth (the denied
   record, the key NOT handled, the ask left pending) and records the settlement leg as the
   non-hermetic successor it is.

4. **The recipe DRIVE is un-drivable in a minimal fixture — asserted at the admission seam
   only.** `baton.recipes.implementContract` → `runRecipe` → `startRun` →
   `createWaveDriver(...).run(...)` runs the `policy.preflight` doctor check
   (`wave-driver.mjs:308,316,331` — `baton.doctor()` route readiness per member). A minimal
   `BatonApplication` fixture's `doctor()` cannot return ready route rows, so the drive throws
   `wave_driver_route_unready` before any wave starts. The suite therefore asserts
   `implementContractRecipe` at the ADMISSION seam (closed recipe fields, role + heavy route
   preserved) and drives the coordinator wave's semantics through `waves.run` (which EXISTS at
   HEAD). The driver cadence (preflight + one-salt render + settle) is documented here, not
   driven.

5. **A7's `capacity_ceiling` deferral receipt is a documented follow-up, not a row.** The mock
   adapter never reports a full fleet, so the `capacity_ceiling` durable deferral receipt (A7
   green, waiting-vocabulary D5) is not producible hermetically. The suite pins the closed five
   and the honest single `waitingOn: null` projection behaviorally (P-A7); the `capacity_ceiling`
   receipt stays contract text until a seam exists to force it (the real fleet-quota read lives
   in the deployment layer).

6. **A5 narrowing — the pre-gate dispatch is a comment-row + static pin.** Per §D2 OQ1, the
   suite does NOT claim the #12 codes for waves.* verbs. `P-A5-static` pins the ORDER
   (`waves.start`/`waves.list`/`waves.run` dispatch before the gate's
   `context?.sessionAuthority` check and throw) so a future widening — `waves.start`/`waves.run`/
   `waves.stop` added to the recursive gate, or explicitly refused for lease holders — is caught
   by the static anchor, never silently assumed. The A5 RED separately demands the NEW
   `coordinator_authority_forbidden` code at the waves.* boundary for the worker seat.

7. **A8's green condition is the example kinds widening the closed set.** The D4 example uses
   `kind:'brief'` / `kind:'result'`; the A8 red is that the interpreter refuses them
   (`workflow_steering_unknown`, closed `inform|query|steer` at `workflow-interpreter.mjs:44`).
   The suite drives the example spec VERBATIM with the fixture's `carryAttemptMarker` adapter
   and a FILE harvest path, so the post-fix run is genuinely `WAVE-OK` with a real D6 receipt —
   not a shortened spec that dodges the kinds.

## Hermeticity & hygiene

- Real `createDriver` stack over `MockAdapter` subclasses: `CarryAdapter` (scenario-keyed by a
  `(marker:<role>)` goal line, carries the wave's real `[attempt: <salt>]` line onto every edit
  so the D4 harvest marker check passes) and `RefusingAnswerAdapter` (its `answer()` throws a
  typed code to surface the D1.3 raced leg). mkdtemp repo + log dirs, git init/commit, and
  `rmSync` inside `t.after` — no network, no real provider spawns.
- NUL-byte discipline: the NUL-carrying `application.mjs` / `coordination-store.mjs` are
  imported (fine) but never whole-file-read; every static source pin uses
  `execFileSync('/usr/bin/grep', ['-an', ...])` or `sed -n` (the `srcAnchor` helper). The D6
  receipt return block is scanned with `grep -A6 -n '^    basis,$'`.
- No clocks as controls: the `hardCapMs` wall-clock budget is a DRIVER budget (the fixture's
  `LANE_DRIVER = { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 }`), never a test
  control; P-D1.4 pins the loop as wall-clock/concurrency-bounded with no iteration counter.
- `localeCompare` banned; sorted-key literals appear in ACTUAL order (`Object.keys(receipt).sort()`
  vs the ACTUAL sorted order asserted in P-A9).

## Deployment verification

The execution contract (direct executable `"true"`, empty argv, cwd `.`, expected exit 0) passes
trivially and is unchanged by this suite — this is the red-first acceptance for the rung's
implementation, not the deployment gate. A reviewer enforces the execution contract separately.
Run the suite with:

```sh
node --test impl/test/worker-orchestrated-swarm-red.test.mjs
```

Expected at this draft at HEAD `c910836`: **15 tests, 8 pass (P-A4, P-A5-static, P-A7, P-A8-dir,
P-A9, P-A10, P-D1.4, P-A3g), 7 fail at their named stages (A1 `coordinator-read-law-missing`,
A2 `read-law-missing`, A3/A3b `steering-trail-falsified`, A5
`coordinator-authority-forbidden-missing`, A6 `seat-route-hidden`, A8
`composition-example-refused`)** — measured twice, stable. The named stages are the six seam
closures the #74 implementation must land (D1.2 at the deployment seam, D1.3 in the interpreter,
D2 at the waves.* boundary, D3 in the registry view, D4 in the message-kind closure).
