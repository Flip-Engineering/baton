import { randomUUID } from 'node:crypto';

import { resolveUnifiedSurfaceCommand } from './control-surface-unification.mjs';
import { BatonControlError, digestValue } from './holistic-runtime.mjs';
import { ProductionConvergenceRuntime } from './production-convergence.mjs';
import { installProductionWebConvergence } from './production-web-convergence.mjs';
import { prepareApplicationSurfaceInvocation } from './surface-capability-catalog.mjs';
import {
  assertSurfaceCapabilityNameClosure,
  resolveSurfaceCapability,
} from './surface-capability-resolution.mjs';

installProductionWebConvergence();

async function admitAndDispatch(runtime, definition, args, dispatch) {
  const commandId = `cli:${randomUUID()}`;
  const admitted = runtime.journal.append('command.admitted', {
    commandId, command: definition.key, args, principalId: 'cli-transport', transport: 'cli',
  });
  return runtime.scheduler.enqueue(definition.lane, async () => {
    runtime.journal.assertExternalAwaitAllowed();
    runtime.journal.append('effect.requested', {
      commandId, command: definition.key, admittedSeq: admitted.seq, transport: 'cli',
    });
    try {
      const result = await dispatch();
      runtime.journal.append('effect.succeeded', {
        commandId, command: definition.key, transport: 'cli', resultDigest: digestValue(result ?? null),
      });
      return result;
    } catch (error) {
      runtime.journal.append('effect.failed', {
        commandId, command: definition.key, transport: 'cli',
        error: BatonControlError.from(error).envelope().error,
      });
      throw error;
    }
  }, { commandId, command: definition.key, transport: 'cli' });
}

function webTransportName(capability, command) {
  if (command === 'run.act') return 'run_act';
  if (capability.names?.web) return capability.names.web;
  return command.replaceAll('.', '_');
}

async function rawWebCommand(target, capability, command, args, idempotencyKey) {
  if (typeof target._json !== 'function' || typeof target._headers !== 'function'
    || typeof target.reconcile !== 'function') {
    throw new BatonControlError('surface_web_transport_unavailable', 'Baton Web client cannot perform generic surface invocation');
  }
  const commandId = `surface-${randomUUID()}`;
  const runId = command === 'run.start' ? args?.intent?.runId ?? null : args?.runId ?? null;
  const envelope = {
    schemaVersion: 1,
    commandId,
    idempotencyKey,
    command: webTransportName(capability, command),
    args,
    repoId: target.repoId,
    ...(runId ? { runId } : {}),
    origin: target.origin,
  };
  const timeout = typeof target._requestTimeoutForCommand === 'function'
    ? target._requestTimeoutForCommand(command, args) : target.requestTimeoutMs;
  const body = await target._json('/v1/commands', {
    method: 'POST', headers: target._headers(true), body: JSON.stringify(envelope),
  }, timeout);
  if (body.status !== 'admitted') return body.result ?? body;
  return target.reconcile(commandId);
}

async function invokeApplicationCapability(target, capability, args, idempotencyKey) {
  const prepared = prepareApplicationSurfaceInvocation(capability, args, { surface: 'cli' });
  try {
    return await target.command(prepared.command, prepared.args, idempotencyKey);
  } catch (error) {
    if (!['cli_command_unavailable', 'surface_unsupported'].includes(error?.code)) throw error;
  }
  if (capability.surfaces?.web?.reachable !== true && prepared.command !== 'run.act') {
    throw new BatonControlError(
      'surface_mcp_config_required',
      `${capability.id} is not admitted on the resident Web bus; invoke it with --mcp-config`,
      { action: 'pass_mcp_config' },
    );
  }
  return rawWebCommand(target, capability, prepared.command, prepared.args, idempotencyKey);
}

function settled(value) {
  if (value.status === 'fulfilled') return { ok: true, value: value.value };
  const error = BatonControlError.from(value.reason).envelope().error;
  return { ok: false, error };
}

