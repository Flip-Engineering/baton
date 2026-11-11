# Seam slice 12 — the entangled effect set splits admission from effect (runtime-effects tranche 2)

Issue #259, slice 12. This is the design act slice 9 and slice 11 carried forward: the four
entangled effect members the map's §3 order leaves after slice 9 — `stopRunTargets`, `_integrate`,
`_deliver`, `_finalizeStop` — do not move verbatim. Each carries an admission prefix that belongs
to `runtime-admission.mjs`; the effect remainder moves to `runtime-effects.mjs` under slice 9's
recorder-port discipline. The execution contract is
`docs/audits/2026-09-13-runtime-policy/seam-effects-tranche-2-design.md` (9d83c4ca, corrected
390a19f1: the import rule is one-way — effects may import admission, admission never imports
effects); this file records what landed.

The invariant is the program's standing one: no behavior change. Every refusal, throw, log row,
coordination write, return value, and await-hop count keeps its exact shape and ordering.

Revision under audit: `499ae7e0` plus this slice's working tree. Write scope:
`impl/src/coordinator.mjs`, `impl/src/runtime-effects.mjs`, `impl/src/runtime-admission.mjs`,
`impl/src/runtime-recovery.mjs`, `impl/src/runtime-observation.mjs`,
`impl/scripts/seam-inventory.json` (regenerated), `impl/test/runtime-effects.test.mjs`,
`impl/test/runtime-admission.test.mjs`, `impl/test/runtime-recovery.test.mjs`,
`impl/test/runtime-observation.test.mjs`, `impl/test/phase51-process-lifecycle.test.mjs`,
`impl/test/turn-checkpoints-31b-red.test.mjs`, and this file.

## 1. What moved

| member | lines | split |
| --- | ---: | --- |
| `stopRunTargets` | 196 | admission `_admitRunStopTargets` (target-list validation, drain-token/closed check); effect remainder keeps the convergence loop; the two closures lift to `cancelRunStopTarget` / `attemptRunStopTarget` carrying `state = { actor, deadline, dispositions, recoveredSignals }` |
| `_integrate` | 172 | admission `_admitIntegration` (the seven refusal throws); effect remainder keeps the record/kill/worktree/verify sequence |
| `_deliver` | 182 | admission `_admitDelivery` (the whole refusal chain, returning the closed descriptor union); effect remainder dispatches the handoff or performs the delivery |
| `_finalizeStop` | 189 | no admission prefix (the `waiter.finalized` guard is waiter state); moves wholesale |

Each admission prefix is a named export of `runtime-admission.mjs`; the effect remainder is a
module function with the member's own name in `runtime-effects.mjs` that calls the prefix first
(`runtimeAdmission._admit*(...)`), so the body reads admitted → act → record. The delegates on the
class are plain non-async forwarders, the slice-11 convention.

`_deliver`'s descriptor union is the design's closed set, pinned in `RE6`:

```
{ admitted: false, result }                    // refusal; the effect body returns result unchanged
{ admitted: true, handoff: null }              // proceed to fence issue and delivery
{ admitted: true, handoff: 'preservedSuccessor' }
{ admitted: true, handoff: 'followUp' }
{ admitted: true, handoff: 'nudgeTurn', pause }
{ admitted: true, handoff: 'interruptThenGoverned' }
```

Handoffs call the receiver members (`coordinator._deliverPreservedSuccessor`,
`coordinator._deliverFollowUp`, `coordinator.nudgeTurn`, `coordinator._interruptThenGoverned` —
all staying members), so instance patches keep firing across the boundary.

### The one deviation from the design doc: the run-stop startup wait

The design put `await Promise.all(coordinator._startupCleanupPromises)` and the
`coordinator_run_stop_incomplete` throw inside an **async** `_admitRunStopTargets`. An async
admission prefix adopts one promise-settlement hop between admission and the act — the slice-11
delegate lesson one level in — and the hop is observable: phase91's P91-12 (a stop must win
against a preserved-successor delivery racing it) failed with it and passes without it. The prefix
is therefore sync (validation + drain/closed check only); the startup-reconciliation wait and its
throw stay in the effect body at their verbatim position, and `RA6` pins all three prefixes sync.

### The one addition to the design doc's relocation table: the closed-verdict family

