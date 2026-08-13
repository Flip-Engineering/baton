# Issue #74 — worker-orchestrated swarm rung: red-first suite draft notes (v1.2 fold)

- **Suite:** `impl/test/worker-orchestrated-swarm-red.test.mjs`
- **Contract:** `contract-fold.md` v1.2 (source of truth — the fold-map + D1.2/D1.3/D1.4 +
  D2/D3/D4 + the blue-team fold), `worker-orchestrated-swarm-contract.md` v1.0 (the D/G grounding
  it keeps), `contract-redteam.md` (the attack surface), `suite-blueteam.md` (the v1.2 fold
  source), `suite-fold-2.md` (the finding → resolution map). The v1.2 acceptance pins are A1–A10
  + A8-dir + the folded laws D1.2 / D1.3 / D1.4 / D2 / D3 / D4.
- **Date:** 2026-08-13
- **Split (verified):** `node --test impl/test/worker-orchestrated-swarm-red.test.mjs` from the
  repo root at HEAD `3dd4143` ("Baton private effective-tree snapshot"), run twice — **tests 16 ·
  pass 8 · fail 8**, stable across both runs. Every red row fails at its NAMED stage (assert
  message names the stage); the eight green rows are the substrate pins and MUST stay green.
- **Done-when (from the dispatch):** "Baton preserves exact route, result, and cleanup truth."
  The green legs pin exact-route profile admission (A6/P-A9), result truth (`resultSha` +
  `report` + the truthful steering trail, P-A3g/A3), and cleanup truth (every fixture tears down
  its mkdtemp repo + log dir in `t.after`, no residue). The red rows are the laws that must land
  for that preservation to be enforceable: D1.2 (read law), D1.3 (truthful trail), D2 (the
  authority boundary), D3 (the seat map in the registry view), D4 (the message-kind closure +
  the file-not-directory harvest law).

## Invented surfaces (all absent at HEAD; accessed absence-proof)

Every invented surface is driven through surfaces that EXIST at HEAD (`waves.run`
`application.mjs:12516`, `waves.start` `:12506`, `waves.list` `:12512`,
`run.scratchpad.read` dispatch `:12474`, `run.answer`, `runs.list`, the standalone
`implementContractRecipe` `recipes.mjs:549`). The invented behavior is asserted BEHAVIORALLY —
a missing code at HEAD is a red assertion, never a load-time crash (no invented export is
imported statically).

| Surface | Exact signature | Where pinned |
|---|---|---|
| The restricting authorize at the deployment seam (D1.2) | `authorize(request) → boolean` installed at `application-deployment.mjs:2012` (permissive `async () => true` at HEAD) — a sibling `worker:<role>` read draws `application_unauthorized`; the seam literal must be GONE | A1 (coordinator partition), A2 (any member partition) — installed in the FIXTURE as the seam stand-in (`restrictingReadAuthorize()`, fold §1.1), with a static RED pin on the real seam |
| The explicit wave-scoped grant path (D1.2 pt 3) | the fixture-level restrictor mints a grant; a GRANTED swarm-row read of `worker:coordinator` SUCCEEDS — over-refusal (no grant surface) fails | A2 (fold §2.2) |
| The truthful denied/raced answer record (D1.3) | `steering[]` entry `{trigger:'answerDecisions', role, requestId, optionId?, outcome:'denied', refusal:<code>}` — key NOT in `answeredKeys` (structural pin: no pre-answer add), ask stays pending, EXACTLY ONE denied record per requestId, no later `answered` | A3 (denied via the authorize seam), A3b (raced via a throwing adapter) |
| The `coordinator_authority_forbidden` refusal (D2/A5) | `{code:'coordinator_authority_forbidden', detail:{attempted, gracefulPath}}` — the worker seat reaches a waves.* authority verb; the review-authority seat (s74-owner AND s74-observer) never fires it | A5 |
| The coordinator route in the `waves.list` roster (D3/A6) | roster member `{role, route:{harness, model, effort}, scope}` — the seat map | A6 |
| The v1.1 example spec's `kind:'brief'` / `kind:'result'` in the steering policy (D4/A8) | `messageOnSpawn.kind` / `signalOnMembersDone.message.kind` accepted END-TO-END at the coordinator boundary (`coordinator.mjs:6864`) — a delivered `messageId`, the `[MESSAGE …]` wire frame received by the adapter | A8 (fold §1.5) |
| The file-not-directory harvest law (D4 §4.3) | a DIRECTORY harvest path WITHOUT `mustContain` must refuse `harvest_miss` → `WAVE-INCOMPLETE` — structural, regardless of mustContain | A8-dir (the new RED row), P-A8-dir (refusal-shape/basis pin) |

