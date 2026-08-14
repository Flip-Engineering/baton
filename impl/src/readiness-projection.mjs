// readiness-projection.mjs — the #146/#167 seat + queue + honest-verdict projection.
//
// The seat-telemetry surface must be LIVE and ACCURATE, never a static card relabel: the
// campaign's origin evidence (Grok 402, GLM capacity deaths found only at turn time) is
// "static-ready ≠ provider-alive". This module owns the single projection every seats-bearing
// read consumes, so the doctor, the card, the roster, and (fleet-side) the waves.list capacity
// block all read ONE binding — the allocator's own binding, never `adapterFor` (which gates on
// `turnCompletion: 'pausable'` and so diverges from the allocator for non-pausable test doubles).
//
// The D1.1 doctor/generic binding: the AUTO-ELIGIBLE candidate set is every adapter whose card
// modelSelection (exact mode) admits the route's model AND whose reasoningEffort admits the
// route's effort — the SAME set the allocator's auto path builds (the suite's `autoEligibleSet`
// replicant, coordinator.mjs `_resolveVendor`). Exactly one eligible candidate names the vendor;
// zero (saturated) or >1 (router-pick ambiguous) reads honest-null. The wave-path capacity atom
// uses the allocator's EXPLICIT binding (`_resolveExplicitRoute`) — that lives fleet-side in the
// waves.list renderer; this module exposes the explicit resolution here so the deployment class
// and the fleet renderer share one implementation.
//
// The closed D1 atom (contract-146 §D1, folded v1.1):
//   { route, state, inFlight, ceiling, deferred, inFlightRevision }
//   - inFlight         the vendor's live seat count (coordinator._inFlightCount)
//   - ceiling          the vendor's card-declared concurrencyCeiling
//   - deferred         the §D5 Arm-1 aggregate — pending-with-receipt tasks on the vendor,
//                      derived PER READ from the ledger (a claim drops it by construction,
//                      a cancel leaves the receipt)
//   - inFlightRevision the vendor's incarnation-local handle-revision counter — the count of
//                      worker handles this incarnation has ever dispatched to the vendor
//                      (handles are never deleted, so the counter is monotonic; never a clock)
//
// The queue surface (#218 addendum): per-adapter { adapter, inFlight, ceiling, seat_queued }
// where seat_queued carries { memberId, queuePosition } for every task the coordinator holds
// 'pending' that would dispatch to that vendor, in task-order. Under the #221 operator ruling
// the coordinator dispatches unconditionally (backpressure is provider-TRUE), so the queue
// reads near-empty — the surface honesty law: the machinery knows → the surface says.
//
// The honest verdict (#167 D2): { verdict, probedAt } — verdict ∈ { 'probe-verified',
// 'unverified', 'failed' } projected from the liveness tuple, probedAt the last recorded
// measurement (never cleared when the window lapses, OQ5).

/** The closed D1 atom key set, in no particular order (consumers sort for comparison). */
export const SEAT_ATOM_KEYS = ['ceiling', 'deferred', 'inFlight', 'inFlightRevision', 'route', 'state'];

/** The #167 closed verdict vocabulary (contract D2). */
export const HONEST_VERDICTS = ['probe-verified', 'unverified', 'failed'];

function isSafeCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isEligibleCard(selection, route) {
  if (!selection || typeof selection !== 'object') return false;
  if (selection.mode !== 'exact') return false;
  const modelOk = Array.isArray(selection.available)
    ? selection.available.includes(route.model)
    : selection.configuredDefault === route.model || selection.acceptedAliases?.includes(route.model) === true;
  return modelOk && Array.isArray(selection.reasoningEffort) && selection.reasoningEffort.includes(route.effort);
}

/**
 * The D1.1 doctor/generic candidate set: every adapter whose card admits the route's model +
 * effort. Mirrors the allocator's auto path (and the seat-telemetry suite's autoEligibleSet)
 * exactly — it does NOT gate on turnCompletion pausable, so a non-pausable MockAdapter is
 * visible here while invisible to adapterFor (the discriminator that separates the correct
 * binding from the parallel reading).
 */
