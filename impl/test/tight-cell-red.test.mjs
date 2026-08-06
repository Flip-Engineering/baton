// Tight-cell (#102) red-first suite — written against the FOLDED contract
// docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md v1.1 + the v1.2
// context-depth amendment (same dir), BEFORE any implementation. Every red row fails TODAY
// at a named `stage[...]` and goes green only on the cell implementation. Pins assert what
// legitimately exists today.
//
// The seam-by-seam ground truth the rows stand on (all re-verified this session with NUL-safe
// grep -an / sed -n):
//   * _normalizeWaveStart closes the member on ['role','objective','exact','scope']
//     (application.mjs:11598) — a `group` key is refused wholesale today, so every
//     group-admission row is currently blocked at application_wave_start_invalid.
//   * createWave/validateMember (wave.mjs:50-105,193-212) pass unknown keys through, but the
//     member loop builds route = member.exact ? {exact} : {harness,model,effort}; a group-only
//     member never starts a run (startError recorded) — the N-spawns-one-run row is blocked at
//     the missing cell branch.
//   * sendWaveMember resolves the FIRST worker (application.mjs:11523-11524) and receipts
//     {result, target} — no delivered/targetCount; the C5 runId fan-out exists at the
//     COORDINATOR seam only (coordinator.mjs:6835,6893-6897).
//   * The run-status builder derives phase/terminal/result from projection.nodes[0] ONLY
//     (application.mjs:7393-7404); `_historicalProfileView` (5680-5700) likewise.
//   * A message record admits exactly ONE reply (parent.reply, coordinator.mjs:12511);
//     replies are attributed `from: workerId` (12508-12511) — the per-member slots are absent.
//   * Board grant mints are indexed by the RAW caller key (coordination-store.mjs:14992-14995)
//     — a second different-content mint under one key refuses board_replay_conflict (ground
//     truth 15; BW-05).
//   * The trust gate fires per-worker when !brief.analysis && requiredEffects includes
//     repository_edit and the fresh capture is diffless -> required_effect_absent -> policy_failure
//     (coordinator.mjs:12839-12849,13719-13723); analysis:true is the existing TG5 hatch.
//   * The run-scoped horizon exists (coordinator.mjs:11060-11078) and the scratchpad read port
//     constructs (runId, 'shared') server-side (coordinator.mjs:10701-10703) — a sibling's
//     task-tier partition never serves (bd3-v3 A4).
//   * The cell vocabulary (wave_group_*, wave_cell_delivery_unsupported, cell_spawn_refused,
//     cell_member_lost, cell_below_quorum, cell_exact_breach, cell.captures, cell.degraded,
//     targetCount, survived) is ABSENT from every impl/src/*.mjs file today (verified by grep).
//     MAX_CELL_SIZE is not an exported constant; MAX_RUN_VIEW_WORKERS/MAX_RUN_VIEW_BYTES named
//     constants do not exist yet (the 64-member wave-array bound and MAX_WAVE_PROGRESS_BYTES
//     do — those are the derivation anchors TC-17 pins).
//
// ===========================================================================
// Row inventory (24 red / 9 pins)
// ===========================================================================
//   RED (each fails today at its named stage):
//     TC-01  group-field-admission-missing    waves.start accepts the closed group field
//     TC-02  group-seat-missing-refusal       group w/o seat refuses wave_group_seat_missing
//     TC-03  group-route-conflict-refusal     member route alongside group.seat refuses
//                                             wave_group_route_conflict at BOTH seams
//     TC-04  cell-mint-missing                a cell member starts ONE run, size homogeneous nodes
//     TC-05  cell-identity-missing            size distinct workerIds/taskIds under one runId,
//                                             steering.registered once
//     TC-06  cell-spawn-refusal-missing       per-worker cell_spawn_refused (source: app.mjs)
//     TC-08  per-worker-grant-mint-missing    claimGrant to a cell runId mints size grants
//     TC-09  cell-broadcast-receipt-missing   cell send routes the C5 fan-out, receipts delivered/targetCount
//     TC-11  cell-quorum-aggregate-missing    cell aggregate {size,quorum,survived,lost} (source)
//     TC-12  cell-below-quorum-terminal-missing  lost > size-quorum -> cell_below_quorum (source)
//     TC-13  cell-exact-breach-missing        strict + any loss -> cell_exact_breach (source)
//     TC-14  cell-member-lost-missing         never-started worker receipted cell_member_lost (source)
//     TC-15  collector-result-law-missing     cell.captures per-member digests; collector resultSha (source)
//     TC-17  cell-size-bound-missing          MAX_CELL_SIZE is a named documented bound of 64
//     TC-20  first-node-truth-missing         cell outcome names cell.degraded; never nodes[0] (source)
//     TC-21  per-member-reply-slot-missing    each delivered member's FIRST reply admitted
//     TC-22  per-member-mint-key-missing      size mints under one send key never collide
//     TC-23a cell-editing-division-missing    group.editing -> analysis:true on non-listed briefs
//     TC-24  cell-delivery-mode-gate-missing  now|turn to a cell refuses wave_cell_delivery_unsupported (source)
//     TC-26  survivor-set-missing             survived = {completed,result_ready}; cell.lost receipt (source)
//     D1     cell-mate-task-tier-read-missing scratchpad CONTEXT_READ resolves the cell's task tiers
//     D2     direct-shared-write-missing      cell member writes the shared tier with the cell nonce
//     D3     cell-reply-visibility-missing    a member's reply is visible to its cell-mates
//     D4     shared-worktree-option-missing   group.worktree:'shared' admitted
//   PIN (green today; assert what legitimately exists):
//     TC-07  shared-horizon law              run-scoped nodes serve every worker; foreign runs refuse
//     TC-09b C5 fan-out receipt              sendMessage({to:{runId}}) -> delivered/targetCount
//     TC-17b derivation anchors              wave member bound 64 + MAX_WAVE_PROGRESS_BYTES
//     TC-18  loose form byte-identical       one run/one worker; 3 delivery modes; single-worker target
//     TC-18a single-reply slot               non-cell second reply / reply-to-reply refuse depth
//     TC-22b first-worker resolution          waves.send to a runId targets worker[0] only, no targetCount
//     TC-23b analysis hatch                  edit-free analysis:true worker is not policy-killed
//     TC-23c safe direction                  edit-free editing member still policy-killed
//     D-loose task-tier invisibility         a sibling's task-tier note never serves
//
// Depth rows D1-D4 require a cell run, and the cell run's mint is itself a missing capability
// today; their first assertion is the contract surface `waves.start` with the closed group —
// blocked at the cell mint. Each names its OWN stage; the post-mint behavioral bindings follow
// the mint assertion so a wrong implementation that mints the cell but not the depth lands on
// the depth assertion.
//
// Invented surfaces: `MAX_CELL_SIZE` is referenced via `import * as waveModule` (namespace —
// a missing export cannot kill the file at load; waveModule.MAX_CELL_SIZE is simply undefined
// today). No other invented symbol is imported; the cell vocabulary rows are source assertions
// over impl/src (readFileSync), never live imports.
//
// NUL discipline: application.mjs / coordination-store.mjs contain NUL bytes — they are read
// with readFileSync(...,'utf8') and only matched, never opened whole in this suite. Campaign
// law: controls are eval-able (no clocks, no turn counts); the only timers are test I/O flushes.
// localeCompare is banned; sorted literals below are in actual sorted order.
//
// Verified split: 24 red / 9 green — 33 tests (node --test impl/test/tight-cell-red.test.mjs),
// stable across three consecutive runs (pass 9 / fail 24 each). Every red row fails today at its
// own named stage (24 distinct stages — none of the reds shares a stage name); every pin is green.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { Log } from '../src/log.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import * as waveModule from '../src/wave.mjs';

