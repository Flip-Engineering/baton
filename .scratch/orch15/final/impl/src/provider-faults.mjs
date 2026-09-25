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
// The reset instant is a fact about the PROVIDER's clock, and the provider's answer is read
// exactly as far as it is honest (#442 item 4, #456 item 1): an instant the answer ZONE-QUALIFIED
// is parsed into the one canonical spelling every host reads the same way; a zone-less instant is
// read against the PROVIDER's own declared zone when this build knows it (`PROVIDER_RESET_ZONES`),
// because the provider's clock is a fact about the provider rather than a guess about the text;
// and a zone-less instant from a provider no zone is documented for stays the provider's own TEXT
// (`resetAtText`) with `resetAt: null`. Assuming UTC for a wall-clock nobody qualified is a
// fabricated instant, and the failure mode is real: the zai GLM answer `reset at 2026-09-18
// 18:07:32` (Beijing wall time, so 10:07:32Z) was recorded as 18:07:32Z, so every block derived
// from it would have lapsed eight hours before the provider said it would.

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

// ── #456: the provider's own clock, and the window its answer names ─────────────────────────────
//
// The reset instant is a fact about the PROVIDER's clock (#442 item 4), so a wall-clock the answer
// left zone-less can only be read when the provider's own zone is KNOWN. This table is that
// knowledge, one row per provider — never a guess on a provider's behalf, and never a second
// reading of the same answer anywhere else in the tree (Decision 8's no-re-declare law).
//
//   zai — z.ai's GLM answers are spelled in Beijing wall time (UTC+08:00). The 2026-09-18 zai 429
//         ("Usage limit reached for 5 hour … reset at 2026-09-18 18:07:32") named 18:07:32, which
//         is 10:07:32Z: read as UTC it would have lapsed a full eight hours early. A provider
//         whose answers have never been captured stays ABSENT — its zone-less instants keep their
//         text (`resetAtText`) and derive nothing, which is the honest reading #442 item 4 pinned.
export const PROVIDER_RESET_ZONES = Object.freeze({ zai: '+08:00' });

/** The quota scope of a route: the API service account it draws on (#523, docs/51 D1).
 * Explicit `route.provider` wins, else the model's provider segment, else the harness.
 * Never reads effort. Returns null when the route names nothing derivable. */
export function routeQuotaScope(route) {
  if (!route || typeof route !== 'object') return null;
  if (typeof route.provider === 'string' && route.provider.length > 0) return route.provider;
  if (typeof route.model === 'string' && route.model.length > 0) {
    const slash = route.model.indexOf('/');
    if (slash > 0) return route.model.slice(0, slash);
  }
  if (typeof route.harness === 'string' && route.harness.length > 0) return route.harness;
  return null;
}

/** The provider whose clock one route's answers are spelled in, or null when the route names none:
 * the model's own provider segment (`zai/glm-5.3-flash` → `zai`, the omp fleet's spelling), else
 * the harness (`glm-via-claude` → `glm-via-claude`, and the aliases its own table resolves). A
 * route that names neither is a route whose provider nothing here knows — and derives no zone. */
export function providerOfRoute(route) {
  const exact = normalizeProviderRoute(route);
  if (exact === null) return null;
  const slash = exact.model.indexOf('/');
  const provider = slash > 0 ? exact.model.slice(0, slash) : exact.harness;
  return provider.length > 0 ? provider : null;
}

// The window a provider's own answer names, read from the bounded answer text the same way the
// reset spelling is: "Usage limit reached for 5 hour" names five hours, and that is the provider's
// own number rather than a preference of ours (seconds/minutes/hours/days, singular or plural).
const FAULT_WINDOW_TEXT = /\bfor\s+(\d+(?:\.\d+)?)\s*(second|minute|hour|day)s?\b/iu;
const FAULT_WINDOW_UNIT_MS = Object.freeze({
  second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
});

/** The window the provider's OWN words named, in milliseconds, or null when they named none
 * (#456 item 2). Never defaulted here: the caller that needs a window when the answer named none
 * reads the registry's own fault-probe row, so this reader answers exactly one question — what did
 * the provider say. */
