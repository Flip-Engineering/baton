# #70 FOLD — blocker → change map (red-team report → contract v1.1)

- **Fold HEAD (this map):** `79a782630c2f31bdd575e536c00cdadb0314fb07` — the worktree
  effective-tree snapshot. The red-team reviewed at
  `90d997c6372a2ef16113555dcb46a7ba2cff40a9`; contract v1.0 was verified at
  `1637ae58dbcf5ac9a188366ec484c629baff4171`. Neither `1637ae5` nor `90d997c` is an ancestor of
  the fold target (`git merge-base --is-ancestor` is false for both — the fold worktree carries
  #105 D4-accessor content, so the six `coordinator.mjs` anchors moved **+8 more** past the
  red-team's HEAD), so every citation was re-verified with `grep -an`/`sed -n` at `79a7826` and
  the contract's `file:line` anchors were updated accordingly (§ Verification notes lists the
  deltas).
- **Fold source:** `contract-redteam.md` (NOT FOLD-READY — 8 blockers: 6 MAJOR, 2 MINOR, plus
  the OQ verdicts marking OQ1 and OQ5 FOLD-BLOCKING).
- **Fold target:** `cross-deployment-knowledge-contract.md` v1.1 (same dir) — the ONLY other
  edit.
- **Verdict:** ALL EIGHT blockers resolved · the two fold-blocking OQs (OQ1, OQ5) resolved ·
  OQ2/OQ3/OQ4 deferred (OK per the report) · zero items silently dropped.

---

## Blocker → change map

### B1 — [GT6 + D3, MAJOR] "There is no second promotion path" is false; the primary-only refusal is wired to one verb only → RESOLVED

- **Red-team:** `promoteKnowledgeNode` (`coordination-store.mjs:16303`; called at
  `coordinator.mjs:13229` for `verified_task_outcome`, `coordinator.mjs:6556`) and
  `addKnowledgeNode` (:16283; `application.mjs:13197` `run.knowledge.seed`) append project-KG
  nodes to **any** root's store with **no primary check**, and D3/GT6 don't cover them. A
  non-primary root keeps auto-promoting unframed local nodes — the authority-laundering the
  brief names.
- **v1.1 change:** GT6 corrected to the THREE promotion/materialization paths — the #63
  orchestrator-admit (`admitWorkflowFinding`, `coordination-store.mjs:16207`; wrapper
  `coordinator.mjs:11428`, `knowledge.workflow_admitted`), the verified-task-outcome
  auto-promotion (`promoteKnowledgeNode`, `coordination-store.mjs:16303`, `knowledge.promoted`),
  and the run-scoped seed (`addKnowledgeNode`, `coordination-store.mjs:16283`,
  `knowledge.node_added`). Both extra verbs are in `COORDINATION_MUTATORS`
  (`coordinator.mjs:261-281`, both at `:266`). D3's "Promotion is primary-only" now fires
  `knowledge_primary_conflict` at the **coordinator mutator seam** covering ALL THREE paths. A2
  gains red rows for the verified_task_outcome auto-promotion and the `run.knowledge.seed` seed.

### B2 — [D1, MAJOR] The split-brain conflict detector is vacuous inside a repo → RESOLVED

- **Red-team:** D1.1's `repoId` equality is the only cross-root check, and GT1 pins ONE shared
  `repoId` across every root of a repo (`repo-76d484205f22eed0163d8f21b8287740`, re-sampled) —
  so `knowledge_primary_conflict` never fires for a second root claiming primary, and a
  self-declared primary serves its KG unframed.
- **v1.1 change:** D1.1 makes the primary a **repo-level fact** — `primaryRoot` is a
  repo-relative PATH that every deployment resolves (`resolve(repo, primaryRoot)`) and compares
  against its own `deploymentRoot`; the refusal fires on the declared-path-vs-this-root
  comparison, never the vacuous `repoId` equality. OQ5 resolved: every project read emits
  `sourceRoot` (D5), even a self-declared primary's own answers (`epochLag: 0`) — so two
  primaries are honestly surfaced to a reconciling reader.

### B3 — [D1, MAJOR] The projection replay law is unspecified and the existing folds cannot replay cross-store → RESOLVED

- **Red-team:** `_validateKnowledgeEvidence` (`coordination-store.mjs:15803-15819`) requires
  every evidence `coordinationSeq` to exist in the store's OWN `_events` (else
  `temporal_incoherence`); `queryKnowledge` (`coordination-store.mjs:16686`) refuses
  `observedSeq > this._events.length` (:16690). The primary's events carry primary-ledger
  evidence seqs and never append to the consumer's ledger (D1.2), so replay-through-`_apply` is
  impossible and the replay-through-projection path was never specified.
