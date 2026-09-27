import assert from 'node:assert/strict';
import test from 'node:test';

import { contextMapCallIdentity, contextMapNodeBinding } from '../src/context-map.mjs';
import { contextEffectCallIdentity, contextEffectNodeBinding } from '../src/context-call.mjs';
import {
  buildAuthoritativeBrief, normalizeGoalPlanPolicy, normalizeGoalRequest,
  normalizePlanRequest, planBriefMatches,
} from '../src/goal-plan.mjs';

const sha = (character) => character.repeat(64);
const policy = normalizeGoalPlanPolicy({
  schemaVersion: 1,
  repoId: 'repo-phase84',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'high'],
  effectClasses: ['provider_call', 'repository_edit'],
  capabilityClasses: ['code', 'test'],
  limits: {
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 16_384, maxItems: 32, maxScopePaths: 32, maxRouteValues: 16,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_440, maxProviderTurns: 1_000,
  },
});
const budget = { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 4 };
const verification = {
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 64 * 1_024,
  requiredPredecessorEvidence: [],
};

function mapCall() {
  return contextMapCallIdentity({
    schemaVersion: 1, kind: 'baton.context_map_call', generation: 1,
    source: {
      repoId: 'repo-phase84', runId: 'run-phase84',
      sessionId: `context-session:${sha('1')}`, cellId: `cell:${sha('2')}`,
      cellAdmissionDigest: sha('3'), cellSettlementDigest: sha('4'),
      manifestDigest: sha('5'), sourceProgramDigest: sha('6'), coordinateDigest: sha('7'),
      outputRef: { kind: 'context_value', mediaType: 'application/vnd.baton.context-value+json', handle: `art:sha256:${sha('8')}`, digest: sha('8'), bytes: 512 },
      evidenceRef: { kind: 'context_evidence', mediaType: 'application/vnd.baton.context-cell-evidence+json', handle: `art:sha256:${sha('9')}`, digest: sha('9'), bytes: 768 },
      predecessorPlan: { planId: `plan:${sha('a')}`, version: 1, digest: sha('b') },
      definitionDigest: sha('c'), profileDigest: sha('d'), treeSha: 'e'.repeat(40),
      environmentDigest: sha('e'), policyDigest: sha('f'),
    },
    role: 'critic', instruction: 'Review this exact immutable partition.',
    partitions: [
      { index: 0, itemDigest: sha('0'), coordinateDigest: sha('1') },
      { index: 1, itemDigest: sha('2'), coordinateDigest: sha('3') },
    ],
  });
}

function goal() {
  const normalized = normalizeGoalRequest({
    objective: 'Review addressed Context in parallel',
    definitionOfDone: ['verification passes'], constraints: [], risk: 'high',
    budget: { tokens: 100_000, usd: 10, wallMin: 100, providerTurns: 40 }, predecessor: null,
  }, policy);
  return {
    ...normalized, goalId: `goal:${sha('a')}`, version: 1, digest: sha('b'),
  };
}

function node(binding, index) {
  return {
    key: `context-map:critic:${String(index).padStart(4, '0')}`,
    objective: `Critic partition ${index + 1}`,
    definitionOfDone: ['verification passes'], deps: [], pathScope: ['reviews/**'],
    contextScope: ['**'], risk: 'high', budget, verification,
    routes: { harnesses: ['codex'], models: ['gpt-5.6-sol'], efforts: ['high'] },
    capabilities: ['code', 'test'], effects: ['provider_call', 'repository_edit'],
    contextCall: binding,
  };
}

test('CM84-P1: Goal/Plan normalizes exact Context-call bindings into nodes and Briefs', () => {
  const call = mapCall();
  const currentGoal = goal();
  const nodes = call.partitions.map((partition, index) => (
    node(contextMapNodeBinding(call, partition), index)
  ));
  const request = {
    goal: { goalId: currentGoal.goalId, version: currentGoal.version, digest: currentGoal.digest },
    predecessor: call.source.predecessorPlan,
    nodes,
  };
  const plan = normalizePlanRequest(request, policy, currentGoal);
  assert.equal(plan.nodes.length, 2);
  assert.deepEqual(plan.nodes.map((entry) => entry.contextCall.partition.index), [0, 1]);
  assert.equal(plan.nodes.every((entry) => entry.contextCall.callId === call.callId), true);

  const authoritative = buildAuthoritativeBrief(currentGoal, {
    ...plan, planId: `plan:${sha('f')}`, version: 2, digest: sha('0'),
  }, plan.nodes[0], {
    goalId: currentGoal.goalId, goalVersion: 1, goalDigest: currentGoal.digest,
    planId: `plan:${sha('f')}`, planVersion: 2, planDigest: sha('0'),
    nodeKey: plan.nodes[0].key, approvalDigest: sha('1'),
    policyDigest: policy.policyDigest, dispatchVersion: 1,
  });
  assert.deepEqual(authoritative.contextCall, plan.nodes[0].contextCall);
  assert.equal(planBriefMatches(authoritative, authoritative, { goalPlanCoordinates: true }), true);
  assert.equal(planBriefMatches({
    ...authoritative,
    contextCall: {
      ...authoritative.contextCall,
      partition: { ...authoritative.contextCall.partition, itemDigest: sha('a') },
    },
  }, authoritative, { goalPlanCoordinates: true }), false);
});

