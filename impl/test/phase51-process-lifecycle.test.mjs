import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ClaudeSessionCli, GlmSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { KimiAcpCli } from '../src/kimi-acp.mjs';
import { PiCli } from '../src/cli-adapters.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { memberSource } from './seam-member-source.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { WebNorthbound } from '../src/web-northbound.mjs';
import { McpFleetServer } from '../src/mcp-northbound.mjs';
import {
  ProcessCloseReapLatch, processAuthorityPayload, processAuthorityState, processReapUnconfirmedPayload,
  reapOwnedProcessGroup, reapRecoveredProcessGroup, validProcessReapUnconfirmedPayload,
} from '../src/process-lifecycle.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex-appserver.mjs', import.meta.url));
const FAKE_GROK = fileURLToPath(new URL('./fixtures/fake-grok-acp.mjs', import.meta.url));
const FAKE_KIMI = fileURLToPath(new URL('./fixtures/fake-kimi-acp.mjs', import.meta.url));
const ONE_SHOT_REAP_TIMEOUT_MS = 5_000;
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

// The coordinator's stop machinery is deliberately timer-unref'd: the kernel never pins its
// host's event loop, and a real spawned child is the handle that normally keeps it alive
// (docs/24 G4 / C4). A stub fixture that settles nothing leaves no live handle at all, so a stop
// whose only settlement is the coordinator's own deadline would be abandoned the moment the loop
// drains. Hold the loop for exactly such an await; the coordinator's deadline still bounds it, and
// if it never settles the assertion fails at its named stage instead of cancelling the file.
async function withLiveLoop(fn) {
  const hold = setInterval(() => {}, 1_000);
  try { return await fn(); } finally { clearInterval(hold); }
}

/** Resolve on the event that ends the wait — never on a wall-clock budget. `until()` remains for
 *  state that is not an event. */
function collect(adapter) {
  const events = []; const waiters = new Set();
  adapter.onEvent((event) => {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(event)) continue;
      waiters.delete(waiter);
      waiter.resolve(event);
    }
  });
  events.waitFor = (predicate) => {
    const seen = events.find(predicate);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve) => { waiters.add({ predicate, resolve }); });
  };
  return events;
}

function adapterCases() {
  return [
    ['claude', () => new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], killGraceMs: 20 }), 'HOLD_UNTIL_INTERRUPT'],
    ['glm', () => new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], authToken: 'fixture-only', model: 'glm-5.2', killGraceMs: 20 }), 'HOLD_UNTIL_INTERRUPT'],
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

