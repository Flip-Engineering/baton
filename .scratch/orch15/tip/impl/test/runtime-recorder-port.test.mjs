import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  createRecorderPort,
  detachSharedWorkspace,
  completeDurableRecoveryAttempt,
} from '../src/runtime-recorder-port.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-recorder-port-${name}-`));

function repo() {
  const path = root('repo');
  execFileSync('git', ['init', '-q'], { cwd: path });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: path });
  return path;
}

function fakeLog() {
  const appended = [];
  return {
    appended,
    append(partial) {
      const event = { ...partial, seq: appended.length + 1, worker: partial.worker ?? 'w' };
      appended.push(event);
      return event;
    },
  };
}

function fakeCoordination() {
  const mapped = [];
  const completed = [];
  return {
    mapped,
    completed,
    mapOperationalEvent(event, opts) {
      const entry = { event, opts };
      mapped.push(entry);
      return { evidence: { seq: event?.seq, key: opts?.key } };
    },
    completeRecoveryAttempt(completion, opts) {
      const entry = { completion, opts };
      completed.push(entry);
      return { attempt: { ...completion, state: completion.state, completedAt: Date.now() } };
    },
  };
}

// ── RP1: createRecorderPort validates and freezes ────────────────────────

test('RP1: createRecorderPort rejects a missing log and freezes a valid port', () => {
  assert.throws(() => createRecorderPort({ log: null, coordination: null, route: null }),
    { message: /log with append/ });
  assert.throws(() => createRecorderPort({ log: {}, coordination: null, route: null }),
    { message: /log with append/ });

  const log = fakeLog();
  const coordination = fakeCoordination();
  const port = createRecorderPort({ log, coordination, route: null });

  assert.equal(port.log, log);
  assert.equal(port.coordination, coordination);
  assert.equal(port.route, null);
  assert.equal(typeof port.mapEvent, 'function');
  assert.equal(typeof port.recordDriver, 'function');
  assert.ok(Object.isFrozen(port));
});

// ── RP2: the port is injected on a real coordinator ──────────────────────

test('RP2: a real driver carries the injected recorder port on its coordinator', async (t) => {
  const repository = repo();
  const logDir = root('log');
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-recorder-port', logDir,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [] }, card: { harness: 'mock', version: 'rp-1', model: 'rp-model' } }) },
  });
  t.after(async () => {
    await driver.drainAndClose('rp-test').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const recorder = driver.coordinator._recorder;
  assert.ok(recorder, 'the coordinator must hold the injected recorder port');
  assert.equal(typeof recorder.log.append, 'function', 'recorder.log.append must be a function');
  assert.equal(typeof recorder.mapEvent, 'function', 'recorder.mapEvent must be a function');
  assert.equal(typeof recorder.recordDriver, 'function', 'recorder.recordDriver must be a function');
});

// ── RP3: _detachSharedWorkspace records through the port ─────────────────

test('RP3: the effect proof consumer (_detachSharedWorkspace) records a log event and maps it through the port', async () => {
  const log = fakeLog();
  const coordination = fakeCoordination();
  const recorder = createRecorderPort({ log, coordination, route: null });

  const fakeCoordinator = {
    _harnessOf: () => 'mock@rp-1',
    _safeTurnEpoch: () => 42,
    _routeAttribution: () => ({ taskId: 't1', runId: 'r1', harnessRequested: null, harnessResolved: 'mock@rp-1', modelRequested: null, modelResolved: null, modelObserved: null, effortRequested: null, effortResolved: null, effortObserved: null }),
  };

  const handle = {
    id: 'worker-1',
    vendor: 'mock',
    sessionContext: { ownerTaskId: 'phys-1' },
    runtimeScope: { active: true },
    worktree: '/some/path',
    ownedWorktreeAuthority: true,
    physicalWorkspaceCleanupCompleted: false,
    workspaceCleanupDeferred: null,
    cleanupPending: false,
    cleanupError: null,
  };

  const result = await detachSharedWorkspace(fakeCoordinator, recorder, handle, ['holder-a']);

  assert.equal(result.ok, true);
  assert.equal(result.result, 'workspace_cleanup_deferred');
  assert.equal(result.reason, 'holders_remain');
  assert.equal(result.physicalOwnerId, 'phys-1');
  assert.deepEqual(result.holders, ['holder-a']);

  assert.equal(handle.worktree, null, 'the handle worktree must be cleared');
  assert.equal(handle.ownedWorktreeAuthority, false);
  assert.equal(handle.workspaceCleanupDeferred, 'holders_remain');
  assert.equal(handle.cleanupPending, true, 'cleanupPending follows runtimeScope.active');

  assert.equal(log.appended.length, 1, 'exactly one log event must be appended');
  const event = log.appended[0];
  assert.equal(event.kind, 'worktree.custody_deferred');
  assert.equal(event.worker, 'worker-1');
  assert.equal(event.harness, 'mock@rp-1');
  assert.equal(event.turnEpoch, 42);
  assert.equal(event.actor, 'policy');
  assert.deepEqual(event.payload.holders, ['holder-a']);
  assert.equal(event.payload.reason, 'holders_remain');
  assert.equal(event.payload.physicalOwnerId, 'phys-1');

  assert.equal(coordination.mapped.length, 1, 'exactly one coordination map must follow the log append');
  assert.equal(coordination.mapped[0].event.seq, event.seq);
});

