# #70 SUITE-FOLD-2 — the blue-team finding → resolution map

The second fold of the #70 red-first suite: the blue-team report
`suite-blueteam.md` (review HEAD `bcc2cd4`) declared the v1.1 suite **NEEDS-FOLD** — 5 RED rows
structurally unsatisfiable by a correct v1.1 implementation (F1.1), one anchoring assertion
contradicting the folded eventTime law (F1.2), plus minors F2.2/F2.4/F2.6 and the missing-row
findings F3.2/F3.3/F3.4/F4.4. This map records each finding and the concrete resolution folded into
the deliverables. The fold target HEAD is the worktree HEAD `fb9f5c5` (the report's review HEAD
`bcc2cd4` is not an ancestor); every citation below was re-verified with `grep -an`/`sed -n` at
`fb9f5c5`.

## Verdict

The v1.1 suite (28 rows, 19 RED / 9 PIN) was folded to a v1.2 suite (31 rows, 22 RED / 9 PIN).
The five F1.1 blockers were re-driven with the parse/construct seam split (fix 1) and the
message-based sub-seam discriminator (fix 2); F1.2's anchoring assertion was corrected to the
GT3 law; the minors and missing rows were folded as concrete rows or contract folds. The
folded suite runs **pass 9 · fail 22** stably across two consecutive runs from the repo root,
all 22 failures at their named stages (`AssertionError`, never a crash).

## Finding → resolution map

### F1.1 [MAJOR, green-side blocker] A1-R2, A1-R3, A1-R4, A1-R5 structurally unsatisfiable

**Finding (suite-blueteam §F1.1).** Each row asserted `openDescriptor(bad)` first returns `null`
("reaches the check") and then `descriptor_invalid` — on the SAME call. Under a correct v1.1
implementation every one of these descriptors MUST be refused at open (closed schema /
containment / deployment-root validation), so the first assertion could never pass (red-forever)
and the second already passes at HEAD (the descriptor is refused because `knowledge` is an
unknown top-level field) — the row was broken in both directions.

**Resolution.** Folded **fix 1 (the seam split)** for A1-R3/R4/R5 and **fix 2 (the message
discriminator)** for A1-R2, per the report's preference:

- A1-R3/R4/R5 now assert the parse and the construct as DIFFERENT stages: `loadMcpDescriptor`
  admits the well-formed `knowledge` field (`parseCode === null`, red at HEAD where the whole
  top-level field is unknown), then `createMcpServerFromDescriptor` fires the
  containment/deployment-root walk and refuses `descriptor_invalid` (the second assertion). The
  two assertions are on different calls and discriminate a correct impl (passes both) from HEAD
  (fails the first) and from a shallow parser that refuses at parse (fails the second).
- A1-R2 now discriminates by the refusal MESSAGE: a `refusalDetail` helper returns `{code,
  message}`, and the row asserts the message names the sub-field `knowledge.bogus` (the 
  `refusalCode`-style head seam — the whole top-level field — names `knowledge`, so HEAD is red
  at the "no knowledge field" stage; a correct impl names `knowledge.bogus` whichever seam fires).

Reworked rows: `impl/test/cross-deployment-knowledge-red.test.mjs` A1-R2…A1-R5.

### F1.2 [MAJOR, green-side blocker] R-R1's `eventTimeSeq === 2` contradicts the folded eventTime law

**Finding (suite-blueteam §F1.2).** R-R1 asserted the projected `finding:P1` carries
`eventTimeSeq: 2`. GT3 pins `eventTime(events, evidence, fallback)` (`coordination-store.mjs:410`):
`eventTimeSeq` is the MINIMUM `coordinationSeq` in the node's evidence refs. The primary's node
(event seq 2, evidence `[{coordinationSeq: 1}]`) derives with `eventTimeSeq: 1`. The assertion
rewarded a wrong implementation that re-anchors `eventTimeSeq` at the projected event's own seq.

**Resolution.** The assertion now reads
`assert.equal(projected.eventTimeSeq, 1, 'eventTimeSeq is the minimum evidence coordinationSeq (GT3), anchored at the primary\'s seqs — never a replica seq')`.
`observedSeq === 2` and `replica.ledgerHeadSeq() === 0` (the no-merge half) stay unchanged.

### F2.2 [MINOR] A1-R4 does not discriminate the containment walk from plain deployment-root validation

**Finding (suite-blueteam §F2.2).** A1-R4's symlink referent was an inert path; a lexical
resolver and a realpath containment walk could both pass or both fail indistinguishably.

**Resolution.** The symlink referent is now a VALID deployment root of THIS repo
(`deploymentRoot(dir('outside'), 'taskwave-outside', 'deployment-outside', repoIdv)` with
`resident/deployment.json` carrying the reader's repoId + a readable
`state/coordination/events.jsonl`) located OUTSIDE the repo. A lexical resolver ACCEPTS the
referent (it IS a real root with the right repoId), so only the realpath containment walk
(no symlinks out, `mcp-packaging-decisions.md:95-99`) refuses — the row pins the WALK, never
plain deployment-root validation.

