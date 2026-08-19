import { randomUUID } from 'node:crypto';

import { resolveUnifiedSurfaceCommand } from './control-surface-unification.mjs';
import { BatonControlError, digestValue } from './holistic-runtime.mjs';
import { ProductionConvergenceRuntime } from './production-convergence.mjs';
import {
  assertUnifiedCapabilityCoverage,
  prepareApplicationSurfaceInvocation,
} from './surface-capability-catalog.mjs';
import {
  COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS,
  assertSurfaceCapabilityNameClosure,
  completeUnifiedCapabilityCatalog,
  resolveSurfaceCapability,
} from './surface-capability-resolution.mjs';
import {
  projectLiveMcpCapability,
  projectLiveMcpCatalog,
} from './surface-live-mcp.mjs';
import {
  auditMcpMetaCompletion,
  auditMcpMetaFailure,
  authorizeMcpMetaRead,
  takeMcpMetaQuota,
} from './surface-mcp-authority.mjs';

const NATIVE_QUERY_TOOLS = new Set([
  'fleet_wait', 'fleet_result', 'fleet_list', 'fleet_capabilities', 'fleet_provider_status',
  'fleet_goal_plan_status', 'baton_decision_list', 'baton_deployment_doctor',
]);
const NATIVE_EMERGENCY_TOOLS = new Set([
  'fleet_kill', 'fleet_drain', 'baton_waves_stop', 'baton_workstream_stop',
]);
const QUERY_NAME = /(?:_read|_list|_view|_status|_progress|_compile|_receipt|_watch|_recall|_horizon|_cite|_result|_capabilities|_wait)$/u;
const MUTATION_NAME = /(?:_post|_close|_drop|_reorder|_retitle|_promote|_admit|_attach|_elevate|_settle|_seed|_append)$/u;
const META_NAMES = new Set(COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS.map((tool) => tool.name));

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => value == null ? value : structuredClone(value);
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value);

function definitionFor(tool) {
  if (typeof tool !== 'string' || tool.length === 0) return null;
  try {
    const row = resolveUnifiedSurfaceCommand('mcp', tool);
    const forcedEffect = MUTATION_NAME.test(tool);
    return Object.freeze({
      key: row.key,
      mode: forcedEffect ? 'effect' : row.mode,
      lane: forcedEffect && row.lane === 'projection' ? 'interactive_control' : row.lane,
    });
  } catch (error) {
    if (error?.code !== 'command_unknown') throw error;
  }
  if (!tool.startsWith('fleet_') && !tool.startsWith('baton_')) return null;
  if (NATIVE_QUERY_TOOLS.has(tool) || QUERY_NAME.test(tool)) {
    return Object.freeze({ key: tool, mode: 'query', lane: 'projection' });
  }
  return Object.freeze({
    key: tool,
    mode: 'effect',
    lane: NATIVE_EMERGENCY_TOOLS.has(tool) ? 'emergency_control' : 'interactive_control',
  });
}

function responseFailure(response) {
  if (response?.error) return response.error;
  if (response?.result?.isError === true) {
    return response.result.structuredContent?.error
      ?? response.result.structuredContent
      ?? { code: 'mcp_tool_error', message: 'MCP tool returned an error result' };
  }
  return null;
}

function toolResult(id, value) {
  return {
    jsonrpc: '2.0', id,
    result: {
      structuredContent: value,
      content: [{ type: 'text', text: JSON.stringify(value) }],
    },
  };
}

function toolErrorResponse(message, error) {
  const envelope = BatonControlError.from(error).envelope().error;
  return {
    jsonrpc: '2.0', id: message?.id ?? null,
    result: {
      isError: true,
      structuredContent: { error: envelope },
      content: [{ type: 'text', text: JSON.stringify({ error: envelope }) }],
    },
  };
}

