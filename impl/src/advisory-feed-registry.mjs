import { createHash } from 'node:crypto';

const typed = (message, code) => Object.assign(new Error(message), { code });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
const exactKeys = (value, keys) => record(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const bounded = (value, max = 256) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max && !/[\0\r\n]/.test(value);
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const exactNpm = (coordinate) => exactKeys(coordinate, ['ecosystem', 'package', 'version']) && coordinate.ecosystem === 'npm'
  && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(coordinate.package)
  && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(coordinate.version);
const coordinateKey = (value) => `${value.ecosystem}\0${value.package}\0${value.version}`;
const sortedUnique = (values, key = (value) => value) => Array.isArray(values) && JSON.stringify(values.map(key)) === JSON.stringify([...new Set(values.map(key))].sort());
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

function validCard(card) {
  const nativeWebhook = ['hmac-sha256', 'ed25519'].includes(card?.auth?.scheme);
  const hasPoll = card?.modes?.includes('poll') === true;
  const topFields = ['schemaVersion', 'providerId', 'adapterId', 'version', 'modes', 'ecosystem', 'semantics', 'auth', 'ceilings', ...(nativeWebhook ? ['webhook', 'privateCas'] : []), ...(hasPoll ? ['poll'] : [])];
  if (!exactKeys(card, topFields)
    || card.schemaVersion !== 1 || !bounded(card.providerId, 128) || !/^[A-Za-z0-9._:-]+$/.test(card.providerId)
    || !bounded(card.adapterId, 128) || !bounded(card.version, 128) || card.ecosystem !== 'npm' || card.semantics !== 'authenticated_hint'
    || !Array.isArray(card.modes) || card.modes.length === 0 || !sortedUnique(card.modes) || card.modes.some((mode) => !['poll', 'webhook'].includes(mode))) return false;
  const authFields = nativeWebhook ? ['scheme', 'keyFingerprints', 'domain', 'signatureEncoding', 'headers'] : ['scheme', 'keyFingerprints'];
  if (!exactKeys(card.auth, authFields) || !['hmac-sha256', 'ed25519', 'injected-test'].includes(card.auth.scheme)
    || !Array.isArray(card.auth.keyFingerprints) || card.auth.keyFingerprints.length === 0 || card.auth.keyFingerprints.length > 16
    || !sortedUnique(card.auth.keyFingerprints) || card.auth.keyFingerprints.some((item) => !hex(item))) return false;
  if (nativeWebhook && (card.auth.domain !== 'baton-provider-webhook-v1' || card.auth.signatureEncoding !== (card.auth.scheme === 'hmac-sha256' ? 'hex' : 'base64')
    || !exactKeys(card.auth.headers, ['signature', 'deliveryId', 'timestamp', 'sequence']) || Object.values(card.auth.headers).some((value) => !/^[a-z0-9-]{1,64}$/.test(value))
    || new Set(Object.values(card.auth.headers)).size !== 4 || !exactKeys(card.webhook, ['method', 'path', 'contentType', 'contentEncoding']) || card.webhook.method !== 'POST'
    || typeof card.webhook.path !== 'string' || !card.webhook.path.startsWith('/') || card.webhook.contentType !== 'application/json' || card.webhook.contentEncoding !== 'identity'
    || !exactKeys(card.privateCas, ['storeId', 'digestAlgorithm']) || !bounded(card.privateCas.storeId, 128) || card.privateCas.digestAlgorithm !== 'sha256')) return false;
  const ceilingKeys = ['maxDeliveryBytes', 'maxCoordinates', 'maxAdvisoryIds', 'maxIdentityBytes', ...(nativeWebhook ? ['maxHeaderCount', 'maxHeaderBytes', 'maxClockSkewMs'] : [])];
  let pollValid = true;
  if (hasPoll) {
    const p = card.poll; let origin; let operation;
    try { origin = new URL(p?.origin); operation = new URL(p?.operation, origin); } catch { return false; }
    const numeric = ['maxPages', 'maxItems', 'maxPageBytes', 'maxTotalBytes', 'maxWallMs', 'maxBackoffMs', 'maxClockSkewMs'];
    pollValid = exactKeys(p, ['origin', 'operation', 'cursorKind', 'initialSequence', 'redirects', 'maxPages', 'maxItems', 'maxPageBytes', 'maxTotalBytes', 'maxWallMs', 'maxBackoffMs', 'maxClockSkewMs'])
      && origin.protocol === 'https:' && origin.href === `${origin.origin}/` && operation.origin === origin.origin && operation.pathname === p.operation && operation.search === '' && operation.hash === '' && typeof p.operation === 'string' && /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,2048}$/.test(p.operation)
      && !p.operation.includes('//') && !p.operation.split('/').some((segment) => ['.', '..'].includes(segment)) && p.cursorKind === 'sequence' && p.redirects === 'deny' && Number.isSafeInteger(p.initialSequence) && p.initialSequence >= 0 && numeric.every((key) => Number.isSafeInteger(p[key]) && p[key] > 0)
      && p.maxPages <= 10_000 && p.maxItems <= 100_000 && p.maxPageBytes <= 16 * 1024 * 1024 && p.maxTotalBytes <= 64 * 1024 * 1024 && p.maxWallMs <= 60 * 60 * 1_000 && p.maxBackoffMs <= 60 * 60 * 1_000 && p.maxClockSkewMs <= 24 * 60 * 60 * 1_000;
  }
  return pollValid && exactKeys(card.ceilings, ceilingKeys) && Object.values(card.ceilings).every((value) => Number.isSafeInteger(value) && value > 0)
    && card.ceilings.maxDeliveryBytes <= 16 * 1024 * 1024 && card.ceilings.maxCoordinates <= 10_000 && card.ceilings.maxAdvisoryIds <= 100_000 && card.ceilings.maxIdentityBytes <= 4_096
    && (!nativeWebhook || (card.ceilings.maxHeaderCount <= 256 && card.ceilings.maxHeaderBytes <= 256 * 1024 && card.ceilings.maxClockSkewMs <= 24 * 60 * 60 * 1_000));
}

