# Seam slice 1 — the store's surface and recovery buckets move out

Issue #259, slice 1. The map (`docs/audits/2026-09-13-runtime-policy/seam-map.md`, §5) ordered the
split by measured payoff and put `coordination-internals.mjs` + `coordination-replay.mjs` first: the
store's `surface:no_authority_touched` fallback and its named reconcile/replay/recover paths were
already separated from everything else. This slice is that move.

Revision under audit: `13225664` plus this slice's working tree. Write scope: the two new modules, the
store, `impl/scripts/seam-inventory.mjs` (two rules) + its regenerated artifact,
`impl/test/coordination-internals.test.mjs`, and this file. No other file changed — in particular
`impl/scripts/expected-red-tests.json` is untouched.

The invariant the slice holds itself to: **no behavior change**. Every member keeps its name, parameter
list, arity, return shape and error codes; the store keeps every call site; no durable format, segment,
digest, or idempotency key moves.

## 1. What moved

136 of the 150 members the map placed in those two buckets leave the class. Each one keeps a delegate
on `CoordinationStore` — same name, same parameter list, same arity — so the class's own call sites and
every external caller are untouched.

| bucket | moved | into | state convention |
| --- | ---: | --- | --- |
| `surface` (fallback) | 95 of 100 | `impl/src/coordination-internals.mjs` | `(state, …)` for the one collection the body reads; `(store, …)` when it reads several or calls back |
| `recovery` | 41 of 50 | `impl/src/coordination-replay.mjs` | `(store, …)`; the validators that read no state take only their own arguments |

Of the 136: **54** take the one collection they project (`events(state, …)`), **66** take the store, and
**16** read no state at all. No helper is ever bound to an implicit receiver — the modules contain no
`this` outside the two relocated error classes' constructors (pinned by `CI1`).

The moved bodies also pull the primitives they need out of the store's module scope: **28 declarations**
(canonicalization, `digest`/`canonicalDigest`/`sha256Bytes`, `clone`/`freeze`, `boundedText`,
`validRunId`, `scratchpadScopeKey`/`replFenceKey`, the segment/ledger constants, the vendored MAD
oracle) with the **17 imports** those need. Five of them —
`CoordinationIntegrityError`, `CoordinationRefusal`, `BRIEFING_SCHEMA_FIELD_SOURCES`,
`MAX_CONTEXT_PACK_BODY_BYTES`, `MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS` — are re-exported from
`coordination-store.mjs`, so every existing import path still resolves to the same binding.

The layering is one-way and acyclic: the store imports the two modules, and neither imports the store
(`CI1` fails on that import).

<details>
<summary>All 136 moved members, by module</summary>

`impl/src/coordination-internals.mjs` (95):

```
KNOWLEDGE_CANDIDATE_TRIGGERS _boardGrantItemRow _boardGrantReportRow _cachePreview _contextArtifactRead
_contextArtifactVerification _contextCallRunId _contextEffectCallCore _contextPackageProvenance
_knowledgePayload _knowledgeProjectFence _knowledgeStaleness _madConfidence _prepareContextPackPayload
_providerAdverseCeilings _providerContribution _recallAssessmentCandidate _runIdentityHasEffects
_scratchCorrectionPrefix _scratchpadResolveForWorker _setKnowledgeEdge _setKnowledgeNode _sortedBoardItems
_supersessionWouldCycle _taskByRun _taskTopologyHint _ttlTarget _waveMembershipOf advisoryFeedCards
affectedReaders artifact bindingFence boardFence boardGrant boardItem boardItemVersions campaignPlan
campaignPlans composeBriefingPack contextCell contextPack contextPackHead contextPackage
contextPackageAttachments contextProgramAuthority contextSession dueProviderProcessing eventFence events
fleetDrain goalPlanRunIds healthCheck integrationAuthority mcpCall mcpCallByScope observationTime
priorCoordinationEvent providerProcessing publicationAuthority readyTasks recallAssessments repositoryId
representationProduction representationProductionByRequest reuseDecision reuseRiskGuard reuseSubjectHead
reverifyRepresentationProduction run runChildren runControl runControls runDescendants runLineage
runOrchestratorLease runResultExport runStop scratchpadFence scratchpadSnapshotBatch swarm swarms task
taskResourceRelease taskTopology taskTopologyNode traceKnowledge unsettledPlanNodeTasks waveClosure
waveClosures waveRegistry waveRoleRun webCommand webCommandByScope withContextArtifactVerification
workerGeneration
```

