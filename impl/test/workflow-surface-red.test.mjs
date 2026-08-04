// Workflow-surface rung red suite (contract: docs/reference/evidence/
// facade-projection-2026-08-03/facade-projection-contract.md v2.1 — epic #87+#48,
// red-team fold contract-redteam.md / contract-fold.md, 7 blockers folded).
//
// Thirty rows over the folded decisions: the eight facade direct ports
// (run.message.send/receipt, run.attention.watch, run.scratchpad.read/elevate,
// run.board.post/read, run.knowledge.seed), their six ordinary MCP projections,
// the CLI verbs + registry rows + conformance regeneration, the #89 cap+actual
// refusal text, and the Decision 13 scripted-workflow live acceptance (WS-01/WS-02).
//
// Red-first: written against the v2.1 contract BEFORE implementation; every positive
// row fails for the named stage and goes green on the contract's implementation ONLY.
// Guard pins (store-direct elevation postures, settlement-plane byte-identity,
// conformance mains, static source pins) are green today by construction and MUST
// stay green; they exist so a wrong implementation has nowhere to hide.
//
// Fixture idiom: board-workerhalf-red's waveFixture (a real createDriver stack with
// a ScriptableAdapter, kernel staging through driver.coordinator/driver.coordination,
// facade invocation through application.command(name, args, principal, context));
// mcp-packaging-red's McpFleetServer + initialized()/resultText for the wire rows;
// control-surface-truth-red's executable conformance mains for the docs pins.
// NUL-byte discipline: coordinator.mjs/application.mjs/coordination-store.mjs are
// never read whole by this suite (behavioral rows only; mcp-northbound.mjs and
// wave-driver.mjs are NUL-free and are source-grepped for the static pins).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter } from '../src/adapter.mjs';
import {
  APPLICATION_COMMAND_DEFINITIONS,
  BatonApplication,
  projectBoardView,
} from '../src/application.mjs';
import { parseBatonCli, CLI_WEB_COMMANDS } from '../src/application-cli.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import {
  CoordinationStore,
  createDriver,
  DEFAULT_RUN_LINEAGE_POLICY,
  McpFleetServer,
} from '../src/index.mjs';
import {
  mcpApplicationToolNames,
  mcpCombinedToolNames,
} from '../src/mcp-northbound.mjs';
import {
  checkSurfaceDocs,
  servedCliOrdinaryKeys,
} from '../scripts/render-surface-docs.mjs';
import { BANNED_SURFACE_VERBS } from '../scripts/surface-conformance.mjs';

const REPO = 'repo-workflow-surface';
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const conformanceScript = fileURLToPath(new URL('../scripts/surface-conformance.mjs', import.meta.url));

const dirs = [];
const drivers = [];
function tmpDir(label = 'baton-ws-') {
  const d = mkdtempSync(join(tmpdir(), label));
  dirs.push(d);
  return d;
}
test.after(async () => {
  for (const driver of drivers) {
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function gitRepo(label) {
  const repo = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  return repo;
}

const canonical = (value) => (Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value));
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

function makeBrief(overrides = {}) {
  return {
    goal: 'read the world, then produce the deliverable',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'report written',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: [],
    ...overrides,
  };
}

// The bd3 staging adapter: admits spawns, records prompts, and emits only what the
// harness drives (no autonomous turns — receipt/attention rows control every epoch).
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'workflow-surface-red', refreshedAt: null,
      },
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

// WS-01's adapter: the scenario-driven MockAdapter (members run to completion and
// block on their decision ask) plus the run-debug emit shim for harness interludes.
class WorkflowAdapter extends MockAdapter {
  constructor(scenario) {
    super({ harness: 'mock', scenario });
    const baseCard = this.card.bind(this);
    this.card = () => ({
      ...baseCard(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'workflow-surface-red', refreshedAt: null,
      },
    });
  }
  emit(event) {
    const session = this._sessions.get(event.worker);
    if (session) this._emit(session, event.kind, event.payload ?? {});
  }
}

const PROFILE = Object.freeze({
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
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

// Full application fixture (board-workerhalf-red pattern, trimmed): one real
// createDriver stack so the facade, the kernel lanes, and the durable store share
// state. Options: authorize (host policy stub — mcp-packaging-red:556 idiom),
// adapter (defaults to the quiet ScriptableAdapter), goalPlan (adds the goal/plan
// authority the run.start/waves.start pipeline needs — WS-01 only).
async function facadeFixture(t, { authorize = async () => true, adapter = new ScriptableAdapter(), goalPlan = false } = {}) {
  const repo = gitRepo('baton-ws-repo-');
  const logDir = tmpDir('baton-ws-log-');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 0 },
    ...(goalPlan ? { goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true } } : {}),
  });
  drivers.push(driver);
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('ws-planner'),
      dispatcher: principalOf('ws-dispatcher'),
      observer: principalOf('ws-observer'),
    },
    authorize,
  });
  t.after(async () => {
    try { await application.shutdown(principalOf('ws-cleanup')); } catch { /* RED failures may interrupt setup */ }
  });
  const coordination = driver.coordination;
  return { repo, logDir, adapter, driver, application, coordination };
}

// A wave-shaped member (byte-exact steering.registered record, application.mjs's
// run-creation ceremony): a coordinator-spawned worker on an explicit runId plus
// the registration the facade writes when run.start carries driverKind.
async function spawnMember(fx, { runId, role = 'member', waveId = 'wave:ws' }) {
  const handle = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId });
  fx.coordination.recordDriver('steering.registered', {
    runId, driverKind: 'wave', actor: 'test:orchestrator', waveId, waveRole: role,
  }, { actor: 'test:orchestrator', key: `run.steering_registered:${runId}` });
  return handle;
}

function writeNote(fx, { runId, taskId, workerId, text, key }) {
  return fx.coordination.writeScratchpad(
    { runId, taskId, workerId, entry: { kind: 'note', text } },
    { actor: 'worker', principalId: workerId, key },
  );
}

function completeTask(fx, taskId) {
  const task = fx.coordination.task(taskId);
  return fx.coordination.transitionTask(taskId, 'completed', task.version, {
    actor: 'policy', key: `ws.complete:${taskId}`,
  });
}

// A stopped run, staged store-directly (the seam's board_run_closed state:
// _runStops membership). Mirrors admitRunStop's closed envelope.
function stopRun(fx, runId) {
  const reasonDigest = digest({ reason: `ws stop ${runId}` });
  return fx.coordination.admitRunStop({
    schemaVersion: 1, repoId: REPO, runId, reasonDigest,
    requestDigest: digest({ repoId: REPO, runId, reasonDigest }),
  }, { actor: 'orchestrator', key: `run.stop:${runId}` });
}

// The board-authority-red lease ceremony: an orchestrator task on runId, a claimed
// worker, and an issued run-orchestrator lease; returns the closed sessionAuthority
// proof plus the principal the lane's review authority recognizes.
function authorityOn(fx, { runId, principalId, sessionId }) {
  const coordination = fx.coordination;
  const authorityDigest = digest({ proof: `${runId}:${principalId}:${sessionId}` });
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const taskId = `task-${runId}-${principalId}`.replaceAll(':', '-');
  const workerId = `worker-${runId}-${principalId}`.replaceAll(':', '-');
  coordination.createTask({
    id: taskId, brief: { objective: `orchestrate ${runId}`, capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'mock-model',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = coordination.claimTask(taskId, workerId, 1,
    { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
      harnessRequested: 'mock', harnessResolved: 'mock@fixture',
      modelRequested: 'mock-model', modelResolved: 'mock-model', modelObserved: 'mock-model',
      effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
      routeKey: '["mock","fixture","mock-model","low"]',
    }).task;
  const leaseId = `run-orchestrator-lease:${digest({
    repoId: REPO, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version,
    workerId, principalId, sessionId, sessionAuthorityDigest: authorityDigest,
  })}`;
  const receipt = coordination.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO, parentTask: { id: taskId, version: task.version },
    session: { principalId, sessionId, authorityDigest, expiresAt },
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
  const sessionAuthority = Object.freeze({
    schemaVersion: 1, authorityDigest, expiresAt, orchestratorLeaseId: receipt.lease.leaseId,
  });
  return { receipt, runId, principalId, sessionId, sessionAuthority, taskId, workerId };
}

async function flush(times = 40) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

// Bounded poll on a durable predicate (reaching mechanism, never the oracle):
// returns the first truthy probe or throws with the last observation.
async function until(probe, { tries = 240, delayMs = 25, label = 'predicate' } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => { setTimeout(resolve, delayMs); });
  }
  throw new Error(`until: ${label} never became true (last: ${JSON.stringify(last)?.slice(0, 200)})`);
}

// Capture the lane's own coded refusal for byte-identity comparison (the facade
// must propagate code AND message untouched — Decision 1).
async function laneError(fn) {
  try { await fn(); return null; } catch (error) { return { code: error?.code ?? null, message: error?.message ?? null }; }
}
async function facadeError(fn) { return laneError(fn); }

const MSG_ID = `message:${'a'.repeat(64)}`;
const ENTRY_ID = (n) => `scratchpad-entry:${String(n).padStart(64, '0')}`;

// ===========================================================================
// Section A — FP-01: the eight commands dispatch as direct ports with closed
// shapes (stage: commands absent — every dispatch throws
// application_command_unavailable today). Closure cases refuse the pinned
// application_*_invalid code BEFORE any state lookup: the refuse-everything
// policy proves authorization is never reached on a shape failure, and no bare
// TypeError ever escapes (every refusal carries a string .code).
// ===========================================================================

const REFUSE_ALL = async () => false;

test('FP-01-message (stage: ports absent): run.message.send/receipt dispatch; closed shapes refuse before state', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const wave = principalOf('wave-owner');
  // Dispatch: a shape-valid send reaches authorization (policy refuses), never
  // application_command_unavailable. A correct implementation passes; today the
  // port does not exist.
  const sent = await facadeError(() => fx.application.command('run.message.send', {
    runId: 'run:a1', kind: 'inform', body: 'hello',
  }, wave, null));
  assert.notEqual(sent?.code, 'application_command_unavailable', 'stage: run.message.send must dispatch as a direct port');
  assert.equal(sent?.code, 'application_unauthorized', 'a shape-valid send reaches the policy seam');
  const receipt = await facadeError(() => fx.application.command('run.message.receipt', {
    messageId: MSG_ID,
  }, wave, null));
  assert.notEqual(receipt?.code, 'application_command_unavailable', 'stage: run.message.receipt must dispatch');
  // Closure: every case refuses application_message_send_invalid BEFORE the policy
  // seam (REFUSE_ALL would answer application_unauthorized if validation did not win).
  const sendCases = [
    { runId: 'run:a1', kind: 'inform', body: 'x', surprise: true }, // extra field
    { runId: 'run:a1', kind: 'inform' }, // missing body
    { runId: 'run:a1', kind: 'bogus', body: 'x' }, // bad enum
    { runId: 'run:a1', workerId: 'w-1', kind: 'inform', body: 'x' }, // non-XOR (both targets)
    { kind: 'inform', body: 'x' }, // non-XOR (neither target)
    { runId: 'run:a1', kind: 'inform', body: '' }, // empty body
    { workerId: 'bad worker id', kind: 'inform', body: 'x' }, // malformed workerId
    { runId: 'run:a1', kind: 'steer', body: 'x', principalId: 'mallory' }, // self-named principal field
  ];
  for (const args of sendCases) {
    const refusal = await facadeError(() => fx.application.command('run.message.send', args, wave, null));
    assert.equal(refusal?.code, 'application_message_send_invalid', `send closure: ${JSON.stringify(args)}`);
  }
  const receiptCases = [
    { messageId: 'msg-1' }, // not the minted shape
    { messageId: MSG_ID, extra: 1 }, // extra field
    {}, // missing messageId
  ];
  for (const args of receiptCases) {
    const refusal = await facadeError(() => fx.application.command('run.message.receipt', args, wave, null));
    assert.equal(refusal?.code, 'application_message_receipt_invalid', `receipt closure: ${JSON.stringify(args)}`);
  }
});

test('FP-01-attention (stage: port absent): run.attention.watch dispatches; shape closure is the facade\'s own code', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  // Dispatch: a shape-valid watch on an unknown run pages EMPTY at the lane for the
  // orchestrator principal (it does not refuse — ground truth 4/Decision 5).
  const page = await fx.application.command('run.attention.watch', { runId: 'run:unknown-a2' }, wave, null);
  assert.equal(page?.schemaVersion, 1, 'the page carries the facade envelope marker');
  assert.ok(Array.isArray(page?.reasons), 'the lane page shape passes through verbatim');
  // Closure: the facade validates runId/kind/cursor SHAPE with its own code.
  const cases = [
    { runId: 'bad run id' }, // malformed runId
    { runId: 'run:a2', cursor: -1 }, // negative cursor
    { runId: 'run:a2', cursor: 1.5 }, // non-integer cursor
    { runId: 'run:a2', kind: 7 }, // non-string kind
    { runId: 'run:a2', timeoutMs: 100 }, // timeoutMs is NOT projected (Decision 5)
    { runId: null }, // the lane's bare deployment scope is deliberately not projected
  ];
  for (const args of cases) {
    const refusal = await facadeError(() => fx.application.command('run.attention.watch', args, wave, null));
    assert.equal(refusal?.code, 'application_attention_watch_invalid', `watch closure: ${JSON.stringify(args)}`);
  }
});

test('FP-01-scratchpad (stage: ports absent): run.scratchpad.read/elevate dispatch; closed scopes and entry shapes', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const wave = principalOf('wave-owner');
  const read = await facadeError(() => fx.application.command('run.scratchpad.read', {
    runId: 'run:a3', scope: 'shared',
  }, wave, null));
  assert.notEqual(read?.code, 'application_command_unavailable', 'stage: run.scratchpad.read must dispatch');
  assert.equal(read?.code, 'application_unauthorized', 'a shape-valid read reaches the policy seam');
  const elevate = await facadeError(() => fx.application.command('run.scratchpad.elevate', {
    runId: 'run:a3', taskId: 'task-1', entryIds: [ENTRY_ID(1)],
  }, wave, null));
  assert.notEqual(elevate?.code, 'application_command_unavailable', 'stage: run.scratchpad.elevate must dispatch');
  assert.equal(elevate?.code, 'application_unauthorized', 'a shape-valid elevate reaches the policy seam');
  const readCases = [
    { runId: 'run:a3', scope: 'bogus' }, // scope outside the closed pattern
    { runId: 'run:a3', scope: 'worker:' }, // empty worker id
    { runId: 'run:a3', scope: 'shared', cursor: '3' }, // non-integer cursor
    { runId: 'run:a3' }, // missing scope
  ];
  for (const args of readCases) {
    const refusal = await facadeError(() => fx.application.command('run.scratchpad.read', args, wave, null));
    assert.equal(refusal?.code, 'application_scratchpad_read_invalid', `read closure: ${JSON.stringify(args)}`);
  }
  const elevateCases = [
    { runId: 'run:a3', taskId: 'task-1', entryIds: 'not-an-array' },
    { runId: 'run:a3', taskId: 'task-1', entryIds: ['not-an-entry-id'] },
    { runId: 'run:a3', taskId: 'task-1', entryIds: [ENTRY_ID(1), ENTRY_ID(1)] }, // duplicates
    { runId: 'run:a3', taskId: 'task-1', entryIds: Array.from({ length: 129 }, (_, i) => ENTRY_ID(i + 1)) }, // >128
    { runId: 'run:a3', entryIds: [ENTRY_ID(1)] }, // missing taskId
  ];
  for (const args of elevateCases) {
    const refusal = await facadeError(() => fx.application.command('run.scratchpad.elevate', args, wave, null));
    assert.equal(refusal?.code, 'application_scratchpad_elevate_invalid', `elevate closure: ${JSON.stringify(args)}`);
  }
});

