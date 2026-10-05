// CDP runtime lane: the closed transport envelope between the native observer
// and the Node adapter process.
//
// Contract: docs/bend2/semantic-context-spec.md, "Runtime contract". Native to
// adapter frames are {version:1,query,request}. Adapter frames are
// {version:1,query,runtime,role,incarnation,sequence,type,payload} with nullable
// runtime, a monotone sequence per adapter and type accepted|complete|failed|state.
// Only complete frames carry the validated result shape. State frames carry
// runtime state/evidence and unsolicited state has a null query. Malformed
// frames, foreign runtime/query/role/incarnation identities and a repeated
// sequence carrying different bytes fail the protocol. A replayed identical
// frame is idempotent.
//
// This module is pure: no filesystem, clock or transport access. Every refusal
// is a typed ProtocolRefusal so a caller records the condition, never raw text.

export const TRANSPORT_VERSION = 1;

export const ROLES = Object.freeze(['starter', 'target', 'adapter']);

export const FRAME_TYPES = Object.freeze(['accepted', 'complete', 'failed', 'state']);

export const FRAME_KEYS = Object.freeze([
  'version',
  'query',
  'runtime',
  'role',
  'incarnation',
  'sequence',
  'type',
  'payload',
]);

// The payload a frame type must carry, and the keys that payload admits.
const PAYLOAD_SHAPES = Object.freeze({
  accepted: Object.freeze({ required: Object.freeze(['state']), optional: Object.freeze([]) }),
  complete: Object.freeze({ required: Object.freeze(['result']), optional: Object.freeze([]) }),
  failed: Object.freeze({ required: Object.freeze(['error']), optional: Object.freeze(['limits']) }),
  state: Object.freeze({
    required: Object.freeze(['state']),
    optional: Object.freeze(['evidence', 'progress']),
  }),
});

export class ProtocolRefusal extends Error {
  constructor(condition, detail) {
    super(detail === undefined || detail === null ? condition : `${condition}: ${detail}`);
    this.name = 'ProtocolRefusal';
    this.condition = condition;
    this.detail = detail === undefined ? null : detail;
  }
}

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value) => typeof value === 'string' && value.length > 0;

function refusal(condition, detail) {
  return { ok: false, condition, detail: detail === undefined ? null : detail };
}

// The closed payload shape of one frame type. A complete frame must carry a
// non-null result object; anything else leaves the result unvalidated.
function admitPayload(type, payload) {
  if (!isPlainObject(payload)) return refusal('payloadMalformed', `${type} payload is not an object`);
  const shape = PAYLOAD_SHAPES[type];
  if (shape === undefined) return refusal('frameTypeUnknown', String(type));
  for (const key of Object.keys(payload)) {
    if (!shape.required.includes(key) && !shape.optional.includes(key)) {
      return refusal('payloadUnknownField', `${type}.${key}`);
    }
  }
  for (const key of shape.required) {
    if (!Object.hasOwn(payload, key)) {
      return refusal('payloadMissingField', `${type}.${key}`);
    }
  }
  if (type === 'complete' && !isPlainObject(payload.result)) {
    return refusal('incompleteResult', 'a complete frame carries the validated result object');
  }
  if (type === 'failed' && !isPlainObject(payload.error)) {
    return refusal('payloadMalformed', 'failed.error');
  }
  if ((type === 'accepted' || type === 'state') && !isText(payload.state)) {
    return refusal('payloadMalformed', `${type}.state`);
  }
  if (type === 'state' && Object.hasOwn(payload, 'evidence') && payload.evidence !== null && !isPlainObject(payload.evidence)) {
    return refusal('payloadMalformed', 'state.evidence');
  }
  if (type === 'state' && Object.hasOwn(payload, 'progress') && payload.progress !== null && !isPlainObject(payload.progress)) {
    return refusal('payloadMalformed', 'state.progress');
  }
  return { ok: true, payload };
}

