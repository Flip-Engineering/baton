# ROW BRIEF — row-suite-146: the red-first suite for the folded #146 seat-telemetry contract

Read `foundry-brief.md` first (the suite law binds you). Your source of truth:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md` (FOLDED — the fleet seat
telemetry surface: seats bound to the ALLOCATOR'S OWN vendor resolution (route-scoped
`_resolveVendor` semantics; `auto`-ambiguity → honest-null), `#occupancyFor` as the single
occupancy source with the honest-null unmatched result, the incarnation-local handle-revision
freshness counter (NOT a clock), the bounded single-pass `deferred` derivation with a stated
cost ceiling, the three read surfaces (doctor primary, `waves.list` additive `capacity` block,
card inheritance, no new MCP tool), the observe posture). Also read `redteam-146.md` (the
allocator-disagreement attack — the pinned test: a wave member's dispatched vendor EQUALS the
seats row's vendor for its route) and `fold-146.md`.

Idioms to mirror: `impl/test/prescriptive-doctor-red.test.mjs` (doctor fixtures) and
`impl/test/wave-observability-red.test.mjs` (roster projection rows) — the load-bearing row is
the allocator-agreement pin; the rest are projection/staleness/honest-null rows.

Deliverables (edit ONLY these): `impl/test/seat-telemetry-red.test.mjs` ·
`docs/reference/evidence/contract-foundry-2026-08-13/suite-notes-146.md` (row inventory +
stage table + both measured splits + judgment calls).
