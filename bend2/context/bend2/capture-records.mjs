// Producer-side capture records for the frontend capture set.
//
// This is the producer counterpart of the adapter's consumer. It turns exact accepted bytes and an
// admitted canonical identity into the nine rendered capture-record fields, so a caller can hand them
// to a plan and to the wire without losing bytes or inventing authority. It reads no file, opens no
// network, resolves no name the caller did not supply and holds no custody: bytes, identities and the
// frozen step come from the caller, and the producing triple is carried as a claimed association that
// only a step selected by admission can justify.
//
// The record shape is the rendered wire spelling, exactly as the consumer side reads it:
//   {captureKind, role, path, marker, payload, payloadEncoding,
//    producerModule, producerDigest, producerOperation}
// For a file or configuration record the marker is the content digest of the exact bytes and the payload
// is those bytes in a lossless byte-exact encoding. A link record carries its resolved target as the
// marker and no payload; a directory record carries the admitted digest the caller supplies; an absent
// record carries the literal marker `absent` and no payload. None of those three carries source bytes.

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

// Encode exact bytes so that decoding reproduces them byte for byte, including a byte order mark, a
// carriage return or a byte that is not valid UTF-8. An encoding that cannot round-trip is refused.
export function encodeExactBytes(bytes, encoding = 'base64') {
  if (!(bytes instanceof Uint8Array)) return unavailable('bytesMissing');
  if (encoding === 'base64') {
    const payload = Buffer.from(bytes).toString('base64');
    const back = Buffer.from(payload, 'base64');
    if (!back.equals(Buffer.from(bytes))) return unavailable('payloadNotRoundTrip', 'base64');
    return Object.freeze({ status: 'encoded', payload, payloadEncoding: 'base64' });
  }
  if (encoding === 'hex') {
    const payload = Buffer.from(bytes).toString('hex');
    const back = Buffer.from(payload, 'hex');
    if (!back.equals(Buffer.from(bytes))) return unavailable('payloadNotRoundTrip', 'hex');
    return Object.freeze({ status: 'encoded', payload, payloadEncoding: 'hex' });
  }
  return unavailable('payloadEncodingUnsupported', String(encoding));
}

// Read a producing triple from the caller's frozen step. A partial triple is refused rather than
// half-filled, because an association with one member missing cannot be compared at plan freeze.
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

// The wire boundary check. A record may travel before selection with its producing triple unclaimed,
// but nothing may be encoded or published while the producing association is incomplete, so the caller
// enforces that with one call instead of re-deriving the triple.
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

