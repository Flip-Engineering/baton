import { CLI_WEB_COMMANDS } from './application-cli.mjs';
import { BatonControlError } from './holistic-runtime.mjs';
import {
  UNIFIED_MCP_META_TOOL_DEFINITIONS,
  unifiedCapabilityCatalog,
} from './surface-capability-catalog.mjs';
import { webAdmittedCommandNames } from './web-northbound.mjs';

const PRIORITY = Object.freeze({ alias: 1, transport: 2, canonical: 3 });
const LIVE_WEB_COMMANDS = new Set(webAdmittedCommandNames());
const clone = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const unique = (values) => [...new Set(values.filter(Boolean))].sort();
const schema = (properties, required = []) => Object.freeze({
  type: 'object', properties, required, additionalProperties: false,
});

export const UNIFIED_NOTIFICATION_WATCH_CAPABILITY = freeze({
  id: 'surface.watch',
  owner: 'surface-kernel',
  kind: 'surface_meta',
  key: 'surface.watch',
  names: { cli: 'baton surface watch', mcp: 'baton_surface_watch' },
  aliases: { cli: [], mcp: [], web: [], embedded: [] },
  categories: ['communication', 'notifications', 'observation', 'telemetry'],
  mode: 'query',
  lane: 'projection',
  capabilities: ['observe'],
  schema: schema({
    runId: { type: 'string', minLength: 1, maxLength: 256 },
    waveId: { type: 'string', minLength: 1, maxLength: 256 },
    afterCursor: { type: 'integer', minimum: 0 },
    attentionCursor: { type: 'integer', minimum: 0 },
    kind: { type: 'string', minLength: 1, maxLength: 256 },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 },
  }, ['runId']),
  effect: 'bounded unified notification watch over existing Run follow, attention, decision and Wave projections',
  description: 'Composes existing Baton notification and monitoring reads; it is not a second event store.',
  notification: true,
  handler: 'surface.watch',
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
});

export const UNIFIED_NOTIFICATION_WATCH_TOOL = Object.freeze({
  name: 'baton_surface_watch',
  description: 'Wait through the existing run.follow projection, then return a normalized page containing run attention, optional decision and Wave state without creating a second notification authority.',
  inputSchema: clone(UNIFIED_NOTIFICATION_WATCH_CAPABILITY.schema),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
});

export const COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS = Object.freeze([
  ...UNIFIED_MCP_META_TOOL_DEFINITIONS,
  UNIFIED_NOTIFICATION_WATCH_TOOL,
]);

function liveTransportSpellings(id) {
  return unique([id, typeof id === 'string' ? id.replaceAll('.', '_') : null]);
}

function enrichLiveApplicationTransport(row) {
  if (row?.kind !== 'mcp_native' || typeof row.id !== 'string') return row;
  const spellings = liveTransportSpellings(row.id);
  const cliDirect = CLI_WEB_COMMANDS.has(row.id);
  const webDirect = spellings.some((name) => LIVE_WEB_COMMANDS.has(name));
  if (!cliDirect && !webDirect) return row;

  // Some long-lived application commands predate the semantic-registry split and therefore appear
  // in the exhaustive MCP inventory as native rows. Their execution authority did not become MCP-
  // only: the actual CLI whitelist and Web admission table still serve them. Enrich the catalogue
  // from those live tables rather than adding exceptions or changing their established command ID.
  return freeze({
    ...clone(row),
    owner: 'application-transport',
    kind: 'application_transport',
    description: `Existing Baton application transport ${row.id}`,
    invocation: {
      ...(row.invocation ?? {}),
      applicationCommand: row.id,
    },
    surfaces: {
      ...clone(row.surfaces),
      cli: {
        ...(row.surfaces?.cli ?? {}),
        declared: cliDirect || row.surfaces?.cli?.declared === true,
        direct: cliDirect,
        generic: true,
        via: unique([
          ...(cliDirect ? ['direct'] : []),
          ...(webDirect ? ['authenticated_web'] : []),
          ...(row.surfaces?.cli?.via ?? []),
        ]),
        reachable: cliDirect || webDirect || row.surfaces?.cli?.reachable === true,
      },
      web: {
        declared: webDirect,
        direct: webDirect,
        reachable: webDirect,
      },
    },
  });
}

