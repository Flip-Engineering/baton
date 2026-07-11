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
    modelSelection: { mode: 'exact', configuredDefault: null, available: null, family: 'test', acceptedPrefixes: ['test-'], acceptedAliases: [], reasoningEffort: null, serviceTier: null, provenance: 'test', refreshedAt: null },
    sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
  };
}

function adapter(over = {}) {
  const calls = { prompt: [], interrupt: [], kill: [] };
  return {
    calls, cb: null,
    onEvent(cb) { this.cb = cb; },
    card,
    emit(worker, kind, payload = {}, turnEpoch = 1, actor = 'worker') {
      this.cb?.({ worker, harness: 'session', turnEpoch, actor, kind, payload });
    },
    spawn: async () => ({ ok: true }),
    prompt: async (...args) => { calls.prompt.push(args); return over.prompt ? over.prompt(...args) : { ok: true }; },
    interrupt: async (...args) => { calls.interrupt.push(args); return { ok: true }; },
    kill: async (...args) => { calls.kill.push(args); return { ok: true }; },
    approve: async () => ({ ok: true }), answer: async () => ({ ok: true }),
  };
}

function harness(ad, referee = async () => ({ reverified: true, observedExit: 0 }), worktreeOverrides = {}) {
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
  const { c, coordination, log } = harness(ad);
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
  assert.equal(c.list()[0].status, 'stopping');
});

test('PS3: interrupt-with-follow-up reopens coordinator state before the adapter follow-up terminal', async () => {
  const ad = adapter();
  const { c, verifyCalls } = harness(ad);
  const h = await c.spawn('session', brief(), { taskId: 'interrupt-follow' });
  const stopping = c.interrupt(h.id, 'continue after interrupt', 'human');
  ad.emit(h.id, 'control.interrupt_confirmed', {}, 1, 'orchestrator');
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
    ['codex', () => new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 500, versionProbe: () => 'fake' })],
    ['grok', () => new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 500, versionProbe: () => 'fake' })],
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
    });
    let workerId;
    t.after(async () => { if (workerId) await c.kill(workerId, 'policy').catch(() => {}); });

    const h = await c.spawn(name, brief(), { taskId: `two-turn-${name}` });
    workerId = h.id;
    await until(async () => (await c.result(h.id)).ready);
    const firstSpawn = log.read(h.id).find((e) => e.kind === 'lifecycle.spawned' && e.actor === 'worker');
    const pid = firstSpawn?.payload?.pid;
    const sessionRef = c.list()[0].sessionRef;
    assert.ok(pid && sessionRef, `${name}: first turn must expose native PID/session identity`);

    const follow = await c.send(h.id, `follow-up for ${name}`, 'turn');
    assert.equal(follow.ok, true, `${name}: public follow-up accepted`);
    await until(async () => (await c.result(h.id)).ready && log.read(h.id).filter((e) => e.kind === 'verify.reverified').length === 2);
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
    const cli = new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 500, versionProbe: () => 'fake' });
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
  const cli = new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 500, versionProbe: () => 'fake' });
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
  const h = await c.spawn('session', brief(), { taskId: 'recover-task' });
  await until(() => c.list()[0].sessionContext);
  original.emit(h.id, 'lifecycle.spawned', { sessionId: 'recover-native', pid: 111 }, 1);
  original.emit(h.id, 'lifecycle.turn_completed', completed('before restart'), 1);
  await until(async () => (await c.result(h.id)).ready);

  const resumed = adapter();
  resumed.spawn = async (worker) => {
    resumed.emit(worker, 'lifecycle.spawned', { sessionId: 'recover-native', pid: 222 }, 1);
    resumed.emit(worker, 'lifecycle.turn_started', { sessionId: 'recover-native' }, 1);
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
  assert.equal(replay.list()[0].status, 'working');
  assert.equal(replay.list()[0].sessionRef.id, 'recover-native');
  assert.ok(log.read(h.id).some((event) => event.kind === 'control.recovery_attached'));
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
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed },
    worktrees: { validateSessionContext: async () => ({ ok: true }), remove: async () => {}, reconcile: async () => {} },
    referee: async () => ({}), route: () => 'session', recoveryTimeoutMs: 100, stopDeadlineMs: 100,
  });
  const rawAppend = coordination._appendFile;
  coordination._appendFile = (file, body, encoding) => {
    if (body.includes('"task.created"') && body.includes('refinement-')) throw new Error('recovery refinement disk full');
    return rawAppend(file, body, encoding);
  };
  await assert.rejects(replay.recover(h.id), (error) => error.code === 'coordination_write_unavailable');
  await until(() => resumed.calls.kill.length === 1);
  assert.equal(replay._workers.get(h.id).status, 'orphaned');
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
  assert.equal(replay.list()[0].status, 'orphaned');
  assert.equal(resumed.calls.kill.length, 1);
  assert.ok(log.read(h.id).some((event) => event.kind === 'control.recovery_failed'));
});

test('PS7: a hung reattachment is bounded, remains orphaned, and invokes adapter cleanup', async () => {
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
  assert.equal(replay.list()[0].status, 'orphaned');
  assert.equal(resumed.calls.kill.length, 1);
});
