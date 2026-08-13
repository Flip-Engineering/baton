// harvest-accessor-red.test.mjs — red-first suite for issue #99's harvest accessor
// (run.resultpin + waves.harvest), drafted against the FOLDED contract
// docs/reference/evidence/harvest-accessor-2026-08-06/harvest-accessor-contract.md
// BEFORE implementation. Every red row fails today at a NAMED stage; every green row
// is a guard that must STAY green.
//
// Row inventory (contract HA-01..HA-14):
//   A  HA-01 dispatch + closed shapes          (stage: ports absent)
//   B  HA-02 stale-base law                    (stage: projection absent)
//   C  HA-03 projection shape + truncation     (stage: projection absent)
//   D  HA-04 readiness trichotomy              (stage: projection absent)
//   E  HA-05 applied-clean receipt             (stage: harvest absent)
//   F  HA-06 three-way survival + conflict     (stage: harvest absent)
//   G  HA-07 already_integrated + empty_delta  (stage: harvest absent)
//   H  HA-08 MCP wire constancy                (stage: tools absent / wire vocabulary absent)
//   I  HA-09 CLI verbs + conformance           (stage: CLI verb absent)
//   J  HA-12 unpinned sha                      (stage: harvest absent)
//   K  HA-11 multi-pin independence            (stage: projection absent)
//   L  HA-13 receipt honesty + divergence      (stage: harvest absent)
//   M  HA-10 static laws                       (guards, green today)
//   N  HA-14 control lane pre-gate             (stage: ports absent)
//
// SUITE LAW: hermetic (tmp repos, mock adapter, in-process servers, no network); every
// red row fails a plausible WRONG implementation; namespace imports only for invented
// surfaces; no clocks/turn-limits as control oracles (the `until` poll is a reaching
// mechanism, never the oracle); `localeCompare` never used; closed-shape literals are
// sorted-key literals in ACTUAL sorted order.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter } from '../src/adapter.mjs';
import {
  APPLICATION_COMMAND_DEFINITIONS,
  BatonApplication,
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

const REPO = 'repo-harvest-accessor';
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const conformanceScript = fileURLToPath(new URL('../scripts/surface-conformance.mjs', import.meta.url));

// The git empty-tree oid (well-known constant) — used for orphan commits.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const dirs = [];
const drivers = [];
function tmpDir(label = 'baton-harvest-') {
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

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function gitRepo(label) {
  const repo = tmpDir(label);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-harvest@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Harvest'], { cwd: repo });
  writeFileSync(join(repo, 'x.md'), 'hello\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: repo });
  return repo;
}

const canonical = (value) => (Array.isArray(value) ? value.map(canonical) : (value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value));
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
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

// The two-edit worker-self-committed capture: each MockAdapter edit is its own git
// commit, so pin^ never equals the recorded base — the tooth that proves the delta
// lane uses the RECORDED base, never rev-parse pin^.
const TWO_EDITS = [
  { path: 'reports/a.md', content: 'alpha\n' },
  { path: 'reports/b.md', content: 'beta\n' },
];

// The host policy seam (workflow-surface-red facadeFixture shape): one real
// createDriver stack so the facade, the kernel lanes, and the durable store share
// state. goalPlan defaults to ON (every red row that reaches a run needs the
// ceremony); the control-lane lease row N2 uses goalPlan: false so the store's
// createTask gate is inert exactly like workflow-surface's authorityOn fixture.
async function facadeFixture(t, { authorize = async () => true, goalPlan = true, adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [] } }) } = {}) {
  const repo = gitRepo('baton-harvest-repo-');
  const logDir = tmpDir('baton-harvest-log-');
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    stopDeadlineMs: 1000,
    watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
    ...(goalPlan ? { goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true } } : {}),
  });
  drivers.push(driver);
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('ha-planner'),
      dispatcher: principalOf('ha-dispatcher'),
      observer: principalOf('ha-observer'),
    },
    authorize,
  });
  t.after(async () => {
    try { await application.shutdown(principalOf('ha-cleanup')); } catch { /* RED failures may interrupt setup */ }
  });
  const coordination = driver.coordination;
  return { repo, logDir, adapter, driver, application, coordination };
}

// A bounded poll on a durable predicate (reaching mechanism, never the oracle): returns
// the first truthy probe or throws with the last observation.
async function until(probe, { tries = 240, delayMs = 25, label = 'predicate' } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => { setTimeout(resolve, delayMs); });
  }
  throw new Error(`until: ${label} never became true (last: ${JSON.stringify(last)?.slice(0, 200)})`);
}

// Capture the lane's own coded refusal (code + message) for byte-identity comparison.
async function facadeError(fn) {
  try { await fn(); return null; } catch (error) { return { code: error?.code ?? null, message: error?.message ?? null }; }
}

const REFUSE_ALL = async () => false;
const policyOn = (known) => async ({ command, runId }) => {
  if (command === 'run.resultpin' || command === 'waves.harvest') return known.has(runId ?? null);
  return true;
};

// The run ceremony: run.start → approve (planDigest from the advertised approve_plan
// action) → until terminal (work_completed | failed). Returns the terminal status view
// plus the coordinator's durable task record and its attribution.
async function ceremonyRun(fx, { runId, owner = principalOf('owner') }) {
  await fx.application.command('run.start', {
    intent: {
      runId, objective: 'produce reports', profile: 'default',
      route: { harness: 'mock', model: 'mock-model', effort: 'low' },
      scope: ['**'],
    },
  }, owner, null);
  const advertised = await until(async () => {
    const status = await fx.application.command('run.status', { runId }, owner, null);
    return (status.nextActions ?? []).find((row) => row?.kind === 'approve_plan') ?? null;
  }, { label: 'approve_plan action' });
  await fx.application.command('run.approve', { runId, planDigest: advertised.planDigest }, owner, null);
  await until(async () => {
    const status = await fx.application.command('run.status', { runId }, owner, null);
    return status?.phase === 'work_completed' || status?.phase === 'failed' ? status.phase : null;
  }, { tries: 1200, label: `terminal phase (${runId})` });
  const view = await fx.application.command('run.status', { runId }, owner, null);
  const taskId = view?.nodes?.[0]?.taskId ?? null;
  const task = (taskId && fx.driver.coordinator._tasks.get(taskId))
    ?? [...fx.driver.coordinator._tasks.values()].find((row) => row?.runId === runId)
    ?? null;
  const assignee = task?.assignee ?? null;
  return {
    owner, view, taskId, task, assignee,
    baseSha: task?.sessionContext?.baseSha ?? null,
    resultSha: task?.capturedSha ?? null,
    ref: task?.retainedResultRef ?? null,
  };
}

// MCP wire idioms (workflow-surface-red shape).
function mockPrincipal(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO], expiresAt: new Date(Date.now() + 60000).toISOString(), revoked: false, ...overrides,
  };
}

