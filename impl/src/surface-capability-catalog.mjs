import { readFileSync } from 'node:fs';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  applicationOperationAliasMap,
} from './application-semantics.mjs';
import {
  APPLICATION_UNIFIED_COMMAND_REGISTRY,
  ambiguousLegacyAliases,
  resolveUnifiedSurfaceCommand,
} from './control-surface-unification.mjs';
import { BatonControlError, digestValue } from './holistic-runtime.mjs';
import {
  mcpAdvancedToolNames,
  mcpApplicationToolNames,
  mcpCombinedToolNames,
  mcpDispatchToolNames,
} from './mcp-northbound.mjs';
import { webAdmittedCommandNames } from './web-northbound.mjs';

export const UNIFIED_SURFACE_CATEGORIES = Object.freeze([
  'control',
  'observation',
  'telemetry',
  'communication',
  'task_management',
  'knowledge',
  'diagnostics',
  'notifications',
]);

const nativeManifest = JSON.parse(readFileSync(
  new URL('../scripts/native-surface-capabilities.json', import.meta.url),
  'utf8',
));
const operationAliases = applicationOperationAliasMap();
const semanticByKey = new Map(
  APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.map((row) => [row.key, row]),
);
const applicationMcpNames = new Set(mcpApplicationToolNames());
const advancedMcpNames = new Set(mcpAdvancedToolNames());
const combinedMcpNames = Object.freeze(mcpCombinedToolNames());
const combinedMcpNameSet = new Set(combinedMcpNames);
const dispatchMcpNames = new Set(mcpDispatchToolNames());
const webCommandNames = new Set(webAdmittedCommandNames());
const cliExceptionKeys = new Set((nativeManifest.registryCliExceptions ?? []).map((row) => row.key));
const nativeOwnership = new Map((nativeManifest.mcpNative ?? []).map((row) => [row.name, row]));

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const clone = (value) => value == null ? value : structuredClone(value);
const unique = (values) => [...new Set(values)].sort();

const OBSERVATION = /(?:observe|read|view|inspect|list|status|progress|events|output|episode|follow|wait|result|receipt|catalog|describe|recall|horizon|cite)/u;
const TELEMETRY = /(?:telemetry|doctor|readiness|provider|roster|seat|status|progress|events|output|episode|follow|wait|scorecard|evaluation|capabilities|route)/u;
const COMMUNICATION = /(?:message|send|answer|respond|feedback|steer|interrupt|decision|notify|reply|approval)/u;
const TASK = /(?:run|wave|member|worker|task|workflow|board|plan|goal|candidate|select|adopt|integrate|review|package)/u;
const KNOWLEDGE = /(?:knowledge|scratchpad|context|repl|package|board|briefing|cairn|atlas|finding)/u;
const DIAGNOSTICS = /(?:debug|diagnos|doctor|readiness|evidence|inspect|review|verify|verification|orientation|orient|capabilities|provider|route|environment|result|health)/u;
const NOTIFICATIONS = /(?:attention|decision|message|watch|follow|notify|receipt|approval|checkpoint)/u;
const CONTROL = /(?:control|start|stop|interrupt|kill|drain|close|shutdown|approve|answer|respond|recover|retry|resume|adopt|integrate|select|revise|send|post|drop|reorder|retitle|promote|admit|attach|settle|seed|append|invoke|claim|report)/u;

function categoryText(row) {
  return [
    row.key,
    row.verb,
    row.noun,
    row.effect,
    row.helpTopic,
    row.outputView,
    row.description,
    ...(row.capabilities ?? []),
  ].filter((value) => typeof value === 'string').join(' ').toLowerCase();
}

