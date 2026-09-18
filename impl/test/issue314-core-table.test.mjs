// Issue #314 lane 1 (docs/49-mcp-primary-surface.md): the core table's own pins.
//
// The red skeleton (issue314-mcp-core-surface-red.test.mjs) pins the four LAWS this lane owns
// (314-a/b/c/g). This file pins what those laws depend on but do not state: that the core
// schemas are DERIVED from the landed tables (a field or verb added there appears in the tool,
// one removed disappears, and a family row that vanishes refuses to project), that a core call
// DISPATCHES to the same operation its flat counterpart reached — byte-identical over the real
// McpFleetServer — and that the migration pointers refuse exactly as docs/49 §8 says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { McpFleetServer, ORDINARY_APPLICATION_TOOL_DEFINITIONS } from '../src/mcp-northbound.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';
import { SWARM_COMMAND_DEFINITIONS } from '../src/swarm-contract.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS } from '../src/surface-capability-resolution.mjs';
import { callConfiguredMcpTool } from '../src/configured-mcp-client.mjs';
import { WAKE_CLASSES } from '../src/wake-stream.mjs';
import {
  CORE_TOOL_NAMES, CORE_TOOL_VERBS, coreMovedTo, coreRetiredSpellings, coreSources,
  coreToolDefinitions, coreVerbFacts, resolveCoreCall,
} from '../src/mcp-core-tools.mjs';

const REPO_ID = 'repo-issue314-lane1';
const NOW = Date.parse('2026-09-18T00:00:00.000Z');

const ORDINARY_BY_NAME = new Map(ORDINARY_APPLICATION_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
const META_BY_NAME = new Map(COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

// ── the fixture: the stub application card the red file composes, over a real McpFleetServer ──

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-314-lane1-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async actionAuthority() {
      return { schemaVersion: 1, actionId: 'a', kind: 'stop', effect: 'run_stop', requiredCapabilities: ['emergency_stop'], authorityDigest: 'x' };
    },
    async command(name) { return { schemaVersion: 1, command: name }; },
    async contextEval() { throw new Error('unused'); },
    async decisionList() { return { decisions: [] }; },
  };
  const raw = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
    ...options,
  });
  return { raw, wrapped: wrapProductionMcpServer(raw, { expandNative: true }) };
}