`impl/src/coordination-replay.mjs` (41):

```
_ensureCanonicalOrderReceipt _load _loadSegmentState _normalizeRecoveryAttemptAdmission
_normalizeRecoveryAttemptCompletion _normalizedPlanRecoveryCreatedPayload _normalizedRecoveryClaimedPayload
_normalizedRecoveryCreatedPayload _openCanonicalOrderLedger _planRecoveryRequestFields
_readCanonicalReceipt _recoveryAttemptFailure _recoveryAttributionFromClaim _recoveryBatchIdentity
_recoveryFailure _reloadProjection _reportStartup _scratchpadReapReceipt _validPreservedContinuationReceipt
_validateGoalPlanReplayTransactions _validateRecoveryAttemptCompletionPayload
_validateRecoveryDispositionPayload _validateRecoveryRefinementPair _validateRecoveryReplayTransactions
_verifiedRecoveryPrior admitRecoveryAttempt completeRecoveryAttempt completeRecoveryDispatch
createAndClaimPreservedResumeRefinement createAndClaimRecoveryRefinement orphans pendingRecoveryAttempts
reapExpiredContextPacks reapRunScratchpads reconcilePlanGatedTask reconcilePlanRevisionTask
recordRecoveryContinuationIntent recoveryAttempt recoveryAttemptHead recoveryDispatchState startupStatus
```

</details>

Each function is a verbatim body: `this.<member>` became the explicit parameter, sibling replay paths
call each other inside the module, and the store's stay-behind members are reached as `store.<member>`.
String, template, number and regex literals were compared line-for-line against the original member
before anything was written — the generator refuses a body whose literals drift.

## 2. What stayed, and why

14 of the 150 keep their bodies in the store: 5 from the surface bucket
(`_acceptanceRevocationRequest`, `_contradictionListRequest`, `_contradictionResolutionRequest`,
`_scratchCorrectionRequest`, `scratchFactOracleTarget`) and 9 from recovery
(`_restoreProjectionCheckpoint`, `_validPreservedResumeAttestation`, `_validateGoalPlanDispatchPair`,
`_validateGoalPlanRecoveryTriple`, `_validateRecoveryAttemptAdmissionPayload`,
`_validateRecoveryContinuationPayload`, `_validateRecoveryRefinementRequest`,
`_validateRecoverySessionRequest`, `createAndClaimPlanRecoveryRefinement`).

They are not hard to move, and none of them changes behavior by staying. Each carries a line that two
suite-pinned source scans key to `coordination-store.mjs` **by path**, and moving it turns a currently
green test red:

- `impl/test/frame-economics-red.test.mjs` (`F1`, the byte-literal ratchet) walks `impl/src/**/*.mjs`
  for catalogued byte-value spellings and byte prose and exempts sites per file. The first, complete
  move relocated 24 lines carrying `4_096` / `8_192` / `32_768` / `1024 * 1024` identity bounds into the
  new modules, and F1 failed with exactly those 24 lines (for example
  `boundedText(context.worktree, 32_768)` and `Buffer.byteLength(fields.taskId) > 4_096`).
- `impl/test/worker-verdict-surface-red.test.mjs` (`C4`, `E4`) greps `coordination-store.mjs` for the
  recovery-refinement digest pin (`canonicalDigest(fields.brief)`), which lives in
  `_validateRecoveryRefinementRequest`.