test('FP-01-board (stage: ports absent): run.board.post/read dispatch with closed board/item shapes', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const wave = principalOf('wave-owner');
  const post = await facadeError(() => fx.application.command('run.board.post', {
    runId: 'run:a4', board: 'ws-a4', title: 'first item',
  }, wave, null));
  assert.notEqual(post?.code, 'application_command_unavailable', 'stage: run.board.post must dispatch');
  assert.equal(post?.code, 'application_unauthorized', 'a shape-valid post reaches the policy seam');
  const read = await facadeError(() => fx.application.command('run.board.read', {
    runId: 'run:a4', board: 'ws-a4',
  }, wave, null));
  assert.notEqual(read?.code, 'application_command_unavailable', 'stage: run.board.read must dispatch');
  assert.equal(read?.code, 'application_unauthorized', 'a shape-valid read reaches the policy seam');
  const postCases = [
    { runId: 'run:a4', board: 'bad board!', title: 't' }, // board outside SAFE_BOARD_ID
    { runId: 'run:a4', board: 'ws-a4', title: '' }, // empty title
    { runId: 'run:a4', board: 'ws-a4', title: 't', detail: 7 }, // non-string detail
    { runId: 'run:a4', board: 'ws-a4', title: 't', owner: 'bad owner id' }, // malformed owner
    { runId: 'run:a4', board: 'ws-a4', title: 't', evidence: Array.from({ length: 9 }, (_, i) => ({ coordinationSeq: i })) }, // >8 refs
    { runId: 'run:a4', board: 'ws-a4' }, // missing title
  ];
  for (const args of postCases) {
    const refusal = await facadeError(() => fx.application.command('run.board.post', args, wave, null));
    assert.equal(refusal?.code, 'application_board_post_invalid', `post closure: ${JSON.stringify(args)}`);
  }
  const readCases = [
    { runId: 'run:a4' }, // missing board (board is REQUIRED in v1 — Open Question 5)
    { runId: 'run:a4', board: 'bad board!' },
    { runId: 'run:a4', board: 'ws-a4', extra: true },
  ];
  for (const args of readCases) {
    const refusal = await facadeError(() => fx.application.command('run.board.read', args, wave, null));
    assert.equal(refusal?.code, 'application_board_read_invalid', `read closure: ${JSON.stringify(args)}`);
  }
});

test('FP-01-knowledge (stage: port absent): run.knowledge.seed dispatches; the Finding-scoped rule and Decision refusal live at validation', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const wave = principalOf('wave-owner');
  const seed = await facadeError(() => fx.application.command('run.knowledge.seed', {
    runId: 'run:a5', type: 'Finding', grounding: 'observed', body: 'a seeded finding',
  }, wave, null));
  assert.notEqual(seed?.code, 'application_command_unavailable', 'stage: run.knowledge.seed must dispatch');
  assert.equal(seed?.code, 'application_unauthorized', 'a shape-valid seed reaches the policy seam');
  const cases = [
    { runId: 'run:a5', type: 'Bogus', grounding: 'observed', body: 'x' }, // type outside the 19
    { runId: 'run:a5', type: 'Decision', grounding: 'asserted', body: 'x', evidence: [{ coordinationSeq: 1 }] }, // Decision unseedable (recorded subtraction)
    { runId: 'run:a5', type: 'Finding', grounding: 'bogus', body: 'x' }, // grounding outside the four
    { runId: 'run:a5', type: 'Finding', grounding: 'observed', body: '' }, // empty body
    { runId: 'run:a5', type: 'Finding', grounding: 'observed', body: 'x', evidence: [{ foo: 1 }] }, // ref names neither key
    { runId: 'run:a5', type: 'Finding', grounding: 'observed', body: 'x', evidence: 'not-an-array' },
    { runId: 'run:a5', type: 'Finding', grounding: 'verified', body: 'x' }, // verified FINDING requires evidence (Finding-scoped rule)
    { runId: 'run:a5', type: 'Finding', grounding: 'observed', body: 'x', sessionAuthority: { forged: true } }, // authority envelope field
  ];
  for (const args of cases) {
    const refusal = await facadeError(() => fx.application.command('run.knowledge.seed', args, wave, null));
    assert.equal(refusal?.code, 'application_knowledge_seed_invalid', `seed closure: ${JSON.stringify(args)}`);
  }
  // The rule is Finding-SCOPED (red-team blocker #3 fix): a verified Constraint
  // without evidence is lane-legal, so it must reach the policy seam, never refuse
  // at validation (a facade narrower than the lane is a Decision 1 violation).
  const constraint = await facadeError(() => fx.application.command('run.knowledge.seed', {
    runId: 'run:a5', type: 'Constraint', grounding: 'verified', body: 'a verified constraint needs no evidence',
  }, wave, null));
  assert.equal(constraint?.code, 'application_unauthorized',
    'a verified Constraint without evidence is NOT validation-refused (the rule mirrors the lane\'s Finding scope)');
});

// ===========================================================================
// Section B — the message lane (stage: facade projection absent; the BD3-C lane
// is landed). FP-02 outcome parity; FP-03 target constancy; FP-04 THE IDENTITY
// ROW (facade == coordinator receipt at every transition — the D-anchor pin);
// FP-05 resolve-then-authorize constancy (possession of a digest is never authority).
// ===========================================================================

test('FP-02 (stage: facade send absent): facade send mints and delivers identically to the embedded lane', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const handleA = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:b1' });
  const handleB = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:b1' });
  const viaFacade = await fx.application.command('run.message.send', {
    workerId: handleA.id, kind: 'inform', body: 'the candidacy board has two items for you',
  }, wave, null);
  assert.equal(viaFacade?.schemaVersion, 1, 'the facade adds ONLY the envelope marker');
  assert.equal(viaFacade?.ok, true);
  assert.equal(viaFacade?.result, 'sent');
  assert.match(viaFacade?.messageId ?? '', /^message:[a-f0-9]{64}$/u, 'the facade send mints the lane id shape (C1)');
  const viaLane = await fx.driver.coordinator.sendMessage({
    kind: 'inform', to: { workerId: handleB.id }, body: 'the candidacy board has two items for you',
  }, { actor: 'orchestrator' });
  // Outcome identity: every non-id field of the lane outcome arrives untouched.
  assert.deepEqual(Object.keys(viaFacade).sort(), [...Object.keys(viaLane), 'schemaVersion'].sort(),
    'the projection adds no response field beyond the envelope marker');
  for (const key of Object.keys(viaLane)) {
    if (key === 'messageId') continue;
    assert.deepEqual(viaFacade[key], viaLane[key], `field ${key} is verbatim`);
  }
  // A run-target send reaches every active member once (C5 bounded fan-out).
  const broadcast = await fx.application.command('run.message.send', {
    runId: 'run:b1', kind: 'inform', body: 'wave-wide inform',
  }, wave, null);
  assert.equal(broadcast?.ok, true);
  assert.equal(broadcast?.result, 'sent');
  assert.equal(broadcast?.targetCount, 2);
});

test('FP-03 (stage: facade send absent): unknown ≡ foreign at the policy seam; lane outcomes verbatim', async (t) => {
  // The refusing stub refuses BOTH the run AND the null scope (red-team Decision 3
  // note): an unresolvable worker authorizes against null, so a run-only stub would
  // stage this row wrong against a correct implementation.
  const REFUSED_RUN = 'run:b2-foreign';
  const authorize = async (request) => !(request.runId === REFUSED_RUN || request.runId === null);
  const fx = await facadeFixture(t, { authorize });
  const wave = principalOf('wave-owner');
  const foreignHandle = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: REFUSED_RUN });
  const unknown = await facadeError(() => fx.application.command('run.message.send', {
    workerId: 'w-never-spawned', kind: 'inform', body: 'x',
  }, wave, null));
  const foreign = await facadeError(() => fx.application.command('run.message.send', {
    workerId: foreignHandle.id, kind: 'inform', body: 'x',
  }, wave, null));
  assert.equal(unknown?.code, 'application_unauthorized');
  assert.equal(foreign?.code, 'application_unauthorized');
  assert.equal(unknown?.message, foreign?.message,
    'unknown worker ≡ foreign worker — possession of a worker id is never authority (constant refusal, no existence leak)');
  const foreignRun = await facadeError(() => fx.application.command('run.message.send', {
    runId: REFUSED_RUN, kind: 'inform', body: 'x',
  }, wave, null));
  assert.equal(foreignRun?.code, 'application_unauthorized');
  assert.equal(foreignRun?.message, unknown?.message, 'the refusal is one constant across target forms');
  // With the permissive stub the lane's own typed OUTCOMES arrive verbatim (never re-coded).
  const fx2 = await facadeFixture(t);
  const inactiveWorker = await fx2.application.command('run.message.send', {
    workerId: 'w-never-spawned', kind: 'query', body: 'status?',
  }, wave, null);
  assert.deepEqual(inactiveWorker, { schemaVersion: 1, ok: false, result: 'worker_not_active' },
    'the lane\'s outcome object verbatim plus the envelope marker — never padded with fabricated fields');
  const emptyRun = await fx2.application.command('run.message.send', {
    runId: 'run:b2-empty', kind: 'inform', body: 'x',
  }, wave, null);
  assert.deepEqual(emptyRun, { schemaVersion: 1, ok: false, result: 'run_not_active' });
});

test('FP-04 (stage: facade receipt absent) THE IDENTITY ROW: facade == coordinator receipt at every transition', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const coordinator = fx.driver.coordinator;
  const handle = await coordinator.spawn('mock', makeBrief(), { runId: 'run:b3' });
  const sent = await fx.application.command('run.message.send', {
    workerId: handle.id, kind: 'query', body: 'status?',
  }, wave, null);
  const both = async (messageId) => {
    const viaFacade = await fx.application.command('run.message.receipt', { messageId }, wave, null);
    const viaLane = coordinator.messageReceipt(messageId);
    assert.equal(viaFacade?.schemaVersion, 1, 'the envelope marker rides');
    assert.equal(viaFacade?.messageId, messageId, 'the messageId echo (Decision 1 envelope completion)');
    return {
      facade: { delivered: viaFacade.delivered, read: viaFacade.read, actedOn: viaFacade.actedOn, reply: viaFacade.reply },
      lane: viaLane,
    };
  };
  // At send: delivered, never read, never acted-on (C3 honesty).
  let pair = await both(sent.messageId);
  assert.deepEqual(pair.facade, pair.lane, 'receipt identity at send');
  assert.deepEqual(pair.facade, { delivered: true, read: null, actedOn: null, reply: null });
  // After a same-generation turn_started: read flips on both paths.
  fx.adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.turn_started', actor: 'worker', payload: {} });
  await flush();
  pair = await both(sent.messageId);
  assert.deepEqual(pair.facade, pair.lane, 'receipt identity after same-generation read');
  assert.equal(pair.facade.read, true);
  // Death between delivered and read: read stays null forever, on BOTH paths (C3).
  const sent2 = await fx.application.command('run.message.send', {
    workerId: handle.id, kind: 'inform', body: 'second',
  }, wave, null);
  fx.adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.process_closed', actor: 'worker', payload: { code: 143 } });
  await flush();
  pair = await both(sent2.messageId);
  assert.deepEqual(pair.facade, pair.lane, 'receipt identity across process death');
  assert.deepEqual(pair.facade, { delivered: true, read: null, actedOn: null, reply: null },
    'delivered is written at send; read is never upgraded to a lie');
  // A respawned worker does NOT inherit the read (C3b process-scoping, projected as-is).
  fx.adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 3, kind: 'lifecycle.turn_started', actor: 'worker', payload: {} });
  await flush();
  pair = await both(sent2.messageId);
  assert.deepEqual(pair.facade, pair.lane, 'receipt identity after respawn');
  assert.equal(pair.facade.read, null, 'a new process generation does not mark the old delivery read');
  // With a reply: the closed {messageId, inReplyTo, from, body} envelope and NOTHING
  // else (C1b) — smuggled fields never reach either receipt.
  const sent3 = await fx.application.command('run.message.send', {
    workerId: handle.id, kind: 'query', body: 'third',
  }, wave, null);
  fx.adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 3, kind: 'message.send', actor: 'worker',
    payload: { inReplyTo: sent3.messageId, body: 'ack — picking up the first now', priority: 'high', cc: ['w-9'] },
  });
  await flush();
  pair = await both(sent3.messageId);
  assert.deepEqual(pair.facade, pair.lane, 'receipt identity with a reply');
  assert.equal(pair.facade.reply?.body, 'ack — picking up the first now');
  assert.deepEqual(Object.keys(pair.facade.reply ?? {}).sort(), ['body', 'from', 'inReplyTo', 'messageId'],
    'the reply envelope is closed (smuggled fields absent on the projected path too)');
});

test('FP-05 (stage: facade receipt absent): resolve-then-authorize — unknown ≡ foreign, the lane\'s null unreachable', async (t) => {
  const REFUSED_RUN = 'run:b4-foreign';
  const authorize = async (request) => !(request.runId === REFUSED_RUN || request.runId === null);
  const fx = await facadeFixture(t, { authorize });
  const wave = principalOf('wave-owner');
  const foreignHandle = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: REFUSED_RUN });
  const sent = await fx.driver.coordinator.sendMessage({
    kind: 'inform', to: { workerId: foreignHandle.id }, body: 'secret of a foreign run',
  }, { actor: 'orchestrator' });
  const unknown = await facadeError(() => fx.application.command('run.message.receipt', { messageId: MSG_ID }, wave, null));
  const foreign = await facadeError(() => fx.application.command('run.message.receipt', { messageId: sent.messageId }, wave, null));
  assert.equal(unknown?.code, 'application_unauthorized');
  assert.equal(foreign?.code, 'application_unauthorized');
  assert.equal(unknown?.message, foreign?.message,
    'unknown messageId ≡ foreign messageId — resolve-then-authorize leaks no existence either direction');
  assert.equal(JSON.stringify(foreign).includes('secret of a foreign run'), false,
    'no receipt field crosses before authorization');
  // The lane's null-for-unknown return is UNREACHABLE through the facade: with a
  // permissive policy the resolve-to-null case is still the constant refusal
  // (a dead-handle worker resolves identically — Decision 4's pinned behavior).
  const fx2 = await facadeFixture(t);
  const permissive = await facadeError(() => fx2.application.command('run.message.receipt', { messageId: MSG_ID }, wave, null));
  assert.equal(permissive?.code, 'application_unauthorized',
    'resolve-to-null ≡ forbidden even under a permissive policy — the facade never returns the lane\'s null');
});

