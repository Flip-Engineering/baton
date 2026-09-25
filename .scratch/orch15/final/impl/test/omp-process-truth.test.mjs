// OMP process truth — the audit A-E1 / A-E10 / A-E11 rows (issue #281, lane `process-truth`).
//
// A-E1 (CONFIRMED, omp-rpc.mjs:169 pre-fix). The child was spawned with `{cwd, env, stdio}` and
// no `detached`, so it sat in BATON'S OWN process group; the `ProcessCloseReapLatch` built on
// `child.pid` then named a group that never existed (`kill(-pid, 0)` → ESRCH), the reap reported
// `{confirmed:true}` having verified nothing, and the adapter published `kill.confirmed` for a
// group it never had. Every sibling passes `detached: true` (claude-session.mjs:805,
// cli-adapters.mjs:307, acp-json-rpc-process.mjs:79) and the Claude session escalates
// SIGTERM→SIGKILL over `killGraceMs` (claude-session.mjs:1580-1586).
//
// A-E10 (CONFIRMED). `this.maxFrameBytes` was assigned at omp-rpc.mjs:143 and read NOWHERE:
// `_onStdout` accumulated the buffer with no size check while the card advertised
// `governance.maxWireFrameBytes`. Every sibling enforces its ceiling (cli-adapters.mjs:363-377,
// claude-session.mjs:1005-1014, codex-appserver.mjs:448-490, grok-acp.mjs:352-358,
// acp-json-rpc-process.mjs:203-207) — and the ceiling itself is the registry's declared wire lane
// (limits.mjs 'wire.frame'), never an adapter-local literal.
//
// A-E11 (CONFIRMED). `spawn()`'s respawn guard tested only `existing && !existing.closed`, so a
// generation whose close was NOT confirmed (its group still owned) could be replaced; and the
// pending-spawn release deleted the reservation unconditionally where every sibling guards with
// `if (this._pendingSpawns.get(worker) === pending)`.
//
// The real-process rows (process-group identity, escalation) spawn `node -e` fixtures and reap
// them; the fake-process rows never touch a real pid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { OmpRpcCli, OmpRpcProcess } from '../src/omp-rpc.mjs';
import { KILL_ESCALATION_GRACE_MS } from '../src/process-lifecycle.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const line = (frame) => `${JSON.stringify(frame)}\n`;
const MODEL = 'deepseek/deepseek-v4-flash';
const CATALOG = { [MODEL]: ['high'] };
const liveChildren = new Set();
test.after(() => {
  for (const child of liveChildren) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  }
});

/** A fake omp child: the omp-rpc-red shape (ready frame, JSONL stdin, exit facts). */
class FakeChild extends EventEmitter {
  constructor({ pid = 424242 } = {}) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.written = [];
    this.signals = [];
    this.stdin = {
      destroyed: false,
      write: (chunk) => { for (const raw of String(chunk).split('\n')) if (raw.trim()) this.written.push(JSON.parse(raw)); return true; },
      end: () => { this.stdin.destroyed = true; },
    };
    // The native startup shape (omp-policy-attest's fixture): the ready frame lands right after
    // the child exists, so `waitReady()` never waits on a fixture that cannot speak.
    setImmediate(() => this.frame({ type: 'ready', protocolVersion: 1 }));
  }
  frame(frame) { this.stdout.write(line(frame)); }
  kill(signal) { this.signals.push(signal ?? 'SIGTERM'); setImmediate(() => this.emit('exit', 0, signal ?? null)); return true; }
  exit(code = 0, signal = null) { setImmediate(() => this.emit('exit', code, signal)); }
}

function fakeProcess({ child, processOptions = {}, onStopConfirmed } = {}) {
  const rpc = new OmpRpcProcess({
    command: 'omp', args: ['--mode', 'rpc'], spawnFn: () => child,
    processGeneration: 1, onStopConfirmed, ...processOptions,
  });
  rpc.start();
  return rpc;
}

function adapterFixture({ spawnFn, options = {} }) {
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 1_000, model: MODEL, modelCatalog: CATALOG,
    versionProbe: () => 'omp test', spawnFn, ...options,
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  return { adapter, events };
}

// ---------------------------------------------------------------------------
// A-E1 — the child owns a REAL process group, and its kill escalates
// ---------------------------------------------------------------------------

test('A-E1: the omp child is spawned detached — the latch names a group that exists', () => {
  const child = new FakeChild();
  const spawnCalls = [];
  const { adapter } = adapterFixture({
    spawnFn: (command, args, options) => { spawnCalls.push({ command, args, options }); return child; },
  });
  void adapter.spawn('w-detach', { goal: 'g' }, { model: MODEL, reasoningEffort: 'high', worktree: '/tmp' });

  assert.equal(spawnCalls.length, 1, 'spawn() created exactly one child');
  assert.equal(spawnCalls[0].options.detached, true,
    'the child must own its process group — without it ProcessCloseReapLatch names a group that does not exist (A-E1)');
  assert.equal(spawnCalls[0].options.stdio[0], 'pipe');
  adapter.kill('w-detach');
});