Both tests are outside this slice's write scope, so the 14 members stay — bodies unchanged, still
reached as `store.<member>` from the moved replay paths — until slice 2 relocates those exemptions and
pins into the modules. `impl/test/coordination-internals.test.mjs` (`CI6`) pins the list, the pin the
grep depends on, and the fact that none of the 14 delegates, so the debt is visible where the move is
reviewed instead of only in the two files that enforce it.

The store's fallback bucket therefore shrinks rather than empties: the 5 fallback members that stayed
are still reported as `surface:no_authority_touched`.

## 3. Size

| file | before | after |
| --- | ---: | ---: |
| `impl/src/coordination-store.mjs` | 18 043 | 16 478 |
| `impl/src/coordination-internals.mjs` | — | 993 |
| `impl/src/coordination-replay.mjs` | — | 1 233 |

The 136 moved members were 1 788 lines of store source and are 408 lines of delegates (three lines
each, generated — the parameter list is the member's own). The 14 that stayed are 717 lines and did not
move. The remaining delta is the 28 relocated primitives and the header/import bookkeeping.

## 4. The map

`impl/scripts/seam-inventory.mjs` gains two evidence rules, both commented at their definitions:

- `recovery:replay_port` — the member's body delegates into `coordination-replay.mjs`;
- `surface:internals_port` — the member's body delegates into `coordination-internals.mjs`.

They are evidence, not a name heuristic: a one-line delegate is exactly what it says it is. Without
them the delegate keeps whatever its name suggests — `_load`, a restart path by every other measure in
the catalogue, would land in `observation` on `read_name`, and `SI4` pins `_load` as `recovery`.

The store, before and after (members are constant: 572 both times):

| seam | slice 0 | slice 1 |
| --- | ---: | ---: |
| admission | 173 | 169 |
| effect | 22 | 22 |
| observation | 227 | 223 |
| recovery | 50 | 50 |
| surface | 100 | 108 |
| — of which the fallback | 100 | 5 |

Three counts move for reasons worth naming:

- **surface 100 → 108**: the 95 delegates carry `surface:internals_port` instead of the fallback, and 8
  forwarding members that were resolved by delegation (`contextCalls`, `contextCallArtifacts`,
  `contextCallContents`, `contextCompletedCallSource`, `contextCompletedCallSourceAndArtifacts`,
  `composeCampaignBriefing`, `recallPreview`, `traceKnowledgeBounded`) now inherit `surface` from the
  moved projections they forward to instead of `observation`/`admission` from a name rule.
- **admission 173 → 169, observation 227 → 223**: the same 8 members' votes, split across the two seams
  they used to inherit.
- **recovery stays 50**: 41 delegate, 9 keep their bodies.

The corpus-wide fallback bucket — the map's own measure of how much the split has placed by hand —
drops from 150 (coordinator 30, application 20, store 100) to 55 (coordinator 30, application 20,
store 5). The store's share is now exactly the five members that stayed.

`TARGETS` is deliberately **not** extended to the new modules. The map's contract is the members of the
three classes, and every moved member still appears exactly once, as a delegate whose evidence names
the module that now holds its body. Classifying the new modules would need a module-scope collector
(they export plain functions, not classes) and a broadened `(this|store)` authority vocabulary — the
call rules match `this._load(`, and the moved bodies call `store._loadSegmentState(` — which would
silently reclassify members of `coordinator.mjs` and `application.mjs` as well. That is slice 2's
question, not this move's; making the change here would have widened an audit artifact three files
beyond the slice.

## 5. Evidence

**The move is behavior-preserving.** The same fixture (create, idempotent retry, claim, restart through
the moved `_load`) run against the pre-move store and the moved store produces byte-identical output:
the ledger bytes and their SHA-256, the projection snapshot and its digest, the event stream, task
records, startup report, ready set, topology, health, and the post-restart projection digest. The
fixture's values are pinned in `CI5`.

**The helpers are pure or explicitly state-fed.** `CI3` calls every exported helper of both modules
against two independently built, identically seeded stores and requires identical values (or identical
refusals); the helpers that take one collection are also required not to write it. `CI1` proves
context-freedom structurally (no `this`, no `let`/`var`, no module-level binding ever assigned, no
store import). `_cachePreview` is the one moved member that writes the collection it reads — it is a
cache — and it therefore takes the store, not a slice.

**Names, arities, and the port are pinned.** `CI4` checks all 136 moved members against the class: each
is still declared, each delegate carries the member's own parameters, and `Function.length` on the
prototype (or the static getter's descriptor) is unchanged. `CI2` requires the committed map, the
delegates and the modules' exports to agree, one delegate per helper, and every name the store imports
from a moved module to exist.

**Commands run:**

```
node impl/scripts/run-suite.mjs        # the canonical verdict
node impl/scripts/surface-gate.mjs     # surface-gate: ok
node impl/scripts/seam-inventory.mjs   # seam-inventory: ok (regenerated with --write)
node --test impl/test/coordination-internals.test.mjs   # CI1–CI6 green
```

The verdict for this worktree is RED, and so is the pristine baseline's — the honest comparison is with
a baseline run in the same environment (a copy of this worktree with `coordination-store.mjs` restored
from `13225664`, the two new modules and the new test removed, and a fresh single-commit Git root):

| run | verdict |
| --- | --- |
| this slice | RED — 4497 passed, 588 expected red (140 of them cancelled by a dangling await earlier in their file), 23 unexpected, 1 stale expectation, 0 hung, 0 stalled lanes |
| pristine baseline | RED — 4490 passed, 588 expected red (140 cancelled), 24 unexpected, 1 stale expectation, 0 hung, 0 stalled lanes |

The baseline's two extra rows are artifacts of how that sandbox was built, not of the code: it was
assembled from a copy of this worktree, so it carries the **regenerated** seam artifact against the
**restored** store, and `seam-inventory.test.mjs` SI2/SI3 correctly refuse that stale map. Subtract
them and the baseline's 22 are this slice's 22, name for name; the one row this slice adds on top of
that set is a load flake, below.

Twenty of the 22 are the same environmental refusal: `application-deployment.mjs:1273` reports
`route_credentials_unprojected` — "No provider credential is projected into the worker runtime for this
route" — because this host has no provider credentials for those routes. The remaining two
(`phase78-concise-deployment-factory` DF3/DF6, whose route-card validation reads false) are likewise
identical at the baseline revision. None of the 22 touches the store's moved members.

Two rows move between runs without the code moving, and both were checked rather than explained away:

- `test/phase78-grok-auth-readiness.test.mjs :: GR1` failed in the suite's parallel lanes and passes
  6/6 in isolation **in both trees** — a load flake (the file drives Grok auth readiness).
- `test/phase51-process-lifecycle.test.mjs :: kimi` is the stale expectation in both runs: red in one
  run of this tree, green in another, passing in isolation. Its row stays in `expected-red-tests.json`;
  the move did not turn it, and deleting a row for a test the move did not fix is the failure the stale
  check exists to catch.

Two failures **were** caused by this move and are fixed rather than explained: the first complete move
turned `frame-economics-red` F1 red (24 lines) and `worker-verdict-surface-red` C4/E4 red (the digest
pin left the file they grep). Both are green again after the 14 members above stayed, and no
`expected-red-tests.json` row was added, removed, or altered.

## 6. What this slice does not claim

- The class is not smaller in members — it is smaller in code. All 136 moved members still exist as
  delegates; inlining them into their call sites (and deleting the ones with no external caller) is
  slice 2's move, and the map's `internals_port` / `replay_port` evidence is how it will find them.
- 14 members did not move, for the two pinned-scan reasons in §2.
- The map does not classify the new modules yet (§4), so the seam distribution *inside*
  `coordination-internals.mjs` / `coordination-replay.mjs` is not measured. The modules' shape is
  pinned by `coordination-internals.test.mjs` instead.
- The seam map document itself (`seam-map.md`) is slice 0's audit at revision `bfdebd53`; its §2 table
  and its §4.4 finding ("all 100 of the store's surface members are fallback") describe that revision.
  The committed artifact is the live map; this file records the delta.