// ===========================================================================
// Section C — the attention inbox (stage: facade projection absent; the BD3-D
// lane is landed). FP-06 scope-first constancy through the facade; FP-07
// candidacy disclosure gating; FP-08 coalescing/terminal-at-mint/cursor chains.
// The lane's own scope authority is the sole seam (Decision 5 — no facade
// _authorize), so coded refusals must arrive BYTE-IDENTICAL to the lane's.
// ===========================================================================

test('FP-06 (stage: facade watch absent): scope-first constancy — unknown ≡ out-of-scope, byte-identical to the lane', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const mallory = principalOf('mallory');
  const handle = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:c1' });
  void handle;
  // A non-authority principal on a run scope: existing and unknown runs refuse
  // IDENTICALLY (the lane authorizes before any existence check — D1 through the facade).
  const existing = await facadeError(() => fx.application.command('run.attention.watch', { runId: 'run:c1' }, mallory, null));
  const unknown = await facadeError(() => fx.application.command('run.attention.watch', { runId: 'run:nonexistent-xyz' }, mallory, null));
  assert.equal(existing?.code, 'attention_scope_forbidden');
  assert.equal(unknown?.code, 'attention_scope_forbidden');
  assert.equal(existing?.message, unknown?.message, 'unknown ≡ out-of-scope — no existence leak through the projection');
  // Byte-identity with the embedded lane: no facade wrapper, no re-coding (Decision 1).
  const lane = await laneError(() => fx.driver.coordinator.attentionFollow({
    scope: { runId: 'run:c1' }, targets: [], afterCursor: 0, timeoutMs: undefined,
  }, { principalId: mallory.principalId, sessionId: mallory.sessionId }));
  assert.equal(existing?.code, lane?.code);
  assert.equal(existing?.message, lane?.message, 'the lane\'s refusal crosses the facade untouched');
  // The orchestrator principal pages: string kinds map to the lane's target-kind
  // filter (shape-only closure — the lane closes no wake-kind vocabulary).
  const page = await fx.application.command('run.attention.watch', { runId: 'run:c1', kind: 'member_terminal' }, wave, null);
  assert.equal(page?.schemaVersion, 1);
  assert.deepEqual(Object.keys(page).sort(), ['afterCursor', 'reasons', 'runId', 'schemaVersion', 'throughCursor'],
    'the page is the lane\'s return plus ONLY the envelope marker (no response-field invention)');
  assert.equal(page?.runId, 'run:c1');
  assert.equal(page?.afterCursor, 0);
  // The cursor discipline: afterCursor echoes the requested offset.
  const paged = await fx.application.command('run.attention.watch', { runId: 'run:c1', cursor: 3 }, wave, null);
  assert.equal(paged?.afterCursor, 3);
});

test('FP-07 (stage: facade watch absent): candidacy_review discloses only to the review authority through the facade', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const mallory = principalOf('mallory');
  await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:c2' });
  // Stage a pending candidacy (the bd3 D2 staging: post + close on a settlement board).
  const posted = fx.coordination.postBoardItem(
    { board: 'wave-settlement:wave:c2', title: 'a finding awaits review', detail: 'd' },
    { actor: 'orchestrator', key: 'ws-c2-post' },
  );
  fx.coordination.closeBoardItem(posted.item.itemId, { actor: 'orchestrator', key: 'ws-c2-close' });
  const queue = fx.coordination.knowledgeCandidateQueue?.({}) ?? { count: 0 };
  assert.ok((queue.count ?? 0) >= 1, 'the candidacy exists (a vacuous D2 greens nothing)');
  // A non-review principal receives NOTHING — the constant scope refusal, identical
  // with or without the candidacy, carrying no candidacy signal.
  const refused = await facadeError(() => fx.application.command('run.attention.watch', {
    runId: 'run:c2', kind: 'candidacy_review',
  }, mallory, null));
  assert.equal(refused?.code, 'attention_scope_forbidden');
  assert.equal(JSON.stringify(refused).includes('candidacy'), false, 'the refusal leaks no candidacy existence');
  // The review authority receives the reason with its count (D2 through the facade).
  const page = await fx.application.command('run.attention.watch', {
    runId: 'run:c2', kind: 'candidacy_review',
  }, wave, null);
  const candidacies = (page?.reasons ?? []).filter((reason) => reason?.kind === 'candidacy_review');
  assert.ok(candidacies.length >= 1, 'the review authority sees the candidacy reason');
  assert.ok((candidacies[0].count ?? 0) >= 1, 'the candidacy carries its live count');
});

test('FP-08 (stage: facade watch absent): storm coalescing, terminal-at-mint, and byte-identical cursor chains through the facade', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const coordinator = fx.driver.coordinator;
  const handleA = await coordinator.spawn('mock', makeBrief(), { runId: 'run:c3' });
  const handleB = await coordinator.spawn('mock', makeBrief(), { runId: 'run:c3' });
  for (const handle of [handleA, handleB]) {
    fx.adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
      payload: { status: 'completed', output: 'done' },
    });
  }
  // The storm mints member_terminal reasons on the run scope (durable predicate).
  const page1 = await until(async () => {
    const page = await fx.application.command('run.attention.watch', { runId: 'run:c3', kind: 'member_terminal' }, wave, null);
    const reasons = (page?.reasons ?? []).filter((reason) => reason?.kind === 'member_terminal');
    const total = reasons.reduce((sum, reason) => sum + (reason.count ?? 1), 0);
    return reasons.length >= 1 && total >= 2 ? page : null;
  }, { label: 'coalesced member_terminal page' });
  const coalesced = page1.reasons.filter((reason) => reason?.kind === 'member_terminal');
  for (const reason of coalesced) {
    assert.ok(Number.isSafeInteger(reason.count), 'every coalesced entry carries an explicit count (the singular v0.9 shape refused)');
    assert.equal(reason.memberState, 'terminal-at-mint',
      'reasons minted after the terminal transition are epoch-marked, never presented as live (D4)');
    if (reason.count > 1) {
      assert.ok(reason.perPhase && typeof reason.perPhase === 'object', 'a storm carries the perPhase distribution');
      assert.ok(Number.isSafeInteger(reason.windowMs), 'a storm carries its coalescing window');
      assert.equal(Object.hasOwn(reason, 'role') && Object.hasOwn(reason, 'phase'), false,
        'no singular {role, phase} identity for a storm (D3)');
    }
  }
  // The cursor chain pages byte-identically: the next page continues exactly at the
  // prior throughCursor and repeats no reason.
  const page2 = await fx.application.command('run.attention.watch', { runId: 'run:c3', cursor: page1.throughCursor }, wave, null);
  assert.equal(page2?.afterCursor, page1.throughCursor, 'the chain echoes the prior throughCursor');
  const seen = new Set(coalesced.map((reason) => reason.seq));
  assert.equal((page2?.reasons ?? []).some((reason) => seen.has(reason.seq)), false,
    'no reason repeats across the cursor chain');
});

// ===========================================================================
// Section D — run.scratchpad.read (stage: facade projection absent; the store
// read lane is landed). FP-09: the #33 accessor with the BD3-A renderer law —
// ≤64-entry pages, UNTRUSTED_SCRATCHPAD framing, ≤4,096-byte leaves, offset
// paging with the fence carried verbatim, the 256 KiB serialized budget with
// digest-citation truncation (red-team blocker #5), and policy-seam constancy.
// ===========================================================================

test('FP-09-read (stage: facade read absent): bounded framed pages with verbatim fences and honest offset paging', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const handle = await spawnMember(fx, { runId: 'run:d1' });
  const task = fx.coordination.task(handle.taskId);
  for (let i = 0; i < 70; i += 1) {
    writeNote(fx, { runId: 'run:d1', taskId: task.id, workerId: handle.id, text: `note ${i}`, key: `ws-d1-note-${i}` });
  }
  const workerScope = `worker:${handle.id}`;
  const eventsBefore = fx.coordination.events().length;
  const page1 = await fx.application.command('run.scratchpad.read', { runId: 'run:d1', scope: workerScope }, wave, null);
  assert.equal(page1?.schemaVersion, 1);
  assert.equal(page1?.runId, 'run:d1');
  assert.equal(page1?.scope, workerScope);
  assert.equal(page1?.entries?.length, 64, 'a page renders at most 64 entries (the renderer\'s non-knowledge bound)');
  for (const entry of page1.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['entryId', 'kind', 'text'], 'each entry renders {entryId, kind, text}');
    assert.match(entry.entryId, /^scratchpad-entry:[a-f0-9]{64}$/u);
    assert.ok(Buffer.byteLength(String(entry.text)) <= 4096, 'every leaf is byte-bounded (≤4,096)');
  }
  assert.ok(typeof page1?.frame === 'string' && page1.frame.includes('UNTRUSTED_SCRATCHPAD'),
    'the page carries the UNTRUSTED_SCRATCHPAD frame marker — worker-authored notes are data, never instruction');
  // The fence and observedSeq ride VERBATIM from the store's live snapshot.
  const snapshot = fx.coordination.scratchpadSnapshot('run:d1', workerScope);
  assert.equal(page1?.scratchpadFence, snapshot.scratchpadFence, 'scratchpadFence is verbatim');
  assert.ok(Number.isSafeInteger(page1?.observedSeq), 'observedSeq rides');
  // Offset paging: nextCursor continues at the first unrendered entry; the remainder
  // chains with no overlap and terminates null.
  assert.equal(page1?.nextCursor, 64);
  assert.equal(page1?.truncated, false, 'offset paging is not budget truncation');
  const page2 = await fx.application.command('run.scratchpad.read', { runId: 'run:d1', scope: workerScope, cursor: page1.nextCursor }, wave, null);
  assert.equal(page2?.entries?.length, 6, 'the remainder pages honestly');
  assert.equal(page2?.nextCursor, null);
  const ids1 = new Set(page1.entries.map((entry) => entry.entryId));
  assert.equal(page2.entries.some((entry) => ids1.has(entry.entryId)), false, 'no entry repeats across pages');
  // The read is NON-EVENTED: no event, no audit class (the ordinary-read posture).
  assert.equal(fx.coordination.events().length, eventsBefore, 'the read appends no event and mints no audit class');
  // The shared scope serves (elevated content lands there — E-section covers elevation).
  const shared = await fx.application.command('run.scratchpad.read', { runId: 'run:d1', scope: 'shared' }, wave, null);
  assert.equal(shared?.schemaVersion, 1);
  assert.ok(Array.isArray(shared?.entries));
});

test('FP-09-budget (stage: facade read absent): the 256 KiB serialized page budget truncates with a digest citation', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const handle = await spawnMember(fx, { runId: 'run:d2' });
  const task = fx.coordination.task(handle.taskId);
  const workerScope = `worker:${handle.id}`;
  // 64 entries whose rendered leaves are ~4 KiB each: 64 × 4,096 = 256 KiB of leaves
  // ALONE — before ids, kinds, fences, and the envelope (red-team blocker #5's math).
  const bigText = 'x'.repeat(6000);
  for (let i = 0; i < 64; i += 1) {
    writeNote(fx, { runId: 'run:d2', taskId: task.id, workerId: handle.id, text: `${i}:${bigText}`, key: `ws-d2-note-${i}` });
  }
  const allIds = fx.coordination.scratchpadSnapshot('run:d2', workerScope).entries.map((entry) => entry.entryId);
  assert.equal(allIds.length, 64, 'the full window is staged');
  const page = await fx.application.command('run.scratchpad.read', { runId: 'run:d2', scope: workerScope }, wave, null);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 256 * 1024,
    'the serialized page never crosses the 256 KiB budget (the mirrored MAX_BOARD_VIEW_BYTES ceiling)');
  assert.equal(page?.truncated, true, 'an over-budget page marks truncation explicitly (the renderer doctrine)');
  assert.ok(page.entries.length >= 1 && page.entries.length < 64,
    'rendering stops BEFORE the budget — never a raw overflow dump');
  assert.match(page?.digest ?? '', /^[a-f0-9]{64}$/u, 'the page carries a digest citation, never raw overflow');
  assert.equal(page?.digest, digest([...allIds].sort()),
    'the citation digests the FULL page id set (canonicalDigest over the sorted ids), so a caller can verify completeness');
  assert.equal(page?.nextCursor, page.entries.length,
    'nextCursor continues at the first unrendered entry — paging continues honestly after truncation');
  const rest = await fx.application.command('run.scratchpad.read', { runId: 'run:d2', scope: workerScope, cursor: page.nextCursor }, wave, null);
  assert.ok(rest.entries.length >= 1, 'the continuation renders the unrendered remainder');
  const rendered = new Set(page.entries.map((entry) => entry.entryId));
  assert.equal(rest.entries.some((entry) => rendered.has(entry.entryId)), false, 'no entry double-renders');
});

test('FP-09-constancy (stage: facade read absent): unknown ≡ foreign at the policy seam; unknown runs serve honest empty pages', async (t) => {
  // A host policy admitting only run:d3: foreign and unknown runs refuse IDENTICALLY.
  const authorize = async (request) => request.runId === 'run:d3';
  const fx = await facadeFixture(t, { authorize });
  const wave = principalOf('wave-owner');
  await spawnMember(fx, { runId: 'run:d3' });
  const served = await fx.application.command('run.scratchpad.read', { runId: 'run:d3', scope: 'shared' }, wave, null);
  assert.equal(served?.schemaVersion, 1, 'the admitted run serves');
  const foreign = await facadeError(() => fx.application.command('run.scratchpad.read', { runId: 'run:d3-foreign', scope: 'shared' }, wave, null));
  const unknown = await facadeError(() => fx.application.command('run.scratchpad.read', { runId: 'run:d3-unknown', scope: 'shared' }, wave, null));
  assert.equal(foreign?.code, 'application_unauthorized');
  assert.equal(unknown?.code, 'application_unauthorized');
  assert.equal(foreign?.message, unknown?.message, 'foreign ≡ unknown at the policy seam — no facade-side existence check');
  // With a permissive policy the store's own law stands: an unknown run returns an
  // EMPTY snapshot — the facade invents no refusal the lane lacks (Decision 1).
  const fx2 = await facadeFixture(t);
  const empty = await fx2.application.command('run.scratchpad.read', { runId: 'run:d3-unknown', scope: 'shared' }, wave, null);
  assert.equal(empty?.schemaVersion, 1);
  assert.deepEqual(empty?.entries, [], 'an unknown run serves the lane\'s honest empty snapshot');
  assert.equal(empty?.nextCursor, null);
});

// ===========================================================================
// Section E — run.scratchpad.elevate (stage: facade projection absent; the
// store lane + coordinator wrapper are landed). FP-10: the steering-registered
// selection ceremony with elevated ≥ 1 (red-team blocker #1), the fence-bound
// retry law (wrapper retry → empty, never idempotent — blocker #2), the
// ordering hazard row, resolve-then-authorize constancy, and the STORE-DIRECT
// postures pinned separately (guard rows — green today by construction).
// ===========================================================================

