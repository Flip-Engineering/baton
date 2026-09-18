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

import { readAaCredential, readDesignArenaCredential } from './adapter.mjs';
import { MODEL_PROFILE_STALENESS_ROW } from './limits.mjs';

/** The ONE catalog endpoint. */
export const AA_CATALOG_URL = 'https://artificialanalysis.ai/api/v2/data/llms/models';

/** The cache file inside the deployment's own state dir (advanced.deploymentRoot/state). */
export const AA_CATALOG_CACHE_FILE = 'model-profiles.json';

// ── #444: Design Arena, the SECOND live source ──────────────────────────────────────────────────
//
// Design Arena publishes blind-vote Bradley-Terry Elo per arena (Website, 3D Design, Data
// Visualization, Game Dev, UI Component, …). ONE endpoint answers them all — `/models` — and every
// entry carries the `openRouterId` a route joins on. The rankings ride the SAME cache file as the
// Artificial Analysis catalog (a write of either section preserves the other), are judged by the
// SAME registry staleness row, and degrade a route the way an absent measurement does: `design`
// null beside the closed reason, never a refusal and never a guessed number.
//
// The credential (`BATON_DESIGNARENA_KEY`, else ~/.config/baton/designarena_key) is declared once
// in adapter.mjs beside the Artificial Analysis pair; like it, the key is read at the deployment
// ROOT and projected into no worker (RuntimeIsolation's secret-name sweep already covers the name).

/** The ONE design endpoint this module reads. */
export const DESIGN_ARENA_BASE_URL = 'https://www.designarena.ai/api/v1';
export const DESIGN_ARENA_MODELS_URL = `${DESIGN_ARENA_BASE_URL}/models`;

/** The typed refusals the design fetch raises, spelled like the Artificial Analysis pair. */
export const DESIGN_RANKINGS_REFUSAL_CODES = Object.freeze({
  credentialAbsent: 'design_rankings_credential_absent',
  unavailable: 'design_rankings_unavailable',
});

/** The closed set of reasons a profile row names when its design axis is ABSENT. `key_absent` — no
 * Design Arena credential is provisioned; `stale` — the cached section is past its freshness bound;
 * `unavailable` — a credential exists but no admissible ranking could be read (a failed fetch, an
 * absent or damaged section, an id the catalog does not define); `no_openrouter_id` — the route
 * declares no OpenRouter id to join on. */
export const DESIGN_RANKINGS_REASONS = Object.freeze({
  keyAbsent: 'key_absent',
  stale: 'stale',
  unavailable: 'unavailable',
  noOpenRouterId: 'no_openrouter_id',
});

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
  measured: Object.freeze(['coding', 'design', 'designReason', 'intelligence', 'measuredAt', 'price', 'priceReason', 'slug', 'tps', 'ttftS']),
  price: Object.freeze(['blended31', 'input', 'output']),
  design: Object.freeze(['arenas', 'observedAt']),
  designArena: Object.freeze(['arena', 'category', 'elo', 'rank', 'votes']),
  unavailable: Object.freeze(['next', 'reason', 'state']),
});

/** The staleness bound this module judges against — the registry row, never a literal here. */
export const MODEL_PROFILE_STALENESS_MS = MODEL_PROFILE_STALENESS_ROW.value;

