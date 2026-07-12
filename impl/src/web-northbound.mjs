import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { WebEventStream } from './web-stream.mjs';
import { WebEdgePolicy, WebReadinessAuthority } from './web-edge.mjs';
import { OidcBrowserFlow, csrfCookie } from './web-oidc.mjs';
import { operatorAsset } from './web-operator.mjs';

const COMMAND_CAPABILITY = Object.freeze({
  spawn: 'control', send: 'control', interrupt: 'control', kill: 'emergency_stop', respond: 'approve',
  list: 'observe', result: 'observe', wait: 'observe', capabilities: 'observe', capability_invoke: 'control',
});
const FENCE_REQUIRED = new Set(['send', 'interrupt', 'kill']);
const TOP_LEVEL = new Set(['schemaVersion', 'commandId', 'idempotencyKey', 'command', 'args', 'repoId', 'runId', 'expectedFence', 'origin', 'clientObservedCursor']);
const ARG_FIELDS = Object.freeze({
  spawn: new Set(['harness', 'model', 'effort', 'modelPolicy', 'brief', 'taskId', 'deps', 'taskType', 'session', 'refines']),
  send: new Set(['workerId', 'message', 'mode']),
  interrupt: new Set(['workerId', 'then']),
  kill: new Set(['workerId']),
  respond: new Set(['requestId', 'answer']),
  list: new Set(),
  result: new Set(['workerId']),
  wait: new Set(['timeoutMs']),
  capabilities: new Set(),
  capability_invoke: new Set(['name', 'op', 'action', 'args', 'budgetTokens', 'ref', 'cursor', 'claim']),
});
const FORBIDDEN_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|credential|password|api[_-]?key|authorization)$/i;
const MODEL_POLICY_FIELDS = new Set(['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies', 'reasoningEffort', 'serviceTier']);
const AUTH_PATHS = new Set(['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout']);
const OIDC_START_PATH = '/v1/auth/oidc/start';
const OIDC_CALLBACK_PATH = '/v1/auth/oidc/callback';

function json(value) { return JSON.parse(JSON.stringify(value)); }
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function tokenHash(value) { return createHash('sha256').update(value).digest('hex'); }
function equalDigest(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
function actor(principal) { return `web:${principal.userId}:${principal.sessionId}`; }
function result(status, body) { return Object.freeze({ status, body: Object.freeze(body) }); }
function error(status, code, message = code) { return result(status, { ok: false, error: { code, message } }); }
function dispatchFailure(cause) {
  if (['ModelSelectionError', 'SessionSelectionError', 'DuplicateTaskIdError', 'UnknownVendorError', 'DependencyCycleError', 'TypeError'].includes(cause?.name)) {
    return { httpStatus: 400, body: { ok: false, error: { code: 'invalid_command', message: 'command precondition failed' } } };
  }
  if (cause?.code === 'capability_not_found') return { httpStatus: 404, body: { ok: false, error: { code: 'not_found', message: 'resource not found' } } };
  if (['capability_op_unavailable', 'capability_resume_unavailable', 'capability_reverify_unavailable', 'capability_args_invalid',
    'capability_resume_invalid', 'capability_reverify_invalid', 'capability_budget_invalid', 'capability_actor_invalid'].includes(cause?.code)) {
    return { httpStatus: 400, body: { ok: false, error: { code: 'invalid_command', message: 'command precondition failed' } } };
  }
  if (cause?.name === 'WorkerNotFoundError') return { httpStatus: 404, body: { ok: false, error: { code: 'not_found', message: 'resource not found' } } };
  return { httpStatus: 503, body: { ok: false, error: { code: 'temporarily_unavailable', message: 'command dispatch failed' } } };
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function containsForbiddenKey(value) {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbiddenKey(child));
}
function string(value) { return typeof value === 'string' && value.length > 0; }
function validProviderClaims(value) {
  if (!isRecord(value)) return false;
  const allowed = new Set(['userId', 'authMethod', 'capabilities', 'repoIds', 'ttlMs']);
  return !Object.keys(value).some((key) => !allowed.has(key))
    && string(value.userId) && ['cookie', 'bearer'].includes(value.authMethod)
    && Array.isArray(value.capabilities) && value.capabilities.length > 0 && value.capabilities.every(string)
    && Array.isArray(value.repoIds) && value.repoIds.length > 0 && value.repoIds.every(string)
    && Number.isSafeInteger(value.ttlMs) && value.ttlMs > 0;
}

function validateEnvelope(envelope) {
  if (!isRecord(envelope)) return 'command envelope must be an object';
  const unknown = Object.keys(envelope).find((key) => !TOP_LEVEL.has(key));
  if (unknown) return 'unknown_top_level_field';
  if (envelope.schemaVersion !== 1) return 'unsupported schemaVersion';
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(envelope.commandId ?? '')
    || !/^[A-Za-z0-9._:-]{1,256}$/.test(envelope.idempotencyKey ?? '')
    || !string(envelope.command) || !string(envelope.repoId) || !string(envelope.origin)) return 'command identity, idempotencyKey, repoId, and origin are required';
  if (!Object.hasOwn(COMMAND_CAPABILITY, envelope.command)) return 'unsupported command';
  if (!isRecord(envelope.args)) return 'args must be an object';
  const allowed = ARG_FIELDS[envelope.command];
  const unknownArg = Object.keys(envelope.args).find((key) => !allowed.has(key));
  if (unknownArg) return 'unknown_argument_field';
  if (containsForbiddenKey(envelope.args)) return 'credential-bearing command fields are forbidden';
  if (FENCE_REQUIRED.has(envelope.command) && !Number.isInteger(envelope.expectedFence)) return `${envelope.command} requires expectedFence`;
  if (envelope.command === 'spawn') {
    if (!string(envelope.args.harness) || !isRecord(envelope.args.brief)) return 'spawn requires harness and brief';
    if (Object.hasOwn(envelope.args, 'model') && !string(envelope.args.model)) return 'model must be a non-empty string';
    if (Object.hasOwn(envelope.args, 'effort') && !string(envelope.args.effort)) return 'effort must be a non-empty string';
    if (Object.hasOwn(envelope.args, 'modelPolicy') && !isRecord(envelope.args.modelPolicy)) return 'modelPolicy must be an object';
    if (isRecord(envelope.args.modelPolicy)) {
      const unknownPolicy = Object.keys(envelope.args.modelPolicy).find((key) => !MODEL_POLICY_FIELDS.has(key));
      if (unknownPolicy) return 'unknown_model_policy_field';
    }
  }
  if (['send', 'interrupt', 'kill', 'result'].includes(envelope.command) && !string(envelope.args.workerId)) return `${envelope.command} requires workerId`;
  if (envelope.command === 'send' && (!string(envelope.args.message) || !['turn', 'steer', 'nudge'].includes(envelope.args.mode))) return 'send requires message and a valid mode';
  if (envelope.command === 'respond' && (!string(envelope.args.requestId) || !Object.hasOwn(envelope.args, 'answer'))) return 'respond requires requestId and answer';
  if (envelope.command === 'capability_invoke') {
    const action = envelope.args.action ?? 'invoke';
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(envelope.args.name ?? '')
      || typeof envelope.args.op !== 'string' || envelope.args.op.length === 0 || envelope.args.op.length > 256) return 'capability_invoke requires a valid name and op';
    if (!['invoke', 'resume', 'reverify'].includes(action)) return 'capability_invoke requires a valid action';
    if (!Number.isSafeInteger(envelope.args.budgetTokens) || envelope.args.budgetTokens <= 0) return 'capability_invoke requires a positive budgetTokens';
    if (action === 'invoke') {
      if (!isRecord(envelope.args.args)) return 'capability invoke requires args';
      if (Object.hasOwn(envelope.args, 'ref') || Object.hasOwn(envelope.args, 'cursor') || Object.hasOwn(envelope.args, 'claim')) return 'capability invoke received action-inapplicable fields';
    }
    if (action === 'resume') {
      if (!isRecord(envelope.args.ref) || !string(envelope.args.cursor) || envelope.args.cursor.length > 4_096) return 'capability resume requires ref and cursor';
      if (Object.hasOwn(envelope.args, 'args') || Object.hasOwn(envelope.args, 'claim')) return 'capability resume received action-inapplicable fields';
    }
    if (action === 'reverify') {
      if (!isRecord(envelope.args.claim) || !isRecord(envelope.args.args)) return 'capability reverify requires claim and args';
      if (Object.hasOwn(envelope.args, 'ref') || Object.hasOwn(envelope.args, 'cursor')) return 'capability reverify received action-inapplicable fields';
    }
  }
  return null;
}

