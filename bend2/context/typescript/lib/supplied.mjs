// Decode this step's retained files, missing paths and directory listings.
// An omitted set uses live inputs; a present set supplies the recorded inputs.

function refused(reason, detail) {
  return detail === undefined
    ? Object.freeze({ status: 'refused', reason })
    : Object.freeze({ status: 'refused', reason, detail });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// A directory answer carries the names the host recorded as a JSON array in the payload these fields
// already have, under the byte encoding this contract names. A legal name may contain any character, a
// newline included, so the list is not newline separated; decoding is ordinary JSON. A record without a
// names payload describes existence only, and one whose payload is not an array of names is refused
// rather than served as an empty membership.
function decodeDirectoryNames(record) {
  if (record.payloadEncoding !== 'base64') return null;
  if (typeof record.payload !== 'string') return null;
  if (record.payload.length === 0) return Object.freeze([]);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(record.payload, 'base64').toString('utf8'));
  } catch {
    return refused('suppliedNamesMalformed', `${record.path}: the membership payload is not JSON`);
  }
  if (!Array.isArray(parsed) || parsed.some((name) => typeof name !== 'string')) {
    return refused('suppliedNamesMalformed', `${record.path}: the membership payload is not a JSON array of names`);
  }
  return Object.freeze(parsed);
}

// Decode the payload of one record. Ordinary decoding errors are refused and the encoding name must be
// one the contract carries; the payload is not re-encoded to prove it round-trips, and the marker is
// passed through as identity metadata rather than re-derived or compared.
export function decodeSuppliedBytes(record) {
  const path = record.path;
  if (!isNonEmptyString(path)) return refused('suppliedPathMissing');
  const payload = record.payload;
  const encoding = record.payloadEncoding;
  if (typeof payload !== 'string') return refused('suppliedPayloadMissing', path);
  let bytes;
  if (encoding === 'base64') {
    if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return refused('suppliedEncodingInvalid', `${path}: base64`);
    bytes = Buffer.from(payload, 'base64');
  } else if (encoding === 'hex') {
    if (payload.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(payload)) return refused('suppliedEncodingInvalid', `${path}: hex`);
    bytes = Buffer.from(payload, 'hex');
  } else {
    return refused('suppliedEncodingUnsupported', `${path}: ${typeof encoding === 'string' ? encoding : 'missing'}`);
  }
  return Object.freeze({
    status: 'decoded',
    path,
    bytes,
    marker: isNonEmptyString(record.marker) ? record.marker : null,
  });
}

// The records this step owns. A producer triple is compared member by member against the binding the
// invocation carries, so a record produced by another step is not consumed; a record with no claimed
// producer is accepted only when the invocation carries no binding to compare.
export function suppliedCaptures(invocation) {
  const records = invocation === null || typeof invocation !== 'object' ? null : invocation.inputIdentities;
  if (records === undefined || records === null) return Object.freeze({ status: 'none', entries: Object.freeze([]) });
  if (!Array.isArray(records)) return refused('inputIdentitiesShape');
  // An empty array is a present set with no inputs, not the absence of a set: the caller must not be
  // able to turn a managed invocation into a filesystem one by supplying nothing.
  if (records.length === 0) return Object.freeze({ status: 'supplied', entries: Object.freeze([]) });
  const binding = invocation.moduleBinding;
  const entries = [];
  for (const record of records) {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) return refused('suppliedRecordShape');
    // A record in a managed invocation must carry the complete producing association, checked here
    // against the encoder's three rendered member names rather than through a helper on the shared side.
    const claimed = isNonEmptyString(record.producerModule)
      && isNonEmptyString(record.producerDigest)
      && isNonEmptyString(record.producerOperation);
    if (!claimed) return refused('suppliedProducerIncomplete', record.path ?? null);
    if (binding !== null && binding !== undefined && typeof binding === 'object') {
      const matches = record.producerModule === binding.id
        && record.producerDigest === binding.declarationDigest
        && record.producerOperation === binding.operation;
      // A record that names another step is not this step's input; it is left out rather than refused,
      // because the plan may carry captures for every step it selected.
      if (!matches) continue;
    }
    if (record.captureKind === 'absent') {
      if (!isNonEmptyString(record.path)) return refused('suppliedPathMissing');
      entries.push(Object.freeze({ kind: 'absent', path: record.path }));
      continue;
    }
    // A directory record replays the membership the producing host recorded, when it carried one. Without
    // names it is existence only, and the capture host then refuses a listing rather than reporting an
    // empty directory or inferring one.
    if (record.captureKind === 'dir') {
      if (!isNonEmptyString(record.path)) return refused('suppliedPathMissing');
      if (!isNonEmptyString(record.marker)) return refused('suppliedMarkerMissing', record.path);
      const names = decodeDirectoryNames(record);
      if (names !== null && !Array.isArray(names)) return names;
      entries.push(Object.freeze({ kind: 'dir', path: record.path, marker: record.marker, names }));
      continue;
    }
    if (record.captureKind !== 'file' && record.captureKind !== 'config') {
      return refused('suppliedKindUnsupported', `${String(record.captureKind)}: ${String(record.path)}`);
    }
    const decoded = decodeSuppliedBytes(record);
    if (decoded.status !== 'decoded') return decoded;
    if (decoded.marker === null) return refused('suppliedMarkerMissing', decoded.path);
    entries.push(Object.freeze({ kind: record.captureKind, path: decoded.path, bytes: decoded.bytes, sha256: decoded.marker }));
  }
  return Object.freeze({ status: 'supplied', entries: Object.freeze(entries) });
}