const REPO = 'repo-tight-cell';
const NOW_MS = Date.parse('2026-08-06T00:00:00.000Z');
const RUN_LINEAGE_POLICY = Object.freeze({
  schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4,
  leaseTtlMs: 3_600_000, maxReplManifestsPerRun: 4,
});
const SEAT = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

const dirs = [];
function tmpDir(prefix = 'baton-tc-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
const drivers = [];
test.after(async () => {
  for (const driver of drivers) {
    try { await driver?.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver?.closeAuthority?.(); } catch { /* best effort */ }
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Source seam — the folded contract's named cell vocabulary must land in the
// listed impl/src files. (Decision 9 explicitly sanctions source assertions;
// every token below is verified ABSENT from every impl/src file today.)
// ---------------------------------------------------------------------------
const SRC_APPLICATION = () => readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8');
function assertTokenInApplication(token, stage, note) {
  assert.ok(SRC_APPLICATION().includes(token),
    `stage[${stage}]: ${note} — today "${token}" exists in none of impl/src/application.mjs`);
}

// ---------------------------------------------------------------------------
// Lightweight Coordinator fixture (bd3 pattern — the board-workerhalf idiom)
// ---------------------------------------------------------------------------
function makeBrief(overrides = {}) {
  return {
    goal: 'work the shared cell board', constraints: [], pathScope: ['.'],
    definitionOfDone: 'reports filed', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, requiredEffects: [],
    ...overrides,
  };
}

class ScriptableAdapter {
  constructor({ pausable = true } = {}) {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native',
      ...(pausable ? { turnCompletion: 'pausable' } : {}),
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

function coordinatorSetup({ adapter, capture, coordinatorOpts = {} } = {}) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: capture ?? (async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] })),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {},
      remove: async () => {},
      reconcile: async () => {},
    },
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
    ...coordinatorOpts,
  });
  return { dir, log, adapter, coordinator, coordination: coordinator._coordination, fences: coordinator._fences };
}

const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

async function flush(times = 40) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function emitContextRead(adapter, handle, query, key) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'context.read', actor: 'worker',
    payload: { query, expectedFence: 'current', idempotencyKey: key },
  });
}

function emitWorkerReply(adapter, handle, inReplyTo, body) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { inReplyTo, body },
  });
}

function emitTurnCompleted(adapter, handle, turnEpoch = 1, output = 'final turn') {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output },
  });
}

function streamEvents(coordinator, handle, kind) {
  return coordinator._log.read(handle.id).filter((event) => event.kind === kind);
}

// ---------------------------------------------------------------------------
// Full application fixture (board-workerhalf waveFixture + goalPlanAuthority
// mandatory:false so snapshot().goalPlan exists and direct run.start works;
// baton bound to a principal DISTINCT from the application planner).
// ---------------------------------------------------------------------------
async function waveFixture() {
  const repo = tmpDir('baton-tc-repo-');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  const adapter = new ScriptableAdapter();
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const logDir = tmpDir('baton-tc-log-');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    runLineagePolicy: RUN_LINEAGE_POLICY,
    now: () => NOW_MS,
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 0 },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId: REPO,
        mandatory: false, // snapshot().goalPlan exists; direct spawns need no approved plan
        approvalTtlMs: 60 * 60 * 1000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  drivers.push(driver);
  const principalOf = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId: REPO, definitionOfDone: ['verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'], effects: ['repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    principals: {
      planner: principalOf('tc-planner'),
      dispatcher: principalOf('tc-dispatcher'),
      observer: principalOf('tc-observer'),
    },
    authorize: async () => true,
  });
  const coordination = driver.coordination;
  const baton = bindBaton(application, principalOf('cell-owner'));
  const waveId = `wave:${'a'.repeat(32)}`;
  return { repo, logDir, adapter, driver, application, coordination, baton, waveId, principalOf };
}

