# Seam slice 9 (first tranche) — the coordinator's first-named effect members move out, recording through the port

Issue #259, slice 9 (first tranche). The map's §3 names the coordinator's largest entangled effect
members in order; this tranche takes the first three that are effect-led — `_dispatch` (row 6),
`_spawnPlanWave` (row 9), `_resolveRecord` (row 10) — into `impl/src/runtime-effects.mjs`, each
recording through the injected recorder port that slice 6 landed. `_handleEvent` (row 1) and its
family are untouched; the map schedules them last.

Revision under audit: `985a42f0` (slice 7's landing on this branch) plus this slice's working tree.
Write scope: the new module, `impl/src/coordinator.mjs`, `impl/src/index.mjs` (the wiring correction
in §2), `impl/scripts/seam-inventory.mjs` + its regenerated artifact,
`impl/test/runtime-effects.test.mjs`, `impl/test/create-driver-wiring.test.mjs` (the CDW5 note text),
`docs/audits/2026-09-13-runtime-policy/seam-slice-6.md` (the wiring correction's doc half), and this
file.

## 1. What moved

| member | lines | records through the port as |
| --- | ---: | --- |
| `_dispatch` | 297 | 6 `recorder.log.append`, 2 `recorder.mapEvent`, 3 `recorder.coordination.*` |
| `_spawnPlanWave` | 240 | 5 `recorder.coordination.*` (incl. the cleanup receipt's `recordDriver`) |
| `_resolveRecord` | 238 | 7 `recorder.log.append`, 6 `recorder.mapEvent`, 3 `recorder.recordDriver`, 3 `recorder.coordination.*` |

The transform is verbatim with exactly four reroutes, each counted and pinned (`RE3`'s census):
`this._log.append(` → `recorder.log.append(`, `this._coordMapEvent(` → `recorder.mapEvent(`,
`this._coordRecord(` → `recorder.recordDriver(`, `this._coordination` → `recorder.coordination`;
every other `this.` becomes `coordinator.`. The port helpers are the members' own class helpers —
`mapEvent` is `_coordMapEvent`'s body, `recordDriver` is `_coordRecord`'s, including the
`authority.rejected` branch — so the reroutes change where the call is issued from, not what runs.

Delegates keep the member name, parameter list, arity and async-ness, and hand over the class's
recorder: `_dispatch(task, vendor, model, effort, workerPolicyResolution = null) { return
runtimeEffects._dispatch(this, this._recorder, task, …); }` — slice 8's convention.

Four coordinator module-scope declarations the bodies read move into the module and are imported
back by the coordinator: `WORKTREE_FAILURE` (shared with the staying `_onSpawnRefused`),
`normalizeRunId` (shared with the staying `_spawn`), and the two error classes `ModelSelectionError`
and `PublicationError`. The classes keep their export surface: `coordinator.mjs` re-exports them, so
`index.mjs`'s package surface and the test imports of `coordinator.mjs` resolve to the same class
objects (`RE4`).

## 2. The wiring correction the tranche forced

`this._log` and `this._coordination` on a Coordinator are not the raw authorities: the log is a
facade that adds the closed check and failure poisoning, and the coordination store is a proxy that
converts a mutator failure into `coordination_write_unavailable`. Slice 6's first wiring assembled
the default port in `createDriver` from the RAW `log`/`coordination` locals, while the constructor's
bare-`new Coordinator` fallback (slice 6's second commit) composed over the wrapped fields — two
paths, two behaviors. A port-routed `recordDriver` on a driver-built coordinator would have bypassed
the poisoning proxy.

phase11's CK8/CK9 caught it the first time a moved member was driven through an injected append
failure: `respond` rejected with the raw store error where the contract is the poisoned
`coordination_write_unavailable`. The fix is one composition site: `createDriver` passes
`opts.recorderPort` through, and the constructor composes the default over its own wrapped fields
(the fallback it already had). The port's shape is unchanged; `RE4b` pins the facade identity
(`coordinator._recorder.log === coordinator._log`, `…coordination === …_coordination` on a
driver-built coordinator), and the slice-6 doc's wiring section records the correction.

## 3. The map

One target and one rule: `{ file: 'impl/src/runtime-effects.mjs', className: null, receiver:
'coordinator' }`, and `effect:effects_port` (weight 3) matching `runtimeEffects.<member>(`. No
recorder-spelling rules were needed: the catalogue's `log_append` already reads
`recorder.log.append(`, and every moved body keeps `effect` on its own evidence. One honest
evidence note: the bodies' `observation:coordination_authority` bit does not fire module-side
(`recorder.coordination` is not the catalogue's `this._coordination` spelling); the seams are
unaffected.

The corpus reads 2 145 members (2 141 + the three bodies + the relocated `normalizeRunId`; the two
error classes and the symbol are not members). The delegates shrink to 3 lines each and keep
`effect`.

## 4. Evidence

- `RE1`–`RE5` + `RE4b` green: one-way imports and receiver discipline; delegate/arity/port bijection
  against the committed map; the reroute census pinned per member and the recorder observed as the
  only recording path on a real spawn (every operational-log row rides the port, in order); the four
  relocated primitives exported once with the coordinator's surface unchanged; facade identity on a
  driver-built coordinator.
- The regression pair: phase11 CK8/CK9 (injected publication- authorization/completion append
  failures) red before the §2 fix, green after — and red at the clean baseline only without the
  move, never with it.
- Commands run (in the shared checkout at `985a42f0` plus the slice; `BATON_HOST_CAPACITY_DISABLED=1`
  per this host's documented operator bypass):

```
node impl/scripts/seam-inventory.mjs --write   # regenerated after the last edit; check mode: ok (2 145 members)
node impl/scripts/surface-gate.mjs             # surface-gate: ok
node impl/scripts/run-suite.mjs test/runtime-effects.test.mjs test/phase11-acceptance-integration.test.mjs \
  test/runtime-recorder-port.test.mjs test/create-driver-wiring.test.mjs test/runtime-recovery.test.mjs \
  test/seam-inventory.test.mjs
#   GREEN — 57 passed, 0 unexpected
node impl/scripts/run-suite.mjs test/coordinator.test.mjs test/phase64-integrated-run-application.test.mjs \
  test/blind-waits-red.test.mjs test/bidirectional-driver-red.test.mjs test/cli-wave-fidelity-red.test.mjs \
  test/omp-question-coordinator.test.mjs test/decision-gate-trust-gate-red.test.mjs \
  test/peer-messages.test.mjs test/phase11-model-selection.test.mjs test/phase14-route-tuple.test.mjs \
  test/control-conflict-axis.test.mjs test/issue286-attention-index.test.mjs \
  test/issue286-tick-fast-path.test.mjs test/phase80-plan-revision-store.test.mjs \
  test/phase62-goal-plan-authority.test.mjs test/phase79-plan-wave-replay-red.test.mjs \
  test/phase73-required-effects.test.mjs test/frame-economics-red.test.mjs \
  test/worker-verdict-surface-red.test.mjs
#   GREEN — 302 passed, 24 expected red, 0 unexpected
```

## 5. What this slice does not claim

- Three of 103 coordinator effect members moved. `_handleEvent`'s family, `_spawn`, `_recover`'s
  neighbors and the rest of the bucket stay on the class; the map's §3 order names the next
  candidates, and the event-handler split is still last.
- The port's `route` face is exercised by `_runTrustGate` (not in this tranche) and remains
  untested-by-this-slice; slice 6's own pins cover its shape.
- `normalizeRunId` classifies `admission` as a module member on its name rule; it is a relocated
  helper, not a claim about the admission seam's contents.
