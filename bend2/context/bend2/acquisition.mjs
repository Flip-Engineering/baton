// Capture custody acquisition for the Bend2 frontend bridge.
//
// The operand this module returns is the `acquisition` a frontend adapter consumes: existence and
// canonical admitted identity for a requested name, and the exact accepted bytes for that
// identity. All three answers come from a retained captured set that performed the reads itself
// and keeps the accepted bytes. This module reads no file, resolves no name on the host, holds no
// read root and re-proves no digest.
//
// Custody boundary:
//   * the retained captured set is the acquisition authority; its rows are the only source of
//     existence, canonical identity and bytes;
//   * a captured record -- the nine members Core's `Wire.capture_json` renders -- is a claim by
//     whoever wrote it, so it is refused as an acquisition source (`claimedRecordNotCustody`);
//   * the producing binding of a capture is a claimed association carried beside the capture
//     (`association(name)`). It decides no existence, no identity and no byte, and it never stands
//     in for the admitted step binding its holder took from admission;
//   * a name the captured set never recorded answers nothing. Absence is stated by a recorded
//     absence row and is never inferred from a missing row.
//
// The captured set interface is the pair of accessors the retained captured-filesystem host
// already supplies:
//   descriptors()      -> [{kind, path, real?, sha256?, detail?}, ...]   no host access
//   readBytes(path)    -> Uint8Array | undefined    the retained bytes of a recorded file or
//                                                   configuration entry, with no further host access
//
// Representation limits:
//   * the bytes handed out are the retained set's own buffer for that entry, without a copy; the
//     sole consumer, `source-binding.captureSource`, takes a private snapshot before deriving
//     anything;
//   * the row's `sha256` is recorded as the set's own identity for the bytes it retains; this
//     module does not re-hash and does not authenticate;
//   * a row carrying a file-lookup marker (`fileLookup`/`directoryLookup`) is not listed by the
//     host's `descriptors()`. A path in that state answers nothing, which leaves the loader to
//     refuse explicitly.

const FILE_KINDS = Object.freeze(['file', 'config']);
const CLAIMED_RECORD_MEMBERS = Object.freeze([
  'captureKind',
  'role',
  'path',
  'marker',
  'payload',
  'payloadEncoding',
  'producerModule',
  'producerDigest',
  'producerOperation',
]);
const CLAIMED_RECORD_ALIASES = Object.freeze(['capture_kind', 'payload_encoding']);

function errorText(error) {
  if (error === null || error === undefined) return 'unknown error';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message.length > 0) return error.message;
  return String(error);
}

function refusal(reason, detail) {
  return Object.freeze({ status: 'refused', reason, detail: detail === undefined ? null : detail });
}

function isRetainedCapture(value) {
  return value !== null && typeof value === 'object'
    && typeof value.descriptors === 'function'
    && typeof value.readBytes === 'function';
}

// A record that carries any member of the rendered capture spelling is a claim, not a captured set.
export function isClaimedCaptureRecord(value) {
  if (value === null || typeof value !== 'object') return false;
  if (CLAIMED_RECORD_MEMBERS.some((member) => value[member] !== undefined)) return true;
  return CLAIMED_RECORD_ALIASES.some((member) => value[member] !== undefined);
}

function rowRefusal(row, index) {
  if (row === null || typeof row !== 'object') return `descriptor row ${index} is not an object`;
  if (typeof row.kind !== 'string' || row.kind.length === 0) return `descriptor row ${index} carries no kind`;
  if (typeof row.path !== 'string' || row.path.length === 0) return `descriptor row ${index} carries no path`;
  return null;
}

// One immutable answer per recorded name and per canonical identity. `presence` is what `resolve`
// returns, `readAnswer` is what `read` returns, and both are precomputed so repeated questions
// receive the identical frozen object.
function fileAnswer(kind, name, identity, digest, bytes) {
  return Object.freeze({
    kind,
    name,
    identity,
    digest,
    bytes,
    presence: Object.freeze({ exists: true, identity }),
    readAnswer: Object.freeze({ bytes }),
  });
}

