// provider-services.mjs — provider services as a deployment concept (issue #317, docs/50).
//
// A service is one API provider the deployment is configured to speak to: its provider segment
// (the identity `providerOfRoute` derives off a route's model id), its base URL, a credential
// REFERENCE (env/file/keychain — never a value), the harnesses that can speak to it, an optional
// declared model list, and an optional usage-rate declaration (subscription window shape, window
// length and quota) for a provider that exposes neither by API.
//
// This module owns the pure domain, once, for every consumer:
//
//   normalizeProviderServices  — the `advanced.services` open-time validation (the
//                                deployment_config_invalid posture of normalizeRoutes);
//   serviceForRoute            — the route → service resolution (explicit `provider` field first,
//                                else the model's provider segment);
//   deriveServiceUsage         — the declared-window accounting over the deployment's own
//                                `resource.tokens` rows, with reset instants from observed
//                                provider facts before any declaration-derived one;
//   serviceStateOf             — the aggregate state over a service's member routes;
//   fetchServiceModels         — the model-list endpoint read (the model-profile.mjs injection
//                                and typed-refusal conventions);
//   validateServicesListArgs   — the canonical `services.list` field contract every surface
//                                shares (the evidence-search.mjs pattern).
//
// No numeric constants are assumed for windows or quotas: both come from the operator's
// declaration or from the provider's own observed answers (#442/#456), never from this module.

import { providerOfRoute } from './provider-faults.mjs';

/** The credential reference kinds a service entry admits — a reference, never a value. */
export const SERVICE_CREDENTIAL_KINDS = Object.freeze(['env', 'file', 'keychain']);

/** The window SHAPES an operator may declare for a subscription's usage window (issue #491). A
 * rolling window clears a fixed period after the call that counted against it, so use during the
 * window moves the boundary; a fixed-clock window clears on the provider's own calendar boundary.
 * The shape is a DECLARATION — the operator states it from the provider's documentation — and its
 * absence stays `unknown`, never guessed from one observation. */
export const USAGE_WINDOW_KINDS = Object.freeze(['rolling', 'fixed_clock']);

const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
// Bounded like the route table the services project (normalizeRoutes' 64).
const MAX_SERVICES = 64;
const MAX_SERVICE_MODELS = 64;
const MAX_SERVICE_HARNESSES = 16;

function configError(message) {
  return Object.assign(new TypeError(message), { code: 'deployment_config_invalid' });
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function closed(value, fields, label) {
  if (!record(value)) throw configError(`${label} must be an object`);
  const unknown = Object.keys(value).find((field) => !fields.includes(field));
  if (unknown) throw configError(`${label} contains unsupported field ${unknown}`);
}

function boundedText(value, max, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw configError(`${label} is invalid`);
  }
  return value;
}

/** The one base-URL predicate: https everywhere, http only for a loopback host (a fixture or a
 * local gateway). The URL is parsed here so a malformed one refuses at open, not at fetch. */
function normalizeBaseUrl(value) {
  const text = boundedText(value, 2048, 'advanced services baseUrl');
  let url;
  try { url = new URL(text); } catch { throw configError('advanced services baseUrl is invalid'); }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw configError('advanced services baseUrl must be https (http only for a loopback host)');
  }
  return url.toString().replace(/\/+$/u, '');
}

function normalizeCredential(value, provider) {
  const label = `advanced services ${provider} credential`;
  closed(value, ['kind', 'name', 'path', 'jsonPointer', 'service', 'account'], label);
  if (!SERVICE_CREDENTIAL_KINDS.includes(value.kind)) {
    throw configError(`${label} kind must be one of: ${SERVICE_CREDENTIAL_KINDS.join(', ')}`);
  }
  if (value.kind === 'env') {
    if (typeof value.name !== 'string' || !ENV_NAME_PATTERN.test(value.name)) {
      throw configError(`${label} name must be an environment variable name`);
    }
    return Object.freeze({ kind: 'env', name: value.name });
  }
  if (value.kind === 'file') {
    const path = boundedText(value.path, 4096, `${label} path`);
    // The pointer rule is the credential loader's own (claude-session.mjs jsonPointerSegments):
    // rooted, bounded, no malformed escapes.
    if (value.jsonPointer !== undefined && (typeof value.jsonPointer !== 'string'
      || !value.jsonPointer.startsWith('/') || value.jsonPointer.length > 512)) {
      throw configError(`${label} jsonPointer is invalid`);
    }
    return Object.freeze({
      kind: 'file', path,
      ...(value.jsonPointer === undefined ? {} : { jsonPointer: value.jsonPointer }),
    });
  }
  const service = boundedText(value.service, 256, `${label} service`);
  if (value.account !== undefined) boundedText(value.account, 256, `${label} account`);
  return Object.freeze({
    kind: 'keychain', service,
    ...(value.account === undefined ? {} : { account: value.account }),
  });
}