test('FP-10-happy (stage: facade elevate absent): a steering-registered run settles with elevated ≥ 1, receipt verbatim', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const handle = await spawnMember(fx, { runId: 'run:e1' });
  const task = fx.coordination.task(handle.taskId);
  const first = writeNote(fx, { runId: 'run:e1', taskId: task.id, workerId: handle.id, text: 'finding one', key: 'ws-e1-a' });
  const second = writeNote(fx, { runId: 'run:e1', taskId: task.id, workerId: handle.id, text: 'finding two', key: 'ws-e1-b' });
  completeTask(fx, task.id);
  const receipt = await fx.application.command('run.scratchpad.elevate', {
    runId: 'run:e1', taskId: task.id,
    entryIds: [first.entry.entryId, second.entry.entryId],
  }, wave, null);
  assert.equal(receipt?.schemaVersion, 1);
  assert.equal(receipt?.ok, true);
  assert.equal(receipt?.result, 'settled');
  assert.ok(Array.isArray(receipt?.elevated) && receipt.elevated.length >= 1,
    'the selection is HONORED on a steering-registered run — a silent discard greens nothing (blocker #1)');
  assert.match(receipt?.dispositionDigest ?? '', /^[a-f0-9]{64}$/u);
  assert.ok(Number.isSafeInteger(receipt?.reapEventSeq), 'the reap event is receipted');
  assert.ok(Number.isSafeInteger(receipt?.observedFence) && Number.isSafeInteger(receipt?.scratchpadFence),
    'both fences ride the verbatim store receipt');
  assert.equal(receipt?.scratchpadFence, fx.coordination.scratchpadFence('run:e1', `worker:${handle.id}`),
    'the post-reap fence is the store\'s live fence');
  // The elevated content is now in the run's shared partition.
  const shared = fx.coordination.scratchpadSnapshot('run:e1', 'shared');
  assert.ok(shared.entries.length >= 1, 'elevated entries mint shared-scope rows');
});

test('FP-10-retry (stage: facade elevate absent): not-ready outcome; wrapper retry → empty (never idempotent); post-reap degrade', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  // A non-terminal task: the wrapper's typed OUTCOME, never a throw.
  const liveHandle = await spawnMember(fx, { runId: 'run:e2-live' });
  const liveTask = fx.coordination.task(liveHandle.taskId);
  const notReady = await fx.application.command('run.scratchpad.elevate', {
    runId: 'run:e2-live', taskId: liveTask.id, entryIds: [ENTRY_ID(1)],
  }, wave, null);
  assert.deepEqual(notReady, { schemaVersion: 1, ok: false, result: 'scratchpad_settlement_not_ready' },
    'a non-terminal task is the lane\'s typed outcome, verbatim');
  // The exact-retry law, fence-bound (blocker #2): the first settle reaps and bumps
  // the fence, so the wrapper retry derives a fresh fence → nothing left → empty.
  const handle = await spawnMember(fx, { runId: 'run:e2' });
  const task = fx.coordination.task(handle.taskId);
  const note = writeNote(fx, { runId: 'run:e2', taskId: task.id, workerId: handle.id, text: 'one', key: 'ws-e2-a' });
  completeTask(fx, task.id);
  const args = { runId: 'run:e2', taskId: task.id, entryIds: [note.entry.entryId] };
  const first = await fx.application.command('run.scratchpad.elevate', args, wave, null);
  assert.equal(first?.result, 'settled');
  assert.ok(first.elevated.length >= 1);
  const retry = await fx.application.command('run.scratchpad.elevate', args, wave, null);
  assert.equal(retry?.ok, true);
  assert.equal(retry?.result, 'empty', 'a wrapper-driven exact retry returns the EMPTY successor — NEVER idempotent (the fence moved)');
  assert.notEqual(retry?.result, 'idempotent', 'idempotent is a store-direct posture, unreachable through the wrapper');
  assert.equal(retry?.reapEventSeq, null);
  assert.equal(retry?.dispositionDigest, null);
  assert.deepEqual(retry?.elevated, [], 'the honest never-double-elevate posture: a success receipt with an empty effect');
  // The ordering row: any reap that precedes the elevate degrades it to the same
  // empty receipt (the releaseTerminalTaskResources auto-settle hazard).
  const raced = await spawnMember(fx, { runId: 'run:e2-raced' });
  const racedTask = fx.coordination.task(raced.taskId);
  const racedNote = writeNote(fx, { runId: 'run:e2-raced', taskId: racedTask.id, workerId: raced.id, text: 'raced', key: 'ws-e2-raced-a' });
  completeTask(fx, racedTask.id);
  // The cleanup reap lands FIRST (store-direct, the auto-settle shape: entryIds []).
  fx.coordination.elevateTaskScratchpad({
    runId: 'run:e2-raced', taskId: racedTask.id, workerId: raced.id,
    expectedScratchpadFence: fx.coordination.scratchpadFence('run:e2-raced', `worker:${raced.id}`),
    entryIds: [],
  }, { actor: 'orchestrator', key: `scratchpad.task_settlement:${racedTask.id}` });
  const degraded = await fx.application.command('run.scratchpad.elevate', {
    runId: 'run:e2-raced', taskId: racedTask.id, entryIds: [racedNote.entry.entryId],
  }, wave, null);
  assert.equal(degraded?.result, 'empty', 'an elevate driven AFTER a cleanup reap degrades to empty — the ordering hazard is honest');
  assert.deepEqual(degraded?.elevated, []);
});

test('FP-10-constancy (stage: facade elevate absent): unknown ≡ cross-run ≡ foreign; selection outside the partition is the lane\'s code', async (t) => {
  const REFUSED_RUN = 'run:e3-foreign';
  const authorize = async (request) => !(request.runId === REFUSED_RUN || request.runId === null);
  const fx = await facadeFixture(t, { authorize });
  const wave = principalOf('wave-owner');
  const ownHandle = await spawnMember(fx, { runId: 'run:e3-own' });
  const ownTask = fx.coordination.task(ownHandle.taskId);
  completeTask(fx, ownTask.id);
  const foreignHandle = await spawnMember(fx, { runId: REFUSED_RUN });
  const foreignTask = fx.coordination.task(foreignHandle.taskId);
  completeTask(fx, foreignTask.id);
  const unknown = await facadeError(() => fx.application.command('run.scratchpad.elevate', {
    runId: 'run:e3-own', taskId: 'task-never-created', entryIds: [ENTRY_ID(1)],
  }, wave, null));
  const crossRun = await facadeError(() => fx.application.command('run.scratchpad.elevate', {
    runId: 'run:e3-own', taskId: foreignTask.id, entryIds: [ENTRY_ID(1)],
  }, wave, null));
  const foreign = await facadeError(() => fx.application.command('run.scratchpad.elevate', {
    runId: REFUSED_RUN, taskId: foreignTask.id, entryIds: [ENTRY_ID(1)],
  }, wave, null));
  for (const refusal of [unknown, crossRun, foreign]) {
    assert.equal(refusal?.code, 'application_unauthorized');
    assert.equal(refusal?.message, unknown?.message,
      'unknown ≡ cross-run ≡ foreign — the entry ids a caller names are never existence-oracles');
  }
  // A selection outside the task partition surfaces the LANE's code byte-identically
  // (state-dependent — the facade's shape closure cannot pre-empt it).
  const fx2 = await facadeFixture(t);
  const host = await spawnMember(fx2, { runId: 'run:e3-host' });
  const hostTask = fx2.coordination.task(host.taskId);
  const other = await spawnMember(fx2, { runId: 'run:e3-other' });
  const otherTask = fx2.coordination.task(other.taskId);
  const alien = writeNote(fx2, { runId: 'run:e3-other', taskId: otherTask.id, workerId: other.id, text: 'alien', key: 'ws-e3-alien' });
  completeTask(fx2, hostTask.id);
  completeTask(fx2, otherTask.id);
  const viaFacade = await facadeError(() => fx2.application.command('run.scratchpad.elevate', {
    runId: 'run:e3-host', taskId: hostTask.id, entryIds: [alien.entry.entryId],
  }, wave, null));
  assert.equal(viaFacade?.code, 'scratchpad_settlement_invalid', 'the lane\'s state-dependent refusal propagates with its code untouched');
  const viaLane = await laneError(() => fx2.driver.coordinator.elevateTaskScratchpad(hostTask.id, [alien.entry.entryId]));
  assert.equal(viaFacade?.code, viaLane?.code);
  assert.equal(viaFacade?.message, viaLane?.message, 'byte-identical to the lane — no facade re-coding');
});

test('FP-10-store-direct (GUARD, green today): the idempotent/conflict pair is a store-direct posture the wrapper never reaches', async (t) => {
  // The scratchpad-33-red.test.mjs:600-604 shape, re-pinned HERE so the projected
  // path's empty-retry law (FP-10-retry) has its contrast in the same suite: a
  // caller pinning the SAME fence replays idempotent; a changed selection under
  // the same fence-pinned key conflicts. Neither may surface through the facade.
  const fx = await facadeFixture(t);
  const handle = await spawnMember(fx, { runId: 'run:e4' });
  const task = fx.coordination.task(handle.taskId);
  const first = writeNote(fx, { runId: 'run:e4', taskId: task.id, workerId: handle.id, text: 'a', key: 'ws-e4-a' });
  const second = writeNote(fx, { runId: 'run:e4', taskId: task.id, workerId: handle.id, text: 'b', key: 'ws-e4-b' });
  completeTask(fx, task.id);
  const fence = fx.coordination.scratchpadFence('run:e4', `worker:${handle.id}`);
  const request = {
    runId: 'run:e4', taskId: task.id, workerId: handle.id,
    expectedScratchpadFence: fence, entryIds: [first.entry.entryId],
  };
  const settled = fx.coordination.elevateTaskScratchpad(request, { actor: 'orchestrator', key: 'ws-e4-settle' });
  assert.equal(settled.result, 'settled');
  const replayed = fx.coordination.elevateTaskScratchpad(request, { actor: 'orchestrator', key: 'ws-e4-settle' });
  assert.equal(replayed.result, 'idempotent', 'same-fence replay is idempotent — STORE-DIRECT ONLY');
  assert.equal(replayed.reapEventSeq, settled.reapEventSeq);
  assert.throws(
    () => fx.coordination.elevateTaskScratchpad({ ...request, entryIds: [second.entry.entryId] }, { actor: 'orchestrator', key: 'ws-e4-settle' }),
    (error) => error?.code === 'scratchpad_settlement_conflict',
    'a changed selection under the same fence-pinned key conflicts — STORE-DIRECT ONLY',
  );
});

// ===========================================================================
// Section F — run.board.post / run.board.read (stage: facade projection absent;
// the #78 store lanes and the facade's projectBoardView renderer are landed).
// FP-11: the binding law VERBATIM (foreign-bound ≡ one constant for post and
// read, decided before any item existence; unbound+empty read refuses;
// unbound-with-items serves; adoption on first post; run-closed refusal; the
// idempotent retry with the replay-derived boardRunBinding; the appendGate race
// row). FP-12: the read view is projectBoardView's exact output, non-evented.
// ===========================================================================

// A raw store-direct post (no admission record): stages items on an UNBOUND board.
function postRaw(fx, board, title, key, detail = 'd') {
  return fx.coordination.postBoardItem({ board, title, detail }, { actor: 'orchestrator', key });
}

// A store-direct post WITH an admission record: stages a board→run binding the way
// the S-2 seam records it (replay derives the binding from payload.boardAdmission).
function postBound(fx, board, runId, title, key) {
  return fx.coordination.postBoardItem(
    { board, title, detail: 'd' },
    { actor: 'orchestrator', key },
    null,
    { schemaVersion: 1, runId, requestDigest: digest({ board, title, runId }), adopted: false, leaseId: null },
  );
}

test('FP-11-binding (stage: facade board absent): the binding law verbatim — one constant, decided before existence', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  postBound(fx, 'ws-f1-bound', 'run:f1-owner', 'already bound', 'ws-f1-bound-post');
  // A board bound to a DIFFERENT run: read ≡ post ≡ application_board_scope_forbidden,
  // identical code AND message, even though the board HAS items (the binding check
  // precedes any item existence or write — a foreign board is indistinguishable).
  const readForeign = await facadeError(() => fx.application.command('run.board.read', {
    runId: 'run:f1-other', board: 'ws-f1-bound',
  }, wave, null));
  const postForeign = await facadeError(() => fx.application.command('run.board.post', {
    runId: 'run:f1-other', board: 'ws-f1-bound', title: 'sneak onto a foreign board',
  }, wave, null));
  assert.equal(readForeign?.code, 'application_board_scope_forbidden');
  assert.equal(postForeign?.code, 'application_board_scope_forbidden');
  assert.equal(readForeign?.message, postForeign?.message, 'post and read share the one binding-law constant');
  assert.notEqual(readForeign?.code, 'application_board_not_found', 'binding precedes existence — never a not-found leak');
  // Unbound AND empty: the read is unknown (the BD3-A context_not_found law).
  const empty = await facadeError(() => fx.application.command('run.board.read', {
    runId: 'run:f1-other', board: 'ws-f1-empty',
  }, wave, null));
  assert.equal(empty?.code, 'application_board_not_found');
  // Unbound WITH items: the read SERVES (the unbound-with-items law).
  postRaw(fx, 'ws-f1-unbound', 'an orphan item', 'ws-f1-orphan');
  const served = await fx.application.command('run.board.read', { runId: 'run:f1-other', board: 'ws-f1-unbound' }, wave, null);
  assert.equal(served?.schemaVersion, 1);
  assert.equal(served?.board, 'ws-f1-unbound');
  assert.equal(served?.boardRunId, null, 'the view reports the unbound state honestly');
  assert.ok(served?.view?.items?.length >= 1, 'the unbound board\'s items serve');
});

test('FP-11-adopt (stage: facade board absent): first post adopts/binds by the seam\'s rule; the binding lands durably', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  // Unbound WITH items: the first admitted write ADOPTS the board into the run.
  postRaw(fx, 'ws-f2-adopt', 'pre-existing item', 'ws-f2-pre');
  const adopted = await fx.application.command('run.board.post', {
    runId: 'run:f2', board: 'ws-f2-adopt', title: 'the adopting post',
  }, wave, null);
  assert.equal(adopted?.schemaVersion, 1);
  assert.equal(adopted?.ok, true);
  assert.equal(adopted?.result, 'posted');
  assert.deepEqual(adopted?.boardRunBinding, { runId: 'run:f2', result: 'adopted' },
    'a first post to an unbound board WITH items adopts it into the run');
  assert.match(adopted?.item?.itemId ?? '', /^board-item:[a-f0-9]{64}$/u, 'the hub mints the item id');
  assert.ok(Number.isSafeInteger(adopted?.item?.ordinal));
  // The binding is durable and replay-derived: the admission record rides the event
  // payload (no lease field — the orchestrator posture fabricates none).
  assert.equal(fx.coordination.boardSnapshot('ws-f2-adopt')?.runId, 'run:f2', 'the public projection carries the binding');
  const admissionEvent = fx.coordination.events().find((event) => event.kind === 'board.item_posted'
    && event.payload?.board === 'ws-f2-adopt' && event.payload?.boardAdmission);
  assert.ok(admissionEvent, 'the admission record is durable');
  assert.equal(admissionEvent.payload.boardAdmission.runId, 'run:f2');
  assert.equal(admissionEvent.payload.boardAdmission.adopted, true, 'replay derives adopted from the durable record');
  assert.equal(admissionEvent.payload.boardAdmission.leaseId, null, 'no lease exists in this posture and none is fabricated');
  // Unbound and EMPTY: the first post BINDS (adopting = !binding && items > 0).
  const bound = await fx.application.command('run.board.post', {
    runId: 'run:f2', board: 'ws-f2-bind', title: 'the binding post',
  }, wave, null);
  assert.deepEqual(bound?.boardRunBinding, { runId: 'run:f2', result: 'bound' },
    'a first post to an EMPTY unbound board binds (not adopts) — the seam\'s exact distinction');
  // A board bound to THIS run serves both verbs.
  const again = await fx.application.command('run.board.post', {
    runId: 'run:f2', board: 'ws-f2-bind', title: 'second post on own board',
  }, wave, null);
  assert.equal(again?.result, 'posted');
  assert.deepEqual(again?.boardRunBinding, { runId: 'run:f2', result: 'bound' });
});