// One immutable capture record. The caller supplies the admitted canonical identity and, for a file or
// configuration, the exact accepted bytes; for a link the resolved target; for a directory the admitted
// digest. Nothing here derives authority from a label and nothing falls back to the filesystem.
export function captureRecord({ identity, bytes = null, role = 'frontend-source', kind = 'file', target = null, marker = null, producer = null, encoding = 'base64' } = {}) {
  if (!isNonEmptyString(identity)) return unavailable('identityMissing');
  if (!KINDS.includes(kind)) return unavailable('captureKindUnsupported', String(kind));
  const triple = producerOf(producer);
  if (triple.status !== 'claimed' && triple.status !== 'unclaimed') return triple;
  // Every record carries an explicit nonempty role. A record whose role is unknown would put a bare
  // label into the wire and leave the consumer to guess what it describes.
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
    return Object.freeze({
      captureKind: 'dir',
      role: field,
      path: identity,
      marker,
      payload: '',
      payloadEncoding: NO_PAYLOAD,
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

// An acquisition callable for the capture set, for a caller that must produce records before the plan
// freezes. The closure answers synchronously and immutably; there is no filesystem fallback, and every
// refusal is a value with its reason.
export function createCaptureRecords({ acquisition, encoding = 'base64', role = 'frontend-source' } = {}) {
  const counters = { acquires: 0, absent: 0, conflicts: 0, unavailable: 0, claims: 0 };
  const byCanonical = new Map();
  const byRequested = new Map();
  const order = [];

  function resolveIdentity(identity) {
    if (acquisition === undefined || acquisition === null || typeof acquisition.resolve !== 'function') {
      return { status: 'unknown', detail: 'closureResolutionMissing' };
    }
    try {
      const resolved = acquisition.resolve(identity);
      if (resolved === undefined || resolved === null) return { status: 'unknown', detail: 'closureResolutionUndefined' };
      if (resolved.exists === true) {
        const canonical = isNonEmptyString(resolved.identity) ? resolved.identity : identity;
        return { status: 'present', canonical };
      }
      if (resolved.exists === false) return { status: 'absent', canonical: isNonEmptyString(resolved.identity) ? resolved.identity : identity };
      return { status: 'unknown', detail: 'resolutionAnswerMalformed' };
    } catch (error) {
      return { status: 'unknown', detail: error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error), threw: true };
    }
  }

  function acquire(identity) {
    if (!isNonEmptyString(identity)) return unavailable('identityMissing');
    counters.acquires += 1;
    // One acquisition per requested name: a repeat is served from the record already made, so a reader
    // that would return different bytes on a second read cannot turn one identity into two captures.
    const settled = byRequested.get(identity);
    if (settled !== undefined) return settled;
    if (acquisition === undefined || acquisition === null || typeof acquisition.read !== 'function') {
      counters.unavailable += 1;
      return unavailable('closureReadMissing');
    }
    const resolution = resolveIdentity(identity);
    if (resolution.status === 'unknown') {
      counters.unavailable += 1;
      return unavailable(resolution.threw === true ? 'resolverThrew' : 'resolutionUnavailable', resolution.detail);
    }
    if (resolution.status === 'absent') {
      // An absence is a record that names the input it is an absence of.
      const record = captureRecord({ identity: resolution.canonical, role, kind: 'absent' });
      counters.absent += 1;
      byCanonical.set(resolution.canonical, { record, digest: null });
      order.push(resolution.canonical);
      const absent = Object.freeze({ status: 'absent', identity: resolution.canonical, record });
      byRequested.set(identity, absent);
      return absent;
    }
    const canonical = resolution.canonical;
    let provided;
    try {
      provided = acquisition.read(canonical);
    } catch (error) {
      counters.unavailable += 1;
      return unavailable('readerThrew', error !== null && typeof error === 'object' && typeof error.message === 'string' ? error.message : String(error));
    }
    if (provided === undefined || provided === null) {
      counters.unavailable += 1;
      return unavailable('readUnavailable');
    }
    if (provided.refuse !== undefined) {
      counters.unavailable += 1;
      return unavailable('readerRefused', String(provided.refuse));
    }
    if (!(provided.bytes instanceof Uint8Array)) {
      counters.unavailable += 1;
      return unavailable('bytesMissing');
    }
    const record = captureRecord({ identity: canonical, bytes: provided.bytes, role, kind: 'file', encoding });
    if (record.status !== undefined) {
      counters.unavailable += 1;
      return record;
    }
    const existing = byCanonical.get(canonical);
    if (existing !== undefined && existing.digest !== null && existing.digest !== record.marker) {
      counters.conflicts += 1;
      return unavailable('aliasConflict', `${canonical} was already captured with different bytes`);
    }
    if (existing === undefined) {
      byCanonical.set(canonical, { record, digest: record.marker });
      order.push(canonical);
    }
    // A later request for the same canonical identity through a different name is a conflict, not an
    // overwrite; the first capture stays exactly as it was produced.
    const captured = Object.freeze({ status: 'captured', identity: canonical, record: existing === undefined ? record : existing.record, digest: record.marker, byteLength: provided.bytes.byteLength });
    byRequested.set(identity, captured);
    return captured;
  }

  // Attaching the producing triple returns a new record; the stored one is never mutated, so a record
  // acquired before selection stays exactly as it was produced.
  function claim(identity, producer) {
    const existing = byCanonical.get(identity);
    if (existing === undefined) return unavailable('notCaptured', identity);
    const triple = producerOf(producer);
    if (triple.status !== 'claimed') return triple;
    const current = existing.record;
    const next = Object.freeze({
      captureKind: current.captureKind,
      role: current.role,
      path: current.path,
      marker: current.marker,
      payload: current.payload,
      payloadEncoding: current.payloadEncoding,
      producerModule: triple.module,
      producerDigest: triple.digest,
      producerOperation: triple.operation,
    });
    counters.claims += 1;
    byCanonical.set(identity, { record: next, digest: existing.digest });
    return Object.freeze({ status: 'claimed', record: next });
  }

  return Object.freeze({
    counters,
    acquire,
    claim,
    records() {
      return Object.freeze(order.map((identity) => byCanonical.get(identity).record));
    },
  });
}
