# spec-deep finds — dropped features in the design archaeology (2026-08-06)

Role: **spec-deep** member of the docs-dive wave. Corpus: the 83+ phase dirs under `spec/`.
Method: deep-read the PARTIAL (68/86/93) and SUPERSEDED (adapter-contract, communication-channel,
driver, phase16-MCP) phases, skimmed the LANDED ones (three parallel sweeps: 8–30, 31–59, 60–92),
read the DECISION specs (24/27) to characterise "dropped by design", and cross-checked every
candidate against `impl/src/` vocabulary (grep for distinctive terms; NUL discipline observed).
The capability atlas's F1–F8 frontier and superseded-but-alive vocabulary are *not* re-reported
here — the finds below are the items the atlas digest missed.

## Ranked finds table (value-per-cost)

| # | Find | Design evidence | Impl status (cross-check) | Cost | Value |
|---|------|-----------------|---------------------------|------|-------|
| F1 | **Phase-79 workflow strategy + join expansion** (`review_revise` / `debate_synthesize` / `partition_review_integrate`; joins `all_terminal` / `all_verified` / `first_verified`) | `spec/phase79-dynamic-workflow-composition.md:53-54,72-73,408-410,417`; `docs/26-full-system-goal.md:1204` | Strategy allowlist is only `['parallel_attempts','candidate_feedback_revision']` (`impl/src/workflow-definition.mjs:214,411`); `join` locked to `'operator_selected'` (`impl/src/application-client.mjs:180-185`) | small→medium | high |
| F2 | **Production HTTPS provider-webhook route (phase 43)** | phase-43 checkpoint: "production HTTPS route assembly … still unshipped" | `coordinator.receiveProviderWebhook` (`impl/src/coordinator.mjs:10057`) + `advisory-feed-registry.verifyWebhook` (`:117`) shipped, but no HTTP route mounts them — `web-northbound.mjs` routes are `/healthz /readyz /v1/commands /v1/stream-tickets /v1/action-authority /v1/events /v1/export-downloads` + OIDC only | small | high |
| F3 | **Context `review` + deterministic `verify` operators; `context_recursive` strategy** (phases 81/84/85) | `spec/phase81-context-program-rlm.md:165-166,265-267`; `phase84:68,197,313`; `phase85:254`; `docs/26-full-system-goal.md:1227` | `context_review` / `context_verify` / `context_recursive` → grep empty; only `context_eval/retry/reduce/map` land (`impl/src/application-semantics.mjs:353,365,381,400`); `context-program.mjs:1425` makes map/reduce/review/verify require "a separately approved Workflow successor Plan" | small→medium | medium-high |
| F4 | **Positive-clearance / non-resurrection transaction (phases 39/42/43 — RI3/PI4/PI12/AF5)** | RI3: "positive clearance requires a later explicit contract"; PI12 cross-policy resurrection "remains pending"; AF5 enumerates the (sourceId, sourceEpoch, officialFactDigest) CAS design | No transaction can clear an adverse fence; `clearance:false` is permanent (`impl/src/cartographer-quartermaster.mjs:296,664,855`); old-policy Decisions close and never re-create (`impl/src/coordination-store.mjs:8139-8171`) | medium | high |
| F5 | **Opaque `runs.list` continuation (phase 89)** | `spec/phase89-authenticated-resident-application.md:66-77,347-348` (acceptance-red) | `runs.list` inputSchema is `objectSchema({}, [])` — no cursor/continuation arg (`impl/src/application-semantics.mjs:256-259`) | small | medium |
| F6 | **WP3 policy attestation through the Run surface (phase 74)** | `spec/phase74/worker-policy.md:60-62` ("next authority slice") | Attestation/mismatch array computed internally (`impl/src/worker-policy.mjs:135,147,165,249-272`) but never projected on Run outline/evidence/result/help | small | small→medium |
| F7 | **Exact `internal` reuse decision (phase 38 RD1)** | RD1: "`internal` remains catalogued but requires a later exact `reuse.internal` decision contract" | `reuse.internal` ships as search-terms only (`impl/src/cartographer-quartermaster.mjs:569-579`); `reuse_decide` accepts only `['borrow','build']` (`impl/src/web-northbound.mjs:426`) | small | medium |
| F8 | **Unified `fleet_reuse` / `fleet_provenance` orchestration (phases 41/42/43 — TA11/AF12)** | Named in three specs as the composite high-level control; never shipped | Only per-op `fleet_reuse_decide`/`fleet_reuse_recheck` exist (`impl/src/mcp-northbound.mjs:83,697,701`); no `fleet_reuse`/`fleet_provenance` composite | medium | medium-high |
| F9 | **Cross-policy Decision resurrection (phase 42 PI12)** | PI12: policy reconciliation "closes prior subjects but does not fabricate a new-policy Decision" | `knowledge.reuse_policy_reconciled` lands; a policy bump silently voids every prior borrow decision | small→medium | medium |
| F10 | **Cairn deployment-neutral knowledge-graph export (phases 40/49/52/53/56; `retainedNext`)** | PG12 "may be specified later"; retained-scope strings | Run-result artifact export exists (`/v1/export-downloads`); the causal KG export never shipped (`impl/src/cairn-run-scorecard.mjs:206` retains `deployment-neutral-export`) | medium | medium |
| F11 | **Context finish-now / deployment-owned concision & no-progress policy (phase 81 CP6)** | Phase-81 checkpoint: "a compact finish-now/synthesis intervention and deployment-owned concision/no-progress policy"; `docs/26-full-system-goal.md:1276` | No `context_finish` action in `impl/src/application-semantics.mjs` (only eval/retry/reduce/map/search/chunk/coverage) | small→medium | medium-high |
| F12 | **Card probing / version-skew defense (adapter-contract, SUPERSEDED)** | `spec/adapter-contract.md:81`: "Cards are generated by probing … version-skew defense" | Cards exist via the ACI-envelope `card()`; the probing + version-skew defense machinery never built | medium | medium |
| F13 | **Grok ACP `mcpServers` pass-through (adapter-contract)** | ACP adapter spec'd MCP-server pass-through (client tools reachable by the worker) | Hardcoded `mcpServers: []` (`impl/src/grok-acp.mjs:787-788`) — the model never sees configured MCP tools | small | medium |
| F14 | **PTY adapter tier-3 (adapter-contract.md:75-77)** | Interactive PTY attachment tier | Never built | large | medium |
| F15 | **GLM OpenCode leg (adapter-contract.md:69)** | GLM routed through an OpenCode adapter leg | Never built; GLM today arrives via the GLM-through-Claude route only | small→medium | medium |
| F16 | **GP9 deployment-approval commands (phase 62)** | `spec/phase62/goal-plan-web-authority.md:215-219`: distinct `integration_approve`/`publication_approve`/`deploy_approve`/`rollback_approve` with own policy/evidence/CAS/SoD/audit contracts | grep empty — none exist; plan approval cannot substitute | large | medium-high (fleet kernel) |
| F17 | **Versioned recall-learning / poison-decay policy (phase 52 RA8)** | RA8: "Phase 52 does not down-rank recalled nodes or implement automatic poison decay"; later versioned policy may consume evidence after min-sample + confound controls | `causal.assess_recall` collects verified pass/fail associations; `recallUtility` is a passive counter (`impl/src/coordination-store.mjs:16922`); ranking never mutated | large | medium-high |
| F18 | **`accepted_result_artifact` capsule variant (phase 85)** | `spec/phase85-context-lineage-recursive-synthesis.md:254-264` | `impl/src/context-result.mjs:140` rejects anything not `kind === 'retained_commit_projection'` — only one capsule variant ships | small | small→medium |