function mockAppServer({ principal, command } = {}) {
  const directory = tmpDir('baton-harvest-mcp-');
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const commandCalls = [];
  const application = {
    repoId: REPO,
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

// A descriptor-driven server over a REAL facade (in-process): refusal codes flow from
// the live lanes through stateFailureCode to the wire.
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
const wireErrorCode = (response) => { try { return JSON.parse(resultText(response))?.error?.code ?? null; } catch { return null; } };

// The board-authority-red lease ceremony: an orchestrator task on runId, a claimed
// worker, and an issued run-orchestrator lease (for the control-lane pre-gate rows).
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

// ===========================================================================
// Section A — HA-01: run.resultpin and waves.harvest dispatch as direct ports with
// closed shapes (stage: ports absent — every dispatch throws
// application_command_unavailable today). Closure cases refuse the pinned
// application_*_invalid code BEFORE any state lookup: the refuse-everything policy
// proves authorization is never reached on a shape failure, and no bare TypeError
// ever escapes (every refusal carries a string .code).
// ===========================================================================

test('A1-resultpin-dispatch (stage: ports absent): run.resultpin dispatches ahead of the command table', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const owner = principalOf('owner');
  // Shape-valid dispatch reaches authorization (policy refuses), never
  // application_command_unavailable. A correct implementation passes; today the
  // port does not exist.
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:a1' }, owner, null));
  assert.equal(refusal?.code, 'application_unauthorized',
    'run.resultpin dispatches and reaches the host policy seam (RED: application_command_unavailable today)');
});

test('A2-harvest-dispatch (stage: ports absent): waves.harvest dispatches for both XOR sources', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const owner = principalOf('owner');
  for (const args of [
    { resultSha: 'a'.repeat(40) },
    { runId: 'run:a2' },
  ]) {
    const refusal = await facadeError(() => fx.application.command('waves.harvest', args, owner, null));
    assert.equal(refusal?.code, 'application_unauthorized',
      `waves.harvest ${JSON.stringify(args)} dispatches and reaches the host policy seam (RED today)`);
  }
});

test('A3-resultpin-closure (stage: ports absent): shape failures refuse application_run_resultpin_invalid before authorize', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const owner = principalOf('owner');
  const closed = ['baseSha', 'changedFiles', 'changedPaths', 'ready', 'resultSha'];
  assert.deepEqual(closed, [...closed].sort(), 'the return literal is a sorted-key closed shape (M2)');
  // Missing, malformed, oversize, non-string, and caller-supplied-base cases.
  const cases = [
    [{ }, 'missing runId'],
    [{ runId: 7 }, 'non-string runId'],
    [{ runId: 'bad run id!' }, 'malformed runId'],
    [{ runId: 'a'.repeat(300) }, 'oversize runId'],
    [{ runId: 'run:a3', baseSha: 'b'.repeat(40) }, 'caller-supplied baseSha is refused as an extra field'],
  ];
  for (const [args, label] of cases) {
    const refusal = await facadeError(() => fx.application.command('run.resultpin', args, owner, null));
    assert.equal(refusal?.code, 'application_run_resultpin_invalid', `${label} → ${refusal?.code}`);
    assert.equal(typeof refusal?.code, 'string', 'every refusal carries a string .code — no bare TypeError escapes');
  }
});

test('A4-harvest-closure (stage: ports absent): shape failures refuse application_waves_harvest_invalid before authorize', async (t) => {
  const fx = await facadeFixture(t, { authorize: REFUSE_ALL });
  const owner = principalOf('owner');
  const closed = ['onto', 'resultSha', 'runId'];
  assert.deepEqual(closed, [...closed].sort(), 'the args literal is a sorted-key closed shape (M2)');
  const cases = [
    [{ }, 'absent source'],
    [{ runId: 'run:a4', resultSha: 'a'.repeat(40) }, 'ambiguous source'],
    [{ resultSha: 'short' }, 'malformed resultSha'],
    [{ resultSha: 'a'.repeat(64) }, '64-hex resultSha refuses at the shape gate (sha1-only v1)'],
    [{ resultSha: 'a'.repeat(40), onto: 7 }, 'non-string onto'],
    [{ resultSha: 'a'.repeat(40), onto: '' }, 'empty onto'],
    [{ runId: 7 }, 'non-string runId'],
    [{ resultSha: 'a'.repeat(40), extra: 1 }, 'extra field'],
  ];
  for (const [args, label] of cases) {
    const refusal = await facadeError(() => fx.application.command('waves.harvest', args, owner, null));
    assert.equal(refusal?.code, 'application_waves_harvest_invalid', `${label} → ${refusal?.code}`);
    assert.equal(typeof refusal?.code, 'string', 'every refusal carries a string .code — no bare TypeError escapes');
  }
});

// ===========================================================================
// Section B — HA-02: the stale-base law. baseSha is the RECORDED capture base
// (task.sessionContext.baseSha), NEVER HEAD, NEVER pin^. changedPaths is the
// recorded-base delta even after main advances. The ancestry cross-check is the
// pin_base_mismatch gate. (stage: projection absent)
// ===========================================================================

test('B1-stale-base (stage: projection absent): the projection owns the RECORDED-base diff after main advances', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:b1' });
  assert.equal(rec.view?.phase, 'work_completed', 'fixture reaches work_completed');
  const owner = rec.owner;
  const changedPaths = fx.driver.coordinator._worktrees.changedPathsAtCommit(rec.baseSha, rec.resultSha);
  assert.deepEqual(changedPaths, ['reports/a.md', 'reports/b.md'], 'the recorded delta is the two edits');
  // The self-committed-capture tooth: pin^ ≠ recorded base — the projection must use
  // the recorded base, never rev-parse pin^.
  const pinParent = git(['rev-parse', `${rec.resultSha}^`], fx.repo);
  assert.notEqual(pinParent, rec.baseSha,
    'pin^ ≠ recorded base (worker-self-committed capture) — the projection MUST use the recorded base, never pin^');
  // Advance main with an unrelated commit.
  writeFileSync(join(fx.repo, 'main-advance.md'), 'adv\n');
  git(['add', '-A'], fx.repo);
  git(['commit', '-q', '-m', 'advance main'], fx.repo);
  const headAfter = git(['rev-parse', 'HEAD'], fx.repo);
  assert.notEqual(headAfter, rec.baseSha, 'fixture: main has advanced past the recorded base');

  const projected = await fx.application.command('run.resultpin', { runId: 'run:b1' }, owner, null);
  assert.equal(projected?.ready, true, 'a preserved, resolvable result exists');
  assert.equal(projected?.resultSha, rec.resultSha, 'resultSha is the accepted pin');
  assert.equal(projected?.baseSha, rec.baseSha, 'baseSha is the RECORDED base — never HEAD');
  assert.notEqual(projected?.baseSha, headAfter, 'baseSha is not HEAD');
  assert.deepEqual(projected?.changedPaths, changedPaths,
    'changedPaths is the recorded-base delta — the advanced main commit is NOT in the diff');

  // The ancestry gate: a corrupted base attribution refuses pin_base_mismatch.
  const orphan = git(['commit-tree', EMPTY_TREE, '-m', 'orphan'], fx.repo);
  const task = fx.driver.coordinator._tasks.get(rec.taskId);
  const handle = fx.driver.coordinator._workers.get(rec.assignee);
  const corrupted = Object.freeze({ ...task.sessionContext, baseSha: orphan });
  task.sessionContext = corrupted;
  if (handle) handle.sessionContext = corrupted;
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:b1' }, owner, null));
  assert.equal(refusal?.code, 'pin_base_mismatch',
    'a base not ancestral to the pin refuses pin_base_mismatch (RED: projection absent)');
  assert.equal(typeof refusal?.message, 'string', 'the refusal carries a message');
});