function closedArgs(message, allowed, required = []) {
  const args = message?.params?.arguments ?? {};
  if (!record(args)) throw new BatonControlError('surface_arguments_invalid', 'surface arguments must be an object');
  const unknown = Object.keys(args).find((key) => !allowed.includes(key));
  if (unknown) throw new BatonControlError('surface_argument_unknown', `unknown surface argument ${unknown}`, { field: unknown });
  const missing = required.find((key) => !Object.hasOwn(args, key));
  if (missing) throw new BatonControlError('surface_argument_required', `surface argument ${missing} is required`, { field: missing });
  return args;
}

function attentionCursorGuard(tool, message, response) {
  if (tool !== 'baton_run_attention_watch' && tool !== 'run.attention.watch') return response;
  const requested = message?.params?.arguments?.cursor;
  const page = response?.result?.structuredContent;
  if (!Number.isSafeInteger(requested) || requested <= 0 || !page || response?.result?.isError === true) return response;
  if (Number.isSafeInteger(page.throughCursor) && page.throughCursor < requested) {
    return toolErrorResponse(message, new BatonControlError(
      'attention_scope_forbidden',
      'attention watch could not preserve the authorized cursor; refusing silent empty fallback',
      { detail: { requestedCursor: requested, throughCursor: page.throughCursor } },
    ));
  }
  return response;
}

async function authorizeRunScopedQuery(target, tool, message) {
  if (!['baton_repl_cite', 'repl.cite'].includes(tool)) return null;
  const runId = message?.params?.arguments?.runId;
  if (!runId || typeof target.application?.authorizeReplay !== 'function') return null;
  const principal = target.principal ?? {};
  try {
    await target.application.authorizeReplay('run.inspect', { runId, depth: 'outline' }, {
      actor: `mcp:${principal.userId ?? 'unknown'}:${principal.sessionId ?? 'unknown'}`,
      principalId: principal.userId,
      sessionId: principal.sessionId,
    }, { transport: 'mcp', requestId: String(message?.id ?? 'repl-cite-authority') });
    return null;
  } catch (error) {
    return toolErrorResponse(message, error);
  }
}

async function admitAndDispatch(runtime, definition, message, dispatch) {
  const commandId = typeof message?.id === 'string' || Number.isSafeInteger(message?.id)
    ? `mcp:${String(message.id)}` : `mcp:${randomUUID()}`;
  const args = message?.params?.arguments ?? {};
  const admitted = runtime.journal.append('command.admitted', {
    commandId, command: definition.key, args, principalId: 'mcp-transport', transport: 'mcp',
  });
  return runtime.scheduler.enqueue(definition.lane, async () => {
    runtime.journal.assertExternalAwaitAllowed();
    runtime.journal.append('effect.requested', {
      commandId, command: definition.key, admittedSeq: admitted.seq, transport: 'mcp',
    });
    try {
      const response = await dispatch();
      const failure = responseFailure(response);
      runtime.journal.append(failure ? 'effect.failed' : 'effect.succeeded', failure
        ? { commandId, command: definition.key, transport: 'mcp', error: failure }
        : { commandId, command: definition.key, transport: 'mcp', resultDigest: digestValue(response ?? null) });
      return response;
    } catch (error) {
      runtime.journal.append('effect.failed', {
        commandId, command: definition.key, transport: 'mcp',
        error: BatonControlError.from(error).envelope().error,
      });
      throw error;
    }
  }, { commandId, command: definition.key, transport: 'mcp' });
}

function applicationContext(target, message, args) {
  const principal = target.principal ?? {};
  const base = {
    transport: 'mcp',
    requestId: String(message?.id ?? randomUUID()),
    idempotencyKey: args.idempotencyKey ?? `mcp.surface:${message?.id ?? randomUUID()}`,
    capabilities: Array.isArray(principal.capabilities) ? [...principal.capabilities] : [],
  };
  if (typeof target._applicationDispatchContext === 'function') {
    try { return { ...target._applicationDispatchContext(args, message?.id ?? randomUUID(), principal), ...base }; }
    catch { /* keep the explicit bounded context above */ }
  }
  return base;
}

