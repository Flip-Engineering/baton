// Issue #386 red-first row: the recovery dispatch must not hand an adapter a wall-budget clock.
//
// #163 law (operator ruling): no wall-time clock feeds a member's fate — fate rests on evidence
// only. The ordinary spawn seam (runtime-effects.mjs) passes no timeoutMs for exactly that reason,
// while the two recovery dispatches in runtime-recovery.mjs used to derive one from
// brief.budget.wallMin. That derivation is inert for the spawn adapter, notify-only for the CLI
// adapters, and a session kill for the mock adapter (adapter.mjs _triggerTimeout) — a recovered
// member still faced a clock that could decide its fate. These rows pin the recovery dispatch
// options: behaviourally through both recovery entry points, and structurally on the two option
// objects themselves.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { _reattachPreservedSession } from '../src/runtime-recovery.mjs';

// The fixture brief admits a 5 minute wall budget, so a derived timeout would be 300_000 ms.
const WALL_MIN = 5;
const WALL_MS = WALL_MIN * 60_000;

function brief() {
  return {
    goal: 'recover one exact native session', constraints: [], pathScope: ['**'],
    definitionOfDone: 'the recovered turn is durably governed',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 1, wallMin: WALL_MIN },
  };
}

function card() {
  return {
    harness: 'session', version: 'issue386', authPosture: 'none',
    concurrencyCeiling: 2, maxContext: 1_000,
    verbs: {
      spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
      approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported',
    },
    modelSelection: {
      mode: 'exact', configuredDefault: null, available: null, family: 'test',
      acceptedPrefixes: ['test-'], acceptedAliases: [], reasoningEffort: ['low', 'high'],
      configuredEffort: 'low', serviceTier: null, provenance: 'test', refreshedAt: null,
    },
    sessions: { multiTurn: 'native', resume: 'native', fork: 'native' },
  };
}

function recordingAdapter() {
  const calls = { spawn: [] };
  return {
    calls,
    callback: null,
    onEvent(callback) { this.callback = callback; },
    card,
    emit(worker, kind, payload = {}, turnEpoch = 1, actor = 'worker') {
      this.callback?.({ worker, harness: 'session', turnEpoch, actor, kind, payload });
    },
    async spawn(...args) { calls.spawn.push(args); return { ok: true }; },
    async prompt() { return { ok: true }; },
    async promptBrief() { return { ok: true }; },
    async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
  };
}

function completed(summary = 'done') {
  return {
    status: 'completed', summary, artifacts: { files: [] },
    verification: { command: 'true', claimedExit: 0 },
  };
}

function assertNoWallDerivedTimeout(options, label) {
  assert.notEqual(options, undefined, `${label}: the adapter received its options object`);
  assert.equal(Object.hasOwn(options, 'timeoutMs'), false,
    `${label}: the recovery dispatch must not pass a timeoutMs option to the adapter`);
  assert.equal(Object.values(options).includes(WALL_MS), false,
    `${label}: no option carries the wall budget converted to milliseconds`);
}

// ---- behavioural: the _recover dispatch -------------------------------------

async function until(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not met');
}

// The coordinator's recovery deadline is deliberately timer-unref'd, and this fixture drives an
// in-process adapter that owns no child handle, so hold the loop for the bounded recovery await.
async function withLiveLoop(fn) {
  const hold = setInterval(() => {}, 1_000);
  try { return await fn(); } finally { clearInterval(hold); }
}

async function recoverableSession(name) {
  const taskId = `issue386-${name}`;
  const nativeId = `native-${name}`;
  const worktree = mkdtempSync(join(tmpdir(), `baton-issue386-${name}-wt-`));
  const log = new Log(mkdtempSync(join(tmpdir(), `baton-issue386-${name}-log-`)));
  const coordination = new CoordinationStore(
    mkdtempSync(join(tmpdir(), `baton-issue386-${name}-coordination-`)),
    { operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null },
  );
  const firstAdapter = recordingAdapter();
  const original = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: firstAdapter }, repoId: `repo-${name}`,
    worktrees: {
      create: async () => ({ path: worktree, branch: `baton/${taskId}`, baseSha: 'base-1' }),
      capture: async () => ({ sha: 'x', snapshotted: false }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'session',
    approvalTimeoutMs: 1_000, stopDeadlineMs: 50, recoveryTimeoutMs: 50, recoveryMaxAttempts: 3,
  });
  const handle = await original.spawn('session', brief(), { taskId, model: 'test-recover', effort: 'high' });
  await until(() => original.list()[0].sessionContext);
  firstAdapter.emit(handle.id, 'lifecycle.spawned', { sessionId: nativeId, pid: 111 });
  firstAdapter.emit(handle.id, 'lifecycle.turn_completed', completed('before restart'));
  await until(async () => (await original.result(handle.id)).ready);

  const resumed = recordingAdapter();
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed }, repoId: `repo-${name}`,
    worktrees: {
      create: async () => ({}), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
      validateSessionContext: async (context) => ({ ok: context.worktree === worktree }),
    },
    runtimeScopes: {
      reconcile: () => {},
      create: () => ({ env: {}, replaceEnv: true, posture: { root: '/runtime/issue386' } }),
      remove: () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'session',
    approvalTimeoutMs: 1_000, stopDeadlineMs: 50, recoveryTimeoutMs: 50, recoveryMaxAttempts: 3,
    startupRecoveryAuthority: Object.freeze({}),
  });
  assert.equal(replay.list()[0].status, 'orphaned', 'the replay coordinator adopts the session as orphaned');
  return { replay, resumed, handle };
}