export function autoEligibleAdapters(coordinator, route) {
  const adapters = coordinator?._adapters ?? {};
  const names = [];
  for (const [name, adapter] of Object.entries(adapters)) {
    if (typeof adapter?.card !== 'function') continue;
    if (isEligibleCard(adapter.card().modelSelection, route)) names.push(name);
  }
  return names;
}

/**
 * The D1.1 doctor/generic vendor resolution: exactly one auto-eligible candidate names the
 * vendor; zero or >1 reads null (the router pick is load/adaptive history, unpredictable from
 * route identity alone). The allocator's auto path ALSO refuses a SATURATED vendor (the router
 * never dispatches onto a full ceiling), so a single card-eligible candidate at capacity reads
 * honest-null too — "eligible" means the allocator would actually dispatch, never merely
 * advertise a model/effort it can no longer seat (A4 leg-b: one live seat on a ceiling-1
 * adapter → nothing eligible to dispatch → null, never a fabricated 0 or 1).
 */
export function resolveSeatVendor(coordinator, route) {
  const eligible = autoEligibleAdapters(coordinator, route);
  const dispatchable = eligible.filter((name) => {
    const card = coordinator?._adapters?.[name]?.card?.() ?? null;
    const ceiling = safeCeiling(card);
    if (ceiling === null) return true; // no declared ceiling → no capacity refusal
    return inFlightCount(coordinator, name) < ceiling;
  });
  return dispatchable.length === 1 ? dispatchable[0] : null;
}

/**
 * The allocator's EXPLICIT binding (the wave-path capacity atom, Fold A3): the member's
 * vendorRequested axis is route.harness, resolved via the coordinator's _resolveExplicitRoute —
 * never adapterFor. Returns the vendor name or null when no single explicit route resolves.
 */
export function resolveExplicitVendor(coordinator, route) {
  if (!coordinator || typeof coordinator._resolveExplicitRoute !== 'function') return null;
  const selected = coordinator._resolveExplicitRoute(route.harness, {
    model: route.model, effort: route.effort, sessionRequest: { mode: 'new' },
  });
  return selected?.ok === true ? selected.selection.vendor : null;
}

function safeCeiling(card) {
  return isSafeCount(card?.concurrencyCeiling) ? card.concurrencyCeiling : null;
}

function inFlightCount(coordinator, vendor) {
  if (!coordinator || typeof coordinator._inFlightCount !== 'function') return null;
  return coordinator._inFlightCount(vendor);
}

/**
 * The §D5 Arm-1 aggregate: pending-with-receipt tasks on the vendor, derived PER READ from the
 * ledger. A task holds a receipt if a task.dispatch_deferred event names it and it has not been
 * claimed or terminal-transitioned since. A claim removes its task from the set by construction
 * (drop-by-one); a cancel leaves the receipt (count persists). Under the #221 ruling the
 * coordinator mints no receipts, so this reads honest zero — but the formula is the pinned one.
 */
export function deferredReceiptCount(coordination, vendor) {
  if (!coordination || typeof coordination.eventsView !== 'function') return 0;
  const events = coordination.eventsView();
  const terminalByTask = new Set();
  const claimedByTask = new Set();
  for (const event of events) {
    const payload = event?.payload ?? {};
    if (event?.kind === 'task.dispatch_deferred' && payload.vendor !== vendor) continue;
    const taskId = payload.id ?? payload.taskId;
    if (!taskId) continue;
    if (event?.kind === 'task.claimed' && payload.harnessResolved === vendor) {
      claimedByTask.add(taskId);
    } else if (event?.kind === 'task.transitioned' && TERMINAL_TASK_STATES.has(payload.to)) {
      terminalByTask.add(taskId);
    }
  }
  let count = 0;
  for (const event of events) {
    const payload = event?.payload ?? {};
    if (event?.kind !== 'task.dispatch_deferred' || payload.vendor !== vendor) continue;
    if (!claimedByTask.has(payload.taskId) && !terminalByTask.has(payload.taskId)) count += 1;
  }
  return count;
}

const TERMINAL_TASK_STATES = new Set(['completed', 'failed', 'cancelled', 'accepted', 'superseded']);

/**
 * The vendor's incarnation-local handle-revision counter: the number of worker handles this
 * coordinator incarnation has EVER dispatched to the vendor. Handles are never removed from
 * the registry (coordinator.mjs _workers), so the counter is monotonic and replay-consistent —
 * never a clock.
 */