## Row map

### Red rows (must FAIL at HEAD at the named stage)

| Row | Stage | Green when |
|---|---|---|
| A1 | `coordinator-read-law-missing` | `implementContractRecipe` admits `role:'coordinator'` with the heavy route preserved (closed recipe fields `{members,name,policy,version}`) **and** the coordinator's wave enforces D1.2 — a sibling read of the coordinator's `worker:coordinator` partition refuses `application_unauthorized`. The fixture installs the restricting authorize (fold §1.1) so the behavioral legs pass hermetically; the RED is the REAL seam: the permissive `authorize: async () => true` literal (`application-deployment.mjs:2012`) must be GONE. At HEAD the seam is still permissive → RED |
| A2 | `read-law-missing` | the D1.2 read law is installed: a member reads `worker:<ownId>` + `shared` (both GREEN at HEAD), a sibling `worker:<role>` read refuses `application_unauthorized` at the restricting authorize, AND the wave-scoped grant path is REACHABLE — a GRANTED swarm-row read of `worker:coordinator` succeeds (fold §2.2, over-refusal fails). At HEAD `application-deployment.mjs:2012` is `async () => true`, so the sibling read SUCCEEDS → RED |
| A3 | `steering-trail-falsified` | a DENIED decision answer (the authorize seam refuses `run.answer` for the waves.run principal) records `{outcome:'denied', refusal:'application_unauthorized', optionId:'opt-a'}` — exactly ONE denied record per requestId, no later `answered` — and the structural pin holds: no pre-answer `s.answeredKeys.add(key)` in the `driveLane` body. At HEAD `answerDecision` swallows the throw and records `{outcome:'answered'}` (workflow-interpreter.mjs:806-808) — and the key was marked handled before the attempt (`:698`) → RED |
| A3b | `steering-trail-falsified` | a RACED answer delivery (a throwing adapter surfaces `application_run_stopped`) records `{outcome:'denied', refusal:'application_run_stopped'}` — exactly ONE denied record, no later `answered`. At HEAD the same `try { await handle.answer(...) } catch {}` masks the code and records `'answered'` → RED |
| A5 | `coordinator-authority-forbidden-missing` | a worker-seat principal (`baton:worker:w-1`) reaching `waves.start` draws `coordinator_authority_forbidden` with `{attempted:'waves.start', gracefulPath}`. GREEN legs: the top orchestrator AND a second top-orchestrator principal (`s74-observer`) can start a wave — the boundary narrows the WORKER seat, never a hardcoded identity list (fold §1.3). At HEAD the direct port dispatches before any authority check (`:12506`) and the default authorize is permissive — the worker-seat `waves.start` SUCCEEDS → RED |
| A6 | `seat-route-hidden` | the roster that `waves.run` mints and `waves.list` renders exposes the coordinator's heavy route. GREEN leg: a member route OUTSIDE the deployment profile refuses `wave_member_invalid` with the inner `application_route_not_allowed` preserved (`detail.cause.code` — each member rides the same exact-route admission ordinary `run.start` uses). At HEAD the registry view renders `route:null` for every member (role-only string roster) — the coordinator's seat is HIDDEN → RED |
| A8 | `composition-example-refused` | the VERBATIM v1.1 example spec (coordinator + rows, `kind:'brief'`/`kind:'result'`, objectiveRef-only members, FILE harvest path) drives through `waves.run` to the D6 receipt `WAVE-OK`, WITH the DELIVERY pinned (fold §1.5): a `messageOnSpawn` entry carries a delivered `messageId` + the `[MESSAGE brief …]` wire frame reached the adapter; `signalOnMembersDone` names the swarm-row recipients + the `[MESSAGE result …]` frame. At HEAD the example's message kinds are NOT in the interpreter's closed set `['inform','query','steer']` (workflow-interpreter.mjs:44) — the spec refuses `workflow_steering_unknown` before any wave starts → RED |
| A8-dir | `file-not-directory-law-missing` | the "file, never a directory" law is enforced STRUCTURALLY (fold §4.3): a DIRECTORY harvest path WITHOUT `mustContain` refuses `harvest_miss` → `WAVE-INCOMPLETE`. At HEAD `git show <sha>:<dir>` returns the tree listing (it does NOT fail) and the directory harvest without mustContain settles `WAVE-OK` → RED |