function normalizeUsage(value, provider) {
  const label = `advanced services ${provider} usage`;
  closed(value, ['windowMs', 'quotaTokens', 'windowKind'], label);
  for (const field of ['windowMs', 'quotaTokens']) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) {
      throw configError(`${label} ${field} must be a positive safe integer`);
    }
  }
  // #491: the shape is optional and additive — a declaration that names none keeps the record it
  // has always published, and the derived row then reads `unknown` rather than an invented shape.
  if (value.windowKind !== undefined && !USAGE_WINDOW_KINDS.includes(value.windowKind)) {
    throw configError(`${label} windowKind must be one of: ${USAGE_WINDOW_KINDS.join(', ')}`);
  }
  return Object.freeze({
    windowMs: value.windowMs, quotaTokens: value.quotaTokens,
    ...(value.windowKind === undefined ? {} : { windowKind: value.windowKind }),
  });
}

/**
 * Validate the `advanced.services` section: a provider-keyed record of closed service entries
 * (`{ zai: { baseUrl, credential, harnesses, models?, usage? } }`), bounded like the route table.
 * The key IS the provider identity, so two entries can never claim one provider. Every violation
 * refuses the open with `deployment_config_invalid`, exactly as a bad route table does.
 */
export function normalizeProviderServices(value = {}) {
  if (!record(value)) throw configError('advanced services must be one object keyed by provider');
  const keys = Object.keys(value);
  if (keys.length > MAX_SERVICES) throw configError('advanced services must be a bounded record');
  return Object.freeze(keys.map((provider) => {
    const label = `advanced services ${provider}`;
    if (!PROVIDER_PATTERN.test(provider)) {
      throw configError(`${label} provider must be a lowercase provider segment`);
    }
    const entry = value[provider];
    closed(entry, ['baseUrl', 'credential', 'harnesses', 'models', 'usage'], label);
    if (!Array.isArray(entry.harnesses) || entry.harnesses.length === 0
      || entry.harnesses.length > MAX_SERVICE_HARNESSES
      || entry.harnesses.some((harness) => typeof harness !== 'string' || harness.length === 0
        || harness.length > 128)) {
      throw configError(`${label} harnesses must be a non-empty bounded string array`);
    }
    if (entry.models !== undefined && (!Array.isArray(entry.models)
      || entry.models.length > MAX_SERVICE_MODELS
      || entry.models.some((model) => typeof model !== 'string' || model.length === 0
        || model.length > 256))) {
      throw configError(`${label} models must be a bounded string array`);
    }
    return Object.freeze({
      provider,
      baseUrl: normalizeBaseUrl(entry.baseUrl),
      credential: normalizeCredential(entry.credential, provider),
      harnesses: Object.freeze([...entry.harnesses]),
      models: entry.models === undefined ? null : Object.freeze([...entry.models]),
      usage: entry.usage === undefined ? null : normalizeUsage(entry.usage, provider),
    });
  }));
}

/**
 * Validate the `advanced.serviceClients` section: the injected seams the model-list read rides
 * (the modelProfiles pattern — the deployment wires its own fetch, keychain and credential-file
 * readers; a fixture supplies fakes and never dials a provider). All optional; a serviceClients
 * section that names none of them is the default wiring spelled explicitly.
 */