`_integrate`'s effect remainder calls `closedVerificationVerdict`, which lived in
`runtime-observation.mjs` — and observation already imports effects (`PublicationError`,
`WORKTREE_FAILURE`). An effects → observation import would close the two-cycle the corrected §6
forbids. The helper and its closure (`CLOSED_VERIFIER_OUTCOMES`, `CLOSED_VERIFIER_OWNERS`,
`CLOSED_VERIFIER_EXECUTIONS`, `CLOSED_VERIFIER_DIAGNOSTICS`, `hex64OrNull`, `boolOrNull`,
`intOrNull`, `closedExecution` — read by no staying observation member) moved to the
runtime-recovery base layer beside `noop`; `runtime-observation.mjs` re-exports every moved name,
so its export surface is unchanged (`RR7` pins identity, not copies). The corpus rows reconcile as
observation 150 / recovery 65 (the doc's table said 151/64; total 2 415 stands).

## 2. Shared declarations that relocated

Per the design's §2, to the runtime-recovery base layer: `ORIENTATION_DELIVERY` (Symbol),
`IntegrationError` (class), `noop`, plus the closed-verdict family (§1). `coordinator.mjs` imports
`ORIENTATION_DELIVERY` and `IntegrationError` back and re-exports `IntegrationError` beside
`ModelSelectionError`/`PublicationError`, so `index.mjs`'s package surface and the
`instanceof IntegrationError` pins in phase11 resolve to the same class object (`RR4`, `RE4`'s
surface shape extended in `RR7`).

## 3. Recording reroutes

Slice 9's four reroutes with the design's one generalization: the log facade's other faces follow
`append`, so `this._log.` → `recorder.log.` (the new spelling is `_deliver`'s three
`recorder.log.tail(workerId)` reads). The census, generated and pinned (`RE3` / `RA3`):

| member | log.append | log.tail | mapEvent | recordDriver | coordination |
| --- | ---: | ---: | ---: | ---: | ---: |
| `stopRunTargets` + closures | 3 | 0 | 3 | 0 | 0 |
| `_integrate` | 4 | 0 | 3 | 3 | 4 |
| `_deliver` (effect) | 5 | 3 | 0 | 0 | 2 |
| `_admitDelivery` (prefix) | 2 | 0 | 0 | 0 | 2 |
| `_finalizeStop` | 2 | 0 | 4 | 0 | 0 |

Every total equals the pre-move body's count through the class authorities the port fronts. The
inverse-transform audit reconstructed each pre-move body from the landed parts token-for-token
(624 / 820 / 703 / 744 tokens, identical) — the split's only text beyond the reroutes is the glue
this file names: the descriptor wraps, the handoff dispatch, the state record, the lifted-closure
headers, and `_integrate`'s `strategy` recompute (the admission prefix computes the same local for
its own checks; the effect re-derives the identical expression rather than widening the admission
return).

## 4. The map

No new target and no new rule: the `runtime-effects.mjs` / `runtime-admission.mjs` targets and the
port rules (`effect:effects_port`, `admission:runtime_admission_port`) match the new call sites
unchanged. The corpus reads **2 415 members**: coordinator 424 (the four bodies become delegates),
runtime-effects 10 (the four remainders, the two lifted closures, the slice-9 four),
runtime-admission 102 (+3 prefixes), runtime-observation 150 (−2), runtime-recovery 65 (+2). The
SI6 per-target pin (3be46fe4) lands independently through the root gate; its
coordinator/admission/effects/observation/recovery rows reconcile to 424/102/10/150/65 when this
slice lands after it.

One honest evidence note: `cancelRunStopTarget`'s only module-side authority is the cancellation
row it appends, so the classifier says `observation`; `RE5` names it the way RO5 names its
port-spelling reclassifications. `attemptRunStopTarget` keeps `effect`.

## 5. Pins that followed their members

- `turn-checkpoints-31b-red` F4: the `control.nudge` lane literal lives in `_deliver`; the pin
  reads it through `memberSource('_deliver')`.
- `worker-verdict-surface-red` E3: the `CLOSED_VERIFIER_DIAGNOSTICS` enum pin follows its
  declaration to runtime-recovery.mjs (the order and the closed set are unchanged).
- `issue473-stop-incomplete-typed`: the run-stop leg's roster follows the split —
  `stopRunTargets`, `_admitRunStopTargets`, `cancelRunStopTarget`, `attemptRunStopTarget` —
  with the leg's code set unchanged.
- `phase51-process-lifecycle` PL10: the `reaped.confirmed && reaped.signaled` predicate lives in
  the lifted `attemptRunStopTarget`; the pin reads `memberSource('attemptRunStopTarget')`.
- `runtime-recovery` RR1/RR4 (+ new RR7): the error-class exemption gained `IntegrationError`;
  the re-export line gained it too; the base-layer/identity claims pin the slice-12 relocations.
- `runtime-observation` RO5: 152 → 150 (the two helpers re-exported, not defined, here).
- `runtime-admission` RA3/RA5 (+ new RA6): census totals gained `_admitDelivery`'s two appends and
  two coordination reads; the target carries 102 members; the prefixes' shapes, sync-ness, and
  refusal codes are pinned.

