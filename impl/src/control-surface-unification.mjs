import { APPLICATION_SEMANTIC_REGISTRY } from './application-semantics.mjs';
import { BatonControlError, digestValue } from './holistic-runtime.mjs';

const SURFACES = Object.freeze(['embedded', 'cli', 'mcp', 'web']);
const NOTIFICATION_KEYS = Object.freeze([
  'run.message.send',
  'run.message.receipt',
  'run.attention.watch',
  'run.answer',
  'run.send',
  'run.interrupt',
  'run.member.send',
  'run.watch',
].filter((key) => APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.some((operation) => operation.key === key)));
const ACTION_KINDS = new Set(Object.keys(APPLICATION_SEMANTIC_REGISTRY.actions));
const CLAIM_PRIORITY = Object.freeze({ legacy_alias: 1, transport: 2, canonical: 3 });

// This is a correction ledger over the existing registry, not a replacement registry. The stale
// alias row predates the REFLEX decision-list tool. The live McpFleetServer dispatch proves that
// baton_decision_list calls application.decisionList, while run.attention.list has its own
// canonical operation and remains reachable by canonical name/generic invocation.
export const SURFACE_ALIAS_CORRECTIONS = Object.freeze([
  Object.freeze({
    surface: 'mcp',
    name: 'baton_decision_list',
    canonical: 'decision.list',
    supersedes: 'run.attention.list',
    evidence: 'McpFleetServer baton_decision_list dispatches application.decisionList',
  }),
]);

function normalizeAliasSurface(surface) {
  if (surface === 'cli' || surface === 'web' || surface === 'embedded') return surface;
  if (surface === 'application.commands') return 'embedded';
  if (surface?.startsWith('mcp.')) return 'mcp';
  return null;
}

function correctedAliasCanonical(alias, surface) {
  const correction = SURFACE_ALIAS_CORRECTIONS.find((row) => (
    row.surface === surface && row.name === alias.name
  ));
  return correction?.canonical ?? alias.canonical;
}

function modeFor(operation) {
  return operation.effect === 'observe' || /(?:_read|_stream|deployment_read|help_read)$/u.test(operation.effect)
    ? 'query' : 'effect';
}

function laneFor(operation) {
  if (operation.emergency) return 'emergency_control';
  if (modeFor(operation) === 'query') return 'projection';
  if (/provider|action|answer|message|attention|decision|send|interrupt|approve|select|feedback/u.test(operation.effect)) {
    return 'interactive_control';
  }
  if (/reconcile|snapshot|cleanup|settle/u.test(operation.effect)) return 'background_reconcile';
  return 'lifecycle_effects';
}

function surfaceAliasesFor(operation, surface) {
  return APPLICATION_SEMANTIC_REGISTRY.surfaceAliases
    .filter((alias) => normalizeAliasSurface(alias.surface) === surface
      && correctedAliasCanonical(alias, surface) === operation.key)
    .map((alias) => alias.name);
}

function admissionFor(operation) {
  const action = ACTION_KINDS.has(operation.liveMethod) ? operation.liveMethod : null;
  return Object.freeze(Object.fromEntries(SURFACES.map((surface) => [surface, Object.freeze({
    // `declared` preserves the registry's reachability claim. A surface adapter may realize that
    // capability as a direct transport name, a legacy alias, or (for MCP action-backed verbs) the
    // generic run.do authorized-action dispatcher. The production surface census resolves which
    // concrete path exists; this registry does not invent standalone tools.
    declared: operation.surfaces.includes(surface),
    canonicalName: operation.names?.[surface] ?? null,
    aliases: Object.freeze([...new Set(surfaceAliasesFor(operation, surface))].sort()),
    ...(action ? { authorizedAction: Object.freeze({ kind: action, via: 'run.do' }) } : {}),
  })])));
}

