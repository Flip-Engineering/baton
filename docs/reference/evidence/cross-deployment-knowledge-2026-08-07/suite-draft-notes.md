# #70 Suite Draft Notes — `cross-deployment-knowledge-red.test.mjs`

Date: 2026-08-12 · Contract: **cross-deployment-knowledge v1.1** (folded) · Suite: 28 rows (19 RED / 9 PIN)
Deliverable: `impl/test/cross-deployment-knowledge-red.test.mjs` (this draft's only other deliverable).
Authority: `cross-deployment-knowledge-contract.md` (v1.1 source of truth — GT1–GT10, D1–D5, A1–A6,
OQ1–OQ5), `contract-fold.md` (the 8 blocker→change map — B1 three promotion paths, B2
path-vs-repoId discriminator, B3 projection replay law, B4 endpoint closure + edge severing, B5
deployment-root validation), `contract-redteam.md` (the attack surface — D1a split-brain vacuous
repoId, D1b replay law, D2a closure, D3a three paths, D4 containment), `suite-70-brief.md` (this
suite's brief), and the idiom suite `doubt-review-red.test.mjs`.

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/cross-deployment-knowledge-red.test.mjs   # run from repo root
ℹ tests 28
ℹ pass 9
ℹ fail 19
ℹ cancelled 0  skipped 0  todo 0
```

Two consecutive runs of the finished suite both produced **pass 9 · fail 19** (the header records
the exact `tests 28 · pass 9 · fail 19 · cancelled 0 · skipped 0 · todo 0` line for both runs). The
9 passes are exactly the nine PIN rows (A1-P1, A2-P1, A2-P2, A3-P1, A3-P2, S-P1, R-P1, K-P1, G1);
the 19 failures are the RED rows, each confirmed to fail at its NAMED stage (the per-row stage lives
in the header row inventory AND in each row's first-failing assertion message — all 19 are
`AssertionError`, never a crash).

## Row map

Every RED row fails at the named stage today and goes green on the v1.1 implementation ONLY.
Stages in **bold** are the current HEAD failure seam. All RED rows' first assertion is a behavior
assertion against a real surface (the closed descriptor opens, the promotion succeeds, the project
read returns) so the row fails at the stage — never on a vacuous shape assertion that a missing
projection could spuriously satisfy. The A1-R2…R5 rows share the A1-R1 stage at HEAD (the whole
`knowledge` field is unknown), but each pins a distinct post-impl refusal; their stages are listed
per the post-impl behavior.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1-R1 | D4 | | **no knowledge field in the descriptor** | `TOP_LEVEL_FIELDS` is the frozen `['repo','deploymentRoot','routes','surface','principal','quotas']` (mcp-descriptor.mjs:18), so `closedRecord(parsed, TOP_LEVEL_FIELDS, 'descriptor')` refuses any `knowledge:{primaryRoot}` — the closed field, the unknown sub-key, and every containment refusal below are all one `descriptor_invalid` at this seam |
| A1-R2 | D4 | | no knowledge field in the descriptor | same seam — the unknown sub-key under `knowledge` never reaches the closed-schema check |
| A1-R3 | D4 | | no knowledge field in the descriptor | same seam — an escaping `primaryRoot` (`../escape`) never reaches the containment check |
| A1-R4 | D4 | | no knowledge field in the descriptor | same seam — a symlink-out `primaryRoot` never reaches the containment check |
| A1-R5 | D4 | | no knowledge field in the descriptor | same seam — a repo-internal non-root path and a foreign-repo deployment root never reach the `resident/deployment.json` + `state/coordination/events.jsonl` containment check |
| A1-P1 | D4 | PIN | byte-identical | green today — a descriptor WITHOUT the knowledge field parses and `createMcpServerFromDescriptor` constructs a `CoordinationStore` at `join(stateRoot, 'coordination')`; the fold must not disturb the absent field |
| A2-R1 | D3 | | **no primary check** | `addKnowledgeNode` (the `run.knowledge.seed` store verb, application.mjs:13197) succeeds on a store whose `deploymentRoot ≠ primaryRoot` — the primary-only law is absent |
| A2-R2 | D3 | | **no primary check** | `promoteKnowledgeNode` with `trigger: 'verified_task_outcome'` (the auto-promotion, coordinator.mjs:13229/:6556) succeeds on a non-primary store |
| A2-R3 | D3 | | **no primary check** | the coordinator's `admitWorkflowFinding` (application-semantics.mjs:1509 → the seam wrapper coordinator.mjs:11428) succeeds on a non-primary deployment — no `knowledge_primary_conflict` |
| A2-P1 | D3 | PIN | self-primary | green today — a deployment whose declared primary is its OWN root promotes normally |
| A2-P2 | D3 | PIN | gate-at-the-seam | green today — the raw store `admitWorkflowFinding` (#63 gate) succeeds even on a non-primary store: the refusal must fire at the coordinator mutator seam, never inside the store gate |
| A3-R1 | D1 | | **no projection** | `projectHorizon(repoId)` returns the replica's OWN empty slice (`nodes: []`) — no projection reads the primary's ledger; the primary's promoted node is invisible |
| A3-R2 | D5 | | **no source/epoch vocabulary** | `projectHorizon(repoId)` returns the plain HEAD shape `{repoId, fenceTuple, nodes, edges}` — no `sourceRoot`/`epochLag`, so the honest framing is absent |
| A3-P1 | D1 | PIN | foreign-seq replay | green today — an `addKnowledgeNode` with a foreign evidence seq (a primary seq absent from this store) refuses `temporal_incoherence` (coordination-store.mjs:15803-15819): the projection is a SEPARATE structure, never `_apply` |
| A3-P2 | GT2 | PIN | per-root local | green today — the replica never sees another root's nodes, and the consumer's own ledger is unchanged by any cross-root read (no merge) |
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

## Invented surfaces

Every invented member is absent at HEAD (the seam the RED row holds). The first assertion on every
invented export is a behavior assertion against a real surface so the row fails at the named stage —
never on a shape assertion that `Object.isFrozen(undefined) === true` could spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| descriptor `knowledge:{primaryRoot}` — the D4 closed field, repo-relative, deep-frozen with the parsed descriptor | `loadMcpDescriptor` + `createMcpServerFromDescriptor` | `descriptor_invalid` — the field is outside `TOP_LEVEL_FIELDS` (A1-R1…R5) |
| store opts `primaryRoot` / `deploymentRoot` — the deployment's declared primary root and its own root (absolute paths at the store seam; the descriptor field is the repo-relative form) | `CoordinationStore` constructor opts | accepted and ignored (A2-R1/R2, A3/R rows, S-R1) |
| store opt `projectionReplayPosition` — the replica's event-seq anchor in PRIMARY seqs (D1.2 ii); a position the primary does not reach makes the primary unreachable | `CoordinationStore` constructor opts | accepted and ignored (R-R3, K-R3) |
| store opt `projectionStaleCeiling` — the deployment-owned epochLag ceiling (D5, default absent = no ceiling) | `CoordinationStore` constructor opts | accepted and ignored (K-R3) |
| coordinator opts `primaryRoot` / `deploymentRoot` — the seam's own-root comparison (B2) | `Coordinator` constructor opts | accepted and ignored (A2-R3, A3, S, R, K rows) |
| project read `sourceRoot` + `epochLag` — on `coordinator.projectHorizon(repoId)` and the recall read, INCLUDING a self-declared primary's own answers (OQ5) | `coordinator.projectHorizon(repoId)` | absent — the plain `{repoId, fenceTuple, nodes, edges}` shape (A3-R2, S-R2) |
| `recallKnowledge(query, reader, {idempotencyKey, strict})` — the strict project read (D5) | `coordinator.recallKnowledge` | the `strict` option is ignored — the local slice serves with no refusal (R-R3, K-R3, K-R4) |
| `coordinatorNs.KNOWLEDGE_FEDERATION_REFUSAL_CODES` — the frozen 4-code federation family | namespace import `* as coordinatorNs` | no such export (K-R1) |

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **A1-P1** absent = per-root local | an impl whose descriptor seam rejects a descriptor WITHOUT the `knowledge` field, or invents a primary where none was declared (byte-identical to HEAD) |
| **A2-P1** self-primary promotes | an impl that refuses promotion on the designated primary itself — the primary-only law binds OTHER roots, never the primary |
| **A2-P2** #63 gate unchanged | an impl that moves the refusal inside the store's `admitWorkflowFinding` — the refusal fires at the coordinator mutator seam (`COORDINATION_MUTATORS`), never inside the store gate |
| **A3-P1** foreign-seq `temporal_incoherence` | an impl that `_apply`s primary events into the replica's ledger — the projection is a SEPARATE structure, and a foreign `coordinationSeq` in an apply-replay must still refuse |
| **A3-P2** per-root local | an impl whose projection loop leaks another root's nodes into a store's OWN local read, or that merges primary events into the consumer ledger |
| **S-P1** `repositoryId()` shared | an impl that scopes repoId per deployment root — the GT1 one-repoId-per-repo law is what makes the path-vs-repoId discriminator non-vacuous |
| **R-P1** within-store replay-exact | an impl that makes the primary store's own replay non-deterministic on reopen (the projection is replay-exact ON TOP of this) |
| **K-P1** reused codes verbatim | an impl that renames/retypes the reused codes (`coordination_writer_busy`, `temporal_incoherence`, `knowledge_read_conflict`, `invalid_query`, `causal_recall_invalid`, `causal_recall_oversize`, `knowledge_recall_conflict`) or breaks the read shapes |
| **G1** plain store byte-identical | an impl whose federation vocabulary (`sourceRoot`/`epochLag`) leaks into a non-federated store's `projectHorizon`/`snapshot`, or that changes the local read lane (`knowledge.read` append) |

## What makes each stage go green (implementer's checklist)

- **no knowledge field in the descriptor** → D4/B5: `loadMcpDescriptor` admits the closed
  `knowledge:{primaryRoot}` field (a non-empty repo-relative path, deep-frozen with the parsed
  descriptor), and `createMcpServerFromDescriptor` validates it at open: the resolved path must (a)
  stay inside the repo root — no `..` escape and no symlink out (reuse the PKG-1 credential
  containment walk at mcp-descriptor.mjs:56-74), and (b) resolve to a deployment root of THIS repo —
  `join(resolved, 'resident', 'deployment.json')` must parse with `repoId` matching the repo's minted
  repoId and `join(resolved, 'state', 'coordination', 'events.jsonl')` must be readable (the D4
  containment check). An unknown sub-key under `knowledge` refuses `descriptor_invalid` naming the
  field, never the value. Absent → per-root local, byte-identical (A1-P1).
- **no primary check** → D3/B2: every promotion path refuses `knowledge_primary_conflict` when
  `resolve(repo, primaryRoot) !== this.deploymentRoot` — (1) `addKnowledgeNode` (the
  `run.knowledge.seed` store verb, application.mjs:13197), (2) `promoteKnowledgeNode` (the
  `verified_task_outcome` auto-promotion, coordinator.mjs:13229/:6556), and (3) the coordinator's
  `admitWorkflowFinding` at the mutator seam (application-semantics.mjs:1509 → coordinator.mjs:11428,
  the wrapper outside the `COORDINATION_MUTATORS` set). The refusal fires at the seam, never inside
  the store's `admitWorkflowFinding` (A2-P2). The discriminator is declared-path-vs-this-root, never
  the vacuous repoId equality — both roots share the one repoId (S-R1), so a repoId-only check is the
  exact redteam D1a hole.
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
  assertion message. 19 RED / 9 PIN, stable across consecutive runs (all 19 failures are
  `AssertionError`, never a crash).
- **NUL discipline**: `coordination-store.mjs`, `coordinator.mjs`, and `index.mjs` are NUL-bearing —
  only their exports are imported, never read whole (`grep -an`/`sed -n` were used for the source
  anchors). `application.mjs` measures 0 NULs and is only cited ranged (the `run.knowledge.seed`
  dispatch at :12474, the `knowledgeSeed` store-verb call at :13185-13214).
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
