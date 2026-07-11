import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpsServer } from 'node:https';
import { WebEventStream } from './web-stream.mjs';

const COMMAND_CAPABILITY = Object.freeze({
  spawn: 'control', send: 'control', interrupt: 'control', kill: 'emergency_stop', respond: 'approve',
  list: 'observe', result: 'observe', wait: 'observe',
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
});
const FORBIDDEN_KEY = /^(?:access[_-]?token|refresh[_-]?token|token|secret|credential|password|api[_-]?key|authorization)$/i;
const MODEL_POLICY_FIELDS = new Set(['allow', 'deny', 'prefer', 'allowFamilies', 'denyFamilies', 'reasoningEffort', 'serviceTier']);
const AUTH_PATHS = new Set(['/v1/auth/login', '/v1/auth/refresh', '/v1/auth/logout']);

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
  if (unknown) return `unknown command field: ${unknown}`;
  if (envelope.schemaVersion !== 1) return 'unsupported schemaVersion';
  if (!string(envelope.commandId) || !string(envelope.idempotencyKey) || !string(envelope.command) || !string(envelope.repoId) || !string(envelope.origin)) return 'command identity, idempotencyKey, repoId, and origin are required';
  if (!Object.hasOwn(COMMAND_CAPABILITY, envelope.command)) return 'unsupported command';
  if (!isRecord(envelope.args)) return 'args must be an object';
  const allowed = ARG_FIELDS[envelope.command];
  const unknownArg = Object.keys(envelope.args).find((key) => !allowed.has(key));
  if (unknownArg) return `unknown ${envelope.command} argument: ${unknownArg}`;
  if (containsForbiddenKey(envelope.args)) return 'credential-bearing command fields are forbidden';
  if (FENCE_REQUIRED.has(envelope.command) && !Number.isInteger(envelope.expectedFence)) return `${envelope.command} requires expectedFence`;
  if (envelope.command === 'spawn') {
    if (!string(envelope.args.harness) || !isRecord(envelope.args.brief)) return 'spawn requires harness and brief';
    if (Object.hasOwn(envelope.args, 'model') && !string(envelope.args.model)) return 'model must be a non-empty string';
    if (Object.hasOwn(envelope.args, 'effort') && !string(envelope.args.effort)) return 'effort must be a non-empty string';
    if (Object.hasOwn(envelope.args, 'modelPolicy') && !isRecord(envelope.args.modelPolicy)) return 'modelPolicy must be an object';
    if (isRecord(envelope.args.modelPolicy)) {
      const unknownPolicy = Object.keys(envelope.args.modelPolicy).find((key) => !MODEL_POLICY_FIELDS.has(key));
      if (unknownPolicy) return `unknown modelPolicy field: ${unknownPolicy}`;
    }
  }
  if (['send', 'interrupt', 'kill', 'result'].includes(envelope.command) && !string(envelope.args.workerId)) return `${envelope.command} requires workerId`;
  if (envelope.command === 'send' && (!string(envelope.args.message) || !['turn', 'steer', 'nudge'].includes(envelope.args.mode))) return 'send requires message and a valid mode';
  if (envelope.command === 'respond' && (!string(envelope.args.requestId) || !Object.hasOwn(envelope.args, 'answer'))) return 'respond requires requestId and answer';
  return null;
}

function canonicalRequest(envelope) {
  const { commandId: _commandId, clientObservedCursor: _cursor, ...semantic } = envelope;
  return semantic;
}