async function initialize(server) {
  await server.handle({
    jsonrpc: '2.0', id: 'init', method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
}

const call = (server, name, args) => server.handle({
  jsonrpc: '2.0', id: 'parity', method: 'tools/call', params: { name, arguments: args },
});

// ── the derivation ───────────────────────────────────────────────────────────────────────────

/** A copy of one landed tool row with its inputSchema adjusted — the perturbation the derivation
 * pins feed through the injectable sources. */
function adjustedTool(name, { addProperties = {}, removeProperties = [], addRequired = [] }) {
  const base = ORDINARY_BY_NAME.get(name);
  const properties = { ...base.inputSchema.properties };
  for (const field of removeProperties) delete properties[field];
  Object.assign(properties, addProperties);
  return {
    ...base,
    inputSchema: { ...base.inputSchema, properties, required: [...base.inputSchema.required, ...addRequired] },
  };
}

function sourcesWith(overrides) {
  const base = coreSources();
  return {
    ...base,
    ...overrides,
    ordinary: (name) => (overrides.ordinary === undefined ? base.ordinary(name) : overrides.ordinary(name, base)),
  };
}

const toolOf = (definitions, name) => definitions.find((tool) => tool.name === name);

test('314-l1-a: a field added to a family table appears in the core tool, one removed disappears', () => {
  const grown = coreToolDefinitions({
    sources: sourcesWith({
      ordinary: (name, base) => (name === 'baton_waves_send'
        ? adjustedTool(name, { addProperties: { probeField: { type: 'string', minLength: 1 } } })
        : base.ordinary(name)),
    }),
  });
  const waves = toolOf(grown, 'baton_waves');
  assert.deepEqual(waves.inputSchema.properties.probeField, { type: 'string', minLength: 1 },
    'the added field rides the tool the verb belongs to');

  const shrunk = coreToolDefinitions({
    sources: sourcesWith({
      ordinary: (name, base) => (name === 'baton_run_message_send'
        ? adjustedTool(name, { removeProperties: ['workerId'] })
        : base.ordinary(name)),
    }),
  });
  assert.equal(Object.hasOwn(toolOf(shrunk, 'baton_run').inputSchema.properties, 'workerId'), false,
    'a field the family table no longer carries is gone from the core schema');
  assert.ok(Object.hasOwn(toolOf(coreToolDefinitions(), 'baton_run').inputSchema.properties, 'workerId'),
    'the landed table still carries it — the projection was the thing that changed');
});

test('314-l1-b: a required field added to a family table is required by the verb branch', () => {
  const definitions = coreToolDefinitions({
    sources: sourcesWith({
      ordinary: (name, base) => (name === 'baton_waves_send'
        ? adjustedTool(name, { addRequired: ['message'] })
        : base.ordinary(name)),
    }),
  });
  const branch = toolOf(definitions, 'baton_waves').inputSchema.oneOf
    .find((entry) => entry.properties.verb.const === 'send');
  assert.deepEqual(branch.required, ['verb', 'runId', 'message'], 'the branch follows the landed required set');
});

test('314-l1-c: a swarm family row that vanishes refuses to project (a verb removed disappears)', () => {
  assert.throws(() => coreToolDefinitions({
    sources: sourcesWith({ swarmDefined: (command) => SWARM_COMMAND_DEFINITIONS[command] !== undefined && command !== 'swarm.capture' }),
  }), /the swarm family no longer carries swarm\.capture/u);
  assert.throws(() => coreToolDefinitions({
    sources: sourcesWith({ swarm: (command) => (command === 'swarm.capture' ? null : coreSources().swarm(command)) }),
  }), /no landed schema for verb capture/u);
  // Every curated swarm verb is a command the family table declares, in the family's own set.
  for (const verb of CORE_TOOL_VERBS.baton_swarm) {
    assert.ok(Object.hasOwn(SWARM_COMMAND_DEFINITIONS, `swarm.${verb}`), `swarm.${verb} is a declared family command`);
  }
  // The held-back family verbs (the emergency_stop and root landing verbs, docs/49 §2) stay out.
  for (const held of ['swarm.stop', 'swarm.integrate', 'swarm.watch']) {
    assert.equal(CORE_TOOL_VERBS.baton_swarm.includes(held.split('.')[1]), false, `${held} stays behind baton_surface`);
  }
});

test('314-l1-d: every core verb dispatches a landed tool or a landed meta authority', () => {
  for (const name of CORE_TOOL_NAMES) {
    for (const verb of CORE_TOOL_VERBS[name]) {
      const resolved = resolveCoreCall(name, { verb, ...minimalArguments(name, verb) });
      assert.equal(resolved.ok, true, `${name} ${verb} resolves`);
      if (resolved.dispatch.kind === 'meta') {
        assert.ok(META_BY_NAME.has(resolved.dispatch.name), `${name} ${verb} reaches a unified meta tool`);
      } else {
        assert.ok(ORDINARY_BY_NAME.has(resolved.dispatch.name), `${name} ${verb} reaches a landed ordinary tool`);
      }
    }
  }
});

/** The smallest argument set each verb admits (required fields only, typed by their branch). */
function minimalArguments(name, verb) {
  const row = coreToolDefinitions().find((tool) => tool.name === name);
  const branch = row.inputSchema.oneOf.find((entry) => entry.properties.verb.const === verb);
  const args = {};
  for (const field of branch.required) {
    if (field === 'verb') continue;
    const schema = row.inputSchema.properties[field];
    args[field] = field === 'members' ? [{ role: 'r', objective: 'o', exact: { harness: 'h', model: 'm', effort: 'e' } }]
      : field === 'intent' ? { objective: 'o' }
        : field === 'answer' ? { text: 'yes' }
          : field === 'inputs' ? {}
            : schema?.type === 'integer' ? 1
              : schema?.type === 'array' ? ['x']
                : 'probe-value';
  }
  return args;
}

// ── the parity: a core call reaches the operation its flat counterpart reached ────────────────
//
// One fixture, two call paths over the SAME server: the flat tool through the raw server, the
// core verb through the production wrapper. The stub application answers by command name, so
// byte-identical answers mean the same command carried the same arguments.

const PARITY = Object.freeze([
  { tool: 'baton_deployment', verb: 'doctor', flat: 'baton_deployment_doctor', args: {} },
  { tool: 'baton_run', verb: 'start', flat: 'baton_run_start', args: { intent: { objective: 'parity probe' }, idempotencyKey: 'parity:run-start' } },
  { tool: 'baton_run', verb: 'view', flat: 'baton_run_inspect', args: { runId: 'run:parity', depth: 'outline' } },
  { tool: 'baton_run', verb: 'list', flat: 'baton_runs', args: {} },
  { tool: 'baton_run', verb: 'send', flat: 'baton_run_message_send', args: { runId: 'run:parity', kind: 'inform', body: 'parity body' } },
  { tool: 'baton_run', verb: 'stop', flat: 'baton_run_stop', args: { runId: 'run:parity', reason: 'parity stop', idempotencyKey: 'parity:run-stop' } },
  { tool: 'baton_run', verb: 'answer', flat: 'baton_decision_answer', args: { runId: 'run:parity', requestId: 'request:parity', answer: { text: 'yes' }, idempotencyKey: 'parity:answer' } },
  { tool: 'baton_run', verb: 'do', flat: 'baton_run_act', args: { runId: 'run:parity', actionId: 'action:parity', inputs: {}, idempotencyKey: 'parity:do' } },
  { tool: 'baton_swarm', verb: 'create', flat: 'baton_swarm_create', args: { purpose: 'parity swarm', idempotencyKey: 'parity:swarm-create' } },
  { tool: 'baton_swarm', verb: 'list', flat: 'baton_swarm_list', args: {} },
  { tool: 'baton_swarm', verb: 'view', flat: 'baton_swarm_view', args: { swarmId: 'swarm:parity' } },
  { tool: 'baton_swarm', verb: 'update', flat: 'baton_swarm_update', args: { swarmId: 'swarm:parity', event: 'swarm.message_sent', payload: { body: 'x' }, idempotencyKey: 'parity:swarm-update' } },
  { tool: 'baton_swarm', verb: 'recruit', flat: 'baton_swarm_recruit', args: { swarmId: 'swarm:parity', participantId: 'seat', objective: 'parity seat', permissions: ['read'], idempotencyKey: 'parity:swarm-recruit' } },
  { tool: 'baton_swarm', verb: 'guide', flat: 'baton_swarm_guide', args: { swarmId: 'swarm:parity', participantId: 'seat', message: 'parity guide', idempotencyKey: 'parity:swarm-guide' } },
  { tool: 'baton_swarm', verb: 'capture', flat: 'baton_swarm_capture', args: { swarmId: 'swarm:parity', participantId: 'seat', contributionId: 'contribution:parity' } },
  { tool: 'baton_swarm', verb: 'check', flat: 'baton_swarm_check', args: { swarmId: 'swarm:parity', participantId: 'seat', contributionId: 'contribution:parity' } },
  { tool: 'baton_waves', verb: 'start', flat: 'baton_waves_start', args: { members: [{ role: 'r', objective: 'o', exact: { harness: 'h', model: 'm', effort: 'e' } }], idempotencyKey: 'parity:wave-start' } },
  { tool: 'baton_waves', verb: 'list', flat: 'baton_waves_list', args: {} },
  { tool: 'baton_waves', verb: 'progress', flat: 'baton_waves_progress', args: { waveId: `wave:${'a'.repeat(32)}` } },
  { tool: 'baton_waves', verb: 'send', flat: 'baton_waves_send', args: { runId: 'run:parity', message: 'parity steer' } },
  { tool: 'baton_waves', verb: 'stop', flat: 'baton_waves_stop', args: { runId: 'run:parity', reason: 'parity wave stop' } },
  { tool: 'baton_knowledge', verb: 'search', flat: 'baton_evidence_search', args: {} },
  { tool: 'baton_knowledge', verb: 'seed', flat: 'baton_run_knowledge_seed', args: { runId: 'run:parity', type: 'Finding', grounding: 'observed', body: 'parity fact' } },
  { tool: 'baton_wakes', verb: 'subscribe', flat: 'baton_wakes_subscribe', args: { kinds: ['contribution_recorded'] } },
  { tool: 'baton_wakes', verb: 'since', flat: 'baton_wakes_since', args: { since: 0 } },
  { tool: 'baton_wakes', verb: 'unsubscribe', flat: 'baton_wakes_unsubscribe', args: { subscriptionId: 'wake-sub:parity' } },
]);

test('314-l1-e: a core call and its flat counterpart answer byte-identically (parity)', async (t) => {
  const { raw, wrapped } = fixture(t);
  await initialize(raw);
  for (const row of PARITY) {
    const repoIdOf = (args) => (Object.hasOwn(args, 'repoId') ? args.repoId : REPO_ID);
    const flat = await call(raw, row.flat, { repoId: repoIdOf(row.args), ...row.args });
    const core = await call(wrapped, row.tool, { repoId: repoIdOf(row.args), verb: row.verb, ...row.args });
    assert.deepEqual(core, flat,
      `${row.tool} {verb: "${row.verb}"} must reach the same operation ${row.flat} reached`);
  }
});

test('314-l1-f: the six baton_surface verbs carry the unified meta tools\' own fields', async (t) => {
  const surface = coreToolDefinitions().find((tool) => tool.name === 'baton_surface');
  for (const verb of CORE_TOOL_VERBS.baton_surface) {
    const meta = META_BY_NAME.get(`baton_surface_${verb}`);
    assert.ok(meta, `baton_surface_${verb} is a landed meta tool`);
    for (const [field, schema] of Object.entries(meta.inputSchema.properties)) {
      assert.deepEqual(surface.inputSchema.properties[field], schema,
        `baton_surface verb ${verb}: ${field} is the meta tool's own schema (fields unchanged)`);
    }
  }
  const { raw, wrapped } = fixture(t);
  await initialize(raw);
  const catalog = await call(wrapped, 'baton_surface', { repoId: REPO_ID, verb: 'catalog' });
  assert.equal(catalog.result.isError, undefined, `the meta authority answers the core verb: ${JSON.stringify(catalog)}`);
  assert.equal(catalog.result.structuredContent.schemaVersion, 3, 'the landed catalog shape rides the core verb');
});

// ── the migration pointers (docs/49 §8) ───────────────────────────────────────────────────────

test('314-l1-g: the resolver refuses an unknown verb and a foreign verb\'s field, teaching the set', () => {
  const unknown = resolveCoreCall('baton_swarm', { verb: 'stop', swarmId: 's' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'invalid_arguments');
  assert.equal(unknown.field, 'verb');
  assert.deepEqual(unknown.detail.admitted, CORE_TOOL_VERBS.baton_swarm);

  const foreign = resolveCoreCall('baton_swarm', { verb: 'list', swarmId: 's' });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.field, 'swarmId');
  assert.ok(foreign.message.includes('swarmId'), 'the refusal names the field');
  assert.ok(Array.isArray(foreign.detail.admitted), 'and carries the admitted set');

  const ok = resolveCoreCall('baton_run', { verb: 'view', runId: 'run:1', role: 'reviewer' });
  assert.equal(ok.ok, true);
  assert.equal(ok.dispatch.name, 'baton_run_episode', 'the role/generation axis routes to the episode read');
  const plain = resolveCoreCall('baton_run', { verb: 'view', runId: 'run:1' });
  assert.equal(plain.dispatch.name, 'baton_run_inspect', 'the plain view routes to the inspect read');
});

test('314-l1-h: the moved and retired spellings carry their core pointer, the rest do not', () => {
  assert.deepEqual(coreMovedTo('baton_runs'), { tool: 'baton_run', verb: 'list' });
  assert.deepEqual(coreMovedTo('baton_run_view'), { tool: 'baton_run', verb: 'view' });
  assert.deepEqual(coreMovedTo('baton_swarm_create'), { tool: 'baton_swarm', verb: 'create' });
  assert.deepEqual(coreMovedTo('baton_surface_catalog'), { tool: 'baton_surface', verb: 'catalog' });
  assert.deepEqual(coreMovedTo('run.inspect'), { tool: 'baton_run', verb: 'view' },
    'the canonical dot spelling of a moved operation points at the same core verb');
  assert.deepEqual(coreMovedTo('evidence.search'), { tool: 'baton_knowledge', verb: 'search' });
  assert.deepEqual(coreMovedTo('baton_help'), { tool: 'baton_surface', verb: 'describe' });
  for (const [retired, target] of coreRetiredSpellings()) {
    assert.deepEqual(coreMovedTo(retired), target, `${retired} names its wake-plane replacement`);
  }
  assert.equal(coreMovedTo('baton_run_member_view'), null,
    'a spelling that stays reachable behind baton_surface carries no pointer');
  assert.equal(coreMovedTo('fleet_spawn'), null, 'a kernel spelling is not a core migration');
});

test('314-l1-i: the CLI\'s own MCP client spelling answers through the served surface', async (t) => {
  // docs/49 §0/§9 keep the CLI unchanged, and the CLI's `baton surface … --mcp <config>` path
  // (surface-cli.mjs → callConfiguredMcpTool) speaks the six unified meta spellings. They ride
  // their core verb as unadvertised aliases, so the CLI client keeps answering.
  const directory = mkdtempSync(join(tmpdir(), 'baton-314-lane1-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const descriptorPath = join(directory, 'descriptor.json');
  writeFileSync(descriptorPath, JSON.stringify({
    repo: directory, deploymentRoot: join(directory, '.baton', 'smoke'),
    routes: [], surface: 'application',
    principal: { userId: 'smoke', capabilities: ['observe'] },
  }));
  const catalog = await callConfiguredMcpTool(descriptorPath, 'baton_surface_catalog', {});
  assert.equal(catalog.schemaVersion, 3, 'the CLI client\'s catalog spelling is answered, never refused');
  assert.equal(Array.isArray(catalog.capabilities), true);
  const described = await callConfiguredMcpTool(descriptorPath, 'baton_surface_describe', { name: 'wakes.subscribe' });
  assert.equal(described.schemaVersion, 3, 'and so is describe');
});

test('314-l1-j: the bound bridge surface advertises the core schema without the derived envelope', async (t) => {
  // The resident bridge constructs exactly this shape (mcp-web-bridge.mjs:767-772):
  // surface application + bindApplicationContext. The core schemas then carry neither repoId nor
  // idempotencyKey — the server derives both — and a core call still reaches its operation.
  const { raw, wrapped } = fixture(t, { bindApplicationContext: true });
  await initialize(raw);
  const listed = await wrapped.handle({ jsonrpc: '2.0', id: 'l', method: 'tools/list', params: {} });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), [...CORE_TOOL_NAMES]);
  for (const tool of listed.result.tools) {
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'repoId'), false, `${tool.name}: repoId is derived`);
    assert.equal(Object.hasOwn(tool.inputSchema.properties, 'idempotencyKey'), false, `${tool.name}: the key is derived`);
    assert.deepEqual(tool.inputSchema.required, ['verb'], `${tool.name}: only the verb discriminator is required`);
  }
  const answered = await call(wrapped, 'baton_deployment', { verb: 'doctor' });
  assert.equal(answered.result.isError, false, 'a core call that carries no envelope answers');
  assert.equal(answered.result.structuredContent.schemaVersion, 1, 'the readiness answer rides the core verb');
  const supplied = await call(wrapped, 'baton_deployment', { repoId: REPO_ID, verb: 'doctor' });
  assert.match(JSON.stringify(supplied), /bound by the server/u, 'a supplied envelope field refuses on the bound surface');
});

