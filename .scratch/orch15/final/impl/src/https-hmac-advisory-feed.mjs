import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';

import { HmacAdvisoryWebhookSource, signHmacAdvisoryWebhookForTest } from './hmac-advisory-webhook.mjs';

const typed = (message, code) => Object.assign(new Error(message), { code });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const stable = (value) => JSON.stringify(canonical(value));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max && !/[\0\r\n]/.test(value);
const segment = (value) => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]); };
const pollDomain = (fields) => Buffer.concat([
  Buffer.from('BATON-PROVIDER-POLL-PAGE-V1\0'), segment(fields.operation), segment(fields.pollId), segment(fields.observedAt),
  segment(fields.pageIndex), segment(fields.finalSequence), segment(fields.requestCursorDigest), segment(fields.cursorDigest),
  segment(fields.nextCursorDigest ?? ''), segment(sha(fields.raw)), segment(fields.raw),
]);
const itemDomain = (fields) => Buffer.concat([
  Buffer.from('BATON-PROVIDER-POLL-ITEM-V1\0'), segment(fields.providerId), segment(fields.cardDigest), segment(fields.deliveryId),
  segment(fields.occurredAt), segment(fields.sequence), segment(fields.rawDigest),
]);

function defaultRequest(url, opts) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'GET', headers: opts.headers, signal: opts.signal, maxRedirects: 0,
      ...(opts.ca ? { ca: opts.ca } : {}), ...(opts.servername ? { servername: opts.servername } : {}),
    }, (res) => {
      const chunks = []; let bytes = 0; let failed = false;
      res.on('data', (chunk) => { if (failed) return; bytes += chunk.length; if (bytes > opts.maxBytes) { failed = true; req.destroy(typed('provider poll page exceeded byte ceiling', 'provider_poll_oversize')); return; } chunks.push(Buffer.from(chunk)); });
      res.on('end', () => { if (!failed) resolve({ status: res.statusCode, rawHeaders: res.rawHeaders.reduce((rows, value, index, all) => index % 2 === 0 ? [...rows, [value, all[index + 1]]] : rows, []), raw: Buffer.concat(chunks) }); });
    });
    req.on('error', reject); req.end();
  });
}