test('FP-11-retry (stage: facade board absent): an exact retry replays idempotent with the DERIVED binding; a closed run refuses', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  postRaw(fx, 'ws-f3', 'pre-existing item', 'ws-f3-pre');
  const args = { runId: 'run:f3', board: 'ws-f3', title: 'the idempotent post', detail: 'same bytes', owner: 'orchestrator', evidence: [{ coordinationSeq: 1 }] };
  const first = await fx.application.command('run.board.post', args, wave, null);
  assert.equal(first?.result, 'posted');
  const itemsBefore = fx.coordination.boardSnapshot('ws-f3')?.items?.length ?? 0;
  const retry = await fx.application.command('run.board.post', args, wave, null);
  assert.equal(retry?.ok, true);
  assert.equal(retry?.result, 'idempotent', 'an exact retry replays — never a double post (the server-minted digest key)');
  assert.deepEqual(retry?.boardRunBinding, first?.boardRunBinding,
    'the replay envelope DERIVES boardRunBinding from the prior event\'s payload.boardAdmission — byte-equal to the fresh derivation (Decision 1 envelope completion)');
  assert.equal(fx.coordination.boardSnapshot('ws-f3')?.items?.length, itemsBefore, 'no second item lands');
  // A post to a stopped run refuses application_board_run_closed (the seam's
  // board_run_closed law, derived through the store's public snapshot()).
  postRaw(fx, 'ws-f3-closed', 'pre-existing item', 'ws-f3-closed-pre');
  await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:f3-stopped' });
  stopRun(fx, 'run:f3-stopped');
  const closed = await facadeError(() => fx.application.command('run.board.post', {
    runId: 'run:f3-stopped', board: 'ws-f3-closed', title: 'post onto a stopped run',
  }, wave, null));
  assert.equal(closed?.code, 'application_board_run_closed');
});

test('FP-11-race (stage: facade board absent): the facade passes an appendGate re-validating binding + run-open at append time', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  // Spy on the store seam: the facade must hand postBoardItem an appendGate (the
  // S-2 no-check-then-write-window law — red-team Decision 8 amendment).
  const store = fx.coordination;
  const original = store.postBoardItem.bind(store);
  const captured = [];
  store.postBoardItem = (fields, auth, appendGate, boardAdmission) => {
    captured.push({ fields, appendGate });
    return original(fields, auth, appendGate, boardAdmission);
  };
  let posted;
  try {
    posted = await fx.application.command('run.board.post', {
      runId: 'run:f4', board: 'ws-f4', title: 'the gated post',
    }, wave, null);
  } finally {
    store.postBoardItem = original;
  }
  assert.equal(posted?.result, 'posted', 'the gate passes when binding + run-open hold at append time');
  assert.equal(captured.length, 1, 'the facade drives exactly one store append');
  assert.equal(typeof captured[0]?.appendGate, 'function',
    'the facade passes an appendGate — it does NOT check-then-write against a snapshot');
  // The gate RE-VALIDATES LIVE state at append time (never a cached pre-check
  // boolean): invoked now it passes; after the run stops it must fail — a post
  // that loses the race refuses at the gate and never writes (the S-2 law).
  let livePass;
  try { livePass = captured[0].appendGate(); } catch { livePass = false; }
  assert.notEqual(livePass, false, 'the gate reflects the state that held at append time');
  stopRun(fx, 'run:f4');
  let gateOutcome;
  try { gateOutcome = captured[0].appendGate(); } catch { gateOutcome = false; }
  assert.equal(gateOutcome, false, 'the gate re-reads run-open LIVE — it refuses once the run is closed');
  // And the pre-check half stays honest on every fresh call (no cached liveness):
  // a post after the stop refuses at the seam and never writes.
  const afterStop = await facadeError(() => fx.application.command('run.board.post', {
    runId: 'run:f4', board: 'ws-f4', title: 'post after the run stopped',
  }, wave, null));
  assert.equal(afterStop?.code, 'application_board_run_closed');
  assert.equal(store.boardSnapshot('ws-f4')?.items?.length, 1,
    'the refused post never wrote — the gate/pre-check pair leaves no check-then-write window');
});

test('FP-12 (stage: facade board absent): the read view is projectBoardView\'s exact output, fresh and non-evented', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  postBound(fx, 'ws-f5', 'run:f5', 'first', 'ws-f5-a');
  postRaw(fx, 'ws-f5', 'second', 'ws-f5-b');
  const expected = projectBoardView(fx.coordination.boardSnapshot('ws-f5'), { role: 'orchestrator', workerId: null });
  const eventsBefore = fx.coordination.events().length;
  const read = await fx.application.command('run.board.read', { runId: 'run:f5', board: 'ws-f5' }, wave, null);
  assert.equal(read?.schemaVersion, 1);
  assert.equal(read?.board, 'ws-f5');
  assert.equal(read?.boardRunId, 'run:f5');
  assert.deepEqual(read?.view, expected,
    'the view is projectBoardView(snapshot, {role: orchestrator, workerId: null}) — the exact projection the MCP board read serves');
  assert.equal(fx.coordination.events().length, eventsBefore, 'the read appends no event (NON-EVENTED, no audit class)');
  // The dual-fence cache law (#78 BW-14): a store-direct post invalidates the cached
  // view — the next read serves the fresh item, never a stale frame.
  postRaw(fx, 'ws-f5', 'third — written after the first read', 'ws-f5-c');
  const fresh = await fx.application.command('run.board.read', { runId: 'run:f5', board: 'ws-f5' }, wave, null);
  assert.ok(JSON.stringify(fresh?.view).includes('third — written after the first read'),
    'a claim/report/post invalidates the cached view (the dual-fence law)');
});

// ===========================================================================
// Section G — run.knowledge.seed (stage: facade projection absent; the store
// lane is landed). FP-13: content-addressed identity inside the run's horizon,
// the idempotency law, the Finding-scoped evidence rule mirrored EXACTLY, and
// the TRUE evidence codes (temporal_incoherence / missing_evidence — red-team
// blocker #3) propagated byte-identically.
// ===========================================================================

test('FP-13-happy (stage: facade seed absent): content-addressed seeding inside the run\'s horizon with the idempotency law', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:g1' });
  const seed = await fx.application.command('run.knowledge.seed', {
    runId: 'run:g1', type: 'Finding', grounding: 'observed', body: 'the decomposition spec for the survey wave',
  }, wave, null);
  assert.equal(seed?.schemaVersion, 1);
  assert.equal(seed?.ok, true);
  assert.equal(seed?.result, 'added', 'the fresh-add envelope completion (the lane\'s return has no result field)');
  assert.match(seed?.nodeId ?? '', /^knowledge:Finding:[a-f0-9]{64}$/u, 'the node id is content-addressed, never facade-minted');
  // Horizon-scoped by construction: the node carries runId and lands inside the
  // run's horizon (the kernel-side effect assertion).
  assert.ok(fx.driver.coordinator._runHorizonNodeIds('run:g1').has(seed.nodeId),
    'the seeded node is inside the run\'s horizon — seeding is horizon-scoped, never ambient');
  // An exact retry replays idempotent with the same id (the content-derived server key).
  const retry = await fx.application.command('run.knowledge.seed', {
    runId: 'run:g1', type: 'Finding', grounding: 'observed', body: 'the decomposition spec for the survey wave',
  }, wave, null);
  assert.equal(retry?.result, 'idempotent');
  assert.equal(retry?.nodeId, seed.nodeId, 'same content → same node, honestly');
  // Distinct content seeds a DISTINCT node — never a silent overwrite.
  const distinct = await fx.application.command('run.knowledge.seed', {
    runId: 'run:g1', type: 'Finding', grounding: 'observed', body: 'a different finding entirely',
  }, wave, null);
  assert.equal(distinct?.result, 'added');
  assert.notEqual(distinct?.nodeId, seed.nodeId);
  // The key-derivation row (defense-in-depth): the SAME content in a DIFFERENT run
  // is a distinct node under the content-derived key — duplicate_node /
  // knowledge_node_conflict stay unreachable through ordinary use and MUST stay so.
  await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:g1-b' });
  const otherRun = await fx.application.command('run.knowledge.seed', {
    runId: 'run:g1-b', type: 'Finding', grounding: 'observed', body: 'the decomposition spec for the survey wave',
  }, wave, null);
  assert.equal(otherRun?.result, 'added', 'same content in another run is a distinct seed, not a conflict');
  assert.notEqual(otherRun?.nodeId, seed.nodeId);
});

test('FP-13-codes (stage: facade seed absent): the TRUE evidence codes propagate byte-identically (blocker #3)', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:g2' });
  // A stale/future coordinationSeq → temporal_incoherence (NOT invalid_evidence).
  const staleArgs = {
    runId: 'run:g2', type: 'Finding', grounding: 'verified', body: 'cites a future event', evidence: [{ coordinationSeq: 999999 }],
  };
  const viaFacade = await facadeError(() => fx.application.command('run.knowledge.seed', staleArgs, wave, null));
  assert.equal(viaFacade?.code, 'temporal_incoherence', 'a stale coordinationSeq is the lane\'s TRUE code');
  const laneStale = await laneError(() => fx.coordination.addKnowledgeNode({
    type: 'Finding', grounding: 'verified', body: 'lane twin', runId: 'run:g2', evidence: [{ coordinationSeq: 999999 }],
  }, { actor: 'orchestrator', key: 'ws-g2-lane-stale' }));
  assert.equal(viaFacade?.code, laneStale?.code);
  assert.equal(viaFacade?.message, laneStale?.message, 'byte-identical to the lane');
  // An unknown artifactId → missing_evidence (NOT invalid_evidence).
  const viaFacade2 = await facadeError(() => fx.application.command('run.knowledge.seed', {
    runId: 'run:g2', type: 'Finding', grounding: 'verified', body: 'cites a missing artifact', evidence: [{ artifactId: 'artifact:nope' }],
  }, wave, null));
  assert.equal(viaFacade2?.code, 'missing_evidence', 'an unknown artifactId is the lane\'s TRUE code');
  const laneMissing = await laneError(() => fx.coordination.addKnowledgeNode({
    type: 'Finding', grounding: 'verified', body: 'lane twin', runId: 'run:g2', evidence: [{ artifactId: 'artifact:nope' }],
  }, { actor: 'orchestrator', key: 'ws-g2-lane-missing' }));
  assert.equal(viaFacade2?.message, laneMissing?.message, 'byte-identical to the lane');
  assert.notEqual(viaFacade?.code, 'invalid_evidence');
  assert.notEqual(viaFacade2?.code, 'invalid_evidence',
    'invalid_evidence covers only MALFORMED refs — the facade\'s ref-shape validation pre-empts it (defense-in-depth)');
  // invalid_evidence stays defense-in-depth: the malformed-ref lane code exists but
  // the facade's closed evidence shape refuses those inputs at validation instead.
  const malformed = await facadeError(() => fx.application.command('run.knowledge.seed', {
    runId: 'run:g2', type: 'Finding', grounding: 'verified', body: 'x', evidence: [{ coordinationSeq: 1, artifactId: 'artifact:both' }],
  }, wave, null));
  assert.equal(malformed?.code, 'application_knowledge_seed_invalid',
    'a ref naming BOTH keys is shape-refused at the facade before the lane (exactly-one-key closure)');
});

// ===========================================================================
// Section H — the MCP projections (stage: tools absent — mcpApplicationToolNames()
// is 27 today; the six land 27→33 per the #93 discovery note). FP-14 descriptor
// rows (closed schemas, _meta digest, capability classes, connection-derived
// principal dispatch, no self-naming, no board tools); FP-15 refusal constancy
// to the wire through a descriptor-driven server over a REAL facade; FP-19 the
// settlement plane byte-identical (guard rows, green today by construction).
// ===========================================================================

function mockPrincipal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO], expiresAt: new Date(Date.now() + 60000).toISOString(), revoked: false, ...overrides,
  };
}