test('A-E1: a real spawned child\'s process group id IS its pid (the latch\'s processGroupId)', async () => {
  const rpc = new OmpRpcProcess({
    command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000);'], processGeneration: 1,
  }).start();
  liveChildren.add(rpc.child);
  const pgid = execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(rpc.child.pid)], { encoding: 'utf8' }).trim();
  assert.equal(Number(pgid), rpc.child.pid,
    'the spawned child leads its own group, so kill(-pid) and the group probe address THIS process');
  assert.equal(rpc.processClose.pid, rpc.child.pid, 'the latch names the same coordinate the kernel shows');
  await rpc.kill();
  liveChildren.delete(rpc.child);
});

test('A-E1: kill() escalates SIGTERM to SIGKILL on the family grace derivation', async () => {
  // The SAME window the Claude session's kill derives — asserted, so a future OMP-local literal
  // cannot drift away from it.
  assert.equal(KILL_ESCALATION_GRACE_MS, new ClaudeSessionCli({
    cmd: process.execPath, args: [], versionProbe: () => 'claude test',
  })._cfg.killGraceMs, 'one derivation for the family, not an OMP-local number');

  const stops = [];
  // A child that ignores SIGTERM: only the escalation can end it. It announces the handler is
  // installed BEFORE the kill, so the fixture cannot be ended by the plain SIGTERM (node's own
  // startup would otherwise race the signal and report signal 'SIGTERM' — a vacuous pass).
  const rpc = new OmpRpcProcess({
    command: process.execPath,
    args: ['-e', 'process.on("SIGTERM", () => {}); console.log("armed"); setInterval(() => {}, 1000);'],
    killGraceMs: 60, processGeneration: 1,
    onStopConfirmed: (kind, payload) => stops.push({ kind, payload }),
  }).start();
  liveChildren.add(rpc.child);
  await once(rpc.child.stdout, 'data');

  let deadline = null;
  try {
    await Promise.race([
      rpc.kill({ kind: 'kill.confirmed', payload: { terminalCause: 'test' } }),
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('kill() never settled — no SIGKILL escalation')), 2_500);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }

  assert.equal(rpc.processClose.closeFact.signal, 'SIGKILL',
    'the unresponsive group was SIGKILLed inside the grace window');
  assert.equal(rpc.processClose.confirmed, true, 'the close is confirmed only on the real group reap');
  assert.deepEqual(stops.map((entry) => entry.kind), ['kill.confirmed'],
    'kill.confirmed is published after the group was observed gone');
  liveChildren.delete(rpc.child);
});

test('A-E1: kill.confirmed is withheld while the group reap is unconfirmed', async () => {
  const child = new FakeChild();
  let reap = { confirmed: false, reason: 'deadline' };
  const events = { stop: [], reapUnconfirmed: [] };
  const rpc = fakeProcess({
    child,
    processOptions: {
      reapOwnedProcessGroup: async () => reap,
      onProcessClosed: () => events.processClosed = true,
      onReapUnconfirmed: (payload) => events.reapUnconfirmed.push(payload),
    },
    onStopConfirmed: (kind) => events.stop.push(kind),
  });

  child.frame({ type: 'ready', protocolVersion: 1 });
  rpc.kill({ kind: 'kill.confirmed', payload: { usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null } } });
  child.exit(0, 'SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(rpc.processClose.confirmed, false, 'the latch refuses to confirm an unverified group');
  assert.deepEqual(events.stop, [], 'no kill.confirmed for a group nobody observed gone');
  assert.equal(events.reapUnconfirmed.length, 1, 'the refusal is a receipt (lifecycle.process_reap_unconfirmed)');
  assert.equal(events.reapUnconfirmed[0].reason, 'deadline');
  assert.equal(events.processClosed, undefined, 'and process_closed is held with it');

  // The bounded retry is the only path to confirmation — and it publishes exactly then.
  reap = { confirmed: true, reason: null };
  const settled = await rpc.processClose.retry();
  assert.equal(settled.confirmed, true);
  assert.deepEqual(events.stop, ['kill.confirmed'], 'the stop is confirmed only after the group probe said ESRCH');
  assert.equal(events.processClosed, true);
});

// ---------------------------------------------------------------------------
// A-E10 — the advertised wire ceiling is enforced, from the registry row
// ---------------------------------------------------------------------------

