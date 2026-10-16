# Seam slice 10 — the coordinator's observation bucket moves out

Issue #259, slice 10. Slice 9's first tranche proved the coordinator's effect members can record
through the injected recorder port (slice 6); the map's §5 orders `runtime-observation.mjs` next —
the event-handler family split is only safe once the effect and observation ports exist, and the
effect port is now proven. This slice moves the coordinator's observation bucket — the read
projections and the write-receipt minters — into `runtime-observation.mjs`.

Revision under audit: `d015626f` (slice 9's first tranche) plus this slice's working tree. Write
scope: the new module, `impl/src/coordinator.mjs`, `impl/scripts/seam-inventory.mjs` + its
regenerated artifact, `impl/test/runtime-observation.test.mjs`, four migrated source-pin suites
(`turn-checkpoints-31b-red`, `surfacing-matrix-red`, `worker-verdict-surface-red`,
`frame-economics-red`), and this file.

The invariant the slice holds itself to: **no behavior change**. Every member keeps its name,
parameter list, arity, return shape and error codes; the coordinator keeps every call site; no
durable format moves.

## 1. What moved

142 of the bucket's 143 members — 3 368 lines of coordinator source — leave the class behind
same-name, same-parameter-list, same-arity delegates. The one exclusion is `_providerBrief`: it is
already slice 3's briefing-port delegate, and routing it through this module would add a hop with no
extraction value. The class still carries it; the map still shows it as `observation` on
`observation:brief_port`.

The two generator members (`_seedCoordinationTasksPasses`, `_terminalizeUnattachedCoordinationTasks`)
delegate with `yield*` (the slice-8 shape); the ten async members keep `async`. Self-calls to moved
members route through the class delegate (`coordinator.<member>(...)`), so instance-level stubs keep
firing — `RO3` proves it by patching `recordWorkerGeneration` on an instance and observing the patch
fire from inside the moved `_dispatch`. The one call-through spelling, `promoteWorkflowFinding`'s
`admitGate.call(this, …)` (the KS3 spy-honoring idiom), becomes `admitGate.call(coordinator, …)`.

Recording inside moved bodies reroutes through the port exactly as slice 9 pinned:
`this._log.append(` → `recorder.log.append(` (36 sites), `this._coordMapEvent(` →
`recorder.mapEvent(` (16), `this._coordRecord(` → `recorder.recordDriver(` (6), `this._coordination`
→ `recorder.coordination` (145). The census is generated, counted, and pinned in `RO3`.

**The read/write split question.** The bucket reads as two families — 56 read projections
(`workerActivity`, `contextRead`, `boardSnapshot`, the horizons) and 87 write-receipt minters
(`_mint*`, `_record*`, `_observe*`, the scratchpad/board/drain settlement paths) — and the
assignment left one module or two to this slice. It does not split cleanly: 41 of the 104 in-bucket
self-call edges cross the family line (the projections compose the minters' helpers —
`_coordTransition`, `_coordMapEvent`, `_collectDigest` — and the minters drive the projections).
One module, one contribution; the families are sectioned in the module's header order, not in
separate files.

**The relocated helpers and the closure bug the rehearsal caught.** The moved bodies read 11
coordinator-scope helpers (`noop`, `pathInScope`, `closedVerificationVerdict`,
`permissionsForWaveRole`, `projectHorizonScratchpad`, `settlementCandidacyTitle`,
`workerEditedPathsOf`, `workerObservedCommitsOf`, `workerToolTitleOf`, and the consts
`ATTENTION_COALESCE_WINDOW_MS`, `PROVIDER_AUTH_EXPIRED`), which move with them. The first cut
relocated exactly those 11 — and the pause projection timed out across the behavioral sweep:
`closedVerificationVerdict` reads seven coordinator-local consts of its own (`closedExecution`, the
`CLOSED_VERIFIER_*` tables, `intOrNull`, `hex64OrNull`, `boolOrNull`), `pathInScope` reads
`globRegex`, `workerObservedCommitsOf` reads `TURN_PROGRESS_COMMIT_RE`. A relocated helper that
reads an unrelocated name throws `ReferenceError` at call time — no parse or load error catches it.
The generator now computes the transitive closure (21 declarations), emits it in source order, and
imports back exactly the three names staying code still reads (`closedVerificationVerdict`, `noop`,
`pathInScope` — the rest are read only by moved members). A token-level inverse-transform audit
(`this`→`coordinator`/`recorder` normalized back) proves all 142 bodies otherwise identical to the
pre-move text.

## 2. The map

One target, one rule: `{ file: 'impl/src/runtime-observation.mjs', className: null, receiver:
'coordinator' }`, and `observation:observation_port` (weight 3) matching
`runtimeObservation.<member>(`. Without the rule a three-line delegate like `_coordMap` — whose only
evidence was the coordination authority its body reached — would fall to the surface fallback.

The corpus reads 2 297 members (2 145 + 152: the 142 bodies plus the 10 relocated function
declarations; the consts are not members). Every one of the 142 class delegates keeps `observation`.

Sixteen module bodies reclassify on the port spelling (`recorder.coordination` is not the
catalogue's `this._coordination`, so the observation evidence the append had carried does not fire
module-side): `drain`, `readProviderStatus`, `claimScratch`, `postScratchFact`, `writeScratchpad`,
`_answerContextRead`, `_recordOrientationRating`, `boardFence`, `boardSnapshot`, `bindingFence`,
`replBindingSnapshot`, `resolveReplCitation`, `_isReviewAuthority`, `_attentionPage` read
`admission`; `_semanticControlBinding` and `_send` read `surface:no_authority_touched`. The class
delegates pin the seam that matters for the split; `RO5` names the 16 so the delta is reviewed here,
not discovered later.

## 3. The pins that keyed code to the coordinator file

Four suites scanned `coordinator.mjs` for source text this slice moved:

- `turn-checkpoints-31b-red` E2 (the stall guard's verbatim comparison) and
  `surfacing-matrix-red` SM-4 (the horizon viewer-scope guard) now resolve the member through
  `test/seam-member-source.mjs` — the pin names `_armWatchdog` / `workflowHorizon`, not a file.
- `worker-verdict-surface-red` E3 (the closed verifier enum's source order) reads
  `runtime-observation.mjs` — the enum's home moved; the pin's text says so.
- `frame-economics-red` F1: `_collectDigest`'s route-observation result cap (`32_768`) gains the
  module's row beside the coordinator's, the slice-8 pattern.

## 4. Size

| file | before | after |
| --- | ---: | ---: |
| `impl/src/coordinator.mjs` | 14 141 | 11 025 |
| `impl/src/runtime-observation.mjs` | — | 3 768 |

## 5. Evidence

- `RO1`–`RO5` green: one-way imports with zero `this` in the module; the 142 delegates pinned
  against the map on name, parameter list, arity (a 142-entry pre-move `Function.length` table), and
  the `this._recorder` handoff; the reroute census; the instance-patch probe; the relocation census
  and import-back list; the map target and the 16 named reclassifications.
- Commands run (in the shared checkout at `d015626f` plus the slice; `BATON_HOST_CAPACITY_DISABLED=1`
  per this host's documented operator bypass):

```
node impl/scripts/seam-inventory.mjs --write   # regenerated after the last source edit; check mode: ok (2 297 members)
node impl/scripts/surface-gate.mjs             # surface-gate: ok
node impl/scripts/run-suite.mjs test/runtime-observation.test.mjs test/runtime-effects.test.mjs \
  test/coordinator.test.mjs test/doubt-review-red.test.mjs test/bidirectional-v3-red.test.mjs \
  test/coordination-ledger.test.mjs test/issue286-ceilings.test.mjs \
  test/issue367-context-read-attempt-counters.test.mjs test/bidirectional-driver-red.test.mjs \
  test/issue299-tool-row-digests.test.mjs test/provider-fault-death-red.test.mjs \
  test/phase11-acceptance-integration.test.mjs test/claim-preflight-red.test.mjs \
  test/member-wedge-boundary-red.test.mjs test/native-completion-loop.test.mjs \
  test/omp-question-coordinator.test.mjs test/tg3-window-red.test.mjs \
  test/turn-checkpoints-31b-red.test.mjs test/peer-messages.test.mjs test/reply-chains-red.test.mjs \
  test/workflow-surface-red.test.mjs test/phase43-provider-reconciliation.test.mjs \
  test/cross-deployment-knowledge-red.test.mjs test/phase11-coordination-store.test.mjs \
  test/surfacing-matrix-red.test.mjs test/frame-economics-red.test.mjs \
  test/worker-verdict-surface-red.test.mjs test/seam-inventory.test.mjs test/runtime-recovery.test.mjs \
  test/runtime-recorder-port.test.mjs test/create-driver-wiring.test.mjs
#   507 passed, 68 expected red, 1 unexpected
```

The one unexpected row is `phase43-provider-reconciliation` AF5/AF6, which fails identically at the
pre-move revision in this checkout (measured twice: the scratch rehearsal worktree and this
checkout) — the host's environment, matching slice 3's record of the same two rows. This slice adds
no failing row.

## 6. What this slice does not claim

- The members are delegates, not gone: inlining them is a later slice's move, and
  `observation:observation_port` is how it will find them.
- `_providerBrief` stays slice 3's delegate by design.
- The 16 module-body reclassifications are a map-reading note, not a seam claim; no recorder-spelling
  catalogue rules were added (the delegates carry the seam).
- The admission bucket is slice 11.