function validatePollProof(proof, card, cardDigest) {
  const fields = ['schemaVersion', 'providerId', 'sourceEpoch', 'cardDigest', 'pollId', 'observedAt', 'window', 'finalSequence', 'cursorDigest', 'authReceiptDigest', 'keyFingerprint', 'pageDigests', 'itemDigests', 'totalBytes', 'receiptRawDigests', 'proofDigest'];
  if (!exactKeys(proof, fields) || proof.schemaVersion !== 1 || proof.providerId !== card.providerId || proof.sourceEpoch !== cardDigest || proof.cardDigest !== cardDigest || !bounded(proof.pollId, card.ceilings.maxIdentityBytes) || !time(proof.observedAt)
    || !exactKeys(proof.window, ['fromSequence', 'toSequence']) || !Number.isSafeInteger(proof.window.fromSequence) || !Number.isSafeInteger(proof.window.toSequence) || proof.window.fromSequence < card.poll.initialSequence || proof.window.toSequence < proof.window.fromSequence || proof.finalSequence !== proof.window.toSequence
    || !hex(proof.cursorDigest) || !hex(proof.authReceiptDigest) || !card.auth.keyFingerprints.includes(proof.keyFingerprint) || !Array.isArray(proof.pageDigests) || proof.pageDigests.length === 0 || proof.pageDigests.length > card.poll.maxPages
    || proof.pageDigests.some((row) => !exactKeys(row, ['digest', 'bytes', 'itemCount']) || !hex(row.digest) || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > card.poll.maxPageBytes || !Number.isSafeInteger(row.itemCount) || row.itemCount <= 0)
    || !Array.isArray(proof.itemDigests) || proof.itemDigests.length === 0 || proof.itemDigests.length > card.poll.maxItems || proof.window.toSequence - proof.window.fromSequence + 1 !== proof.itemDigests.length || proof.pageDigests.reduce((sum, row) => sum + row.itemCount, 0) !== proof.itemDigests.length || proof.itemDigests.some((value) => !hex(value))
    || !Number.isSafeInteger(proof.totalBytes) || proof.totalBytes <= 0 || proof.totalBytes > card.poll.maxTotalBytes || !Array.isArray(proof.receiptRawDigests) || proof.receiptRawDigests.length !== proof.itemDigests.length || proof.receiptRawDigests.some((value) => !hex(value)) || JSON.stringify(proof.receiptRawDigests) !== JSON.stringify(proof.itemDigests)) throw typed('provider poll proof is invalid', 'provider_poll_invalid');
  const core = Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'proofDigest'));
  if (proof.proofDigest !== digest(core)) throw typed('provider poll proof digest is invalid', 'provider_poll_invalid');
  return freeze(json(proof));
}

