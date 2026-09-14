// provider-faults.mjs — THE provider-fault taxonomy (#295).
//
// A provider answer that ends a turn is evidence with a MEANING, and only the adapter that
// received it can read that meaning off the wire (frame stop reason, JSON-RPC error code, a
// 429-shaped status, the provider's own message text). Downstream — the coordinator, the route
// readiness derivation, the run projections — never re-reads provider prose (#267): it reads the
// typed code and the bounded detail this module mints.
//
// Three classes exist, each naming exactly what was observed:
//
//   provider_quota_exhausted — the provider refused for a quota/limit reason. `detail.resetAt`
//       carries the instant the provider said the limit resets, PARSED from its answer when the
//       answer carries one, never invented. A quota fault is not transient: the same route will
//       refuse again until that instant, so a turn in this class is never re-driven in place.
//   provider_socket_closed  — the provider connection dropped mid-turn. Transient by
//       construction: the same route may answer again, so this is the one class a fresh turn on
//       the same session may re-drive.
//   provider_turn_failed    — the named generic, for a failed turn whose class the boundary could
//       not name. Never a bare `omp_<stopReason>` and never a silent death.
//
// The reset instant is a fact about the PROVIDER's clock, so the parse is deliberately narrow: a
// spelled ISO-8601-shaped date-time, with an explicit zone when the answer carries one. A
// zone-less date-time is read as UTC, so the same answer means the same instant on every host
// that recorded it (a host-local reading would make one recorded reset compare differently per
// machine, which is exactly what a readiness derivation may not do).

import { FRAME_LIMITS } from './limits.mjs';

export const PROVIDER_FAULT_CODES = Object.freeze({
  quota: 'provider_quota_exhausted',
  socket: 'provider_socket_closed',
  generic: 'provider_turn_failed',
});

/** The one class a fresh turn may re-drive on the same session: the connection dropped, the
 * provider recorded no result, and the route itself is not known to be refusing. */
export const TRANSIENT_PROVIDER_FAULT_CODES = Object.freeze([PROVIDER_FAULT_CODES.socket]);

export function isTransientProviderFault(code) {
  return TRANSIENT_PROVIDER_FAULT_CODES.includes(code);
}

const ROUTE_FIELDS = Object.freeze(['harness', 'model', 'effort']);

/** The closed exact-route identity a fault is attributed to, or null when the caller has none.
 * Harness/model/effort only — never a provider token, a path, or a credential coordinate. */
export function normalizeProviderRoute(route) {
  if (!route || typeof route !== 'object' || Array.isArray(route)) return null;
  const fields = {};
  for (const field of ROUTE_FIELDS) {
    const value = route[field];
    if (typeof value !== 'string' || value.length === 0 || value.length > 256) return null;
    fields[field] = value;
  }
  return Object.freeze(fields);
}

/** Structured codes that mean "the provider refused for quota" — an HTTP-ish status or a
 * provider-reported limit code. Membership is a DECLARATION, not a guess: adding a provider
 * vocabulary word is a deliberate act here. */
const QUOTA_CODES = new Set([
  '429', 'rate_limit', 'rate_limited', 'rate_limit_exceeded', 'too_many_requests',
  'usage_limit', 'usage_limit_reached', 'usage_limit_exceeded',
  'quota', 'quota_exceeded', 'insufficient_quota', 'resource_exhausted',
]);

/** Structured codes that mean "the connection to the provider dropped". */
const SOCKET_CODES = new Set([
  'econnreset', 'econnrefused', 'econnaborted', 'epipe', 'etimedout', 'enotfound', 'eai_again',
  'ehostunreach', 'enetunreach', 'und_err_socket', 'und_err_connect_timeout',
  'socket_closed', 'socket_hang_up', 'transport_closed', 'transport_process_exit',
]);

// Prose fallbacks. These exist ONLY at the boundary, because a provider that answers in prose is
// still answering: omp reports a spent plan as a failed turn whose message carries the limit
// text. The coordinator never runs these — it reads the code minted here (#267).
const QUOTA_TEXT = /usage limit|rate.?limit|quota|too many requests|\b429\b/iu;
const SOCKET_TEXT = /socket connection (?:was )?closed|socket (?:hang ?up|closed|error)|connection (?:was )?(?:reset|closed|dropped|terminated)|closed unexpectedly|connection refused|fetch failed|network error|econnreset/iu;

