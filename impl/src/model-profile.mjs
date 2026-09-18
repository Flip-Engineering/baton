// model-profile.mjs — Issue #429: each served route's MEASURED profile.
//
// Artificial Analysis publishes a per-model catalog over one HTTP endpoint: the intelligence and
// coding indices, the median output tokens per second, the median time to first token, and the
// per-million-token prices. The operator's ruling (2026-09-17) is that this integration is LIVE,
// never a committed table of numbers: the deployment reads the catalog at USE time through the
// reader wired into its doctor read, caches it in the deployment's own state dir, and refreshes it
// only when the cached catalog is no longer fresh. Nothing here runs on the resident's request
// loop: a synchronous read is served from the cache (and merely STARTS a refresh when the cache is
// stale), the explicit async doctor read awaits one, and a recruit's comparison never fetches at
// all. The fetch is injected, so a test drives every path with a fake and no test ever needs a key.
//
// Three facts about the source shape the contract:
//
//   - The provider answers its OWN freshness and its own measurement instant. When the response
//     declares `cache-control: max-age` (and an `age`), that window is what the read honors; the
//     fallback is the ONE registry row in limits.mjs (`model_profile.catalog_staleness_ms`, derived
//     from the provider's published request budget) — never a literal of this module's own. The
//     freshness origin is the catalog's own `updated_at` (else the response's `date`, else the
//     fetch instant), so a catalog the provider stamped yesterday reads stale even if we cached it
//     a minute ago.
//   - A route's billing basis decides whether a price is meaningful AT ALL. A flat subscription
//     (muse, Kimi, zai/glm on this fleet) pays no per-token price, so its profile carries
//     `price: null, priceReason: 'subscription'` while the measured indices still apply. Only an
//     `api`-billed route carries prices.
//   - A measurement that is absent stays absent. A slug the catalog does not define, a row without
//     an index, a credential that is not provisioned: each is a DEGRADED row naming the reason and
//     the remedy — never a guessed number, and never a refusal of the doctor.
//
// The credential (`BATON_AA_KEY`, else ~/.config/baton/aa_key) is declared once in adapter.mjs; see
// that section for why it is read at the root only and projected into no worker.

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readAaCredential } from './adapter.mjs';
import { MODEL_PROFILE_STALENESS_ROW } from './limits.mjs';

/** The ONE catalog endpoint. */
export const AA_CATALOG_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models';

/** The cache file inside the deployment's own state dir (advanced.deploymentRoot/state). */
export const AA_CATALOG_CACHE_FILE = 'model-profiles.json';

/** The typed refusals a fetch raises. `model_profile_credential_absent` is the absence of the key
 * itself (no request is made); `model_profile_unavailable` carries `{status, cause}` for an HTTP or
 * shape failure. */
export const MODEL_PROFILE_REFUSAL_CODES = Object.freeze({
  credentialAbsent: 'model_profile_credential_absent',
  unavailable: 'model_profile_unavailable',
});

/** The closed set of reasons a DEGRADED profile row names. `credential_absent` — no key is
 * provisioned; `catalog_unavailable` — a key exists but no admissible catalog could be read (a
 * failed fetch, an absent/undamaged cache, a refresh still in flight); `model_unmeasured` — the
 * catalog answered and defines no row for the route's mapped slug. */
export const MODEL_PROFILE_REASONS = Object.freeze({
  credentialAbsent: 'credential_absent',
  catalogUnavailable: 'catalog_unavailable',
  modelUnmeasured: 'model_unmeasured',
});

/** The ONE declaration of every admissible `profile` shape, asserted wherever a row is composed:
 * the MEASURED row `profileFor` answers, and the DEGRADED row a read publishes when it cannot
 * measure. `state` is the discriminator — a measured row never carries one. */
export const MODEL_PROFILE_SHAPE = Object.freeze({
  measured: Object.freeze(['coding', 'intelligence', 'measuredAt', 'price', 'priceReason', 'slug', 'tps', 'ttftS']),
  price: Object.freeze(['blended31', 'input', 'output']),
  unavailable: Object.freeze(['next', 'reason', 'state']),
});

/** The staleness bound this module judges against — the registry row, never a literal here. */
export const MODEL_PROFILE_STALENESS_MS = MODEL_PROFILE_STALENESS_ROW.value;

const MEASURED_KEYS = [...MODEL_PROFILE_SHAPE.measured].sort().join(',');
const UNAVAILABLE_KEYS = [...MODEL_PROFILE_SHAPE.unavailable].sort().join(',');

