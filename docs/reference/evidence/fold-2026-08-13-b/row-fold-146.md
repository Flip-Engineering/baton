# ROW BRIEF — row-fold146: fold the #146 seat-telemetry contract

Read `docs/reference/evidence/fold-2026-08-13-b/foundry-brief.md` first — it binds you, INCLUDING
the blind-QA law (row report governs on conflict — the QA's §5 "SOUND with one amendment" was
written WITHOUT the row report; the row's three blockers stand and explicitly OVERTURN the
earlier contract-foundry QA's "sound"). Your material:

- Contract: `docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md` (FULL read)
- Red-team: `docs/reference/evidence/contract-foundry-2026-08-13/redteam-146.md` — **B1-B3 + A3-A6 + N1/N2, all binding** (the operator's bar: "is seat telemetry real time and accurate?" — a seats row that can disagree with the allocator is worse than none):
  - B1 (parallel vendor resolution): bind the seats to the allocator's OWN resolution
    (route-scoped `_resolveVendor` semantics, `coordinator.mjs:2953-3034` /
    `router.mjs:198-206`; `auto`-ambiguity → honest-null); pin a test that a wave member's
    dispatched vendor equals the seats row's vendor for its route.
  - B2 (two disagreeing occupancy values in one doctor response): make `#occupancyFor` the
    single occupancy source; its unmatched result becomes honest-null (not `vendor =
    route.harness` + `_inFlightCount`); pin the ripple into the doctor's non-enumerable
    occupancy + `fleet_roster`; A8 states the numeric→null change is the intended correction.
  - B3 (freshness label doesn't label the live component): add an incarnation-local
    handle-revision counter (NOT a clock) for `inFlight` freshness, or drop the overclaim
    explicitly.
  - Amendments: A3 (object-roster capacity path specified), A4 (redefine/re-teach `deferred`
    so it cannot read as "currently ceiling-waiting"), A5 (name the raw-path vendor resolver
    or pin all-null by design), A6 (single-pass deferred derivation + stated cost ceiling —
    subsumes the QA's H1), N1/N2 citation hygiene.
- QA: `docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md` §5 — the §5.4 set:
  H1 (cost/ceiling for the `deferred` ledger scan — folded via A6), ship D1's record shape /
  D2's three read surfaces (doctor primary, `waves.list` additive `capacity` block, card
  inheritance, no new MCP tool) / D3's staleness+contention honesty / observe posture as
  written, keep OQ3 (`fleet_roster` fourth-surface wiring) as the named follow-on.

Deliverables per the shared frame: the folded contract in place +
`docs/reference/evidence/contract-foundry-2026-08-13/fold-146.md` (attempt line in the FIRST
FIVE lines).
