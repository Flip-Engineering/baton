// Issue #388 (consolidated C9): run dispatch deletes a Run's admitted shared-workspace
// attachment when it refuses a multi-node Plan.
//
// `_dispatchCurrent` refused a multi-node workflow Plan for a Run with an admitted shared
// workspace — and DELETED the admission as a side effect (application.mjs:5015-5019). The
// attachment is the swarm's resolved live observation (which checkout, whose native session
// handed it over, how many holders were in it), admitted once per Run through the recruit
// request's `workspace` field (_admitWorkspaceAttachment, application.mjs:3855-3872). After the
// refusal, the corrected Run dispatched detached with no row saying the attachment was dropped.
//
// The contract now:
//   (a) a refused multi-node plan leaves the shared-workspace attachment in place and readable;
//   (b) the refusal names the attachment and teaches the field, the rule and the next action;
//   (c) a later admitted plan on the same run uses the kept attachment;
//   (d) the run scheduler leaves a kept-attachment refusal to the operator (the kept admission
//       must never turn the startup reconciliation into a boot loop).
//
// Real stack: createDriver + MockAdapter + BatonApplication — real goal/plan ledger, real
// approval and dispatch gates; nothing here mocks the store or the coordinator.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

const repoId = 'repo-issue388';
const routes = Object.freeze([
  Object.freeze({ harness: 'mock', model: 'model-a', effort: 'high' }),
  Object.freeze({ harness: 'mock', model: 'model-b', effort: 'low' }),
]);
// The goal/plan authority context a direct planner call carries (normalizeGoalPlanContext shape).
const planAuthority = (principalId, power, idempotencyKey, runId = null) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
  repoId, runId, powers: [power], idempotencyKey,
});
const principal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const profile = Object.freeze({
  schemaVersion: 1, repoId,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'], risk: 'high',
  goalBudget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 16 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1_024,
    requiredPredecessorEvidence: [],
  },
  routes, capabilities: ['code', 'test'], effects: ['repository_edit', 'provider_call'],
  resultPolicy: { mode: 'none', maxAdoptedResults: 0, locator: 'git_ref' },
});

// A live-observation-shaped attachment: the workspaceId is the shared checkout's owner task,
// the session context names the same owner, one holder was in it.
const WORKSPACE_ID = 'ws-3f9c2a7b5d1e4c8a9b0d2f4e6a8c0b1d';
const workspace = Object.freeze({
  workspaceId: WORKSPACE_ID, holderCount: 1,
  sessionContext: Object.freeze({ ownerTaskId: WORKSPACE_ID }),
});

