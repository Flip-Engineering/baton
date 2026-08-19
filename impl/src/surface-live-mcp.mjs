import { BatonControlError } from './holistic-runtime.mjs';

const clone = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

function serverRows(servers) {
  return servers.filter(Boolean).flatMap((server) => (server.toolDefinitions ?? []).map((definition) => ({
    server,
    definition,
    profile: server.surface ?? 'combined',
  })));
}

export function liveMcpToolIndex(servers) {
  const index = new Map();
  for (const row of serverRows(servers)) {
    if (!row.definition || typeof row.definition.name !== 'string') continue;
    if (!index.has(row.definition.name)) index.set(row.definition.name, row);
  }
  return index;
}

export function capabilityMcpCandidateNames(capability) {
  return [...new Set([
    capability?.names?.mcp,
    capability?.key,
    ...(capability?.aliases?.mcp ?? []),
    capability?.invocation?.mcpTool,
  ].filter((value) => typeof value === 'string' && value.length > 0))];
}

export function projectLiveMcpCapability(capability, servers, { applicationAvailable = false } = {}) {
  if (!capability || typeof capability !== 'object') {
    throw new BatonControlError('surface_capability_invalid', 'capability projection requires a catalogue row');
  }
  const index = liveMcpToolIndex(servers);
  const matchedName = capabilityMcpCandidateNames(capability).find((name) => index.has(name)) ?? null;
  const match = matchedName === null ? null : index.get(matchedName);
  const applicationFallback = capability.kind === 'application_operation'
    && capability.operatorFacing === true
    && applicationAvailable;
  const meta = capability.kind === 'surface_meta';
  const available = match !== null || applicationFallback || meta;
  const source = match ? 'existing_mcp_tool_definition'
    : applicationFallback ? 'existing_application_command'
      : meta ? 'unified_meta_adapter' : 'not_available_in_profile';
  return freeze({
    ...clone(capability),
    liveMcp: {
      available,
      source,
      direct: match !== null,
      toolName: matchedName,
      profile: match?.profile ?? (applicationFallback ? 'application' : meta ? 'meta' : null),
      inputSchema: clone(match?.definition?.inputSchema ?? capability.schema ?? null),
      description: match?.definition?.description ?? capability.description ?? null,
      annotations: clone(match?.definition?.annotations ?? null),
    },
  });
}

export function projectLiveMcpCatalog(capabilities, servers, options = {}) {
  if (!Array.isArray(capabilities)) {
    throw new BatonControlError('surface_catalog_invalid', 'capability catalogue must be an array');
  }
  return Object.freeze(capabilities.map((capability) => (
    projectLiveMcpCapability(capability, servers, options)
  )));
}

export function assertLiveMcpProjection(capabilities, servers, { applicationAvailable = false } = {}) {
  const projected = projectLiveMcpCatalog(capabilities, servers, { applicationAvailable });
  const unavailableOperators = projected.filter((row) => row.operatorFacing === true
    && row.hostLocal !== true && row.liveMcp.available !== true);
  const promotedInternals = projected.filter((row) => row.operatorFacing !== true
    && row.kind === 'application_operation' && row.liveMcp.available === true);
  if (unavailableOperators.length > 0 || promotedInternals.length > 0) {
    throw new BatonControlError('surface_live_mcp_incomplete', 'configured MCP surface violates capability authority boundaries', {
      detail: {
        unavailableOperators: unavailableOperators.map((row) => row.id),
        promotedInternals: promotedInternals.map((row) => row.id),
      },
    });
  }
  return projected;
}
