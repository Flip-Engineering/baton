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
   typed pre-spawn worktree readiness failure, fresh verification, emergency stop, and complete
   in-process reap. Failed checkout creation cannot fall through to a worker turn or adapter cwd.
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
8. **Cairn Rung 0:** bounded run identity now survives direct/web/MCP spawn, task state, replay,
   handles/results, reviews/refinements, and coordinator-owned operational attribution. The
   deterministic `run.scorecard` ACI operation seals terminal runs, pins independent log tails,
   distinguishes verified from asserted completions, aggregates normalized cost/control/approval
   evidence, emits a content-addressed artifact, and atomically materializes Run/Artifact graph
   authority in one replay-safe event.
9. **Cartographer/Quartermaster local Rung 0:** `orientation.slice` and `reuse.internal` reuse one
   explicit immutable Atlas epoch plus worktree overlay through the Coordinator-owned ACI plane.
   Focused brief/map records are typed and resumable; internal reuse requires actual symbol/call/
   lexical evidence, while a miss returns only `external_vet_required`. Artifacts are confined,
   content-addressed, tamper-refusing, and exact-operation reverifiable; these local operations
   perform no network request and claim no verification or merge authority. Phase 33 adds
   `orientWorker`: exact-fence, authenticated addressed delivery over the existing serialized
   nudge lane. Capability code has no adapter authority; host paths/private provenance are stripped,
   and successful delivery is one actor-stamped `knowledge.map_served` event. Phase 34 adds an
   opt-in deployment-pinned scope-drift scheduler over immutable Brief scope and authoritative edit
   events, with per-path deduplication, one in-flight refresh, cooldown/turn ceilings, exact epoch
   and fence, stop-race refusal, and distinct mechanical outcome events. Kill remains the default.
10. **Quartermaster external evidence floor:** deployment-configured `reuse.vet` accepts only exact
   npm coordinates and combines exact Atlas import observation with bounded deps.dev/OSV evidence.
   Raw source bytes and normalized dossiers are content-addressed; TTL/cache/explicit-refresh and
   snapshot reverify fail closed; known advisories are never waived by incomplete reachability.
   It recommends only candidate/block/pending and has no install, decision, knowledge, verification,
   or merge authority.
11. **Exact-lockfile SBOM floor:** deployment-configured `provenance.sbom` turns a confined npm
   package-lock v3 into a deterministic CycloneDX 1.6 inventory and dependency graph. Components,
   integrity, dev/optional flags, nested resolution, and unresolved edges are actual-lockfile
   grounded; proposed registry graphs remain explicitly absent. It is content-addressed and
   reverifiable, with no mutation, advisory, decision, or promotion authority.
12. **Immutable reuse decision and causal promotion:** a deployment-authorized Coordinator path
   freshly reverifies the exact dossier and actual-lockfile SBOM, binds them to one configured repo,
   clean Git tree, Atlas effective overlay, lockfile digest, actor, need, exact coordinate, and policy,
   and records `borrow|build` only. One replay-validated `knowledge.reuse_decided` event materializes
   fleet evidence/decision artifacts, derived Findings, an actor-observed Decision, `Informed` and
   provenance edges, plus optional CAS `Supersedes` and affected-reader contamination. Blocked
   evidence cannot authorize borrow. Exact direct retry performs no second reverify; authenticated
   web and `fleet_reuse_decide` preserve actor/repo/idempotency. There is no install, mutation,
   merge, policy override, publication, PM export, or homelab integration.
13. **Advisory refresh guard and TTL invalidation:** separate Coordinator recheck authority accepts
   only an exact decision/version and closed trigger. TTL is hidden at exact expiry before the
   durable no-network closure. Advisory mode internally forces official refresh and reverification;
   an adverse observation atomically fences the exact coordinate, invalidates every matching stale
   Decision/dossier Finding, records affected readers, and projects a derived risk Finding plus
   `Affects` edges. A green check cannot clear the fence. Web and the twelfth MCP tool carry derived
   actor/repo/idempotency with no caller-supplied evidence or package authority.
