# Seam slice 12 design — the coordinator's entangled effect set splits admission from effect

Issue #259, runtime-effects tranche 2. This is the design act the slice-9 and slice-11
carried-forwards named: the four entangled effect members the map's §3 order leaves after slice 9 —
`stopRunTargets` (row-adjacent to the drain family), `_integrate`, `_deliver`, `_finalizeStop` — do
not move verbatim. Each carries an admission prefix that belongs to `runtime-admission.mjs`; the
effect remainder moves to `impl/src/runtime-effects.mjs` under slice 9's recorder-port discipline.
This document is the execution contract for that slice; the landed slice gets its own
`seam-slice-12.md` in this directory.

The invariant is the program's standing one: no behavior change. Every refusal, throw, log row,
coordination write, and return value keeps its exact shape and ordering.

## 1. The split rule

Each member's body today reads: decide admissibility (a chain of throws and early returns), then
act (adapter calls, worktree operations, fence issue), recording throughout. After the slice each
body reads: admitted → act → record.

- The admission prefix becomes a named function in `impl/src/runtime-admission.mjs`:
  `_admitRunStopTargets`, `_admitIntegration`, `_admitDelivery`. Admission functions take
  `(coordinator, recorder, …)`, record any refusal observations through `recorder`, and either
  throw the exact errors the source throws or return a refusal result the effect body returns
  unchanged.
- The effect remainder moves to `runtime-effects.mjs` as a module function with the member's own
  name, taking `(coordinator, recorder, …)`, calling admission first.
- `_finalizeStop` has no admission prefix beyond its `waiter.finalized` guard, which is effect
  state; it moves wholesale.
- Delegates on the class are plain non-async forwarders
  (`_deliver(handle, message, mode, opts) { return runtimeEffects._deliver(this, this._recorder, handle, message, mode, opts); }`),
  the slice-11 convention. None of the four is a generator, so no `yield*` delegate appears in
  this tranche. The async-delegate hop retrofit of slices 8/9/10 remains a separate follow-up and
  is not folded in.

## 2. Shared declarations that relocate

The moved bodies and the admission functions read three coordinator-scope declarations. Per the
slice-10 finding, the relocation closure is computed transitively.

| declaration | consumers after the slice | home |
| --- | --- | --- |
| `ORIENTATION_DELIVERY` (Symbol, coordinator.mjs:88) | `_admitDelivery`, the moved `_deliver`, the staying `_orientWorker` | `runtime-recovery.mjs` |
| `IntegrationError` (class, coordinator.mjs:181) | `_admitIntegration`, the moved `_integrate`, the staying `_preserveResult`/`_pinAcceptedResult`, package surface | `runtime-recovery.mjs` |
| `noop` (runtime-observation.mjs:203) | the moved `_finalizeStop` | `runtime-recovery.mjs` |

`runtime-recovery.mjs` is the base layer of the extracted modules: `runtime-effects` and
`runtime-admission` already import from it, and `runtime-observation` already imports from both.
Placing the three declarations there adds no new module edge. The alternative — admission importing
`runtime-effects` for `IntegrationError` and `ORIENTATION_DELIVERY` while effects calls admission —
would create a cycle; this placement is how the split avoids it.

`coordinator.mjs` imports all three back and keeps its export surface: `IntegrationError` is
re-exported exactly as slice 9 re-exported `ModelSelectionError` and `PublicationError`, so
`index.mjs`'s package surface and the `instanceof IntegrationError` pins in
`phase11-acceptance-integration.test.mjs` resolve to the same class object.
`runtime-observation.mjs` re-exports `noop` from its new home so its own export surface is
unchanged.

The other module-scope names the bodies read are already clean imports from
`process-lifecycle.mjs` (`reapRecoveredProcessGroup`, `processAuthorityState`, `processGroupAlive`,
`recoveryProcessReapedPayload`, `recoveryProcessAbsentPayload`), `coordination-internals.mjs`
(`canonicalDigest`, re-exported through `runtime-recovery.mjs`), `runtime-observation.mjs`
(`closedVerificationVerdict`), or `runtime-recovery.mjs` (`TERMINAL_TASK_STATUSES`, `KILL_RULES`).
`runtime-effects.mjs` imports what it needs from those same modules.

## 3. The four splits

### 3.1 `stopRunTargets` (coordinator.mjs:800–995, 195 lines)

Admission prefix (`_admitRunStopTargets`, async): the target-list validation (the
`coordinator_run_stop_invalid` TypeError), the drain-token and closed-authority check
(`coordinator_closed`), and the startup-cleanup reconciliation
(`await Promise.all(coordinator._startupCleanupPromises)` then the `coordinator_run_stop_incomplete`
throw). It returns nothing; the effect body computes `deadline` after admission resolves,
preserving the source's ordering (the deadline starts after startup reconciliation).