function profileError(message, code) {
  return Object.assign(new TypeError(`model profile: ${message}`), { code });
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function instantMs(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The closed-shape check every composed row passes through: null (a route with no mapping carries
 * no profile at all), a measured row, or a degraded row. Never a partial row. */
export function assertModelProfile(row) {
  if (row === null) return null;
  if (!record(row)) throw profileError('a profile is null or one object', 'model_profile_invalid');
  const keys = Object.keys(row).sort().join(',');
  if (keys === UNAVAILABLE_KEYS) {
    if (row.state !== 'unavailable') throw profileError('a state row must read unavailable', 'model_profile_invalid');
    if (typeof row.reason !== 'string' || row.reason.length === 0 || typeof row.next !== 'string' || row.next.length === 0) {
      throw profileError('a degraded row names its reason and its remedy', 'model_profile_invalid');
    }
    return row;
  }
  if (keys !== MEASURED_KEYS) {
    throw profileError(`a measured row is exactly ${MODEL_PROFILE_SHAPE.measured.join(', ')}`, 'model_profile_invalid');
  }
  if (typeof row.slug !== 'string' || row.slug.length === 0) throw profileError('a measured row names its slug', 'model_profile_invalid');
  for (const field of ['intelligence', 'coding', 'tps', 'ttftS']) {
    if (row[field] !== null && row[field] !== undefined && !Number.isFinite(row[field])) {
      throw profileError(`a measured ${field} is a number or null`, 'model_profile_invalid');
    }
  }
  if (row.price !== null) {
    if (!record(row.price) || Object.keys(row.price).sort().join(',') !== [...MODEL_PROFILE_SHAPE.price].sort().join(',')) {
      throw profileError('a price is the declared blended/input/output shape or null', 'model_profile_invalid');
    }
  }
  if (row.priceReason !== null && row.priceReason !== 'subscription') {
    throw profileError('a price reason is null or subscription', 'model_profile_invalid');
  }
  if (row.measuredAt !== null && typeof row.measuredAt !== 'string') {
    throw profileError('measuredAt is the provider instant or null', 'model_profile_invalid');
  }
  return row;
}

function unavailable(reason, next) {
  return assertModelProfile(Object.freeze({ state: 'unavailable', reason, next }));
}

/** The remedy a degraded row names, per reason — one sentence, written once. */
function remedyFor(reason, detail = null) {
  switch (reason) {
    case MODEL_PROFILE_REASONS.credentialAbsent:
      return 'provision the Artificial Analysis API key (BATON_AA_KEY, or the key file this deployment reads) and reopen Baton; the doctor reads the catalog on its next route-table read.';
    case MODEL_PROFILE_REASONS.modelUnmeasured:
      return `the Artificial Analysis catalog defines no model ${detail ?? ''}`.trim()
        + '; correct that route\'s aaSlug mapping or accept the route without a measured profile.';
    default:
      return 'the Artificial Analysis catalog could not be read; the next doctor read retries, and the route is unaffected either way.';
  }
}

/** One response header, read through either shape a fetch may answer (a `Headers`-like object or a
 * plain record). */
function responseHeader(response, name) {
  const headers = response?.headers;
  if (typeof headers?.get === 'function') {
    const value = headers.get(name);
    return typeof value === 'string' ? value : null;
  }
  if (record(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name.toLowerCase()) return typeof value === 'string' ? value : null;
    }
  }
  return null;
}

/** The freshness window a response declares, in ms, or null when it declares none: `cache-control`
 * `max-age` (or `s-maxage`), less the `age` the response reports. */
function declaredWindowMs(response) {
  const control = responseHeader(response, 'cache-control');
  if (control === null) return null;
  const match = /(?:^|[,;\s])(?:s-)?max-age\s*=\s*(\d+)/iu.exec(control);
  if (!match) return null;
  const maxAge = Number(match[1]);
  if (!Number.isSafeInteger(maxAge) || maxAge <= 0) return null;
  const age = Number(responseHeader(response, 'age') ?? '0');
  const elapsed = Number.isSafeInteger(age) && age > 0 ? age : 0;
  return Math.max(0, maxAge - elapsed) * 1000;
}

/** The provider's own measurement instant: the catalog document's `updated_at`, else the response's
 * `date`. Absence stays null — the caller falls back to its own fetch instant. */
function observedAt(payload, response) {
  for (const value of [payload?.updated_at, payload?.updatedAt, payload?.meta?.updated_at, responseHeader(response, 'date')]) {
    if (typeof value === 'string' && instantMs(value) !== null) return value;
  }
  return null;
}

/** The catalog as this module reads it: one frozen row per slug, the numbers the provider stated
 * (null where it stated none), the measured-at instant, and the declared freshness window. */
function normalizeCatalog(payload, response) {
  const rows = Array.isArray(payload?.data) ? payload.data
    : (Array.isArray(payload?.models) ? payload.models : null);
  if (rows === null) return null;
  const models = {};
  for (const row of rows) {
    if (!record(row)) continue;
    const slug = typeof row.slug === 'string' && row.slug.length > 0 ? row.slug
      : (typeof row.id === 'string' && row.id.length > 0 ? row.id : null);
    if (slug === null) continue;
    const evaluations = record(row.evaluations) ? row.evaluations : {};
    const pricing = record(row.pricing) ? row.pricing : null;
    models[slug] = Object.freeze({
      slug,
      id: typeof row.id === 'string' ? row.id : null,
      name: typeof row.name === 'string' ? row.name : null,
      creator: typeof row.model_creator?.slug === 'string' ? row.model_creator.slug : null,
      intelligence: finiteNumber(evaluations.artificial_analysis_intelligence_index),
      coding: finiteNumber(evaluations.artificial_analysis_coding_index),
      tps: finiteNumber(row.median_output_tokens_per_second),
      ttftS: finiteNumber(row.median_time_to_first_token_seconds),
      price: pricing === null ? null : Object.freeze({
        blended31: finiteNumber(pricing.price_1m_blended_3_to_1),
        input: finiteNumber(pricing.price_1m_input_tokens),
        output: finiteNumber(pricing.price_1m_output_tokens),
      }),
    });
  }
  return Object.freeze({
    updatedAt: observedAt(payload, response),
    freshForMs: declaredWindowMs(response),
    models: Object.freeze(models),
  });
}

function refusal(code, detail) {
  const message = code === MODEL_PROFILE_REFUSAL_CODES.credentialAbsent
    ? 'model profile: no Artificial Analysis credential is provisioned'
    : `model profile: the catalog is unavailable (${detail?.cause ?? detail?.status ?? 'unknown'})`;
  return Object.assign(new Error(message), {
    code,
    detail: Object.freeze({ status: detail?.status ?? null, cause: detail?.cause ?? null }),
  });
}

/**
 * ONE request to the provider's catalog. `fetchImpl` is injected (a test answers a fake response);
 * an absent key refuses `model_profile_credential_absent` before any request, and an HTTP, body or
 * shape failure refuses `model_profile_unavailable {status, cause}`. The answer is the normalized
 * catalog plus the instant it was fetched on the deployment clock.
 */
export async function fetchModelProfiles({ fetchImpl, key, now = Date.now, timeoutMs = null } = {}) {
  if (typeof fetchImpl !== 'function') throw refusal(MODEL_PROFILE_REFUSAL_CODES.unavailable, { cause: 'fetch_impl_absent' });
  if (typeof key !== 'string' || key.trim().length === 0) throw refusal(MODEL_PROFILE_REFUSAL_CODES.credentialAbsent, {});
  const bound = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? AbortSignal.timeout(timeoutMs) : undefined;
  let response;
  try {
    response = await fetchImpl(AA_CATALOG_URL, {
      headers: Object.freeze({ accept: 'application/json', 'x-api-key': key.trim() }),
      ...(bound === undefined ? {} : { signal: bound }),
    });
  } catch (cause) {
    throw refusal(MODEL_PROFILE_REFUSAL_CODES.unavailable, { cause: cause?.name ?? 'request_failed' });
  }
  const status = Number.isSafeInteger(response?.status) ? response.status : null;
  if (response?.ok !== true) throw refusal(MODEL_PROFILE_REFUSAL_CODES.unavailable, { status });
  let payload;
  try { payload = await response.json(); }
  catch { throw refusal(MODEL_PROFILE_REFUSAL_CODES.unavailable, { status, cause: 'unreadable_body' }); }
  const catalog = normalizeCatalog(payload, response);
  if (catalog === null) throw refusal(MODEL_PROFILE_REFUSAL_CODES.unavailable, { status, cause: 'catalog_shape' });
  return Object.freeze({ catalog, fetchedAtMs: now() });
}

/**
 * The measured profile of ONE catalog slug, or null when the catalog defines no such model.
 * `billing` is the route's declared basis: only `api` carries prices (a subscription route states
 * no per-token price and says why).
 */
export function profileFor(catalog, slug, { billing = 'subscription' } = {}) {
  const entry = typeof slug === 'string' && slug.length > 0 ? catalog?.models?.[slug] ?? null : null;
  if (entry === null) return null;
  const api = billing === 'api';
  return assertModelProfile(Object.freeze({
    slug: entry.slug,
    intelligence: entry.intelligence,
    coding: entry.coding,
    tps: entry.tps,
    ttftS: entry.ttftS,
    price: api ? entry.price : null,
    priceReason: api ? null : 'subscription',
    measuredAt: typeof catalog.updatedAt === 'string' ? catalog.updatedAt : null,
  }));
}

// ── the bounded cache: the deployment's own state dir, keyed by the provider's timestamps ───────

function cachePath(stateDir) {
  if (typeof stateDir !== 'string' || stateDir.length === 0) {
    throw profileError('the cache needs the deployment state dir', 'model_profile_cache_invalid');
  }
  return join(stateDir, AA_CATALOG_CACHE_FILE);
}

// The parsed cache file, memoised by its own (path, mtime, size) so a doctor read does not parse it
// once per route. Only the PARSED entry is memoised: everything that depends on the reading clock
// (staleness, the fresh-until instant) is derived per call.
let cacheMemo = null;

function parseCachedCatalog(text) {
  let document;
  try { document = JSON.parse(text); } catch { return null; }
  if (!record(document) || !record(document.catalog) || !record(document.catalog.models)) return null;
  const catalog = document.catalog;
  return Object.freeze({
    catalog: Object.freeze({
      updatedAt: typeof catalog.updatedAt === 'string' ? catalog.updatedAt : null,
      freshForMs: Number.isSafeInteger(catalog.freshForMs) && catalog.freshForMs > 0 ? catalog.freshForMs : null,
      models: Object.freeze(catalog.models),
    }),
    fetchedAt: typeof document.fetchedAt === 'string' ? document.fetchedAt : null,
  });
}

/**
 * The cached catalog, judged against the staleness bound the registry declares — or the freshness
 * window the provider itself declared, which wins — or null when there is no admissible cache.
 * `stale` is derived on the reading clock from the LATEST of the two instants the copy carries (the
 * provider's own `updated_at`/response `date` and the fetch instant), so a freshly fetched catalog
 * is fresh for the window while the measurement instant it publishes stays the provider's own.
 */
export function readCachedCatalog(stateDir, { now = Date.now } = {}) {
  const path = cachePath(stateDir);
  let stat;
  try { stat = statSync(path); } catch { return null; }
  if (!stat.isFile()) return null;
  const key = `${path}:${stat.mtimeMs}:${stat.size}`;
  if (cacheMemo === null || cacheMemo.key !== key) {
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { return null; }
    const entry = parseCachedCatalog(text);
    cacheMemo = entry === null ? null : { key, entry };
    if (cacheMemo === null) return null;
  }
  const { entry } = cacheMemo;
  // The freshness origin is the LATEST of the two instants the cache carries: the provider's own
  // measurement instant (`updated_at`, else the response's `date`) and the instant this deployment
  // fetched the copy. The provider's instant alone would judge a catalog published hours ago as
  // stale the moment it lands — a request per read — while the copy's own age is what the window
  // actually bounds. (The response `date` is the server's clock at the fetch, so a response that
  // declares one usually IS this origin, exactly as the provider stated it.)
  const publishedAtMs = instantMs(entry.catalog.updatedAt);
  const fetchedAtMs = instantMs(entry.fetchedAt);
  const observedAtMs = publishedAtMs === null ? fetchedAtMs
    : (fetchedAtMs === null ? publishedAtMs : Math.max(publishedAtMs, fetchedAtMs));
  if (observedAtMs === null) return null;
  const windowMs = entry.catalog.freshForMs ?? MODEL_PROFILE_STALENESS_MS;
  const freshUntilMs = observedAtMs + windowMs;
  return Object.freeze({
    catalog: entry.catalog,
    observedAt: entry.catalog.updatedAt ?? entry.fetchedAt,
    observedAtMs,
    windowMs,
    boundMs: MODEL_PROFILE_STALENESS_MS,
    freshUntilMs,
    stale: now() >= freshUntilMs,
  });
}

/** Write the catalog the deployment just fetched into its own state dir, atomically (a temp file
 * renamed into place) and owner-only. Returns the path written. */
export function writeCachedCatalog(stateDir, catalog, { now = Date.now } = {}) {
  const path = cachePath(stateDir);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(temporary, `${JSON.stringify({
      schemaVersion: 1, fetchedAt: new Date(now()).toISOString(), catalog,
    })}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } catch (cause) {
    try { rmSync(temporary, { force: true }); } catch { /* the temp file never existed */ }
    throw profileError(`the cache could not be written (${cause?.code ?? 'unknown'})`, 'model_profile_cache_unwritable');
  } finally {
    cacheMemo = null;
  }
  return path;
}

/**
 * The deployment's profile reader: the ONE authority the doctor's route table, the recruit's route
 * comparison and the seat brief read. It never fetches inline — `profilesFor` answers from the
 * cache (and STARTS a refresh when the cache is stale, so the next read is fresh), and `refresh` is
 * the explicit read an async caller awaits.
 *
 * `stateDir` is the deployment's state dir; `fetchImpl` is injected (the production reader supplies
 * the HTTPS fetch, a test supplies a fake); `key`/`env`/`keyPath` resolve the credential exactly as
 * adapter.mjs declares it.
 */
export function modelProfileReader({
  stateDir, key = null, env = null, keyPath = null, now = Date.now,
  fetchImpl = null, timeoutMs = null,
} = {}) {
  let inFlight = null;

  function resolveKey() {
    if (typeof key === 'string' && key.trim().length > 0) return key.trim();
    return readAaCredential({
      ...(record(env) ? { env } : {}),
      ...(typeof keyPath === 'string' && keyPath.length > 0 ? { path: keyPath } : {}),
    });
  }

  function catalog() {
    try { return readCachedCatalog(stateDir, { now }); } catch { return null; }
  }

  /** Ensure a fresh catalog is present. The explicit read: deduped while one is in flight, skipped
   * while the cache is still fresh, and NEVER thrown — every failure is a reason the caller's row
   * degrades with. */
  function refresh({ force = false } = {}) {
    if (inFlight !== null) return inFlight;
    const current = catalog();
    if (!force && current !== null && current.stale === false) {
      return Promise.resolve(Object.freeze({ ok: true, reason: null, fetched: false }));
    }
    if (typeof fetchImpl !== 'function') {
      return Promise.resolve(Object.freeze({
        ok: false, reason: MODEL_PROFILE_REASONS.catalogUnavailable, fetched: false,
      }));
    }
    const keyValue = resolveKey();
    if (keyValue === null) {
      return Promise.resolve(Object.freeze({
        ok: false, reason: MODEL_PROFILE_REASONS.credentialAbsent, fetched: false,
      }));
    }
    inFlight = (async () => {
      try {
        const { catalog: fetched } = await fetchModelProfiles({ fetchImpl, key: keyValue, now, timeoutMs });
        writeCachedCatalog(stateDir, fetched, { now });
        return Object.freeze({ ok: true, reason: null, fetched: true });
      } catch (error) {
        return Object.freeze({
          ok: false,
          reason: error?.code === MODEL_PROFILE_REFUSAL_CODES.credentialAbsent
            ? MODEL_PROFILE_REASONS.credentialAbsent : MODEL_PROFILE_REASONS.catalogUnavailable,
          fetched: false,
        });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  /** The profile of ONE route, or null when the route maps to no catalog slug at all. A route with
   * an `aaSlug` always answers a row: the measurement, or the reason it could not be read. */
  function profileOf(route) {
    const slug = typeof route?.aaSlug === 'string' && route.aaSlug.length > 0 ? route.aaSlug : null;
    if (slug === null) return null;
    const billing = route?.billing === 'api' ? 'api' : 'subscription';
    const cached = catalog();
    if (cached === null) {
      const keyValue = resolveKey();
      if (keyValue === null) {
        return unavailable(MODEL_PROFILE_REASONS.credentialAbsent, remedyFor(MODEL_PROFILE_REASONS.credentialAbsent));
      }
      refresh();
      return unavailable(MODEL_PROFILE_REASONS.catalogUnavailable, remedyFor(MODEL_PROFILE_REASONS.catalogUnavailable));
    }
    if (cached.stale) refresh();
    const measured = profileFor(cached.catalog, slug, { billing });
    return measured ?? unavailable(MODEL_PROFILE_REASONS.modelUnmeasured, remedyFor(MODEL_PROFILE_REASONS.modelUnmeasured, slug));
  }

  /** The rows for one served route list, aligned by index — one read of the cache per call. */
  function profilesFor(routes) {
    if (!Array.isArray(routes)) throw profileError('profilesFor takes the served routes', 'model_profile_invalid');
    return Object.freeze(routes.map((route) => profileOf(route)));
  }

  return Object.freeze({ profileOf, profilesFor, refresh });
}