// ── RP4: _completeDurableRecoveryAttempt records through the port ─────────

test('RP4: the recovery proof consumer (_completeDurableRecoveryAttempt) writes through the coordination store on the port', () => {
  const log = fakeLog();
  const coordination = fakeCoordination();
  const recorder = createRecorderPort({ log, coordination, route: null });

  const attemptId = 'recovery-attempt:' + 'a'.repeat(64);
  const admissionDigest = 'b'.repeat(64);
  const attempt = {
    attemptId,
    admissionDigest,
    state: 'pending',
  };

  const result = completeDurableRecoveryAttempt(recorder, attempt, 'closed', 'policy');

  assert.equal(coordination.completed.length, 1, 'exactly one completeRecoveryAttempt call');
  const call = coordination.completed[0];
  assert.equal(call.completion.attemptId, attemptId);
  assert.equal(call.completion.admissionDigest, admissionDigest);
  assert.equal(call.completion.state, 'closed');
  assert.deepEqual(call.completion.receipt, {
    schemaVersion: 1,
    effectStarted: true,
    transportDisposition: 'closed',
  });
  assert.equal(call.opts.actor, 'policy');
  assert.equal(call.opts.key, `recovery.attempt.complete:${attemptId}`);

  assert.equal(result.state, 'closed');
  assert.equal(log.appended.length, 0, 'the recovery consumer does not append to the log');
});

test('RP4b: a non-pending attempt returns without recording', () => {
  const log = fakeLog();
  const coordination = fakeCoordination();
  const recorder = createRecorderPort({ log, coordination, route: null });

  assert.equal(completeDurableRecoveryAttempt(recorder, null, 'confirmed', 'policy'), null);
  assert.equal(completeDurableRecoveryAttempt(recorder, { state: 'completed' }, 'confirmed', 'policy').state, 'completed');
  assert.equal(coordination.completed.length, 0, 'no coordination write for a non-pending attempt');
});

// ── RP5: mapEvent and recordDriver helpers ───────────────────────────────

test('RP5: mapEvent delegates to coordination.mapOperationalEvent with the evidence key', () => {
  const log = fakeLog();
  const coordination = fakeCoordination();
  const port = createRecorderPort({ log, coordination, route: null });

  assert.equal(port.mapEvent(null), null, 'null event produces null');

  const event = { worker: 'w1', seq: 7 };
  const evidence = port.mapEvent(event);
  assert.equal(coordination.mapped.length, 1);
  assert.equal(coordination.mapped[0].opts.key, 'evidence:w1:7');
  assert.equal(coordination.mapped[0].opts.actor, 'policy');
  assert.ok(evidence);
});

test('RP5b: mapEvent returns null when coordination is absent', () => {
  const log = fakeLog();
  const port = createRecorderPort({ log, coordination: null, route: null });
  assert.equal(port.mapEvent({ worker: 'w1', seq: 1 }), null);
});

test('RP5c: recordDriver calls recordDriver or recordAuthorityRejected', () => {
  const log = fakeLog();
  const driven = [];
  const rejections = [];
  const coordination = {
    mapOperationalEvent: () => ({ evidence: {} }),
    recordDriver(kind, payload, opts) {
      driven.push({ kind, payload, opts });
      return { event: { seq: driven.length } };
    },
    recordAuthorityRejected(payload, opts) {
      rejections.push({ payload, opts });
      return { event: { seq: rejections.length + 100 } };
    },
  };
  const port = createRecorderPort({ log, coordination, route: null });

  const e1 = port.recordDriver('task.created', { id: 't1' }, 'key-1');
  assert.equal(driven.length, 1);
  assert.equal(driven[0].kind, 'task.created');
  assert.equal(driven[0].opts.key, 'key-1');
  assert.equal(driven[0].opts.actor, 'policy');

  const e2 = port.recordDriver('authority.rejected', { id: 't2' }, 'key-2', 'test');
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0].opts.actor, 'test');
});

// ── RP6: the delegates retain name and arity ─────────────────────────────

test('RP6: the coordinator delegates retain the original member names and arities', async (t) => {
  const { Coordinator } = await import('../src/coordinator.mjs');
  const proto = Coordinator.prototype;

  assert.equal(typeof proto._detachSharedWorkspace, 'function',
    '_detachSharedWorkspace must exist on Coordinator.prototype');
  assert.equal(proto._detachSharedWorkspace.length, 2,
    '_detachSharedWorkspace(handle, remainingHolders) must have arity 2');

  assert.equal(typeof proto._completeDurableRecoveryAttempt, 'function',
    '_completeDurableRecoveryAttempt must exist on Coordinator.prototype');
  assert.equal(proto._completeDurableRecoveryAttempt.length, 3,
    '_completeDurableRecoveryAttempt(attempt, state, actor) must have arity 3');
});
