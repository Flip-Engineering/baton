// Concurrency policy: representation, deployment defaults, and dispatch admission.
//
// Policy under test (docs/audits/2026-09-13-runtime-policy/admission-fix.md):
//   * `card().concurrencyCeiling: number | null` — a number is a value the deployment CALLER
//     configured; `null` means "no configured limit". Nothing invents a default: no constructor,
//     no built-in route, no surface substitute (1/4/Infinity are all gone).
//   * A configured ceiling is ENFORCED for exact and auto routes by dispatch admission, which
//     ledgers `task.dispatch_deferred` and resumes when a slot is released — never a silent skip,
//     never a reroute, and never a durable-looking wait whose receipt failed to record.
//   * Absence throttles nothing: a card without a ceiling runs as many workers as the caller asks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeConcurrencyCeiling, withinConcurrencyCeiling } from '../src/concurrency-policy.mjs';
import { ClaudeAdapter, CodexAdapter, GlmAdapter, MockAdapter } from '../src/adapter.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { KimiAcpCli } from '../src/kimi-acp.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { ClaudeCli, CodexCli, PiCli, ZCodeCli } from '../src/cli-adapters.mjs';
import { ClaudeSessionCli, GlmSessionCli, KimiSessionCli } from '../src/claude-session.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const dirs = [];
function tmpDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function makeBrief(overrides = {}) {
  return {
    goal: 'do the thing', constraints: [], pathScope: ['.'], definitionOfDone: 'ok',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, ...overrides,
  };
}

/** Minimal Adapter-contract double with a real modelSelection, so auto routing can select it. */
class ScriptableAdapter {
  constructor({ harness = 'mock', concurrencyCeiling = null } = {}) {
    this._card = {
      harness, version: '1.0.0', authPosture: 'api_key', concurrencyCeiling, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'claim',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null,
        provenance: 'concurrency-policy-test', refreshedAt: null,
      },
    };
    this.calls = { spawn: [] };
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

class SpyWorktreeManager {
  constructor() { this.calls = { create: [], reconcile: [] }; }
  async create(taskId) { this.calls.create.push({ taskId }); return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }; }
  async capture() { return { sha: 'sha-result' }; }
  async createVerifyWorktree(taskId) { return { path: `/tmp/verify/${taskId}` }; }
  async removeVerifyWorktree() {}
  async remove() {}
  async reconcile() { this.calls.reconcile.push({}); }
  worktreeAvailable() { return true; }
}

function setup({ adapters, route }) {
  const log = new Log(join(tmpDir('baton-concurrency-log-'), 'log'));
  const coordination = coordinationForLog(log);
  const worktrees = new SpyWorktreeManager();
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters, worktrees,
    referee: async (task) => ({
      reverified: true, observedExit: task.brief.verification.expectExit,
      matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
    }),
    route, now: () => 0,
  });
  return { coordinator, coordination, worktrees };
}

const deferredReceipts = (coordination) => coordination.events(1).filter((event) => event.kind === 'task.dispatch_deferred');

/** A git repository the deployment factory can bind to. */
function repository() {
  const path = tmpDir('baton-concurrency-repo-');
  execFileSync('git', ['init', '-q'], { cwd: path });
  writeFileSync(join(path, 'README.md'), 'x\n');
  execFileSync('git', ['add', '-A'], { cwd: path });
  execFileSync('git', ['-c', 'user.email=t@e.test', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: path });
  return path;
}

/** Open a deployment whose adapters are the real BUILT-IN ones (no advanced.adapters override). */
async function openBuiltInDeployment({ routes, adapterOptions, extraAdvanced = {} } = {}) {
  const repo = repository();
  let driver = null;
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: tmpDir('baton-concurrency-dep-'),
      routes: routes ?? [
        { harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'low' },
        { harness: 'kimi-code', model: 'kimi-k3', effort: 'max' },
      ],
      ...(adapterOptions ? { adapterOptions } : {}),
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
      ...extraAdvanced,
    },
  }, (options) => { driver = createDriver(options); return driver; });
  return {
    deployment, driver,
    async close() { try { await deployment.close(); } catch { /* best-effort teardown */ } },
  };
}

// ---------------------------------------------------------------------------
// REP — one representation
// ---------------------------------------------------------------------------

