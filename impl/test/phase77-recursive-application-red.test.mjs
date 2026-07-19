// Phase 77 application RED gate — recursive Baton may use only Baton's compact Run surface.
//
// The public command arguments remain semantic and coordinate-free. A northbound server may add
// one private fourth-argument context after authentication. Baton must consume that context before
// admitting the child Goal/Plan, attenuate it to three descendant-scoped commands, and retain the
// exact subtree stop snapshot through physical kill/reap completion.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS,
  BatonApplication,
  MockAdapter,
  createDriver,
  validateApplicationCommandArgs,
} from '../src/index.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase77-recursive-application-${label}-`));
const NOW = '2026-07-18T08:00:00.000Z';
const REPO = 'repo-phase77-application';
const runLineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 4,
  maxDescendantsPerRoot: 16, leaseTtlMs: 60_000,
});
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  mandatory: false,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  definitionOfDone: ['the recursive result is mechanically verified'],
  constraints: ['remain inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  followPolicy: {
    mode: 'enabled', maxWaitMs: 1_000, maxChanges: 8,
    maxResponseBytes: 64 * 1024, maxScanEvents: 32,
  },
});

const principal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});

function configuredAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 25, summary: 'done', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function createParentTask(store, label) {
  const runId = `run-${label}-parent`;
  const taskId = `task-${label}-parent`;
  const workerId = `worker-${label}-parent`;
  store.createTask({
    id: taskId,
    brief: {
      objective: 'Recursively improve Baton through its compact application',
      capabilities: ['baton_orchestrator'],
    },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  }, {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","model-a","low"]',
  }).task;
  return { runId, taskId, workerId, task };
}

