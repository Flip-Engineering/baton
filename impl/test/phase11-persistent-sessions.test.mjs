// Phase 11.1 PS1-PS5 red tests: make already-native session depth usable through Coordinator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Coordinator, SessionSelectionError } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex-appserver.mjs', import.meta.url));
const FAKE_GROK = fileURLToPath(new URL('./fixtures/fake-grok-acp.mjs', import.meta.url));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function brief() {
  return {
    goal: 'persistent task', constraints: [], pathScope: ['**'], definitionOfDone: 'true remains true',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 5 },
  };
}

function card() {
  return {
    harness: 'session', version: '1', authPosture: 'none', concurrencyCeiling: 2, maxContext: 1000,
    verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
    modelSelection: { mode: 'exact', configuredDefault: null, available: null, family: 'test', acceptedPrefixes: ['test-'], acceptedAliases: [], reasoningEffort: ['low', 'high'], configuredEffort: 'low', serviceTier: null, provenance: 'test', refreshedAt: null },
    sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
  };
}

function adapter(over = {}) {
  const calls = { prompt: [], promptBrief: [], interrupt: [], kill: [] };
  return {
    calls, cb: null,
    onEvent(cb) { this.cb = cb; },
    card,
    emit(worker, kind, payload = {}, turnEpoch = 1, actor = 'worker') {
      this.cb?.({ worker, harness: 'session', turnEpoch, actor, kind, payload });
    },
    spawn: async () => ({ ok: true }),
    prompt: async (...args) => { calls.prompt.push(args); return over.prompt ? over.prompt(...args) : { ok: true }; },
    promptBrief: async function promptBrief(worker, taskBrief) {
      calls.promptBrief.push([worker, taskBrief]);
      return this.prompt(worker, taskBrief, 'turn');
    },
    interrupt: async (...args) => { calls.interrupt.push(args); return { ok: true }; },
    kill: async function kill(...args) {
      calls.kill.push(args);
      this.emit(args[0], 'kill.confirmed', {}, 1);
      return { ok: true };
    },
    approve: async () => ({ ok: true }), answer: async () => ({ ok: true }),
  };
}