export class WebNorthbound {
  constructor(opts) {
    if (!opts?.coordinator || !opts?.coordination) throw new TypeError('web northbound requires coordinator and coordination authority');
    for (const method of ['admitWebCommand', 'completeWebCommand', 'failWebCommand', 'recordWebAudit']) {
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
    if (!this.authenticate && this.sessions) this.authenticate = this.sessions.authenticator();
    this.isPrincipalActive = opts.isPrincipalActive ?? this.authenticate?.isPrincipalActive ?? null;
    this.maxBodyBytes = opts.maxBodyBytes ?? 64 * 1024;
    this.stream = opts.stream ?? new WebEventStream({
      ...opts, coordination: this.coordination,
      allowedOrigins: [...this.allowedOrigins], repoIds: [...this.repoIds],
      isPrincipalActive: this.isPrincipalActive,
    });
  }

  _audit(kind, ctx, details = {}) {
    const principal = ctx?.principal;
    const auditActor = principal ? actor(principal) : 'web:anonymous';
    return this.coordination.recordWebAudit({
      kind, userId: principal?.userId ?? null, sessionId: principal?.sessionId ?? null,
      credentialId: principal?.credentialId ?? null, origin: ctx?.origin ?? null,
      remoteAddressClass: ctx?.remoteAddress ? 'present' : 'absent', ...json(details),
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

    const webActor = actor(ctx.principal);
    const scopeKey = hash({ userId: ctx.principal.userId, command: envelope.command, repoId: envelope.repoId, idempotencyKey: envelope.idempotencyKey });
    const requestDigest = hash(canonicalRequest(envelope));
    let admission;
    try {
      admission = this.coordination.admitWebCommand({
        commandId: envelope.commandId, scopeKey, requestDigest, command: envelope.command,
        repoId: envelope.repoId, runId: envelope.runId ?? null, credentialId: ctx.principal.credentialId,
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
    }
    if (value?.result === 'stale_fence') return error(409, 'stale_fence');
    return result(200, { ok: true, commandId: envelope.commandId, result: json(value) });
  }

  async handle(req, res) {
    const origin = req.headers.origin ?? null;
    const url = new URL(req.url, 'https://baton.invalid');
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
      const ctx = { principal, origin, csrfToken: req.headers['x-baton-csrf'] ?? null, transport: req.socket?.encrypted ? 'https' : 'http' };
      const authFailure = this._authenticate(ctx);
      if (authFailure) return this._write(res, authFailure, origin);
      if (principal.authMethod === 'cookie') {
        const csrfValid = string(ctx.csrfToken) && (principal.csrfTokenDigest
          ? equalDigest(tokenHash(ctx.csrfToken), principal.csrfTokenDigest)
          : ctx.csrfToken === principal.csrfToken);
        if (!csrfValid) return this._write(res, error(403, 'forbidden'), origin);
      }
      return this._write(res, this.stream.issue(principal, origin, body?.repoId), origin);
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      let principal;
      try { principal = await this.authenticate?.(req) ?? null; } catch { principal = null; }
      const authFailure = this._authenticate({ principal, transport: req.socket?.encrypted ? 'https' : 'http' });
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
    const response = await this.execute({
      principal, origin, csrfToken: req.headers['x-baton-csrf'] ?? null,
      remoteAddress: req.socket?.remoteAddress ?? null, transport: req.socket?.encrypted ? 'https' : 'http',
    }, envelope);
    return this._write(res, response, origin);
  }

  async _handleLifecycle(req, res, pathname, origin) {
    const ctx = { origin, remoteAddress: req.socket?.remoteAddress ?? null };
    const audit = (kind, principal = null, details = {}) => this._audit(kind, { ...ctx, principal }, details);
    if (!req.socket?.encrypted || !this.allowedOrigins.has(origin)) {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', null, { reason: 'request_policy' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(!req.socket?.encrypted ? 503 : 403, !req.socket?.encrypted ? 'temporarily_unavailable' : 'forbidden'), origin);
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
    let body;
    try { body = await this._readBody(req); }
    catch (cause) {
      try { audit(pathname.endsWith('login') ? 'login_refused' : pathname.endsWith('refresh') ? 'refresh_refused' : 'logout_refused', principal, { reason: cause?.code ?? 'invalid_json' }); }
      catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
      return this._write(res, error(cause?.code === 'body_too_large' ? 413 : 400, 'invalid_request'), origin);
    }
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
    let claims;
    try { claims = await this.identityProvider(json(body), Object.freeze({ origin: ctx.origin, transport: 'https' })); } catch { return refused(); }
    if (!claims || !validProviderClaims(claims)) return refused();
    let issued;
    try { issued = this.sessions.issue(claims, { actor: `web:${claims.userId}:login` }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
    try { this._audit('login_issued', { ...ctx, principal: { userId: claims.userId, sessionId: issued.sessionId, credentialId: issued.credentialId } }, { authMethod: claims.authMethod, expiresAt: issued.expiresAt }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), ctx.origin); }
    return this._credentialResponse(res, claims, issued, ctx.origin, 201);
  }

  _refresh(res, principal, origin) {
    if (!this.sessions) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    let issued;
    try { issued = this.sessions?.rotate(principal.sessionId, { actor: actor(principal) }); } catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    if (!issued) return this._write(res, error(401, 'unauthenticated'), origin);
    try { this._audit('session_rotated', { principal, origin }, { successorCredentialId: issued.credentialId, expiresAt: issued.expiresAt }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    return this._credentialResponse(res, principal, issued, origin, 200);
  }

  _logout(res, principal, origin) {
    if (!this.sessions) return this._write(res, error(503, 'temporarily_unavailable'), origin);
    try { this.sessions?.revoke(principal.sessionId, { actor: actor(principal), reason: 'logout' }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    try { this._audit('session_revoked', { principal, origin }, { reason: 'logout' }); }
    catch { return this._write(res, error(503, 'temporarily_unavailable'), origin); }
    const headers = principal.authMethod === 'cookie' ? { 'set-cookie': '__Host-baton_session=; Max-Age=0; Secure; HttpOnly; SameSite=Strict; Path=/' } : {};
    return this._write(res, result(200, { ok: true }), origin, headers);
  }

  _credentialResponse(res, identity, issued, origin, status) {
    const body = { ok: true, identity: { userId: identity.userId, capabilities: [...identity.capabilities], repoIds: [...identity.repoIds] }, expiresAt: issued.expiresAt };
    const headers = {};
    if (identity.authMethod === 'cookie') { body.csrfToken = issued.csrfToken; headers['set-cookie'] = issued.setCookie; }
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
    const headers = { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extraHeaders };
    if (origin && this.allowedOrigins.has(origin)) Object.assign(headers, { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' });
    res.writeHead(response.status, headers);
    res.end(body);
  }
}

export function createAuthenticatedWebServer(northbound, opts = {}) {
  if (!(northbound instanceof WebNorthbound)) throw new TypeError('WebNorthbound required');
  if (!opts.tls?.key || !opts.tls?.cert) throw new TypeError('TLS key and certificate are required');
  if (typeof northbound.authenticate !== 'function') throw new TypeError('an authenticator is required');
  return createHttpsServer({ key: opts.tls.key, cert: opts.tls.cert, minVersion: 'TLSv1.2' }, (req, res) => northbound.handle(req, res));
}

export { validateEnvelope as validateWebCommandEnvelope };
