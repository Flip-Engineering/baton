// readiness-projection.mjs — the folded #146 seat-atom + #167 honest-projection read layer.
//
// ONE occupancy source for the deployment doctor and the fleet roster: every seat-shaped read
// (the D1 atom, the doctor row's non-enumerable occupancy sibling, and the roster's occupancy)
// is derived here from the ALLOCATOR's binding — never from `adapterFor` (which gates on
// `turnCompletion: 'pausable'` and so diverges from the allocator exactly on non-pausable
// test doubles, route-liveness.mjs:35-47).
//
// Binding laws (contract-146 D1.1/B1, the suite's discriminator):
//   - the DOCTOR/generic read is the allocator's AUTO path: build the candidate set (adapter
//     card advertises the route's exact model + effort — mirroring resolveCardModel/resolveEffort,
//     coordinator.mjs:665-696 / route-tuple.mjs:30), apply the router's eligibility predicate
//     (inFlight < concurrencyCeiling, router.mjs:202), and read EXACTLY ONE eligible candidate.
//     0 or >1 eligible → honest-null (the router's adaptive pick is history-dependent, never
//     predictable from route identity alone — D1.1).
//   - the WAVE path (a dispatched member's capacity atom, A9-1) is the allocator's EXPLICIT
//     path: `coordinator._resolveExplicitRoute(harness, {model, effort})` — the vendorRequested
//     axis (coordinator.mjs:3012-3055). Exposed here for the future wave-list integration; the
//     waves.list surface itself is owned by application.mjs (out of this row's partition).
//
// The D1 atom is a CLOSED six-key set (assertAtom, seat-telemetry suite): {ceiling, deferred,
// inFlight, inFlightRevision, route, state}. inFlight/ceiling/deferred/inFlightRevision are null
// exactly when no vendor resolves (no card to read, no dispatch could have deferred, no handle
// registry to read a revision for); state is the static readiness state, never null.
//
// deferred is the §D5 Arm-1 aggregate — the single-pass ledger sweep of pending-with-receipt
// tasks on the vendor (tasks holding a `task.dispatch_deferred` receipt that are not terminal).
// Operator ruling #221 removed the receipt minting, so the sweep reads zero in practice; it is
// still derived per-read, so a claim drops the task from the set by construction (D1.2).
//
// inFlightRevision is the vendor's incarnation-local handle-registry revision — the number of
// worker handles ever registered for the vendor (the coordinator's `_workers` Map is permanent,
// coordinator.mjs:4938). Monotonic, vendor-scoped (the same counter for every route the vendor
// serves — A6), never a clock (B3/A11's no-clock guard).
//
// The #167 honest projection (contract-167 D2) maps the projected liveness row to the
// enumerable {verdict, probedAt} pair: verified+unexpired → 'probe-verified' with probedAt =
// ISO(verifiedAt); never-probed/unsupported/lapsed → 'unverified' (probedAt null when never
// measured, else the retained ISO(verifiedAt)); failed → 'failed' with probedAt = ISO(failedAt).

// The allocator's exact-model gate (mirror of coordinator.mjs:656-663 — a card advertises an
// exact model when its mode is 'exact' and one of available/configuredDefault/aliases/prefixes
// accepts it). Never imports from coordinator.mjs: this module stays an additive sibling.
function cardAcceptsExactModel(card, model) {
  const selection = card?.modelSelection;
  if (!selection || selection.mode !== 'exact') return false;
  if (Array.isArray(selection.available)) return selection.available.includes(model);
  if (selection.configuredDefault === model) return true;
  if (selection.acceptedAliases?.includes(model)) return true;
  return (selection.acceptedPrefixes ?? []).some((prefix) => model.startsWith(prefix));
}

// The allocator's effort gate (mirror of route-tuple.mjs:30-36): the inventory is the card's
// reasoningEffort list; a requested effort is supported exactly when the inventory names it.
function cardAcceptsEffort(card, effort) {
  const inventory = card?.modelSelection?.reasoningEffort;
  if (effort === undefined || effort === null || effort === '') return true;
  return Array.isArray(inventory) && inventory.includes(effort);
}

/**
 * The allocator's AUTO binding for a readiness route (the doctor/generic read, D1.1). Builds the
 * candidate set from every adapter card advertising the route's exact model + effort, applies the
 * router's eligibility predicate (`inFlight < concurrencyCeiling`), and returns the sole eligible
 * vendor — or null when 0 or >1 candidates are eligible (honest ambiguity/saturation).
 * @param {{coordinator: object}} driver
 * @param {{harness: string, model: string, effort: string}} route
 * @returns {string|null}
 */