test('REP-1: no in-tree adapter invents a ceiling; a configured value is preserved and an invalid one refuses', () => {
  const defaults = [
    ['MockAdapter', new MockAdapter({ scenario: { outcome: 'completed' } })],
    ['CodexAdapter', new CodexAdapter()],
    ['ClaudeAdapter', new ClaudeAdapter()],
    ['GlmAdapter', new GlmAdapter()],
    ['OmpRpcCli', new OmpRpcCli({ requestTimeoutMs: 45_000, model: 'm', modelCatalog: { m: ['low'] } })],
    ['GrokAcpCli', new GrokAcpCli({ requestTimeoutMs: 45_000, model: 'm' })],
    ['KimiAcpCli', new KimiAcpCli({ cmd: 'kimi', requestTimeoutMs: 45_000, model: 'm', modelCatalog: { m: ['max'] } })],
    ['CodexAppServerCli', new CodexAppServerCli({ cmd: 'codex', requestTimeoutMs: 45_000 })],
    ['CodexCli', new CodexCli()],
    ['ClaudeCli', new ClaudeCli()],
    ['ZCodeCli', new ZCodeCli()],
    ['PiCli', new PiCli()],
    ['ClaudeSessionCli', new ClaudeSessionCli({ cmd: 'true', versionProbe: () => 'x' })],
    ['GlmSessionCli', new GlmSessionCli({ cmd: 'true', versionProbe: () => 'x' })],
    ['KimiSessionCli', new KimiSessionCli({ cmd: 'true', versionProbe: () => 'x' })],
  ];
  for (const [name, adapter] of defaults) {
    assert.equal(adapter.card().concurrencyCeiling, null,
      `${name}: absent configuration is null (no configured limit) — never an invented 1 or 4, never a sentinel`);
  }
  assert.equal(new MockAdapter({ scenario: {}, concurrencyCeiling: 2 }).card().concurrencyCeiling, 2,
    'a configured ceiling survives construction verbatim');

  for (const invalid of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '4', true]) {
    assert.throws(() => new MockAdapter({ scenario: {}, concurrencyCeiling: invalid }),
      (error) => error instanceof TypeError && /positive safe integer or null/.test(error.message),
      `constructor refuses ${String(invalid)} instead of coercing it`);
    assert.throws(() => withinConcurrencyCeiling(invalid, 0), TypeError,
      `the shared predicate refuses ${String(invalid)} instead of treating it as unbounded or saturated`);
  }
});

test('REP-2: the shared predicate treats null as unbounded and a configured value as a real gate', () => {
  assert.equal(withinConcurrencyCeiling(null, 9), true, 'no configured limit: any in-flight count is eligible');
  assert.equal(withinConcurrencyCeiling(undefined, 9), true, 'an absent field is the same absence');
  assert.equal(withinConcurrencyCeiling(1, 0), true);
  assert.equal(withinConcurrencyCeiling(1, 1), false, 'a configured ceiling is enforced, not advisory');
  assert.equal(withinConcurrencyCeiling(4, 3), true);
  assert.equal(withinConcurrencyCeiling(4, 4), false);
  assert.equal(normalizeConcurrencyCeiling(null), null);
  assert.equal(normalizeConcurrencyCeiling(undefined), null);
});

// ---------------------------------------------------------------------------
// DEP — the product default (built-in routes, no advanced.adapters override)
// ---------------------------------------------------------------------------

test('DEP-1: built-in deployment routes configure NO ceiling, and occupancy reports null instead of a fabricated 1', async (t) => {
  const fixture = await openBuiltInDeployment();
  t.after(() => fixture.close());
  const cards = Object.entries(fixture.driver.coordinator._adapters)
    .map(([key, adapter]) => [key, adapter.card()]);
  assert.ok(cards.length >= 2, 'the built-in route set produced real adapters');
  for (const [key, card] of cards) {
    assert.equal(card.concurrencyCeiling, null,
      `${key}: the product default is no configured limit — Baton never invents a fleet ceiling`);
  }
  const doctor = await fixture.deployment.doctor();
  for (const row of doctor.routes) {
    assert.equal(row.occupancy?.concurrencyCeiling, null,
      `${row.harness}: doctor occupancy reports the honest null (the old projection fabricated 1)`);
    assert.equal(Number.isSafeInteger(row.occupancy?.inFlight), true, 'the real in-flight count still rides the row');
  }
  const roster = await fixture.deployment.fleet.roster();
  assert.deepEqual(roster.routes.map((row) => row.occupancy.concurrencyCeiling), doctor.routes.map(() => null),
    'the roster agrees with the doctor — no drift, no substitute number');
});

test('DEP-2: only the deployment CALLER can configure a ceiling, and an invalid value refuses at open', async (t) => {
  await assert.rejects(
    openBuiltInDeployment({ adapterOptions: { concurrencyCeiling: 0 } }),
    (error) => /concurrencyCeiling/.test(error.message),
    'advanced.adapterOptions.concurrencyCeiling is validated like every other configuration value',
  );
  const fixture = await openBuiltInDeployment({ adapterOptions: { concurrencyCeiling: 3 } });
  t.after(() => fixture.close());
  const doctor = await fixture.deployment.doctor();
  const configured = doctor.routes.filter((row) => row.occupancy.concurrencyCeiling !== null);
  assert.ok(configured.length >= 1, 'at least one readiness route resolves a unique card to report from');
  for (const row of configured) {
    assert.equal(row.occupancy.concurrencyCeiling, 3, `${row.harness}: occupancy reports the caller's value, not a default`);
  }
  // A route with no unique card match has no configured value to report: it reads null rather
  // than borrowing a number from a neighbor or a fabricated 1.
  for (const row of doctor.routes.filter((entry) => entry.occupancy.concurrencyCeiling === null)) {
    assert.equal(fixture.driver.coordinator._adapters[row.harness] !== undefined
      || fixture.driver.coordinator._adapters[`${row.harness}:${row.provider ?? row.harness}`] !== undefined, true,
    `${row.harness}: null here means "no unique card match", not a missing adapter`);
  }
});