Effect remainder (`stopRunTargets` in `runtime-effects.mjs`): the convergence loop. The two inner
closures lift to module functions taking a state record, because they capture `dispositions`,
`recoveredSignals`, `deadline`, and `actor`:

```
const state = { actor, deadline, dispositions: new Map(), recoveredSignals: new Map() };
async function cancelRunStopTarget(coordinator, recorder, state, handle, task, kind)
async function attemptRunStopTarget(coordinator, recorder, state, workerId)
```

Callees stay on the receiver and are called as `coordinator.…`: `_resolveRecord` (already slice 9's
delegate), `kill`, `_ownsLocalResources`, `_removeRuntimeScope`, `_removeOwnedTaskWorktree`,
`_drainWaitObserve`, `_stopWaitingOn`, `_sleep`, `_coordTransition`. The process-lifecycle calls
are module imports. Recording reroutes per §4.

### 3.2 `_integrate` (coordinator.mjs:3313–3484, 171 lines)

Admission prefix (`_admitIntegration`, sync): the seven refusal throws — `result_not_accepted`,
`scratch_oracle_not_integrable`, `independent_oracle_required`, `unsupported_strategy`,
`integration_unavailable` (twice), `worker_not_quiescent`. It takes `(coordinator, handle, task,
opts)` and throws `IntegrationError` from its new home. It records nothing; the source records
nothing before `integration.requested`.

Effect remainder (`_integrate` in `runtime-effects.mjs`): `coordinator.tick()` and
`coordinator._getWorker(workerId)` run first, then admission, then the `integration.requested`
recordDriver, the retain/kill/worktree-removal sequence, the `ff-only` or `structured` integration
with its fresh pinned verification (`coordinator._referee`, `coordinator._accept`,
`closedVerificationVerdict`), the catch-path cleanup with the `integration.incomplete` /
`integration.refused` recording and `coordinator._poisonIntegration`, and the success path's
`integration.completed` append and `recorder.coordination.completeIntegration` write. The
post-effect tagging reads (`inspectStructuredIntegration`) stay verbatim.

### 3.3 `_deliver` (coordinator.mjs:4368–4549, 181 lines)

Admission prefix (`_admitDelivery`, sync): the whole refusal chain — goal-plan continuation
  authority, the two sealed-Run checks (the first throws the `CoordinationRefusal`, the second, in
  the pause branch, returns the `run_sealed` refusal result), semantic-target drift
(recording `control.stale_rejected` through the recorder), `worker_stopping`, the preserved-turn
controlId TypeError, the orientation-delivery status check, the reusable-follow-up computation and
its `worker_not_active` / `task_terminal` chain, the pause check, and the externally-supplied fence
pre-check (recording `control.stale_rejected` at `pre_delivery`). It returns a closed descriptor
union:

```
{ admitted: false, result }                    // refusal; the effect body returns result unchanged
{ admitted: true, handoff: null }              // proceed to fence issue and delivery
{ admitted: true, handoff: 'preservedSuccessor' }
{ admitted: true, handoff: 'followUp' }
{ admitted: true, handoff: 'nudgeTurn', pause }
{ admitted: true, handoff: 'interruptThenGoverned' }
```

Effect remainder (`_deliver` in `runtime-effects.mjs`): calls admission, returns refusal results
unchanged, dispatches a handoff as the receiver call the source makes
(`coordinator._deliverPreservedSuccessor`, `coordinator._deliverFollowUp`, `coordinator.nudgeTurn`,
`coordinator._interruptThenGoverned` — all staying members, called through the class so instance
patches keep firing), and otherwise performs the delivery: `coordinator._fences.issue`, the
`control.delivery_requested` append, `coordinator._adapters[vendor].prompt`, the post-delivery
fence check with its `control.stale_rejected` + `control.delivery_amended` pair, the
`control.delivery_refused` append on ack failure, and the success path's kind selection, final
append, `coordinator._armStallCycle`, and the `recorder.coordination.recordMessage` lane receipt
with its `coordinator._noteFailure` guard.

### 3.4 `_finalizeStop` (coordinator.mjs:5807–5995, 188 lines)

No admission prefix; the `waiter.finalized` guard is waiter state. The body moves wholesale: the
confirmation append, the preservation receipt (`coordinator._sessionPreservationReceipt`, already
slice 11's admission delegate), the three handle/task state arms (kill, preserved interrupt,
plain), the error arm's cleanup and `coordinator._bestEffort` adapter kill, and the settled
continuation (`coordinator._settleTransportDeath`, `coordinator.releaseGoneWorkerReservations`,
the `coordinator._beginStop` escalation, `coordinator._resolveStopRequests`,
`coordinator._dispatchPass`).

