# Phase 47 — Cairn causal integrity, contradiction resolution, and attested audit

## CA1 — deployment-pinned local authority

Cairn Rung 2 is bound to exactly one deployment `repoId` and one closed audit policy. The policy
independently caps state rows, nodes, edges, evidence references, violation samples, trace depth,
trace rows, artifact bytes, and result bytes. Generic ACI invocation carries the authenticated
repository and northbound idempotency identity; a capability context resolver cannot replace
either. The sole ACI registry binds that identity to repository, actor, action, capability,
operation, bounded input digest, budget, and terminal result in an owner-only durable record.
Identical concurrent requests coalesce, identical restart requests replay, changed requests
conflict, and an incomplete crash record requires reconciliation instead of repeating an unknown
effect. Baton uses no project-manager, homelab, network, or external graph runtime.

## CA2 — validated live and replay projection

Generic knowledge node and edge events use the same validation during append and replay. Node and
edge types are closed; endpoints and referenced evidence must already exist; coordination evidence
must precede the event; valid times must parse and form a non-negative interval. Recomputed event
tamper, missing/future edge evidence, malformed times, self-supersession, and invalid endpoint
relationships fail readiness rather than materializing a plausible graph.

## CA3 — true bitemporal views

Every node and edge projection retains observation-version history. A view at
`{observedSeq, asOf}` first selects the last version Baton had observed by that coordination
boundary, then applies valid time. A later invalidation, supersession, or contradiction resolution
cannot rewrite what an earlier observation-time query returns. Current snapshots remain the latest
projection and replay reconstructs both latest state and history byte-identically.

## CA4 — causal backbone and grounding audit

The audit independently checks the graph rather than trusting producer labels. A Decision is
causally complete only with an earlier live `Informed` source and earlier immutable evidence. A
verified Finding requires earlier production/verification/derivation lineage; a verified RouteStat
requires its earlier `ObservedIn` task and verification evidence. Model prose and confidence never
upgrade grounding. Violations are counted by axis and sampled under a separate ceiling.

## CA5 — supersession integrity

`Supersedes` requires distinct live same-type endpoints, evidence validation, target validity CAS,
non-backdated effective time, and an acyclic chain. Edge creation, target invalidation, and exact
affected-reader contamination remain one atomic append. A failed or racing append changes none of
the graph projection.

## CA6 — contradiction lifecycle

A `Contradicts` edge has one canonical unordered-pair identity, distinct live same-type endpoints,
and earlier evidence. Creation never chooses a winner. Resolution is an explicit human or
orchestrator action naming winner and loser, CAS-binding both node versions and the contradiction
edge version. One atomic append closes the edge, invalidates only the loser, and records every exact
prior reader of the loser. Racing, stale, reversed, or double resolution refuses; history remains.

## CA7 — bounded attested causal audit

`causal.audit` scans one pinned observation boundary and emits separate metrics for causal
completeness, temporal coherence, structure/orphans, grounding/lineage, contradiction state,
recall utility, and contamination. It never compresses these into an unexplained green bit. A
disposition names critical violations explicitly; a well-formed unresolved contradiction is
reported but is not silently resolved. Max+1 state refuses instead of emitting a false-green
partial audit. The canonical packet is mode 0600 and content-addressed by its full bytes.
An occupied packet is owner/mode/exact-size checked through a no-follow descriptor before bytes are
read. Cancellation is checked after the audit scan, after observation-time acquisition, immediately
before publication, and before return; a newly created packet is removed if that gate closes.

## CA8 — bounded cycle-safe trace

`causal.trace` walks only the closed causal edge set from one visible node at a caller-pinned or
current observation boundary. Stable edge/id ordering, a visited set, exact depth/row/evidence
ceilings, and explicit frontier metadata prevent cycles or truncation from masquerading as a
complete path. Output contains bounded node/edge/evidence projections, not raw operational bodies,
credentials, artifact paths, prompts, or reader identities.

## CA9 — exact ACI reverify and authority denial

Both operations run through the Coordinator-owned `cairn` ACI card and generic authenticated web
and MCP invoke/reverify paths. Reverify rebuilds from the claimed policy, repo, and coordination
boundary and compares the complete canonical claim; packet, boundary, policy, path, digest, status,
summary, payload, cost, or provenance substitution diverges. Cairn receives no worker, edit,
verification, merge, approval, publication, routing, proof, note, or policy-authoring authority.

## CA10 — gates and retained scope

Red tests cover live/replay tamper, future/missing edge evidence, invalid intervals, historical
observation views, causal lineage, supersession cycles/CAS/atomicity, contradiction pair identity
and resolution races, every independent max+1 ceiling, cyclic trace, artifact/claim tamper,
authenticated cross-repo refusal, restart determinism, and zero authority. Recursive Baton review
starts only after those gates pass and must end with fresh hub verification plus confirmed process,
worktree, branch, runtime-home, and writer-lease reaping.
Dogfood-discovered reds additionally cover ACI same-key changed-request conflict, concurrent and
restart replay, durable result binding without raw input retention, oversized occupied packets
before read, and cancellation at the publication seam.

Phase 48 bounded lexical/graph recall remains required: audit-gated ranking, contradiction bundles,
compact durable read receipts, `ReadBy`/contamination, pull-only proof, authenticated ACI reach, and
exact replay/reverify. Broader control-action/failure/Scratch promotion, Playbook/Skill promotion,
recall feedback, export, and the remaining full-system goal also remain catalogued; Phase 47 does
not retire them.

The attested packet carries a versioned, digested stable-ID catalog rather than only broad prose.
It retains authenticated northbound control; exact harness/model/effort routing; persistent
sessions; kill/reap/replay; sandbox/secrets/provenance/budgets/watchdogs; verification, mutation,
independent oracle, semantic review, integration and approval-gated publication; adaptive routing;
shared memory and recall; AST/CST, symbol/SCIP, CPG, IR and semantic-delta depth; graph-backed
representations; Vantage, Evidence Ladder, Scratch, Skill Forge/computer use,
Cartographer/Quartermaster/Cairn; semantic merge/fingerprints; e-graphs; and the deeper language,
provider, session, northbound, and runtime backlog. The project-manager influence remains the
local architectural idea of a self-contained selective typed causal graph. The catalog explicitly
forbids an external project-manager or homelab runtime dependency.
