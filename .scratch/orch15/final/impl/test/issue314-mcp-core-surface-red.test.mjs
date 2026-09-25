// Issue #314 conformance pins (docs/44): MCP as the primary agent surface — the
// docs/49-mcp-primary-surface.md design pinned red-before against the CURRENT surface.
//
// Every row below asserts a law of that design against the landed implementation and is RED at
// HEAD, each on its own assertion that names the missing law (never an import failure, never a
// dangling await — #460):
//
//   314-a  tools/list on the ordinary agent surface is exactly the core verb-tools — one per
//          family (seven at landing; #317 added the eighth, baton_services) — today
//          it is 58 flat tools (measured: 52 ordinary rows of mcp-northbound.mjs
//          ORDINARY_APPLICATION_TOOL_DEFINITIONS plus the six baton_surface_* the production
//          wrapper merges), 64,629 bytes of schema on the wire.
//   314-b  the core tools/list stays inside the derived byte budget: core count × the largest
//          DESIGNED core schema carried below (docs/43 — derived, never a bare ceiling).
//   314-c  every core tool is ONE verb-discriminated closed schema (a `verb` enum + closed
//          per-verb oneOf branches) — the docs/36 grammar applied to MCP.
//   314-d1 no blocking read rides the agent surface: baton_run_attention_watch and
//          baton_swarm_watch retire to the #294 wake plane.
//   314-d2 a mutation answers the #302 receipt plus a wake subscription id — never the whole
//          view (today run.start/run.stop answer the full outline, mcp-web-bridge.mjs:638-665).
//   314-e1 a bridge session survives a resident reincarnation: one rediscovery, ONE typed
//          notification, the wake plane resumed from its cursor — today the plane reconnects to
//          the withdrawn socket of the old incarnation forever (mcp-web-bridge.mjs
//          _scheduleReconnect), because the connection is discovered once
//          (connectBatonWebApplication, mcp-web-bridge.mjs:695).
//   314-e2 an in-flight call that meets the incarnation boundary is retried ONCE against the
//          successor under the same derived idempotency key (the ledger is shared), never
//          surfaced as a session-fatal error.
//   314-f  the migration table (docs/49 §7) covers every tool impl/MCP.md documents, and the
//          served surface reflects it (no retired/behind-surface spelling advertised).
//   314-g  a retired flat spelling refuses unknown_tool with a movedTo pointer into the core —
//          data on the landed refusal code, never a new code (#430/#436).
//   314-h  impl/MCP.md leads with the resident bridge and documents the descriptor as the
//          headless mode — today its H1 reads "descriptor-first" (impl/MCP.md:1).
//
// Fixture: the mcp-bridge-admission.test.mjs idiom — a stub application card over a real
// McpFleetServer (plus the production wrapper, which is what a client actually sees), and the
// facadeWith stub-client idiom for the bridge-facade rows. No resident is spawned.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { McpFleetServer } from '../src/mcp-northbound.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';
import { BatonWebApplicationFacade } from '../src/mcp-web-bridge.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';
import {
  SWARM_COMMAND_DEFINITIONS, SWARM_EVENT_KINDS, SWARM_RECRUIT_MODES, SWARM_VIEW_PROJECTION_NAMES,
} from '../src/swarm-contract.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const NOW = Date.parse('2026-09-18T00:00:00.000Z');

// ── the designed core, carried as executable data (docs/49 §2) ────────────────────────────────
// One tool per family, a `verb` discriminator, and a closed per-verb argument schema. `requires`
// is the per-verb required set (repoId rides the top level on the descriptor surface and is
// stripped on the bound bridge surface, exactly as today — mcp-northbound.mjs:1849-1857);
// `mutation` marks the verbs that answer a receipt (#302); `long` marks the mutations whose
// follow-up rides a wake subscription the answer hands back (#294).

const ID_SCHEMA = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9._:-]+$' };
const TEXT_SCHEMA = { type: 'string', minLength: 1 };
const IDEM_SCHEMA = { type: 'string', minLength: 1, maxLength: 256 };
const INT_CURSOR_SCHEMA = { type: 'integer', minimum: 0 };
const PAGE_TOKEN_SCHEMA = { type: 'string', minLength: 1, maxLength: 4096 };
const KNOWLEDGE_TYPES = ['Run', 'Task', 'Artifact', 'Phase', 'Experiment', 'Finding', 'Question',
  'Hypothesis', 'Principle', 'Constraint', 'Literature', 'Research', 'RouteStat', 'Skill',
  'Counterexample', 'Representation', 'ScratchFact', 'Source'];

