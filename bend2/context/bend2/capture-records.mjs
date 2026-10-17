// Encode captured inputs into the nine fields consumed by Core and providers.
// File and configuration records carry a content digest and encoded bytes.
// Link records carry their target, directory records carry their marker and
// optional listing, and absent records carry the marker "absent".

import { createHash } from 'node:crypto';

const KINDS = Object.freeze(['file', 'absent', 'dir', 'link', 'config']);
const ABSENT_MARKER = 'absent';
const NO_PAYLOAD = 'none';

function unavailable(reason, detail) {
  return detail === undefined
    ? Object.freeze({ status: 'unavailable', reason })
    : Object.freeze({ status: 'unavailable', reason, detail });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// Encode bytes as base64 or hex.
export function encodeExactBytes(bytes, encoding = 'base64') {
  if (!(bytes instanceof Uint8Array)) return unavailable('bytesMissing');
  if (encoding === 'base64') {
    const payload = Buffer.from(bytes).toString('base64');
    return Object.freeze({ status: 'encoded', payload, payloadEncoding: 'base64' });
  }
  if (encoding === 'hex') {
    const payload = Buffer.from(bytes).toString('hex');
    return Object.freeze({ status: 'encoded', payload, payloadEncoding: 'hex' });
  }
  return unavailable('payloadEncodingUnsupported', String(encoding));
}

// Read the producer module, declaration digest and operation.
export function producerOf(producer) {
  if (producer === null || producer === undefined) {
    return Object.freeze({ status: 'unclaimed', module: null, digest: null, operation: null });
  }
  const module = typeof producer.module === 'string' && producer.module.length > 0 ? producer.module : null;
  const digest = typeof producer.digest === 'string' && producer.digest.length > 0 ? producer.digest : null;
  const operation = typeof producer.operation === 'string' && producer.operation.length > 0 ? producer.operation : null;
  const given = [module, digest, operation].filter((entry) => entry !== null).length;
  if (given !== 0 && given !== 3) return unavailable('producerIncomplete');
  if (given === 0) return Object.freeze({ status: 'unclaimed', module: null, digest: null, operation: null });
  return Object.freeze({ status: 'claimed', module, digest, operation });
}

// Read the complete producer identity from a supplied record.
export function requireClaimed(record) {
  if (record === null || typeof record !== 'object') return unavailable('recordMissing');
  const triple = producerOf({
    module: record.producerModule,
    digest: record.producerDigest,
    operation: record.producerOperation,
  });
  if (triple.status === 'unclaimed') return unavailable('producerIncomplete');
  if (triple.status !== 'claimed') return triple;
  return Object.freeze({ status: 'claimed', module: triple.module, digest: triple.digest, operation: triple.operation });
}

// Build a record from the supplied identity, content and producer.
export function captureRecord({ identity, bytes = null, role = 'frontend-source', kind = 'file', target = null, marker = null, names = null, producer = null, encoding = 'base64' } = {}) {
  if (!isNonEmptyString(identity)) return unavailable('identityMissing');
  if (!KINDS.includes(kind)) return unavailable('captureKindUnsupported', String(kind));
  const triple = producerOf(producer);
  if (triple.status !== 'claimed' && triple.status !== 'unclaimed') return triple;
  if (!isNonEmptyString(role)) return unavailable('roleMissing');
  const field = role;

  if (kind === 'absent') {
    return Object.freeze({
      captureKind: 'absent',
      role: field,
      path: identity,
      marker: ABSENT_MARKER,
      payload: '',
      payloadEncoding: NO_PAYLOAD,
      producerModule: triple.module,
      producerDigest: triple.digest,
      producerOperation: triple.operation,
    });
  }
  if (kind === 'link') {
    if (!isNonEmptyString(target)) return unavailable('targetRequired');
    return Object.freeze({
      captureKind: 'link',
      role: field,
      path: identity,
      marker: target,
      payload: '',
      payloadEncoding: NO_PAYLOAD,
      producerModule: triple.module,
      producerDigest: triple.digest,
      producerOperation: triple.operation,
    });
  }
  if (kind === 'dir') {
    if (!isNonEmptyString(marker)) return unavailable('markerRequired', 'a directory record carries the admitted digest the caller supplies');
    // A directory listing is a JSON array encoded as base64.
    const list = Array.isArray(names) ? names.filter((name) => typeof name === 'string' && name.length > 0) : null;
    return Object.freeze({
      captureKind: 'dir',
      role: field,
      path: identity,
      marker,
      payload: list === null ? '' : Buffer.from(JSON.stringify(list), 'utf8').toString('base64'),
      payloadEncoding: list === null ? NO_PAYLOAD : 'base64',
      producerModule: triple.module,
      producerDigest: triple.digest,
      producerOperation: triple.operation,
    });
  }
  const encoded = encodeExactBytes(bytes, encoding);
  if (encoded.status !== 'encoded') return encoded;
  return Object.freeze({
    captureKind: kind,
    role: field,
    path: identity,
    marker: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    payload: encoded.payload,
    payloadEncoding: encoded.payloadEncoding,
    producerModule: triple.module,
    producerDigest: triple.digest,
    producerOperation: triple.operation,
  });
}