// ===========================================================================
// Section C — HA-03: the projection shape. changedFiles rows {blob, digest, mode,
// path, size} EXACTLY covering changedPaths with byte-wise path sort; at-cap page
// admitted, cap+1 truncated with truncated/changedFilesDigest/cursor.
// (stage: projection absent)
// ===========================================================================

test('C1-projection (stage: projection absent): ready/resultSha/baseSha/changedPaths/changedFiles oracles', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:c1' });
  assert.equal(rec.view?.phase, 'work_completed');
  assert.equal(rec.view?.result?.preservation?.state, 'pinned', 'the run preserved its result');
  const owner = rec.owner;
  const oracle = fx.driver.coordinator._worktrees.changedPathsAtCommit(rec.baseSha, rec.resultSha);

  const projected = await fx.application.command('run.resultpin', { runId: 'run:c1' }, owner, null);
  assert.equal(projected?.ready, true);
  assert.equal(projected?.resultSha, rec.resultSha);
  assert.match(projected?.baseSha, /^[a-f0-9]{40}$/u, 'baseSha is 40-hex');
  assert.notEqual(projected?.baseSha, projected?.resultSha, 'baseSha ≠ resultSha');
  assert.deepEqual(projected?.changedPaths, oracle, 'changedPaths is the changedPathsAtCommit output');

  // changedFiles EXACTLY covers changedPaths, byte-wise sorted, closed row shape.
  assert.ok(Array.isArray(projected?.changedFiles), 'changedFiles is an array');
  const rowKeys = ['blob', 'digest', 'mode', 'path', 'size'];
  assert.deepEqual(rowKeys, [...rowKeys].sort(), 'the changedFiles row literal is sorted-key (M2)');
  const filePaths = projected.changedFiles.map((row) => row.path);
  assert.deepEqual(filePaths, [...filePaths].sort(), 'changedFiles are byte-wise sorted by path');
  assert.deepEqual(filePaths, oracle, 'changedFiles paths EXACTLY cover changedPaths');
  for (const row of projected.changedFiles) {
    assert.deepEqual(Object.keys(row), rowKeys, 'each row is the closed {blob, digest, mode, path, size} shape');
    assert.match(row.blob, /^[a-f0-9]{40}$/u, 'blob is the 40-hex git blob oid');
    assert.match(row.digest, /^[a-f0-9]{64}$/u, 'digest is the 64-hex sha256');
    assert.match(row.mode, /^(100644|100755)$/u, 'mode is a regular-file mode');
    assert.equal(typeof row.size, 'number', 'size is a number');
  }
  // The exact row oracle: for the two known edits, the blob oid comes from the pin
  // tree and the digest is sha256 of the file content.
  const expectedFor = (path, content) => ({
    blob: git(['rev-parse', `${rec.resultSha}:${path}`], fx.repo),
    digest: createHash('sha256').update(content).digest('hex'),
    mode: '100644',
    path,
    size: Buffer.byteLength(content),
  });
  assert.deepEqual(projected.changedFiles[0], expectedFor('reports/a.md', 'alpha\n'),
    'the a.md row is byte-exact (blob/digest/mode/path/size)');
  assert.deepEqual(projected.changedFiles[1], expectedFor('reports/b.md', 'beta\n'),
    'the b.md row is byte-exact');
});

// A ~800-byte deep path fixture: per-segment names stay under git's 255-byte NAME_MAX
// and the full path stays inside the platform PATH_MAX budget (macOS 1024) given the
// ~160-char worktree prefix — while the serialized changedFiles rows clear 256 KiB.
const DEEP_PAD = 190;
const deepPath = (n) => {
  const seg = (i) => 'd' + 'y'.repeat(DEEP_PAD) + i;
  return Array.from({ length: 4 }, (_, i) => seg(i)).join('/') + `/f${n}.md`;
};

test('C2-truncation (stage: projection absent): an oversize changedFiles page truncates with digest + cursor', async (t) => {
  const N = 320;
  const edits = Array.from({ length: N }, (_, n) => ({ path: deepPath(n), content: `c${n}\n` }));
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:c2' });
  assert.equal(rec.view?.phase, 'work_completed', 'the 320-file ceremony completes');
  const owner = rec.owner;
  const oracle = fx.driver.coordinator._worktrees.changedPathsAtCommit(rec.baseSha, rec.resultSha);
  assert.equal(oracle.length, N, 'fixture: exactly N changed paths');
  const approxRow = Buffer.byteLength(JSON.stringify({ blob: 'a'.repeat(40), digest: 'b'.repeat(64), mode: '100644', path: oracle[0], size: 1 }));
  assert.ok(approxRow * N > 262144, `fixture: serialized rows (~${approxRow} B × ${N}) clear the 256 KiB page cap`);

  const projected = await fx.application.command('run.resultpin', { runId: 'run:c2' }, owner, null);
  assert.equal(projected?.ready, true);
  assert.equal(projected?.changedPaths?.length, N, 'changedPaths carries the full set (below the 1_024 maxPaths)');
  assert.equal(projected?.truncated, true, 'the serialized page exceeded 256 KiB and truncated');
  assert.match(projected?.changedFilesDigest, /^[a-f0-9]{64}$/u, 'changedFilesDigest is over the FULL entry set');
  assert.ok(projected?.cursor !== undefined && projected?.cursor !== null, 'a continuing cursor is present');
  assert.ok(Array.isArray(projected?.changedFiles), 'changedFiles is an array');
  assert.ok(projected.changedFiles.length < N, 'the admitted page holds fewer than the full set');
  assert.ok(projected.changedFiles.length > 0, 'the admitted page is non-empty');
  for (const row of projected.changedFiles) {
    assert.ok(oracle.includes(row.path), 'every admitted row is a changed path');
  }
});

// ===========================================================================
// Section D — HA-04: the readiness trichotomy. result_not_ready covers mid-flight
// AND terminal-failed; a released/retargeted/unverifiable pin names its exact state;
// the host policy gate owns authorization. (stage: projection absent)
// ===========================================================================

test('D1-midflight (stage: projection absent): a pre-approval run reads result_not_ready', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const owner = principalOf('owner');
  await fx.application.command('run.start', {
    intent: { runId: 'run:d1', objective: 'produce reports', profile: 'default', route: { harness: 'mock', model: 'mock-model', effort: 'low' }, scope: ['**'] },
  }, owner, null);
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:d1' }, owner, null));
  assert.equal(refusal?.code, 'result_not_ready', 'mid-flight (awaiting plan approval) is not-ready (RED: projection absent)');
});

test('D2-failed (stage: projection absent): a terminal-failed run reads result_not_ready; the checkpoint is pinned', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'failed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:d2' });
  assert.equal(rec.view?.phase, 'failed', 'the failed scenario lands on phase failed');
  assert.equal(rec.view?.result, null, 'failed runs carry no result section');
  const owner = rec.owner;
  // The failed run leaves a pinned CHECKPOINT (OQ4: checkpoints are not results).
  // Verified BEFORE the red projection row so the fixture self-checks every run.
  assert.equal(rec.task?.checkpoint?.state, 'pinned', 'the failed run pinned its checkpoint');
  assert.match(rec.task?.checkpoint?.sha ?? '', /^[a-f0-9]{40}$/u, 'the checkpoint sha is 40-hex');
  assert.equal(rec.task?.retainedResultRef, null, 'no retained result ref exists for a failed run');
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:d2' }, owner, null));
  assert.equal(refusal?.code, 'result_not_ready', 'terminal-failed is never (RED: projection absent)');
});