function issueLease(store, parent, recursivePrincipal) {
  const session = {
    principalId: recursivePrincipal.principalId,
    sessionId: recursivePrincipal.sessionId,
    authorityDigest: digest({
      kind: 'authenticated-recursive-session',
      principalId: recursivePrincipal.principalId,
      sessionId: recursivePrincipal.sessionId,
    }),
    expiresAt: '2026-07-18T09:00:00.000Z',
  };
  const identity = {
    repoId: REPO, parentRunId: parent.runId, parentTaskId: parent.taskId,
    parentTaskVersion: parent.task.version, workerId: parent.workerId,
    principalId: session.principalId, sessionId: session.sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  return store.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO,
    parentTask: { id: parent.taskId, version: parent.task.version }, session,
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` }).lease;
}

function recursiveContext(lease, requestId = 'recursive-request-1') {
  return {
    transport: 'direct', requestId,
    idempotencyKey: `direct.recursive:${requestId}`,
    sessionAuthority: {
      schemaVersion: 1,
      authorityDigest: lease.session.authorityDigest,
      expiresAt: lease.session.expiresAt,
      orchestratorLeaseId: lease.leaseId,
    },
  };
}

function mutableClock(initial = NOW) {
  let value = initial;
  return {
    now: () => value,
    set(next) { value = next; },
  };
}

function fixture(label, { clock = mutableClock() } = {}) {
  const repository = root(`${label}-repo`);
  const logDir = root(`${label}-log`);
  execFileSync('git', ['init', '-q'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'phase77@example.invalid'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Phase 77'], { cwd: repository });
  writeFileSync(join(repository, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repository });
  const driver = createDriver({
    repoRoot: repository, repoId: REPO, logDir, now: () => Date.parse(clock.now()),
    adapters: { mock: configuredAdapter() }, runLineagePolicy,
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: REPO, profiles: { recursive: profile },
    principals: {
      planner: principal(`${label}-planner`), dispatcher: principal(`${label}-dispatcher`),
      observer: principal(`${label}-observer`),
    },
    authorize: async () => true,
  });
  const parent = createParentTask(driver.coordination, label);
  const recursivePrincipal = principal(`${label}-recipient`);
  const lease = issueLease(driver.coordination, parent, recursivePrincipal);
  return {
    application, clock, driver, lease, logDir, parent, recursivePrincipal, repository,
  };
}

const intent = (runId) => ({
  runId,
  objective: 'Use Baton recursively to remove one bounded orchestration friction',
  profile: 'recursive',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

async function cleanupFixture(f) {
  try { await f.application.shutdown(principal('phase77-shutdown')); } catch { /* RED failures may interrupt setup */ }
  rmSync(f.repository, { recursive: true, force: true });
  rmSync(f.logDir, { recursive: true, force: true });
}

test('RA1 RED: recursive context admits child lineage before its first Goal or Plan effect', async (t) => {
  const f = fixture('lineage-order');
  t.after(() => cleanupFixture(f));
  const childRunId = 'run-phase77-recursive-child';
  const view = await f.application.command(
    'run.start', { intent: intent(childRunId) }, f.recursivePrincipal,
    recursiveContext(f.lease, 'start-child'),
  );
  assert.equal(view.phase, 'awaiting_plan_approval');
  const events = f.driver.coordination.events();
  const lineage = events.find((event) => event.kind === 'run.lineage_admitted'
    && event.payload.childRunId === childRunId);
  const goal = events.find((event) => event.kind === 'goal.version_defined'
    && event.payload.goal.runId === childRunId);
  const plan = events.find((event) => event.kind === 'plan.version_proposed'
    && event.payload.plan.runId === childRunId);
  assert.ok(lineage, 'recursive application start durably admits lineage');
  assert.ok(goal);
  assert.ok(plan);
  assert.equal(lineage.seq < goal.seq, true, 'lineage precedes the first child effect');
  assert.equal(lineage.seq < plan.seq, true);
  assert.equal(lineage.payload.parentRunId, f.parent.runId);
  assert.equal(lineage.payload.lease.id, f.lease.leaseId);
  assert.deepEqual(f.driver.coordination.runChildren(f.parent.runId)
    .map((row) => row.childRunId), [childRunId]);
});

test('RA2 RED: public arguments and principals cannot inject recursive session or lease authority', async () => {
  const base = { intent: intent('run-public-authority-forgery') };
  for (const [field, value] of [
    ['sessionAuthority', { schemaVersion: 1 }],
    ['orchestratorLeaseId', 'run-orchestrator-lease:forged'],
    ['sessionAuthorityDigest', 'a'.repeat(64)],
    ['expiresAt', '2099-01-01T00:00:00.000Z'],
  ]) {
    assert.throws(
      () => validateApplicationCommandArgs('run.start', { ...base, [field]: value }),
      (error) => error.code === 'application_command_invalid', field,
    );
  }
  assert.throws(
    () => validateApplicationCommandArgs('run.status', {
      runId: 'run-public-authority-forgery', sessionAuthority: {},
    }),
    (error) => error.code === 'application_command_invalid',
  );
  assert.deepEqual(APPLICATION_COMMAND_DEFINITIONS['run.start'].args, ['intent']);
  assert.deepEqual(APPLICATION_COMMAND_DEFINITIONS['run.status'].args, ['runId']);
  assert.deepEqual(APPLICATION_COMMAND_DEFINITIONS['run.stop'].args, ['runId', 'reason']);
  await assert.rejects(
    BatonApplication.prototype.command.call({
      _assertOpen() {},
    }, 'run.status', { runId: 'run-public-authority-forgery' }, {
      ...principal('forger'), orchestratorLeaseId: 'run-orchestrator-lease:forged',
    }),
    (error) => error.code === 'application_authority_invalid',
  );
});

test('RA3 RED: recursive lease permits only start/status-or-inspect/stop within descendants', async (t) => {
  const f = fixture('attenuation');
  t.after(() => cleanupFixture(f));
  const childRunId = 'run-phase77-attenuated-child';
  const context = recursiveContext(f.lease, 'attenuation-start');
  const started = await f.application.command(
    'run.start', { intent: intent(childRunId) }, f.recursivePrincipal, context,
  );
  assert.equal(started.runId, childRunId);
  assert.equal((await f.application.command(
    'run.status', { runId: childRunId }, f.recursivePrincipal,
    { ...context, requestId: 'status-child', idempotencyKey: 'direct.recursive:status-child' },
  )).runId, childRunId);
  assert.equal((await f.application.command(
    'run.inspect', { runId: childRunId, depth: 'outline' }, f.recursivePrincipal,
    { ...context, requestId: 'inspect-child', idempotencyKey: 'direct.recursive:inspect-child' },
  )).runId, childRunId);
  assert.equal(await f.application.authorizeReplay(
    'run.stop', { runId: childRunId, reason: 'Stop only this recursive subtree.' },
    f.recursivePrincipal,
    { ...context, requestId: 'stop-child', idempotencyKey: 'direct.recursive:stop-child' },
  ), true);

  await assert.rejects(
    f.application.authorizeReplay(
      'run.approve', { runId: childRunId, planDigest: started.plan.digest },
      f.recursivePrincipal,
      { ...context, requestId: 'approve-child', idempotencyKey: 'direct.recursive:approve-child' },
    ),
    (error) => error.code === 'run_orchestrator_command_forbidden',
  );
  for (const [label, runId] of [
    ['parent', f.parent.runId], ['unrelated', 'run-phase77-unrelated'],
  ]) {
    await assert.rejects(
      f.application.authorizeReplay(
        'run.status', { runId }, f.recursivePrincipal,
        { ...context, requestId: `status-${label}`, idempotencyKey: `direct.recursive:status-${label}` },
      ),
      (error) => error.code === 'run_orchestrator_scope_forbidden', label,
    );
  }
});

const waitInvalidationCases = Object.freeze([
  Object.freeze({
    label: 'expired', code: 'run_orchestrator_lease_expired',
    inactivate(f) { f.clock.set('2026-07-18T08:01:00.001Z'); },
  }),
  Object.freeze({
    label: 'revoked', code: 'run_orchestrator_lease_revoked',
    inactivate(f) {
      f.driver.coordination.revokeRunOrchestratorLease({
        schemaVersion: 1,
        leaseId: f.lease.leaseId,
        leaseDigest: f.lease.leaseDigest,
        reason: 'session_revoked',
      }, {
        actor: 'operator:phase77-application',
        key: `run.orchestrator_lease.revoke:${f.lease.leaseId}`,
      });
    },
  }),
]);

function invalidateRecipientWhenWaitWakes(f, runId, invalidation) {
  const coordination = f.driver.coordination;
  const waitAfter = coordination.waitAfter.bind(coordination);
  const marker = `post-${invalidation.label}-run-data-must-not-return`;
  let woke = false;
  coordination.waitAfter = async (afterCursor, timeoutMs, options) => {
    if (!woke) {
      woke = true;
      invalidation.inactivate(f);
      coordination.recordDriver('result.phase77_post_invalidation', {
        runId, marker,
      }, {
        actor: 'fixture:phase77-application',
        key: `phase77.post-invalidation:${runId}:${invalidation.label}`,
      });
    }
    return waitAfter(afterCursor, timeoutMs, options);
  };
  return {
    marker,
    woke: () => woke,
  };
}

test('RA6 RED: recursive run.inspect revalidates its recipient lease after wait and before projection', async (t) => {
  for (const invalidation of waitInvalidationCases) {
    await t.test(invalidation.label, async (t) => {
      const f = fixture(`inspect-wait-${invalidation.label}`);
      t.after(() => cleanupFixture(f));
      const runId = `run-phase77-inspect-wait-${invalidation.label}`;
      const started = await f.application.command(
        'run.start', { intent: intent(runId) }, f.recursivePrincipal,
        recursiveContext(f.lease, `inspect-start-${invalidation.label}`),
      );
      const wake = invalidateRecipientWhenWaitWakes(f, runId, invalidation);
      const inspectContext = recursiveContext(f.lease, `inspect-wait-${invalidation.label}`);
      const semanticEnvelope = f.application._semanticEnvelope.bind(f.application);
      let projectedAfterWait = false;
      f.application._semanticEnvelope = (...args) => {
        projectedAfterWait = true;
        return semanticEnvelope(...args);
      };

      let returned;
      let refusal;
      try {
        returned = await f.application.command('run.inspect', {
          runId, depth: 'outline', cursor: started.cursor, waitMs: 500,
        }, f.recursivePrincipal, inspectContext);
      } catch (error) {
        refusal = error;
      }

      assert.equal(wake.woke(), true, 'the lease changes only inside the durable wait boundary');
      assert.equal(f.driver.coordination.events().some(
        (event) => event.payload?.marker === wake.marker,
      ), true, 'post-invalidation Run data exists and would be visible without revalidation');
      assert.equal(returned, undefined, 'no inspection projection is returned after authority changes');
      assert.equal(refusal?.code, invalidation.code);
      assert.equal(projectedAfterWait, false,
        'semantic Run content is not projected after the recipient lease becomes inactive');
      assert.equal(JSON.stringify(refusal).includes(wake.marker), false);
    });
  }
});

test('RA7 RED: recursive run.follow revalidates its recipient lease after wait and immediately before return', async (t) => {
  for (const invalidation of waitInvalidationCases) {
    await t.test(invalidation.label, async (t) => {
      const f = fixture(`follow-wait-${invalidation.label}`);
      t.after(() => cleanupFixture(f));
      const runId = `run-phase77-follow-wait-${invalidation.label}`;
      const started = await f.application.command(
        'run.start', { intent: intent(runId) }, f.recursivePrincipal,
        recursiveContext(f.lease, `follow-start-${invalidation.label}`),
      );
      const wake = invalidateRecipientWhenWaitWakes(f, runId, invalidation);

      let returned;
      let refusal;
      try {
        returned = await f.application.command('run.follow', {
          runId, afterCursor: started.cursor, timeoutMs: 500,
        }, f.recursivePrincipal, recursiveContext(f.lease, `follow-wait-${invalidation.label}`));
      } catch (error) {
        refusal = error;
      }

      assert.equal(wake.woke(), true, 'the lease changes only after follow enters durable wait');
      assert.equal(f.driver.coordination.events().some(
        (event) => event.payload?.marker === wake.marker,
      ), true, 'post-invalidation Run data exists and would otherwise satisfy follow');
      assert.equal(returned, undefined, 'no follow page is returned after authority changes');
      assert.equal(refusal?.code, invalidation.code);
      assert.equal(JSON.stringify(refusal).includes(wake.marker), false);
    });
  }
});

function stopPerformer({ stop, outcome }) {
  const completions = [];
  const calls = [];
  const application = Object.create(BatonApplication.prototype);
  application._runStopPromises = new Map();
  application._runRetryControllers = new Map();
  application._abortResultExportDeliveries = async () => {};
  application.driver = {
    coordination: {
      runStop: () => stop,
      pendingRunVerificationRetries: () => [],
      completeRunStop(runId, receipt) {
        completions.push({ runId, receipt });
        return { stop: { ...stop, status: 'stopped', receipt } };
      },
    },
    coordinator: {
      async stopRunTargets(workerIds, actor) {
        calls.push({ workerIds, actor });
        return structuredClone(outcome);
      },
    },
  };
  return { application, calls, completions };
}

const subtreeStop = Object.freeze({
  schemaVersion: 1, status: 'stopping', scope: 'run_subtree', repoId: REPO,
  runId: 'run-phase77-stop-child',
  targetRunIds: ['run-phase77-stop-child', 'run-phase77-stop-grandchild'],
  targetTaskIds: ['task-phase77-stop-child', 'task-phase77-stop-grandchild'],
  targetWorkerIds: ['worker-phase77-stop-child', 'worker-phase77-stop-grandchild'],
  targetDigest: 'd'.repeat(64), actor: 'direct:recursive-stop',
});

test('RA4 RED: subtree stop never claims stopped while one snapped process remains unreaped', async () => {
  const f = stopPerformer({
    stop: subtreeStop,
    outcome: {
      targetCount: 2, remainingCount: 1,
      counts: {
        pendingCancelled: 0, killConfirmed: 2, alreadyTerminal: 0,
        processesObserved: 2, processesClosed: 1,
      },
      checks: { interactionsResolved: true, runAuthorityReleased: true },
    },
  });
  await assert.rejects(
    f.application._performRunStop(subtreeStop),
    (error) => error.code === 'application_run_stop_incomplete',
  );
  assert.deepEqual(f.calls, [{
    workerIds: subtreeStop.targetWorkerIds,
    actor: subtreeStop.actor,
  }]);
  assert.equal(f.completions.length, 0, 'no durable stopped receipt exists before exact reap');
});

test('RA5 RED: physical subtree stop uses the immutable descendant worker union exactly once', async () => {
  const f = stopPerformer({
    stop: subtreeStop,
    outcome: {
      targetCount: 2, remainingCount: 0,
      counts: {
        pendingCancelled: 0, killConfirmed: 2, alreadyTerminal: 0,
        processesObserved: 2, processesClosed: 2,
      },
      checks: { interactionsResolved: true, runAuthorityReleased: true },
    },
  });
  const receipt = await f.application._performRunStop(subtreeStop);
  assert.deepEqual(f.calls, [{
    workerIds: subtreeStop.targetWorkerIds,
    actor: subtreeStop.actor,
  }]);
  assert.equal(f.completions.length, 1);
  assert.equal(receipt.scope, 'run_subtree');
  assert.equal(receipt.targetCount, subtreeStop.targetWorkerIds.length);
  assert.equal(receipt.remainingCount, 0);
  assert.equal(receipt.targetDigest, subtreeStop.targetDigest);
  assert.equal(receipt.counts.processesObserved, 2);
  assert.equal(receipt.counts.processesClosed, 2);
});

function createRecipientAuthority(f, runId, label) {
  const taskId = `task-${label}-orchestrator`;
  const workerId = `worker-${label}-orchestrator`;
  f.driver.coordination.createTask({
    id: taskId,
    brief: {
      objective: 'Coordinate one bounded descendant through the ordinary Baton Run application.',
      capabilities: ['baton_orchestrator'],
    },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = f.driver.coordination.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  }, {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","model-a","low"]',
  }).task;
  const recipient = principal(`${label}-recipient`);
  const lease = issueLease(f.driver.coordination, {
    runId, taskId, workerId, task,
  }, recipient);
  return { lease, recipient, taskId, workerId };
}

function admitDescendant(f, authority, childRunId, label) {
  return f.driver.coordination.admitRunLineage({
    schemaVersion: 1, repoId: REPO, childRunId,
    intentDigest: digest({ objective: `Bounded descendant ${label}` }),
  }, {
    actor: `worker:${authority.workerId}`,
    key: `run.lineage:${childRunId}`,
    principalId: authority.recipient.principalId,
    sessionId: authority.recipient.sessionId,
    sessionAuthorityDigest: authority.lease.session.authorityDigest,
    orchestratorLeaseId: authority.lease.leaseId,
  });
}

function admitSubtreeStop(f, runId, reason) {
  const reasonDigest = digest(reason);
  return f.driver.coordination.admitRunStop({
    schemaVersion: 1, repoId: REPO, runId, reasonDigest,
    requestDigest: digest({ repoId: REPO, runId, reasonDigest }),
  }, { actor: 'direct:phase77-orchestration', key: `run.stop:${runId}` });
}

function assertOrchestrationIsSanitized(value, f, authority) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(f.repository), false, 'repository paths remain deployment-private');
  for (const field of [
    'authorityDigest', 'leaseDigest', 'requestDigest', 'admissionDigest', 'policyDigest',
    'taskId', 'workerId', 'principalId', 'sessionId', 'leaseId',
  ]) {
    assert.equal(serialized.includes(`"${field}"`), false, `orchestration leaked ${field}`);
  }
  for (const marker of [
    authority.taskId, authority.workerId, authority.recipient.principalId,
    authority.recipient.sessionId, authority.lease.leaseId, authority.lease.leaseDigest,
    authority.lease.requestDigest, authority.lease.session.authorityDigest,
  ]) {
    assert.equal(serialized.includes(marker), false, `orchestration leaked private marker ${marker}`);
  }
}

test('RA8 RED: outline and orchestration section unify sanitized per-Run topology, effective recipient authority, and subtree-stop truth', async (t) => {
  const f = fixture('orchestration-cascade');
  t.after(() => cleanupFixture(f));
  const runId = 'run-phase77-orchestration-child';
  await f.application.command(
    'run.start', { intent: intent(runId) }, f.recursivePrincipal,
    recursiveContext(f.lease, 'orchestration-start'),
  );
  const authority = createRecipientAuthority(f, runId, 'phase77-orchestration-child');
  const grandchildRunId = 'run-phase77-orchestration-grandchild';
  admitDescendant(f, authority, grandchildRunId, 'grandchild');

  const expectedOpen = {
    schemaVersion: 1,
    role: 'descendant',
    depth: 1,
    topology: { hasParent: true, directChildren: 1, descendants: 1 },
    recipientAuthority: {
      state: 'active',
      counts: { total: 1, active: 1, expired: 0, revoked: 0, inactive: 0 },
    },
    subtreeStop: { state: 'open', inherited: false, targets: null },
  };
  const outline = await f.application.command(
    'run.inspect', { runId, depth: 'outline' }, principal('owner'),
  );
  assert.deepEqual(outline.outline.orchestration, expectedOpen,
    'the first screen carries compact recursive authority and topology truth');
  assertOrchestrationIsSanitized(outline.outline.orchestration, f, authority);

  const section = await f.application.command(
    'run.inspect', { runId, depth: 'section', section: 'orchestration' }, principal('owner'),
  );
  assert.equal(section.section.itemCount, 1);
  assert.deepEqual(section.section.items[0].value, expectedOpen,
    'one expansion returns the same durable truth instead of scattered lease receipts');
  assertOrchestrationIsSanitized(section.section.items[0].value, f, authority);

  const admitted = admitSubtreeStop(
    f, runId, 'Freeze the exact child subtree for orchestration AX inspection.',
  );
  const expectedStopping = {
    ...expectedOpen,
    recipientAuthority: {
      state: 'inactive',
      counts: { total: 1, active: 0, expired: 0, revoked: 0, inactive: 1 },
    },
    subtreeStop: {
      state: 'stopping', inherited: false,
      targets: { runs: 2, tasks: 1, workers: 1, remainingWorkers: 1 },
    },
  };
  assert.deepEqual(admitted.stop.targetRunIds, [runId, grandchildRunId].sort());
  const stopping = await f.application.command(
    'run.inspect', { runId, depth: 'section', section: 'orchestration' }, principal('owner'),
  );
  assert.deepEqual(stopping.section.items[0].value, expectedStopping,
    'effective lease invalidation and immutable subtree-stop counts are visible together');
  assertOrchestrationIsSanitized(stopping.section.items[0].value, f, authority);
});

test('RA9 RED: change-aware follow classifies recursive authority and lineage as orchestration while preserving stop as cleanup', async (t) => {
  const f = fixture('orchestration-follow');
  t.after(() => cleanupFixture(f));
  const runId = 'run-phase77-orchestration-follow-child';
  const started = await f.application.command(
    'run.start', { intent: intent(runId) }, f.recursivePrincipal,
    recursiveContext(f.lease, 'orchestration-follow-start'),
  );

  const authority = createRecipientAuthority(f, runId, 'phase77-orchestration-follow');
  const grandchildRunId = 'run-phase77-orchestration-follow-grandchild';
  admitDescendant(f, authority, grandchildRunId, 'follow-grandchild');
  admitSubtreeStop(f, runId, 'Expose a categorized cleanup transition without private coordinates.');

  const followed = await f.application.command('run.follow', {
    runId, afterCursor: started.cursor, timeoutMs: 100,
  }, principal('owner'));
  const changes = followed.follow.changes;
  assert.deepEqual(
    changes.find((change) => change.kind === 'run.orchestrator_lease_issued'),
    {
      seq: authority.lease.issuedEvent,
      category: 'orchestration',
      kind: 'run.orchestrator_lease_issued',
      summary: 'Run orchestration authority or topology changed.',
    },
  );
  assert.equal(
    changes.find((change) => change.kind === 'run.lineage_admitted')?.category,
    'orchestration',
  );
  assert.equal(
    changes.find((change) => change.kind === 'run.stop_admitted')?.category,
    'cleanup',
  );
  assertOrchestrationIsSanitized(changes, f, authority);
});