function rowFor(operation) {
  const admission = admissionFor(operation);
  return Object.freeze({
    key: operation.key,
    names: operation.names,
    surfaces: operation.surfaces,
    aliases: Object.freeze(Object.fromEntries(SURFACES.map((surface) => [surface, admission[surface].aliases]))),
    admission,
    mode: modeFor(operation),
    lane: laneFor(operation),
    capabilities: operation.capabilities,
    schema: operation.inputSchema,
    profile: operation.profile,
    effect: operation.effect,
    idempotent: operation.idempotent,
    destructive: operation.destructive,
    reconcilable: operation.reconcilable,
    emergency: operation.emergency,
    authorityFields: operation.authorityFields,
    serverDerived: operation.serverDerived,
    transportHidden: operation.transportHidden,
    authority: operation.authority,
    handler: operation.liveMethod,
    notification: NOTIFICATION_KEYS.includes(operation.key),
  });
}

function indexSurface(rows, surface) {
  const index = new Map();
  const conflicts = [];
  const shadowed = [];
  const claim = (name, key, kind) => {
    if (typeof name !== 'string' || name.length === 0) return;
    const incoming = Object.freeze({ key, kind });
    const prior = index.get(name);
    if (!prior) {
      index.set(name, incoming);
      return;
    }
    if (prior.key === key) {
      if (CLAIM_PRIORITY[kind] > CLAIM_PRIORITY[prior.kind]) index.set(name, incoming);
      return;
    }
    const priorPriority = CLAIM_PRIORITY[prior.kind] ?? 0;
    const incomingPriority = CLAIM_PRIORITY[kind] ?? 0;
    if (incomingPriority !== priorPriority) {
      const winner = incomingPriority > priorPriority ? incoming : prior;
      const loser = incomingPriority > priorPriority ? prior : incoming;
      index.set(name, winner);
      shadowed.push(Object.freeze({
        surface, name, owner: winner.key, shadowedOwner: loser.key,
        ownerKind: winner.kind, shadowedKind: loser.kind,
      }));
      return;
    }
    conflicts.push(Object.freeze({
      surface,
      name,
      owners: Object.freeze([prior.key, key].sort()),
      kinds: Object.freeze([prior.kind, kind].sort()),
    }));
  };
  for (const row of rows.filter((candidate) => candidate.surfaces.includes(surface))) {
    claim(row.key, row.key, 'canonical');
    claim(row.names?.[surface], row.key, 'transport');
    for (const alias of row.aliases[surface]) claim(alias, row.key, 'legacy_alias');
  }
  return Object.freeze({
    index,
    conflicts: Object.freeze(conflicts),
    shadowed: Object.freeze(shadowed),
  });
}