test('PL7/PL9: every native harness retains a natural-close terminal across an unconfirmed first reap', async (t) => {
  const cases = [
    ['one-shot', (reap) => new PiCli({
      cmd: process.execPath, args: () => ['-e', 'setInterval(() => {}, 1000)'], parse: () => ({}),
      live: true, reapOwnedProcessGroup: reap,
    }), { live: true }, false],
    ['claude', (reap) => new ClaudeSessionCli({
      cmd: process.execPath, args: [FAKE_CLAUDE], killGraceMs: 20, reapOwnedProcessGroup: reap,
    }), {}, true],
    ['codex', (reap) => new CodexAppServerCli({
      cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 1500,
      versionProbe: () => 'fake', reapOwnedProcessGroup: reap,
    }), {}, true],
    ['grok', (reap) => new GrokAcpCli({
      cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 1500,
      versionProbe: () => 'fake', reapOwnedProcessGroup: reap,
    }), {}, true],
    // The kimi fixture has no FAKE:STAY_OPEN brief form (the codex/grok fakes do): its prompt
    // replies end_turn immediately, so the spawn turn races this case's SIGKILL — a completed
    // turn then replaces the natural-close terminal and the row flakes. prompt-hang keeps the
    // fake's chunk-then-hold shape, exactly like the other harnesses' held turns.
    ['kimi', (reap) => new KimiAcpCli({
      cmd: process.execPath, args: [FAKE_KIMI, '--serve'], requestTimeoutMs: 1500,
      versionProbe: () => 'fake', reapOwnedProcessGroup: reap, env: { FAKE_KIMI_MODE: 'prompt-hang' },
    }), { model: 'kimi-code/k3', reasoningEffort: 'max' }, true],
  ];
  for (const [name, make, extraSpawn, ready] of cases) {
    await t.test(name, async () => {
      const attempts = [];
      const reap = async (processGroupId, options) => {
        attempts.push(processGroupId);
        if (attempts.length === 1) return Object.freeze({ confirmed: false, reason: 'deadline' });
        void options;
        return Object.freeze({ confirmed: true, reason: null });
      };
      const adapter = make(reap); const worker = `phase51-retry-${name}`; const events = collect(adapter);
      const worktree = mkdtempSync(join(tmpdir(), `phase51-retry-${name}-`));
      try {
        const ack = await adapter.spawn(worker, brief(name === 'claude' ? 'HOLD_UNTIL_INTERRUPT' : 'FAKE:STAY_OPEN'), {
          worktree, processGeneration: 37, processReapTimeoutMs: 500, ...extraSpawn,
        });
        assert.equal(ack.ok, true);
        await events.waitFor((event) => event.kind === 'lifecycle.process_started');
        if (ready) await events.waitFor((event) => event.kind === 'lifecycle.spawned');

        const session = adapter._sessions.get(worker);
        const pid = session?.child?.pid ?? session?.pid ?? session?.process?.child?.pid;
        assert.ok(Number.isSafeInteger(pid) && pid > 0);
        process.kill(-pid, 'SIGKILL');
        await events.waitFor((event) => event.kind === 'lifecycle.process_reap_unconfirmed');
        assert.equal(events.some((event) => event.kind === 'lifecycle.process_closed'), false,
          `${name} cannot publish close while descendant absence remains unconfirmed`);
        assert.equal(events.some((event) => event.kind === 'lifecycle.crashed'), false,
          `${name} must retain its natural-close terminal until descendant absence is proven`);
        assert.equal(events.some((event) => event.kind === 'kill.confirmed'), false);
        const latch = session?.processClose ?? session?.process?.processClose;
        assert.ok(latch?.pending, `${name} must retain exact cleanup ownership`);
        assert.equal(Object.isFrozen(latch.closeFact), true);
        assert.deepEqual({
          generation: latch.closeFact.generation,
          pid: latch.closeFact.pid,
          processGroupId: latch.closeFact.processGroupId,
          ready: latch.closeFact.ready,
        }, {
          generation: 37,
          pid: events.find((event) => event.kind === 'lifecycle.process_started').payload.pid,
          processGroupId: events.find((event) => event.kind === 'lifecycle.process_started').payload.processGroupId,
          ready,
        });

        assert.equal((await adapter.kill(worker)).ok, true);
        await events.waitFor((event) => event.kind === 'kill.confirmed');
        assertClosedPair(events, 37, ready);
        const order = events.map((event) => event.kind);
        assert.ok(order.indexOf('lifecycle.process_reap_unconfirmed') < order.indexOf('lifecycle.process_closed'));
        assert.ok(order.indexOf('lifecycle.process_closed') < order.indexOf('lifecycle.crashed'), order.join(' > '));
        assert.ok(order.indexOf('lifecycle.crashed') < order.indexOf('kill.confirmed'));
        assert.equal(events.filter((event) => event.kind === 'lifecycle.crashed').length, 1);
        assert.equal(events.filter((event) => event.kind === 'lifecycle.process_reap_unconfirmed').length, 1);
        assert.equal(events.filter((event) => event.kind === 'lifecycle.process_closed').length, 1);
        assert.equal(events.filter((event) => event.kind === 'kill.confirmed').length, 1);
        assert.equal(attempts.length, 2);
        assert.equal(attempts.every((pid) => pid === latch.closeFact.processGroupId), true);

        const third = await adapter.kill(worker);
        assert.equal(third.ok, true); assert.equal(third.terminal, true);
        assert.equal(attempts.length, 2, 'a terminal third kill cannot signal or probe again');
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL7: concurrent retry callers join one reap and kill supersedes interrupt before one final terminal', async () => {
  let attempts = 0;
  let confirmSecond;
  const events = [];
  const closeDerived = (fact) => events.push(['lifecycle.crashed', fact.generation]);
  const latch = new ProcessCloseReapLatch({
    generation: 41,
    pid: 4242,
    reap: async () => {
      attempts += 1;
      if (attempts === 1) return { confirmed: false, reason: 'deadline' };
      return new Promise((resolve) => { confirmSecond = resolve; });
    },
    onProcessClosed: (payload) => events.push(['lifecycle.process_closed', payload.generation]),
    onReapUnconfirmed: (payload) => events.push(['lifecycle.process_reap_unconfirmed', payload.generation]),
    onStopConfirmed: (kind) => events.push([kind, 41]),
  });

  assert.deepEqual(await latch.close(9, null, true, closeDerived), {
    confirmed: false, reason: 'deadline',
  });
  assert.deepEqual(events.map(([kind]) => kind), [
    'lifecycle.process_reap_unconfirmed',
  ]);

  const interrupted = latch.authorizeStop('control.interrupt_confirmed', { disposition: 'interrupt' });
  const secondKill = latch.authorizeStop('kill.confirmed', { disposition: 'kill' });
  const thirdKill = latch.authorizeStop('kill.confirmed', { disposition: 'kill' });
  assert.equal(interrupted, secondKill);
  assert.equal(secondKill, thirdKill);
  assert.equal(attempts, 2, 'concurrent second and third kill must join one physical reap');
  confirmSecond({ confirmed: true, reason: null });
  await Promise.all([interrupted, secondKill, thirdKill]);

  assert.deepEqual(events.map(([kind]) => kind), [
    'lifecycle.process_reap_unconfirmed',
    'lifecycle.process_closed',
    'lifecycle.crashed',
    'kill.confirmed',
  ]);
  assert.equal(events.filter(([kind]) => kind === 'control.interrupt_confirmed').length, 0);
  assert.equal(events.filter(([kind]) => kind === 'kill.confirmed').length, 1);
  assert.equal((await latch.retry()).confirmed, true);
  assert.equal(attempts, 2);
});

test('PL3/PL7: generation N confirmation cannot mutate a reused N+1 PID coordinate', async () => {
  const mutations = [];
  const closes = [];
  const first = new ProcessCloseReapLatch({
    generation: 51, pid: 5151, reap: async () => ({ confirmed: true, reason: null }),
    onProcessClosed: (payload) => closes.push(payload),
  });
  await first.close(0, null, true, (fact) => mutations.push(`terminal:${fact.generation}`));
  assert.equal(first.confirmed, true);

  const second = new ProcessCloseReapLatch({
    generation: 52, pid: 5151, reap: async () => ({ confirmed: true, reason: null }),
    onProcessClosed: (payload) => closes.push(payload),
  });
  await second.close(0, null, false, (fact) => mutations.push(`terminal:${fact.generation}`));
  await Promise.all([first.retry(), first.authorizeStop('kill.confirmed', {})]);

  assert.deepEqual(mutations, ['terminal:51', 'terminal:52']);
  assert.deepEqual(closes.map(({ generation, pid, processGroupId }) => ({ generation, pid, processGroupId })), [
    { generation: 51, pid: 5151, processGroupId: 5151 },
    { generation: 52, pid: 5151, processGroupId: 5151 },
  ]);
});

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

// #163 law (operator ruling): the wall-time fate clock is RETIRED across every adapter.
// The pin's close-ordering guarantee now rides an explicit operator kill instead of a
// self-firing timer: spawn with a timeoutMs (accepted, ignored for fate), prove the member
// is HELD ALIVE past the old window, then kill and assert the exact close ordering.
test('PL7: no wall-time fate clock exists — a timeoutMs-bearing member is held alive; explicit kill orders the exact close', async (t) => {
  for (const [name, make, marker] of adapterCases()) {
    await t.test(name, async () => {
      const adapter = make(); const worker = `phase51-${name}-timeout`; const events = collect(adapter);
      try {
        const ack = await adapter.spawn(worker, brief(marker), {
          worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-timeout-`)),
          processGeneration: 17,
          timeoutMs: 750, // accepted for back-compat; MUST be inert for fate
        });
        assert.equal(ack.ok, true);
        // Held alive WELL past the old 750ms window — elapsed time is not evidence:
        await sleep(2000);
        assert.equal(events.some((event) => event.kind === 'lifecycle.crashed' && event.payload?.phase === 'timeout'), false,
          'no timeout crash exists — the fate clock is retired');
        assert.equal(events.some((event) => event.kind === 'lifecycle.process_closed'), false,
          'the member is held open past the old timeout window');
        // The explicit operator kill IS evidence; the close ordering holds exactly as before:
        await adapter.kill(worker);
        await until(() => events.some((event) => event.kind === 'lifecycle.process_closed'), `${name} close after kill`, 5000);
        assertClosedPair(events, 17, true);
        assert.equal(events.some((event) => event.kind === 'kill.confirmed'), true, 'the explicit kill confirms');
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});

test('PL7/PL10: pre-close Kimi timeout retains runtime, worktree, and local authority through an unconfirmed reap', async () => {
  let attempts = 0;
  let confirmRetry;
  const adapter = new KimiAcpCli({
    cmd: process.execPath, args: [FAKE_KIMI, '--serve'], requestTimeoutMs: 1500,
    versionProbe: () => 'fake',
    reapOwnedProcessGroup: async () => {
      attempts += 1;
      if (attempts === 1) return Object.freeze({ confirmed: false, reason: 'deadline' });
      return new Promise((resolve) => { confirmRetry = resolve; });
    },
  });
  const root = mkdtempSync(join(tmpdir(), 'phase51-kimi-preclose-timeout-'));
  const worktree = join(root, 'worktree');
  mkdirSync(worktree);
  const log = new Log(join(root, 'log'));
  let runtimeRemovals = 0;
  let worktreeRemovals = 0;
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(),
    adapters: { kimi: adapter },
    runtimeScopes: {
      create: (worker) => ({ env: {}, replaceEnv: false, posture: { root: `/runtime/${worker}` } }),
      remove: () => { runtimeRemovals += 1; }, reconcile: () => {},
    },
    worktrees: {
      create: async () => ({ path: worktree }),
      capture: async () => ({ sha: 'x', snapshotted: false, changedPaths: [] }),
      remove: async () => { worktreeRemovals += 1; }, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'kimi',
    approvalTimeoutMs: 100, stopDeadlineMs: 500,
  });
  const handle = await coordinator.spawn('kimi', brief('FAKE:STAY_OPEN'), {
    taskId: 'phase51-kimi-preclose-timeout', model: 'kimi-code/k3', effort: 'max',
  });
  try {
    await until(() => log.read(handle.id).some((event) => event.kind === 'lifecycle.spawned' && event.actor === 'worker'), 'pre-close Kimi ready');
    const session = adapter._sessions.get(handle.id);
    const ownedHandle = coordinator._workers.get(handle.id);
    // #163: the wall-time fate clock is retired — the pin now drives the pre-close cause
    // directly through the classification the timer used to feed (timeoutFailure + kill),
    // preserving the reap-hold ordering this test defends. Model a transport already
    // classified untrusted; the no-op request boundary keeps the fixture cause authoritative
    // while the installed record owns runtime/worktree reap.
    session.timeoutFailure = { code: 'provider_timeout', error: 'fixture pre-close timeout', usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null } };
    adapter._emitCrash(session, session.timeoutFailure);
    session.killing = true;
    session.pendingInterrupt = null;
    session.steerPending = null;
    coordinator._scheduleUntrustedTransportReap(ownedHandle, {
      kill: async () => ({ ok: true }),
    }, { removeWorktree: true, reason: 'fixture_untrusted_transport' });
    assert.equal(ownedHandle.untrustedTransportReap?.reason, 'fixture_untrusted_transport');
    void session.process.kill({
      kind: 'kill.confirmed',
      payload: { terminalCause: 'timeout', usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null } },
    });

    await until(() => attempts === 2, 'held second reap after pre-close timeout');
    const owned = coordinator._workers.get(handle.id);
    assert.equal(owned.localAuthority, true);
    assert.equal(owned.runtimeScope.active, true);
    assert.equal(owned.ownedWorktreeAuthority, true);
    assert.equal(runtimeRemovals, 0);
    assert.equal(worktreeRemovals, 0);
    assert.equal(log.read(handle.id).some((event) => event.kind === 'lifecycle.process_reap_unconfirmed'), true);
    assert.equal(log.read(handle.id).some((event) => event.kind === 'lifecycle.process_closed'), false);
    assert.equal(log.read(handle.id).some((event) => event.kind === 'kill.confirmed'), false);

    confirmRetry({ confirmed: true, reason: null });
    await until(() => log.read(handle.id).some((event) => event.kind === 'kill.confirmed'), 'pre-close timeout final stop');
    await until(() => coordinator._workers.get(handle.id).localAuthority === false, 'pre-close timeout cleanup');
    assert.equal(runtimeRemovals, 1);
    assert.equal(worktreeRemovals, 1);
    const kinds = log.read(handle.id).map((event) => event.kind);
    assert.ok(kinds.indexOf('lifecycle.crashed') < kinds.indexOf('lifecycle.process_reap_unconfirmed'));
    assert.ok(kinds.indexOf('lifecycle.process_reap_unconfirmed') < kinds.indexOf('lifecycle.process_closed'));
    assert.ok(kinds.indexOf('lifecycle.process_closed') < kinds.indexOf('kill.confirmed'));
  } finally { await emergencyCleanup(adapter, handle.id); }
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

test('PL7: a pre-close transport cause remains first when an explicit kill races close', async (t) => {
  for (const [name, make, marker] of adapterCases()) {
    await t.test(name, async () => {
      const adapter = make(); const worker = `phase51-${name}-timeout-kill-race`; const events = collect(adapter);
      try {
        const ack = await adapter.spawn(worker, brief(marker), { worktree: mkdtempSync(join(tmpdir(), `phase51-${name}-timeout-kill-`)), processGeneration: 29 });
        assert.equal(ack.ok, true); await until(() => events.some((event) => event.kind === 'lifecycle.spawned'), `${name} ready before timeout race`);
        // #163: the wall-time fate clock is retired, so the pin drives the pre-close cause through
        // the classification the timer used to feed — exactly as the Kimi sibling above does.
        // `_onWallTimeout`/`wallTimer` no longer exist to be called: no clock may terminate a turn.
        const session = adapter._sessions.get(worker);
        session.timeoutFailure = { code: 'provider_timeout', error: 'fixture pre-close timeout', usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null } };
        await adapter.kill(worker);
        await until(() => events.some((event) => event.kind === 'kill.confirmed'), `${name} timeout kill confirmation`);
        const terminals = events.filter((event) => ['lifecycle.turn_completed', 'lifecycle.crashed'].includes(event.kind));
        assert.equal(terminals.length, 1); assert.equal(terminals[0].kind, 'lifecycle.crashed'); assert.equal(terminals[0].payload.error, 'fixture pre-close timeout');
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
  const code = "const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.unref();console.log(JSON.stringify({done:true,descendantPid:c.pid}));setInterval(()=>{},1000)";
  let descendantPid = null;
  const adapter = new PiCli({
    cmd: process.execPath,
    args: () => ['-e', code],
    parse: (obj, worker, harness, turnEpoch) => {
      if (obj.done !== true) return {};
      descendantPid = obj.descendantPid;
      return { terminal: true, event: { worker, harness, turnEpoch, actor: 'worker', kind: 'lifecycle.turn_completed', payload: { status: 'completed' } } };
    },
    live: true,
  });
  const worker = 'phase51-one-shot-descendant'; const events = collect(adapter);
  try {
    assert.equal((await adapter.spawn(worker, brief(), {
      live: true, worktree: tmpdir(), processGeneration: 31,
      processReapTimeoutMs: ONE_SHOT_REAP_TIMEOUT_MS,
    })).ok, true);
    await until(() => events.some((event) => event.kind === 'lifecycle.turn_completed'), 'one-shot parsed terminal');
    const session = adapter._sessions.get(worker); const pid = session.child.pid;
    assert.equal(session.turnSettled, true); assert.equal(session.terminal, false);
    assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
    assert.equal(alive(descendantPid), true); assert.equal(groupAlive(pid), true);
    await adapter.kill(worker);
    // The exact-close latch publishes either the confirmed stop or one named refusal; a refusal
    // inside the kernel's mid-exit window (macOS reports EPERM while a killed group drains)
    // retains ownership, and the lifecycle's own answer is one new bounded attempt per OBSERVED
    // refusal — exactly what the coordinator's kill path drives. The wait ends on the
    // confirmation event, never on a wall-clock budget.
    let refusals = 0;
    for (;;) {
      const outcome = await events.waitFor((event) => event.kind === 'kill.confirmed'
        || (event.kind === 'lifecycle.process_reap_unconfirmed'
          && events.filter((row) => row.kind === 'lifecycle.process_reap_unconfirmed').length > refusals));
      if (outcome.kind === 'kill.confirmed') break;
      refusals += 1;
      assert.equal((await adapter.kill(worker)).ok, true, 'a refused reap retains kill authority for the next bounded attempt');
    }
    assert.equal(alive(descendantPid), false); assert.equal(groupAlive(pid), false);
    assertClosedPair(events, 31, false);
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

test('PL7: each observed unconfirmed reap drives a bounded coordinator kill and converges without restart', async () => {
  let attempts = 0;
  const exactGroups = [];
  const adapter = new CodexAppServerCli({
    cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 1500,
    versionProbe: () => 'fake',
    reapOwnedProcessGroup: async (processGroupId, options) => {
      exactGroups.push(processGroupId);
      attempts += 1;
      if (attempts === 1) return Object.freeze({ confirmed: false, reason: 'deadline' });
      return reapOwnedProcessGroup(processGroupId, options);
    },
  });
  const log = new Log(mkdtempSync(join(tmpdir(), 'phase51-retry-coordinator-log-')));
  const coordination = coordinationForLog(log);
  const worktrees = {
    create: async () => ({ path: mkdtempSync(join(tmpdir(), 'phase51-retry-coordinator-wt-')) }),
    capture: async () => ({ sha: 'x' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { codex: adapter }, worktrees,
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'codex',
    approvalTimeoutMs: 100, stopDeadlineMs: 100,
  });
  const handle = await coordinator.spawn('codex', brief('FAKE:STAY_OPEN'), {
    taskId: 'phase51-current-generation-retry',
  });
  try {
    await until(() => coordinator.list()[0]?.processRef?.state === 'ready', 'coordinator retry process ready');
    const generation = coordinator.list()[0].processRef.generation;
    const pid = coordinator.list()[0].processRef.pid;

    // The first reap is refused after the fake Codex child is already gone, so the retry that
    // converges this stop rides an unref'd timer with no live handle behind it.
    const first = await withLiveLoop(() => coordinator.kill(handle.id));
    assert.equal(first.ok, true); assert.equal(first.result, 'confirmed');
    await until(() => coordinator.list()[0]?.processRef?.state === 'closed', 'coordinator retry exact close');
    const events = log.read(handle.id);
    const closed = events.filter((event) => event.kind === 'lifecycle.process_closed');
    const confirmed = events.filter((event) => event.kind === 'kill.confirmed');
    assert.equal(closed.length, 1); assert.equal(confirmed.length, 1);
    assert.equal(closed[0].payload.generation, generation);
    assert.equal(closed[0].payload.pid, pid); assert.equal(closed[0].payload.processGroupId, pid);
    assert.ok(closed[0].seq < confirmed[0].seq);
    assert.deepEqual(exactGroups, [pid, pid]);
    assert.equal(coordinator._workers.get(handle.id).localAuthority, false);
    assert.equal(alive(pid), false); assert.equal(groupAlive(pid), false);

    const second = await coordinator.kill(handle.id);
    assert.equal(second.ok, true); assert.equal(second.result, 'already_dead');
    assert.equal(attempts, 2);
  } finally { await emergencyCleanup(adapter, handle.id); }
});

test('PL7/PL10: explicit reap retries stop at the outer deadline and remain operator-retryable', async () => {
  let kills = 0;
  let confirm = false;
  const adapter = stubAdapter({
    async kill(worker) {
      kills += 1;
      const generation = this.spawnOpts.processGeneration;
      queueMicrotask(() => {
        if (confirm) {
          this.emit('lifecycle.process_closed', worker, {
            schemaVersion: 1, generation, pid: 4242, processGroupId: 4242,
            code: 9, signal: null, ready: false,
          });
          this.emit('kill.confirmed', worker, {});
          return;
        }
        this.emit('lifecycle.process_reap_unconfirmed', worker, {
          schemaVersion: 1, generation, pid: 4242, processGroupId: 4242, reason: 'deadline',
        });
      });
      return { ok: true };
    },
  });
  const log = new Log(mkdtempSync(join(tmpdir(), 'phase51-bounded-retry-log-')));
  const { coordinator } = coordinatorFixture(adapter, log);
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-bounded-retry' });
  const generation = adapter.spawnOpts.processGeneration;
  await until(() => coordinator.list()[0]?.processRef?.state === 'initializing', 'bounded retry process start');
  adapter.emit('lifecycle.process_reap_unconfirmed', handle.id, {
    schemaVersion: 1, generation, pid: 4242, processGroupId: 4242, reason: 'deadline',
  });

  await until(() => log.read(handle.id).some((event) => event.kind === 'control.forced_stop'), 'bounded retry outer deadline');
  assert.ok(kills >= 2, 'an observed refusal must drive another physical kill');
  assert.ok(kills < 100, `bounded retry count was unexpectedly high: ${kills}`);
  const atDeadline = kills;
  await sleep(30);
  assert.equal(kills, atDeadline, 'no automatic retry may escape the outer deadline');
  assert.equal(coordinator._workers.get(handle.id).localAuthority, true);
  assert.equal(coordinator.list()[0].processRef.state, 'unconfirmed_after_restart');

  confirm = true;
  const retried = await coordinator.kill(handle.id);
  assert.equal(retried.ok, true); assert.equal(retried.result, 'confirmed');
  assert.equal(coordinator.list()[0].processRef.state, 'closed');
  assert.equal(coordinator._workers.get(handle.id).localAuthority, false);
});

async function establishVerifiedRecoveryPrior(coordinator, adapter, handle) {
  adapter.emit('lifecycle.turn_completed', handle.id, {
    status: 'completed',
    summary: 'hub-verified recovery prior',
    artifacts: { commits: [], files: [] },
    verification: { command: 'true', claimedExit: 0 },
    openQuestions: [],
    budgetUsed: { tokens: 1, usd: 0 },
  });
  await until(async () => {
    const result = await coordinator.result(handle.id);
    return result.ready && result.status === 'completed';
  }, 'durable hub-verified recovery prior');
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
  assert.deepEqual(result, { confirmed: false, signaled: true, reason: 'deadline' },
    'a delivered SIGKILL that never converges is named deadline, not closure');
  assert.equal(signals, 1); assert.ok(probes > 1 && probes < 20);

  // EPERM on the PROBE: the SIGKILL itself was accepted, but the group cannot be observed, so
  // closure is never confirmed — the delivery is reported and the refusal is named.
  const denied = await reapOwnedProcessGroup(4242, {
    probe: () => { const error = new Error('denied'); error.code = 'EPERM'; throw error; },
    signal: () => {},
  });
  assert.deepEqual(denied, { confirmed: false, signaled: true, reason: 'permission_denied' });
});

// The delivery observation names itself (2026-09-14 audit, swarm-a/lead.md finding 2): before this,
// `reapRecoveredProcessGroup` stamped `signaled: true` on EVERY result — an already-absent group and
// an EPERM refusal both reached the coordinator as durable signal authority it never earned.
test('PL7/PL10: a reap reports a delivered signal only when one was really delivered', async () => {
  // The pre-probe found nothing to signal: no signal was attempted at all.
  let signals = 0;
  const absent = await reapOwnedProcessGroup(4242, {
    probe: () => { const error = new Error('gone'); error.code = 'ESRCH'; throw error; },
    signal: () => { signals += 1; },
  });
  assert.deepEqual(absent, { confirmed: true, signaled: false, reason: 'absent' });
  assert.equal(signals, 0, 'an absent group is never signaled');

  // The kernel answered ESRCH to the SIGKILL itself: attempted, never delivered.
  const raced = await reapOwnedProcessGroup(4242, {
    probe: () => {},
    signal: () => { const error = new Error('gone'); error.code = 'ESRCH'; throw error; },
  });
  assert.deepEqual(raced, { confirmed: true, signaled: false, reason: 'absent_on_signal' });

  // Any other kernel refusal leaves the delivery unproven even when the poll proves closure.
  let probes = 0;
  const refused = await reapOwnedProcessGroup(4242, {
    probe: () => {
      probes += 1;
      if (probes > 1) { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }
    },
    signal: () => { const error = new Error('interrupted'); error.code = 'EINTR'; throw error; },
    sleep: async () => {},
  });
  assert.deepEqual(refused, { confirmed: true, signaled: false, reason: 'signal_refused' });
  assert.equal(validProcessReapUnconfirmedPayload({
    schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, reason: 'signal_refused',
  }), true, 'the unproven-delivery reason is a member of the closed receipt vocabulary');
});

test('PL8/PL10: the recovered reap never mints a delivery it did not make', async () => {
  const processRef = { generation: 3, pid: 4242, processGroupId: 4242 };
  const execFileSync = () => '4242 4242 Sun Jul 19 13:53:51 2026\n';
  const authority = processAuthorityPayload(processRef, { execFileSync });
  assert.equal(processAuthorityState(processRef, authority, { execFileSync }), 'active');

  let signals = 0;
  const gone = await reapRecoveredProcessGroup(processRef, authority, {
    execFileSync,
    probe: () => { const error = new Error('gone'); error.code = 'ESRCH'; throw error; },
    signal: () => { signals += 1; },
  });
  assert.deepEqual(gone, { confirmed: true, signaled: false, reason: 'absent' });
  assert.equal(signals, 0);
  // The coordinator's durable signal-authority row is chosen by exactly this predicate
  // (`if (reaped.confirmed && reaped.signaled)`), so an unsignaled reap can never earn it.
  assert.equal(gone.confirmed && gone.signaled, false, 'absence is not signal authority');
});

test('PL10: a delivery is observed, never stamped, and the durable row rides the reap\'s own truth', () => {
  const lifecycleSource = readFileSync(fileURLToPath(new URL('../src/process-lifecycle.mjs', import.meta.url)), 'utf8');
  // Code only: the prose above the function is allowed to quote the fabrication it retired.
  const lifecycleCode = lifecycleSource.split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line)).join('\n');
  assert.equal(/signaled:\s*true/u.test(lifecycleCode), false,
    'no site may stamp `signaled: true` — the field is set by the delivery observation alone');
  // Issue #259 slice 12: the choosing member is `attemptRunStopTarget` (the lifted
  // stopRunTargets closure), now in runtime-effects.mjs — the pin follows the member wherever
  // the seam map places it.
  assert.ok(memberSource('attemptRunStopTarget').includes('reaped.confirmed && reaped.signaled'),
    'the durable recovery_process_reaped row is chosen by the reap\'s own delivery observation');
});

// G-30 (2026-09-14 audit): a reap that exhausts its polls is NOT a reap that reached its deadline —
// the two have different recoveries, so the reason must name the bound that actually ended the wait.
// The poll budget itself is derived from the deadline and the interval the caller polls on, never a
// bare ceiling: the same call names all three inputs, so the fourth is not a separate decision.
test('G-30: an attempt-exhausted reap names itself, and the poll budget derives from the deadline', async () => {
  let now = 0;
  let probes = 0;
  const exhausted = await reapOwnedProcessGroup(4242, {
    timeoutMs: 20, pollMs: 5,
    now: () => now, // a clock that never advances — the deadline is never the bound that fires
    sleep: async () => {},
    probe: () => { probes += 1; },
    signal: () => {},
  });
  assert.deepEqual(exhausted, { confirmed: false, signaled: true, reason: 'attempts_exhausted' });
  assert.equal(probes, Math.floor(20 / 5) + 2,
    'the poll budget is derived from the deadline and the poll interval (the entry probe is one more)');

  let tick = 0;
  const expired = await reapOwnedProcessGroup(4242, {
    now: () => tick,
    timeoutMs: 10, pollMs: 2,
    sleep: async (ms) => { tick += ms; },
    probe: () => {},
    signal: () => {},
  });
  assert.deepEqual(expired, { confirmed: false, signaled: true, reason: 'deadline' },
    'a reap whose clock runs out under the same interval still says deadline');
});

test('G-30: the closed reap-unconfirmed reason set carries attempt exhaustion', () => {
  const payload = processReapUnconfirmedPayload(3, 4242, 'attempts_exhausted');
  assert.equal(payload.reason, 'attempts_exhausted',
    'an exhausted reap is reported as exhausted, never laundered into probe_error');
  assert.equal(validProcessReapUnconfirmedPayload(payload), true, 'the reason is a member of the closed set');
});

test('PL8: recovered signaling requires the exact durable PID-start authority', async () => {
  const processRef = { generation: 7, pid: 4242, processGroupId: 4242 };
  const execFileSync = () => '4242 4242 Sun Jul 19 13:53:51 2026\n';
  const authority = processAuthorityPayload(processRef, { execFileSync });
  assert.deepEqual(authority, {
    schemaVersion: 1, generation: 7, pid: 4242, processGroupId: 4242,
    pidStart: 'Sun Jul 19 13:53:51 2026',
  });
  assert.equal(processAuthorityState(processRef, authority, { execFileSync }), 'active');

  let signals = 0;
  const mismatched = { ...authority, pidStart: 'Sun Jul 19 13:53:52 2026' };
  assert.deepEqual(await reapRecoveredProcessGroup(processRef, mismatched, {
    execFileSync, signal: () => { signals += 1; }, probe: () => {},
  }), { confirmed: false, signaled: false, reason: 'mismatch' });
  assert.equal(signals, 0, 'a reused or mismatched process coordinate is never signaled');

  let probes = 0;
  assert.deepEqual(await reapRecoveredProcessGroup(processRef, authority, {
    execFileSync,
    signal: (target, signal) => { signals += 1; assert.equal(target, -4242); assert.equal(signal, 'SIGKILL'); },
    probe: () => {
      probes += 1;
      if (probes > 1) { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }
    },
    sleep: async () => {},
  }), { confirmed: true, signaled: true, reason: null });
  assert.equal(signals, 1);
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
  assert.equal((await withLiveLoop(() => coordinator.kill(handle.id))).result, 'forced');
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
  assert.equal((await withLiveLoop(() => coordinator.kill(handle.id))).result, 'forced'); assert.equal(coordinator.list()[0].processRef.state, 'unconfirmed_after_restart');
  coordinator._fatalError = Object.assign(new Error('fixture poison'), { code: 'operational_log_unavailable' });
  assert.equal((await withLiveLoop(() => coordinator.kill(handle.id, 'policy', { emergency: true }))).result, 'confirmed_unlogged');
  assert.equal(killCalls >= 3, true); assert.equal(coordinator._workers.get(handle.id).processRef.state, 'closed'); assert.equal(coordinator._workers.get(handle.id).localAuthority, false);
});

test('PL7/PL10: a failed spawn record settles its handle so no later act is stranded', async () => {
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
  const owned = [...coordinator._workers.values()][0];
  assert.equal(owned.status, 'exited', 'the act that could not record its spawn settles its own handle');
  assert.equal(owned.localAuthority, false, 'and gives up the local authority a stop would need');
  assert.equal(owned.runtimeScope.active, true, 'the runtime scope this attempt created is the reap\'s to remove');
  // #562: the durable claim the failed spawn left behind is never re-dispatched into a stranded
  // refusal, so the NEXT act is attempted normally and fails on its own append, not on the claim.
  const second = await coordinator.spawn('stub', brief(), { taskId: 'phase51-second-spawn', model: 'stub-model', effort: 'low' })
    .then(() => null, (error) => error);
  assert.equal(second?.code, 'operational_log_unavailable',
    'the next spawn is attempted normally — never refused as already_assigned');
  releaseWorktree({ path: tmpdir() }); await until(() => removed > 0, 'failed-spawn cleanup');
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

test('PL3/PL10: an unlogged emergency close still requires exact source and process correlation', async () => {
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
  const owned = coordinator._workers.get(handle.id);
  // #562: the log refuses every row, so the ordinary stop fails its act and the explicit
  // emergency stop reaps unlogged — the reap the fatal branch used to provide through the poison.
  fail = true;
  await assert.rejects(coordinator.kill(handle.id), (error) => error.code === 'operational_log_unavailable');
  const emergency = coordinator.kill(handle.id, 'policy', { emergency: true });
  await until(() => killCalls > 0, 'emergency kill in flight');
  // The log works again, so the terminals the reap correlates on are observable.
  fail = false;
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 999, pid: 9999, processGroupId: 9999, code: 0, signal: null, ready: false });
  assert.equal(owned.processRef.state, 'initializing'); assert.equal(owned.processRef.pid, 4242); assert.equal(owned.localAuthority, true); assert.equal(removed, 0);
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: false });
  await until(() => removed === 1 && owned.localAuthority === false, 'exact emergency cleanup');
  assert.equal(owned.processRef.state, 'closed'); assert.equal(owned.localAuthority, false);
  assert.deepEqual(await emergency, { ok: true, result: 'confirmed_unlogged', auditUnavailable: true });
});

test('PL3: adapter callback source identity cannot close another adapter worker, and the refusal kills nothing', async () => {
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
  assert.equal(['dead', 'stopping'].includes(coordinator.list()[0].status), false,
    'issue #611: the cross-adapter refusal kills nothing, so the owner keeps its transport');
  owner.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: false });
  await until(() => coordinator.list()[0].processRef.state === 'closed', 'owner exact close');
});

test('PL3/PL8: rejected recovery identity persists only sanitized readiness and cannot pivot replay sessionRef', async () => {
  const adapter = stubAdapter(); const { coordinator, log } = coordinatorFixture(adapter); coordinator._stopDeadlineMs = 500;
  const baseCard = adapter.card; adapter.card = () => ({ ...baseCard(), sessions: { multiTurn: 'native', resume: 'native', fork: 'native' } });
  const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-recovery-identity', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'recovery identity seed process');
  adapter.emit('lifecycle.spawned', handle.id, { sessionId: 'expected-native', pid: 4242, processGeneration: 1 });
  await establishVerifiedRecoveryPrior(coordinator, adapter, handle);
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  await until(() => coordinator._workers.get(handle.id).localAuthority === false, 'verified identity seed cleanup');
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
  const recovered = await withLiveLoop(() => coordinator.recover(handle.id)); assert.equal(recovered.result, 'session_identity_mismatch');
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
  await establishVerifiedRecoveryPrior(coordinator, adapter, handle);
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  await until(() => coordinator._workers.get(handle.id).localAuthority === false, 'verified fast-close seed cleanup');
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

test('PL3/PL10: a malformed or mismatched process close cannot replace current authority, and the refusal kills nothing', async () => {
  const adapter = stubAdapter();
  const { coordinator, log } = coordinatorFixture(adapter); const handle = await coordinator.spawn('stub', brief(), { taskId: 'phase51-invalid-close', model: 'stub-model', effort: 'low' });
  await until(() => coordinator.list()[0]?.processRef, 'invalid-close source processRef'); const before = coordinator.list()[0].processRef;
  adapter.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 2, pid: 9999, processGroupId: 9999, code: 0, signal: null, ready: false });
  await until(() => log.read(handle.id).some((event) => event.kind === 'lifecycle.process_attribution_refused' && event.payload?.code === 'invalid_process_close'), 'invalid-close refusal');
  const after = coordinator.list()[0].processRef;
  assert.deepEqual(after, before, 'the invalid close cannot replace exact process identity');
  assert.equal(['dead', 'stopping'].includes(coordinator.list()[0].status), false,
    'issue #611: the refusal kills nothing, so the seat stays available for its orchestrator');
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
  seed.emit('lifecycle.spawned', handle.id, { sessionId: 'phase51-native-recovery', pid: 4242, processGeneration: 1 });
  await establishVerifiedRecoveryPrior(coordinator, seed, handle);
  seed.emit('lifecycle.process_closed', handle.id, { schemaVersion: 1, generation: 1, pid: 4242, processGroupId: 4242, code: 0, signal: null, ready: true });
  await until(() => coordinator._workers.get(handle.id).localAuthority === false, 'verified recovery seed cleanup');

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

// LIF-004 ("Elapsed time alone cannot terminalize work") / #163: terminality is not a tier lottery
// (2026-09-14 audit, swarm-b/lead.md finding 10). The wall-time fate clock was dead in three
// adapters — `_onWallTimeout` defined and never invoked, `wallTimer` cleared and never assigned —
// while the one-shot tier SIGKILLed its child on the clock. The vestiges are deleted and the
// one-shot tier's declared wall budget is notify-only evidence. Exercised per adapter: elapsed time
// alone never terminalizes a turn, and the explicit stop still does.
test('PL10/LIF-004: the wall-time fate clock is gone, and elapsed time never terminalizes a turn', async (t) => {
  // kimi-acp.mjs is deliberately absent from this list: it carries no fate-clock METHOD, and its one
  // leftover `session.wallTimer` clear (kimi-acp.mjs:610) sits outside this lane's write authority,
  // so it is reported rather than repaired. Its tier is still exercised behaviourally below.
  for (const file of ['claude-session.mjs', 'codex-appserver.mjs', 'grok-acp.mjs', 'cli-adapters.mjs']) {
    const source = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
    // Code only: the comments at each retired site are allowed to name what was deleted.
    const code = source.split('\n').filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line)).join('\n');
    assert.equal(/wallTimer|_onWallTimeout/u.test(code), false,
      `${file}: the fate clock vestiges are deleted, not merely unused`);
  }
  const cliSource = readFileSync(fileURLToPath(new URL('../src/cli-adapters.mjs', import.meta.url)), 'utf8');
  assert.ok(cliSource.includes("kind: 'resource.budget_threshold'") && cliSource.includes("action: 'notify'"),
    'the one-shot wall budget crossing is notify-only evidence, never a kill');

  const cases = [
    ['claude', () => new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], killGraceMs: 20 }), 'HOLD_UNTIL_INTERRUPT', {}],
    ['glm', () => new GlmSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], authToken: 'fixture-only', model: 'glm-5.2', killGraceMs: 20 }), 'HOLD_UNTIL_INTERRUPT', {}],
    ['codex', () => new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' }), 'FAKE:STAY_OPEN', {}],
    ['grok', () => new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' }), 'FAKE:STAY_OPEN', {}],
    ['kimi', () => new KimiAcpCli({ cmd: process.execPath, args: [FAKE_KIMI, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake', env: { FAKE_KIMI_MODE: 'prompt-hang' } }), 'FAKE:STAY_OPEN', { model: 'kimi-code/k3', reasoningEffort: 'max' }],
    ['one-shot', () => new PiCli({ cmd: process.execPath, args: () => ['-e', 'setInterval(() => {}, 1000)'], parse: () => ({}), live: true }), 'one-shot', { live: true }],
  ];
  const TERMINALS = ['lifecycle.crashed', 'lifecycle.turn_completed', 'lifecycle.exited'];
  for (const [name, make, marker, extraSpawn] of cases) {
    await t.test(name, async () => {
      const adapter = make(); const worker = `phase51-terminality-${name}`; const events = collect(adapter);
      const worktree = mkdtempSync(join(tmpdir(), `phase51-terminality-${name}-`));
      try {
        const ack = await adapter.spawn(worker, brief(marker), { worktree, processGeneration: 41, timeoutMs: 30, ...extraSpawn });
        assert.equal(ack.ok, true);
        if (name !== 'one-shot') await until(() => events.some((event) => event.kind === 'lifecycle.spawned'), `${name} ready`);
        const session = adapter._sessions.get(worker);
        if (name === 'one-shot') {
          // The declaration is evidence: one notify-only row, and the child keeps running.
          await until(() => events.some((event) => event.kind === 'resource.budget_threshold'), 'wall budget notification');
          const alarms = events.filter((event) => event.kind === 'resource.budget_threshold');
          assert.equal(alarms.length, 1, 'the crossing is reported once');
          assert.deepEqual({ dimension: alarms[0].payload.dimension, action: alarms[0].payload.action, hardStop: alarms[0].payload.hardStop },
            { dimension: 'wall', action: 'notify', hardStop: false });
          assert.equal(alarms[0].payload.limits.wallMs, 30);
          await sleep(60);
          assert.equal(events.filter((event) => event.kind === 'resource.budget_threshold').length, 1, 'and never repeats');
        } else {
          // No clock exists in these tiers at all: past the same budget, the turn is untouched.
          await sleep(200);
          assert.equal(events.some((event) => event.kind === 'resource.budget_threshold'), false,
            `${name}: no wall budget is declared to this tier, so none is reported`);
        }
        assert.equal(events.some((event) => TERMINALS.includes(event.kind)), false,
          `${name}: elapsed time alone never terminalizes the turn`);
        const child = session.child ?? session.process?.child;
        assert.equal(alive(child.pid), true, `${name}: the child is still running`);
        assert.equal(events.some((event) => event.kind === 'kill.confirmed'), false, `${name}: nothing was stopped`);
        // The explicit stop is the only terminality this tier has — and it still works.
        await adapter.kill(worker);
        await until(() => events.some((event) => event.kind === 'kill.confirmed'), `${name} kill confirmation`);
        assertClosedPair(events, 41, events.some((event) => event.kind === 'lifecycle.spawned'));
      } finally { await emergencyCleanup(adapter, worker); }
    });
  }
});
