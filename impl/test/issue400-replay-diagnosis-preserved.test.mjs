// Issue #400 — a replay-adjudication failure is not relabelled as an idempotency conflict.
//
// Audit finding C21 (swarm audit-20260918, umbrella #382): the retry path of a plan recovery
// dispatch replaced the fold's own diagnoses with `plan_recovery_conflict`, so a recorded
// transaction that can no longer be adjudicated was indistinguishable from a reused key. The two
// sites the audit named were `createAndClaimPlanRecoveryRefinement` (the catch around
// `_validateGoalPlanRecoveryTriple`) and the recovery-attempt admission (the catch around
// `_verifiedRecoveryPrior`).
//
// The sibling seam already honours the principle: `_validateGoalPlanReplayTransactions` lets a
// failed triple cross under the fold's own code, and the pair it validates is row-anchored — a
// recorded dispatch is re-derived from the recorded rows, never re-judged by the live policy. The
// retry lane IS prospective (it answers a live request), so it re-reads the live world, the
// predecessor task, and when it refuses, the refusal is the fold's, never the key's.
//
// The rows here: a recovery triple recorded against a completed, hub-verified predecessor whose
// acceptance is revoked afterwards (an approval no longer expires with time, laws revision 12a, so
// the live fact the retry re-reads is the predecessor). The RETRY must name the fold's diagnosis
// (`recovery_refinement_unverified`, the predecessor it can no longer read), and a changed request
// under a used key must still read as the key conflict.
//
// Suite law: hermetic (mkdtemp fixture, fixed clock, no network, no processes).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const repoId = 'repo-issue400-replay-diagnosis';
const runId = 'run-issue400-replay-diagnosis';
const workerId = 'worker-issue400-replay-diagnosis';
const route = Object.freeze({ vendor: 'stub', model: 'model-a', effort: 'low' });
const attribution = Object.freeze({
  harnessRequested: 'stub', harnessResolved: 'stub@issue400',
  modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
  effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
  routeKey: '["stub","issue400","model-a","low"]',
});
const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
  expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000,
  requiredPredecessorEvidence: [],
});
const T0 = Date.parse('2026-07-14T00:00:00.000Z');

/** The deployment's goal/plan policy. The approval window stays a schema field, and no lane here
 * re-judges it: an approval does not expire with time. */
function policyFor() {
  return Object.freeze({
    schemaVersion: 1,
    repoId,
    mandatory: true,
    approvalTtlMs: 60 * 60 * 1_000,
    riskClasses: ['low', 'medium', 'high', 'critical'],
    effectClasses: ['provider_call', 'repository_edit'],
    capabilityClasses: ['code', 'native_session_recovery', 'test'],
    limits: Object.freeze({
      maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
      maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
      maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
      maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
    }),
  });
}