function matchesFilters(row, { category = null, surface = null, mode = null, owner = null } = {}) {
  return (category === null || row.categories.includes(category))
    && (surface === null || row.surfaces[surface]?.reachable === true)
    && (mode === null || row.mode === mode)
    && (owner === null || row.owner === owner);
}

export function completeUnifiedCapabilityCatalog(filters = {}) {
  const base = unifiedCapabilityCatalog().map(enrichLiveApplicationTransport);
  return Object.freeze([
    ...base,
    UNIFIED_NOTIFICATION_WATCH_CAPABILITY,
  ].filter((row) => matchesFilters(row, filters)).map(clone));
}

function claimsFor(row) {
  const claims = [];
  const push = (name, kind) => {
    if (typeof name !== 'string' || name.length === 0) return;
    claims.push({ name, row, kind, priority: PRIORITY[kind] });
  };
  push(row.id, 'canonical');
  push(row.key, 'canonical');
  for (const name of Object.values(row.names ?? {})) push(name, 'transport');
  for (const names of Object.values(row.aliases ?? {})) {
    for (const name of names ?? []) push(name, 'alias');
  }
  return claims;
}

function buildResolution() {
  const index = new Map();
  const shadowed = [];
  const unresolved = [];
  for (const row of completeUnifiedCapabilityCatalog()) {
    for (const claim of claimsFor(row)) {
      const prior = index.get(claim.name);
      if (!prior) {
        index.set(claim.name, claim);
        continue;
      }
      if (prior.row.id === claim.row.id) {
        if (claim.priority > prior.priority) index.set(claim.name, claim);
        continue;
      }
      if (claim.priority !== prior.priority) {
        const winner = claim.priority > prior.priority ? claim : prior;
        const loser = claim.priority > prior.priority ? prior : claim;
        index.set(claim.name, winner);
        shadowed.push(freeze({
          name: claim.name,
          owner: winner.row.id,
          ownerKind: winner.kind,
          shadowedOwner: loser.row.id,
          shadowedKind: loser.kind,
        }));
        continue;
      }
      index.delete(claim.name);
      unresolved.push(freeze({
        name: claim.name,
        owners: Object.freeze([prior.row.id, claim.row.id].sort()),
        kinds: Object.freeze([prior.kind, claim.kind].sort()),
      }));
    }
  }
  return freeze({ index, shadowed, unresolved });
}

const RESOLUTION = buildResolution();

export function resolveSurfaceCapability(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 512) {
    throw new BatonControlError('surface_capability_invalid', 'capability name must be a bounded string', { field: 'name' });
  }
  const unresolved = RESOLUTION.unresolved.find((row) => row.name === name);
  if (unresolved) {
    throw new BatonControlError('surface_capability_ambiguous', `${name} resolves to multiple equal-authority capabilities`, {
      field: 'name', detail: { owners: unresolved.owners },
    });
  }
  const claim = RESOLUTION.index.get(name);
  if (!claim) throw new BatonControlError('surface_capability_unknown', `unknown capability ${name}`, { field: 'name' });
  return clone(claim.row);
}

export function surfaceCapabilityNameAudit() {
  return freeze({
    schemaVersion: 1,
    names: RESOLUTION.index.size,
    shadowed: clone(RESOLUTION.shadowed),
    unresolved: clone(RESOLUTION.unresolved),
  });
}

export function assertSurfaceCapabilityNameClosure() {
  if (RESOLUTION.unresolved.length > 0) {
    throw new BatonControlError('surface_capability_name_conflict', 'capability names retain unresolved equal-authority owners', {
      detail: { conflicts: RESOLUTION.unresolved },
    });
  }
  return surfaceCapabilityNameAudit();
}