function canonicalRequest(envelope) {
  const { commandId: _commandId, clientObservedCursor: _cursor, ...semantic } = envelope;
  return semantic;
}

export class WebNorthbound {
  constructor(opts) {
    if (!opts?.coordinator || !opts?.coordination) throw new TypeError('web northbound requires coordinator and coordination authority');
    for (const method of ['admitWebCommand', 'completeWebCommand', 'failWebCommand', 'recordWebAudit', 'webCommand']) {
      if (typeof opts.coordination[method] !== 'function') throw new TypeError(`coordination authority is missing ${method}()`);
    }
    this.coordinator = opts.coordinator;
    this.coordination = opts.coordination;
    this.allowedOrigins = new Set(opts.allowedOrigins ?? []);
    this.repoIds = new Set(opts.repoIds ?? []);
    if (this.repoIds.size > 1) throw new TypeError('one web northbound authority may serve at most one repository');
    this.now = opts.now ?? Date.now;
    this.authenticate = opts.authenticate ?? null;
    this.sessions = opts.sessions ?? opts.sessionStore ?? null;
    this.identityProvider = opts.identityProvider ?? opts.provider ?? null;
    this.oidc = opts.oidc ?? opts.oidcFlow ?? null;
    if (this.oidc !== null && !(this.oidc instanceof OidcBrowserFlow)) throw new TypeError('oidc must be an OidcBrowserFlow');
    if (this.oidc && (!this.allowedOrigins.has(this.oidc.redirectUri.origin)
      || this.oidc.redirectUri.pathname !== OIDC_CALLBACK_PATH)) {
      throw new TypeError('OIDC redirectUri must match the served allowed origin and callback path');
    }
    if (!this.authenticate && this.sessions) this.authenticate = this.sessions.authenticator();
    this.isPrincipalActive = opts.isPrincipalActive ?? this.authenticate?.isPrincipalActive ?? null;
    this.maxBodyBytes = opts.maxBodyBytes ?? 64 * 1024;
    this.edge = opts.edge ?? (opts.edgePolicy ? new WebEdgePolicy(opts.edgePolicy) : null);
    this.admitting = true;
    this.readinessChecks = opts.readinessChecks ?? [];
    this.readinessAuthority = opts.readinessAuthority ?? (this.sessions && this.authenticate?.isPrincipalActive
      ? new WebReadinessAuthority({ coordination: this.coordination, sessions: this.sessions, authenticate: this.authenticate, checks: this.readinessChecks }) : null);
    this.stream = opts.stream ?? new WebEventStream({
      ...opts, coordination: this.coordination,
      allowedOrigins: [...this.allowedOrigins], repoIds: [...this.repoIds],
      isPrincipalActive: this.isPrincipalActive,
      acquireConnection: this.edge ? (principal) => this.edge.acquireConnection(principal.credentialId) : null,
      releaseConnection: this.edge ? (principal) => this.edge.releaseConnection(principal.credentialId) : null,
      credentialDigest: this.edge ? (credentialId) => this.edge.digest(`credential:${credentialId}`) : null,
    });
  }