function mockAppServer({ principal, command } = {}) {
  const directory = tmpDir('baton-ws-mcp-');
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const commandCalls = [];
  const application = {
    repoId: REPO,
    // The served-card contract (mcp-northbound.mjs:1067): the card advertises every
    // registry-derived ordinary command — the mcp-packaging-red card list verbatim.
    card: () => ({
      schemaVersion: 1, repoId: REPO,
      commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'waves.attach', 'application.shutdown'],
    }),
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal, context) {
      commandCalls.push({ name, args, principal: appPrincipal, context });
      if (command) return command(name, args, appPrincipal, context);
      return { schemaVersion: 1, ok: true };
    },
    async decisionList() { return { decisions: [] }; },
  };
  const server = new McpFleetServer({
    coordinator: {}, coordination, application, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: principal ?? mockPrincipal(),
    repoIds: [REPO], now: () => Date.now(), maxWaitMs: 25000, maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  return { server, application, commandCalls, coordination };
}

// A descriptor-driven server over a REAL facade (the MP18 factory shape, in-process):
// refusal codes flow from the live lanes through stateFailureCode to the wire.
async function realServer(fx, principal) {
  const server = new McpFleetServer({
    coordinator: fx.driver.coordinator,
    coordination: fx.driver.coordination,
    application: fx.application,
    surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal,
    repoIds: [REPO], now: () => Date.now(), maxWaitMs: 25000, maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  return server;
}

const wireRequest = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await wireRequest(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
const wireCall = (server, id, name, args) => wireRequest(server, id, 'tools/call', { name, arguments: args });
const resultText = (response) => response?.result?.content?.[0]?.text ?? '';

const SIX_TOOLS = [
  ['baton_run_message_send', 'run.message.send', { readOnlyHint: false, idempotentHint: false }],
  ['baton_run_message_receipt', 'run.message.receipt', { readOnlyHint: true, idempotentHint: true }],
  ['baton_run_attention_watch', 'run.attention.watch', { readOnlyHint: true, idempotentHint: true }],
  ['baton_run_scratchpad_read', 'run.scratchpad.read', { readOnlyHint: true, idempotentHint: true }],
  ['baton_run_scratchpad_elevate', 'run.scratchpad.elevate', { readOnlyHint: false, idempotentHint: false }],
  ['baton_run_knowledge_seed', 'run.knowledge.seed', { readOnlyHint: false, idempotentHint: true }],
];

test('FP-14-tools (stage: tools absent): the six ordinary tools register with closed schemas, _meta digests, and honest annotations', async () => {
  const names = mcpApplicationToolNames();
  for (const [tool] of SIX_TOOLS) {
    assert.ok(names.includes(tool), `${tool} joins the ordinary application surface (27 → 33)`);
  }
  assert.equal(names.some((name) => /^baton_(run_)?board_/u.test(name)), false,
    'no ordinary MCP board tools — boards stay the combined-surface S-2 family (Decision 10)');
  const { server } = mockAppServer();
  await initialized(server);
  const list = await wireRequest(server, 2, 'tools/list', {});
  const tools = new Map((list.result?.tools ?? []).map((tool) => [tool.name, tool]));
  for (const [tool, , hints] of SIX_TOOLS) {
    const row = tools.get(tool);
    assert.ok(row, `${tool} is advertised in tools/list`);
    assert.equal(row.inputSchema?.additionalProperties, false, `${tool} schema is closed`);
    assert.equal(row._meta?.['baton/registryDigest'], APPLICATION_SEMANTIC_REGISTRY.digest,
      `${tool} carries the registry-digest _meta stamp`);
    assert.equal(row.annotations?.readOnlyHint, hints.readOnlyHint, `${tool} readOnlyHint`);
    assert.equal(row.annotations?.idempotentHint, hints.idempotentHint, `${tool} idempotentHint (send/elevate retry mint new effects honestly)`);
    assert.equal(row.annotations?.destructiveHint, false);
    assert.equal(row.annotations?.openWorldHint, false);
    const properties = Object.keys(row.inputSchema?.properties ?? {});
    for (const banned of ['idempotencyKey', 'sessionAuthority', 'lease', 'principalId', 'sessionId', 'capabilities']) {
      assert.equal(properties.includes(banned), false,
        `${tool} carries no wire ${banned} — authority comes from the connection, replay safety lives server-side`);
    }
  }
});

test('FP-14-dispatch (stage: tools absent): each tool dispatches its facade command with the CONNECTION-derived principal', async () => {
  const { server, commandCalls } = mockAppServer();
  await initialized(server);
  const cases = [
    ['baton_run_message_send', 'run.message.send', { repoId: REPO, runId: 'run:h2', kind: 'inform', body: 'x' }],
    ['baton_run_message_receipt', 'run.message.receipt', { repoId: REPO, messageId: MSG_ID }],
    ['baton_run_attention_watch', 'run.attention.watch', { repoId: REPO, runId: 'run:h2' }],
    ['baton_run_scratchpad_read', 'run.scratchpad.read', { repoId: REPO, runId: 'run:h2', scope: 'shared' }],
    ['baton_run_scratchpad_elevate', 'run.scratchpad.elevate', { repoId: REPO, runId: 'run:h2', taskId: 'task-1', entryIds: [ENTRY_ID(1)] }],
    ['baton_run_knowledge_seed', 'run.knowledge.seed', { repoId: REPO, runId: 'run:h2', type: 'Finding', grounding: 'observed', body: 'x' }],
  ];
  let callId = 2;
  for (const [tool, command, args] of cases) {
    commandCalls.length = 0;
    const response = await wireCall(server, callId, tool, args);
    callId += 1;
    assert.equal(response.result?.isError, false, `${tool} dispatches: ${resultText(response)}`);
    assert.equal(commandCalls.length, 1, `${tool} reaches the facade exactly once`);
    assert.equal(commandCalls[0].name, command, `${tool} → application.command('${command}')`);
    assert.equal(commandCalls[0].principal?.principalId, 'operator-a', 'the principal is CONNECTION-derived');
    assert.equal(commandCalls[0].principal?.sessionId, 'stdio-a');
    assert.equal(Object.hasOwn(commandCalls[0].args ?? {}, 'principalId'), false, 'principal fields never ride tool args');
  }
  // Self-naming is schema-refused: a tool arg carrying principal/session/authority
  // fields fails the closed schema (additionalProperties: false).
  for (const forged of [{ principalId: 'wave-owner' }, { sessionId: 'forged' }, { sessionAuthority: { schemaVersion: 1 } }]) {
    const response = await wireCall(server, callId, 'baton_run_message_send', {
      repoId: REPO, runId: 'run:h2', kind: 'inform', body: 'x', ...forged,
    });
    callId += 1;
    assert.equal(response.result?.isError, true, `self-named ${JSON.stringify(forged)} is refused`);
  }
  // The capability classes are deployment preconditions (Decision 10): the DEFAULT
  // observe-only principal reaches the reads; send/elevate/seed require control.
  const observeOnly = mockAppServer({
    principal: mockPrincipal({ userId: 'descriptor-host', sessionId: 'descriptor-host-session', capabilities: ['observe'] }),
  });
  await initialized(observeOnly.server);
  let readId = 2;
  for (const tool of ['baton_run_message_receipt', 'baton_run_scratchpad_read', 'baton_run_attention_watch']) {
    const args = tool === 'baton_run_message_receipt'
      ? { repoId: REPO, messageId: MSG_ID }
      : { repoId: REPO, runId: 'run:h2', ...(tool === 'baton_run_scratchpad_read' ? { scope: 'shared' } : {}) };
    const response = await wireCall(observeOnly.server, readId, tool, args);
    readId += 1;
    assert.doesNotMatch(resultText(response), /forbidden/u, `${tool} admits the observe class`);
  }
  for (const [tool, args] of [
    ['baton_run_message_send', { repoId: REPO, runId: 'run:h2', kind: 'inform', body: 'x' }],
    ['baton_run_scratchpad_elevate', { repoId: REPO, runId: 'run:h2', taskId: 'task-1', entryIds: [ENTRY_ID(1)] }],
    ['baton_run_knowledge_seed', { repoId: REPO, runId: 'run:h2', type: 'Finding', grounding: 'observed', body: 'x' }],
  ]) {
    const response = await wireCall(observeOnly.server, readId, tool, args);
    readId += 1;
    assert.equal(response.result?.isError, true);
    assert.match(resultText(response), /forbidden/u, `${tool} requires the control capability class`);
  }
});

test('FP-15 (stage: tools + wire mapping absent): every newly projected refusal reaches the wire AS ITSELF', async (t) => {
  const fx = await facadeFixture(t);
  for (const [tool] of SIX_TOOLS) {
    assert.ok(mcpApplicationToolNames().includes(tool), `stage: ${tool} is absent from the ordinary surface`);
  }
  // The knowledge rows drive the rung's headline property at the exact point v2.0
  // staged wrong (blocker #3): the TRUE codes, never command_outcome_unknown.
  const control = await realServer(fx, mockPrincipal({ capabilities: ['control', 'observe'] }));
  await initialized(control);
  const stale = await wireCall(control, 2, 'baton_run_knowledge_seed', {
    repoId: REPO, runId: 'run:h3', type: 'Finding', grounding: 'verified', body: 'x', evidence: [{ coordinationSeq: 999999 }],
  });
  assert.equal(stale.result?.isError, true);
  assert.match(resultText(stale), /temporal_incoherence/u, 'a stale coordinationSeq surfaces AS ITSELF');
  assert.doesNotMatch(resultText(stale), /command_outcome_unknown|invalid_command/u);
  const missing = await wireCall(control, 3, 'baton_run_knowledge_seed', {
    repoId: REPO, runId: 'run:h3', type: 'Finding', grounding: 'verified', body: 'x', evidence: [{ artifactId: 'artifact:nope' }],
  });
  assert.match(resultText(missing), /missing_evidence/u, 'an unknown artifactId surfaces AS ITSELF');
  assert.doesNotMatch(resultText(missing), /command_outcome_unknown|invalid_command/u);
  // The #89 char-vs-byte honesty row: the wire schema's maxLength counts CHARS — a
  // 1,025-char / 3,075-byte body passes the schema and the FACADE's byte cap refuses,
  // naming cap AND actual as an application_ code (never invalid_command).
  const oversize = await wireCall(control, 4, 'baton_run_message_send', {
    repoId: REPO, runId: 'run:h3', kind: 'inform', body: '€'.repeat(1025),
  });
  assert.equal(oversize.result?.isError, true);
  assert.match(resultText(oversize), /application_message_send_invalid/u);
  assert.match(resultText(oversize), /2048/u);
  assert.match(resultText(oversize), /3075/u, 'the refusal names the ACTUAL byte size, not the char length');
  // The scratchpad-settlement family: a non-terminal elevate is the lane's typed
  // OUTCOME on the wire (isError false), never a degraded error code.
  const handle = await spawnMember(fx, { runId: 'run:h3-elev' });
  const notReady = await wireCall(control, 5, 'baton_run_scratchpad_elevate', {
    repoId: REPO, runId: 'run:h3-elev', taskId: handle.taskId, entryIds: [ENTRY_ID(1)],
  });
  assert.equal(notReady.result?.isError, false, `the typed outcome rides the wire: ${resultText(notReady)}`);
  assert.match(resultText(notReady), /scratchpad_settlement_not_ready/u);
  // The attention lane's authority is principal-shaped (Decision 5): the DEFAULT
  // descriptor principal refuses the constant scope code AS ITSELF; a descriptor row
  // naming the orchestrator id pages. Both prove the attention family reaches the wire.
  const stock = await realServer(fx, mockPrincipal({ userId: 'descriptor-host', sessionId: 'descriptor-host-session', capabilities: ['observe'] }));
  await initialized(stock);
  const refused = await wireCall(stock, 2, 'baton_run_attention_watch', { repoId: REPO, runId: 'run:h3' });
  assert.equal(refused.result?.isError, true);
  assert.match(resultText(refused), /attention_scope_forbidden/u, 'the default deployment principal refuses with the lane\'s own code');
  assert.doesNotMatch(resultText(refused), /command_outcome_unknown|invalid_command/u);
  const orchestrator = await realServer(fx, mockPrincipal({ userId: 'wave-owner', sessionId: 'stdio-owner', capabilities: ['observe'] }));
  await initialized(orchestrator);
  const paged = await wireCall(orchestrator, 2, 'baton_run_attention_watch', { repoId: REPO, runId: 'run:h3' });
  assert.equal(paged.result?.isError, false, `the orchestrator-named descriptor row pages: ${resultText(paged)}`);
  assert.ok(Array.isArray(JSON.parse(resultText(paged))?.reasons), 'the page shape rides the wire');
  // The stateFailureCode re-enumeration is COMPLETE (Decision 10's amendment): every
  // newly mapped family is present in the mapping, and scratchpad_cursor_stale stays
  // deliberately unmapped (the CAS is not projected in v1).
  const source = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const mapping = source.slice(source.indexOf('function stateFailureCode'), source.indexOf('function protocolResult'));
  assert.ok(mapping.length > 100, 'the stateFailureCode region was located');
  for (const code of [
    'attention_scope_forbidden', 'attention_scope_invalid', 'attention_target_invalid',
    'scratchpad_settlement_invalid', 'scratchpad_settlement_conflict', 'scratchpad_settlement_not_ready',
    'stale_scratchpad_fence', 'scratchpad_partition_exhausted', 'scratchpad_read_invalid',
    'temporal_incoherence', 'missing_evidence', 'invalid_evidence', 'causal_orphan',
    'missing_endpoint', 'duplicate_node', 'knowledge_node_conflict', 'reserved_knowledge_field',
  ]) {
    assert.ok(mapping.includes(`'${code}'`), `stateFailureCode maps ${code} (never command_outcome_unknown)`);
  }
  assert.equal(mapping.includes("'scratchpad_cursor_stale'"), false,
    'scratchpad_cursor_stale is deliberately NOT mapped — the fence CAS is not projected (Decision 6)');
  // Tool-set placement: the six are ORDINARY_EXPLICIT (typed-failure lane), and none
  // joins STATEFUL/RECONCILABLE (no wire idempotencyKey — Decision 10).
  const explicit = source.match(/const ORDINARY_EXPLICIT_TOOLS = new Set\(\[([\s\S]*?)\]\)/u)?.[1] ?? '';
  const stateful = source.match(/const STATEFUL = new Set\(\[([\s\S]*?)\]\)/u)?.[1] ?? '';
  const reconcilable = source.match(/const RECONCILABLE = new Set\(\[([\s\S]*?)\]\)/u)?.[1] ?? '';
  for (const [tool] of SIX_TOOLS) {
    assert.ok(explicit.includes(`'${tool}'`), `${tool} joins ORDINARY_EXPLICIT_TOOLS`);
    assert.equal(stateful.includes(`'${tool}'`), false, `${tool} stays out of STATEFUL`);
    assert.equal(reconcilable.includes(`'${tool}'`), false, `${tool} stays out of RECONCILABLE`);
  }
});

test('FP-19 (GUARD, green today): the settlement plane is byte-identical — the six new tools need no settlement class', async (t) => {
  const fx = await facadeFixture(t);
  const server = await realServer(fx, mockPrincipal({ capabilities: ['control', 'observe'] }));
  await initialized(server);
  // A principal WITHOUT the settlement capability is served by all six new tools
  // (they are ordinary-plane: no sessionAuthority, no lease, no settlement class).
  let id = 2;
  for (const [tool, , args] of [
    ['baton_run_message_send', , { repoId: REPO, runId: 'run:h4', kind: 'inform', body: 'x' }],
    ['baton_run_message_receipt', , { repoId: REPO, messageId: MSG_ID }],
    ['baton_run_attention_watch', , { repoId: REPO, runId: 'run:h4' }],
    ['baton_run_scratchpad_read', , { repoId: REPO, runId: 'run:h4', scope: 'shared' }],
    ['baton_run_scratchpad_elevate', , { repoId: REPO, runId: 'run:h4', taskId: 'task-1', entryIds: [ENTRY_ID(1)] }],
    ['baton_run_knowledge_seed', , { repoId: REPO, runId: 'run:h4', type: 'Finding', grounding: 'observed', body: 'x' }],
  ]) {
    const response = await wireCall(server, id, tool, args);
    id += 1;
    assert.equal(!(response.result?.isError === true && /forbidden/u.test(resultText(response))), true,
      `${tool} never demands the settlement class (state-level outcomes/refusals are fine)`);
  }
  // The settlement tools' envelope requirements are untouched (byte-identical
  // before and after this rung — the guard).
  const promote = await wireCall(server, id, 'baton_knowledge_promote', {
    repoId: REPO, idempotencyKey: 'ws-h4-promote', runId: 'run:h4', candidateFindingId: 'finding:x:1',
    policy: { repoId: REPO, maxBatchBytes: 1024, maxResultBytes: 1024 },
    lease: { id: 'x', digest: '0'.repeat(64), issuedEvent: 1 },
  });
  id += 1;
  assert.match(resultText(promote), /board_lease_required/u, 'the S-2 envelope requirement is unchanged');
  const lease = await wireCall(server, id, 'baton_knowledge_settlement_lease', {
    repoId: REPO, idempotencyKey: 'ws-h4-lease', waveId: `wave:${'a'.repeat(32)}`,
  });
  assert.match(resultText(lease), /forbidden/u, 'the settlement capability class is never defaulted');
  // The combined-surface board family stays exactly where it lives (Decision 10).
  assert.ok(mcpCombinedToolNames().includes('baton_board_post'), 'the S-2 board family still rides the combined surface');
  assert.ok(mcpCombinedToolNames().includes('baton_board_read'));
  assert.equal(mcpApplicationToolNames().some((name) => name.startsWith('baton_board_')), false,
    'the default surface carries no board family');
});

// ===========================================================================
// Section I — CLI verbs + registry rows + conformance (stage: verbs absent —
// today `baton run message …` falls through to parseStart and is silently parsed
// as a run-start objective). FP-16: the nine spellings parse to command
// dispatches; unknown sub-verbs are parse errors; the registry rows carry the
// pinned shapes; the regeneration mains stay green (guard rows).
// ===========================================================================

test('FP-16-parse (stage: verbs absent): the nine spellings parse to their command dispatches; bad sub-verbs are parse errors', () => {
  const parses = [
    [['run', 'message', 'send', 'run:i1', '--kind', 'inform', '--body', 'hello'], 'run.message.send', { runId: 'run:i1', kind: 'inform', body: 'hello' }],
    [['run', 'message', 'send', '--worker', 'w-1', '--kind', 'query', '--body', 'status?'], 'run.message.send', { workerId: 'w-1', kind: 'query', body: 'status?' }],
    [['run', 'message', 'receipt', MSG_ID], 'run.message.receipt', { messageId: MSG_ID }],
    [['run', 'attention', 'watch', 'run:i1', '--kind', 'member_terminal', '--cursor', '3'], 'run.attention.watch', { runId: 'run:i1', kind: 'member_terminal', cursor: 3 }],
    [['run', 'scratchpad', 'read', 'run:i1', '--scope', 'shared', '--cursor', '2'], 'run.scratchpad.read', { runId: 'run:i1', scope: 'shared', cursor: 2 }],
    [['run', 'scratchpad', 'elevate', 'run:i1', '--task', 'task-1', '--entries', `["${ENTRY_ID(1)}"]`], 'run.scratchpad.elevate', { runId: 'run:i1', taskId: 'task-1', entryIds: [ENTRY_ID(1)] }],
    [['run', 'board', 'post', 'run:i1', '--board', 'ws-i1', '--title', 't', '--detail', 'd', '--owner', 'w-1', '--evidence', '[{"coordinationSeq":1}]'], 'run.board.post', { runId: 'run:i1', board: 'ws-i1', title: 't', detail: 'd', owner: 'w-1', evidence: [{ coordinationSeq: 1 }] }],
    [['run', 'board', 'read', 'run:i1', '--board', 'ws-i1'], 'run.board.read', { runId: 'run:i1', board: 'ws-i1' }],
    [['run', 'knowledge', 'seed', 'run:i1', '--type', 'Finding', '--grounding', 'observed', '--body', 'x', '--evidence', '[]'], 'run.knowledge.seed', { runId: 'run:i1', type: 'Finding', grounding: 'observed', body: 'x', evidence: [] }],
  ];
  for (const [argv, name, expectedArgs] of parses) {
    const parsed = parseBatonCli(argv);
    assert.equal(parsed?.kind, 'command', `${argv.join(' ')} parses to a command dispatch, never a run-start objective`);
    assert.equal(parsed?.name, name);
    for (const [key, value] of Object.entries(expectedArgs)) {
      assert.deepEqual(parsed?.args?.[key], value, `${name} arg ${key}`);
    }
  }
  // Exactly one target form: runId AND --worker together are a parse error.
  assert.throws(
    () => parseBatonCli(['run', 'message', 'send', 'run:i1', '--worker', 'w-1', '--kind', 'inform', '--body', 'x']),
    (error) => error?.code === 'cli_invalid',
    'the send target is XOR at the CLI too',
  );
  // Unknown sub-verbs are PARSE ERRORS, never silently a run-start objective (the
  // load-bearing pin — today they fall through to parseStart).
  for (const argv of [
    ['run', 'message', 'teleport', 'run:i1'],
    ['run', 'attention', 'follow', 'run:i1'], // the renamed verb: 'follow' is never a spelling (Decision 2)
    ['run', 'scratchpad', 'burn', 'run:i1'],
    ['run', 'board', 'burn', 'run:i1'],
    ['run', 'knowledge', 'burn', 'run:i1'],
  ]) {
    assert.throws(() => parseBatonCli(argv), (error) => error?.code === 'cli_invalid',
      `${argv.join(' ')} refuses at the parser`);
  }
});

test('FP-16-registry (stage: rows absent): eight canonical operations with the pinned profiles, surfaces, capabilities, and names', () => {
  const registry = APPLICATION_SEMANTIC_REGISTRY;
  const expectations = [
    ['run.message.send', ['embedded', 'mcp', 'cli'], ['control', 'observe'], false, 'baton run message send', 'baton_run_message_send'],
    ['run.message.receipt', ['embedded', 'mcp', 'cli'], ['observe'], true, 'baton run message receipt', 'baton_run_message_receipt'],
    ['run.attention.watch', ['embedded', 'mcp', 'cli'], ['observe'], true, 'baton run attention watch', 'baton_run_attention_watch'],
    ['run.scratchpad.read', ['embedded', 'mcp', 'cli'], ['observe'], true, 'baton run scratchpad read', 'baton_run_scratchpad_read'],
    ['run.scratchpad.elevate', ['embedded', 'mcp', 'cli'], ['control', 'observe'], true, 'baton run scratchpad elevate', 'baton_run_scratchpad_elevate'],
    ['run.board.post', ['embedded', 'cli'], ['control', 'observe'], true, 'baton run board post', null],
    ['run.board.read', ['embedded', 'cli'], ['observe'], true, 'baton run board read', null],
    ['run.knowledge.seed', ['embedded', 'mcp', 'cli'], ['control', 'observe'], true, 'baton run knowledge seed', 'baton_run_knowledge_seed'],
  ];
  for (const [key, surfaces, capabilities, idempotent, cli, mcp] of expectations) {
    const op = registry.canonicalOperations.find((entry) => entry.key === key);
    assert.ok(op, `registry row ${key} exists`);
    assert.equal(op.profile, 'ordinary', `${key} profile`);
    assert.deepEqual([...op.surfaces].sort(), [...surfaces].sort(), `${key} surfaces (boards are embedded+cli only — Decision 10)`);
    assert.deepEqual([...(op.capabilities ?? [])].sort(), [...capabilities].sort(), `${key} capabilities`);
    assert.equal(op.idempotent ?? true, idempotent, `${key} idempotent (send is NOT — a retry mints a new message honestly)`);
    assert.equal(op.names?.cli, cli, `${key} derived CLI spelling`);
    if (mcp !== null) assert.equal(op.names?.mcp, mcp, `${key} derived MCP spelling`);
  }
  // The dispatch gate and the served inventory pick all eight up.
  for (const [key] of expectations) {
    assert.ok(CLI_WEB_COMMANDS.has(key), `CLI_WEB_COMMANDS gates ${key} in`);
  }
  const served = servedCliOrdinaryKeys();
  for (const [key] of expectations) {
    assert.ok(served.includes(key), `servedCliOrdinaryKeys() renders ${key}`);
  }
  // The follow→watch rename stays LAWFUL: the banned verb is never introduced.
  assert.ok(BANNED_SURFACE_VERBS.includes('follow'), 'follow remains a banned canonical surface verb (ground truth 18)');
  assert.equal(registry.canonicalOperations.some((entry) => entry.key === 'run.attention.follow'), false,
    'no run.attention.follow row — the rename spends no lint exception (the waves.progress carve-out pattern, unspent)');
});

test('FP-16-conformance (GUARD, green today, MUST stay green): the docs/conformance mains enforce the regenerated inventories', () => {
  // After the Decision 11 regeneration these stay green; landing tools WITHOUT
  // regenerating flips them red — that is the regeneration enforcement.
  assert.deepEqual(checkSurfaceDocs(), [], 'CLI.md/MCP.md generated blocks match the served surface');
  const result = execFileSync(process.execPath, [conformanceScript], {
    cwd: repoRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(String(result), /surface-conformance: ok/u, 'the CS-4 artifact and the banned-verb lint hold');
});

// ===========================================================================
// Section J — FP-17: #89 frame-economics honesty. Every projected cap: at-cap
// ADMITTED (validation passes — the refuse-everything policy answers
// application_unauthorized, proving the policy seam was reached), cap+1 refused
// with the pinned application_*_invalid code whose text names BOTH numbers.
// (The leaf ≤4,096 render bound and the 256 KiB page budget are pinned in
// Section D — they are render/page bounds, not refusals.)
// ===========================================================================

test('FP-17 (stage: validators absent): at-cap admitted, cap+1 refused naming cap AND actual', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const wave = principalOf('wave-owner');
  const rows = [
    {
      label: 'message body 2,048 bytes',
      atCap: { runId: 'run:j1', kind: 'inform', body: 'x'.repeat(2048) },
      overCap: { runId: 'run:j1', kind: 'inform', body: 'x'.repeat(2049) },
      command: 'run.message.send', code: 'application_message_send_invalid', cap: /2048/u, actual: /2049/u,
    },
    {
      label: 'scratchpad entryIds ≤128 unique',
      atCap: { runId: 'run:j1', taskId: 'task-1', entryIds: Array.from({ length: 128 }, (_, i) => ENTRY_ID(i + 1)) },
      overCap: { runId: 'run:j1', taskId: 'task-1', entryIds: Array.from({ length: 129 }, (_, i) => ENTRY_ID(i + 1)) },
      command: 'run.scratchpad.elevate', code: 'application_scratchpad_elevate_invalid', cap: /128/u, actual: /129/u,
    },
    {
      label: 'board title ≤160 bytes',
      atCap: { runId: 'run:j1', board: 'ws-j1', title: 't'.repeat(160) },
      overCap: { runId: 'run:j1', board: 'ws-j1', title: 't'.repeat(161) },
      command: 'run.board.post', code: 'application_board_post_invalid', cap: /160/u, actual: /161/u,
    },
    {
      label: 'board detail ≤4,096 bytes',
      atCap: { runId: 'run:j1', board: 'ws-j1', title: 't', detail: 'd'.repeat(4096) },
      overCap: { runId: 'run:j1', board: 'ws-j1', title: 't', detail: 'd'.repeat(4097) },
      command: 'run.board.post', code: 'application_board_post_invalid', cap: /4096/u, actual: /4097/u,
    },
    {
      label: 'board evidence ≤8 refs',
      atCap: { runId: 'run:j1', board: 'ws-j1', title: 't', evidence: Array.from({ length: 8 }, (_, i) => ({ coordinationSeq: i + 1 })) },
      overCap: { runId: 'run:j1', board: 'ws-j1', title: 't', evidence: Array.from({ length: 9 }, (_, i) => ({ coordinationSeq: i + 1 })) },
      command: 'run.board.post', code: 'application_board_post_invalid', cap: /\b8\b/u, actual: /\b9\b/u,
    },
    {
      label: 'knowledge seed body ≤4,096 bytes (the disclosed SURFACE cap, OQ-7)',
      atCap: { runId: 'run:j1', type: 'Finding', grounding: 'observed', body: 'k'.repeat(4096) },
      overCap: { runId: 'run:j1', type: 'Finding', grounding: 'observed', body: 'k'.repeat(4097) },
      command: 'run.knowledge.seed', code: 'application_knowledge_seed_invalid', cap: /4096/u, actual: /4097/u,
    },
  ];
  for (const row of rows) {
    const admitted = await facadeError(() => fx.application.command(row.command, row.atCap, wave, null));
    assert.equal(admitted?.code, 'application_unauthorized',
      `${row.label}: at-cap is ADMITTED through validation (it reaches the policy seam)`);
    const refused = await facadeError(() => fx.application.command(row.command, row.overCap, wave, null));
    assert.equal(refused?.code, row.code, `${row.label}: cap+1 refuses the pinned code BEFORE state`);
    assert.match(refused?.message ?? '', row.cap, `${row.label}: the refusal names the cap`);
    assert.match(refused?.message ?? '', row.actual, `${row.label}: the refusal names the actual size (#89's admitted-refusal law)`);
  }
});

// ===========================================================================
// Section K — the scripted-workflow property (stage: the workflow needs bespoke
// drivers today). WS-01: ONE scripted driver runs the Decision 13 sequence
// end-to-end through the facade ALONE — the static assertion proves zero kernel
// reaches (imports AND .driver/.coordinator/.coordination field-reach, blocker
// #6) and the elevation asserts elevated ≥ 1 (blockers #1/#2). WS-02: the
// step→command map is asserted mechanically against the served inventories.
// ===========================================================================

// The scripted driver — two parts with a harness interlude between (worker wire
// behavior is environmental staging, exactly as bd3 interleaves adapter.emit; every
// ORCHESTRATOR effect rides port.command / port.decisionList, the facade only).
async function scriptPartA(port) {
  // Step 1 — seed board + knowledge inside the orchestrator run's horizon (the
  // board adopts on first post; member briefs will cite both).
  await port.command('run.start', {
    intent: {
      runId: 'run:ws01-orch', objective: 'orchestrate the survey wave', profile: 'default',
      route: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'],
    },
  });
  const seed = await port.command('run.knowledge.seed', {
    runId: 'run:ws01-orch', type: 'Finding', grounding: 'observed',
    body: 'the survey decomposition: four slices, one constraint ledger',
  });
  const posted = await port.command('run.board.post', {
    runId: 'run:ws01-orch', board: 'ws01-tasks', title: 'survey task board', detail: 'the swarm\'s task board',
  });
  // Step 2 — waves.start (4 members); each brief cites the seeded board and node.
  const roles = ['surveyor', 'mapper', 'sampler', 'scribe'];
  const wave = await port.command('waves.start', {
    idempotencyKey: 'ws01-wave',
    members: roles.map((role) => ({
      role,
      objective: `survey slice ${role} — cite board ws01-tasks and node ${seed.nodeId}`,
      exact: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['reports/**'],
    })),
  });
  // Step 3 — message status queries to each member (run-target sends).
  const queries = [];
  for (const member of wave.members) {
    const sent = await port.command('run.message.send', {
      runId: member.runId, kind: 'query', body: `status? (${member.role})`,
    });
    queries.push({ role: member.role, runId: member.runId, messageId: sent.messageId });
  }
  return {
    orchRunId: 'run:ws01-orch', seedNodeId: seed.nodeId, boardItemId: posted.item.itemId,
    waveId: wave.waveId, memberRunIds: wave.members.map((member) => member.runId), queries,
  };
}

async function scriptPartB(port, stateA) {
  // Step 4 — the orchestrator reads each reply through the parent message's receipt.
  const receipts = {};
  for (const query of stateA.queries) {
    const receipt = await port.command('run.message.receipt', { messageId: query.messageId });
    receipts[query.role] = receipt.reply?.body ?? null;
  }
  // Step 5 — decision-gate synthesis: page pending decisions and answer each gate
  // through the EXISTING run.answer (the gate is answered, not awaited).
  const gates = [];
  for (const query of stateA.queries) {
    const pending = await port.decisionList(query.runId);
    const decision = (pending.decisions ?? []).find((row) => row.kind === 'answer_decision');
    if (decision) {
      await port.command('run.answer', { runId: query.runId, requestId: decision.requestId, answer: { optionId: 'opt-a' } });
      gates.push({ role: query.role, requestId: decision.requestId });
    }
  }
  return { receipts, gates };
}

async function scriptPartC(port, stateA) {
  // Step 5 (continued) — attention pages: each member's terminal wake is visible
  // to the orchestrator principal with its coalescing shape.
  const pages = [];
  for (const query of stateA.queries) {
    const page = await port.command('run.attention.watch', { runId: query.runId, kind: 'member_terminal' });
    const count = (page.reasons ?? []).filter((reason) => reason.kind === 'member_terminal')
      .reduce((sum, reason) => sum + (reason.count ?? 1), 0);
    pages.push({ role: query.role, count });
  }
  // Step 6 — elevate findings per terminal member task, BEFORE any settlement/
  // cleanup reap: worker-scope read lists the partition, then elevate honors it.
  const elevations = [];
  for (const query of stateA.queries) {
    const debug = await port.command('run.debug', { runId: query.runId, limit: 1 });
    const workerId = (debug.members ?? [])[0]?.workerId;
    const status = await port.command('run.status', { runId: query.runId });
    const taskIds = new Set();
    const walk = (value) => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (key === 'taskId' && typeof child === 'string') taskIds.add(child);
          else walk(child);
        }
      }
    };
    walk(status);
    const taskId = [...taskIds][0] ?? null;
    const partition = await port.command('run.scratchpad.read', { runId: query.runId, scope: `worker:${workerId}` });
    const entryIds = (partition.entries ?? []).map((entry) => entry.entryId);
    const settled = await port.command('run.scratchpad.elevate', { runId: query.runId, taskId, entryIds });
    elevations.push({
      role: query.role, taskId, entryCount: entryIds.length,
      result: settled.result, elevated: settled.elevated?.length ?? 0,
    });
  }
  // Step 7 — shared reads: the elevated findings and the triaged board, bounded.
  const sharedReads = [];
  for (const query of stateA.queries) {
    const shared = await port.command('run.scratchpad.read', { runId: query.runId, scope: 'shared' });
    sharedReads.push({ role: query.role, entries: shared.entries?.length ?? 0 });
  }
  const board = await port.command('run.board.read', { runId: stateA.orchRunId, board: 'ws01-tasks' });
  // Step 8 — harvest through the existing waves.attach resume path.
  const attached = await port.command('waves.attach', {
    waveId: stateA.waveId,
    members: stateA.queries.map((query) => ({ role: query.role, objective: `survey slice ${query.role}` })),
    timeoutMs: 30000,
  });
  return {
    pages, elevations, sharedReads,
    boardItems: board.view?.items?.length ?? 0,
    attach: {
      outcomes: attached.outcomes?.length ?? 0,
      waveDriverDetached: attached.waveDriverDetached ?? null,
      harvestReplayed: attached.harvestReplayed ?? null,
    },
  };
}

test('WS-01 (stage: the workflow needs kernel reaches today) THE SCRIPTED-WORKFLOW ROW: the eight-step sequence through the facade ALONE', { timeout: 180000 }, async (t) => {
  // THE STATIC ASSERTION (Decision 13): the script contains no createDriver /
  // coordinator.mjs / coordination-store.mjs import — INCLUDING a dynamic import()
  // of those path strings (the grep form is pinned) — AND no .driver/.coordinator/
  // .coordination member access (the public-field reach, blocker #6).
  const scriptSource = `${scriptPartA.toString()}\n${scriptPartB.toString()}\n${scriptPartC.toString()}`;
  for (const banned of [
    /createDriver/u, /coordinator\.mjs/u, /coordination-store\.mjs/u,
    /\bimport\s*\(/u, /\.driver\b/u, /\.coordinator\b/u, /\.coordination\b/u,
  ]) {
    assert.equal(banned.test(scriptSource), false, `the scripted driver carries zero kernel reaches (${banned})`);
  }
  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'reports/slice.md', content: 'slice report' }],
    ask: {
      kind: 'decision', question: 'Which path?',
      options: [{ id: 'opt-a', label: 'A', summary: null }, { id: 'opt-b', label: 'B', summary: null }],
      allowFreeResponse: false, recommended: null, deadlineMs: 120000, afterEditIndex: 0,
    },
  };
  const fx = await facadeFixture(t, { adapter: new WorkflowAdapter(scenario), goalPlan: true });
  const orchestrator = principalOf('wave-owner');
  const port = {
    principal: orchestrator,
    command: (name, args) => fx.application.command(name, args, orchestrator, null),
    decisionList: (runId) => fx.application.decisionList({ runId }, orchestrator),
  };
  const stateA = await scriptPartA(port);
  assert.equal(stateA.queries.length, 4, 'four members queried');
  for (const query of stateA.queries) {
    assert.match(query.messageId, /^message:[a-f0-9]{64}$/u, 'each query is receipted on its durable message id');
  }
  // Harness interlude (worker wire behavior, environmental — bd3's adapter.emit
  // idiom): each member replies to its query (#86 grammar) and notes its findings.
  const handleFor = (runId) => fx.driver.coordinator.list()
    .find((candidate) => fx.driver.coordinator._tasks.get(candidate.taskId)?.runId === runId);
  for (const query of stateA.queries) {
    const handle = await until(async () => handleFor(query.runId) ?? null, { label: `member handle ${query.role}` });
    fx.adapter.emit({ worker: handle.id, kind: 'message.send', payload: { inReplyTo: query.messageId, body: `ack — ${query.role} working` } });
    const task = fx.coordination.task(handle.taskId);
    writeNote(fx, { runId: query.runId, taskId: task.id, workerId: handle.id, text: `finding one from ${query.role}`, key: `ws01-${query.role}-n1` });
    writeNote(fx, { runId: query.runId, taskId: task.id, workerId: handle.id, text: `finding two from ${query.role}`, key: `ws01-${query.role}-n2` });
  }
  await flush();
  const stateB = await scriptPartB(port, stateA);
  assert.deepEqual(stateB.receipts, {
    surveyor: 'ack — surveyor working', mapper: 'ack — mapper working',
    sampler: 'ack — sampler working', scribe: 'ack — scribe working',
  }, 'every reply rides the parent message\'s receipt (C1)');
  assert.equal(stateB.gates.length, 4, 'every member\'s decision gate was answered through run.answer');
  // Members proceed past their gates to terminal completion (durable predicate).
  for (const query of stateA.queries) {
    await until(async () => {
      const debug = await port.command('run.debug', { runId: query.runId, limit: 1 }).catch(() => null);
      return (debug?.members ?? [])[0]?.phase === 'completed' ? true : null;
    }, { label: `member ${query.role} terminal` });
  }
  const stateC = await scriptPartC(port, stateA);
  for (const page of stateC.pages) {
    assert.ok(page.count >= 1, `member_terminal wake visible for ${page.role}`);
  }
  for (const elevation of stateC.elevations) {
    assert.ok(typeof elevation.taskId === 'string' && elevation.taskId.length > 0,
      `the member taskId is discoverable through the facade projections (${elevation.role})`);
    assert.equal(elevation.entryCount, 2, `the worker-scope read listed the partition (${elevation.role})`);
    assert.equal(elevation.result, 'settled', `elevation settles (${elevation.role})`);
    assert.ok(elevation.elevated >= 1,
      `the selection is honored — elevated ≥ 1 on steering-registered wave runs (${elevation.role}; blockers #1/#2)`);
  }
  for (const shared of stateC.sharedReads) {
    assert.ok(shared.entries >= 1, `elevated findings serve on the shared partition (${shared.role})`);
  }
  assert.ok(stateC.boardItems >= 1, 'the seeded board serves through run.board.read');
  assert.equal(stateC.attach.outcomes, 4, 'the harvest receipts all four members');
  assert.equal(stateC.attach.waveDriverDetached, true, 'waves.attach harvests the detached wave');
  // The seeded node is inside the orchestrator run's horizon (durable effect).
  assert.ok(fx.driver.coordinator._runHorizonNodeIds(stateA.orchRunId).has(stateA.seedNodeId));
  // Every effect is receipted on durable events/ids — never sleep durations or turn
  // counts (the campaign control law): the durable trail carries the board item,
  // the node, the four message ids, and the four reap receipts.
  const events = fx.coordination.events();
  assert.ok(events.some((event) => event.payload?.board === 'ws01-tasks' && event.payload?.boardAdmission), 'the board adoption is durable');
  assert.ok(events.filter((event) => event.kind === 'scratchpad.partition_reaped').length >= 4, 'four elevation reaps are durable');
});

