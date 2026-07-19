// Phase 77 — durable recursive Run lineage and application-only orchestrator leases.
//
// A Baton worker may recursively use Baton's compact Run application, but it may not inherit the
// operator's fleet kernel or manufacture its own ancestry. The authenticated session supplies one
// server-issued lease; the store derives all lineage coordinates before the child Goal/Plan can be
// admitted. Full-permission same-UID execution is not credential secrecy: this authority limits
// Baton commands and causal ownership, while a harder process boundary remains separately required.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationIntegrityError,
  CoordinationStore,
} from '../src/coordination-store.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase77-run-lineage-${label}-`));
const repoId = 'repo-phase77-lineage';
const capabilities = Object.freeze(['run.context', 'run.start', 'run.status', 'run.stop']);
const policy = Object.freeze({
  schemaVersion: 1,
  maxDepth: 3,
  maxChildrenPerRun: 2,
  maxDescendantsPerRoot: 4,
  leaseTtlMs: 60_000,
});
const policyDigest = digest(policy);
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId,
  mandatory: false,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit'],
  capabilityClasses: ['baton_orchestrator'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const leasePayloadFields = Object.freeze([
  'capabilities', 'expiresAt', 'issuedAt', 'leaseDigest', 'leaseId', 'parent', 'policyDigest',
  'repoId', 'requestDigest', 'schemaVersion', 'scope', 'session',
].sort());
const lineagePayloadFields = Object.freeze([
  'admissionDigest', 'ancestors', 'childRunId', 'depth', 'intentDigest', 'lease',
  'parent', 'parentLineageEvent', 'parentRunId', 'policyDigest', 'repoId', 'requestDigest',
  'rootRunId', 'schemaVersion', 'scope',
].sort());

function mutableClock(value = '2026-07-18T08:00:00.000Z') {
  let current = value;
  return {
    now: () => current,
    set: (next) => { current = next; },
  };
}

function createWorkingTask(store, {
  runId, taskId, workerId, refines = null, relation = 'root', orchestrator = true,
}) {
  store.createTask({
    id: taskId,
    brief: {
      objective: `Own ${runId} while recursively orchestrating bounded child Runs`,
      capabilities: orchestrator ? ['baton_orchestrator'] : [],
    },
    deps: [],
    refines,
    relation,
    runId,
    taskType: relation === 'root' ? 'general' : 'follow_up',
    reservedWorkerId: workerId,
    vendorRequested: 'kimi-code',
    modelRequested: 'kimi-code/k3',
    modelPolicy: null,
    effortRequested: 'max',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  return store.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
}

function fixture(label, policyOverrides = {}) {
  const directory = root(label);
  const clock = mutableClock();
  const selectedPolicy = { ...policy, ...policyOverrides };
  const store = new CoordinationStore(directory, {
    repoId,
    clock: clock.now,
    runLineagePolicy: selectedPolicy,
  });
  const parent = {
    runId: `run-${label}-root`,
    taskId: `task-${label}-root`,
    workerId: `worker-${label}-root`,
  };
  const task = createWorkingTask(store, parent);
  return { clock, directory, parent, policy: selectedPolicy, store, task };
}

function sessionFor(label, overrides = {}) {
  const principalId = overrides.principalId ?? `recursive-${label}`;
  const sessionId = overrides.sessionId ?? `session-${label}`;
  return {
    principalId,
    sessionId,
    authorityDigest: overrides.authorityDigest ?? digest({
      kind: 'authenticated-worker-session', principalId, sessionId,
    }),
    expiresAt: overrides.expiresAt ?? '2026-07-18T09:00:00.000Z',
  };
}

function leaseRequestFor(f, overrides = {}) {
  return {
    schemaVersion: 1,
    repoId: overrides.repoId ?? repoId,
    parentTask: {
      id: overrides.parentTaskId ?? f.parent.taskId,
      version: overrides.parentTaskVersion ?? f.task.version,
    },
    session: overrides.session ?? sessionFor(f.parent.taskId),
  };
}

function leaseIdentity(f, request) {
  return {
    repoId: request.repoId,
    parentRunId: f.parent.runId,
    parentTaskId: request.parentTask.id,
    parentTaskVersion: request.parentTask.version,
    workerId: f.parent.workerId,
    principalId: request.session.principalId,
    sessionId: request.session.sessionId,
    sessionAuthorityDigest: request.session.authorityDigest,
  };
}

function leaseIdFor(f, request) {
  return `run-orchestrator-lease:${digest(leaseIdentity(f, request))}`;
}

function leaseAuthFor(f, request, actor = 'orchestrator') {
  return { actor, key: `run.orchestrator_lease:${leaseIdFor(f, request)}` };
}

function issueLease(f, overrides = {}) {
  const request = leaseRequestFor(f, overrides);
  return f.store.issueRunOrchestratorLease(request, leaseAuthFor(f, request));
}

function lineageRequest(childRunId, label = childRunId) {
  return {
    schemaVersion: 1,
    repoId,
    childRunId,
    intentDigest: digest({ objective: `Delegate ${label}`, profile: 'recursive-code' }),
  };
}

function lineageAuthFor(lease, childRunId, overrides = {}) {
  return {
    actor: overrides.actor ?? `mcp:${lease.session.principalId}:${lease.session.sessionId}`,
    key: overrides.key ?? `run.lineage:${childRunId}`,
    principalId: overrides.principalId ?? lease.session.principalId,
    sessionId: overrides.sessionId ?? lease.session.sessionId,
    sessionAuthorityDigest: overrides.sessionAuthorityDigest ?? lease.session.authorityDigest,
    orchestratorLeaseId: overrides.orchestratorLeaseId ?? lease.leaseId,
  };
}

function admitChild(f, lease, childRunId, overrides = {}) {
  const request = overrides.request ?? lineageRequest(childRunId);
  return f.store.admitRunLineage(request, lineageAuthFor(lease, childRunId, overrides.auth));
}

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

test('RL0: one closed deployment policy bounds recursion and lease lifetime', () => {
  for (const malformed of [
    { ...policy, extra: true },
    { ...policy, schemaVersion: 2 },
    { ...policy, maxDepth: -1 },
    { ...policy, maxChildrenPerRun: 0 },
    { ...policy, maxDescendantsPerRoot: 0 },
    { ...policy, leaseTtlMs: 0 },
  ]) {
    assert.throws(
      () => new CoordinationStore(root('invalid-policy'), { runLineagePolicy: malformed }),
      (error) => error instanceof TypeError && error.code === 'run_lineage_policy_invalid',
    );
  }
  const f = fixture('policy-projection');
  assert.deepEqual(f.store.runLineagePolicy(), policy);
  assert.equal(f.store.runLineagePolicyDigest(), policyDigest);
  f.store.releaseWriterLease();
});

test('RL1: a lease derives exact parent/session authority and only the compact application command set', () => {
  const f = fixture('lease-schema');
  for (const method of [
    'issueRunOrchestratorLease', 'revokeRunOrchestratorLease', 'runOrchestratorLease',
    'admitRunLineage', 'runLineage', 'runChildren', 'runDescendants',
    'authorizeRunOrchestratorCommand',
  ]) assert.equal(typeof f.store[method], 'function', `${method} is part of the store contract`);

  const request = leaseRequestFor(f);
  const issued = f.store.issueRunOrchestratorLease(request, leaseAuthFor(f, request));
  assert.equal(issued.result, 'issued');
  assert.equal(issued.event.kind, 'run.orchestrator_lease_issued');
  assert.deepEqual(Object.keys(issued.event.payload).sort(), leasePayloadFields);
  const payload = issued.event.payload;
  const lease = issued.lease;
  assert.equal(lease.scope, 'application_run_subtree');
  assert.equal(lease.repoId, repoId);
  assert.equal(lease.leaseId, leaseIdFor(f, request));
  assert.deepEqual(lease.parent, {
    runId: f.parent.runId, taskId: f.parent.taskId,
    taskVersion: f.task.version, workerId: f.parent.workerId,
  });
  assert.deepEqual(lease.session, request.session);
  assert.deepEqual(lease.capabilities, capabilities);
  assert.equal(payload.issuedAt, issued.event.ts);
  assert.equal(payload.issuedAt, f.clock.now());
  assert.equal(lease.expiresAt, '2026-07-18T08:01:00.000Z');
  assert.equal(lease.policyDigest, policyDigest);
  assert.equal(lease.requestDigest, digest(request));
  const { leaseDigest, ...leaseCore } = payload;
  assert.equal(leaseDigest, digest(leaseCore));
  assert.equal(lease.status, 'active');
  assert.equal(lease.issuedEvent, issued.event.seq);
  assert.equal(lease.revokedEvent, null);
  assert.deepEqual(f.store.runOrchestratorLease(lease.leaseId), lease);
  assert.equal(Object.isFrozen(issued), true);
  assert.equal(Object.isFrozen(issued.lease.capabilities), true);
  assert.equal(JSON.stringify(lease).includes('token'), false);
  assert.equal(JSON.stringify(lease).includes('credential'), false);

  const short = fixture('lease-short-session');
  const shortRequest = leaseRequestFor(short, {
    session: sessionFor('short-session', { expiresAt: '2026-07-18T08:00:20.000Z' }),
  });
  const shortLease = short.store.issueRunOrchestratorLease(
    shortRequest, leaseAuthFor(short, shortRequest),
  );
  assert.equal(shortLease.lease.expiresAt, shortRequest.session.expiresAt,
    'authenticated session expiry is a hard upper bound on the lease');
  short.store.releaseWriterLease();
  f.store.releaseWriterLease();
});

test('RL2: child lineage derives ancestry from the authenticated lease; callers cannot supply coordinates', () => {
  const f = fixture('derived-lineage');
  const lease = issueLease(f).lease;
  const request = lineageRequest('run-derived-child');
  const admitted = f.store.admitRunLineage(request, lineageAuthFor(lease, request.childRunId));
  assert.equal(admitted.result, 'admitted');
  assert.equal(admitted.event.kind, 'run.lineage_admitted');
  assert.deepEqual(Object.keys(admitted.event.payload).sort(), lineagePayloadFields);
  const lineage = admitted.lineage;
  assert.equal(lineage.scope, 'application_run_child');
  assert.equal(lineage.rootRunId, f.parent.runId);
  assert.equal(lineage.parentRunId, f.parent.runId);
  assert.equal(lineage.childRunId, request.childRunId);
  assert.equal(lineage.depth, 1);
  assert.deepEqual(lineage.ancestors, [f.parent.runId]);
  assert.deepEqual(lineage.parent, {
    taskId: f.parent.taskId, taskVersion: f.task.version, workerId: f.parent.workerId,
  });
  assert.equal(lineage.parentLineageEvent, null);
  assert.deepEqual(lineage.lease, {
    id: lease.leaseId, digest: lease.leaseDigest, issuedEvent: lease.issuedEvent,
  });
  assert.equal(lineage.policyDigest, policyDigest);
  assert.equal(lineage.requestDigest, digest({ ...request, orchestratorLeaseId: lease.leaseId }));
  const { admissionDigest, ...admissionCore } = lineage;
  assert.equal(admissionDigest, digest(admissionCore));
  assert.deepEqual(f.store.runLineage(request.childRunId), lineage);
  assert.deepEqual(f.store.runChildren(f.parent.runId), [lineage]);
  assert.deepEqual(f.store.runDescendants(f.parent.runId), [lineage]);

  for (const forbidden of ['parentRunId', 'rootRunId', 'depth', 'ancestors', 'lease', 'leaseId', 'capabilities']) {
    const forged = { ...lineageRequest(`run-forged-${forbidden}`), [forbidden]: forbidden === 'depth' ? 1 : 'forged' };
    assert.equal(
      refusalCode(() => f.store.admitRunLineage(
        forged, lineageAuthFor(lease, forged.childRunId),
      )),
      'run_lineage_invalid',
      forbidden,
    );
  }
  f.store.releaseWriterLease();
});

test('RL3: lease and lineage retries replay exactly; changed actors, sessions, or meanings conflict before append', () => {
  const f = fixture('idempotency');
  const leaseRequest = leaseRequestFor(f);
  const firstLease = f.store.issueRunOrchestratorLease(
    leaseRequest, leaseAuthFor(f, leaseRequest),
  );
  const leaseReplay = f.store.issueRunOrchestratorLease(
    structuredClone(leaseRequest), leaseAuthFor(f, leaseRequest),
  );
  assert.equal(leaseReplay.result, 'replay');
  assert.equal(leaseReplay.event.seq, firstLease.event.seq);
  assert.equal(refusalCode(() => f.store.issueRunOrchestratorLease(
    leaseRequest, leaseAuthFor(f, leaseRequest, 'operator:other'),
  )), 'run_orchestrator_lease_conflict');

  const request = lineageRequest('run-idempotent-child');
  const auth = lineageAuthFor(firstLease.lease, request.childRunId);
  const first = f.store.admitRunLineage(request, auth);
  const replay = f.store.admitRunLineage(structuredClone(request), structuredClone(auth));
  assert.equal(replay.result, 'replay');
  assert.equal(replay.event.seq, first.event.seq);
  const before = f.store.snapshot().lastSeq;
  const changed = { ...request, intentDigest: digest({ changed: true }) };
  assert.equal(
    refusalCode(() => f.store.admitRunLineage(changed, auth)),
    'run_lineage_conflict',
  );
  assert.equal(
    refusalCode(() => f.store.admitRunLineage(request, {
      ...auth, sessionAuthorityDigest: digest({ forged: 'session' }),
    })),
    'run_lineage_conflict',
    'an admitted key cannot be replayed under changed authenticated authority',
  );
  assert.equal(f.store.snapshot().lastSeq, before);
  f.store.releaseWriterLease();
});

test('RL4: active lease and current parent ownership are prospective fences', () => {
  const sessionCases = [
    ['principal', { principalId: 'recursive-other' }],
    ['session', { sessionId: 'session-other' }],
    ['session authority', { sessionAuthorityDigest: digest({ forged: true }) }],
    ['lease identity', { orchestratorLeaseId: 'run-orchestrator-lease:missing' }],
  ];
  for (const [label, authOverride] of sessionCases) {
    const f = fixture(`session-${label.replaceAll(' ', '-')}`);
    const lease = issueLease(f).lease;
    const childRunId = `run-${label.replaceAll(' ', '-')}`;
    assert.equal(
      refusalCode(() => f.store.admitRunLineage(
        lineageRequest(childRunId), lineageAuthFor(lease, childRunId, authOverride),
      )),
      authOverride.orchestratorLeaseId
        ? 'run_orchestrator_lease_not_found' : 'run_orchestrator_session_mismatch',
      label,
    );
    f.store.releaseWriterLease();
  }

  const expired = fixture('expired');
  const expiredLease = issueLease(expired).lease;
  expired.clock.set('2026-07-18T08:01:00.001Z');
  assert.equal(
    refusalCode(() => admitChild(expired, expiredLease, 'run-expired-child')),
    'run_orchestrator_lease_expired',
  );

  const stale = fixture('stale-parent');
  const staleLease = issueLease(stale).lease;
  stale.store.transitionTask(stale.parent.taskId, 'completed', stale.task.version, {
    actor: 'orchestrator', key: `task.completed:${stale.parent.taskId}`,
  });
  assert.equal(
    refusalCode(() => admitChild(stale, staleLease, 'run-stale-parent-child')),
    'run_orchestrator_parent_inactive',
  );

  const unprivilegedDirectory = root('missing-parent-capability-exact');
  const unprivilegedClock = mutableClock();
  const unprivilegedStore = new CoordinationStore(unprivilegedDirectory, {
    repoId, clock: unprivilegedClock.now, runLineagePolicy: policy,
  });
  const unprivilegedParent = {
    runId: 'run-unprivileged-root', taskId: 'task-unprivileged-root',
    workerId: 'worker-unprivileged-root',
  };
  const unprivilegedTask = createWorkingTask(unprivilegedStore, {
    ...unprivilegedParent, orchestrator: false,
  });
  const unprivilegedFixture = {
    clock: unprivilegedClock, directory: unprivilegedDirectory, parent: unprivilegedParent,
    policy, store: unprivilegedStore, task: unprivilegedTask,
  };
  const unprivilegedRequest = leaseRequestFor(unprivilegedFixture);
  assert.equal(refusalCode(() => unprivilegedStore.issueRunOrchestratorLease(
    unprivilegedRequest, leaseAuthFor(unprivilegedFixture, unprivilegedRequest),
  )), 'run_orchestrator_capability_required');
  expired.store.releaseWriterLease();
  stale.store.releaseWriterLease();
  unprivilegedStore.releaseWriterLease();
});

test('RL5: revocation is durable, idempotent, and fences every later child admission', () => {
  const f = fixture('revocation');
  const issued = issueLease(f);
  const fields = {
    schemaVersion: 1,
    leaseId: issued.lease.leaseId,
    leaseDigest: issued.lease.leaseDigest,
    reason: 'operator',
  };
  const auth = {
    actor: 'operator:phase77',
    key: `run.orchestrator_lease.revoke:${issued.lease.leaseId}`,
  };
  const revoked = f.store.revokeRunOrchestratorLease(fields, auth);
  assert.equal(revoked.result, 'revoked');
  assert.equal(revoked.event.kind, 'run.orchestrator_lease_revoked');
  assert.deepEqual(Object.keys(revoked.event.payload).sort(), [
    'leaseDigest', 'leaseId', 'reason', 'revocationDigest', 'schemaVersion',
  ]);
  const { revocationDigest, ...core } = revoked.event.payload;
  assert.equal(revocationDigest, digest(core));
  assert.equal(revoked.lease.status, 'revoked');
  assert.equal(revoked.lease.revokedEvent, revoked.event.seq);
  assert.equal(f.store.revokeRunOrchestratorLease(fields, auth).result, 'replay');
  assert.equal(
    refusalCode(() => admitChild(f, issued.lease, 'run-revoked-child')),
    'run_orchestrator_lease_revoked',
  );
  f.store.releaseWriterLease();
});

test('RL6: depth, direct children, and total descendants are independent exact ceilings', () => {
  const children = fixture('children-limit', { maxChildrenPerRun: 1 });
  const childrenLease = issueLease(children).lease;
  admitChild(children, childrenLease, 'run-child-one');
  assert.equal(
    refusalCode(() => admitChild(children, childrenLease, 'run-child-two')),
    'run_lineage_children',
  );
  assert.equal(children.store.runChildren(children.parent.runId).length, 1);

  const descendants = fixture('descendants-limit', {
    maxDepth: 8, maxChildrenPerRun: 8, maxDescendantsPerRoot: 1,
  });
  const descendantsLease = issueLease(descendants).lease;
  admitChild(descendants, descendantsLease, 'run-descendant-one');
  assert.equal(
    refusalCode(() => admitChild(descendants, descendantsLease, 'run-descendant-two')),
    'run_lineage_descendants',
  );

  const depth = fixture('depth-limit', {
    maxDepth: 1, maxChildrenPerRun: 8, maxDescendantsPerRoot: 8,
  });
  const rootLease = issueLease(depth).lease;
  const child = admitChild(depth, rootLease, 'run-depth-child').lineage;
  const childTask = createWorkingTask(depth.store, {
    runId: child.childRunId,
    taskId: 'task-depth-child',
    workerId: 'worker-depth-child',
  });
  const nestedRequest = leaseRequestFor({
    ...depth,
    parent: {
      runId: child.childRunId,
      taskId: childTask.id,
      workerId: childTask.assignee,
    },
    task: childTask,
  });
  const nestedFixture = {
    ...depth,
    parent: {
      runId: child.childRunId,
      taskId: childTask.id,
      workerId: childTask.assignee,
    },
    task: childTask,
  };
  const nestedLease = depth.store.issueRunOrchestratorLease(
    nestedRequest, leaseAuthFor(nestedFixture, nestedRequest),
  ).lease;
  assert.equal(
    refusalCode(() => admitChild(depth, nestedLease, 'run-depth-grandchild')),
    'run_lineage_depth',
  );
  children.store.releaseWriterLease();
  descendants.store.releaseWriterLease();
  depth.store.releaseWriterLease();
});

test('RL7: lease authorization attenuates commands and scope to the admitted descendant subtree', () => {
  const f = fixture('attenuation');
  const lease = issueLease(f).lease;
  const first = admitChild(f, lease, 'run-attenuated-first').lineage;
  const second = admitChild(f, lease, 'run-attenuated-second').lineage;
  for (const command of capabilities) {
    const target = first.childRunId;
    const authorized = f.store.authorizeRunOrchestratorCommand({
      schemaVersion: 1, command, repoId, runId: target,
    }, lineageAuthFor(lease, `authorize-${command}`, { key: `authorize:${command}` }));
    assert.deepEqual(authorized, {
      ok: true, leaseId: lease.leaseId, command, repoId, runId: target,
    });
  }
  for (const command of [
    'run.approve', 'run.act', 'run.steer', 'run.answer', 'run.review', 'run.integrate',
    'run.export', 'run.adopt', 'application.shutdown', 'fleet_spawn', 'fleet_kill',
    'credential.read', 'worker.spawn',
  ]) {
    assert.equal(refusalCode(() => f.store.authorizeRunOrchestratorCommand({
      schemaVersion: 1, command, repoId, runId: first.childRunId,
    }, lineageAuthFor(lease, `authorize-${command}`, { key: `authorize:${digest(command)}` }))),
    'run_orchestrator_command_forbidden', command);
  }
  assert.equal(refusalCode(() => f.store.authorizeRunOrchestratorCommand({
    schemaVersion: 1, command: 'run.status', repoId, runId: f.parent.runId,
  }, lineageAuthFor(lease, 'authorize-parent', { key: 'authorize:parent' }))),
  'run_orchestrator_scope_forbidden', 'the lease cannot control its own parent Run');
  assert.equal(refusalCode(() => f.store.authorizeRunOrchestratorCommand({
    schemaVersion: 1, command: 'run.stop', repoId, runId: 'run-unrelated',
  }, lineageAuthFor(lease, 'authorize-unrelated', { key: 'authorize:unrelated' }))),
  'run_orchestrator_scope_forbidden');
  assert.deepEqual(f.store.runDescendants(f.parent.runId).map((row) => row.childRunId), [
    first.childRunId, second.childRunId,
  ]);
  f.store.releaseWriterLease();
});

test('RL8: child identity is globally fresh and lineage precedes every child Run effect', () => {
  const f = fixture('global-freshness');
  const lease = issueLease(f).lease;
  const occupiedRunId = 'run-already-has-effects';
  createWorkingTask(f.store, {
    runId: occupiedRunId,
    taskId: 'task-existing-child-effect',
    workerId: 'worker-existing-child-effect',
  });
  const before = f.store.snapshot().lastSeq;
  assert.equal(
    refusalCode(() => admitChild(f, lease, occupiedRunId)),
    'run_lineage_conflict',
  );
  assert.equal(f.store.snapshot().lastSeq, before);

  const childRunId = 'run-lineage-before-effect';
  const admitted = admitChild(f, lease, childRunId);
  const childTask = createWorkingTask(f.store, {
    runId: childRunId,
    taskId: 'task-after-lineage',
    workerId: 'worker-after-lineage',
  });
  assert.equal(admitted.event.seq < childTask.createdEvent, true);
  assert.equal(f.store.events().find((event) => event.seq === admitted.event.seq).kind,
    'run.lineage_admitted');
  f.store.releaseWriterLease();

  const goalDirectory = root('global-freshness-goal');
  const goalClock = mutableClock();
  const goalStore = new CoordinationStore(goalDirectory, {
    repoId, clock: goalClock.now, runLineagePolicy: policy, goalPlanPolicy,
  });
  const goalParent = {
    runId: 'run-goal-collision-root', taskId: 'task-goal-collision-root',
    workerId: 'worker-goal-collision-root',
  };
  const goalParentTask = createWorkingTask(goalStore, goalParent);
  const goalFixture = {
    clock: goalClock, directory: goalDirectory, parent: goalParent, policy,
    store: goalStore, task: goalParentTask,
  };
  const goalLease = issueLease(goalFixture).lease;
  const occupiedByGoal = 'run-already-has-goal';
  goalStore.defineGoal({
    objective: 'Existing Goal must make this Run identity unavailable to recursive lineage',
    definitionOfDone: ['Run identity remains singular'],
    constraints: ['No child lineage may be inserted after this effect'],
    risk: 'high',
    budget: { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 4 },
    predecessor: null,
  }, {
    actor: 'direct:goal-owner', principalId: 'goal-owner',
    sessionDigest: digest({ session: 'goal-owner' }), repoId, runId: occupiedByGoal,
    key: 'goal:existing-run-identity',
  });
  assert.equal(
    refusalCode(() => admitChild(goalFixture, goalLease, occupiedByGoal)),
    'run_lineage_conflict',
    'a Goal is already a child effect and cannot be backfilled with ancestry',
  );
  goalStore.releaseWriterLease();
});

test('RL9: replay reconstructs leases and lineage exactly and rejects ledger tampering', () => {
  const directory = root('replay');
  const clock = mutableClock();
  const store = new CoordinationStore(directory, { repoId, clock: clock.now, runLineagePolicy: policy });
  const parent = { runId: 'run-replay-root', taskId: 'task-replay-root', workerId: 'worker-replay-root' };
  const task = createWorkingTask(store, parent);
  const f = { clock, directory, parent, policy, store, task };
  const lease = issueLease(f).lease;
  const child = admitChild(f, lease, 'run-replay-child').lineage;
  const snapshot = store.snapshot();
  store.releaseWriterLease();

  const replay = new CoordinationStore(directory, { repoId, clock: clock.now, runLineagePolicy: policy });
  assert.deepEqual(replay.runOrchestratorLease(lease.leaseId), lease);
  assert.deepEqual(replay.runLineage(child.childRunId), child);
  assert.deepEqual(replay.runDescendants(parent.runId), [child]);
  assert.deepEqual(replay.snapshot(), snapshot);
  replay.releaseWriterLease();

  const original = readFileSync(join(directory, 'events.jsonl'), 'utf8');
  const leaseLines = original.trimEnd().split('\n');
  const leaseIndex = leaseLines.findIndex((line) => JSON.parse(line).kind === 'run.orchestrator_lease_issued');
  const leaseEvent = JSON.parse(leaseLines[leaseIndex]);
  leaseEvent.payload.issuedAt = '2026-07-18T08:00:00.001Z';
  leaseLines[leaseIndex] = JSON.stringify(leaseEvent);
  writeFileSync(join(directory, 'events.jsonl'), `${leaseLines.join('\n')}\n`);
  assert.throws(
    () => new CoordinationStore(directory, { repoId, clock: clock.now, runLineagePolicy: policy }),
    (error) => error instanceof CoordinationIntegrityError
      && error.code === 'run_orchestrator_lease_integrity',
    'replay must bind issuedAt to the durable event timestamp',
  );

  writeFileSync(join(directory, 'events.jsonl'), original);
  const lines = original.trimEnd().split('\n');
  const index = lines.findIndex((line) => JSON.parse(line).kind === 'run.lineage_admitted');
  const event = JSON.parse(lines[index]);
  event.payload.depth += 1;
  lines[index] = JSON.stringify(event);
  writeFileSync(join(directory, 'events.jsonl'), `${lines.join('\n')}\n`);
  assert.throws(
    () => new CoordinationStore(directory, { repoId, clock: clock.now, runLineagePolicy: policy }),
    (error) => error instanceof CoordinationIntegrityError && error.code === 'run_lineage_integrity',
  );
});

test('RL10 RED: lease repository is bound to the parent Run durable repository and cannot be relabeled', () => {
  const directory = root('lease-parent-repository');
  const clock = mutableClock();
  const store = new CoordinationStore(directory, {
    repoId,
    clock: clock.now,
    goalPlanPolicy,
    runLineagePolicy: policy,
  });
  const parent = {
    runId: 'run-lease-parent-repository',
    taskId: 'task-lease-parent-repository',
    workerId: 'worker-lease-parent-repository',
  };
  const task = createWorkingTask(store, parent);
  const f = { clock, directory, parent, policy, store, task };
  try {
    store.defineGoal({
      objective: 'Bind recursive authority to this Run durable repository',
      definitionOfDone: ['a child lease cannot relabel the parent repository'],
      constraints: ['derive repository authority from durable parent state'],
      risk: 'high',
      budget: { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 4 },
      predecessor: null,
    }, {
      actor: 'direct:goal-owner', principalId: 'goal-owner',
      sessionDigest: digest({ session: 'goal-owner' }), repoId, runId: parent.runId,
      key: 'goal:lease-parent-repository',
    });

    const canonicalLease = issueLease(f).lease;
    assert.equal(canonicalLease.repoId, repoId);

    const foreignRequest = leaseRequestFor(f, { repoId: 'repo-phase77-foreign' });
    assert.throws(
      () => store.issueRunOrchestratorLease(
        foreignRequest, leaseAuthFor(f, foreignRequest),
      ),
      (error) => error?.code === 'run_orchestrator_repository_mismatch',
      'caller-supplied repoId cannot relabel a parent Run with durable repository authority',
    );
  } finally {
    store.releaseWriterLease();
  }
});

test('RL11 RED: subtree stop repository must match the admitted lineage repository', () => {
  const f = fixture('stop-lineage-repository');
  try {
    const lease = issueLease(f).lease;
    const childRunId = 'run-stop-lineage-repository-child';
    admitChild(f, lease, childRunId);
    const reasonDigest = digest('Stop the recursively admitted child Run');
    const core = {
      repoId: 'repo-phase77-foreign',
      runId: childRunId,
      reasonDigest,
    };
    assert.throws(
      () => f.store.admitRunStop({
        schemaVersion: 1,
        ...core,
        requestDigest: digest(core),
      }, {
        actor: 'operator:phase77-stop-repository',
        key: `run.stop:${childRunId}`,
      }),
      (error) => error?.code === 'run_stop_repository_mismatch',
      'stop cannot select a Run lineage through a different repository coordinate',
    );
  } finally {
    f.store.releaseWriterLease();
  }
});