  _audit(kind, ctx, details = {}) {
    const principal = ctx?.principal;
    const auditActor = principal ? actor(principal) : 'web:anonymous';
    return this.coordination.recordWebAudit({
      kind, userId: principal?.userId ?? null, sessionId: principal?.sessionId ?? null,
      credentialDigest: principal?.credentialId && this.edge ? this.edge.digest(`credential:${principal.credentialId}`) : null,
      originClass: ctx?.origin == null ? 'missing' : this.allowedOrigins.has(ctx.origin) ? 'allowed' : 'disallowed',
      remoteAddressClass: ctx?.remoteAddress ? 'present' : 'absent', addressDigest: ctx?.addressDigest ?? null, ...json(details),
    }, { actor: auditActor, key: `web.audit:${randomUUID()}` });
  }

  _authenticate(ctx) {
    const principal = ctx?.principal;
    if (!principal || !string(principal.userId) || !string(principal.sessionId) || !string(principal.credentialId)) return error(401, 'unauthenticated');
    const expiresAt = Date.parse(principal.expiresAt);
    if (principal.revoked === true || !string(principal.expiresAt) || !Number.isFinite(expiresAt) || expiresAt <= this.now()) return error(401, 'unauthenticated');
    if (ctx.transport !== 'https') return error(503, 'temporarily_unavailable', 'secure transport required');
    return null;
  }

  _isReady() {
    if (!this.admitting || (this.edge && !this.edge.admitting)) return false;
    try {
      return this.readinessAuthority?.check() === true;
    } catch { return false; }
  }

  _readinessResponse(ctx) {
    const ready = this._isReady();
    try {
      this._audit('readiness_probe', ctx, { ready });
      if (this._lastReady !== ready) {
        this._audit('readiness_transition', ctx, { ready });
        this._lastReady = ready;
      }
    } catch { return result(503, { ready: false }); }
    return ready ? result(200, { ready: true }) : result(503, { ready: false });
  }

  _admissionOpen() { return this.admitting && (!this.edge || this.edge.admitting); }

  _authorize(ctx, envelope) {
    const principal = ctx.principal;
    if (!this.allowedOrigins.has(ctx.origin) || envelope.origin !== ctx.origin) return error(403, 'forbidden');
    if (principal.authMethod === 'cookie') {
      const csrfValid = string(ctx.csrfToken) && (principal.csrfTokenDigest
        ? equalDigest(tokenHash(ctx.csrfToken), principal.csrfTokenDigest)
        : ctx.csrfToken === principal.csrfToken);
      if (!csrfValid) return error(403, 'forbidden');
    }
    if (!this.repoIds.has(envelope.repoId) || !Array.isArray(principal.repoIds) || !principal.repoIds.includes(envelope.repoId)) return error(403, 'forbidden');
    if (!Array.isArray(principal.capabilities) || !principal.capabilities.includes(COMMAND_CAPABILITY[envelope.command])) return error(403, 'forbidden');
    return null;
  }

  async execute(ctx, envelope) {
    if (!this._admissionOpen()) return error(503, 'temporarily_unavailable');
    const authFailure = this._authenticate(ctx);
    if (authFailure) {
      try { this._audit('authentication_refused', ctx); } catch { return error(503, 'temporarily_unavailable'); }
      return authFailure;
    }
    const validation = validateEnvelope(envelope);
    if (validation) {
      try { this._audit('command_invalid', ctx, { reason: validation }); } catch { return error(503, 'temporarily_unavailable'); }
      return error(400, 'invalid_command', validation);
    }
    const authorizationFailure = this._authorize(ctx, envelope);
    if (authorizationFailure) {
      try { this._audit('authorization_refused', ctx, { command: envelope.command, repoId: envelope.repoId }); } catch { return error(503, 'temporarily_unavailable'); }
      return authorizationFailure;
    }
    if (this.edge) {
      const key = ctx.principal.credentialId;
      const quota = this.edge.takeCommand(key, ({ spawn: 10, capability_invoke: 10, send: 2, interrupt: 2, kill: 2, respond: 2 }[envelope.command] ?? 1));
      if (!quota.ok) {
        try { this._audit('quota_refused', ctx, { quota: quota.quota }); } catch { return error(503, 'temporarily_unavailable'); }
        return { ...error(429, 'rate_limited'), headers: { 'retry-after': String(quota.retryAfter) } };
      }
    }

    const webActor = actor(ctx.principal);
    const scopeKey = hash({ userId: ctx.principal.userId, command: envelope.command, repoId: envelope.repoId, idempotencyKey: envelope.idempotencyKey });
    const requestDigest = hash(canonicalRequest(envelope));
    let admission;
    try {
      admission = this.coordination.admitWebCommand({
        commandId: envelope.commandId, scopeKey, requestDigest, command: envelope.command,
        repoId: envelope.repoId, runId: envelope.runId ?? null,
        userId: ctx.principal.userId, sessionId: ctx.principal.sessionId, credentialId: ctx.principal.credentialId,
        origin: envelope.origin, expectedFence: envelope.expectedFence ?? null,
      }, { actor: webActor, key: `web.admit:${scopeKey}` });
    } catch {
      return error(503, 'temporarily_unavailable');
    }
    if (!admission.ok) {
      try { this._audit('idempotency_refused', ctx, { command: envelope.command, repoId: envelope.repoId, reason: admission.result }); } catch { return error(503, 'temporarily_unavailable'); }
      return error(409, admission.result === 'idempotency_conflict' ? 'idempotency_conflict' : 'invalid_command');
    }
    if (admission.result === 'replay') {
      try { this._audit('command_replayed', ctx, { command: envelope.command, repoId: envelope.repoId, commandId: admission.command.commandId }); } catch { return error(503, 'temporarily_unavailable'); }
      if (admission.command.status === 'admitted') return result(202, { ok: true, commandId: admission.command.commandId, status: 'admitted', replayed: true });
      return result(admission.command.outcome.httpStatus, { ...json(admission.command.outcome.body), replayed: true });
    }

    let response;
    try {
      response = await this._dispatch(envelope, webActor);
    } catch (cause) {
      const failure = dispatchFailure(cause);
      try { this.coordination.failWebCommand(envelope.commandId, failure, { actor: webActor, key: `web.fail:${envelope.commandId}` }); } catch { /* no success is returned */ }
      void cause;
      return result(failure.httpStatus, failure.body);
    }

    const outcome = { httpStatus: response.status, body: response.body };
    try {
      this.coordination.completeWebCommand(envelope.commandId, outcome, { actor: webActor, key: `web.complete:${envelope.commandId}` });
    } catch {
      return error(503, 'temporarily_unavailable');
    }
    return response;
  }

