// Phase 11.0 red tests for CI1-CI6.
// These are zero-quota seam tests. They intentionally target the public coordinator/driver path,
// not isolated helpers, because every defect was a built-but-unwired boundary failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Coordinator } from '../src/coordinator.mjs';
import { createDriver } from '../src/index.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { createBrief, isFact, isProse } from '../src/messages.mjs';
import { initialState, foldEvent } from '../src/story.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`condition did not become true within ${timeoutMs}ms`);
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function brief(goal = 'original goal') {
  return {
    goal,
    constraints: ['original constraint'],
    pathScope: ['src/**'],
    definitionOfDone: 'original done',
    verification: {
      command: 'test -f original.txt',
      expectExit: 0,
      timeoutMs: 4321,
      coverageCommand: 'node coverage.mjs',
    },
    budget: { tokens: 100, usd: 1, wallMin: 1 },
  };
}

function card(over = {}) {
  return {
    harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 4,
    maxContext: 1000,
    verbs: {
      spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
      approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported',
    },
    ...over,
  };
}

function adapter(over = {}) {
  return {
    _cb: null,
    onEvent(cb) { this._cb = cb; },
    emit(kind, payload = {}, actor = 'worker', turnEpoch = 2) {
      this._cb?.({ worker: 'w-1', harness: 'stub', turnEpoch, actor, kind, payload });
    },
    card: () => card(over.card),
    spawn: over.spawn ?? (async () => ({ ok: true })),
    prompt: over.prompt ?? (async () => ({ ok: true })),
    interrupt: over.interrupt ?? (async () => ({ ok: true })),
    kill: over.kill ?? (async () => ({ ok: true })),
    approve: over.approve ?? (async () => ({ ok: true })),
    answer: over.answer ?? (async () => ({ ok: true })),
  };
}

function harness({ ad = adapter(), log, worktrees: worktreeOver = {}, stopDeadlineMs = 50 } = {}) {
  const actualLog = log ?? new Log(mkdtempSync(join(tmpdir(), 'baton-p11-log-')));
  const coordination = coordinationForLog(actualLog);
  const worktrees = {
    create: worktreeOver.create ?? (async (taskId) => ({ path: `/tmp/${taskId}`, branch: `baton/${taskId}`, baseSha: 'base' })),
    capture: worktreeOver.capture ?? (async () => ({ sha: 'result', snapshotted: false })),
    createVerifyWorktree: worktreeOver.createVerifyWorktree ?? (async () => ({ path: '/tmp/verify' })),
    removeVerifyWorktree: worktreeOver.removeVerifyWorktree ?? (async () => {}),
    remove: worktreeOver.remove ?? (async () => {}),
    reconcile: worktreeOver.reconcile ?? (async () => {}),
  };
  const coordinator = new Coordinator({
    log: actualLog,
    coordination,
    fences: new FenceTable(),
    adapters: { stub: ad },
    worktrees,
    repoRoot: tmpdir(),
    referee: async () => ({ reverified: true, passed: true, observedExit: 0 }),
    route: () => 'stub',
    now: Date.now,
    approvalTimeoutMs: 1000,
    stopDeadlineMs,
  });
  return { coordinator, coordination, log: actualLog, ad, worktrees };
}

test('CI1: createBrief preserves verification hardening fields and freezes them', () => {
  const made = createBrief(brief());
  assert.equal(made.verification.timeoutMs, 4321);
  assert.equal(made.verification.coverageCommand, 'node coverage.mjs');
  assert.ok(Object.isFrozen(made));
  assert.ok(Object.isFrozen(made.verification));
});

test('CI1: admission deep-snapshots unknown nested extension fields without freezing the caller', () => {
  const raw = { ...brief(), contextPolicy: { views: [{ id: 'symbols', retractable: true }] } };
  const made = createBrief(raw);
  raw.contextPolicy.views[0].id = 'mutated';
  assert.equal(made.contextPolicy.views[0].id, 'symbols');
  assert.equal(Object.isFrozen(raw.contextPolicy), false);
  assert.ok(Object.isFrozen(made.contextPolicy.views[0]));
});

test('CI1: Coordinator snapshots a raw brief before async adapter admission', async () => {
  const gate = deferred();
  let observed;
  const ad = adapter({
    spawn: async (_worker, admittedBrief, opts) => {
      await opts.worktreeReady;
      await gate.promise;
      observed = admittedBrief;
      return { ok: true };
    },
  });
  const { coordinator } = harness({ ad });
  const raw = brief();
  await coordinator.spawn('stub', raw, { taskId: 'snapshot-brief' });
  raw.goal = 'mutated goal';
  raw.verification.command = 'true';
  gate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(observed.goal, 'original goal');
  assert.equal(observed.verification.command, 'test -f original.txt');
  assert.notEqual(observed, raw);
});