### Green guards / pins (must stay green at HEAD)

| Row | Pin |
|---|---|
| P-A4 | a coordinator-seat worker has NO baton connection — `discoverBatonConnection` (with a repo authority referencing a missing profile) draws the byte-identical absence refusal `cli_config_invalid: user connection profile is unavailable` (`application-cli.mjs:126`, label call site `:257`), plus static anchors for `readConnectionJson` (`:149`) |
| P-A5-static | the waves.* direct ports (`waves.start`, `waves.list`, `waves.run`) dispatch BEFORE the recursive-session gate throw (`run_orchestrator_command_forbidden`); the #12 codes are NOT claimed for waves.* verbs. Per the blue-team §3.2 ruling, the pins are the ORDER (`start < list < run < gate`, the direct-port comment precedes the ports) and EXISTENCE/byte-string (`srcAnchor` throws if a marker disappears) — NO tight absolute line windows, so a normal landing never re-bases them |
| P-A7 | `WAITING_ON_KINDS` stays the byte-unchanged closed five (`capacity_ceiling, dispatch_pending, plan_approval, provider_stalled, spawning`, actual order); a settled member's `run.status` carries the SINGLE `waitingOn` projection with the honest `null` (never a fabricated `'working'`) |
| P-A8-dir | a DIRECTORY harvest path WITH `mustContain` (whose recovered listing fails the check) lands `harvest_miss` → `WAVE-INCOMPLETE` with `basis = manifestDigest` — the refusal-shape/basis relation (D4 §4.3); the STRUCTURAL file-not-directory enforcement is the A8-dir RED row |
| P-A9 | the D6 receipt is EXACTLY the seven sorted keys `{basis, harvest, manifestDigest, outcomes, steering, verdict, waveId}` (workflow-interpreter.mjs:594-602); `WAVE-OK` → `basis:'completed'`; `outcomes` is audit-shaped (per-member `{role, phase, terminal, resultSha, report?}`); the heavy coordinator settles `work_completed` |
| P-A10 | refusal constancy: the facade capability refusal `application_unauthorized` (`application.mjs:3215`), the #105 boundary `message_depth_exceeded`, and the reply frame `'body,inReplyTo'` (`claude-session.mjs:161`) stay byte-unchanged; the D6 receipt return is a literal object (no assembled sorted-key list); no clock enters any refusal. Per §3.2 the pins are EXISTENCE + byte-string, never tight absolute line windows |
| P-D1.4 | the escalation sequence is concurrency-bounded (roster ≤64, polled in parallel) and sequentially UNCAPPED — the drive loop stays `while (pending.size > 0 && Date.now() - startedAt < driver.hardCapMs)`, no numeric iteration counter ANYWHERE in the `driveLane` body (the drift-immune awk scan, fold §4.1 — not just the matched loop line) |
| P-A3g | the A3 GREEN side: a DELIVERED decision answer records `outcome:'answered'` only AFTER `handle.answer` returns (the onAnswerEdits land, the member settles) — the machinery works when not denied |