// The scan bound is the declared attention-text lane — the provider's answer is read exactly as
// far as any other attention-shaped text in this repository, never a this-module literal.
const ANSWER_SCAN_BYTES = FRAME_LIMITS['view.attention_text.bytes'].value;

const RESET_AT_TEXT = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?/u;

function boundedText(value, limit) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, limit) : '';
}

/**
 * The reset instant the provider's own answer named, as a canonical ISO-8601 UTC string, or null
 * when the answer named none. Bounded scan (the message is already bounded by the caller), one
 * spelling: an ISO-8601-shaped date-time. A zone-less reading is UTC (see the module header).
 */
export function parseProviderResetAt(text) {
  const message = boundedText(text, ANSWER_SCAN_BYTES);
  if (message.length === 0) return null;
  const match = RESET_AT_TEXT.exec(message);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00', fraction = '0', zone = ''] = match;
  const numeric = [year, month, day, hour, minute, second].map((part) => Number.parseInt(part, 10));
  if (numeric.some((part) => !Number.isSafeInteger(part))) return null;
  const [y, mo, d, h, mi, s] = numeric;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const offset = zone === '' || zone === 'Z' || zone === 'UTC' || zone === 'GMT'
    ? 'Z' : (zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`);
  const millis = Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, '0')}${offset}`,
  );
  if (!Number.isFinite(millis)) return null;
  return new Date(millis).toISOString();
}

function structuredCodes(answer) {
  const candidates = [answer?.code, answer?.statusCode, answer?.status, answer?.errorCode,
    answer?.error?.code, answer?.cause?.code];
  return candidates
    .map((value) => (typeof value === 'number' ? String(value)
      : typeof value === 'string' ? value : ''))
    .filter((value) => value.length > 0 && value.length <= 128)
    .map((value) => value.toLowerCase());
}

function answerText(answer) {
  const candidates = [answer?.errorMessage, answer?.message, answer?.error, answer?.detail,
    answer?.reason, answer?.cause?.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return '';
}

/**
 * Type one provider answer that ended a turn. Returns `{ code, detail }` — `detail` always names
 * the exact route (when the caller has one) and the reset instant when the provider's answer
 * carried one. Never throws: an answer nothing matches is the named generic, not an error.
 */
export function classifyProviderFault(answer = {}, { route = null } = {}) {
  const exactRoute = normalizeProviderRoute(route);
  const codes = structuredCodes(answer);
  const text = boundedText(answerText(answer), ANSWER_SCAN_BYTES);
  const detail = {
    ...(exactRoute ? { route: exactRoute } : {}),
  };
  const statusCode = codes.find((code) => /^\d{3}$/u.test(code)) ?? null;
  const quotaByCode = codes.some((code) => QUOTA_CODES.has(code));
  const socketByCode = codes.some((code) => SOCKET_CODES.has(code));
  if (quotaByCode || QUOTA_TEXT.test(text)) {
    const resetAt = parseProviderResetAt(text);
    return Object.freeze({
      code: PROVIDER_FAULT_CODES.quota,
      detail: Object.freeze({
        ...detail,
        resetAt,
        ...(statusCode ? { statusCode: Number.parseInt(statusCode, 10) } : {}),
      }),
    });
  }
  if (socketByCode || SOCKET_TEXT.test(text)) {
    return Object.freeze({
      code: PROVIDER_FAULT_CODES.socket,
      detail: Object.freeze({ ...detail, resetAt: null }),
    });
  }
  return Object.freeze({
    code: PROVIDER_FAULT_CODES.generic,
    detail: Object.freeze({ ...detail, resetAt: null, ...(text ? { observed: text } : {}) }),
  });
}

/**
 * Read back a fault detail that crossed the wire on a lifecycle payload. Shape-validating only:
 * this never classifies and never re-reads provider prose (#267) — a detail that does not have
 * the documented shape reads as absent, so a malformed payload cannot become a fabricated route
 * or a fabricated reset instant.
 */
export function readProviderFaultDetail(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const route = normalizeProviderRoute(value.route);
  const resetAt = typeof value.resetAt === 'string' && Number.isFinite(Date.parse(value.resetAt))
    ? new Date(Date.parse(value.resetAt)).toISOString() : null;
  const statusCode = Number.isSafeInteger(value.statusCode) && value.statusCode >= 100 && value.statusCode <= 599
    ? value.statusCode : null;
  if (!route && resetAt === null && statusCode === null) return null;
  return Object.freeze({
    ...(route ? { route } : {}),
    resetAt,
    ...(statusCode === null ? {} : { statusCode }),
  });
}