function categoriesFor(row) {
  const text = categoryText(row);
  const categories = new Set();
  if (row.mode === 'query' || OBSERVATION.test(text)) categories.add('observation');
  if (row.mode === 'effect' || CONTROL.test(text)
    || (row.capabilities ?? []).some((value) => ['control', 'approve', 'emergency_stop'].includes(value))) {
    categories.add('control');
  }
  if (TELEMETRY.test(text)) categories.add('telemetry');
  if (COMMUNICATION.test(text)) categories.add('communication');
  if (TASK.test(text)) categories.add('task_management');
  if (KNOWLEDGE.test(text)) categories.add('knowledge');
  if (DIAGNOSTICS.test(text)) categories.add('diagnostics');
  if (row.notification === true || NOTIFICATIONS.test(text)) categories.add('notifications');
  if (categories.size === 0) categories.add(row.mode === 'query' ? 'observation' : 'control');
  return Object.freeze([...categories].sort());
}

function candidateNames(row, surface) {
  return unique([
    row.key,
    row.names?.[surface],
    ...(row.aliases?.[surface] ?? []),
  ].filter(Boolean));
}

function applicationRow(row) {
  const semantic = semanticByKey.get(row.key) ?? {};
  const hostLocal = row.key === 'deployment.serve';
  const cliDeclared = row.surfaces.includes('cli');
  const mcpDeclared = row.surfaces.includes('mcp');
  const webDeclared = row.surfaces.includes('web');
  const embeddedDirect = row.surfaces.includes('embedded');
  const cliDirect = cliDeclared && !cliExceptionKeys.has(row.key);
  const mcpDirect = candidateNames(row, 'mcp').some((name) => combinedMcpNameSet.has(name));
  const webDirect = candidateNames(row, 'web').some((name) => webCommandNames.has(name));
  const cliAction = row.admission?.cli?.authorizedAction ?? null;
  const mcpAction = row.admission?.mcp?.authorizedAction ?? null;
  const operatorFacing = !hostLocal && [cliDirect, mcpDirect, webDirect, cliAction, mcpAction].some(Boolean);
  const remotePosture = hostLocal ? 'host_local'
    : operatorFacing ? 'operator'
      : semantic.profile === 'worker' ? 'worker_internal' : 'embedded_only';
  const applicationCommand = operationAliases[row.key] ?? row.key;
  const enriched = {
    ...row,
    verb: semantic.verb ?? null,
    noun: semantic.noun ?? null,
    helpTopic: semantic.helpTopic ?? null,
    outputView: semantic.outputView ?? null,
    example: semantic.example ?? null,
    description: semantic.helpTopic
      ? `Existing Baton ${semantic.helpTopic} capability` : `Existing Baton ${row.key} capability`,
  };
  return freeze({
    id: row.key,
    owner: 'application',
    kind: 'application_operation',
    key: row.key,
    names: clone(row.names),
    aliases: clone(row.aliases),
    categories: categoriesFor(enriched),
    mode: row.mode,
    lane: row.lane,
    capabilities: clone(row.capabilities),
    schema: clone(row.schema),
    effect: row.effect,
    verb: enriched.verb,
    noun: enriched.noun,
    helpTopic: enriched.helpTopic,
    outputView: enriched.outputView,
    example: enriched.example,
    description: enriched.description,
    notification: row.notification === true,
    handler: row.handler,
    authorityFields: clone(row.authorityFields),
    serverDerived: clone(row.serverDerived),
    transportHidden: clone(row.transportHidden),
    profile: row.profile,
    hostLocal,
    operatorFacing,
    remotePosture,
    parityRequired: operatorFacing,
    invocation: {
      applicationCommand,
      cliAction,
      mcpAction,
      actionIdRequiredForFallback: Boolean(cliAction || mcpAction),
    },
    surfaces: {
      cli: {
        declared: cliDeclared,
        direct: cliDirect,
        generic: operatorFacing,
        via: unique([
          ...(cliDirect ? ['direct'] : []),
          ...(webDirect ? ['authenticated_web'] : []),
          ...(mcpDirect ? ['mcp_descriptor'] : []),
          ...(cliAction ? ['run.do'] : []),
          ...(!cliDirect && operatorFacing ? ['surface.invoke'] : []),
        ]),
        reachable: cliDirect || operatorFacing,
      },
      mcp: {
        declared: mcpDeclared,
        direct: mcpDirect,
        generic: operatorFacing,
        via: unique([
          ...(mcpDirect ? ['direct'] : []),
          ...(operatorFacing ? ['baton_surface_invoke'] : []),
          ...(mcpAction ? ['run.do'] : []),
        ]),
        reachable: mcpDirect || operatorFacing,
      },
      web: { declared: webDeclared, direct: webDirect, reachable: webDirect },
      embedded: { declared: embeddedDirect, direct: embeddedDirect, reachable: embeddedDirect },
    },
  });
}

