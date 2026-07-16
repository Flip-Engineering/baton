import assert from 'node:assert/strict';
import test from 'node:test';

import { projectTypedTerminalCause } from '../src/application-semantics.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';

const requiredCoordinationMethods = [
  'snapshot', 'task', 'integrationAuthority', 'publicationAuthority', 'createTask', 'claimTask',
  'transitionTask', 'transitionTaskWithArtifacts', 'createAndClaimRecoveryRefinement',
  'recordRecoveryContinuationIntent', 'completeRecoveryDispatch', 'mapOperationalEvent',
  'recordDriver', 'completeIntegration', 'completePublication', 'registerArtifact', 'artifact',
  'recordReuseDecision', 'reuseDecision', 'reuseDecisionAdmission', 'reusePolicyState',
  'activateReusePolicy', 'reuseRiskGuard', 'recordReuseRiskGuard', 'reuseRiskAdmission',
  'recordReuseTtlInvalidation', 'reuseTtlAdmission', 'claimScratch', 'postScratchFact',
  'readScratch', 'activeScratchClaims', 'expireScratchClaim', 'addKnowledgeNode',
  'promoteKnowledgeNode', 'readKnowledge',
];

function rehydrate(events) {
  const coordination = Object.fromEntries(requiredCoordinationMethods.map((name) => [name, () => null]));
  coordination.snapshot = () => ({ tasks: [] });
  coordination.integrationAuthority = () => false;
  coordination.publicationAuthority = () => false;
  const log = {
    append: (event) => event,
    workers: () => ['durable-worker'],
    read: () => events.map((event, index) => ({ seq: index + 1, worker: 'durable-worker', turnEpoch: 1, ...event })),
  };
  const adapter = { onEvent() {}, card: () => ({ sessions: {} }) };
  const fences = new FenceTable();
  return new Coordinator({ coordination, log, adapters: { mock: adapter }, fences });
}

test('hard budget cause reports the exceeded dimension with bounded facts', () => {
  const terminalCause = {
    kind: 'budget_exceeded', code: 'budget_hard_limit_exceeded',
    dimension: 'tokens', used: 120, limit: 100, ratio: 1.2,
  };
  const projected = projectTypedTerminalCause({ terminalResult: { terminalCause } });
  assert.deepEqual(projected, terminalCause);
  assert.deepEqual(Object.keys(projected).sort(), ['code', 'dimension', 'kind', 'limit', 'ratio', 'used']);
});

test('coordinator rehydrates the provider-native root cause ahead of later cleanup', async () => {
  const coordinator = rehydrate([
    { kind: 'lifecycle.spawned', actor: 'orchestrator', payload: { taskId: 'task-durable', vendorResolved: 'mock' } },
    { kind: 'lifecycle.crashed', actor: 'worker', payload: { code: 'transport_closed' } },
    { kind: 'control.forced_stop', actor: 'policy', payload: { reason: 'cleanup' } },
  ]);
  const replay = await coordinator.result('durable-worker');
  assert.deepEqual(replay.terminalCause, { kind: 'provider_failure', code: 'transport_closed' });
});

test('later cleanup stop preserves a worker cause and exposes no receipt coordinates', () => {
  const cause = projectTypedTerminalCause({
    terminalResult: { terminalCause: { kind: 'provider_failure', code: 'provider_crashed' } },
    runStop: { status: 'stopped', targetWorkerIds: ['worker-secret'], reasonDigest: 'digest' },
  });
  assert.deepEqual(cause, { kind: 'provider_failure', code: 'provider_crashed' });
  assert.equal(JSON.stringify(cause).includes('worker-secret'), false);
});

test('operator stop is the cause only when it initiated termination', () => {
  assert.deepEqual(projectTypedTerminalCause({ runStop: { status: 'stopped' } }), {
    kind: 'operator_stop', code: 'operator_stop',
  });
});

test('coordinator rehydrates the exact policy-owned budget cause', async () => {
  const coordinator = rehydrate([
    { kind: 'lifecycle.spawned', actor: 'orchestrator', payload: { taskId: 'task-durable', vendorResolved: 'mock' } },
    {
      kind: 'resource.budget_threshold', actor: 'policy', payload: {
        threshold: 1, hardStop: true, used: { tokens: 120, usd: 0 },
        limits: { tokens: 100, usd: 1 }, dimensions: { tokens: 1.2, usd: 0 }, ratio: 1.2,
      },
    },
    { kind: 'control.forced_stop', actor: 'policy', payload: { reason: 'cleanup' } },
  ]);
  const replay = await coordinator.result('durable-worker');
  assert.deepEqual(replay.terminalCause, {
    kind: 'budget_exceeded', code: 'budget_hard_limit_exceeded',
    dimension: 'tokens', used: 120, limit: 100, ratio: 1.2,
  });
});