// The contract surface for a cell wave. Every group-admission row asserts the call SUCCEEDS
// (or draws the exact typed refusal); today the `group` key is refused at _normalizeWaveStart
// (application.mjs:11598) with application_wave_start_invalid.
async function startCellRun(fx, { role = 'cell', size = 2, group = {}, objective = 'coordinate the cell through the board', idem }) {
  return fx.application.command('waves.start',
    { idempotencyKey: idem, members: [{ role, objective, scope: ['.'], group: { seat: SEAT, size, ...group } }] },
    fx.principalOf('cell-owner'),
    { transport: 'direct', requestId: `${idem}:req`, idempotencyKey: idem })
    .then((receipt) => ({ ok: true, receipt }), (error) => ({ ok: false, code: error?.code ?? 'thrown', error }));
}

// ===========================================================================
// A — Group field admission (transport seam; today blocked at the closed member key set)
// ===========================================================================

test('TC-01 group[group-field-admission-missing]: waves.start accepts the closed group field', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'tc01', role: 'cell' });
  assert.ok(sent.ok,
    'stage[group-field-admission-missing]: a wave member must accept the closed group field '
    + '{editing?, quorum?, seat, size, strict?} (Decision 1); today the group key is refused at '
    + `_normalizeWaveStart (application.mjs:11598) with ${sent.code}`);
  // Green oracle: one detached member row — the cell consumes ONE wave member slot.
  assert.deepEqual(Object.keys(sent.receipt).sort(), ['members', 'schemaVersion', 'waveId']);
  assert.equal(sent.receipt.members.length, 1, 'a cell member is ONE wave member slot (Decision 1)');
  assert.ok(/^run:/u.test(sent.receipt.members[0].runId), 'the cell member produced one runId');
});

test('TC-02 group[group-seat-missing-refusal]: group without seat refuses wave_group_seat_missing before any spawn', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'tc02', role: 'cell', group: { size: 2 } }); // no seat
  assert.equal(sent.ok, false,
    'stage[group-seat-missing-refusal]: a group without its closed route seat is ambiguous and must be '
    + 'refused, never silently defaulted (Decision 1, TC-02)');
  assert.equal(sent.code, 'wave_group_seat_missing',
    'stage[group-seat-missing-refusal]: the refusal is the typed wave_group_seat_missing (Decision 1); '
    + `today the group key is refused wholesale at admission with ${sent.code}`);
});

test('TC-03 group[group-route-conflict-refusal]: member-level route alongside group.seat refuses wave_group_route_conflict at BOTH seams', async () => {
  const fx = await waveFixture();
  // transport seam: member-level exact alongside group
  const transport = await fx.application.command('waves.start',
    { idempotencyKey: 'tc03', members: [{ role: 'cell', objective: 'conflict', scope: ['.'], exact: SEAT, group: { seat: SEAT, size: 2 } }] },
    fx.principalOf('cell-owner'),
    { transport: 'direct', requestId: 'tc03:req', idempotencyKey: 'tc03' })
    .then((receipt) => ({ ok: true, receipt }), (error) => ({ ok: false, code: error?.code ?? 'thrown' }));
  assert.equal(transport.ok, false,
    'stage[group-route-conflict-refusal]: member-level exact alongside group.seat must be refused at the '
    + 'transport seam (the exact-XOR, Decision 1)');
  assert.equal(transport.code, 'wave_group_route_conflict',
    'stage[group-route-conflict-refusal]: the transport refusal is wave_group_route_conflict; today the '
    + `group key is refused wholesale (${transport.code})`);
  // library seam: bare member-level harness/model/effort alongside group
  const lib = await fx.baton.waves.start({ members: [{ role: 'cell', objective: 'conflict', scope: ['.'], harness: 'mock', model: 'mock-model', effort: 'low', group: { seat: SEAT, size: 2 } }] })
    .then((wave) => ({ ok: true, wave }), (error) => ({ ok: false, code: error?.code ?? 'thrown' }));
  assert.equal(lib.ok, false,
    'stage[group-route-conflict-refusal]: bare member-level harness/model/effort alongside group must refuse '
    + 'wave_group_route_conflict at the createWave/validateMember library seam (wave.mjs:98-103)');
  assert.equal(lib.code, 'wave_group_route_conflict',
    'stage[group-route-conflict-refusal]: the library refusal is wave_group_route_conflict; today the member '
    + `starts a loose run (${lib.code ?? 'ok'})`);
});

// ===========================================================================
// B — N-spawns-one-run (library seam; today the group-only member never starts a run)
// ===========================================================================

test('TC-04 cell-mint[cell-mint-missing]: a cell member starts ONE run whose plan carries size homogeneous nodes', async () => {
  const fx = await waveFixture();
  const wave = await fx.baton.waves.start({ members: [{ role: 'cell', objective: 'divide the cell work', scope: ['.'], group: { seat: SEAT, size: 2 } }] });
  const run = wave.runs.get('cell');
  assert.ok(run,
    'stage[cell-mint-missing]: a cell member starts ONE run via the cell branch of the run-start plan mint, '
    + 'with size homogeneous nodes keyed cell:<waveRole>:<index> and identical routes/objective (Decision 2, '
    + 'TC-04); today the group-only member never starts a run (no member-level route, wave.mjs:204-207)');
  const view = await run.status();
  assert.equal(view.ownership?.workerIds?.length ?? 0, 2,
    'stage[cell-mint-missing]: run.status().ownership.workerIds.length === size — today one member maps to one '
    + 'run/one worker (ground truth 2)');
  const workers = fx.driver.coordinator.list().filter((w) => w.runId === view.runId);
  assert.equal(workers.length, 2, 'stage[cell-mint-missing]: size distinct workers under the one runId');
});

