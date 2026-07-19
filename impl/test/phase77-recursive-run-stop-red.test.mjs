// Phase 77 follow-on RED gate — recursive Run subtree stop snapshot and effect fence.
//
// This file is intentionally separate from the lease/lineage slice. It proves only the durable
// target snapshot and prospective descendant fence. Physical transitive kill/reap and its receipt
// remain an application/Coordinator integration gate and cannot be inferred from these tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase77-subtree-stop-${label}-`));
const repoId = 'repo-phase77-subtree-stop';
const policy = Object.freeze({
  schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 4,
  maxDescendantsPerRoot: 16, leaseTtlMs: 60_000,
});

function task(store, runId, label) {
  const id = `task-${label}`;
  const workerId = `worker-${label}`;
  store.createTask({
    id,
    brief: {
      objective: `Own ${runId}`,
      capabilities: ['baton_orchestrator'],
    },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code',
    modelRequested: 'kimi-code/k3', modelPolicy: null, effortRequested: 'max',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${id}` });
  return store.claimTask(id, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${id}`,
  }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
}

function issue(store, parentTask, label) {
  const session = {
    principalId: `recursive-${label}`,
    sessionId: `session-${label}`,
    authorityDigest: digest({ session: label }),
    expiresAt: '2026-07-18T09:00:00.000Z',
  };
  const request = {
    schemaVersion: 1, repoId,
    parentTask: { id: parentTask.id, version: parentTask.version },
    session,
  };
  const identity = {
    repoId, parentRunId: parentTask.runId, parentTaskId: parentTask.id,
    parentTaskVersion: parentTask.version, workerId: parentTask.assignee,
    principalId: session.principalId, sessionId: session.sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  return store.issueRunOrchestratorLease(request, {
    actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}`,
  }).lease;
}

function child(store, lease, childRunId) {
  const request = {
    schemaVersion: 1, repoId, childRunId,
    intentDigest: digest({ objective: `Start ${childRunId}` }),
  };
  return store.admitRunLineage(request, {
    actor: `mcp:${lease.session.principalId}:${lease.session.sessionId}`,
    key: `run.lineage:${childRunId}`,
    principalId: lease.session.principalId,
    sessionId: lease.session.sessionId,
    sessionAuthorityDigest: lease.session.authorityDigest,
    orchestratorLeaseId: lease.leaseId,
  }).lineage;
}

function tree(label) {
  const directory = root(label);
  const store = new CoordinationStore(directory, {
    repoId, clock: () => '2026-07-18T08:00:00.000Z', runLineagePolicy: policy,
  });
  const rootRunId = `run-${label}-root`;
  const rootTask = task(store, rootRunId, `${label}-root`);
  const rootLease = issue(store, rootTask, `${label}-root`);

  const childRunId = `run-${label}-child`;
  child(store, rootLease, childRunId);
  const childTask = task(store, childRunId, `${label}-child`);
  const childLease = issue(store, childTask, `${label}-child`);

  const grandchildRunId = `run-${label}-grandchild`;
  child(store, childLease, grandchildRunId);
  const grandchildTask = task(store, grandchildRunId, `${label}-grandchild`);

  const siblingRunId = `run-${label}-sibling`;
  child(store, rootLease, siblingRunId);
  const siblingTask = task(store, siblingRunId, `${label}-sibling`);
  const siblingLease = issue(store, siblingTask, `${label}-sibling`);
  return {
    childLease, childRunId, childTask, directory, grandchildRunId, grandchildTask,
    rootRunId, siblingLease, siblingRunId, siblingTask, store,
  };
}

function stopRequest(runId, reason = `Stop ${runId} and all descendants`) {
  const reasonDigest = digest(reason);
  const core = { repoId, runId, reasonDigest };
  return { schemaVersion: 1, ...core, requestDigest: digest(core) };
}

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

test('RS1 RED: stop admission snapshots the exact immutable descendant Run/task/worker closure', () => {
  const f = tree('snapshot');
  const throughSeq = f.store.snapshot().lastSeq;
  const request = stopRequest(f.childRunId);
  const admitted = f.store.admitRunStop(request, {
    actor: 'operator:phase77-stop', key: `run.stop:${f.childRunId}`,
  });
  assert.equal(admitted.event.kind, 'run.stop_admitted');
  assert.deepEqual(Object.keys(admitted.event.payload).sort(), [
    'reasonDigest', 'repoId', 'requestDigest', 'runId', 'schemaVersion', 'scope',
    'targetDigest', 'targetRunIds', 'targetTaskIds', 'targetWorkerIds', 'throughSeq',
  ]);
  const stop = admitted.stop;
  assert.equal(stop.scope, 'run_subtree');
  assert.equal(stop.throughSeq, throughSeq);
  assert.equal(stop.throughSeq, admitted.event.seq - 1);
  assert.deepEqual(stop.targetRunIds, [f.childRunId, f.grandchildRunId].sort());
  assert.deepEqual(stop.targetTaskIds, [f.childTask.id, f.grandchildTask.id].sort());
  assert.deepEqual(stop.targetWorkerIds, [f.childTask.assignee, f.grandchildTask.assignee].sort());
  assert.equal(stop.targetDigest, digest({
    throughSeq,
    targetRunIds: stop.targetRunIds,
    targetTaskIds: stop.targetTaskIds,
    targetWorkerIds: stop.targetWorkerIds,
  }));
  assert.equal(f.store.runStop(f.childRunId).admittedEvent, admitted.event.seq);
  assert.equal(f.store.runStop(f.grandchildRunId).admittedEvent, admitted.event.seq,
    'every snapped descendant resolves to the same stop authority');
  assert.equal(f.store.runStop(f.rootRunId), null);
  assert.equal(f.store.runStop(f.siblingRunId), null);

  f.store.releaseWriterLease();
  const replay = new CoordinationStore(f.directory, {
    repoId, clock: () => '2026-07-18T08:00:00.000Z', runLineagePolicy: policy,
  });
  assert.deepEqual(replay.runStop(f.childRunId), stop);
  assert.deepEqual(replay.runStop(f.grandchildRunId), stop);
  replay.releaseWriterLease();
});

test('RS2 RED: admitted subtree stop fences descendant lineage and effects while a sibling stays open', () => {
  const f = tree('fence');
  f.store.admitRunStop(stopRequest(f.childRunId), {
    actor: 'operator:phase77-stop', key: `run.stop:${f.childRunId}`,
  });
  assert.equal(
    refusalCode(() => child(f.store, f.childLease, 'run-fence-late-descendant')),
    'run_stopping',
    'no new descendant can escape the immutable stop snapshot',
  );
  assert.equal(refusalCode(() => f.store.createTask({
    id: 'task-fence-late-effect',
    brief: { objective: 'Must be fenced', capabilities: [] },
    deps: [], refines: null, relation: 'root', runId: f.grandchildRunId, taskType: 'general',
    reservedWorkerId: 'worker-fence-late-effect', vendorRequested: 'kimi-code',
    modelRequested: 'kimi-code/k3', modelPolicy: null, effortRequested: 'max',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: 'task.created:fence-late-effect' })), 'run_stopping');

  const siblingChild = child(f.store, f.siblingLease, 'run-fence-sibling-child');
  assert.equal(siblingChild.parentRunId, f.siblingRunId,
    'a stop never widens into an unrelated sibling subtree');
  f.store.releaseWriterLease();
});