const CORE = Object.freeze([
  {
    name: 'baton_deployment',
    description: 'Deployment authority: doctor reads fresh readiness (routes, workspace, credential posture as metadata). Quota-free; the route-picking prerequisite.',
    verbs: {
      doctor: { requires: [], fields: {}, mutation: false, long: false },
    },
  },
  {
    name: 'baton_run',
    description: 'One Run: start, view (the one read, depth/section/role axes), list, send, stop, answer (settles attention), do (the advertised action executor, L2).',
    verbs: {
      start: { requires: ['intent', 'idempotencyKey'], mutation: true, long: true,
        fields: { intent: { type: 'object' }, idempotencyKey: IDEM_SCHEMA } },
      view: { requires: ['runId'], mutation: false, long: false,
        fields: {
          runId: ID_SCHEMA,
          depth: { type: 'string', enum: APPLICATION_SEMANTIC_REGISTRY.depths },
          section: ID_SCHEMA, item: ID_SCHEMA, role: ID_SCHEMA,
          generation: { type: 'integer', minimum: 1 },
          cursor: INT_CURSOR_SCHEMA, pageCursor: PAGE_TOKEN_SCHEMA,
        } },
      list: { requires: [], mutation: false, long: false, fields: { cursor: INT_CURSOR_SCHEMA } },
      send: { requires: ['runId', 'body'], mutation: true, long: false,
        fields: {
          runId: ID_SCHEMA, body: TEXT_SCHEMA,
          kind: { type: 'string', enum: ['inform', 'query', 'steer'] },
          budget: { type: 'integer', minimum: 1 },
        } },
      stop: { requires: ['runId', 'reason', 'idempotencyKey'], mutation: true, long: false,
        fields: { runId: ID_SCHEMA, reason: TEXT_SCHEMA, idempotencyKey: IDEM_SCHEMA } },
      answer: { requires: ['runId', 'requestId', 'answer', 'idempotencyKey'], mutation: true, long: false,
        fields: {
          runId: ID_SCHEMA, requestId: { type: 'string', minLength: 1, maxLength: 4096 },
          answer: { type: 'object' }, idempotencyKey: IDEM_SCHEMA,
        } },
      do: { requires: ['runId', 'actionId', 'inputs', 'idempotencyKey'], mutation: true, long: false,
        fields: {
          runId: ID_SCHEMA, actionId: ID_SCHEMA, inputs: { type: 'object' },
          idempotencyKey: IDEM_SCHEMA,
        } },
    },
  },
  {
    name: 'baton_swarm',
    description: 'One swarm: create, list, view (the sliced read), update (the closed event set), recruit, guide, capture, check. capture/check are identity-keyed; the rest carry idempotencyKey.',
    verbs: {
      create: { requires: ['purpose', 'idempotencyKey'], mutation: true, long: false,
        fields: {
          purpose: TEXT_SCHEMA, swarmId: ID_SCHEMA, policy: { type: 'object' },
          idempotencyKey: IDEM_SCHEMA, view: { type: 'boolean' },
        } },
      list: { requires: [], mutation: false, long: false, fields: {} },
      view: { requires: ['swarmId'], mutation: false, long: false,
        fields: {
          swarmId: ID_SCHEMA, participantId: ID_SCHEMA,
          projection: { type: 'string', enum: SWARM_VIEW_PROJECTION_NAMES },
          cursor: PAGE_TOKEN_SCHEMA,
        } },
      update: { requires: ['swarmId', 'event', 'idempotencyKey'], mutation: true, long: false,
        fields: {
          swarmId: ID_SCHEMA, event: { type: 'string', enum: SWARM_EVENT_KINDS },
          payload: { type: 'object' }, idempotencyKey: IDEM_SCHEMA, view: { type: 'boolean' },
        } },
      recruit: { requires: ['swarmId', 'participantId', 'objective', 'idempotencyKey'], mutation: true, long: true,
        fields: {
          swarmId: ID_SCHEMA, participantId: ID_SCHEMA, objective: TEXT_SCHEMA,
          options: { type: 'object' },
          permissions: { type: 'array', items: { type: 'string', enum: SWARM_PERMISSIONS } },
          mode: { type: 'string', enum: SWARM_RECRUIT_MODES },
          shareWorkspaceWith: ID_SCHEMA, resumeFrom: ID_SCHEMA, workId: ID_SCHEMA,
          idempotencyKey: IDEM_SCHEMA, view: { type: 'boolean' },
        } },
      guide: { requires: ['swarmId', 'participantId', 'message', 'idempotencyKey'], mutation: true, long: false,
        fields: {
          swarmId: ID_SCHEMA, participantId: ID_SCHEMA, message: TEXT_SCHEMA,
          idempotencyKey: IDEM_SCHEMA, view: { type: 'boolean' },
        } },
      capture: { requires: ['swarmId', 'participantId'], mutation: true, long: false,
        fields: {
          swarmId: ID_SCHEMA, participantId: ID_SCHEMA, contributionId: ID_SCHEMA,
          view: { type: 'boolean' },
        } },
      check: { requires: ['swarmId', 'participantId', 'contributionId'], mutation: true, long: true,
        fields: {
          swarmId: ID_SCHEMA, participantId: ID_SCHEMA, contributionId: ID_SCHEMA,
          checkId: ID_SCHEMA, view: { type: 'boolean' },
        } },
    },
  },
  {
    name: 'baton_waves',
    description: 'One wave cohort: start (detached, per-member quota), list, progress (paged), send, stop — member-targeted by runId.',
    verbs: {
      start: { requires: ['members', 'idempotencyKey'], mutation: true, long: true,
        fields: { members: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'object' } }, idempotencyKey: IDEM_SCHEMA } },
      list: { requires: [], mutation: false, long: false, fields: { cursor: INT_CURSOR_SCHEMA } },
      progress: { requires: ['waveId'], mutation: false, long: false,
        fields: { waveId: { type: 'string', pattern: '^wave:[a-f0-9]{32}$' }, cursor: INT_CURSOR_SCHEMA } },
      send: { requires: ['runId', 'message'], mutation: true, long: false,
        fields: { runId: ID_SCHEMA, message: TEXT_SCHEMA } },
      stop: { requires: ['runId', 'reason'], mutation: true, long: false,
        fields: { runId: ID_SCHEMA, reason: TEXT_SCHEMA } },
    },
  },
  {
    name: 'baton_knowledge',
    description: 'The knowledge layer: search the deployment evidence and contributions (seq cursor), seed one content-addressed node inside a run horizon.',
    verbs: {
      search: { requires: [], mutation: false, long: false,
        fields: {
          swarmId: ID_SCHEMA, participantId: ID_SCHEMA, kind: TEXT_SCHEMA, path: TEXT_SCHEMA,
          query: TEXT_SCHEMA, afterSeq: INT_CURSOR_SCHEMA,
        } },
      seed: { requires: ['runId', 'type', 'grounding', 'body'], mutation: true, long: false,
        fields: {
          runId: ID_SCHEMA, type: { type: 'string', enum: KNOWLEDGE_TYPES },
          grounding: { type: 'string', enum: ['verified', 'observed', 'derived', 'asserted'] },
          body: TEXT_SCHEMA, evidence: { type: 'array', maxItems: 32, items: { type: 'object' } },
        } },
    },
  },
  {
    name: 'baton_wakes',
    description: 'The session wake plane (#294): subscribe (a filter over the session\'s ONE attachment, frames arrive as notifications), since (one bounded pull page), unsubscribe. Never a second connection.',
    verbs: {
      subscribe: { requires: [], mutation: true, long: false, fields: {} },
      since: { requires: [], mutation: false, long: false,
        fields: {
          kinds: { type: 'array', items: TEXT_SCHEMA }, swarms: { type: 'array', items: ID_SCHEMA },
          participants: { type: 'array', items: ID_SCHEMA }, since: INT_CURSOR_SCHEMA,
        } },
      unsubscribe: { requires: ['subscriptionId'], mutation: true, long: false,
        fields: { subscriptionId: ID_SCHEMA } },
    },
  },
  // Issue #317 (docs/50): the provider-services family joins the designed core — the eighth
  // family, one read verb over the deployment's declared services.
  {
    name: 'baton_services',
    description: 'Provider services (issue #317): list the deployment’s configured API services — the models each offers, the routes derived from them, and subscription-window usage with its reset instant.',
    verbs: {
      list: { requires: [], mutation: false, long: false,
        fields: { provider: { type: 'string', minLength: 1, maxLength: 128 } } },
    },
  },
  {
    name: 'baton_surface',
    description: 'Progressive disclosure: catalog the capabilities this deployment profile serves, describe one (schema and posture), invoke it through its existing authority; snapshot, watch (bounded composite), visualize.',
    verbs: {
      catalog: { requires: [], mutation: false, long: false,
        fields: { category: TEXT_SCHEMA, surface: TEXT_SCHEMA, mode: TEXT_SCHEMA, owner: TEXT_SCHEMA } },
      describe: { requires: ['name'], mutation: false, long: false, fields: { name: TEXT_SCHEMA } },
      invoke: { requires: ['name'], mutation: true, long: false,
        fields: { name: TEXT_SCHEMA, args: { type: 'object' } } },
      snapshot: { requires: [], mutation: false, long: false, fields: { runId: ID_SCHEMA } },
      watch: { requires: [], mutation: false, long: false, fields: {} },
      visualize: { requires: [], mutation: false, long: false, fields: { runId: ID_SCHEMA } },
    },
  },
]);