test('TC-05 cell-identity[cell-identity-missing]: size distinct worker identities under one runId, steering.registered once', async () => {
  const fx = await waveFixture();
  const wave = await fx.baton.waves.start({ members: [{ role: 'cell', objective: 'divide the cell work', scope: ['.'], group: { seat: SEAT, size: 3 } }] });
  const run = wave.runs.get('cell');
  assert.ok(run,
    'stage[cell-identity-missing]: the cell is ONE wave member with size distinct worker identities '
    + '(Decision 2, TC-05); today the group-only member never starts a run');
  const view = await run.status();
  const ids = view.ownership?.workerIds ?? [];
  assert.equal(ids.length, 3, 'stage[cell-identity-missing]: size distinct workerIds');
  assert.equal(new Set(ids).size, ids.length, 'stage[cell-identity-missing]: the workerIds are distinct');
  const workers = fx.driver.coordinator.list().filter((w) => w.runId === view.runId);
  assert.equal(new Set(workers.map((w) => w.taskId)).size, workers.length,
    'stage[cell-identity-missing]: each worker owns its own taskId');
  const tasks = workers.map((w) => fx.coordination.task(w.taskId));
  assert.ok(tasks.every((task) => task?.runId === view.runId),
    'stage[cell-identity-missing]: every task\'s task.runId === cellRunId');
  const steering = fx.coordination.events().filter((e) => e.kind === 'steering.registered' && e.payload?.runId === view.runId);
  assert.equal(steering.length, 1,
    'stage[cell-identity-missing]: steering.registered records the cell run ONCE — the cell is one wave member');
});

test('TC-06 cell-spawn[cell-spawn-refusal-missing]: a refused individual spawn is recorded cell_spawn_refused, never aborts the run', () => {
  assertTokenInApplication('cell_spawn_refused',
    'cell-spawn-refusal-missing',
    'a worker whose spawn refused (capacity/session/policy) is recorded as a per-worker cell_spawn_refused with '
    + 'its spawnError — never a run failure (Decision 2, TC-06); today the run-start mint knows no per-worker '
    + 'spawn record (a member failure is startError, wave.mjs:208-210)');
});

// ===========================================================================
// C — Quorum substrate (kernel work — Decision 6; source-level, Decision 9)
// ===========================================================================

test('TC-11 quorum[cell-quorum-aggregate-missing]: the run-status builder derives the cell aggregate, never nodes[0]', () => {
  assertTokenInApplication('cell: { size',
    'cell-quorum-aggregate-missing',
    'the cell outcome carries the closed aggregate cell: {size, quorum, survived, lost, degraded} derived over '
    + 'ALL plan nodes (Decision 6); today the run-status builder reads projection.nodes[0] only '
    + '(application.mjs:7393-7404, ground truth 13)');
  assertTokenInApplication('survived',
    'cell-quorum-aggregate-missing',
    'survived is counted from the work-rest set {completed, result_ready} across every cell member '
    + '(Decision 6); today application.mjs derives no survival count');
});

test('TC-12 quorum[cell-below-quorum-terminal-missing]: lost > size - quorum fails cell_below_quorum', () => {
  assertTokenInApplication('cell_below_quorum',
    'cell-below-quorum-terminal-missing',
    'when quorum is unreachable (lost > size - quorum) the cell mints phase failed / terminalCause '
    + 'cell_below_quorum AT the event the count tips (Decision 6, TC-12); today the terminal vocabulary '
    + 'exists nowhere in application.mjs');
});

test('TC-13 quorum[cell-exact-breach-missing]: group.strict with any loss fails cell_exact_breach', () => {
  assertTokenInApplication('cell_exact_breach',
    'cell-exact-breach-missing',
    'group.strict:true with any member loss fails cell_exact_breach — no degraded fallback (Decision 6, TC-13); '
    + 'today the code exists nowhere');
});

test('TC-14 quorum[cell-member-lost-missing]: a never-started worker is receipted cell_member_lost, not a run failure', () => {
  assertTokenInApplication('cell_member_lost',
    'cell-member-lost-missing',
    'a worker whose spawn refused is receipted cell_member_lost in cell.lost with its per-worker cause '
    + '(Decision 6, TC-14); today a member whose run never started is a flat startError outcome '
    + '(wave.mjs:430-431)');
});

test('TC-20 quorum[first-node-truth-missing]: worker #1\'s terminal neither settles nor fails the cell', () => {
  assertTokenInApplication('cell.degraded',
    'first-node-truth-missing',
    'the cell outcome names degraded:true when quorum <= survived < size and mints AT the count-reached event — '
    + 'worker #1 resting must not settle the cell, worker #1 dying must not fail it while quorum is reachable '
    + '(Decision 6, TC-20); today application.mjs derives terminal truth from nodes[0] and knows no degraded phase');
});

test('TC-26 quorum[survivor-set-missing]: survived is the closed work-rest set, losses receipted in cell.lost', () => {
  assertTokenInApplication('cell.lost',
    'survivor-set-missing',
    'every terminal non-survivor (failed, cancelled, stopped, denied, never-started) is receipted in cell.lost '
    + 'with its per-member cause — stopped/denied count as LOSSES, never survivals (Decision 6, TC-26); today '
    + 'application.mjs has no cell.lost receipt');
});

// ===========================================================================
// D — The single collective result (designated-collector law — Decision 7)
// ===========================================================================