test('WS-02 (stage: steps unserved today): the eight sequence steps resolve to served commands — boards facade-explicit', async (t) => {
  const fx = await facadeFixture(t);
  const wave = principalOf('wave-owner');
  const servedCli = servedCliOrdinaryKeys();
  const servedMcp = mcpApplicationToolNames();
  // The mechanical step→command map (Decision 13): every step resolves to a served
  // facade command or MCP tool in the regenerated inventories — never a kernel reach.
  const steps = [
    { step: '1-seed-knowledge', cli: 'run.knowledge.seed', mcp: 'baton_run_knowledge_seed', facade: 'run.knowledge.seed', args: { runId: 'run:w2', type: 'Finding', grounding: 'observed', body: 'x' } },
    { step: '1-seed-board', cli: 'run.board.post', mcp: null, facade: 'run.board.post', args: { runId: 'run:w2', board: 'ws-w2', title: 't' } },
    { step: '2-wave', cli: 'waves.start', mcp: 'baton_waves_start', facade: null, args: null },
    { step: '3-message', cli: 'run.message.send', mcp: 'baton_run_message_send', facade: 'run.message.send', args: { runId: 'run:w2', kind: 'inform', body: 'x' } },
    { step: '4-receipt', cli: 'run.message.receipt', mcp: 'baton_run_message_receipt', facade: 'run.message.receipt', args: { messageId: MSG_ID } },
    { step: '5-watch', cli: 'run.attention.watch', mcp: 'baton_run_attention_watch', facade: 'run.attention.watch', args: { runId: 'run:w2' } },
    { step: '5-answer', cli: 'run.answer', mcp: 'baton_decision_answer', facade: null, args: null },
    { step: '6-elevate', cli: 'run.scratchpad.elevate', mcp: 'baton_run_scratchpad_elevate', facade: 'run.scratchpad.elevate', args: { runId: 'run:w2', taskId: 'task-1', entryIds: [ENTRY_ID(1)] } },
    { step: '7-scratchpad', cli: 'run.scratchpad.read', mcp: 'baton_run_scratchpad_read', facade: 'run.scratchpad.read', args: { runId: 'run:w2', scope: 'shared' } },
    { step: '7-board', cli: 'run.board.read', mcp: null, facade: 'run.board.read', args: { runId: 'run:w2', board: 'ws-w2' } },
    { step: '8-harvest', cli: 'waves.attach', mcp: 'baton_waves_attach', facade: null, args: null },
  ];
  for (const step of steps) {
    assert.ok(servedCli.includes(step.cli), `step ${step.step} resolves to a served CLI verb (${step.cli})`);
    if (step.mcp !== null) assert.ok(servedMcp.includes(step.mcp), `step ${step.step} resolves to a served MCP tool (${step.mcp})`);
  }
  // The board steps are FACADE/CLI-pinned EXPLICITLY (ground truth 11, Decision 10):
  // the facade-or-MCP disjunction cannot green them on an MCP surface that cannot
  // serve boards — no ordinary baton_run_board_* tool exists to green them with.
  assert.equal(servedMcp.some((name) => /^baton_(run_)?board_/u.test(name)), false,
    'no MCP board tool exists to green the board steps — they are facade/CLI only');
  for (const step of steps.filter((entry) => entry.facade !== null)) {
    const refusal = await facadeError(() => fx.application.command(step.facade, step.args, wave, null));
    assert.notEqual(refusal?.code, 'application_command_unavailable',
      `step ${step.step} dispatches on the facade (${step.facade})`);
  }
});