const CORE_NAMES = Object.freeze(CORE.map((row) => row.name));

/** The full wire definition of one designed core tool: a `verb`-discriminated closed union —
 * the union of every verb's fields at the top level with additionalProperties: false, and one
 * oneOf branch per verb pinning its required set (repoId rides the top level, stripped on the
 * bound bridge surface by the landed bindApplicationContext mechanism). */
function coreToolDefinition(row) {
  const verbs = Object.keys(row.verbs);
  const properties = { repoId: { type: 'string', minLength: 1, maxLength: 4096 } };
  const oneOf = [];
  for (const [verb, spec] of Object.entries(row.verbs)) {
    for (const [field, fieldSchema] of Object.entries(spec.fields)) {
      if (properties[field] === undefined) properties[field] = fieldSchema;
    }
    oneOf.push({ properties: { verb: { const: verb } }, required: ['verb', ...spec.requires] });
  }
  return Object.freeze({
    name: row.name,
    description: row.description,
    inputSchema: Object.freeze({
      type: 'object', additionalProperties: false,
      required: ['repoId', 'verb'],
      properties: Object.freeze({ ...properties, verb: { type: 'string', enum: verbs } }),
      oneOf: Object.freeze(oneOf),
    }),
    annotations: Object.freeze({
      readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    }),
  });
}