function fixture(name) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue388-${name}-`));
  const repo = join(world, 'repo');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue388@example.invalid', GIT_COMMITTER_EMAIL: 'issue388@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 388', GIT_COMMITTER_NAME: 'Issue 388' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: {
    outcome: 'completed', edits: [], delayMs: 20,
  } });
  const nativeCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...nativeCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a', 'model-b'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low', 'high'], serviceTier: null,
      provenance: 'issue388-test', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(world, 'log'), adapters: { mock: adapter },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  // Every dispatch the application requests, captured at the application→coordinator seam:
  // opts[2] is the spawn options bag the plain dispatch arm builds (attachedWorkspace rides
  // there). The request is captured, not forwarded — the coordinator's physical-custody
  // validation of the attached checkout is the swarm lane's contract, not this issue's.
  const spawns = [];
  driver.coordinator.spawn = async (...args) => {
    spawns.push(args);
    return { ok: true };
  };
  const application = new BatonApplication({
    driver, repoId, profiles: { workflow: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return {
    application, driver, spawns: () => spawns, world,
    cleanup: async () => {
      try { await application.shutdown(principal('shutdown')); } catch { /* refusal already held */ }
      rmSync(world, { recursive: true, force: true });
    },
  };
}

const intent = (runId) => ({
  runId, objective: 'Settle the shared checkout across one work node', profile: 'workflow',
  scope: ['impl/**'],
  composition: {
    strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
    team: [
      { role: 'builder', route: routes[0] },
      { role: 'challenger', route: routes[1] },
    ],
  },
});

/** Drive one composition Run to the multi-node refusal with the attachment admitted first —
 * the exact sequence the swarm lane runs (admit at startRun, then the Run's Plan refuses). */
async function refusedRun(f, runId) {
  f.application._admitWorkspaceAttachment(runId, workspace);
  const planned = await f.application.start(intent(runId), principal('owner'));
  const refusal = await f.application.approve(planned.runId, planned.plan.digest, principal('approver')).then(
    () => { throw new Error('a multi-node plan with a shared workspace attachment must refuse'); },
    (error) => error,
  );
  assert.equal(refusal.code, 'application_workspace_attachment_unsupported');
  return refusal;
}

test('(a) a refused multi-node plan leaves the shared-workspace attachment in place and readable', async (t) => {
  const f = fixture('kept');
  t.after(f.cleanup);
  await f.application.ready;
  await refusedRun(f, 'run-388-kept');
  const kept = f.application._workspaceAttachments.get('run-388-kept');
  assert.ok(kept, 'the admitted attachment survives the refusal');
  assert.deepEqual(kept, {
    workspaceId: WORKSPACE_ID, context: { ownerTaskId: WORKSPACE_ID },
  }, 'the kept attachment is exactly the admitted observation');
});

test('(b) the refusal names the attachment and teaches the field, the rule and the next action', async (t) => {
  const f = fixture('teaching');
  t.after(f.cleanup);
  await f.application.ready;
  const refusal = await refusedRun(f, 'run-388-teach');
  assert.match(refusal.message, new RegExp(WORKSPACE_ID, 'u'), 'the message names the attachment');
  assert.match(refusal.message, /single-work-node/u, 'the message states the rule');
  assert.match(refusal.message, /exactly one work node/u, 'the message teaches the next action');
  assert.match(refusal.message, /kept/u, 'the message says the admission is preserved');
  assert.equal(refusal.detail.field, 'workspace', 'the detail names the admission field');
  assert.equal(refusal.detail.workspaceId, WORKSPACE_ID, 'the detail carries the attachment');
  assert.equal(refusal.detail.runId, 'run-388-teach', 'the detail carries the run');
  assert.match(refusal.detail.rule, /single-work-node/u);
  assert.match(refusal.detail.next, /exactly one work node/u, 'the next action is the correction');
});

test('(c) a later admitted plan on the same run uses the kept attachment', async (t) => {
  const f = fixture('reuse');
  t.after(f.cleanup);
  await f.application.ready;
  await refusedRun(f, 'run-388-reuse');
  assert.equal(f.spawns().length, 0, 'the refused plan dispatched nothing');
  // The operator corrects the Plan to exactly one work node: a successor Plan generation on the
  // SAME run and goal, carrying the run's own first node re-keyed to the plain work node.
  const { goal, plan } = f.driver.coordination.goalPlanRun(repoId, 'run-388-reuse');
  const proposed = await f.driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    predecessor: { planId: plan.planId, version: plan.version, digest: plan.digest },
    nodes: [{ ...plan.nodes[0], key: 'work' }],
  }, planAuthority('planner-reuse', 'plan:propose', 'issue388:reuse:v2', 'run-388-reuse'));
  await f.application.approve('run-388-reuse', proposed.plan.digest, principal('approver'));
  assert.equal(f.spawns().length, 1, 'the corrected plan dispatches exactly once');
  const [, , opts] = f.spawns()[0];
  assert.deepEqual(opts.attachedWorkspace, { ownerTaskId: WORKSPACE_ID },
    'the dispatch rides the kept attachment instead of detaching');
});

test('(d) the run scheduler leaves a kept-attachment refusal to the operator instead of failing readiness', async (t) => {
  const f = fixture('scheduler');
  t.after(f.cleanup);
  await f.application.ready;
  await refusedRun(f, 'run-388-scheduler');
  // The run sits approved and undispatched with its kept admission; the startup reconciliation
  // re-asks every pass and must leave the correction to the operator, not throw readiness away.
  await f.application._reconcileApprovedRuns();
  assert.ok(f.application._workspaceAttachments.has('run-388-scheduler'),
    'the reconciliation keeps the admission too');
});