test('A-E10: the default wire ceiling is the registry row, not an adapter-local literal', () => {
  const { adapter } = adapterFixture({ spawnFn: () => new FakeChild() });
  assert.equal(adapter._maxWireFrameBytes, FRAME_LIMITS['wire.frame'].value,
    'the declared wire lane is the one source for the frame bound (Decision 8)');
  assert.equal(adapter.card().governance.maxWireFrameBytes, FRAME_LIMITS['wire.frame'].value,
    'the card advertises exactly the bound the adapter holds');
});

test('A-E10: _onStdout enforces the ceiling — the oversize frame is never buffered, parsed or delivered', async () => {
  const child = new FakeChild();
  const limit = 512;
  const { adapter, events } = adapterFixture({
    spawnFn: () => child,
    options: { maxWireFrameBytes: limit, maxEventPayloadBytes: 256 },
  });
  const spawnPromise = adapter.spawn('w-wire', { goal: 'g' }, { model: MODEL, reasoningEffort: 'high', worktree: '/tmp' });
  const session = adapter._sessions.get('w-wire');
  session.process._onStdout(line({ type: 'ready', protocolVersion: 1 }));
  assert.equal(adapter.card().governance.maxWireFrameBytes, limit, 'the card advertises the enforced bound');

  const oversized = JSON.stringify({ type: 'content.message', phase: 'update', text: 'x'.repeat(4_096) });
  assert.ok(Buffer.byteLength(oversized) > limit, 'the fixture frame really is over the ceiling');
  session.process._onStdout(`${oversized}\n`);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(session.process.wireFailure?.code, 'wire_frame_oversize', 'the breach is named, not swallowed');
  assert.equal(session.process.wireFailure.limitBytes, limit);
  assert.equal(session.process._buffer, '', 'the oversize line is never retained (no unbounded accumulation)');
  assert.equal(events.some((event) => JSON.stringify(event.payload ?? {}).includes('xxxxxxxxxx')),
    false, 'a frame over the declared ceiling is never parsed or delivered');
  assert.deepEqual(child.signals, ['SIGKILL'], 'the breached transport generation is killed');
  // The fake child's kill lands its exit fact immediately (the real one dies by the same signal).
  await spawnPromise.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  const crash = events.find((event) => event.kind === 'lifecycle.crashed');
  assert.ok(crash, 'the session publishes a cert for the wire death');
  assert.equal(crash.payload.code, 'wire_frame_oversize', 'the cert carries the typed code');
  assert.equal(crash.payload.phase, 'wire');
  assert.equal(crash.payload.limitBytes, limit, 'and the bound that was breached');
});

// ---------------------------------------------------------------------------
// A-E11 — the respawn guard and the pending-spawn reservation identity
// ---------------------------------------------------------------------------

test('A-E11: a second generation is refused while the prior close is unconfirmed', async () => {
  const children = [];
  const { adapter } = adapterFixture({
    spawnFn: () => { const child = new FakeChild(); children.push(child); return child; },
  });
  // A prior generation whose transport terminal landed but whose exact-close latch has not
  // confirmed the group gone: it still owns a process group.
  const prior = { worker: 'w-respawn', closed: true, process: { processClose: { confirmed: false } } };
  adapter._sessions.set('w-respawn', prior);

  const refused = await adapter.spawn('w-respawn', { goal: 'g' }, { model: MODEL, reasoningEffort: 'high', worktree: '/tmp' });
  assert.equal(refused.ok, false, 'an unreaped prior generation blocks the respawn (A-E11)');
  assert.match(refused.reason, /already has an active session/u);
  assert.equal(children.length, 0, 'no second child was created under an unconfirmed generation');

  prior.process.processClose.confirmed = true;
  const admitted = await adapter.spawn('w-respawn', { goal: 'g' }, { model: MODEL, reasoningEffort: 'high', worktree: '/tmp' });
  assert.equal(admitted.ok, true, 'once the close is confirmed the worker is spawnable again');
  assert.equal(children.length, 1);
  adapter.kill('w-respawn');
});

test('A-E11: a stale spawn releases only its OWN reservation', async () => {
  const { adapter } = adapterFixture({ spawnFn: () => new FakeChild() });
  let releaseWorktree = null;
  const worktreeReady = new Promise((resolve) => { releaseWorktree = resolve; });

  const first = adapter.spawn('w-race', { goal: 'g' }, { model: MODEL, reasoningEffort: 'high', worktreeReady });
  const own = adapter._pendingSpawns.get('w-race');
  assert.ok(own, 'the in-flight spawn holds a reservation');

  // The newer reservation a racing path would install for the same worker.
  const newer = { cancelled: false };
  adapter._pendingSpawns.set('w-race', newer);

  releaseWorktree({ path: '/tmp' });
  const outcome = await first;
  assert.equal(outcome.ok, true, 'the in-flight spawn still completes');
  assert.equal(adapter._pendingSpawns.get('w-race'), newer,
    'the stale spawn\'s cleanup must not cancel a newer reservation (the sibling identity guard)');
  adapter.kill('w-race');
});
