import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  executeUnifiedSurfaceCli,
  parseUnifiedSurfaceCli,
} from '../src/surface-cli.mjs';

test('surface CLI parses catalog, describe, invoke, snapshot and watch as closed commands', () => {
  assert.equal(parseUnifiedSurfaceCli(['run', 'show']), null);
  const catalog = parseUnifiedSurfaceCli([
    'surface', 'catalog', '--category', 'knowledge', '--mcp-config', 'deployment.mjs',
  ]);
  assert.equal(catalog.kind, 'surface_catalog');
  assert.equal(catalog.mcpConfig, 'deployment.mjs');
  const describe = parseUnifiedSurfaceCli([
    'surface', 'describe', 'run.debug', '--mcp-config', 'deployment.mjs',
  ]);
  assert.equal(describe.kind, 'surface_describe');
  assert.equal(describe.mcpConfig, 'deployment.mjs');
  const invoke = parseUnifiedSurfaceCli([
    'surface', 'invoke', 'run.message.send', '--args', '{"runId":"run:a","kind":"inform","body":"hello"}',
  ]);
  assert.equal(invoke.kind, 'surface_invoke');
  assert.equal(invoke.args.body, 'hello');
  assert.equal(parseUnifiedSurfaceCli(['surface', 'snapshot', '--run-id', 'run:a']).kind, 'surface_snapshot');
  const watch = parseUnifiedSurfaceCli([
    'surface', 'watch', 'run:a', '--wave-id', 'wave:a', '--after-cursor', '4',
    '--attention-cursor', '7', '--kind', 'answer_decision', '--timeout', '1200',
  ]);
  assert.deepEqual(watch, {
    kind: 'surface_watch', runId: 'run:a', waveId: 'wave:a', afterCursor: 4,
    attentionCursor: 7, attentionKind: 'answer_decision', timeoutMs: 1200, mcpConfig: null,
  });
  assert.throws(
    () => parseUnifiedSurfaceCli(['surface', 'invoke', 'run.start', '--args', '[]']),
    (error) => error.code === 'cli_invalid',
  );
  assert.throws(
    () => parseUnifiedSurfaceCli(['surface', 'watch', 'run:a', '--timeout', '0']),
    (error) => error.code === 'cli_invalid' && error.field === 'timeoutMs',
  );
});

test('local catalog and describe execute without a resident connection', async () => {
  const catalog = await executeUnifiedSurfaceCli(parseUnifiedSurfaceCli([
    'surface', 'catalog', '--category', 'telemetry', '--surface', 'mcp',
  ]));
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.source, 'local_existing_inventory');
  assert.ok(catalog.capabilities.length > 0);
  assert.deepEqual(catalog.nameClosure.unresolved, []);
  const described = await executeUnifiedSurfaceCli(parseUnifiedSurfaceCli([
    'surface', 'describe', 'baton_decision_list',
  ]));
  assert.equal(described.capability.id, 'decision.list');
});

test('configured catalog, describe and watch delegate to the existing MCP authority', async () => {
  const calls = [];
  const mcpCall = async (config, name, args) => {
    calls.push({ config, name, args });
    return { ok: true, name };
  };
  const catalog = parseUnifiedSurfaceCli([
    'surface', 'catalog', '--category', 'knowledge', '--mcp-config', 'deployment.mjs',
  ]);
  const described = parseUnifiedSurfaceCli([
    'surface', 'describe', 'fleet_spawn', '--mcp-config', 'deployment.mjs',
  ]);
  const watch = parseUnifiedSurfaceCli([
    'surface', 'watch', 'run:a', '--after-cursor', '3', '--mcp-config', 'deployment.mjs',
  ]);
  assert.equal((await executeUnifiedSurfaceCli(catalog, { mcpCall })).name, 'baton_surface_catalog');
  assert.equal((await executeUnifiedSurfaceCli(described, { mcpCall })).name, 'baton_surface_describe');
  assert.equal((await executeUnifiedSurfaceCli(watch, { mcpCall })).name, 'baton_surface_watch');
  assert.deepEqual(calls[0].args, { category: 'knowledge' });
  assert.deepEqual(calls[1].args, { name: 'fleet_spawn' });
  assert.deepEqual(calls[2].args, { runId: 'run:a', afterCursor: 3 });
});

test('application invocation uses the authenticated CLI client', async () => {
  const calls = [];
  const client = {
    async surfaceInvoke(name, args, idempotencyKey) {
      calls.push({ name, args, idempotencyKey });
      return { ok: true };
    },
  };
  const parsed = parseUnifiedSurfaceCli([
    'surface', 'invoke', 'run.message.send', '--args', '{"runId":"run:a","kind":"inform","body":"hello"}',
    '--idempotency-key', 'surface:test',
  ]);
  assert.deepEqual(await executeUnifiedSurfaceCli(parsed, { client }), { ok: true });
  assert.deepEqual(calls, [{
    name: 'run.message.send',
    args: { runId: 'run:a', kind: 'inform', body: 'hello' },
    idempotencyKey: 'surface:test',
  }]);
});

test('local watch uses the connected CLI composite without bypassing existing commands', async () => {
  const calls = [];
  const client = {
    async surfaceWatch(args) {
      calls.push(args);
      return { kind: 'baton.surface_watch', runId: args.runId };
    },
  };
  const parsed = parseUnifiedSurfaceCli([
    'surface', 'watch', 'run:a', '--attention-cursor', '8', '--kind', 'answer_question',
  ]);
  assert.deepEqual(await executeUnifiedSurfaceCli(parsed, { client }), {
    kind: 'baton.surface_watch', runId: 'run:a',
  });
  assert.deepEqual(calls, [{ runId: 'run:a', attentionCursor: 8, kind: 'answer_question' }]);
});

test('MCP-native invocation requires and uses a configured MCP authority', async () => {
  const noConfig = parseUnifiedSurfaceCli([
    'surface', 'invoke', 'fleet_spawn', '--args', '{"repoId":"repo","harness":"fake","brief":{}}',
  ]);
  await assert.rejects(
    executeUnifiedSurfaceCli(noConfig),
    (error) => error.code === 'surface_mcp_config_required',
  );

  const parsed = parseUnifiedSurfaceCli([
    'surface', 'invoke', 'fleet_spawn', '--args', '{"repoId":"repo","harness":"fake","brief":{}}',
    '--mcp-config', 'deployment.mjs',
  ]);
  const calls = [];
  const result = await executeUnifiedSurfaceCli(parsed, {
    mcpCall: async (config, name, args) => {
      calls.push({ config, name, args });
      return { ok: true };
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].name, 'baton_surface_invoke');
  assert.equal(calls[0].args.name, 'fleet_spawn');
});

test('embedded-only worker capability remains visible but cannot be promoted by generic invoke', async () => {
  const parsed = parseUnifiedSurfaceCli([
    'surface', 'invoke', 'board.claim', '--args', '{"grantId":"grant:a"}', '--mcp-config', 'deployment.mjs',
  ]);
  await assert.rejects(
    executeUnifiedSurfaceCli(parsed, { mcpCall: async () => ({ ok: true }) }),
    (error) => error.code === 'surface_embedded_only',
  );
});
