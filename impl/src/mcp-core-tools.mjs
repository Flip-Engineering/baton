// mcp-core-tools.mjs — the core agent surface (issue #314, docs/49-mcp-primary-surface.md §2-§3,
// §8, §10).
//
// ONE verb-discriminated closed tool per family — baton_deployment, baton_run, baton_swarm,
// baton_waves, baton_knowledge, baton_wakes, baton_services (#317), baton_surface. Every verb's
// argument schema is
// DERIVED from the table that already owns it: the ordinary application tool table
// (mcp-northbound.mjs ORDINARY_APPLICATION_TOOL_DEFINITIONS) for the run/deployment/waves/
// knowledge/wakes families, the swarm command contract (swarm-contract.mjs
// SWARM_COMMAND_SCHEMAS) for the swarm family, and the unified meta tools
// (surface-capability-resolution.mjs) for baton_surface. Only the CURATION lives here: which
// verbs the core carries, the order of each tool's closed verb set, the per-verb declared
// required set (docs/49 §2's tables) and the flat spellings each verb replaces (docs/49 §7).
// Field schemas, landed required fields, annotations and dispatch targets are read from the
// tables, never retyped — a verb or field added there appears here, one removed disappears.
//
// The table is a PROJECTION over the same dispatch (docs/36 §1.3, docs/49 §0): the production
// wrapper (production-mcp-convergence.mjs) advertises exactly these tools on the ordinary
// surface and routes a core call to the flat tool the verb names, so a core call and its legacy
// counterpart reach ONE operation with ONE schema. The raw McpFleetServer keeps its flat table:
// the core surface is what the SHIPPED composition (both entry scripts wrap) serves.

import {
  APPLICATION_SEMANTIC_REGISTRY, canonicalAndTransportNames, deriveSurfaceNames,
} from './application-semantics.mjs';
import { APPLICATION_TOOL, ORDINARY_APPLICATION_TOOL_DEFINITIONS, commandForTool } from './mcp-northbound.mjs';
import { COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS } from './surface-capability-resolution.mjs';
import { SWARM_COMMAND_DEFINITIONS, SWARM_COMMAND_SCHEMAS } from './swarm-contract.mjs';
import { WAKE_CLASSES } from './wake-stream.mjs';


/** The wake handoff docs/49 §2 declares for a long verb: the classes the answer's subscription
 * carries, the `settleOn` subset whose frame settles the follow-up, and the ARGUMENT axes the
 * subscription may be narrowed by — the operation's own subject, as §2's third column spells it
 * (`recruit` scopes by swarm AND participant; `check` names its swarm; the run and waves families
 * name none, because the #294 filter carries no run axis and their frames correlate client-side —
 * §12 Q2). Every class is checked against the landed vocabulary (WAKE_CLASS_TABLE, wake-stream.mjs)
 * when the table loads — a class the stream does not publish is a load-time refusal, never a
 * literal that drifts (§10) — and the scope names are argument fields, checked the same way. */
const WAKE_SCOPE_AXES = Object.freeze(['swarmId', 'participantId']);

function wakeHandoff(kinds, settleOn = kinds, scope = []) {
  for (const wakeClass of [...kinds, ...settleOn]) {
    if (!WAKE_CLASSES.includes(wakeClass)) {
      throw new Error(`mcp-core-tools: ${wakeClass} is not a wake class the deployment stream publishes`);
    }
  }
  for (const axis of scope) {
    if (!WAKE_SCOPE_AXES.includes(axis)) {
      throw new Error(`mcp-core-tools: ${axis} is not a wake filter axis (${WAKE_SCOPE_AXES.join(', ')})`);
    }
  }
  return Object.freeze({
    kinds: Object.freeze([...kinds]),
    settleOn: Object.freeze([...settleOn]),
    scope: Object.freeze([...scope]),
  });
}
const REPO_ID_SCHEMA = Object.freeze({ type: 'string', minLength: 1, maxLength: 4096 });

