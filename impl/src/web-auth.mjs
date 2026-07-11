import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const COOKIE_NAME = '__Host-baton_session';

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function digest(token) { return createHash('sha256').update(token).digest('hex'); }
function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:@-]{1,128}$/.test(value); }
function validStringArray(value) { return Array.isArray(value) && value.length > 0 && value.every(validId); }
function token() { return randomBytes(32).toString('base64url'); }

function cookieTokens(header) {
  if (typeof header !== 'string' || Buffer.byteLength(header) > 4096) return [];
  return header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE_NAME}=`)).map((part) => part.slice(COOKIE_NAME.length + 1));
}

export class WebSessionIntegrityError extends Error {
  constructor(message, code = 'session_integrity') { super(message); this.name = 'WebSessionIntegrityError'; this.code = code; }
}

export class WebSessionStore {
  constructor(root, opts = {}) {
    this.root = root;
    this.file = join(root, 'sessions.jsonl');
    this.now = opts.now ?? Date.now;
    this.maxTtlMs = opts.maxTtlMs ?? 24 * 60 * 60 * 1000;
    this.maxCredentialBytes = opts.maxCredentialBytes ?? 512;
    this._appendFile = opts.appendFile ?? appendFileSync;
    this._events = [];
    this._sessions = new Map();
    this._byDigest = new Map();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    if (!existsSync(this.file)) closeSync(openSync(this.file, 'a', 0o600));
    chmodSync(this.file, 0o600);
    this._load();
  }

  _load() {
    const raw = readFileSync(this.file, 'utf8');
    if (raw.length === 0) return;
    if (!raw.endsWith('\n')) throw new WebSessionIntegrityError('session stream has a truncated tail', 'truncated_tail');
    const lines = raw.slice(0, -1).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      let event;
      try { event = JSON.parse(lines[i]); } catch { throw new WebSessionIntegrityError(`invalid session JSON at line ${i + 1}`, 'invalid_json'); }
      if (event.schemaVersion !== 1) throw new WebSessionIntegrityError(`unsupported session schema at line ${i + 1}`, 'schema_version');
      if (event.seq !== i + 1) throw new WebSessionIntegrityError(`session sequence gap at line ${i + 1}`, 'sequence_gap');
      this._apply(freeze(event));
      this._events.push(freeze(event));
    }
  }

  _append(kind, actor, payload) {
    if (!validId(actor)) throw new TypeError('session audit actor required');
    const event = freeze({ schemaVersion: 1, seq: this._events.length + 1, ts: new Date(this.now()).toISOString(), kind, actor, payload: freeze(clone(payload)) });
    this._appendFile(this.file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    this._apply(event);
    this._events.push(event);
    return event;
  }

  _apply(event) {
    const p = event.payload;
    if (event.kind === 'session.issued') {
      if (this._sessions.has(p.sessionId) || this._byDigest.has(p.tokenDigest)) throw new WebSessionIntegrityError('duplicate session credential', 'duplicate_credential');
      const session = freeze({ ...clone(p), revoked: false, issuedEvent: event.seq, revokedEvent: null });
      this._sessions.set(p.sessionId, session);
      this._byDigest.set(p.tokenDigest, p.sessionId);
    } else if (event.kind === 'session.revoked') {
      const old = this._sessions.get(p.sessionId);
      if (!old || old.revoked) throw new WebSessionIntegrityError('revocation does not reference an active session', 'invalid_revocation');
      this._sessions.set(p.sessionId, freeze({ ...clone(old), revoked: true, revokedEvent: event.seq, revokedReason: p.reason ?? null }));
    } else throw new WebSessionIntegrityError(`unknown session event ${event.kind}`, 'unknown_event');
  }

  events() { return this._events.map(clone); }

  issue(fields, auth = {}) {
    if (!validId(fields?.userId)) throw new TypeError('session userId required');
    if (!['cookie', 'bearer'].includes(fields.authMethod)) throw new TypeError('session authMethod must be cookie or bearer');
    if (!validStringArray(fields.capabilities) || !validStringArray(fields.repoIds)) throw new TypeError('session capabilities and repoIds are required');
    if (!Number.isInteger(fields.ttlMs) || fields.ttlMs <= 0 || fields.ttlMs > this.maxTtlMs) throw new TypeError('session ttlMs is outside policy');
    const rawToken = token();
    const rawCsrf = fields.authMethod === 'cookie' ? token() : null;
    const issuedAtMs = this.now();
    const sessionId = randomUUID();
    const credentialId = randomUUID();
    const payload = {
      sessionId, credentialId, userId: fields.userId, authMethod: fields.authMethod,
      capabilities: [...fields.capabilities], repoIds: [...fields.repoIds], tokenDigest: digest(rawToken),
      ...(rawCsrf ? { csrfTokenDigest: digest(rawCsrf) } : {}),
      issuedAt: new Date(issuedAtMs).toISOString(), expiresAt: new Date(issuedAtMs + fields.ttlMs).toISOString(),
    };
    this._append('session.issued', auth.actor, payload);
    const maxAge = Math.floor(fields.ttlMs / 1000);
    return freeze({
      sessionId, credentialId, token: rawToken, ...(rawCsrf ? { csrfToken: rawCsrf } : {}),
      expiresAt: payload.expiresAt,
      ...(fields.authMethod === 'cookie' ? { setCookie: `${COOKIE_NAME}=${rawToken}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict; Path=/` } : {}),
    });
  }

  revoke(sessionId, auth = {}) {
    const session = this._sessions.get(sessionId);
    if (!session || session.revoked) return freeze({ ok: true, result: 'not_active' });
    const event = this._append('session.revoked', auth.actor, { sessionId, reason: auth.reason ?? null });
    return freeze({ ok: true, result: 'revoked', event: clone(event), clearCookie: `${COOKIE_NAME}=; Max-Age=0; Secure; HttpOnly; SameSite=Strict; Path=/` });
  }

  authenticate(req) {
    const authorization = req?.headers?.authorization;
    const cookies = cookieTokens(req?.headers?.cookie);
    if (authorization !== undefined && cookies.length > 0) return null;
    let rawToken; let authMethod;
    if (authorization !== undefined) {
      if (typeof authorization !== 'string' || Buffer.byteLength(authorization) > this.maxCredentialBytes) return null;
      const match = /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(authorization);
      if (!match) return null;
      rawToken = match[1]; authMethod = 'bearer';
    } else if (cookies.length === 1) {
      if (Buffer.byteLength(cookies[0]) > this.maxCredentialBytes || !/^[A-Za-z0-9_-]{40,128}$/.test(cookies[0])) return null;
      rawToken = cookies[0]; authMethod = 'cookie';
    } else return null;
    const sessionId = this._byDigest.get(digest(rawToken));
    const session = this._sessions.get(sessionId);
    if (!session || session.revoked || session.authMethod !== authMethod || Date.parse(session.expiresAt) <= this.now()) return null;
    return freeze({
      userId: session.userId, sessionId: session.sessionId, credentialId: session.credentialId,
      authMethod: session.authMethod, issuedAt: session.issuedAt, expiresAt: session.expiresAt,
      capabilities: [...session.capabilities], repoIds: [...session.repoIds], revoked: false,
      ...(session.csrfTokenDigest ? { csrfTokenDigest: session.csrfTokenDigest } : {}),
    });
  }

  authenticator() { return (req) => this.authenticate(req); }
}

export { COOKIE_NAME as WEB_SESSION_COOKIE_NAME };