test('D3-released-pin (stage: projection absent): a released result ref reads pin_not_found', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:d3' });
  const owner = rec.owner;
  assert.equal(rec.view?.result?.preservation?.state, 'pinned', 'fixture: pin preserved');
  fx.driver.coordinator._worktrees.releaseResult(rec.ref);
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:d3' }, owner, null));
  assert.equal(refusal?.code, 'pin_not_found', 'a released ref is missing → pin_not_found (RED: projection absent)');
});

test('D4-retargeted-pin (stage: projection absent): a re-pointed result ref reads pin_mismatch', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:d4' });
  const owner = rec.owner;
  const foreign = git(['commit-tree', EMPTY_TREE, '-m', 'foreign'], fx.repo);
  git(['update-ref', rec.ref, foreign], fx.repo);
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:d4' }, owner, null));
  assert.equal(refusal?.code, 'pin_mismatch', 'a re-pointed ref → pin_mismatch (RED: projection absent)');
});

test('D5-unverifiable (stage: projection absent): an unresolvable pin reads pin_unverifiable', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:d5' });
  const owner = rec.owner;
  fx.driver.coordinator._worktrees.resolveResult = null;
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:d5' }, owner, null));
  assert.equal(refusal?.code, 'pin_unverifiable', 'an unresolvable pin → pin_unverifiable (RED: projection absent)');
});

test('D6-foreign-run (stage: ports absent): the host policy refuses an unauthorized run', async (t) => {
  const fx = await facadeFixture(t, { authorize: policyOn(new Set(['run:real'])), adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const owner = principalOf('owner');
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:foreign' }, owner, null));
  assert.equal(refusal?.code, 'application_unauthorized', 'an unknown run is refused by the host policy seam (RED: ports absent)');
});

// ===========================================================================
// Section E — HA-05: the applied-clean harvest receipt. One fixture drives three
// ordered rows: onto-invalid refuses; onto-equals-main applies clean; the retry of
// the SAME pin is already_integrated (Section G's row lives here — same fixture).
// (stage: harvest absent)
// ===========================================================================

test('E1-harvest-receipt (stage: harvest absent): onto rules, applied-clean, then already_integrated', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:e1' });
  assert.equal(rec.view?.phase, 'work_completed');
  assert.equal(rec.view?.result?.preservation?.state, 'pinned');
  const owner = rec.owner;
  const oracle = fx.driver.coordinator._worktrees.changedPathsAtCommit(rec.baseSha, rec.resultSha);

  // onto-invalid: a string onto that does not realpath-equal the main checkout.
  const ontoInvalid = await facadeError(() => fx.application.command('waves.harvest', { resultSha: rec.resultSha, onto: '/some/other/checkout' }, owner, null));
  assert.equal(ontoInvalid?.code, 'harvest_onto_invalid',
    'an onto that is not the main checkout refuses harvest_onto_invalid (RED: harvest absent)');

  // onto-equals-main: the realpath-equality variant applies clean.
  const receipt = await fx.application.command('waves.harvest', { resultSha: rec.resultSha, onto: fx.repo }, owner, null);
  assert.equal(receipt?.ok, true, 'the receipt succeeds');
  assert.equal(receipt?.result, 'applied-clean', 'the merge applied cleanly');
  assert.equal(receipt?.reason, null, 'reason is null on applied-clean');
  assert.match(receipt?.afterSha, /^[a-f0-9]{40}$/u, 'afterSha is 40-hex');
  assert.deepEqual(receipt?.classes, ['clean_textual'], 'the class-name projection is clean_textual');
  assert.equal(receipt?.baseSha, rec.baseSha, 'the receipt certifies the RECORDED-base delta');
  assert.deepEqual(receipt?.changedPaths, oracle, 'changedPaths is the recorded diff');
  assert.equal(receipt?.resultSha, rec.resultSha, 'resultSha matches the pin');
  assert.equal(git(['rev-parse', 'HEAD'], fx.repo), receipt.afterSha, 'onto HEAD lands at afterSha');
  assert.equal(git(['status', '--porcelain'], fx.repo), '', 'the main checkout is clean after the apply');
  // The applied delta is byte-visible on main.
  assert.equal(readFileSync(join(fx.repo, 'reports/a.md'), 'utf8'), 'alpha\n', 'the pin content is on main');
  assert.equal(readFileSync(join(fx.repo, 'reports/b.md'), 'utf8'), 'beta\n', 'the pin content is on main');

  // Retry of the same pin: contained → already_integrated (no new merge commit).
  const headAfterApply = git(['rev-parse', 'HEAD'], fx.repo);
  const retry = await fx.application.command('waves.harvest', { resultSha: rec.resultSha }, owner, null);
  assert.equal(retry?.ok, true, 'the retry succeeds');
  assert.equal(retry?.result, 'skipped', 'the retry is skipped');
  assert.equal(retry?.reason, 'already_integrated', 'the pin is already contained');
  assert.equal(git(['rev-parse', 'HEAD'], fx.repo), headAfterApply, 'the skip creates no merge commit');
});

test('E2-harvest-runid (stage: harvest absent): the runId source resolves the same receipt', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:e2' });
  assert.equal(rec.view?.phase, 'work_completed');
  const owner = rec.owner;
  const oracle = fx.driver.coordinator._worktrees.changedPathsAtCommit(rec.baseSha, rec.resultSha);
  const receipt = await fx.application.command('waves.harvest', { runId: 'run:e2' }, owner, null);
  assert.equal(receipt?.ok, true);
  assert.equal(receipt?.result, 'applied-clean');
  assert.equal(receipt?.baseSha, rec.baseSha, 'the runId source attributes the recorded base');
  assert.deepEqual(receipt?.changedPaths, oracle, 'the runId source reports the same delta');
  assert.equal(receipt?.resultSha, rec.resultSha, 'the runId source resolves the same pin');
  assert.equal(git(['rev-parse', 'HEAD'], fx.repo), receipt?.afterSha, 'main lands at afterSha');
  assert.equal(git(['status', '--porcelain'], fx.repo), '', 'main is clean');
});

// ===========================================================================
// Section F — HA-06: the three-way probe. An untouched-file divergent edit survives
// the clean apply; a touched-file divergent edit REFUSES harvest_conflict naming the
// exact conflicted paths, leaving onto untouched and clean.
// (stage: harvest absent)
// ===========================================================================

test('F1-three-way-survival (stage: harvest absent): a divergent untouched file survives the clean apply', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:f1' });
  assert.equal(rec.view?.phase, 'work_completed');
  const owner = rec.owner;
  // Advance main with a divergent edit to a file the pin did NOT touch.
  writeFileSync(join(fx.repo, 'notes.md'), 'main divergent\n');
  git(['add', '-A'], fx.repo);
  git(['commit', '-q', '-m', 'main divergent notes'], fx.repo);
  const mainDivergent = git(['rev-parse', 'HEAD'], fx.repo);
  assert.notEqual(mainDivergent, rec.baseSha, 'fixture: main diverged past the recorded base');
  assert.notEqual(git(['merge-base', mainDivergent, rec.resultSha], fx.repo), null,
    'fixture: a three-way merge base exists (divergence is not a rewrite)');

  const receipt = await fx.application.command('waves.harvest', { resultSha: rec.resultSha }, owner, null);
  assert.equal(receipt?.ok, true);
  assert.equal(receipt?.result, 'applied-clean', 'the three-way merge applied cleanly');
  assert.equal(receipt?.baseSha, rec.baseSha, 'the recorded base anchored the merge');
  assert.deepEqual(receipt?.changedPaths, fx.driver.coordinator._worktrees.changedPathsAtCommit(rec.baseSha, rec.resultSha), 'the recorded diff was applied');
  assert.equal(git(['rev-parse', 'HEAD'], fx.repo), receipt?.afterSha, 'main landed at afterSha');
  // The untouched file's divergent content survived.
  assert.equal(readFileSync(join(fx.repo, 'notes.md'), 'utf8'), 'main divergent\n', 'the untouched divergent edit survives');
  assert.equal(readFileSync(join(fx.repo, 'reports/a.md'), 'utf8'), 'alpha\n', 'the pin content landed');
  assert.equal(git(['status', '--porcelain'], fx.repo), '', 'main is clean');
});