export function seatVendor(driver, route) {
  const coordinator = driver?.coordinator ?? null;
  const adapters = coordinator?._adapters ?? {};
  const candidates = [];
  for (const [name, adapter] of Object.entries(adapters)) {
    const card = typeof adapter?.card === 'function' ? adapter.card() : null;
    if (!card) continue;
    if (!cardAcceptsExactModel(card, route.model)) continue;
    if (!cardAcceptsEffort(card, route.effort)) continue;
    candidates.push(name);
  }
  const eligible = candidates.filter((name) => {
    const card = typeof adapters[name]?.card === 'function' ? adapters[name].card() : null;
    const ceiling = Number.isSafeInteger(card?.concurrencyCeiling) ? card.concurrencyCeiling : 0;
    return typeof coordinator._inFlightCount === 'function'
      && coordinator._inFlightCount(name) < ceiling;
  });
  return eligible.length === 1 ? eligible[0] : null;
}

/**
 * The allocator's EXPLICIT binding for a dispatched member's route (the wave capacity atom,
 * A9-1): the vendorRequested axis resolves through the coordinator's own explicit resolver —
 * `_resolveExplicitRoute(harness, {model, effort})` — which does NOT gate on pausability. Null
 * when the harness does not resolve uniquely (the same honest-null discipline).
 * @param {object} coordinator
 * @param {{harness: string, model: string, effort: string}} route
 * @returns {string|null}
 */
export function explicitSeatVendor(coordinator, route) {
  if (!coordinator || typeof coordinator._resolveExplicitRoute !== 'function') return null;
  const resolved = coordinator._resolveExplicitRoute(route.harness, {
    model: route.model, effort: route.effort,
  });
  return resolved?.ok ? resolved.selection.vendor : null;
}

