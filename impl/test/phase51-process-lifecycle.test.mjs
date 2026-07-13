import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClaudeSessionCli, GlmSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { PiCli } from '../src/cli-adapters.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { WebNorthbound } from '../src/web-northbound.mjs';
import { McpFleetServer } from '../src/mcp-northbound.mjs';
import { reapOwnedProcessGroup } from '../src/process-lifecycle.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex-appserver.mjs', import.meta.url));
const FAKE_GROK = fileURLToPath(new URL('./fixtures/fake-grok-acp.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const groupAlive = (pid) => { try { process.kill(-pid, 0); return true; } catch { return false; } };
const brief = (goal = 'stay open') => ({ goal, constraints: [], pathScope: ['**'], definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } });

async function until(fn, label, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await sleep(5);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function collect(adapter) { const events = []; adapter.onEvent((event) => events.push(event)); return events; }
function adapterCases() {
  return [
    ['claude', () => new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], killGraceMs: 20 }), 'HOLD_UNTIL_INTERRUPT'],
    ['glm', () => new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], authToken: 'fixture-only', model: 'glm-4.7', killGraceMs: 20 }), 'HOLD_UNTIL_INTERRUPT'],
    ['codex', () => new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' }), 'FAKE:STAY_OPEN'],
    ['grok', () => new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' }), 'FAKE:STAY_OPEN'],
  ];
}
async function emergencyCleanup(adapter, worker) {
  try { await adapter.kill(worker); } catch {}
  const session = adapter._sessions?.get(worker); const pid = session?.child?.pid ?? session?.pid;
  if (pid && alive(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } }
  await sleep(20);
}

function assertClosedPair(events, generation, ready) {
  const started = events.filter((event) => event.kind === 'lifecycle.process_started');
  const closed = events.filter((event) => event.kind === 'lifecycle.process_closed');
  assert.equal(started.length, 1); assert.equal(closed.length, 1);
  assert.deepEqual(Object.keys(started[0].payload).sort(), ['generation', 'phase', 'pid', 'processGroupId', 'schemaVersion'].sort());
  assert.equal(started[0].payload.schemaVersion, 1); assert.equal(started[0].payload.generation, generation); assert.equal(started[0].payload.phase, 'initializing');
  assert.ok(Number.isSafeInteger(started[0].payload.pid) && started[0].payload.pid > 0); assert.equal(started[0].payload.processGroupId, started[0].payload.pid);
  assert.deepEqual(Object.keys(closed[0].payload).sort(), ['code', 'generation', 'pid', 'processGroupId', 'ready', 'schemaVersion', 'signal'].sort());
  assert.equal(closed[0].payload.generation, generation); assert.equal(closed[0].payload.pid, started[0].payload.pid); assert.equal(closed[0].payload.processGroupId, started[0].payload.processGroupId); assert.equal(closed[0].payload.ready, ready);
  const readyIndex = events.findIndex((event) => event.kind === 'lifecycle.spawned');
  if (readyIndex >= 0) assert.ok(events.indexOf(started[0]) < readyIndex);
  const closeDerived = events.findIndex((event) => ['kill.confirmed', 'lifecycle.exited', 'lifecycle.crashed'].includes(event.kind));
  if (closeDerived >= 0) assert.ok(events.indexOf(closed[0]) < closeDerived);
  assert.equal(alive(started[0].payload.pid), false); assert.equal(groupAlive(started[0].payload.pid), false);
}