function validateWatchArgs(args, target) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || typeof args.runId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/u.test(args.runId)) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch requires a valid runId', { field: 'runId' });
  }
  if (args.waveId !== undefined
    && (typeof args.waveId !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/u.test(args.waveId))) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch waveId is invalid', { field: 'waveId' });
  }
  for (const field of ['afterCursor', 'attentionCursor']) {
    if (args[field] !== undefined && (!Number.isSafeInteger(args[field]) || args[field] < 0)) {
      throw new BatonControlError('surface_watch_invalid', `${field} must be a non-negative safe integer`, { field });
    }
  }
  if (args.kind !== undefined
    && (typeof args.kind !== 'string' || !/^[A-Za-z0-9._:-]{1,256}$/u.test(args.kind))) {
    throw new BatonControlError('surface_watch_invalid', 'surface watch kind is invalid', { field: 'kind' });
  }
  const maximum = Math.min(30_000, Number.isSafeInteger(target.commandTimeoutMs)
    ? target.commandTimeoutMs : 30_000);
  const timeoutMs = args.timeoutMs ?? Math.min(25_000, maximum);
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

function directCliApplicationPath(capability) {
  return capability.hostLocal !== true
    && capability.kind !== 'surface_meta'
    && (capability.surfaces?.cli?.direct === true || capability.surfaces?.web?.reachable === true);
}

