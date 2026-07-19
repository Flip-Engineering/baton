import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Coordinator } from '../src/coordinator.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { normalizeWorkflowRevision, workflowRevisionDigest } from '../src/workflow-revision.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const repoId = 'repo-phase80-revision';
const runId = 'run-phase80-revision';
const resultSha = 'e'.repeat(40);
const retainedResultRef = `refs/baton/results/${resultSha}`;
const route = Object.freeze({ vendor: 'stub', model: 'stub-model', effort: 'high' });
const policy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 3_600_000,
  riskClasses: ['low', 'high'], effectClasses: ['provider_call', 'repository_edit'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 16,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_000, maxProviderTurns: 1_000,
  }),
});
const auth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId, repoId, runId, key,
  sessionDigest: digest(`session:${principalId}`),
});
const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});
const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
  expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000,
  maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [],
});

function gate(goal, plan, nodeKey) {
  const node = plan.nodes.find((entry) => entry.key === nodeKey);
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey, expectedDispatchVersion: 0,
    capabilities: node.capabilities, effects: node.effects,
  };
}

function fixture(name, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), `baton-phase80-revision-${name}-`));
  const operational = new Map();
  let liveLog = null;
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`)
    ?? liveLog?.read(worker).find((event) => event.seq === seq) ?? null;
  const store = new CoordinationStore(directory, {
    goalPlanPolicy: policy, operationalRead, clock: () => '2026-07-18T16:00:00.000Z',
  });
  const goal = store.defineGoal({
    objective: 'Produce and revise one verified Candidate',
    definitionOfDone: ['The Candidate satisfies the exact correction'],
    constraints: ['Retain exact feedback provenance'], risk: 'high',
    budget: options.goalBudget
      ?? { tokens: 100_000, usd: 10, wallMin: 100, providerTurns: 20 },
    predecessor: null,
  }, auth('goal-owner', `${name}:goal`)).goal;
  const sourcePlan = store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [{
      key: 'attempt:builder', objective: 'Produce a mechanically verified Candidate',
      definitionOfDone: goal.definitionOfDone, deps: [], pathScope: ['src/**'], risk: 'high',
      budget: { tokens: 30_000, usd: 3, wallMin: 30, providerTurns: 6 }, verification,
      routes: { harnesses: [route.vendor], models: [route.model], efforts: [route.effort] },
      capabilities: ['code', 'test'], effects: ['provider_call', 'repository_edit'],
    }],
  }, auth('planner', `${name}:plan:1`)).plan;
  store.approvePlan({ goal: ref('goal', goal), plan: ref('plan', sourcePlan),
    expectedDisposition: null, disposition: 'approved' }, auth('approver', `${name}:approve:1`));
  const sourceGate = gate(goal, sourcePlan, 'attempt:builder');
  const source = store.previewPlanDispatch(sourceGate, route);
  store.createPlanGatedTask({
    id: 'task-builder', brief: source.brief, deps: [], refines: null, runId,
    taskType: 'general', reservedWorkerId: 'worker-builder', vendorRequested: route.vendor,
    modelRequested: route.model, modelPolicy: null, effortRequested: route.effort,
    effortResolved: null, effortObserved: null, routeKey: null, sessionRequest: { mode: 'new' },
  }, sourceGate, route, auth('dispatcher', `${name}:dispatch:1`));
  const claimed = store.claimTask('task-builder', 'worker-builder', 1,
    { actor: 'orchestrator', key: `${name}:claim` }, {
      harnessRequested: route.vendor, harnessResolved: 'stub@1', modelRequested: route.model,
      modelResolved: route.model, modelObserved: route.model, effortRequested: route.effort,
      effortResolved: route.effort, effortObserved: route.effort, routeKey: 'route:stub',
    });
  const changedPaths = ['src/a.mjs'];
  const verdict = { gate: 'accepted' };
  const verify = { worker: 'worker-builder', taskId: 'task-builder', seq: 7,
    ts: '2026-07-18T16:00:00.000Z', kind: 'verify.reverified', actor: 'policy',
    payload: { accept: true, verdict,
      capture: { sha: resultSha, retainedResultRef, changedPaths } } };
  operational.set('worker-builder:7', verify);
  const mapped = store.mapOperationalEvent(verify, { actor: 'policy', key: `${name}:map` });
  const terminal = store.transitionTaskWithArtifacts('task-builder', 'completed', claimed.task.version, [
    { taskId: 'task-builder', kind: 'commit', refs: { sha: resultSha, retainedResultRef },
      mediaType: 'application/vnd.git.commit', accepted: true, provenance: [mapped.evidence] },
    { taskId: 'task-builder', kind: 'verification', refs: { worker: 'worker-builder', workerSeq: 7 },
      mediaType: 'application/vnd.baton.verdict+json', accepted: true,
      provenance: [mapped.evidence] },
  ], { actor: 'policy', key: `${name}:terminal` }, mapped.evidence);
  const commitArtifact = terminal.artifacts.find((artifact) => artifact.kind === 'commit');
  const verificationArtifact = terminal.artifacts.find((artifact) => artifact.kind === 'verification');
  const definitionCore = { schemaVersion: 1, repoId, runId, planDigest: sourcePlan.digest };
  const definitionDigest = digest(definitionCore);
  store.recordDriver('application.workflow_definition_bound', {
    ...definitionCore, definitionDigest,
  }, { actor: 'application:workflow-registry',
    key: `application.workflow_definition_bound:${runId}:${sourcePlan.digest}` });
  const evidenceCore = {
    commitArtifact: { id: commitArtifact.id, digest: commitArtifact.digest },
    verificationArtifact: { id: verificationArtifact.id, digest: verificationArtifact.digest },
    verification: { worker: 'worker-builder', workerSeq: 7, verdictDigest: digest(verdict),
      changedPathsDigest: digest(changedPaths) },
  };
  const evidenceDigest = digest(evidenceCore);
  const candidateCore = { schemaVersion: 1, repoId, runId, planDigest: sourcePlan.digest,
    definitionDigest, role: 'builder', nodeKey: 'attempt:builder', taskId: 'task-builder',
    resultSha, changedPaths, evidence: evidenceCore, evidenceDigest };
  const candidateDigest = digest(candidateCore);
  const candidateId = `candidate:${candidateDigest}`;
  const selectionCore = {
    schemaVersion: 1, repoId, runId, planDigest: sourcePlan.digest, definitionDigest,
    candidate: { id: candidateId, digest: candidateDigest, role: 'builder',
      nodeKey: 'attempt:builder', taskId: 'task-builder', resultSha, retainedResultRef,
      evidenceDigest },
    comparedCandidates: [{ id: candidateId, digest: candidateDigest, role: 'builder' }],
    reason: { text: 'Select the verified Candidate.', digest: digest('Select the verified Candidate.') },
    selectedBy: { actor: 'direct:operator', principalId: 'operator', sessionId: 'session-operator' },
  };
  store.recordDriver('application.workflow_candidate_selected', {
    ...selectionCore, selectionDigest: digest(selectionCore),
  }, { actor: 'direct:operator',
    key: `application.workflow_candidate_selected:${runId}:${sourcePlan.digest}` });
  const feedback = { summary: 'Correct the selected Candidate.', findings: [{
    kind: 'defect', severity: 'high', message: 'Fix the changed path.', path: 'src/a.mjs', line: 1,
  }] };
  const target = { kind: 'candidate', role: 'builder', candidateId, candidateDigest,
    nodeKey: 'attempt:builder', taskId: 'task-builder', resultSha, changedPaths,
    changedPathsDigest: digest(changedPaths), retainedResultRef,
    treeIdentityDigest: digest({ resultSha, retainedResultRef }) };
  const feedbackSource = { kind: 'authenticated_user', actor: 'direct:operator',
    principalId: 'operator', sessionId: 'session-operator' };
  const feedbackId = `feedback:${digest({ repoId, runId, planDigest: sourcePlan.digest,
    definitionDigest, source: feedbackSource, target, feedback })}`;
  const feedbackCore = { schemaVersion: 1, repoId, runId, planDigest: sourcePlan.digest,
    definitionDigest, feedbackId, source: feedbackSource, target, feedback,
    prefix: { throughSeq: store.snapshot().lastSeq, goalDigest: goal.digest,
      planDigest: sourcePlan.digest, definitionDigest } };
  const feedbackDigest = digest(feedbackCore);
  const feedbackEvent = store.recordDriver('application.workflow_feedback_recorded', {
    ...feedbackCore, feedbackDigest,
  }, { actor: 'direct:operator',
    key: `application.workflow_feedback_recorded:${feedbackId}` }).event;
  const revision = normalizeWorkflowRevision({
    schemaVersion: 1, kind: 'candidate_feedback_revision', round: 1,
    workflow: { definitionDigest }, predecessorPlan: ref('plan', sourcePlan),
    parent: { role: 'builder', nodeKey: 'attempt:builder', taskId: 'task-builder',
      candidateId, candidateDigest, resultSha, retainedResultRef,
      treeIdentityDigest: digest({ resultSha, retainedResultRef }), changedPaths,
      changedPathsDigest: workflowRevisionDigest(changedPaths), evidenceDigest,
      commitArtifact: { id: commitArtifact.id, digest: commitArtifact.digest },
      verificationArtifact: { id: verificationArtifact.id, digest: verificationArtifact.digest } },
    feedback: [{ feedbackId, feedbackDigest, eventSeq: feedbackEvent.seq, feedback }],
    decision: { actionId: 'action-revise', principalScopeDigest: '8'.repeat(64),
      reasonDigest: '9'.repeat(64) },
  });
  const plan = store.proposePlan({ goal: ref('goal', goal), predecessor: ref('plan', sourcePlan),
    nodes: [{ key: 'revision:1', objective: 'Revise the selected Candidate from exact feedback',
      definitionOfDone: goal.definitionOfDone, deps: [], pathScope: ['src/**'], risk: 'high',
      budget: { tokens: 30_000, usd: 3, wallMin: 30, providerTurns: 6 }, verification,
      routes: { harnesses: [route.vendor], models: [route.model], efforts: [route.effort] },
      capabilities: ['code', 'test'], effects: ['provider_call', 'repository_edit'], revision }],
  }, auth('planner', `${name}:plan:2`)).plan;
  store.approvePlan({ goal: ref('goal', goal), plan: ref('plan', plan),
    expectedDisposition: null, disposition: 'approved' }, auth('approver', `${name}:approve:2`));
  const revisionGate = gate(goal, plan, 'revision:1');
  const state = options.deferPreview ? null : store.previewPlanRevision(revisionGate, route);
  const fields = state ? { id: 'task-revision', brief: state.brief, deps: [],
    refines: 'task-builder', runId, taskType: 'general', reservedWorkerId: 'worker-revision',
    vendorRequested: route.vendor, modelRequested: route.model, modelPolicy: null,
    effortRequested: route.effort, effortResolved: null, effortObserved: null, routeKey: null,
    sessionRequest: { mode: 'new' }, relation: 'revision', worktreeBaseSha: resultSha } : null;
  return { directory, operationalRead, store, goal, sourcePlan, plan, revisionGate, state,
    fields, attachLog: (log) => { liveLog = log; } };
}

function revisionBrief(state) {
  const { goalPlan: _goalPlan, ...brief } = state.brief;
  return brief;
}

function coordinatorFixture(name, { resolvedResultSha = resultSha } = {}) {
  const f = fixture(name);
  const log = new Log(join(f.directory, 'operational'));
  f.attachLog(log);
  const calls = [];
  const originalCreate = f.store.createPlanRevisionTask.bind(f.store);
  f.store.createPlanRevisionTask = (...args) => {
    calls.push('ledger');
    return originalCreate(...args);
  };
  const adapter = {
    onEvent() {},
    card: () => ({
      harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 1,
      maxContext: 100_000,
      modelSelection: {
        mode: 'exact', configuredDefault: route.model, available: [route.model], family: 'stub',
        acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [route.effort],
        serviceTier: null, provenance: 'phase80-test', refreshedAt: null,
      },
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
        approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      sessions: { multiTurn: 'native', resume: 'unsupported', fork: 'unsupported' },
    }),
    async spawn() { calls.push('provider'); return { ok: false, reason: 'test boundary' }; },
    async prompt() { return { ok: false }; },
    async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; },
    async approve() { return { ok: true }; },
    async answer() { return { ok: true }; },
  };
  const worktrees = {
    async resolveResult(refValue) {
      calls.push('resolve');
      assert.equal(refValue, retainedResultRef);
      return resolvedResultSha;
    },
    async reserveCapacity(taskId, baseSha) {
      calls.push('reserve');
      assert.equal(taskId, 'task-revision');
      assert.equal(baseSha, resultSha);
      return { baseSha, reservation: { id: 'revision-capacity' } };
    },
    async create(taskId, baseSha) {
      calls.push('worktree');
      return { path: `/tmp/${taskId}`, branch: `baton/${taskId}`, baseSha };
    },
    async releaseCapacity() { calls.push('release'); },
    async remove() {},
    async reconcile() {},
  };
  const coordinator = new Coordinator({
    log, coordination: f.store, fences: new FenceTable(), adapters: { stub: adapter }, worktrees,
    repoId, goalPlanAuthority: { policy: f.store.goalPlanPolicy(), authorize: async () => true },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => route.vendor,
    stopDeadlineMs: 50,
  });
  const member = { brief: revisionBrief(f.state), effort: route.effort,
    goalPlan: f.revisionGate, model: route.model, runId, taskId: 'task-revision',
    vendor: route.vendor };
  const opts = { actor: 'direct:dispatcher', principalId: 'dispatcher',
    sessionId: 'session-dispatcher', powers: ['plan:dispatch'],
    idempotencyKey: `${name}:revision` };
  return { ...f, calls, coordinator, member, opts };
}

async function closeCoordinatorFixture(f, name) {
  try {
    await f.coordinator.drain({ actor: 'phase80-test', repoId,
      idempotencyKey: `${name}:drain` });
    f.coordinator.closeAuthority();
  } finally {
    f.store.releaseWriterLease();
    rmSync(f.directory, { recursive: true, force: true });
  }
}

test('RF1: dedicated revision admission binds exact predecessor Candidate, feedback, and base in one pair', (t) => {
  const f = fixture('atomic'); t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  assert.throws(() => f.store.previewPlanDispatch(f.revisionGate, route),
    (error) => error?.code === 'plan_revision_api_required');
  const before = f.store.events().length;
  const admitted = f.store.createPlanRevisionTask(f.fields, f.revisionGate, route,
    auth('dispatcher', 'atomic:revision'));
  const appended = f.store.events().slice(before);
  assert.deepEqual(appended.map((event) => event.kind), ['plan.node_dispatched', 'task.created']);
  assert.equal(new Set(appended.map((event) => event.batch.id)).size, 1);
  assert.equal(admitted.task.relation, 'revision');
  assert.equal(admitted.task.refines, 'task-builder');
  assert.equal(admitted.task.worktreeBaseSha, resultSha);
  assert.equal(admitted.task.brief.revisionContext.revisionDigest,
    f.plan.nodes[0].revision.revisionDigest);
  const replayed = f.store.createPlanRevisionTask(f.fields, f.revisionGate, route,
    auth('dispatcher', 'atomic:revision'));
  assert.equal(replayed.result, 'idempotent');
});

test('RF2: revision lineage/base substitution and generic relation bypass fail before append', (t) => {
  const f = fixture('refuse'); t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const before = f.store.events().length;
  assert.throws(() => f.store.createPlanRevisionTask({ ...f.fields, worktreeBaseSha: '0'.repeat(40) },
    f.revisionGate, route, auth('dispatcher', 'refuse:bad-base')),
  (error) => error?.code === 'plan_revision_invalid');
  assert.throws(() => f.store.createTask({ ...f.fields, brief: { ...f.fields.brief, goalPlan: undefined } },
    { actor: 'orchestrator', key: 'refuse:generic' }),
  (error) => error?.code === 'plan_revision_api_required');
  assert.equal(f.store.events().length, before);
});

test('RF2: cumulative predecessor Plan totals cannot overspend one individually-valid Goal', (t) => {
  const f = fixture('cumulative-budget', {
    deferPreview: true,
    goalBudget: { tokens: 50_000, usd: 5, wallMin: 50, providerTurns: 12 },
  });
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  assert.throws(() => f.store.previewPlanRevision(f.revisionGate, route),
    (error) => error?.code === 'workflow_revision_invalid'
      && /cumulative Plan authority/u.test(error.message));
});

test('RF3: Coordinator derives revision lineage and preflights retained ref plus exact capacity before ledger', async (t) => {
  const f = coordinatorFixture('coordinator');
  t.after(() => closeCoordinatorFixture(f, 'coordinator'));
  const handle = await f.coordinator.spawnPlanRevision(f.member, f.opts);
  assert.deepEqual(f.calls.slice(0, 3), ['resolve', 'reserve', 'ledger']);
  const task = f.store.task('task-revision');
  assert.equal(handle.taskId, 'task-revision');
  assert.equal(task.relation, 'revision');
  assert.equal(task.refines, 'task-builder');
  assert.equal(task.worktreeBaseSha, resultSha);
  assert.equal(f.coordinator._tasks.get('task-revision').refines, 'task-builder');
  assert.equal(f.calls.filter((call) => call === 'reserve').length, 1);
});

test('RF4: retained result mismatch refuses before capacity, ledger, worktree, or provider effects', async (t) => {
  const f = coordinatorFixture('mismatch', { resolvedResultSha: '0'.repeat(40) });
  t.after(() => closeCoordinatorFixture(f, 'mismatch'));
  const before = f.store.events().length;
  await assert.rejects(() => f.coordinator.spawnPlanRevision(f.member, f.opts),
    (error) => error?.code === 'plan_revision_result_ref_mismatch');
  assert.deepEqual(f.calls, ['resolve']);
  assert.equal(f.store.events().length, before);
  assert.equal(f.store.task('task-revision'), null);
});

test('RF5: dedicated revision replay reconciles exactly and rehydrates with integrity validation', (t) => {
  const f = fixture('replay'); let replay = null;
  t.after(() => {
    replay?.releaseWriterLease();
    f.store.releaseWriterLease();
    rmSync(f.directory, { recursive: true, force: true });
  });
  f.store.createPlanRevisionTask(f.fields, f.revisionGate, route,
    auth('dispatcher', 'replay:revision'));
  const reconciled = f.store.reconcilePlanRevisionTask('task-revision', f.revisionGate, route,
    auth('dispatcher', 'replay:revision'));
  assert.equal(reconciled.result, 'reconciled');
  assert.throws(() => f.store.reconcilePlanRevisionTask('task-revision', f.revisionGate,
    { ...route, effort: 'low' }, auth('dispatcher', 'replay:revision')),
  (error) => error?.code === 'plan_revision_conflict');
  f.store.releaseWriterLease();
  replay = new CoordinationStore(f.directory, {
    goalPlanPolicy: policy, operationalRead: f.operationalRead,
    clock: () => '2026-07-18T16:00:00.000Z',
  });
  const task = replay.task('task-revision');
  assert.equal(task.relation, 'revision');
  assert.equal(task.refines, 'task-builder');
  assert.equal(task.worktreeBaseSha, resultSha);
  assert.equal(task.brief.revisionContext.revisionDigest,
    f.plan.nodes[0].revision.revisionDigest);
});