test('CM84-P2: Plan normalization rejects malformed or route-bearing Context bindings', () => {
  const call = mapCall();
  const currentGoal = goal();
  const binding = contextMapNodeBinding(call, call.partitions[0]);
  for (const contextCall of [
    { ...binding, model: 'gpt-5.6-sol' },
    { ...binding, logicalRole: 'builder' },
    { ...binding, partition: { ...binding.partition, index: 1 } },
  ]) {
    assert.throws(() => normalizePlanRequest({
      goal: { goalId: currentGoal.goalId, version: 1, digest: currentGoal.digest },
      predecessor: call.source.predecessorPlan,
      nodes: [node(contextCall, 0)],
    }, policy, currentGoal), (error) => error?.code === 'context_map_binding_invalid');
  }
});

test('CM85-P1: Goal/Plan uses the same contextCall field for one exact generic reduce unit', () => {
  const currentGoal = goal();
  const predecessorPlan = { planId: `plan:${sha('4')}`, version: 2, digest: sha('5') };
  const call = contextEffectCallIdentity({
    schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'reduce',
    generation: 1, predecessorCall: null, inheritedChildren: [],
    authority: {
      contextPrincipal: {
        actor: 'deployment:context', principalId: 'service-context',
        repoId: 'repo-phase84', runId: 'run-phase84',
      },
      requester: { principalId: 'local-owner', sessionId: 'local-owner-session' },
      sessionId: `context-session:${sha('1')}`, manifestDigest: sha('2'),
      treeSha: '3'.repeat(40), environmentDigest: sha('4'), policyDigest: sha('5'),
      definitionDigest: sha('6'), roleCatalogDigest: sha('7'), profileDigest: sha('8'),
      predecessorPlan,
    },
    source: {
      kind: 'call', id: `context-call:${sha('9')}`, callDigest: sha('9'), generation: 1,
      settlementDigest: sha('a'),
      outputRef: {
        kind: 'context_value', mediaType: 'application/vnd.baton.context-value+json',
        handle: `art:sha256:${sha('b')}`, digest: sha('b'), bytes: 512,
      },
      evidenceRef: {
        kind: 'context_call_evidence',
        mediaType: 'application/vnd.baton.context-call-evidence+json',
        handle: `art:sha256:${sha('c')}`, digest: sha('c'), bytes: 768,
      },
      itemCount: 2, coordinateDigest: sha('d'), outputLineageDigest: sha('e'),
    },
    role: 'critic', instruction: 'Synthesize the exact accepted child result set.',
    units: [{
      index: 0,
      inputs: [
        { index: 0, itemDigest: sha('0'), lineageDigest: sha('1') },
        { index: 1, itemDigest: sha('2'), lineageDigest: sha('3') },
      ],
      coordinateDigest: sha('d'),
    }],
  });
  const binding = contextEffectNodeBinding(call, call.units[0]);
  const plan = normalizePlanRequest({
    goal: { goalId: currentGoal.goalId, version: 1, digest: currentGoal.digest },
    predecessor: predecessorPlan,
    nodes: [node(binding, 0)],
  }, policy, currentGoal);
  assert.deepEqual(plan.nodes[0].contextCall, binding);
  assert.equal(plan.nodes[0].contextCall.kind, 'context_effect_child');
  assert.equal(plan.nodes[0].contextCall.operator, 'reduce');
  const authoritative = buildAuthoritativeBrief(currentGoal, {
    ...plan, planId: `plan:${sha('f')}`, version: 3, digest: sha('0'),
  }, plan.nodes[0], {
    goalId: currentGoal.goalId, goalVersion: 1, goalDigest: currentGoal.digest,
    planId: `plan:${sha('f')}`, planVersion: 3, planDigest: sha('0'),
    nodeKey: plan.nodes[0].key, approvalDigest: sha('1'),
    policyDigest: policy.policyDigest, dispatchVersion: 1,
  });
  assert.deepEqual(authoritative.contextCall, binding);
  const changed = structuredClone(binding);
  changed.unit.inputs[0].lineageDigest = sha('f');
  assert.throws(() => normalizePlanRequest({
    goal: { goalId: currentGoal.goalId, version: 1, digest: currentGoal.digest },
    predecessor: predecessorPlan, nodes: [node(changed, 0)],
  }, policy, currentGoal), (error) => error?.code?.startsWith('context_call_'));
});
