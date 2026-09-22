// Issue #146 (contract-146.md, v1.1 fold): the fleet seat telemetry projection.
//
// One derivation serves three read surfaces — the deployment doctor's `seats` array, the raw
// application doctor's `seats` array, and the `waves.list` capacity block; the deployment card
// inherits the doctor's array through card(). Each route resolves to ONE vendor through the
// allocator's own resolution and the counts are read for that vendor, so a seat atom and the
// allocator name the same vendor.
//
// A route the allocator cannot bind to a single vendor reads all-null: the counts are
// unobservable for that route, and a zero would claim an empty seat set for a route the
// allocator would not dispatch at all.
//
// Freshness is split across two labels. `observedAtEventSeq` is the ledger event sequence at
// composition and labels the ledger-derived parts (deferred, state, ceiling). The per-atom
// `inFlightRevision` is the resolved vendor's handle-revision counter, derived from the live
// handle registry, and labels the live inFlight count. Neither label is a clock.

import { normalizeConcurrencyCeiling, withinConcurrencyCeiling } from './concurrency-policy.mjs';
import { cardSupportsSession } from './runtime-recovery.mjs';
import { resolveCardModel } from './runtime-admission.mjs';
import { resolveEffort } from './route-tuple.mjs';

/** The D1 atom's closed key set, in sorted order. */
export const SEAT_ATOM_KEYS = Object.freeze(['ceiling', 'deferred', 'inFlight', 'inFlightRevision', 'route', 'state']);

/** The route identity a seat atom carries: the readiness route fields, plus `provider` when the
 * route declares one. */
export function seatRouteIdentity(route) {
  return Object.freeze({
    harness: route.harness,
    model: route.model,
    effort: route.effort,
    ...(typeof route.provider === 'string' && route.provider.length > 0 ? { provider: route.provider } : {}),
  });
}

/** The dedup key of a route inside one capacity block. */
export function seatRouteKey(route) {
  return [route.harness, route.model, route.effort, route.provider ?? ''].join('\u0000');
}

/** The replay-consistent composition marker: the ledger sequence at read time, an event sequence,
 * never wall time. A deployment with no coordination store reads 0 (its ledger is empty). */
export function seatObservedAtEventSeq(coordination) {
  return coordination && typeof coordination.ledgerHeadSeq === 'function'
    ? coordination.ledgerHeadSeq() : 0;
}

function cardOf(coordinator, vendor) {
  try {
    const card = coordinator?._adapters?.[vendor]?.card?.();
    return card === undefined ? null : card;
  } catch { return null; }
}

function inFlightCount(coordinator, vendor) {
  return typeof coordinator?._inFlightCount === 'function'
    ? coordinator._inFlightCount(vendor) : null;
}

/** The allocator's EXPLICIT path for one harness: `_resolveExplicitRoute` filtered by session,
 * model, effort and worker policy, unique-or-ambiguous. Null when the allocator cannot name one
 * vendor (unknown harness, no capable card, or `route_ambiguous`). */
function explicitSeatVendor(coordinator, requestedHarness, route) {
  if (typeof coordinator._resolveExplicitRoute !== 'function') return null;
  let resolved;
  try {
    resolved = coordinator._resolveExplicitRoute(requestedHarness, {
      sessionRequest: { mode: 'new' },
      model: route.model ?? null,
      modelPolicy: null,
      effort: route.effort ?? null,
      workerPolicyRequest: null,
    });
  } catch { return null; }
  const vendor = resolved?.ok === true ? resolved.selection?.vendor ?? null : null;
  return typeof vendor === 'string' && vendor.length > 0 ? vendor : null;
}

/** The allocator's AUTO path for a route identity: the cards that accept the route's model and
 * effort, then the router's eligibility predicate over the live in-flight counts. Exactly one
 * eligible candidate is the vendor the router can pick from the route identity alone; zero
 * eligible (nothing to dispatch) and more than one eligible (the pick follows load and adaptive
 * history) both read null. */
