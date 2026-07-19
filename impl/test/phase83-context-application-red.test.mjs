import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY, BatonContextCell, BatonContextExpression, BatonRun,
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
          actions: [action('context_eval')],
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
    'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.act', 'run.stop',
  ]);
  assert.ok(APPLICATION_SEMANTIC_REGISTRY.sections.some(({ id }) => id === 'context'));
  assert.deepEqual(Object.keys(APPLICATION_SEMANTIC_REGISTRY.actions)
    .filter((kind) => kind.startsWith('context_')).sort(), [
    'context_chunk', 'context_coverage', 'context_eval', 'context_map', 'context_reduce',
    'context_retry', 'context_search',
  ]);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.cli.commands
    .some((command) => command.action?.startsWith('context_')), false);
  const definition = APPLICATION_SEMANTIC_REGISTRY.actions.context_eval;
  assert.equal(definition.priority, 'optional');
  assert.equal(definition.effect, 'context_pure_compute');
  assert.equal(definition.genericCli, true);
  assert.equal(definition.inputSchema.properties.program.additionalProperties, false);
  assert.ok(definition.inputSchema.properties.program.$defs.expression.oneOf.length >= 14);
  for (const kind of ['context_search', 'context_chunk', 'context_coverage']) {
    const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
    assert.equal(definition.advertised, false);
    assert.equal(definition.legacyAliasFor, 'context_eval');
  }
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.actions.context_map.effect, 'plan_proposal');
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.actions.context_map.genericCli, true);
});

test('CA83-2: Pythonic Run Context compiles entirely through help, inspect, and advertised act', async () => {
  const app = application();
  const run = new BatonRun(app, runId);
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
    program: {
      schemaVersion: 1, kind: 'baton.context_program',
      expression: {
        op: 'search', input: { op: 'source', branch: 'repository' },
        query: 'durable authority', mode: 'case_insensitive',
      },
    },
  });
});

test('CA83-2b: immutable Context expressions cover the pure AST and evaluate once', async () => {
  const app = application();
  const context = new BatonRun(app, runId).context();
  const source = context.source('repository');
  const expression = source
    .search('authority', { mode: 'literal' })
    .filter({ field: 'path', operator: 'contains', value: 'impl/src' })
    .slice({ kind: 'indices', values: [1, 0] })
    .project(['path', 'text']).sort(['path']).unique(['path']).chunk('path').coverage();
  assert.ok(expression instanceof BatonContextExpression);
  assert.equal(Object.isFrozen(expression), true);
  assert.deepEqual(source.toJSON().expression, { op: 'source', branch: 'repository' },
    'chaining must not mutate an earlier expression');
  const right = context.source('dependencies').index({ after: 0 }).outline();
  const joined = expression.join(right, { left: 'path', right: 'path' });
  const collected = context.collect([expression, joined]);
  const finished = context.finish(collected, [source.coverage()]);
  const serialized = finished.toJSON();
  assert.deepEqual(Object.keys(serialized), ['schemaVersion', 'kind', 'expression']);
  assert.equal(serialized.expression.op, 'finish');
  await context.evaluate(finished);
  assert.equal(app.calls.filter(({ name }) => name === 'run.act').length, 1);
  assert.equal(app.calls.find(({ name }) => name === 'run.act').args.inputs.program.expression.op,
    'finish');
  await assert.rejects(async () => context.evaluate({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: {
      op: 'map', input: { op: 'source', branch: 'repository' },
      role: 'builder', instruction: 'cross the provider edge',
    },
  }), (error) => error?.code === 'context_program_effect_forbidden');
});