### F2.4 [MINOR] The suite probes the refusal at the STORE verbs; the contract D3 names only the coordinator mutator seam

**Finding (suite-blueteam §F2.4).** A2-R1/R2 call `replica.addKnowledgeNode` /
`replica.promoteKnowledgeNode` directly on the store, bypassing the coordinator. The contract D3
said the refusal fires "at the coordinator mutator seam" — an impl enforcing ONLY inside the
coordinator's mutator proxy would stay red on A2-R1/R2. The contract's seam wording was narrower
than what the suite tests.

**Resolution (contract movement to v1.2).** `cross-deployment-knowledge-contract.md` D3 now names
the store verbs as enforcement points: `addKnowledgeNode` (`coordination-store.mjs:16283`) and
`promoteKnowledgeNode` (`coordination-store.mjs:16303`) refuse `knowledge_primary_conflict` inside
the store when constructed with federation opts where `resolve(primaryRoot) ≠
resolve(deploymentRoot)`; the coordinator's mutator seam (`COORDINATION_MUTATORS`,
`coordinator.mjs:272`, both verbs at `:277`) additionally guards the `admitWorkflowFinding` path
(A2-R3, wrapper `coordinator.mjs:11647`), while the store's `admitWorkflowFinding`
(`coordination-store.mjs:16207`) stays open (A2-P2). The refusal-vocabulary row and the A2
acceptance pin were re-worded to the two-seam posture.

### F2.6 [SOUND, minor note] A1-P1's freeze check covers only the top-level object

**Finding (suite-blueteam §F2.6).** A shallow impl that freezes the parsed descriptor top-level
but leaves the nested `knowledge` object mutable passes A1-P1.

**Resolution.** A1-R1 (the closed-field row) now also asserts
`assert.ok(Object.isFrozen(parsed.knowledge))` — the nested object is deep-frozen too, pinning
PKG-1's "read once, immutable" for the nested field.

### F3.2 [MINOR, missing row] D2 endpoint-closure not pinned behaviorally

**Finding (suite-blueteam §F3.2).** No row asserted the `task:<taskId>` endpoint cited by a
promotion edge appears in the projection; a buggy implementation that projects only promotion
nodes (dropping task nodes) passed the entire suite.

**Resolution.** New RED row **A4-R1** (D2 endpoint-closure): the primary promotes via
`verified_task_outcome` so the graph carries a `VerifiedBy` edge (`finding:P1 -> task:task:P1`,
the task node materialized by `task.created`); the row asserts the projected slice carries
`task:task:P1` AND every edge has both endpoints present in the slice (never a dangling edge).
Fails at HEAD (`no projection` — the slice is empty).

### F3.3 [MINOR, missing row] D2 edge-severing at projection build not pinned

**Finding (suite-blueteam §F3.3).** K-R2 pins the admission-side refusal only; the
projection-build severing of a `workflow_admitted` node's `DerivedFrom` edge (citing a local-only
candidate) was never exercised.

**Resolution.** New RED row **A4-R2** (D2 edge-severing): the fixture admits a workflow finding
in the primary via the #63 path (so the ledger holds a `knowledge.workflow_admitted` node with a
`DerivedFrom` edge to the candidate), then a strict replica `recallKnowledge` refuses
`knowledge_cross_root_denied` — the same typed code K-R2 pins on the admission side. Fails at
HEAD (`no cross-root denial`).

### F3.4 [MINOR, missing row] D5's read shape pinned only on `projectHorizon` and strict refusals

**Finding (suite-blueteam §F3.4).** No row asserted a SUCCESSFUL non-strict `knowledge.recall` on
a non-primary serves the primary's node with `{epochLag, sourceRoot}` and appends nothing to the
consumer ledger; a correct impl that frames `projectHorizon` but forgets the recall lane passed.

**Resolution.** New RED row **A5-R1** (D5/A6): on a fresh replica, a non-strict
`replicaCoord.recallKnowledge(query, reader, {idempotencyKey})` returns the primary's node with
`epochLag: 0` (integer, `ledgerHeadSeq − observedSeq`, never wall time), `sourceRoot:
'deployment-primary'` (the primary's deploymentId from resident/deployment.json at projection
build), the `UNTRUSTED_RECALLED_MEMORY` frame, AND `replica.ledgerHeadSeq() === 0` (a projected
read appends nothing — A6). Fails at HEAD (`no projection` — the local slice is empty).

### F4.4 [MINOR] K-R4's comment mis-states the D4 open-time check