function autoSeatVendor(coordinator, route) {
  let chosen = null;
  for (const [name, adapter] of Object.entries(coordinator._adapters ?? {})) {
    let card;
    try { card = adapter?.card?.() ?? null; } catch { card = null; }
    if (!card || !cardSupportsSession(card, { mode: 'new' })) continue;
    if (!resolveCardModel(card, route.model ?? null, null, { explicit: false }).ok) continue;
    if (!resolveEffort(card, route.effort ?? null).ok) continue;
    const ceiling = normalizeConcurrencyCeiling(card.concurrencyCeiling, `${name} concurrencyCeiling`);
    if (!withinConcurrencyCeiling(ceiling, inFlightCount(coordinator, name) ?? 0)) continue;
    if (chosen !== null) return null;
    chosen = name;
  }
  return chosen;
}

/** The ONE vendor a route's seat atom reads its counts from, or null when the allocator cannot
 * name exactly one.
 *
 * `explicit` names the harness a wave member was dispatched with (`vendorRequested`); the wave
 * path passes the recovered route's own harness. A wave-path resolution that fails reads null
 * (the allocator refuses `route_ambiguous` there too).
 *
 * With no `explicit` harness, a route declaring a provider resolves through that provider-scoped
 * card, and every other route runs the adaptive candidate set. */
export function seatVendor(coordinator, route, { explicit = null } = {}) {
  if (!coordinator || !route || coordinator._adapters === undefined || coordinator._adapters === null) return null;
  if (typeof explicit === 'string' && explicit.length > 0) {
    return explicitSeatVendor(coordinator, explicit, route);
  }
  if (typeof route.provider === 'string' && route.provider.length > 0) {
    return explicitSeatVendor(coordinator, `${route.harness}:${route.provider}`, route);
  }
  return autoSeatVendor(coordinator, route);
}

/** The card-declared concurrency ceiling of a resolved vendor, or null when the vendor names no
 * card. */
export function seatCeiling(coordinator, vendor) {
  const card = cardOf(coordinator, vendor);
  return card === null ? null
    : normalizeConcurrencyCeiling(card.concurrencyCeiling, `${vendor} concurrencyCeiling`);
}

// The handle-revision counter: one entry per (coordinator incarnation, vendor), holding the last
// observed signature of that vendor's handle registry and the revision that signature moved to.
// A WeakMap keyed by the coordinator makes the counter incarnation-local by construction — a new
// coordinator starts every vendor at 0. The signature is the vendor's handle ids and statuses, so
// two reads with an equal revision observed the same handle set in the same statuses, and the
// inFlight count (a function of that set) cannot have moved between them.
const handleRevisions = new WeakMap();

function handleSignature(coordinator, vendor) {
  const workers = coordinator?._workers;
  if (!(workers instanceof Map)) return null;
  const parts = [];
  for (const handle of workers.values()) {
    if (handle?.vendor !== vendor) continue;
    parts.push(`${handle.id ?? ''}\u0000${handle.status ?? ''}`);
  }
  parts.sort();
  return parts.join('\u0001');
}

/** The resolved vendor's incarnation-local handle-revision counter, or null when no vendor
 * resolves. The counter moves on a handle insert, removal or status change for the vendor and
 * never reads a clock. */
export function seatInFlightRevision(coordinator, vendor) {
  if (typeof vendor !== 'string' || vendor.length === 0 || !coordinator) return null;
  const signature = handleSignature(coordinator, vendor);
  if (signature === null) return null;
  let perVendor = handleRevisions.get(coordinator);
  if (perVendor === undefined) { perVendor = new Map(); handleRevisions.set(coordinator, perVendor); }
  const prior = perVendor.get(vendor);
  if (prior === undefined || prior.signature !== signature) {
    const revision = prior === undefined ? 0 : prior.revision + 1;
    perVendor.set(vendor, { signature, revision });
    return revision;
  }
  return prior.revision;
}