test('#386 behavioural: the _recover dispatch hands the adapter no wall-budget timeoutMs', async () => {
  const fixture = await recoverableSession('recover');
  const outcome = await withLiveLoop(() => fixture.replay.recover(fixture.handle.id));

  assert.equal(fixture.resumed.calls.spawn.length, 1,
    `the recovery path dispatched exactly once (outcome: ${outcome?.result ?? 'none'})`);
  const [worker, attachBrief, options] = fixture.resumed.calls.spawn[0];
  assert.equal(worker, fixture.handle.id);
  assert.equal(attachBrief.budget.wallMin, WALL_MIN,
    'the brief still admits the advisory wall budget (inert for fate, per #163)');
  assert.equal(options.attachOnly, true, 'the dispatch is the recovery attach seam');
  assert.equal(options.signal instanceof AbortSignal, true,
    'the cancellation signal rides the seam unchanged');
  assertNoWallDerivedTimeout(options, 'recover');
});

// ---- behavioural: the _reattachPreservedSession dispatch --------------------

test('#386 behavioural: preserved reattachment hands the adapter no wall-budget timeoutMs', async () => {
  const adapter = recordingAdapter();
  const handle = {
    id: 'issue386-worker', taskId: 'issue386-task', status: 'orphaned', vendor: 'session',
    sessionRef: { id: 'issue386-native', persistence: 'native' },
    sessionContext: { worktree: '/tmp/issue386-worktree', ownerTaskId: 'issue386-task' },
    processGeneration: 3, processRef: null, processAuthority: null,
    modelResolved: 'test-model', effortResolved: 'low', workerPolicyResolution: null, modelPolicy: null,
    sessionPreservation: { state: 'preserved' },
  };
  const task = { id: 'issue386-task', runId: null, brief: brief() };
  const recorder = {
    log: { append: () => ({ seq: 1 }) },
    mapEvent: (event) => event,
    recordDriver: () => {},
    coordination: {},
  };
  // The preserved-reattachment authority predicates need a signature-bound receipt and a durable
  // preserve-turn control; this row stubs only those predicates so the dispatch options stay the
  // real ones the function builds. A stub that breaks the fixture fails the spawn-count assertion.
  const coordinator = {
    _recoveryTimeoutMs: 50,
    _adapters: { session: adapter },
    _preservedProcesslessAttachAuthority: Object.freeze({}),
    _exactPreservedRecoveryContext: () => ({
      ok: true, context: { worktree: '/tmp/issue386-worktree', ownerTaskId: 'issue386-task' },
    }),
    _exactProcesslessPreservationAuthority: () => ({ ok: true, processless: false, card: card() }),
    _validateSessionContext: async () => {},
    _ensureRuntimeScope: () => ({ env: {}, replaceEnv: false }),
    _setTimeout: (fn, ms) => setTimeout(fn, ms),
    _clearTimeout: (timer) => clearTimeout(timer),
    _harnessOf: () => 'session',
    _safeTurnEpoch: () => 1,
    _routeAttribution: () => ({}),
    _failPreservedReattachment: (_handle, _task, result) => ({ ok: false, result }),
  };

  const outcome = await _reattachPreservedSession(coordinator, recorder, handle, task, {});

  assert.equal(adapter.calls.spawn.length, 1,
    `the preserved reattachment dispatched exactly once (outcome: ${outcome?.result ?? 'none'})`);
  const [worker, preservationBrief, options] = adapter.calls.spawn[0];
  assert.equal(worker, handle.id);
  assert.equal(preservationBrief.budget.wallMin, WALL_MIN,
    'the brief still admits the advisory wall budget (inert for fate, per #163)');
  assert.equal(options.attachOnly, true, 'the dispatch is the preserved-attach seam');
  assert.equal(options.signal instanceof AbortSignal, true,
    'the cancellation signal rides the seam unchanged');
  assertNoWallDerivedTimeout(options, 'reattachPreservedSession');
});

// ---- structural: both recovery dispatch option objects ----------------------

const RECOVERY_SOURCE = readFileSync(new URL('../src/runtime-recovery.mjs', import.meta.url), 'utf8');
const DISPATCH_CALL = '.then(() => adapter.spawn(';

// Full-line comments are dropped so the pin reads code, not the #163 note left beside it.
function codeOnly(text) {
  return text.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
}

function recoveryDispatchOptions(source) {
  const regions = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(DISPATCH_CALL, from);
    if (start === -1) break;
    const end = source.indexOf('.then((ack)', start);
    assert.notEqual(end, -1, 'the recovery dispatch options are closed by their ack consumer');
    regions.push(codeOnly(source.slice(start, end)));
    from = start + DISPATCH_CALL.length;
  }
  return regions;
}

test('#386 pin: neither recovery dispatch option object derives a timeout from the wall budget', () => {
  const regions = recoveryDispatchOptions(RECOVERY_SOURCE);
  assert.equal(regions.length, 2,
    'both recovery dispatches (_recover and _reattachPreservedSession) are pinned');
  for (const region of regions) {
    assert.equal(region.includes('attachOnly: true'), true, 'the region is a recovery attach spawn call');
    assert.equal(region.includes('signal:'), true, 'the region carries the cancellation signal');
    assert.equal(region.includes('timeoutMs'), false,
      'no timeoutMs option rides the recovery dispatch');
    assert.equal(region.includes('wallMin'), false,
      'no wall-budget derivation rides the recovery dispatch');
  }
});