test('CI1: invalid raw brief is rejected before a task or worker is allocated', async () => {
  const { coordinator } = harness();
  await assert.rejects(() => coordinator.spawn('stub', { goal: '' }), /validation|brief|verification/i);
  assert.deepEqual(coordinator.list(), []);
});

test('CI2: adapter Ack{ok:false} keeps a question pending and is returned honestly', async () => {
  const ad = adapter({ answer: async () => ({ ok: false, reason: 'wire refused' }) });
  const { coordinator, log } = harness({ ad });
  const h = await coordinator.spawn('stub', brief(), { taskId: 'respond-refusal' });
  ad._cb({
    worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'question.asked',
    payload: { requestId: 'q-1', question: 'continue?', blocking: true },
  });
  const ack = await coordinator.respond('q-1', { text: 'yes' });
  assert.equal(ack.ok, false);
  assert.equal(coordinator.list()[0].pendingQuestionId, 'q-1');
  assert.equal(coordinator.list()[0].status, 'blocked');
  assert.equal(log.read(h.id).some((e) => e.kind === 'question.answered'), false);
});

test('CI2: thrown response delivery rolls back so a later retry can win', async () => {
  let attempts = 0;
  const ad = adapter({
    answer: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('pipe failed');
      return { ok: true };
    },
  });
  const { coordinator } = harness({ ad });
  const h = await coordinator.spawn('stub', brief(), { taskId: 'respond-retry' });
  ad._cb({
    worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'question.asked',
    payload: { requestId: 'q-2', question: 'retry?', blocking: true },
  });
  await assert.rejects(() => coordinator.respond('q-2', { text: 'first' }), /pipe failed/);
  const retry = await coordinator.respond('q-2', { text: 'second' });
  assert.equal(retry.ok, true);
  assert.equal(attempts, 2);
});

test('CI2: a missing Ack is not treated as accepted delivery', async () => {
  const ad = adapter({ answer: async () => undefined });
  const { coordinator } = harness({ ad });
  const h = await coordinator.spawn('stub', brief(), { taskId: 'respond-no-ack' });
  ad._cb({
    worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'question.asked',
    payload: { requestId: 'q-no-ack', question: 'delivered?', blocking: true },
  });
  const result = await coordinator.respond('q-no-ack', { text: 'answer' });
  assert.equal(result.ok, false);
  assert.equal(coordinator.list()[0].pendingQuestionId, 'q-no-ack');
});

test('CI2/CK9: accepted input followed by append failure releases one racing consumer and replay closes failed', async () => {
  const delivery = deferred();
  let answers = 0;
  const ad = adapter({ answer: async () => { answers += 1; await delivery.promise; return { ok: true }; } });
  const { coordinator, coordination, log, worktrees } = harness({ ad });
  const h = await coordinator.spawn('stub', brief(), { taskId: 'respond-post-effect-failure' });
  ad._cb({
    worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'question.asked',
    payload: { requestId: 'q-post-effect', question: 'exactly once?', blocking: true },
  });

  const first = coordinator.respond('q-post-effect', { text: 'first' }, 'human');
  await until(() => answers === 1);
  const second = coordinator.respond('q-post-effect', { text: 'second' }, 'other-human');
  const originalFile = log._file.bind(log);
  log._file = () => join(tmpdir(), 'baton-missing-parent', `${Date.now()}`, 'events.jsonl');
  delivery.resolve();

  await assert.rejects(first, (error) => error.code === 'operational_log_unavailable');
  assert.deepEqual(await Promise.race([second, sleep(100).then(() => ({ result: 'timeout' }))]), {
    ok: false, result: 'already_resolved', resolution: { text: 'first' },
  });
  assert.equal(answers, 1, 'the racing consumer must never redeliver an accepted answer');
  assert.equal(coordinator._pending.get('q-post-effect').state, 'resolved');
  assert.throws(() => coordinator.list(), (error) => error.code === 'operational_log_unavailable');

  log._file = originalFile;
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { stub: adapter({ card: { concurrencyCeiling: 0 } }) },
    worktrees, repoRoot: tmpdir(), referee: async () => ({}), route: () => 'stub',
    approvalTimeoutMs: 1000, stopDeadlineMs: 50,
  });
  assert.equal(coordination.task('respond-post-effect-failure').status, 'failed');
  assert.equal(replay.list()[0].status, 'orphaned');
});