// Validate one frame against the closed envelope. `expect` binds the frame to a
// recorded identity: {runtime, role, incarnation, query}. A member that is
// absent from `expect` is not checked; a member present must match exactly.
export function admitFrame(text, expect = {}) {
  if (typeof text !== 'string') return refusal('frameNotText', typeof text);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return refusal('frameMalformed', error.message);
  }
  if (!isPlainObject(parsed)) return refusal('frameMalformed', 'frame is not an object');
  const keys = Object.keys(parsed);
  if (keys.length !== FRAME_KEYS.length) {
    const unknown = keys.filter((key) => !FRAME_KEYS.includes(key));
    const missing = FRAME_KEYS.filter((key) => !Object.hasOwn(parsed, key));
    return refusal(unknown.length ? 'frameUnknownField' : 'frameMissingField',
      unknown.length ? unknown.join(',') : missing.join(','));
  }
  if (parsed.version !== TRANSPORT_VERSION) {
    return refusal('frameVersionUnsupported', String(parsed.version));
  }
  if (!FRAME_TYPES.includes(parsed.type)) return refusal('frameTypeUnknown', String(parsed.type));
  if (!ROLES.includes(parsed.role)) return refusal('frameRoleUnknown', String(parsed.role));
  if (!isText(parsed.incarnation)) return refusal('frameIncarnationMissing', String(parsed.incarnation));
  if (parsed.runtime !== null && !isText(parsed.runtime)) {
    return refusal('frameRuntimeMalformed', String(parsed.runtime));
  }
  if (parsed.query !== null && !isText(parsed.query)) {
    return refusal('frameQueryMalformed', String(parsed.query));
  }
  if (parsed.query === null && parsed.type !== 'state') {
    return refusal('frameQueryMissing', `${parsed.type} must name its query`);
  }
  if (parsed.type === 'state' && parsed.query === null && parsed.runtime === null) {
    return refusal('frameRuntimeMissing', 'an unsolicited state frame names its runtime');
  }
  if (!Number.isSafeInteger(parsed.sequence) || parsed.sequence < 0) {
    return refusal('frameSequenceMalformed', String(parsed.sequence));
  }
  for (const member of ['runtime', 'role', 'incarnation', 'query']) {
    if (expect[member] !== undefined && parsed[member] !== expect[member]) {
      return refusal('foreignIdentity', `${member} ${JSON.stringify(parsed[member])} != ${JSON.stringify(expect[member])}`);
    }
  }
  const payload = admitPayload(parsed.type, parsed.payload);
  if (!payload.ok) return payload;
  return { ok: true, frame: parsed };
}

function assertAdmissible(frame) {
  const admitted = admitFrame(encodeFrame(frame));
  if (!admitted.ok) throw new ProtocolRefusal(admitted.condition, admitted.detail);
  return admitted.frame;
}

// Canonical frame text: the closed key order above, so identical frames produce
// identical bytes and a replay compares byte for byte.
export function encodeFrame(frame) {
  if (!isPlainObject(frame)) throw new ProtocolRefusal('frameMalformed', 'frame is not an object');
  const ordered = {};
  for (const key of FRAME_KEYS) ordered[key] = Object.hasOwn(frame, key) ? frame[key] : null;
  return JSON.stringify(ordered);
}

// A frame that passed encode/admit, with the bytes a replay is compared against.
export function sealedFrame(frame) {
  const admitted = assertAdmissible(frame);
  return { frame: admitted, bytes: encodeFrame(admitted) };
}

// The per-adapter sequence state. `previous` is the retained state or null.
// Identical bytes at a retained sequence are the idempotent replay of a frame
// already consumed; different bytes at a retained sequence are a protocol
// failure; a sequence below the highest retained one is a replay and must match
// its retained bytes.
export function sequenceAdmit(previous, sequence, bytes) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    return refusal('frameSequenceMalformed', String(sequence));
  }
  if (typeof bytes !== 'string' || bytes.length === 0) {
    return refusal('frameBytesMissing', null);
  }
  if (previous === null || previous === undefined) {
    return { ok: true, sequence, bytes, replay: false, retained: Object.freeze({ [sequence]: bytes }) };
  }
  const retained = Object.hasOwn(previous.retained, sequence) ? previous.retained[sequence] : undefined;
  if (retained !== undefined) {
    if (retained === bytes) return { ok: true, sequence, bytes, replay: true, retained: previous.retained };
    return refusal('sequenceConflict', `sequence ${sequence} already carries different bytes`);
  }
  if (sequence <= previous.sequence) {
    return refusal('sequenceConflict', `sequence ${sequence} is below the retained ${previous.sequence}`);
  }
  return {
    ok: true,
    sequence,
    bytes,
    replay: false,
    retained: Object.freeze({ ...previous.retained, [sequence]: bytes }),
  };
}