/** Exported so the budget number in docs/49 §3 re-derives from this exact table. */
export function designedCoreTools() {
  return CORE.map(coreToolDefinition);
}

// ── the migration table (docs/49 §7), one row per tool impl/MCP.md documents ──────────────────
// {tool, verb}: the flat spelling folds into a core verb. {surface: <operation>}: reachable
// through baton_surface invoke, not advertised by default. {retired}: gone from MCP (the reason
// names the replacement).
const MIGRATION = Object.freeze({
  baton_application_help: { tool: 'baton_surface', verb: 'describe' },
  baton_help: { tool: 'baton_surface', verb: 'describe' },
  baton_decision_answer: { tool: 'baton_run', verb: 'answer' },
  baton_deployment_doctor: { tool: 'baton_deployment', verb: 'doctor' },
  baton_evidence_search: { tool: 'baton_knowledge', verb: 'search' },
  baton_knowledge_promote: { surface: 'knowledge.promote (descriptor kernel profile — never bridged, U-G3)' },
  baton_knowledge_settlement_lease: { surface: 'knowledge.settlement_lease (descriptor kernel profile — never bridged, U-G3)' },
  baton_run_act: { tool: 'baton_run', verb: 'do' },
  baton_run_attention_watch: { retired: 'baton_wakes subscribe (kinds/swarms filter) replaces the blocking attention watch (#294)' },
  baton_run_do: { tool: 'baton_run', verb: 'do' },
  baton_run_episode: { tool: 'baton_run', verb: 'view' },
  baton_run_inspect: { tool: 'baton_run', verb: 'view' },
  baton_run_knowledge_seed: { tool: 'baton_knowledge', verb: 'seed' },
  baton_run_member_send: { surface: 'run.member.send' },
  baton_run_member_stop: { surface: 'run.member.stop' },
  baton_run_member_view: { surface: 'run.member.view' },
  baton_run_message_receipt: { surface: 'run.message.receipt' },
  baton_run_message_send: { tool: 'baton_run', verb: 'send' },
  baton_run_scratchpad_append: { surface: 'run.scratchpad.append' },
  baton_run_scratchpad_elevate: { surface: 'run.scratchpad.elevate' },
  baton_run_scratchpad_read: { surface: 'run.scratchpad.read' },
  baton_run_start: { tool: 'baton_run', verb: 'start' },
  baton_run_stop: { tool: 'baton_run', verb: 'stop' },
  baton_run_view: { tool: 'baton_run', verb: 'view' },
  baton_run_workstreams: { surface: 'run.member.view' },
  baton_runs: { tool: 'baton_run', verb: 'list' },
  baton_scratchpad_elevate: { surface: 'scratchpad.elevate (descriptor kernel profile)' },
  baton_scratchpad_settle: { surface: 'scratchpad.settle (descriptor kernel profile)' },
  baton_services_list: { tool: 'baton_services', verb: 'list' },
  baton_swarm_capture: { tool: 'baton_swarm', verb: 'capture' },
  baton_swarm_check: { tool: 'baton_swarm', verb: 'check' },
  baton_swarm_create: { tool: 'baton_swarm', verb: 'create' },
  baton_swarm_guide: { tool: 'baton_swarm', verb: 'guide' },
  baton_swarm_integrate: { surface: 'swarm.integrate (the root landing verb)' },
  baton_swarm_list: { tool: 'baton_swarm', verb: 'list' },
  baton_swarm_recruit: { tool: 'baton_swarm', verb: 'recruit' },
  baton_swarm_stop: { surface: 'swarm.stop (emergency_stop capability)' },
  baton_swarm_update: { tool: 'baton_swarm', verb: 'update' },
  baton_swarm_view: { tool: 'baton_swarm', verb: 'view' },
  baton_swarm_watch: { retired: 'baton_wakes subscribe with a swarms filter replaces the blocking watch on MCP; the CLI keeps baton swarm watch' },
  baton_wakes_since: { tool: 'baton_wakes', verb: 'since' },
  baton_wakes_subscribe: { tool: 'baton_wakes', verb: 'subscribe' },
  baton_wakes_unsubscribe: { tool: 'baton_wakes', verb: 'unsubscribe' },
  baton_waves_attach: { surface: 'waves.attach' },
  baton_waves_compile: { surface: 'waves.compile' },
  baton_waves_list: { tool: 'baton_waves', verb: 'list' },
  baton_waves_progress: { tool: 'baton_waves', verb: 'progress' },
  baton_waves_run: { surface: 'waves.run' },
  baton_waves_send: { tool: 'baton_waves', verb: 'send' },
  baton_waves_start: { tool: 'baton_waves', verb: 'start' },
  baton_waves_stop: { tool: 'baton_waves', verb: 'stop' },
  baton_workstream_notify: { surface: 'run.member.send' },
  baton_workstream_stop: { surface: 'run.member.stop' },
  baton_surface_catalog: { tool: 'baton_surface', verb: 'catalog' },
  baton_surface_describe: { tool: 'baton_surface', verb: 'describe' },
  baton_surface_invoke: { tool: 'baton_surface', verb: 'invoke' },
  baton_surface_snapshot: { tool: 'baton_surface', verb: 'snapshot' },
  baton_surface_watch: { tool: 'baton_surface', verb: 'watch' },
  baton_surface_visualize: { tool: 'baton_surface', verb: 'visualize' },
});

