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
// two. There is no timer, no poll, and no re-probe: when the recorded reset passes, the route
// reads ready again because the fact that blocked it is in the past.

import { PROVIDER_FAULT_CODES, normalizeProviderRoute } from './provider-faults.mjs';

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
    const key = routeQuotaKey(route);
    if (key === null) return null;
    const exact = normalizeProviderRoute(route);
    const resetAt = typeof details.resetAt === 'string' && Number.isFinite(Date.parse(details.resetAt))
      ? new Date(Date.parse(details.resetAt)).toISOString() : null;
    const prior = this._blocks.get(key) ?? null;
    const recordedAt = Number.isFinite(details.at) ? details.at : this._now();
    if (prior && recordedAt < prior.observedAt) {
      return Object.freeze({ ...prior, observedCount: prior.observedCount + 1 });
    }
    const row = {
      key, route: exact,
      code: PROVIDER_FAULT_CODES.quota,
      resetAt,
      observedAt: recordedAt,
      observedCount: (prior?.observedCount ?? 0) + 1,
      workerId: typeof details.workerId === 'string' && details.workerId.length > 0 ? details.workerId : null,
      runId: typeof details.runId === 'string' && details.runId.length > 0 ? details.runId : null,
    };
    this._blocks.delete(key);
    this._blocks.set(key, row);
    while (this._blocks.size > this._maxEntries) {
      const oldest = this._blocks.keys().next();
      if (oldest.done) break;
      this._blocks.delete(oldest.value);
    }
    return this.blockFor(route, this._now());
  }

  /** The live block for one route, or null. An expired block is dropped as it is read — the
   * expiry is derived from the recorded instant, never from a polling constant. */
  blockFor(route, now = this._now()) {
    const key = routeQuotaKey(route);
    if (key === null) return null;
    const row = this._blocks.get(key);
    if (!row) return null;
    if (row.resetAt !== null && Date.parse(row.resetAt) <= now) {
      this._blocks.delete(key);
      return null;
    }
    return Object.freeze({ state: 'blocked', ...row });
  }

  // A block whose provider named no reset instant is retained (fail-closed) until a later
  // observation names one: the durable `provider.quota_exhausted` row and the run-level attention
  // row both carry it, and the refusal says the reset time was not reported. There is deliberately
  // no timer and no polling reader here — only the recorded instant can end a block.
}