function deferralReceiptOf(event) {
  if (event?.kind === 'task.dispatch_deferred') return event.payload ?? event;
  if (event?.payload?.kind === 'task.dispatch_deferred') return event.payload;
  return null;
}

/** The #10 §D5 Arm-1 aggregate per vendor: the number of distinct tasks that are pending NOW and
 * hold a `task.dispatch_deferred` receipt on that vendor. One ledger sweep collects the
 * (vendor, taskId) receipts, then each receipt's task status is read once — O(E + D) per read, and
 * a task that claims or cancels leaves the count because its status is no longer pending.
 *
 * Returns null when there is no coordination store to read. */
export function seatDeferredByVendor(coordination) {
  if (!coordination || typeof coordination.eventsView !== 'function') return null;
  const receipts = new Map();
  for (const event of coordination.eventsView()) {
    const receipt = deferralReceiptOf(event);
    const taskId = receipt?.taskId;
    const vendor = receipt?.vendor;
    if (typeof taskId !== 'string' || taskId.length === 0) continue;
    if (typeof vendor !== 'string' || vendor.length === 0) continue;
    const key = `${vendor}\u0000${taskId}`;
    if (!receipts.has(key)) receipts.set(key, { taskId, vendor });
  }
  const byVendor = new Map();
  const statusOf = typeof coordination.task === 'function'
    ? (taskId) => coordination.task(taskId)?.status ?? null
    : () => null;
  for (const { taskId, vendor } of receipts.values()) {
    if (statusOf(taskId) !== 'pending') continue;
    byVendor.set(vendor, (byVendor.get(vendor) ?? 0) + 1);
  }
  return byVendor;
}

/** The closed D1 atom. Every count is null when no single vendor resolves; otherwise the counts
 * are read for that vendor and `deferredByVendor` scopes the deferral aggregate. */
export function seatAtom({ coordinator = null, route, state, vendor = null, deferredByVendor = null }) {
  const identity = seatRouteIdentity(route);
  const vendorName = typeof vendor === 'string' && vendor.length > 0 ? vendor : null;
  if (vendorName === null) {
    return Object.freeze({
      route: identity, inFlight: null, ceiling: null, deferred: null, inFlightRevision: null, state,
    });
  }
  return Object.freeze({
    route: identity,
    inFlight: inFlightCount(coordinator, vendorName),
    ceiling: seatCeiling(coordinator, vendorName),
    deferred: deferredByVendor === null ? null : deferredByVendor.get(vendorName) ?? 0,
    inFlightRevision: seatInFlightRevision(coordinator, vendorName),
    state,
  });
}

/** The seat atoms for a list of routes, deduplicated by route key in first-seen order. The
 * doctor and the raw doctor path use it for their readiness routes. */
export function seatAtomsForRoutes({ coordinator = null, routes, stateOf, deferredByVendor = null }) {
  return Object.freeze(routes.map((route, index) => seatAtom({
    coordinator,
    route,
    state: stateOf(route, index),
    vendor: seatVendor(coordinator, route),
    deferredByVendor,
  })));
}

/** The `waves.list` capacity block for one wave: the DISTINCT routes its members occupy, each as a
 * D1 atom, bound through the allocator's explicit path for the member's own harness. Members whose
 * route could not be recovered contribute nothing.
 *
 * `state` is the readiness the `waves.list` surface publishes for those routes. That surface is
 * the application's own registry read, and the application's readiness derivation carries every
 * profile route as `state: 'ready'` — the value the wave member was admitted against. */
export function seatCapacityAtoms({ coordinator = null, routes, deferredByVendor = null, state = 'ready' }) {
  const byKey = new Map();
  for (const route of routes) {
    if (!route || typeof route.harness !== 'string') continue;
    const key = seatRouteKey(route);
    if (byKey.has(key)) continue;
    byKey.set(key, seatAtom({
      coordinator,
      route,
      state,
      vendor: seatVendor(coordinator, route, { explicit: route.harness }),
      deferredByVendor,
    }));
  }
  return Object.freeze([...byKey.values()]);
}