export function normalizeServiceClients(value = {}) {
  closed(value, ['fetchImpl', 'keychainRead', 'readCredentialFile', 'timeoutMs'], 'advanced serviceClients');
  for (const field of ['fetchImpl', 'keychainRead', 'readCredentialFile']) {
    if (value[field] !== undefined && typeof value[field] !== 'function') {
      throw configError(`advanced serviceClients.${field} must be a function`);
    }
  }
  if (value.timeoutMs !== undefined
    && (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0)) {
    throw configError('advanced serviceClients.timeoutMs must be a positive safe integer');
  }
  return Object.freeze({
    fetchImpl: value.fetchImpl ?? null,
    keychainRead: value.keychainRead ?? null,
    readCredentialFile: value.readCredentialFile ?? null,
    timeoutMs: value.timeoutMs ?? null,
  });
}

/** The declared service for one provider segment, or null. */
export function serviceForProvider(services, provider) {
  if (typeof provider !== 'string' || provider.length === 0) return null;
  return (services ?? []).find((service) => service.provider === provider) ?? null;
}

/** The declared service one route resolves to, or null: the route's explicit `provider` field
 * first (the registry's own declaration), else the provider segment `providerOfRoute` derives. */
export function serviceForRoute(services, route) {
  const explicit = typeof route?.provider === 'string' && route.provider.length > 0
    ? route.provider : null;
  return serviceForProvider(services, explicit ?? providerOfRoute(route));
}

/** The publishable credential metadata — the kind and the reference, never the value. The
 * reference names WHAT to resolve (the env name, the file path, the keychain service), exactly
 * the facts the doctor's key-file rows already publish. */
export function serviceCredentialReference(service) {
  const credential = service.credential;
  if (credential.kind === 'env') return Object.freeze({ kind: 'env', reference: credential.name });
  if (credential.kind === 'file') {
    return Object.freeze({ kind: 'file', reference: credential.path });
  }
  return Object.freeze({
    kind: 'keychain',
    reference: credential.account === undefined
      ? credential.service : `${credential.service}/${credential.account}`,
  });
}

/**
 * Resolve a service credential's VALUE in memory, for the model-list fetch and nothing else.
 * The readers are injected seams: `env` (the environment map), `readCredentialFile` (the
 * deployment wires claude-session.mjs's typed loader), `keychainRead(service, account)`. Answers
 * null when the reference resolves to nothing; a reader's own typed error propagates so the
 * caller can name the cause.
 */
