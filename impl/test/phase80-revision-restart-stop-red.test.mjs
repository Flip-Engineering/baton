import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BatonApplication, MockAdapter, bindBaton, createDriver,
} from '../src/index.mjs';

const repoId = 'repo-phase80-revision-restart';
const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'medium' });

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification,
  routes: [routeA, routeB],
  capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const principal = (principalId) => Object.freeze({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase80-revision-restart-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase80@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 80'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, path, tracker, { revisionDelayMs = 20 } = {}) {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: {
      outcome: 'completed', edits: [{ path, content: `${route.harness}\n`, delayMs: 20 }],
    },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase80-revision-restart-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  value.spawn = (worker, brief, options) => {
    const revision = brief?.revisionContext ?? null;
    tracker.calls.push({
      worker, harness: route.harness, model: options?.model,
      effort: options?.reasoningEffort, revision: revision !== null,
    });
    return nativeSpawn(worker, brief, {
      ...options,
      ...(revision ? {
        scenario: {
          outcome: 'completed',
          edits: [{
            path, content: `${route.harness}-revision\n`, delayMs: revisionDelayMs,
          }],
        },
      } : {}),
    });
  };
  return value;
}

function applicationFixture({ repo, logDir, tracker, revisionDelayMs = 20 }) {
  const adapters = {
    codex: adapter(routeA, 'candidate-a.txt', tracker, { revisionDelayMs }),
    grok: adapter(routeB, 'candidate-b.txt', tracker, { revisionDelayMs }),
  };
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters,
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: { default: profile },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  return {
    adapters, application, driver,
    baton: bindBaton(application, principal('workflow-owner')),
  };
}

