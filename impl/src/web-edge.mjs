import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

const positive = (value, name) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
};
const address = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || value.trim() !== value || !isIP(value)) throw new TypeError('invalid client address');
  return value;
};

export class FixedWindowQuota {
  constructor({ limit, windowMs, maxKeys, now = Date.now }) {
    this.limit = positive(limit, 'limit'); this.windowMs = positive(windowMs, 'windowMs');
    this.maxKeys = positive(maxKeys, 'maxKeys');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    this.now = now; this.keys = new Map();
  }
  take(key, cost = 1) {
    positive(cost, 'cost');
    const now = this.now(); const start = Math.floor(now / this.windowMs) * this.windowMs;
    for (const [k, v] of this.keys) if (v.start < start) this.keys.delete(k);
    let entry = this.keys.get(key);
    if (!entry) {
      if (this.keys.size >= this.maxKeys) return { ok: false, retryAfter: Math.max(1, Math.ceil((start + this.windowMs - now) / 1000)), reason: 'capacity' };
      entry = { start, used: 0 }; this.keys.set(key, entry);
    }
    if (entry.used + cost > this.limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((start + this.windowMs - now) / 1000)) };
    entry.used += cost;
    return { ok: true };
  }
  canTake(key, cost = 1) {
    positive(cost, 'cost');
    const now = this.now(); const start = Math.floor(now / this.windowMs) * this.windowMs;
    for (const [k, v] of this.keys) if (v.start < start) this.keys.delete(k);
    const entry = this.keys.get(key);
    if (!entry && this.keys.size >= this.maxKeys) return { ok: false, retryAfter: Math.max(1, Math.ceil((start + this.windowMs - now) / 1000)), reason: 'capacity' };
    if ((entry?.used ?? 0) + cost > this.limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((start + this.windowMs - now) / 1000)) };
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
  constructor({ coordination, sessions = null, authenticate, checks = [] }) {
    if (typeof coordination?.healthCheck !== 'function') throw new TypeError('readiness requires coordination healthCheck');
    if (typeof authenticate !== 'function' || typeof authenticate.isPrincipalActive !== 'function' || typeof authenticate.healthCheck !== 'function') throw new TypeError('readiness requires live authentication health');
    if (sessions && typeof sessions.healthCheck !== 'function') throw new TypeError('readiness requires session healthCheck');
    if (!Array.isArray(checks) || checks.some((check) => typeof check !== 'function')) throw new TypeError('readiness checks must be functions');
    this.coordination = coordination; this.sessions = sessions; this.authenticate = authenticate; this.checks = checks;
  }
  check() {
    try { return this.coordination.healthCheck() === true && this.authenticate.healthCheck() === true
      && (!this.sessions || this.sessions.healthCheck() === true) && this.checks.every((check) => check() === true); }
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
      fields[match[1].toLowerCase()] = match[2];
    }
    if (!fields.for || !fields.proto || !['http', 'https'].includes(fields.proto) || Object.keys(fields).some((key) => !['for', 'proto'].includes(key))) throw new TypeError('invalid forwarding chain');
    let client = fields.for;
    if (client.startsWith('"')) client = client.slice(1, -1);
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
  const proto = req.headers?.['x-forwarded-proto'];
  if (typeof proto !== 'string' || !['https', 'http'].includes(proto)) throw new TypeError('invalid forwarded protocol');
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
    const now = opts.now ?? Date.now; const windowMs = opts.windowMs ?? 60_000; const maxKeys = opts.maxKeys ?? 10_000;
    const allowedLimits = new Set(['address', 'login', 'principal', 'cost', 'ticket', 'health', 'readiness', 'connection']);
    const unknownLimit = Object.keys(opts.limits ?? {}).find((name) => !allowedLimits.has(name));
    if (unknownLimit) throw new TypeError(`unknown quota policy: ${unknownLimit}`);
    const limits = { address: 1000, login: 10, principal: 100, cost: 100, ticket: 30, health: 60, readiness: 60, connection: 4, ...(opts.limits ?? {}) };
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
  takeCommand(key, cost) {
    const count = this.quotas.principal.canTake(key);
    if (!count.ok) return { ...count, quota: 'principal' };
    const weighted = this.quotas.cost.canTake(key, cost);
    if (!weighted.ok) return { ...weighted, quota: 'cost' };
    this.quotas.principal.take(key); this.quotas.cost.take(key, cost);
    return { ok: true };
  }
  acquireConnection(key) { return this.connections.acquire(key); }
  releaseConnection(key) { this.connections.release(key); }
  closeAdmission() { this.admitting = false; }
}
