// Issue #334 acceptance half (red-before): a read_only_evidence run whose captured
// candidate changed no path skips pinned verification, and an inconclusive verdict whose
// failureOwnership is baseline_or_environment never reads phase 'failed'.
//
// Row inventory (6 rows):
//   334-1  coordinator trust gate: read-only (effects without repository_edit) + changedPaths
//          empty records {outcome:'passed', diagnosticCode:'verification_not_required',
//          reason:'read_only_no_change'} WITHOUT running the pinned verification (no referee
//          call, no verify sandbox) and completes with the worker's textual result.
//   334-2  narrowness guard: a change run (effects WITH repository_edit) whose capture changed
//          no path still runs the pinned verification.
//   334-3  referee done-gate: accept() honors the hub's own skip receipt, including under
//          hardening requirements (there is no change to harden).
//   334-4  application run phase: an inconclusive verdict with failureOwnership
//          baseline_or_environment (base red, candidate not to blame) reads phase
//          'inconclusive' — never 'failed' — with the retry_verification action still offered
//          and the progress summary naming the ownership.
//   334-5  end to end: a read_only_evidence exploration whose worker changed nothing completes
//          even though the deployment's pinned verification would fail if it ran.
//   334-6  brief renderer: a read_only_evidence brief states exactly what acceptance will check.
//
// Hermetic except 334-4/334-5, which drive a real deployment over mkdtemp git repos (the
// phase92 pattern): real coordinator trust gate, real referee over real sandboxes, stub
// provider. The failing pinned verification is `node -e process.exit(1)` — hermetic (node is
// the test host) and fails identically on candidate and base, which is exactly the
// baseline_or_environment shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { MockAdapter, renderBrief } from '../src/adapter.mjs';
import * as refereeNs from '../src/referee.mjs';
import { openBaton } from '../src/index.mjs';

const dirs = [];
function tmpDir(prefix = 'baton-334-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// ---------------------------------------------------------------------------
// Coordinator-direct harness (mirrors worker-verdict-surface-red.test.mjs:
// a 'claim'-card adapter whose completed turn falls straight through to the
// real trust gate; a fixed microtask drain drives the production dispatch).
// ---------------------------------------------------------------------------

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null,
      maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native',
    };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(callback) { this._onEvent = callback; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
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

const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

function setup({ adapter, capture = noDiff, referee = null } = {}) {
  const dirPath = tmpDir();
  const log = new Log(join(dirPath, 'log'));
  let verifyWorktrees = 0;
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture,
    createVerifyWorktree: async () => { verifyWorktrees += 1; return { path: tmpdir() }; },
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  let refereeCalls = 0;
  const countingReferee = async (...args) => {
    refereeCalls += 1;
    return (referee ?? (async () => ({
      reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox',
    }))) (...args);
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: countingReferee,
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
  });
  return {
    coordinator,
    calls: () => ({ referee: refereeCalls, verifyWorktrees }),
  };
}

async function flush(times = 80) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

async function spawn(coordinator, overrides = {}) {
  const handle = await coordinator.spawn('mock', makeBrief(overrides));
  return { handle, task: coordinator._tasks.get(handle.taskId) };
}

function stageCompletedTurn(adapter, handle, { summary = 'pong', files = [] } = {}) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: {
      status: 'completed', progress: 1, summary,
      artifacts: { commits: [], files },
      verification: { command: 'true', claimedExit: 0 },
      budgetUsed: { tokens: 1, usd: 0 },
    },
  });
}

test('334-1: a read-only run whose capture changed no path skips pinned verification and records the typed skip verdict', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, calls } = setup({ adapter });
  const { handle, task } = await spawn(coordinator, { effects: ['provider_call'] });
  stageCompletedTurn(adapter, handle, { summary: 'pong' });
  await flush();
  assert.equal(calls().referee, 0, 'the pinned verification does not run at all — the referee is never called');
  assert.equal(calls().verifyWorktrees, 0, 'no verify sandbox is materialized for a run with nothing to verify');
  assert.equal(task.status, 'completed', 'the run completes');
  assert.equal(task.verdict?.outcome, 'passed');
  assert.equal(task.verdict?.diagnosticCode, 'verification_not_required');
  assert.equal(task.verdict?.reason, 'read_only_no_change');
  assert.equal(task.result?.summary, 'pong', 'the run completes with the worker textual result');
});

test('334-2: a change run whose capture changed no path still runs the pinned verification', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, calls } = setup({ adapter });
  const { handle, task } = await spawn(coordinator, { effects: ['provider_call', 'repository_edit'] });
  stageCompletedTurn(adapter, handle);
  await flush();
  assert.equal(calls().referee, 1, 'the change run still verifies against the base');
  assert.equal(task.status, 'completed');
  assert.notEqual(task.verdict?.diagnosticCode, 'verification_not_required');
});