- **v1.1 change:** D1.2 pins the projection as a SEPARATE read-only structure with its own
  replay position (never `_apply`) and the four-part replay law: (i) a projection entry point
  that validates against the primary's ledger — trusting the primary's content digest, which is
  already mandatory inside every fold (GT3); (ii) `observedSeq`/`eventTimeSeq` anchored at the
  PRIMARY's seqs; (iii) a strict-prefix ordering/gap law — a gap or out-of-order arrival
  refuses `knowledge_primary_unreachable` for a strict read, never silently skips; (iv) dedup by
  the primary's `idempotencyKey`. A3 gains the red row (a replica applying a primary promotion
  event whose source seq is not in the replica's ledger refuses `temporal_incoherence`) and
  greens the law on top of it.

### B4 — [D2, MAJOR] The replication surface is not closed under edge endpoints → RESOLVED

- **Red-team:** the `workflow_admitted` `DerivedFrom` edge cites the candidate finding (a
  local-only, workflow-ephemeral candidacy object, `_deriveWorkflowAdmission`
  `coordination-store.mjs:16152-16185`), and promotion edges (`Informed`/`ObservedIn`/
  `VerifiedBy`) cite `task:<id>` nodes materialized by `task.created`, not by promotion folds —
  the projected slice either dangles (`_validateKnowledgeEdgePayload` :15847-15849 requires both
  endpoints in-store) or leaks a candidate into a replica's `knowledgeCandidateQueue` (:17046).
- **v1.1 change:** D2 defines the surface as the **endpoint-closure** of fold outputs: `task:<id>`
  endpoints (project-persistent KG nodes reachable by the project horizon) ARE replicated as part
  of the slice; the candidate trigger set (`board.item_closed`, `package.admitted`,
  `orientation.leaf_proposed` — `KNOWLEDGE_CANDIDATE_TRIGGERS` `coordination-store.mjs:17020-17026`)
  is named EXCLUDED; the `workflow_admitted` `DerivedFrom` edge citing a candidate is SEVERED at
  projection build — the edge is dropped and `knowledge_cross_root_denied` fires; the candidate
  node never crosses, so a replica's candidacy queue never surfaces a foreign candidate. A4
  greens the closure + the severing.

### B5 — [D4, MAJOR] Containment does not require the referent to be a baton deployment root → RESOLVED

- **Red-team:** the seam checks "inside the repo root, no symlinks out"
  (`mcp-packaging-decisions.md:95-99`) but never that `primaryRoot` resolves to a deployment
  root with the reader's `repoId` and a readable coordination store; combined with B2's vacuous
  repoId check, a repo-internal non-root path passes the seam.
- **v1.1 change:** D4 adds **open-time deployment-root validation** — `resolve(repo, primaryRoot)`
  must contain `resident/deployment.json` whose `repoId` equals the reader's AND a readable
  `state/coordination/events.jsonl`; and pins the `primaryRoot → state/coordination` derivation
  (`join(resolve(repo, primaryRoot), 'state', 'coordination')`, mirroring `index.mjs:1238` /
  `application-deployment.mjs:1761`). A1 green extended.

### B6 — [Citations, MAJOR — automatic] Six `coordinator.mjs` anchors are +18 lines stale at current HEAD → RESOLVED (re-anchored)

- **Red-team:** `:10460→:10478`, `:10487→:10505`, `:11402→:11420`, `:11661→:11679`,
  `:11687→:11705`, `:11729→:11747`; correct only at the non-ancestor verification HEAD `1637ae5`.
- **v1.1 change:** verification HEAD bumped to the fold target `79a7826` (ancestry stated in the
  header); the six anchors re-verified at the fold HEAD —
  `recallKnowledge` :10486, `serveKnowledge` :10513, `admitWorkflowFinding` wrapper :11428,
  `taskHorizon` :11687, `workflowHorizon` :11713, `projectHorizon(repoId)` :11755. The two
  promotion call sites re-verified too: verify-flow `promoteKnowledgeNode` `coordinator.mjs:13229`,
  `run.knowledge.seed` `application.mjs:13197`.

### B7 — [Citations, MINOR — automatic] `docs/34:52` is off-by-one; the project-horizon quote is at `:53` → RESOLVED

- **v1.1 change:** GT1's quote re-anchored to `docs/34:53`.

### B8 — [Metadata, MINOR] The NUL-bearing-file lists are wrong in both the contract and the brief → RESOLVED

- **Red-team:** `application.mjs` has **0** NULs; the four remaining impl files are NUL-bearing
  too. No methodology impact — all reads are ranged.
- **v1.1 change:** the header's list corrected to the six NUL-bearing impl files
  (`coordination-store.mjs`, `coordinator.mjs`, `application-semantics.mjs`,
  `application-deployment.mjs`, `index.mjs`, `resident-authority.mjs`); `application.mjs`
  explicitly noted as 0-NUL.

---

## Open-question verdicts → applied

