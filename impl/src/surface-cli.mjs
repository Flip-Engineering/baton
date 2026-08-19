import { randomUUID } from 'node:crypto';

import { BatonControlError } from './holistic-runtime.mjs';
import {
  UNIFIED_SURFACE_CATEGORIES,
  assertUnifiedCapabilityCoverage,
} from './surface-capability-catalog.mjs';
import {
  assertSurfaceCapabilityNameClosure,
  completeUnifiedCapabilityCatalog,
  resolveSurfaceCapability,
} from './surface-capability-resolution.mjs';

function fail(code, message, field = null) {
  throw new BatonControlError(code, message, { field });
}

function take(args, flag, { required = false } = {}) {
  const index = args.indexOf(flag);
  if (index < 0) {
    if (required) fail('cli_invalid', `${flag} is required`, flag.slice(2));
    return null;
  }
  if (index === args.length - 1 || args[index + 1].startsWith('--')) {
    fail('cli_invalid', `${flag} requires a value`, flag.slice(2));
  }
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function noRemainder(args) {
  if (args.length > 0) fail('cli_invalid', `unexpected argument ${args[0]}`);
}

function jsonObject(value, flag) {
  let parsed;
  try { parsed = JSON.parse(value); }
  catch { fail('cli_invalid', `${flag} must be valid JSON`, flag.slice(2)); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('cli_invalid', `${flag} must be a JSON object`, flag.slice(2));
  }
  return parsed;
}

function boundedId(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/u.test(value)) {
    fail('cli_invalid', `${field} is invalid`, field);
  }
  return value;
}

function integer(value, field, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail('cli_invalid', `${field} must be an integer between ${minimum} and ${maximum}`, field);
  }
  return parsed;
}

export const UNIFIED_SURFACE_CLI_HELP = `baton surface — complete CLI/MCP capability discovery and dispatch

Usage:
  baton surface catalog [--category CATEGORY] [--surface cli|mcp|web|embedded] [--mode query|effect] [--owner OWNER] [--mcp-config PATH]
  baton surface describe NAME [--mcp-config PATH]
  baton surface invoke NAME --args JSON [--idempotency-key KEY] [--mcp-config PATH]
  baton surface snapshot [--run-id RUN] [--wave-id WAVE] [--mcp-config PATH]
  baton surface watch RUN_ID [--wave-id WAVE] [--after-cursor N] [--attention-cursor N] [--kind KIND] [--timeout MS] [--mcp-config PATH]

Categories:
  ${UNIFIED_SURFACE_CATEGORIES.join(', ')}

Authority:
  Local catalog/describe derives from Baton's application registry and exported live transport
  inventories. Supplying --mcp-config (or BATON_MCP_CONFIG) asks the configured existing MCP
  server for its exact profile-specific catalogue and schemas. Application effects use the
  authenticated resident Web command plane only when that command is actually admitted there.
  MCP-native and MCP-only operations use the configured MCP authority. Action-dispatched
  operations require actionId and lower through the current Run's authorized run.do action.
  surface watch composes the existing run.follow, attention, decision, and optional Wave progress
  projections; it does not create a second notification bus or bypass their authorization.
  Embedded-only worker/kernel capabilities are visible in catalog/describe but are not promoted
  into operator authority by surface invoke.
`;

export function parseUnifiedSurfaceCli(argv) {
  if (!Array.isArray(argv) || argv[0] !== 'surface') return null;
  const args = argv.slice(1);
  const action = args.shift() ?? 'help';
  if (action === 'help' || action === '--help' || action === '-h') {
    noRemainder(args);
    return Object.freeze({ kind: 'surface_help' });
  }
  if (action === 'catalog' || action === 'list') {
    const category = take(args, '--category');
    const surface = take(args, '--surface');
    const mode = take(args, '--mode');
    const owner = take(args, '--owner');
    const mcpConfig = take(args, '--mcp-config');
    noRemainder(args);
    return Object.freeze({
      kind: 'surface_catalog', filters: { category, surface, mode, owner }, mcpConfig,
    });
  }
  if (action === 'describe') {
    const name = args.shift();
    if (!name) fail('cli_invalid', 'surface describe requires NAME', 'name');
    const mcpConfig = take(args, '--mcp-config');
    noRemainder(args);
    return Object.freeze({ kind: 'surface_describe', name, mcpConfig });
  }
  if (action === 'invoke') {
    const name = args.shift();
    if (!name) fail('cli_invalid', 'surface invoke requires NAME', 'name');
    const rawArgs = take(args, '--args', { required: true });
    const idempotencyKey = take(args, '--idempotency-key') ?? `cli.surface:${randomUUID()}`;
    const mcpConfig = take(args, '--mcp-config');
    noRemainder(args);
    return Object.freeze({
      kind: 'surface_invoke', name, args: jsonObject(rawArgs, '--args'), idempotencyKey, mcpConfig,
    });
  }
  if (action === 'snapshot' || action === 'status') {
    const runId = take(args, '--run-id');
    const waveId = take(args, '--wave-id');
    const mcpConfig = take(args, '--mcp-config');
    noRemainder(args);
    return Object.freeze({ kind: 'surface_snapshot', runId, waveId, mcpConfig });
  }
  if (action === 'watch') {
    const runId = boundedId(args.shift(), 'runId');
    const waveIdRaw = take(args, '--wave-id');
    const afterCursor = integer(take(args, '--after-cursor'), 'afterCursor');
    const attentionCursor = integer(take(args, '--attention-cursor'), 'attentionCursor');
    const kindRaw = take(args, '--kind');
    const timeoutMs = integer(take(args, '--timeout'), 'timeoutMs', { minimum: 1, maximum: 30_000 });
    const mcpConfig = take(args, '--mcp-config');
    noRemainder(args);
    return Object.freeze({
      kind: 'surface_watch',
      runId,
      waveId: waveIdRaw === null ? null : boundedId(waveIdRaw, 'waveId'),
      afterCursor,
      attentionCursor,
      attentionKind: kindRaw === null ? null : boundedId(kindRaw, 'kind'),
      timeoutMs,
      mcpConfig,
    });
  }
  fail('cli_command_unavailable', `unknown surface command ${action}; expected catalog, describe, invoke, snapshot, watch, or help`);
}