## Per-find details

### F1 — Phase-79 workflow strategy + join expansion (top pick)
- **WHAT**: `spec/phase79-dynamic-workflow-composition.md` defines a closed strategy grammar with
  `parallel_attempts`, `review_revise`, `debate_synthesize`, `partition_review_integrate` (:53-54)
  and four join modes `all_terminal` / `all_verified` / `first_verified` / `operator_selected`
  (:72-73). Only the `parallel_attempts` + `operator_selected` vertical (Phase 79C, :408-410) shipped.
- **WHY dropped**: spec checkpoint :417 — "First-class review, partition, synthesis,
  `debate_synthesize`, `partition_review_integrate` … remain pending". `docs/26-full-system-goal.md:1204`
  defers them to "later slices". Nothing failed — it was sequenced after the P0 vertical.
- **WHAT it would give**: multi-model independent review/debate with mechanically verified
  candidates — Baton's flagship fleet-kernel differentiator — reusing the entirely-landed Wave /
  Attempt / Candidate / gate / typed-feedback / selection / reap machinery. `join` variants are the
  natural completion semantics for the parallel engine already running.
- **SIZE**: small→medium. Admitting two more strategy strings + join modes in
  `workflow-definition.mjs` (`:214,:411`) and lifting the `join === 'operator_selected'` throw
  (`application-client.mjs:182-185`). No new engine. Verified by grep.

### F2 — Production HTTPS provider-webhook route
- **WHAT**: phase 43 built the entire adverse-provider *push* machinery — `receiveProviderWebhook`
  coordinator transaction (`coordinator.mjs:10057`), `HmacAdvisoryWebhookSource` +
  `verifyWebhook` (`advisory-feed-registry.mjs:117`), deferred-official-processing and
  full-poll-reconciliation companions — and its own checkpoint names "production HTTPS route
  assembly" as the one unshipped piece.