test('TC-15 collector[collector-result-law-missing]: the collective result is the collector\'s capture, siblings checkpoint-only', () => {
  assertTokenInApplication('cell.captures',
    'collector-result-law-missing',
    'the cell receipt carries cell.captures [{workerId, taskId, captureDigest}] for every member, sorted by '
    + 'member index — member index 0 is the collector, its pin is resultSha (Decision 7, TC-15); today the run '
    + 'result is the FIRST worker\'s capture and no per-member digest list exists (ground truth 11)');
});

// ===========================================================================
// E — Broadcast & reply (coordinator seam)
// ===========================================================================

test('TC-21 reply[per-member-reply-slot-missing]: a runId broadcast admits EACH delivered member\'s FIRST reply', async () => {
  const { adapter, coordinator } = coordinatorSetup({ adapter: new ScriptableAdapter(), capture: noDiff });
  const h1 = await coordinator.spawn('mock', makeBrief(), { runId: 'run:cell' });
  const h2 = await coordinator.spawn('mock', makeBrief(), { runId: 'run:cell' });
  const parent = await coordinator.sendMessage(
    { kind: 'inform', to: { runId: 'run:cell' }, body: 'cell broadcast' }, { actor: 'orchestrator' },
  );
  assert.equal(parent.delivered, 2, 'PIN: the C5 runId fan-out delivers to every worker (coordinator.mjs:6835)');
  assert.equal(parent.targetCount, 2, 'PIN: the broadcast receipt names targetCount = size (coordinator.mjs:6893-6897)');
  emitWorkerReply(adapter, h1, parent.messageId, 'reply from member 0');
  await flush(40);
  emitWorkerReply(adapter, h2, parent.messageId, 'reply from member 1');
  await flush(40);
  const delivered = streamEvents(coordinator, h2, 'message.delivered')
    .filter((e) => e.payload?.inReplyTo === parent.messageId);
  const rejected = streamEvents(coordinator, h2, 'message.rejected')
    .filter((e) => e.payload?.inReplyTo === parent.messageId);
  assert.equal(delivered.length, 1,
    'stage[per-member-reply-slot-missing]: each delivered cell member\'s FIRST reply is admitted against its own '
    + 'per-member delivery record (Decision 5, TC-21); today the parent message holds ONE reply slot '
    + `(coordinator.mjs:12511), so member 1\'s reply is refused with `
    + `${rejected.map((r) => r.payload?.reason).join(',') || 'no rejection recorded'}`);
  // depth stays 1: member 1's SECOND reply to the same broadcast still refuses message_depth_exceeded
  emitWorkerReply(adapter, h2, parent.messageId, 'member 1 second reply');
  await flush(40);
  const rejectedAgain = streamEvents(coordinator, h2, 'message.rejected')
    .filter((e) => e.payload?.inReplyTo === parent.messageId);
  assert.ok(rejectedAgain.some((r) => r.payload?.reason === 'message_depth_exceeded'),
    'a member\'s second reply still refuses message_depth_exceeded (depth stays 1 per member)');
});

test('TC-18a reply pin: the non-cell single-worker reply lane is byte-identical (one reply slot)', async () => {
  const { adapter, coordinator } = coordinatorSetup({ adapter: new ScriptableAdapter(), capture: noDiff });
  const h1 = await coordinator.spawn('mock', makeBrief());
  const parent = await coordinator.sendMessage(
    { kind: 'query', to: { workerId: h1.id }, body: 'status?' }, { actor: 'orchestrator' },
  );
  emitWorkerReply(adapter, h1, parent.messageId, 'first');
  await flush(40);
  const delivered = streamEvents(coordinator, h1, 'message.delivered')
    .filter((e) => e.payload?.inReplyTo === parent.messageId);
  assert.equal(delivered.length, 1, 'PIN: the first reply is admitted');
  emitWorkerReply(adapter, h1, parent.messageId, 'second');
  await flush(40);
  const rejected = streamEvents(coordinator, h1, 'message.rejected')
    .filter((e) => e.payload?.inReplyTo === parent.messageId);
  assert.ok(rejected.some((r) => r.payload?.reason === 'message_depth_exceeded'),
    'PIN: a single-worker target still refuses a second reply with message_depth_exceeded (TC-18: byte-identical)');
  emitWorkerReply(adapter, h1, delivered[0].payload.messageId, 'reply to reply');
  await flush(40);
  const rejectedToReply = streamEvents(coordinator, h1, 'message.rejected')
    .filter((e) => e.payload?.inReplyTo === delivered[0].payload.messageId);
  assert.ok(rejectedToReply.some((r) => r.payload?.reason === 'message_depth_exceeded'),
    'PIN: a reply to a reply still refuses message_depth_exceeded (depth stays 1)');
});

test('TC-09b waves.send pin: the C5 runId fan-out already receipts delivered/targetCount at the coordinator seam', async () => {
  const { coordinator } = coordinatorSetup({ adapter: new ScriptableAdapter(), capture: noDiff });
  const h1 = await coordinator.spawn('mock', makeBrief(), { runId: 'run:fan' });
  const h2 = await coordinator.spawn('mock', makeBrief(), { runId: 'run:fan' });
  const receipt = await coordinator.sendMessage(
    { kind: 'inform', to: { runId: 'run:fan' }, body: 'fan' }, { actor: 'orchestrator' },
  );
  assert.equal(receipt.result, 'sent');
  assert.equal(receipt.delivered, 2, 'PIN: every worker acks');
  assert.equal(receipt.targetCount, 2, 'PIN: targetCount is the worker count (coordinator.mjs:6893-6897)');
  void h1; void h2;
});