export function buildApplicationUnifiedRegistry() {
  // Projection of Baton's existing semantic registry, never a replacement catalogue. Kernel,
  // advanced, compatibility and surface-specific operations retain their declared reachability,
  // authority and live method. Admission metadata records authorized-action fallback without
  // pretending those operations have direct tools on every surface.
  const rows = Object.freeze(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.map(rowFor));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const surfaceIndexes = Object.freeze(Object.fromEntries(SURFACES.map((surface) => [surface, indexSurface(rows, surface)])));
  const registry = {
    rows({ surface = null } = {}) {
      return surface === null ? rows : rows.filter((row) => row.surfaces.includes(surface));
    },
    inventory(surface) {
      if (!SURFACES.includes(surface)) throw new TypeError(`unsupported surface ${surface}`);
      return this.rows({ surface }).map((row) => Object.freeze({
        key: row.key,
        name: row.names?.[surface] ?? null,
        aliases: row.aliases[surface],
        admission: row.admission[surface],
        capabilities: row.capabilities,
        mode: row.mode,
        lane: row.lane,
        schema: row.schema,
        profile: row.profile,
        effect: row.effect,
        authorityFields: row.authorityFields,
        serverDerived: row.serverDerived,
        transportHidden: row.transportHidden,
        notification: row.notification,
      }));
    },
    resolve(name, { surface = null } = {}) {
      if (surface === null) {
        if (byKey.has(name)) return byKey.get(name);
        const owners = new Set();
        for (const candidateSurface of SURFACES) {
          const claimed = surfaceIndexes[candidateSurface].index.get(name);
          if (claimed) owners.add(claimed.key);
        }
        if (owners.size === 1) return byKey.get([...owners][0]);
        if (owners.size > 1) throw new BatonControlError('command_alias_ambiguous', `${name} resolves to multiple commands`, { detail: { owners: [...owners].sort() } });
        throw new BatonControlError('command_unknown', `unknown command ${name}`, { field: 'command' });
      }
      if (!SURFACES.includes(surface)) throw new TypeError(`unsupported surface ${surface}`);
      const claimed = surfaceIndexes[surface].index.get(name);
      if (!claimed) throw new BatonControlError('command_unknown', `unknown ${surface} command ${name}`, { field: 'command' });
      return byKey.get(claimed.key);
    },
    conflicts(surface = null) {
      if (surface !== null) return surfaceIndexes[surface]?.conflicts ?? [];
      return SURFACES.flatMap((candidate) => surfaceIndexes[candidate].conflicts);
    },
    shadowed(surface = null) {
      if (surface !== null) return surfaceIndexes[surface]?.shadowed ?? [];
      return SURFACES.flatMap((candidate) => surfaceIndexes[candidate].shadowed);
    },
    digest() {
      return digestValue({
        rows: rows.map((row) => ({
          key: row.key, names: row.names, surfaces: row.surfaces, aliases: row.aliases,
          admission: row.admission,
          capabilities: row.capabilities, schema: row.schema, profile: row.profile, effect: row.effect,
          authorityFields: row.authorityFields, serverDerived: row.serverDerived,
          transportHidden: row.transportHidden, handler: row.handler,
        })),
        aliasCorrections: SURFACE_ALIAS_CORRECTIONS,
      });
    },
  };
  return Object.freeze(registry);
}

export const APPLICATION_UNIFIED_COMMAND_REGISTRY = buildApplicationUnifiedRegistry();
export const APPLICATION_UNIFIED_REGISTRY_DIGEST = APPLICATION_UNIFIED_COMMAND_REGISTRY.digest();

export function unifiedSurfaceInventory(surface) {
  return APPLICATION_UNIFIED_COMMAND_REGISTRY.inventory(surface);
}

export function resolveUnifiedSurfaceCommand(surface, name) {
  return APPLICATION_UNIFIED_COMMAND_REGISTRY.resolve(name, { surface });
}

export function unifiedMcpCapabilities() {
  return Object.fromEntries(unifiedSurfaceInventory('mcp').flatMap((entry) => {
    const names = [entry.key, entry.name, ...entry.aliases].filter(Boolean);
    return names.map((name) => [name, entry.capabilities]);
  }));
}

export function unifiedCliCommands() {
  return new Set(unifiedSurfaceInventory('cli').map((entry) => entry.key));
}

export function unifiedNotificationInventory(surface) {
  return unifiedSurfaceInventory(surface).filter((entry) => entry.notification);
}

export function ambiguousLegacyAliases() {
  return APPLICATION_UNIFIED_COMMAND_REGISTRY.conflicts();
}

export function shadowedLegacyAliases() {
  return APPLICATION_UNIFIED_COMMAND_REGISTRY.shadowed();
}

function assertNoCapabilityDrop(surface) {
  const expected = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((operation) => operation.surfaces.includes(surface))
    .map((operation) => operation.key).sort();
  const projected = unifiedSurfaceInventory(surface).map((operation) => operation.key).sort();
  if (JSON.stringify(expected) !== JSON.stringify(projected)) {
    throw new BatonControlError('surface_capability_drop', `${surface} unified inventory dropped existing Baton operations`, {
      detail: {
        missing: expected.filter((key) => !projected.includes(key)),
        unexpected: projected.filter((key) => !expected.includes(key)),
      },
    });
  }
}