- **WHY dropped**: the phase checkpoint admits it; the HTTP surface (web-northbound routes
  `:1112-1393`) was never extended to mount the handler.
- **WHAT it would give**: the whole push path is currently dead from the wire — only poll works.
  One fixed endpoint (next to `/v1/action-authority`) + a card-config toggle completes a designed,
  store-backed, auth-verified pipeline.
- **SIZE**: small. Pure route assembly over shipped transactions.

### F3 — Context `review` / `verify` operators + `context_recursive`
- **WHAT**: phase 81 spec'd `review(input, role, criteria)` (independent review with route-family
  policy) and `verify(input, gate)` (approved deterministic gate); phase 84/85 kept "review,
  deterministic verify, model-backed reduce successors" as separately-visible successors. A
  `context_recursive` Workflow strategy was spec'd (one root decomposition Wave + one synthesis or
  review Wave).
- **WHY dropped**: `impl/src/context-program.mjs:1425` requires "a separately approved Workflow
  successor Plan" for map/reduce/review/verify — the gate to execution was never opened for
  review/verify; `context_recursive` never left the allowlist.
- **WHAT it would give**: verified multi-perspective synthesis on the RLM surface; extends the
  phase-92 "no false verifier verdict" posture into Context; closes phase-84's named closed list.
- **SIZE**: small→medium. `context_map`/`context_reduce`/`context_retry` and the partition→effect-call
  machinery already ship (`context-call.mjs:592-746`).

### F4 — Positive-clearance transaction (reuse dead-end)
- **WHAT**: phase 39 RI3, 42 PI4/PI12, and 43 AF5 all reserve "a later separately authorized
  positive-clearance transaction" enumerating every `(sourceId, sourceEpoch, officialFactDigest)`
  contribution. It was never built.
- **WHY dropped**: sequenced-out; the adverse-fence and policy-reconciliation halves shipped, the
  recovery half did not.
- **WHAT it would give**: today an adverse coordinate fence is permanent (`clearance:false`
  everywhere) — a stale or erroneous signal permanently blocks a coordinate, and a policy bump
  silently voids every prior borrow decision. The product's entire point is deciding `borrow` vs
  `build`; the inability to ever clear a stale observation is a genuine usability dead-end. The
  multi-source CAS design is already written in AF5.
- **SIZE**: medium. Mostly implementation + tests over the written contract.

### F5 — Opaque `runs.list` continuation
- **WHAT**: phase 89 acceptance-red item: list shape must carry a server-owned opaque
  `continuation` without caller-managed limits or hidden cardinality.
- **WHY dropped**: listed explicitly as acceptance-red in the spec checkpoint (:347-348) and never
  closed.
- **WHAT it would give**: bounded catalog reads and server-owned cardinality — a real
  security/scalability gap today. The `run.inspect` continuation machinery (`application-semantics.mjs:274-283`)
  is already there to reuse.
- **SIZE**: small.

### F6 — WP3 policy attestation projection
- **WHAT**: phase 74 named the next authority slice: "expose concise policy attestation through Run
  outline, evidence, result, and help".
- **WHY dropped**: deferred as the "next slice" after the first vertical.
- **WHAT it would give**: the containment/attestation observation and mismatch array are already
  computed (`worker-policy.mjs:135,147,165,249-272`); projecting them as a Run item is pure
  presentation and closes a real transparency gap ("what containment was actually enforced").
- **SIZE**: small.

### F7–F10 — the reuse/SCA/export cluster
- **F7 `internal` reuse decision**: the search half shipped (`reuse.internal`,
  `cartographer-quartermaster.mjs:569-579`), the decision half never did (`reuse_decide` rejects
  `choice:'internal'`, `web-northbound.mjs:426`). Small; closes a named hole.
- **F8 `fleet_reuse`/`fleet_provenance` composite**: named in three specs as the one-call
  vetting dossier; every primitive (`reuse.vet`, `provenance.sbom/plan/advisories`, `decideReuse`,
  `recheckReuseDecision`) is landed. Pure composition. Medium.
- **F9 cross-policy resurrection**: without it a policy bump silently voids prior borrow decisions
  (`coordination-store.mjs:8139-8171`). Small→medium.
- **F10 KG export**: run-result artifact export ships; the causal knowledge-graph export that
  phases 49/52/53/56 keep deferring does not (`cairn-run-scorecard.mjs:206` retains
  `deployment-neutral-export`). Medium.