function validateReceipt(receipt, card, raw, mode, cardDigest) {
  const fields = ['schemaVersion', 'providerId', 'deliveryId', 'rawDigest', 'rawBytes', 'authReceiptDigest', 'keyFingerprint', 'occurredAt', 'sequence', 'coordinates', 'advisoryIds', 'source'];
  if (!exactKeys(receipt, fields) || receipt.schemaVersion !== 1 || receipt.providerId !== card.providerId || !bounded(receipt.deliveryId, card.ceilings.maxIdentityBytes)
    || !hex(receipt.rawDigest) || receipt.rawDigest !== digest(raw) || receipt.rawBytes !== raw.length || receipt.rawBytes <= 0 || receipt.rawBytes > card.ceilings.maxDeliveryBytes
    || !hex(receipt.authReceiptDigest) || !card.auth.keyFingerprints.includes(receipt.keyFingerprint) || !time(receipt.occurredAt)
    || (receipt.sequence !== null && (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 0))) throw typed('provider delivery receipt is invalid', 'provider_receipt_invalid');
  if (!Array.isArray(receipt.coordinates) || receipt.coordinates.length === 0 || receipt.coordinates.length > card.ceilings.maxCoordinates || receipt.coordinates.some((coordinate) => !exactNpm(coordinate))
    || !sortedUnique(receipt.coordinates, coordinateKey)) throw typed('provider delivery coordinates are invalid', 'provider_receipt_invalid');
  if (!Array.isArray(receipt.advisoryIds) || receipt.advisoryIds.length > card.ceilings.maxAdvisoryIds || receipt.advisoryIds.some((id) => !bounded(id, card.ceilings.maxIdentityBytes))
    || !sortedUnique(receipt.advisoryIds)) throw typed('provider advisory identities are invalid', 'provider_receipt_invalid');
  const source = receipt.source;
  if (!exactKeys(source, ['handle', 'digest', 'bytes', 'mediaType']) || !hex(source.digest) || source.handle !== `art:sha256:${source.digest}`
    || source.digest !== receipt.rawDigest || source.bytes !== receipt.rawBytes || source.mediaType !== 'application/json') throw typed('provider source reference is invalid', 'provider_receipt_invalid');
  const core = { schemaVersion: 1, providerId: card.providerId, sourceEpoch: cardDigest, cardDigest, mode, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest, rawBytes: receipt.rawBytes, authReceiptDigest: receipt.authReceiptDigest, keyFingerprint: receipt.keyFingerprint, occurredAt: receipt.occurredAt, sequence: receipt.sequence, coordinates: receipt.coordinates, advisoryIds: receipt.advisoryIds, source: receipt.source };
  return freeze({ ...json(core), contentDigest: digest(core) });
}