test('TC-09 waves.send[cell-broadcast-receipt-missing]: a cell send routes the C5 runId fan-out and receipts targetCount=size', async () => {
  // Source token `targetCount` is contaminated (the interrupt/stop outcome already carries it,
  // application.mjs:4067-4080,4688-4829) so this row is blocked-behavioral like TC-08/TC-22: the cell
  // mint must land first, then the send to the cell runId must route the C5 fan-out. A wrong
  // implementation that mints the cell but keeps the `.find()` first-worker lane fails the delivered
  // assertion below (TC-22b pins that today the lane returns {result, target}).
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'tc09', role: 'cell', size: 2 });
  assert.ok(sent.ok,
    'stage[cell-broadcast-receipt-missing]: a send to a cell runId routes the C5 runId fan-out and the receipt '
    + 'is {ok:true, result:\'sent\', messageId, delivered, targetCount:size} (Decision 5, TC-09); today the cell '
    + `run cannot even be minted — blocked at the cell mint (${sent.code}) — and sendWaveMember resolves the `
    + 'FIRST worker (application.mjs:11523-11524) returning {result, target}');
  const fanned = await fx.application.command('waves.send',
    { runId: sent.receipt.members[0].runId, message: 'cell steer' },
    { actor: `direct:${fx.principalOf('tc-planner').principalId}`, principalId: 'tc-planner', sessionId: 'tc-planner-session' },
    { transport: 'direct', requestId: 'tc09:send:req', idempotencyKey: 'tc09:send' })
    .then((receipt) => ({ ok: true, receipt }), (error) => ({ ok: false, code: error?.code ?? 'thrown' }));
  assert.equal(fanned.receipt?.delivered, 2,
    'stage[cell-broadcast-receipt-missing]: the receipt carries delivered=size — a wrong implementation that '
    + 'mints the cell but keeps the first-worker lane returns no delivered field and fails here');
  assert.equal(fanned.receipt?.targetCount, 2,
    'stage[cell-broadcast-receipt-missing]: the receipt carries targetCount=size');
});

test('TC-24 delivery[cell-delivery-mode-gate-missing]: a cell target admits nudge ONLY — now|turn refuse wave_cell_delivery_unsupported', () => {
  assertTokenInApplication('wave_cell_delivery_unsupported',
    'cell-delivery-mode-gate-missing',
    'a delivery now|turn request for a cell target refuses wave_cell_delivery_unsupported; nudge is admitted '
    + '(Decision 5, TC-24); today the code exists nowhere in application.mjs');
});

// ===========================================================================
// F — Shared horizon (existing machinery — PIN) + the v1.2 context depths
// ===========================================================================

test('TC-07 horizon[pin]: the run-scoped horizon serves every worker of the run; foreign runs refuse', async () => {
  const { adapter, coordinator } = coordinatorSetup({ adapter: new ScriptableAdapter(), capture: noDiff });
  const h1 = await coordinator.spawn('mock', makeBrief(), { runId: 'run:cell' });
  const h2 = await coordinator.spawn('mock', makeBrief(), { runId: 'run:cell' });
  const store = coordinator._coordination;
  const task1 = coordinator._tasks.get(h1.taskId);
  store.addKnowledgeNode({
    type: 'Finding', grounding: 'observed', body: 'cell-shared finding', repoId: store._repoId ?? 'local',
    runId: 'run:cell', evidence: [], taskId: task1.id,
  }, { actor: 'orchestrator', key: 'tc07-in' });
  const foreign = store.addKnowledgeNode({
    type: 'Finding', grounding: 'observed', body: 'foreign-run secret', repoId: store._repoId ?? 'local',
    runId: 'run:foreign', evidence: [],
  }, { actor: 'orchestrator', key: 'tc07-out' });
  emitContextRead(adapter, h2, { kind: 'knowledge', text: 'cell-shared' }, 'tc07-m2-read');
  await flush(40);
  const knowledge = coordinator._log.read(h2.id).filter((e) => e.kind === 'context.read_result').at(-1);
  const body = JSON.stringify(knowledge?.payload ?? {});
  assert.ok(body.includes('cell-shared finding'),
    'PIN: the shared-horizon law — every cell worker\'s taskId is in runTaskIds, so run-scoped nodes serve '
    + '(coordinator.mjs:11060-11078, ground truth 5)');
  assert.ok(!body.includes('foreign-run secret'),
    'PIN: a node promoted under a different run is outside the horizon');
  emitContextRead(adapter, h2, { kind: 'finding', id: foreign.node?.id ?? 'finding:foreign' }, 'tc07-finding');
  await flush(40);
  const foreignRead = coordinator._log.read(h2.id).filter((e) => e.kind === 'context.read_result').at(-1);
  assert.equal(foreignRead?.payload?.ok ?? null, false,
    'PIN: a foreign-run finding-by-id refuses context_scope_forbidden (coordinator.mjs:10653-10657)');
  assert.match(String(foreignRead?.payload?.result ?? ''), /scope|horizon|not_found/u,
    'PIN: constant scope refusal — no existence leak');
});

test('D-loose pin: a non-cell member\'s task-tier note is invisible to siblings (the loose default is byte-identical)', async () => {
  const { adapter, coordinator } = coordinatorSetup({ adapter: new ScriptableAdapter(), capture: noDiff });
  const h1 = await coordinator.spawn('mock', makeBrief(), { runId: 'run:loose' });
  const h2 = await coordinator.spawn('mock', makeBrief(), { runId: 'run:loose' });
  const store = coordinator._coordination;
  store.writeScratchpad(
    { runId: 'run:loose', taskId: h1.taskId, workerId: h1.id, entry: { kind: 'note', text: 'PRIVATE task-tier note' } },
    { actor: 'worker', principalId: h1.id, key: 'dloose-a' },
  );
  emitContextRead(adapter, h2, { kind: 'scratchpad' }, 'dloose-b-read');
  await flush(40);
  const result = coordinator._log.read(h2.id).filter((e) => e.kind === 'context.read_result').at(-1);
  const body = JSON.stringify(result?.payload ?? {});
  assert.ok(!body.includes('PRIVATE task-tier note'),
    'PIN: the read port constructs (runId, [\'shared\']) server-side (coordinator.mjs:10701-10703) — a sibling\'s '
    + 'task-tier partition never serves (bd3-v3 A4); the loose form stays byte-identical under the v1.2 depths');
});

