# Issue #70 cross-deployment-knowledge contract — adversarial red team (v1.0 DRAFT under review)

Date: 2026-08-07
Target: `docs/reference/evidence/cross-deployment-knowledge-2026-08-07/cross-deployment-knowledge-contract.md` (v1.0)
Method: every anchor re-derived against the **current** working tree (HEAD `90d997c6372a2ef16113555dcb46a7ba2cff40a9`)
with NUL-safe `grep -an` / ranged `sed -n` of `impl/src/{coordination-store,coordinator,application,application-semantics,application-deployment,index,resident-authority}.mjs`,
plus the cited docs (`docs/34-knowledge-horizons.md`, `mcp-packaging-decisions.md`, the #69/#132 contracts, `run-task-wave.mjs`)
and the live `.baton/` sprawl at `$HOME/Development/Experiments/baton/.baton/`. No implementation files were modified; this report is the only artifact written.

**Verdict: NOT FOLD-READY — 8 blockers (6 MAJOR, 2 MINOR).** The citation corpus is real — every cited
function, row, and fold exists — but six `coordinator.mjs` anchors are **+18 lines stale at the current HEAD**
(they hold only at the contract's declared verification HEAD `1637ae5`, which is **not an ancestor of the
current tree**), and two load-bearing ground truths mis-state the code they cite: GT5's "drops a foreign
`deploymentId` at ingestion" does not exist in the wave fold, and GT6's "no second promotion path" is refuted
by `promoteKnowledgeNode` + `addKnowledgeNode`. The design itself hits the exact three axes the brief names:
the split-brain conflict detector (D1.1's `repoId` equality) is **vacuous inside a repo** because GT1 pins a
shared `repoId` across all roots; the projection's replay law is **unspecified and unimplementable through the
existing folds** (`_validateKnowledgeEvidence` refuses foreign-seq evidence); and the replication surface is
**not closed under graph endpoints** (edges cite `task:` and candidate nodes that never cross). Details below;
blockers are numbered in §6.

---

## 1. Citation ledger (re-verified at current HEAD)

### 1a. WRONG at current HEAD — six `coordinator.mjs` anchors, +18 lines (BLOCKER 6, automatic)

The contract declares "every `file:line` citation below was re-verified with `grep -an`/`sed -n` at
[verification HEAD `1637ae5`]". At **that** HEAD the six anchors are exactly right:

| Cited | Claimed symbol | Actual at `1637ae5` |
|---|---|---|
| `coordinator.mjs:10460` | `recallKnowledge` | `10460: recallKnowledge(...)` ✓ |
| `coordinator.mjs:10487` | `serveKnowledge` | `10487: serveKnowledge(...)` ✓ |
| `coordinator.mjs:11402` | `admitWorkflowFinding` wrapper | `11402: admitWorkflowFinding(...)` ✓ |
| `coordinator.mjs:11661` | `taskHorizon` | `11661: taskHorizon(...)` ✓ |
| `coordinator.mjs:11687` | `workflowHorizon` | `11687: workflowHorizon(...)` ✓ |
| `coordinator.mjs:11729` | `projectHorizon(repoId)` | `11729: projectHorizon(repoId)` ✓ |

At the **current** HEAD `90d997c` those lines are empty/other, and every symbol has moved **+18**:

| Cited | Actual at current HEAD | Shown by |
|---|---|---|
| `coordinator.mjs:10460` | `10478: recallKnowledge` | `grep -n recallKnowledge` |
| `coordinator.mjs:10487` | `10505: serveKnowledge` | `grep -n serveKnowledge` |
| `coordinator.mjs:11402` | `11420: admitWorkflowFinding` | `grep -n admitWorkflowFinding` |
| `coordinator.mjs:11661` | `11679: taskHorizon` | `grep -n taskHorizon` |
| `coordinator.mjs:11687` | `11705: workflowHorizon` | `grep -n workflowHorizon` |
| `coordinator.mjs:11729` | `11747: projectHorizon` | `grep -n projectHorizon` |

`coordinator.mjs` gained **165 lines** between `1637ae5` and `HEAD` (`git diff --stat` = 148 insertions / 17
deletions), and `git merge-base --is-ancestor 1637ae5 HEAD` is **false** — the verification HEAD is on a
different line of history than the tree this fold runs against. Per the brief's law ("every citation
re-verified at the current HEAD", "a wrong citation is an automatic blocker"), these six are **wrong at HEAD**.
Fix: re-anchor to the current tree (the six offsets are listed above) **or** re-derive the entire citation
corpus at a bumped verification HEAD that IS an ancestor of the fold target, and state the re-verification
HEAD's ancestry.

### 1b. Off-by-one — `docs/34:52` (BLOCKER 7, automatic)

GT1 quotes docs/34's "project horizon (persistent): the Cairn KG, repoId-scoped, durable across runs" at
`docs/34:52`. At current HEAD (and at `1637ae5`) the quote is at **line 53**; `:52` is the previous bullet
("decision settlements for one run — the orchestrator's working memory for a wave"). Same content, one line
down — an off-by-one in the anchor. Fix: `docs/34:52` → `docs/34:53`.

### 1c. Metadata error — the NUL-bearing-file lists (BLOCKER 8, MINOR)

The contract says the NUL-bearing files are "`coordination-store.mjs` + `application-semantics.mjs` only";
the red-team brief says "`application.mjs` + `coordination-store.mjs` only". Measured at current HEAD:

| File | NUL count |
|---|---|
| `application.mjs` | **0** |
| `coordination-store.mjs` | 17,249 |
| `application-semantics.mjs` | 2,166 |
| `coordinator.mjs` | 14,356 |
| `application-deployment.mjs` | 2,042 |
| `index.mjs` | 1,655 |
| `resident-authority.mjs` | 440 |

Neither list is right. `application.mjs` has **no** NULs, and the four remaining impl files are NUL-bearing
too. All reads here were `grep -an`/`sed -n` ranged, so no methodological impact; the artifact's factual
claims are wrong. Fix: correct the list in both documents.

### 1d. Verified correct at current HEAD

- **`coordination-store.mjs` — all anchors hold:** `eventTime` :410 (MIN `coordinationSeq` → `eventTimeSeq`,
  `events[seq-1]?.ts` → `eventTime`); `_contextReads` :1223-1224; `claimWriterLease` :1289 /
  `coordination_writer_busy` :1290; promotion folds `knowledge.promotion_batch` :8523,
  `knowledge.scratch_corrected` :8527, `knowledge.workflow_admitted` :8536,
  `knowledge.node_added`/`knowledge.promoted` :8543, `knowledge.edge_added` :8554; `recall_assessment` :8582;
  wave registry fold :8099-8127; `wave.closed` :8793-8810; `context.read` apply :8815 and :13537;
  `ledgerHeadSeq` :13374; `eventFence` :14480; `admitWorkflowFinding` :16207; `UNTRUSTED_CONTRADICTED` :16375;
  `queryKnowledge` :16686 (bounded `observedSeq`, `0 ≤ observedSeq ≤ this._events.length`);
  `causal_recall_*` :16729-16733; `knowledge_recall_conflict` :16861; `readKnowledge` :16997;
  `knowledge_read_conflict` :17004; `UNTRUSTED_RECALLED_MEMORY` :17005/:17011; `knowledgeContentDigest` :17031.
- **`application-deployment.mjs` :175** (`repoId` mint), **:1759-1760** (default root), **:1761** (`stateRoot`) — all hold.
- **`index.mjs` :1238** (coordination store creation at `join(logDir,'coordination')`) — holds.
- **`resident-authority.mjs` :115-130** (`stableDeploymentId`, writes `deploymentRoot/resident/deployment.json`)
  and **:264** (constructor reads it back via `this.root = privateDirectory(join(deploymentRoot,'resident'))`) — hold.
- **`application.mjs` :11711** — the `waveList` method (the `waves.list` verb; the D2.4 comment at :11708-11710
  names it). Substance holds; the surface verb is a method mapping, not a literal string.
- **`application-semantics.mjs` :1509** (`knowledge.promote` row), **:1515** (`liveMethod: admitWorkflowFinding`),
  **:1528-1544** (`knowledge.recall` / `knowledge.horizon` rows) — hold.
- **`mcp-packaging-decisions.md` :95-99** (containment: "must resolve inside the repo root, no symlinks out")
  and **:100-102** (pinned-at-open) — hold.
- **`run-task-wave.mjs` :70** (`deploymentRoot: resolve(repo,'.baton', taskwave-${ROLE}-${SALT})`) — holds.
- **GT1's sample:** re-sampled 4 `taskwave-*` resident files — all carry `repoId` `repo-76d484205f22eed0163d8f21b8287740`,
  distinct `deploymentId`s. Holds exactly.
- **GT10's count is off:** `.baton/` holds **65** `taskwave-*` roots at current runtime, not 60 (the contract's
  "60" was true at its verification HEAD). MINOR numeric drift.

---

## 2. Attack report per decision

### D1 — shape / primary / projection: **HOLE (two independent blockers 2 and 3)**

**D1a. Split-brain: two roots both claim primary — the conflict detector is vacuous inside a repo.**

Attack: root A's descriptor names `.baton/taskwave-A` (itself); root B's descriptor names `.baton/taskwave-B`
(itself). Both promote into their own stores with no refusal — each is "the primary" of its own descriptor,
and D1.3 explicitly blesses this ("Two deployments declaring DIFFERENT primaries are each internally
consistent"). Now the honest-conflict question: **which wins, and is the conflict honest?**

The contract's only cross-root check is D1.1: "its `repoId` must equal the reader's own `repoId` (verified at
projection build — a store carrying a different repoId is not this repo's primary, `knowledge_primary_conflict`)."
But GT1 (code-verified, and re-sampled above) pins **one shared `repoId` across every root of a repo**. The
check therefore **never fires inside a repo** — the only scenario it could detect is a root of a *different
repo*, which the D4 containment rule (inside-repo path) already blocks at open. `knowledge_primary_conflict`'s
"a second root claiming primary" trigger is **dead code** for its named threat.

The honest posture is asymmetric: a **projected** answer carries `sourceRoot` (D5), so a replica's worker can
see the difference; but a **self-declared primary serves its own KG unframed** — no `sourceRoot`, no epoch line —
because to itself it is local. Two self-declared primaries therefore each present their own project KG as
authoritative-local to their own workers, and the conflict is surfaced to **nobody** unless a worker explicitly
cross-reads both roots and compares. That is not "the reader can SEE the difference" (D1.3's claim) — the 
reader on either primary sees an unframed local KG. Fix: make the primary claim a **repo-level fact** (a
declaration both roots can compare — e.g., the descriptor's `primaryRoot` is itself a repo-relative path that
every deployment can resolve and check against its own root), and have the `knowledge_primary_conflict` refusal
fire on the *declared path vs this root's path* comparison rather than on the vacuous repoId check. As drafted,
the split-brain is honest only by accident of the read framing, not by detection.

**D1b. Replication replay law is unspecified — and the existing folds cannot replay cross-store.**

The brief's exact question: "can a replica apply a promotion event whose dependencies never arrived
(out-of-order/partial replication — is the projection's ordering/dedup law replay-safe)?"

Mechanism ground truth: the promotion apply folds (`knowledge.promotion_batch` :8523, `knowledge.promoted`
:8543, etc.) all run `_validateKnowledgeNodePayload` → `_validateKnowledgeEvidence` (:15803-15819), which
requires **every evidence `coordinationSeq` to exist in the store's OWN `_events`** and be `< eventSeq`
(else `temporal_incoherence`). The primary's promotion events carry evidence `[{ coordinationSeq: <primary
ledger seq> }]` (see `_deriveKnowledgePromotion` :15873-15891; `promoteKnowledgeNode` :16303-16317). D1.2
states the primary's events "NEVER append to the consumer's ledger". Therefore:

- A replica that replays the primary's events **through `_apply`** would refuse every one of them —
  `future/missing evidence seq` — because the primary's seqs are absent from the replica's `_events`.
- A replica that replays them **outside `_apply`** needs a replay law the contract never names: which entry
  point; whether validation is primary-ledger-anchored or digest-trusted; what `observedSeq`/`observedAt`/
  `eventTime`/`validFrom` a projected node carries (**they must be the primary's seqs**, or the projection's
  epoch math and the `queryKnowledge` bound break); how out-of-order or gap arrival is handled (refuse
  `knowledge_primary_unreachable`? serve a partial slice with honest `epochLag`?); and how dedup works across
  roots (the primary's `promoted`-commitments set at :15873 is *local-ledger-scoped*).
- The `queryKnowledge` bound makes the trap concrete: `queryKnowledge({observedSeq})` refuses
  `observedSeq > this._events.length` (:16687-16689). A replica cannot even call its own `queryKnowledge`
  with a primary-anchored `observedSeq`. The projection state must be a separate read-only structure with its
  own replay position — a structure the contract does not define.

GT3's "replay-exact, no merge conflicts" is true **within** the primary store (replaying the primary's ledger
into a fresh primary store derives the identical graph). It is **not** established **across** roots, which is
exactly where D1.2 deploys it. Fix: pin the projection replay law — (i) a projection entry point that
validates against the primary's ledger (or trusts the primary's content digest, which is already mandatory
inside every fold), (ii) `observedSeq`/`eventTimeSeq` anchored at the **primary's** seqs, (iii) an ordering/gap
law (strict prefix or refusal), (iv) dedup by primary `idempotencyKey`. Add a red row: "a replica applying a
primary promotion event whose source seq is not in the replica's ledger refuses `temporal_incoherence`" — and
then green the new law on top of it.

**D1c. Local promotion colliding with a replicated one.**

Node ids are content-addressed on `(repoId, sourceSeq, sourceKind)` (`promotion:${canonicalDigest({repoId,
sourceSeq, sourceKind})}`, :15879). The same *semantic* fact promoted in two roots yields **different** ids
(different `sourceSeq`), so no `duplicate_node` collision fires — instead the replica's graph accumulates two
nodes with identical meaning and different provenance. One is local (unframed, `promoteKnowledgeNode`), the
other projected (framed `sourceRoot`). The contract's D3 "promotion is primary-only" refusal would prevent the
local one *if wired*; today it is not (blocker 1). This is the D1 half of the laundering surface the brief's
D3 axis names.

### D2 — the federation boundary: **HOLE (blocker 4)**

**D2a. A promoted node citing an ephemeral one — the projected surface is not closed under edge endpoints.**

`_deriveWorkflowAdmission` (:16152-16185) mints the admitted node
`finding:workflow-admitted:<candidateFindingId>` with a `DerivedFrom` edge whose `to` is the **candidate**
finding (`board.item_closed` / `package.admitted` / `orientation.leaf_proposed` findings — the candidacy
queue, `knowledgeCandidateQueue` :17044-17060). D2 keeps "candidacy queues ... local" and "board items,
admitted-but-unsettled workflow findings" local; the replication surface is "the `knowledge.promoted` /
`knowledge.workflow_admitted` / `knowledge.scratch_corrected` fold outputs **admitted through the #63 gate**" —
which **excludes** the pre-admission candidate. So the projected `workflow_admitted` slice carries a
`DerivedFrom` edge whose endpoint is a **local-only, workflow-ephemeral** object. Two outcomes, both bad:

- **Dangle:** the projected edge cites a node that is not in the slice (violating the graph invariant that
  edge endpoints exist — `_validateKnowledgeEdgePayload` :15847-15849 requires both endpoints in-store).
- **Leak:** to avoid the dangle, the surface must include the candidate — but then a **candidacy object
  crosses roots**, and a replica's `knowledgeCandidateQueue` (a pure store projection over live
  candidate-trigger nodes) would surface the foreign candidate and feed the replica's own #63 admission a
  foreign candidate. A4's "a #63 admission refuses a foreign candidate" is then only incidentally enforced
  (the projected candidate's evidence references primary seqs and dies on `temporal_incoherence`), not by the
  named `knowledge_cross_root_denied` rule.

The same closure gap hits the `verified_task_outcome` path: promotion edges (`Informed`/`ObservedIn`/
`VerifiedBy`) cite `task:<taskId>` nodes (:15882-15892, :8543-8552). Task nodes are materialized by
`task.created`, **not** by any promotion fold, and are not "#63-admitted" — so the projected `VerifiedBy`/
`Informed` edges dangle on `task:` endpoints unless the surface is defined as the *closure* of fold outputs
under graph endpoints. The contract's A4 "projected slice contains ONLY live project-persistent nodes/edges"
does not say whether the edge endpoints are themselves project-persistent and replicated. Fix: define the
surface as the closure — replicate the referenced `task:` nodes and (if candidates may never cross) sever or
drop the `DerivedFrom` edges that cite them, firing `knowledge_cross_root_denied`; or explicitly replicate
candidate nodes **as framed, non-admissible project rows** and make the #63 admission refusal the primary
guard. Either way, pin which.

**D2b. Candidacy queue leak into federated recall.** Covered above: the leak is contingent on how the surface
closure is resolved, but as drafted the boundary is unenforced precisely at the point (candidate nodes are
`knowledge.node_added` outputs) where a "node_added outputs cross" reading would leak. The contract must name
the candidate trigger set (`board.item_closed`, `package.admitted`, `orientation.leaf_proposed`,
`knowledgeCandidateQueue`'s trigger map, :17054) as **excluded** from the surface.

### D3 — the authority posture: **HOLE (blocker 1)**

**D3a. GT6's "There is no second promotion path" is false at HEAD.**

Three distinct promotion/materialization paths exist:

| Path | Store fn | Call sites | Event |
|---|---|---|---|
| #63 orchestrator-admit | `admitWorkflowFinding` :16207 | `knowledge.promote` row → `application-semantics.mjs:1509,1515`; coordinator wrapper :11420 | `knowledge.workflow_admitted` |
| verified-task-outcome auto-promotion | `promoteKnowledgeNode` :16303 | `coordinator.mjs:13213` (verify flow), `coordinator.mjs:6556` | `knowledge.promoted` |
| run-scoped knowledge seed | `addKnowledgeNode` :16283 | `application.mjs:13173` (`run.knowledge.seed`) | `knowledge.node_added` |

`promoteKnowledgeNode` and `addKnowledgeNode` are in the coordinator's mutator allowlist
(`COORDINATION_MUTATORS`, `coordinator.mjs:261-282`; both construct the payload, run
`_validateKnowledgeNodePayload`, and **append to the store's own ledger unconditionally** — no primary check
exists anywhere at HEAD, and the field that would trigger one does not exist). D3's "Promotion is primary-only"
law is wired only to the `knowledge.promote` surface verb → `admitWorkflowFinding`; the other two paths are
**not** covered. A non-primary root whose descriptor names a different primary still auto-promotes every
verified task outcome into its own store, and still seeds nodes via `run.knowledge.seed`. That is exactly the
authority-laundering the brief names: a non-primary root's project KG keeps growing with **unframed** local
nodes.

**D3b. Can a federated node be promoted AGAIN in the replica?**

Yes, structurally: the replica's own ledger accepts `knowledge.promoted` (via `promoteKnowledgeNode`) with no
relation to the projected replica. The contract never specifies how a non-primary root's `knowledge.recall` /
`knowledge.horizon {kind:'project'}` **composes its own local project nodes with the projected replica**. If
both are served, the local ones render with no `sourceRoot`/`epochLag` — they read as **LOCAL authoritative**
despite the deployment not being primary. If only the projection is served, the local promoted nodes are
hidden from the horizon but still reachable through `readKnowledge`/`queryKnowledge` (unframed). Either
composition is a laundering vector the contract must pin down. Fix: extend the `knowledge_primary_conflict`
refusal to `promoteKnowledgeNode`/`addKnowledgeNode` (or gate them at the coordinator mutator seam), correct
GT6, and specify the read composition on a non-primary root (local nodes either refused at promote or framed
with a local-only marker).

**D3c. What is sound:** "no gate, no verification, no settlement consumes a projected answer" — the *read* half
is coherent: a projected read appends nothing (A6), so the recall-assessment chain (`knowledge.recall_assessment_batch`,
:8582) never sees it, and a #63 admission reviews store-local evidence only. The hole is purely the promotion
half (D3a/D3b).

### D4 — the descriptor seam: **containment HOLE (blocker 5); closed schema + default-absent SOUND**

- **Closed schema / pinned at open / read once:** rides the PKG-1 discipline
  (`mcp-packaging-decisions.md:100-102`) verbatim. SOUND. Unknown key under `knowledge` refuses at open; the
  field is non-empty, ≤ 512 bytes, no NUL. Red state confirmed: `knowledge.primaryRoot` does **not** exist
  anywhere at HEAD.
- **Containment — HOLE.** The pinned rule is "resolving inside the repo root with no symlink escaping it"
  (`mcp-packaging-decisions.md:95-99`) — lexical+realpath inside repo. That is the right rule for a **file
  credential ref**, but `primaryRoot` names a **directory that must be a deployment root** (a store lives at
  `join(deploymentRoot,'state','coordination')`). The seam as drafted does **not** require the referent to be
  a baton root (a directory containing `resident/deployment.json` with the reader's `repoId` and a readable
  `state/coordination/events.jsonl`). A repo-internal directory that is not a root passes every check; whether
  it then degrades honestly (`knowledge_primary_unreachable`, no ledger) or silently projects a **sibling
  root's** store depends on the path→ledger derivation the contract never pins. And the one check that could
  catch a wrong root — D1.1's `repoId` equality — is vacuous inside a repo (blocker 2). The brief's exact
  question ("can it point OUTSIDE the repo / at a path that isn't a baton root") therefore answers: outside is
  blocked, **non-baton-root is not**. Fix: add an open-time validation that `primaryRoot` resolves to a
  deployment root (contains `resident/deployment.json` whose `repoId` equals the reader's, plus a readable
  coordination store), and pin `primaryRoot → state/coordination` derivation.
- **Default-absent byte-identical:** SOUND. The field is absent at HEAD; every read and promotion is served by
  the deployment's own store; no projection, no primary check, no source/epoch vocabulary. A green test may
  not exercise the projection with the field absent. This is the honest red state.

### D5 — the read shape: **SOUND on the epoch math; HOLE-lite on `sourceRoot` provenance (feeds blocker 2)**

- **Epoch lag is event-seq anchored — SOUND.** `epochLag = ledgerHeadSeq() − observedSeq`
  (`ledgerHeadSeq` :13374 = `_events.length`; `observedSeq` = the projection's replay position, the
  `queryKnowledge` parameter :16686). Both sides are ledger seqs; never wall time. Fresh projection reads
  `epochLag: 0`; a bounded slice names its actual lag; `strict: true` past a deployment-owned ceiling refuses
  `knowledge_projection_stale`; an unreadable primary refuses `knowledge_primary_unreachable` on strict reads
  and degrades to an honestly-marked local-only slice for ambient serving. All consistent with the #132 D3.2
  posture. Two honest notes: (i) `ledgerHeadSeq()` counts **all** primary events, including ephemeral ones, so
  a busy ephemeral primary inflates `epochLag` even when the project KG is unchanged — honest but noisy; (ii)
  computing it at read time requires the replica to read the primary's live ledger, a transport the contract
  leaves to the OQ2 implementation fold. Neither is a correctness hole.
- **Can a federated answer pass as LOCAL?** For **projected** answers, no — they carry `sourceRoot` +
  `epochLag` under the `UNTRUSTED_RECALLED_MEMORY` frame (:17011). The break is on the **promotion side**
  (D3a/D3b): a non-primary root's own locally-promoted nodes are served unframed, so they pass as LOCAL even
  though the deployment is not the primary. That is the laundering vector, not the read framing.
- **`sourceRoot` unforgeability is pinned too loosely.** D5 says `sourceRoot` is "the identity of the primary
  root ... (its `deploymentId`, `resident-authority.mjs:115-130`)" — but it does **not** pin that the value is
  read from the primary's `resident/deployment.json` at projection build and **never from a replayed event
  payload**. The codebase precedent is the wrong way around: the wave registry fold stores
  `deploymentId: p.deploymentId ?? null` straight from the payload (:8122). If a projection build mirrors that
  habit and reads a `deploymentId` off a replayed event, a root whose ledger it is projecting can claim a
  forged `sourceRoot`. Fix: pin in D5 that `sourceRoot` is the deploymentId read from the primary's
  `resident/deployment.json` at projection build, never a payload field.

---

## 3. Refusal vocabulary — SOUND as a closed set, with one vacuous trigger

All five new codes are typed, named, and pinned to a surface row; the reused codes are verified verbatim
(`causal_recall_*` :16729-16733, `knowledge_recall_conflict` :16861, `knowledge_read_conflict` :17004,
`coordination_writer_busy` :1290, the #63 gate's lease codes). The **one defect**: `knowledge_primary_conflict`
'— "a projected read whose source store carries a different `repoId` ... (a second root claiming primary)" — can
**never fire inside a repo** (GT1's shared repoId, §2 D1a). The code must be re-triggered on the
declared-primary-path comparison, or it stays dead vocabulary for the exact threat it names. The
`knowledge_cross_root_denied` trigger ("a projected slice would leak a task- or workflow-ephemeral object") is
correct in intent but **has no specified firing point** today, because the surface closure law (D2a) does not
exist — the code names a refusal the contract never says how to reach.

## 4. Red-first acceptance pins

- **A1 (descriptor seam): SOUND with the containment gap of blocker 5.** Red (no field) and the absent-behavior
  green are exact. Green's "a path escaping the repo root or symlinking out refuses" is necessary but not
  sufficient — add "and is a deployment root with the reader's repoId".
- **A2 (promotion is primary-only): HOLE.** The green only exercises `knowledge.promote` →
  `admitWorkflowFinding`; `promoteKnowledgeNode`/`addKnowledgeNode` are outside the refusal's reach. Add red
  rows: "a non-primary root's verified_task_outcome auto-promotion refuses `knowledge_primary_conflict`" and "a
  non-primary root's `run.knowledge.seed` refuses `knowledge_primary_conflict`".
- **A3 (projection build): HOLE.** "Replaying the same primary ledger replays identically (replay-exact)" has
  no replay law; the existing folds cannot replay foreign-seq events (§2 D1b). Add the law, then green the pin
  against it.
- **A4 (what federates): HOLE.** "The projected slice contains ONLY live project-persistent nodes/edges" does
  not close under endpoints; the workflow_admitted `DerivedFrom` edge and the promotion edges cite nodes that
  never cross. Green must assert the surface is endpoint-closed (or that dangling-edge severing fires
  `knowledge_cross_root_denied`).
- **A5 (read shape): SOUND**, with the D5 `sourceRoot`-provenance pin added.
- **A6 (authority posture): SOUND on the read half** (projected read appends nothing, feeds no assessment),
  **undermined on the promotion half** by blocker 1.

## 5. Open questions — fold verdicts

1. **OQ1 (promotion routing): FOLD-BLOCKING.** The question assumes a single promotion verb (the #63 ritual).
   The second/third paths (D3a) make the "refusal is the v1.0 honest minimum" claim false — the refusal is not
   wired to them. Resolve the routing **and** the wiring of `knowledge_primary_conflict` to every promotion
   path before fold.
2. **OQ2 (projection freshness): OK to defer.** On-demand replay vs `eventFence()`-keyed cache
   (`eventFence` :14480, docs/34 rule-4) — either satisfies the event-seq law; the cache is an implementation
   fold. Not blocking.
3. **OQ3 (ambient serving): OK to defer.** Explicit `knowledge.recall`/`knowledge.horizon` is pinned; ambient
   `serveKnowledge` (:10505) is a follow-up that must keep source/epoch framing. Not blocking.
4. **OQ4 (knowledge-side liveness tri-state): OK to defer.** `sourceRoot`+`epochLag` is the pinned v1.0
   vocabulary; the `local|remote|stale` tri-state is additive. Not blocking.
5. **OQ5 (two different declared primaries): FOLD-BLOCKING.** The contract's premise is that each answer names
   its `sourceRoot`, so reconciliation is visible. But D1a shows the `sourceRoot` label is **absent on
   self-declared primaries' own answers** and the repoId conflict detector is dead — so a reader reconciling
   A's and B's project KGs cannot even tell that A's unframed answers are "one primary among two." Resolve the
   self-primary framing (always emit `sourceRoot` for a project read, even when the answer is local) before
   fold.

## 6. Blockers (numbered)

1. **[GT6 + D3, MAJOR] "There is no second promotion path" is false; the primary-only refusal is wired to one
   verb only.** `promoteKnowledgeNode` (`coordination-store.mjs:16303`; called at `coordinator.mjs:13213` for
   `verified_task_outcome`, `coordinator.mjs:6556`) and `addKnowledgeNode` (:16283; `application.mjs:13173`
   `run.knowledge.seed`) append project-KG nodes to any root's store with **no primary check**, and D3/GT6
   don't cover them. **Why:** a non-primary root keeps auto-promoting unframed local nodes — authority
   laundering the brief names. **Fix:** wire `knowledge_primary_conflict` into `promoteKnowledgeNode`/
   `addKnowledgeNode` (or gate them at the coordinator mutator seam), correct GT6, and add A2 red rows for both
   paths.
2. **[D1, MAJOR] The split-brain conflict detector is vacuous inside a repo.** D1.1's `repoId` equality is the
   only cross-root check, and GT1 pins one shared `repoId` across all roots — `knowledge_primary_conflict`
   never fires for a second root claiming primary, and a self-declared primary serves its KG unframed, so two
   primaries are not honestly surfaced. **Fix:** make the primary a repo-level fact and fire the refusal on the
   declared `primaryRoot` path vs this root's path; emit `sourceRoot` on every project read, including local
   (resolves OQ5).
3. **[D1, MAJOR] The projection replay law is unspecified and the existing folds cannot replay cross-store.**
   `_validateKnowledgeEvidence` (:15803-15819) refuses any evidence seq not in the store's own `_events`
   (`temporal_incoherence`); `queryKnowledge` (:16686) refuses `observedSeq > this._events.length`. The
   primary's events carry primary-ledger evidence seqs and never append to the consumer's ledger (D1.2), so
   replay-through-`_apply` is impossible and the replay-through-projection path (entry point, primary-seq
   anchoring of `observedSeq`/`eventTimeSeq`, ordering/gap law, cross-root dedup) is never specified. **Fix:**
   pin the projection replay law and add the red row for the foreign-seq refusal.
4. **[D2, MAJOR] The replication surface is not closed under edge endpoints.** The `workflow_admitted`
   `DerivedFrom` edge cites the candidate finding (:16168-16184) — a local-only, workflow-ephemeral
   candidacy object — and promotion edges cite `task:<id>` nodes materialized by `task.created`, not by
   promotion folds. The projected slice either dangles or leaks, and a replica's `knowledgeCandidateQueue`
   (:17044-17060) would surface a foreign candidate. **Fix:** define the surface as the endpoint-closure of
   fold outputs, or pin edge-severing with `knowledge_cross_root_denied`; name the candidate trigger set as
   excluded.
5. **[D4, MAJOR] Containment does not require the referent to be a baton deployment root.** The seam checks
   "inside the repo root, no symlinks out" (`mcp-packaging-decisions.md:95-99`) but never that `primaryRoot`
   resolves to a deployment root with the reader's `repoId` and a readable coordination store; combined with
   blocker 2's vacuous repoId check, a repo-internal non-root path (or a sibling root's store, per the unpinned
   path derivation) passes the seam. **Fix:** open-time deployment-root validation + pin `primaryRoot →
   state/coordination` derivation.
6. **[Citations, MAJOR — automatic] Six `coordinator.mjs` anchors are +18 lines stale at current HEAD.**
   `:10460→:10478`, `:10487→:10505`, `:11402→:11420`, `:11661→:11679`, `:11687→:11705`, `:11729→:11747`;
   correct only at the non-ancestor verification HEAD `1637ae5`. **Why:** `coordinator.mjs` gained 165 lines
   after `1637ae5` (#105 surface work). **Fix:** re-anchor at the current tree, or bump the verification HEAD
   to an ancestor of the fold target and re-verify the whole corpus.
7. **[Citations, MINOR — automatic] `docs/34:52` is off-by-one; the project-horizon quote is at `:53`.**
   **Fix:** re-anchor.
8. **[Metadata, MINOR] The NUL-bearing-file lists are wrong in both the contract ("`coordination-store.mjs` +
   `application-semantics.mjs` only") and the brief ("`application.mjs` + `coordination-store.mjs` only").**
   At HEAD `application.mjs` has 0 NULs and the four remaining impl files are NUL-bearing. **Fix:** correct
   the lists (no methodology impact — all reads here were ranged).

**Sound as drafted:** GT1-GT4's machinery descriptions (`eventTime` :410, the folds :8523-8554, the
content-digest/query path), GT8's seam discipline, D5's epoch-lag math (event-seq anchored, never wall time),
the refusal **vocabulary as a closed set**, A1's absent-behavior, and A5/A6's read-side framing. The blockers
are the six load-bearing design seams the brief's axes target.

---

*Red-team method note: `coordination-store.mjs`, `coordinator.mjs`, `application-semantics.mjs`,
`application-deployment.mjs`, `index.mjs`, and `resident-authority.mjs` contain NUL bytes; all reads were
`grep -an` / ranged `sed -n`, never whole-file. Verification HEAD ancestry established with
`git merge-base --is-ancestor 1637ae5 HEAD`. Deployment identity sampled from live `.baton/taskwave-*` resident
files (4 of 4 share `repo-76d484205f22eed0163d8f21b8287740`; distinct `deploymentId`s). No implementation files
were modified; this report is the only artifact written.*
