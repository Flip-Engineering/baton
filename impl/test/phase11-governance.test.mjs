import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { withGrokModelArgs } from '../src/grok-acp.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const brief = (budget = { tokens: 100, usd: 1, wallMin: 5 }) => ({
  goal: 'governed task', constraints: [], pathScope: ['src/**'], definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0 }, budget,
});

function adapter() {
  const calls = { kill: 0, interrupt: 0, spawn: [] };
  return {
    calls, cb: null, onEvent(cb) { this.cb = cb; },
    emit(worker, kind, payload = {}, turnEpoch = 1) { this.cb?.({ worker, harness: 'stub', actor: 'worker', kind, payload, turnEpoch }); },
    card: () => ({
      harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 2, maxContext: 1000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      modelSelection: { mode: 'exact', available: null, family: 'stub', acceptedPrefixes: ['stub-'], acceptedAliases: [], reasoningEffort: null, serviceTier: null },
      sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
    }),
    spawn: async (...args) => { calls.spawn.push(args); return { ok: true }; }, prompt: async () => ({ ok: true }),
    interrupt: async () => { calls.interrupt += 1; return { ok: true }; },
    kill: async () => { calls.kill += 1; return { ok: true }; },
    approve: async () => ({ ok: true }), answer: async () => ({ ok: true }),
  };
}

function system(ad, opts = {}) {
  const log = opts.log ?? new Log(mkdtempSync(join(tmpdir(), 'baton-gv-log-')));
  const c = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(), adapters: { stub: ad },
    worktrees: {
      create: async (taskId) => ({ path: opts.worktreePath ?? `/tmp/${taskId}` }), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub',
    stopDeadlineMs: 100, approvalTimeoutMs: 1000,
    budgetPolicy: opts.budgetPolicy,
    watchdog: opts.watchdog,
    setTimeout: opts.setTimeout,
    clearTimeout: opts.clearTimeout,
    runtimeScopes: opts.runtimeScopes,
  });
  return { c, log };
}

test('GV1/GV2: cumulative snapshots become monotonic deltas and thresholds fire once', async () => {
  const ad = adapter();
  const { c, log } = system(ad);
  const h = await c.spawn('stub', brief());
  ad.emit(h.id, 'resource.tokens', { source: 'codex', accounting: 'cumulative', tokens: 60, usd: 0.1 });
  ad.emit(h.id, 'resource.tokens', { source: 'codex', accounting: 'cumulative', tokens: 60, usd: 0.1 });
  ad.emit(h.id, 'resource.tokens', { source: 'codex', accounting: 'cumulative', tokens: 90, usd: 0.2 });
  assert.deepEqual(c.list()[0].budgetUsed, { tokens: 90, usd: 0.2 });
  const thresholds = log.read(h.id).filter((event) => event.kind === 'resource.budget_threshold');
  assert.deepEqual(thresholds.map((event) => event.payload.threshold), [0.5, 0.8]);
});

test('GV3: 100 percent budget invokes confirmed two-phase kill exactly once', async () => {
  const ad = adapter();
  const { c, log } = system(ad, { budgetPolicy: { terminalGraceMs: 5 } });
  const h = await c.spawn('stub', brief());
  ad.emit(h.id, 'resource.tokens', { source: 'delta', accounting: 'delta', tokens: 101, usd: 0 });
  assert.equal(c.list()[0].status, 'working', 'hard stop allows only the bounded terminal-frame grace');
  await sleep(10);
  assert.equal(c.list()[0].status, 'stopping');
  assert.equal(ad.calls.kill, 1);
  ad.emit(h.id, 'kill.confirmed');
  await sleep(0);
  assert.equal(c.list()[0].status, 'dead');
  assert.equal(log.read(h.id).filter((event) => event.kind === 'resource.budget_threshold' && event.payload.hardStop).length, 1);
});

