import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

const positive = (value, name) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
};
const address = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || value.trim() !== value || !isIP(value)) throw new TypeError('invalid client address');
  if (isIP(value) === 4) return value.split('.').map((part) => String(Number(part))).join('.');
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
  const [left, right = ''] = normalized.split('::');
  const lhs = left ? left.split(':') : []; const rhs = right ? right.split(':') : [];
  const words = [...lhs, ...Array(8 - lhs.length - rhs.length).fill('0'), ...rhs].map((part) => Number.parseInt(part, 16));
  if (words.length === 8 && words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
  }
  return normalized;
};

export class FixedWindowQuota {
  constructor({ limit, windowMs, maxKeys, now = Date.now }) {
    this.limit = positive(limit, 'limit'); this.windowMs = positive(windowMs, 'windowMs');
    this.maxKeys = positive(maxKeys, 'maxKeys');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.now = now; this.keys = new Map(); this.lastNow = null;
  }
  _validateSample(nowMs) {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('quota clock must return a non-negative safe integer');
    if (this.lastNow !== null && nowMs < this.lastNow) throw new RangeError('quota clock must be monotonic');
    return nowMs;
  }
  _retryAfter(now) {
    return Math.max(1, Math.ceil((this.windowMs - (now % this.windowMs)) / 1000));
  }
  take(key, cost = 1, nowMs = this.now()) {
    positive(cost, 'cost');
    const now = this._validateSample(nowMs); const start = Math.floor(now / this.windowMs) * this.windowMs;
    this.lastNow = now;
    for (const [k, v] of this.keys) if (v.start < start) this.keys.delete(k);
    let entry = this.keys.get(key);
    if (!entry) {
      if (this.keys.size >= this.maxKeys) return { ok: false, retryAfter: this._retryAfter(now), reason: 'capacity' };
      entry = { start, used: 0 }; this.keys.set(key, entry);
    }
    if (entry.used + cost > this.limit) return { ok: false, retryAfter: this._retryAfter(now) };
    entry.used += cost;
    return { ok: true };
  }
  reserve(key, cost = 1, nowMs = this.now()) {
    const taken = this.take(key, cost, nowMs);
    if (!taken.ok) return taken;
    const entry = this.keys.get(key);
    let active = true;
    return {
      ok: true,
      commit: () => { if (!active) return false; active = false; return true; },
      rollback: () => {
        if (!active) return false;
        active = false;
        if (this.keys.get(key) !== entry) return false;
        entry.used -= cost;
        if (entry.used === 0) this.keys.delete(key);
        return true;
      },
    };
  }
  canTake(key, cost = 1, nowMs = this.now()) {
    positive(cost, 'cost');
    const now = this._validateSample(nowMs); const start = Math.floor(now / this.windowMs) * this.windowMs;
    const current = this.keys.get(key); const entry = current?.start >= start ? current : null;
    let activeKeys = 0;
    for (const value of this.keys.values()) if (value.start >= start) activeKeys += 1;
    if (!entry && activeKeys >= this.maxKeys) return { ok: false, retryAfter: this._retryAfter(now), reason: 'capacity' };
    if ((entry?.used ?? 0) + cost > this.limit) return { ok: false, retryAfter: this._retryAfter(now) };
    return { ok: true };
  }
  get size() { return this.keys.size; }
}

export class ConcurrentQuota {
  constructor({ limit, maxKeys }) { this.limit = positive(limit, 'limit'); this.maxKeys = positive(maxKeys, 'maxKeys'); this.keys = new Map(); }
  acquire(key) {
    const current = this.keys.get(key) ?? 0;
    if (current >= this.limit || (!this.keys.has(key) && this.keys.size >= this.maxKeys)) return { ok: false, retryAfter: 1 };
    this.keys.set(key, current + 1); return { ok: true, key };
  }
  release(key) { const current = this.keys.get(key) ?? 0; if (current <= 1) this.keys.delete(key); else this.keys.set(key, current - 1); }
}

