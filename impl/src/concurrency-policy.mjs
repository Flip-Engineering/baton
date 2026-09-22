/**
 * concurrency-policy.mjs — the one representation of a worker-concurrency ceiling.
 *
 * `card().concurrencyCeiling: number | null`:
 *   number — a positive safe integer the deployment CALLER configured. No constructor and no
 *            built-in route invents one, and a provider observation (429/quota) is never written
 *            back here.
 *   null   — no configured limit. Not 0, not 1, not 4; every consumer treats it as unbounded.
 *
 * A configured value is enforced by the coordinator's dispatch admission (exact and auto routes
 * alike), which ledgers `task.dispatch_deferred` and resumes when a slot is released.
 */

/** @param {unknown} value undefined/null = no configured limit. @returns {number|null} */
export function normalizeConcurrencyCeiling(value, label = 'concurrencyCeiling') {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer or null (no configured limit), got ${describe(value)}`);
  }
  return value;
}

/** The single eligibility predicate: null is unbounded; a malformed value refuses loudly rather
 * than silently excluding the vendor forever. @returns {boolean} */
export function withinConcurrencyCeiling(ceiling, inFlight) {
  const limit = normalizeConcurrencyCeiling(ceiling, 'card concurrencyCeiling');
  if (limit === null) return true;
  const active = Number.isSafeInteger(inFlight) && inFlight >= 0 ? inFlight : 0;
  return active < limit;
}

/**
 * The ONE closed reason a seat-ceiling deferral carries on its durable receipt
 * (`task.dispatch_deferred`). It is the router's own word for the same fact
 * (AdaptiveRouter.advice's row reason), so the pre-cap, the advice row and the deferral all name
 * one vocabulary. It names the GATE — a configured seat ceiling — never provider-side
 * backpressure, which is a different class and never a deferral.
 */
export const SEAT_CEILING_REASON = 'concurrency_saturated';

/** The seat-ceiling verdict for one candidate, read from the SAME predicate the pre-cap uses:
 * null when no configured ceiling gates it, else SEAT_CEILING_REASON. A deferral therefore names
 * the reason the gate actually decided on, never a number derived by a second scan.
 * @returns {string|null} */
export function seatCeilingReason(ceiling, inFlight) {
  return withinConcurrencyCeiling(ceiling, inFlight) ? null : SEAT_CEILING_REASON;
}

function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return 'a function';
  return String(value);
}