/** Deployment-owned registry for provider authentication adapters. It is deliberately not an ACI
 * capability and has no user/MCP invocation surface. Adapters retain secrets and raw-source CAS;
 * the registry returns only a closed, secret-free authenticated-hint receipt. */
export class AdvisoryFeedRegistry {
  constructor(opts = {}) {
    if (!record(opts.sources ?? {})) throw new TypeError('advisory feed sources must be a closed registry');
    this.entries = new Map();
    for (const [providerId, source] of Object.entries(opts.sources ?? {})) {
      if (!source || typeof source.card !== 'function' || (typeof source.verifyDelivery !== 'function' && typeof source.verifyWebhook !== 'function')) throw new TypeError(`invalid advisory feed source: ${providerId}`);
      const card = source.card();
      if (!validCard(card) || card.providerId !== providerId) throw new TypeError(`invalid advisory feed card: ${providerId}`);
      if (card.modes.includes('poll') && (typeof source.pollFull !== 'function' || typeof source.reverifyPollSync !== 'function' || typeof source.verifyDelivery !== 'function')) throw new TypeError(`poll authority is incomplete: ${providerId}`);
      const cardDigest = digest(card);
      this.entries.set(providerId, { source, card: freeze(json(card)), cardDigest });
    }
  }

  cards() { return [...this.entries.values()].map((entry) => freeze({ ...json(entry.card), cardDigest: entry.cardDigest })).sort((a, b) => a.providerId.localeCompare(b.providerId)); }

  async verify(providerId, input, ctx = {}) {
    const entry = this.entries.get(providerId); if (!entry) throw typed('unknown advisory feed provider', 'provider_not_configured');
    if (!record(input) || !exactKeys(input, ['mode', 'raw']) || !entry.card.modes.includes(input.mode) || !Buffer.isBuffer(input.raw) || input.raw.length === 0 || input.raw.length > entry.card.ceilings.maxDeliveryBytes) throw typed('provider delivery envelope is invalid', 'provider_delivery_invalid');
    if (ctx.signal?.aborted) throw typed('provider delivery verification cancelled', 'cancelled');
    const preserved = Buffer.from(input.raw); const adapterBytes = Buffer.from(preserved);
    const receipt = await entry.source.verifyDelivery(Object.freeze({ mode: input.mode, raw: adapterBytes }), Object.freeze({ signal: ctx.signal, cardDigest: entry.cardDigest }));
    return validateReceipt(receipt, entry.card, preserved, input.mode, entry.cardDigest);
  }

  async verifyWebhook(providerId, input, ctx = {}) {
    const entry = this.entries.get(providerId); if (!entry) throw typed('unknown advisory feed provider', 'provider_not_configured');
    if (entry.card.auth.scheme === 'injected-test' || typeof entry.source.verifyWebhook !== 'function' || !record(input) || !exactKeys(input, ['method', 'path', 'rawHeaders', 'raw'])
      || !Buffer.isBuffer(input.raw) || input.raw.length === 0 || input.raw.length > entry.card.ceilings.maxDeliveryBytes) throw typed('provider webhook is not configured', 'provider_delivery_invalid');
    if (ctx.signal?.aborted) throw typed('provider delivery verification cancelled', 'cancelled');
    const preserved = Buffer.from(input.raw); const receipt = await entry.source.verifyWebhook(Object.freeze({ method: input.method, path: input.path, rawHeaders: json(input.rawHeaders), raw: Buffer.from(preserved) }), Object.freeze({ signal: ctx.signal, cardDigest: entry.cardDigest }));
    return validateReceipt(receipt, entry.card, preserved, 'webhook', entry.cardDigest);
  }