  async _dispatch(envelope, webActor) {
    const a = envelope.args;
    let value;
    if (envelope.command === 'spawn') {
      value = await this.coordinator.spawn(a.harness, a.brief, {
        model: a.model, effort: a.effort, modelPolicy: a.modelPolicy, taskId: a.taskId ?? `web-${envelope.commandId}`,
        deps: a.deps, taskType: a.taskType, session: a.session, refines: a.refines,
        actor: webActor, idempotencyKey: `web.command:${envelope.commandId}`,
      });
    } else if (envelope.command === 'send') {
      value = await this.coordinator.send(a.workerId, a.message, a.mode, { expectedFence: envelope.expectedFence });
    } else if (envelope.command === 'interrupt') {
      value = await this.coordinator.interrupt(a.workerId, a.then, webActor, { expectedFence: envelope.expectedFence });
    } else if (envelope.command === 'kill') {
      value = await this.coordinator.kill(a.workerId, webActor, { expectedFence: envelope.expectedFence });
    } else if (envelope.command === 'respond') {
      value = await this.coordinator.respond(a.requestId, a.answer, webActor);
    } else if (envelope.command === 'list') {
      value = this.coordinator.list();
    } else if (envelope.command === 'result') {
      value = await this.coordinator.result(a.workerId);
    } else if (envelope.command === 'wait') {
      value = await this.coordinator.wait(Math.min(Number(a.timeoutMs ?? 25000), 30000));
    } else if (envelope.command === 'capabilities') {
      value = this.coordinator.capabilityCards();
    } else if (envelope.command === 'capability_invoke') {
      const capabilityCtx = { budgetTokens: a.budgetTokens, actor: webActor };
      const action = a.action ?? 'invoke';
      if (action === 'invoke') value = await this.coordinator.invokeCapability(a.name, a.op, a.args, capabilityCtx);
      else if (action === 'resume') value = await this.coordinator.resumeCapability(a.name, a.op, a.ref, a.cursor, capabilityCtx);
      else value = await this.coordinator.reverifyCapability(a.name, a.op, a.claim, a.args, capabilityCtx);
    }
    if (value?.result === 'stale_fence') return error(409, 'stale_fence');
    return result(200, { ok: true, commandId: envelope.commandId, result: json(value) });
  }