| OQ | Verdict (red-team §5) | Where folded |
|---|---|---|
| OQ1 — promotion routing | **FOLD-BLOCKING — RESOLVED** | Wiring of `knowledge_primary_conflict` to every promotion path (B1) plus the routing: a wave that will promote must run with its `deploymentRoot` equal to the declared primary; the promotion-port routing is deferred as an implementation fold with the single-writer law held. The refusal is the complete honest posture, not a partial one (D3). |
| OQ2 — projection freshness | **Deferred (OK)** | On-demand replay vs an `eventFence()`-keyed cache (`coordination-store.mjs:14480`) — either satisfies the event-seq law; the cache is an implementation fold (D1.2). |
| OQ3 — ambient serving | **Deferred (OK)** | Explicit `knowledge.recall`/`knowledge.horizon` is pinned; ambient `serveKnowledge` (`coordinator.mjs:10513`) is a follow-up that must keep source/epoch framing (D5). |
| OQ4 — knowledge-side liveness tri-state | **Deferred (OK)** | `sourceRoot` + `epochLag` is the pinned v1.1 vocabulary; the `local|remote|stale` tri-state is additive. |
| OQ5 — two different declared primaries | **FOLD-BLOCKING — RESOLVED** | Always emit `sourceRoot` for a project read, even when the answer is local (the self-primary framing — a self-declared primary serves its OWN project KG with `sourceRoot: <own deploymentId>, epochLag: 0`), so a reader reconciling A's and B's project KGs sees that A's answers are "one primary among two" (B2 + D5). |

---

## Verification notes

- **Every citation in v1.1 was re-verified at `79a7826`** with `LC_ALL=C grep -an`/`sed -n` on the
  six NUL-bearing files (`coordination-store.mjs`, `coordinator.mjs`, `application-semantics.mjs`,
  `application-deployment.mjs`, `index.mjs`, `resident-authority.mjs`; `application.mjs` = 0 NULs)
  and plain `grep`/`sed` elsewhere. Cross-contract pins (`kg-settlement-decisions.md`,
  `mcp-packaging-decisions.md`, `docs/34-knowledge-horizons.md`, `repl-realization-contract.md`,
  `wave-observability-contract.md`) were read in their own files.
- **NUL counts at the fold HEAD:** `application.mjs` 0; `coordination-store.mjs` 17,249;
  `application-semantics.mjs` 2,166; `coordinator.mjs` 14,379; `application-deployment.mjs` 2,042;
  `index.mjs` 1,655; `resident-authority.mjs` 440. (`coordinator.mjs` = 14,356 at the red-team's
  HEAD — the fold worktree adds +23 NUL-bearing lines.)
- **Line-number deltas vs the red-team HEAD** (the fold worktree carries #105 D4-accessor content,
  so these anchors moved; v1.1 cites the fold-HEAD values):
  | Anchor | Contract v1.0 HEAD `1637ae5` | Red-team HEAD `90d997c` | Fold HEAD `79a7826` |
  |---|---|---|---|
  | `recallKnowledge` | `coordinator.mjs:10460` | `:10478` | `:10486` |
  | `serveKnowledge` | `coordinator.mjs:10487` | `:10505` | `:10513` |
  | `admitWorkflowFinding` wrapper | `coordinator.mjs:11402` | `:11420` | `:11428` |
  | `taskHorizon` | `coordinator.mjs:11661` | `:11679` | `:11687` |
  | `workflowHorizon` | `coordinator.mjs:11687` | `:11705` | `:11713` |
  | `projectHorizon(repoId)` | `coordinator.mjs:11729` | `:11747` | `:11755` |
  | verify-flow `promoteKnowledgeNode` call | — (not cited in v1.0) | `coordinator.mjs:13213` | `:13229` |
  | `run.knowledge.seed` → `addKnowledgeNode` | — (not cited in v1.0) | `application.mjs:13173` | `:13197` |
- **Live sprawl drift:** the `.baton/` taskwave count is a runtime snapshot — v1.0 said 60 at
  `1637ae5`, the red-team measured 65 at `90d997c`, and this fold measures **72** at `79a7826`.
  GT10 now states the fold-time count and notes the sprawl grows per wave attempt (GT1's resident
  `deployment.json` sample re-verified: 4 sampled roots all carry
  `repo-76d484205f22eed0163d8f21b8287740` with distinct `deploymentId`s).
- **Laws honored:** no clocks (`epochLag = primary.ledgerHeadSeq() − observedSeq`, both primary
  ledger seqs — `ledgerHeadSeq` `coordination-store.mjs:13374`; a self-primary read reads
  `epochLag: 0`, never a wall-time claim); every sorted-key literal in ACTUAL sorted order
  (`{epochLag, sourceRoot}`); no locale-dependent string comparison anywhere in either deliverable
  (the declared-primary path comparison is exact byte/path equality, never a locale collator).