## Design decisions made in the draft (beyond the contract's text)

1. **A1's RED is the D1.2 enforcement, not the recipe admission.** The green leg — the recipe
   admits `role:'coordinator'` with the heavy route and the D6 receipt carries its per-row
   outcome — passes at HEAD. The red is that nothing distinguishes the coordinator: a sibling
   read of `worker:coordinator` succeeds. The green condition is therefore that the coordinator's
   wave enforces D1.2 at the deployment seam (the restricting authorize that
   `application-deployment.mjs:2012` leaves `async () => true`), stage
   `coordinator-read-law-missing`. **(v1.2 fold §1.1: the fixture installs the restricting
   authorize — `restrictingReadAuthorize()` — as the seam stand-in, so the sibling-refusal legs
   are REACHABLE after a correct impl; the permissive fixture would keep them red forever.)**

2. **`waves.list` NEVER exposes a route at HEAD — the two-seam roster discrepancy.** `createWave`
   (the interpreter/recipe seam) mints a role-only STRING roster (`members.map((m) => m.role)`);
   `startWave` (the direct `waves.start` port, `application.mjs:11617-11621`) mints the OBJECT
   roster `[{role, route, scope}]`. The registry read side renders string members as
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
   non-hermetic successor it is. **(v1.2 fold §2.1: the permanence half is pinned STRUCTURALLY —
   the pre-answer `s.answeredKeys.add(key)` must be absent from the `driveLane` body; a denied
   key stays NOT-handled so the ask stays pending, and the later human answer is the documented
   successor.)**

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
   **(v1.2 fold §3.2: the ORDER/EXISTENCE/byte-string alarms stay; the tight absolute line
   windows are dropped — a normal landing never re-bases them. v1.2 fold §1.3: a second
   top-orchestrator principal (`s74-observer`) is added to the GREEN leg to pin seat-CLASS, not
   identity.)**

7. **A8's green condition is the example kinds widening the closed set — asserted at DELIVERY.**
   The D4 example uses `kind:'brief'` / `kind:'result'`; the A8 red is that the interpreter
   refuses them (`workflow_steering_unknown`, closed `inform|query|steer` at
   `workflow-interpreter.mjs:44`). The suite drives the example spec VERBATIM with the fixture's
   `carryAttemptMarker` adapter and a FILE harvest path, so the post-fix run is genuinely
   `WAVE-OK` with a real D6 receipt — not a shortened spec that dodges the kinds. **(v1.2 fold
   §1.5: the DELIVERY is pinned — a `messageOnSpawn` entry carries a delivered `messageId` and
   the `[MESSAGE …]` wire frame reached the adapter, and `signalOnMembersDone` names the
   swarm-row recipients with the `[MESSAGE result …]` frame — so a widening that admits
   `brief`/`result` at the interpreter but silently drops them at the coordinator boundary
   (`coordinator.mjs:6864`) FAILS. The delayMs-bearing scenarios keep members live across the
   steering polls so delivery is reachable.)**

8. **The D1.2 read law is enforced at the FIXTURE seam, not the real deployment seam — the
   deployment seam is pinned statically (v1.2 fold §1.1).** `BatonApplication` consults only its
   injected `authorize` (`application.mjs:2487`; `_authorize` throws when it does not return
   `true`, `:3215`), and the production wiring (`createDeployment`, `application-deployment.mjs:2012`)
   is bypassed by the fixture. A1/A2 therefore install `restrictingReadAuthorize()` in the
   fixture (the D1.2 law, behaviorally GREEN at HEAD) AND assert the permissive
   `authorize: async () => true` literal is ABSENT from the deployment seam (the `sed` pin
   matches only the seam literal, never the `:2044` comment that quotes it) — the RED that turns
   green exactly when the restrictor lands at the seam.