// ── fixtures (the mcp-bridge-admission.test.mjs idiom) ─────────────────────────────────────────

const REPO_ID = 'repo-issue314';
const SESSION = Object.freeze({
  schemaVersion: 1,
  identity: { userId: 'bridge-user', sessionId: 'bridge-session', capabilities: ['observe', 'control'], repoIds: [REPO_ID] },
  expiresAt: '2099-01-01T00:00:00.000Z',
});
const PRINCIPAL = Object.freeze({ actor: 'mcp:bridge-user:bridge-session', principalId: 'bridge-user', sessionId: 'bridge-session' });
const CONTEXT = Object.freeze({ transport: 'mcp', requestId: 'r1', idempotencyKey: 'mcp.call:r1' });
const WIRE_CARD = Object.freeze([...new Set([...webAdmittedCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS)])]);

/** The served agent surface exactly as a client meets it: the real McpFleetServer (ordinary
 * surface) under the production wrapper, over a stub application card. */
function servedSurface(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-314-core-'));
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
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  const server = wrapProductionMcpServer(raw, { expandNative: true });
  const request = (id, method, params) => server.handle({ jsonrpc: '2.0', id, method, params });
  return { server, request };
}

async function ready(request) {
  await request('init', 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  await request(undefined, 'notifications/initialized', {});
}

async function toolList(t) {
  const { request } = servedSurface(t);
  await ready(request);
  const listed = await request('list', 'tools/list', {});
  return listed.result.tools;
}

async function until(probe, { timeoutMs = 2_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** One controllable wake attachment: done settles when the test says the stream ended. */
function attachmentStub() {
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  return {
    attachment: {
      close() { resolveDone({ status: 'stopped' }); },
      opened: Promise.resolve({ status: 'open' }),
      done,
    },
    end: (outcome) => resolveDone(outcome),
  };
}

// ── the rows ──────────────────────────────────────────────────────────────────────────────────

test('314-a RED: tools/list on the ordinary agent surface is exactly the core verb-tools — one per family (docs/49 §2; #317 added baton_services)', async (t) => {
  const tools = await toolList(t);
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [...CORE_NAMES].sort(),
    'LAW (docs/49 §2): the default surface is ONE verb-tool per family — '
    + `${CORE_NAMES.join(', ')} — not ${names.length} flat tools; the rest opens through baton_surface`);
});

test('314-b RED: the core tools/list stays inside the derived byte budget — core count times the largest designed core schema (docs/49 §3)', async (t) => {
  const tools = await toolList(t);
  const designed = designedCoreTools();
  const sizes = designed.map((tool) => ({ name: tool.name, bytes: Buffer.byteLength(JSON.stringify(tool)) }));
  const largest = sizes.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  const budget = designed.length * largest.bytes;
  const servedBytes = Buffer.byteLength(JSON.stringify(tools));
  assert.ok(servedBytes <= budget,
    `LAW (docs/49 §3): tools/list is ${servedBytes} bytes; the #314 budget is ${budget} bytes `
    + `(7 core tools × ${largest.bytes} — the largest designed core schema, ${largest.name}); `
    + 'growth past it is a decision, not drift (docs/43)');
});

test('314-c RED: every core tool is ONE verb-discriminated closed schema (docs/49 §2)', async (t) => {
  const tools = await toolList(t);
  for (const row of CORE) {
    const served = tools.find((tool) => tool.name === row.name);
    assert.ok(served, `LAW (docs/49 §2): the core tool ${row.name} is advertised`);
    const schema = served.inputSchema;
    assert.equal(schema.additionalProperties, false, `${row.name}: the schema is closed`);
    assert.ok(schema.required?.includes('verb'), `${row.name}: verb is required`);
    assert.deepEqual(schema.properties?.verb?.enum, Object.keys(row.verbs),
      `${row.name}: the verb enum is the designed closed set`);
    assert.ok(Array.isArray(schema.oneOf) && schema.oneOf.length === Object.keys(row.verbs).length,
      `${row.name}: one closed branch per verb`);
    for (const [verb, spec] of Object.entries(row.verbs)) {
      const branch = schema.oneOf.find((candidate) => candidate.properties?.verb?.const === verb);
      assert.ok(branch, `${row.name}: a branch pins verb ${verb}`);
      for (const requiredField of spec.requires) {
        assert.ok(branch.required?.includes(requiredField),
          `${row.name} verb ${verb}: ${requiredField} is required`);
      }
    }
  }
});

test('314-d1 RED: no blocking read rides the agent surface — waits and watches retire to the wake plane (docs/49 §5)', async (t) => {
  const tools = await toolList(t);
  const names = new Set(tools.map((tool) => tool.name));
  for (const blocking of ['baton_run_attention_watch', 'baton_swarm_watch']) {
    assert.equal(names.has(blocking), false,
      `LAW (docs/49 §5): ${blocking} is a blocking read; the agent surface hands back a wake subscription instead (#294)`);
  }
  // Guard clause (green at authoring): the designed core verb sets carry no wait/follow verb,
  // and watch lives only on baton_surface as the bounded composite.
  for (const row of CORE) {
    for (const verb of Object.keys(row.verbs)) {
      assert.ok(!['wait', 'follow'].includes(verb), `${row.name} carries no ${verb} verb`);
      if (verb === 'watch') assert.equal(row.name, 'baton_surface', 'watch is the bounded composite only');
    }
  }
});

test('314-d2 RED: a mutation answers a receipt plus a wake subscription, never the whole view (docs/49 §5)', async (t) => {
  const calls = [];
  const wakeOpens = [];
  const card = { repoId: REPO_ID, commands: [...WIRE_CARD], agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest } };
  const client = {
    repoId: REPO_ID,
    pollMs: 5,
    async session() { return SESSION; },
    async doctor() { return { ready: true, application: card }; },
    async command(name, args, key) {
      calls.push({ name, args, key });
      if (name === 'run.start') return { runId: 'run:1' };
      return { schemaVersion: 1, runId: 'run:1', depth: 'outline', outline: { phase: 'working', actions: [] } };
    },
    wakes(options) { wakeOpens.push(options); return attachmentStub().attachment; },
  };
  const facade = new BatonWebApplicationFacade(client, card, SESSION);
  t.after(() => facade.closeWakes());
  const answer = await facade.command('run.start', { intent: { objective: 'probe' } }, PRINCIPAL, CONTEXT);
  assert.ok(answer !== null && typeof answer === 'object' && typeof answer.receipt === 'object',
    'LAW (docs/49 §5): a mutation answers the #302 receipt {command, event: {kind, seq, ts, actor}, changed, next} — '
    + 'today run.start answers the whole outline (mcp-web-bridge.mjs:638-665)');
  assert.equal(answer.outline, undefined, 'the whole view never rides a mutation answer (view: true opts in)');
  assert.ok(typeof answer.wake?.subscriptionId === 'string',
    'a long operation hands back the wake subscription its follow-up rides (#294)');
  assert.ok(Array.isArray(answer.wake?.kinds) && Array.isArray(answer.wake?.settleOn),
    'the wake handoff names its classes and the settleOn subset whose frame settles the follow-up');
  assert.ok(wakeOpens.length >= 1, 'the session\'s one wake plane carries the subscription');
});

test('314-e1 RED: a bridge session survives reincarnation — rediscovery, ONE typed notification, wake resume (docs/49 §6)', async (t) => {
  const frames = [];
  const openCalls = [];
  const rediscoverCalls = [];
  let current = attachmentStub();
  const card = { repoId: REPO_ID, commands: [...WIRE_CARD], agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest } };
  const clientV1 = {
    repoId: REPO_ID,
    pollMs: 5,
    async session() { return SESSION; },
    async doctor() { return { ready: true, application: card }; },
    async command() { return { ok: true }; },
    wakes(options) { openCalls.push(options); return current.attachment; },
  };
  const successorSession = { ...SESSION, identity: { ...SESSION.identity, sessionId: 'bridge-session-incarnation-2' } };
  const rediscover = async () => {
    rediscoverCalls.push(1);
    return { client: clientV1, card, session: successorSession };
  };
  // The fourth constructor argument is the rebind authority docs/49 §6 mints; the landed
  // constructor (mcp-web-bridge.mjs:412) ignores it — that is what makes this row red.
  const facade = new BatonWebApplicationFacade(clientV1, card, SESSION, { rediscover });
  t.after(() => facade.closeWakes());
  const receipt = await facade.wakeSubscribe({ kinds: ['contribution_recorded'] }, (frame) => { frames.push(frame); });
  assert.equal(typeof receipt.subscriptionId, 'string', 'the subscription receipt is the landed shape');
  // The old incarnation's attachment ends typed (resident_stopping, #316 b) — the reincarnation.
  const first = current;
  first.end({ status: 'error', error: Object.assign(new Error('the resident named its stopping'), { code: 'resident_stopping' }) });
  await until(() => openCalls.length >= 2, { label: 'the wake plane re-attach' });
  assert.equal(rediscoverCalls.length, 1,
    'LAW (docs/49 §6): the typed end of the old incarnation\'s attachment triggers ONE connection '
    + 'rediscovery — today the plane reconnects to the withdrawn socket of the dead incarnation forever');
  const reincarnated = frames.filter((frame) => frame?.kind === 'baton.resident_reincarnated');
  assert.equal(reincarnated.length, 1,
    'LAW (docs/49 §6): the client gets ONE typed baton.resident_reincarnated notification '
    + '{from, to, cursor} — independent of any subscription filter, exactly once per handoff');
  assert.equal(reincarnated[0]?.cursor, receipt.cursor ?? reincarnated[0]?.cursor,
    'the notification names the cursor the resumed attachment starts from');
});