test('D1 depth1[cell-mate-task-tier-read-missing]: a cell member\'s CONTEXT_READ resolves the cell\'s task tiers', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'd1', role: 'cell', size: 2 });
  assert.ok(sent.ok,
    'stage[cell-mate-task-tier-read-missing]: D1 requires a cell run — the cell branch of the run-start mint '
    + `(Decision 2) is the missing capability (blocked today at ${sent.code}); once minted, a cell member\'s `
    + 'scratchpad CONTEXT_READ must resolve the cell\'s task tiers (every member\'s task-ephemeral entries '
    + 'within the cell run), bounded and UNTRUSTED-framed, with zero promotion weight (v1.2 D-depth-1). '
    + 'A wrong implementation that mints the cell but leaves the read port on (runId, [\'shared\']) fails the '
    + 'member-read assertion that follows the mint.');
});

test('D2 depth2[direct-shared-write-missing]: a cell member may write the shared tier directly with the cell\'s nonce', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'd2', role: 'cell', size: 2 });
  assert.ok(sent.ok,
    'stage[direct-shared-write-missing]: D2 requires a cell run — once minted, a cell member\'s direct '
    + 'scratchpad write must land in the SHARED tier carrying the cell\'s nonce (today every worker write '
    + 'scopes worker:<workerId>, coordination-store.mjs:13844; the fence CAS stays, idempotency keys stay '
    + 'per-member, and a direct write never mints a KG candidate — v1.2 D-depth-2). A wrong implementation '
    + `that never admits the shared-tier write fails here; today blocked at the cell mint (${sent.code}).`);
});

test('D3 depth3[cell-reply-visibility-missing]: a member\'s reply is visible to its cell-mates', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'd3', role: 'cell', size: 2 });
  assert.ok(sent.ok,
    'stage[cell-reply-visibility-missing]: D3 requires a cell run — once minted, a member\'s reply to the cell '
    + 'broadcast is visible to its cell-mates (the reply receipt cites the cell + member index; cell-mates\' '
    + 'next frames carry the reply\'s framed excerpt; depth stays 1 per member — v1.2 D-depth-3). A wrong '
    + 'implementation that admits the reply but never mirrors it to siblings fails here; today blocked at the '
    + `cell mint (${sent.code}).`);
});

test('D4 depth4[shared-worktree-option-missing]: group.worktree:\'shared\' is admitted and one tree is captured', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'd4', role: 'cell', size: 2, group: { worktree: 'shared' } });
  assert.ok(sent.ok,
    'stage[shared-worktree-option-missing]: the closed group field gains the optional worktree:\'shared\' — '
    + 'one worktree, one capture, the collective diff, conflicts surfacing as cell.conflict attention items '
    + '(v1.2 D-depth-4); today the group key is refused wholesale at admission, so the option cannot even be '
    + `declared (${sent.code}).`);
});

// ===========================================================================
// G — Trust-gate division (Decision 2; group.editing -> analysis:true)
// ===========================================================================

test('TC-23a trust[cell-editing-division-missing]: group.editing divides the gate — non-listed members carry analysis:true', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'tc23', role: 'cell', size: 2, group: { editing: [0] } });
  assert.ok(sent.ok,
    'stage[cell-editing-division-missing]: group.editing (closed sorted member indexes, default ALL) must be '
    + 'admitted and the cell branch must set analysis:true on every non-listed member\'s task brief so the '
    + 'per-worker gate and the #88 preflight compose UNCHANGED (Decision 2, TC-23); an idle EDITING member is '
    + 'still policy-killed. A wrong implementation that admits editing but never writes analysis:true to the '
    + `briefs fails the brief assertion that follows; today blocked at the cell mint (${sent.code}).`);
});

test('TC-23b trust pin: analysis:true documents repository_edit as not-required — the existing TG5 hatch', async () => {
  const { adapter, coordinator } = coordinatorSetup({ adapter: new ScriptableAdapter({ pausable: false }), capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief({ analysis: true, requiredEffects: [] }));
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.notEqual(coordinator._tasks.get(handle.taskId).status, 'failed',
    'PIN: analysis:true skips required_effect — the gate stays per-worker (TG5, T14)');
});

test('TC-23c trust pin: an idle EDITING member is still policy-killed — the safe direction', async () => {
  const { adapter, coordinator } = coordinatorSetup({ adapter: new ScriptableAdapter({ pausable: false }), capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief({ requiredEffects: ['repository_edit'] })); // diffless, no analysis
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'failed',
    'PIN: a diffless editing member with required repository_edit still fails required_effect_absent (T14b)');
});

// ===========================================================================
// H — Per-member grant mint & mint-key derivation (Decision 4)
// ===========================================================================

test('TC-08 grant[per-worker-grant-mint-missing]: a waves.send claimGrant to a cell runId mints size grants', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'tc08', role: 'cell', size: 2 });
  assert.ok(sent.ok,
    'stage[per-worker-grant-mint-missing]: a waves.send claimGrant to a cell runId mints ONE grant PER cell '
    + 'worker — size grants, each bound to its own (workerId, taskId, taskVersion, processGeneration) and all '
    + 'sharing memberRunId = cellRunId (Decision 4, TC-08); today the mint resolves _taskByRun(runId) — the '
    + `FIRST task (coordination-store.mjs:15011-15016). Blocked at the cell mint (${sent.code}).`);
});