test('F2-three-way-conflict (stage: harvest absent): a touched-file divergent edit refuses harvest_conflict naming the paths', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:f2' });
  assert.equal(rec.view?.phase, 'work_completed');
  const owner = rec.owner;
  // Advance main with a divergent edit to a file the pin DID touch. The pin created
  // reports/ in the worker worktree — main must be given the same path so the add/add
  // divergent file is a genuine three-way conflict (ENOENT would be a fixture bug).
  mkdirSync(join(fx.repo, 'reports'), { recursive: true });
  writeFileSync(join(fx.repo, 'reports/a.md'), 'main conflicting alpha\n');
  git(['add', '-A'], fx.repo);
  git(['commit', '-q', '-m', 'main conflicting a'], fx.repo);
  const ontoHead = git(['rev-parse', 'HEAD'], fx.repo);

  const refusal = await facadeError(() => fx.application.command('waves.harvest', { resultSha: rec.resultSha }, owner, null));
  assert.equal(refusal?.code, 'harvest_conflict', 'a conflicting harvest refuses harvest_conflict (RED: harvest absent)');
  assert.ok(Array.isArray(refusal?.conflicts), 'the refusal carries a conflict list');
  assert.equal(refusal.conflicts.length, 1, 'exactly the touched file conflicts');
  assert.equal(refusal.conflicts[0]?.path, 'reports/a.md', 'the conflicted path is named');
  assert.equal(typeof refusal.conflicts[0]?.class, 'string', 'each conflict carries a class');
  assert.equal(refusal?.ontoHeadSha, ontoHead, 'ontoHeadSha is the untouched main HEAD');
  assert.equal(refusal?.resultSha, rec.resultSha, 'resultSha names the pin');
  assert.equal(git(['rev-parse', 'HEAD'], fx.repo), ontoHead, 'onto is UNTOUCHED by the refused harvest');
  assert.equal(git(['status', '--porcelain'], fx.repo), '', 'onto is clean after the probe (no stage, no merge)');
  assert.equal(readFileSync(join(fx.repo, 'reports/a.md'), 'utf8'), 'main conflicting alpha\n', 'the divergent main content is untouched');
});

// ===========================================================================
// Section G — HA-07: the skipped receipts. already_integrated is covered by E1's
// retry row; empty_delta needs a net-zero self-committed pin (edits cancel out).
// (stage: harvest absent)
// ===========================================================================

test('G2-empty-delta (stage: harvest absent): a net-zero self-committed pin is skipped/empty_delta', async (t) => {
  const netZero = [
    { path: 'x.md', content: 'world\n' },
    { path: 'x.md', content: 'hello\n' },
  ];
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: netZero } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:g2' });
  assert.equal(rec.view?.phase, 'work_completed');
  assert.equal(rec.view?.result?.preservation?.state, 'pinned', 'the net-zero run still preserves a pin');
  const owner = rec.owner;
  assert.deepEqual(fx.driver.coordinator._worktrees.changedPathsAtCommit(rec.baseSha, rec.resultSha), [],
    'fixture: the recorded delta is empty');
  const headBefore = git(['rev-parse', 'HEAD'], fx.repo);

  const receipt = await fx.application.command('waves.harvest', { resultSha: rec.resultSha }, owner, null);
  assert.equal(receipt?.ok, true);
  assert.equal(receipt?.result, 'skipped', 'an empty delta is skipped');
  assert.equal(receipt?.reason, 'empty_delta', 'the skip reason is empty_delta');
  assert.deepEqual(receipt?.changedPaths, [], 'the receipt reports the empty delta');
  assert.equal(git(['rev-parse', 'HEAD'], fx.repo), headBefore, 'no merge commit is created');
  assert.equal(git(['status', '--porcelain'], fx.repo), '', 'main is clean');
});

// ===========================================================================
// Section H — HA-08: MCP projections. New tools register (33→35 / 84→86), dispatch
// with the connection-derived principal, and the COMPLETE refusal vocabulary reaches
// the wire as itself (never command_outcome_unknown). Kernel→harvest translations
// are pinned row-by-row. (stage: tools absent / wire vocabulary absent)
// ===========================================================================

const NEW_TOOLS = [
  ['baton_run_resultpin', 'run.resultpin', { readOnlyHint: true, idempotentHint: true }],
  ['baton_waves_harvest', 'waves.harvest', { readOnlyHint: false, idempotentHint: true }],
];

test('H1-tools (stage: tools absent): the two ordinary tools register with closed schemas, _meta digests, and honest annotations', async () => {
  const names = mcpApplicationToolNames();
  for (const [tool] of NEW_TOOLS) {
    assert.ok(names.includes(tool), `${tool} joins the ordinary application surface (33 → 35)`);
  }
  assert.equal(names.length, 35,
    'the ordinary surface is exactly 33 + the two — a stowaway tool greens nothing');
  const combined = mcpCombinedToolNames();
  assert.ok(combined.includes('baton_run_resultpin'), 'combined surface gains baton_run_resultpin');
  assert.ok(combined.includes('baton_waves_harvest'), 'combined surface gains baton_waves_harvest');
  assert.equal(combined.length, 86, 'the combined surface is exactly 84 + the two');
  const { server } = mockAppServer();
  await initialized(server);
  const list = await wireRequest(server, 2, 'tools/list', {});
  const tools = new Map((list.result?.tools ?? []).map((tool) => [tool.name, tool]));
  for (const [tool, , hints] of NEW_TOOLS) {
    const row = tools.get(tool);
    assert.ok(row, `${tool} is advertised in tools/list`);
    assert.equal(row.inputSchema?.additionalProperties, false, `${tool} schema is closed`);
    assert.equal(row._meta?.['baton/registryDigest'], APPLICATION_SEMANTIC_REGISTRY.digest,
      `${tool} carries the registry-digest _meta stamp`);
    assert.equal(row.annotations?.readOnlyHint, hints.readOnlyHint, `${tool} readOnlyHint`);
    assert.equal(row.annotations?.idempotentHint, hints.idempotentHint, `${tool} idempotentHint`);
    assert.equal(row.annotations?.destructiveHint, false);
    assert.equal(row.annotations?.openWorldHint, false);
    const properties = Object.keys(row.inputSchema?.properties ?? {});
    for (const banned of ['idempotencyKey', 'sessionAuthority', 'lease', 'principalId', 'sessionId', 'capabilities']) {
      assert.equal(properties.includes(banned), false,
        `${tool} carries no wire ${banned} — authority comes from the connection, replay safety lives server-side`);
    }
  }
  assert.deepEqual(Object.keys(tools.get('baton_run_resultpin').inputSchema.properties).sort(),
    ['repoId', 'runId'], 'baton_run_resultpin schema is {repoId, runId}');
  assert.deepEqual(Object.keys(tools.get('baton_waves_harvest').inputSchema.properties).sort(),
    ['onto', 'repoId', 'resultSha', 'runId'], 'baton_waves_harvest schema is {onto, repoId, resultSha, runId}');
});

