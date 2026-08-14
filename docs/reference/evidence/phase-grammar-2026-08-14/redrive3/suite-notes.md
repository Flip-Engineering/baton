# suite-notes — row-suite (red-first acceptance suite for the phase-level grammar)

[attempt: 26544c22-a314-483b-948d-69a07ef1bc05 row-suite]

Status: AWAIT-INPUTS — polling (`test -f`, 30s cadence, no clock-capped give-up) for
`phase-grammar-contract.md` in this directory. No suite row is final until the contract is
read IN FULL; the pin shapes below that depend on contract decisions are marked PENDING.

## Pre-work reading (anchors, this session)

- `impl/src/workflow-dsl.mjs` read in full (527 lines at HEAD 09200e9): the #170 16-directive
  compiler — `WAVEFILE_DIRECTIVES` (:39-56), lexical layer `logicalLines`/`tokenize` (:92-172),
  `refuse` carrying the #160 `{line, field, expected}` triple + `detail` wire leg (:70-74),
  pure compile seam `compileWavefile` (:453-524) emitting the five-key schemaVersion-1 IR.
  Zero phase/outcome/coupling/when vocabulary at HEAD.
- `impl/src/workflow-interpreter.mjs` read in full (957 lines): `admitSpec` (:131-163) over the
  closed `SPEC_FIELDS` (:48), `runWorkflow` (:497-665) — render objectives + salt (:521,
  :333-348), base-commit machinery (:537-541), `waves.start` approve:true (:549-557), the
  `driveLane` poll loop (:726-808) with steering lanes 1-7, `harvestOne` (:667-706) reading the
  authoritative result sha via `git show` with attempt-marker + mustContain checks, the
  seven-key sorted receipt (:633-641), and the #173 detached-settle split (:577-664).
  `admitSpec` IS exported (the #170 suite's STAGE_ADMISSION seam landed).
- `impl/test/workflow-dsl-red.test.mjs` read in full — the #170 conventions this suite
  inherits: named-stage loaders (`stageError(STAGE, …)` on ERR_MODULE_NOT_FOUND), PIN rows
  green at HEAD vs capability rows red, `assertRefusal` asserting code + triple + `detail`
  leg, `canonicalJson` local copy, SPLIT RECORD in the header, mkdtemp hermetic fixtures.
- `impl/test/workflow-as-data-red.test.mjs` (header + fixture core :300-474) — the real-stack
  drive option: `wadFixture` (BatonApplication + createDriver + TrackingMarkerAdapter,
  `watchdog: { stallMs: 5*60_000 … }`), `LANE_DRIVER = { pollIntervalMs: 15,
  stallTimeoutMs: 400, hardCapMs: 3000 }` (F11), `laneOf`/`driveLane` red-stage helpers.
- `impl/test/workflow-surface-red.test.mjs` (:190-215) — the `watchdog: { stallMs: 60_000 },`
  comment idiom this suite must carry verbatim where a driver config appears.
- The redrive3 wavefile + all four row briefs + coordinator-brief read in full.

## Campaign topology (recorded for the coordinator)

- The attempt salt `26544c22-a314-483b-69a07ef1bc05` is CAMPAIGN-WIDE: my task line and the
  sibling row-impl-interpreter notes (`ws-72691758447322e98516b936f9cc433e` redrive3
  `impl-interpreter-notes.md`) share it. That worktree is my wave's interpreter row; its
  notes also record AWAIT-INPUTS on contract + suite-notes.
- Two `phase-grammar-contract.md` files exist in SIBLING worktrees of OTHER attempts of the
  same wave name (salts `9c4144b5-…` in `ws-339bada8…`, `b59fa92f-…` in `ws-f640bc11…`).
  Neither carries my campaign's salt. **Judgment call JC-1:** they are NOT my authority; I
  keep polling my own directory per the await-inputs discipline. I read both IN FULL as
  non-binding background so the suite can move fast when MY contract lands. The two diverge
  materially — schemaVersion 2 + three new `workflow_phase_*` codes + `phase <n> checkpoint` +
  `when <name> = "<lit>"` vs. schemaVersion 1 + `kind:'campaign'` + no new codes + separate
  `compileCampaign` + `when eq <name> "<lit>"` — which proves the suite cannot be pre-shaped
  before my attempt's contract lands. Every contract-dependent pin below stays PENDING.

## Suite design (PENDING contract; the contract-independent parts are fixed)

Fixed by the brief + suite law (already binding, independent of the contract):

- Suite home `impl/test/workflow-phases-red.test.mjs`; header carries the verbatim
  `[attempt: 26544c22-a314-483b-948d-69a07ef1bc05 row-suite]` line, the pin inventory, and a
  SPLIT RECORD (`node --test` from the repo root, run twice for stability).
- No clocks (no Date.now-dependent assertions; the interpreter driver option `hardCapMs` is a
  config value, never an asserted wall-clock), no absolute line-window anchors, sorted-key
  literals written in ACTUAL order (no `localeCompare` anywhere — `.sort()` codepoint default
  only), namespace imports for invented surfaces (`import * as ns` + absence-proof access so a
  missing export never kills the file at LOAD), and every pin at a NAMED stage.
- RED at HEAD: the phase vocabulary does not exist in `workflow-dsl.mjs`/`workflow-interpreter.mjs`
  (verified by source scan this session), so compiler rows red at a named
  `workflow_phase_compile_missing` stage and driver rows at `workflow_phase_driver_missing`
  (stage names PENDING the contract's own naming if it names them).
- PIN rows green at HEAD (the substrate the phase grammar must not disturb): admitSpec's
  schemaVersion-1 closed shape is unchanged; the closed 5-code family; the #170 16-directive
  registry; the interpreter's JSON-only string path; `runWorkflow` single-wave behavior on a
  plain spec (compile-free) stays green.

PENDING the contract (blocked on its decisions): the campaign IR shape, the refusal codes and
their `{line, field, expected}` triples, the `when` predicate spelling, the checkpoint packet
surface, the derived per-phase key rule, the amendment seam, and therefore every capability
row's exact assertion.

Drive-machinery decision (JC-2, leaning recorded, FINAL after contract): the interpreter rows
drive the interpreter through a FAKE BATON FACADE (a scripted `waves.start` returning scripted
per-member handles — the facade contract is narrow and pinned in workflow-interpreter.mjs
:549-560, :442-476) rather than the full BatonApplication/MockAdapter stack of
workflow-as-data-red. Rationale: the phase semantics under test (sequencing, outcome
extraction, gating, park/resume, amendment) live ABOVE the wave machinery; the as-data suite
already pins the machinery below. The contract may override (e.g. if its drive seam is a new
export with different coupling) — then its ruling wins and this note records the fold.

## Drive-machinery proof (JC-2 VALIDATED at HEAD, /tmp probe — not a repo file)

A scratch probe drove the REAL HEAD `runWorkflow` through a fake baton facade to `WAVE-OK`
with a full marker-verified harvest. The mechanics the suite fixture will reuse:

- fake handle: `inspect({depth:'section',section:'result'})` → `{section:{items:[{value:{sha}}]}}`
  (the materializeSha seam); plain `inspect()` → `{outline:{phase,actions,attention:[]},terminal}`
  stepped through `planning → running → result_ready` per poll; `status()` → `{view:{phase,
  attention, actions}}`; `act`/`answer`/`_command` recorded best-effort `{ok:true}`.
- fake wave: `{waveId: 'wave-<key>', runs: Map<role,handle>, close → {ok:true}}`.
- fake `waves.start({members, idempotencyKey})`: parses the interpreter-minted salt from the
  rendered objective (`[attempt: <uuid> <role>]` prefix, workflow-interpreter.mjs:347), then
  mints a real commit in the temp repo carrying each member's report body WITH that marker
  (the B2 harvest law) — `git write-tree` + `commit-tree`; harvest recovers it via the
  interpreter's own `git show sha:path`.
- Observed receipt: seven sorted keys; `harvest[0].ok:true, matched:true, code:'harvest_ok'`;
  the base-commit machinery committed `baton workflow base <key>` unprompted; verdict
  `WAVE-OK`. No network, no provider, no clock dependency (driver option
  `{pollIntervalMs:5, stallTimeoutMs:100, hardCapMs:2000}` only bounds the drive loop).

So the end-to-end phase rows can assert ORDER over recorded `waves.start` invocations (per
phase), outcome extraction from harvested bytes, and fold/park behavior — all through the
interpreter's public seam. The fixture needs one fake-wave FACTORY parameterized per phase.

## Poll log

- Polls began immediately after pre-work reading (test -f, 30s cadence): absent through
  window 1 (~9.5 min), window 2, window 3. Sibling-worktree survey performed after window 2
  (topology above). Polling continues — quiescence is the contract's absence, not a give-up.
- Windows 4-8 absent (~90 min total). During window 8's tail the /tmp drive probe above was
  run and validated JC-2. My attempt's interpreter row (ws-726917…, shared salt) is likewise
  still awaiting contract + these notes — the attempt's contract row has not published.
