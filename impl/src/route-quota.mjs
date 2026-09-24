// route-quota.mjs — the exhausted-route authority (#295).
//
// One exact route can be refused by its provider for a quota reason. That refusal is a fact about
// the ROUTE, not about the member that happened to hit it: a successor recruited onto the same
// route would be refused identically, after its worktree, credential projection and process were
// already paid for. So the observation is recorded here, once, and two consumers read it:
//
//   - route readiness (doctor) reports the route blocked until the recorded reset instant, and a
//     recruit on that route is refused BEFORE any effect (deployment assertRouteReady);
//   - the coordinator never re-drives a turn in the quota class on the same route.
//
// The block expires by DERIVATION from the recorded instant — `blockFor(route, now)` compares the
// two. The recorded instant is the provider's own reset when it named one; a block whose provider
// named nothing ends at the declared fault-probe bound (`details.derivedResetAt`, the same
// derivation the degrade episode's probe instant rides), so a zone-less answer cannot hold a route
// off forever (#575). There is no timer and no poll here: the expiry is checked as the block is
// read, and a fresh observation starts a fresh block.

import { PROVIDER_FAULT_CODES, normalizeProviderRoute, routeQuotaScope } from './provider-faults.mjs';

/** The one exact-route identity this authority keys on: harness, model, effort. */
export function routeQuotaKey(route) {
  const exact = normalizeProviderRoute(route);
  return exact ? JSON.stringify([exact.harness, exact.model, exact.effort]) : null;
}

export class ProviderQuotaAuthority {
  /**
   * @param {{now?: () => number, maxEntries?: number}} [options] `now` is the deployment clock
   * (injectable, so readiness expiry is testable without waiting on wall time); `maxEntries` is
   * the retention ceiling the deployment sizes to its OWN route inventory, so a live block on a
   * configured route can never be evicted. Eviction drops the oldest observation first and only
   * ever touches a route this deployment never dispatched to.
   */
  constructor(options = {}) {
    const now = options.now ?? Date.now;
    if (typeof now !== 'function') throw new TypeError('ProviderQuotaAuthority requires a now() function');
    const maxEntries = options.maxEntries ?? 1;
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new TypeError('ProviderQuotaAuthority requires a positive entry ceiling');
    }
    this._now = now;
    this._maxEntries = maxEntries;
    this._blocks = new Map();
  }

  /**
   * Record one observed quota refusal for an exact route. The NEWEST observation is the
   * authoritative one — a provider that names a nearer recovery has said something newer than the
   * record here — while an out-of-order observation (an older `at`) never rewrites newer truth.
   */
  record(route, details = {}) {
    const scope = routeQuotaScope(route);
    if (scope === null) return null;
    const exact = normalizeProviderRoute(route);
    const resetAt = typeof details.resetAt === 'string' && Number.isFinite(Date.parse(details.resetAt))
      ? new Date(Date.parse(details.resetAt)).toISOString() : null;
    const prior = this._blocks.get(scope) ?? null;
    const recordedAt = Number.isFinite(details.at) ? details.at : this._now();
    if (prior && recordedAt < prior.observedAt) {
      return Object.freeze({ ...prior, observedCount: prior.observedCount + 1 });
    }
    const derivedResetAt = typeof details.derivedResetAt === 'string' && Number.isFinite(Date.parse(details.derivedResetAt))
      ? new Date(Date.parse(details.derivedResetAt)).toISOString() : null;
    const row = {
      key: scope, scope, route: exact,
      code: PROVIDER_FAULT_CODES.quota,
      resetAt,
      // #575: the instant the block ends when the provider named no reset of its own — the
      // declared fault-probe bound, carried beside the honest `resetAt: null` so a reader never
      // mistakes a derived bound for the provider's own answer.
      derivedResetAt,
      observedAt: recordedAt,
      observedCount: (prior?.observedCount ?? 0) + 1,
      workerId: typeof details.workerId === 'string' && details.workerId.length > 0 ? details.workerId : null,
      runId: typeof details.runId === 'string' && details.runId.length > 0 ? details.runId : null,
    };
    this._blocks.delete(scope);
    this._blocks.set(scope, row);
    while (this._blocks.size > this._maxEntries) {
      const oldest = this._blocks.keys().next();
      if (oldest.done) break;
      this._blocks.delete(oldest.value);
    }
    return this.blockFor(route, this._now());
  }
  /** The live block for one route, or null. An expired block is dropped as it is read — the
   * expiry is derived from the recorded instant, never from a polling constant: the provider's
   * own reset when it named one, else the declared fault-probe bound (#575). */
  blockFor(route, now = this._now()) {
    const scope = routeQuotaScope(route);
    if (scope === null) return null;
    const row = this._blocks.get(scope);
    if (!row) return null;
    const end = row.resetAt ?? row.derivedResetAt ?? null;
    if (end !== null && Date.parse(end) <= now) {
      this._blocks.delete(scope);
      return null;
    }
    return Object.freeze({ state: 'blocked', ...row });
  }

  // The durable `provider.quota_exhausted` row and the run-level attention row carry the block
  // beside the provider's own words, and the refusal says when the reset time was not reported.
}