function resolvesApplicationTool(name) {
  try {
    resolveUnifiedSurfaceCommand('mcp', name);
    return true;
  } catch (error) {
    if (error?.code === 'command_alias_ambiguous') return true;
    if (error?.code === 'command_unknown') return false;
    throw error;
  }
}

function nativeMode(name) {
  return /(?:_read|_list|_view|_status|_progress|_compile|_receipt|_watch|_recall|_horizon|_cite|_result|_capabilities|_wait)$/u.test(name)
    ? 'query' : 'effect';
}

function nativeOwner(name) {
  const declared = nativeOwnership.get(name);
  if (declared) return declared.owner;
  if (name.startsWith('fleet_')) return 'fleet-kernel';
  if (name.startsWith('baton_board_')) return 'board-kernel';
  if (name.startsWith('baton_package_')) return 'package-kernel';
  if (name.startsWith('baton_knowledge_')) return 'knowledge-kernel';
  if (name.startsWith('baton_repl_')) return 'repl-kernel';
  if (name.startsWith('baton_scratchpad_')) return 'scratchpad-kernel';
  if (name.startsWith('baton_waves_')) return 'wave-kernel';
  return 'mcp-native';
}

function nativeMcpRow(name) {
  const declared = nativeOwnership.get(name);
  const mode = nativeMode(name);
  const profile = applicationMcpNames.has(name) ? 'application'
    : advancedMcpNames.has(name) ? 'advanced' : 'combined';
  const description = declared?.reason ?? `Existing ${profile} MCP tool ${name}`;
  const row = {
    key: name,
    mode,
    effect: description,
    description,
    capabilities: [],
    notification: NOTIFICATIONS.test(name),
  };
  return freeze({
    id: name,
    owner: nativeOwner(name),
    kind: 'mcp_native',
    key: name,
    names: { mcp: name },
    aliases: { cli: [], mcp: [], web: [], embedded: [] },
    categories: categoriesFor(row),
    mode,
    lane: mode === 'query' ? 'projection'
      : /(?:kill|drain|stop)/u.test(name) ? 'emergency_control' : 'interactive_control',
    capabilities: [],
    schema: null,
    effect: description,
    description,
    notification: row.notification,
    handler: name,
    profile,
    stateful: dispatchMcpNames.has(name),
    hostLocal: false,
    operatorFacing: true,
    remotePosture: 'operator',
    parityRequired: true,
    invocation: { mcpTool: name },
    surfaces: {
      cli: { declared: false, direct: false, generic: true, via: ['mcp_descriptor', 'surface.invoke'], reachable: true },
      mcp: { declared: true, direct: true, generic: true, via: ['direct', 'baton_surface_invoke'], reachable: true },
      web: { declared: false, direct: false, reachable: false },
      embedded: { declared: true, direct: true, reachable: true },
    },
  });
}

function nativeCliRow(row) {
  const key = row.canonicalKey ?? `cli.${row.name.replaceAll(' ', '.')}`;
  const description = row.reason;
  return freeze({
    id: key,
    owner: row.owner,
    kind: 'cli_native',
    key,
    names: { cli: `baton ${row.name}` },
    aliases: { cli: [], mcp: [], web: [], embedded: [] },
    categories: categoriesFor({ key, mode: 'effect', effect: description, description, capabilities: [] }),
    mode: 'effect',
    lane: /(?:serve|shutdown)/u.test(key) ? 'lifecycle_effects' : 'interactive_control',
    capabilities: [],
    schema: null,
    effect: description,
    description,
    notification: false,
    handler: row.name,
    hostLocal: true,
    operatorFacing: false,
    remotePosture: 'host_local',
    parityRequired: false,
    invocation: { cliCommand: row.name },
    surfaces: {
      cli: { declared: true, direct: true, generic: false, via: ['direct'], reachable: true },
      mcp: { declared: false, direct: false, generic: false, via: [], reachable: false },
      web: { declared: false, direct: false, reachable: false },
      embedded: { declared: false, direct: false, reachable: false },
    },
  });
}