test('GV3: a terminal claim adjacent to final over-budget usage cancels the pending kill', async () => {
  const ad = adapter();
  const { c, log } = system(ad, { budgetPolicy: { terminalGraceMs: 20 } });
  const h = await c.spawn('stub', brief());
  ad.emit(h.id, 'resource.tokens', { source: 'delta', accounting: 'delta', tokens: 101, usd: 0 });
  ad.emit(h.id, 'lifecycle.turn_completed', {
    status: 'completed', summary: 'finished before budget stop', artifacts: { files: [] },
    verification: { command: 'true', claimedExit: 0 },
  });
  await sleep(30);
  assert.equal(ad.calls.kill, 0);
  assert.equal((await c.result(h.id)).status, 'completed');
  assert.equal(log.read(h.id).filter((event) => event.kind === 'resource.budget_threshold' && event.payload.hardStop).length, 1);
});

test('GV2: replay restores canonical budget totals and fired thresholds', async () => {
  const ad = adapter();
  const { c, log } = system(ad);
  const h = await c.spawn('stub', brief());
  ad.emit(h.id, 'resource.tokens', { source: 'delta', accounting: 'delta', tokens: 60, usd: 0.2 });
  const replay = system(adapter(), { log }).c;
  assert.deepEqual(replay.list()[0].budgetUsed, { tokens: 60, usd: 0.2 });
  assert.equal(log.read(h.id).filter((event) => event.kind === 'resource.budget_threshold' && event.payload.threshold === 0.5).length, 1);
});

test('GV1/GV2: replay restores cumulative baselines so resumed snapshots do not double count', async () => {
  const ad = adapter();
  const { c, log } = system(ad);
  const h = await c.spawn('stub', brief());
  ad.emit(h.id, 'resource.tokens', { source: 'codex', accounting: 'cumulative', tokens: 60, usd: 0.1 });
  const replayAdapter = adapter();
  const replay = system(replayAdapter, { log }).c;
  replayAdapter.emit(h.id, 'resource.tokens', { source: 'codex', accounting: 'cumulative', tokens: 90, usd: 0.2 });
  assert.deepEqual(replay.list()[0].budgetUsed, { tokens: 90, usd: 0.2 });
});

test('GV4/GV5: three identical completed failing commands interrupt once', async () => {
  const ad = adapter();
  const { c, log } = system(ad, { watchdog: { loopThreshold: 3, stallMs: 0 } });
  const h = await c.spawn('stub', brief());
  for (let i = 0; i < 3; i += 1) ad.emit(h.id, 'content.tool_call', { command: 'npm test', exitCode: 1, status: 'completed' });
  assert.equal(ad.calls.interrupt, 1);
  assert.equal(log.read(h.id).filter((event) => event.kind === 'health.loop_suspected').length, 1);
});

test('GV4/GV5: an absolute edited path outside scope kills once', async () => {
  const ad = adapter();
  const { c, log } = system(ad, { watchdog: { stallMs: 0 } });
  const h = await c.spawn('stub', brief());
  ad.emit(h.id, 'content.file_edit', { path: '/tmp/outside/secret.txt' });
  assert.equal(ad.calls.kill, 1);
  assert.equal(log.read(h.id).filter((event) => event.kind === 'health.scope_violation').length, 1);
});

test('GV4/GV5: canonical filesystem aliases do not fabricate an out-of-scope kill', async () => {
  const worktree = mkdtempSync('/tmp/baton-gv-path-alias-');
  mkdirSync(join(worktree, 'src')); writeFileSync(join(worktree, 'src', 'ok.mjs'), 'export const ok = true;\n');
  const ad = adapter();
  const { c, log } = system(ad, { watchdog: { stallMs: 0 }, worktreePath: worktree });
  const h = await c.spawn('stub', brief());
  ad.emit(h.id, 'content.file_edit', { path: join(realpathSync(worktree), 'src', 'ok.mjs') });
  assert.equal(ad.calls.kill, 0);
  assert.equal(log.read(h.id).some((event) => event.kind === 'health.scope_violation'), false);
});

