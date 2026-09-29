// KG settlement epic red suite v2 (contract: docs/reference/evidence/
// kg-settlement-2026-08-01/kg-settlement-decisions.md v1.0+v1.1 — issue #63).
//
// v2 folds the test-suite red-team (test-redteam-falsegreen.md codex, test-redteam-coverage.md
// deepseek): primitive fixtures use only already-shipped primitives and are labelled; every
// row records its expected failure STAGE (the named contract gap); dispatch rows use spy
// coordinators and valid fixtures; the re-drive row is a real crash walk; the sweep is
// driver-triggered with a 17-bundle bound check; framing is asserted on the real review
// surface with a control-character-bearing worker note.
//
// Red-first: written against the contract BEFORE implementation; every row fails for the
// named stage and goes green on the contract's implementation ONLY. KS9 is a regression pin
// (green before and after; it guards the structural gate, it is not red-first evidence).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter } from '../src/adapter.mjs';
import { BatonApplication } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { CLI_WEB_COMMANDS } from '../src/application-cli.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { bindBaton, createDriver, DEFAULT_RUN_LINEAGE_POLICY } from '../src/index.mjs';
import { RUN_ORCHESTRATOR_CAPABILITIES } from '../src/run-lineage.mjs';

const repoId = 'repo-kg-settlement';
const dirs = [];
function dir(label) {
  const d = mkdtempSync(join(tmpdir(), `baton-kg-settlement-${label}-`));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const auth = (key, actor = 'orchestrator') => ({ actor, key });

const sessionAuth = (key, session) => ({
  actor: 'orchestrator', key,
  principalId: session.principalId, sessionId: session.sessionId,
  sessionAuthorityDigest: session.authorityDigest,
});

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

function freshStore(label, opts = {}) {
  return new CoordinationStore(dir(label), { repoId, clock: () => '2026-08-01T08:00:00.000Z', ...opts });
}

const goalPlanPolicy = (mandatory) => Object.freeze({
  schemaVersion: 1, repoId, mandatory, approvalTtlMs: 60_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['provider_call', 'repository_edit'],
  capabilityClasses: ['baton_orchestrator', 'code', 'test'],
  limits: {
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 16, maxDepsPerNode: 16,
    maxTextBytes: 16_384, maxItems: 128, maxScopePaths: 128, maxRouteValues: 64,
    maxGoalBytes: 256 * 1024, maxPlanBytes: 512 * 1024, maxStatusBytes: 1024 * 1024,
    maxTokens: 100_000_000, maxUsd: 1_000, maxWallMin: 480, maxProviderTurns: 2_048,
  },
});

// The application harness policy drops baton_orchestrator from the capability classes: with it
// present, keyed waves route through the run-lineage orchestrator admission path and stall the
// full approvalTtlMs (60s) at close — receipted in this suite's v2 bring-up (issue-worthy).
const appGoalPlanPolicy = (mandatory) => Object.freeze({
  ...goalPlanPolicy(mandatory),
  capabilityClasses: ['code', 'test'],
});

const WAVE_ID = `wave:${createHash('sha256').update('kg-settlement-test-wave').digest('hex').slice(0, 32)}`;
const SETTLEMENT_RUN_ID = `run-settlement:${WAVE_ID}`;
const SETTLEMENT_TASK_ID = `settlement-task:${WAVE_ID}`;
const SETTLEMENT_WORKER_ID = `settlement-worker:${WAVE_ID}`;



// ===========================================================================
// KS1 — D1: the atomic settlement-task API (stage: API missing)
// ===========================================================================

test('KS1: the pair is ONE two-event batch with the hub-fixed brief and pinned identities', () => {
  const store = freshStore('ks1', { runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY, goalPlanPolicy: goalPlanPolicy(true) });
  const before = store.snapshot().lastSeq ?? store.events().length;
  const receipt = store.createAndClaimSettlementTask(
    { id: SETTLEMENT_TASK_ID, runId: SETTLEMENT_RUN_ID, reservedWorkerId: SETTLEMENT_WORKER_ID },
    { actor: 'orchestrator', key: `settlement.task:${WAVE_ID}` },
  );
  assert.equal(receipt.result, 'claimed');
  const events = store.events(before + 1);
  assert.equal(events.length, 2, 'exactly one created + one claimed event');
  assert.deepEqual(events.map((event) => event.kind), ['task.created', 'task.claimed']);
  assert.equal(events[0].batch?.id, events[1].batch?.id, 'one atomic batch');
  assert.equal(events[0].batch?.index, 0);
  assert.equal(events[1].batch?.index, 1);
  assert.equal(events[0].ts, events[1].ts, 'same timestamp');
  assert.equal(receipt.task.status, 'working');
  assert.equal(receipt.task.relation, 'settlement');
  assert.equal(receipt.task.brief?.objective, `settlement task for wave ${WAVE_ID}`, 'the objective is the hub constant, byte-exact');
  assert.deepEqual(receipt.task.brief?.capabilities, ['baton_orchestrator']);
});

test('KS1: closed shape — extra fields, caller prose, non-orchestrator actors, unpinned ids all refuse', () => {
  const store = freshStore('ks1-closed', { runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY, goalPlanPolicy: goalPlanPolicy(true) });
  for (const fields of [
    { id: SETTLEMENT_TASK_ID, runId: SETTLEMENT_RUN_ID, reservedWorkerId: SETTLEMENT_WORKER_ID, objective: 'caller prose' },
    { id: SETTLEMENT_TASK_ID, runId: SETTLEMENT_RUN_ID, reservedWorkerId: SETTLEMENT_WORKER_ID, brief: {} },
    { id: 'task:unpinned', runId: SETTLEMENT_RUN_ID, reservedWorkerId: SETTLEMENT_WORKER_ID },
    { id: SETTLEMENT_TASK_ID, runId: 'run:unpinned', reservedWorkerId: SETTLEMENT_WORKER_ID },
  ]) {
    assert.equal(refusalCode(() => store.createAndClaimSettlementTask(fields, auth(`settlement.task:bad:${JSON.stringify(Object.keys(fields).sort())}`))),
      'settlement_task_invalid', JSON.stringify(fields));
  }
  for (const actor of ['worker', 'operator:mallory', 'policy']) {
    assert.equal(refusalCode(() => store.createAndClaimSettlementTask(
      { id: SETTLEMENT_TASK_ID, runId: SETTLEMENT_RUN_ID, reservedWorkerId: SETTLEMENT_WORKER_ID },
      auth(`settlement.task:actor:${actor}`, actor),
    )), 'settlement_task_invalid', actor);
  }
});

test('KS1: replay is exactly-once and same-key-different-fields conflicts', () => {
  const store = freshStore('ks1-mandatory', { runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY, goalPlanPolicy: goalPlanPolicy(true) });
  const first = store.createAndClaimSettlementTask(
    { id: SETTLEMENT_TASK_ID, runId: SETTLEMENT_RUN_ID, reservedWorkerId: SETTLEMENT_WORKER_ID },
    auth(`settlement.task:${WAVE_ID}`),
  );
  const replay = store.createAndClaimSettlementTask(
    { id: SETTLEMENT_TASK_ID, runId: SETTLEMENT_RUN_ID, reservedWorkerId: SETTLEMENT_WORKER_ID },
    auth(`settlement.task:${WAVE_ID}`),
  );
  assert.equal(replay.result, 'idempotent');
  assert.equal(replay.event.seq, first.event.seq);
  assert.equal(refusalCode(() => store.createAndClaimSettlementTask(
    { id: SETTLEMENT_TASK_ID, runId: SETTLEMENT_RUN_ID, reservedWorkerId: 'settlement-worker:other' },
    auth(`settlement.task:${WAVE_ID}`),
  )), 'settlement_task_conflict', 'same key, changed identity must conflict');
});

// ===========================================================================

// ===========================================================================
// KS3 — D2: the four commands dispatch to the exact coordinator methods with
// server-derived authority (stage: dispatch missing)
// ===========================================================================

test('KS3: scratchpad.elevate maps to coordinator.elevateTaskScratchpad with normalized args', async (t) => {
  const { application, driver } = appHarness(t, { default: { outcome: 'completed', edits: [{ path: 'reports/a.md', content: 'a\n' }] } });
  const calls = spyCoordinator(driver, ['elevateTaskScratchpad', 'settleWorkflowScratchpad']);
  const code = await application.command('scratchpad.elevate', {
    runId: 'run-x', taskId: 'task-x', workerId: 'w-1', expectedScratchpadFence: 0,
    entryIds: [`scratchpad-entry:${'a'.repeat(64)}`],
  }, principal('wave-owner')).then(() => null, (error) => error?.code ?? 'thrown');
  assert.notEqual(code, 'application_command_unavailable');
  assert.equal(calls.elevateTaskScratchpad.length, 1, 'the coordinator method is reached exactly once');
  const [taskIdArg, entryIdsArg] = calls.elevateTaskScratchpad[0];
  assert.equal(taskIdArg, 'task-x', 'the command normalizes to the coordinator wrapper signature');
  assert.deepEqual(entryIdsArg, [`scratchpad-entry:${'a'.repeat(64)}`]);
  assert.equal(calls.settleWorkflowScratchpad.length, 0, 'no alternate method is called');
});

test('KS3: scratchpad.settle maps to coordinator.settleWorkflowScratchpad', async (t) => {
  const { application, driver } = appHarness(t, { default: { outcome: 'completed', edits: [{ path: 'reports/a.md', content: 'a\n' }] } });
  const calls = spyCoordinator(driver, ['settleWorkflowScratchpad', 'elevateTaskScratchpad']);
  await application.command('scratchpad.settle', {
    runId: 'run-x', expectedScratchpadFence: 0, skips: [],
  }, principal('wave-owner')).catch(() => {});
  assert.equal(calls.settleWorkflowScratchpad.length, 1);
  const [runIdArg, fieldsArg] = calls.settleWorkflowScratchpad[0];
  assert.equal(runIdArg, 'run-x');
  assert.deepEqual(fieldsArg, { expectedScratchpadFence: 0, skips: [] });
  assert.equal(calls.elevateTaskScratchpad.length, 0, 'no alternate method is called');
});
// ===========================================================================
// KS9 — structural surface gate (regression pin; amended for the MCP-W2 fold)
// ===========================================================================

test('KS9: the two settlement rows are mcp-enabled in the registry, CLI, and recursive gate', async () => {
  const names = ['scratchpad.elevate', 'scratchpad.settle'];
  const rows = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations;
  for (const name of names) {
    const row = rows.find((entry) => entry.key === name);
    assert.ok(row, `${name} registry row exists`);
    // Deliberate amendment (mcp-packaging-decisions v1.0 MCP-W2): the rows gain `mcp` in
    // `surfaces`; the MCP enablement carries the S-2 sessionAuthority envelope requirement.
    assert.deepEqual([...(row.surfaces ?? [])].sort(), ['embedded', 'mcp'], `${name} surfaces carry mcp`);
  }
  for (const derived of ['scratchpad_elevate', 'scratchpad_settle']) {
    assert.equal(CLI_WEB_COMMANDS.has(derived), false, `CLI excludes ${derived}`);
  }
  assert.deepEqual([...RUN_ORCHESTRATOR_CAPABILITIES], ['run.context', 'run.start', 'run.status', 'run.stop']);
});

test('KS9: the four names stay out of the recursive-dispatch allowlists (source pin)', async () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'application.mjs'), 'utf8');
  const effectSet = source.slice(source.indexOf('recursiveEffectCommands'), source.indexOf('recursiveEffectCommands') + 200);
  for (const name of ['scratchpad.elevate', 'scratchpad.settle', 'knowledge.promote']) {
    assert.equal(effectSet.includes(`'${name}'`), false, `${name} stays out of recursiveEffectCommands`);
  }
  assert.deepEqual([...RUN_ORCHESTRATOR_CAPABILITIES], ['run.context', 'run.start', 'run.status', 'run.stop'],
    'the capability allowlist is unchanged — the capability-backed recursive gate does not admit the ritual');
});

