# Seam slice 8 — the coordinator's recovery bucket moves behind the recorder port

Issue #259, slice 8. Slices 1–4 moved the store's three buckets and slice 3 moved the brief seam;
slice 6 built the injected recorder port (`runtime-recorder-port.mjs`) that seam-map §4.3 says the
effect and recovery seams share, and migrated one proof consumer from each. This slice moves the
coordinator's recovery bucket — the 43 members `impl/scripts/seam-inventory.json` classifies
`recovery` — into `impl/src/runtime-recovery.mjs` against that port.

Revision under audit: `36295b70` plus this slice's working tree. Write scope:
`impl/src/runtime-recovery.mjs`, `impl/src/coordinator.mjs`,
`impl/scripts/seam-inventory.mjs` + its regenerated artifact,
`impl/test/runtime-recovery.test.mjs`, `impl/test/frame-economics-red.test.mjs` (one exemption row
follows a moved line), and this file. No behavior change: every member keeps its name, parameter
list, arity, return shape and error codes; one disclosed exception is recorded in §5.

## 1. What moved

42 of the 43 members move. The 43rd, `_completeDurableRecoveryAttempt`, moved in slice 6 as the
port's recovery proof consumer; this slice keeps routing its callers through the same delegate.

| family | members |
| --- | --- |
| startup reconstruction (14) | `completeDeferredStartup`, `_startupReconstruction`, `_runStartupReconstructionAsync`, `startupReconstructionStatus`, `startupWorkerFleet`, `_startupReconstructionPasses`, `_startupCleanupIncomplete`, `_startupReconcilerObservation`, `_trackStartupCleanup`, `startupReady`, `beginStartupRecovery`, `startupRecoveryCandidates`, `_recoveryDispatchRefusal`, `completeStartupRecovery` |
| orphan/capacity (3) | `orphanedCapacityReservations`, `_drainReaperFor`, `_orphanCapacityWaits` |
| preserved-session/reattach (2) | `_exactPreservedRecoveryContext`, `_restoreRecoveredPhysicalWorkspaceAuthority` |
| recover family (6) | `recover`, `recoverPlanBound`, `_admitDurableRecoveryAttempt`, `_recover`, `_reattachPreservedSession`, `resumePreservedWork`, `_resumePreservedWork` |
| reap family (10) | `_retryProcessReap`, `_createCoordinationRecoveryRefinement`, `_createCoordinationPlanRecoveryRefinement`, `_preserveProgressBeforeReap`, `_scheduleUntrustedTransportReap`, `_releaseRecoveryProviderTurn`, `_stopRecoveryTransport`, `_finishUntrustedTransportReap`, `_refuseStallReap`, `_recordStallReapRefusal` |
| provider reconciliation (5) | `reconcileProviderSource`, `reconcileDueProviderProcessing`, `reconcileProviderProcessing`, `reapRunScratchpads`, `resumeOrphans` |
| replay (1) | `_replay` (generator; `yield*` from `_startupReconstructionPasses`) |

Each keeps a same-name same-parameter-list same-arity delegate on `Coordinator`:

```js
async _recover(workerId, opts = {}) {
  return runtimeRecovery._recover(this, this._recorder, workerId, opts);
}
```

Bodies are verbatim: `this.` became the explicit receiver `coordinator`, recording goes through the
port parameter `recorder`, and every self-call to a moved member routes through the class delegate
(`coordinator._recover(...)`) — the delegate is the member, so instance-level stubs, fences and
authority tickets observe exactly what they observed before the move. Sibling calls that stay
module-local were deliberately avoided for this bucket: the behavioral suites (phase76) drive
recovery through instance doubles, and a module-local call would bypass them.

## 2. The recorder port boundary

The port (slice 6, `createRecorderPort`) groups the observation authorities. The moved bodies
reach it as the second parameter:

* `recorder.log.append(frame)` — 23 sites. The port carries the raw log, so the durable event
  return survives; `_replay`'s gap keys (`task.failed:<id>:coordination_gap:<seq>`) and
  `_recover`'s `recoveryRequested.seq` are built from it.
* `recorder.mapEvent(event)` — 13 sites; one-for-one mirror of `_coordMapEvent` (`mapOperationalEvent`
  with the `evidence:<worker>:<seq>` key).
* `recorder.recordDriver(kind, payload, key, actor)` — 6 sites; mirror of `_coordRecord` including
  the `authority.rejected` special case.
* `recorder.coordination.<verb>` — the raw coordination store, so the 13 write verbs
  (`admitRecoveryAttempt`, `completeRecoveryDispatch`, `recordRecoveryContinuationIntent`,
  `transitionTask`, …) and 17 read verbs keep their exact return shapes.

`_coordTransition` is deliberately not port surface: it is a coordinator composite (durable write +
claim expiry + grant revocation + plan-budget settlement) and stays reachable through the receiver,
exactly like `_providerBrief` and `_admitProviderTurn`. `_replay`'s two transitions already went
through the raw store and keep doing so.