export async function executeUnifiedSurfaceCli(parsed, { client = null, mcpCall = null } = {}) {
  if (!parsed || typeof parsed !== 'object') fail('cli_invalid', 'surface command is required');
  if (parsed.kind === 'surface_help') return { schemaVersion: 1, help: UNIFIED_SURFACE_CLI_HELP };
  if (parsed.kind === 'surface_catalog') {
    if (parsed.mcpConfig !== null) {
      if (typeof mcpCall !== 'function') fail('cli_config_invalid', 'MCP surface catalogue is unavailable');
      return mcpCall(parsed.mcpConfig, 'baton_surface_catalog', Object.fromEntries(
        Object.entries(parsed.filters).filter(([, value]) => value !== null),
      ));
    }
    const coverage = assertUnifiedCapabilityCoverage();
    return Object.freeze({
      schemaVersion: 2,
      source: 'local_existing_inventory',
      coverage,
      nameClosure: assertSurfaceCapabilityNameClosure(),
      capabilities: completeUnifiedCapabilityCatalog(parsed.filters),
    });
  }
  if (parsed.kind === 'surface_describe') {
    if (parsed.mcpConfig !== null) {
      if (typeof mcpCall !== 'function') fail('cli_config_invalid', 'MCP surface description is unavailable');
      return mcpCall(parsed.mcpConfig, 'baton_surface_describe', { name: parsed.name });
    }
    return Object.freeze({
      schemaVersion: 2, source: 'local_existing_inventory',
      capability: resolveSurfaceCapability(parsed.name),
    });
  }
  if (parsed.kind === 'surface_invoke') {
    const capability = resolveSurfaceCapability(parsed.name);
    if (capability.kind === 'application_operation' && capability.operatorFacing !== true) {
      fail(
        'surface_embedded_only',
        `${capability.id} retains ${capability.remotePosture} authority and is not an operator command`,
      );
    }
    if (parsed.mcpConfig !== null) {
      if (typeof mcpCall !== 'function') fail('cli_config_invalid', 'MCP surface invocation is unavailable');
      return mcpCall(parsed.mcpConfig, 'baton_surface_invoke', {
        name: parsed.name, args: parsed.args, idempotencyKey: parsed.idempotencyKey,
      });
    }
    const webOrCliPath = capability.surfaces?.web?.reachable === true
      || capability.surfaces?.cli?.direct === true
      || Boolean(capability.invocation?.cliAction);
    if (!webOrCliPath) {
      fail('surface_mcp_config_required', `${capability.id} requires the configured MCP authority; pass --mcp-config PATH`, 'mcpConfig');
    }
    if (capability.hostLocal) {
      fail('surface_host_command_required', `${capability.id} is host-local; use ${capability.names.cli ?? 'its direct CLI command'}`);
    }
    if (!client || typeof client.surfaceInvoke !== 'function') {
      fail('cli_config_invalid', 'authenticated Baton client is unavailable');
    }
    return client.surfaceInvoke(parsed.name, parsed.args, parsed.idempotencyKey);
  }
  if (parsed.kind === 'surface_snapshot') {
    if (parsed.mcpConfig !== null) {
      if (typeof mcpCall !== 'function') fail('cli_config_invalid', 'MCP surface snapshot is unavailable');
      return mcpCall(parsed.mcpConfig, 'baton_surface_snapshot', {
        ...(parsed.runId ? { runId: parsed.runId } : {}),
        ...(parsed.waveId ? { waveId: parsed.waveId } : {}),
      });
    }
    if (!client || typeof client.surfaceSnapshot !== 'function') {
      fail('cli_config_invalid', 'authenticated Baton client is unavailable');
    }
    return client.surfaceSnapshot({ runId: parsed.runId, waveId: parsed.waveId });
  }
  if (parsed.kind === 'surface_watch') {
    const args = {
      runId: parsed.runId,
      ...(parsed.waveId === null ? {} : { waveId: parsed.waveId }),
      ...(parsed.afterCursor === null ? {} : { afterCursor: parsed.afterCursor }),
      ...(parsed.attentionCursor === null ? {} : { attentionCursor: parsed.attentionCursor }),
      ...(parsed.attentionKind === null ? {} : { kind: parsed.attentionKind }),
      ...(parsed.timeoutMs === null ? {} : { timeoutMs: parsed.timeoutMs }),
    };
    if (parsed.mcpConfig !== null) {
      if (typeof mcpCall !== 'function') fail('cli_config_invalid', 'MCP surface watch is unavailable');
      return mcpCall(parsed.mcpConfig, 'baton_surface_watch', args);
    }
    if (!client || typeof client.surfaceWatch !== 'function') {
      fail('cli_config_invalid', 'authenticated Baton notification watch is unavailable');
    }
    return client.surfaceWatch(args);
  }
  fail('cli_command_unavailable', `unsupported surface command ${parsed.kind}`);
}
