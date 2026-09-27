import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY, BatonContextExpression,
} from '../src/index.mjs';

test('CE85-A1: one closed context_eval schema advertises every pure AST operation', () => {
  const action = APPLICATION_SEMANTIC_REGISTRY.actions.context_eval;
  assert.equal(action.effect, 'context_pure_compute');
  assert.equal(action.genericCli, true);
  assert.deepEqual(action.inputSchema.required, ['program']);
  assert.equal(action.inputSchema.additionalProperties, false);
  const program = action.inputSchema.properties.program;
  assert.equal(program.additionalProperties, false);
  const operations = program.$defs.expression.oneOf.flatMap((schema) => {
    const value = schema.properties?.op;
    return value?.const ? [value.const] : value?.enum ?? [];
  });
  assert.deepEqual(operations.sort(), [
    'chunk', 'collect', 'coverage', 'filter', 'finish', 'index', 'join', 'outline',
    'project', 'search', 'slice', 'sort', 'source', 'unique',
  ]);
  for (const definition of Object.values(program.$defs.expression.oneOf)) {
    assert.equal(definition.additionalProperties, false);
  }
  for (const legacy of ['context_search', 'context_chunk', 'context_coverage']) {
    assert.equal(APPLICATION_SEMANTIC_REGISTRY.actions[legacy].advertised, false);
    assert.equal(APPLICATION_SEMANTIC_REGISTRY.actions[legacy].legacyAliasFor, 'context_eval');
  }
});

test('CE85-A2: the immutable builder normalizes every pure operation without aliasing', () => {
  const source = new BatonContextExpression({ op: 'source', branch: 'repository' });
  const selected = source.search('context_eval', { mode: 'literal' })
    .slice({ kind: 'indices', values: [1, 0] })
    .filter({ field: 'path', operator: 'contains', value: 'impl/' })
    .project(['path', 'text']).sort(['path']).unique(['path']).chunk('path');
  const other = new BatonContextExpression({ op: 'source', branch: 'dependencies' })
    .index({ after: 0 }).outline();
  const joined = selected.join(other, { left: 'path', right: 'path' }).coverage();
  assert.equal(Object.isFrozen(joined), true);
  assert.deepEqual(source.toJSON(), {
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'source', branch: 'repository' },
  });
  assert.equal(joined.toJSON().expression.op, 'coverage');
  assert.equal(joined.toJSON().expression.input.op, 'join');
  assert.throws(() => new BatonContextExpression({
    op: 'verify', input: { op: 'source', branch: 'repository' }, gate: 'tests',
  }), (error) => error?.code === 'context_program_effect_forbidden');
  assert.throws(() => source.join({ toJSON() {} }, { left: 'path', right: 'path' }),
    (error) => error?.code === 'application_client_invalid');
});