function actorContext(target) {
  const principal = target.principal ?? {};
  return {
    actor: `mcp:${principal.userId ?? 'unknown'}:${principal.sessionId ?? 'unknown'}`,
    principalId: principal.userId,
    sessionId: principal.sessionId,
  };
}

function toolCandidateNames(capability) {
  return [...new Set([
    capability.names?.mcp,
    capability.key,
    ...(capability.aliases?.mcp ?? []),
    capability.invocation?.mcpTool,
  ].filter(Boolean))];
}

function definitionByName(server, name) {
  return (server.toolDefinitions ?? []).find((tool) => tool.name === name) ?? null;
}

function completeToolArguments(server, name, supplied, idempotencyKey) {
  const args = { ...supplied };
  const definition = definitionByName(server, name);
  const properties = definition?.inputSchema?.properties ?? {};
  const [repoId] = server.repoIds ?? [];
  if (Object.hasOwn(properties, 'repoId') && !Object.hasOwn(args, 'repoId') && repoId) args.repoId = repoId;
  if (Object.hasOwn(properties, 'idempotencyKey') && !Object.hasOwn(args, 'idempotencyKey')) {
    args.idempotencyKey = idempotencyKey;
  }
  return args;
}

async function createAdvancedShadow(target) {
  const Shadow = target.constructor;
  if (typeof Shadow !== 'function') return null;
  try {
    const shadow = new Shadow({
      coordinator: target.coordinator,
      coordination: target.coordination,
      principal: target.principal,
      repoIds: [...(target.repoIds ?? [])],
      surface: 'advanced',
      application: null,
      applicationOwned: false,
      isPrincipalActive: target.isPrincipalActive,
      takeToolQuota: target.takeToolQuota,
      now: target.now,
      maxWaitMs: target.maxWaitMs,
      maxMessageBytes: target.maxMessageBytes,
      maxObservationAudits: target.maxObservationAudits,
    });
    shadow.lifecycle = 'ready';
    return shadow;
  } catch {
    return null;
  }
}

async function surfaceSnapshot(target, runtime, args) {
  const principal = actorContext(target);
  const appContext = applicationContext(target, { id: 'surface-snapshot' }, args);
  const safe = async (fn) => {
    try { return { ok: true, value: clone(await fn()) }; }
    catch (error) { return { ok: false, error: BatonControlError.from(error).envelope().error }; }
  };
  const snapshot = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    coverage: assertUnifiedCapabilityCoverage(),
    nameClosure: assertSurfaceCapabilityNameClosure(),
    convergence: runtime.audit(),
    applicationCard: await safe(() => target.application?.card?.() ?? null),
    readiness: await safe(() => target.application?.command?.('deployment.doctor', {}, principal, appContext)
      ?? target.application?.doctorReadiness?.() ?? null),
    workers: await safe(() => target.coordinator?.list?.() ?? []),
    routeCapabilities: await safe(() => target.coordinator?.capabilityCards?.() ?? []),
    providerTelemetry: await safe(() => target.coordinator?.readProviderStatus?.({}, {
      repoId: [...(target.repoIds ?? [])][0] ?? null,
    }) ?? null),
  };
  if (args.runId) {
    snapshot.run = await safe(() => target.application.command(
      'run.inspect', { runId: args.runId, depth: 'outline' }, principal, appContext,
    ));
  }
  if (args.waveId) {
    snapshot.wave = await safe(() => target.application.command(
      'waves.progress', { waveId: args.waveId }, principal, appContext,
    ));
  }
  return Object.freeze(snapshot);
}