test('314-e2 RED: an in-flight call at the incarnation boundary is retried once against the successor under the same idempotency key (docs/49 §6)', async (t) => {
  const predecessorKeys = [];
  const successorKeys = [];
  const rediscoverCalls = [];
  const card = { repoId: REPO_ID, commands: [...WIRE_CARD], agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest } };
  const clientV1 = {
    repoId: REPO_ID,
    pollMs: 5,
    async session() { return SESSION; },
    async doctor() { return { ready: true, application: card }; },
    async command(name, args, key) {
      predecessorKeys.push(key);
      throw Object.assign(new Error('the resident that answered is a different incarnation than the connection names'),
        { code: 'resident_incarnation_mismatch', wireSafe: true });
    },
  };
  const successorSession = { ...SESSION, identity: { ...SESSION.identity, sessionId: 'bridge-session-incarnation-2' } };
  const clientV2 = {
    repoId: REPO_ID,
    pollMs: 5,
    async session() { return successorSession; },
    async doctor() { return { ready: true, application: card }; },
    async command(name, args, key) {
      successorKeys.push(key);
      return { schemaVersion: 1, command: name, via: 'successor' };
    },
  };
  const rediscover = async () => {
    rediscoverCalls.push(1);
    return { client: clientV2, card, session: successorSession };
  };
  const facade = new BatonWebApplicationFacade(clientV1, card, SESSION, { rediscover });
  t.after(() => facade.closeWakes());
  const outcome = await facade.command('run.review', { runId: 'run:1' }, PRINCIPAL, CONTEXT)
    .then((value) => ({ value }), (error) => ({ error }));
  assert.equal(outcome.error, undefined,
    'LAW (docs/49 §6): an in-flight call refused resident_incarnation_mismatch is retried ONCE '
    + 'against the successor after rebind — today it kills the call (and the session follows)');
  assert.deepEqual(outcome.value, { schemaVersion: 1, command: 'run.review', via: 'successor' });
  assert.equal(rediscoverCalls.length, 1, 'exactly one rebind per handoff');
  assert.deepEqual(successorKeys, predecessorKeys.slice(0, 1),
    'the retry carries the SAME derived idempotency key — the shared ledger replays the first attempt');
});