### F11 — Context finish-now / concision policy
- Distinct from F3: phase 81's checkpoint explicitly establishes "the need for a compact finish-now /
  synthesis intervention and deployment-owned concision/no-progress policy", and
  `docs/26-full-system-goal.md:1276` confirms the gap. No `context_finish` action exists. Without
  it, RLM-style recursion has no disciplined termination disposition (`no_verified_progress` /
  `repeated_query_or_result`) beyond the model choosing to stop.
- **SIZE**: small→medium.

### F12–F15 — adapter-contract cluster (SUPERSEDED spec, never-built legs)
- **F12 card probing / version-skew defense** (`adapter-contract.md:81`): cards now exist via the
  ACI-envelope `card()`, but the probing + version-skew defense that makes cards trustworthy across
  adapter versions never shipped. Medium.
- **F13 Grok ACP `mcpServers` pass-through** (`grok-acp.mjs:787-788`): configured MCP servers never
  reach the Grok worker — a tool-availability gap, small.
- **F14 PTY tier-3** (`adapter-contract.md:75-77`): interactive PTY attachment. Large, and largely
  superseded by the ACP/session model — *not* a top recommendation.
- **F15 GLM OpenCode leg** (`adapter-contract.md:69`): route breadth only; GLM works today via the
  GLM-through-Claude route. Small→medium.

### F16–F18
- **F16 GP9 deployment-approval commands** (phase 62): the spec is explicit they need their own
  per-effect policy/evidence/CAS/separation-of-duty/audit contracts. Real build (large) — the
  natural completion of goal/plan approval authority, but sequence after the cheap wins.
- **F17 recall-learning/poison-decay** (phase 52 RA8): `causal.assess_recall` collects verified
  pass/fail associations that nothing consumes; `recallUtility` is a passive counter
  (`coordination-store.mjs:16922`). The most "designed-for then left unwired" mechanism in the Cairn
  ladder, but a large, versioned, contamination-sensitive build.
- **F18 `accepted_result_artifact` capsule variant** (phase 85): lets Context reduce consume accepted
  task artifacts, not just commit projections; small, but blocked on the artifact-attachment
  authority.

## Top-3 recommendations

1. **F1 — Phase-79 strategy + join expansion.** Highest leverage-per-cost in the corpus. The engine
   primitives are proven; two more strategy strings (`review_revise`, `debate_synthesize`) and the
   `all_verified`/`first_verified` joins turn the already-running parallel engine into Baton's
   stated differentiator (independent multi-model review/debate with mechanically-verified
   candidates). Small→medium, no new machinery.
2. **F2 — Production HTTPS provider-webhook route.** The smallest cost with a wire-dead pipeline on
   the other side: the entire adverse-provider push path was designed, built, and verified at the
   store/coordinator layer, then never mounted on the HTTP surface. Completing it is route assembly.
3. **F3 — Context `review`/`verify` (+ `context_recursive`).** Closes the named "remain closed"
   list of the RLM frontier (phases 81/84/85) and extends the no-false-verdict posture into Context
   — directly on the live phase 92/93 seam. Small→medium over shipped partition machinery.

Runner-up: **F4 positive-clearance transaction** — a genuine permanent-dead-end bug-shaped gap in
the reuse product, medium cost, high value. Worth doing immediately after the top three.

## Checked and rejected (skepticism, with WARNINGs)

- **Whole-repo e-graph** (`spec/phase27/egraph-evaluation.md`) — WARNING: *retired_native* by an
  explicit DECISION, not dropped by neglect; reopening gates exist (EG4). Do not resurrect without
  the stated conditions.
- **TA5 `vulnerableFunctionReachability`** (`spec/phase41`, hardcoded `'unknown'` at
  `cartographer-quartermaster.mjs:295`) — deliberately honest non-goal; the flagship SCA upgrade is
  a large research bet, not a bring-back.
- **MCP Tasks / Streamable HTTP / daemon supervision** (`docs/26-full-system-goal.md:353`, phase-62
  GP9) — *deferred to next depth*, not dropped; separate transport initiative, not a quick win.
- **Phase-79D workspace composition modes** (`application-client.mjs:183` locked `'isolated'`) —
  genuinely hard (hub-owned overlay serialization/ownership); marginal. Wait for an explicit ask.
- **Phase-59 WC5 filesystem quota** — a deployment concern, not Baton logic; the reservation ledger
  is already honest.
- **Phase-89 persisted progress-anchor index** — largely covered by the phase-90 rebuildable per-Run
  timeline index; marginal delta.

## Boundary note

Atlas-covered frontier items are deliberately **not** re-reported: phase-93 Program runtime
(93B–93F), verified OS containment (phase 86 PX5), adaptive policy derivation (phase 68), REPL
shared objects / Scratch Bench, board worker half, swarm, cross-deployment KG, attention inbox,
adaptive routing, orientation successor. The finds above are the ones the atlas digest did not list.
