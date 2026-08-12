# Issue #70 — cross-deployment knowledge: one project, many deployment roots

The implementation contract for issue #70: every deployment root carries its own KG; a
project spanning deployments starts knowledge-poor every time. It specifies behavior; it does
not amend implementation in this artifact. It is a Ring-2 contract (ground truths → decisions →
refusal vocabulary → red-first acceptance → open questions). It cross-references — it does not
re-specify — #24-27 (the Cairn KG + promotion taxonomy / KG-1..4), #63 (the KG settlement
ritual), #68 (the BD3-A read port), #69 (the REPL realization tiers), #132 (the wave
observability liveness honesty), and the PKG-1 descriptor (the declarative deployment
descriptor seam).

- **Date:** 2026-08-07 (folded to v1.1 2026-08-12)
- **Status:** DRAFT v1.1 — implementation contract (v1.0 folded per the #70 red-team report;
  see `contract-fold.md` in this directory for the blocker → change map, all 8 blockers + the
  two fold-blocking OQ verdicts)
- **Verification HEAD:** `79a782630c2f31bdd575e536c00cdadb0314fb07` ("Baton private
  effective-tree snapshot"), the tree this v1.1 draft was verified against. Every `file:line`
  citation below was re-verified with `grep -an`/`sed -n` at this HEAD, unless explicitly
  marked spec-referenced (a cross-contract pin, not a working-tree read). The six NUL-bearing
  files whose anchors are grep/sed-verified, never whole-file reads:
  `coordination-store.mjs`, `coordinator.mjs`, `application-semantics.mjs`,
  `application-deployment.mjs`, `index.mjs`, `resident-authority.mjs` — `application.mjs`
  measures 0 NUL bytes and is read with plain `grep`/`sed`. The v1.0 verification HEAD
  `1637ae58dbcf5ac9a188366ec484c629baff4171` and the red-team's HEAD
  `90d997c6372a2ef16113555dcb46a7ba2cff40a9` are each **not an ancestor** of this fold target
  (the fold worktree carries #105 D4-accessor content); all six `coordinator.mjs` anchors were
  re-derived at `79a7826` (deltas in `contract-fold.md`).
- **Brief:** `contract-70-brief.md` (same dir) — read fully; the issue body (`gh issue view 70`)
  could not be fetched (`gh` is not authenticated in this worktree — the same constraint the
  #105 and #69 contracts record). The requirements are carried by the brief and the read-order
  below.
- **Read-order executed.** (1) this brief; (2) the lived deployment sprawl — `.baton/` at fold
  HEAD holds **72** `taskwave-*` roots (a runtime snapshot that grows per wave attempt),
  one per wave attempt (`deploymentRoot: resolve(repo, '.baton',
  \`taskwave-${ROLE}-${SALT}\`)`, `run-task-wave.mjs:70`), each with its own
  `state/coordination/events.jsonl` ledger (`index.mjs:1238`, `application-deployment.mjs:1761`),
  all sharing ONE `repoId` (`repo-` + sha256 of the git common dir, `application-deployment.mjs:175`)
  and each carrying a distinct `deploymentId` (`resident-authority.mjs:115-130`); (3) the KG
  machinery — the Cairn graph + promotion taxonomy (`coordination-store.mjs` knowledge folds),
  the #63 settlement ritual (`kg-settlement-decisions.md`), `knowledge.recall`/`knowledge.horizon`
  (`application-semantics.mjs` rows), the promotion event shape (content-addressed + replayable);
  (4) the #132 wave-observability contract v1.2 (LANDED — the wave registry fold at
  `coordination-store.mjs:8099-8127`, `wave.closed` at :8793-8810, `waves.list` at
  `application.mjs:11711`) and the #69 REPL-realization contract v1.1 (the tier law, D4); (5) the
  PKG-1 descriptor seam (`mcp-packaging-decisions.md:88-117`).

Scope of the rung, in one sentence: **the project-persistent tier stops being per-root-local
by construction — the PKG-1 descriptor names a designated project-primary root, promotion into
the project KG is primary-only (the single-writer lease law made visible, wired to EVERY
promotion path), every other root PROJECTS the primary's promotion events as a read-only,
event-seq-anchored replica, and every project answer — including a self-declared primary's own —
names its source root + epoch lag, UNTRUSTED-framed, never an authority input.**

---

## Ground truths (code-verified)

**GT1 — The KG is per-deployment private, and every deployment of one repo shares a single
`repoId`.** The coordination store is created at `join(opts.logDir, 'coordination')`
(`index.mjs:1238`), where `logDir = stateRoot = privateDirectory(join(deploymentRoot, 'state'))`
(`application-deployment.mjs:1761`); the default deployment root is
`join(repository.common, 'baton', 'application-v3')` (`application-deployment.mjs:1759-1760`).
The repository identity is `repoId = 'repo-' + sha256(git-common-dir)` (`application-deployment.mjs:175`);
the resident identity is a stable `deploymentId = 'deployment-' + uuid` written once to
`deploymentRoot/resident/deployment.json` (`resident-authority.mjs:115-130`; the constructor
reads it back at `:264`). Verified in `.baton/` at fold HEAD: 4 sampled `taskwave-*` resident
`deployment.json` files all carry the SAME `repoId`
(`repo-76d484205f22eed0163d8f21b8287740`) and DISTINCT `deploymentId`s. So docs/34's
"project horizon (persistent): the Cairn KG, repoId-scoped, durable across runs" (`docs/34:53`)
is in practice **deployment-scoped**: the KG lives in the per-deployment private store, and a
project spanning deployment roots has no shared KG by construction. (v1.0 cited `docs/34:52`;
the quote is at `:53` — blocker 7.)

**GT2 — Every knowledge read is deployment-bounded; no cross-root read exists.** `readKnowledge`
(`coordination-store.mjs:16997`) reads `this.queryKnowledge(...)` — THIS store's
`_knowledgeNodeHistory` — and appends a `knowledge.read` event to THIS store's ledger (the
`UNTRUSTED_RECALLED_MEMORY` frame, `coordination-store.mjs:17005,17011`). `recallKnowledge`
(`coordinator.mjs:10486`) is a thin wrapper calling `this._coordination.readKnowledge(...)`.
`projectHorizon(repoId)` (`coordinator.mjs:11755`) reads `this._coordination.queryKnowledge({})`
— the same store. `serveKnowledge` (the KG-3 ambient slice, `coordinator.mjs:10513`) reads
`this._coordination.queryKnowledge({ types: ['Finding'] })`. None of these can see a node
promoted in a different deployment root. The campaign witness is direct: the
`knowledge.promoted` event in `taskwave-contract-69-*`'s `events.jsonl` is invisible to
`taskwave-contract-70-*`'s store.

**GT3 — Promotion events are content-addressed and replayable — replication is a projection,
never a merge.** The project-KG folds in `_apply` — `knowledge.promotion_batch`
(`coordination-store.mjs:8523`), `knowledge.scratch_corrected` (:8527), `knowledge.workflow_admitted`
(:8536), `knowledge.node_added` / `knowledge.promoted` (:8543), `knowledge.edge_added` (:8554) —
each set/derive a node or edge carrying `observedSeq` (= the event's own seq), `validFrom`,
`validTo`, `validityVersion`, and the event's `idempotencyKey`. The temporal anchor is
`eventTime(events, evidence, fallback)` (`coordination-store.mjs:410`): `eventTimeSeq` is the
MINIMUM `coordinationSeq` in the node's evidence refs, `eventTime` is `events[seq-1].ts` —
**event-seq anchored, never a wall-clock claim**. The graph's live state is a canonical digest
(`knowledgeContentDigest()`, `coordination-store.mjs:17031`), and `queryKnowledge` is a bounded,
event-seq-parameterized read sorted by canonical strings (`coordination-store.mjs:16686`). A
consumer that replays the same promotion events derives the identical graph — replay-exact, no
merge conflicts, no two-writer problem. **Within the primary store** this is exact (replaying the
primary's ledger into a fresh primary store derives the identical graph); **across** roots it is
the law D1.2 pins (blocker 3) — the existing `_apply` folds cannot replay foreign-seq evidence,
so the projection is a separate read-only structure, never `_apply`.

**GT4 — The single-writer lease law holds per root.** `claimWriterLease`
(`coordination-store.mjs:1289`) — one writer per store root; a second claim refuses
`coordination_writer_busy`. Two deployments cannot write one store. This is why a "shared
knowledge root" cannot be a store every deployment writes; the coherent shape is ONE primary
writer and read-only projection consumers.

**GT5 — #132's cross-deployment liveness honesty LANDED and is the composition precedent.** The
wave registry fold consumes `wave.started` and stores the member rows with
`deploymentId: p.deploymentId ?? null` read straight off the payload (`coordination-store.mjs:8122`)
— there is NO ingestion-time "drop a foreign deploymentId" (v1.0's claim; corrected — blocker
fold in GT6/D5's contrast). The defense is topological: the registry fold lives in the
per-deployment PRIVATE store, so a foreign deployment's rows never arrive in the first place.
`wave.closed` folds at top level (:8793-8810); `waves.list` reads `liveness: 'local'` for every
row by construction and renders legacy members honestly (`application.mjs:11711`); `remote`/`stale`
are explicitly deferred with the honesty rule pinned (`wave-observability-contract.md` D3). The
knowledge-side equivalent of that posture — a projected answer names its source + epoch, never
fabricates liveness from a git-ref or a digest — is what this contract composes with. The wave
fold's payload-read `deploymentId` habit is exactly the precedent the D5 `sourceRoot` provenance
pin must NOT follow (blocker fold in D5): identity is read from the primary's
`resident/deployment.json` at projection build, never off a replayed event.

**GT6 — The #63 settlement ritual is ONE of THREE promotion/materialization paths.** The full
set (each verified at HEAD):
`admitWorkflowFinding` (`coordination-store.mjs:16207`; coordinator wrapper
`coordinator.mjs:11428`) is the #63 orchestrator-admit gate, session-bound to the settlement
lease (`kg-settlement-decisions.md` D2), emitting `knowledge.workflow_admitted`; the
verified-task-outcome auto-promotion is `promoteKnowledgeNode` (`coordination-store.mjs:16303`),
called at `coordinator.mjs:13229` (the verify flow) and `coordinator.mjs:6556`, emitting
`knowledge.promoted`; the run-scoped knowledge seed is `addKnowledgeNode`
(`coordination-store.mjs:16283`), called at `application.mjs:13197` (`run.knowledge.seed`),
emitting `knowledge.node_added`. `promoteKnowledgeNode` and `addKnowledgeNode` are in the
coordinator's mutator allowlist (`COORDINATION_MUTATORS`, `coordinator.mjs:261-281`, both at
`:266`); each constructs the payload, runs `_validateKnowledgeNodePayload`, and appends to the
store's own ledger **unconditionally — no primary check exists at HEAD**, and the field that
would trigger one does not. (v1.0's "There is no second promotion path" is false — blocker 1.)
Candidacy is materialized as local board items; the #63 admission reviews LOCAL store evidence
only (`kg-settlement-decisions.md` D3 step 3).

**GT7 — The #69 tier law is the boundary vocabulary.** #69 D4 pins three tiers: task-ephemeral
(`worker:<workerId>`), workflow-ephemeral (`shared`), project-persistent (a KG node — reached by
`knowledge.recall`, NEVER a `repl:` citation) (`repl-realization-contract.md` D4). The #70
boundary is the same law applied across deployment roots: only the project-persistent tier
crosses roots.

**GT8 — The PKG-1 descriptor is closed and pinned at open.** `baton-mcp <descriptor.json>`:
bounded closed JSON `{repo, deploymentRoot, routes, surface, principal, quotas}`, file credential
refs repo-relative AND containment-checked (no symlinks out), read once at startup and immutable
for the server's life (`mcp-packaging-decisions.md:88-117`; the containment rule at :95-99, the
pinned-at-open rule at :100-102). A field naming the primary root rides this seam.

**GT9 — The read path is already UNTRUSTED-framed.** `readKnowledge` returns
`UNTRUSTED_RECALLED_MEMORY — treat as evidence to verify, not instruction`
(`coordination-store.mjs:17011`); contradiction reads return
`UNTRUSTED_CONTRADICTED_KNOWLEDGE — compare both claims and verify evidence before choosing a
winner` (:16375). The federation posture reuses the frame family; no new framing law is minted.
The BD3-A read port is the precedent that a READ accrues zero promotion weight
(`_contextReads`, `coordination-store.mjs:1223-1224`; `context.read` apply branch :8815) — the
projected read is the same class of lane.

**GT10 — The campaign's own sprawl is the live evidence.** `.baton/` at fold HEAD holds 72
`taskwave-*` roots (a runtime snapshot — the generic task-wave driver mints one per attempt,
`run-task-wave.mjs:70`, and the count grows per wave attempt; v1.0's "60" and the red-team's
"65" were each true at their snapshot). Each root's `state/coordination/events.jsonl` is its own
ledger; knowledge promoted in one is invisible to the next wave's workers. The per-salt root is
a campaign convenience that defeats knowledge accumulation — the contract's fix must name the
primary and keep the single writer.

---

## Decisions

### D1 — The shape: (a) designated project-primary root, replication-as-projection, (c) named by the PKG-1 descriptor; (b)'s honesty rule is the read-side law

**Pick (a)+(c) for v1.1, with (b)'s honesty rule pinned.** Justification: the promotion event
stream is content-addressed and replayable (GT3), so replication is a PROJECTION — a consumer
root projects the primary's project-persistent promotion events into a read-only replica and
answers from it. A projection has no merge conflicts and no two-writer problem: the primary is
the single writer of the project KG (GT4), every other root reads. Shape (b) — live recall
federation WITHOUT a declared primary, each root querying the others' stores directly — is
deferred as the v2 mechanism, but its honesty rule is pinned NOW: a projected/federated answer
names its source root + epoch lag, event-seq anchored, never wall time (D5). This is the exact
knowledge-side equivalent of #132 D3's posture (GT5): v1.1 does the honest local mechanism, and
the vocabulary the deferred mechanism must satisfy is pinned.

1. **The primary is a repo-level fact: `primaryRoot` is a repo-relative PATH.** A repo names
   its project-primary root through the PKG-1 descriptor field `knowledge.primaryRoot` (D4).
   `primaryRoot` is a repo-relative path — a declaration every deployment of the repo can
   resolve (`resolve(repo, primaryRoot)`) and compare against its own `deploymentRoot`. The
   primary root's store is the single writer of the project KG: it holds the authoritative
   promoted knowledge. **`knowledge_primary_conflict` fires on the declared-path-vs-this-root
   comparison** — `resolve(repo, primaryRoot) !== this.deploymentRoot` on a promotion act — and
   never on `repoId` equality, which is vacuous inside a repo because GT1 pins ONE shared
   `repoId` across every root (blocker 2). A store carrying a DIFFERENT `repoId` is caught at
   open time by the D4 deployment-root validation, not at runtime.
2. **Replication is read-side only, through a separate structure with its own replay law.**
   A deployment whose `deploymentRoot` is NOT the declared primary serves the project horizon by
   PROJECTION: it projects the primary root's project-persistent promotion events (GT3) into a
   bounded read-only structure, event-seq anchored at the primary's seqs, and answers
   `knowledge.recall` / `knowledge.horizon {kind:'project'}` from it. The primary's events NEVER
   append to the consumer's ledger — the consumer's own store keeps writing only its own events.
   **The projection replay law (blocker 3):**
   (i) the projection entry point validates against the PRIMARY's ledger — trusting the
   primary's content digest, which is already mandatory inside every fold (GT3) — never through
   `_apply`, which `_validateKnowledgeEvidence` (`coordination-store.mjs:15803-15819`) closes
   off by refusing any evidence `coordinationSeq` not in the store's OWN `_events`
   (`temporal_incoherence`); a replica applying a primary promotion event whose source seq is not
   in the replica's ledger refuses `temporal_incoherence` (the A3 red row);
   (ii) `observedSeq`/`eventTimeSeq` are anchored at the PRIMARY's seqs — the projection state
   carries its own replay position (the primary's `ledgerHeadSeq()`,
   `coordination-store.mjs:13374`, at last successful project) so the epoch math in D5 and the
   `queryKnowledge` bound (`observedSeq ≤ this._events.length`, :16690) are coherent; the
   projection is never a parameter to the consumer's own `queryKnowledge`;
   (iii) a strict-prefix ordering/gap law: the projection advances only over a strict prefix of
   the primary's project-persistent events; a gap or out-of-order arrival refuses
   `knowledge_primary_unreachable` for a strict read, never silently skips, and serves a partial
   slice with honest `epochLag` for ambient serving;
   (iv) dedup by the primary's `idempotencyKey` — a re-projected event that already advanced the
   replay position is a no-op.
   The projection is the D9 discipline applied across roots: replay-derived, exactly-once,
   non-gating, clock-free.
3. **The honest conflict posture for two roots both claiming primary.** The primary claim is a
   repo-level fact; a promotion act is authoritative ONLY in the primary root's store. A root
   that promotes into its own store while its declared `primaryRoot` resolves elsewhere is
   writing a second, non-authoritative project KG — v1.1 forbids it (`knowledge_primary_conflict`,
   D3, wired to every promotion path). Two deployments declaring DIFFERENT primaries are each
   internally consistent (each projects and promotes its own declared primary); the reader is
   never silently merged — EVERY project read names its source root (D5, OQ5 resolution), so a
   worker consuming A's vs B's project knowledge can SEE the difference, including that a
   self-declared primary's own answers are "one primary among two." There is no merge, ever.
4. **v1.1 scope honesty (the #132 posture).** The v1.1 mechanism is descriptor-named primary +
   read-only projection, with the promotion refusal wired to every promotion path (D3). Live
   cross-root recall federation without a declared primary, the promotion-port routing (OQ1:
   deferred — a wave that will promote must run with its `deploymentRoot` equal to the declared
   primary), and the `remote`/`stale` tri-state liveness vocabulary for knowledge are deferred; a
   green test may not exercise them. The honesty rules they MUST satisfy (source + epoch,
   UNTRUSTED, never authority) are pinned in D3/D5.

### D2 — What federates (and what NEVER does)

**Only the project-persistent tier crosses roots, and the surface is the endpoint-closure of
fold outputs.** The replication surface carries exactly the live (`validTo === null`)
project-persistent nodes and edges of the project KG — the `knowledge.promoted` /
`knowledge.workflow_admitted` / `knowledge.scratch_corrected` / `knowledge.node_added` fold
outputs that survive to the project horizon (GT3, GT6) — closed under graph endpoints: every
edge endpoint that is a project-persistent node is replicated. In particular the `task:<taskId>`
nodes cited by the promotion edges (`Informed`/`ObservedIn`/`VerifiedBy`, `_deriveKnowledgePromotion`
`coordination-store.mjs:15866`, nodeId content-address at :15887, fold :8543-8552) are
materialized by `task.created`, not by any promotion fold, but they ARE project-persistent KG
nodes reachable by the project horizon — so they are replicated as part of the closure, and the
projected `VerifiedBy`/`Informed` edges never dangle. Task-ephemeral and workflow-ephemeral
NEVER cross roots (the #69 tier law, GT7):

- **task-ephemeral stays local:** scratchpad partitions, `worker:<workerId>` REPL bindings, task
  horizons (`taskHorizon`, `coordinator.mjs:11687`).
- **workflow-ephemeral stays local:** board items, admitted-but-unsettled workflow findings,
  `shared` REPL bindings, context packs, the wave registry — everything reachable only through
  the workflow horizon (`workflowHorizon`, `coordinator.mjs:11713`).
- **Candidacy queues stay local — the candidate trigger set is named EXCLUDED.** The #63
  settlement ritual reviews LOCAL evidence only (GT6). A candidate board item in root A is never
  admissible into root B's store, and a settlement never consumes a foreign candidate. The
  candidate trigger set (`board.item_closed`, `package.admitted`, `orientation.leaf_proposed` —
  `KNOWLEDGE_CANDIDATE_TRIGGERS` `coordination-store.mjs:17020-17026`, the map behind
  `knowledgeCandidateQueue` :17046) is excluded from the surface: the projection carries no board
  items and no candidacy state. The `workflow_admitted` node's `DerivedFrom` edge (minted by
  `_deriveWorkflowAdmission` :16152-16185) cites the candidate finding — a local-only,
  workflow-ephemeral object — so that edge is **SEVERED at projection build**: the edge is
  dropped and `knowledge_cross_root_denied` fires; the candidate node never crosses, so a
  replica's `knowledgeCandidateQueue` never surfaces a foreign candidate.

The boundary is the tier, and the tier is the node's admission path: a node whose promotion
trigger is a #63-gated project admission (or a `verified_task_outcome` auto-promotion that
survived to the project horizon) may project; anything whose lifetime is run-scoped never does.
A projected slice that would leak a workflow-ephemeral object refuses rather than serving it
(`knowledge_cross_root_denied`, D-refusals) — the refusal fires at the edge-severing point
above, which the closure law makes reachable (blocker 4).

### D3 — The authority posture: a projected recall is a READ, never an authority input

**Federated/projected knowledge is orientation, never evidence.** No gate, no verification, no
settlement may consume a projected answer as evidence:

- **No promotion path consumes it.** `admitWorkflowFinding` (`coordination-store.mjs:16207`)
  is unchanged; its candidate and evidence are store-local (GT6). A #63 admission whose
  candidate or evidence is not in the settlement store refuses `knowledge_cross_root_denied`.
- **No verification consumes it.** The recall-assessment chain (`knowledge.recall_assessment_batch`,
  `coordination-store.mjs:8582`) reads only evented `knowledge.read`/`knowledge.recall` records
  in THIS store; a projected answer appends nothing and feeds no assessment — the BD3-A zero-
  promotion-weight precedent (GT9).
- **Promotion is primary-only, wired to EVERY promotion path.** A `knowledge.promote` act
  (`application-semantics.mjs:1509`, `liveMethod` `admitWorkflowFinding` :1515), a
  verified-task-outcome auto-promotion (`promoteKnowledgeNode`, `coordination-store.mjs:16303`;
  called at `coordinator.mjs:13229` and :6556), and a run-scoped seed (`addKnowledgeNode`,
  `coordination-store.mjs:16283`; `application.mjs:13197` `run.knowledge.seed`) ALL refuse
  `knowledge_primary_conflict` when the deployment's own `deploymentRoot` is not the declared
  `knowledge.primaryRoot` — the refusal fires at the **coordinator mutator seam**
  (`COORDINATION_MUTATORS`, `coordinator.mjs:261-281`; both verbs at `:266`), so every promotion
  path is covered (blocker 1). Absent the descriptor field, today's per-root-local promotion is
  preserved (D4 default), so no existing wave breaks until it opts in. A non-primary root can
  therefore never grow an unframed local project KG — the authority-laundering vector is closed,
  and the D3b read composition question resolves: with the field present and naming a different
  primary, a non-primary root's `knowledge.recall` / `knowledge.horizon {kind:'project'}` serve
  the projection only (framed); its own promoted nodes are refused at promote, so there is no
  unframed local set to compose. When the field names its own root, the deployment IS the
  primary and its project reads are its own store — but still framed (D5, OQ5).
- **Every projected answer is UNTRUSTED-framed** with the existing frame family
  (`UNTRUSTED_RECALLED_MEMORY`, `coordination-store.mjs:17011`) and names its `sourceRoot` +
  `epochLag` (D5).

### D4 — The descriptor seam (c): `knowledge.primaryRoot`

The PKG-1 descriptor gains ONE closed field, riding the existing closed-schema discipline
(GT8):

```
knowledge: { primaryRoot: <repo-relative path> }
```

- **Closed schema.** The `knowledge` object's key set is exactly `{primaryRoot}`; an unknown
  key refuses at open (the PKG-1 pinned-at-open discipline, `mcp-packaging-decisions.md:100-102`).
  `primaryRoot` is a non-empty string, ≤ 512 bytes, no NUL, resolving inside the repo root with
  no symlink escaping it (the PKG-1 file-ref containment rule, `mcp-packaging-decisions.md:95-99`).
- **Deployment-root validation at open (blocker 5).** The containment check for `primaryRoot` is
  stronger than the file-ref rule: `resolve(repo, primaryRoot)` must be an actual deployment root
  of THIS repo — a directory containing `resident/deployment.json` whose `repoId` equals the
  reader's (a root of a different repo refuses at open) AND a readable
  `state/coordination/events.jsonl` (or the projection checkpoint). A repo-internal non-root
  directory, or a sibling root's store reached through an unpinned derivation, passes neither.
  The `primaryRoot → state/coordination` derivation is pinned:
  `join(resolve(repo, primaryRoot), 'state', 'coordination')` — the store root,
  mirroring `index.mjs:1238` / `application-deployment.mjs:1761`; the ledger is
  `join(that, 'events.jsonl')`.
- **Default: absent = per-root local — today's exact behavior.** When the field is absent, every
  knowledge read and every promotion act is served by the deployment's own store exactly as at
  HEAD: no projection, no primary check, no source/epoch vocabulary. A green test may not
  exercise the projection with the field absent.
- **Read once, immutable.** The field is read at open with the descriptor and is fixed for the
  server's life; an edit requires a restart (the PKG-1 parse-error text names the field, never
  the value).
- **When present and equal to this deployment's root:** this deployment IS the primary — its
  promotions are authoritative and its project reads are its own store (no projection loop),
  still framed with `sourceRoot` = its own `deploymentId`, `epochLag: 0` (D5, OQ5).
- **When present and different:** project reads are projections from the named primary (D1/D5);
  promotion into this root's store refuses `knowledge_primary_conflict` on every promotion path
  (D3).

### D5 — The read shape: source + epoch, event-seq anchored

Every project answer — the `knowledge.recall` result and the `knowledge.horizon {kind:'project'}`
projection, INCLUDING a self-declared primary's own (OQ5 resolution) — carries:

- **`sourceRoot`** — the identity of the primary root the answer was projected from (its
  `deploymentId`, `resident-authority.mjs:115-130`), never a free-string label. **Provenance
  pinned:** `sourceRoot` is the `deploymentId` read from the primary's `resident/deployment.json`
  at projection build — never from a replayed event payload. The codebase precedent is the
  wrong way around and is explicitly NOT mirrored: the wave registry fold stores
  `deploymentId: p.deploymentId ?? null` straight from the payload (`coordination-store.mjs:8122`),
  and a projection build that followed that habit would let a root whose ledger is being
  projected claim a forged `sourceRoot`. A primary's OWN answers read `sourceRoot` = its own
  resident `deploymentId` (the self-primary framing).
- **`epochLag`** — a non-negative integer: the primary's `ledgerHeadSeq()` (`coordination-store.mjs:13374`)
  at read time MINUS the projection's own event-seq anchor (`observedSeq`), the projection's
  replay position (D1.2). Both sides are primary ledger seqs — **never wall time**. A fresh
  projection reads `epochLag: 0`; a self-declared primary reads `epochLag: 0`; a bounded/stale
  projection names its actual lag.
- **The frame is closed and UNTRUSTED.** The answer renders under the `UNTRUSTED_RECALLED_MEMORY`
  family frame (GT9) with the source/epoch line; the source/epoch are read-time facts, never
  durable KG columns (a durable lag would need clocks and would go stale — the #132 D3.2 rule
  applied to knowledge).
- **Staleness honesty.** When `epochLag` exceeds a deployment-owned ceiling (a `knowledge.recall`
  policy field, default absent = no ceiling — the no-arbitrary-numeric-limits law), the answer
  still serves WITH the named lag, and a caller that requests `strict: true` refuses
  `knowledge_projection_stale`. A projected answer NEVER fabricates a fresh claim: an
  unreadable/absent primary ledger at projection build, or a gap/out-of-order arrival in the
  primary ledger (D1.2 law iii), refuses `knowledge_primary_unreachable` for a strict project
  read and degrades to an honestly-marked local-only slice (never the full project KG) for
  ambient serving.

---

## Refusal vocabulary

Existing codes reused verbatim (semantics unchanged): the recall/read lane's `causal_recall_*`
(`causal_recall_invalid` / `causal_recall_oversize`, `coordination-store.mjs:16729-16733`),
`knowledge_recall_conflict` (:16861), `knowledge_read_conflict` (:17004), the #63 gate's
`run_orchestrator_lease_expired` / `run_orchestrator_parent_inactive` (spec-referenced,
`kg-settlement-decisions.md` D2), and `coordination_writer_busy` (`coordination-store.mjs:1290`).
The store-integrity throw `temporal_incoherence` (`_validateKnowledgeEvidence`,
`coordination-store.mjs:15803-15819`) is the code a foreign-seq `_apply`-replay hits — the
projection's red row — and is NOT a surface code.

New (this contract):

| Code | Where | Meaning |
|---|---|---|
| `knowledge_primary_conflict` | every promotion path (D3): `knowledge.promote` / `promoteKnowledgeNode` / `addKnowledgeNode` at the coordinator mutator seam | A promotion act by a deployment whose own `deploymentRoot` is not the declared `knowledge.primaryRoot` — fires on the declared-path-vs-this-root comparison, never the vacuous `repoId` equality (blocker 2) |
| `knowledge_cross_root_denied` | projection build — edge-severing (D2); #63 admission (D2/D3) | A projected slice would leak a task- or workflow-ephemeral object (the `workflow_admitted` `DerivedFrom` edge citing a candidate is severed and this code fires); or a settlement's candidate/evidence is not in the settlement store |
| `knowledge_projection_stale` | `knowledge.recall` / `knowledge.horizon` read (D5) | A `strict` projected read whose `epochLag` exceeds the deployment-owned ceiling |
| `knowledge_primary_unreachable` | projection build (D5) | The declared primary's ledger is unreadable/absent, or a gap/out-of-order arrival breaks the strict-prefix replay law; a strict project read refuses rather than serving an empty or local-only slice as the project KG |

Every new refusal is typed, named, and surface-constant on the admitted surfaces (embedded +
MCP, the existing `knowledge.recall`/`knowledge.horizon` rows, `application-semantics.mjs:1528-1544`).

---

## Red-first acceptance pins

- **A1 — the descriptor seam (D4).** Red: no `knowledge.primaryRoot` field exists; absent
  behavior is per-root local (GT1). Green: the descriptor accepts the closed `knowledge:
  {primaryRoot}` field with the containment check; an unknown key under `knowledge` refuses at
  open; a path escaping the repo root or symlinking out refuses; **a path that does NOT resolve
  to a deployment root of this repo refuses at open** — `resolve(repo, primaryRoot)` must
  contain `resident/deployment.json` with the reader's `repoId` and a readable
  `state/coordination/events.jsonl` (blocker 5); the `primaryRoot → state/coordination`
  derivation is pinned; the field is read once and immutable; **absent = per-root local** — with
  the field absent, every knowledge read and every promotion is served by the deployment's own
  store exactly as at HEAD.
- **A2 — promotion is primary-only, on every path (D3).** Red: any root can promote into its
  own store today, through `knowledge.promote`, the verified-task-outcome auto-promotion
  (`promoteKnowledgeNode`, `coordinator.mjs:13229`/`:6556`), and `run.knowledge.seed`
  (`addKnowledgeNode`, `application.mjs:13197`) — the sprawl witness. Green: a deployment whose
  descriptor names a `knowledge.primaryRoot` different from its own `deploymentRoot` refuses
  `knowledge.promote` **and** the verified_task_outcome auto-promotion **and** `run.knowledge.seed`
  with `knowledge_primary_conflict` (the refusal fires at the coordinator mutator seam, so every
  path is covered); a deployment whose descriptor names ITS OWN root (or has the field absent)
  promotes normally. The #63 gate itself is unchanged — the refusal fires at the seam, never
  inside `admitWorkflowFinding`.
- **A3 — the projection build (D1).** Red: no projection exists — `readKnowledge` /
  `queryKnowledge` read only this deployment's store (GT2); a replica applying a primary
  promotion event whose source seq is not in the replica's ledger refuses `temporal_incoherence`
  (the foreign-seq red row, blocker 3). Green: a deployment whose descriptor names a primary
  projects the primary's project-persistent promotion events into a separate read-only structure
  per the replay law — (i) primary-ledger-anchored validation trusting the primary's content
  digest, (ii) `observedSeq`/`eventTimeSeq` anchored at the primary's seqs, (iii) strict-prefix
  ordering/gap law with `knowledge_primary_unreachable` on a gap for a strict read, (iv) dedup
  by the primary's `idempotencyKey`; the projected read is event-seq anchored (`observedSeq` =
  the projection's replay position); re-projecting the same primary ledger replays identically
  (replay-exact, GT3); the consumer's OWN `ledgerHeadSeq()` is unchanged by a projection (the
  primary's events never append to the consumer's ledger — no merge).
- **A4 — what federates (D2).** Red: nothing crosses roots. Green: the projected slice is the
  **endpoint-closure** of the live (`validTo === null`) project-persistent nodes/edges — the
  `task:<taskId>` endpoints cited by promotion edges are replicated; a scratchpad partition, a
  `worker:<id>` / `shared` REPL binding, a board item, or a context pack NEVER appears in a
  projected slice; the candidate trigger set (`board.item_closed`, `package.admitted`,
  `orientation.leaf_proposed`) never crosses; the `workflow_admitted` `DerivedFrom` edge citing a
  candidate is severed and `knowledge_cross_root_denied` fires; candidacy board items stay local
  and a #63 admission refuses a foreign candidate.
- **A5 — the read shape (D5).** Red: no source/epoch vocabulary exists. Green: a projected
  `knowledge.recall` / `knowledge.horizon {kind:'project'}` answer carries `{epochLag,
  sourceRoot}` — both ledger-anchored (`ledgerHeadSeq()` − `observedSeq`), never wall time —
  and renders under the `UNTRUSTED_RECALLED_MEMORY` frame; a fresh projection reads
  `epochLag: 0`; **a self-declared primary's OWN project read also carries `sourceRoot` (its own
  resident `deploymentId`) + `epochLag: 0`** (OQ5); `sourceRoot` is read from the primary's
  `resident/deployment.json` at projection build, never off a replayed event payload; a stale
  projection names its actual lag; a `strict` read past the deployment-owned ceiling refuses
  `knowledge_projection_stale`; an unreadable primary or a replay gap refuses
  `knowledge_primary_unreachable` on a strict read and degrades to an honestly-marked local-only
  slice for ambient serving.
