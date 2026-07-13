import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { PiCli } from '../src/cli-adapters.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

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
  assert.ok(events.indexOf(started[0]) < events.findIndex((event) => event.kind === 'lifecycle.spawned'));
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
  return { coordinator: make(), make, log };
}

test('PL3/PL4/PL8: coordinator exposes a closed processRef and replay never treats an unclosed historical PID as live', async () => {
  const adapter = stubAdapter(); const { coordinator, make, log } = coordinatorFixture(adapter);
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-process-ref', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'public processRef');
  const started = coordinator.list()[0].processRef;
  assert.deepEqual(started, { generation: 1, pid: 4242, processGroupId: 4242, state: 'initializing', ready: false, startedSeq: log.read(handle.id).find((event) => event.kind === 'lifecycle.process_started').seq, closedSeq: null });
  const replayed = make().list()[0].processRef; assert.equal(replayed.state, 'unconfirmed_after_restart'); assert.equal(replayed.ready, false);
  adapter.emit('lifecycle.spawned', handle.id, { sessionId: 'stub-native', pid: 4242 });
  assert.equal(coordinator.list()[0].processRef.state, 'ready'); assert.equal(coordinator.list()[0].processRef.ready, true);
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  const closed = coordinator.list()[0].processRef; assert.equal(closed.state, 'closed'); assert.ok(Number.isSafeInteger(closed.closedSeq));
});
