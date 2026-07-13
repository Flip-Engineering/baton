import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const typed = (message, code) => Object.assign(new Error(message), { code });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const stable = (value) => JSON.stringify(canonical(value));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max && !/[\0\r\n]/.test(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const segment = (value) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]); };
const domain = ({ method, path, occurredAt, deliveryId, raw }) => Buffer.concat([
  Buffer.from('BATON-PROVIDER-WEBHOOK-V1\0'), segment(method), segment(path), segment(occurredAt), segment(deliveryId), segment(sha(raw)), segment(raw),
]);
const exactNpm = (coordinate) => exactKeys(coordinate, ['ecosystem', 'package', 'version']) && coordinate.ecosystem === 'npm'
  && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(coordinate.package)
  && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(coordinate.version);
const coordinateKey = (value) => `${value.ecosystem}\0${value.package}\0${value.version}`;

/** Baton-owned exact-domain HMAC webhook verifier. The secret and raw CAS remain private to this
 * source; its card and receipt expose fingerprints/digests only. */
export class HmacAdvisoryWebhookSource {
  constructor(opts = {}) {
    if (!bounded(opts.providerId, 128) || !bounded(opts.adapterId, 128) || !bounded(opts.version, 128) || !Buffer.isBuffer(opts.secret) || opts.secret.length < 32
      || !/^[a-f0-9]{64}$/.test(opts.keyFingerprint ?? '') || !exactKeys(opts.callback, ['method', 'path']) || opts.callback.method !== 'POST'
      || typeof opts.callback.path !== 'string' || !opts.callback.path.startsWith('/') || opts.callback.path.includes('?') || opts.callback.path.includes('#')
      || typeof opts.privateCas?.put !== 'function' || typeof opts.privateCas?.get !== 'function' || !bounded(opts.privateCas.storeId, 128)) throw new TypeError('HMAC advisory webhook configuration is invalid');
    const ceilings = opts.ceilings;
    const ceilingFields = ['maxDeliveryBytes', 'maxCoordinates', 'maxAdvisoryIds', 'maxIdentityBytes', 'maxHeaderCount', 'maxHeaderBytes', 'maxClockSkewMs'];
    if (!exactKeys(ceilings, ceilingFields) || Object.values(ceilings).some((value) => !Number.isSafeInteger(value) || value <= 0)
      || ceilings.maxDeliveryBytes > 16 * 1024 * 1024 || ceilings.maxCoordinates > 10_000 || ceilings.maxAdvisoryIds > 100_000 || ceilings.maxIdentityBytes > 4_096
      || ceilings.maxHeaderCount > 256 || ceilings.maxHeaderBytes > 256 * 1024 || ceilings.maxClockSkewMs > 24 * 60 * 60 * 1_000) throw new TypeError('HMAC advisory webhook ceilings are invalid');
    this.providerId = opts.providerId; this.adapterId = opts.adapterId; this.version = opts.version; this.secret = Buffer.from(opts.secret); this.keyFingerprint = opts.keyFingerprint;
    this.callback = Object.freeze({ ...opts.callback }); this.privateCas = opts.privateCas; this.ceilings = Object.freeze({ ...ceilings }); this.now = opts.now ?? Date.now;
  }

  card() {
    return { schemaVersion: 1, providerId: this.providerId, adapterId: this.adapterId, version: this.version, modes: ['webhook'], ecosystem: 'npm', semantics: 'authenticated_hint',
      auth: { scheme: 'hmac-sha256', keyFingerprints: [this.keyFingerprint], domain: 'baton-provider-webhook-v1', signatureEncoding: 'hex', headers: { signature: 'x-baton-signature', deliveryId: 'x-baton-delivery-id', timestamp: 'x-baton-timestamp', sequence: 'x-baton-sequence' } },
      webhook: { method: this.callback.method, path: this.callback.path, contentType: 'application/json', contentEncoding: 'identity' }, privateCas: { storeId: this.privateCas.storeId, digestAlgorithm: 'sha256' }, ceilings: { ...this.ceilings } };
  }