const META_ROWS = Object.freeze([
  ['surface.catalog', 'query', ['observation', 'diagnostics']],
  ['surface.describe', 'query', ['observation', 'diagnostics']],
  ['surface.invoke', 'effect', ['control', 'task_management']],
  ['surface.snapshot', 'query', ['observation', 'telemetry', 'diagnostics', 'notifications']],
].map(([key, mode, categories]) => freeze({
  id: key,
  owner: 'surface-kernel',
  kind: 'surface_meta',
  key,
  names: { cli: `baton ${key.replace('.', ' ')}`, mcp: `baton_${key.replace('.', '_')}` },
  aliases: { cli: [], mcp: [], web: [], embedded: [] },
  categories: Object.freeze(categories),
  mode,
  lane: mode === 'query' ? 'projection' : 'interactive_control',
  capabilities: mode === 'query' ? ['observe'] : ['control'],
  schema: null,
  effect: 'unified surface discovery and dispatch',
  description: 'Additive adapter over existing Baton surface authorities',
  notification: key === 'surface.snapshot',
  handler: key,
  hostLocal: false,
  operatorFacing: true,
  remotePosture: 'operator',
  parityRequired: true,
  invocation: { meta: true },
  surfaces: {
    cli: { declared: true, direct: true, generic: true, via: ['direct'], reachable: true },
    mcp: { declared: true, direct: true, generic: true, via: ['direct'], reachable: true },
    web: { declared: false, direct: false, reachable: false },
    embedded: { declared: true, direct: true, reachable: true },
  },
})));

const APPLICATION_ROWS = Object.freeze(APPLICATION_UNIFIED_COMMAND_REGISTRY.rows().map(applicationRow));
const NATIVE_MCP_ROWS = Object.freeze(combinedMcpNames
  .filter((name) => !resolvesApplicationTool(name))
  .map(nativeMcpRow));
const NATIVE_CLI_ROWS = Object.freeze((nativeManifest.cliNative ?? []).map(nativeCliRow));
const ALL_ROWS = Object.freeze([...APPLICATION_ROWS, ...NATIVE_MCP_ROWS, ...NATIVE_CLI_ROWS, ...META_ROWS]);

function namesFor(row) {
  return unique([
    row.id,
    row.key,
    ...Object.values(row.names ?? {}).filter((value) => typeof value === 'string'),
    ...Object.values(row.aliases ?? {}).flat().filter((value) => typeof value === 'string'),
  ]);
}

const INDEX = new Map();
const CONFLICTS = new Map();
for (const row of ALL_ROWS) {
  for (const name of namesFor(row)) {
    const prior = INDEX.get(name);
    if (prior && prior.id !== row.id) {
      CONFLICTS.set(name, unique([prior.id, row.id, ...(CONFLICTS.get(name) ?? [])]));
      INDEX.delete(name);
    } else if (!CONFLICTS.has(name)) {
      INDEX.set(name, row);
    }
  }
}

export function unifiedCapabilityCatalog({ category = null, surface = null, mode = null, owner = null } = {}) {
  if (category !== null && !UNIFIED_SURFACE_CATEGORIES.includes(category)) {
    throw new BatonControlError('surface_category_invalid', `unknown surface category ${category}`, { field: 'category' });
  }
  if (surface !== null && !['cli', 'mcp', 'web', 'embedded'].includes(surface)) {
    throw new BatonControlError('surface_name_invalid', `unknown surface ${surface}`, { field: 'surface' });
  }
  if (mode !== null && !['query', 'effect'].includes(mode)) {
    throw new BatonControlError('surface_mode_invalid', `unknown surface mode ${mode}`, { field: 'mode' });
  }
  return Object.freeze(ALL_ROWS.filter((row) => (
    (category === null || row.categories.includes(category))
    && (surface === null || row.surfaces[surface]?.reachable === true)
    && (mode === null || row.mode === mode)
    && (owner === null || row.owner === owner)
  )).map(clone));
}

