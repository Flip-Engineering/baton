// Explicit backend v1 bridge for the TypeScript provider.
//
// The declaration schema this lane publishes is version 1 and the provider's
// own request/result wire is version 1 (lib/protocol.mjs), while Core admits
// transport "2" only and serves a selected plan under a frozen version-2
// invocation frame (Invocation{"2", ...}). This module translates exactly
// that boundary and nothing else: it extracts a runnable request from
// whatever the launcher hands the provider on stdin, and it frames a v1
// provider result as a version-2 transport event carrying the admitted
// producer binding. No member is relabelled: version 1 stays version 1,
// version 2 stays version 2, and the translation is named on every answer.
//
// Authorities (root c1c2 source, read-only):
//   engines-decl.bend  decl_version_supported / protocol_version_supported
//   engines-select.bend invocation_of / invocation_from_step (frozen "2")
//   codec-wire.bend     invocation_frame / event_frame member order and the
//                       verbatim splice rule (the module splices binding and
//                       payload verbatim and never re-spells them)
//   provider.mjs:1-15   Core owns the launch contract and the frame wrapper;
//                       this entry reads one request from stdin and writes
//                       one frame to stdout with the outcome on the exit code

const INVOCATION_MEMBERS = Object.freeze([
  'version',
  'query',
  'owner',
  'moduleBinding',
  'request',
  'inputIdentities',
  'operationPlan',
  'role',
  'incarnation',
]);

function refusal(reason, detail) {
  return Object.freeze({ status: 'refused', reason, detail: detail === undefined ? null : detail });
}

function jsonString(value) {
  let out = '"';
  for (const unit of value) {
    const code = unit.codePointAt(0);
    if (unit === '"') out += '\\"';
    else if (unit === '\\') out += '\\\\';
    else if (unit === '\n') out += '\\n';
    else if (unit === '\r') out += '\\r';
    else if (unit === '\t') out += '\\t';
    else if (unit === '\b') out += '\\b';
    else if (unit === '\f') out += '\\f';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += unit;
  }
  return `${out}"`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Extract the runnable request from launcher stdin bytes. Three admitted
// shapes, each named on the answer; anything else is refused, never guessed.
export function bridgeInvocationToRequest(stdinText) {
  if (typeof stdinText !== 'string' || stdinText.length === 0) {
    return refusal('emptyInput', 'the launcher supplied no stdin bytes');
  }
  let parsed = null;
  let isJson = true;
  try {
    parsed = JSON.parse(stdinText);
  } catch {
    isJson = false;
  }
  if (!isJson || !isRecord(parsed)) {
    // The admitted canonical request bytes travel as raw text.
    return Object.freeze({ status: 'request', envelope: 'canonicalBytes', request: stdinText, binding: null, query: null, owner: null });
  }
  if (typeof parsed.requestCanonical === 'string') {
    return Object.freeze({ status: 'request', envelope: 'requestCanonical', request: parsed.requestCanonical, binding: null, query: null, owner: null });
  }
  if (parsed.version === 2) {
    if (typeof parsed.request !== 'string') {
      return refusal('invocationMissingRequest', 'a version-2 invocation frame carries no text request member');
    }
    let binding = null;
    if (parsed.moduleBinding !== undefined && parsed.moduleBinding !== null) {
      if (typeof parsed.moduleBinding !== 'string') {
        return refusal('invocationBindingNotText', 'the producer binding travels as text the bridge splices verbatim');
      }
      binding = parsed.moduleBinding;
    }
    return Object.freeze({
      status: 'request',
      envelope: 'invocationV2',
      request: parsed.request,
      binding,
      query: typeof parsed.query === 'string' ? parsed.query : null,
      owner: typeof parsed.owner === 'string' ? parsed.owner : null,
    });
  }
  if (parsed.version === 1) {
    // The provider's own version-1 request wire flows through unchanged.
    return Object.freeze({ status: 'request', envelope: 'providerRequestV1', request: stdinText, binding: null, query: null, owner: null });
  }
  if (parsed.version !== undefined) {
    return refusal('wrongVersion', `saw version ${String(parsed.version)}; the bridge admits canonical bytes, requestCanonical, provider version 1, or invocation version 2`);
  }
  return refusal('unrecognizedFrame', 'a JSON object on stdin names neither requestCanonical, a provider version, nor an invocation version');
}

function verbatimJson(text, reason) {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, refusal: refusal(reason, 'a JSON text value is required') };
  }
  try {
    JSON.parse(text);
  } catch {
    return { ok: false, refusal: refusal(reason, 'the value does not parse as JSON') };
  }
  return { ok: true, text };
}

// Frame one v1 provider result as a version-2 transport event. Member order
// follows codec-wire event_frame exactly; runtime, role and incarnation are
// the empty string of a direct invocation; the producer binding and the
// payload are spliced verbatim.
export function frameProviderEvent({ query, owner, producer, sequence, frameType, payload } = {}) {
  if (typeof query !== 'string' || typeof owner !== 'string') {
    return refusal('eventIdentityMissing', 'query and owner are concrete strings on a framed event');
  }
  if (typeof sequence !== 'string' || sequence.length === 0) {
    return refusal('eventSequenceMissing', 'a framed event carries a nonempty sequence');
  }
  if (typeof frameType !== 'string' || frameType.length === 0) {
    return refusal('eventTypeMissing', 'a framed event carries a nonempty type');
  }
  const bound = verbatimJson(producer, 'producerNotJson');
  if (!bound.ok) return bound.refusal;
  const body = verbatimJson(payload, 'payloadNotJson');
  if (!body.ok) return body.refusal;
  return (
    `{"version":2,"query":${jsonString(query)}`
    + `,"owner":${jsonString(owner)}`
    + `,"moduleBinding":${bound.text}`
    + `,"runtime":""`
    + `,"role":""`
    + `,"incarnation":""`
    + `,"sequence":${jsonString(sequence)}`
    + `,"type":${jsonString(frameType)}`
    + `,"payload":${body.text}}`
  );
}

export { INVOCATION_MEMBERS };