export class HttpsHmacAdvisoryFeedSource extends HmacAdvisoryWebhookSource {
  constructor(opts = {}) {
    super(opts);
    const poll = opts.poll;
    let origin; let operation;
    try { origin = new URL(poll?.origin); operation = new URL(poll?.operation, origin); } catch { throw new TypeError('HTTPS advisory poll configuration is invalid'); }
    const numeric = ['maxPages', 'maxItems', 'maxPageBytes', 'maxTotalBytes', 'maxWallMs', 'maxBackoffMs', 'maxClockSkewMs'];
    if (!exact(poll, ['origin', 'operation', 'initialSequence', 'maxPages', 'maxItems', 'maxPageBytes', 'maxTotalBytes', 'maxWallMs', 'maxBackoffMs', 'maxClockSkewMs'])
      || origin.protocol !== 'https:' || origin.href !== `${origin.origin}/` || operation.origin !== origin.origin || operation.pathname !== poll.operation || operation.search || operation.hash
      || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,2048}$/.test(poll.operation) || poll.operation.includes('//') || poll.operation.split('/').some((part) => ['.', '..'].includes(part))
      || !Number.isSafeInteger(poll.initialSequence) || poll.initialSequence < 0 || numeric.some((key) => !Number.isSafeInteger(poll[key]) || poll[key] <= 0)
      || !bounded(opts.authorization, 4096) || (opts.request !== undefined && typeof opts.request !== 'function')
      || (opts.ca !== undefined && !(typeof opts.ca === 'string' || Buffer.isBuffer(opts.ca))) || (opts.servername !== undefined && !bounded(opts.servername, 253))) throw new TypeError('HTTPS advisory poll configuration is invalid');
    this.poll = Object.freeze({ ...poll }); this.origin = origin; this.operation = operation; this.authorization = opts.authorization;
    this.request = opts.request ?? defaultRequest; this.ca = opts.ca; this.servername = opts.servername; this._pendingPollItems = new Map();
  }

  card() {
    const base = super.card();
    return { ...base, modes: ['poll', 'webhook'], poll: { origin: this.poll.origin, operation: this.poll.operation, cursorKind: 'sequence', initialSequence: this.poll.initialSequence, redirects: 'deny', maxPages: this.poll.maxPages, maxItems: this.poll.maxItems, maxPageBytes: this.poll.maxPageBytes, maxTotalBytes: this.poll.maxTotalBytes, maxWallMs: this.poll.maxWallMs, maxBackoffMs: this.poll.maxBackoffMs, maxClockSkewMs: this.poll.maxClockSkewMs } };
  }

  _pageSignature(fields) { return createHmac('sha256', this.secret).update(pollDomain(fields)).digest('hex'); }
  _pollItemAuth(receipt, cardDigest) { return sha(createHmac('sha256', this.secret).update(itemDomain({ providerId: this.providerId, cardDigest, deliveryId: receipt.deliveryId, occurredAt: receipt.occurredAt, sequence: receipt.sequence, rawDigest: receipt.rawDigest })).digest()); }
  _pollProofAuth(proof) {
    const core = { schemaVersion: 1, providerId: proof.providerId, sourceEpoch: proof.sourceEpoch, cardDigest: proof.cardDigest, pollId: proof.pollId, observedAt: proof.observedAt, window: proof.window, finalSequence: proof.finalSequence, cursorDigest: proof.cursorDigest, keyFingerprint: proof.keyFingerprint, pageDigests: proof.pageDigests, itemDigests: proof.itemDigests, totalBytes: proof.totalBytes, receiptRawDigests: proof.receiptRawDigests };
    return sha(createHmac('sha256', this.secret).update(`BATON-PROVIDER-POLL-PROOF-V1\0${stable(core)}`).digest());
  }

  async pollFull(ctx = {}, authority = {}) {
    if (ctx.signal?.aborted) throw typed('provider poll cancelled', 'cancelled');
    if (!/^[a-f0-9]{64}$/.test(authority.cardDigest ?? '')) throw typed('provider poll card authority is invalid', 'provider_poll_invalid');
    if (!record(authority.pollToken)) throw typed('provider poll call authority is invalid', 'provider_poll_invalid');
    let cursor = String(this.poll.initialSequence); let pollId = null; let observedAt = null; let finalSequence = null; let finalCursor = null; const pages = []; const authRows = []; let itemCount = 0; let totalBytes = 0;
    for (let pageIndex = 0; pageIndex < this.poll.maxPages; pageIndex += 1) {
      const response = await this.request(this.operation, { signal: ctx.signal, ca: this.ca, servername: this.servername, maxBytes: this.poll.maxPageBytes, headers: { accept: 'application/json', authorization: this.authorization, 'x-baton-cursor': cursor, 'x-baton-page-index': String(pageIndex) } });
      if (!exact(response, ['status', 'rawHeaders', 'raw']) || response.status !== 200 || !Buffer.isBuffer(response.raw) || response.raw.length === 0 || response.raw.length > this.poll.maxPageBytes || !Array.isArray(response.rawHeaders)) throw typed(response?.status >= 300 && response?.status < 400 ? 'provider poll redirect refused' : 'provider poll response is invalid', response?.status >= 300 && response?.status < 400 ? 'provider_poll_redirect' : 'provider_poll_invalid');
      const headers = new Map();
      for (const pair of response.rawHeaders) { if (!Array.isArray(pair) || pair.length !== 2 || !bounded(pair[0], 128) || !bounded(pair[1], this.ceilings.maxHeaderBytes)) throw typed('provider poll headers are invalid', 'provider_poll_invalid'); const name = pair[0].toLowerCase(); if (headers.has(name)) throw typed('provider poll headers are ambiguous', 'provider_poll_invalid'); headers.set(name, pair[1]); }
      if (response.rawHeaders.length > this.ceilings.maxHeaderCount || Buffer.byteLength(JSON.stringify(response.rawHeaders)) > this.ceilings.maxHeaderBytes || headers.get('content-type') !== 'application/json' || headers.get('content-encoding') !== 'identity') throw typed('provider poll headers are invalid', 'provider_poll_invalid');
      const metadata = { pollId: headers.get('x-baton-poll-id'), observedAt: headers.get('x-baton-observed-at'), finalSequence: Number(headers.get('x-baton-final-sequence')), cursor: headers.get('x-baton-cursor'), nextCursor: headers.get('x-baton-next-cursor') ?? null, signature: headers.get('x-baton-poll-signature') };
      if (!bounded(metadata.pollId, this.ceilings.maxIdentityBytes) || !bounded(metadata.observedAt, 64) || !Number.isFinite(Date.parse(metadata.observedAt)) || new Date(Date.parse(metadata.observedAt)).toISOString() !== metadata.observedAt
        || !Number.isSafeInteger(metadata.finalSequence) || metadata.finalSequence < this.poll.initialSequence || !bounded(metadata.cursor, this.ceilings.maxIdentityBytes) || (metadata.nextCursor !== null && !bounded(metadata.nextCursor, this.ceilings.maxIdentityBytes)) || !/^[a-f0-9]{64}$/.test(metadata.signature ?? '')) throw typed('provider poll metadata is invalid', 'provider_poll_invalid');
      if (pollId !== null && (metadata.pollId !== pollId || metadata.observedAt !== observedAt || metadata.finalSequence !== finalSequence)) throw typed('provider poll page identity diverged', 'provider_poll_invalid');
      pollId ??= metadata.pollId; observedAt ??= metadata.observedAt; finalSequence ??= metadata.finalSequence;
      const signatureFields = { operation: this.poll.operation, pollId, observedAt, pageIndex, finalSequence, requestCursorDigest: sha(cursor), cursorDigest: sha(metadata.cursor), nextCursorDigest: metadata.nextCursor === null ? null : sha(metadata.nextCursor), raw: response.raw };
      const expectedSignature = Buffer.from(this._pageSignature(signatureFields), 'hex'); const observedSignature = Buffer.from(metadata.signature, 'hex');
      if (observedSignature.length !== expectedSignature.length || !timingSafeEqual(observedSignature, expectedSignature)) throw typed('provider poll page authentication failed', 'provider_auth_invalid');
      let page; try { page = JSON.parse(response.raw); } catch { throw typed('provider poll page JSON is invalid', 'provider_poll_invalid'); }
      if (response.raw.toString('utf8') !== stable(page) || !exact(page, ['schemaVersion', 'items']) || page.schemaVersion !== 1 || !Array.isArray(page.items) || page.items.length === 0) throw typed('provider poll page body is invalid', 'provider_poll_invalid');
      const items = [];
      for (const item of page.items) {
        if (!exact(item, ['deliveryId', 'occurredAt', 'sequence', 'raw']) || !bounded(item.deliveryId, this.ceilings.maxIdentityBytes) || !bounded(item.occurredAt, 64) || !Number.isSafeInteger(item.sequence) || item.sequence < this.poll.initialSequence || !bounded(item.raw, this.poll.maxPageBytes)) throw typed('provider poll item is invalid', 'provider_poll_invalid');
        const raw = Buffer.from(item.raw, 'base64'); if (raw.length === 0 || raw.toString('base64') !== item.raw || raw.length > this.ceilings.maxDeliveryBytes) throw typed('provider poll item encoding is invalid', 'provider_poll_invalid');
        const key = sha(raw); items.push(raw); authRows.push({ sequence: item.sequence, rawDigest: key, deliveryId: item.deliveryId, occurredAt: item.occurredAt, cardDigest: authority.cardDigest, pollToken: authority.pollToken });
      }
      itemCount += items.length; totalBytes += response.raw.length + items.reduce((sum, raw) => sum + raw.length, 0); if (itemCount > this.poll.maxItems || totalBytes > this.poll.maxTotalBytes) throw typed('provider poll exceeded deployment ceiling', 'provider_poll_oversize');
      pages.push({ raw: Buffer.from(response.raw), items }); finalCursor = metadata.cursor;
      if (metadata.nextCursor === null) break; cursor = metadata.nextCursor;
      if (pageIndex === this.poll.maxPages - 1) throw typed('provider poll pagination exceeded deployment ceiling', 'provider_poll_oversize');
    }
    if (pages.length === 0 || authRows.length === 0 || authRows.some((row, index) => index > 0 && row.sequence !== authRows[index - 1].sequence + 1) || authRows.at(-1).sequence !== finalSequence) throw typed('provider poll sequence window is incomplete', 'provider_poll_incomplete');
    for (const row of authRows) { const queue = this._pendingPollItems.get(row.rawDigest) ?? []; queue.push({ deliveryId: row.deliveryId, occurredAt: row.occurredAt, sequence: row.sequence, cardDigest: row.cardDigest, pollToken: row.pollToken }); this._pendingPollItems.set(row.rawDigest, queue); }
    const pageDigests = pages.map((page) => ({ digest: sha(page.raw), bytes: page.raw.length, itemCount: page.items.length })); const itemDigests = authRows.map((row) => row.rawDigest); const proofCore = { schemaVersion: 1, providerId: this.providerId, sourceEpoch: authority.cardDigest, cardDigest: authority.cardDigest, pollId, observedAt, window: { fromSequence: authRows[0].sequence, toSequence: authRows.at(-1).sequence }, finalSequence, cursorDigest: sha(finalCursor), keyFingerprint: this.keyFingerprint, pageDigests, itemDigests, totalBytes, receiptRawDigests: itemDigests };
    return { schemaVersion: 1, providerId: this.providerId, pollId, observedAt, window: proofCore.window, finalSequence, cursorDigest: proofCore.cursorDigest, authReceiptDigest: this._pollProofAuth(proofCore), keyFingerprint: this.keyFingerprint, pages };
  }

  async verifyDelivery(input, ctx = {}) {
    if (!exact(input, ['mode', 'raw']) || input.mode !== 'poll' || !Buffer.isBuffer(input.raw)) throw typed('provider poll delivery is invalid', 'provider_delivery_invalid');
    const key = sha(input.raw); const queue = this._pendingPollItems.get(key); const pending = queue?.[0]; if (!pending || ctx.pollToken !== pending.pollToken) throw typed('provider poll item lacks authenticated page authority', 'provider_auth_invalid'); queue.shift(); if (queue.length === 0) this._pendingPollItems.delete(key);
    const signature = signHmacAdvisoryWebhookForTest(this.secret, { method: this.callback.method, path: this.callback.path, occurredAt: pending.occurredAt, deliveryId: pending.deliveryId, raw: input.raw });
    const receipt = await super.verifyWebhook({ method: this.callback.method, path: this.callback.path, rawHeaders: [['content-type', 'application/json'], ['content-encoding', 'identity'], ['x-baton-signature', signature], ['x-baton-delivery-id', pending.deliveryId], ['x-baton-timestamp', pending.occurredAt], ['x-baton-sequence', String(pending.sequence)]], raw: input.raw }, ctx);
    return { ...receipt, authReceiptDigest: this._pollItemAuth(receipt, pending.cardDigest) };
  }

  async readReceipt(receipt) {
    if (receipt?.mode !== 'poll') return super.readReceipt(receipt);
    const raw = await this.privateCas.get(receipt.rawDigest); if (!Buffer.isBuffer(raw) || raw.length !== receipt.rawBytes || sha(raw) !== receipt.rawDigest || receipt.authReceiptDigest !== this._pollItemAuth(receipt, receipt.sourceEpoch)) throw typed('provider poll receipt replay diverged', 'provider_auth_receipt_invalid'); return Buffer.from(raw);
  }
  readReceiptSync(receipt) {
    if (receipt?.mode !== 'poll') return super.readReceiptSync(receipt);
    if (typeof this.privateCas.getSync !== 'function') throw typed('provider private CAS synchronous replay is unavailable', 'provider_replay_unavailable'); const raw = this.privateCas.getSync(receipt.rawDigest); if (!Buffer.isBuffer(raw) || raw.length !== receipt.rawBytes || sha(raw) !== receipt.rawDigest || receipt.authReceiptDigest !== this._pollItemAuth(receipt, receipt.sourceEpoch)) throw typed('provider poll receipt replay diverged', 'provider_auth_receipt_invalid'); return Buffer.from(raw);
  }

  reverifyPollSync(proof) {
    if (!proof || proof.providerId !== this.providerId || proof.keyFingerprint !== this.keyFingerprint || proof.authReceiptDigest !== this._pollProofAuth(proof)) throw typed('provider poll proof authentication replay diverged', 'provider_poll_replay_invalid');
    return JSON.parse(JSON.stringify(proof));
  }
}

export function signHmacAdvisoryPollPageForTest(secret, fields) { return createHmac('sha256', secret).update(pollDomain(fields)).digest('hex'); }