test('GV4/GV5: an empty path scope is unscoped and does not invent a violation', async () => {
  const ad = adapter();
  const { c, log } = system(ad, { watchdog: { stallMs: 0 } });
  const unscoped = brief();
  unscoped.pathScope = [];
  const h = await c.spawn('stub', unscoped);
  ad.emit(h.id, 'content.file_edit', { path: 'anywhere.txt' });
  assert.equal(ad.calls.kill, 0);
  assert.equal(log.read(h.id).some((event) => event.kind === 'health.scope_violation'), false);
});

test('GV4: a quiet working worker is interrupted by the injected watchdog deadline', async () => {
  const timers = [];
  const ad = adapter();
  const { c, log } = system(ad, {
    watchdog: { stallMs: 50, loopThreshold: 3 },
    setTimeout: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: () => {},
  });
  const h = await c.spawn('stub', brief());
  const stallTimer = timers.find((timer) => timer.ms === 50);
  assert.ok(stallTimer);
  stallTimer.fn();
  await sleep(0);
  assert.equal(ad.calls.interrupt, 1);
  assert.equal(log.read(h.id).filter((event) => event.kind === 'health.stall_suspected').length, 1);
});

test('GV6: coordinator passes a replacement environment, logs posture only, and reaps scope on kill', async () => {
  const secret = 'scoped-secret-must-never-be-logged';
  const removed = [];
  const runtimeScopes = {
    reconcile: () => {},
    create: (worker) => ({
      env: { PATH: '/bin', HOME: `/runtime/${worker}/home`, OPENAI_API_KEY: secret }, replaceEnv: true,
      posture: { root: `/runtime/${worker}`, family: 'codex', projectedEnvKeys: ['OPENAI_API_KEY'] },
    }),
    remove: (worker) => removed.push(worker),
  };
  const ad = adapter();
  const { c, log } = system(ad, { runtimeScopes, watchdog: { stallMs: 0 } });
  const h = await c.spawn('stub', brief());
  const spawnOpts = ad.calls.spawn[0][2];
  assert.equal(spawnOpts.replaceEnv, true);
  assert.equal(spawnOpts.env.OPENAI_API_KEY, secret);
  assert.equal(JSON.stringify(c.list()[0]).includes(secret), false);
  assert.equal(JSON.stringify(log.read(h.id)).includes(secret), false);
  const stopping = c.kill(h.id, 'policy');
  ad.emit(h.id, 'kill.confirmed');
  await stopping;
  assert.deepEqual(removed, [h.id]);
  assert.equal(c.list()[0].runtimeScope.active, false);
});

test('GV6: runtime scope creation failure becomes a durable failed task before adapter spawn', async () => {
  const removed = [];
  const ad = adapter();
  const { c, log } = system(ad, {
    runtimeScopes: {
      reconcile: () => {}, create: () => { throw new Error('private directory unavailable'); },
      remove: (worker) => removed.push(worker),
    },
    watchdog: { stallMs: 0 },
  });
  const h = await c.spawn('stub', brief());
  assert.equal((await c.result(h.id)).status, 'failed');
  assert.equal(ad.calls.spawn.length, 0);
  assert.deepEqual(removed, [h.id]);
  assert.ok(log.read(h.id).some((event) => event.kind === 'lifecycle.crashed' && event.payload?.phase === 'runtime_scope'));
});

test('GV7: Grok sandbox is top-level while exact model and effort remain agent flags', () => {
  assert.deepEqual(
    withGrokModelArgs(['agent', 'stdio'], { sandbox: 'workspace', model: 'grok-x', reasoningEffort: 'high' }),
    ['--sandbox', 'workspace', 'agent', '--model', 'grok-x', '--reasoning-effort', 'high', 'stdio'],
  );
});