function validateWatchArgs(args, target) {
  if (!safeId(args.runId)) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch requires a valid runId', { field: 'runId' });
  }
  if (args.waveId !== undefined && !safeId(args.waveId)) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch waveId is invalid', { field: 'waveId' });
  }
  for (const field of ['afterCursor', 'attentionCursor']) {
    if (args[field] !== undefined && (!Number.isSafeInteger(args[field]) || args[field] < 0)) {
      throw new BatonControlError('surface_watch_invalid', `${field} must be a non-negative safe integer`, { field });
    }
  }
  if (args.kind !== undefined && !safeId(args.kind)) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch kind is invalid', { field: 'kind' });
  }
  const maximum = Math.min(30_000, Number.isSafeInteger(target.maxWaitMs) ? target.maxWaitMs : 30_000);
  const timeoutMs = args.timeoutMs ?? maximum;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maximum) {
    throw new BatonControlError('surface_watch_invalid', `timeoutMs must be between 1 and ${maximum}`, {
      field: 'timeoutMs', detail: { maximum },
    });
  }
  return Object.freeze({
    runId: args.runId,
    waveId: args.waveId ?? null,
    afterCursor: args.afterCursor ?? 0,
    attentionCursor: args.attentionCursor ?? 0,
    kind: args.kind ?? null,
    timeoutMs,
  });
}

async function surfaceWatch(target, runtime, input, message) {
  if (typeof target.application?.command !== 'function') {
    throw new BatonControlError('surface_profile_restricted', 'surface watch requires the existing application facade');
  }
  const args = validateWatchArgs(input, target);
  const principal = actorContext(target);
  const context = applicationContext(target, message, input);
  const follow = await target.application.command('run.follow', {
    runId: args.runId,
    afterCursor: args.afterCursor,
    timeoutMs: args.timeoutMs,
  }, principal, context);
  const attention = await target.application.command('run.attention.watch', {
    runId: args.runId,
    cursor: args.attentionCursor,
    ...(args.kind === null ? {} : { kind: args.kind }),
  }, principal, context);
  if (Number.isSafeInteger(attention?.throughCursor)
    && attention.throughCursor < args.attentionCursor) {
    throw new BatonControlError(
      'attention_scope_forbidden',
      'attention watch could not preserve the authorized cursor; refusing silent empty fallback',
      { detail: { requestedCursor: args.attentionCursor, throughCursor: attention.throughCursor } },
    );
  }
  const decisions = typeof target.application.decisionList === 'function'
    ? await target.application.decisionList({ runId: args.runId }, principal, context)
    : Object.freeze({ available: false, reason: 'decision_list_not_available_in_profile' });
  const wave = args.waveId === null ? null : await target.application.command(
    'waves.progress', { waveId: args.waveId }, principal, context,
  );
  return Object.freeze({
    schemaVersion: 1,
    kind: 'baton.surface_watch',
    runId: args.runId,
    waveId: args.waveId,
    afterCursor: args.afterCursor,
    attentionCursor: args.attentionCursor,
    nextAfterCursor: Number.isSafeInteger(follow?.cursor)
      ? follow.cursor : Number.isSafeInteger(follow?.throughCursor) ? follow.throughCursor : args.afterCursor,
    nextAttentionCursor: Number.isSafeInteger(attention?.throughCursor)
      ? attention.throughCursor : args.attentionCursor,
    follow: clone(follow),
    attention: clone(attention),
    decisions: clone(decisions),
    wave: clone(wave),
    convergence: runtime.audit(),
  });
}

function augmentInstructions(response) {
  if (!response?.result || typeof response.result.instructions !== 'string') return response;
  const suffix = ' Unified surface tools project Baton\'s existing control, observation, telemetry, communication, task management, knowledge, diagnostics/environment awareness, and notification authorities; use baton_surface_catalog for profile-specific availability and baton_surface_watch for the composed existing notification loop.';
  return { ...response, result: { ...response.result, instructions: `${response.result.instructions}${suffix}` } };
}

