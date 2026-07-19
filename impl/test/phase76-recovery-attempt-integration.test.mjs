import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import {
  createRecoveryAttemptAdmission,
  createRecoveryAttemptCompletion,
} from '../src/recovery-attempt.mjs';

const repoId = 'repo-phase76-recovery-integration';
const runId = 'run-phase76-recovery-integration';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function brief() {
  return {
    goal: 'recover one exact native session', constraints: [], pathScope: ['**'],
    definitionOfDone: 'the recovered turn is durably governed',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 1, wallMin: 5 },
  };
}

function card() {
  return {
    harness: 'session', version: 'phase76', authPosture: 'none',
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

function adapter(overrides = {}) {
  const calls = { spawn: [], prompt: [], kill: [] };
  return {
    calls,
    callback: null,
    onEvent(callback) { this.callback = callback; },
    card,
    emit(worker, kind, payload = {}, turnEpoch = 1, actor = 'worker') {
      this.callback?.({ worker, harness: 'session', turnEpoch, actor, kind, payload });
    },
    async spawn(...args) {
      calls.spawn.push(args);
      return overrides.spawn ? overrides.spawn.call(this, ...args) : { ok: true };
    },
    async prompt(...args) {
      calls.prompt.push(args);
      return overrides.prompt ? overrides.prompt.call(this, ...args) : { ok: true };
    },
    async promptBrief(worker, taskBrief) { return this.prompt(worker, taskBrief, 'turn'); },
    async interrupt() { return { ok: true }; },
    async kill(worker) {
      calls.kill.push([worker]);
      if (overrides.kill) return overrides.kill.call(this, worker);
      this.emit(worker, 'kill.confirmed');
      return { ok: true };
    },
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

async function until(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition not met');
}

async function recoverableSession(name, options = {}) {
  const taskId = `phase76-${name}`;
  const nativeId = `native-${name}`;
  const worktree = mkdtempSync(join(tmpdir(), `baton-phase76-${name}-wt-`));
  const log = new Log(mkdtempSync(join(tmpdir(), `baton-phase76-${name}-log-`)));
  const coordination = new CoordinationStore(
    mkdtempSync(join(tmpdir(), `baton-phase76-${name}-coordination-`)),
    { operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null },
  );
  const firstAdapter = adapter();
  const original = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: firstAdapter }, repoId,
    worktrees: {
      create: async () => ({ path: worktree, branch: `baton/${taskId}`, baseSha: 'base-1' }),
      capture: async () => ({ sha: 'x', snapshotted: false }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'session',
    approvalTimeoutMs: 1_000, stopDeadlineMs: 50, recoveryTimeoutMs: 50,
    recoveryMaxAttempts: 3,
  });
  const handle = await original.spawn('session', brief(), {
    taskId, model: 'test-recover', effort: 'high',
  });
  await until(() => original.list()[0].sessionContext);
  firstAdapter.emit(handle.id, 'lifecycle.spawned', { sessionId: nativeId, pid: 111 });
  firstAdapter.emit(handle.id, 'lifecycle.turn_completed', completed('before restart'));
  await until(async () => (await original.result(handle.id)).ready);

  const timeline = [];
  const resumed = adapter(options.adapter ?? {});
  const removedScopes = [];
  const startupRecoveryAuthority = Object.freeze({});
  const replay = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { session: resumed }, repoId,
    worktrees: {
      create: async () => ({}), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
      validateSessionContext: async (context) => ({ ok: context.worktree === worktree }),
    },
    runtimeScopes: {
      reconcile: () => {},
      create: (worker) => {
        timeline.push('runtime');
        return { env: {}, replaceEnv: true, posture: { root: `/runtime/${worker}` } };
      },
      remove: (worker) => removedScopes.push(worker),
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'session',
    approvalTimeoutMs: 1_000,
    stopDeadlineMs: options.stopDeadlineMs ?? 50,
    recoveryTimeoutMs: options.recoveryTimeoutMs ?? 50,
    recoveryMaxAttempts: options.recoveryMaxAttempts ?? 3,
    startupRecoveryAuthority,
  });
  assert.equal(replay.list()[0].status, 'orphaned');
  return {
    coordination, handle, log, nativeId, removedScopes, replay, resumed,
    startupRecoveryAuthority, timeline, worktree,
  };
}

function attemptEvents(coordination) {
  return coordination.events().filter((event) => event.kind.startsWith('recovery.attempt_'));
}

function seedAttempt(fixture, state) {
  const task = fixture.coordination.task(fixture.handle.taskId);
  const terminal = fixture.coordination.events()[task.terminalEvent - 1];
  const admission = createRecoveryAttemptAdmission({
    repoId,
    runId: task.runId ?? null,
    attempt: 1,
    maxAttempts: 3,
    expectedAttemptHeadEvent: null,
    priorTask: { id: task.id, version: task.version, terminalEvent: task.terminalEvent },
    verifiedOwner: {
      workerId: fixture.handle.id,
      evidence: { coordinationSeq: terminal.payload.evidence.coordinationSeq },
    },
    session: {
      idDigest: digest(fixture.nativeId),
      contextDigest: digest(fixture.replay.list()[0].sessionContext),
      nextProcessGeneration: 2,
    },
    route: {
      tupleKey: task.routeKey,
      adapterCardDigest: digest(card()),
      modelPolicyDigest: digest(task.modelPolicy ?? null),
    },
    workerPolicy: null,
    authority: {
      gateDigest: digest(null),
      profileDigest: digest({ source: 'startup-policy' }),
      recoveryPolicyDigest: digest({ maxAttempts: 3 }),
    },
  });
  const actor = 'policy:startup-recovery';
  fixture.coordination.admitRecoveryAttempt(admission, {
    actor, key: `recovery.attempt:${admission.attemptId}`,
  });
  if (state !== 'pending') {
    const completion = createRecoveryAttemptCompletion({
      attemptId: admission.attemptId,
      admissionDigest: admission.admissionDigest,
      state,
      receipt: {
        schemaVersion: 1,
        effectStarted: state !== 'not_started',
        transportDisposition: state,
      },
    });
    fixture.coordination.completeRecoveryAttempt(completion, {
      actor, key: `recovery.attempt.complete:${admission.attemptId}`,
    });
  }
  return admission;
}

test('RAI1: application delegates attempt derivation and forwards only deployment-owned maxAttempts', async () => {
  const calls = [];
  const recoveryPolicy = {
    mode: 'manual', maxAttempts: 7, timeoutMs: 4_321,
    eligibleSessionModes: ['resume'], ambiguousDispatch: 'operator_required',
  };
  const goal = { goalId: 'goal-phase76', version: 1, digest: 'a'.repeat(64), runId };
  const recoveryNode = {
    key: 'recover', deps: ['work'],
    capabilities: ['native_session_recovery'], effects: ['provider_call'],
    routes: { harnesses: ['session'], models: ['model-a'], efforts: ['high'] },
  };
  const plan = { planId: 'plan-phase76', version: 1, digest: 'b'.repeat(64), nodes: [recoveryNode] };
  const handle = {
    id: 'worker-phase76', taskId: 'prior-phase76', runId, status: 'orphaned', vendor: 'session',
    sessionRef: { id: 'native-phase76', persistence: 'native' },
    sessionContext: { worktree: '/tmp/phase76', ownerTaskId: 'prior-phase76' },
    modelResolved: 'model-a', effortResolved: 'high', processGeneration: 1,
  };
  const current = {
    goal, plan, approval: { disposition: 'approved' },
    profile: { digest: 'c'.repeat(64), recoveryPolicy },
  };
  const application = Object.create(BatonApplication.prototype);
  Object.assign(application, {
    ready: Promise.resolve(),
    principals: { observer: { actor: 'direct:observer', principalId: 'observer', sessionId: 'observer-session' } },
    driver: {
      coordination: { events: () => [] },
      coordinator: {
        list: () => [{ ...handle }],
        async recoverPlanBound(workerId, request) {
          calls.push({ workerId, request });
          return {
            ok: true, result: 'attached', attempt: 4, workerId,
            taskId: 'recovery-phase76', dispatchDisposition: 'dispatch_accepted',
            processGeneration: 2,
          };
        },
        recoveryDispatchState: () => ({ status: 'dispatch_accepted' }),
      },
    },
    _assertOpen() {},
    _assertRunMutable() {},
    async _authorize() { return true; },
    _findRun() { return current; },
    async _goalPlanStatus() {
      return {
        nodes: [
          { key: 'work', state: 'accepted', taskId: 'prior-phase76' },
          { key: 'recover', state: 'ready', taskId: null },
        ],
      };
    },
    _buildView(_state, _observer, options) { return options; },
  });

  const view = await application.recover(runId, {
    actor: 'direct:operator', principalId: 'operator', sessionId: 'operator-session',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].workerId, handle.id);
  assert.equal(calls[0].request.maxAttempts, recoveryPolicy.maxAttempts);
  assert.equal(Object.hasOwn(calls[0].request, 'attempt'), false,
    'the application must not derive a recovery attempt from a generic ledger count');
  assert.equal(calls[0].request.timeoutMs, recoveryPolicy.timeoutMs);
  assert.equal(view.recovery.attempt, 4, 'only the Coordinator-derived durable attempt is projected');
});

test('RAI2: durable admission precedes provider, operational-log, runtime, and adapter effects', async () => {
  const fixture = await recoverableSession('ordering-success');
  const originalAdmit = fixture.coordination.admitRecoveryAttempt.bind(fixture.coordination);
  fixture.coordination.admitRecoveryAttempt = (...args) => {
    fixture.timeline.push('admit');
    return originalAdmit(...args);
  };
  const originalProvider = fixture.replay._admitProviderTurn.bind(fixture.replay);
  fixture.replay._admitProviderTurn = (...args) => {
    fixture.timeline.push('provider');
    return originalProvider(...args);
  };
  fixture.resumed.spawn = async (worker, _taskBrief, options) => {
    fixture.resumed.calls.spawn.push([worker, _taskBrief, options]);
    fixture.timeline.push('spawn');
    fixture.resumed.emit(worker, 'lifecycle.spawned', { sessionId: fixture.nativeId, pid: 222 });
    return { ok: true };
  };

  const outcome = await fixture.replay.recover(fixture.handle.id);

  assert.equal(outcome.ok, true);
  assert.deepEqual(fixture.timeline.slice(0, 4), ['admit', 'provider', 'runtime', 'spawn']);
  const events = fixture.coordination.events();
  const admission = events.find((event) => event.kind === 'recovery.attempt_admitted');
  const recoveryLogMapping = events.find((event) => event.kind === 'evidence.mapped'
    && event.payload?.kind === 'control.recovery_requested');
  assert.ok(admission && recoveryLogMapping && admission.seq < recoveryLogMapping.seq,
    'the recovery operational log cannot precede durable admission');
  const attempts = attemptEvents(fixture.coordination);
  assert.deepEqual(attempts.map((event) => event.kind), [
    'recovery.attempt_admitted', 'recovery.attempt_completed',
  ]);
  assert.equal(fixture.coordination.recoveryAttempt(attempts[0].payload.attemptId).state, 'attached');
});

test('RAI3: a provider refusal is durably not_started and reaches no log/runtime/adapter effect', async () => {
  const fixture = await recoverableSession('provider-refused');
  fixture.replay._admitProviderTurn = () => ({ ok: false, code: 'provider_capacity' });

  const outcome = await fixture.replay.recover(fixture.handle.id);

  assert.equal(outcome.ok, false);
  assert.equal(outcome.result, 'provider_turn_refused');
  assert.equal(outcome.reason, 'provider_capacity');
  assert.equal(outcome.attempt, 1, 'the refused result still reports the server-derived attempt');
  const attempts = attemptEvents(fixture.coordination);
  assert.deepEqual(attempts.map((event) => event.kind), [
    'recovery.attempt_admitted', 'recovery.attempt_completed',
  ]);
  const durable = fixture.coordination.recoveryAttempt(attempts[0].payload.attemptId);
  assert.equal(durable.state, 'not_started');
  assert.deepEqual(fixture.timeline, []);
  assert.equal(fixture.resumed.calls.spawn.length, 0);
  assert.equal(fixture.log.read(fixture.handle.id)
    .some((event) => event.kind === 'control.recovery_requested'), false);
});

test('RAI4: confirmed cleanup is closed while unconfirmed cleanup is unknown', async (t) => {
  await t.test('confirmed adapter close', async () => {
    const fixture = await recoverableSession('confirmed-close', {
      adapter: { spawn() { throw new Error('attach failed'); } },
    });
    const outcome = await fixture.replay.recover(fixture.handle.id);
    assert.equal(outcome.result, 'recovery_exception');
    const admission = attemptEvents(fixture.coordination)[0];
    assert.equal(fixture.coordination.recoveryAttempt(admission.payload.attemptId).state, 'closed');
    assert.equal(fixture.resumed.calls.kill.length, 1);
  });

  await t.test('timed-out attach with confirmed close', async () => {
    const fixture = await recoverableSession('timeout-closed', {
      recoveryTimeoutMs: 20,
      adapter: { spawn: async () => new Promise(() => {}) },
    });
    const outcome = await fixture.replay.recover(fixture.handle.id);
    assert.equal(outcome.result, 'recovery_timeout');
    const admission = attemptEvents(fixture.coordination)[0];
    assert.equal(fixture.coordination.recoveryAttempt(admission.payload.attemptId).state, 'closed');
    assert.equal(fixture.resumed.calls.kill.length, 1);
  });

  await t.test('unconfirmed adapter close', async () => {
    const fixture = await recoverableSession('unknown-close', {
      stopDeadlineMs: 20,
      adapter: {
        spawn() { throw new Error('attach failed before Ack'); },
        async kill() { return { ok: true }; },
      },
    });
    const outcome = await fixture.replay.recover(fixture.handle.id);
    assert.equal(outcome.result, 'recovery_exception');
    const admission = attemptEvents(fixture.coordination)[0];
    assert.equal(fixture.coordination.recoveryAttempt(admission.payload.attemptId).state, 'unknown');
    assert.equal(fixture.replay._workers.get(fixture.handle.id).cleanupPending, true);
  });
});

test('RAI5: startup selection fences unresolved effects but permits proven retryable outcomes', async (t) => {
  for (const [state, eligible] of [
    ['pending', false], ['unknown', false], ['attached', false],
    ['not_started', true], ['closed', true],
  ]) {
    await t.test(state, async () => {
      const fixture = await recoverableSession(`startup-${state}`);
      seedAttempt(fixture, state);
      fixture.replay.beginStartupRecovery(fixture.startupRecoveryAuthority);
      assert.deepEqual(
        fixture.replay.startupRecoveryCandidates(fixture.startupRecoveryAuthority, 8),
        eligible ? [fixture.handle.id] : [],
        `${state} authority must yield the exact retry eligibility`,
      );
      assert.equal(fixture.resumed.calls.spawn.length, 0);
      fixture.replay.completeStartupRecovery(fixture.startupRecoveryAuthority);
    });
  }
});