export class WebReadinessAuthority {
  constructor({ coordination, sessions, authenticate, checks = [] }) {
    if (typeof coordination?.healthCheck !== 'function') throw new TypeError('readiness requires coordination healthCheck');
    if (typeof authenticate !== 'function' || typeof authenticate.isPrincipalActive !== 'function' || typeof authenticate.healthCheck !== 'function') throw new TypeError('readiness requires live authentication health');
    if (typeof sessions?.healthCheck !== 'function') throw new TypeError('readiness requires session healthCheck');
    if (!Array.isArray(checks) || checks.some((check) => typeof check !== 'function')) throw new TypeError('readiness checks must be functions');
    this.coordination = coordination; this.sessions = sessions; this.authenticate = authenticate; this.checks = checks;
  }
  check() {
    try { return this.coordination.healthCheck() === true && this.authenticate.healthCheck() === true
      && this.sessions.healthCheck() === true && this.checks.every((check) => check() === true); }
    catch { return false; }
  }
}

const parseForwarded = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new TypeError('invalid forwarding chain');
  const elements = value.split(',');
  if (elements.length > 16) throw new TypeError('invalid forwarding chain');
  return elements.map((element) => {
    const fields = Object.create(null);
    for (const parameter of element.split(';')) {
      const match = /^([a-z]+)=("[^"]+"|[^\s;,]+)$/i.exec(parameter.trim());
      if (!match || Object.hasOwn(fields, match[1].toLowerCase())) throw new TypeError('invalid forwarding chain');
      let decoded = match[2];
      if (decoded.startsWith('"')) decoded = decoded.slice(1, -1);
      if (!/^[A-Za-z0-9.:[\]_%+-]+$/.test(decoded)) throw new TypeError('invalid forwarding chain');
      fields[match[1].toLowerCase()] = decoded;
    }
    if (!fields.for || !fields.proto || Object.keys(fields).some((key) => !['for', 'proto'].includes(key))) throw new TypeError('invalid forwarding chain');
    fields.proto = fields.proto.toLowerCase();
    if (!['http', 'https'].includes(fields.proto)) throw new TypeError('invalid forwarding chain');
    let client = fields.for;
    if (client.startsWith('[') && client.endsWith(']')) client = client.slice(1, -1);
    if (client.includes(']') || client.includes('[') || client.includes('%')) throw new TypeError('invalid forwarding chain');
    return { address: address(client), proto: fields.proto };
  });
};

export function resolveEdgeRequest(req, { trustedProxies = [], forwardedHop = 0, requireForwardedHttps = false } = {}) {
  if (!Number.isSafeInteger(forwardedHop) || forwardedHop < 0) throw new TypeError('forwardedHop must be a non-negative safe integer');
  const peer = address(req?.socket?.remoteAddress);
  const trusted = new Set(trustedProxies.map(address)).has(peer);
  const xff = req.headers?.['x-forwarded-for']; const forwarded = req.headers?.forwarded;
  if (!trusted) return { address: peer, transport: req.socket?.encrypted ? 'https' : 'http', proxied: false };
  if (!Array.isArray(req.rawHeaders) || req.rawHeaders.length % 2 !== 0) throw new TypeError('invalid forwarding headers');
  const counts = new Map([['forwarded', 0], ['x-forwarded-for', 0], ['x-forwarded-proto', 0]]);
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = String(req.rawHeaders[index]).toLowerCase();
    if (counts.has(name)) counts.set(name, counts.get(name) + 1);
  }
  for (const [name, count] of counts) {
    if (count > 1 || (count === 0) !== (req.headers?.[name] == null)) throw new TypeError('ambiguous forwarding headers');
  }
  if (xff != null && forwarded != null) throw new TypeError('mixed forwarding headers');
  if (forwarded != null) {
    if (req.headers?.['x-forwarded-proto'] != null) throw new TypeError('mixed forwarding headers');
    const chain = parseForwarded(forwarded);
    if (forwardedHop >= chain.length) throw new TypeError('invalid forwarding chain');
    const selected = chain[chain.length - 1 - forwardedHop];
    if (requireForwardedHttps && selected.proto !== 'https') throw new TypeError('forwarded HTTPS required');
    return { address: selected.address, transport: selected.proto, proxied: true };
  }
  if (typeof xff !== 'string' || xff.length === 0 || xff.length > 512) throw new TypeError('invalid forwarding chain');
  const chain = xff.split(',').map((part) => address(part.trim()));
  if (chain.length > 16 || forwardedHop >= chain.length) throw new TypeError('invalid forwarding chain');
  const rawProto = req.headers?.['x-forwarded-proto'];
  if (typeof rawProto !== 'string') throw new TypeError('invalid forwarded protocol');
  const proto = rawProto.toLowerCase();
  if (!['https', 'http'].includes(proto)) throw new TypeError('invalid forwarded protocol');
  if (requireForwardedHttps && proto !== 'https') throw new TypeError('forwarded HTTPS required');
  return { address: chain[chain.length - 1 - forwardedHop], transport: proto, proxied: true };
}