  async pollFull(providerId, ctx = {}) {
    const entry = this.entries.get(providerId); if (!entry) throw typed('unknown advisory feed provider', 'provider_not_configured');
    if (!entry.card.modes.includes('poll') || typeof entry.source.pollFull !== 'function' || !record(ctx) || Object.keys(ctx).some((key) => key !== 'signal')) throw typed('provider poll is not configured', 'provider_poll_unavailable');
    if (ctx.signal?.aborted) throw typed('provider poll cancelled', 'cancelled');
    const controller = new AbortController(); const signal = ctx.signal ? AbortSignal.any([ctx.signal, controller.signal]) : controller.signal; const deadline = Date.now() + entry.card.poll.maxWallMs;
    const timed = async (promise) => { let timer; try { const remaining = deadline - Date.now(); if (remaining <= 0) throw typed('provider poll exceeded wall-time ceiling', 'provider_poll_timeout'); return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(typed('provider poll exceeded wall-time ceiling', 'provider_poll_timeout')); }, remaining); })]); } finally { clearTimeout(timer); } };
    try {
      const pollToken = Object.freeze({});
      let value;
      try { value = await timed(Promise.resolve(entry.source.pollFull(Object.freeze({ signal }), Object.freeze({ cardDigest: entry.cardDigest, pollToken })))); }
      catch (error) { if (ctx.signal?.aborted) throw typed('provider poll cancelled', 'cancelled'); throw error; }
      const fields = ['schemaVersion', 'providerId', 'pollId', 'observedAt', 'window', 'finalSequence', 'cursorDigest', 'authReceiptDigest', 'keyFingerprint', 'pages'];
      if (!exactKeys(value, fields) || value.schemaVersion !== 1 || value.providerId !== providerId || !bounded(value.pollId, entry.card.ceilings.maxIdentityBytes) || !time(value.observedAt) || !exactKeys(value.window, ['fromSequence', 'toSequence'])
        || !Number.isSafeInteger(value.window.fromSequence) || !Number.isSafeInteger(value.window.toSequence) || value.window.fromSequence < entry.card.poll.initialSequence || value.window.toSequence < value.window.fromSequence || value.finalSequence !== value.window.toSequence
        || !hex(value.cursorDigest) || !hex(value.authReceiptDigest) || !entry.card.auth.keyFingerprints.includes(value.keyFingerprint) || !Array.isArray(value.pages) || value.pages.length === 0) throw typed('provider poll result is invalid', 'provider_poll_invalid');
      if (value.pages.length > entry.card.poll.maxPages) throw typed('provider poll exceeded deployment ceiling', 'provider_poll_oversize');
      const pageDigests = []; const itemBytes = []; let totalBytes = 0;
      for (const page of value.pages) {
        if (!exactKeys(page, ['raw', 'items']) || !Buffer.isBuffer(page.raw) || page.raw.length === 0 || page.raw.length > entry.card.poll.maxPageBytes || !Array.isArray(page.items) || page.items.length === 0 || page.items.some((raw) => !Buffer.isBuffer(raw) || raw.length === 0)) throw typed('provider poll exceeded deployment ceiling', 'provider_poll_oversize');
        totalBytes += page.raw.length; for (const raw of page.items) { totalBytes += raw.length; itemBytes.push(Buffer.from(raw)); }
        pageDigests.push({ digest: digest(page.raw), bytes: page.raw.length, itemCount: page.items.length });
      }
      if (itemBytes.length > entry.card.poll.maxItems || totalBytes > entry.card.poll.maxTotalBytes) throw typed('provider poll exceeded deployment ceiling', 'provider_poll_oversize');
      const receipts = [];
      for (const raw of itemBytes) { if (signal.aborted) throw typed('provider poll cancelled', 'cancelled'); const receipt = await timed(Promise.resolve(entry.source.verifyDelivery(Object.freeze({ mode: 'poll', raw: Buffer.from(raw) }), Object.freeze({ signal, cardDigest: entry.cardDigest, pollToken })))); receipts.push(validateReceipt(receipt, entry.card, raw, 'poll', entry.cardDigest)); }
      const expectedSequences = Array.from({ length: value.window.toSequence - value.window.fromSequence + 1 }, (_, index) => value.window.fromSequence + index);
      if (JSON.stringify(receipts.map((row) => row.sequence)) !== JSON.stringify(expectedSequences)) throw typed('provider poll sequence window is incomplete', 'provider_poll_incomplete');
      const core = { schemaVersion: 1, providerId, sourceEpoch: entry.cardDigest, cardDigest: entry.cardDigest, pollId: value.pollId, observedAt: value.observedAt, window: json(value.window), finalSequence: value.finalSequence, cursorDigest: value.cursorDigest, authReceiptDigest: value.authReceiptDigest, keyFingerprint: value.keyFingerprint, pageDigests, itemDigests: itemBytes.map(digest), totalBytes, receiptRawDigests: receipts.map((row) => row.rawDigest) };
      const proof = validatePollProof({ ...core, proofDigest: digest(core) }, entry.card, entry.cardDigest);
      return freeze({ proof, receipts: receipts.map((row) => freeze(json(row))) });
    } finally { controller.abort(); }
  }

  reverifyPollSync(proof) {
    const entry = this.entries.get(proof?.providerId); if (!entry || !entry.card.modes.includes('poll') || typeof entry.source.reverifyPollSync !== 'function') throw typed('provider poll replay is unavailable', 'provider_poll_replay_unavailable');
    const checked = validatePollProof(proof, entry.card, entry.cardDigest); const reverified = entry.source.reverifyPollSync(json(checked));
    if (reverified && typeof reverified.then === 'function') throw typed('provider poll replay must be synchronous', 'provider_poll_replay_unavailable');
    const replayed = validatePollProof(reverified, entry.card, entry.cardDigest); if (digest(replayed) !== digest(checked)) throw typed('provider poll replay diverged', 'provider_poll_invalid');
    return replayed;
  }

  async reverifyReceipt(receipt) {
    const entry = this.entries.get(receipt?.providerId); if (!entry || typeof entry.source.readReceipt !== 'function') throw typed('provider receipt replay is unavailable', 'provider_replay_unavailable');
    const raw = await entry.source.readReceipt(receipt); const reverified = validateReceipt({ schemaVersion: 1, providerId: receipt.providerId, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest, rawBytes: receipt.rawBytes, authReceiptDigest: receipt.authReceiptDigest, keyFingerprint: receipt.keyFingerprint, occurredAt: receipt.occurredAt, sequence: receipt.sequence, coordinates: receipt.coordinates, advisoryIds: receipt.advisoryIds, source: receipt.source }, entry.card, raw, receipt.mode, entry.cardDigest);
    if (reverified.contentDigest !== receipt.contentDigest || receipt.sourceEpoch !== entry.cardDigest || receipt.cardDigest !== entry.cardDigest) throw typed('provider receipt replay diverged', 'provider_receipt_invalid');
    return reverified;
  }

  reverifyReceiptSync(receipt) {
    const entry = this.entries.get(receipt?.providerId); if (!entry || typeof entry.source.readReceiptSync !== 'function') throw typed('provider receipt replay is unavailable', 'provider_replay_unavailable');
    const raw = entry.source.readReceiptSync(receipt); const reverified = validateReceipt({ schemaVersion: 1, providerId: receipt.providerId, deliveryId: receipt.deliveryId, rawDigest: receipt.rawDigest, rawBytes: receipt.rawBytes, authReceiptDigest: receipt.authReceiptDigest, keyFingerprint: receipt.keyFingerprint, occurredAt: receipt.occurredAt, sequence: receipt.sequence, coordinates: receipt.coordinates, advisoryIds: receipt.advisoryIds, source: receipt.source }, entry.card, raw, receipt.mode, entry.cardDigest);
    if (reverified.contentDigest !== receipt.contentDigest || receipt.sourceEpoch !== entry.cardDigest || receipt.cardDigest !== entry.cardDigest) throw typed('provider receipt replay diverged', 'provider_receipt_invalid');
    return reverified;
  }
}
