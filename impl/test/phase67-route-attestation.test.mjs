import assert from 'node:assert/strict';
import test from 'node:test';
import { projectRouteAttestation, projectRunRouteEvidence } from '../src/application.mjs';

const requested = { harness: 'codex', model: 'gpt-5', effort: 'high' };
const resolved = { ...requested };

test('reports a provider-observed model without synthesizing other axes', () => {
  const route = projectRouteAttestation({
    requested, resolved, observed: { harness: null, model: 'gpt-5', effort: null }, phase: 'running',
  });
  assert.equal(route.providerAttestation.model.state, 'matched');
  assert.equal(route.providerAttestation.model.observed, 'gpt-5');
  assert.deepEqual(route.providerAttestation.harness, { observed: null, state: 'pending' });
  assert.deepEqual(route.providerAttestation.effort, { observed: null, state: 'pending' });
});

test('reports unavailable effort after provider completion', () => {
  const route = projectRouteAttestation({ requested, resolved, observed: null, phase: 'work_completed' });
  assert.deepEqual(route.providerAttestation.effort, { observed: null, state: 'unavailable' });
});

test('keeps launch and provider mismatch reporting independent', () => {
  const route = projectRouteAttestation({
    requested,
    resolved: { harness: 'codex', model: 'gpt-5-mini', effort: 'high' },
    observed: { harness: 'codex-cli', model: 'gpt-5', effort: 'medium' },
    phase: 'running',
  });
  assert.equal(route.launchEnforcement.model.state, 'mismatched');
  assert.equal(route.providerAttestation.model.state, 'matched');
  assert.equal(route.providerAttestation.harness.state, 'mismatched');
  assert.equal(route.providerAttestation.effort.state, 'mismatched');
});

test('reports stop before observation on every unobserved axis', () => {
  const route = projectRouteAttestation({
    requested, resolved, observed: { harness: null, model: 'gpt-5', effort: null }, phase: 'stopped',
  });
  assert.equal(route.providerAttestation.harness.state, 'not_observed_before_stop');
  assert.equal(route.providerAttestation.model.state, 'matched');
  assert.equal(route.providerAttestation.effort.state, 'not_observed_before_stop');
});

test('ordinary projection awaits provider evidence before an owned worker exists', () => {
  const route = projectRunRouteEvidence({ requested, phase: 'awaiting_plan_approval' });
  assert.equal(route.resolved, null);
  assert.equal(route.observed, null);
  assert.equal(route.launchEnforcement.harness.state, 'pending');
  assert.equal(route.providerAttestation.model.state, 'pending');
});

test('ordinary running projection uses independent evidence from its live owned worker', () => {
  const route = projectRunRouteEvidence({
    requested,
    liveHandle: {
      vendor: 'codex', harnessResolved: 'codex-cli@1.2.3', modelResolved: 'gpt-5', effortResolved: 'high',
      harnessObserved: null, modelObserved: 'gpt-5', effortObserved: null,
    },
    phase: 'running',
  });
  assert.deepEqual(route.resolved, { harness: 'codex-cli@1.2.3', model: 'gpt-5', effort: 'high' });
  assert.equal(route.launchEnforcement.harness.state, 'matched');
  assert.deepEqual(route.providerAttestation.harness, { observed: null, state: 'pending' });
  assert.equal(route.providerAttestation.model.state, 'matched');
  assert.deepEqual(route.providerAttestation.effort, { observed: null, state: 'pending' });
  assert.equal(Object.hasOwn(route, 'workerId'), false);
});

test('ordinary terminal projection prefers terminal result evidence over the live handle', () => {
  const route = projectRunRouteEvidence({
    requested,
    liveHandle: {
      vendor: 'codex', harnessResolved: 'codex-cli@live', modelResolved: 'gpt-5-mini', effortResolved: 'medium',
      harnessObserved: 'live-harness', modelObserved: 'live-model', effortObserved: 'live-effort',
    },
    terminalResult: {
      harnessVendor: 'codex', harnessResolved: 'codex-cli@terminal', modelResolved: 'gpt-5', effortResolved: 'high',
      harnessObserved: 'codex', modelObserved: 'gpt-5', effortObserved: null,
    },
    phase: 'work_completed',
  });
  assert.equal(route.resolved.harness, 'codex-cli@terminal');
  assert.equal(route.observed.model, 'gpt-5');
  assert.equal(route.launchEnforcement.harness.state, 'matched');
  assert.equal(route.providerAttestation.effort.state, 'unavailable');
});

test('ordinary projection reports independent launch and provider mismatches', () => {
  const route = projectRunRouteEvidence({
    requested,
    liveHandle: {
      vendor: 'other', harnessResolved: 'other-cli@2', modelResolved: 'gpt-5-mini', effortResolved: 'high',
      harnessObserved: 'codex', modelObserved: 'gpt-5', effortObserved: 'medium',
    },
    phase: 'running',
  });
  assert.equal(route.launchEnforcement.harness.state, 'mismatched');
  assert.equal(route.launchEnforcement.model.state, 'mismatched');
  assert.equal(route.launchEnforcement.effort.state, 'matched');
  assert.equal(route.providerAttestation.harness.state, 'matched');
  assert.equal(route.providerAttestation.model.state, 'matched');
  assert.equal(route.providerAttestation.effort.state, 'mismatched');
});

test('ordinary stopped projection never fills missing provider observations from route selection', () => {
  const route = projectRunRouteEvidence({
    requested,
    liveHandle: {
      vendor: 'codex', harnessResolved: 'codex-cli@1.2.3', modelResolved: 'gpt-5', effortResolved: 'high',
      harnessObserved: null, modelObserved: null, effortObserved: null,
    },
    phase: 'stopped',
  });
  for (const axis of ['harness', 'model', 'effort']) {
    assert.deepEqual(route.providerAttestation[axis], { observed: null, state: 'not_observed_before_stop' });
  }
});