function directoryAnswer(name, identity) {
  return Object.freeze({
    kind: 'directory',
    name,
    identity,
    digest: null,
    bytes: undefined,
    presence: Object.freeze({ exists: true, identity }),
    readAnswer: Object.freeze({ refuse: 'sourceInputKindUnsupported: directory' }),
  });
}

function linkAnswer(name, identity, target) {
  return Object.freeze({
    kind: 'symlink',
    name,
    identity,
    digest: target === undefined ? null : target.digest,
    bytes: target === undefined ? undefined : target.bytes,
    presence: Object.freeze({ exists: true, identity }),
    readAnswer: target === undefined
      ? Object.freeze({ refuse: 'sourceInputKindUnsupported: symlink' })
      : target.readAnswer,
  });
}

function absentAnswer(name, identity) {
  return Object.freeze({
    kind: 'absent',
    name,
    identity,
    digest: null,
    bytes: undefined,
    presence: Object.freeze({ exists: false, identity }),
    readAnswer: Object.freeze({ captureKind: 'absent', path: identity }),
  });
}

function failedAnswer(name, detail) {
  return Object.freeze({
    kind: 'failed',
    name,
    identity: name,
    digest: null,
    bytes: undefined,
    presence: undefined,
    readAnswer: Object.freeze({ refuse: `captureFailed: ${detail}` }),
  });
}