test('PL1/PL2/PL7/PL9: every shipped session adapter separates process start, provider readiness, close, and confirmed kill', async (t) => {
  for (const [name, make, marker] of adapterCases()) {
    await t.test(name, async () => {
      const adapter = make(); const worker = `phase51-${name}-normal`; const events = collect(adapter);
      try {
        const ack = await adapter.spawn(worker, brief(marker), { worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-`)), processGeneration: 7 });
        assert.equal(ack.ok, true);
        await until(() => events.some((event) => event.kind === 'lifecycle.spawned'), `${name} provider readiness`);
        await adapter.kill(worker);
        await until(() => events.some((event) => event.kind === 'kill.confirmed'), `${name} confirmed kill`);
        assertClosedPair(events, 7, true);
        if (name === 'glm') assert.equal(JSON.stringify(events).includes('fixture-only'), false, 'GLM credential value never enters lifecycle evidence');
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL1/PL5: Codex initialize timeout and Grok authentication refusal retain exact pre-ready PID close evidence', async (t) => {
  const cases = [
    ['codex', new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], env: { FAKE_CODEX_HANG: '1' }, requestTimeoutMs: 120, versionProbe: () => 'fake' })],
    ['grok', new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], env: { FAKE_GROK_UNAUTH: '1' }, requestTimeoutMs: 500, versionProbe: () => 'fake' })],
  ];
  for (const [name, adapter] of cases) {
    await t.test(name, async () => {
      const worker = `phase51-${name}-setup-refusal`; const events = collect(adapter);
      try {
        const ack = await adapter.spawn(worker, brief(), { worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-refuse-`)), processGeneration: 9 });
        assert.equal(ack.ok, false);
        await until(() => events.some((event) => event.kind === 'lifecycle.process_closed'), `${name} setup process close`);
        assert.equal(events.some((event) => event.kind === 'lifecycle.spawned'), false);
        assertClosedPair(events, 9, false);
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL6: kill during Codex/Grok setup can confirm only after the real process group is gone', async (t) => {
  const cases = [
    ['codex', new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], env: { FAKE_CODEX_HANG: '1' }, requestTimeoutMs: 1200, versionProbe: () => 'fake' })],
    ['grok', new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], env: { FAKE_GROK_HANG: '1' }, requestTimeoutMs: 1200, versionProbe: () => 'fake' })],
  ];
  for (const [name, adapter] of cases) {
    await t.test(name, async () => {
      const worker = `phase51-${name}-kill-setup`; const events = collect(adapter);
      const spawning = adapter.spawn(worker, brief(), { worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-kill-`)), processGeneration: 11 });
      const nativePid = await until(() => adapter._sessions.get(worker)?.child?.pid, `${name} fixture child`);
      try {
        const killAck = await adapter.kill(worker); assert.equal(killAck.ok, true);
        await until(() => events.some((event) => event.kind === 'kill.confirmed'), `${name} setup kill confirmation`);
        assert.equal(alive(nativePid), false, 'kill.confirmed must not be synthetic while the child lives');
        assert.equal(groupAlive(nativePid), false);
        assert.equal((await spawning).ok, false);
        assertClosedPair(events, 11, false);
      } finally {
        if (alive(nativePid)) { try { process.kill(-nativePid, 'SIGKILL'); } catch {} }
        await spawning.catch(() => {}); await emergencyCleanup(adapter, worker);
      }
    });
  }
});

test('PL7: wall timeout records the exact close before the timeout crash for every session adapter', async (t) => {
  for (const [name, make, marker] of adapterCases()) {
    await t.test(name, async () => {
      const adapter = make(); const worker = `phase51-${name}-timeout`; const events = collect(adapter);
      try {
        const ack = await adapter.spawn(worker, brief(marker), {
          worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-timeout-`)),
          processGeneration: 17,
          timeoutMs: 750,
        });
        assert.equal(ack.ok, true);
        await until(() => events.some((event) => event.kind === 'lifecycle.crashed' && event.payload?.phase === 'timeout'), `${name} timeout crash`, 5000);
        assertClosedPair(events, 17, true);
        assert.equal(events.some((event) => event.kind === 'kill.confirmed'), false, 'policy timeout is not a user-requested confirmed kill');
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL7: an earlier positive-PID process error remains the terminal cause when user kill races it', async (t) => {
  for (const [name, make, marker] of adapterCases()) {
    await t.test(name, async () => {
      const adapter = make(); const worker = `phase51-${name}-process-error-race`; const events = collect(adapter);
      try {
        const ack = await adapter.spawn(worker, brief(marker), { worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-error-`)), processGeneration: 23 });
        assert.equal(ack.ok, true); await until(() => events.some((event) => event.kind === 'lifecycle.spawned'), `${name} ready before process error`);
        const session = adapter._sessions.get(worker); session.child.emit('error', new Error('fixture positive-pid process error'));
        await adapter.kill(worker);
        await until(() => events.some((event) => event.kind === 'kill.confirmed'), `${name} process error kill confirmation`);
        const crashes = events.filter((event) => event.kind === 'lifecycle.crashed');
        assert.equal(crashes.length, 1); assert.equal(crashes[0].payload.phase, 'process_error');
        assert.equal(events.find((event) => event.kind === 'kill.confirmed').payload.terminalCause, 'process_error');
        assertClosedPair(events, 23, true);
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL7: timeout remains first cause when an explicit kill races close', async (t) => {
  for (const [name, make, marker] of adapterCases()) {
    await t.test(name, async () => {
      const adapter = make(); const worker = `phase51-${name}-timeout-kill-race`; const events = collect(adapter);
      try {
        const ack = await adapter.spawn(worker, brief(marker), { worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-timeout-kill-`)), processGeneration: 29 });
        assert.equal(ack.ok, true); await until(() => events.some((event) => event.kind === 'lifecycle.spawned'), `${name} ready before timeout race`);
        const session = adapter._sessions.get(worker); adapter._onWallTimeout(session, 123); await adapter.kill(worker);
        await until(() => events.some((event) => event.kind === 'kill.confirmed'), `${name} timeout kill confirmation`);
        const terminals = events.filter((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind));
        assert.equal(terminals.length, 1); assert.equal(terminals[0].kind, 'lifecycle.crashed'); assert.equal(terminals[0].payload.phase, 'timeout');
        assert.equal(events.find((event) => event.kind === 'kill.confirmed').payload.terminalCause, 'timeout');
        assertClosedPair(events, 29, true);
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL7: Codex/Grok active-turn transport close emits one terminal after exact process close', async (t) => {
  const cases = [
    ['codex', new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' })],
    ['grok', new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' })],
  ];
  for (const [name, adapter] of cases) {
    await t.test(name, async () => {
      const worker = `phase51-${name}-stdin-close`; const events = collect(adapter);
      try {
        assert.equal((await adapter.spawn(worker, brief('FAKE:STAY_OPEN'), { worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-stdin-`)), processGeneration: 37 })).ok, true);
        await until(() => events.some((event) => event.kind === 'lifecycle.spawned'), `${name} active turn`);
        adapter._sessions.get(worker).child.stdin.end();
        await until(() => events.some((event) => event.kind === 'lifecycle.process_closed'), `${name} stdin close`);
        await sleep(20);
        const terminals = events.filter((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind));
        assert.equal(terminals.length, 1); assert.equal(terminals[0].kind, 'lifecycle.crashed');
        assertClosedPair(events, 37, true);
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL3/PL10: an invalid generation is rejected before any adapter creates a child', async (t) => {
  const cases = [
    ...adapterCases().map(([name, make]) => [name, make(), false]),
    ['one-shot', new PiCli({ cmd: process.execPath, args: () => ['-e', 'setInterval(() => {}, 1000)'], parse: () => ({}), live: true }), true],
  ];
  for (const [name, adapter, live] of cases) {
    await t.test(name, async () => {
      const worker = `phase51-${name}-bad-generation`; const events = collect(adapter);
      await assert.rejects(
        adapter.spawn(worker, brief(), { live, worktree: tmpdir(), processGeneration: 0 }),
        /processGeneration must be a positive safe integer/,
      );
      assert.equal(events.length, 0);
      assert.equal(adapter._sessions?.has(worker) ?? false, false);
      assert.equal(adapter._pendingSpawns?.has(worker) ?? false, false);
    });
  }
});

test('PL1: an OS spawn error without a PID never fabricates process start or close evidence', async (t) => {
  const missing = join(tmpdir(), `phase51-command-does-not-exist-${process.pid}`);
  const cases = [
    ['claude', new ClaudeSessionCli({ cmd: missing, args: [], killGraceMs: 20 }), false],
    ['codex', new CodexAppServerCli({ cmd: missing, args: [], requestTimeoutMs: 100, versionProbe: () => 'fake' }), false],
    ['grok', new GrokAcpCli({ cmd: missing, args: [], requestTimeoutMs: 100, versionProbe: () => 'fake' }), false],
    ['one-shot', new PiCli({ cmd: missing, args: () => [], parse: () => ({}), live: true }), true],
  ];
  for (const [name, adapter, live] of cases) {
    await t.test(name, async () => {
      const worker = `phase51-${name}-spawn-error`; const events = collect(adapter);
      try {
        await adapter.spawn(worker, brief(), { live, worktree: tmpdir(), processGeneration: 19 });
        await until(() => {
          const session = adapter._sessions?.get(worker);
          return session?.terminal === true || session?.closed === true || session?.deadEmitted === true;
        }, `${name} pidless spawn failure`);
        assert.equal(events.some((event) => event.kind === 'lifecycle.process_started'), false);
        assert.equal(events.some((event) => event.kind === 'lifecycle.process_closed'), false);
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL1/PL9: the live one-shot compatibility tier emits the same process pair without changing its verb card', async () => {
  const adapter = new PiCli({ cmd: process.execPath, args: () => ['-e', 'setInterval(() => {}, 1000)'], parse: () => ({}), live: true });
  const worker = 'phase51-one-shot'; const events = collect(adapter); const verbs = adapter.card().verbs;
  try {
    const ack = await adapter.spawn(worker, brief(), { live: true, worktree: tmpdir(), processGeneration: 13 }); assert.equal(ack.ok, true);
    await until(() => events.some((event) => event.kind === 'lifecycle.process_started'), 'one-shot process start');
    await adapter.kill(worker); await until(() => events.some((event) => event.kind === 'kill.confirmed'), 'one-shot kill confirmation');
    assertClosedPair(events, 13, false);
    assert.deepEqual(adapter.card().verbs, verbs);
  } finally { await emergencyCleanup(adapter, worker); }
});

test('PL7/PL9: one-shot turn completion does not surrender process-group authority over descendants', async () => {
  const code = "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.unref();console.log(JSON.stringify({done:true}));setInterval(()=>{},1000)";
  const adapter = new PiCli({
    cmd: process.execPath,
    args: () => ['-e', code],
    parse: (obj, worker, harness, turnEpoch) => obj.done === true ? { terminal: true, event: { worker, harness, turnEpoch, actor: 'worker', kind: 'lifecycle.turn_completed', payload: { status: 'completed' } } } : {},
    live: true,
  });
  const worker = 'phase51-one-shot-descendant'; const events = collect(adapter);
  try {
    assert.equal((await adapter.spawn(worker, brief(), { live: true, worktree: tmpdir(), processGeneration: 31 })).ok, true);
    await until(() => events.some((event) => event.kind === 'lifecycle.turn_completed'), 'one-shot parsed terminal');
    const session = adapter._sessions.get(worker); const pid = session.child.pid;
    assert.equal(session.turnSettled, true); assert.equal(session.terminal, false); assert.equal(groupAlive(pid), true);
    await adapter.kill(worker); await until(() => events.some((event) => event.kind === 'kill.confirmed'), 'one-shot descendant reap', 8000);
    assert.equal(groupAlive(pid), false); assertClosedPair(events, 31, false);
  } finally { await emergencyCleanup(adapter, worker); }
});

function stubAdapter(overrides = {}) {
  return {
    cb: null, spawnOpts: null,
    onEvent(cb) { this.cb = cb; },
    emit(kind, worker, payload = {}) { this.cb?.({ worker, harness: 'stub@1', turnEpoch: 1, actor: 'worker', kind, payload }); },
    card: () => ({ harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 1, maxContext: 1000, modelSelection: { mode: 'exact', configuredDefault: 'stub-model', available: ['stub-model'], family: 'stub', acceptedPrefixes: ['stub-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'fixture', refreshedAt: null }, verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' } }),
    async spawn(worker, _brief, opts) { this.spawnOpts = opts; queueMicrotask(() => this.emit('lifecycle.process_started', worker, { schemaVersion: 1, generation: opts.processGeneration, pid: 4242, processGroupId: 4242, phase: 'initializing' })); return { ok: true }; },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; }, async kill() { return { ok: true }; }, async approve() { return { ok: true }; }, async answer() { return { ok: true }; },
    ...overrides,
  };
}
function coordinatorFixture(adapter, log = new Log(mkdtempSync(join(tmpdir(), 'phase51-log-')))) {
  const coordination = coordinationForLog(log);
  const worktrees = { create: async () => ({ path: mkdtempSync(join(tmpdir(), 'phase51-wt-')) }), capture: async () => ({ sha: 'x' }), createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {} };
  const make = () => new Coordinator({ log, coordination, fences: new FenceTable(), adapters: { stub: adapter }, worktrees, referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub', approvalTimeoutMs: 100, stopDeadlineMs: 100 });
  return { coordinator: make(), make, log, coordination };
}

test('PL7/PL10: process-group reap is bounded and never fabricates exact close on non-convergence', async () => {
  let now = 0; let signals = 0; let probes = 0;
  const result = await reapOwnedProcessGroup(4242, {
    timeoutMs: 10, pollMs: 2, maxAttempts: 100,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    probe: () => { probes += 1; },
    signal: () => { signals += 1; },
  });
  assert.deepEqual(result, { confirmed: false, reason: 'deadline' });
  assert.equal(signals, 1); assert.ok(probes > 1 && probes < 20);

  const denied = await reapOwnedProcessGroup(4242, {
    probe: () => { const error = new Error('denied'); error.code = 'EPERM'; throw error; },
    signal: () => {},
  });
  assert.deepEqual(denied, { confirmed: false, reason: 'permission_denied' });
});

test('PL2/PL3: provider readiness requires the exact active initializing generation', async () => {
  let adapter;
  adapter = stubAdapter({
    async spawn(worker, _brief, opts) {
      this.spawnOpts = opts;
      queueMicrotask(() => this.emit('lifecycle.spawned', worker, { sessionId: 'too-early', pid: 4242, processGeneration: opts.processGeneration }));
      return { ok: true };
    },
  });
  const { coordinator, log } = coordinatorFixture(adapter);
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-ready-without-start', model: 'stub-model', effort: 'low' });
  await until(() => log.read(handle.id).some((event) => event.payload?.code === 'invalid_provider_ready'), 'provider-ready refusal');
  assert.equal(coordinator.list()[0].processRef, null);
  assert.equal(adapter.spawnOpts.processReapTimeoutMs, 80, 'reap deadline is derived from the coordinator stop deadline');
});

test('PL3/PL10: close readiness is exact and cannot fabricate false-to-true provider readiness', async () => {
  const adapter = stubAdapter(); const { coordinator, log } = coordinatorFixture(adapter);
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-ready-close-forgery', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'process start');
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  await until(() => log.read(handle.id).some((event) => event.payload?.code === 'invalid_process_close'), 'ready mismatch refusal');
  assert.equal(coordinator.list()[0].processRef.ready, false);
  assert.notEqual(coordinator.list()[0].processRef.state, 'closed');
});

test('PL7: confirmed kill waits for owned cleanup and writer release', async () => {
  let releaseCleanup; const cleanupGate = new Promise((resolve) => { releaseCleanup = resolve; });
  let adapter;
  adapter = stubAdapter({
    async kill(worker) {
      queueMicrotask(() => {
        this.emit('lifecycle.process_closed', worker, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: null, signal: 'SIGKILL', ready: false });
        this.emit('kill.confirmed', worker);
      });
      return { ok: true };
    },
  });
  const log = new Log(mkdtempSync(join(tmpdir(), 'phase51-cleanup-wait-log-'))); const coordination = coordinationForLog(log);
  const worktrees = { create: async () => ({ path: tmpdir() }), remove: async () => cleanupGate, reconcile: async () => {} };
  const coordinator = new Coordinator({ log, coordination, fences: new FenceTable(), adapters: { stub: adapter }, worktrees, referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub', stopDeadlineMs: 500 });
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-cleanup-wait', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'cleanup wait process');
  let settled = false; const killing = coordinator.kill(handle.id).then((result) => { settled = true; return result; });
  await until(() => coordinator._workers.get(handle.id)?.cleanupPending === true, 'owned cleanup pending');
  assert.equal(settled, false); assert.throws(() => coordinator.closeAuthority(), /kill\/reap before close/);
  releaseCleanup(); assert.equal((await killing).result, 'confirmed');
  assert.equal(coordinator.closeAuthority(), true);
});

test('PL7/PL10: cleanup failure is bounded, retains authority, and cannot report confirmed reap', async () => {
  let adapter;
  adapter = stubAdapter({
    async kill(worker) {
      queueMicrotask(() => {
        this.emit('lifecycle.process_closed', worker, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: null, signal: 'SIGKILL', ready: false });
        this.emit('kill.confirmed', worker);
      });
      return { ok: true };
    },
  });
  const log = new Log(mkdtempSync(join(tmpdir(), 'phase51-cleanup-fail-log-'))); const coordination = coordinationForLog(log);
  const worktrees = { create: async () => ({ path: tmpdir() }), remove: async () => { throw new Error('fixture remove failure'); }, reconcile: async () => {} };
  const coordinator = new Coordinator({ log, coordination, fences: new FenceTable(), adapters: { stub: adapter }, worktrees, referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub', stopDeadlineMs: 500 });
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-cleanup-fail', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'cleanup failure process');
  assert.equal((await coordinator.kill(handle.id)).result, 'cleanup_failed');
  assert.equal(coordinator._workers.get(handle.id).cleanupPending, true);
  assert.throws(() => coordinator.closeAuthority(), /kill\/reap before close/);
});

test('PL7: confirmed interrupt retains live process and writer authority until terminal kill', async () => {
  let adapter;
  adapter = stubAdapter({
    async interrupt(worker) { queueMicrotask(() => this.emit('control.interrupt_confirmed', worker)); return { ok: true }; },
    async kill(worker) {
      queueMicrotask(() => {
        this.emit('lifecycle.process_closed', worker, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: null, signal: 'SIGKILL', ready: false });
        this.emit('kill.confirmed', worker);
      });
      return { ok: true };
    },
  });
  const { coordinator } = coordinatorFixture(adapter); const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-interrupt-authority', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'interrupt process');
  assert.equal((await coordinator.interrupt(handle.id)).result, 'confirmed');
  assert.equal(coordinator.list()[0].processRef.state, 'initializing'); assert.equal(coordinator._workers.get(handle.id).localAuthority, true);
  assert.throws(() => coordinator.closeAuthority(), /kill\/reap before close/);
  assert.equal((await coordinator.kill(handle.id)).result, 'confirmed'); assert.equal(coordinator.closeAuthority(), true);
});

test('PL7: forced stop records uncertainty and cannot release writer before a late exact close', async () => {
  let killCalls = 0; let adapter;
  adapter = stubAdapter({
    async kill(worker) {
      killCalls += 1;
      if (killCalls <= 2) return { ok: true };
      queueMicrotask(() => {
        adapter.emit('lifecycle.process_closed', worker, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: false });
        adapter.emit('kill.confirmed', worker);
      });
      return { ok: true };
    },
  });
  const { coordinator } = coordinatorFixture(adapter);
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-forced-authority', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'forced process');
  assert.equal((await coordinator.kill(handle.id)).result, 'forced');
  assert.equal(coordinator.list()[0].processRef.state, 'unconfirmed_after_restart'); assert.equal(coordinator._workers.get(handle.id).localAuthority, true);
  assert.throws(() => coordinator.closeAuthority(), /kill\/reap before close/);
  assert.equal((await coordinator.kill(handle.id)).result, 'confirmed', 'a second kill retries the unconfirmed native reap');
  assert.equal(killCalls >= 3, true); await until(() => coordinator._workers.get(handle.id).localAuthority === false, 'late exact forced close');
  assert.equal(coordinator.closeAuthority(), true);
});

test('PL7/PL10: poisoned emergency kill retries a dead-but-unconfirmed process instead of releasing authority', async () => {
  let killCalls = 0; let adapter;
  adapter = stubAdapter({
    async kill(worker) {
      killCalls += 1;
      if (killCalls <= 2) return { ok: true };
      queueMicrotask(() => {
        adapter.emit('lifecycle.process_closed', worker, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: false });
        adapter.emit('kill.confirmed', worker);
      });
      return { ok: true };
    },
  });
  const { coordinator } = coordinatorFixture(adapter); const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-forced-emergency-retry', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'forced emergency process');
  assert.equal((await coordinator.kill(handle.id)).result, 'forced'); assert.equal(coordinator.list()[0].processRef.state, 'unconfirmed_after_restart');
  coordinator._fatalError = Object.assign(new Error('fixture poison'), { code: 'operational_log_unavailable' });
  assert.equal((await coordinator.kill(handle.id, 'policy', { emergency: true })).result, 'confirmed_unlogged');
  assert.equal(killCalls >= 3, true); assert.equal(coordinator._workers.get(handle.id).processRef.state, 'closed'); assert.equal(coordinator._workers.get(handle.id).localAuthority, false);
});

test('PL7/PL10: spawn-time log poison cannot exempt locally owned pending resources from drain', async () => {
  let releaseWorktree; const worktreeGate = new Promise((resolve) => { releaseWorktree = resolve; });
  const rawLog = new Log(mkdtempSync(join(tmpdir(), 'phase51-pending-poison-log-'))); const append = rawLog.append.bind(rawLog);
  rawLog.append = (event) => { if (event.kind === 'lifecycle.spawned' && event.actor === 'orchestrator') throw new Error('fixture log failure'); return append(event); };
  const adapter = stubAdapter({ async spawn() { return new Promise(() => {}); }, async kill() { return { ok: true, terminal: true }; } });
  const coordination = coordinationForLog(rawLog); let removed = 0;
  const coordinator = new Coordinator({
    log: rawLog, coordination, fences: new FenceTable(), adapters: { stub: adapter },
    worktrees: { create: async () => worktreeGate, remove: async () => { removed += 1; }, reconcile: async () => {} },
    runtimeScopes: { reconcile: () => {}, create: (worker) => ({ env: {}, replaceEnv: true, posture: { root: `/runtime/${worker}` } }), remove: () => {} },
    referee: async () => ({}), route: () => 'stub', stopDeadlineMs: 100,
  });
  await assert.rejects(coordinator.spawn('stub', brief(), { taskId: 'phase51-pending-poison', model: 'stub-model', effort: 'low' }), (error) => error.code === 'operational_log_unavailable');
  const owned = [...coordinator._workers.values()][0]; assert.equal(owned.status, 'pending'); assert.equal(owned.localAuthority, true); assert.equal(owned.runtimeScope.active, true);
  assert.throws(() => coordinator.closeAuthority(), /kill\/reap before close/);
  assert.equal((await coordinator.kill(owned.id, 'policy', { emergency: true })).result, 'confirmed_unlogged');
  releaseWorktree({ path: tmpdir() }); await until(() => removed > 0, 'pending poison cleanup');
});

test('PL7: verification and its deferred cleanup remain writer-authority operations', async () => {
  let releaseReferee; const refereeGate = new Promise((resolve) => { releaseReferee = resolve; }); const removals = [];
  const adapter = stubAdapter(); const log = new Log(mkdtempSync(join(tmpdir(), 'phase51-verify-close-log-'))); const coordination = coordinationForLog(log);
  const worktrees = {
    create: async () => ({ path: tmpdir() }), capture: async () => ({ sha: 'fixture-sha' }),
    createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
    remove: async (taskId) => { removals.push(taskId); }, reconcile: async () => {},
  };
  const coordinator = new Coordinator({ log, coordination, fences: new FenceTable(), adapters: { stub: adapter }, worktrees, referee: async () => refereeGate, route: () => 'stub', stopDeadlineMs: 500 });
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-verify-close', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'verification process');
  adapter.emit('lifecycle.spawned', handle.id, { sessionId: 'verify-native', pid: 4242, processGeneration: 1 });
  adapter.emit('lifecycle.turn_completed', handle.id, { status: 'completed', summary: 'ok', artifacts: { commits: ['fixture-sha'], files: [] }, verification: { command: 'true', claimedExit: 0 }, openQuestions: [], budgetUsed: { tokens: 1, usd: 0 } });
  await until(() => coordinator._tasks.get('phase51-verify-close')?.status === 'verifying', 'verification gate');
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  assert.throws(() => coordinator.closeAuthority(), /coordinator_not_drained|kill\/reap before close/);
  releaseReferee({ reverified: true, observedExit: 0 });
  await until(() => removals.length === 1, 'verification cleanup');
  assert.equal(coordinator.closeAuthority(), true);
});

test('PL7/PL10: runtime cleanup failure during verification is retained and retried before release', async () => {
  let releaseReferee; const refereeGate = new Promise((resolve) => { releaseReferee = resolve; }); let runtimeRemovals = 0;
  const adapter = stubAdapter(); const log = new Log(mkdtempSync(join(tmpdir(), 'phase51-verify-runtime-log-'))); const coordination = coordinationForLog(log);
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { stub: adapter },
    worktrees: { create: async () => ({ path: tmpdir() }), capture: async () => ({ sha: 'fixture-sha' }), createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {} },
    runtimeScopes: { reconcile: () => {}, create: (worker) => ({ env: {}, replaceEnv: true, posture: { root: `/runtime/${worker}` } }), remove: () => { runtimeRemovals += 1; if (runtimeRemovals < 2) throw new Error('fixture runtime removal failure'); } },
    referee: async () => refereeGate, route: () => 'stub', stopDeadlineMs: 500,
  });
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-verify-runtime', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'verification runtime process');
  adapter.emit('lifecycle.spawned', handle.id, { sessionId: 'verify-runtime-native', pid: 4242, processGeneration: 1 });
  adapter.emit('lifecycle.turn_completed', handle.id, { status: 'completed', summary: 'ok', artifacts: { commits: ['fixture-sha'], files: [] }, verification: { command: 'true', claimedExit: 0 }, openQuestions: [], budgetUsed: { tokens: 1, usd: 0 } });
  await until(() => coordinator._tasks.get('phase51-verify-runtime')?.status === 'verifying', 'runtime verification gate');
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  assert.equal(coordinator._workers.get(handle.id).localAuthority, true); assert.equal(coordinator._workers.get(handle.id).runtimeScope.active, true);
  assert.throws(() => coordinator.closeAuthority(), /kill\/reap before close/);
  releaseReferee({ reverified: true, observedExit: 0 });
  await until(() => coordinator._workers.get(handle.id).status === 'exited' && coordinator._workers.get(handle.id).localAuthority === false, 'verification runtime cleanup retry');
  assert.equal(runtimeRemovals, 2); assert.equal(coordinator._workers.get(handle.id).runtimeScope.active, false); assert.equal(coordinator.closeAuthority(), true);
});

test('PL3/PL10: poisoned-log emergency close still requires exact source and process correlation', async () => {
  const rawLog = new Log(mkdtempSync(join(tmpdir(), 'phase51-emergency-correlation-log-'))); const append = rawLog.append.bind(rawLog); let fail = false;
  rawLog.append = (event) => { if (fail) throw new Error('fixture disk full'); return append(event); };
  const coordination = coordinationForLog(rawLog); let killCalls = 0; let removed = 0;
  const adapter = stubAdapter({ async kill() { killCalls += 1; return { ok: true }; } });
  const coordinator = new Coordinator({
    log: rawLog, coordination, fences: new FenceTable(), adapters: { stub: adapter },
    worktrees: { create: async () => ({ path: tmpdir() }), remove: async () => { removed += 1; }, reconcile: async () => {} },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub', stopDeadlineMs: 100,
  });
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-emergency-correlation', model: 'stub-model', effort: 'low' });
  await until(() => coordinator._workers.get(handle.id)?.processRef, 'emergency source process');
  fail = true; adapter.emit('content.message', handle.id, { text: 'poison next append' });
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 999, pid: 9999, processGroupId: 9999, code: 0, signal: null, ready: false });
  await until(() => killCalls > 0, 'emergency kill after mismatched close');
  const owned = coordinator._workers.get(handle.id);
  assert.equal(owned.processRef.state, 'initializing'); assert.equal(owned.processRef.pid, 4242); assert.equal(owned.localAuthority, true); assert.equal(removed, 0);
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: false });
  await until(() => removed === 1 && owned.localAuthority === false, 'exact emergency cleanup');
  assert.equal(owned.processRef.state, 'closed'); assert.equal(owned.localAuthority, false);
});

test('PL3: adapter callback source identity cannot close another adapter worker', async () => {
  const owner = stubAdapter(); const attacker = stubAdapter(); const log = new Log(mkdtempSync(join(tmpdir(), 'phase51-cross-adapter-log-'))); const coordination = coordinationForLog(log);
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { owner, attacker },
    worktrees: { create: async () => ({ path: tmpdir() }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'owner', stopDeadlineMs: 500,
  });
  const handle = await coordinator.spawn('owner', brief(), { taskId: 'phase51-cross-adapter', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'cross-adapter source process');
  attacker.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: false });
  await until(() => log.read(handle.id).some((event) => event.payload?.code === 'cross_adapter_worker'), 'cross-adapter refusal');
  assert.equal(coordinator.list()[0].processRef.state, 'initializing');
  owner.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: false });
  owner.emit('kill.confirmed', handle.id); await until(() => coordinator.list()[0].status === 'dead', 'owner exact cleanup');
});

test('PL3/PL8: rejected recovery identity persists only sanitized readiness and cannot pivot replay sessionRef', async () => {
  const adapter = stubAdapter(); const { coordinator, log } = coordinatorFixture(adapter); coordinator._stopDeadlineMs = 500;
  const baseCard = adapter.card; adapter.card = () => ({ ...baseCard(), sessions: { multiTurn: 'native', resume: 'native', fork: 'native' } });
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-recovery-identity', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'recovery identity seed process');
  adapter.emit('lifecycle.spawned', handle.id, { sessionId: 'expected-native', pid: 4242, processGeneration: 1 });
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  const internal = coordinator._workers.get(handle.id); const task = coordinator._tasks.get(handle.taskId);
  internal.status = 'orphaned'; internal.localAuthority = false; internal.sessionContext = { worktree: tmpdir(), ownerTaskId: task.id }; task.sessionContext = internal.sessionContext;
  adapter.spawn = async (worker, _brief, opts) => {
    queueMicrotask(() => {
      adapter.emit('lifecycle.process_started', worker, { schemaVersion: 1, generation: opts.processGeneration, pid: 5252, processGroupId: 5252, phase: 'initializing' });
      adapter.emit('lifecycle.spawned', worker, { sessionId: 'wrong-native', pid: 5252, processGeneration: opts.processGeneration });
    });
    return { ok: true };
  };
  adapter.kill = async (worker) => { queueMicrotask(() => adapter.emit('lifecycle.process_closed', worker, { schemaVersion: 1, generation: 2, pid: 5252, processGroupId: 5252, code: 0, signal: null, ready: true })); return { ok: true }; };
  const recovered = await coordinator.recover(handle.id); assert.equal(recovered.result, 'session_identity_mismatch');
  await until(() => coordinator.list()[0].processRef.state === 'closed', 'mismatched recovery close');
  assert.equal(log.read(handle.id).some((event) => event.kind === 'lifecycle.process_ready'), true);
  assert.equal(log.read(handle.id).some((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker' && event.payload?.sessionId === 'wrong-native'), false);
  const replayAdapter = stubAdapter(); const replay = new Coordinator({ log, coordination: coordinator._coordination, fences: new FenceTable(), adapters: { stub: replayAdapter }, worktrees: coordinator._worktrees, referee: async () => ({}), route: () => 'stub', stopDeadlineMs: 500 });
  assert.equal(replay.list().find((row) => row.id === handle.id).sessionRef.id, 'expected-native');
});

test('PL7/PL8: recovery refuses a matching provider session that closes before admission commits', async () => {
  const adapter = stubAdapter(); const { coordinator, log } = coordinatorFixture(adapter); coordinator._stopDeadlineMs = 500;
  const baseCard = adapter.card; adapter.card = () => ({ ...baseCard(), sessions: { multiTurn: 'native', resume: 'native', fork: 'native' } });
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-recovery-fast-close', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'fast-close recovery seed');
  adapter.emit('lifecycle.spawned', handle.id, { sessionId: 'fast-close-native', pid: 4242, processGeneration: 1 });
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  const internal = coordinator._workers.get(handle.id); const task = coordinator._tasks.get(handle.taskId); const worktree = mkdtempSync(join(tmpdir(), 'phase51-fast-close-recovery-wt-'));
  internal.status = 'orphaned'; internal.localAuthority = false; internal.sessionContext = { worktree, ownerTaskId: task.id }; task.sessionContext = internal.sessionContext;
  adapter.spawn = async (worker, _brief, opts) => {
    queueMicrotask(() => {
      adapter.emit('lifecycle.process_started', worker, { schemaVersion: 1, generation: opts.processGeneration, pid: 6262, processGroupId: 6262, phase: 'initializing' });
      adapter.emit('lifecycle.spawned', worker, { sessionId: 'fast-close-native', pid: 6262, processGeneration: opts.processGeneration });
      adapter.emit('lifecycle.process_closed', worker, { schemaVersion: 1, generation: opts.processGeneration, pid: 6262, processGroupId: 6262, code: 0, signal: null, ready: true });
      adapter.emit('lifecycle.exited', worker, { code: 0, signal: null });
    });
    return { ok: true };
  };
  adapter.kill = async () => ({ ok: true, terminal: true });
  const recovered = await coordinator.recover(handle.id); assert.equal(recovered.result, 'recovery_transport_closed');
  await until(() => internal.localAuthority === false, 'fast-close recovery cleanup');
  const events = log.read(handle.id); assert.equal(events.some((event) => event.kind === 'control.recovery_attached'), false);
  assert.equal(events.some((event) => event.kind === 'lifecycle.spawned' && event.payload?.pid === 6262), false, 'buffered session identity does not commit');
  assert.equal(events.some((event) => event.kind === 'lifecycle.process_ready' && event.payload?.pid === 6262), true);
  assert.equal(events.some((event) => event.kind === 'lifecycle.process_closed' && event.payload?.pid === 6262), true);
  assert.equal(internal.status, 'dead'); assert.equal(internal.processRef.state, 'closed');
});

test('PL8: replay preserves historical readiness for an exact late close without claiming a live transport', async () => {
  const original = stubAdapter(); const { coordinator, log } = coordinatorFixture(original);
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-ready-replay-close', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'ready replay source');
  original.emit('lifecycle.spawned', handle.id, { sessionId: 'ready-replay-native', pid: 4242, processGeneration: 1 });
  const replayAdapter = stubAdapter(); const replay = new Coordinator({ log, coordination: coordinator._coordination, fences: new FenceTable(), adapters: { stub: replayAdapter }, worktrees: coordinator._worktrees, referee: async () => ({}), route: () => 'stub', stopDeadlineMs: 500 });
  const before = replay.list().find((row) => row.id === handle.id).processRef;
  assert.equal(before.state, 'unconfirmed_after_restart'); assert.equal(before.ready, true);
  replayAdapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  assert.equal(replay.list().find((row) => row.id === handle.id).processRef.state, 'closed');
});

test('PL3/PL4/PL8: coordinator exposes a closed processRef and replay never treats an unclosed historical PID as live', async () => {
  const adapter = stubAdapter(); const { coordinator, log } = coordinatorFixture(adapter);
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-process-ref', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'public processRef');
  const started = coordinator.list()[0].processRef;
  assert.deepEqual(started, { generation: 1, pid: 4242, processGroupId: 4242, state: 'initializing', ready: false, startedSeq: log.read(handle.id).find((event) => event.kind === 'lifecycle.process_started').seq, closedSeq: null });
  adapter.emit('lifecycle.spawned', handle.id, { sessionId: 'stub-native', pid: 4242, processGeneration: 1 });
  assert.equal(coordinator.list()[0].processRef.state, 'ready'); assert.equal(coordinator.list()[0].processRef.ready, true);
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  const closed = coordinator.list()[0].processRef; assert.equal(closed.state, 'closed'); assert.ok(Number.isSafeInteger(closed.closedSeq));

  const replayAdapter = stubAdapter(); const replayLog = new Log(mkdtempSync(join(tmpdir(), 'phase51-replay-log-'))); const replayFixture = coordinatorFixture(replayAdapter, replayLog);
  const replayHandle = await replayFixture.coordinator.spawn('stub', brief(), { taskId: 'phase51-unclosed-replay', model: 'stub-model', effort: 'low' });
  await until(() => replayFixture.coordinator.list()[0]?.processRef, 'replay source processRef');
  const replayer = replayFixture.make();
  const replayed = replayer.list().find((row) => row.id === replayHandle.id).processRef; assert.equal(replayed.state, 'unconfirmed_after_restart'); assert.equal(replayed.ready, false);
});

test('PL3/PL10: malformed or mismatched process close cannot replace current authority and triggers safe stop', async () => {
  let adapter;
  adapter = stubAdapter({ async kill(worker) { queueMicrotask(() => adapter.emit('kill.confirmed', worker)); return { ok: true }; } });
  const { coordinator, log } = coordinatorFixture(adapter); const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-invalid-close', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'invalid-close source processRef'); const before = coordinator.list()[0].processRef;
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 2, pid: 9999, processGroupId: 9999, code: 0, signal: null, ready: false });
  await until(() => coordinator.list()[0]?.status === 'dead', 'invalid-close safe stop');
  const after = coordinator.list()[0].processRef;
  assert.deepEqual({ ...after, state: before.state }, before, 'the invalid close cannot replace exact process identity');
  assert.equal(after.state, 'unconfirmed_after_restart', 'the later forced-stop deadline records uncertain disposition explicitly');
  assert.equal(log.read(handle.id).some((event) => event.kind === 'lifecycle.process_attribution_refused' && event.payload?.code === 'invalid_process_close'), true);
});

test('PL4: direct, authenticated web, and authenticated MCP list expose only the closed processRef projection', async () => {
  const adapter = stubAdapter(); const { coordinator, coordination } = coordinatorFixture(adapter); const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-northbound-process', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'northbound processRef');
  const expected = coordinator.list()[0].processRef; const origin = 'https://control.phase51.test';
  const principal = { userId: 'alice', sessionId: 'phase51-web', credentialId: 'cred-phase51', authMethod: 'cookie', csrfToken: 'csrf-phase51', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false, capabilities: ['observe', 'control'], repoIds: ['repo-a'] };
  const web = new WebNorthbound({ coordinator, coordination, repoIds: ['repo-a'], allowedOrigins: [origin] });
  const webResult = await web.execute({ principal, origin, csrfToken: 'csrf-phase51', transport: 'https' }, { schemaVersion: 1, commandId: 'phase51-list', idempotencyKey: 'phase51-list', command: 'list', args: {}, repoId: 'repo-a', origin });
  assert.equal(webResult.status, 200); assert.deepEqual(webResult.body.result.find((row) => row.id === handle.id).processRef, expected);
  const unauthenticated = await web.execute({ principal: null, origin, csrfToken: 'csrf-phase51', transport: 'https' }, { schemaVersion: 1, commandId: 'phase51-list-noauth', idempotencyKey: 'phase51-list-noauth', command: 'list', args: {}, repoId: 'repo-a', origin });
  assert.equal(unauthenticated.body.error.code, 'unauthenticated');
  const forbidden = await web.execute({ principal: { ...principal, capabilities: [] }, origin, csrfToken: 'csrf-phase51', transport: 'https' }, { schemaVersion: 1, commandId: 'phase51-list-forbidden', idempotencyKey: 'phase51-list-forbidden', command: 'list', args: {}, repoId: 'repo-a', origin });
  assert.equal(forbidden.body.error.code, 'forbidden');

  const mcp = new McpFleetServer({ coordinator, coordination, principal: { ...principal, sessionId: 'phase51-mcp' }, repoIds: ['repo-a'], maxWaitMs: 1000, maxMessageBytes: 64 * 1024, takeToolQuota: async () => ({ ok: true }) });
  await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase51', version: '1' } } }); await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpResult = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_list', arguments: { repoId: 'repo-a' } } });
  assert.equal(mcpResult.result.isError, false); assert.deepEqual(mcpResult.result.structuredContent.result.find((row) => row.id === handle.id).processRef, expected);
  const encoded = JSON.stringify([webResult.body.result, mcpResult.result.structuredContent]); for (const forbidden of ['executable', 'argv', 'environment', 'credential', 'prompt', 'stderr']) assert.equal(encoded.includes(forbidden), false);
});

test('PL5/PL7: coordinator keeps setup-failed Codex ownership until exact close then reaps', async () => {
  const adapter = new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], env: { FAKE_CODEX_HANG: '1' }, requestTimeoutMs: 120, versionProbe: () => 'fake' });
  const log = new Log(mkdtempSync(join(tmpdir(), 'phase51-coordinator-codex-log-'))); const removals = [];
  const worktrees = { create: async () => ({ path: mkdtempSync(join(tmpdir(), 'phase51-coordinator-codex-wt-')) }), capture: async () => ({ sha: 'x' }), createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {}, remove: async (taskId) => { removals.push({ taskId, lastSeq: log.read('w-1').at(-1)?.seq ?? 0 }); }, reconcile: async () => {} };
  const coordinator = new Coordinator({ log, coordination: coordinationForLog(log), fences: new FenceTable(), adapters: { codex: adapter }, worktrees, referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'codex', approvalTimeoutMs: 100, stopDeadlineMs: 1000 });
  const handle = await coordinator.spawn('codex', brief(), { taskId: 'phase51-coordinator-setup-fail' });
  await until(() => (coordinator.list()[0]?.processRef?.state === 'closed' && removals.length > 0), 'coordinator close before reap');
  const events = log.read(handle.id); const start = events.find((event) => event.kind === 'lifecycle.process_started'); const close = events.find((event) => event.kind === 'lifecycle.process_closed'); const confirmed = events.find((event) => event.kind === 'kill.confirmed');
  assert.ok(start && close && confirmed); assert.ok(start.seq < close.seq && close.seq < confirmed.seq); assert.ok(removals[0].lastSeq >= confirmed.seq);
  assert.equal((await coordinator.result(handle.id)).status, 'failed'); assert.equal(coordinator.list()[0].status, 'dead'); assert.equal(alive(start.payload.pid), false); assert.equal(groupAlive(start.payload.pid), false);
});

test('PL7/PL8: failed native recovery retains writer authority and runtime ownership until its new generation closes', async () => {
  const seed = stubAdapter(); const { coordinator } = coordinatorFixture(seed); coordinator._stopDeadlineMs = 1000;
  const worktree = mkdtempSync(join(tmpdir(), 'phase51-recovery-wt-'));
  const handle = await coordinator.spawn('stub', brief('FAKE:STAY_OPEN'), { taskId: 'phase51-recovery-reap', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'seed process start');
  seed.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: false });

  const internal = coordinator._workers.get(handle.id); const task = coordinator._tasks.get(handle.taskId);
  internal.status = 'orphaned'; internal.localAuthority = false;
  internal.sessionRef = { vendor: 'stub', kind: 'thread', id: 'phase51-native-recovery', persistence: 'native' };
  internal.sessionContext = { worktree, branch: 'phase51/recovery', ownerTaskId: task.id };
  task.sessionRef = internal.sessionRef; task.sessionContext = internal.sessionContext;

  const adapter = new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' });
  adapter.onEvent((event) => coordinator._handleEvent(event, 'stub')); coordinator._adapters.stub = adapter;
  let releaseKill; const killGate = new Promise((resolve) => { releaseKill = resolve; }); const nativeKill = adapter.kill.bind(adapter);
  adapter.kill = async (worker) => { await killGate; return nativeKill(worker); };
  const cleanup = []; coordinator._removeRuntimeScope = (owned) => cleanup.push({ state: owned.processRef?.state, pid: owned.processRef?.pid });
  coordinator._createCoordinationRecoveryRefinement = () => { throw new Error('scripted recovery refinement failure'); };

  let nativePid;
  try {
    const recovering = coordinator.recover(handle.id);
    await until(() => coordinator.list()[0].processRef?.generation === 2 && coordinator.list()[0].processRef?.state === 'ready', 'recovery process ready before failed refinement stop');
    nativePid = coordinator.list()[0].processRef.pid;
    assert.equal(coordinator.list()[0].processRef.generation, 2); assert.equal(coordinator.list()[0].processRef.state, 'ready');
    assert.equal(internal.localAuthority, true); assert.equal(cleanup.length, 0); assert.equal(alive(nativePid), true); assert.equal(groupAlive(nativePid), true);
    assert.throws(() => coordinator.closeAuthority(), (error) => error.code === 'coordinator_not_drained');
    releaseKill();
    await assert.rejects(recovering, /scripted recovery refinement failure/);
    await until(() => coordinator.list()[0].processRef.state === 'closed' && cleanup.length === 1, 'recovery process close before cleanup');
    assert.deepEqual(cleanup, [{ state: 'closed', pid: nativePid }]); assert.equal(internal.localAuthority, false);
    assert.equal(alive(nativePid), false); assert.equal(groupAlive(nativePid), false);
    const replayAdapter = stubAdapter();
    const replay = new Coordinator({ log: coordinator._log, coordination: coordinator._coordination, fences: new FenceTable(), adapters: { stub: replayAdapter }, worktrees: coordinator._worktrees, referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'stub', stopDeadlineMs: 1000 });
    const replayed = replay.list().find((row) => row.id === handle.id).processRef;
    assert.equal(replayed.generation, 2); assert.equal(replayed.state, 'closed'); assert.equal(replayed.ready, true);
    assert.equal(coordinator.closeAuthority(), true);
  } finally {
    releaseKill?.();
    if (nativePid && alive(nativePid)) { try { process.kill(-nativePid, 'SIGKILL'); } catch {} }
    await emergencyCleanup(adapter, handle.id);
  }
});
