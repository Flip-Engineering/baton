import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  validateApplicationCommandArgs,
} from '../src/application.mjs';

const principal = Object.freeze({ actor: 'operator', principalId: 'operator', sessionId: 'phase67-continuation' });

function fixture() {
  let phase = 'executing';
  const current = {
    goal: { runId: 'run-self-describing', digest: 'a'.repeat(64) },
    plan: {
      version: 1, digest: 'b'.repeat(64), nodes: [{
        key: 'implement', objective: 'Add a bounded continuation', definitionOfDone: 'Focused tests pass',
        risk: 'low', routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
      }],
    },
    approval: null,
    profile: {
      risk: 'low',
      followPolicy: { mode: 'enabled', maxWaitMs: 1_234, maxChanges: 8, maxResponseBytes: 64 * 1024, maxScanEvents: 32 },
    },
  };
  const app = Object.create(BatonApplication.prototype);
  Object.assign(app, {
    ready: Promise.resolve(), principals: { observer: principal }, authorize: async () => true,
    _closed: null, _followControllers: new Set(), _semanticActions: () => [], _findRun: () => current,
    _buildView: async () => ({
      cursor: 41, phase, narrative: 'bounded', progress: {}, attention: [], route: null,
      budget: null, ownership: { workers: 0 }, stop: null,
      nodes: [{ key: 'implement', state: 'running' }],
    }),
    driver: { coordination: { events: () => [], waitAfter: async () => ({ advanced: false }) } },
  });
  return { app, terminal() { phase = 'completed'; } };
}

function expected(argumentsValue) {
  return { operation: 'run.inspect', arguments: { ...argumentsValue, cursor: 41 } };
}

test('ordinary outline exposes one registry-derived, callable, bounded continuation without coordinates', async () => {
  const { app } = fixture();
  const response = await app.inspect({ runId: 'run-self-describing' }, principal);
  assert.deepEqual(response.continuation, expected({ runId: 'run-self-describing', depth: 'outline' }));
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].continuation.preferred, true);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.inspect'].continuation.waitPolicy,
    'deployment_derived');
  assert.equal(validateApplicationCommandArgs(response.continuation.operation, response.continuation.arguments), true);
  const serialized = JSON.stringify(response);
  for (const leak of ['receipt', 'workerId', 'taskId', 'sessionId', '/private/', 'worktree']) {
    assert.equal(serialized.includes(leak), false, `continuation response leaked ${leak}`);
  }
});

test('section, item, and evidence continuations preserve only their public selector', async () => {
  const { app } = fixture();
  const section = await app.inspect({ runId: 'run-self-describing', depth: 'section', section: 'plan' }, principal);
  const itemId = section.section.items[0].id;
  assert.deepEqual(section.continuation, expected({ runId: 'run-self-describing', depth: 'section', section: 'plan' }));
  const item = await app.inspect({ runId: 'run-self-describing', depth: 'item', section: 'plan', item: itemId }, principal);
  assert.deepEqual(item.continuation, expected({ runId: 'run-self-describing', depth: 'item', section: 'plan', item: itemId }));
  const evidence = await app.inspect({ runId: 'run-self-describing', depth: 'evidence', section: 'plan', item: itemId }, principal);
  assert.deepEqual(evidence.continuation, expected({ runId: 'run-self-describing', depth: 'evidence', section: 'plan', item: itemId }));
  for (const response of [section, item, evidence]) {
    assert.equal(validateApplicationCommandArgs('run.inspect', response.continuation.arguments), true);
  }
});

test('terminal inspect omits continuation and contextual help recommends it', async () => {
  const { app, terminal } = fixture();
  terminal();
  const response = await app.inspect({ runId: 'run-self-describing' }, principal);
  assert.equal(response.terminal, true);
  assert.equal(Object.hasOwn(response, 'continuation'), false);
  const help = await app.help({ topic: 'run.inspect', depth: 'outline', runId: 'run-self-describing' }, principal);
  assert.match(help.summary, /preferred change-aware workflow/u);
});
