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
  get size() { return this.keys.size; }
}

export function resolveEdgeRequest(req, { trustedProxies = [], forwardedHop = 0, requireForwardedHttps = false } = {}) {
  if (!Number.isSafeInteger(forwardedHop) || forwardedHop < 0) throw new TypeError('forwardedHop must be a non-negative safe integer');
  const peer = address(req?.socket?.remoteAddress);
  const trusted = new Set(trustedProxies.map(address)).has(peer);
  const xff = req.headers?.['x-forwarded-for']; const forwarded = req.headers?.forwarded;
  if (!trusted) return { address: peer, transport: req.socket?.encrypted ? 'https' : 'http', proxied: false };
  if (xff != null && forwarded != null) throw new TypeError('mixed forwarding headers');
  if (forwarded != null) throw new TypeError('Forwarded header is not supported');
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
    const now = opts.now ?? Date.now; const windowMs = opts.windowMs ?? 60_000; const maxKeys = opts.maxKeys ?? 10_000;
    const limits = { address: 1000, login: 10, principal: 100, cost: 100, ticket: 30, readiness: 60, ...(opts.limits ?? {}) };
    this.quotas = Object.fromEntries(Object.entries(limits).map(([name, limit]) => [name, new FixedWindowQuota({ limit, windowMs, maxKeys, now })]));
    this.admitting = true;
  }
  resolve(req) { return resolveEdgeRequest(req, { trustedProxies: this.trustedProxies, forwardedHop: this.forwardedHop, requireForwardedHttps: this.proxyMode }); }
  digest(value) { return createHmac('sha256', this.addressKey).update(value).digest('hex'); }
  take(kind, key, cost) { return this.quotas[kind].take(key, cost); }
  closeAdmission() { this.admitting = false; }
}