test('CI2/CK9: accepted approval append failure also releases one racing consumer without redelivery', async () => {
  const delivery = deferred();
  let approvals = 0;
  const ad = adapter({ approve: async () => { approvals += 1; await delivery.promise; return { ok: true }; } });
  const { coordinator, log } = harness({ ad });
  const h = await coordinator.spawn('stub', brief(), { taskId: 'approval-post-effect-failure' });
  ad._cb({
    worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'approval.requested',
    payload: { requestId: 'a-post-effect', tool: 'shell', blocking: true },
  });

  const first = coordinator.respond('a-post-effect', { decision: 'allow' }, 'human');
  await until(() => approvals === 1);
  const second = coordinator.respond('a-post-effect', { decision: 'deny' }, 'other-human');
  log._file = () => join(tmpdir(), 'baton-missing-parent', `${Date.now()}`, 'events.jsonl');
  delivery.resolve();

  await assert.rejects(first, (error) => error.code === 'operational_log_unavailable');
  assert.deepEqual(await Promise.race([second, sleep(100).then(() => ({ result: 'timeout' }))]), {
    ok: false, result: 'already_resolved', resolution: { decision: 'allow' },
  });
  assert.equal(approvals, 1);
  assert.equal(coordinator._pending.get('a-post-effect').state, 'resolved');
  assert.throws(() => coordinator.list(), (error) => error.code === 'operational_log_unavailable');
});

test('CI3: kill after a crash settles already_dead without waiting for a new confirmation', async () => {
  let removed = 0;
  const ad = adapter({ kill: async () => ({ ok: true }) });
  const { coordinator } = harness({
    ad,
    worktrees: { remove: async () => { removed += 1; } },
    stopDeadlineMs: 5000,
  });
  const h = await coordinator.spawn('stub', brief(), { taskId: 'already-crashed' });
  ad._cb({ worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'lifecycle.crashed', payload: { error: 'timeout' } });
  const result = await Promise.race([
    coordinator.kill(h.id, 'policy'),
    new Promise((resolve) => setTimeout(() => resolve({ result: 'test_timeout' }), 50)),
  ]);
  assert.equal(result.result, 'already_dead');
  assert.equal(removed, 1);
});

test('CI4: model-authored content is prose, never a hub-computed fact', async () => {
  const ad = adapter();
  const { coordinator } = harness({ ad });
  const h = await coordinator.spawn('stub', brief(), { taskId: 'provenance' });
  ad._cb({ worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'content.message', payload: { text: 'model claim' } });
  const digest = await coordinator.wait(0);
  const prose = digest.prose.find((item) => item.text === 'model claim');
  assert.ok(prose);
  assert.equal(isProse(prose), true);
  assert.equal(digest.facts.some((item) => item.kind === 'content.message'), false);
  assert.equal(digest.facts.every(isFact), true);
});

test('CI4: worker result narrative is prose and never nested in a trusted lifecycle fact', async () => {
  const ad = adapter();
  const { coordinator } = harness({ ad });
  const h = await coordinator.spawn('stub', brief(), { taskId: 'result-provenance' });
  ad._cb({
    worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'lifecycle.turn_completed',
    payload: {
      status: 'completed', summary: 'I changed the parser', openQuestions: ['Was the edge case covered?'],
      artifacts: { files: ['src/parser.mjs'] }, verification: { command: 'true', claimedExit: 0 },
    },
  });
  const digest = await coordinator.wait(0);
  assert.ok(digest.prose.some((item) => item.text === 'I changed the parser' && isProse(item)));
  assert.ok(digest.prose.some((item) => item.text === 'Was the edge case covered?' && isProse(item)));
  const lifecycle = digest.facts.find((item) => item.kind === 'lifecycle.turn_completed');
  assert.ok(lifecycle && isFact(lifecycle));
  assert.equal(lifecycle.data.status, 'completed');
  assert.equal(JSON.stringify(lifecycle).includes('I changed the parser'), false);
});