export class WebEdgePolicy {
  constructor(opts = {}) {
    if (typeof opts.addressKey !== 'string' || opts.addressKey.length < 16) throw new TypeError('addressKey must contain at least 16 characters');
    this.addressKey = opts.addressKey; this.trustedProxies = opts.trustedProxies ?? [];
    this.forwardedHop = opts.forwardedHop ?? 0; this.proxyMode = opts.proxyMode ?? false;
    if (this.proxyMode && this.trustedProxies.length === 0) throw new TypeError('proxy mode requires trusted proxies');
    if (!this.proxyMode && (this.trustedProxies.length > 0 || this.forwardedHop !== 0)) throw new TypeError('direct mode cannot configure proxy trust or forwarding hops');
    const now = opts.now ?? Date.now; this.now = now; const windowMs = opts.windowMs ?? 60_000; const maxKeys = opts.maxKeys ?? 10_000;
    const allowedLimits = new Set(['peer', 'address', 'login', 'principal', 'cost', 'ticket', 'health', 'readiness', 'connection']);
    const unknownLimit = Object.keys(opts.limits ?? {}).find((name) => !allowedLimits.has(name));
    if (unknownLimit) throw new TypeError(`unknown quota policy: ${unknownLimit}`);
    const limits = { peer: 100, address: 1000, login: 10, principal: 100, cost: 100, ticket: 30, health: 60, readiness: 60, connection: 4, ...(opts.limits ?? {}) };
    const { connection, ...windowLimits } = limits;
    this.quotas = Object.fromEntries(Object.entries(windowLimits).map(([name, limit]) => [name, new FixedWindowQuota({ limit, windowMs, maxKeys, now })]));
    this.connections = new ConcurrentQuota({ limit: connection, maxKeys });
    this.admitting = true;
  }
  resolve(req) {
    if (!this.proxyMode) return { address: address(req?.socket?.remoteAddress), transport: req?.socket?.encrypted ? 'https' : 'http', proxied: false };
    return resolveEdgeRequest(req, { trustedProxies: this.trustedProxies, forwardedHop: this.forwardedHop, requireForwardedHttps: true });
  }
  digest(value) { return createHmac('sha256', this.addressKey).update(value).digest('hex'); }
  peerDigest(req) { return this.digest(address(req?.socket?.remoteAddress)); }
  take(kind, key, cost) { return this.quotas[kind].take(key, cost); }
  reserve(kind, key, cost) { return this.quotas[kind].reserve(key, cost); }
  takeCommand(key, cost) {
    const now = this.now();
    const count = this.quotas.principal.canTake(key, 1, now);
    if (!count.ok) return { ...count, quota: 'principal' };
    const weighted = this.quotas.cost.canTake(key, cost, now);
    if (!weighted.ok) return { ...weighted, quota: 'cost' };
    const countCommit = this.quotas.principal.take(key, 1, now);
    const costCommit = this.quotas.cost.take(key, cost, now);
    if (!countCommit.ok || !costCommit.ok) throw new Error('quota transaction invariant violated');
    return { ok: true };
  }
  acquireConnection(key) { return this.connections.acquire(key); }
  releaseConnection(key) { this.connections.release(key); }
  closeAdmission() { this.admitting = false; }
}