  async verifyWebhook(input, ctx = {}) {
    if (ctx.signal?.aborted) throw typed('provider delivery verification cancelled', 'cancelled');
    if (!exactKeys(input, ['method', 'path', 'rawHeaders', 'raw']) || input.method !== this.callback.method || input.path !== this.callback.path || !Buffer.isBuffer(input.raw)
      || input.raw.length === 0 || input.raw.length > this.ceilings.maxDeliveryBytes || !Array.isArray(input.rawHeaders) || input.rawHeaders.length > this.ceilings.maxHeaderCount
      || input.rawHeaders.some((pair) => !Array.isArray(pair) || pair.length !== 2 || !bounded(pair[0], 128) || !bounded(pair[1], this.ceilings.maxHeaderBytes))
      || Buffer.byteLength(JSON.stringify(input.rawHeaders)) > this.ceilings.maxHeaderBytes) throw typed('provider webhook envelope is invalid', 'provider_delivery_invalid');
    const headers = new Map();
    for (const [rawName, value] of input.rawHeaders) { const name = rawName.toLowerCase(); if (headers.has(name)) throw typed('provider webhook headers are ambiguous', 'provider_auth_invalid'); headers.set(name, value); }
    if (headers.has('content-length') || headers.has('transfer-encoding')) throw typed('provider webhook framing headers are not accepted at this boundary', 'provider_auth_invalid');
    const names = this.card().auth.headers; const signature = headers.get(names.signature); const deliveryId = headers.get(names.deliveryId); const occurredAt = headers.get(names.timestamp); const sequenceText = headers.get(names.sequence);
    const occurredMs = Date.parse(occurredAt); const nowMs = this.now();
    if (headers.get('content-type') !== 'application/json' || headers.get('content-encoding') !== 'identity' || !/^[a-f0-9]{64}$/.test(signature ?? '')
      || !bounded(deliveryId, this.ceilings.maxIdentityBytes) || !/^\d+$/.test(sequenceText ?? '') || (sequenceText.length > 1 && sequenceText.startsWith('0'))
      || !Number.isSafeInteger(Number(sequenceText)) || Number(sequenceText) < 0 || !bounded(occurredAt, 64) || !Number.isFinite(occurredMs) || new Date(occurredMs).toISOString() !== occurredAt
      || !Number.isFinite(nowMs) || occurredMs > nowMs || nowMs - occurredMs > this.ceilings.maxClockSkewMs) throw typed('provider webhook authentication metadata is invalid', 'provider_auth_invalid');
    const raw = Buffer.from(input.raw); const signedDomain = domain({ method: input.method, path: input.path, occurredAt, deliveryId, raw }); const expected = createHmac('sha256', this.secret).update(signedDomain).digest(); const observed = Buffer.from(signature, 'hex');
    if (observed.length !== expected.length || !timingSafeEqual(observed, expected)) throw typed('provider webhook authentication failed', 'provider_auth_invalid');
    let hint; try { hint = JSON.parse(raw); } catch { throw typed('provider webhook JSON is invalid', 'provider_hint_invalid'); }
    if (raw.toString('utf8') !== stable(hint) || !exactKeys(hint, ['schemaVersion', 'coordinates', 'advisoryIds']) || hint.schemaVersion !== 1
      || !Array.isArray(hint.coordinates) || hint.coordinates.length === 0 || hint.coordinates.length > this.ceilings.maxCoordinates || hint.coordinates.some((coordinate) => !exactNpm(coordinate))
      || JSON.stringify(hint.coordinates.map(coordinateKey)) !== JSON.stringify([...new Set(hint.coordinates.map(coordinateKey))].sort())
      || !Array.isArray(hint.advisoryIds) || hint.advisoryIds.length > this.ceilings.maxAdvisoryIds || hint.advisoryIds.some((id) => !bounded(id, this.ceilings.maxIdentityBytes))
      || JSON.stringify(hint.advisoryIds) !== JSON.stringify([...new Set(hint.advisoryIds)].sort())) throw typed('provider webhook hint is invalid', 'provider_hint_invalid');
    const rawDigest = sha(raw); const stored = await this.privateCas.put(Buffer.from(raw), { digest: rawDigest, bytes: raw.length, signal: ctx.signal });
    if (!exactKeys(stored, ['storeId', 'digest', 'bytes']) || stored.storeId !== this.privateCas.storeId || stored.digest !== rawDigest || stored.bytes !== raw.length) throw typed('provider private CAS did not preserve authenticated bytes', 'provider_cas_invalid');
    const domainDigest = sha(signedDomain); const authReceiptDigest = sha(stable({ schemaVersion: 1, algorithm: 'hmac-sha256', keyFingerprint: this.keyFingerprint, domain: 'baton-provider-webhook-v1', domainDigest }));
    return { schemaVersion: 1, providerId: this.providerId, deliveryId, rawDigest, rawBytes: raw.length, authReceiptDigest, keyFingerprint: this.keyFingerprint, occurredAt, sequence: Number(sequenceText), coordinates: hint.coordinates, advisoryIds: hint.advisoryIds, source: { handle: `art:sha256:${rawDigest}`, digest: rawDigest, bytes: raw.length, mediaType: 'application/json' } };
  }

  async readReceipt(receipt) {
    const raw = await this.privateCas.get(receipt.rawDigest); if (!Buffer.isBuffer(raw) || raw.length !== receipt.rawBytes || sha(raw) !== receipt.rawDigest) throw typed('provider private CAS replay diverged', 'provider_cas_invalid');
    return Buffer.from(raw);
  }
}

export function signHmacAdvisoryWebhookForTest(secret, fields) {
  return createHmac('sha256', secret).update(domain(fields)).digest('hex');
}
