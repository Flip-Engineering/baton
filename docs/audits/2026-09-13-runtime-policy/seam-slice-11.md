# Seam slice 11 — the coordinator's admission bucket moves out, composition root included

Issue #259, slice 11. Slice 9 moved the first effect members and slice 10 the observation bucket;
this slice moves the coordinator's 89 admission members — the authority-op guards
(`_withAuthorityOp`, `_acquireAuthorityOp`, `_trackAuthorityPromise`), the route and policy
admission, the pause/interaction authority (`_admitPauseRecord`, `_reservePauseRecord`,
`_withPauseReservation`), the contribution capture/check admission, and the constructor, which the
map classifies admission — into `impl/src/runtime-admission.mjs`. With this slice the entangled
effect set the map's §3 names next (`_deliver`, `stopRunTargets`, `_finalizeStop`, `_integrate`) has
its preflight homes: admission here, observation in slice 10, the proven effect port in slice 9.

Revision under audit: `d734f104` (slice 10) plus this slice's working tree. Write scope: the new
module, `impl/src/coordinator.mjs`, `impl/scripts/seam-inventory.mjs` + its regenerated artifact,
`impl/test/runtime-admission.test.mjs`, `impl/test/runtime-recovery.test.mjs` (RR6's pin follows the
constructor), `impl/test/frame-economics-red.test.mjs` (three exemption rows follow their lines),
and this file.

## 1. What moved

All 89 admission members — 2 093 lines — leave the class behind same-name, same-parameter-list,
same-arity delegates carrying `(this, this._recorder, …)`. Recording reroutes are the slice-9/10
four, counted and pinned (`RA3`): 5 `recorder.log.append`, 4 `recorder.mapEvent`, 1
`recorder.recordDriver`, 29 `recorder.coordination`. The generator refuses a body whose literals
drift, a bare `this` outside the `.call(this, …)` receiver idiom, or a local named `coordinator`/
`recorder`; a token-level inverse-transform audit proves all 89 bodies otherwise identical to the
pre-move text.

Three members needed decisions the delegate table hides:

- **The constructor** is the composition root: it builds the recorder port, so nothing can hand it
  one. Its module function takes `(coordinator, opts)`, its delegate is an expression statement
  (`constructor(opts = {}) { runtimeAdmission.constructor(this, opts); }`), and its body keeps the
  blanket receiver rename only — the log facade's closure keeps reading `this._coordMapEvent` at
  call time (through the class delegate, per the instance-patch contract), and the two composition
  assignments (`this._log = …`, `this._coordination = …`) stay assignments: the coordination reroute
  never rewrites an assignment target (the port is frozen; strict mode would throw). `RA3`
  constructs a blank prototype through the module function and requires the same recorder, facade
  identity, and public surface as `new`.
- **Async members get plain delegates.** A delegate written `async name(…) { return
  runtimeAdmission.name(…); }` adopts the module promise, adding one settlement hop —
  `turn-checkpoints-31b-red` A1 (the pause-record race) pins the exact hop count and failed with it.
  The plain delegate returns the module function's own promise, which is the pre-move timing
  exactly. This generalizes slice 8/9/10's `async`-delegate convention; those suites stay green
  either way, and a retrofit is named in §6.
- **The relocated classes keep their export surface.** `DependencyCycleError`,
  `SupervisedProcesses` and `guidanceSender` move with the bucket and are re-exported by the
  coordinator in slice 8's `export { … } from '…'` form, so every import path resolves to the same
  bindings (`RA4`).

**The relocated declarations and their closure.** The bucket reads 16 coordinator-scope helpers
(the authority consts `COORDINATION_MUTATORS`, `PHYSICAL_LOG_APPENDS`, the attention push tables,
`TRANSIENT_TURN_RETRY_LIMIT`, the `bestEffort` pair, `coachingError`, `defaultAccept`,
`guidanceSenderLabel`, `normalizedDecisionText`, `normalizeDrainPolicy`, `resolveCardModel`, and the
two classes), which pull three more of their own (`DEFAULT_DRAIN_POLICY`,
`SUPERVISED_STREAM_TAIL_BYTES`, `cardAcceptsExactModel`) — 19 declarations, emitted in source order.
The closure computation is the slice-10 lesson applied at generation time: a relocated helper that
reads an unrelocated name throws at call time, not load time. Exactly the three names staying code
still reads (`coachingError`, `resolveCardModel`, `SupervisedProcesses`) are imported back.

## 2. The map