export function providerFaultWindowMs(text) {
  const message = boundedText(text, ANSWER_SCAN_BYTES);
  if (message.length === 0) return null;
  const match = FAULT_WINDOW_TEXT.exec(message);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  const unit = FAULT_WINDOW_UNIT_MS[match[2].toLowerCase()];
  if (!Number.isFinite(value) || value <= 0 || unit === undefined) return null;
  const millis = Math.round(value * unit);
  return Number.isSafeInteger(millis) && millis > 0 ? millis : null;
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
 * The reset instant the provider's answer spelled, or null when it spelled none. Bounded scan
 * (the message is already bounded by the caller), one spelling: an ISO-8601-shaped date-time.
 * The match is returned with the zone the answer carried, verbatim, so the caller can keep the
 * provider's own words beside the instant this module does or does not derive from them.
 */
function readResetSpelling(text) {
  const message = boundedText(text, ANSWER_SCAN_BYTES);
  if (message.length === 0) return null;
  const match = RESET_AT_TEXT.exec(message);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00', , zone = ''] = match;
  const numeric = [year, month, day, hour, minute, second].map((part) => Number.parseInt(part, 10));
  if (numeric.some((part) => !Number.isSafeInteger(part))) return null;
  const [mo, d, h, mi, s] = numeric.slice(1);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  return Object.freeze({ spelling: match[0].trim(), zone, fields: match.slice(1, 8) });
}

/**
 * The provider's own reset spelling — the text as the answer carried it, or null when the answer
 * named no reset instant at all. This is the value a consumer keeps when no honest instant can be
 * derived from it (#442 item 4).
 */
export function providerResetText(text) {
  return readResetSpelling(text)?.spelling ?? null;
}

/**
 * The reset instant the provider's own answer named, as a canonical ISO-8601 UTC string, or null
 * when no honest instant can be derived from it. Two readings, in this order (#442 item 4, #456
 * item 1):
 *
 *   1. the zone the answer QUALIFIED itself with always wins — it is the provider stating its own
 *      offset, and nothing this module holds may override a stated fact;
 *   2. a zone-less wall-clock is read against the PROVIDER's own declared zone
 *      (`PROVIDER_RESET_ZONES`, keyed by the route's provider) when one is known — zai spells
 *      Beijing wall time, so `2026-09-18 18:07:32` is 10:07:32Z and not a fabricated UTC instant
 *      that lapses eight hours early;
 *   3. a provider no zone is documented for derives NOTHING. The caller keeps the provider's words
 *      (`providerResetText`) and its route clears by probe instead (#456 item 2).
 */
export function parseProviderResetAt(text, { provider = null } = {}) {
  const spelled = readResetSpelling(text);
  if (!spelled) return null;
  const zone = spelled.zone !== '' ? spelled.zone
    : (typeof provider === 'string' ? PROVIDER_RESET_ZONES[provider] ?? '' : '');
  if (zone === '') return null;
  const [year, month, day, hour, minute, second = '00', fraction = '0'] = spelled.fields;
  const offset = zone === 'Z' || zone === 'UTC' || zone === 'GMT'
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
    // #456 item 1: the zone-less spelling is read against the PROVIDER's own declared zone (this
    // route's provider), so a zai answer that says `reset at 2026-09-18 18:07:32` types the instant
    // it meant — 10:07:32Z — while a provider no zone is documented for still derives none.
    const resetAt = parseProviderResetAt(text, { provider: providerOfRoute(exactRoute) });
    // #442 item 4: the answer's own spelling always rides the typed fault beside the instant this
    // module was willing to derive from it, so a zone-less answer with no known provider zone reads
    // as `{resetAt: null, resetAtText: '...'}` — the honest pair — and never as a UTC instant
    // nobody stated.
    const resetAtText = providerResetText(text);
    return Object.freeze({
      code: PROVIDER_FAULT_CODES.quota,
      detail: Object.freeze({
        ...detail,
        resetAt,
        resetAtText,
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
  // #442 item 4: the provider's own spelling, bounded exactly as the scan reads it. Absent unless
  // the payload carried one, so a detail written before the field existed reads byte-identically.
  const resetAtText = typeof value.resetAtText === 'string' && value.resetAtText.length > 0
    ? value.resetAtText.slice(0, ANSWER_SCAN_BYTES) : null;
  const statusCode = Number.isSafeInteger(value.statusCode) && value.statusCode >= 100 && value.statusCode <= 599
    ? value.statusCode : null;
  if (!route && resetAt === null && resetAtText === null && statusCode === null) return null;
  return Object.freeze({
    ...(route ? { route } : {}),
    resetAt,
    ...(resetAtText === null ? {} : { resetAtText }),
    ...(statusCode === null ? {} : { statusCode }),
  });
}