test('CI3: driver-level wall timeout reaps the real child, worktree, metadata, and task branch', async (t) => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'baton-p11-repo-'));
  const logDir = mkdtempSync(join(tmpdir(), 'baton-p11-driver-log-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  git(['init', '-q'], repoRoot);
  git(['config', 'user.email', 'baton-test@example.com'], repoRoot);
  git(['config', 'user.name', 'Baton Test'], repoRoot);
  git(['commit', '--allow-empty', '-q', '-m', 'base'], repoRoot);

  const cli = new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], killGraceMs: 20 });
  const { coordinator, log } = createDriver({
    repoRoot,
    logDir,
    adapters: { claude: cli },
    stopDeadlineMs: 250,
  });
  const timed = brief('HOLD_UNTIL_INTERRUPT');
  // Keep the integration budget above fixture process startup jitter in the bare parallel suite;
  // the assertion is about real timeout cleanup after a wire session exists.
  timed.budget.wallMin = 0.01;
  const h = await coordinator.spawn('claude', timed, { taskId: 'timeout-reap' });
  const crashed = await until(() => log.read(h.id).find((e) => e.kind === 'lifecycle.crashed' && e.payload?.phase === 'timeout'));
  const pid = log.read(h.id).find((e) => e.kind === 'lifecycle.spawned' && e.actor === 'worker')?.payload?.pid;
  assert.ok(pid, 'a real child process must have existed');
  assert.ok(crashed);

  const killed = await coordinator.kill(h.id, 'policy');
  assert.equal(killed.result, 'already_dead');
  await until(() => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  });
  assert.equal(existsSync(join(repoRoot, '.baton', 'wt', 'timeout-reap')), false);
  assert.equal(existsSync(join(repoRoot, '.baton', 'wt', 'timeout-reap.meta.json')), false);
  assert.equal(git(['branch', '--list', 'baton/timeout-reap'], repoRoot), '');
});

test('CI5: wire spawn enriches task identity and duplicate turn-start does not double count', () => {
  let state = initialState();
  state = foldEvent(state, { worker: 'w-1', harness: 'claude', seq: 1, ts: '2026-01-01T00:00:00Z', turnEpoch: 1, actor: 'orchestrator', kind: 'lifecycle.spawned', payload: { taskId: 't-1', brief: brief() } });
  state = foldEvent(state, { worker: 'w-1', harness: 'claude', seq: 2, ts: '2026-01-01T00:00:01Z', turnEpoch: 2, actor: 'orchestrator', kind: 'lifecycle.turn_started', payload: {} });
  state = foldEvent(state, { worker: 'w-1', harness: 'claude', seq: 3, ts: '2026-01-01T00:00:02Z', turnEpoch: 1, actor: 'worker', kind: 'lifecycle.spawned', payload: { sessionId: 's-1' } });
  state = foldEvent(state, { worker: 'w-1', harness: 'claude', seq: 4, ts: '2026-01-01T00:00:03Z', turnEpoch: 1, actor: 'worker', kind: 'lifecycle.turn_started', payload: { sessionId: 's-1' } });
  const worker = state.workers.get('w-1');
  assert.equal(worker.taskId, 't-1');
  assert.equal(worker.brief.goal, 'original goal');
  assert.equal(worker.turnCount, 1);
});

test('CI6: replay advances automatic task and worker IDs without collision', async () => {
  const log = new Log(mkdtempSync(join(tmpdir(), 'baton-p11-replay-')));
  log.append({
    worker: 'w-1', harness: 'stub@1', turnEpoch: 1, actor: 'orchestrator',
    kind: 'lifecycle.spawned', payload: { taskId: 'task-1', brief: brief() },
  });
  log.append({
    worker: 'w-1', harness: 'stub@1', turnEpoch: 1, actor: 'worker',
    kind: 'lifecycle.crashed', payload: { error: 'old' },
  });
  const { coordinator } = harness({ log });
  const next = await coordinator.spawn('stub', brief('new goal'));
  assert.equal(next.id, 'w-2');
  assert.equal(next.taskId, 'task-2');
  assert.equal(coordinator.list().length, 2);
});

test('CI6: replay terminalizes an unattached in-flight session instead of fabricating control', async () => {
  const log = new Log(mkdtempSync(join(tmpdir(), 'baton-p11-orphan-')));
  let killCalls = 0;
  const ad = adapter({ kill: async () => { killCalls += 1; return { ok: true }; } });
  log.append({
    worker: 'w-7', harness: 'stub@1', turnEpoch: 1, actor: 'orchestrator',
    kind: 'lifecycle.spawned', payload: { taskId: 'task-7', brief: brief() },
  });
  log.append({
    worker: 'w-7', harness: 'stub@1', turnEpoch: 2, actor: 'orchestrator',
    kind: 'lifecycle.turn_started', payload: {},
  });
  const { coordinator } = harness({ log, ad });
  assert.equal((await coordinator.result('w-7')).status, 'failed');
  assert.equal(coordinator.list().find((w) => w.id === 'w-7').status, 'orphaned');
  const stop = await coordinator.kill('w-7', 'policy');
  assert.equal(stop.result, 'session_not_attached');
  assert.equal(stop.ok, false);
  assert.equal(log.read('w-7').filter((e) => e.kind === 'control.recovery_terminalized').length, 1);
  assert.equal(killCalls, 0, 'an unattached replay must never target an arbitrary fresh adapter instance');
});