## 6. Evidence

- `RE1`–`RE6` green, including: the acyclic import order (effects imports admission; neither
  imports observation/coordinator/application); the delegate census extended to the seven
  `effects_port` delegates; the descriptor union as a closed set; one driven instance of each
  moved member observed recording through the port on a real coordinator (`_deliver` a nudge,
  `_finalizeStop` a kill confirmation, `stopRunTargets` the convergence; `_integrate`'s driven
  recording proof is phase11's CK8/CK9 poisoned-write pair).
- `RA1`–`RA6`, `RO1`–`RO5`, `RR1`–`RR7` green.
- The race pin: phase91 P91-12 red with an async `_admitRunStopTargets`, green with the sync
  prefix (§1) — the hop count is the pre-move timing exactly.
- `node impl/scripts/seam-inventory.mjs` check mode: ok (2 415 members); regenerated after the
  last source edit. `node impl/scripts/surface-gate.mjs`: ok.
- Commands run (this checkout at `499ae7e0` plus the slice; `BATON_HOST_CAPACITY_DISABLED=1` per
  this host's documented operator bypass):

```
node impl/scripts/run-suite.mjs test/runtime-effects.test.mjs test/runtime-admission.test.mjs \
  test/runtime-recovery.test.mjs test/runtime-observation.test.mjs test/seam-inventory.test.mjs \
  test/create-driver-wiring.test.mjs test/turn-checkpoints-31a-red.test.mjs \
  test/turn-checkpoints-31b-red.test.mjs test/phase51-process-lifecycle.test.mjs \
  test/phase91-semantic-interrupt-preservation-red.test.mjs test/issue473-stop-incomplete-typed.test.mjs
#   GREEN — 195 passed, 0 unexpected
node impl/scripts/run-suite.mjs test/coordinator.test.mjs test/phase56-drain-and-close.test.mjs \
  test/issue350-stop-settles-membership.test.mjs test/issue428-worktree-custody-on-stop.test.mjs \
  test/phase70-preserved-stop.test.mjs test/omp-question-coordinator.test.mjs \
  test/native-completion-loop.test.mjs test/bidirectional-driver-red.test.mjs \
  test/worker-delivery-push-red.test.mjs test/phase11-acceptance-integration.test.mjs \
  test/phase11-control-integrity.test.mjs test/turn-checkpoints-31a-red.test.mjs \
  test/issue459-integrate-off-loop.test.mjs test/issue463-integrate-gate-paths.test.mjs
#   GREEN — 267 passed, 0 unexpected
npm test --prefix impl   # the canonical suite
#   6235 passed, 453 expected red, 22 unexpected, exit 1 — every unexpected row reproduces
#   identically at the swarm base 90828b30 (and at the master tip cbc7a00d) on this host:
#   phase42-policy-invalidation (7), phase11-persistent-sessions (4, event-loop-stall reds),
#   phase43-hmac-webhook AF2/AF7/AF10, phase43-provider-reconciliation AF5/AF6 (already named
#   environment-red by slice 11), phase89-resident-host P92-RH5, phase92 RI1,
#   phase10.1-reconciliation WF1-WF4, scratchpad-33 SP8, served-commit-306 (2),
#   issue144-lsp-pool GP-C, and the two git-stash rows (issue285 G-6, worktree pinBaseSha —
#   `git stash` is refused in a linked worktree by construction). issue351 OL-a missed its 800ms
#   loop-stall bound by 1ms under full-suite contention and is green in isolation at both the
#   baseline and this tip. This slice adds no failing row.
```

- The two stale-pin fixes (F4, PL10) and the P91-12 hop regression were each reproduced red at
  this slice's tree before their fix and green after; P91-12 was additionally verified green at
  the clean baseline (`git worktree add` at `499ae7e0`) before the slice touched it.

## 7. What this slice does not claim

- The coordinator keeps 96 unmoved effect members; `_deliverPreservedSuccessor`,
  `_deliverFollowUp`, `nudgeTurn`, `_interruptThenGoverned`, `_beginStop`, `_resolveStopRequests`,
  `_dispatchPass`, `_settleTransportDeath`, `releaseGoneWorkerReservations`,
  `_preserveProgressBeforeReap` and the rest stay on the class — later tranches.
- The delegates are delegates, not gone; inlining them is a later slice's move.
- The slice-8/9/10 async-delegate hop retrofit remains a separate follow-up.
- The `_handleEvent` family split is untouched; the map schedules it last.
- The `application-*` buckets and `runtime-api.mjs` remain open scope, per the root's resume
  brief for this swarm.
