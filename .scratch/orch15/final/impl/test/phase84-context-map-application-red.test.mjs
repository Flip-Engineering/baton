import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY, BatonContextCall, BatonContextCell, BatonRun,
} from '../src/index.mjs';

const runId = 'run-phase84-map';
const cellId = `cell:${'a'.repeat(64)}`;
const callId = `context-call:${'b'.repeat(64)}`;

function action(kind) {
  const definition = APPLICATION_SEMANTIC_REGISTRY.actions[kind];
  return {
    actionId: `action-${kind}`, kind, priority: definition.priority,
    destructive: definition.destructive, irreversible: definition.irreversible,
    inputSchema: definition.inputSchema,
  };
}

function application() {
  const calls = [];
  const command = async (name, args) => {
    calls.push({ name, args });
    if (name === 'application.help') return { topic: args.topic, depth: args.depth };
    if (name === 'run.act') {
      return {
        schemaVersion: 1, runId, depth: 'item',
        item: {
          id: callId, section: 'context', state: 'awaiting_plan_approval',
          value: {
            kind: 'call', operation: 'map', inputCellId: cellId,
            partitionCount: 2, childCount: 0,
          },
        },
      };
    }
    if (name === 'run.inspect' && args.depth === 'content') {
      const offset = args.offset ?? 0;
      return {
        schemaVersion: 1, runId, depth: 'content',
        item: { id: callId, section: 'context' },
        content: {
          schemaVersion: 1, kind: 'baton.context_call_content', callId,
          resultCount: 1, results: [{ index: 0, sourceItems: 2 }],
          totalItems: 2, offset,
          items: [{ resultIndex: 0, sourceIndex: offset, text: `chunk-${offset}` }],
          nextOffset: offset === 0 ? 1 : null, truncated: offset === 0,
        },
      };
    }
    if (name === 'run.inspect' && args.depth === 'evidence') {
      return {
        schemaVersion: 1, runId, depth: 'evidence',
        item: { id: callId, section: 'context', value: { kind: 'call' } },
        evidence: [{ kind: 'context_call_admission', digest: 'c'.repeat(64) }],
      };
    }
    if (name === 'run.inspect' && args.depth === 'item') {
      return {
        schemaVersion: 1, runId, depth: 'item',
        item: {
          id: callId, section: 'context', state: 'awaiting_plan_approval',
          value: { kind: 'call', operation: 'map', inputCellId: cellId, partitionCount: 2 },
        },
      };
    }
    return {
      schemaVersion: 1, runId, depth: 'outline', viewDigest: 'd'.repeat(64),
      outline: {
        context: {
          state: 'awaiting_plan_approval', callCount: 1,
          lastCall: { id: callId, state: 'awaiting_plan_approval', operation: 'map' },
        },
        actions: [action('context_map')],
      },
    };
  };
  return { calls, command };
}

test('CM84-A1: Context map extends the same five-operation registry with a minimal input surface', () => {
  assert.deepEqual(APPLICATION_SEMANTIC_REGISTRY.defaultOperations, [
    'application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode',
    'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.stop',
  ]);
  const definition = APPLICATION_SEMANTIC_REGISTRY.actions.context_map;
  assert.ok(definition);
  assert.deepEqual(Object.keys(definition.inputSchema.properties).sort(), [
    'cellId', 'instruction', 'role',
  ]);
  assert.deepEqual([...definition.inputSchema.required].sort(), ['cellId', 'instruction']);
  assert.equal(definition.effect, 'plan_proposal');
  assert.equal(definition.genericCli, true);
  assert.equal(JSON.stringify(definition.inputSchema).includes('model'), false);
  assert.equal(JSON.stringify(definition.inputSchema).includes('effort'), false);
  assert.equal(JSON.stringify(definition.inputSchema).includes('budget'), false);
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.cli.commands
    .some((command) => command.action === 'context_map'), false);
});

test('CM84-A2: Pythonic Context map takes a bound cell and returns one addressed call handle', async () => {
  const app = application();
  const run = new BatonRun(app, runId);
  const input = new BatonContextCell(run, cellId);
  const mapped = await run.context().map(input, {
    role: 'critic', instruction: 'Review this exact immutable partition.',
  });
  assert.ok(mapped instanceof BatonContextCall);
  assert.equal(mapped.id, callId);
  assert.equal((await mapped.outline()).item.state, 'awaiting_plan_approval');
  assert.equal((await mapped.evidence()).evidence[0].kind, 'context_call_admission');
  assert.equal((await mapped.output()).kind, 'call');
  assert.deepEqual(await mapped.help(), { topic: 'run.inspect.context', depth: 'item' });
  assert.deepEqual(app.calls.find(({ name }) => name === 'run.act').args.inputs, {
    cellId, role: 'critic', instruction: 'Review this exact immutable partition.',
  });
  assert.equal(app.calls.every(({ args }) => (
    !JSON.stringify(args).includes('gpt-5.6-sol') && !JSON.stringify(args).includes('xhigh')
  )), true);
});

test('CM84-A2b: Context call content cascades through bounded pages without caller bookkeeping', async () => {
  const app = application();
  const run = new BatonRun(app, runId);
  const call = new BatonContextCall(run, callId);
  const content = await call.content();
  assert.deepEqual(content.items.map((item) => item.text), ['chunk-0', 'chunk-1']);
  assert.equal(content.nextOffset, null);
  assert.equal(content.truncated, false);
  assert.deepEqual(app.calls.filter(({ name, args }) => (
    name === 'run.inspect' && args.depth === 'content'
  )).map(({ args }) => args.offset), [0, 1]);
  await assert.rejects(() => call.contentPage(-1), /offset is invalid/u);
});

test('CM84-A3: Pythonic Context map can defer a uniquely eligible role to the orchestrator', async () => {
  const app = application();
  const run = new BatonRun(app, runId);
  const mapped = await run.context().map(cellId, {
    instruction: 'Use the only eligible approved Workflow role.',
  });
  assert.ok(mapped instanceof BatonContextCall);
  assert.deepEqual(app.calls.find(({ name }) => name === 'run.act').args.inputs, {
    cellId, instruction: 'Use the only eligible approved Workflow role.',
  });
});