async function proposedRevision(fixture) {
  const workflow = await fixture.baton.workflow(
    'Produce and correct an attributable restart-safe Candidate.',
    {
      team: [
        { role: 'builder', exact: routeA },
        { role: 'challenger', exact: routeB },
      ],
    },
  );
  await workflow.complete();
  const initial = await fixture.application.wait(
    workflow.id, principal('workflow-owner'), { timeoutMs: 5_000 },
  );
  assert.equal(initial.phase, 'selection_required');
  await workflow.sendFeedback('builder', {
    summary: 'Correct the selected Candidate without losing its immutable basis.',
    findings: [{
      kind: 'defect', severity: 'high', message: 'Revise this exact changed path.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  await workflow.select('builder', 'Use builder as the correction basis.');
  const proposed = await workflow.revise('Address the recorded defect in a gated correction round.');
  assert.equal(proposed.outline.phase, 'awaiting_plan_approval');
  return workflow;
}

function revisionDispatches(driver, planDigest) {
  return driver.coordination.events().filter((event) => (
    event.kind === 'plan.node_dispatched'
    && event.payload?.binding?.planDigest === planDigest
    && event.payload?.revision
  ));
}

test('AR80-RS1: lost successor-approval response restarts one exact revision dispatch', async (t) => {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-phase80-revision-approval-loss-'));
  const tracker = { calls: [] };
  let current = applicationFixture({ repo, logDir, tracker });
  t.after(async () => {
    try { await current?.application.shutdown(principal('cleanup')); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const workflow = await proposedRevision(current);
  const before = await workflow.status();
  const providerCallsBeforeApproval = tracker.calls.length;
  await current.driver.coordinator.approvePlan({
    goal: {
      goalId: before.goal.id, version: before.goal.version, digest: before.goal.digest,
    },
    plan: {
      planId: before.plan.id, version: before.plan.version, digest: before.plan.digest,
    },
    expectedDisposition: null,
    disposition: 'approved',
  }, {
    actor: 'direct:lost-response-approver',
    principalId: 'lost-response-approver',
    sessionId: 'lost-response-approver-session',
    powers: ['plan:approve'],
    repoId,
    runId: workflow.id,
    idempotencyKey: `phase80:approval-response-loss:${workflow.id}:${before.plan.digest}`,
  });
  assert.equal(revisionDispatches(current.driver, before.plan.digest).length, 0,
    'durable approval alone does not create an unowned provider effect in the old process');
  assert.equal(tracker.calls.length, providerCallsBeforeApproval);
  assert.equal((await current.application.shutdown(principal('restart-boundary'))).state, 'closed');

  current = applicationFixture({ repo, logDir, tracker });
  const replay = current.baton.runs.open(workflow.id);
  const finished = await current.application.wait(
    workflow.id, principal('workflow-owner'), { timeoutMs: 5_000 },
  );
  assert.equal(finished.phase, 'selection_required');
  await replay.status();
  assert.equal(revisionDispatches(current.driver, before.plan.digest).length, 1);
  assert.equal(tracker.calls.filter((call) => call.revision).length, 1,
    'startup reconciliation launches the approved successor once, never redelivers it');
  const rounds = await replay.rounds();
  assert.equal(rounds.section.itemCount, 2);
  assert.equal(rounds.section.items[1].value.candidates.length, 1);
});

test('AR80-RS2: a working revision lost across restart exposes exact typed recovery and forbids redelivery', async (t) => {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-phase80-working-revision-restart-'));
  const tracker = { calls: [] };
  const first = applicationFixture({ repo, logDir, tracker, revisionDelayMs: 60_000 });
  let restarted = null;
  let lostNative = null;
  t.after(async () => {
    lostNative?.haltController.abort();
    try { await first.application.shutdown(principal('old-process-cleanup')); } catch {}
    try { await restarted?.application.shutdown(principal('cleanup')); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const workflow = await proposedRevision(first);
  const active = await workflow.approve();
  assert.equal(active.outline.phase, 'running');
  const working = await workflow.status();
  const attempt = working.attempts.find((candidate) => candidate.nodeKey.startsWith('revision:'));
  assert.ok(attempt?.taskId);
  const task = first.driver.coordination.task(attempt.taskId);
  const workerId = task?.assignee;
  assert.ok(workerId);
  assert.equal(first.driver.coordinator.list().find((row) => row.id === workerId)?.status, 'working');
  assert.equal(tracker.calls.filter((call) => call.revision).length, 1);

  // Model a hard process loss after the durable working state: the provider disappears without
  // a lifecycle terminal receipt, then the old writer lease disappears with the process. The
  // replacement Coordinator must reason only from durable state and may never redeliver.
  const native = first.adapters.codex._sessions.get(workerId);
  assert.ok(native && native.terminal === false);
  lostNative = native;
  first.adapters.codex._clearTimers(native);
  native.terminal = true;
  // Do not send an orderly abort signal: a hard process loss cannot run the old controller's
  // catch/finally path and therefore cannot manufacture a durable provider failure.
  assert.equal(first.driver.coordination.releaseWriterLease({ requireOwned: true }), true);

  restarted = applicationFixture({ repo, logDir, tracker, revisionDelayMs: 60_000 });
  await restarted.application.ready;
  const replay = restarted.baton.runs.open(workflow.id);
  const recovered = await replay.status();

  assert.deepEqual(recovered.recovery, {
    state: 'manual_intervention_required',
    reason: 'revision_worker_unconfirmed_after_restart',
    redelivery: 'forbidden',
    round: 2,
    planDigest: working.plan.digest,
    nodeKey: attempt.nodeKey,
    taskId: attempt.taskId,
    workerId,
  });
  assert.equal(tracker.calls.filter((call) => call.revision).length, 1,
    'restart cannot manufacture a second provider launch for a durable working revision');
  assert.equal(revisionDispatches(restarted.driver, working.plan.digest).length, 1,
    'the one durable revision dispatch remains the only dispatch authority');
  assert.equal(recovered.ownership.workers, 0,
    'a replayed historical coordinate is not current physical ownership');
});
