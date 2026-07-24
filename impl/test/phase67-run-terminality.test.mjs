import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  APPLICATION_RUN_TERMINAL_PHASES,
  BatonApplication,
  PROVIDER_EXECUTION_SETTLED_PHASES,
  projectRouteAttestation,
} from '../src/application.mjs';
import {
  applicationTerminal,
  providerSettled,
} from '../src/application-semantics.mjs';

// docs/36 §7.1 M2: `closed` is a dead string, deleted from both sets. The registry L4 predicates
// own the canonical settled/terminal vocabulary; the application sets record the still-legacy
// state machine's literals and must agree with the predicates on every literal they carry.
const settledPhases = [
  'work_completed', 'selection_required', 'candidate_selected',
  'completed', 'failed', 'cancelled', 'denied', 'stopped',
];
const runTerminalPhases = ['completed', 'failed', 'cancelled', 'denied', 'stopped'];
const providerUnavailablePhases = [
  'work_completed', 'selection_required', 'candidate_selected',
  'completed', 'failed', 'denied',
];
const providerStoppedPhases = ['cancelled', 'stopped'];

test('provider-settled and application-terminal phase sets stay separate, with closed deleted', () => {
  assert.deepEqual([...PROVIDER_EXECUTION_SETTLED_PHASES], settledPhases);
  assert.deepEqual([...APPLICATION_RUN_TERMINAL_PHASES], runTerminalPhases);
  assert.equal(PROVIDER_EXECUTION_SETTLED_PHASES.has('work_completed'), true);
  assert.equal(APPLICATION_RUN_TERMINAL_PHASES.has('work_completed'), false);
  assert.equal(PROVIDER_EXECUTION_SETTLED_PHASES.has('closed'), false);
  assert.equal(APPLICATION_RUN_TERMINAL_PHASES.has('closed'), false);
});

test('the registry predicates own the canonical settled/terminal vocabulary (L4)', () => {
  for (const phase of ['result_ready', 'awaiting_selection', 'result_selected',
    'completed', 'failed', 'cancelled', 'stopped', 'denied',
    'work_completed', 'selection_required', 'candidate_selected']) {
    assert.equal(providerSettled(phase), true, phase);
  }
  for (const phase of ['planning', 'awaiting_approval', 'queued', 'working', 'paused',
    'interrupted', 'uncertain', 'verifying', 'reviewing', 'integrating', 'stopping',
    'running', 'approved', 'awaiting_plan_approval', 'input_required', 'closed']) {
    assert.equal(providerSettled(phase), false, phase);
  }
  for (const phase of ['completed', 'failed', 'cancelled', 'stopped', 'denied']) {
    assert.equal(applicationTerminal(phase), true, phase);
  }
  for (const phase of ['result_ready', 'awaiting_selection', 'result_selected',
    'working', 'work_completed', 'closed']) {
    assert.equal(applicationTerminal(phase), false, phase);
  }
  // The application sets are consistent with the predicates over every legacy literal they carry.
  for (const phase of PROVIDER_EXECUTION_SETTLED_PHASES) assert.equal(providerSettled(phase), true, phase);
  for (const phase of APPLICATION_RUN_TERMINAL_PHASES) assert.equal(applicationTerminal(phase), true, phase);
});

test('provider attestation distinguishes natural settlement from stopped work', () => {
  const requested = { harness: 'codex', model: 'exact-model', effort: 'high' };
  for (const phase of providerUnavailablePhases) {
    const route = projectRouteAttestation({ requested, resolved: requested, phase });
    assert.deepEqual(Object.values(route.providerAttestation).map((axis) => axis.state),
      ['unavailable', 'unavailable', 'unavailable'], phase);
  }
  for (const phase of providerStoppedPhases) {
    const route = projectRouteAttestation({ requested, resolved: requested, phase });
    assert.deepEqual(Object.values(route.providerAttestation).map((axis) => axis.state),
      ['not_observed_before_stop', 'not_observed_before_stop', 'not_observed_before_stop'], phase);
  }
  const running = projectRouteAttestation({ requested, resolved: requested, phase: 'running' });
  assert.deepEqual(Object.values(running.providerAttestation).map((axis) => axis.state),
    ['pending', 'pending', 'pending']);
});

test('ordinary inspect and run.follow remain change-aware at work_completed', () => {
  const application = Object.create(BatonApplication.prototype);
  application._semanticBounds = () => ({ maxItems: 8, maxBytes: 4096, maxWaitMs: 250 });
  const current = { goal: { runId: 'run-1' }, profile: { followPolicy: { mode: 'enabled', maxWaitMs: 250 } } };
  const envelope = application._semanticEnvelope(current, { phase: 'work_completed', cursor: 7 }, { depth: 'outline' });
  assert.equal(envelope.terminal, false);
  assert.equal(envelope.continuation.operation, 'run.inspect');
  assert.equal(envelope.continuation.arguments.cursor, 7);
  assert.equal(Object.hasOwn(envelope.continuation.arguments, 'waitMs'), false);
  assert.equal(Object.hasOwn(envelope, 'bounds'), false);

  application.driver = { coordination: { events: () => [] } };
  const page = application._followPage({
    goal: { runId: 'run-1' }, profile: { followPolicy: { maxScanEvents: 8, maxChanges: 8 } },
  }, { phase: 'work_completed', cursor: 7 }, 7);
  assert.equal(page.terminal, false);
});

test('ordinary inspect remains bounded but advertises no invalid continuation when follow is disabled', () => {
  const application = Object.create(BatonApplication.prototype);
  application._semanticBounds = () => ({ maxItems: 8, maxBytes: 4096, maxWaitMs: 0 });
  const current = { goal: { runId: 'run-disabled' }, profile: { followPolicy: { mode: 'none', maxWaitMs: 0 } } };
  const envelope = application._semanticEnvelope(current, { phase: 'running', cursor: 3 }, { depth: 'outline' });
  assert.equal(envelope.terminal, false);
  assert.equal(envelope.continuation, undefined);
});

test('inspect and follow classify every application terminal phase as terminal', () => {
  const application = Object.create(BatonApplication.prototype);
  application._semanticBounds = () => ({ maxItems: 8, maxBytes: 4096, maxWaitMs: 250 });
  application.driver = { coordination: { events: () => [] } };
  const current = {
    goal: { runId: 'run-1' },
    profile: { followPolicy: { maxWaitMs: 250, maxScanEvents: 8, maxChanges: 8 } },
  };
  for (const phase of runTerminalPhases) {
    assert.equal(application._semanticEnvelope(current, { phase, cursor: 7 }, { depth: 'outline' }).terminal, true, phase);
    assert.equal(application._followPage(current, { phase, cursor: 7 }, 7).terminal, true, phase);
  }
});

test('compatibility wait and terminal evidence use execution settlement', async () => {
  const source = await readFile(new URL('../src/application.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(!PROVIDER_EXECUTION_SETTLED_PHASES\.has\(view\.phase\)\) \{\s*throw applicationError\('Run evidence/);
  assert.match(source, /terminalPlanState: PROVIDER_EXECUTION_SETTLED_PHASES\.has\(view\.phase\)/);
  assert.match(source, /while \(!PROVIDER_EXECUTION_SETTLED_PHASES\.has\(view\.phase\) && Date\.now\(\) < deadline\)/);
});