test('334-3: the referee done-gate honors the hub skip receipt, including under hardening requirements', () => {
  assert.equal(typeof refereeNs.readOnlyNoChangeVerdict, 'function',
    'referee.mjs mints the hub skip receipt');
  const receipt = refereeNs.readOnlyNoChangeVerdict({ durationMs: 3 });
  assert.equal(receipt.outcome, 'passed');
  assert.equal(receipt.diagnosticCode, 'verification_not_required');
  assert.equal(receipt.passed, true);
  assert.equal(refereeNs.accept(receipt), true);
  assert.equal(
    refereeNs.accept(receipt, { requireRedGreen: true, requireCoverage: true, requireMutation: true }),
    true,
    'there is no change to harden — hardening requirements never apply to the skip receipt',
  );
  assert.equal(
    refereeNs.accept({ ...receipt, passed: false, outcome: 'candidate_failed' }),
    false,
    'a tampered skip receipt is still refused',
  );
});

// ---------------------------------------------------------------------------
// Full-application rows (the phase92 openBaton pattern).
// ---------------------------------------------------------------------------

const ROUTE = Object.freeze({ harness: 'mock', model: 'phase334-review', effort: 'high' });

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-334-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase334@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 334'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# review target\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapterWith(scenario) {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    version: 'mock 1.0.0',
    authPosture: 'fixture',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'phase334-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return value;
}

async function terminal(run) {
  const deadline = Date.now() + 60_000;
  let last = null;
  while (Date.now() < deadline) {
    const view = await run.status();
    last = view;
    if (['completed', 'failed', 'inconclusive', 'cancelled', 'stopped'].includes(view.phase)) return view;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Run did not settle: ${JSON.stringify({ phase: last?.phase })}`);
}

test('334-4: an inconclusive baseline_or_environment verdict reads phase inconclusive, keeps retry_verification, and names the ownership', async (t) => {
  const repo = repository(t);
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(repo, '.deployment'),
      adapters: {
        mock: adapterWith({
          outcome: 'completed', delayMs: 1, summary: 'candidate with a diff',
          edits: [{ path: 'note.txt', content: 'hello\n' }],
        }),
      },
      routes: [ROUTE],
      // Fails identically on the candidate and the base: the candidate is not to blame.
      verification: { command: 'node', arguments: ['-e', 'process.exit(1)'] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  const run = await deployment.run('Change note.txt; the pinned suite is red on every checkout.', {
    exact: ROUTE,
  });
  await run.approve();
  const settled = await terminal(run);
  assert.equal(settled.verification?.verdict?.outcome, 'inconclusive');
  assert.equal(settled.verification?.verdict?.failureOwnership, 'baseline_or_environment');
  assert.equal(settled.phase, 'inconclusive', 'a baseline-owned inconclusive never reads failed');
  assert.equal(settled.verification?.state, 'inconclusive');
  assert.ok(
    (settled.nextActions ?? []).some((entry) => entry?.kind === 'retry_verification'),
    'the retry_verification action is still offered',
  );
  assert.match(
    settled.progress?.summary ?? '',
    /baseline_or_environment/,
    'the outline progress summary names the ownership',
  );
});

test('334-5: a read-only exploration with no changed path completes without running a failing pinned verification', async (t) => {
  const repo = repository(t);
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(repo, '.deployment'),
      adapters: {
        mock: adapterWith({ outcome: 'completed', delayMs: 1, summary: 'pong', files: {} }),
      },
      routes: [ROUTE],
      // Would fail if it ran: the skip is what lets this run complete.
      verification: { command: 'node', arguments: ['-e', 'process.exit(1)'] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  const review = await deployment.explore('Evidence-backed review; change nothing.', { exact: ROUTE });
  await review.approve();
  const settled = await terminal(review);
  assert.equal(settled.phase, 'completed', JSON.stringify({
    terminalCause: settled.terminalCause, verification: settled.verification,
  }));
  assert.equal(settled.terminalCause, null);
  assert.equal(settled.verification?.verdict?.outcome, 'passed');
  assert.equal(settled.verification?.verdict?.diagnosticCode, 'verification_not_required');
  assert.equal(settled.result?.state, 'accepted');
});

test('334-6: the brief renderer states exactly what acceptance will check for read-only runs', () => {
  const readOnly = renderBrief({
    goal: 'review only',
    pathScope: ['.'],
    effects: ['provider_call'],
    requiredEffects: [],
    budget: { tokens: 10, usd: 1, wallMin: 1 },
    verification: { command: 'npm test', expectExit: 0 },
  }, 'cli');
  assert.match(readOnly, /verification_not_required/, 'the skip diagnostic is named');
  assert.match(readOnly, /read_only_no_change/, 'the skip reason is named');
  assert.match(readOnly, /no pinned verification/i, 'the skipped check is said out loud');
  const change = renderBrief({
    goal: 'change it',
    pathScope: ['.'],
    effects: ['provider_call', 'repository_edit'],
    requiredEffects: ['repository_edit'],
    budget: { tokens: 10, usd: 1, wallMin: 1 },
    verification: { command: 'npm test', expectExit: 0 },
  }, 'cli');
  assert.equal(change.includes('verification_not_required'), false,
    'a change brief carries no read-only acceptance statement');
});