One target, one rule: `{ file: 'impl/src/runtime-admission.mjs', className: null, receiver:
'coordinator' }`, and `admission:runtime_admission_port` (weight 3) matching
`runtimeAdmission.<member>(`. The corpus reads 2 396 members (2 297 + 99: the 89 bodies plus the 10
relocated function declarations; consts and classes are not members). Every class delegate keeps
`admission`; the 7 relocated helpers that classify `surface:no_authority_touched` are pure
functions, named in `RA5`'s neighborhood (they are the module's only non-admission members).

## 3. The pins that keyed code to the coordinator file

- `runtime-recovery.test.mjs` RR6 pinned the port-wiring lines by scanning `coordinator.mjs`; they
  moved with the constructor, so RR6 reads the member through `seam-member-source.mjs`
  (`memberSource('constructor')` — the receiver normalization puts `this.` back).
- `frame-economics-red` F1: three literals followed their lines — the scratch-oracle policy
  ceiling and the two identity-field rows — each gaining the module's row beside the coordinator's.

## 4. Size

| file | before | after |
| --- | ---: | ---: |
| `impl/src/coordinator.mjs` | 11 025 | 9 008 |
| `impl/src/runtime-admission.mjs` | — | 2 454 |

## 5. Evidence

- `RA1`–`RA5` green: one-way imports with implicit receivers confined to the two relocated classes;
  the 89 delegates pinned on name, parameter list, arity (a pre-move `Function.length` table), and
  the `(this, this._recorder)` handoff, with the constructor's special shape pinned explicitly; the
  reroute census plus the constructor's blanket-only transform; the relocation census, import-back
  list and re-export identity; the map target and counts.
- The constructor's completeness is behavioral: `RA3` builds a blank prototype through the module
  function and requires the composed recorder to front the same facades (`RE4b`'s law holds under
  the moved composition root).
- Commands run (in the shared checkout at `d734f104` plus the slice; `BATON_HOST_CAPACITY_DISABLED=1`
  per this host's documented operator bypass):

```
node impl/scripts/seam-inventory.mjs --write   # regenerated after the last source edit; check mode: ok (2 396 members)
node impl/scripts/surface-gate.mjs             # surface-gate: ok
node impl/scripts/run-suite.mjs test/runtime-admission.test.mjs test/runtime-observation.test.mjs \
  test/runtime-effects.test.mjs test/coordinator.test.mjs test/issue299-tool-row-digests.test.mjs \
  test/issue311-situation-projection.test.mjs test/issue314-lane2-receipts-wakes.test.mjs \
  test/issue345-work-holder-updates.test.mjs test/issue350-stop-settles-membership.test.mjs \
  test/issue459-integrate-off-loop.test.mjs test/issue463-integrate-gate-paths.test.mjs \
  test/bidirectional-driver-red.test.mjs test/board-workerhalf-red.test.mjs \
  test/briefing-pack-red.test.mjs test/cli-crash-stderr-tail.test.mjs test/diagnostics-red.test.mjs \
  test/member-wedge-boundary-red.test.mjs test/native-completion-loop.test.mjs \
  test/omp-question-coordinator.test.mjs test/tg3-window-red.test.mjs \
  test/turn-checkpoints-31a-red.test.mjs test/turn-checkpoints-31b-red.test.mjs \
  test/issue10-waiting-vocabulary-red.test.mjs test/phase11-acceptance-integration.test.mjs \
  test/phase14-route-tuple.test.mjs test/create-driver-wiring.test.mjs test/runtime-recovery.test.mjs \
  test/runtime-recorder-port.test.mjs test/seam-inventory.test.mjs test/frame-economics-red.test.mjs \
  test/worker-verdict-surface-red.test.mjs test/phase43-provider-reconciliation.test.mjs \
  test/phase64-integrated-run-application.test.mjs
#   523 passed, 13 expected red, 1 unexpected
```

The one unexpected row is `phase43-provider-reconciliation` AF5/AF6, the host's environment red,
failing identically at the pre-move revision in this checkout (measured on slice 10's tree and held
unchanged here). This slice adds no failing row.

## 6. What this slice does not claim

- The members are delegates, not gone; inlining them is a later slice's move, and
  `admission:runtime_admission_port` is how it will find them.
- Slice 8/9/10's async delegates keep their `async` keyword. Slice 11's plain-delegate timing fix
  (§1) is the more faithful shape for all of them; retrofitting the landed slices is a reviewable
  follow-up, not folded into this slice.
- The coordinator keeps 100 stay-behind effect members and its 46 surface members; the
  event-handler family split is still last.