export function wrapProductionCliClient(client, { runtime = new ProductionConvergenceRuntime() } = {}) {
  if (!client || typeof client.command !== 'function') throw new TypeError('CLI client with command() is required');
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'convergence') return runtime;
      if (key === 'surfaceInvoke') {
        return async (name, args = {}, idempotencyKey = `cli.surface:${randomUUID()}`) => {
          const capability = resolveSurfaceCapability(name);
          if (capability.hostLocal === true || capability.kind === 'cli_native') {
            throw new BatonControlError(
              'surface_host_command_required',
              `${capability.id} is host-local; use ${capability.names?.cli ?? 'its direct CLI command'}`,
            );
          }
          if (capability.kind === 'surface_meta') {
            throw new BatonControlError(
              'surface_meta_direct_required',
              `${capability.id} must be called through its direct surface command`,
            );
          }
          let dispatch;
          if (capability.kind === 'application_operation') {
            dispatch = () => invokeApplicationCapability(target, capability, args, idempotencyKey);
          } else if (directCliApplicationPath(capability)) {
            // Existing legacy application commands (for example run.status/run.wait/runs.list)
            // can appear as live transport rows in the exhaustive catalogue. Preserve their real
            // CLI/Web command path instead of reclassifying or forcing them through MCP.
            dispatch = () => target.command(capability.id, args, idempotencyKey);
          } else {
            throw new BatonControlError(
              'surface_mcp_config_required',
              `${capability.id} is not a connected application command; invoke it with --mcp-config`,
              { action: 'pass_mcp_config' },
            );
          }
          if (capability.mode === 'query') return dispatch();
          return admitAndDispatch(runtime, {
            key: capability.key, lane: capability.lane ?? 'interactive_control',
          }, args, dispatch);
        };
      }
      if (key === 'surfaceSnapshot') {
        return async ({ runId = null, waveId = null } = {}) => {
          // #250: a frame is BOUNDED reads — never the list projections. runs.list and
          // waves.list are the #210/#216 furnaces (101.8s per waves_list measured on the
          // campaign ledger); firing them per frame (the default 1s refresh) wedges the
          // resident. The un-scoped frame reads doctor (pulse/routes); scoped frames add
          // their bounded projections. The visual model consumes run.value.workstreams +
          // doctor only — the roster rides the run-scoped frame, never runs.list.
          const requests = {
            doctor: Promise.resolve().then(() => target.doctor()),
            ...(runId ? { run: Promise.resolve().then(() => target.command('run.inspect', { runId, depth: 'outline' })) } : {}),
            ...(waveId ? { wave: Promise.resolve().then(() => target.command('waves.progress', { waveId })) } : {}),
          };
          const entries = Object.entries(requests);
          const values = await Promise.allSettled(entries.map(([, promise]) => promise));
          return Object.freeze({
            schemaVersion: 2,
            source: 'cli_authenticated_web',
            generatedAt: new Date().toISOString(),
            nameClosure: assertSurfaceCapabilityNameClosure(),
            convergence: runtime.audit(),
            ...Object.fromEntries(entries.map(([name], index) => [name, settled(values[index])])),
          });
        };
      }
      if (key === 'surfaceWatch') {
        return async (input) => {
          const args = validateWatchArgs(input, target);
          const follow = await target.command('run.follow', {
            runId: args.runId,
            afterCursor: args.afterCursor,
            timeoutMs: args.timeoutMs,
          });
          const requests = {
            attention: Promise.resolve().then(() => target.command('run.attention.watch', {
              runId: args.runId,
              cursor: args.attentionCursor,
              ...(args.kind === null ? {} : { kind: args.kind }),
            })),
            run: Promise.resolve().then(() => target.command('run.inspect', {
              runId: args.runId, depth: 'outline',
            })),
            ...(args.waveId === null ? {} : {
              wave: Promise.resolve().then(() => target.command('waves.progress', {
                waveId: args.waveId,
              })),
            }),
          };
          const entries = Object.entries(requests);
          const outcomes = await Promise.allSettled(entries.map(([, promise]) => promise));
          const projected = Object.fromEntries(entries.map(([name], index) => [name, settled(outcomes[index])]));
          const attention = projected.attention?.ok ? projected.attention.value : null;
          if (Number.isSafeInteger(attention?.throughCursor)
            && attention.throughCursor < args.attentionCursor) {
            throw new BatonControlError(
              'attention_scope_forbidden',
              'attention watch could not preserve the authorized cursor; refusing silent empty fallback',
              { detail: { requestedCursor: args.attentionCursor, throughCursor: attention.throughCursor } },
            );
          }
          const reasons = Array.isArray(attention?.reasons) ? attention.reasons : [];
          return Object.freeze({
            schemaVersion: 1,
            kind: 'baton.surface_watch',
            source: 'cli_authenticated_web',
            runId: args.runId,
            waveId: args.waveId,
            afterCursor: args.afterCursor,
            attentionCursor: args.attentionCursor,
            nextAfterCursor: Number.isSafeInteger(follow?.cursor)
              ? follow.cursor : Number.isSafeInteger(follow?.throughCursor)
                ? follow.throughCursor : args.afterCursor,
            nextAttentionCursor: Number.isSafeInteger(attention?.throughCursor)
              ? attention.throughCursor : args.attentionCursor,
            follow,
            ...projected,
            decisions: {
              source: 'run.attention.watch',
              reasons: reasons.filter((reason) => /decision|answer|approval/u.test(
                `${reason?.kind ?? ''} ${reason?.requiredAction ?? ''}`,
              )),
            },
            convergence: runtime.audit(),
          });
        };
      }
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      if (key !== 'command') return value.bind(target);
      return async (name, args, idempotencyKey) => {
        let definition;
        try { definition = resolveUnifiedSurfaceCommand('cli', name); }
        catch (error) {
          if (error?.code === 'command_unknown') return value.call(target, name, args, idempotencyKey);
          throw error;
        }
        if (definition.mode === 'query') return value.call(target, name, args, idempotencyKey);
        return admitAndDispatch(runtime, definition, args,
          () => value.call(target, name, args, idempotencyKey));
      };
    },
    has(target, key) {
      return ['convergence', 'surfaceInvoke', 'surfaceSnapshot', 'surfaceWatch'].includes(key)
        || Reflect.has(target, key);
    },
  });
}