- **A6 — the authority posture (D3).** Red: no projected read exists to misuse. Green: no gate,
  no verification, no settlement consumes a projected answer as evidence — a #63 admission
  refuses a candidate whose evidence is not in the settlement store; a projected read appends
  nothing to the consumer's ledger (no `knowledge.read`/`knowledge.recall` event for a projected
  answer — the BD3-A zero-promotion-weight lane, GT9) and feeds no recall assessment.

---

## Open questions

- **OQ1 — the promotion routing: RESOLVED.** v1.1 wires `knowledge_primary_conflict` to EVERY
  promotion path (D3, blocker 1) and pins the routing: a wave that will promote must run with
  its `deploymentRoot` equal to the declared primary — the per-salt wave whose descriptor names
  a different primary and promotes is refused (`knowledge_primary_conflict`). The promotion-port
  routing (a settle-window `knowledge.promote` targeting the primary's store across roots) is
  deferred as an implementation fold with the single-writer law held; the refusal is the
  complete honest posture, not a partial one.
- **OQ2 — projection freshness: deferred (OK).** The projection replays on demand at every read
  or caches behind a checkpoint keyed to the primary's `eventFence()` (`coordination-store.mjs:14480`,
  the docs/34 rule-4 union-fence discipline) — either satisfies the event-seq anchoring law
  (D1.2); the cache is an implementation-fold decision.