14. **Proposed npm install graph and actual delta:** deployment-configured `provenance.plan`
   resolves one exact npm coordinate from immutable actual lockfile/manifest bytes without
   installing it. Measured macOS Seatbelt confines writes to a disposable root and denies direct
   network; an exact-authority loopback CONNECT proxy is the only registry route. Closed dependency
   specs, fixed argv, bounded output/deadline, marker-based subtree reconciliation, PID-start-bound
   lease, supervisor-verified receipt, separate proposed lock/SBOM/receipt/delta artifacts, and
   offline reverify fail closed. Authenticated web/MCP reach the same Coordinator-owned operation.
   The live official npm proof observes no source mutation or install. This is not a reuse decision,
   transitive advisory scan, reachability proof, provenance verdict, merge, or homelab integration.
15. **Transitive advisory projection:** Phase 41 scans every exact-input npm component in separately
   grounded actual or proposed graphs through fixed official OSV QueryBatch semantics, binds private
   scan-session/request/response evidence, retains typed dependency-path and supported-static-import
   attention, and permanently leaves vulnerable-function reachability unknown. It grants no waiver,
   clearance, decision, or mutation authority.
16. **Reuse policy-epoch reconciliation:** Phase 42 derives the only active policy identity from the
   deployment-pinned Quartermaster card and reconciles it synchronously under exclusive writer
   ownership. One bounded replay-validated event closes all mismatched Decisions and Findings,
   contaminates exact readers, preserves old adverse fences as stale-but-blocking, binds legacy
   matching Decisions, and projects local Constraint supersession/affect/informing lineage. Green
   migration never clears inherited adverse state; authenticated web/MCP replay reports current
   versus historical without accepting policy inputs. No provider request, policy authoring,
   positive clearance, external knowledge-graph runtime, project-manager export, or homelab
   integration is introduced.

## What remains partial

- Automatic session rejoin, deeper fork/rewind/checkpoint parity, and vendor-specific context,
  hook, broker, extension, and reconfiguration surfaces.
- Full Claude/Codex sandbox denial parity, contamination UX, persistent router learning, operator
  pin/exclude/prefer controls, and account quota-window/fleet-seat scheduling.
- Cross-vendor review is wired, but continuous semantic review automation and structured reject
  postmortems are not.
- Structured merge is shipped with an injected Mergiraf-class boundary; a live Mergiraf binary
  proof is absent. Publication has no live remote-push proof.
- Scratch and causal knowledge primitives ship. Cairn Rung 0's scorecard/promoter now ships;
  Scratch REPL/Bench and Cairn RouteStats/route advice, causal audit/recall, contradiction UX,
  and optional deployment-neutral export remain partial or pending.
- Phase 29 closes the former Atlas wiring gap: deployments inject a closed set of real Atlas
  instances, bounds, artifact roots, and optional trusted multi-root contexts into `createDriver()`;
  Coordinator owns the sole registry handle, and authenticated web/MCP reuse that invoke/resume/
  reverify path. Atlas is not auto-registered, so an empty deployment remains honestly empty.
- OIDC has a real TLS socket proof, not an in-app browser interaction; the production provider
  adapter, WebSocket parity, deep operator takeover, and some edge-policy review depth remain.
- Phase 30 closes the GLM credential-backed live gate: exact `glm-4.7` at native `low` effort was
  provider-observed, freshly verified, killed, and fully reaped through the public driver. Concurrent
  GLM-seat and automatic quota discovery remain unproven.
- Phase 32 closes the local orientation/reuse wiring gap, Phase 33 closes addressed downward
  worker push, Phase 34 closes bounded mechanical scope-drift refresh, and Phase 36 closes the
  exact-npm external evidence/freshness floor. Phase 37 adds the actual npm lockfile SBOM floor,
  Phase 38 closes the external `borrow|build` decision plus local causal-promotion transaction, and
  Phase 39 closes pull-to-refresh advisory fencing plus exact TTL invalidation, and Phase 40 closes
  the npm proposed-vs-actual graph delta under an isolated resolver supervisor. Phase 41 is now
  shipped as read-only exact-input transitive advisory projection plus conservative dependency/
  import attention evidence. Phase 42 closes deployment-card-derived policy-epoch reconciliation,
  bounded atomic fan-out, non-clearing adverse-guard migration, and exclusive writer ownership. The
  authoritative pending ledger in `docs/capabilities/orientation-reuse.md` retains provider
  push/feed, positive clearance, exact `internal` decisions, plan approval/binding, trusted
  advisory-symbol identity and true vulnerability reachability, independent provenance, additional
  ecosystems, Socket/full-SCA enrichment, composite `fleet_reuse`/`fleet_provenance`, and optional
  export as distinct later contracts.