test('TC-22 grant[per-member-mint-key-missing]: size mints under one send key derive per-member caller keys', async () => {
  const fx = await waveFixture();
  const sent = await startCellRun(fx, { idem: 'tc22', role: 'cell', size: 2 });
  assert.ok(sent.ok,
    'stage[per-member-mint-key-missing]: the size per-worker mints under ONE waves.send idempotencyKey derive '
    + 'per-member caller keys <sendKey>:<workerId> — mint #2..N never collide (Decision 4, TC-22); today the '
    + 'mint lane is raw-caller-key indexed (coordination-store.mjs:14992-14995, ground truth 15). Blocked at '
    + `the cell mint (${sent.code}).`);
});

test('TC-22b grant pin: waves.send resolves worker[0] of the runId — the seam the per-member mint must replace', async () => {
  // The grant mint's raw-caller-key collision (ground truth 15, coordination-store.mjs:14992-14995) is not
  // reachable today — waves.send refuses the claimGrant request (BW-03's red stage) — so the honest pin for
  // TC-08/TC-22 is the resolution substrate the cell mint must replace: today waves.send to a multi-worker
  // runId steers worker[0] ONLY and receipts {result, target} — no per-worker fan-out, no delivered/targetCount.
  const fx = await waveFixture();
  const h1 = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:two' });
  const h2 = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:two' });
  assert.notEqual(h1.id, h2.id, 'PIN: two live workers share the runId');
  const sent = await fx.application.command('waves.send',
    { runId: 'run:two', message: 'steer' },
    { actor: `direct:${fx.principalOf('tc-planner').principalId}`, principalId: 'tc-planner', sessionId: 'tc-planner-session' },
    { transport: 'direct', requestId: 'tc22b:req', idempotencyKey: 'tc22b' })
    .then((receipt) => ({ ok: true, receipt }), (error) => ({ ok: false, code: error?.code ?? 'thrown' }));
  assert.ok(sent.ok, 'PIN: the non-cell send lane reaches the run');
  assert.equal(sent.receipt.target, h1.id,
    'PIN: waves.send resolves worker[0] — the FIRST worker (application.mjs:11523-11524), the seam the '
    + 'per-member grant mint must replace');
  assert.equal(sent.receipt.delivered ?? sent.receipt.targetCount, undefined,
    'PIN: the wave send receipt is {schemaVersion, runId, result, target} — no delivered/targetCount');
  assert.equal(fx.adapter.calls.prompt.filter((call) => call.worker === h1.id).length, 1,
    'PIN: exactly one steer — the first worker only');
});

// ===========================================================================
// I — Size bound & loose-form byte-identity (Decision 1, TC-17/TC-18)
// ===========================================================================

test('TC-17 size[cell-size-bound-missing]: MAX_CELL_SIZE is a named documented count bound of 64', () => {
  assert.equal(waveModule.MAX_CELL_SIZE, 64,
    'stage[cell-size-bound-missing]: MAX_CELL_SIZE is a named, documented count-based circuit breaker set to 64 '
    + '— the same bound as the wave member-array ceiling (wave.mjs:163) and comfortably under the run-view '
    + 'worker ceiling — never an arbitrary silent limit (Decision 1, TC-17, campaign law); today the export is '
    + `undefined (${String(waveModule.MAX_CELL_SIZE)})`);
});

test('TC-17b size pin: the derivation anchors MAX_CELL_SIZE rests on exist today', () => {
  assert.equal(typeof waveModule.MAX_WAVE_PROGRESS_BYTES, 'number',
    'PIN: MAX_WAVE_PROGRESS_BYTES bounds the wave progress snapshot (wave.mjs:21)');
  const waveSrc = readFileSync(new URL('../src/wave.mjs', import.meta.url), 'utf8');
  assert.match(waveSrc, /membersInput\.length > 64/u,
    'PIN: the wave member-array ceiling is 64 (wave.mjs:163) — the derivation anchor for MAX_CELL_SIZE');
});

test('TC-18 loose[pin]: a wave with no group fields is byte-identical today', async () => {
  const fx = await waveFixture();
  const wave = await fx.baton.waves.start({ members: [{ role: 'worker', objective: 'loose work', scope: ['.'], harness: 'mock', model: 'mock-model', effort: 'low' }] });
  const run = wave.runs.get('worker');
  assert.ok(run, 'PIN: the loose member starts a run');
  const view = await run.status();
  assert.equal(view.ownership?.workerIds?.length ?? 0, 1,
    'PIN: one member = one run = one worker (loose form, ground truth 2)');
  const member = fx.driver.coordinator.list().find((w) => w.runId === view.runId);
  assert.ok(member, 'PIN: the member worker exists');
  for (const delivery of ['now', 'turn', undefined]) {
    const sent = await fx.application.command('waves.send',
      { runId: view.runId, message: 'steer', ...(delivery === undefined ? {} : { delivery }) },
      { actor: `direct:${fx.principalOf('tc-planner').principalId}`, principalId: 'tc-planner', sessionId: 'tc-planner-session' },
      { transport: 'direct', requestId: `tc18:${delivery ?? 'n'}:req`, idempotencyKey: `tc18:${delivery ?? 'n'}` })
      .then((receipt) => ({ ok: true, receipt }), (error) => ({ ok: false, code: error?.code ?? 'thrown' }));
    assert.ok(sent.ok, `PIN: the non-cell send lane keeps delivery ${delivery ?? 'nudge'} (TC-18)`);
    assert.equal(sent.receipt.target, member.id,
      'PIN: waves.send targets the single worker of the runId (application.mjs:11523-11524)');
  }
});