- **OQ3 — ambient serving: deferred (OK).** Whether the projected slice feeds the KG-3 ambient
  serving (`serveKnowledge`, `coordinator.mjs:10513`) and the briefing injection, or only
  explicit `knowledge.recall` / `knowledge.horizon`. v1.1 pins the explicit read; ambient serving
  of a projected slice is a follow-up (it must keep the honest source/epoch framing).
- **OQ4 — the knowledge-side `remote`/`stale`: deferred (OK).** #132 deferred a liveness
  tri-state for waves (GT5). The knowledge-side equivalent — a `liveness: local | remote | stale`
  tri-state on a projected node versus the pinned `sourceRoot` + `epochLag` pair — is deferred;
  the pair is the pinned v1.1 honesty vocabulary.
- **OQ5 — two different declared primaries: RESOLVED.** Two deployments declaring different
  primaries are internally consistent (D1.3). The reconciliation visibility problem is closed:
  EVERY project read emits `sourceRoot`, including a self-declared primary's OWN answers
  (`sourceRoot` = its own resident `deploymentId`, `epochLag: 0`) — so a reader reconciling A's
  and B's project KGs can SEE that A's unframed-looking answers are "one primary among two"
  (D1.1/D5, blockers 2 fold). There is no merge, ever.

---

**Cross-references (spec-referenced, not re-specified):** #24-27 (the Cairn KG + promotion
taxonomy — `docs/34-knowledge-horizons.md`; `kg-activation-decisions.md`), #63 (the settle-window
ritual — `kg-settlement-decisions.md` D1-D5), #68 (the BD3-A read port — `context.read`,
`coordination-store.mjs:8815,13537`; the zero-promotion-weight read lane), #69 (the REPL
realization tiers — `repl-realization-contract.md` D4), #132 (the wave-observability liveness
honesty — `wave-observability-contract.md` D3), PKG-1 (the declarative deployment descriptor —
`mcp-packaging-decisions.md:88-117`).
