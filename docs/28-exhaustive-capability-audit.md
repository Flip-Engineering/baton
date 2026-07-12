# 28 — Exhaustive current capability audit

This audit supersedes the **status** layer of the 107-row Phase-10 snapshot in
`docs/handoff/evidence/capability-matrix.json`. The old file remains the historical research
inventory; it is not deleted. Current status is grounded in public assembly, coordinator and
northbound call paths, focused tests, live evidence, and explicit retirement/reopening Decisions.
Documentation prose or an exported class alone does not make a full-system feature shipped.

## Decision

**No: Baton has not yet built every intended capability in the full-system goal.** It has a real,
live-proven control/trust/northbound spine and an unusually broad executable substrate, but the
capability plane, several governance/session depths, higher trust/evaluation programs, and parts
of the production northbound/runtime remain partial or pending.

The two independent Phase 28 auditors produced complementary exhaustive matrices: a 71-row
primary A–J matrix and an 83-row expanded subfeature matrix. The primary matrix contains 26
unambiguously shipped labels, 28 partial labels, 22 pending labels, six conditionally catalogued
labels, and two explicit retirements; combined-status rows make those labels intentionally
non-exclusive. The exact row-level evidence and disagreement are retained in
`docs/reference/evidence/phase28-exhaustive-capability-audit-grok-review-2026-07-11/`.

## What is genuinely shipped

1. **Fleet control and authority:** the eight commands, ordered delivery, fences, single-consumer
   questions/approvals, two-phase stop, terminal monotonicity, task DAG/claims, worktree ownership,
   fresh verification, emergency stop, and complete in-process reap.
2. **Route specificity:** independent harness, exact model, and effort selection; visible
   requested/resolved/observed attribution; fail-closed mismatch; concurrent exact Grok routes.
3. **Trust spine:** immutable briefs, pinned verification, red→green, changed-line coverage,
   mutation, independent-family oracle, ff integration, approval-gated exact-SHA publication, and
   opt-in structured staging with post-effect poison semantics.
4. **Governance substrate:** scoped runtime homes/credentials, canonical token/USD/wall budgets,
   hard stops, deterministic watchdogs, and verified-outcome adaptive routing.
5. **Shared coordination/knowledge substrate:** operational ledger/cursors/replay, durable task and
   artifact authority, Scratch claims/facts/expiry, typed causal knowledge, bitemporal reads,
   contradiction/supersession, promotion, and contamination evidence—with no homelab dependency.
6. **Northbound:** authenticated HTTPS commands, resumable SSE, OIDC wire/bootstrap and minimal
   operator assets, edge policy/reconciliation, and MCP stdio tools over the same coordinator.
7. **Representation implementations:** R1 structural delta/rewrite proposals, R2 symbols/SCIP
   interchange, bounded R3 CPG/delta/taint/path sensitivity, bounded R5 behavioral fingerprints,
   R6 syntax-aware structured merge, plus explicit R4 and R7 Decision gates.

## What remains partial

- Automatic session rejoin, deeper fork/rewind/checkpoint parity, and vendor-specific context,
  hook, broker, extension, and reconfiguration surfaces.
- Full Claude/Codex sandbox denial parity, contamination UX, persistent router learning, operator
  pin/exclude/prefer controls, and account quota-window/fleet-seat scheduling.
- Cross-vendor review is wired, but continuous semantic review automation and structured reject
  postmortems are not.
- Structured merge is shipped with an injected Mergiraf-class boundary; a live Mergiraf binary
  proof is absent. Publication has no live remote-push proof.
- Scratch and causal knowledge primitives ship, but the full Scratch REPL/Bench and Cairn
  scorecard/promoter/export product do not.
- Atlas modules have strong ACI-shaped unit/evidence gates but are **not constructed by
  `createDriver()` and cannot be invoked through Coordinator, web, or MCP**. They are library
  surfaces, not yet fleet tools.
- OIDC has a real TLS socket proof, not an in-app browser interaction; the production provider
  adapter, WebSocket parity, deep operator takeover, and some edge-policy review depth remain.
- GLM code reaches the credential boundary but lacks a credential-backed live proof.

## What remains pending

- Trust ramp policy, plan gate, impact-selected reruns, structured reject postmortems, and higher
  Evidence Ladder rungs (property/fuzz/BMC/SMT/proof) under honest language/tool ceilings.
- Vantage, Evidence Ladder as a capability module, Skill Forge/computer use,
  Cartographer/Quartermaster, and Cairn as public ACI/coordinator tools.
- Direct structural rewrite apply, live LSP, full SSA/PDG/path solving, interprocedural/alias/heap
  CPG depth, attestation overlays, and representation choreography.
- True semantic merge, stacked integration, deploy adapters, rollback automation, and live remote
  publication.
- Streamable HTTP MCP authorization, MCP Tasks/progress/daemon supervision, WebSocket parity,
  deeper operator surfaces, and OpenTelemetry GenAI export.
- Reproducible M0/M1/E2 evaluation programs, automatic account-aware scheduling, and a production
  Go/Elixir core after executable contracts stabilize.

## Explicit Decisions and conditional research

- JS/TS R4 compiler IR/translation validation is explicitly ceiling-retired at R3. External
  LLVM/MIR/MLIR paths remain conditional on tool/language/demand evidence.
- Native whole-repo R7 e-graphs are retired; whole-function claims redirect to behavioral evidence
  plus verification; external expression/kernel work remains conditional on Phase 27 thresholds.
- True semantic merge, multi-machine/A2A, extra vendors, and remote mesh stay visible and
  conditional. They cannot weaken the single-box authority model or be silently removed.
- Homelab integration is not a capability gap for this project; adding it would violate scope.

## Dependency-ordered pursuit

1. **Make existing Atlas real fleet tools:** one capability registry and `invoke` path through
   `createDriver()`/Coordinator, then the same authenticated web/MCP authority. Preserve ACI,
   cancellation, budgets, artifact provenance, reverify, and no merge authority.
2. **Close environment/live honesty gates:** GLM credentialed smoke without key disclosure; live
   Mergiraf; real-browser OIDC; independent edge-policy review; optional safe remote-push fixture.
3. **Finish governance/session continuity:** auto-rejoin, vendor-honest fork/rewind, compaction DoD
   reinjection, quota-window/seat scheduling, route overrides, and durable router learning.
4. **Build capability modules on shared substrate:** Cartographer/Quartermaster and Cairn first,
   then Vantage, Evidence Ladder, and Skill Forge/computer use behind stronger containment.
5. **Complete northbound/runtime depth:** MCP HTTP/Tasks/daemon, WebSocket, operator takeover,
   OpenTelemetry, and only then a production-core port.
6. **Pursue representation/trust research only through its Decisions:** higher CPG/IR/semantic
   merge/e-graph gates, with measured incremental value and no proof-language inflation.
7. **Productize evals and conditional federation last:** M0/M1/E2, then multi-machine/A2A/extra
   vendors only if demand earns them.

Each item retains the earned loop: current verification → numbered contract → red tests →
implementation → adversarial review → live proof → catalog update. No “later” or “fenced” label
deletes a row.