function augmentTools(response, tools) {
  if (!Array.isArray(response?.result?.tools)) return response;
  const byName = new Map(response.result.tools.map((tool) => [tool.name, tool]));
  for (const tool of tools) if (!byName.has(tool.name)) byName.set(tool.name, tool);
  return { ...response, result: { ...response.result, tools: [...byName.values()] } };
}

async function invokeCapability(target, shadow, capability, args, idempotencyKey, message) {
  if (capability.kind === 'cli_native' || capability.hostLocal === true) {
    throw new BatonControlError('surface_host_command_required', `${capability.id} is a host-local CLI capability`);
  }
  if (capability.kind === 'surface_meta') {
    throw new BatonControlError('surface_meta_direct_required', `${capability.id} must be called through its direct meta tool`);
  }
  if (capability.kind === 'application_operation' && capability.operatorFacing !== true) {
    throw new BatonControlError(
      'surface_embedded_only',
      `${capability.id} retains ${capability.remotePosture} authority and is not an operator command`,
    );
  }

  const candidates = toolCandidateNames(capability);
  for (const server of [target, shadow].filter(Boolean)) {
    const name = candidates.find((candidate) => server.toolNames?.has?.(candidate));
    if (!name) continue;
    const inner = await server.handle({
      jsonrpc: '2.0', id: `surface:${message.id ?? randomUUID()}`, method: 'tools/call',
      params: { name, arguments: completeToolArguments(server, name, args, idempotencyKey) },
    });
    return { ...inner, id: message.id };
  }
  if (capability.kind !== 'application_operation' || !target.application?.command) {
    throw new BatonControlError('surface_profile_restricted', `${capability.id} is unavailable in this MCP deployment profile`);
  }
  const prepared = prepareApplicationSurfaceInvocation(capability, args, { surface: 'mcp' });
  const value = await target.application.command(
    prepared.command,
    prepared.args,
    actorContext(target),
    applicationContext(target, message, { ...args, idempotencyKey }),
  );
  return toolResult(message.id, { capability: capability.id, path: prepared.path, result: clone(value) });
}

function liveServers(target, shadow) {
  return [target, shadow].filter(Boolean);
}

async function handleMeta(target, shadow, runtime, message) {
  const name = message?.params?.name;
  let repoId = null;
  try {
    const authority = await authorizeMcpMetaRead(target, name, {
      takeQuota: name !== 'baton_surface_invoke',
    });
    repoId = authority.repoId;
    const applicationAvailable = typeof target.application?.command === 'function';
    let response;

    if (name === 'baton_surface_catalog') {
      const args = closedArgs(message, ['category', 'surface', 'mode', 'owner']);
      const capabilities = projectLiveMcpCatalog(
        completeUnifiedCapabilityCatalog(args),
        liveServers(target, shadow),
        { applicationAvailable },
      );
      response = toolResult(message.id, {
        schemaVersion: 3,
        source: 'configured_existing_mcp_authority',
        coverage: assertUnifiedCapabilityCoverage(),
        nameClosure: assertSurfaceCapabilityNameClosure(),
        capabilities,
      });
    } else if (name === 'baton_surface_describe') {
      const args = closedArgs(message, ['name'], ['name']);
      response = toolResult(message.id, {
        schemaVersion: 3,
        source: 'configured_existing_mcp_authority',
        capability: projectLiveMcpCapability(
          resolveSurfaceCapability(args.name),
          liveServers(target, shadow),
          { applicationAvailable },
        ),
      });
    } else if (name === 'baton_surface_snapshot') {
      const args = closedArgs(message, ['runId', 'waveId']);
      response = toolResult(message.id, await surfaceSnapshot(target, runtime, args));
    } else if (name === 'baton_surface_watch') {
      const args = closedArgs(message, [
        'runId', 'waveId', 'afterCursor', 'attentionCursor', 'kind', 'timeoutMs',
      ], ['runId']);
      response = toolResult(message.id, await surfaceWatch(target, runtime, args, message));
    } else if (name === 'baton_surface_invoke') {
      const args = closedArgs(message, ['name', 'args', 'idempotencyKey'], ['name', 'args']);
      if (!record(args.args)) throw new BatonControlError('surface_arguments_invalid', 'surface invoke args must be an object', { field: 'args' });
      const capability = resolveSurfaceCapability(args.name);
      const live = projectLiveMcpCapability(
        capability,
        liveServers(target, shadow),
        { applicationAvailable },
      );
      if (live.liveMcp.direct !== true) await takeMcpMetaQuota(target, name, repoId);
      const dispatch = () => invokeCapability(
        target, shadow, capability, args.args,
        args.idempotencyKey ?? `mcp.surface:${message.id ?? randomUUID()}`,
        message,
      );
      response = capability.mode === 'query'
        ? await dispatch()
        : await admitAndDispatch(runtime, {
          key: capability.key,
          mode: capability.mode,
          lane: capability.lane ?? 'interactive_control',
        }, message, dispatch);
    } else {
      throw new BatonControlError('surface_capability_unknown', `unknown meta tool ${name}`);
    }

    auditMcpMetaCompletion(target, name, repoId);
    return response;
  } catch (error) {
    if (repoId !== null) {
      try { auditMcpMetaFailure(target, name, repoId, error); }
      catch (auditError) { return toolErrorResponse(message, auditError); }
    }
    return toolErrorResponse(message, error);
  }
}

