# #70 Suite Draft Notes — `cross-deployment-knowledge-red.test.mjs`

Date: 2026-08-13 · Contract: **cross-deployment-knowledge v1.2** (folded) · Suite: 31 rows (22 RED / 9 PIN)
Deliverable: `impl/test/cross-deployment-knowledge-red.test.mjs` (this draft's only other deliverable).
Authority: `cross-deployment-knowledge-contract.md` (v1.2 source of truth — GT1–GT10, D1–D5, A1–A6,
OQ1–OQ5), `contract-fold.md` (the 8 blocker→change map — B1 three promotion paths, B2
path-vs-repoId discriminator, B3 projection replay law, B4 endpoint closure + edge severing, B5
deployment-root validation), `suite-blueteam.md` (the v1.1 blue-team report — 5 green-side blockers
F1.1/F1.2 plus F2.2/F2.4/F2.6 and the missing-row additions F3.2/F3.3/F3.4/F4.4),
`suite-fold-2.md` (this suite's finding → resolution map), `suite-70-brief.md` (this
suite's brief), and the idiom suite `doubt-review-red.test.mjs`.

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/cross-deployment-knowledge-red.test.mjs   # run from repo root
ℹ tests 31
ℹ pass 9
ℹ fail 22
ℹ cancelled 0  skipped 0  todo 0
```

Two consecutive runs of the finished suite both produced **pass 9 · fail 22** (the header records
the exact `tests 31 · pass 9 · fail 22 · cancelled 0 · skipped 0 · todo 0` line for both runs). The
9 passes are exactly the nine PIN rows (A1-P1, A2-P1, A2-P2, A3-P1, A3-P2, S-P1, R-P1, K-P1, G1);
the 22 failures are the RED rows, each confirmed to fail at its NAMED stage (the per-row stage lives
in the header row inventory AND in each row's first-failing assertion message — all 22 are
`AssertionError`, never a crash).

## Row map

Every RED row fails at the named stage today and goes green on the v1.1/v1.2 implementation ONLY.
Stages in **bold** are the current HEAD failure seam. All RED rows' first assertion is a behavior
assertion against a real surface (the closed descriptor opens, the promotion succeeds, the project
read returns) so the row fails at the stage — never on a vacuous shape assertion that a missing
projection could spuriously satisfy. The A1-R2…R5 rows each PIN a distinct post-impl refusal
(D4 closed-schema / containment / deployment-root validation); since the suite-fold-2 F1.1 seam
split (parse admits the well-formed `knowledge` field at `loadMcpDescriptor`, construct fires
containment + deployment-root validation at `createMcpServerFromDescriptor`), each row asserts the
parse admission first and the construct refusal second — a correct implementation passes both, a
wrong one fails at the named seam.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1-R1 | D4 | | **no knowledge field in the descriptor** | `TOP_LEVEL_FIELDS` is the frozen `['repo','deploymentRoot','routes','surface','principal','quotas']` (mcp-descriptor.mjs:18), so `closedRecord(parsed, TOP_LEVEL_FIELDS, 'descriptor')` refuses any `knowledge:{primaryRoot}` — the closed field, the unknown sub-key, and every containment refusal below are all one `descriptor_invalid` at this seam |
| A1-R2 | D4 | | **the sub-field is not named** | the refusal message (F1.1 fix 2) does not name the sub-field `knowledge.bogus` — at HEAD the closed-schema error names the top-level `knowledge` (the whole field is unknown); the row's first assertion is the message discriminator, never the code (both HEAD and a correct impl refuse `descriptor_invalid`) |
| A1-R3 | D4 | | no knowledge field in the descriptor | same seam — an escaping `primaryRoot` (`../escape`) never reaches the containment check |
| A1-R4 | D4 | | no knowledge field in the descriptor | same seam — a symlink-out `primaryRoot` never reaches the containment check; F2.2: the symlink referent is a VALID deployment root of this repo outside the repo, so only the realpath containment walk refuses |
| A1-R5 | D4 | | no knowledge field in the descriptor | same seam — a repo-internal non-root path and a foreign-repo deployment root never reach the `resident/deployment.json` + `state/coordination/events.jsonl` containment check |
| A1-P1 | D4 | PIN | byte-identical | green today — a descriptor WITHOUT the knowledge field parses and `createMcpServerFromDescriptor` constructs a `CoordinationStore` at `join(stateRoot, 'coordination')`; the fold must not disturb the absent field |
| A2-R1 | D3 | | **no primary check** | `addKnowledgeNode` (the `run.knowledge.seed` store verb, application.mjs:13201) succeeds on a store whose `deploymentRoot ≠ primaryRoot` — the primary-only law is absent |
| A2-R2 | D3 | | **no primary check** | `promoteKnowledgeNode` with `trigger: 'verified_task_outcome'` (the auto-promotion, coordinator.mjs:13458/:6580) succeeds on a non-primary store |
| A2-R3 | D3 | | **no primary check** | the coordinator's `admitWorkflowFinding` (application-semantics.mjs:1509 → the seam wrapper coordinator.mjs:11647) succeeds on a non-primary deployment — no `knowledge_primary_conflict` |
| A2-P1 | D3 | PIN | self-primary | green today — a deployment whose declared primary is its OWN root promotes normally |
| A2-P2 | D3 | PIN | gate-at-the-seam | green today — the raw store `admitWorkflowFinding` (#63 gate) succeeds even on a non-primary store: the refusal must fire at the store-verb seam (F2.4: `addKnowledgeNode`/`promoteKnowledgeNode` refuse when constructed with federation opts where `resolve(primaryRoot) ≠ resolve(deploymentRoot)`) and at the coordinator mutator seam, never inside the store gate |
| A3-R1 | D1 | | **no projection** | `projectHorizon(repoId)` returns the replica's OWN empty slice (`nodes: []`) — no projection reads the primary's ledger; the primary's promoted node is invisible |
| A3-R2 | D5 | | **no source/epoch vocabulary** | `projectHorizon(repoId)` returns the plain HEAD shape `{repoId, fenceTuple, nodes, edges}` — no `sourceRoot`/`epochLag`, so the honest framing is absent |
| A3-P1 | D1 | PIN | foreign-seq replay | green today — an `addKnowledgeNode` with a foreign evidence seq (a primary seq absent from this store) refuses `temporal_incoherence` (coordination-store.mjs:15803-15819): the projection is a SEPARATE structure, never `_apply` |
| A3-P2 | GT2 | PIN | per-root local | green today — the replica never sees another root's nodes, and the consumer's own ledger is unchanged by any cross-root read (no merge) |
| A4-R1 | D2 | | **no endpoint closure** | the projected slice is empty — the endpoint-closure law (task:<taskId> endpoints cited by promotion edges are replicated; every edge's endpoints are present in the slice) is unobservable (F3.2) |
| A4-R2 | D2 | | **no edge severing** | a replica `recallKnowledge` that would surface a workflow_admitted node's `DerivedFrom` edge to a local candidate never fires `knowledge_cross_root_denied` — the edge-severing refusal is absent (F3.3) |
| A5-R1 | D5/A6 | | **no projection** | a non-strict `recallKnowledge` on a non-primary returns an empty local slice — the primary's promoted node, `{epochLag, sourceRoot}`, and the UNTRUSTED frame never appear, and the no-append-to-consumer-ledger law (A6) is unobservable (F3.4) |
| S-R1 | B2 | | **no primary check** | `addKnowledgeNode` on a non-primary store succeeds even though both roots share the one repoId (GT1 holds by construction) — the declared-path-vs-this-root discriminator is absent, and the vacuous repoId-equality attack (redteam D1a) would pass |
| S-R2 | OQ5 | | **no source/epoch vocabulary** | two self-declared primaries each promote into their own store and their project reads carry no `sourceRoot`/`epochLag` — a reconciling reader cannot SEE the one-primary-among-two situation |
| S-P1 | GT1 | PIN | one repoId per repo | green today — `repositoryId()` is shared across every root of a repo, distinct `deploymentId`s notwithstanding (the discriminator's law) |
| R-R1 | D1.2 | | **no projection** | the projected node's `observedSeq`/`eventTimeSeq` anchoring and the no-merge law are unobservable — `projectHorizon` returns an empty slice |
| R-R2 | D1.2 | | **no projection** | dedup-by-idempotencyKey is unobservable — `projectHorizon` returns an empty slice, so re-projection has no nodes to duplicate |
| R-R3 | D1.2 | | **no replay law** | `recallKnowledge(..., {strict: true})` ignores the strict option and serves the local slice with no refusal (`null`) — a replay position the primary does not reach (ahead-of-head, the strict-prefix gap) never fires `knowledge_primary_unreachable` |
| R-P1 | GT3 | PIN | within-store replay-exact | green today — reopening the same store dir derives the identical graph (the primary store's own replay is deterministic) |
| K-R1 | refusals | | **refusal family is absent** | `coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES` does not exist — the frozen 4-code federation family is not a typed surface constant |
| K-R2 | D2/D3 | | **no cross-root denial** | a #63 admission whose candidate is a REAL closed candidate in the PRIMARY root (never in the replica's candidacy queue) refuses the generic `workflow_admit_ineligible` — never the typed `knowledge_cross_root_denied` |
| K-R3 | D5 | | **no staleness posture** | a strict read with `projectionReplayPosition: 0` against a `projectionStaleCeiling: 0` deployment serves the local slice with no refusal (`null`) — never `knowledge_projection_stale` |
| K-R4 | D5 | | **no unreachable posture** | a strict read whose declared primary passed the D4 open-time deployment-root check but never wrote a coordination ledger serves the local slice with no refusal (`null`) — never `knowledge_primary_unreachable` |
| K-P1 | refusals | PIN | reused codes verbatim | green today — `coordination_writer_busy` (second `claimWriterLease`), `temporal_incoherence` (foreign seq), `knowledge_read_conflict` (reused key, changed query), `invalid_query` (observedSeq past head), `causal_recall_invalid`/`causal_recall_oversize`/`knowledge_recall_conflict` (the recall lane under the exact 11-field policy) all fire; the read shapes hold (`{event, frame, nodes, asOf, replayed}`, the UNTRUSTED frame, `queryKnowledge` returns the filtered array) |
| G1 | — | PIN | byte-identical | green today — a store WITHOUT federation opts keeps the plain `projectHorizon` shape (`{repoId, fenceTuple, nodes, edges}`, no sourceRoot/epochLag), `readKnowledge` still appends a `knowledge.read` event, and `snapshot().knowledge` carries no federation vocabulary |

Note: the draft's row set changed by fold (v1.1 28 rows 19 RED → v1.2 31 rows 22 RED): the five
green-side blocker rows (A1-R2…R5) were re-driven with the F1.1 seam split; R-R1 was re-anchored
to the F1.2 law (eventTimeSeq is the MINIMUM evidence coordinationSeq); A4-R1/A4-R2 (D2
endpoint-closure + edge-severing) and A5-R1 (D5 non-strict recall lane) were added per the
blue-team missing-row findings F3.2/F3.3/F3.4. K-R4's comment was corrected per F4.4.

## Invented surfaces

Every invented member is absent at HEAD (the seam the RED row holds). The first assertion on every
invented export is a behavior assertion against a real surface so the row fails at the named stage —
never on a shape assertion that `Object.isFrozen(undefined) === true` could spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| descriptor `knowledge:{primaryRoot}` — the D4 closed field, repo-relative, deep-frozen with the parsed descriptor | `loadMcpDescriptor` + `createMcpServerFromDescriptor` | `descriptor_invalid` — the field is outside `TOP_LEVEL_FIELDS` (A1-R1…R5). The F1.1 seam split means the parse admits the well-formed field and the construct fires the containment/deployment-root walk: A1-R3/R4/R5 assert `parseCode === null` FIRST, then the construct refusal |
| store opts `primaryRoot` / `deploymentRoot` — the deployment's declared primary root and its own root (absolute paths at the store seam; the descriptor field is the repo-relative form) | `CoordinationStore` constructor opts | accepted and ignored (A2-R1/R2, A3/R rows, S-R1). Per F2.4 these opts are the store-verb enforcement point: `addKnowledgeNode`/`promoteKnowledgeNode` refuse inside the store when `resolve(primaryRoot) ≠ resolve(deploymentRoot)` |
| store opt `projectionReplayPosition` — the replica's event-seq anchor in PRIMARY seqs (D1.2 ii); a position the primary does not reach makes the primary unreachable | `CoordinationStore` constructor opts | accepted and ignored (R-R3, K-R3) |
| store opt `projectionStaleCeiling` — the deployment-owned epochLag ceiling (D5, default absent = no ceiling) | `CoordinationStore` constructor opts | accepted and ignored (K-R3) |
| coordinator opts `primaryRoot` / `deploymentRoot` — the seam's own-root comparison (B2) | `Coordinator` constructor opts | accepted and ignored (A2-R3, A3, S, R, K rows) |
| project read `sourceRoot` + `epochLag` — on `coordinator.projectHorizon(repoId)` and the recall read, INCLUDING a self-declared primary's own answers (OQ5) | `coordinator.projectHorizon(repoId)` | absent — the plain `{repoId, fenceTuple, nodes, edges}` shape (A3-R2, S-R2, A5-R1) |
| `recallKnowledge(query, reader, {idempotencyKey, strict})` — the strict project read (D5) | `coordinator.recallKnowledge` | the `strict` option is ignored — the local slice serves with no refusal (R-R3, K-R3, K-R4); a NON-strict read serves an empty local slice with no `{epochLag, sourceRoot}` (A5-R1) |
| `coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES` — the frozen 4-code federation family | namespace import `* as coordinatorNs` | no such export (K-R1) |

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **A1-P1** absent = per-root local | an impl whose descriptor seam rejects a descriptor WITHOUT the `knowledge` field, or invents a primary where none was declared (byte-identical to HEAD) |
| **A2-P1** self-primary promotes | an impl that refuses promotion on the designated primary itself — the primary-only law binds OTHER roots, never the primary |
| **A2-P2** #63 gate unchanged | an impl that moves the refusal inside the store's `admitWorkflowFinding` — the store gate (`coordination-store.mjs:16207`) stays open (F2.4); the refusal fires at the store-verb seam (`addKnowledgeNode`/`promoteKnowledgeNode` refuse on federation opts) and at the coordinator mutator seam (`COORDINATION_MUTATORS`, `coordinator.mjs:272`), never inside the gate |
| **A3-P1** foreign-seq `temporal_incoherence` | an impl that `_apply`s primary events into the replica's ledger — the projection is a SEPARATE structure, and a foreign `coordinationSeq` in an apply-replay must still refuse |
| **A3-P2** per-root local | an impl whose projection loop leaks another root's nodes into a store's OWN local read, or that merges primary events into the consumer ledger |
| **S-P1** `repositoryId()` shared | an impl that scopes repoId per deployment root — the GT1 one-repoId-per-repo law is what makes the path-vs-repoId discriminator non-vacuous |
| **R-P1** within-store replay-exact | an impl that makes the primary store's own replay non-deterministic on reopen (the projection is replay-exact ON TOP of this) |
| **K-P1** reused codes verbatim | an impl that renames/retypes the reused codes (`coordination_writer_busy`, `temporal_incoherence`, `knowledge_read_conflict`, `invalid_query`, `causal_recall_invalid`, `causal_recall_oversize`, `knowledge_recall_conflict`) or breaks the read shapes |
| **G1** plain store byte-identical | an impl whose federation vocabulary (`sourceRoot`/`epochLag`) leaks into a non-federated store's `projectHorizon`/`snapshot`, or that changes the local read lane (`knowledge.read` append) |

## What makes each stage go green (implementer's checklist)

- **no knowledge field in the descriptor** → D4/B5, folded per F1.1 (fix 1 — the seam split):
  `loadMcpDescriptor` ADMITS the closed `knowledge:{primaryRoot}` field (a non-empty repo-relative
  path, deep-frozen with the parsed descriptor), and `createMcpServerFromDescriptor` fires the
  validation at open: the resolved path must (a) stay inside the repo root — no `..` escape and no
  symlink out (reuse the PKG-1 credential containment walk at mcp-descriptor.mjs:56-74), and (b)
  resolve to a deployment root of THIS repo — `join(resolved, 'resident', 'deployment.json')` must
  parse with `repoId` matching the repo's minted repoId and
  `join(resolved, 'state', 'coordination', 'events.jsonl')` must be readable (the D4 containment
  check). The A1-R3/R4/R5 rows assert the parse admission FIRST and the construct refusal SECOND —
  the two are different calls (fix 1). An unknown sub-key under `knowledge` refuses
  `descriptor_invalid` naming the sub-field (`knowledge.bogus`), never the top-level `knowledge` —
  the A1-R2 row discriminates by the refusal MESSAGE (fix 2). Absent → per-root local,
  byte-identical (A1-P1).
- **no primary check** → D3/B2/F2.4: every promotion path refuses `knowledge_primary_conflict` when
  `resolve(repo, primaryRoot) !== this.deploymentRoot` — (1) `addKnowledgeNode` (the
  `run.knowledge.seed` store verb, application.mjs:13201) and (2) `promoteKnowledgeNode` (the
  `verified_task_outcome` auto-promotion, coordinator.mjs:13458/:6580) refuse **inside the store
  itself** when constructed with federation opts where `resolve(primaryRoot) ≠ resolve(deploymentRoot)`
  (the F2.4 fold — a direct store call and a coordinator-mediated call both refuse), and (3) the
  coordinator's `admitWorkflowFinding` at the mutator seam (application-semantics.mjs:1509 →
  coordinator.mjs:11647, the wrapper outside the `COORDINATION_MUTATORS` set at `coordinator.mjs:272`,
  both verbs at `:277`). The refusal never fires inside the store's `admitWorkflowFinding` (A2-P2 —
  the #63 gate stays open). The discriminator is declared-path-vs-this-root, never the vacuous repoId
  equality — both roots share the one repoId (S-R1), so a repoId-only check is the exact redteam D1a hole.
- **no projection** → D1/D1.2/B3: a non-primary deployment's project read (`projectHorizon` and the
  recall read) builds the projection from the primary's project-persistent promotion events —
  primary-ledger-anchored validation trusting the content digest (never `_apply`), observedSeq /
  eventTimeSeq anchored at the PRIMARY's seqs, strict-prefix ordering and gap law, dedup by the
  primary's idempotencyKey, and NEVER an append of a primary event to the consumer's ledger (no
  merge). A replica's own store-local read stays its own (A3-P2).
- **no source/epoch vocabulary** → D5/OQ5: every project answer — including a self-declared
  primary's own — carries `sourceRoot` (the deploymentId from the primary's `resident/deployment.json`
  at projection build) + `epochLag` (primary ledgerHeadSeq − observedSeq, an integer, never wall
  time). A self-primary reads its own deploymentId + `epochLag: 0` (S-R2).
- **no endpoint closure** → D2/F3.2: the projected slice is the endpoint-closure of the live
  project-persistent nodes/edges — the `task:<taskId>` endpoints cited by promotion edges
  (`VerifiedBy`/`Informed`/`ObservedIn`) are replicated as part of the closure (A4-R1 asserts the
  task endpoint appears AND every edge has both endpoints present — never a dangling edge).
- **no edge severing** → D2/F3.3: a projected slice that would leak the `workflow_admitted` node's
  `DerivedFrom` edge (citing a local-only, workflow-ephemeral candidate) SEVERS the edge and refuses
  `knowledge_cross_root_denied` on a strict read (A4-R2 — the same typed code K-R2 pins on the
  admission side).
- **no non-strict recall lane** → D5/F3.4: a NON-strict `recallKnowledge` on a non-primary serves
  the primary's promoted node with `{epochLag, sourceRoot}` under the UNTRUSTED frame and appends
  nothing to the consumer's ledger (A5-R1 — the ambient-serving lane the #132 posture keeps honest).
- **no replay law** → D1.2 iii/D5: the strict read (`recallKnowledge(..., {strict: true})`) refuses
  `knowledge_primary_unreachable` when the replica's replay position names a primary state the
  primary does not reach — a gap, an out-of-order arrival, or a position ahead of the primary's head —
  never a silent skip to a local-only slice (R-R3).
- **the refusal family is absent** → refusals: `coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES`
  exports the frozen 4-code family in ACTUAL sorted order — `knowledge_cross_root_denied`,
  `knowledge_primary_conflict`, `knowledge_primary_unreachable`, `knowledge_projection_stale` —
  reusing the snake_case refusal machinery; never `localeCompare`.
- **no cross-root denial** → D2/D3: a #63 admission whose candidate originates in another root
  refuses `knowledge_cross_root_denied` (typed), never the generic `workflow_admit_ineligible` — the
  candidate trigger set stays local to the settlement store (K-R2).
- **no staleness posture** → D5: a strict read whose projection's observedSeq lags the primary's
  ledgerHeadSeq beyond the deployment-owned `projectionStaleCeiling` refuses `knowledge_projection_stale`
  — the answer is never fabricated fresh past the ceiling (K-R3).
- **no unreachable posture** → D5: a strict read whose declared primary ledger is unreadable/absent
  refuses `knowledge_primary_unreachable` — a primary that passed the D4 open-time deployment-root
  check but never wrote a coordination ledger is honestly unreachable, never a local-only slice (K-R4).

## Suite-law hygiene (verified)

- **Hermetic**: no network, no real provider spawns; mock worktrees / capture / referee / route for
  the coordinator harness; `mkdtempSync` repos, descriptors, logs, and stores; a global `test.after`
  cleanup; the deployment-verification stub is the brief's `true` command (executable `true`,
  argv `[]`, cwd `.`, exit 0). Real git repos are used ONLY for the repoId mint (the suite never
  pushes; `git init` + one empty local commit, `git rev-parse --git-common-dir`).
- **Red-first at named stages**: every RED row's first assertion is the named-stage failure (a
  behavior assertion against a real surface — the closed descriptor opens, the promotion succeeds,
  the project read returns); the stage names live in the header row inventory AND in each row's
  assertion message. 22 RED / 9 PIN, stable across consecutive runs (all 22 failures are
  `AssertionError`, never a crash).
- **NUL discipline**: `coordination-store.mjs`, `coordinator.mjs`, `application-semantics.mjs`,
  `application-deployment.mjs`, `index.mjs`, and `resident-authority.mjs` are NUL-bearing — only
  their exports are imported, never read whole (`grep -an`/`sed -n` were used for the source
  anchors). `application.mjs` measures 0 NULs and is only cited ranged (the `run.knowledge.seed`
  dispatch at :12478, the `knowledgeSeed` store-verb call at :13190-13214).
- **Fixture ordering law**: the coordinator is constructed BEFORE the candidate/task fixture — its
  constructor's dispatch pass marks pre-existing `working` tasks FAILED (A2-R3 pins this ordering).
- **No clocks as controls / no wall-clock assertion**: fixed-clock stores (`FIXED_TS =
  '2026-08-12T08:00:00.000Z'`); the coordinator's `now` anchors to that fixed instant. `epochLag` is
  `ledgerHeadSeq − observedSeq`, both primary seqs — never wall time (D5).
- **No `localeCompare`**: the 4-code federation literal, the reused-code literal, and every
  sorted-key literal (the `readKnowledge` shape keys) are ACTUAL byte order.
- **Idempotency keys asserted verbatim**: the `run.knowledge.seed` key
  (`run.knowledge.seed:${runId}:${digest(...)}`), the recall key, the `knowledge.read` key — the
  re-drive contract is pinned, not just the payload shapes.