export function handleRevision(coordinator, vendor) {
  if (!coordinator?._workers || typeof coordinator._workers.values !== 'function') return 0;
  let revision = 0;
  for (const handle of coordinator._workers.values()) {
    if (handle?.vendor === vendor) revision += 1;
  }
  return revision;
}

function publicRouteAtom(route) {
  return Object.freeze({ harness: route.harness, model: route.model, effort: route.effort });
}

/**
 * The closed D1 seat atom for one readiness route. `state` is the STATIC readiness state —
 * the atom never claims provider-aliveness, it reports what the machinery actually knows.
 */
export function computeSeatAtom({ route, state, coordinator, coordination }) {
  const identity = publicRouteAtom(route);
  const vendor = resolveSeatVendor(coordinator, route);
  if (vendor === null) {
    return Object.freeze({
      route: identity, state,
      inFlight: null, ceiling: null, deferred: null, inFlightRevision: null,
    });
  }
  const adapter = coordinator?._adapters?.[vendor] ?? null;
  const card = typeof adapter?.card === 'function' ? adapter.card() : null;
  return Object.freeze({
    route: identity, state,
    inFlight: inFlightCount(coordinator, vendor),
    ceiling: safeCeiling(card),
    deferred: deferredReceiptCount(coordination, vendor),
    inFlightRevision: handleRevision(coordinator, vendor),
  });
}

/**
 * The #218 queue surface: per-adapter { adapter, inFlight, ceiling, seat_queued } where
 * seat_queued lists every task the coordinator holds 'pending' that would dispatch to that
 * vendor, in task order, with { memberId, queuePosition }.
 */
export function seatQueue(coordinator, coordination) {
  const adapters = coordinator?._adapters ?? {};
  const order = Array.isArray(coordinator?._taskOrder) ? coordinator._taskOrder : [];
  const tasks = coordinator?._tasks;
  const rows = [];
  for (const [name, adapter] of Object.entries(adapters)) {
    const card = typeof adapter?.card === 'function' ? adapter.card() : null;
    const queued = [];
    let position = 0;
    for (const taskId of order) {
      const task = tasks?.get?.(taskId);
      if (!task || task.status !== 'pending') continue;
      const vendor = typeof task.vendorResolved === 'string'
        ? task.vendorResolved
        : typeof task.vendorRequested === 'string' && task.vendorRequested !== 'auto'
          ? task.vendorRequested : null;
      if (vendor !== name) continue;
      position += 1;
      queued.push(Object.freeze({ memberId: task.runId ?? task.id, queuePosition: position }));
    }
    rows.push(Object.freeze({
      adapter: name,
      inFlight: inFlightCount(coordinator, name),
      ceiling: safeCeiling(card),
      seat_queued: Object.freeze(queued),
    }));
  }
  return Object.freeze(rows);
}

/**
 * The #167 honest projection: { verdict, probedAt } derived from the liveness tuple. The
 * lapsed-verified window reads 'unverified' with probedAt RETAINING the last recorded
 * measurement (OQ5 — the measurement is content-derived, never cleared, never a TTL guess).
 */
export function honestVerdict(liveness) {
  if (!liveness || typeof liveness !== 'object') {
    return Object.freeze({ verdict: 'unverified', probedAt: null });
  }
  const state = liveness.state;
  let verdict = 'unverified';
  if (state === 'verified') verdict = 'probe-verified';
  else if (state === 'failed') verdict = 'failed';
  const measuredAt = Number.isFinite(liveness.verifiedAt) ? liveness.verifiedAt
    : Number.isFinite(liveness.failedAt) ? liveness.failedAt : null;
  return Object.freeze({
    verdict,
    probedAt: measuredAt === null ? null : new Date(measuredAt).toISOString(),
  });
}

/**
 * The replay-consistent freshness label: an event seq (ledger head), never wall time. The
 * seats-bearing reads carry it so consumers can reason about staleness against the ledger
 * without a clock (the campaign no-clock law).
 */
export function observedAtEventSeq(coordination) {
  if (!coordination || typeof coordination.ledgerHeadSeq !== 'function') return 0;
  return coordination.ledgerHeadSeq();
}