const MEASURED_KEYS = [...MODEL_PROFILE_SHAPE.measured].sort().join(',');
const UNAVAILABLE_KEYS = [...MODEL_PROFILE_SHAPE.unavailable].sort().join(',');
const DESIGN_KEYS = [...MODEL_PROFILE_SHAPE.design].sort().join(',');
const DESIGN_ARENA_KEYS = [...MODEL_PROFILE_SHAPE.designArena].sort().join(',');
const DESIGN_REASON_VALUES = Object.freeze([...new Set(Object.values(DESIGN_RANKINGS_REASONS))]);

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
  // #444: the design axis rides the measured row as a joined fact or as the reason it is absent —
  // never as a number the provider did not publish.
  if (row.design === null) {
    if (row.designReason !== null && !DESIGN_REASON_VALUES.includes(row.designReason)) {
      throw profileError(`a design reason is null or one of: ${DESIGN_REASON_VALUES.join(', ')}`, 'model_profile_invalid');
    }
  } else {
    if (!record(row.design) || Object.keys(row.design).sort().join(',') !== DESIGN_KEYS) {
      throw profileError(`a design fact is exactly ${MODEL_PROFILE_SHAPE.design.join(', ')} or null`, 'model_profile_invalid');
    }
    if (row.design.observedAt !== null && typeof row.design.observedAt !== 'string') {
      throw profileError('a design observedAt is the provider instant or null', 'model_profile_invalid');
    }
    if (!Array.isArray(row.design.arenas) || row.design.arenas.length === 0) {
      throw profileError('a design fact carries the arenas the provider ranked', 'model_profile_invalid');
    }
    for (const arena of row.design.arenas) {
      if (!record(arena) || Object.keys(arena).sort().join(',') !== DESIGN_ARENA_KEYS) {
        throw profileError(`a design arena is exactly ${MODEL_PROFILE_SHAPE.designArena.join(', ')}`, 'model_profile_invalid');
      }
      if (typeof arena.arena !== 'string' || arena.arena.length === 0 || !Number.isFinite(arena.elo)) {
        throw profileError('a design arena names its arena and its Elo', 'model_profile_invalid');
      }
      if (arena.category !== null && typeof arena.category !== 'string') {
        throw profileError('a design arena category is a string or null', 'model_profile_invalid');
      }
      for (const field of ['rank', 'votes']) {
        if (arena[field] !== null && !Number.isSafeInteger(arena[field])) {
          throw profileError(`a design arena ${field} is an integer or null`, 'model_profile_invalid');
        }
      }
    }
    if (row.designReason !== null) {
      throw profileError('a row that carries design names no design reason', 'model_profile_invalid');
    }
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

// ── #444: the Design Arena reader and the join ──────────────────────────────────────────────────

/** One metric the provider may spell more than one way (the wire's own field names beside the
 * `openRouterId` the provider's docs state are not pinned here). Absence stays null: a ranking
 * without an Elo is not a ranking, and a guessed number is worse than none. */
function metricOf(row, names) {
  for (const name of names) {
    const value = finiteNumber(row[name]);
    if (value !== null) return value;
  }
  return null;
}

function countOf(row, names) {
  for (const name of names) {
    if (Number.isSafeInteger(row[name])) return row[name];
  }
  return null;
}

/** The OpenRouter id a design row joins on, or null. */
function openRouterIdOf(row) {
  for (const name of ['openRouterId', 'open_router_id']) {
    const value = row[name];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Best-first, ties broken by arena then category: the order is a fact of the data, never of the
 * wire's own key order, so the best arena is a stable read wherever it is asked for. */
function sortArenas(rows) {
  const compare = (left, right) => (left < right ? -1 : (left > right ? 1 : 0));
  return rows.sort((left, right) => right.elo - left.elo
    || compare(left.arena, right.arena) || compare(left.category ?? '', right.category ?? ''));
}

/** ONE arena ranking as the closed five-field shape, or null when the row names no arena or states
 * no Elo. */
function designArenaRow(arena, category, metrics) {
  if (!record(metrics)) return null;
  const elo = metricOf(metrics, ['elo', 'rating', 'score']);
  if (typeof arena !== 'string' || arena.length === 0 || elo === null) return null;
  return Object.freeze({
    arena,
    category: typeof category === 'string' && category.length > 0 ? category : null,
    elo,
    rank: countOf(metrics, ['rank', 'position']),
    votes: countOf(metrics, ['votes', 'matches', 'battles']),
  });
}

/** Every arena ranking one model row carries, through either container the endpoint publishes: an
 * `arenas` array of rows, or a `rankings` map of arena → category → metrics (metrics directly
 * under the arena name the arena's own aggregate). */
function designArenasOf(row) {
  const rows = [];
  if (Array.isArray(row.arenas)) {
    for (const entry of row.arenas) {
      if (!record(entry)) continue;
      const composed = designArenaRow(entry.arena, entry.category, entry);
      if (composed !== null) rows.push(composed);
    }
  }
  if (record(row.rankings)) {
    for (const [arena, perArena] of Object.entries(row.rankings)) {
      if (!record(perArena)) continue;
      const direct = designArenaRow(arena, null, perArena);
      if (direct !== null) { rows.push(direct); continue; }
      for (const [category, metrics] of Object.entries(perArena)) {
        const composed = designArenaRow(arena, category, metrics);
        if (composed !== null) rows.push(composed);
      }
    }
  }
  return sortArenas(rows);
}

/** The rows ONE design answer carries, through the containers the endpoint may use. */
function designRows(payload) {
  for (const candidate of [payload?.data, payload?.models, payload]) {
    if (Array.isArray(candidate)) return candidate;
    if (record(candidate) && Array.isArray(candidate.models)) return candidate.models;
  }
  return null;
}

/** The design catalog as this module reads it: one best-first arena list per OpenRouter id, the
 * provider's own instant, and the declared freshness window. A row with no joinable id or no
 * ranking is DROPPED — the catalog claims nothing about a model it did not rank. */
function normalizeDesignCatalog(payload, response) {
  const rows = designRows(payload);
  if (rows === null) return null;
  const models = {};
  for (const row of rows) {
    if (!record(row)) continue;
    const id = openRouterIdOf(row);
    if (id === null) continue;
    const arenas = designArenasOf(row);
    if (arenas.length === 0) continue;
    models[id] = Object.freeze(arenas);
  }
  return Object.freeze({
    observedAt: observedAt(payload, response),
    freshForMs: declaredWindowMs(response),
    models: Object.freeze(models),
  });
}

function designRefusal(code, detail) {
  const message = code === DESIGN_RANKINGS_REFUSAL_CODES.credentialAbsent
    ? 'design rankings: no Design Arena credential is provisioned'
    : `design rankings: the design catalog is unavailable (${detail?.cause ?? detail?.status ?? 'unknown'})`;
  return Object.assign(new Error(message), {
    code,
    detail: Object.freeze({ status: detail?.status ?? null, cause: detail?.cause ?? null }),
  });
}

/**
 * ONE request to the design catalog — `/models` carries every arena, so the source never makes a
 * second call. `fetchImpl` is injected exactly like the Artificial Analysis reader's; an absent key
 * refuses `design_rankings_credential_absent` before any request, and an HTTP, body, provider-error
 * or shape failure refuses `design_rankings_unavailable {status, cause}`. The answer is the
 * normalized rankings plus the instant they were fetched on the deployment clock.
 */
export async function fetchDesignRankings({ fetchImpl, key, now = Date.now, timeoutMs = null } = {}) {
  if (typeof fetchImpl !== 'function') throw designRefusal(DESIGN_RANKINGS_REFUSAL_CODES.unavailable, { cause: 'fetch_impl_absent' });
  if (typeof key !== 'string' || key.trim().length === 0) throw designRefusal(DESIGN_RANKINGS_REFUSAL_CODES.credentialAbsent, {});
  const bound = Number.isSafeInteger(timeoutMs) && timeoutMs > 0
    ? AbortSignal.timeout(timeoutMs) : undefined;
  let response;
  try {
    response = await fetchImpl(DESIGN_ARENA_MODELS_URL, {
      headers: Object.freeze({ accept: 'application/json', authorization: `Bearer ${key.trim()}` }),
      ...(bound === undefined ? {} : { signal: bound }),
    });
  } catch (cause) {
    throw designRefusal(DESIGN_RANKINGS_REFUSAL_CODES.unavailable, { cause: cause?.name ?? 'request_failed' });
  }
  const status = Number.isSafeInteger(response?.status) ? response.status : null;
  if (response?.ok !== true) throw designRefusal(DESIGN_RANKINGS_REFUSAL_CODES.unavailable, { status });
  let payload;
  try { payload = await response.json(); }
  catch { throw designRefusal(DESIGN_RANKINGS_REFUSAL_CODES.unavailable, { status, cause: 'unreadable_body' }); }
  // The API's error answer is a JSON document, never an HTTP class alone: name its own code.
  if (payload?.success === false) {
    throw designRefusal(DESIGN_RANKINGS_REFUSAL_CODES.unavailable,
      { status, cause: typeof payload?.error?.code === 'string' ? payload.error.code : 'provider_error' });
  }
  const design = normalizeDesignCatalog(payload, response);
  if (design === null) throw designRefusal(DESIGN_RANKINGS_REFUSAL_CODES.unavailable, { status, cause: 'catalog_shape' });
  return Object.freeze({ design, fetchedAtMs: now() });
}

/** The design ranking of ONE OpenRouter model id — the joined fact a route's profile carries, joined
 * by the id the ROUTE declares — or null when the catalog ranks no such id. */
export function designRankingFor(designCatalog, openRouterId) {
  const arenas = typeof openRouterId === 'string' && openRouterId.length > 0
    ? designCatalog?.models?.[openRouterId] ?? null : null;
  if (!Array.isArray(arenas) || arenas.length === 0) return null;
  return Object.freeze({
    observedAt: typeof designCatalog?.observedAt === 'string' ? designCatalog.observedAt : null,
    arenas,
  });
}

/**
 * The measured profile of ONE catalog slug, or null when the catalog defines no such model.
 * `billing` is the route's declared basis: only `api` carries prices (a subscription route states
 * no per-token price and says why). #444: `design` is the joined design fact the caller resolved by
 * the route's `openRouterId` (or null) with the closed `designReason` that explains its absence —
 * the profile row never re-derives either.
 */
export function profileFor(catalog, slug, { billing = 'subscription', design = null, designReason = null } = {}) {
  const entry = typeof slug === 'string' && slug.length > 0 ? catalog?.models?.[slug] ?? null : null;
  if (entry === null) return null;
  const api = billing === 'api';
  const joined = design ?? null;
  return assertModelProfile(Object.freeze({
    slug: entry.slug,
    intelligence: entry.intelligence,
    coding: entry.coding,
    tps: entry.tps,
    ttftS: entry.ttftS,
    price: api ? entry.price : null,
    priceReason: api ? null : 'subscription',
    measuredAt: typeof catalog.updatedAt === 'string' ? catalog.updatedAt : null,
    design: joined,
    designReason: joined === null ? (designReason ?? null) : null,
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

/** One section of the parsed cache document, sanitized: a hand-edited or truncated section degrades
 * to no row rather than refusing a read. */
function parseCachedCatalogSection(document) {
  if (!record(document.catalog) || !record(document.catalog.models)) return null;
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

/** ONE cached arena row, through the closed shape — a row without an arena or an Elo is dropped,
 * never carried into a profile. */
function cachedArenaRow(value) {
  if (!record(value)) return null;
  const elo = finiteNumber(value.elo);
  if (typeof value.arena !== 'string' || value.arena.length === 0 || elo === null) return null;
  return Object.freeze({
    arena: value.arena,
    category: typeof value.category === 'string' && value.category.length > 0 ? value.category : null,
    elo,
    rank: Number.isSafeInteger(value.rank) ? value.rank : null,
    votes: Number.isSafeInteger(value.votes) ? value.votes : null,
  });
}

function parseCachedDesignSection(section) {
  if (!record(section) || !record(section.models)) return null;
  const models = {};
  for (const [id, arenas] of Object.entries(section.models)) {
    const rows = (Array.isArray(arenas) ? arenas : [])
      .map(cachedArenaRow).filter((arena) => arena !== null);
    if (rows.length === 0) continue;
    models[id] = Object.freeze(sortArenas(rows));
  }
  return Object.freeze({
    design: Object.freeze({
      observedAt: typeof section.observedAt === 'string' ? section.observedAt : null,
      freshForMs: Number.isSafeInteger(section.freshForMs) && section.freshForMs > 0 ? section.freshForMs : null,
      models: Object.freeze(models),
    }),
    fetchedAt: typeof section.fetchedAt === 'string' ? section.fetchedAt : null,
  });
}

/** The parsed cache document, section by section: the Artificial Analysis catalog and the Design
 * Arena rankings ride ONE file (two live sources), and either section is admissible on its own. */
function parseCachedDocument(text) {
  let document;
  try { document = JSON.parse(text); } catch { return null; }
  if (!record(document)) return null;
  return Object.freeze({
    catalog: parseCachedCatalogSection(document),
    design: parseCachedDesignSection(document.design),
  });
}

/** The parsed document behind the (path, mtime, size) memo — read ONCE per cache generation so a
 * doctor read serves a route's two sections from the same bytes. */
function cachedDocument(stateDir) {
  const path = cachePath(stateDir);
  let stat;
  try { stat = statSync(path); } catch { return null; }
  if (!stat.isFile()) return null;
  const key = `${path}:${stat.mtimeMs}:${stat.size}`;
  if (cacheMemo === null || cacheMemo.key !== key) {
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { return null; }
    const entry = parseCachedDocument(text);
    if (entry === null || (entry.catalog === null && entry.design === null)) {
      cacheMemo = null;
      return null;
    }
    cacheMemo = { key, entry };
  }
  return cacheMemo.entry;
}

/** The freshness judgment BOTH sections share: the origin is the LATEST of the two instants the
 * copy carries (the provider's own measurement instant and the instant this deployment fetched it),
 * the window is the one the provider declared when it declared one, and the ONE registry row is the
 * fallback. The provider's instant alone would judge a catalogue published hours ago as stale the
 * moment it lands — a request per read — while the copy's own age is what the window bounds. */
function judgeFreshness(publishedAt, fetchedAt, freshForMs, now) {
  const publishedAtMs = instantMs(publishedAt);
  const fetchedAtMs = instantMs(fetchedAt);
  const observedAtMs = publishedAtMs === null ? fetchedAtMs
    : (fetchedAtMs === null ? publishedAtMs : Math.max(publishedAtMs, fetchedAtMs));
  if (observedAtMs === null) return null;
  const windowMs = Number.isSafeInteger(freshForMs) && freshForMs > 0 ? freshForMs : MODEL_PROFILE_STALENESS_MS;
  const freshUntilMs = observedAtMs + windowMs;
  return Object.freeze({ observedAtMs, windowMs, freshUntilMs, stale: now() >= freshUntilMs });
}

/**
 * The cached catalog, judged against the staleness bound the registry declares — or the freshness
 * window the provider itself declared, which wins — or null when there is no admissible cache.
 */
export function readCachedCatalog(stateDir, { now = Date.now } = {}) {
  const section = cachedDocument(stateDir)?.catalog ?? null;
  if (section === null) return null;
  const freshness = judgeFreshness(section.catalog.updatedAt, section.fetchedAt, section.catalog.freshForMs, now);
  if (freshness === null) return null;
  return Object.freeze({
    catalog: section.catalog,
    observedAt: section.catalog.updatedAt ?? section.fetchedAt,
    ...freshness,
    boundMs: MODEL_PROFILE_STALENESS_MS,
  });
}

/**
 * The cached DESIGN rankings, judged exactly like the catalog — the same registry fallback, the
 * same provider-declared window, the same fetch-instant origin — so the two live sources age by one
 * rule and the route table can read both from one cache generation.
 */
export function readCachedDesignRankings(stateDir, { now = Date.now } = {}) {
  const section = cachedDocument(stateDir)?.design ?? null;
  if (section === null) return null;
  const freshness = judgeFreshness(section.design.observedAt, section.fetchedAt, section.design.freshForMs, now);
  if (freshness === null) return null;
  return Object.freeze({
    design: section.design,
    observedAt: section.design.observedAt ?? section.fetchedAt,
    ...freshness,
    boundMs: MODEL_PROFILE_STALENESS_MS,
  });
}

/** The raw cache document, as the merge below reads it. */
function readCacheDocument(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return null; }
  let document;
  try { document = JSON.parse(text); } catch { return null; }
  return record(document) ? document : null;
}

/** Write ONE section of the cache document, atomically (a temp file renamed into place), owner-only,
 * and PRESERVING the other section: two live sources share the file, so a refresh of either never
 * erases what the other measured. Returns the path written. */
function writeCacheSection(stateDir, patch) {
  const path = cachePath(stateDir);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const document = { schemaVersion: 1, ...(readCacheDocument(path) ?? {}), ...patch };
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } catch (cause) {
    try { rmSync(temporary, { force: true }); } catch { /* the temp file never existed */ }
    throw profileError(`the cache could not be written (${cause?.code ?? 'unknown'})`, 'model_profile_cache_unwritable');
  } finally {
    cacheMemo = null;
  }
  return path;
}

export function writeCachedCatalog(stateDir, catalog, { now = Date.now } = {}) {
  return writeCacheSection(stateDir, { fetchedAt: new Date(now()).toISOString(), catalog });
}

export function writeCachedDesignRankings(stateDir, design, { now = Date.now } = {}) {
  return writeCacheSection(stateDir, {
    design: { fetchedAt: new Date(now()).toISOString(), ...design },
  });
}

/**
 * The deployment's profile reader: the ONE authority the doctor's route table, the recruit's route
 * comparison and the seat brief read. It never fetches inline — `profilesFor` answers from the
 * cache (and STARTS a refresh when the cache is stale, so the next read is fresh), and `refresh` is
 * the explicit read an async caller awaits. #444: the design source rides the SAME reader — one
 * cache file, two sections, two credentials, each refreshed on its own freshness.
 *
 * `stateDir` is the deployment's state dir; `fetchImpl`/`designFetchImpl` are injected (the
 * production reader supplies the HTTPS fetch, a test supplies a fake); `key`/`env`/`keyPath` and
 * `designKey`/`designKeyPath` resolve the two credentials exactly as adapter.mjs declares them.
 */
export function modelProfileReader({
  stateDir, key = null, env = null, keyPath = null, now = Date.now,
  fetchImpl = null, timeoutMs = null,
  designKey = null, designKeyPath = null, designFetchImpl = null,
} = {}) {
  let inFlight = null;
  let designInFlight = null;

  function resolveKey() {
    if (typeof key === 'string' && key.trim().length > 0) return key.trim();
    return readAaCredential({
      ...(record(env) ? { env } : {}),
      ...(typeof keyPath === 'string' && keyPath.length > 0 ? { path: keyPath } : {}),
    });
  }

  function resolveDesignKey() {
    if (typeof designKey === 'string' && designKey.trim().length > 0) return designKey.trim();
    return readDesignArenaCredential({
      ...(record(env) ? { env } : {}),
      ...(typeof designKeyPath === 'string' && designKeyPath.length > 0 ? { path: designKeyPath } : {}),
    });
  }

  function catalog() {
    try { return readCachedCatalog(stateDir, { now }); } catch { return null; }
  }

  function designSection() {
    try { return readCachedDesignRankings(stateDir, { now }); } catch { return null; }
  }

  /** Ensure a fresh catalog is present. The explicit read: deduped while one is in flight, skipped
   * while the cache is still fresh, and NEVER thrown — every failure is a reason the caller's row
   * degrades with. */
  function refreshCatalog({ force = false } = {}) {
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

  /** The design source's own refresh, on the same contract: deduped while one is in flight, skipped
   * while the section is still fresh, and NEVER thrown. */
  function refreshDesign({ force = false } = {}) {
    if (designInFlight !== null) return designInFlight;
    const current = designSection();
    if (!force && current !== null && current.stale === false) {
      return Promise.resolve(Object.freeze({ ok: true, reason: null, fetched: false }));
    }
    if (typeof designFetchImpl !== 'function') {
      return Promise.resolve(Object.freeze({
        ok: false, reason: DESIGN_RANKINGS_REASONS.unavailable, fetched: false,
      }));
    }
    const keyValue = resolveDesignKey();
    if (keyValue === null) {
      return Promise.resolve(Object.freeze({
        ok: false, reason: DESIGN_RANKINGS_REASONS.keyAbsent, fetched: false,
      }));
    }
    designInFlight = (async () => {
      try {
        const { design: fetched } = await fetchDesignRankings({
          fetchImpl: designFetchImpl, key: keyValue, now, timeoutMs,
        });
        writeCachedDesignRankings(stateDir, fetched, { now });
        return Object.freeze({ ok: true, reason: null, fetched: true });
      } catch (error) {
        return Object.freeze({
          ok: false,
          reason: error?.code === DESIGN_RANKINGS_REFUSAL_CODES.credentialAbsent
            ? DESIGN_RANKINGS_REASONS.keyAbsent : DESIGN_RANKINGS_REASONS.unavailable,
          fetched: false,
        });
      } finally {
        designInFlight = null;
      }
    })();
    return designInFlight;
  }

  /** The explicit read: BOTH live sources refresh together, each on its own freshness, dedup and
   * credential, and the answer names each one's outcome. Never throws. */
  function refresh({ force = false } = {}) {
    return Promise.all([refreshCatalog({ force }), refreshDesign({ force })]).then(
      ([catalogOutcome, designOutcome]) => Object.freeze({ ...catalogOutcome, design: designOutcome }),
    );
  }

  /** #444: the design fact of ONE route — the joined ranking, or null beside the ONE closed reason
   * it is absent. An absent or stale section STARTS its refresh (never awaited here), so the next
   * read is served fresh while this one stays honest, and the route itself is never affected. */
  function designFactOf(route) {
    const openRouterId = typeof route?.openRouterId === 'string' && route.openRouterId.length > 0
      ? route.openRouterId : null;
    if (openRouterId === null) {
      return Object.freeze({ design: null, designReason: DESIGN_RANKINGS_REASONS.noOpenRouterId });
    }
    const cached = designSection();
    if (cached === null) {
      if (resolveDesignKey() === null) {
        return Object.freeze({ design: null, designReason: DESIGN_RANKINGS_REASONS.keyAbsent });
      }
      refreshDesign();
      return Object.freeze({ design: null, designReason: DESIGN_RANKINGS_REASONS.unavailable });
    }
    if (cached.stale) {
      refreshDesign();
      return Object.freeze({ design: null, designReason: DESIGN_RANKINGS_REASONS.stale });
    }
    const ranking = designRankingFor(cached.design, openRouterId);
    if (ranking === null) {
      return Object.freeze({ design: null, designReason: DESIGN_RANKINGS_REASONS.unavailable });
    }
    return Object.freeze({ design: ranking, designReason: null });
  }

  /** The profile of ONE route, or null when the route maps to no catalog slug at all. A route with
   * an `aaSlug` always answers a row: the measurement, or the reason it could not be read — with
   * the design axis beside it whenever the route declares a join the design catalog ranks. */
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
      refreshCatalog();
      return unavailable(MODEL_PROFILE_REASONS.catalogUnavailable, remedyFor(MODEL_PROFILE_REASONS.catalogUnavailable));
    }
    if (cached.stale) refreshCatalog();
    const measured = profileFor(cached.catalog, slug, { billing, ...designFactOf(route) });
    return measured ?? unavailable(MODEL_PROFILE_REASONS.modelUnmeasured, remedyFor(MODEL_PROFILE_REASONS.modelUnmeasured, slug));
  }

  /** The rows for one served route list, aligned by index — one read of the cache per call. */
  function profilesFor(routes) {
    if (!Array.isArray(routes)) throw profileError('profilesFor takes the served routes', 'model_profile_invalid');
    return Object.freeze(routes.map((route) => profileOf(route)));
  }

  return Object.freeze({ profileOf, profilesFor, refresh });
}