9. **The wave-scoped grant path is asserted REACHABLE (v1.2 fold §2.2), not only the sibling
   refusal.** A2's fixture-level restrictor mints an explicit grant
   (`grantedScopes = new Map([['s74-sibling', new Set(['worker:coordinator'])]])`) and a GRANTED
   swarm-row read of the coordinator's `worker:coordinator` partition SUCCEEDS. A
   refuse-everything restrictor (no grant surface) FAILS the row — the D1.2 law's required
   escape hatch is pinned, so over-refusal is caught.

10. **The file-not-directory law is enforced STRUCTURALLY (v1.2 fold §4.3).** `git show <sha>:<dir>`
    does NOT fail — it returns the tree listing (exit 0), so the v1.1 mechanism was wrong. The
    structural check (each harvest path is a regular file, refusing `harvest_miss` for
    directories regardless of `mustContain`) is the NEW A8-dir RED row: a directory path WITHOUT
    `mustContain` must refuse `WAVE-INCOMPLETE`. P-A8-dir stays GREEN as the refusal-shape/basis
    relation pin (the `mustContain`-mismatch directory refuses honestly with
    `basis === manifestDigest`).

## Hermeticity & hygiene

- Real `createDriver` stack over `MockAdapter` subclasses: `CarryAdapter` (scenario-keyed by a
  `(marker:<role>)` goal line, carries the wave's real `[attempt: <salt>]` line onto every edit
  so the D4 harvest marker check passes; ledgers every `prompt` so the A8 delivery frames are
  provable) and `RefusingAnswerAdapter` (its `answer()` throws a typed code to surface the D1.3
  raced leg). mkdtemp repo + log dirs, git init/commit, and `rmSync` inside `t.after` — no
  network, no real provider spawns.
- NUL-byte discipline: the NUL-carrying `application.mjs` / `coordination-store.mjs` are
  imported (fine) but never whole-file-read; every static source pin uses
  `execFileSync('/usr/bin/grep', ['-an', ...])` or `sed -n` (the `srcAnchor` helper), and the
  `driveLaneBody()` awk helper (a drift-immune range, no absolute line windows) scans the whole
  `driveLane` body. The D6 receipt return block is scanned with `grep -A6 -n '^    basis,$'`.
- No clocks as controls: the `hardCapMs` wall-clock budget is a DRIVER budget (the fixture's
  `LANE_DRIVER = { pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 }`), never a test
  control; P-D1.4 pins the loop as wall-clock/concurrency-bounded with no iteration counter
  anywhere in the `driveLane` body. The A8 scenario `delayMs` values (~120/240 ms) keep members
  live across steering polls — a delivery reachability fixture, not a clock control.
- `localeCompare` banned; sorted-key literals appear in ACTUAL order (`Object.keys(receipt).sort()`
  vs the ACTUAL sorted order asserted in P-A9).
- `watchdog.stallMs` is a valid positive (5 minutes) in the fixture's `watchdog` (`createDriver`,
  fixture `:282`) per the #67 law; `stallAction: 'kill'` comes from the contract vocabulary.

## Deployment verification

The execution contract (direct executable `"true"`, empty argv, cwd `.`, expected exit 0) passes
trivially and is unchanged by this suite — this is the red-first acceptance for the rung's
implementation, not the deployment gate. A reviewer enforces the execution contract separately.
Run the suite with:

```sh
node --test impl/test/worker-orchestrated-swarm-red.test.mjs
```

Expected at this draft at HEAD `3dd4143`: **16 tests, 8 pass (P-A4, P-A5-static, P-A7, P-A8-dir,
P-A9, P-A10, P-D1.4, P-A3g), 8 fail at their named stages (A1 `coordinator-read-law-missing`,
A2 `read-law-missing`, A3/A3b `steering-trail-falsified`, A5
`coordinator-authority-forbidden-missing`, A6 `seat-route-hidden`, A8
`composition-example-refused`, A8-dir `file-not-directory-law-missing`)** — measured twice,
stable. The seven named stages are the five law-closures the #74 implementation must land (D1.2
at the deployment seam, D1.3 in the interpreter, D2 at the waves.* boundary, D3 in the registry
view, D4 in the message-kind closure + the file-not-directory harvest admission).