`impl/test/runtime-recovery.test.mjs` (RR3) pins the boundary the way the brief asks: a fake
recorder drives `_replay` and observes every recording act the fold performs — the two
`control.recovery_terminalized` appends, their evidence mappings, the durable `transitionTask`
writes keyed by the appended events' `seq`, the claim expiry tail, and the unmarked-alias
`recordDriver` row.

## 3. The 28 relocated primitives

The moved bodies read 22 module-scope declarations of `coordinator.mjs` (plus 6 they transitively
need): `canonicalDigest` and its `canonical`/`createHash` substrate, `KILL_RULES`,
`TERMINAL_TASK_STATUSES`, the logical-call/worker-policy/session-selection helpers,
`startupReconcilerNext`/`startupReconcilerRecord`, the workspace-owner expectations, and
`SessionSelectionError`. They moved verbatim and the coordinator imports every one back.
`PUSH_REFUSAL_CODES`, `REARM_KINDS` and `SessionSelectionError` are re-exported from
`coordinator.mjs`, so `impl/src/index.mjs` and `impl/test/phase11-persistent-sessions.test.mjs`
keep resolving the same bindings. All other 31 dependencies (limits, worker-policy,
process-lifecycle, recovery-attempt, provider-governance, usd, messages, adapter, worktree,
shared-workspace-custody, node builtins) are imported from their own sources. The layering is
one-way: `coordinator.mjs` imports `runtime-recovery.mjs`; the module imports neither monolith.

## 4. The map

`TARGETS` gains the module target (`runtime-recovery.mjs`, `className: null`, `receiver:
'coordinator'` — the slice-3/slice-4 convention) and one evidence rule, the slice-1 §4 pattern:

* `recovery:recovery_port` — the class delegate calls `runtimeRecovery.<member>(`. Without it the
  three-line delegates would be read off their names and could lose the seam their bodies had.

The regenerated artifact classifies all 424 coordinator members exactly as before the move (zero
reclassifications, zero vanishings); the module target adds 63 members (45 recovery, 13
`surface:no_authority_touched` fallback primitives, 4 admission, 1 observation — the relocated
primitives classified honestly at module scope, the slice-4 convention).

## 5. Size, and what this slice does not claim

| file | before | after |
| --- | ---: | ---: |
| `impl/src/coordinator.mjs` | 18 349 | 14 923 |
| `impl/src/runtime-recovery.mjs` | — | 3 645 |

* One disclosed deviation from strict verbatim: every moved body is byte-identical except that the
  `completeDeferredStartup` constructs `new CoordinationRefusal(...)` with a real import from
  `coordination-internals.mjs`. At the base revision that identifier was never imported into
  `coordinator.mjs` — the deferred-load branch could only ever have thrown a bare `ReferenceError`.
  The import makes the branch's intended typed refusal (`coordination_store_loading`) real; no
  reachable base behavior is preserved by keeping the landmine.
* The members are delegates, not gone: inlining them (and dropping the ones with no external
  caller) is later-slice work, found through the `recovery_port` evidence.

## 6. Evidence

| command | result |
| --- | --- |
| `node impl/scripts/seam-inventory.mjs --write` then check mode | `ok` (regenerated; zero member reclassifications) |
| `node impl/scripts/surface-gate.mjs` | `ok` |
| `node impl/scripts/run-suite.mjs` over `runtime-recovery`, `seam-inventory`, `frame-economics-red`, `worker-verdict-surface-red` | GREEN — 80 passed, 13 expected red, 0 unexpected |
| same runner over `phase60-coordination-recovery`, `phase66-plan-authorized-recovery`, `phase66-run-recovery-application`, `phase76-recovery-attempt-integration`, `phase76-recovery-attempt-authority`, `phase70-preserved-stop`, `orphan-resume-red` | GREEN — 61 passed, 0 unexpected |

`frame-economics-red` F1 flagged exactly one moved line (`Buffer.byteLength(request.id) > 4_096`,
the request id-class) and the named exemption row follows it to `runtime-recovery.mjs`, with the
coordinator row retained — the slice-2 migration pattern. `worker-verdict-surface-red` C4/E4 stayed
green without new exemptions. The two behavioral failures the first cut of this slice produced
(RAI2–RAI5 hangs, CE7 refusal) were delegate bugs this slice's review caught and fixed before
commit: generator delegates must `yield*` (a `return`-style delegate completed without running the
reconstruction), and defaulted parameters forwarded as argument expressions (`opts = {}`) re-default
the value at the call site, wiping the caller's object.

## 7. What this slice does not claim

* The recovery seam is smaller in code, not in members: all 42 members still exist as delegates.
* The port does not yet carry the recovery seam's reads — they stay on the receiver's
  `coordination` authority, which the port carries raw; narrowing that surface is the effect
  seam's call (slice for `runtime-effects.mjs`).
* The canonical-suite verdict on this host is environment-red for credential-class rows
  independent of this slice; the subset above covers every suite the moved members' behavior is
  pinned by, plus the two pinned-scan suites (F1, C4/E4) that follow moved bodies.