export function wrapProductionMcpServer(server, {
  runtime = new ProductionConvergenceRuntime(),
  expandNative = true,
} = {}) {
  if (!server || typeof server.handle !== 'function') throw new TypeError('MCP server with handle() is required');
  let shadowPromise = null;
  const shadow = async () => {
    if (!expandNative || server.surface === 'advanced' || server.surface === 'combined') return null;
    shadowPromise ??= createAdvancedShadow(server);
    return shadowPromise;
  };
  const listedTools = async () => {
    const advanced = await shadow();
    return [
      ...(server.toolDefinitions ?? []),
      ...(advanced?.toolDefinitions ?? []),
      ...COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS,
    ];
  };
  return new Proxy(server, {
    get(target, key, receiver) {
      if (key === 'convergence') return runtime;
      if (key === 'unifiedCapabilityCoverage') return Object.freeze({
        coverage: assertUnifiedCapabilityCoverage(),
        nameClosure: assertSurfaceCapabilityNameClosure(),
      });
      if (key === 'toolDefinitions') {
        const byName = new Map((target.toolDefinitions ?? []).map((tool) => [tool.name, tool]));
        for (const tool of COMPLETE_UNIFIED_MCP_META_TOOL_DEFINITIONS) byName.set(tool.name, tool);
        return [...byName.values()];
      }
      if (key === 'toolNames') {
        return new Set([...(target.toolNames ?? []), ...META_NAMES]);
      }
      if (key !== 'handle') {
        const value = Reflect.get(target, key, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (message) => {
        if (message?.method === 'initialize') {
          return augmentInstructions(await target.handle(message));
        }
        if (message?.method === 'tools/list'
          || (message?.method === 'notifications/initialized' && message?.id !== undefined)) {
          return augmentTools(await target.handle(message), await listedTools());
        }
        const tool = message?.method === 'tools/call' ? message?.params?.name : null;
        if (META_NAMES.has(tool)) return handleMeta(target, await shadow(), runtime, message);
        const definition = definitionFor(tool);
        if (!definition) return target.handle(message);
        if (definition.mode === 'query') {
          const authorityFailure = await authorizeRunScopedQuery(target, tool, message);
          if (authorityFailure) return authorityFailure;
          return attentionCursorGuard(tool, message, await target.handle(message));
        }
        return admitAndDispatch(runtime, definition, message, () => target.handle(message));
      };
    },
    has(target, key) {
      return ['convergence', 'unifiedCapabilityCoverage'].includes(key) || Reflect.has(target, key);
    },
  });
}
