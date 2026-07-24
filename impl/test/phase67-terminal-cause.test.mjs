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
  'promoteKnowledgeNode', 'readKnowledge', 'writeScratchpad', 'elevateTaskScratchpad',
  'settleWorkflowScratchpad', 'reapRunScratchpads', 'scratchpadSnapshotBatch',
  'scratchpadSnapshot',
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
    terminalResult: { terminalCause: {
      kind: 'provider_failure', code: 'provider_crashed',
      error: 'provider said token=secret-value', path: '/private/provider/session',
    } },
    runStop: { status: 'stopped', targetWorkerIds: ['worker-secret'], reasonDigest: 'digest' },
  });
  assert.deepEqual(cause, {
    kind: 'provider_failure', code: 'provider_crashed', category: 'provider_runtime',
    summary: 'The provider process or session ended unexpectedly; the specific cause is unclassified.',
    remediation: 'Check Baton route readiness and the harness-native status, then retry. If it repeats, inspect the Run\'s bounded evidence.',
    retryable: true,
  });
  assert.doesNotMatch(JSON.stringify(cause), /worker-secret|secret-value|\/private\/provider|token=/u);
});

for (const [code, category, summary, remediation] of [
  [
    'authentication_required', 'provider_authentication',
    'The selected provider route requires authentication.',
    'Establish or refresh the harness-native login outside Baton, rerun baton doctor, then retry the Run.',
  ],
  [
    'authentication_refresh_required', 'provider_authentication',
    'The selected provider route requires refreshed authentication.',
    'Refresh the harness-native login outside Baton, rerun baton doctor, then retry the Run.',
  ],
  [
    'wire_frame_oversize', 'provider_protocol',
    'The provider emitted a frame that exceeded Baton\'s safe wire boundary.',
    'Baton requires exact termination and reaping of the ambiguous session. Update or repair the harness integration, then retry the Run.',
  ],
]) {
  test(`canonical provider cause ${code} has fixed actionable guidance and discards provider payload`, () => {
    const projected = projectTypedTerminalCause({
      terminalResult: {
        terminalCause: {
          kind: 'provider_failure', code,
          error: 'Authentication required token=secret-value',
          path: '/private/secret/provider/session',
          workerId: 'worker-secret', taskId: 'task-secret',
          remediation: 'print the credential',
        },
      },
    });
    assert.deepEqual(projected, {
      kind: 'provider_failure', code, category, summary, remediation, retryable: true,
    });
    assert.equal(Object.isFrozen(projected), true);
    assert.doesNotMatch(JSON.stringify(projected), /secret|worker-|task-|\/private|token=/iu);
  });
}

test('provider cause codes remain canonical and malformed values cannot become operator-visible text', () => {
  const projected = projectTypedTerminalCause({
    terminalResult: {
      terminalCause: {
        kind: 'provider_failure',
        code: 'Authentication required at /private/secret; token=credential',
      },
    },
  });
  assert.deepEqual(projected, {
    kind: 'provider_failure', code: 'provider_failure_unclassified', category: 'provider_failure',
    summary: 'The provider route failed.',
    remediation: 'Inspect the Run\'s bounded evidence and provider readiness, then retry or select another exact route.',
    retryable: true,
  });
  assert.doesNotMatch(JSON.stringify(projected), /private|secret|token=|Authentication required/u);
});

test('canonical codes cannot select inherited object properties as terminal guidance', () => {
  const projected = projectTypedTerminalCause({
    terminalResult: { terminalCause: { kind: 'provider_failure', code: 'constructor' } },
  });
  assert.deepEqual(projected, {
    kind: 'provider_failure', code: 'constructor', category: 'provider_failure',
    summary: 'The provider route failed.',
    remediation: 'Inspect the Run\'s bounded evidence and provider readiness, then retry or select another exact route.',
    retryable: true,
  });
});

test('operator stop is the cause only when it initiated termination', () => {
  assert.deepEqual(projectTypedTerminalCause({ runStop: { status: 'stopped' } }), {
    kind: 'operator_stop', code: 'operator_stop',
  });
});

test('durable Plan terminal outcome remains typed when no live worker result survives restart', () => {
  assert.deepEqual(projectTypedTerminalCause({
    terminalOutcome: {
      status: 'failed', accepted: false, code: 'recovery_terminalized',
    },
  }), {
    kind: 'provider_failure', code: 'recovery_terminalized',
    category: 'provider_failure', summary: 'The provider route failed.',
    remediation: 'Inspect the Run\'s bounded evidence and provider readiness, then retry or select another exact route.',
    retryable: true,
  });
  assert.equal(projectTypedTerminalCause({
    terminalOutcome: { status: 'completed', accepted: true, code: 'accepted' },
  }), null);
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
