import { createHash } from 'node:crypto';

import { BatonControlError } from './holistic-runtime.mjs';

const PORT_ROWS = [
  ['run_message_send', 'run.message.send', 'effect', ['runId', 'workerId', 'kind', 'body', 'budget']],
  ['run_message_receipt', 'run.message.receipt', 'query', ['messageId']],
  ['run_attention_watch', 'run.attention.watch', 'query', ['runId', 'kind', 'cursor']],
  ['run_scratchpad_read', 'run.scratchpad.read', 'query', ['runId', 'scope', 'cursor']],
  ['run_scratchpad_elevate', 'run.scratchpad.elevate', 'effect', ['runId', 'taskId', 'entryIds']],
  ['run_board_post', 'run.board.post', 'effect', ['runId', 'board', 'title', 'detail', 'owner', 'evidence']],
  ['run_board_read', 'run.board.read', 'query', ['runId', 'board']],
  ['run_knowledge_seed', 'run.knowledge.seed', 'effect', ['runId', 'type', 'grounding', 'body', 'evidence']],
  // CS-3 already shipped a bounded, whitelisted run.debug application projection and parser, but
  // deliberately omitted it from CLI_WEB_COMMANDS/Web admission. The convergence release closes
  // that parser-present/executor-dead gap without changing the projection itself.
  ['run_debug', 'run.debug', 'query', ['runId', 'member', 'limit'], {
    dispatch: 'application', authorizationCommand: 'run_board_read',
  }],
];

export const PRODUCTION_WORKFLOW_WEB_PORTS = Object.freeze(Object.fromEntries(
  PORT_ROWS.flatMap(([transport, application, mode, fields, options = {}]) => {
    const row = Object.freeze({
      application,
      mode,
      fields: Object.freeze(fields),
      dispatch: options.dispatch ?? 'web_northbound',
      authorizationCommand: options.authorizationCommand ?? null,
    });
    return [[transport, row], [application, row]];
  }),
));

const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion', 'commandId', 'idempotencyKey', 'command', 'args', 'repoId',
  'runId', 'expectedFence', 'origin', 'clientObservedCursor',
]);
const ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const FORBIDDEN_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|credential|password|api[_-]?key|authorization)$/iu;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const result = (status, body) => Object.freeze({ status, body: Object.freeze(body) });
const errorResult = (status, code, message = code, options = {}) => result(status, {
  ok: false,
  error: {
    code,
    message,
    ...(options.detail == null ? {} : { detail: options.detail }),
    ...(options.field == null ? {} : { field: options.field }),
    ...(options.retryable === true ? { retryable: true } : {}),
    ...(options.action == null ? {} : { action: options.action }),
  },
});

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!record(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key)
    || containsForbiddenKey(child));
}

function typedFailure(error) {
  const typed = BatonControlError.from(error).envelope().error;
  const status = typed.code === 'application_unauthorized' || typed.code === 'forbidden' ? 403
    : /not_found/u.test(typed.code) ? 404
      : typed.retryable ? 503
        : /conflict|stale|already|closed|detached|scope/u.test(typed.code) ? 409
          : 400;
  return errorResult(status, typed.code, typed.message, typed);
}

function validateEnvelope(envelope, port) {
  if (!record(envelope)) return errorResult(400, 'invalid_command', 'command envelope must be an object');
  const unknownTop = Object.keys(envelope).find((key) => !TOP_LEVEL_FIELDS.has(key));
  if (unknownTop) return errorResult(400, 'unknown_top_level_field', 'unknown_top_level_field', { field: unknownTop });
  if (envelope.schemaVersion !== 1) return errorResult(400, 'invalid_command', 'unsupported schemaVersion');
  if (!ID.test(envelope.commandId ?? '') || !ID.test(envelope.idempotencyKey ?? '')
    || typeof envelope.repoId !== 'string' || envelope.repoId.length === 0
    || typeof envelope.origin !== 'string' || envelope.origin.length === 0
    || !record(envelope.args)) {
    return errorResult(400, 'invalid_command', 'command identity, idempotencyKey, repoId, origin, and args are required');
  }
  const allowed = new Set(port.fields);
  const unknownArg = Object.keys(envelope.args).find((key) => !allowed.has(key));
  if (unknownArg) return errorResult(400, 'unknown_argument_field', 'unknown_argument_field', { field: unknownArg });
  if (containsForbiddenKey(envelope.args)) {
    return errorResult(400, 'invalid_command', 'credential-bearing command fields are forbidden');
  }
  if (Object.hasOwn(envelope, 'runId')
    && (!ID.test(envelope.runId ?? '') || envelope.runId !== envelope.args.runId)) {
    return errorResult(400, 'application_run_id_mismatch', 'top-level runId must match args.runId', { field: 'runId' });
  }
  return null;
}

function applicationPrincipal(ctx) {
  return {
    actor: `web:${ctx.principal.userId}:${ctx.principal.sessionId}`,
    principalId: ctx.principal.userId,
    sessionId: ctx.principal.sessionId,
  };
}

function applicationContext(ctx, envelope) {
  return {
    transport: 'web',
    requestId: String(envelope.commandId),
    idempotencyKey: `web.command:${envelope.commandId}`,
    capabilities: Array.isArray(ctx.principal?.capabilities) ? [...ctx.principal.capabilities] : [],
  };
}

function canonicalRequest(envelope) {
  const { commandId: _commandId, clientObservedCursor: _cursor, ...semantic } = envelope;
  return semantic;
}

async function authorizePort(application, port, args, principal, context) {
  if (port.application === 'run.attention.watch') return true;
  if (typeof args.runId === 'string') {
    return application.authorizeReplay(
      'run.inspect', { runId: args.runId, depth: 'outline' }, principal, context,
    );
  }
  return application.authorizeReplay(port.application, args, principal, context);
}