test('314-f RED: the migration table covers every tool MCP.md documents and the served surface reflects it (docs/49 §7)', async (t) => {
  const doc = readFileSync(new URL('../MCP.md', import.meta.url), 'utf8');
  const documented = new Set();
  for (const match of doc.matchAll(/`(baton_[a-z_]+)`/g)) documented.add(match[1]);
  // Guard clauses (green at authoring): completeness of docs/49 §7 against MCP.md, and every
  // core verb is the target of at least one migration row. §7 maps the LEGACY spellings; a core
  // tool is its own target (docs/49 §2), so the documented set the guard judges is the union of
  // the two — MCP.md names the core tools because that is the surface it leads with, and
  // it names a flat spelling only while §7 has a row for it.
  for (const name of documented) {
    if (CORE_NAMES.includes(name)) continue;
    assert.ok(Object.hasOwn(MIGRATION, name), `docs/49 §7 covers ${name} — MCP.md documents it`);
  }
  const coreVerbs = new Set(CORE.flatMap((row) => Object.keys(row.verbs).map((verb) => `${row.name}:${verb}`)));
  for (const target of Object.values(MIGRATION)) {
    if (target.tool) coreVerbs.delete(`${target.tool}:${target.verb}`);
  }
  assert.deepEqual([...coreVerbs], [], 'every core verb is reached by at least one migrated tool');
  // The red clause: the DEFAULT surface advertises no spelling whose mapping is behind the
  // surface or retired.
  const tools = await toolList(t);
  const served = new Set(tools.map((tool) => tool.name));
  const leaked = Object.entries(MIGRATION)
    .filter(([name, target]) => (target.retired !== undefined || target.surface !== undefined) && served.has(name))
    .map(([name]) => name);
  assert.deepEqual(leaked, [],
    'LAW (docs/49 §7): a spelling the migration moves behind baton_surface or retires is not '
    + 'advertised by default — progressive disclosure is the default, not an opt-in');
});