export function assertCliMcpControlParity() {
  // Parity means identical semantics for the shared canonical capability, not identical transport
  // topology. MCP-only kernel/advanced capability remains intact, and an authorized action reached
  // through run.do is not forced into a fake standalone tool merely to resemble the CLI.
  assertNoCapabilityDrop('cli');
  assertNoCapabilityDrop('mcp');
  const unresolvedAliases = ambiguousLegacyAliases();
  if (unresolvedAliases.length > 0) {
    throw new BatonControlError('surface_alias_conflict', 'surface aliases still have unresolved equal-authority owners', {
      detail: { conflicts: unresolvedAliases },
    });
  }
  const cli = new Map(unifiedSurfaceInventory('cli').map((entry) => [entry.key, entry]));
  const mcp = new Map(unifiedSurfaceInventory('mcp').map((entry) => [entry.key, entry]));
  const shared = [...cli.keys()].filter((key) => mcp.has(key)).sort();
  for (const key of shared) {
    const left = cli.get(key); const right = mcp.get(key);
    if (JSON.stringify(left.capabilities) !== JSON.stringify(right.capabilities)
      || left.mode !== right.mode || left.lane !== right.lane
      || JSON.stringify(left.schema) !== JSON.stringify(right.schema)
      || JSON.stringify(left.authorityFields) !== JSON.stringify(right.authorityFields)
      || JSON.stringify(left.serverDerived) !== JSON.stringify(right.serverDerived)
      || JSON.stringify(left.transportHidden) !== JSON.stringify(right.transportHidden)) {
      throw new BatonControlError('surface_registry_divergence', `CLI/MCP command contract diverged for ${key}`);
    }
  }
  const sharedNotifications = NOTIFICATION_KEYS.filter((key) => cli.has(key) && mcp.has(key));
  if (sharedNotifications.length === 0) {
    throw new BatonControlError('notification_surface_incomplete', 'CLI and MCP have no shared notification/control operations');
  }
  return Object.freeze({
    canonicalOperations: APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.length,
    sharedCommands: shared.length,
    cliCommands: cli.size,
    mcpCommands: mcp.size,
    mcpOnlyCommands: [...mcp.keys()].filter((key) => !cli.has(key)).sort(),
    cliOnlyCommands: [...cli.keys()].filter((key) => !mcp.has(key)).sort(),
    notificationCommands: sharedNotifications.length,
    notificationKeys: Object.freeze(sharedNotifications),
    aliasConflicts: unresolvedAliases,
    shadowedAliases: shadowedLegacyAliases(),
    aliasCorrections: SURFACE_ALIAS_CORRECTIONS,
    authorityDigest: APPLICATION_SEMANTIC_REGISTRY.authorityDigest,
    presentationDigest: APPLICATION_SEMANTIC_REGISTRY.presentationDigest,
    digest: APPLICATION_UNIFIED_REGISTRY_DIGEST,
  });
}

export function normalizeControlSurfaceError(error) {
  return BatonControlError.from(error).envelope();
}

export function notificationEnvelope({ subscriptionId, cursor, nextCursor, events }) {
  return Object.freeze({
    schemaVersion: 1,
    kind: 'baton.notifications.page',
    subscriptionId,
    cursor,
    nextCursor,
    events: Object.freeze(events.map((event) => Object.freeze({
      seq: event.seq,
      eventId: event.eventId,
      type: event.type,
      data: event.data,
    }))),
  });
}

export function transportNameFor(surface, key) {
  const row = APPLICATION_UNIFIED_COMMAND_REGISTRY.resolve(key);
  if (!row.surfaces.includes(surface)) throw new BatonControlError('surface_unsupported', `${key} is not available on ${surface}`);
  return row.names?.[surface] ?? null;
}