export function resolveUnifiedCapability(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 512) {
    throw new BatonControlError('surface_capability_invalid', 'capability name must be a bounded string', { field: 'name' });
  }
  const conflicts = CONFLICTS.get(name);
  if (conflicts) {
    throw new BatonControlError('surface_capability_ambiguous', `${name} resolves to multiple capabilities`, {
      field: 'name', detail: { owners: conflicts },
    });
  }
  const row = INDEX.get(name);
  if (!row) throw new BatonControlError('surface_capability_unknown', `unknown capability ${name}`, { field: 'name' });
  return clone(row);
}

export function prepareApplicationSurfaceInvocation(row, args = {}, { surface = 'mcp' } = {}) {
  if (row?.kind !== 'application_operation') {
    throw new BatonControlError('surface_capability_not_application', `${row?.id ?? 'capability'} is not an application operation`);
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new BatonControlError('surface_arguments_invalid', 'surface invocation args must be an object', { field: 'args' });
  }
  const action = row.invocation?.[`${surface}Action`] ?? null;
  const direct = row.surfaces?.[surface]?.direct === true;
  if (action && Object.hasOwn(args, 'actionId')) {
    const { actionId, runId, ...inputs } = args;
    if (typeof runId !== 'string' || runId.length === 0 || typeof actionId !== 'string' || actionId.length === 0) {
      throw new BatonControlError('surface_action_coordinates_invalid', 'runId and actionId are required for run.do fallback');
    }
    return freeze({ command: 'run.act', args: { runId, actionId, inputs }, path: 'run.do', action: action.kind });
  }
  if (action && !direct) {
    throw new BatonControlError(
      'surface_action_id_required',
      `${row.id} is authorized by the current Run action; pass its actionId`,
      { field: 'actionId', action: 'inspect_run_actions' },
    );
  }
  return freeze({
    command: row.invocation.applicationCommand,
    args: clone(args),
    path: direct ? 'direct_application_command' : 'application.command',
    action: null,
  });
}