export function resolveServiceCredentialValue(service, { env = {}, readCredentialFile = null, keychainRead = null } = {}) {
  const credential = service.credential;
  if (credential.kind === 'env') {
    const value = env[credential.name];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  if (credential.kind === 'file') {
    if (typeof readCredentialFile !== 'function') return null;
    const value = readCredentialFile(credential.path, {
      providerLabel: `service ${service.provider}`,
      ...(credential.jsonPointer === undefined ? {} : { jsonPointer: credential.jsonPointer }),
    });
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  if (typeof keychainRead !== 'function') return null;
  const value = keychainRead(credential.service, credential.account ?? null);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export const SERVICE_MODELS_REFUSAL_CODES = Object.freeze({
  unavailable: 'service_models_unavailable',
  credentialAbsent: 'service_credential_absent',
});

function modelsRefusal(code, detail) {
  const message = code === SERVICE_MODELS_REFUSAL_CODES.credentialAbsent
    ? 'service models: the declared credential reference resolved to nothing'
    : `service models: the endpoint is unavailable (${detail?.cause ?? detail?.status ?? 'unknown'})`;
  return Object.assign(new Error(message), {
    code,
    detail: Object.freeze({ status: detail?.status ?? null, cause: detail?.cause ?? null }),
  });
}

/** The model ids one OpenAI-shaped list answer carries, or null for any other shape. */
function normalizeModelList(payload) {
  if (!record(payload) || !Array.isArray(payload.data)) return null;
  const models = [];
  for (const row of payload.data) {
    if (!record(row) || typeof row.id !== 'string' || row.id.length === 0) return null;
    models.push(row.id);
  }
  return Object.freeze(models);
}

/**
 * ONE read of a service's model-list endpoint: `GET {baseUrl}/models` with the resolved
 * credential as the bearer token. The conventions are the model-profile reader's (issue #429):
 * `fetchImpl` is injected, `AbortSignal.timeout` applies only when the caller passes `timeoutMs`,
 * and every failure is a typed refusal — a service that declares a credential it cannot resolve
 * draws `service_credential_absent` before any request. A service that declares no credential
 * reads the endpoint unauthenticated and lets the provider's own answer decide.
 */
export async function fetchServiceModels(service, {
  fetchImpl, credential = null, timeoutMs = null,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw modelsRefusal(SERVICE_MODELS_REFUSAL_CODES.unavailable, { cause: 'fetch_impl_absent' });
  }
  // The caller resolves the declared reference (resolveServiceCredentialValue) and passes the
  // VALUE; a declared reference that resolved to nothing refuses before any request.
  if (record(service.credential) && (typeof credential !== 'string' || credential.length === 0)) {
    throw modelsRefusal(SERVICE_MODELS_REFUSAL_CODES.credentialAbsent, { cause: service.credential.kind });
  }
  const token = typeof credential === 'string' && credential.length > 0 ? credential : null;
  const bound = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? AbortSignal.timeout(timeoutMs) : undefined;
  let response;
  try {
    response = await fetchImpl(`${service.baseUrl}/models`, {
      headers: Object.freeze({
        accept: 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      }),
      ...(bound === undefined ? {} : { signal: bound }),
    });
  } catch (cause) {
    throw modelsRefusal(SERVICE_MODELS_REFUSAL_CODES.unavailable, { cause: cause?.name ?? 'request_failed' });
  }
  const status = Number.isSafeInteger(response?.status) ? response.status : null;
  if (response?.ok !== true) {
    throw modelsRefusal(SERVICE_MODELS_REFUSAL_CODES.unavailable, { status });
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw modelsRefusal(SERVICE_MODELS_REFUSAL_CODES.unavailable, { status, cause: 'unreadable_body' }); }
  const models = normalizeModelList(payload);
  if (models === null) {
    throw modelsRefusal(SERVICE_MODELS_REFUSAL_CODES.unavailable, { status, cause: 'model_list_shape' });
  }
  return Object.freeze({ models });
}

/**
 * The usage axis of one service row (docs/50 D5). All inputs are observed or declared facts:
 *
 *   service      — the normalized entry; its `usage` declaration supplies windowMs/quotaTokens.
 *   observations — the service's member routes' `resource.tokens` rows, oldest first, each
 *                  { ts, tokens, usd, accounting, counterId, source, rateLimits }.
 *   reset        — the live provider-fault reset fact across the member routes, or null:
 *                  { resetAt, observedAt } where resetAt is the provider's own stated instant
 *                  (null when the provider named none) and observedAt is when the block was
 *                  recorded (ms since epoch).
 *   now          — the deployment clock, ms since epoch.
 *
 * Answers null when the service declares no usage AND no observation carries a provider
 * rate-limit fact — the honest absence. Otherwise the row carries the declaration, the trailing
 * window's accounted tokens (delta rows summed, cumulative rows deduplicated per counterId with
 * the latest value winning — the `workerActivity` rule), the remainder against the declared
 * quota, and the reset instant: the provider's own word (`resetSource: 'provider'`) when one was
 * observed, the declaration-derived `observedAt + windowMs` (`resetSource: 'declared_window'`)
 * when a block was observed with no instant, or null when nothing names one.
 *
 * #491: `quotaWindow` carries the declared window SHAPE beside that instant — `{kind, periodMs}`
 * with `kind` from USAGE_WINDOW_KINDS, or `unknown` for a declaration that names none — so a
 * reader judges a rolling boundary (use inside the window can move it) differently from a fixed
 * clock reset. Null when the service declares no usage at all.
 */
export function deriveServiceUsage(service, { observations = [], reset = null, now = Date.now } = {}) {
  const declared = service.usage ?? null;
  let observed = null;
  for (const event of observations) {
    if (event?.source === 'rateLimit' && record(event.rateLimits)) {
      observed = event.rateLimits;
    }
  }
  if (declared === null && observed === null) return null;
  let usedTokens = null;
  let remainingTokens = null;
  if (declared !== null) {
    const windowStart = now - declared.windowMs;
    let deltaTokens = 0;
    const cumulative = new Map();
    for (const event of observations) {
      if (event?.source === 'rateLimit') continue;
      const at = Date.parse(event?.ts ?? '');
      if (!Number.isFinite(at) || at < windowStart || at > now) continue;
      const tokens = Number(event.tokens) || 0;
      if (event.accounting === 'cumulative') {
        const counter = typeof event.counterId === 'string' ? event.counterId : 'default';
        cumulative.set(counter, tokens);
      } else {
        deltaTokens += tokens;
      }
    }
    usedTokens = deltaTokens;
    for (const tokens of cumulative.values()) usedTokens += tokens;
    remainingTokens = declared.quotaTokens - usedTokens;
  }
  let resetAt = null;
  let resetSource = null;
  if (typeof reset?.resetAt === 'string' && Number.isFinite(Date.parse(reset.resetAt))) {
    resetAt = new Date(Date.parse(reset.resetAt)).toISOString();
    resetSource = 'provider';
  } else if (declared !== null && Number.isFinite(reset?.observedAt)) {
    resetAt = new Date(reset.observedAt + declared.windowMs).toISOString();
    resetSource = 'declared_window';
  }
  return Object.freeze({
    windowMs: declared?.windowMs ?? null,
    quotaTokens: declared?.quotaTokens ?? null,
    usedTokens,
    remainingTokens,
    resetAt,
    resetSource,
    quotaWindow: declared === null ? null
      : Object.freeze({ kind: declared.windowKind ?? 'unknown', periodMs: declared.windowMs }),
    observed: observed === null ? null : Object.freeze({
      ...(record(observed.primary) ? {
        primary: Object.freeze({
          usedPercent: Number.isFinite(observed.primary.usedPercent) ? observed.primary.usedPercent : null,
          windowDurationMins: Number.isFinite(observed.primary.windowDurationMins) ? observed.primary.windowDurationMins : null,
          resetsAt: typeof observed.primary.resetsAt === 'string' ? observed.primary.resetsAt : null,
        }),
      } : {}),
      ...(record(observed.secondary) ? {
        secondary: Object.freeze({
          usedPercent: Number.isFinite(observed.secondary.usedPercent) ? observed.secondary.usedPercent : null,
          windowDurationMins: Number.isFinite(observed.secondary.windowDurationMins) ? observed.secondary.windowDurationMins : null,
          resetsAt: typeof observed.secondary.resetsAt === 'string' ? observed.secondary.resetsAt : null,
        }),
      } : {}),
    }),
  });
}

/** The aggregate state of one service over its member routes' published verdicts: ready when any
 * member is ready, else degraded when any is degraded, else blocked when any is blocked, else
 * unrouted — a declared service no configured route resolves to. The aggregate never feeds back
 * into a route's own verdict (docs/50 D6). */
export function serviceStateOf(memberStates) {
  if (memberStates.length === 0) return 'unrouted';
  if (memberStates.includes('ready')) return 'ready';
  if (memberStates.includes('degraded')) return 'degraded';
  return 'blocked';
}

// ── the canonical services.list operation ─────────────────────────────────────────────────────

/** The filter names `services.list` accepts — the closed vocabulary (the evidence-search.mjs
 * pattern: one canonical operation, every surface shapes from here). */
export const SERVICES_LIST_FILTERS = Object.freeze(['provider']);

export const SERVICES_LIST_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: Object.freeze({
    provider: Object.freeze({
      type: 'string', minLength: 1, maxLength: 128,
      description: 'narrow the answer to the one service with this provider id; omit for every configured service',
    }),
  }),
  required: Object.freeze([]),
});

const listError = (message, field, rule, expectation) => Object.assign(new Error(message), {
  code: 'services_list_invalid', detail: { field, rule, expectation },
});

/** Validate one services.list request against the canonical shape. Answers the normalized
 * filters; unknown keys ride along unread, and anything that names a known field badly refuses
 * typed with the field, the rule and the expectation. */
export function validateServicesListArgs(args) {
  if (args === undefined || args === null) return validateServicesListArgs({});
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw listError('services list arguments must be one JSON object', null, 'arguments-shape', 'one JSON object');
  }
  const provider = args.provider ?? null;
  if (provider !== null && (typeof provider !== 'string' || provider.length === 0
    || provider.length > 128)) {
    throw listError('services list provider must be non-empty text', 'provider', 'field-predicate', 'at most 128 characters');
  }
  return Object.freeze({ provider });
}