function audit(northbound, kind, ctx, details = {}) {
  try {
    northbound._audit(kind, ctx, details);
    return true;
  } catch {
    return false;
  }
}

function authorizationEnvelope(envelope, port) {
  return port.authorizationCommand === null
    ? envelope
    : { ...envelope, command: port.authorizationCommand };
}

async function executeDirectApplicationQuery(northbound, ctx, envelope, port, principal, context) {
  try {
    const value = await northbound.application.command(
      port.application, envelope.args, principal, context,
    );
    if (!audit(northbound, 'operator_read_authorized', ctx, {
      command: port.application,
      repoId: envelope.repoId,
      resourceClass: 'run_debug',
    })) return errorResult(503, 'temporarily_unavailable');
    return result(200, { ok: true, commandId: envelope.commandId, result: value });
  } catch (error) {
    return typedFailure(error);
  }
}

export async function executeProductionWorkflowWebPort(northbound, ctx, envelope, port) {
  const validation = validateEnvelope(envelope, port);
  if (validation) {
    if (!audit(northbound, 'command_invalid', ctx, {
      command: envelope?.command ?? null,
      reason: validation.body.error.code,
    })) return errorResult(503, 'temporarily_unavailable');
    return validation;
  }
  if (!northbound._admissionOpen()) return errorResult(503, 'temporarily_unavailable');
  const authFailure = northbound._authenticate(ctx);
  if (authFailure) {
    if (!audit(northbound, 'authentication_refused', ctx)) {
      return errorResult(503, 'temporarily_unavailable');
    }
    return authFailure;
  }
  const authorizationFailure = northbound._authorize(
    ctx, authorizationEnvelope(envelope, port),
  );
  if (authorizationFailure) {
    if (!audit(northbound, 'authorization_refused', ctx, {
      command: envelope.command, repoId: envelope.repoId,
    })) return errorResult(503, 'temporarily_unavailable');
    return authorizationFailure;
  }
  if (!northbound.application) return errorResult(503, 'application_unavailable', 'run application unavailable');

  if (northbound.edge) {
    const quota = northbound.edge.takeCommand(ctx.principal.credentialId, 1);
    if (!quota.ok) {
      if (!audit(northbound, 'quota_refused', ctx, { quota: quota.quota ?? 'command' })) {
        return errorResult(503, 'temporarily_unavailable');
      }
      return { ...errorResult(429, 'rate_limited'), headers: { 'retry-after': String(quota.retryAfter) } };
    }
  }

  const principal = applicationPrincipal(ctx);
  const context = applicationContext(ctx, envelope);
  try {
    await authorizePort(northbound.application, port, envelope.args, principal, context);
  } catch (error) {
    audit(northbound, 'authorization_refused', ctx, {
      command: envelope.command, repoId: envelope.repoId,
    });
    return typedFailure(error);
  }

  const scopeKey = hash({
    userId: ctx.principal.userId,
    command: envelope.command,
    repoId: envelope.repoId,
    idempotencyKey: envelope.idempotencyKey,
  });
  const requestDigest = hash(canonicalRequest(envelope));

  if (port.mode === 'query') {
    if (port.dispatch === 'application') {
      return executeDirectApplicationQuery(
        northbound, ctx, envelope, port, principal, context,
      );
    }
    return northbound._executeObservation(
      ctx, envelope, principal.actor, scopeKey, requestDigest,
    );
  }

  let admission;
  try {
    admission = northbound.coordination.admitWebCommand({
      commandId: envelope.commandId,
      scopeKey,
      requestDigest,
      command: envelope.command,
      repoId: envelope.repoId,
      runId: envelope.args.runId ?? null,
      userId: ctx.principal.userId,
      sessionId: ctx.principal.sessionId,
      credentialId: ctx.principal.credentialId,
      origin: envelope.origin,
      expectedFence: envelope.expectedFence ?? null,
    }, { actor: principal.actor, key: `web.admit:${scopeKey}` });
  } catch {
    return errorResult(503, 'temporarily_unavailable');
  }
  if (!admission.ok) {
    audit(northbound, 'idempotency_refused', ctx, {
      command: envelope.command, repoId: envelope.repoId, reason: admission.result,
    });
    return errorResult(409,
      admission.result === 'idempotency_conflict' ? 'idempotency_conflict' : 'invalid_command');
  }
  if (admission.result === 'replay') {
    audit(northbound, 'command_replayed', ctx, {
      command: envelope.command,
      repoId: envelope.repoId,
      commandId: admission.command.commandId,
    });
    if (admission.command.status === 'admitted') {
      return result(202, { ok: true, commandId: admission.command.commandId, status: 'admitted', replayed: true });
    }
    const outcome = admission.command.outcome;
    if (outcome?.body) return result(outcome.httpStatus, { ...outcome.body, replayed: true });
  }

  const dispatch = Promise.resolve().then(() => northbound._dispatch(
    envelope, principal.actor, ctx.principal,
  ));
  void dispatch.then(
    (response) => {
      try {
        northbound.coordination.completeWebCommand(
          envelope.commandId,
          { httpStatus: response.status, body: response.body },
          { actor: principal.actor, key: `web.complete:${envelope.commandId}` },
        );
      } catch { /* durable admission remains visible */ }
    },
    (error) => {
      const failure = typedFailure(error);
      try {
        northbound.coordination.failWebCommand(
          envelope.commandId,
          { httpStatus: failure.status, body: failure.body },
          { actor: principal.actor, key: `web.fail:${envelope.commandId}` },
        );
      } catch { /* durable admission remains visible */ }
    },
  );
  return result(202, { ok: true, commandId: envelope.commandId, status: 'admitted' });
}