const budget = (tokens, usd, providerTurns) => ({ tokens, usd, wallMin: 10, providerTurns });
const ref = (kind, value) => ({ [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest });
const auth = (principalId, key, extra = {}) => ({
  actor: `direct:${principalId}`, principalId, repoId, runId, key,
  sessionDigest: digest({ principalId, session: `${principalId}-session` }),
  ...extra,
});

function gate(goal, plan, nodeKey) {
  const node = plan.nodes.find((row) => row.key === nodeKey);
  return {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey, expectedDispatchVersion: 0,
    capabilities: [...node.capabilities], effects: [...node.effects],
  };
}

function planNode({
  key, objective, definitionOfDone, deps, tokens, usd, providerTurns, recovery,
}) {
  return {
    key, objective, definitionOfDone: [definitionOfDone], deps, pathScope: ['impl/**'], risk: 'high',
    budget: budget(tokens, usd, providerTurns),
    verification: { ...verification, requiredPredecessorEvidence: [...deps] },
    routes: { harnesses: ['stub'], models: ['model-a'], efforts: ['low'] },
    capabilities: recovery ? ['code', 'native_session_recovery', 'test'] : ['code', 'test'],
    effects: ['provider_call', 'repository_edit'],
  };
}

/** One deployment: the goal/plan authority, one completed hub-verified predecessor with an accepted
 * artifact, and the recovery dispatch the retry path answers. `revoke` records the later mapped
 * provider evidence and revokes that predecessor's acceptance. */
function fixture(label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue400-${label}-`));
  const operational = new Map();
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`) ?? null;
  let now = T0;
  const policy = policyFor();
  const store = new CoordinationStore(directory, {
    goalPlanPolicy: policy, operationalRead, clock: () => new Date(now).toISOString(),
  });

  const done = [
    'implemented result is hub verified',
    'eligible native session recovery is exact',
  ];
  const goal = store.defineGoal({
    objective: 'Recover one Plan-bound Run without escaping Goal/Plan authority',
    definitionOfDone: done,
    constraints: ['Recovery must remain local and attach-only'],
    risk: 'high', budget: { ...budget(40_000, 5, 12), wallMin: 30 }, predecessor: null,
  }, auth('goal-owner', 'goal:issue400')).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [
      planNode({
        key: 'implement', objective: 'Produce the verified recovery predecessor',
        definitionOfDone: done[0], deps: [], tokens: 20_000, usd: 2, providerTurns: 6, recovery: false,
      }),
      planNode({
        key: 'recover', objective: 'Recover the exact native session under explicit Plan authority',
        definitionOfDone: done[1], deps: ['implement'], tokens: 12_000, usd: 2, providerTurns: 4, recovery: true,
      }),
    ],
  }, auth('planner', 'plan:issue400')).plan;
  const approval = store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval:issue400')).approval;
  assert.equal(approval.disposition, 'approved');

  const implementGate = gate(goal, plan, 'implement');
  const implement = store.previewPlanDispatch(implementGate, route);
  store.createPlanGatedTask({
    id: 'prior-plan-task', brief: implement.brief, deps: implement.resolvedDeps, refines: null,
    runId, taskType: 'general', reservedWorkerId: workerId,
    vendorRequested: route.vendor, modelRequested: route.model, modelPolicy: null,
    effortRequested: route.effort, effortResolved: null, effortObserved: null, routeKey: null,
    sessionRequest: { mode: 'new' },
  }, implementGate, route, auth('dispatcher', 'plan.dispatch:implement'));
  store.claimTask('prior-plan-task', workerId, 1, {
    actor: 'orchestrator', key: 'task.claimed:prior-plan-task',
  }, attribution);
  const verified = {
    worker: workerId, seq: 1, ts: new Date(T0 + 1_000).toISOString(), kind: 'verify.reverified',
    actor: 'policy', taskId: 'prior-plan-task', payload: { accept: true, verdict: { ok: true } },
  };
  operational.set(`${workerId}:1`, verified);
  const evidence = store.mapOperationalEvent(verified, {
    actor: 'policy', key: 'evidence:prior-plan-task:verified',
  }).evidence;
  store.transitionTask('prior-plan-task', 'completed', 2, {
    actor: 'policy', key: 'task.completed:prior-plan-task',
  }, evidence);
  // The revocation target and its evidence: an accepted artifact of the predecessor, then a LATER
  // mapped provider-governance row (the #57 request).
  store.registerArtifact({
    id: 'prior-plan-commit', taskId: 'prior-plan-task', kind: 'commit',
    refs: { id: 'prior-plan-commit' }, accepted: true, provenance: [evidence],
  }, { actor: 'policy', key: 'artifact:prior-plan-task' });
  const adverse = {
    worker: workerId, seq: 2, ts: new Date(T0 + 2_000).toISOString(),
    kind: 'resource.provider_governance_exceeded', payload: { code: 'provider_call_after_terminal' },
  };
  operational.set(`${workerId}:2`, adverse);
  const mappedAdverse = store.mapOperationalEvent(adverse, {
    actor: 'policy', key: 'evidence:prior-plan-task:adverse',
  });
  const revoke = () => store.revokeTaskAcceptance({
    schemaVersion: 1, taskId: 'prior-plan-task', expectedTaskVersion: 3,
    evidence: { coordinationSeq: mappedAdverse.evidence.coordinationSeq },
  }, { actor: 'orchestrator', key: 'revoke-acceptance:prior-plan-task' });
  now = T0 + 5 * 60_000;

  const recoveryGate = gate(goal, plan, 'recover');
  const recovery = store.previewPlanDispatch(recoveryGate, route);
  const recoveryFields = {
    id: 'recovery-plan-task', brief: recovery.brief, deps: recovery.resolvedDeps,
    refines: 'prior-plan-task', runId, taskType: 'general', reservedWorkerId: workerId,
    vendorRequested: route.vendor, modelRequested: route.model, modelPolicy: null,
    effortRequested: route.effort,
    sessionRequest: {
      mode: 'resume', id: 'native-session-issue400',
      context: { worktree: '/tmp/baton-issue400-worktree', ownerTaskId: 'prior-plan-task', baseSha: 'base-sha' },
    },
    relation: 'recovery',
  };
  const recoveryAuth = auth('dispatcher', 'plan.recovery:recover', { actor: 'orchestrator' });
  const call = (target, overrides = {}) => target.createAndClaimPlanRecoveryRefinement(
    overrides.fields ?? recoveryFields,
    overrides.gate ?? recoveryGate,
    overrides.route ?? route,
    overrides.attribution ?? attribution,
    overrides.auth ?? recoveryAuth,
  );
  return { directory, store, operationalRead, policy, recoveryFields, call, revoke };
}

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function fixtureRoot(label, options) {
  const built = fixture(label, options);
  roots.push(built.directory);
  return built;
}

test('an adjudication failure on a key-bound recovery retry crosses under the fold own code, not the key conflict', () => {
  const recorded = fixtureRoot('diagnosis');
  const admitted = recorded.call(recorded.store);
  assert.equal(admitted.result, 'claimed',
    'the triple is recorded against a completed, hub-verified predecessor');
  // The predecessor's acceptance is revoked after the triple was recorded: the recorded rows are
  // untouched, the live predecessor is no longer the completed, hub-verified task the fold
  // requires, and the retry re-reads it. The refusal is the fold's own code, never a key conflict.
  recorded.revoke();
  const before = recorded.store.events().length;
  assert.throws(() => recorded.call(recorded.store), (error) => {
    assert.equal(error.code, 'recovery_refinement_unverified',
      'the retry names the fold diagnosis, never plan_recovery_conflict');
    assert.match(error.message, /hub-verified prior task/u,
      'and the message names the predecessor the fold could not read');
    return true;
  });
  assert.equal(recorded.store.events().length, before, 'the refusal appends nothing');
  recorded.store.releaseWriterLease();
});

test('a changed request under a used key is still the key-reuse conflict', () => {
  const recorded = fixtureRoot('key-reuse');
  const admitted = recorded.call(recorded.store);
  const before = recorded.store.events().length;
  assert.throws(() => recorded.call(recorded.store, {
    fields: {
      ...recorded.recoveryFields,
      sessionRequest: { ...recorded.recoveryFields.sessionRequest, id: 'substituted-native-session' },
    },
  }), (error) => {
    assert.equal(error.code, 'plan_recovery_conflict');
    return true;
  });
  assert.equal(recorded.store.events().length, before);
  assert.equal(admitted.result, 'claimed');
  recorded.store.releaseWriterLease();
});
