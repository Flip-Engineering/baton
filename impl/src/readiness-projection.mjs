// readiness-projection.mjs — the #146/#167/#218 seat + verdict projection authority.
//
// ONE projection module backs every seat-bearing read surface on the deployment class
// (application-deployment.mjs): the doctor `seats` array (contract-146 D1/D2.1), the
// occupancy sibling (D2.1/B2 — occupancy and seats are the SAME source, never two), the
// replay-consistent `observedAtEventSeq` label (D3/B3), the per-vendor `inFlightRevision`
// counter (B3 — a handle-revision counter, never a clock), and the #218 queue read
// (`seat_queued` with member ids + queue position — the surface honesty law: the machinery
// knows → the surface says).
//
// ALLOCATOR BINDING LAW (contract-146 D1.1/B1, LOAD-BEARING): the live counts read the
// ALLOCATOR's candidate set — every adapter whose card passes the coordinator's auto path
// (resolveCardModel + resolveEffort; the `{mode: 'new'}` session gate always passes,
// coordinator.mjs cardSupportsSession) — NOT `adapterFor` (route-liveness.mjs), which gates
// on `turnCompletion: 'pausable'`. A non-pausable MockAdapter is invisible to `adapterFor`
// while the allocator still dispatches it, so only this binding can match the allocator's
// counts. Exactly ONE eligible candidate → that vendor's counts; ZERO or >1 → honest-null
// (the router's pick is load/adaptive history, unpredictable from route identity alone —
// a saturated route also reads null: the allocator would dispatch nothing).
//
// NO-CLOCK LAW: every freshness label here is either a ledger event seq
// (observedAtEventSeq) or an incarnation-local counter (inFlightRevision). Wall time is
// never a control and never a freshness label on this surface.

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The allocator's auto candidate set for a route (contract-146 D1.1): every adapter whose
 * card passes resolveCardModel + resolveEffort. Mirrors the coordinator's auto path
 * (_resolveVendor's candidate construction), not routeMatches — no pausable gate, no
 * harness identity gate: the vendor IS the selection axis the router picks. */
function eligibleAutoVendors(adapters, route) {
  const names = [];
  for (const [name, adapter] of Object.entries(adapters ?? {})) {
    const selection = plainObject(adapter?.card?.()) ? adapter.card().modelSelection : null;
    if (selection?.mode !== 'exact') continue;
    const modelOk = Array.isArray(selection.available)
      ? selection.available.includes(route.model)
      : selection.configuredDefault === route.model
        || (Array.isArray(selection.acceptedAliases) && selection.acceptedAliases.includes(route.model))
        || (Array.isArray(selection.acceptedPrefixes)
          && selection.acceptedPrefixes.some((prefix) => route.model.startsWith(prefix)));
    const effortOk = Array.isArray(selection.reasoningEffort)
      && selection.reasoningEffort.includes(route.effort);
    if (modelOk && effortOk) names.push(name);
  }
  return names;
}

/** The #167 honest verdict projection (contract-167 D2): the enumerable
 * {verdict, probedAt} pair every wire surface re-adds. verdict ∈ 'probe-verified' |
 * 'unverified' | 'failed'; probedAt is the RECORDED measurement (the liveness row's
 * verifiedAt/failedAt as ISO-8601) or null — content-derived, never a TTL guess, never
 * cleared when a verified window lapses (the staleness law: lapsed reads unverified with
 * the last measurement retained). */
function honestVerdict(liveness) {
  const row = plainObject(liveness) ? liveness : null;
  if (row?.state === 'verified') {
    return Object.freeze({ verdict: 'probe-verified', probedAt: isoOf(row.verifiedAt) });
  }
  if (row?.state === 'failed') {
    return Object.freeze({ verdict: 'failed', probedAt: isoOf(row.failedAt) });
  }
  // unverified — but a lapsed verified window retains its recorded measurement (OQ5).
  return Object.freeze({ verdict: 'unverified', probedAt: isoOf(row?.verifiedAt) });
}

function isoOf(epochMs) {
  return Number.isSafeInteger(epochMs) ? new Date(epochMs).toISOString() : null;
}

/** The seat/queue projection. One instance per deployment — the incarnation boundary for
 * the per-vendor revision counters (a new deployment reads fresh counters, never a stale
 * cross-incarnation value). */
function createReadinessProjection({ adapters = {}, driver = null, inFlightCount = null } = {}) {
  const coordinator = driver?.coordinator ?? null;
  const coordination = driver?.coordination ?? null;
  // The live seat count reader: the coordinator's own `_inFlightCount` (working|stopping|
  // blocked handles on the vendor, coordinator.mjs) — injectable so the deployment hands its
  // reader down explicitly (RT-7's source pin: occupancy derives from _inFlightCount).
  const countInFlight = typeof inFlightCount === 'function' ? inFlightCount
    : (vendor) => (typeof coordinator?._inFlightCount === 'function'
      ? coordinator._inFlightCount(vendor) : 0);
  // inFlightRevision: the vendor's incarnation-local handle-revision counter (B3). Bumps
  // when the observed live count changes; stable across reads that observe the same count
  // (so the doctor and the card compose byte-identical atoms). NEVER a clock.
  const revisions = new Map();
  // The #218 queue ledger, derived incrementally from the coordination event log: a
  // task.dispatch_deferred receipt (issue #10 D5 Arm 1) marks a seat-queued member; the
  // claim (task.claimed) or any lifecycle transition ends its queue membership. Derived
  // per-read from the pending-with-receipt set — never the receipt's mint-time-frozen
  // inFlight. Since operator ruling #221 removed the ceiling pre-cap, nothing mints these
  // receipts at HEAD and the honest queue is empty; the read stays correct by
  // construction for any future minting authority.
  const queueState = { lastSeq: 0, receipts: new Map(), members: new Map() };

  function inFlightFor(vendor) {
    return countInFlight(vendor);
  }

  function revisionFor(vendor, inFlight) {
    const entry = revisions.get(vendor);
    if (!entry) {
      revisions.set(vendor, { value: 0, lastInFlight: inFlight });
      return 0;
    }
    if (entry.lastInFlight !== inFlight) {
      entry.value += 1;
      entry.lastInFlight = inFlight;
    }
    return entry.value;
  }

  function refreshQueue() {
    if (!coordination || typeof coordination.eventsView !== 'function') return;
    const head = coordination.ledgerHeadSeq();
    if (!Number.isSafeInteger(head) || head <= queueState.lastSeq) return;
    for (const event of coordination.eventsView(queueState.lastSeq + 1)) {
      const seq = Number.isSafeInteger(event?.seq) ? event.seq : queueState.lastSeq + 1;
      const payload = plainObject(event?.payload) ? event.payload : null;
      if (event?.kind === 'task.created' && typeof payload?.id === 'string') {
        queueState.members.set(payload.id, {
          memberId: typeof payload.runId === 'string' ? payload.runId : payload.id,
        });
      } else if (event?.kind === 'task.dispatch_deferred'
        && typeof payload?.taskId === 'string' && typeof payload?.vendor === 'string') {
        queueState.receipts.set(payload.taskId, { vendor: payload.vendor, seq });
      } else if (event?.kind === 'task.claimed' || event?.kind === 'task.transitioned') {
        // A claimed task left the queue (drop-by-one by construction); a transitioned task
        // is no longer pending-with-receipt. Judgment call (suite-notes §4): a terminal
        // transition ends queue membership — the count is "still-pending", not
        // "ever-deferred"; the ledger receipt itself always persists as evidence.
        if (typeof payload?.id === 'string') {
          queueState.receipts.delete(payload.id);
          queueState.members.delete(payload.id);
        }
      }
      queueState.lastSeq = Math.max(queueState.lastSeq, seq);
    }
    queueState.lastSeq = Math.max(queueState.lastSeq, head);
  }

  function queueFor(vendor) {
    const queued = [];
    for (const [taskId, receipt] of queueState.receipts) {
      if (receipt.vendor !== vendor) continue;
      const member = queueState.members.get(taskId);
      queued.push({
        memberId: member?.memberId ?? taskId,
        position: 0,
        taskId,
        deferredAtEventSeq: receipt.seq,
      });
    }
    queued.sort((left, right) => left.deferredAtEventSeq - right.deferredAtEventSeq);
    queued.forEach((entry, index) => { entry.position = index + 1; });
    return Object.freeze(queued.map((entry) => Object.freeze(entry)));
  }

  /** The closed D1 seat atom (contract-146): exactly
   * {ceiling, deferred, inFlight, inFlightRevision, route, state}. `routeRow` is the
   * readiness row (its state is the static readiness — never a liveness probe). */
  function seatFor(routeRow) {
    const route = Object.freeze({
      harness: routeRow.harness,
      model: routeRow.model,
      effort: routeRow.effort,
    });
    const vendors = eligibleAutoVendors(adapters, routeRow);
    if (vendors.length !== 1) {
      // 0 eligible (unrouted/saturated) or >1 (auto-ambiguous): honest-null on every live
      // component — never a fabricated number (D1.2 honesty table). state is never null.
      return Object.freeze({
        ceiling: null,
        deferred: null,
        inFlight: null,
        inFlightRevision: null,
        route,
        state: typeof routeRow.state === 'string' ? routeRow.state : 'blocked',
      });
    }
    const vendor = vendors[0];
    const card = plainObject(adapters[vendor]?.card?.()) ? adapters[vendor].card() : null;
    const ceiling = Number.isSafeInteger(card?.concurrencyCeiling) ? card.concurrencyCeiling : null;
    const inFlight = inFlightFor(vendor);
    refreshQueue();
    const deferred = queueFor(vendor).length;
    return Object.freeze({
      ceiling,
      deferred,
      inFlight,
      inFlightRevision: revisionFor(vendor, inFlight),
      route,
      state: typeof routeRow.state === 'string' ? routeRow.state : 'blocked',
    });
  }

  /** The occupancy sibling (D2.1/B2): THE SAME SOURCE as the seat atom — occupancy is the
   * seat projection read as a sibling, never an independent count that can drift. */
  function occupancyFor(routeRow) {
    const seat = seatFor(routeRow);
    return Object.freeze({ inFlight: seat.inFlight, concurrencyCeiling: seat.ceiling });
  }

  /** The replay-consistent freshness label (D3/B3): a ledger event seq, never wall time. */
  function observedAtEventSeq() {
    return typeof coordination?.ledgerHeadSeq === 'function'
      ? coordination.ledgerHeadSeq() : null;
  }

  /** The #218 queue read — `seat_queued` with member ids + queue position, per vendor.
   * Surfaced as the non-enumerable `seatQueue` sibling on seat-bearing reads: the D1 atom
   * key set is CLOSED by contract, so the queue lands as its named sibling surface (the
   * suites do not pin this read — recorded as a suite gap; the surface honesty law pins
   * it here instead). */
  function seatQueue() {
    refreshQueue();
    const byVendor = new Map();
    for (const [taskId, receipt] of queueState.receipts) {
      if (!byVendor.has(receipt.vendor)) byVendor.set(receipt.vendor, []);
      byVendor.get(receipt.vendor).push(taskId);
    }
    const rows = [];
    for (const [vendor] of byVendor) {
      const card = plainObject(adapters[vendor]?.card?.()) ? adapters[vendor].card() : null;
      rows.push(Object.freeze({
        vendor,
        inFlight: inFlightFor(vendor),
        ceiling: Number.isSafeInteger(card?.concurrencyCeiling) ? card.concurrencyCeiling : null,
        seatQueued: queueFor(vendor),
      }));
    }
    return Object.freeze(rows);
  }

  return Object.freeze({ seatFor, occupancyFor, observedAtEventSeq, seatQueue });
}

export { createReadinessProjection, eligibleAutoVendors, honestVerdict };
