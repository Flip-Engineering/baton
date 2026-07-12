import { createHash, randomBytes as cryptoRandomBytes, timingSafeEqual } from 'node:crypto';

export const OIDC_FLOW_COOKIE_NAME = '__Host-baton_oidc';
export const WEB_CSRF_COOKIE_NAME = '__Host-baton_csrf';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const token = (randomBytes) => {
  const bytes = randomBytes(32);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw new TypeError('OIDC randomness must return 32 bytes');
  return bytes.toString('base64url');
};
const validText = (value, max = 256) => typeof value === 'string' && value.length > 0
  && Buffer.byteLength(value) <= max && !/[\u0000-\u001f\u007f]/.test(value);
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9._:@-]{1,128}$/.test(value);
const validArray = (value) => Array.isArray(value) && value.length > 0 && value.every(validId);

function endpoint(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${name} must be an HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${name} must be an unambiguous HTTPS URL`);
  }
  return url;
}

function cookieValues(header, name) {
  if (typeof header !== 'string' || Buffer.byteLength(header) > 4096) return [];
  return header.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
}

function equalToken(left, right) {
  const a = Buffer.from(digest(left), 'hex');
  const b = Buffer.from(right, 'hex');
  if (a.length !== 32 || b.length !== 32) return false;
  return timingSafeEqual(a, b);
}

function validMappedClaims(value) {
  if (!record(value)) return false;
  const allowed = new Set(['userId', 'capabilities', 'repoIds', 'ttlMs']);
  return !Object.keys(value).some((key) => !allowed.has(key))
    && validId(value.userId) && validArray(value.capabilities) && validArray(value.repoIds)
    && Number.isSafeInteger(value.ttlMs) && value.ttlMs > 0;
}

export class OidcFlowError extends Error {
  constructor(message, code = 'invalid_flow') {
    super(message);
    this.name = 'OidcFlowError';
    this.code = code;
  }
}

export class OidcBrowserFlow {
  constructor(opts = {}) {
    this.authorizationEndpoint = endpoint(opts.authorizationEndpoint, 'authorizationEndpoint');
    endpoint(opts.issuer, 'issuer');
    this.issuer = opts.issuer;
    this.redirectUri = endpoint(opts.redirectUri, 'redirectUri');
    if (!validText(opts.clientId, 256)) throw new TypeError('clientId is required');
    this.clientId = opts.clientId;
    this.scopes = opts.scopes ?? ['openid'];
    if (!Array.isArray(this.scopes) || !this.scopes.includes('openid') || this.scopes.length > 16
      || new Set(this.scopes).size !== this.scopes.length
      || this.scopes.some((scope) => !/^[A-Za-z0-9._:-]{1,64}$/.test(scope))) {
      throw new TypeError('OIDC scopes must be unique, bounded, and include openid');
    }
    if (typeof opts.completeAuthorization !== 'function' || typeof opts.mapClaims !== 'function') {
      throw new TypeError('OIDC completion and claims mapper callbacks are required');
    }
    this.completeAuthorization = opts.completeAuthorization;
    this.mapClaims = opts.mapClaims;
    this.now = opts.now ?? Date.now;
    this.randomBytes = opts.randomBytes ?? cryptoRandomBytes;
    this.flowTtlMs = opts.flowTtlMs ?? 300_000;
    this.maxPending = opts.maxPending ?? 128;
    this.providerTimeoutMs = opts.providerTimeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.flowTtlMs) || this.flowTtlMs < 1_000 || this.flowTtlMs > 600_000) {
      throw new TypeError('flowTtlMs must be between 1 second and 10 minutes');
    }
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending <= 0 || this.maxPending > 10_000) {
      throw new TypeError('maxPending must be a positive bounded integer');
    }
    if (!Number.isSafeInteger(this.providerTimeoutMs) || this.providerTimeoutMs < 10 || this.providerTimeoutMs > 60_000) {
      throw new TypeError('providerTimeoutMs must be between 10 ms and 1 minute');
    }
    this.pending = new Map();
    this.active = 0;
    this.detached = 0;
    this.lastNow = null;
  }

  _time() {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0 || (this.lastNow !== null && value < this.lastNow)) {
      throw new OidcFlowError('OIDC clock is invalid', 'clock_invalid');
    }
    this.lastNow = value;
    return value;
  }

  _prune(now) {
    for (const [key, flow] of this.pending) if (flow.expiresAt <= now) this.pending.delete(key);
  }

  begin() {
    const now = this._time();
    this._prune(now);
    if (this.pending.size + this.active + this.detached >= this.maxPending) throw new OidcFlowError('OIDC flow capacity reached', 'flow_capacity');
    const state = token(this.randomBytes);
    const browserBinding = token(this.randomBytes);
    const nonce = token(this.randomBytes);
    const codeVerifier = token(this.randomBytes);
    const stateDigest = digest(state);
    if (this.pending.has(stateDigest)) throw new OidcFlowError('OIDC state collision', 'flow_collision');
    const flow = Object.freeze({
      browserBindingDigest: digest(browserBinding), nonce, codeVerifier,
      expiresAt: now + this.flowTtlMs,
    });
    this.pending.set(stateDigest, flow);
    const location = new URL(this.authorizationEndpoint);
    location.searchParams.set('response_type', 'code');
    location.searchParams.set('client_id', this.clientId);
    location.searchParams.set('redirect_uri', this.redirectUri.href);
    location.searchParams.set('scope', this.scopes.join(' '));
    location.searchParams.set('state', state);
    location.searchParams.set('nonce', nonce);
    location.searchParams.set('code_challenge', createHash('sha256').update(codeVerifier).digest('base64url'));
    location.searchParams.set('code_challenge_method', 'S256');
    let active = true;
    return Object.freeze({
      location: location.href,
      setCookie: `${OIDC_FLOW_COOKIE_NAME}=${browserBinding}; Max-Age=${Math.floor(this.flowTtlMs / 1000)}; Secure; HttpOnly; SameSite=Lax; Path=/v1/auth/oidc/callback`,
      expiresAt: new Date(flow.expiresAt).toISOString(),
      rollback: () => {
        if (!active) return false;
        active = false;
        if (this.pending.get(stateDigest) !== flow) return false;
        this.pending.delete(stateDigest);
        return true;
      },
      commit: () => { active = false; },
    });
  }

  async complete({ state, code, cookieHeader } = {}) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state ?? '') || !validText(code, 2048)
      || !/^[A-Za-z0-9._~-]+$/.test(code)) throw new OidcFlowError('OIDC callback is invalid');
    const bindings = cookieValues(cookieHeader, OIDC_FLOW_COOKIE_NAME);
    if (bindings.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(bindings[0])) {
      const flow = this.pending.get(digest(state));
      if (flow) this.pending.delete(digest(state));
      throw new OidcFlowError('OIDC browser binding is invalid');
    }
    const now = this._time();
    const stateDigest = digest(state);
    const flow = this.pending.get(stateDigest);
    if (!flow) throw new OidcFlowError('OIDC flow is unknown or already consumed');
    this.pending.delete(stateDigest);
    if (flow.expiresAt <= now || !equalToken(bindings[0], flow.browserBindingDigest)) {
      throw new OidcFlowError('OIDC flow is expired or browser binding is invalid');
    }
    this.active += 1;
    try {
      const controller = new AbortController();
      const bounded = async (operation, code) => {
        let timer;
        let timedOut = false;
        const operationPromise = Promise.resolve().then(() => operation(controller.signal));
        try {
          return await Promise.race([
            operationPromise,
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
                this.detached += 1;
                operationPromise.then(() => { this.detached -= 1; }, () => { this.detached -= 1; });
                reject(new OidcFlowError('OIDC provider boundary timed out', code));
              }, this.providerTimeoutMs);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
          if (!timedOut) controller.signal.throwIfAborted?.();
        }
      };
      let verified;
      try {
        verified = await bounded((signal) => this.completeAuthorization(Object.freeze({
          code, codeVerifier: flow.codeVerifier, redirectUri: this.redirectUri.href,
          clientId: this.clientId, expectedIssuer: this.issuer, expectedNonce: flow.nonce, signal,
        })), 'provider_timeout');
      } catch (cause) {
        if (cause instanceof OidcFlowError) throw cause;
        throw new OidcFlowError('OIDC provider verification failed', 'provider_refused');
      }
      if (this._time() >= flow.expiresAt) throw new OidcFlowError('OIDC flow expired during provider verification');
      if (!record(verified)) throw new OidcFlowError('OIDC provider verification failed', 'provider_refused');
      const allowed = new Set(['issuer', 'audience', 'subject', 'nonce', 'claims']);
      const audiences = Array.isArray(verified.audience) ? verified.audience : [verified.audience];
      let claimsBytes = Infinity;
      try { claimsBytes = Buffer.byteLength(JSON.stringify(verified.claims)); } catch { /* invalid below */ }
      if (Object.keys(verified).some((key) => !allowed.has(key))
        || verified.issuer !== this.issuer || audiences.length === 0 || audiences.length > 16
        || audiences.some((audience) => !validText(audience, 256)) || !audiences.includes(this.clientId)
        || !validText(verified.subject, 256) || verified.nonce !== flow.nonce
        || !record(verified.claims) || claimsBytes > 64 * 1024) {
        throw new OidcFlowError('OIDC verified identity does not match this relying party', 'identity_mismatch');
      }
      let mapped;
      try {
        mapped = await bounded(() => this.mapClaims(Object.freeze(clone({
          issuer: verified.issuer, audience: audiences, subject: verified.subject, claims: verified.claims,
        }))), 'claims_timeout');
      } catch (cause) {
        if (cause instanceof OidcFlowError) throw cause;
        throw new OidcFlowError('OIDC claims mapping failed', 'claims_refused');
      }
      if (!validMappedClaims(mapped)) throw new OidcFlowError('OIDC claims mapping failed', 'claims_refused');
      return Object.freeze({
        userId: mapped.userId, authMethod: 'cookie', capabilities: [...mapped.capabilities],
        repoIds: [...mapped.repoIds], ttlMs: mapped.ttlMs,
      });
    } finally {
      this.active -= 1;
    }
  }

  clearCookie() {
    return `${OIDC_FLOW_COOKIE_NAME}=; Max-Age=0; Secure; HttpOnly; SameSite=Lax; Path=/v1/auth/oidc/callback`;
  }
}

export function csrfCookie(value, maxAgeSeconds) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value ?? '') || !Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new TypeError('valid CSRF value and Max-Age are required');
  }
  return `${WEB_CSRF_COOKIE_NAME}=${value}; Max-Age=${maxAgeSeconds}; Secure; SameSite=Strict; Path=/`;
}
