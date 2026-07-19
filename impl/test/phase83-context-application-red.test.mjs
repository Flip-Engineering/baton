import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY, BatonContextCell, BatonRun,
} from '../src/index.mjs';

const runId = 'run-phase83-context';
const cellId = `cell:${'a'.repeat(64)}`;
const action = (kind) => ({
  actionId: `action-${kind}`,
  kind,
  priority: 'optional',
  destructive: false,
  irreversible: false,
  inputSchema: APPLICATION_SEMANTIC_REGISTRY.actions[kind].inputSchema,
});

function application() {
  const calls = [];
  const command = async (name, args) => {
    calls.push({ name, args });
    if (name === 'application.help') return { topic: args.topic, depth: args.depth };
    if (name === 'run.act') {
      return {
        schemaVersion: 1, runId, depth: 'item',
        item: {
          id: cellId, section: 'context', state: 'completed',
          value: { kind: 'cell', output: { items: [{ symbol: 'BatonRunContext' }] } },
        },
      };
    }
    if (args.depth === undefined || args.depth === 'outline') {
      return {
        schemaVersion: 1, runId, depth: 'outline', viewDigest: 'b'.repeat(64),
        outline: {
          context: {
            state: 'ready', cellCount: 1,
            lastCell: { id: cellId, ordinal: 1, state: 'completed', operation: 'search' },
          },
          actions: [action('context_search'), action('context_chunk'), action('context_coverage')],
        },
      };
    }
    if (args.depth === 'section') {
      return {
        schemaVersion: 1, runId, depth: 'section',
        section: { id: 'context', itemCount: 1, items: [{ id: cellId, section: 'context' }] },
      };
    }
    if (args.depth === 'evidence') {
      return {
        schemaVersion: 1, runId, depth: 'evidence',
        item: { id: cellId, section: 'context' },
        evidence: [{ kind: 'context_evidence', digest: 'c'.repeat(64) }],
      };
    }
    return {
      schemaVersion: 1, runId, depth: 'item',
      item: { id: cellId, section: 'context', value: { kind: 'cell' } },
    };
  };
  return { calls, command };
}

test('CA83-1: Context extends the unified action registry without adding a command or tool family', () => {
  assert.deepEqual(APPLICATION_SEMANTIC_REGISTRY.defaultOperations, [
    'application.help', 'run.start', 'run.inspect', 'run.act', 'run.stop',
  ]);
  assert.ok(APPLICATION_SEMANTIC_REGISTRY.sections.some(({ id }) => id === 'context'));
  assert.deepEqual(Object.keys(APPLICATION_SEMANTIC_REGISTRY.actions)
    .filter((kind) => kind.startsWith('context_')).sort(), [
    'context_chunk', 'context_coverage', 'context_map', 'context_reduce', 'context_retry',
    'context_search',
  ]);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.cli.commands
    .some((command) => command.action?.startsWith('context_')), false);
  for (const kind of ['context_search', 'context_chunk', 'context_coverage']) {
    const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
    assert.equal(definition.priority, 'optional');
    assert.equal(definition.effect, 'context_pure_compute');
    assert.equal(definition.genericCli, true);
  }
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.actions.context_map.effect, 'plan_proposal');
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.actions.context_map.genericCli, true);
});

test('CA83-2: Pythonic Run Context compiles entirely through help, inspect, and advertised act', async () => {
  const app = application();
  const run = new BatonRun(app, { principalId: 'owner' }, runId);
  const context = run.context();
  assert.equal((await context.outline()).state, 'ready');
  assert.equal((await context.index()).section.id, 'context');
  assert.equal((await context.help()).topic, 'run.inspect.context');
  const cell = await context.search('durable authority', {
    branch: 'repository', mode: 'case_insensitive',
  });
  assert.ok(cell instanceof BatonContextCell);
  assert.equal(cell.id, cellId);
  assert.deepEqual(await cell.output(), { items: [{ symbol: 'BatonRunContext' }] });
  assert.equal((await context.evidence(cellId)).evidence[0].kind, 'context_evidence');
  assert.deepEqual(app.calls.map(({ name }) => name), [
    'run.inspect', 'run.inspect', 'application.help', 'run.inspect', 'run.act', 'run.inspect',
  ]);
  assert.deepEqual(app.calls.find(({ name }) => name === 'run.act').args.inputs, {
    query: 'durable authority', branch: 'repository', mode: 'case_insensitive',
  });
});
