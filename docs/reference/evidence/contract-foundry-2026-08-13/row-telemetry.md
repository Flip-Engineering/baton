# ROW BRIEF — row-telemetry: contract for issue #146 (fleet seat telemetry surface)

Read `foundry-brief.md` first (the shared frame binds you). Your contract:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md`.

## The problem (verify, then contract)

The fleet's seat truth — per-route inFlight / ceiling / deferred counts — exists in the
machinery and is exposed NOWHERE. The orchestrator (and every wave driver) flies blind on
capacity until a refusal arrives. Read: `gh issue view 146`; the seat/capacity machinery
(`grep -n "inFlight\|ceiling" impl/src/coordinator.mjs | head -20` — the per-route counts;
the deferred queue); the registry/waves.list projection (`application.mjs` — the #74 D3
seat-map row that just landed); the doctor surface.

## Your contract must answer

- **D1 — the projection shape.** The closed per-route record: `{route, inFlight, ceiling,
  deferred, state}` (exact fields the contract names — verify each exists in the machinery
  or is derivable without new authority), the honesty of `null` where a count is
  unobservable, and the freshness frame (the counts are read from WHERE, replay-consistent).
- **D2 — the surfaces.** Where it reads: the deployment card? `waves list`? a doctor row?
  All three? Choose per the surface doctrine (each surface must teach it per #159), and the
  MCP tool shape.
- **D3 — the staleness + contention honesty.** The counts change under the reader; pin the
  read semantics (a point-in-time projection of durable state, labeled as such) and what
  "deferred" means exactly (the #10 capacity_ceiling vocabulary alignment).
- Refusal vocabulary + red-first acceptance pins + open questions, per the frame.