test('H2-dispatch (stage: tools absent): baton_run_resultpin dispatches the facade command with the CONNECTION principal', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:h2' });
  assert.equal(rec.view?.phase, 'work_completed');
  const server = await realServer(fx, mockPrincipal());
  await initialized(server);
  const response = await wireCall(server, 2, 'baton_run_resultpin', { repoId: REPO, runId: 'run:h2' });
  assert.equal(response.result?.isError, false, `dispatch succeeds: ${resultText(response)}`);
  const text = JSON.parse(resultText(response));
  assert.equal(text?.ready, true, 'the projection reaches the wire');
  assert.equal(text?.resultSha, rec.resultSha, 'the pin sha reaches the wire');
  assert.equal(text?.baseSha, rec.baseSha, 'the recorded base reaches the wire');
});

test('H3-vocabulary (stage: wire vocabulary absent): all 12 new refusal codes reach the wire AS THEMSELVES', async () => {
  const { server } = mockAppServer({
    command: async (name, args) => {
      if (name === 'run.message.send') throw Object.assign(new Error(`stub: ${args.body}`), { code: args.body });
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const codes = [
    'result_not_ready', 'pin_not_found', 'pin_unverifiable', 'pin_mismatch', 'pin_base_mismatch',
    'result_delta_oversize', 'harvest_conflict', 'harvest_onto_dirty', 'harvest_onto_invalid',
    'harvest_onto_advanced', 'harvest_base_diverged', 'harvest_apply_failed',
  ];
  let id = 2;
  for (const code of codes) {
    const response = await wireCall(server, id, 'baton_run_message_send', { repoId: REPO, runId: 'run:h3', kind: 'inform', body: code });
    id += 1;
    assert.equal(wireErrorCode(response), code,
      `${code} reaches the wire as itself — never command_outcome_unknown (RED: wire vocabulary absent)`);
  }
});

test('H4-translations (stage: wire vocabulary absent): the kernel codes map to the harvest vocabulary', async () => {
  const { server } = mockAppServer({
    command: async (name, args) => {
      if (name === 'run.message.send') throw Object.assign(new Error(`stub: ${args.body}`), { code: args.body });
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const rows = [
    ['structured_main_dirty', 'harvest_onto_dirty'],
    ['structured_main_advanced', 'harvest_onto_advanced'],
    ['structured_tool_unavailable', 'harvest_conflict'],
    ['structured_merge_failed', 'harvest_apply_failed'],
    ['captured_change_oversize', 'result_delta_oversize'],
  ];
  let id = 2;
  for (const [kernel, harvest] of rows) {
    const response = await wireCall(server, id, 'baton_run_message_send', { repoId: REPO, runId: 'run:h4', kind: 'inform', body: kernel });
    id += 1;
    assert.equal(wireErrorCode(response), harvest,
      `${kernel} translates to ${harvest} at the wire — never command_outcome_unknown (RED: wire vocabulary absent)`);
  }
});

test('H5-capabilities (stage: tools absent): observe admits run.resultpin; waves.harvest demands control', async () => {
  const { server } = mockAppServer({ principal: mockPrincipal({ capabilities: ['observe'] }) });
  await initialized(server);
  const admit = await wireCall(server, 2, 'baton_run_resultpin', { repoId: REPO, runId: 'run:h5' });
  assert.equal(admit.result?.isError, false,
    'an observe-only principal is admitted to the read projection (RED: tools absent)');
  const deny = await wireCall(server, 3, 'baton_waves_harvest', { repoId: REPO, resultSha: 'a'.repeat(40) });
  assert.equal(deny.result?.isError, true,
    'an observe-only principal is refused the effectful harvest (RED: tools absent)');
  assert.match(resultText(deny), /forbidden|unauthorized|capability/u,
    'the refusal names the capability gate — never a silent apply');
});

// ===========================================================================
// Section I — HA-09: CLI verbs + registry + conformance regeneration.
// Positive parse rows are red (stage: CLI verb absent); negative rows and the
// episode guard are green regression guards; the conformance guard must STAY green
// (landing tools without regenerating flips it red).
// ===========================================================================

test('I1-cli-parse (stage: CLI verb absent): the new verbs parse to the pinned command shapes', () => {
  const parsed = parseBatonCli(['run', 'resultpin', 'run:1']);
  assert.equal(parsed?.kind, 'command', 'run resultpin RUN_ID is a command dispatch');
  assert.equal(parsed?.name, 'run.resultpin');
  assert.equal(parsed?.args?.runId, 'run:1');

  const sha = 'a'.repeat(40);
  const bySha = parseBatonCli(['waves', 'harvest', sha]);
  assert.equal(bySha?.kind, 'command');
  assert.equal(bySha?.name, 'waves.harvest');
  assert.equal(bySha?.args?.resultSha, sha);

  const byRun = parseBatonCli(['waves', 'harvest', 'run:1']);
  assert.equal(byRun?.kind, 'command');
  assert.equal(byRun?.name, 'waves.harvest');
  assert.equal(byRun?.args?.runId, 'run:1');

  const withOnto = parseBatonCli(['waves', 'harvest', 'run:1', '--onto', '/x']);
  assert.equal(withOnto?.kind, 'command');
  assert.equal(withOnto?.name, 'waves.harvest');
  assert.equal(withOnto?.args?.runId, 'run:1');
  assert.equal(withOnto?.args?.onto, '/x');
});

test('I2-cli-negative (GUARD, green today): malformed verb spellings refuse at the parser', () => {
  // The two-token `baton run resultpin` is today's run-start objective shorthand and its
  // post-implementation fate is unspecified by Decision 5 (only `baton run resultpin
  // RUN_ID` is a new branch) — so it is deliberately NOT pinned here. The four forms
  // below refuse TODAY (with the pre-existing cli_command_unavailable/cli_invalid) and
  // must refuse after the grammar lands (as cli_invalid): the guard asserts the refusal,
  // not the pre-existing code.
  for (const argv of [
    ['waves', 'harvest'],                                // neither XOR source
    ['waves', 'harvest', 'run:1', 'a'.repeat(40)],       // both XOR sources
    ['run', 'resultpin', 'run:1', 'extra'],              // extra positional past RUN_ID
    ['waves', 'harvest', '--onto'],                      // dangling --onto with no value
  ]) {
    assert.throws(() => parseBatonCli(argv), `${argv.join(' ')} refuses at the parser`);
  }
});

test('I3-cli-web (stage: CLI verb absent): the dispatch gate admits both new keys', () => {
  assert.ok(CLI_WEB_COMMANDS.has('run.resultpin'), 'CLI_WEB_COMMANDS gates run.resultpin in');
  assert.ok(CLI_WEB_COMMANDS.has('waves.harvest'), 'CLI_WEB_COMMANDS gates waves.harvest in');
});

test('I4-registry (stage: rows absent): two canonical operations with pinned profiles, surfaces, capabilities, names', () => {
  const registry = APPLICATION_SEMANTIC_REGISTRY;
  const expectations = [
    ['run.resultpin', ['embedded', 'mcp', 'cli'], ['observe'], true, 'baton run resultpin', 'baton_run_resultpin'],
    ['waves.harvest', ['embedded', 'mcp', 'cli'], ['control', 'observe'], true, 'baton waves harvest', 'baton_waves_harvest'],
  ];
  for (const [key, surfaces, capabilities, idempotent, cli, mcp] of expectations) {
    const op = registry.canonicalOperations.find((entry) => entry.key === key);
    assert.ok(op, `registry row ${key} exists`);
    assert.equal(op.profile, 'ordinary', `${key} profile`);
    assert.deepEqual([...op.surfaces].sort(), [...surfaces].sort(), `${key} surfaces`);
    assert.deepEqual([...(op.capabilities ?? [])].sort(), [...capabilities].sort(), `${key} capabilities`);
    assert.equal(op.idempotent ?? true, idempotent, `${key} idempotent`);
    assert.equal(op.names?.cli, cli, `${key} derived CLI spelling`);
    assert.equal(op.names?.mcp, mcp, `${key} derived MCP spelling`);
  }
  // The dispatch gate and the served inventory pick both up.
  const served = servedCliOrdinaryKeys();
  for (const [key] of expectations) {
    assert.ok(served.includes(key), `servedCliOrdinaryKeys() renders ${key}`);
  }
  // The episode spelling stays LAWFUL: run.result is never a canonical key.
  assert.equal(registry.canonicalOperations.some((entry) => entry.key === 'run.result'), false,
    'no run.result canonical row — the episode result-chapter spelling is UNTOUCHED (green guard)');
});

test('I5-cli-episode (GUARD, green today): the occupied episode spelling is untouched', () => {
  const parsed = parseBatonCli(['run', 'result', 'run:1']);
  assert.equal(parsed?.kind, 'command');
  assert.equal(parsed?.name, 'run.episode');
  assert.equal(parsed?.args?.runId, 'run:1');
  assert.equal(parsed?.args?.topic, 'result');
});

test('I6-conformance (GUARD, green today, MUST stay green): the docs/conformance mains enforce the regenerated inventories', () => {
  assert.deepEqual(checkSurfaceDocs(), [], 'CLI.md/MCP.md generated blocks match the served surface');
  const result = execFileSync(process.execPath, [conformanceScript], {
    cwd: repoRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(String(result), /surface-conformance: ok/u, 'the CS-4 artifact and the banned-verb lint hold');
  assert.ok(BANNED_SURFACE_VERBS.length > 0, 'the banned-verb lint is populated');
});

// ===========================================================================
// Section J — HA-12: a real-but-unpinned commit refuses pin_not_found, and the
// runId source re-verifies its recorded ref the same way. (stage: harvest absent)
// ===========================================================================

test('J1-unpinned-sha (stage: harvest absent): a real commit without an ownership pin refuses pin_not_found', async (t) => {
  const fx = await facadeFixture(t);
  const owner = principalOf('owner');
  // A real commit that is NOT preserved under refs/baton/results/.
  execFileSync('git', ['checkout', '-q', '-b', 'side'], { cwd: fx.repo });
  writeFileSync(join(fx.repo, 'side.md'), 'side\n');
  git(['add', '-A'], fx.repo);
  git(['commit', '-q', '-m', 'side commit'], fx.repo);
  const realSha = git(['rev-parse', 'HEAD'], fx.repo);
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: fx.repo });

  const refusal = await facadeError(() => fx.application.command('waves.harvest', { resultSha: realSha }, owner, null));
  assert.equal(refusal?.code, 'pin_not_found',
    'a real-but-unpinned commit refuses pin_not_found (RED: harvest absent)');
});

test('J2-runid-reverification (stage: harvest absent): a released recorded ref refuses pin_not_found on the runId source', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:j2' });
  const owner = rec.owner;
  assert.equal(rec.view?.result?.preservation?.state, 'pinned');
  fx.driver.coordinator._worktrees.releaseResult(rec.ref);
  const refusal = await facadeError(() => fx.application.command('waves.harvest', { runId: 'run:j2' }, owner, null));
  assert.equal(refusal?.code, 'pin_not_found',
    'the runId source re-verifies the recorded ref and refuses a released pin (RED: harvest absent)');
});

// ===========================================================================
// Section K — HA-11: multi-pin independence. Two ceremonies with main advanced
// between produce DISTINCT pins; each run.resultpin resolves its OWN pin; releasing
// one leaves the other live. (stage: projection absent)
// ===========================================================================

test('K1-multi-pin (stage: projection absent): two ceremonies own distinct pins, each resolved by its own run', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const owner = principalOf('owner');
  const runA = await ceremonyRun(fx, { runId: 'run:k1-a', owner });
  assert.equal(runA.view?.phase, 'work_completed');
  // Advance main between the ceremonies so the second pin has a different parent chain.
  writeFileSync(join(fx.repo, 'k-advance.md'), 'adv\n');
  git(['add', '-A'], fx.repo);
  git(['commit', '-q', '-m', 'advance between ceremonies'], fx.repo);
  const runB = await ceremonyRun(fx, { runId: 'run:k1-b', owner });
  assert.equal(runB.view?.phase, 'work_completed');
  assert.notEqual(runA.resultSha, runB.resultSha, 'the two pins are distinct (deterministic advance between ceremonies)');

  const projA = await fx.application.command('run.resultpin', { runId: 'run:k1-a' }, owner, null);
  const projB = await fx.application.command('run.resultpin', { runId: 'run:k1-b' }, owner, null);
  assert.equal(projA?.ready, true);
  assert.equal(projA?.resultSha, runA.resultSha, 'run A resolves A\'s pin');
  assert.equal(projB?.ready, true);
  assert.equal(projB?.resultSha, runB.resultSha, 'run B resolves B\'s pin');
});

test('K2-released-coexists (stage: projection absent): releasing one pin leaves the other live', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const owner = principalOf('owner');
  const runA = await ceremonyRun(fx, { runId: 'run:k2-a', owner });
  writeFileSync(join(fx.repo, 'k2-advance.md'), 'adv\n');
  git(['add', '-A'], fx.repo);
  git(['commit', '-q', '-m', 'advance between ceremonies'], fx.repo);
  const runB = await ceremonyRun(fx, { runId: 'run:k2-b', owner });
  assert.equal(runA.view?.phase, 'work_completed');
  assert.equal(runB.view?.phase, 'work_completed');
  fx.driver.coordinator._worktrees.releaseResult(runA.ref);
  const projA = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:k2-a' }, owner, null));
  const projB = await fx.application.command('run.resultpin', { runId: 'run:k2-b' }, owner, null);
  assert.equal(projA?.code, 'pin_not_found', 'the released pin refuses pin_not_found');
  assert.equal(projB?.ready, true, 'the coexisting live pin still resolves');
  assert.equal(projB?.resultSha, runB.resultSha, 'B\'s pin is B\'s');
});

// ===========================================================================
// Section L — HA-13: receipt honesty. An applied-clean receipt certifies the
// RECORDED-base delta even after main advanced; a rewound main refuses
// harvest_base_diverged naming the four shas. (stage: harvest absent)
// ===========================================================================

test('L1-receipt-honesty (stage: harvest absent): applied-clean certifies the recorded diff after main advanced', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const rec = await ceremonyRun(fx, { runId: 'run:l1' });
  assert.equal(rec.view?.phase, 'work_completed');
  const owner = rec.owner;
  const oracle = fx.driver.coordinator._worktrees.changedPathsAtCommit(rec.baseSha, rec.resultSha);
  // Advance main with an unrelated commit AFTER the ceremony.
  writeFileSync(join(fx.repo, 'post.md'), 'post\n');
  git(['add', '-A'], fx.repo);
  git(['commit', '-q', '-m', 'post-ceremony advance'], fx.repo);
  const headAfter = git(['rev-parse', 'HEAD'], fx.repo);
  assert.notEqual(headAfter, rec.baseSha);

  const receipt = await fx.application.command('waves.harvest', { resultSha: rec.resultSha }, owner, null);
  assert.equal(receipt?.ok, true);
  assert.equal(receipt?.result, 'applied-clean');
  assert.equal(receipt?.baseSha, rec.baseSha, 'the receipt names the RECORDED base, not HEAD');
  assert.notEqual(receipt?.baseSha, headAfter, 'baseSha is not HEAD');
  assert.deepEqual(receipt?.changedPaths, oracle,
    'changedPaths is the recorded diff — the post-ceremony commit is NOT in it');
  assert.equal(git(['rev-parse', 'HEAD'], fx.repo), receipt?.afterSha, 'main landed at afterSha');
  assert.equal(git(['status', '--porcelain'], fx.repo), '', 'main is clean');
});

test('L2-diverged (stage: harvest absent): a rewound main refuses harvest_base_diverged naming the four shas', async (t) => {
  const fx = await facadeFixture(t, { adapter: new MockAdapter({ scenario: { outcome: 'completed', edits: TWO_EDITS } }) });
  const repo = fx.repo;
  // Advance main to a second commit BEFORE the ceremony so the recorded base is R2.
  writeFileSync(join(repo, 'r2.md'), 'second\n');
  git(['add', '-A'], repo);
  git(['commit', '-q', '-m', 'second commit'], repo);
  const rec = await ceremonyRun(fx, { runId: 'run:l2' });
  assert.equal(rec.view?.phase, 'work_completed');
  const owner = rec.owner;
  assert.equal(rec.baseSha, git(['rev-parse', 'HEAD'], repo), 'fixture: the recorded base is the main HEAD at capture');
  // Rewind main to its ancestor R1: merge-base(R1, pin) = R1 ≠ recorded base.
  const r1 = git(['rev-parse', 'HEAD~1'], repo);
  execFileSync('git', ['reset', '--hard', r1], { cwd: repo });
  const ontoHead = git(['rev-parse', 'HEAD'], repo);
  assert.equal(ontoHead, r1, 'fixture: main is rewound');

  const refusal = await facadeError(() => fx.application.command('waves.harvest', { resultSha: rec.resultSha }, owner, null));
  assert.equal(refusal?.code, 'harvest_base_diverged',
    'a main not descended from the recorded base refuses harvest_base_diverged (RED: harvest absent)');
  const mergeBase = git(['merge-base', ontoHead, rec.resultSha], repo);
  assert.equal(mergeBase, r1, 'fixture: the real merge-base is R1');
  for (const sha of [rec.baseSha, mergeBase, ontoHead, rec.resultSha]) {
    assert.ok(refusal?.message?.includes(sha), `the refusal names ${sha.slice(0, 8)} (baseSha/mergeBaseSha/ontoHeadSha/resultSha)`);
  }
  assert.equal(git(['rev-parse', 'HEAD'], repo), ontoHead, 'onto is UNTOUCHED by the refused harvest');
  assert.equal(git(['status', '--porcelain'], repo), '', 'onto is clean');
});

// ===========================================================================
// Section M — HA-10 static laws: the byte-stable command table is untouched, and the
// suite's closed-shape literals are sorted-key literals in ACTUAL sorted order.
// (guards, green today)
// ===========================================================================

test('M1-static (GUARD, green today): the byte-stable command table gains no keys', () => {
  for (const key of ['run.resultpin', 'waves.harvest']) {
    assert.equal(Object.hasOwn(APPLICATION_COMMAND_DEFINITIONS, key), false,
      `${key} is a DIRECT PORT — the byte-stable command table is untouched`);
  }
});

test('M2-static (GUARD, green today): the suite pins the closed-shape sorted-key literals', () => {
  const literals = [
    ['baseSha', 'changedFiles', 'changedPaths', 'ready', 'resultSha'], // run.resultpin return
    ['onto', 'resultSha', 'runId'], // waves.harvest args
    ['baseSha', 'changedPaths', 'ok', 'reason', 'result', 'resultSha'], // receipt core
    ['blob', 'digest', 'mode', 'path', 'size'], // changedFiles row
    ['conflicts', 'ontoHeadSha', 'resultSha'], // harvest_conflict payload
  ];
  for (const literal of literals) {
    assert.deepEqual(literal, [...literal].sort(),
      `[${literal.join(', ')}] is a sorted-key literal in ACTUAL sorted order`);
  }
});

// ===========================================================================
// Section N — HA-14: the control lane. The host policy refuses without a lease; the
// ports dispatch AHEAD of the recursive-session gate (a live run-orchestrator lease
// holder's shape failures are the commands' OWN codes, never
// run_orchestrator_command_forbidden). (stage: ports absent)
// ===========================================================================

test('N1-control-policy (stage: ports absent): the host policy owns both commands', async (t) => {
  const fx = await facadeFixture(t, { authorize: policyOn(new Set(['run:known'])) });
  const owner = principalOf('owner');
  for (const [args, code] of [
    [{ runId: 'run:unknown' }, 'application_unauthorized'],
    [{ resultSha: 'a'.repeat(40) }, 'application_unauthorized'],
  ]) {
    const refusal = await facadeError(() => fx.application.command('waves.harvest', args, owner, null));
    assert.equal(refusal?.code, code, `waves.harvest ${JSON.stringify(args)} is policy-refused`);
  }
  const refusal = await facadeError(() => fx.application.command('run.resultpin', { runId: 'run:unknown' }, owner, null));
  assert.equal(refusal?.code, 'application_unauthorized', 'run.resultpin is policy-refused');
});

test('N2-pre-gate (stage: ports absent): shape failures dispatch ahead of the recursive-session gate', async (t) => {
  // goalPlan: false makes the store's createTask gate inert (workflow-surface's
  // authorityOn fixture), so the lease ceremony stages store-directly.
  const fx = await facadeFixture(t, { goalPlan: false });
  const lease = authorityOn(fx, { runId: 'run:n2', principalId: 'reviewer', sessionId: 'session-reviewer' });
  const recursiveContext = {
    schemaVersion: 1, requestId: 'ha-n2', idempotencyKey: 'ha-n2',
    sessionAuthority: lease.sessionAuthority,
  };
  const reviewer = principalOf('reviewer');
  const expected = [
    ['run.resultpin', {}, 'application_run_resultpin_invalid'],
    ['waves.harvest', { runId: 'run:n2', bad: 1 }, 'application_waves_harvest_invalid'],
  ];
  for (const [name, args, code] of expected) {
    const refusal = await facadeError(() => fx.application.command(name, args, reviewer, recursiveContext));
    assert.equal(refusal?.code, code,
      `${name} dispatches ahead of the recursive-session gate — never run_orchestrator_command_forbidden (RED: ports absent)`);
  }
});