export function assertUnifiedCapabilityCoverage() {
  const parityRows = ALL_ROWS.filter((row) => row.parityRequired);
  const missingCli = parityRows.filter((row) => row.surfaces.cli?.reachable !== true).map((row) => row.id);
  const missingMcp = parityRows.filter((row) => row.surfaces.mcp?.reachable !== true).map((row) => row.id);
  const uncategorized = ALL_ROWS.filter((row) => row.categories.length === 0).map((row) => row.id);
  const representedMcpNames = new Set(ALL_ROWS.flatMap((row) => [
    ...(row.surfaces?.mcp?.direct ? [row.key] : []),
    row.names?.mcp,
    ...(row.aliases?.mcp ?? []),
  ]).filter(Boolean));
  const knownAmbiguous = new Set(ambiguousLegacyAliases()
    .filter((row) => row.surface === 'mcp')
    .map((row) => row.name));
  const unrepresentedMcpTools = combinedMcpNames.filter((name) => (
    !representedMcpNames.has(name) && !knownAmbiguous.has(name)
  ));
  const categoryCoverage = Object.fromEntries(UNIFIED_SURFACE_CATEGORIES.map((category) => {
    const rows = ALL_ROWS.filter((row) => row.categories.includes(category));
    const operatorRows = rows.filter((row) => row.operatorFacing || row.kind === 'surface_meta');
    const cli = operatorRows.filter((row) => row.surfaces.cli?.reachable).length;
    const mcp = operatorRows.filter((row) => row.surfaces.mcp?.reachable).length;
    return [category, freeze({ total: rows.length, operator: operatorRows.length, cli, mcp })];
  }));
  const emptyCategories = Object.entries(categoryCoverage)
    .filter(([, counts]) => counts.operator > 0 && (counts.cli === 0 || counts.mcp === 0))
    .map(([category]) => category);
  const registryConflicts = ambiguousLegacyAliases();
  if (missingCli.length || missingMcp.length || uncategorized.length
    || unrepresentedMcpTools.length || emptyCategories.length) {
    throw new BatonControlError('surface_capability_coverage_incomplete', 'unified CLI/MCP capability coverage is incomplete', {
      detail: { missingCli, missingMcp, uncategorized, unrepresentedMcpTools, emptyCategories },
    });
  }
  return freeze({
    schemaVersion: 2,
    source: {
      applicationAuthorityDigest: APPLICATION_SEMANTIC_REGISTRY.authorityDigest,
      applicationPresentationDigest: APPLICATION_SEMANTIC_REGISTRY.presentationDigest,
      liveMcpToolCount: combinedMcpNames.length,
      liveMcpDispatchCount: dispatchMcpNames.size,
      liveWebCommandCount: webCommandNames.size,
      cliExceptionCount: cliExceptionKeys.size,
    },
    categories: categoryCoverage,
    totalCapabilities: ALL_ROWS.length,
    applicationOperations: APPLICATION_ROWS.length,
    operatorApplicationOperations: APPLICATION_ROWS.filter((row) => row.operatorFacing).length,
    embeddedOnlyApplicationOperations: APPLICATION_ROWS.filter((row) => !row.operatorFacing && !row.hostLocal).length,
    mcpNative: NATIVE_MCP_ROWS.length,
    cliNative: NATIVE_CLI_ROWS.length,
    metaOperations: META_ROWS.length,
    parityRequired: parityRows.length,
    missingCli,
    missingMcp,
    unrepresentedMcpTools,
    catalogConflicts: Object.fromEntries(CONFLICTS),
    registryAliasConflicts: registryConflicts,
    digest: digestValue(ALL_ROWS),
  });
}

export const UNIFIED_CAPABILITY_CATALOG_DIGEST = digestValue(ALL_ROWS);

const schema = (properties, required = []) => Object.freeze({
  type: 'object', properties, required, additionalProperties: false,
});

export const UNIFIED_MCP_META_TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'baton_surface_catalog',
    description: 'List the categorized Baton capability inventory derived from the existing application semantic registry and live MCP/Web/CLI transport inventories.',
    inputSchema: schema({
      category: { type: 'string', enum: UNIFIED_SURFACE_CATEGORIES },
      surface: { type: 'string', enum: ['cli', 'mcp', 'web', 'embedded'] },
      mode: { type: 'string', enum: ['query', 'effect'] },
      owner: { type: 'string', minLength: 1, maxLength: 256 },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }),
  Object.freeze({
    name: 'baton_surface_describe',
    description: 'Describe one canonical, legacy, native or meta capability including existing schema, authority, aliases, declaration and live reachability.',
    inputSchema: schema({ name: { type: 'string', minLength: 1, maxLength: 512 } }, ['name']),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }),
  Object.freeze({
    name: 'baton_surface_invoke',
    description: 'Invoke one operator-facing capability by canonical or transport name through its existing Baton application or MCP authority. Run actions require the current actionId.',
    inputSchema: schema({
      name: { type: 'string', minLength: 1, maxLength: 512 },
      args: { type: 'object' },
      idempotencyKey: { type: 'string', minLength: 1, maxLength: 256 },
    }, ['name', 'args']),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }),
  Object.freeze({
    name: 'baton_surface_snapshot',
    description: 'Read one bounded projection over existing readiness, workers, route capabilities, provider telemetry, convergence state and optional Run/Wave views.',
    inputSchema: schema({
      runId: { type: 'string', minLength: 1, maxLength: 256 },
      waveId: { type: 'string', minLength: 1, maxLength: 256 },
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }),
]);