// ---------------------------------------------------------------------------
// ADM — dispatch admission
// ---------------------------------------------------------------------------

test('ADM-1: an absent limit throttles nothing — six workers on one vendor dispatch together', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, coordination } = setup({ adapters: { mock: adapter }, route: () => 'mock' });
  const handles = [];
  for (let index = 0; index < 6; index += 1) {
    handles.push(await coordinator.spawn('mock', makeBrief(), { taskId: `w${index}` }));
  }
  assert.deepEqual(handles.map((handle) => handle.status), Array(6).fill('working'),
    'with no configured ceiling every worker dispatches — no invented seat cap');
  assert.equal(adapter.calls.spawn.length, 6);
  assert.equal(deferredReceipts(coordination).length, 0, 'nothing defers when nothing is configured');
});

test('ADM-2: a route implementation cannot dispatch over a configured ceiling (auto path re-check)', async () => {
  const adapter = new ScriptableAdapter({ concurrencyCeiling: 1 });
  // A greedy router that ignores the in-flight counts it is handed — exactly the bypass this
  // re-check closes: selection is not admission.
  const { coordinator, coordination } = setup({ adapters: { mock: adapter }, route: () => 'mock' });
  const first = await coordinator.spawn('auto', makeBrief(), { taskId: 'auto-a', model: 'mock-model', effort: 'low' });
  assert.equal(first.status, 'working', 'the auto route resolves and dispatches the first task');
  const second = await coordinator.spawn('auto', makeBrief(), { taskId: 'auto-b', model: 'mock-model', effort: 'low' });
  assert.equal(second.status, 'pending',
    'the configured ceiling holds even though the router returned the saturated candidate');
  assert.equal(adapter.calls.spawn.length, 1, 'the saturated vendor is never invoked past its ceiling');
  const receipts = deferredReceipts(coordination);
  assert.equal(receipts.length, 1, 'the wait is ledgered');
  assert.equal(receipts[0].payload.vendor, 'mock');
  assert.equal(receipts[0].payload.ceiling, 1);
  assert.equal(receipts[0].payload.inFlight, 1);
});

test('ADM-3: an unrecorded deferral is fatal and typed — never reported as a durable wait', async () => {
  const adapter = new ScriptableAdapter({ concurrencyCeiling: 1 });
  const { coordinator } = setup({ adapters: { mock: adapter }, route: () => 'mock' });
  const first = await coordinator.spawn('mock', makeBrief(), { taskId: 'a' });
  assert.equal(first.status, 'working');
  coordinator._coordination.deferTaskDispatch = () => {
    throw Object.assign(new Error('coordination ledger unavailable'), { code: 'coordination_unavailable' });
  };
  await assert.rejects(
    coordinator.spawn('mock', makeBrief(), { taskId: 'b' }),
    (error) => error.code === 'dispatch_deferral_unrecorded' && /not recorded/.test(error.message),
    'the refusal propagates as a typed failure instead of leaving a silently pending task',
  );
  assert.ok(coordinator._fatalError, 'the coordinator records the authoritative-write failure');
  assert.throws(() => coordinator.tick(), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(coordinator._adapters.mock.calls.spawn.length, 1, 'the second task never reached the adapter');
});

test('ADM-4: a configured ceiling defers the exact route with a durable reason and admits it on release', async () => {
  const adapter = new ScriptableAdapter({ concurrencyCeiling: 1 });
  const { coordinator, coordination, worktrees } = setup({ adapters: { mock: adapter }, route: () => 'mock' });
  const first = await coordinator.spawn('mock', makeBrief(), { taskId: 'exact-a' });
  const second = await coordinator.spawn('mock', makeBrief(), { taskId: 'exact-b' });
  assert.equal(first.status, 'working');
  assert.equal(second.status, 'pending', 'the exact route waits for ITS vendor — it is never rerouted');
  assert.equal(worktrees.calls.create.length, 1, 'a deferred task holds no worktree');
  const receipt = deferredReceipts(coordination)[0];
  assert.ok(receipt, 'the deferral is durable');
  assert.equal(receipt.idempotencyKey, `task.dispatch_deferred:exact-b:${receipt.payload.taskCreatedSeq}`);
  coordinator.tick(); coordinator.tick();
  assert.equal(deferredReceipts(coordination).length, 1, 're-driven passes re-mint nothing');
  adapter.calls.released = true;
  // Release the slot by ending the first worker's turn through the coordinator's own lifecycle.
  coordinator._workers.get(first.id).status = 'idle';
  coordinator.tick();
  assert.equal(coordinator.list().find((worker) => worker.id === second.id).status, 'working',
    'the released slot admits the deferred task');
});