test('314-g RED: a retired flat spelling refuses unknown_tool with a movedTo pointer into the core (docs/49 §8)', async (t) => {
  const { request } = servedSurface(t);
  await ready(request);
  const retired = await request('g1', 'tools/call', { name: 'baton_runs', arguments: { repoId: REPO_ID } });
  assert.equal(retired.error?.data?.code, 'unknown_tool',
    'LAW (docs/49 §8): a retired flat spelling is not dispatched — it refuses with the landed '
    + 'unknown_tool code (mcp-northbound.mjs:2036-2046), never a new refusal code (#430/#436)');
  assert.deepEqual(retired.error?.data?.movedTo, { tool: 'baton_run', verb: 'list' },
    'the refusal data names the core verb that replaces the retired spelling');
  const unknown = await request('g2', 'tools/call', { name: 'baton_no_such_tool', arguments: { repoId: REPO_ID } });
  assert.equal(unknown.error?.data?.code, 'unknown_tool', 'the unknown-tool refusal keeps its landed code');
  assert.ok(Array.isArray(unknown.error?.data?.tools), 'the advertised set rides the refusal, as today');
});

test('314-h RED: MCP.md leads with the resident bridge and documents the descriptor as the headless mode (docs/49 §4)', async () => {
  const doc = readFileSync(new URL('../MCP.md', import.meta.url), 'utf8');
  const h1 = doc.match(/^# .+$/m)?.[0] ?? '';
  assert.ok(!/descriptor-first/u.test(h1),
    'LAW (docs/49 §4): the resident bridge is the entry story — the H1 does not lead with the descriptor');
  const firstSection = doc.match(/^## .+$/m)?.[0] ?? '';
  assert.match(firstSection, /resident bridge/iu,
    'the first section after the title is the resident-bridge connect story (baton serve, then the harness points at the bridge)');
  assert.ok(/headless/iu.test(doc), 'the descriptor is documented as the headless mode for a host without a resident');
});