**Finding (suite-blueteam §F4.4).** K-R4's comment said the ghost primary "IS a deployment root —
the D4 open-time check passes". Contract D4 requires a readable
`state/coordination/events.jsonl`; the ghost has the directory but no ledger, so a D4
descriptor-open would REFUSE it.

**Resolution.** K-R4's comment now states the ghost is a deployment root only by the
`resident/deployment.json` criterion; the descriptor-open (D4) is bypassed because the
store/coordinator are constructed directly with opts; the absent ledger is the D5 runtime
posture (`knowledge_primary_unreachable`). The row's behavior is unchanged.

### Stale in-test citations (report §Citation re-verification)

**Finding.** The suite's in-test citations were verified at the fold HEAD `79a7826`; the worktree
carries content that moved the `coordinator.mjs` / `application.mjs` / `application-semantics.mjs`
anchors. At the fold target HEAD `fb9f5c5` the anchors moved again relative to the report's review
HEAD `bcc2cd4`.

**Resolution.** Every citation in the suite, the contract, and this fold's map was re-verified at
`fb9f5c5` and re-anchored:

| Anchor | Report HEAD `bcc2cd4` | Fold target `fb9f5c5` (verified) |
|---|---|---|
| `recallKnowledge` | `coordinator.mjs:10705` | `coordinator.mjs:10705` |
| `serveKnowledge` | `coordinator.mjs:10732` | `coordinator.mjs:10732` |
| `admitWorkflowFinding` wrapper | `coordinator.mjs:11647` | `coordinator.mjs:11647` |
| `projectHorizon` | — | `coordinator.mjs:11974` |
| `taskHorizon` | — | `coordinator.mjs:11906` |
| `workflowHorizon` | — | `coordinator.mjs:11932` |
| `COORDINATION_MUTATORS` | `coordinator.mjs:272` | `coordinator.mjs:272` |
| both verbs in the mutator set | `coordinator.mjs:277` | `coordinator.mjs:277` |
| `promoteKnowledgeNode` callsites | `coordinator.mjs:13458` / `:6580` | `coordinator.mjs:13458` / `:6580` |
| `run.knowledge.seed` → `addKnowledgeNode` | `application.mjs:13201` | `application.mjs:13201` (`knowledgeSeed` `:13190`, dispatch `:12478`) |
| `knowledge.promote` liveMethod | `application-semantics.mjs:1511-1519` / `:1515` | `application-semantics.mjs:1509` / `liveMethod` `:1515` — at `fb9f5c5` `:1509` IS the `knowledge.promote` row (the report's `bcc2cd4` note that `:1509` was `repl.cite` no longer holds at this HEAD) |
| `index.mjs` coordination store | — | `index.mjs:1253` |
| `application-deployment.mjs` stateRoot | — | `application-deployment.mjs:1773` |
| `application-deployment.mjs` repoId | — | `application-deployment.mjs:187` |
| `coordination-store.mjs` wave registry `deploymentId` | — | `coordination-store.mjs:8117` |

The contract's Verification HEAD was updated from `79a7826…` to `fb9f5c5…` with the delta noted in
its header.

## Folded deliverables

- `impl/test/cross-deployment-knowledge-red.test.mjs` — reworked A1-R2…R5 (F1.1 seam split +
  message discriminator), corrected R-R1 (F1.2), tightened A1-R4 (F2.2) and A1-R1 (F2.6),
  added A4-R1/A4-R2/A5-R1 (F3.2/F3.3/F3.4), corrected K-R4's comment (F4.4), re-anchored
  citations; header inventory and VERIFIED SPLIT updated to 31 rows / 22 RED / 9 PIN.
- `docs/reference/evidence/cross-deployment-knowledge-2026-08-07/cross-deployment-knowledge-contract.md`
  — folded to v1.2 (F2.4 seam movement), Verification HEAD `fb9f5c5`, all citations re-anchored.
- `docs/reference/evidence/cross-deployment-knowledge-2026-08-07/suite-draft-notes.md` — updated
  for the folded 31-row suite (row map, invented surfaces, PIN list, implementer's checklist,
  hygiene).
- `docs/reference/evidence/cross-deployment-knowledge-2026-08-07/suite-fold-2.md` — this map.

## Verified split (two consecutive runs from the repo root)

```
$ node --test impl/test/cross-deployment-knowledge-red.test.mjs   # run from repo root
run 1: tests 31 · pass 9 · fail 22 · cancelled 0 · skipped 0 · todo 0
run 2: tests 31 · pass 9 · fail 22 · cancelled 0 · skipped 0 · todo 0
```

The 9 passes are exactly the PIN rows (A1-P1, A2-P1, A2-P2, A3-P1, A3-P2, S-P1, R-P1, K-P1, G1).
The 22 failures are the RED rows, each failing at its named stage — all `AssertionError`, never a
crash; the failing row set is identical across the two runs.