// ---------------------------------------------------------------------------
// Harnesses
// ---------------------------------------------------------------------------

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

function root(label) {
  const d = dir(label);
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: d });
  return d;
}


function profile() {
  return Object.freeze({
    schemaVersion: 1,
    repoId,
    definitionOfDone: ['deployment verification passes'],
    constraints: [],
    risk: 'low',
    goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
    nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
    pathScope: ['**'],
    verification: {
      command: 'true', arguments: [], cwd: '.', envAllowlist: [],
      expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
      requiredPredecessorEvidence: [],
    },
    routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
    capabilities: ['code', 'test'],
    effects: ['provider_call', 'repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  });
}

function mockCard(adapter) {
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'kg-settlement-test', refreshedAt: null,
    },
  });
}

// The store/coordinator clock is anchored to the wave-time the fixtures assume (the settle-window
// opens well inside every seeded review window: the seeded leases expire at 06:30 / 08:30 UTC, so a
// 06:00 base keeps them live at issue/admission and stale only relative to a LATER wave close — the
// driver-triggered, no-timers sweep). It advances in real time (never frozen), so relative durations
// stay honest; only the absolute wall-clock coupling is removed. This makes the suite deterministic
// on any host clock without touching a single assertion (the shipped deployment clock is real time).
const ANCHORED_STORE_CLOCK = (() => {
  const base = Date.parse('2026-08-01T06:00:00.000Z');
  const start = Date.now();
  return () => base + (Date.now() - start);
})();

function buildApplication(t, adapter, { mandatory = true } = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mockCard(adapter);
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    now: ANCHORED_STORE_CLOCK,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    approvalTimeoutMs: 3_000, // keyed waves (93B) otherwise stall the full 60s default at close
    runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
    goalPlanAuthority: { policy: appGoalPlanPolicy(mandatory), authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: { default: profile() },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    await driver.closeAuthority?.();
    await driver.coordination?.releaseWriterLease?.();
  });
  return { application, baton, driver, repo, store: driver.coordination };
}

function appHarness(t, scenariosByMarker) {
  return buildApplication(t, new MockAdapter({ scenario: scenariosByMarker.default ?? { outcome: 'completed' } }), {});
}




function spyCoordinator(driver, methods) {
  const calls = Object.fromEntries(methods.map((name) => [name, []]));
  for (const name of methods) {
    const original = driver.coordinator?.[name];
    driver.coordinator[name] = (...args) => {
      calls[name].push(args);
      if (typeof original === 'function') return original.apply(driver.coordinator, args);
      return { ok: true };
    };
  }
  return calls;
}