## What remains pending

- Trust ramp policy, plan gate, impact-selected reruns, structured reject postmortems, and higher
  Evidence Ladder rungs (property/fuzz/BMC/SMT/proof) under honest language/tool ceilings.
- Vantage, Evidence Ladder as a capability module, Skill Forge/computer use, later
  Cartographer/Quartermaster supply/orientation rungs, and Cairn Rungs 1–4 remain pending.
- Direct structural rewrite apply, live LSP, full SSA/PDG/path solving, interprocedural/alias/heap
  CPG depth, attestation overlays, and representation choreography.
- True semantic merge, stacked integration, deploy adapters, rollback automation, and live remote
  publication.
- Streamable HTTP MCP authorization, MCP Tasks/progress/daemon supervision, WebSocket parity,
  deeper operator surfaces, and OpenTelemetry GenAI export.
- Reproducible M0/M1/E2 evaluation programs, automatic account-aware scheduling, and a production
  Go/Elixir core after executable contracts stabilize.
- Provider-terminal lump usage can cross nominal token/USD ceilings before Baton receives telemetry;
  preauthorization/headroom and post-overrun artifact-admission policy remain explicit governance
  work. Provider-native budget flags are not treated as hard until live evidence proves enforcement.

## Explicit Decisions and conditional research

- JS/TS R4 compiler IR/translation validation is explicitly ceiling-retired at R3. External
  LLVM/MIR/MLIR paths remain conditional on tool/language/demand evidence.
- Native whole-repo R7 e-graphs are retired; whole-function claims redirect to behavioral evidence
  plus verification; external expression/kernel work remains conditional on Phase 27 thresholds.
- True semantic merge, multi-machine/A2A, extra vendors, and remote mesh stay visible and
  conditional. They cannot weaken the single-box authority model or be silently removed.
- Homelab integration is not a capability gap for this project; adding it would violate scope.

## Dependency-ordered pursuit

1. **Make existing Atlas real fleet tools — shipped in Phase 29:** one Coordinator-owned registry,
   deployment-bounded ACI invoke/resume/reverify, real multi-root Atlas traversal, and authenticated
   web/MCP authority with no verification/merge authority.
2. **Close environment/live honesty gates:** GLM credentialed smoke without key disclosure shipped
   in Phase 30; live Mergiraf, real-browser OIDC, independent edge-policy review, and an optional
   safe remote-push fixture remain.
3. **Finish governance/session continuity:** auto-rejoin, vendor-honest fork/rewind, compaction DoD
   reinjection, quota-window/seat scheduling, route overrides, and durable router learning.
4. **Build capability modules on shared substrate:** Cairn Rung 0 shipped in Phase 31 and
   Cartographer/Quartermaster local Rung 0 shipped in Phase 32, addressed push in Phase 33, and
   bounded scope-drift refresh in Phase 34, external evidence in Phase 36, exact SBOM in Phase 37,
   immutable external reuse decision/promotion in Phase 38, advisory/TTL invalidation in Phase 39,
   the isolated proposed npm graph/delta in Phase 40, transitive advisory projection in Phase 41,
   and policy-epoch reconciliation in Phase 42. Phase 43 now has its first provider receipt,
   semantic-processing, observed-Source, machine-ingress, and store-serialized pending-admission
   foundation; native HTTP authentication/private CAS, official refresh, seedless monotonic adverse
   union/fan-out, cursor/poll lifecycle, bounded read surfaces, and the full live matrix remain.
   Continue the remaining explicitly
   catalogued later rungs, then demand-earned Cairn Rungs 1–4, Vantage, Evidence Ladder, and Skill
   Forge/computer use behind stronger containment.
5. **Complete northbound/runtime depth:** MCP HTTP/Tasks/daemon, WebSocket, operator takeover,
   OpenTelemetry, and only then a production-core port.
6. **Pursue representation/trust research only through its Decisions:** higher CPG/IR/semantic
   merge/e-graph gates, with measured incremental value and no proof-language inflation.
7. **Productize evals and conditional federation last:** M0/M1/E2, then multi-machine/A2A/extra
   vendors only if demand earns them.

Each item retains the earned loop: current verification → numbered contract → red tests →
implementation → adversarial review → live proof → catalog update. No “later” or “fenced” label
deletes a row.