// Single-pass ledger sweep (§D5 Arm-1): every `task.dispatch_deferred` receipt on the vendor
// whose task is still pending (non-terminal) counts as deferred work. A claim transitions the
// task out of pending, so the count drops by construction; a cancel leaves the receipt (D1.2).
function pendingDeferredReceiptCount(driver, vendor) {
  const coordination = driver?.coordination ?? null;
  const tasks = driver?.coordinator?._tasks ?? null;
  if (!coordination || typeof coordination.eventsView !== 'function') return 0;
  let count = 0;
  for (const event of coordination.eventsView()) {
    const kind = event?.kind ?? event?.payload?.kind;
    if (kind !== 'task.dispatch_deferred') continue;
    const eventVendor = event?.payload?.vendor ?? event?.vendor;
    if (eventVendor !== vendor) continue;
    const taskId = event?.payload?.taskId ?? event?.taskId;
    const task = typeof taskId === 'string' && tasks ? tasks.get(taskId) : null;
    if (task && task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') count += 1;
  }
  return count;
}

// The vendor's incarnation-local handle-registry revision: how many worker handles the
// coordinator has EVER registered for the vendor in this incarnation. `_workers` is a permanent
// Map (coordinator.mjs:4938 — handles are never deleted), so this is monotonic, vendor-scoped,
// and changes exactly when the live-seat set can change — never a clock (B3/A11).
function handleRegistryRevision(coordinator, vendor) {
  let revision = 0;
  for (const handle of coordinator?._workers?.values?.() ?? []) {
    if (handle?.vendor === vendor) revision += 1;
  }
  return revision;
}

// #218 QUEUE READ (addendum): the members waiting to dispatch on the vendor. A task is queued
// when it explicitly requested this vendor (vendorRequested === vendor — the wave member's
// vendorRequested axis, coordinator.mjs:4369) and is still pending: non-terminal and not holding
// a live in-flight seat (working/stopping/blocked, the _inFlightCount states, coordinator.mjs:3060).
// 'auto' tasks are NOT attributed — the allocator's auto pick is history-dependent and cannot be
// re-derived from route identity alone (the same honest-null discipline as the seat binding, D1.1).
// Order is the coordinator's task creation order (_taskOrder); position is the 0-based queue index.
// NOT suite-pinned (grep over both acceptance suites finds no `seat_queued`/queue read — a named
// suite gap); the surface-honesty law still pins the read in the impl (the machinery knows → the
// surface says). The queue is exposed as a NON-ENUMERABLE `seat_queued` sibling on the D1 atom so
// the closed six-key enumerable set (assertAtom, seat-telemetry) stays byte-stable.
function vendorQueue(driver, vendor) {
  const coordinator = driver?.coordinator ?? null;
  const tasks = coordinator?._tasks ?? null;
  const order = coordinator?._taskOrder ?? null;
  if (!tasks || !Array.isArray(order) || vendor === null || vendor === undefined) return Object.freeze([]);
  const queued = [];
  for (const taskId of order) {
    const task = tasks.get(taskId);
    if (!task) continue;
    if (task.vendorRequested !== vendor) continue;
    if (task.status === 'working' || task.status === 'stopping' || task.status === 'blocked') continue;
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') continue;
    queued.push(Object.freeze({ memberId: taskId, position: queued.length }));
  }
  return Object.freeze(queued);
}

/**
 * The D1 closed atom + the single-source occupancy for one readiness route, bound through the
 * allocator. Every count is null when no vendor resolves (no card to read, no dispatch could
 * have deferred, no handle registry to read a revision for); state is the static readiness
 * state, never null.
 * @param {{coordinator: object, coordination: object}} driver
 * @param {{harness: string, model: string, effort: string, state: string}} route
 * @returns {{vendor: string|null, atom: object, occupancy: object}}
 */
export function seatAtom(driver, route) {
  const vendor = seatVendor(driver, route);
  const coordinator = driver?.coordinator ?? null;
  const adapters = coordinator?._adapters ?? {};
  let inFlight = null;
  let ceiling = null;
  let deferred = null;
  let inFlightRevision = null;
  if (vendor !== null && vendor !== undefined) {
    inFlight = typeof coordinator._inFlightCount === 'function' ? coordinator._inFlightCount(vendor) : null;
    const card = typeof adapters[vendor]?.card === 'function' ? adapters[vendor].card() : null;
    ceiling = Number.isSafeInteger(card?.concurrencyCeiling) ? card.concurrencyCeiling : null;
    deferred = pendingDeferredReceiptCount(driver, vendor);
    inFlightRevision = handleRegistryRevision(coordinator, vendor);
  }
  const atom = {
    route: Object.freeze({ harness: route.harness, model: route.model, effort: route.effort }),
    state: route.state,
    inFlight,
    ceiling,
    deferred,
    inFlightRevision,
  };
  // #218: the queue rides as a non-enumerable sibling (the closed six-key set is the enumerable
  // contract; the queue is an additive read the surface must still expose).
  Object.defineProperty(atom, 'seat_queued', {
    value: vendorQueue(driver, vendor), enumerable: false, writable: false, configurable: false,
  });
  const occupancy = Object.freeze({ inFlight, concurrencyCeiling: ceiling });
  return { vendor, atom: Object.freeze(atom), occupancy };
}

// The closed honest-projection vocabulary (contract-167 D2, suite VERDICTS).
const HONEST_VERDICTS = Object.freeze(['probe-verified', 'unverified', 'failed']);

/**
 * The #167 honest projection over the projected liveness row. The row is the RouteLiveness
 * project() tuple (route-liveness.mjs:359-389): 'verified' (+expiresAt), 'unverified' (with the
 * retained verifiedAt when a window lapsed), 'failed' (+failedAt), or null/'unobserved'.
 * @param {object|null} liveness
 * @returns {{verdict: string, probedAt: string|null}}
 */
export function honestProjection(liveness) {
  if (!liveness || typeof liveness !== 'object') {
    return Object.freeze({ verdict: 'unverified', probedAt: null });
  }
  if (liveness.state === 'verified') {
    return Object.freeze({
      verdict: 'probe-verified',
      probedAt: new Date(liveness.verifiedAt).toISOString(),
    });
  }
  if (liveness.state === 'failed') {
    return Object.freeze({
      verdict: 'failed',
      probedAt: new Date(liveness.failedAt).toISOString(),
    });
  }
  // 'unverified' — never probed (null), unsupported (null), or a lapsed verified window (the
  // recorded verifiedAt is retained by project(), P-stale/V-stale).
  return Object.freeze({
    verdict: 'unverified',
    probedAt: Number.isFinite(liveness.verifiedAt)
      ? new Date(liveness.verifiedAt).toISOString() : null,
  });
}