test('314-l1-k: the long verbs carry their wake handoff from the landed vocabulary', () => {
  const long = [];
  for (const tool of CORE_TOOL_NAMES) {
    for (const verb of CORE_TOOL_VERBS[tool]) {
      const facts = coreVerbFacts(tool, verb);
      if (!facts.long) {
        assert.equal(facts.wake, null, `${tool} ${verb} is not long and hands back no subscription`);
        continue;
      }
      long.push(`${tool}:${verb}`);
      for (const wakeClass of [...facts.wake.kinds, ...facts.wake.settleOn]) {
        assert.ok(WAKE_CLASSES.includes(wakeClass), `${tool} ${verb}: ${wakeClass} is a class the stream publishes`);
      }
      for (const settle of facts.wake.settleOn) {
        assert.ok(facts.wake.kinds.includes(settle), `${tool} ${verb}: settleOn is a subset of the handoff's kinds`);
      }
    }
  }
  assert.deepEqual(long, ['baton_run:start', 'baton_swarm:recruit', 'baton_swarm:check', 'baton_waves:start'],
    'the long verbs are exactly the ones docs/49 §2 gives a wake handoff');
  assert.equal(coreVerbFacts('baton_run', 'view').mutation, false, 'the landed annotation says a read');
  assert.equal(coreVerbFacts('baton_swarm', 'capture').mutation, true, 'and an identity-keyed capture is a write');
  assert.throws(() => coreVerbFacts('baton_run', 'wait'), /not in the core table/u);
});