  async handle(req, res) {
    const origin = req.headers?.origin ?? null;
    if (this.edge) {
      let peerDigest = null;
      try { peerDigest = this.edge.peerDigest(req); } catch { /* bounded invalid-peer audit below */ }
      let identity;
      try { identity = this.edge.resolve(req); } catch {
        let peerQuota;
        try { peerQuota = this.edge.take('peer', peerDigest ?? this.edge.digest('peer:invalid')); }
        catch { return this._write(res, error(503, 'temporarily_unavailable')); }
        if (!peerQuota.ok) return this._write(res, { ...error(429, 'rate_limited'), headers: { 'retry-after': String(peerQuota.retryAfter) } });
        try { this._audit('proxy_refused', { origin, remoteAddress: peerDigest ? 'canonical' : null, addressDigest: peerDigest }, { reason: peerDigest ? 'invalid_forwarding' : 'invalid_peer' }); } catch { return this._write(res, error(503, 'temporarily_unavailable')); }
        return this._write(res, error(400, 'invalid_forwarding'));
      }
      req.edgeIdentity = identity;
      req.edgeAddressDigest = this.edge.digest(identity.address);
    }
    const takeEdgeQuota = (name) => {
      if (!this.edge) return null;
      const quota = this.edge.take(name, req.edgeAddressDigest);
      if (quota.ok) return null;
      try { this._audit('quota_refused', { origin }, { quota: name, addressDigest: req.edgeAddressDigest }); }
      catch { return error(503, 'temporarily_unavailable'); }
      return { ...error(429, 'rate_limited'), headers: { 'retry-after': String(quota.retryAfter) } };
    };
    let url;
    try {
      if (typeof req.url !== 'string' || req.url.length === 0 || req.url.length > 4_096
        || !req.url.startsWith('/') || req.url.startsWith('//') || /[\u0000-\u001f\u007f]/.test(req.url)
        || /%(?![0-9a-f]{2})/i.test(req.url)) throw new TypeError('invalid request target');
      url = new URL(req.url, 'https://baton.invalid');
      if (url.origin !== 'https://baton.invalid' || url.hash) throw new TypeError('invalid request target');
    } catch {
      const quotaRefusal = takeEdgeQuota('address');
      if (quotaRefusal) return this._write(res, quotaRefusal);
      try { this._audit('request_refused', { origin: this.allowedOrigins.has(origin) ? origin : null }, { reason: 'invalid_target' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(400, 'invalid_request'));
    }
    if (this.edge) {
      const name = url.pathname === '/readyz' ? 'readiness' : url.pathname === '/healthz' ? 'health' : 'address';
      const quotaRefusal = takeEdgeQuota(name);
      if (quotaRefusal) return this._write(res, quotaRefusal, origin);
      if (req.edgeIdentity.transport !== 'https') {
        try { this._audit('transport_refused', { origin, remoteAddress: 'canonical', addressDigest: req.edgeAddressDigest }, { reason: 'secure_transport_required' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable')); }
        return this._write(res, error(503, 'temporarily_unavailable'));
      }
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return this._write(res, result(200, { ok: true }));
    if (req.method === 'GET' && url.pathname === '/readyz') return this._write(res, this._readinessResponse({ origin, remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null), addressDigest: req.edgeAddressDigest ?? null }));
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'));
    if (req.method === 'GET' && url.pathname === OIDC_START_PATH) {
      return this._handleOidcStart(req, res, url, origin);
    }
    if (req.method === 'GET' && url.pathname === OIDC_CALLBACK_PATH) {
      return this._handleOidcCallback(req, res, url, origin);
    }
    if (req.method === 'GET' && (url.pathname === '/v1/session' || operatorAsset(url.pathname))) {
      return this._handleOperatorRead(req, res, url.pathname, origin);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/v1/commands/')) {
      return this._handleCommandStatus(req, res, url, origin);
    }
    if (req.method === 'POST' && AUTH_PATHS.has(url.pathname)) {
      return this._handleLifecycle(req, res, url.pathname, origin);
    }
    if (req.method === 'OPTIONS' && (['/v1/commands', '/v1/stream-tickets'].includes(url.pathname) || AUTH_PATHS.has(url.pathname))) {
      if (!this.allowedOrigins.has(origin)) return this._write(res, error(403, 'forbidden'));
      res.writeHead(204, {
        'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type,x-baton-csrf',
        'access-control-max-age': '300', vary: 'Origin', 'cache-control': 'no-store',
      });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/stream-tickets') {
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return this._write(res, error(400, 'invalid_command', 'application/json required'), origin);
      }
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      let body;
      try { body = await this._readBody(req); } catch { return this._write(res, error(400, 'invalid_command'), origin); }
      if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
      const ctx = { principal, origin, csrfToken: req.headers['x-baton-csrf'] ?? null, addressDigest: req.edgeAddressDigest ?? null, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http') };
      const authFailure = this._authenticate(ctx);
      if (authFailure) return this._write(res, authFailure, origin);
      if (principal.authMethod === 'cookie') {
        const csrfValid = string(ctx.csrfToken) && (principal.csrfTokenDigest
          ? equalDigest(tokenHash(ctx.csrfToken), principal.csrfTokenDigest)
          : ctx.csrfToken === principal.csrfToken);
        if (!csrfValid) return this._write(res, error(403, 'forbidden'), origin);
      }
      if (typeof this.stream.authorizeIssue !== 'function') return this._write(res, error(503, 'temporarily_unavailable'), origin);
      if (!this.stream.authorizeIssue(principal, origin, body?.repoId)) {
        try { this._audit('stream_ticket_refused', { principal, origin, addressDigest: req.edgeAddressDigest ?? null }, { reason: 'forbidden' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
        return this._write(res, error(403, 'forbidden'), origin);
      }
      if (this.edge) {
        const ticketQuota = this.edge.reserve('ticket', principal.credentialId);
        if (!ticketQuota.ok) {
          try { this._audit('quota_refused', { principal, origin, addressDigest: req.edgeAddressDigest ?? null }, { quota: 'ticket' }); }
          catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
          return this._write(res, error(429, 'rate_limited'), origin, { 'retry-after': String(ticketQuota.retryAfter) });
        }
        let issuance;
        try {
          if (typeof this.stream.beginIssue !== 'function') throw new TypeError('transactional ticket issuance required');
          issuance = this.stream.beginIssue(principal, origin, body?.repoId);
        }
        catch { ticketQuota.rollback(); return this._write(res, error(503, 'temporarily_unavailable'), origin); }
        const issued = issuance?.response ?? error(503, 'temporarily_unavailable');
        if (issued.status !== 201) {
          issuance?.rollback?.(); ticketQuota.rollback();
          return this._write(res, issued, origin);
        }
        try { this._write(res, issued, origin); }
        catch { issuance.rollback(); ticketQuota.rollback(); return; }
        issuance.commit(); ticketQuota.commit();
        return;
      }
      return this._write(res, this.stream.issue(principal, origin, body?.repoId), origin);
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
      const authFailure = this._authenticate({ principal, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http') });
      if (authFailure) return this._write(res, authFailure, origin);
      const responseValue = this.stream.open({
        ticket: url.searchParams.get('ticket'), principal, origin,
        cursor: req.headers['last-event-id'] ?? url.searchParams.get('cursor'),
      }, res);
      if (responseValue) return this._write(res, responseValue, origin);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/commands') return this._write(res, error(404, 'not_found'));
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return this._write(res, error(400, 'invalid_command', 'application/json required'), origin);
    let principal;
    try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
    let envelope;
    try { envelope = await this._readBody(req); } catch (cause) {
      try { this._audit('command_body_refused', { principal, origin, remoteAddress: req.socket?.remoteAddress ?? null }, { reason: cause?.code ?? 'invalid_json' }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(cause?.code === 'body_too_large' ? 413 : 400, 'invalid_command'), origin);
    }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    const response = await this.execute({
      principal, origin, csrfToken: req.headers['x-baton-csrf'] ?? null,
      remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null), addressDigest: req.edgeAddressDigest ?? null, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http'),
    }, envelope);
    return this._write(res, response, origin);
  }

  _oidcContext(req, origin) {
    return {
      origin,
      remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null),
      addressDigest: req.edgeAddressDigest ?? null,
      transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http'),
    };
  }

  async _handleOperatorRead(req, res, pathname, origin) {
    const ctx = this._oidcContext(req, origin);
    let principal;
    try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
    const authFailure = this._authenticate({ principal, transport: ctx.transport });
    if (authFailure) {
      try { this._audit('operator_read_refused', { ...ctx, principal }, { reason: 'unauthenticated' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, authFailure);
    }
    const repoId = [...this.repoIds][0];
    const sameSite = ['same-origin', 'none'].includes(req.headers?.['sec-fetch-site']);
    if (!sameSite || !principal.capabilities?.includes('observe') || !principal.repoIds?.includes(repoId)
      || (this.isPrincipalActive && !this.isPrincipalActive(principal, { repoId }))) {
      try { this._audit('operator_read_refused', { ...ctx, principal }, { reason: 'forbidden' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(403, 'forbidden'));
    }
    try { this._audit('operator_read_authorized', { ...ctx, principal }, { resourceClass: pathname === '/v1/session' ? 'session' : 'asset' }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable')); }
    if (pathname === '/v1/session') {
      return this._write(res, result(200, {
        ok: true,
        identity: { userId: principal.userId, capabilities: [...principal.capabilities], repoIds: [...principal.repoIds] },
        expiresAt: principal.expiresAt,
      }));
    }
    const asset = operatorAsset(pathname);
    const body = asset.body;
    const headers = {
      'content-type': asset.type, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    };
    res.writeHead(200, headers);
    res.end(body);
  }

  async _handleCommandStatus(req, res, url, origin) {
    const ctx = this._oidcContext(req, origin);
    let principal;
    try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
    const authFailure = this._authenticate({ principal, transport: ctx.transport });
    if (authFailure) {
      try { this._audit('command_status_refused', { ...ctx, principal }, { reason: 'unauthenticated' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, authFailure);
    }
    const sameSite = principal.authMethod !== 'cookie' || ['same-origin', 'none'].includes(req.headers?.['sec-fetch-site']);
    const servedRepo = [...this.repoIds][0];
    if (!sameSite || !principal.capabilities?.includes('observe') || !principal.repoIds?.includes(servedRepo)
      || (this.isPrincipalActive && !this.isPrincipalActive(principal, { repoId: servedRepo }))) {
      try { this._audit('command_status_refused', { ...ctx, principal }, { reason: 'forbidden' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(403, 'forbidden'));
    }
    const encoded = url.pathname.slice('/v1/commands/'.length);
    const commandId = /^[A-Za-z0-9._:-]{1,128}$/.test(encoded) && url.search === '' ? encoded : null;
    const command = commandId ? this.coordination.webCommand(commandId) : null;
    const owned = command && string(command.userId) && command.userId === principal.userId
      && command.repoId === servedRepo;
    if (!owned) {
      try { this._audit('command_status_refused', { ...ctx, principal }, { reason: 'not_found_or_forbidden' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(404, 'not_found'));
    }
    try { this._audit('command_status_authorized', { ...ctx, principal }, { commandDigest: hash(command.commandId), status: command.status }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable')); }
    return this._write(res, result(200, { ok: true, command: {
      commandId: command.commandId, command: command.command, repoId: command.repoId,
      runId: command.runId ?? null, expectedFence: command.expectedFence ?? null,
      status: command.status, admittedAt: command.admittedAt, completedAt: command.completedAt ?? null,
      outcome: command.outcome == null ? null : json(command.outcome),
    } }));
  }

  _validOidcNavigation(req, origin, callback = false) {
    if (req.headers?.['sec-fetch-mode'] !== 'navigate') return false;
    if (req.headers?.['sec-fetch-dest'] !== 'document') return false;
    const site = req.headers?.['sec-fetch-site'];
    const allowedSites = callback ? new Set(['cross-site', 'same-origin', 'none']) : new Set(['same-origin', 'none']);
    if (!allowedSites.has(site)) return false;
    if (callback) return origin == null;
    return origin == null || this.allowedOrigins.has(origin);
  }

  _writeRedirect(res, status, location, setCookie) {
    const headers = {
      location, 'content-length': '0', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      ...(setCookie ? { 'set-cookie': setCookie } : {}),
    };
    res.writeHead(status, headers);
    res.end();
  }

  _handleOidcStart(req, res, url, origin) {
    const ctx = this._oidcContext(req, origin);
    if (!this.oidc) return this._write(res, error(404, 'not_found'));
    if (ctx.transport !== 'https' || url.search !== '' || !this._validOidcNavigation(req, origin, false)) {
      try { this._audit('oidc_start_refused', ctx, { reason: 'request_policy' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable')); }
      return this._write(res, error(ctx.transport === 'https' ? 403 : 503, ctx.transport === 'https' ? 'forbidden' : 'temporarily_unavailable'));
    }
    if (this.edge) {
      const quota = this.edge.take('login', ctx.addressDigest);
      if (!quota.ok) {
        try { this._audit('quota_refused', ctx, { quota: 'login' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable')); }
        return this._write(res, error(429, 'rate_limited'), null, { 'retry-after': String(quota.retryAfter) });
      }
    }
    try { this._audit('oidc_start_requested', ctx, { providerClass: 'oidc' }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable')); }
    let started;
    try { started = this.oidc.begin(); }
    catch (cause) {
      return this._write(res, error(cause?.code === 'flow_capacity' ? 429 : 503, cause?.code === 'flow_capacity' ? 'rate_limited' : 'temporarily_unavailable'));
    }
    try {
      this._writeRedirect(res, 302, started.location, started.setCookie);
      started.commit();
    } catch (cause) {
      started.rollback();
      throw cause;
    }
  }

  async _handleOidcCallback(req, res, url, origin) {
    const ctx = this._oidcContext(req, origin);
    const clearCookie = this.oidc?.clearCookie?.();
    const refuse = (status, code, reason) => {
      try { this._audit('oidc_callback_refused', ctx, { reason }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), null, clearCookie ? { 'set-cookie': clearCookie } : {}); }
      return this._write(res, error(status, code), null, clearCookie ? { 'set-cookie': clearCookie } : {});
    };
    if (!this.oidc) return this._write(res, error(404, 'not_found'));
    if (ctx.transport !== 'https' || !this._validOidcNavigation(req, origin, true)) {
      return refuse(ctx.transport === 'https' ? 403 : 503, ctx.transport === 'https' ? 'forbidden' : 'temporarily_unavailable', 'request_policy');
    }
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => !['code', 'state'].includes(key))
      || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('state').length !== 1) {
      return refuse(400, 'invalid_request', 'invalid_callback');
    }
    let claims;
    try {
      claims = await this.oidc.complete({
        code: url.searchParams.get('code'), state: url.searchParams.get('state'),
        cookieHeader: req.headers?.cookie,
      });
    } catch (cause) {
      return refuse(cause?.code === 'provider_refused' || cause?.code === 'identity_mismatch' || cause?.code === 'claims_refused' ? 401 : 400,
        cause?.code === 'provider_refused' || cause?.code === 'identity_mismatch' || cause?.code === 'claims_refused' ? 'unauthenticated' : 'invalid_request',
        cause?.code ?? 'invalid_flow');
    }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), null, { 'set-cookie': clearCookie });
    if (!this.sessions || !this.sessions.validateIssue?.(claims)) return refuse(401, 'unauthenticated', 'claims_refused');
    try {
      this._audit('oidc_callback_authorized', {
        ...ctx, principal: { userId: claims.userId, sessionId: 'pending', credentialId: 'pending' },
      }, { authMethod: 'cookie', providerClass: 'oidc' });
    } catch {
      return this._write(res, error(503, 'temporarily_unavailable'), null, { 'set-cookie': clearCookie });
    }
    let issued;
    try { issued = this.sessions.issue(claims, { actor: `web:${claims.userId}:oidc` }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), null, { 'set-cookie': clearCookie }); }
    const maxAge = Math.max(1, Math.floor((Date.parse(issued.expiresAt) - this.now()) / 1000));
    const cookies = [issued.setCookie, csrfCookie(issued.csrfToken, maxAge), clearCookie];
    try {
      this._writeRedirect(res, 303, '/control', cookies);
    } catch (cause) {
      try { this.sessions.revoke(issued.sessionId, { actor: `web:${claims.userId}:oidc`, reason: 'delivery_failed' }); } catch { /* durable issue remains visible */ }
      try { this._audit('oidc_callback_delivery_failed', ctx, { reason: 'response_delivery' }); } catch { /* transport already failed */ }
      throw cause;
    }
  }

  async _handleLifecycle(req, res, pathname, origin) {
    const ctx = { origin, remoteAddress: req.edgeAddressDigest ? 'canonical' : (req.socket?.remoteAddress ?? null), addressDigest: req.edgeAddressDigest ?? null, transport: req.edgeIdentity?.transport ?? (req.socket?.encrypted ? 'https' : 'http') };
    const audit = (kind, principal = null, details = {}) => this._audit(kind, { ...ctx, principal }, details);
    if (ctx.transport !== 'https' || !this.allowedOrigins.has(origin)) {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', null, { reason: 'request_policy' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(ctx.transport !== 'https' ? 503 : 403, ctx.transport !== 'https' ? 'temporarily_unavailable' : 'forbidden'), origin);
    }
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', null, { reason: 'content_type' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(415, 'unsupported_media_type'), origin);
    }
    let principal = null;
    if (pathname !== '/v1/auth/login') {
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
    }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    let body;
    try { body = await this._readBody(req); }
    catch (cause) {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: cause?.code ?? 'invalid_json' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(cause?.code === 'body_too_large' ? 413 : 400, 'invalid_request'), origin);
    }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    if (!isRecord(body)) {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: 'invalid_body' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(400, 'invalid_request'), origin);
    }
    if (pathname === '/v1/auth/login') return this._login(res, body, ctx);
    if (!principal) {
      try { audit(pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', null, { reason: 'unauthenticated' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(401, 'unauthenticated'), origin);
    }
    if (principal.authMethod === 'cookie') {
      const supplied = req.headers['x-baton-csrf'];
      if (!string(supplied) || !principal.csrfTokenDigest || !equalDigest(tokenHash(supplied), principal.csrfTokenDigest)) {
        try { audit(pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: 'csrf' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
        return this._write(res, error(403, 'forbidden'), origin);
      }
    }
    if (Object.keys(body).length !== 0) {
      try { audit(pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: 'invalid_body' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(400, 'invalid_request'), origin);
    }
    return pathname === '/v1/auth/refresh' ? this._refresh(res, principal, origin) : this._logout(res, principal, origin);
  }

  async _login(res, body, ctx) {
    const refused = async () => {
      try { this._audit('login_refused', ctx, { reason: 'unauthenticated' }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
      return this._write(res, error(401, 'unauthenticated'), ctx.origin);
    };
    if (!this.sessions || typeof this.identityProvider !== 'function') return refused();
    if (this.edge) {
      const login = this.edge.take('login', ctx.addressDigest);
      if (!login.ok) {
        try { this._audit('quota_refused', ctx, { quota: 'login' }); }
        catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
        return this._write(res, error(429, 'rate_limited'), ctx.origin, { 'retry-after': String(login.retryAfter) });
      }
    }
    let claims;
    try { claims = await this.identityProvider(json(body), Object.freeze({ origin: ctx.origin, transport: 'https' })); } catch { return refused(); }
    if (!this._admissionOpen()) return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin);
    if (!claims || !validProviderClaims(claims) || !this.sessions.validateIssue?.(claims)) return refused();
    try { this._audit('login_authorized', { ...ctx, principal: { userId: claims.userId, sessionId: 'pending', credentialId: 'pending' } }, { authMethod: claims.authMethod }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
    let issued;
    try { issued = this.sessions.issue(claims, { actor: `web:${claims.userId}:login` }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
    return this._credentialResponse(res, claims, issued, ctx.origin, 201);
  }

  _refresh(res, principal, origin) {
    if (!this.sessions) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    try { this._audit('refresh_authorized', { principal, origin }, { authMethod: principal.authMethod }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    let issued;
    try { issued = this.sessions?.rotate(principal.sessionId, { actor: actor(principal) }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    if (!issued) return this._write(res, error(401, 'unauthenticated'), origin);
    return this._credentialResponse(res, principal, issued, origin, 200);
  }

  _logout(res, principal, origin) {
    if (!this.sessions) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    try { this._audit('logout_authorized', { principal, origin }, { authMethod: principal.authMethod }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    try { this.sessions?.revoke(principal.sessionId, { actor: actor(principal), reason: 'logout' }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    const headers = principal.authMethod === 'cookie' ? { 'set-cookie': [
      '__Host-baton_session=; Max-Age=0; Secure; HttpOnly; SameSite=Strict; Path=/',
      '__Host-baton_csrf=; Max-Age=0; Secure; SameSite=Strict; Path=/',
    ] } : {};
    return this._write(res, result(200, { ok: true }), origin, headers);
  }

  _credentialResponse(res, identity, issued, origin, status) {
    const body = { ok: true, identity: { userId: identity.userId, capabilities: [...identity.capabilities], repoIds: [...identity.repoIds] }, expiresAt: issued.expiresAt };
    const headers = {};
    if (identity.authMethod === 'cookie') {
      body.csrfToken = issued.csrfToken;
      const maxAge = Math.max(1, Math.floor((Date.parse(issued.expiresAt) - this.now()) / 1000));
      headers['set-cookie'] = [issued.setCookie, csrfCookie(issued.csrfToken, maxAge)];
    }
    else body.token = issued.token;
    return this._write(res, result(status, body), origin, headers);
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > this.maxBodyBytes) { const cause = new Error('body too large'); cause.code = 'body_too_large'; reject(cause); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (cause) { reject(cause); } });
      req.on('error', reject);
    });
  }

  _write(res, response, origin = null, extraHeaders = {}) {
    const body = JSON.stringify(response.body);
    const headers = { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(response.headers ?? {}), ...extraHeaders };
    if (origin && this.allowedOrigins.has(origin)) Object.assign(headers, { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' });
    res.writeHead(response.status, headers);
    res.end(body);
  }

  shutdown({ server, drainMs = 5_000 } = {}) {
    if (this._shutdown) return this._shutdown;
    if (!Number.isSafeInteger(drainMs) || drainMs <= 0) throw new TypeError('drainMs must be a positive safe integer');
    this.admitting = false; this.edge?.closeAdmission();
    this._shutdown = (async () => {
      let auditOk = true;
      try { this._audit('shutdown_started', {}); } catch { auditOk = false; }
      let streamOk = true;
      try { this.stream.shutdown?.(); } catch { streamOk = false; }
      let closed = !server?.close;
      const closePromise = new Promise((resolve) => {
        if (!server?.close) return resolve(true);
        try { server.close(() => { closed = true; resolve(true); }); } catch { resolve(false); }
      });
      const timedOut = await Promise.race([closePromise.then(() => false), new Promise((resolve) => setTimeout(() => resolve(true), drainMs))]);
      if (timedOut && !closed) {
        try { server.closeIdleConnections?.(); } catch {}
        try { server.closeAllConnections?.(); } catch {}
        await Promise.race([closePromise, new Promise((resolve) => setTimeout(resolve, Math.min(1_000, drainMs)))]);
      }
      const outcome = closed ? 'shutdown_completed' : 'shutdown_timed_out';
      try { this._audit(outcome, {}, { streamShutdownOk: streamOk }); } catch { auditOk = false; }
      return {
        ok: closed && auditOk && streamOk,
        result: !closed ? 'timed_out' : !auditOk && !streamOk ? 'closed_degraded'
          : !auditOk ? 'closed_audit_unavailable' : !streamOk ? 'closed_stream_unavailable' : 'closed',
      };
    })();
    return this._shutdown;
  }
}

export function createAuthenticatedWebServer(northbound, opts = {}) {
  if (!(northbound instanceof WebNorthbound)) throw new TypeError('WebNorthbound required');
  if (typeof northbound.authenticate !== 'function') throw new TypeError('an authenticator is required');
  const requireReadiness = () => {
    if (!(northbound.readinessAuthority instanceof WebReadinessAuthority)
      || northbound.readinessAuthority.coordination !== northbound.coordination
      || northbound.readinessAuthority.sessions !== northbound.sessions
      || northbound.readinessAuthority.authenticate !== northbound.authenticate) {
      throw new TypeError('production web server requires a WebReadinessAuthority bound to its coordination, session, and authentication authorities');
    }
  };
  const proxyCleartext = opts.proxy?.cleartextBackend === true;
  let server;
  if (proxyCleartext) {
    if (!(northbound.edge instanceof WebEdgePolicy) || !northbound.edge.proxyMode || northbound.edge.trustedProxies.length === 0) throw new TypeError('cleartext proxy backend requires an explicit trusted-proxy edge policy');
    requireReadiness();
    if (opts.tls?.key || opts.tls?.cert) throw new TypeError('choose direct TLS or cleartext trusted-proxy backend, not both');
    server = createHttpServer((req, res) => northbound.handle(req, res));
  } else {
    if (!opts.tls?.key || !opts.tls?.cert) throw new TypeError('TLS key and certificate are required');
    if (!(northbound.edge instanceof WebEdgePolicy)) throw new TypeError('production web server requires a WebEdgePolicy');
    requireReadiness();
    if (northbound.edge.proxyMode) throw new TypeError('direct TLS requires a direct-mode edge policy');
    server = createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert, minVersion: 'TLSv1.2' }, (req, res) => northbound.handle(req, res));
  }
  server.batonShutdown = (shutdownOpts = {}) => northbound.shutdown({ ...shutdownOpts, server });
  return server;
}

export { validateEnvelope as validateWebCommandEnvelope };