function harness(ad, referee = async () => ({ reverified: true, observedExit: 0 }), worktreeOverrides = {}, coordinatorOverrides = {}) {
  const log = new Log(mkdtempSync(join(tmpdir(), 'baton-ps-log-')));
  const coordination = new CoordinationStore(mkdtempSync(join(tmpdir(), 'baton-ps-coordination-')), {
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  const verifyCalls = [];
  const c = new Coordinator({
    log, fences: new FenceTable(), adapters: { session: ad }, coordination,
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/${taskId}` }),
      capture: async () => ({ sha: 'x', snapshotted: false }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
      ...worktreeOverrides,
    },
    referee: async (...args) => { verifyCalls.push(args); return referee(...args); },
    route: () => 'session', approvalTimeoutMs: 1000, stopDeadlineMs: 100,
    ...coordinatorOverrides,
  });
  return { c, log, verifyCalls, coordination };
}

async function until(fn, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(5);
  }
  throw new Error('condition not met');
}

function completed(summary = 'done') {
  return { status: 'completed', summary, artifacts: { files: [] }, verification: { command: 'true', claimedExit: 0 } };
}

async function recoverableNativeSession({ taskId, nativeId }) {
  const wt = mkdtempSync(join(tmpdir(), `baton-ps-${taskId.slice(0, 32)}-wt-`));
  const original = adapter();
  const { c, log, coordination } = harness(original, undefined, {
    create: async () => ({ path: wt, branch: `baton/${taskId}`, baseSha: 'base-1' }),
  });
  const handle = await c.spawn('session', brief(), { taskId, model: 'test-recover', effort: 'high' });
  await until(() => c.list()[0].sessionContext);
  original.emit(handle.id, 'lifecycle.spawned', { sessionId: nativeId, pid: 111 }, 1);
  original.emit(handle.id, 'lifecycle.turn_completed', completed('before restart'), 1);
  await until(async () => (await c.result(handle.id)).ready);

  const resumed = adapter();
  resumed.kill = async (worker) => {
    resumed.calls.kill.push([worker]);
    resumed.emit(worker, 'kill.confirmed', {}, 1);
    return { ok: true };
  };
  const removedScopes = [];
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed }, repoRoot: null,
    worktrees: {
      create: async () => ({}), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
      validateSessionContext: async (context) => ({ ok: context.worktree === wt }),
    },
    runtimeScopes: {
      reconcile: () => {},
      create: (worker) => ({ env: {}, replaceEnv: true, posture: { root: `/runtime/${worker}` } }),
      remove: (worker) => removedScopes.push(worker),
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'session',
    approvalTimeoutMs: 1000, stopDeadlineMs: 100, recoveryTimeoutMs: 100,
  });
  assert.equal(replay.list()[0].status, 'orphaned');
  return { handle, nativeId, wt, resumed, replay, log, coordination, removedScopes };
}

function admitGovernedRecoveryTurn(coordinator) {
  coordinator._admitProviderTurn = (handle) => {
    handle.providerGovernance = {
      mode: 'observe', digest: 'test-recovery-route', terminalReserve: { tokens: 0, usd: 0 },
    };
    handle.providerTurn = {
      admissionSeq: 9001,
      phase: 'recovery',
      usage: { tokens: 0, usd: 0 },
      sealed: false,
      violation: null,
    };
    return { ok: true, route: handle.providerGovernance };
  };
}

test('PS1/PS4: a verified worker accepts a public follow-up turn and verifies it independently', async () => {
  const ad = adapter();
  const { c, log, verifyCalls, coordination } = harness(ad);
  const h = await c.spawn('session', brief(), { taskId: 'follow-up' });
  ad.emit(h.id, 'lifecycle.spawned', { sessionId: 'session-1', pid: 123 }, 1);
  ad.emit(h.id, 'lifecycle.turn_completed', completed('first'), 1);
  await until(async () => (await c.result(h.id)).ready);
  assert.equal(verifyCalls.length, 1);

  const ack = await c.send(h.id, 'second turn', 'turn');
  assert.equal(ack.ok, true);
  assert.equal(c.list()[0].status, 'working');
  assert.equal((await c.result(h.id)).ready, false);
  assert.deepEqual(ad.calls.prompt[0].slice(1), ['second turn', 'turn']);

  ad.emit(h.id, 'lifecycle.turn_started', { sessionId: 'session-1' }, 2);
  ad.emit(h.id, 'lifecycle.turn_completed', completed('second'), 2);
  await until(async () => (await c.result(h.id)).ready && verifyCalls.length === 2);
  assert.equal((await c.result(h.id)).status, 'completed');
  assert.equal(coordination.snapshot().tasks.length, 2);
  assert.deepEqual(coordination.snapshot().tasks.map((task) => task.status), ['completed', 'completed']);
  assert.equal(coordination.snapshot().tasks[1].refines, 'follow-up');

  const replay = new Coordinator({
    log, fences: new FenceTable(), adapters: { session: adapter() }, coordination,
    worktrees: { create: async () => ({}), capture: async () => ({}), createVerifyWorktree: async () => ({}), removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({}), route: () => 'session', approvalTimeoutMs: 1000, stopDeadlineMs: 100,
  });
  assert.equal(replay.list()[0].taskId, coordination.snapshot().tasks[1].id);
  assert.equal((await replay.result(h.id)).status, 'completed');
  assert.equal((await replay.result(h.id)).ready, true);
});

test('PS2: a refused follow-up restores the previous terminal result and logs no new turn', async () => {
  const ad = adapter({ prompt: async () => ({ ok: false, reason: 'busy' }) });
  const { c, log } = harness(ad);
  const h = await c.spawn('session', brief(), { taskId: 'follow-refused' });
  ad.emit(h.id, 'lifecycle.turn_completed', completed('first'), 1);
  await until(async () => (await c.result(h.id)).ready);
  const beforeStarts = log.read(h.id).filter((e) => e.kind === 'lifecycle.turn_started').length;
  const ack = await c.send(h.id, 'try again', 'turn');
  assert.equal(ack.ok, false);
  assert.equal(ad.calls.prompt.length, 1, 'refusal must come from an attempted native follow-up, not the old idle guard');
  assert.equal((await c.result(h.id)).status, 'completed');
  assert.equal(c.list()[0].status, 'idle');
  assert.equal(log.read(h.id).filter((e) => e.kind === 'lifecycle.turn_started').length, beforeStarts);
});

test('PS2: a follow-up exception is a refused Ack and preserves the prior result', async () => {
  const ad = adapter({ prompt: async () => { throw new Error('wire write failed'); } });
  const { c } = harness(ad);
  const h = await c.spawn('session', brief(), { taskId: 'follow-throws' });
  ad.emit(h.id, 'lifecycle.turn_completed', completed('first'), 1);
  await until(async () => (await c.result(h.id)).ready);
  const ack = await c.send(h.id, 'try again', 'turn');
  assert.deepEqual(ack, { ok: false, result: 'delivery_exception', reason: 'wire write failed' });
  assert.equal((await c.result(h.id)).status, 'completed');
  assert.equal(c.list()[0].status, 'idle');
});

test('CK8/CK9: follow-up refinement failure kills native state and replays an explicit aborted attempt', async () => {
  const ad = adapter();
  const removedScopes = [];
  const { c, coordination, log } = harness(ad, undefined, {}, { runtimeScopes: {
    reconcile: () => {},
    create: (worker) => ({ env: {}, replaceEnv: true, posture: { root: `/runtime/${worker}` } }),
    remove: (worker) => removedScopes.push(worker),
  } });
  const h = await c.spawn('session', brief(), { taskId: 'follow-refinement-failure' });
  ad.emit(h.id, 'lifecycle.turn_completed', completed('first'), 1);
  await until(async () => (await c.result(h.id)).ready);
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"task.created"') && body.includes('refinement-')) throw new Error('follow-up refinement disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(c.send(h.id, 'advance native state', 'turn'), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(ad.calls.prompt.length, 1);
  assert.equal(ad.calls.kill.length, 1);
  assert.equal(c._workers.get(h.id).status, 'orphaned');
  assert.deepEqual(removedScopes, [h.id]);
  assert.equal(coordination.snapshot().tasks.length, 1);
  assert.equal(coordination.snapshot().tasks[0].status, 'completed');
  assert.equal(coordination.events().some((event) => event.kind === 'driver.recorded' && event.payload.kind === 'follow_up.requested'), true);
  assert.equal(log.read(h.id).some((event) => event.kind === 'control.refinement_aborted' && event.payload.relation === 'follow_up'), true);

  coordination._appendFile = rawAppend;
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: adapter() },
    worktrees: { remove: async () => {}, reconcile: async () => {} }, referee: async () => ({}),
    route: () => 'session', approvalTimeoutMs: 1000, stopDeadlineMs: 100,
  });
  assert.equal(replay.list()[0].status, 'orphaned');
  assert.equal((await replay.result(h.id)).status, 'completed', 'the accepted prior turn remains distinct from the aborted refinement');
});

test('PS2: emitted turn facts followed by refusal are a protocol violation and kill the ambiguous session', async () => {
  let ad;
  ad = adapter({
    prompt: async (worker) => {
      ad.emit(worker, 'lifecycle.turn_started', {}, 2);
      return { ok: false, reason: 'contradictory refusal' };
    },
  });
  const { c, log } = harness(ad);
  const h = await c.spawn('session', brief(), { taskId: 'follow-contradiction' });
  ad.emit(h.id, 'lifecycle.turn_completed', completed('first'), 1);
  await until(async () => (await c.result(h.id)).ready);
  const ack = await c.send(h.id, 'try again', 'turn');
  assert.equal(ack.ok, false);
  assert.ok(log.read(h.id).some((event) => event.kind === 'control.protocol_violation'));
  assert.equal((await c.result(h.id)).status, 'completed');
  assert.equal(c.list()[0].status, 'dead');
});

test('PS3: interrupt-with-follow-up reopens coordinator state before the adapter follow-up terminal', async () => {
  const ad = adapter();
  const { c, verifyCalls } = harness(ad);
  const h = await c.spawn('session', brief(), { taskId: 'interrupt-follow' });
  const stopping = c.interrupt(h.id, 'continue after interrupt', 'human');
  ad.emit(h.id, 'control.interrupt_confirmed', {}, 1, 'worker');
  await stopping;
  assert.equal(c.list()[0].status, 'working');
  assert.equal((await c.result(h.id)).ready, false);
  ad.emit(h.id, 'lifecycle.turn_started', {}, 2);
  ad.emit(h.id, 'lifecycle.turn_completed', completed('followed'), 2);
  await until(async () => (await c.result(h.id)).ready);
  assert.equal(verifyCalls.length, 1);
  assert.equal((await c.result(h.id)).status, 'completed');
});

test('PS4: a late terminal from the prior wire epoch cannot overwrite the active follow-up', async () => {
  const ad = adapter();
  const { c, log, verifyCalls } = harness(ad);
  const h = await c.spawn('session', brief(), { taskId: 'stale-terminal' });
  ad.emit(h.id, 'lifecycle.turn_completed', completed('first'), 1);
  await until(async () => (await c.result(h.id)).ready);
  await c.send(h.id, 'next', 'turn');
  ad.emit(h.id, 'lifecycle.turn_started', {}, 2);
  ad.emit(h.id, 'lifecycle.turn_completed', completed('late first'), 1);
  await sleep(20);
  assert.equal(verifyCalls.length, 1);
  assert.equal((await c.result(h.id)).ready, false);
  assert.ok(log.read(h.id).some((e) => e.kind === 'control.stale_rejected' && e.payload?.op === 'terminal'));
});

test('PS5: wire sessionRef reaches handle/result and survives terminal replay', async () => {
  const ad = adapter();
  const { c, log, coordination } = harness(ad);
  const h = await c.spawn('session', brief(), { taskId: 'session-ref' });
  ad.emit(h.id, 'lifecycle.spawned', { sessionId: 'native-session-7', pid: 123 }, 1);
  ad.emit(h.id, 'lifecycle.turn_completed', completed(), 1);
  await until(async () => (await c.result(h.id)).ready);
  const expected = { vendor: 'session', kind: 'session', id: 'native-session-7', persistence: 'native', source: 'wire' };
  assert.deepEqual(c.list()[0].sessionRef, expected);
  assert.deepEqual((await c.result(h.id)).sessionRef, expected);

  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: adapter() },
    worktrees: { create: async () => ({}), capture: async () => ({}), createVerifyWorktree: async () => ({}), removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({}), route: () => 'session', approvalTimeoutMs: 1000, stopDeadlineMs: 100,
  });
  assert.deepEqual(replay.list()[0].sessionRef, expected);
  assert.deepEqual(replay.list()[0].sessionRequest, { mode: 'new' });
  assert.equal(replay.list()[0].status, 'orphaned');
  assert.deepEqual(await replay.send(h.id, 'must not reach an unattached adapter', 'turn'), { ok: false, result: 'worker_not_active' });
  assert.equal((await replay.result(h.id)).status, 'completed');
});

test('PS1-PS5: Claude, Codex, and Grok each run two public turns on one native session then kill', async (t) => {
  const definitions = [
    ['claude', () => new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], killGraceMs: 20 })],
    ['codex', () => new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 2_000, versionProbe: () => 'fake' })],
    ['grok', () => new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 2_000, versionProbe: () => 'fake' })],
  ];

  for (const [name, make] of definitions) {
    const ad = make();
    const log = new Log(mkdtempSync(join(tmpdir(), `baton-ps-${name}-`)));
    const coordination = new CoordinationStore(mkdtempSync(join(tmpdir(), `baton-ps-${name}-coordination-`)), {
      operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
    });
    const c = new Coordinator({
      log, coordination, fences: new FenceTable(), adapters: { [name]: ad },
      worktrees: {
        create: async () => ({ path: mkdtempSync(join(tmpdir(), `baton-ps-${name}-wt-`)) }),
        capture: async () => ({ sha: 'x', snapshotted: false }),
        createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
        remove: async () => {}, reconcile: async () => {},
      },
      referee: async () => ({ reverified: true, observedExit: 0 }), route: () => name,
      approvalTimeoutMs: 1000, stopDeadlineMs: 500,
      // TG3: every pausable turn_completed is a CHECKPOINT that arms a steering cycle; a short
      // window lets the cycle expire and the gate evaluate each native-session turn promptly.
      progressNudgeWindowMs: 50,
    });
    let workerId;
    t.after(async () => { if (workerId) await c.kill(workerId, 'policy').catch(() => {}); });

    const h = await c.spawn(name, brief(), { taskId: `two-turn-${name}` });
    workerId = h.id;
    // TG1/TG3: a pausable native session checkpoints every turn_completed. This test drives the
    // gate through the epic's drivered path — a live steering registration parks each checkpoint
    // and the driver's claim re-runs the full trust gate, keeping the same native session alive.
    const task = c._tasks.get(h.taskId);
    c._coordRecord(
      'steering.registered', { runId: task.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
      `run.steering_registered:${task.runId ?? 'null'}`, 'orchestrator',
    );
    await until(() => log.read(h.id).some((e) => e.kind === 'turn.paused'));
    const firstSpawn = log.read(h.id).find((e) => e.kind === 'lifecycle.spawned' && e.actor === 'worker');
    const pid = firstSpawn?.payload?.pid;
    const sessionRef = c.list()[0].sessionRef;
    assert.ok(pid && sessionRef, `${name}: first turn must expose native PID/session identity`);

    // Claim the first checkpoint — the gate runs against the live session result.
    await c.claimTurn(c.pausedTurns()[0].pauseId, { actor: 'orchestrator' });
    await until(() => log.read(h.id).filter((e) => e.kind === 'verify.reverified').length === 1);

    const follow = await c.send(h.id, `follow-up for ${name}`, 'turn');
    assert.equal(follow.ok, true, `${name}: public follow-up accepted`);
    // The follow-up turn completes → its checkpoint pause pends → claim runs the gate a second time.
    await until(() => log.read(h.id).filter((e) => e.kind === 'turn.paused').length >= 2);
    await c.claimTurn(c.pausedTurns()[0].pauseId, { actor: 'orchestrator' });
    await until(() => log.read(h.id).filter((e) => e.kind === 'verify.reverified').length === 2);
    assert.deepEqual(c.list()[0].sessionRef, sessionRef, `${name}: native session identity stays stable`);
    const pids = new Set(log.read(h.id).filter((e) => e.kind === 'lifecycle.spawned' && e.actor === 'worker').map((e) => e.payload?.pid).filter(Boolean));
    assert.deepEqual([...pids], [pid], `${name}: second turn must not respawn`);

    const stopped = await c.kill(h.id, 'policy');
    assert.equal(stopped.result, 'confirmed', `${name}: reusable session still confirms kill`);
    workerId = null;
  }
});

test('PS6: unsupported resume/fork policy fails typed before worker allocation', async () => {
  const ad = adapter();
  ad.card = () => ({ ...card(), sessions: { multiTurn: 'native', resume: 'native', fork: 'planned' } });
  const { c } = harness(ad);
  await assert.rejects(
    () => c.spawn('session', brief(), { session: { mode: 'fork', id: 'parent-session' } }),
    (err) => err instanceof SessionSelectionError && err.code === 'session_mode_unavailable',
  );
  assert.deepEqual(c.list(), []);
});

test('PS6: Claude maps per-task resume and fork to native session identities', async (t) => {
  for (const mode of ['resume', 'fork']) {
    const cli = new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], killGraceMs: 20 });
    const events = [];
    cli.onEvent((e) => events.push(e));
    const worker = `claude-${mode}`;
    t.after(() => cli.kill(worker).catch(() => {}));
    const ack = await cli.spawn(worker, brief(), { worktree: tmpdir(), session: { mode, id: 'claude-parent' } });
    assert.equal(ack.ok, true);
    const spawned = await until(() => events.find((e) => e.kind === 'lifecycle.spawned'));
    assert.equal(spawned.payload.sessionId, mode === 'fork' ? 'claude-parent-fork' : 'claude-parent');
  }
});

test('PS6: Codex maps resume and fork to thread/resume and thread/fork', async (t) => {
  for (const mode of ['resume', 'fork']) {
    const cli = new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 2_000, versionProbe: () => 'fake' });
    const events = [];
    cli.onEvent((e) => events.push(e));
    const worker = `codex-${mode}`;
    t.after(() => cli.kill(worker).catch(() => {}));
    const ack = await cli.spawn(worker, brief(), {
      worktree: tmpdir(),
      session: { mode, id: 'thread-parent', ...(mode === 'fork' ? { lastTurnId: 'turn-parent' } : {}) },
    });
    assert.equal(ack.ok, true);
    const spawned = await until(() => events.find((e) => e.kind === 'lifecycle.spawned'));
    assert.equal(spawned.payload.threadId, mode === 'fork' ? 'thread-parent-fork' : 'thread-parent');
  }
});

test('PS6: Grok maps resume to ACP session/load', async (t) => {
  const cli = new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 2_000, versionProbe: () => 'fake' });
  const events = [];
  cli.onEvent((e) => events.push(e));
  t.after(() => cli.kill('grok-resume').catch(() => {}));
  const ack = await cli.spawn('grok-resume', brief(), { worktree: tmpdir(), session: { mode: 'resume', id: 'grok-parent' } });
  assert.equal(ack.ok, true);
  const spawned = await until(() => events.find((e) => e.kind === 'lifecycle.spawned'));
  assert.equal(spawned.payload.sessionId, 'grok-parent');
});

test('PS8: coordinator resume requires and reuses a validated worktree without creating another', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-ps-resume-wt-'));
  const ad = adapter();
  let spawnOpts;
  ad.spawn = async (_worker, _brief, opts) => { spawnOpts = opts; return { ok: true }; };
  let creates = 0;
  const { c } = harness(ad, undefined, {
    create: async () => { creates += 1; throw new Error('resume must not create'); },
    validateSessionContext: async (context) => ({ ok: context.worktree === wt }),
  });

  await assert.rejects(
    () => c.spawn('session', brief(), { session: { mode: 'resume', id: 'external-session' } }),
    (err) => err instanceof SessionSelectionError && err.code === 'session_context_required',
  );
  assert.deepEqual(c.list(), []);
  await assert.rejects(
    () => c.spawn('session', brief(), { session: { mode: 'resume', id: 'external-session', context: { worktree: wt } } }),
    (err) => err instanceof SessionSelectionError && err.code === 'session_context_required',
  );
  assert.deepEqual(c.list(), []);

  const context = { worktree: wt, ownerTaskId: 'original-task' };
  const h = await c.spawn('session', brief(), {
    taskId: 'resumed-task', refines: 'original-task', session: { mode: 'resume', id: 'external-session', context },
  });
  await until(() => spawnOpts);
  assert.equal(creates, 0);
  assert.equal((await spawnOpts.worktreeReady).path, wt);
  assert.deepEqual(h.lineage, { relation: 'resume', parentSessionId: 'external-session', parentTaskId: 'original-task' });
  assert.equal(c.list()[0].sessionContext.worktree, wt);
  assert.equal(c.list()[0].sessionContext.ownerTaskId, 'original-task');
});

test('PS8: fork gets a fresh worktree and a durable parent-session lineage edge', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-ps-fork-wt-'));
  const ad = adapter();
  let spawnOpts;
  ad.spawn = async (_worker, _brief, opts) => { spawnOpts = opts; return { ok: true }; };
  let creates = 0;
  const { c, log } = harness(ad, undefined, {
    create: async () => { creates += 1; return { path: wt, branch: 'baton/forked-task', baseSha: 'base-1' }; },
  });
  const h = await c.spawn('session', brief(), {
    taskId: 'forked-task', refines: 'parent-task', session: { mode: 'fork', id: 'parent-session', lastTurnId: 'parent-turn' },
  });
  await until(() => spawnOpts && c.list()[0].sessionContext);
  assert.equal(creates, 1);
  assert.equal((await spawnOpts.worktreeReady).path, wt);
  assert.deepEqual(h.lineage, { relation: 'fork', parentSessionId: 'parent-session', parentTaskId: 'parent-task' });
  assert.ok(log.read(h.id).some((event) => event.kind === 'worktree.ready' && event.payload?.worktree === wt));
});

test('PS7: replayed session is reattached only after bounded handshake proves the same native identity', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-ps-recover-wt-'));
  const original = adapter();
  const { c, log, coordination } = harness(original, undefined, {
    create: async () => ({ path: wt, branch: 'baton/recover-task', baseSha: 'base-1' }),
  });
  const h = await c.spawn('session', brief(), { taskId: 'recover-task', model: 'test-recover', effort: 'high' });
  await until(() => c.list()[0].sessionContext);
  original.emit(h.id, 'lifecycle.spawned', { sessionId: 'recover-native', pid: 111 }, 1);
  original.emit(h.id, 'lifecycle.turn_completed', completed('before restart'), 1);
  await until(async () => (await c.result(h.id)).ready);

  const resumed = adapter();
  let recoveryOpts;
  resumed.spawn = async (worker, _brief, opts) => {
    recoveryOpts = opts;
    resumed.emit(worker, 'lifecycle.spawned', { sessionId: 'recover-native', pid: 222 }, 1);
    return { ok: true };
  };
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed }, repoRoot: null,
    worktrees: {
      create: async () => ({}), capture: async () => ({ sha: 'x' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
      validateSessionContext: async (context) => ({ ok: context.worktree === wt }),
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'session',
    approvalTimeoutMs: 1000, stopDeadlineMs: 100, recoveryTimeoutMs: 100,
  });
  assert.equal(replay.list()[0].status, 'orphaned');
  const recovered = await replay.recover(h.id);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.result, 'attached');
  assert.equal(recoveryOpts.model, 'test-recover');
  assert.equal(recoveryOpts.reasoningEffort, 'high', 'recovery must preserve the resolved top-level effort');
  assert.equal(replay.list()[0].status, 'working');
  assert.equal(replay.list()[0].sessionRef.id, 'recover-native');
  assert.ok(log.read(h.id).some((event) => event.kind === 'control.recovery_attached'));
});

test('NR1/NR3: recovery attaches without provider work, commits its refinement and intent, then prompts', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-transaction', nativeId: 'transaction-native' });
  const spawnEmissions = [];
  let spawnOpts;
  let coordinationAtPrompt;
  f.resumed.spawn = async (worker, _brief, opts) => {
    spawnOpts = opts;
    spawnEmissions.push('lifecycle.spawned');
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  f.resumed.prompt = async (...args) => {
    f.resumed.calls.prompt.push(args);
    coordinationAtPrompt = f.coordination.events();
    return { ok: true };
  };

  const recovered = await f.replay.recover(f.handle.id);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.result, 'attached');
  assert.equal(spawnOpts.attachOnly, true, 'recovery must select the private attach-only adapter path');
  assert.equal(spawnOpts.session.mode, 'resume');
  assert.deepEqual(spawnEmissions, ['lifecycle.spawned'], 'attach emits identity, not an implicit turn');
  const admittedBrief = f.replay._tasks.get(f.replay._workers.get(f.handle.id).taskId).brief;
  // Epic #81 (OR-S1): the admission injects the L0 orientation grant into every spawn/recovery
  // prompt brief — compare the delegation fields, then assert the grant positively.
  const { orientation, ...promptDelegation } = f.resumed.calls.promptBrief[0][1];
  assert.deepEqual([f.handle.id, promptDelegation], [f.handle.id, admittedBrief], 'coordinator uses the immutable admitted Brief through the adapter dialect hook');
  assert.ok(orientation && typeof orientation.frame === 'string' && orientation.frame.startsWith('UNTRUSTED_ORIENTATION'), 'OR-S1: the L0 orientation grant is cited into the recovery prompt brief');
  assert.deepEqual(f.resumed.calls.prompt[0].slice(1), [{ ...admittedBrief, orientation }, 'turn']);

  const created = coordinationAtPrompt.find((event) => event.kind === 'task.created'
    && event.payload.id.startsWith('recovery:'));
  const claimed = coordinationAtPrompt.find((event) => event.kind === 'task.claimed'
    && event.payload.id === created?.payload.id);
  const intent = coordinationAtPrompt.find((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'recovery.continuation_intent');
  assert.ok(created, 'the recovery refinement must be durable before prompt');
  assert.ok(claimed, 'the recovery refinement claim must be durable before prompt');
  assert.ok(intent, 'the continuation intent must be durable before prompt');
  assert.ok(created.seq < claimed.seq && claimed.seq < intent.seq);
  assert.equal(intent.payload.taskId, created.payload.id);
  assert.equal(intent.payload.workerId, f.handle.id);
  assert.equal(intent.payload.sessionId, f.nativeId);
  const accepted = f.coordination.events().find((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'recovery.dispatch_accepted');
  assert.ok(accepted && intent.seq < accepted.seq, 'accepted disposition follows the durable intent');
  assert.equal(f.coordination.recoveryDispatchState(f.handle.id).status, 'dispatch_accepted');
  assert.equal(f.replay.list()[0].status, 'working');
  assert.equal(f.replay.list()[0].sessionRef.id, f.nativeId);
  assert.ok(f.log.read(f.handle.id).some((event) => event.kind === 'control.recovery_attached'));
});

test('NR3/NR5: refused recovery continuation fails the refinement and kills/reaps the attached transport', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-prompt-refused', nativeId: 'prompt-refused-native' });
  let spawnOpts;
  f.resumed.spawn = async (worker, _brief, opts) => {
    spawnOpts = opts;
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  f.resumed.prompt = async (...args) => {
    f.resumed.calls.prompt.push(args);
    return { ok: false, notSent: true, reason: 'adapter proved provider input was not written' };
  };
  delete f.resumed.promptBrief;

  const recovered = await f.replay.recover(f.handle.id);
  assert.equal(spawnOpts.attachOnly, true);
  assert.equal(f.resumed.calls.prompt.length, 1);
  const admittedBrief = f.replay._tasks.get(f.replay._workers.get(f.handle.id).taskId).brief;
  // Epic #81 (OR-S1): same L0 grant injection — compare delegation, then assert the grant.
  const { orientation, ...promptDelegation } = f.resumed.calls.prompt[0][1];
  assert.deepEqual([promptDelegation, 'turn'], [admittedBrief, 'turn'], 'custom adapters fall back to prompt(worker, admitted brief, turn)');
  assert.ok(orientation && typeof orientation.frame === 'string' && orientation.frame.startsWith('UNTRUSTED_ORIENTATION'), 'OR-S1: the L0 orientation grant is cited into the refused-recovery prompt brief');
  assert.equal(recovered.ok, false);
  assert.equal(recovered.result, 'dispatch_refused');
  await until(() => f.resumed.calls.kill.length === 1);
  await until(() => f.removedScopes.length === 1);
  assert.equal(f.replay._workers.get(f.handle.id).status, 'dead');
  assert.equal(f.coordination.snapshot().tasks.at(-1).status, 'failed');
  assert.equal(f.coordination.events().some((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'recovery.dispatch_refused'), true);
  const refused = f.coordination.events().find((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'recovery.dispatch_refused');
  const failed = f.coordination.events()[refused.seq];
  assert.equal(failed.kind, 'task.transitioned', 'refusal and task failure share one append batch');
  assert.equal(failed.payload.to, 'failed');
  assert.equal(failed.ts, refused.ts);
  assert.equal(f.log.read(f.handle.id).some((event) => event.kind === 'control.recovery_attached'), false);
  const second = await f.replay.recover(f.handle.id);
  assert.equal(second.result, 'dispatch_refused', 'a refused continuation is not automatically redelivered');
  assert.equal(f.resumed.calls.prompt.length, 1);
});

test('NR2/NR5: a recovered route mismatch joins one exact stop instead of racing a second reaper', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-route-mismatch', nativeId: 'route-mismatch-native' });
  f.resumed.spawn = async (worker, _brief, opts) => {
    assert.equal(opts.attachOnly, true);
    f.resumed.emit(worker, 'lifecycle.spawned', {
      sessionId: f.nativeId,
      pid: 222,
      modelObserved: 'test-substituted',
    }, 1);
    return { ok: true };
  };
  f.resumed.kill = async (worker) => {
    f.resumed.calls.kill.push([worker]);
    f.resumed.emit(worker, 'kill.confirmed', {}, 1);
    return { ok: true };
  };

  const recovered = await f.replay.recover(f.handle.id);
  assert.deepEqual(recovered, { ok: false, result: 'recovery_route_mismatch' });
  assert.equal(f.resumed.calls.prompt.length, 0, 'a mismatched route never receives the continuation');
  assert.equal(f.resumed.calls.kill.length, 1, 'one exact stop owns transport teardown');
  assert.equal(f.replay._workers.get(f.handle.id).untrustedTransportReap ?? null, null);
  assert.equal(f.replay._workers.get(f.handle.id).status, 'dead');
  assert.equal(f.coordination.snapshot().tasks.at(-1).status, 'failed');
  assert.deepEqual(f.removedScopes, [f.handle.id]);
});

test('NR6: concurrent identical recovery calls coalesce and a changed request conflicts before effects', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-concurrent', nativeId: 'concurrent-native' });
  let spawnCalls = 0;
  f.resumed.spawn = async (worker, _brief, opts) => {
    spawnCalls += 1;
    await sleep(25);
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };

  const first = f.replay.recover(f.handle.id);
  const duplicate = f.replay.recover(f.handle.id);
  const conflict = await f.replay.recover(f.handle.id, {
    context: { ...f.replay._workers.get(f.handle.id).sessionContext, branch: 'baton/substituted' },
  });
  assert.deepEqual(conflict, { ok: false, result: 'recovery_conflict' });
  const [a, b] = await Promise.all([first, duplicate]);
  assert.equal(a.ok, true);
  assert.deepEqual(b, a);
  assert.equal(spawnCalls, 1, 'one controller epoch creates one native recovery process');
  assert.equal(f.resumed.calls.prompt.length, 1, 'the coalesced recovery dispatches one continuation');
});

test('NR1/NR2: duplicate provider-ready identities are refused before refinement or prompt', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-duplicate-ready', nativeId: 'duplicate-ready-native' });
  f.resumed.spawn = async (worker, _brief, opts) => {
    assert.equal(opts.attachOnly, true);
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: `${f.nativeId}-substituted`, pid: 222 }, 1);
    return { ok: true };
  };

  const recovered = await f.replay.recover(f.handle.id);
  assert.equal(recovered.result, 'recovery_protocol_violation');
  assert.equal(f.resumed.calls.prompt.length, 0);
  assert.equal(f.coordination.snapshot().tasks.length, 1, 'no recovery refinement crosses duplicate identity testimony');
  assert.equal(f.resumed.calls.kill.length, 1);
  assert.equal(f.replay._workers.get(f.handle.id).status, 'dead');
});

test('NR3/NR4: a maximum valid base task id uses bounded recovery identity and retains no-redelivery state', async () => {
  const taskId = `long-${'x'.repeat(123)}`;
  const f = await recoverableNativeSession({ taskId, nativeId: 'long-task-native' });
  f.resumed.spawn = async (worker) => {
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  const recovered = await f.replay.recover(f.handle.id);
  assert.equal(recovered.ok, true);
  const live = f.coordination.recoveryDispatchState(f.handle.id);
  assert.equal(live.status, 'dispatch_accepted');
  assert.equal(live.priorTaskId, taskId);
  assert.ok(Buffer.byteLength(live.taskId) < Buffer.byteLength(taskId), 'recovery identity does not recursively append the prior id');

  const loaded = new CoordinationStore(f.coordination.root, {
    operationalRead: (worker, seq) => f.log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  assert.deepEqual(loaded.recoveryDispatchState(f.handle.id), live, 'restart cannot silently drop a valid long-id disposition');
});

test('NR3/NR4: generic driver records cannot bypass validated recovery state projection', () => {
  const coordination = new CoordinationStore(mkdtempSync(join(tmpdir(), 'baton-ps-recovery-api-')));
  const before = coordination.events().length;
  assert.throws(() => coordination.recordDriver('recovery.continuation_intent', {
    workerId: 'w-forged', taskId: 'missing', priorTaskId: 'missing-prior',
  }, { actor: 'orchestrator', key: 'forged-recovery-intent' }), (error) => error.code === 'recovery_dispatch_api_required');
  assert.equal(coordination.events().length, before, 'invalid recovery state is refused before append');
});

test('Phase 60 RED: a prompt exception is dispatch_unknown and is never automatically redelivered', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-prompt-exception', nativeId: 'prompt-exception-native' });
  let spawnCalls = 0;
  f.resumed.spawn = async (worker, _brief, opts) => {
    spawnCalls += 1;
    assert.equal(opts.attachOnly, true);
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  f.resumed.prompt = async (...args) => {
    f.resumed.calls.prompt.push(args);
    throw new Error('transport failed after dispatch became possible');
  };
  delete f.resumed.promptBrief;

  const first = await f.replay.recover(f.handle.id);
  assert.equal(first.ok, false);
  assert.equal(first.result, 'dispatch_unknown', 'an exception cannot prove that the provider did not accept the continuation');
  assert.equal(f.coordination.recoveryDispatchState(f.handle.id).status, 'dispatch_unknown');
  assert.equal(f.coordination.events().some((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'recovery.dispatch_refused'), false, 'ambiguous transport failure is not durable refusal proof');
  await until(() => f.resumed.calls.kill.length === 1);

  const second = await f.replay.recover(f.handle.id);
  assert.equal(second.result, 'dispatch_unknown');
  assert.equal(spawnCalls, 1, 'an ambiguous continuation is never attached or dispatched again automatically');
  assert.equal(f.resumed.calls.prompt.length, 1);
});

test('Phase 60 RED: synchronous turn evidence followed by a false Ack is dispatch_unknown, not refused', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-false-ack-evidence', nativeId: 'false-ack-evidence-native' });
  let spawnCalls = 0;
  f.resumed.spawn = async (worker, _brief, opts) => {
    spawnCalls += 1;
    assert.equal(opts.attachOnly, true);
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  f.resumed.prompt = async (...args) => {
    f.resumed.calls.prompt.push(args);
    f.resumed.emit(f.handle.id, 'lifecycle.turn_started', { sessionId: f.nativeId }, 2);
    return { ok: false, reason: 'false Ack after the provider turn visibly advanced' };
  };
  delete f.resumed.promptBrief;

  const first = await f.replay.recover(f.handle.id);
  assert.equal(first.ok, false);
  assert.equal(first.result, 'dispatch_unknown', 'provider turn evidence contradicts a pre-acceptance refusal');
  assert.equal(f.coordination.recoveryDispatchState(f.handle.id).status, 'dispatch_unknown');
  assert.equal(f.coordination.events().some((event) => event.kind === 'driver.recorded'
    && event.payload.kind === 'recovery.dispatch_refused'), false);
  await until(() => f.resumed.calls.kill.length === 1);

  const second = await f.replay.recover(f.handle.id);
  assert.equal(second.result, 'dispatch_unknown');
  assert.equal(spawnCalls, 1);
  assert.equal(f.resumed.calls.prompt.length, 1);
});

test('NR3/NR4: a hung continuation dispatch is bounded, unknown, and never redelivered', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-prompt-timeout', nativeId: 'prompt-timeout-native' });
  f.replay._recoveryTimeoutMs = 20;
  f.resumed.spawn = async (worker) => {
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  f.resumed.prompt = async (...args) => {
    f.resumed.calls.prompt.push(args);
    return new Promise(() => {});
  };
  delete f.resumed.promptBrief;

  const first = await f.replay.recover(f.handle.id);
  assert.equal(first.result, 'dispatch_unknown');
  assert.match(first.reason, /dispatch exceeded 20ms/u);
  assert.equal(f.coordination.recoveryDispatchState(f.handle.id).status, 'dispatch_unknown');
  assert.equal(f.resumed.calls.kill.length, 1);
  const second = await f.replay.recover(f.handle.id);
  assert.equal(second.result, 'dispatch_unknown');
  assert.equal(f.resumed.calls.prompt.length, 1);
});

test('Phase 60 RED: kill winning a delayed successful prompt Ack cannot expose working authority or clean twice', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-kill-prompt-race', nativeId: 'kill-prompt-race-native' });
  const pid = 4242;
  let releasePrompt;
  let markPromptEntered;
  const promptEntered = new Promise((resolve) => { markPromptEntered = resolve; });
  f.resumed.spawn = async (worker, _brief, opts) => {
    f.resumed.emit(worker, 'lifecycle.process_started', {
      schemaVersion: 1,
      generation: opts.processGeneration,
      pid,
      processGroupId: pid,
      phase: 'initializing',
    }, 1);
    f.resumed.emit(worker, 'lifecycle.spawned', {
      sessionId: f.nativeId,
      pid,
      processGeneration: opts.processGeneration,
    }, 1);
    return { ok: true };
  };
  f.resumed.prompt = async (...args) => {
    f.resumed.calls.prompt.push(args);
    markPromptEntered();
    return new Promise((resolve) => { releasePrompt = () => resolve({ ok: true }); });
  };
  delete f.resumed.promptBrief;
  f.resumed.kill = async (worker) => {
    f.resumed.calls.kill.push([worker]);
    const generation = f.replay._workers.get(worker).processGeneration;
    f.resumed.emit(worker, 'lifecycle.process_closed', {
      schemaVersion: 1,
      generation,
      pid,
      processGroupId: pid,
      code: null,
      signal: 'SIGKILL',
      ready: true,
    }, 1);
    f.resumed.emit(worker, 'kill.confirmed', {}, 1);
    return { ok: true };
  };

  const recovering = f.replay.recover(f.handle.id);
  await promptEntered;
  const killed = await f.replay.kill(f.handle.id, 'human');
  assert.equal(killed.result, 'confirmed');
  releasePrompt();
  const recovered = await recovering;

  assert.equal(recovered.ok, false, 'a completed stop owns the outcome even if the delayed prompt Ack is positive');
  assert.notEqual(f.replay._workers.get(f.handle.id).status, 'working');
  assert.equal(f.log.read(f.handle.id).some((event) => event.kind === 'control.recovery_attached'), false);
  assert.equal(f.resumed.calls.kill.length, 1, 'one stop owns the recovered process generation');
  assert.deepEqual(f.removedScopes, [f.handle.id], 'runtime cleanup is performed exactly once');
});

test('NR3/NR5: recovery refinement append failure dispatches no continuation and reaps the attached transport', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-pre-prompt-refine-failure', nativeId: 'pre-prompt-refine-native' });
  let spawnOpts;
  f.resumed.spawn = async (worker, _brief, opts) => {
    spawnOpts = opts;
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  const rawAppend = f.coordination._appendFile;
  f.coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"task.created"') && body.includes('"relation":"recovery"')) throw new Error('recovery refinement disk full');
    return rawAppend(file, body, encoding);
  };

  await assert.rejects(f.replay.recover(f.handle.id), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(spawnOpts.attachOnly, true);
  assert.equal(f.resumed.calls.prompt.length, 0, 'no continuation crosses a failed refinement boundary');
  await until(() => f.resumed.calls.kill.length === 1);
  await until(() => f.removedScopes.length === 1);
  assert.equal(f.replay._workers.get(f.handle.id).status, 'dead');
  assert.deepEqual(f.coordination.snapshot().tasks.map((task) => task.status), ['completed']);
});

test('NR3: continuation-intent append failure calls no prompt and reaps the attached transport', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-intent-boundary', nativeId: 'intent-boundary-native' });
  let spawnOpts;
  f.resumed.spawn = async (worker, _brief, opts) => {
    spawnOpts = opts;
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  const rawAppend = f.coordination._appendFile;
  f.coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"recovery.continuation_intent"')) throw new Error('recovery intent disk full');
    return rawAppend(file, body, encoding);
  };

  await assert.rejects(f.replay.recover(f.handle.id), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(spawnOpts.attachOnly, true);
  assert.equal(f.resumed.calls.prompt.length, 0, 'no continuation crosses an uncommitted intent boundary');
  await until(() => f.resumed.calls.kill.length === 1);
  await until(() => f.removedScopes.length === 1);
  assert.equal(f.replay._workers.get(f.handle.id).status, 'dead');
});

test('NR4/NR5: accepted-receipt loss reaps, materializes dispatch_unknown, and restart never redelivers', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-receipt-boundary', nativeId: 'receipt-boundary-native' });
  f.resumed.spawn = async (worker, _brief, opts) => {
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    assert.equal(opts.attachOnly, true);
    return { ok: true };
  };
  const rawAppend = f.coordination._appendFile;
  f.coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"recovery.dispatch_accepted"')) throw new Error('recovery receipt disk full');
    return rawAppend(file, body, encoding);
  };

  await assert.rejects(f.replay.recover(f.handle.id), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(f.resumed.calls.prompt.length, 1, 'the prompt crossed the durable intent exactly once');
  await until(() => f.resumed.calls.kill.length === 1);
  await until(() => f.removedScopes.length === 1);
  assert.equal(f.replay._workers.get(f.handle.id).status, 'dead');
  assert.equal(f.log.read(f.handle.id).some((event) => event.kind === 'control.recovery_attached'), false);
  assert.equal(f.coordination.recoveryDispatchState(f.handle.id).status, 'dispatch_unknown');

  f.coordination._appendFile = rawAppend;
  const next = adapter(); let spawnCalls = 0;
  next.spawn = async () => { spawnCalls += 1; return { ok: true }; };
  const restarted = new Coordinator({
    log: f.log, coordination: f.coordination, fences: new FenceTable(), adapters: { session: next },
    worktrees: { validateSessionContext: async () => ({ ok: true }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({}), route: () => 'session', recoveryTimeoutMs: 100, stopDeadlineMs: 100,
  });
  const retry = await restarted.recover(f.handle.id);
  assert.equal(retry.result, 'dispatch_unknown');
  assert.equal(spawnCalls, 0, 'restart cannot redeliver an ambiguously dispatched continuation');
});

test('CK8/CK9: recovery intent append failure reaches no native adapter', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-ps-recover-intent-wt-'));
  const original = adapter();
  const { c, log, coordination } = harness(original, undefined, { create: async () => ({ path: wt }) });
  const h = await c.spawn('session', brief(), { taskId: 'recover-intent-task' });
  await until(() => c.list()[0].sessionContext);
  original.emit(h.id, 'lifecycle.spawned', { sessionId: 'intent-native', pid: 111 }, 1);
  original.emit(h.id, 'lifecycle.turn_completed', completed(), 1);
  await until(async () => (await c.result(h.id)).ready);

  const resumed = adapter();
  let spawnCalls = 0;
  resumed.spawn = async () => { spawnCalls += 1; return { ok: true }; };
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed },
    worktrees: { validateSessionContext: async () => ({ ok: true }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({}), route: () => 'session', recoveryTimeoutMs: 100, stopDeadlineMs: 100,
  });
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"kind":"recovery.requested"')) throw new Error('recovery intent disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(replay.recover(h.id), (error) => error.code === 'coordination_write_unavailable');
  assert.equal(spawnCalls, 0);
  assert.equal(replay._workers.get(h.id).status, 'orphaned');
});

test('CK8/CK9: recovery refinement failure kills a native transport that already attached', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-ps-recover-refine-wt-'));
  const original = adapter();
  const { c, log, coordination } = harness(original, undefined, { create: async () => ({ path: wt }) });
  const h = await c.spawn('session', brief(), { taskId: 'recover-refine-task' });
  await until(() => c.list()[0].sessionContext);
  original.emit(h.id, 'lifecycle.spawned', { sessionId: 'refine-native', pid: 111 }, 1);
  original.emit(h.id, 'lifecycle.turn_completed', completed(), 1);
  await until(async () => (await c.result(h.id)).ready);

  const resumed = adapter();
  resumed.spawn = async (worker) => {
    resumed.emit(worker, 'lifecycle.spawned', { sessionId: 'refine-native', pid: 222 }, 1);
    return { ok: true };
  };
  const removedScopes = [];
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed },
    worktrees: { validateSessionContext: async () => ({ ok: true }), remove: async () => {}, reconcile: async () => {} },
    runtimeScopes: {
      reconcile: () => {},
      create: (worker) => ({ env: {}, replaceEnv: true, posture: { root: `/runtime/${worker}` } }),
      remove: (worker) => removedScopes.push(worker),
    },
    referee: async () => ({}), route: () => 'session', recoveryTimeoutMs: 100, stopDeadlineMs: 100,
  });
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"task.created"') && body.includes('"relation":"recovery"')) throw new Error('recovery refinement disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(replay.recover(h.id), (error) => error.code === 'coordination_write_unavailable');
  await until(() => resumed.calls.kill.length === 1);
  await until(() => removedScopes.length === 1);
  assert.equal(replay._workers.get(h.id).status, 'dead');
  assert.deepEqual(removedScopes, [h.id]);
  assert.equal(log.read(h.id).some((event) => event.kind === 'control.refinement_aborted' && event.payload.relation === 'recovery'), true);

  coordination._appendFile = rawAppend;
  const restarted = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: adapter() },
    worktrees: { validateSessionContext: async () => ({ ok: true }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({}), route: () => 'session', recoveryTimeoutMs: 100, stopDeadlineMs: 100,
  });
  assert.equal(restarted.list()[0].status, 'orphaned');
  assert.equal((await restarted.result(h.id)).status, 'completed', 'the prior verified task is not rewritten as refinement success');
});

test('PS7: a reattachment identity mismatch is refused and the untrusted transport is killed', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-ps-recover-bad-wt-'));
  const original = adapter();
  const { c, log, coordination } = harness(original, undefined, { create: async () => ({ path: wt }) });
  const h = await c.spawn('session', brief(), { taskId: 'recover-bad-task' });
  await until(() => c.list()[0].sessionContext);
  original.emit(h.id, 'lifecycle.spawned', { sessionId: 'expected-native', pid: 111 }, 1);
  original.emit(h.id, 'lifecycle.turn_completed', completed(), 1);
  await until(async () => (await c.result(h.id)).ready);

  const resumed = adapter();
  resumed.spawn = async (worker) => {
    resumed.emit(worker, 'lifecycle.spawned', { sessionId: 'wrong-native', pid: 333 }, 1);
    return { ok: true };
  };
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed },
    worktrees: { validateSessionContext: async () => ({ ok: true }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({}), route: () => 'session', recoveryTimeoutMs: 100, stopDeadlineMs: 100,
  });
  const recovered = await replay.recover(h.id);
  assert.equal(recovered.ok, false);
  assert.equal(recovered.result, 'session_identity_mismatch');
  assert.equal(replay.list()[0].status, 'dead');
  assert.equal(resumed.calls.kill.length, 1);
  assert.ok(log.read(h.id).some((event) => event.kind === 'control.recovery_failed'));
});

test('PS7: a hung reattachment is bounded, confirms stop, and invokes adapter cleanup', async () => {
  const wt = mkdtempSync(join(tmpdir(), 'baton-ps-recover-timeout-wt-'));
  const original = adapter();
  const { c, log, coordination } = harness(original, undefined, { create: async () => ({ path: wt }) });
  const h = await c.spawn('session', brief(), { taskId: 'recover-timeout-task' });
  await until(() => c.list()[0].sessionContext);
  original.emit(h.id, 'lifecycle.spawned', { sessionId: 'timeout-native', pid: 111 }, 1);
  original.emit(h.id, 'lifecycle.turn_completed', completed(), 1);
  await until(async () => (await c.result(h.id)).ready);

  const resumed = adapter();
  resumed.spawn = async () => new Promise(() => {});
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed },
    worktrees: { validateSessionContext: async () => ({ ok: true }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({}), route: () => 'session', recoveryTimeoutMs: 20, stopDeadlineMs: 100,
  });
  const recovered = await replay.recover(h.id);
  assert.equal(recovered.ok, false);
  assert.equal(recovered.result, 'recovery_timeout');
  assert.equal(replay.list()[0].status, 'dead');
  assert.equal(resumed.calls.kill.length, 1);
});

test('Phase 60 adversarial: a synchronous attach exception enters confirmed recovery cleanup', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-sync-throw', nativeId: 'sync-throw-native' });
  f.resumed.spawn = () => { throw new Error('synchronous attach failure'); };

  const recovered = await f.replay.recover(f.handle.id);

  assert.equal(recovered.ok, false);
  assert.equal(recovered.result, 'recovery_exception');
  assert.match(recovered.reason, /synchronous attach failure/u);
  assert.equal(f.resumed.calls.kill.length, 1, 'the synchronous exception reaches exact stop');
  assert.deepEqual(f.removedScopes, [f.handle.id], 'runtime authority is reaped once');
  assert.equal(f.replay._workers.get(f.handle.id).status, 'dead');
  assert.equal(f.replay._workers.get(f.handle.id).recoverySpawnPending, false);
});

test('Phase 60 adversarial: timed-out attach remains abortable and reserved until spawn settles', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-pending-spawn', nativeId: 'pending-spawn-native' });
  f.replay._recoveryTimeoutMs = 20;
  admitGovernedRecoveryTurn(f.replay);
  let settleSpawn;
  let spawnSignal;
  f.resumed.spawn = (_worker, _brief, opts) => {
    spawnSignal = opts.signal;
    return new Promise((resolve) => { settleSpawn = resolve; });
  };

  const recovered = await f.replay.recover(f.handle.id);
  const internal = f.replay._workers.get(f.handle.id);

  assert.equal(recovered.result, 'recovery_timeout');
  assert.equal(spawnSignal?.aborted, true, 'timeout aborts the attach-only spawn contract');
  assert.equal(internal.recoverySpawnPending, true, 'the unresolved adapter call remains owned');
  assert.equal(internal.providerTurn.sealed, false, 'provider admission is retained while a late child remains possible');
  assert.equal(f.log.read(f.handle.id).some((event) => event.kind === 'resource.provider_turn_released'), false);
  assert.throws(() => f.replay.closeAuthority(), (error) => error.code === 'coordinator_not_drained');

  settleSpawn({ ok: false, reason: 'aborted' });
  await until(() => internal.recoverySpawnPending === false && internal.recoverySpawnPromise === null);

  assert.equal(internal.providerTurn.sealed, true, 'the seat is released only after spawn settlement and confirmed stop');
  assert.equal(f.log.read(f.handle.id).some((event) => event.kind === 'resource.provider_turn_released'), true);
  assert.equal(f.replay.closeAuthority(), true);
});

test('Phase 60 adversarial: unconfirmed recovery teardown retains provider and runtime authority', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-unconfirmed-stop', nativeId: 'unconfirmed-stop-native' });
  admitGovernedRecoveryTurn(f.replay);
  f.replay._stopDeadlineMs = 20;
  f.resumed.spawn = () => { throw new Error('attach failed before Ack'); };
  f.resumed.kill = async (worker) => {
    f.resumed.calls.kill.push([worker]);
    return { ok: true };
  };

  const recovered = await f.replay.recover(f.handle.id);
  const internal = f.replay._workers.get(f.handle.id);

  assert.equal(recovered.result, 'recovery_exception');
  assert.equal(f.resumed.calls.kill.length >= 1, true);
  assert.equal(internal.providerTurn.sealed, false, 'a deadline is not provider-seat release authority');
  assert.equal(f.log.read(f.handle.id).some((event) => event.kind === 'resource.provider_turn_released'), false);
  assert.equal(internal.localAuthority, true);
  assert.equal(internal.cleanupPending, true);
  assert.deepEqual(f.removedScopes, [], 'runtime authority is retained until exact close');
});

test('Phase 60 adversarial: every pre-spawn post-admission failure compensates provider and runtime authority', async (t) => {
  for (const phase of ['operational_log', 'coordination', 'runtime']) {
    await t.test(phase, async () => {
      const f = await recoverableNativeSession({ taskId: `recover-setup-${phase}`, nativeId: `setup-${phase}-native` });
      admitGovernedRecoveryTurn(f.replay);
      let spawnCalls = 0;
      f.resumed.spawn = async () => { spawnCalls += 1; return { ok: true }; };
      const originalLogDir = f.log.dir;
      if (phase === 'operational_log') {
        const admit = f.coordination.admitRecoveryAttempt.bind(f.coordination);
        f.coordination.admitRecoveryAttempt = (...args) => {
          const admitted = admit(...args);
          f.log.dir = join(originalLogDir, 'missing', 'nested');
          return admitted;
        };
      }
      if (phase === 'coordination') f.replay._coordRecord = () => { throw new Error('coordination setup failed'); };
      if (phase === 'runtime') f.replay._runtimeScopes.create = () => { throw new Error('runtime setup failed'); };

      try {
        await assert.rejects(f.replay.recover(f.handle.id));
      } finally {
        f.log.dir = originalLogDir;
      }

      const internal = f.replay._workers.get(f.handle.id);
      assert.equal(spawnCalls, 0, `${phase} failure occurs before attach`);
      assert.equal(internal.turnAdmission, null);
      assert.equal(internal.providerTurn.sealed, true, `${phase} releases the admitted provider seat`);
      assert.equal(internal.localAuthority, false);
      assert.deepEqual(f.removedScopes, [f.handle.id], `${phase} compensates a possibly partial runtime create`);
    });
  }
});

test('Phase 60 adversarial: pending refinement is never publicly exposed as working', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-result-mask', nativeId: 'result-mask-native' });
  let releasePrompt;
  let promptEnteredResolve;
  const promptEntered = new Promise((resolve) => { promptEnteredResolve = resolve; });
  f.resumed.spawn = async (worker) => {
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  f.resumed.prompt = async (...args) => {
    f.resumed.calls.prompt.push(args);
    promptEnteredResolve();
    return new Promise((resolve) => { releasePrompt = () => resolve({ ok: true }); });
  };

  const recovering = f.replay.recover(f.handle.id);
  await promptEntered;
  const resultDuringDispatch = await f.replay.result(f.handle.id);
  const listedDuringDispatch = f.replay.list().find((handle) => handle.id === f.handle.id);

  assert.equal(f.replay._tasks.get(f.replay._workers.get(f.handle.id).taskId).status, 'working');
  assert.equal(resultDuringDispatch.ready, false);
  assert.equal(resultDuringDispatch.status, 'orphaned');
  assert.equal(listedDuringDispatch.status, 'orphaned');

  releasePrompt();
  const recovered = await recovering;
  assert.equal(recovered.ok, true);
  assert.equal(recovered.handle.status, 'working');
  assert.equal((await f.replay.result(f.handle.id)).status, 'working');
});

test('Phase 60 adversarial: post-acceptance exposure log failure emergency-stops and never returns working', async () => {
  const f = await recoverableNativeSession({ taskId: 'recover-exposure-failure', nativeId: 'exposure-failure-native' });
  admitGovernedRecoveryTurn(f.replay);
  const originalLogDir = f.log.dir;
  f.resumed.spawn = async (worker) => {
    f.resumed.emit(worker, 'lifecycle.spawned', { sessionId: f.nativeId, pid: 222 }, 1);
    return { ok: true };
  };
  f.resumed.prompt = async (...args) => {
    f.resumed.calls.prompt.push(args);
    f.log.dir = join(originalLogDir, 'missing', 'nested');
    return { ok: true };
  };

  try {
    await assert.rejects(f.replay.recover(f.handle.id), (error) => error.code === 'operational_log_unavailable');
  } finally {
    f.log.dir = originalLogDir;
  }

  const internal = f.replay._workers.get(f.handle.id);
  assert.equal(f.coordination.recoveryDispatchState(f.handle.id).status, 'dispatch_accepted');
  assert.equal(internal.status, 'dead');
  assert.equal(f.resumed.calls.kill.length, 1);
  assert.deepEqual(f.removedScopes, [f.handle.id]);
  assert.equal(internal.providerTurn.sealed, true);
  assert.equal(f.log.read(f.handle.id).some((event) => event.kind === 'control.recovery_attached'), false);
});