// The base document is located by the pinned digest over the recorded files. A name a caller
// supplies never selects it.
function selectBase(files, basePin) {
  if (basePin === null || basePin === undefined) return undefined;
  if (typeof basePin.sha256 !== 'string' || basePin.sha256.length === 0) return undefined;
  const candidates = files
    .filter((answer) => answer.digest === basePin.sha256)
    .sort((left, right) => {
      const leftExact = left.name === basePin.path ? 0 : 1;
      const rightExact = right.name === basePin.path ? 0 : 1;
      if (leftExact !== rightExact) return leftExact - rightExact;
      if (left.identity !== right.identity) return left.identity < right.identity ? -1 : 1;
      return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
  return candidates.length === 0 ? undefined : candidates[0].name;
}

function buildClaimedProducers(claimedProducers) {
  if (claimedProducers === null || claimedProducers === undefined) return new Map();
  if (!(claimedProducers instanceof Map)) {
    return refusal('claimedProducerMalformed', 'the claimed producing associations must be a Map keyed by capture name');
  }
  const frozen = new Map();
  for (const [name, association] of claimedProducers) {
    if (typeof name !== 'string' || name.length === 0) {
      return refusal('claimedProducerMalformed', 'a claimed producing association carries no capture name');
    }
    if (association === null || typeof association !== 'object') {
      return refusal('claimedProducerMalformed', `${name}: the claimed producing association is not an object`);
    }
    const { module, digest, operation } = association;
    for (const [member, value] of [['module', module], ['digest', digest], ['operation', operation]]) {
      if (typeof value !== 'string' || value.length === 0) {
        return refusal('claimedProducerMalformed', `${name}: the claimed producing association carries no ${member}`);
      }
    }
    frozen.set(name, Object.freeze({ module, digest, operation }));
  }
  return frozen;
}

export function createRetainedAcquisition({ capture, basePin, claimedProducers } = {}) {
  if (capture === null || capture === undefined) {
    return refusal(
      'custodyOperandMissing',
      'a retained captured set supplying descriptors() and readBytes() is required; neither a query-keyed association nor a captured record carries the exact accepted bytes',
    );
  }
  if (isClaimedCaptureRecord(capture)) {
    return refusal(
      'claimedRecordNotCustody',
      'a captured record is a claim by its writer; the exact accepted bytes come from the retained captured set',
    );
  }
  if (!isRetainedCapture(capture)) {
    return refusal(
      'custodyOperandMissing',
      'the captured set must supply descriptors() and readBytes(); the caller cannot supply the accepted bytes',
    );
  }

  let rows;
  try {
    rows = capture.descriptors();
  } catch (error) {
    return refusal('captureSetMalformed', `descriptors() raised: ${errorText(error)}`);
  }
  if (!Array.isArray(rows)) {
    return refusal('captureSetMalformed', 'descriptors() did not return an array of rows');
  }

  const byName = new Map();
  const byCanonical = new Map();
  const files = [];
  const deferred = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const invalid = rowRefusal(row, index);
    if (invalid !== null) return refusal('captureSetMalformed', invalid);
    if (row.kind === 'symlink' || row.kind === 'directory') {
      deferred.push(row);
      continue;
    }
    if (FILE_KINDS.includes(row.kind)) {
      if (typeof row.real !== 'string' || row.real.length === 0) {
        return refusal('captureSetMalformed', `${row.kind} row ${row.path} carries no canonical path`);
      }
      if (typeof row.sha256 !== 'string' || row.sha256.length === 0) {
        return refusal('captureSetMalformed', `${row.kind} row ${row.path} carries no digest`);
      }
      const known = byCanonical.get(row.real);
      if (known !== undefined) {
        if (known.digest !== row.sha256) {
          return refusal(
            'captureSetMalformed',
            `${row.path} and ${known.name} name the canonical path ${row.real} with different digests`,
          );
        }
        if (byName.has(row.path)) {
          return refusal('captureSetMalformed', `${row.path} is recorded twice`);
        }
        byName.set(row.path, known);
        continue;
      }
      let bytes;
      try {
        bytes = capture.readBytes(row.path);
      } catch (error) {
        return refusal('captureSetMalformed', `readBytes(${row.path}) raised: ${errorText(error)}`);
      }
      if (!(bytes instanceof Uint8Array)) {
        return refusal('captureSetMalformed', `the retained bytes of ${row.path} are unavailable`);
      }
      if (byName.has(row.path)) return refusal('captureSetMalformed', `${row.path} is recorded twice`);
      const answer = fileAnswer(row.kind, row.path, row.real, row.sha256, bytes);
      byName.set(row.path, answer);
      byCanonical.set(row.real, answer);
      files.push(answer);
      continue;
    }
    if (row.kind === 'absent') {
      if (byName.has(row.path)) return refusal('captureSetMalformed', `${row.path} is recorded twice`);
      byName.set(row.path, absentAnswer(row.path, row.path));
      continue;
    }
    if (row.kind === 'failed') {
      if (byName.has(row.path)) return refusal('captureSetMalformed', `${row.path} is recorded twice`);
      byName.set(row.path, failedAnswer(
        row.path,
        typeof row.detail === 'string' && row.detail.length > 0 ? row.detail : 'unreadable',
      ));
      continue;
    }
    return refusal('captureSetMalformed', `descriptor row ${row.path} carries the unsupported kind ${row.kind}`);
  }

  for (const row of deferred) {
    if (row.kind === 'directory') {
      const identity = typeof row.real === 'string' && row.real.length > 0 ? row.real : row.path;
      if (byName.has(row.path)) return refusal('captureSetMalformed', `${row.path} is recorded twice`);
      const answer = directoryAnswer(row.path, identity);
      byName.set(row.path, answer);
      if (!byCanonical.has(identity)) byCanonical.set(identity, answer);
      continue;
    }
    const identity = typeof row.real === 'string' && row.real.length > 0 ? row.real : null;
    if (identity === null) return refusal('captureSetMalformed', `symlink row ${row.path} carries no target path`);
    if (byName.has(row.path)) return refusal('captureSetMalformed', `${row.path} is recorded twice`);
    const answer = linkAnswer(row.path, identity, byCanonical.get(identity));
    byName.set(row.path, answer);
  }

  const claimed = buildClaimedProducers(claimedProducers);
  if (claimed.status === 'refused') return claimed;

  const base = selectBase(files, basePin);

  function lookup(name) {
    if (typeof name !== 'string' || name.length === 0) return undefined;
    const direct = byName.get(name);
    if (direct !== undefined) return direct;
    return byCanonical.get(name);
  }

  return Object.freeze({
    resolve(name) {
      const answer = lookup(name);
      return answer === undefined ? undefined : answer.presence;
    },
    read(name) {
      const answer = lookup(name);
      return answer === undefined ? undefined : answer.readAnswer;
    },
    baseBend: base,
    association(name) {
      return claimed.get(name);
    },
  });
}