## 4. Recording reroutes

Slice 9's four reroutes apply, with one generalization: the log facade's other faces follow
`append`, so the rule is `this._log.` → `recorder.log.` (the new spelling this tranche needs is
`this._log.tail(workerId)` → `recorder.log.tail(workerId)` in `_deliver`'s lane-receipt digest and
stall-cycle arm). In full:

- `this._log.` → `recorder.log.`
- `this._coordMapEvent(` → `recorder.mapEvent(`
- `this._coordRecord(` → `recorder.recordDriver(`
- `this._coordination` → `recorder.coordination`
- every other `this.` → `coordinator.`

The same rules apply inside the admission functions. The census is generated, counted per member,
and pinned, and the token-level inverse-transform audit of slice 10 covers the verbatim halves.

## 5. The map and the corpus pin

No new target: `runtime-effects.mjs` and `runtime-admission.mjs` are already declared with
`receiver: 'coordinator'`, and the existing port rules (`effect:effects_port`,
`admission:runtime_admission_port`) match the new call sites without change. The delegates keep
their members' seams. One expected evidence note: the three split effect bodies call
`runtimeAdmission._admit*(` first, so they carry `admission:runtime_admission_port` evidence
module-side alongside their own effect evidence — the census records it, and their seam stays
`effect` on the adapter/process authority they drive.

Member arithmetic: the coordinator keeps 424 members (the four bodies become delegates);
`runtime-effects.mjs` gains the four bodies plus the two lifted `stopRunTargets` closures (10
total); `runtime-admission.mjs` gains the three admission functions (102 total); `noop` moves from
`runtime-observation.mjs` to `runtime-recovery.mjs` (151 and 64). The corpus reads 2 415 members.
The executor regenerates `seam-inventory.json` after its last source edit, runs check mode as the
final gate, and updates the four changed `CORPUS_COUNTS` rows in the same commit.

## 6. Pins

The `runtime-effects.test.mjs` / `runtime-admission.test.mjs` RE-series continues:

- the delegate/admission/effect triad for each split member: name, parameter list, arity, and
  async-ness preserved at all three stations;
- the reroute census per member, counted and pinned as in RE3;
- the `_admitDelivery` descriptor union as a closed set;
- one-way imports: `runtime-effects.mjs` imports `runtime-admission.mjs` to call the admission
  prefixes first (the admitted → act → record reading stays inside the effect body);
  `runtime-admission.mjs` never imports `runtime-effects.mjs` — that direction is the cycle this
  design's §2 placement exists to prevent — and the three relocated declarations are each defined
  exactly once;
- the inverse-transform audit proving the effect bodies otherwise identical to the pre-move text;
- behavior: the phase11 integration suite (the `IntegrationError` codes and the poisoned-write
  path), the stop/convergence suites for `stopRunTargets` and `_finalizeStop`, and the delivery
  suites for `_deliver` all green unchanged, with the recorder observed as the only recording path
  on one driven instance of each member.

## 7. What this slice does not claim

- `_deliverPreservedSuccessor`, `_deliverFollowUp`, `nudgeTurn`, `_interruptThenGoverned`,
  `_beginStop`, `_resolveStopRequests`, `_dispatchPass`, `_settleTransportDeath`,
  `releaseGoneWorkerReservations`, and `_preserveProgressBeforeReap` stay on the class; they are
  later tranches of the effect bucket (96 unmoved bodies remain after this tranche).
- The `_handleEvent` family split is untouched; the map schedules it last.
- The slice-8/9/10 async-delegate hop retrofit is a separate follow-up.
- The `application-*` buckets are outside this swarm's brief scope pending the root's decision.

## 8. Execution errata (recorded at slice-12 execution; the landed truth is seam-slice-12.md)

Two sections of this design were corrected by the executor's findings, each with a red/green
gate behind it:

- §3.1: `_admitRunStopTargets` is SYNC. An async prefix adds one adopted-promise settlement hop
  before the convergence loop, and phase91 P91-12 fails on exactly that hop (red with async,
  green with sync, green at the clean baseline). The startup-reconciliation wait and its
  `coordinator_run_stop_incomplete` throw stay in the effect body at their verbatim position;
  the admission prefix covers the validation and authority checks only.
- §2: `closedVerificationVerdict` could not stay an import from `runtime-observation.mjs` —
  `_integrate` reads it, and effects → observation would close a cycle with observation's
  existing import of effects. The closed-verdict family (the function and its eight-name
  closure) moved to `runtime-recovery.mjs` beside `noop`; `runtime-observation.mjs` re-exports
  it, and RR7 pins the identity. The corpus rows read: coordinator 424, admission 102, effects
  10, observation 150, recovery 65 (total 2 415 — the §5 total stands; the two rows moved with
  the family).