// ── the table (docs/49 §2) ────────────────────────────────────────────────────────────────────
//
// `requires` is the design's per-verb REQUIRED set; the served branch requires it beside the
// required set the landed counterpart already enforces (a core verb never relaxes the operation
// it projects, and a design field with no landed schema refuses at load).
// `dispatch` is the ordered leg list: the first leg whose `when` fields are present (a leg
// without `when` always matches) names the flat tool the call reaches.
// `omit` drops a landed field from the core schema where docs/49 retires the axis (there is one:
// run.view's waitMs — law (d), no core verb blocks).
// `replaces` are the flat spellings docs/49 §7 folds into this verb; the canonical dot spelling
// each one dispatches (canonicalAndTransportNames) rides the same pointer, derived.
// `wake` is the long verb's handoff (docs/49 §2's third column), present exactly on the verbs
// whose follow-up rides a subscription.

const CORE_TABLE = Object.freeze([
  Object.freeze({
    name: 'baton_deployment',
    description: 'Deployment authority: doctor reads fresh readiness (routes, workspace, credential posture as metadata). Quota-free; the route-picking prerequisite.',
    verbs: Object.freeze([
      Object.freeze({
        verb: 'doctor', requires: Object.freeze([]),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_deployment_doctor' })]),
        replaces: Object.freeze(['baton_deployment_doctor']),
      }),
    ]),
  }),
  Object.freeze({
    name: 'baton_run',
    description: 'One Run: start, view (the one read, depth/section/role axes), list, send, stop, answer (settles attention), do (the advertised action executor, L2).',
    verbs: Object.freeze([
      Object.freeze({
        verb: 'start', requires: Object.freeze(['intent', 'idempotencyKey']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_run_start' })]),
        replaces: Object.freeze(['baton_run_start']),
        wake: wakeHandoff(['attention', 'paused', 'integrated']),
      }),
      Object.freeze({
        verb: 'view', requires: Object.freeze(['runId']), omit: Object.freeze(['waitMs']),
        dispatch: Object.freeze([
          Object.freeze({ tool: 'baton_run_episode', when: Object.freeze(['role', 'generation']) }),
          Object.freeze({ tool: 'baton_run_inspect' }),
        ]),
        replaces: Object.freeze(['baton_run_view', 'baton_run_inspect', 'baton_run_episode']),
      }),
      Object.freeze({
        verb: 'list', requires: Object.freeze([]),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_runs' })]),
        replaces: Object.freeze(['baton_runs']),
      }),
      Object.freeze({
        verb: 'send', requires: Object.freeze(['runId', 'body']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_run_message_send' })]),
        replaces: Object.freeze(['baton_run_message_send']),
      }),
      Object.freeze({
        verb: 'stop', requires: Object.freeze(['runId', 'reason', 'idempotencyKey']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_run_stop' })]),
        replaces: Object.freeze(['baton_run_stop']),
      }),
      Object.freeze({
        verb: 'answer', requires: Object.freeze(['runId', 'requestId', 'answer', 'idempotencyKey']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_decision_answer' })]),
        replaces: Object.freeze(['baton_decision_answer']),
      }),
      Object.freeze({
        verb: 'do', requires: Object.freeze(['runId', 'actionId', 'inputs', 'idempotencyKey']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_run_act' })]),
        replaces: Object.freeze(['baton_run_act', 'baton_run_do']),
      }),
    ]),
  }),
  Object.freeze({
    name: 'baton_swarm',
    description: 'One swarm: create, list, view (the sliced read), update (the closed event set), recruit, guide, capture, check. capture/check are identity-keyed; the rest carry idempotencyKey.',
    // Every swarm verb's schema comes from the swarm command contract; the flat tool it
    // dispatches is the contract row's own derived MCP name (swarm-surface.mjs).
    verbs: Object.freeze([
      Object.freeze({ verb: 'create', command: 'swarm.create', requires: Object.freeze(['purpose', 'idempotencyKey']) }),
      Object.freeze({ verb: 'list', command: 'swarm.list', requires: Object.freeze([]) }),
      Object.freeze({ verb: 'view', command: 'swarm.view', requires: Object.freeze(['swarmId']) }),
      Object.freeze({ verb: 'update', command: 'swarm.update', requires: Object.freeze(['swarmId', 'event', 'idempotencyKey']) }),
      Object.freeze({ verb: 'recruit', command: 'swarm.recruit', requires: Object.freeze(['swarmId', 'participantId', 'objective', 'idempotencyKey']),
        wake: wakeHandoff(
          ['queued', 'refused', 'dead', 'reroute_proposed', 'contribution_recorded'],
          ['refused', 'dead', 'reroute_proposed', 'contribution_recorded'],
          ['swarmId', 'participantId'],
        ) }),
      Object.freeze({ verb: 'guide', command: 'swarm.guide', requires: Object.freeze(['swarmId', 'participantId', 'message', 'idempotencyKey']) }),
      Object.freeze({ verb: 'capture', command: 'swarm.capture', requires: Object.freeze(['swarmId', 'participantId']) }),
      Object.freeze({ verb: 'check', command: 'swarm.check', requires: Object.freeze(['swarmId', 'participantId', 'contributionId']),
        wake: wakeHandoff(['reviewed'], ['reviewed'], ['swarmId']) }),
    ]),
  }),
  Object.freeze({
    name: 'baton_waves',
    description: 'One wave cohort: start (detached, per-member quota), list, progress (paged), send, stop — member-targeted by runId.',
    verbs: Object.freeze([
      Object.freeze({
        verb: 'start', requires: Object.freeze(['members', 'idempotencyKey']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_waves_start' })]),
        replaces: Object.freeze(['baton_waves_start']),
        wake: wakeHandoff(['attention', 'paused', 'integrated']),
      }),
      Object.freeze({
        verb: 'list', requires: Object.freeze([]),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_waves_list' })]),
        replaces: Object.freeze(['baton_waves_list']),
      }),
      Object.freeze({
        verb: 'progress', requires: Object.freeze(['waveId']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_waves_progress' })]),
        replaces: Object.freeze(['baton_waves_progress']),
      }),
      Object.freeze({
        verb: 'send', requires: Object.freeze(['runId', 'message']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_waves_send' })]),
        replaces: Object.freeze(['baton_waves_send']),
      }),
      Object.freeze({
        verb: 'stop', requires: Object.freeze(['runId', 'reason']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_waves_stop' })]),
        replaces: Object.freeze(['baton_waves_stop']),
      }),
    ]),
  }),
  Object.freeze({
    name: 'baton_knowledge',
    description: 'The knowledge layer: search the deployment evidence and contributions (seq cursor), seed one content-addressed node inside a run horizon.',
    verbs: Object.freeze([
      Object.freeze({
        verb: 'search', requires: Object.freeze([]),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_evidence_search' })]),
        replaces: Object.freeze(['baton_evidence_search']),
      }),
      Object.freeze({
        verb: 'seed', requires: Object.freeze(['runId', 'type', 'grounding', 'body']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_run_knowledge_seed' })]),
        replaces: Object.freeze(['baton_run_knowledge_seed']),
      }),
    ]),
  }),
  Object.freeze({
    name: 'baton_wakes',
    description: "The session wake plane (#294): subscribe (a filter over the session's ONE attachment, frames arrive as notifications), since (one bounded pull page), unsubscribe. Never a second connection.",
    verbs: Object.freeze([
      Object.freeze({
        verb: 'subscribe', requires: Object.freeze([]),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_wakes_subscribe' })]),
        replaces: Object.freeze(['baton_wakes_subscribe']),
      }),
      Object.freeze({
        verb: 'since', requires: Object.freeze([]),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_wakes_since' })]),
        replaces: Object.freeze(['baton_wakes_since']),
      }),
      Object.freeze({
        verb: 'unsubscribe', requires: Object.freeze(['subscriptionId']),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_wakes_unsubscribe' })]),
        replaces: Object.freeze(['baton_wakes_unsubscribe']),
      }),
    ]),
  }),
  // Issue #317 (docs/50): the provider-services family — ONE read verb over the deployment's
  // declared services. The per-verb schema derives from the flat baton_services_list row like
  // every other dispatch-projected verb.
  Object.freeze({
    name: 'baton_services',
    description: 'Provider services (issue #317): list the deployment’s configured API services — the models each offers, the routes derived from them, and subscription-window usage with its reset instant.',
    verbs: Object.freeze([
      Object.freeze({
        verb: 'list', requires: Object.freeze([]),
        dispatch: Object.freeze([Object.freeze({ tool: 'baton_services_list' })]),
        replaces: Object.freeze(['baton_services_list']),
      }),
    ]),
  }),
  Object.freeze({
    name: 'baton_surface',
    description: 'Progressive disclosure: catalog the capabilities this deployment profile serves, describe one (schema and posture), invoke it through its existing authority; snapshot, watch (bounded composite), visualize.',
    // The six unified meta tools fold into this ONE tool: each verb dispatches its meta name
    // through the wrapper's existing meta authority (production-mcp-convergence.mjs handleMeta).
    verbs: Object.freeze([
      Object.freeze({
        verb: 'catalog', requires: Object.freeze([]),
        meta: 'baton_surface_catalog', replaces: Object.freeze(['baton_surface_catalog']),
      }),
      Object.freeze({
        verb: 'describe', requires: Object.freeze(['name']),
        meta: 'baton_surface_describe',
        // baton_help / baton_application_help are the legacy help spellings docs/49 §7 folds
        // into describe (it answers a capability name OR a help topic).
        replaces: Object.freeze(['baton_surface_describe', 'baton_help', 'baton_application_help']),
      }),
      Object.freeze({
        verb: 'invoke', requires: Object.freeze(['name']),
        meta: 'baton_surface_invoke', replaces: Object.freeze(['baton_surface_invoke']),
      }),
      Object.freeze({
        verb: 'snapshot', requires: Object.freeze([]),
        meta: 'baton_surface_snapshot', replaces: Object.freeze(['baton_surface_snapshot']),
      }),
      Object.freeze({
        verb: 'watch', requires: Object.freeze([]),
        meta: 'baton_surface_watch', replaces: Object.freeze(['baton_surface_watch']),
      }),
      Object.freeze({
        verb: 'visualize', requires: Object.freeze([]),
        meta: 'baton_surface_visualize', replaces: Object.freeze(['baton_surface_visualize']),
      }),
    ]),
  }),
]);

/** The retired blocking reads (docs/49 §5, §7): gone from MCP, each replaced by the wake plane.
 * Named here so the refusal can carry the pointer every moved spelling carries. */
const RETIRED_FLAT_SPELLINGS = Object.freeze(new Map([
  ['baton_run_attention_watch', Object.freeze({ tool: 'baton_wakes', verb: 'subscribe' })],
  ['baton_swarm_watch', Object.freeze({ tool: 'baton_wakes', verb: 'subscribe' })],
]));

/** Issue #156: the application profile IS the parity superset — the ordinary table the raw
 * McpFleetServer serves (D1's 49-tool flat table), in served order. The CORE_TABLE verb-tool
 * curation above remains the production wrapper's projection; this name list is the surface the
 * committed inventory artifact records (the conformance reader and the red suite agree on it). */
export const CORE_TOOL_NAMES = Object.freeze(ORDINARY_APPLICATION_TOOL_DEFINITIONS.map((tool) => tool.name));

/** The closed verb set of each core tool, in the tool's own order (the served enum). */
export const CORE_TOOL_VERBS = Object.freeze(Object.fromEntries(
  CORE_TABLE.map((row) => [row.name, Object.freeze(row.verbs.map((verb) => verb.verb))]),
));

const CORE_TOOLS_BY_NAME = new Map(CORE_TABLE.map((row) => [row.name, row]));
const VERBS_BY_TOOL = new Map(CORE_TABLE.map((row) => [
  row.name,
  new Map(row.verbs.map((verb) => [verb.verb, verb])),
]));

const ORDINARY_TOOLS_BY_NAME = new Map(
  ORDINARY_APPLICATION_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]),
);
const META_TOOLS_BY_NAME = new Map(
  COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]),
);

/** The landed tables the core table projects, injectable so a pin can prove the derivation is
 * live (a field added to a family table appears in the tool, one removed disappears). */
export function coreSources() {
  return {
    ordinary: (name) => ORDINARY_TOOLS_BY_NAME.get(name) ?? null,
    meta: (name) => META_TOOLS_BY_NAME.get(name) ?? null,
    swarm: (command) => SWARM_COMMAND_SCHEMAS[command] ?? null,
    swarmDefined: (command) => Object.hasOwn(SWARM_COMMAND_DEFINITIONS, command),
  };
}

/** The flat tool a verb's call reaches: the first leg whose `when` fields the caller supplied,
 * else the leg without one. */
function dispatchTarget(verb, args, sources) {
  if (verb.meta) return { kind: 'meta', name: verb.meta };
  if (verb.command) return { kind: 'tool', name: deriveSurfaceNames(verb.command).mcp };
  const legs = verb.dispatch;
  const chosen = legs.find((leg) => leg.when === undefined
    || leg.when.some((field) => Object.prototype.hasOwnProperty.call(args ?? {}, field)))
    ?? legs[legs.length - 1];
  return { kind: 'tool', name: chosen.tool };
}

/** The source schema a verb projects for one dispatch leg. */
function legSource(verb, leg, sources) {
  if (verb.command) {
    if (!sources.swarmDefined(verb.command)) {
      throw new Error(`mcp-core-tools: the swarm family no longer carries ${verb.command} (verb ${verb.verb}) — the projection must track the family table`);
    }
    return sources.swarm(verb.command);
  }
  return verb.meta ? sources.meta(verb.meta) : sources.ordinary(leg.tool);
}

/** Every dispatch leg of a verb, in declaration order. */
function verbLegs(verb) {
  if (verb.command) return [{ tool: deriveSurfaceNames(verb.command).mcp }];
  if (verb.meta) return [{ meta: verb.meta }];
  return verb.dispatch;
}

/** The schema a verb projects: the union of its legs' landed properties, minus repoId (the
 * envelope field the core schema carries once at the top level) and minus the retired axes.
 * Landed required fields are the ones EVERY leg requires (a call must satisfy the leg it
 * reaches). Throws when a declared required field has no landed schema, or a leg's landed row
 * is missing — the derivation must be complete, never silently partial. */
function verbSchema(verb, sources) {
  const legs = verbLegs(verb);
  const omit = new Set(verb.omit ?? []);
  const fields = {};
  let required = null;
  for (const leg of legs) {
    const source = legSource(verb, leg, sources);
    // An ordinary/meta tool row carries its schema under `inputSchema`; a swarm contract row
    // IS the schema. ONE access, whichever table the leg projects.
    const schema = source?.inputSchema ?? source ?? null;
    if (!schema?.properties) {
      throw new Error(`mcp-core-tools: no landed schema for verb ${verb.verb} leg ${leg.tool ?? leg.meta} — the projected table row is missing`);
    }
    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      if (field === 'repoId' || omit.has(field)) continue;
      if (fields[field] === undefined) fields[field] = fieldSchema;
    }
    const landed = new Set((schema.required ?? []).filter((field) => field !== 'repoId' && !omit.has(field)));
    required = required === null ? landed : new Set([...required].filter((field) => landed.has(field)));
  }
  const resolved = [...new Set([...verb.requires, ...(required ?? [])])];
  for (const field of resolved) {
    if (!Object.hasOwn(fields, field)) {
      throw new Error(`mcp-core-tools: verb ${verb.verb} requires ${field}, which its landed counterpart does not carry`);
    }
  }
  return { fields, required: Object.freeze(resolved) };
}

/** ONE core tool's wire definition: a `verb`-discriminated closed union — the union of every
 * verb's fields at the top level with additionalProperties: false, and one oneOf branch per
 * verb pinning its required set. `bindApplicationContext` strips the envelope fields the bound
 * bridge surface derives, exactly as the raw server does for its own table. */
export function coreToolDefinition(row, sources = coreSources(), { bindApplicationContext = false } = {}) {
  const properties = {};
  if (!bindApplicationContext) properties.repoId = REPO_ID_SCHEMA;
  const oneOf = [];
  const annotations = [];
  const admitted = [];
  for (const verb of row.verbs) {
    const { fields, required } = verbSchema(verb, sources);
    for (const [field, fieldSchema] of Object.entries(fields)) {
      if (bindApplicationContext && field === 'idempotencyKey') continue;
      if (properties[field] === undefined) properties[field] = fieldSchema;
    }
    const branchRequired = required.filter((field) => !(bindApplicationContext && field === 'idempotencyKey'));
    oneOf.push(Object.freeze({
      properties: Object.freeze({ verb: Object.freeze({ const: verb.verb }) }),
      required: Object.freeze(['verb', ...branchRequired]),
    }));
    admitted.push(verb.verb);
    annotations.push(dispatchTarget(verb, {}, sources));
  }
  const legAnnotations = annotations.map((target) => (target.kind === 'meta'
    ? META_TOOLS_BY_NAME.get(target.name)?.annotations
    : ORDINARY_TOOLS_BY_NAME.get(target.name)?.annotations));
  return Object.freeze({
    name: row.name,
    description: row.description,
    _meta: Object.freeze({ 'baton/registryDigest': APPLICATION_SEMANTIC_REGISTRY.digest }),
    inputSchema: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze(bindApplicationContext ? ['verb'] : ['repoId', 'verb']),
      properties: Object.freeze({
        ...properties,
        verb: Object.freeze({ type: 'string', enum: Object.freeze(admitted) }),
      }),
      oneOf: Object.freeze(oneOf),
    }),
    annotations: Object.freeze({
      readOnlyHint: legAnnotations.every((entry) => entry?.readOnlyHint === true),
      destructiveHint: legAnnotations.some((entry) => entry?.destructiveHint === true),
      idempotentHint: true,
      openWorldHint: false,
    }),
  });
}

/** The seven core tool definitions, in table order — exactly what the production wrapper
 * advertises on the ordinary surface. */
export function coreToolDefinitions(options = {}) {
  const sources = options.sources ?? coreSources();
  return Object.freeze(CORE_TABLE.map((row) => coreToolDefinition(row, sources, options)));
}

/** The facts a receipt/wake answer composer reads off one core verb (docs/49 §5, §10): whether
 * the verb mutates (the landed counterpart's own annotation), whether it is long — its
 * follow-up rides a wake subscription — and that handoff when it is. The handoff's classes are
 * the table's `wake` rows, drawn from the landed wake vocabulary at load. */
export function coreVerbFacts(toolName, verbName, sources = null) {
  const verb = VERBS_BY_TOOL.get(toolName)?.get(verbName);
  if (verb === undefined) {
    throw new Error(`mcp-core-tools: ${toolName} verb ${verbName} is not in the core table`);
  }
  const target = dispatchTarget(verb, {}, sources ?? coreSources());
  const annotations = target.kind === 'meta'
    ? META_TOOLS_BY_NAME.get(target.name)?.annotations
    : ORDINARY_TOOLS_BY_NAME.get(target.name)?.annotations;
  return Object.freeze({
    mutation: annotations?.readOnlyHint === false,
    long: verb.wake !== undefined,
    wake: verb.wake ?? null,
  });
}

// ── the bridge's own view of the table (docs/49 §5, §10) ──────────────────────────────────────
//
// The resident bridge never sees the core (tool, verb) pair: the production wrapper resolves it
// and dispatches the flat counterpart, so the facade holds a wire COMMAND (`run.start`) and needs
// the same facts `coreVerbFacts` answers. The index below is that lookup, derived from the SAME
// rows — a command → its verb → the facts — so the wake handoff has ONE owner (this table) and a
// bridge-side hand list can never drift from it.
/** The wire command a core verb dispatches: the contract command for a swarm verb, else the
 * landed application command its flat counterpart carries (mcp-northbound.mjs `commandForTool`,
 * which reads BOTH the table binding and the explicit-dispatch lane) — null for a verb whose
 * dispatch is the unified meta authority (no application command). */
function verbCommand(verb, sources) {
  if (verb.command) return verb.command;
  if (verb.meta) return null;
  return commandForTool(dispatchTarget(verb, {}, sources).name);
}

function commandFactsIndex(sources) {
  const index = new Map();
  for (const row of CORE_TABLE) {
    for (const verb of row.verbs) {
      const command = verbCommand(verb, sources);
      if (command === null) continue;
      if (index.has(command)) {
        throw new Error(`mcp-core-tools: the command ${command} is dispatched by two core verbs`);
      }
      index.set(command, Object.freeze({ tool: row.name, verb: verb.verb, ...coreVerbFacts(row.name, verb.verb, sources) }));
    }
  }
  return index;
}

let commandFactsCache = null;

/** The core facts a bridge composer reads off the wire COMMAND it holds: `{tool, verb, mutation,
 * long, wake}`, or null when the core does not fold that command in (a command the core never
 * serves keeps the answer its own lane sends, unchanged). */
export function coreCommandFacts(command, sources = null) {
  if (sources !== null) return commandFactsIndex(sources).get(command) ?? null;
  if (commandFactsCache === null) commandFactsCache = commandFactsIndex(coreSources());
  return commandFactsCache.get(command) ?? null;
}

// ── the migration pointers (docs/49 §7, §8) ───────────────────────────────────────────────────
//
// Every flat spelling the core folds in, and the core (tool, verb) that replaces it — derived
// from each verb's `replaces` plus the canonical dot spelling of the command that spelling
// dispatches (canonicalAndTransportNames over APPLICATION_TOOL), never a second hand list.

function replacementIndex(sources) {
  const index = new Map();
  const map = (spelling, target) => {
    const existing = index.get(spelling);
    if (existing && (existing.tool !== target.tool || existing.verb !== target.verb)) {
      throw new Error(`mcp-core-tools: the flat spelling ${spelling} maps to two core verbs`);
    }
    index.set(spelling, target);
  };
  for (const row of CORE_TABLE) {
    for (const verb of row.verbs) {
      const target = Object.freeze({ tool: row.name, verb: verb.verb });
      const spellings = new Set(verb.replaces ?? []);
      if (verb.command) spellings.add(deriveSurfaceNames(verb.command).mcp);
      for (const spelling of [...spellings]) {
        map(spelling, target);
        const definition = sources.ordinary(spelling);
        const command = definition === null ? null : APPLICATION_TOOL[spelling] ?? null;
        if (typeof command === 'string') {
          const dot = canonicalAndTransportNames(command).canonical;
          if (dot !== spelling) map(dot, target);
        }
      }
    }
  }
  return index;
}

let replacementCache = null;
let replacementCacheSources = null;

/** flat spelling → the core {tool, verb} that replaces it, or null when the core does not fold
 * it (a spelling that stays reachable behind baton_surface, or one this surface never served). */
export function coreReplacementFor(name, sources = null) {
  if (sources !== null) return replacementIndex(sources).get(name) ?? null;
  if (replacementCache === null) {
    replacementCacheSources = coreSources();
    replacementCache = replacementIndex(replacementCacheSources);
  }
  return replacementCache.get(name) ?? null;
}

/** The movedTo data a refusal carries for a flat spelling: the core verb that replaces it, or
 * the wake-plane replacement for a retired blocking read. */
export function coreMovedTo(name, sources = null) {
  return coreReplacementFor(name, sources) ?? RETIRED_FLAT_SPELLINGS.get(name) ?? null;
}

/** The retired blocking reads, as a Map of spelling → the {tool, verb} that replaces it. */
export function coreRetiredSpellings() {
  return RETIRED_FLAT_SPELLINGS;
}

/** The unified meta tool name → the baton_surface verb that now carries it, derived from the
 * table. The CLI's own MCP client (configured-mcp-client.mjs, `baton surface … --mcp`) speaks
 * exactly these six spellings, and docs/49 §0 keeps the CLI unchanged: the wrapper accepts them
 * as the aliases they are (unadvertised, routed to the same verb) while every OTHER moved flat
 * spelling refuses with its pointer. */
const META_ALIAS_BY_TOOL = new Map(CORE_TABLE.flatMap((row) => row.verbs
  .filter((verb) => verb.meta !== undefined)
  .map((verb) => [verb.meta, Object.freeze({ tool: row.name, verb: verb.verb })])));

/** The core {tool, verb} an unadvertised unified meta spelling folds into, or null. */
export function coreMetaAlias(name) {
  return META_ALIAS_BY_TOOL.get(name) ?? null;
}

// ── the call resolver (the wrapper's dispatch seam) ──────────────────────────────────────────

/** Resolve ONE core tool call: `{ok: true, dispatch: {kind: 'tool'|'meta', name, verb, arguments}}`,
 * or a typed `invalid_arguments` refusal `{ok: false, code, message, detail, field}`.
 * The verb must be the tool's own closed enum; the fields must be the verb's own closed set
 * (a field only another verb carries refuses here, taught with the admitted set — docs/49 §2). */
export function resolveCoreCall(toolName, args, { sources = null, bindApplicationContext = false } = {}) {
  const row = CORE_TOOLS_BY_NAME.get(toolName);
  if (!row) throw new Error(`mcp-core-tools: ${toolName} is not a core tool`);
  const verbs = VERBS_BY_TOOL.get(toolName);
  const supplied = args ?? {};
  const verbName = supplied.verb;
  if (typeof verbName !== 'string' || !verbs.has(verbName)) {
    const admitted = row.verbs.map((verb) => verb.verb);
    return {
      ok: false, code: 'invalid_arguments', field: 'verb',
      message: `verb must be one of: ${admitted.join(', ')}`,
      detail: { field: 'verb', admitted },
    };
  }
  const verb = verbs.get(verbName);
  const { fields } = verbSchema(verb, sources ?? coreSources());
  const admittedFields = new Set(Object.keys(fields));
  const external = { ...supplied };
  delete external.verb;
  for (const field of Object.keys(external)) {
    if (field === 'repoId' || field === 'idempotencyKey') continue;
    if (admittedFields.has(field)) continue;
    const admitted = [...admittedFields, 'repoId', 'idempotencyKey'].sort();
    return {
      ok: false, code: 'invalid_arguments', field,
      message: `${field} is not an argument of ${toolName} verb ${verbName}; admitted: ${admitted.join(', ')}`,
      detail: { field, admitted, verb: verbName },
    };
  }
  const target = dispatchTarget(verb, external, sources ?? coreSources());
  return {
    ok: true,
    dispatch: Object.freeze({
      kind: target.kind, name: target.name, verb: verbName, arguments: external,
    }),
  };
}
