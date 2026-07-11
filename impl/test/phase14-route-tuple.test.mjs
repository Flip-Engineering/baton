import test from 'node:test';
import assert from 'node:assert/strict';
import { routeTupleKey, resolveEffort } from '../src/route-tuple.mjs';
import { buildClaudeSessionArgs } from '../src/claude-session.mjs';
import { withGrokModelArgs } from '../src/grok-acp.mjs';
import { WebNorthbound } from '../src/web-northbound.mjs';

const card = (efforts = ['low', 'high']) => ({
  harness: 'codex', version: '2',
  modelSelection: { family: 'openai', reasoningEffort: efforts, configuredEffort: 'low' },
});

test('RT11.2: exact effort validation rejects empty inventories and unsupported values', () => {
  assert.deepEqual(resolveEffort(card(), 'high'), { ok: true, effort: 'high' });
  assert.equal(resolveEffort(card([]), 'high').ok, false);
  assert.equal(resolveEffort({ ...card(), modelSelection: { reasoningEffort: null } }, 'high').ok, false);
});

test('RT11.3/4: stable tuple learning identity separates resolved low and high buckets', () => {
  const low = routeTupleKey(card(), 'gpt-exact', 'low', 'build');
  const high = routeTupleKey(card(), 'gpt-exact', 'high', 'build');
  assert.notEqual(low, high);
  assert.equal(low, routeTupleKey(card(), 'gpt-exact', 'low', 'build'));
});

test('RT11.1/9: web dispatch forwards effort independently of modelPolicy', async () => {
  let call;
  const northbound = Object.create(WebNorthbound.prototype);
  northbound.coordinator = { spawn: async (...args) => { call = args; return { id: 'w-1' }; } };
  const response = await northbound._dispatch({ command: 'spawn', commandId: 'c1', args: {
    harness: 'codex', model: 'gpt-exact', effort: 'high', modelPolicy: { allow: ['gpt-exact'] }, brief: {},
  } }, 'web:u:s');
  assert.equal(response.status, 200);
  assert.equal(call[2].effort, 'high');
  assert.deepEqual(call[2].modelPolicy, { allow: ['gpt-exact'] });
});

test('RT11.7: Claude and Grok native controls preserve exact effort', () => {
  assert.deepEqual(buildClaudeSessionArgs({ effort: 'high', permissionMode: null }).slice(-2), ['--effort', 'high']);
  assert.deepEqual(withGrokModelArgs([], { reasoningEffort: 'low' }), ['--reasoning-effort', 'low']);
});