// ===========================================================================
// Section L — FP-18 static pins: the byte-stable command table is untouched, the
// wave driver stays free of the inbox (D5), the ONE permitted kernel addition is
// the read-only authorization accessor, and the eight ports dispatch AHEAD of the
// recursive-session gate (a live run-orchestrator lease holder keeps the
// lane-admitted review authority).
// ===========================================================================

test('FP-18 (mixed: guards + the accessor and pre-gate rows red today): the projection smuggles no semantics', async (t) => {
  // Guards (green today, must stay green): the byte-stable table gains no keys, and
  // the wave driver's stall machinery is NOT consumed by the inbox.
  const EIGHT = ['run.message.send', 'run.message.receipt', 'run.attention.watch',
    'run.scratchpad.read', 'run.scratchpad.elevate', 'run.board.post', 'run.board.read', 'run.knowledge.seed'];
  for (const key of EIGHT) {
    assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, key), false,
      `${key} is a DIRECT PORT — the byte-stable command table is untouched (grammar-m3 stays green)`);
  }
  const driverSource = readFileSync(new URL('../src/wave-driver.mjs', import.meta.url), 'utf8');
  assert.equal(driverSource.includes('attentionFollow'), false, 'the D5 pin: wave-driver.mjs stays free of attentionFollow');
  // The ONE permitted kernel-side addition (Decision 4): a read-only accessor
  // resolving a message's target run for authorization ONLY.
  const fx = await facadeFixture(t);
  assert.equal(typeof fx.driver.coordinator.messageRunId, 'function',
    'stage: accessor absent — the read-only messageRunId accessor is the rung\'s single kernel addition');
  const handle = await fx.driver.coordinator.spawn('mock', makeBrief(), { runId: 'run:l1' });
  const sent = await fx.driver.coordinator.sendMessage({
    kind: 'inform', to: { workerId: handle.id }, body: 'x',
  }, { actor: 'orchestrator' });
  assert.equal(fx.driver.coordinator.messageRunId(sent.messageId), 'run:l1',
    'the accessor resolves the message\'s target run through durable records');
  assert.equal(fx.driver.coordinator.messageRunId(MSG_ID), null,
    'unknown resolves to null — resolve-to-null ≡ forbidden, never a leak (Decision 4)');
  // The eight ports dispatch AHEAD of the recursive-session gate: with a live
  // sessionAuthority context, shape failures are the commands' own codes — never
  // run_orchestrator_command_forbidden (a behind-gate port would refuse first).
  const lease = authorityOn(fx, { runId: 'run:l1', principalId: 'reviewer', sessionId: 'session-reviewer' });
  const recursiveContext = {
    schemaVersion: 1, requestId: 'ws-l1', idempotencyKey: 'ws-l1',
    sessionAuthority: lease.sessionAuthority,
  };
  const reviewer = principalOf('reviewer');
  const expectedCodes = {
    'run.message.send': 'application_message_send_invalid',
    'run.message.receipt': 'application_message_receipt_invalid',
    'run.attention.watch': 'application_attention_watch_invalid',
    'run.scratchpad.read': 'application_scratchpad_read_invalid',
    'run.scratchpad.elevate': 'application_scratchpad_elevate_invalid',
    'run.board.post': 'application_board_post_invalid',
    'run.board.read': 'application_board_read_invalid',
    'run.knowledge.seed': 'application_knowledge_seed_invalid',
  };
  for (const [name, code] of Object.entries(expectedCodes)) {
    const refusal = await facadeError(() => fx.application.command(name, {}, reviewer, recursiveContext));
    assert.equal(refusal?.code, code, `${name} dispatches ahead of the recursive-session gate`);
  }
  // A live run-orchestrator lease holder retains the lane-admitted review authority
  // through the facade (BD3-D's deliberate admission, Decision 2's gate placement).
  const page = await fx.application.command('run.attention.watch', { runId: 'run:l1' }, reviewer, recursiveContext);
  assert.equal(page?.schemaVersion, 1, 'the lease holder pages — the gate never pre-empts the lane\'s own authority');
  assert.ok(Array.isArray(page?.reasons));
});
