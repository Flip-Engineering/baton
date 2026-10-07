# Seam slice 7 — the store's effect bucket moves out

Issue #259, slice 7. Slices 1, 2 and 4 moved the store's `surface` and `recovery` buckets and its
observation bucket (`coordination-internals.mjs`, `coordination-replay.mjs`, `coordination-ledger.mjs`);
slice 6 landed the injected recorder port (`runtime-recorder-port.mjs`). This slice moves the store's
26 `effect` members — the ledger-write authorities — into `coordination-ledger-writes.mjs`. These are
the authorities the recorder port carries as its `coordination` face: the module extracts with its
bodies unchanged because the recording surface (`store._append`, the fsynced file writes) is the seam
itself, not a consumer of it.

Revision under audit: `60714734` (slice 5's landing; slice 8, the coordinator's recovery bucket, landed beside it as `5677e147`) plus this slice's working tree. Write scope: the
new module, `impl/src/coordination-store.mjs`, `impl/src/coordination-internals.mjs` (two relocated
constants), `impl/src/canonical-order.mjs` (one relocated symbol),
`impl/scripts/seam-inventory.mjs` (one target, one rule) + its regenerated artifact,
`impl/test/coordination-ledger-writes.test.mjs`, `impl/test/coordination-internals.test.mjs` (the CI2
census moves with two delegates), `impl/test/seam-member-source.mjs` (the store's module-scope
file list gains its fourth file) and `impl/test/coordination-admission.test.mjs` (CA6 pins that list), and this file.

The invariant the slice holds itself to: **no behavior change**. Every member keeps its name, parameter
list, arity, return shape and error codes; the store keeps every call site; no durable format, segment,
digest, or idempotency key moves.

## 1. What moved

All 26 members the map placed in the store's `effect` bucket leave the class. Each keeps a delegate on
`CoordinationStore` — same name, same parameter list, same arity — so the class's own call sites and
every external caller are untouched.

| group | members | lines |
| --- | --- | ---: |
| writer lease | `claimWriterLease`, `releaseWriterLease`, `_dropBorrowedWriterLease` | 106 |
| segments and compaction | `_writeSegment`, `_writeSegmentIndex`, `_cleanupSegmentTemps`, `compact` | 141 |
| canonical-order receipt | `_writeCanonicalReceipt`, `_cleanupCanonicalOrderTemps` | 29 |
| projection checkpoint | `_projectionCheckpointWriteSteps`, `_sweepProjectionCheckpointTemps` | 108 |
| construction | `constructor` (the durable store open: mkdir, policy admission, the load) | 209 |
| ledger-append verbs | `revokeRunOrchestratorLease`, `attachContextPackage`, `revokeTaskAcceptance`, `grantContextPack`, `revokeBoardGrants`, `proposeOrientationCandidate` | 159 |
| reads classified effect by name rule | `materializeContextPack`, `materializeSpill`, `_orientationLatestSource`, `orientationReadLatest`, `_orientationWorkerFreshness`, `orientationReadHead`, `_orientationCandidate` | 31 |
| timers | `waitAfter` | 33 |

Every function takes `store` first: all 26 read several collections or call back into stay-behind
members (`_assertWriterLease`, `_append`, `_canonicalReceiptCore`, `_reloadProjection`, the segment
paths), so none qualifies for a single-slice receiver. The module contains no `this` (CLW1).

Three members needed a decision the table hides:

- **`_projectionCheckpointWriteSteps` is a generator.** Its delegate is a plain method that returns
  the generator object: `yield* store._projectionCheckpointWriteSteps()` (the async open in
  `coordination-ledger.mjs`) and the synchronous drain in `_writeProjectionCheckpoint` both consume a
  returned generator unchanged. Slice 4's `_writeProjectionCheckpoint` delegate already drives the
  member this way.
- **The constructor** moves as `export function constructor(store, root, opts = {})` — the name stays
  so the map's delegate bijection holds one name per member. The class delegate is an expression
  statement (a constructor returns no value): `constructor(root, opts = {}) {
  coordinationLedgerWrites.constructor(this, root, opts); }`.
- **`orientationReadLatest` and `orientationReadHead`** were already delegates into
  `coordinationInternals` (slice 1's helpers, added by #286). Their bodies move like the rest; the
  module calls the same internals helpers, one module call away. The internals census drops to 101
  (§4).

The moved bodies pull the primitives they need out of the store's module scope: **13 declarations**
(`CANONICAL_ORDER_RECEIPT`, `CANONICAL_ORDER_TEMP_PREFIX`, `PROJECTION_CHECKPOINT`,
`PROJECTION_CHECKPOINT_TEMP_PREFIX`, `SEGMENT_TEMP_PREFIX`, `SEGMENT_INDEX_TEMP_PREFIX`,
`LEDGER_TEMP_PREFIX`, `defaultLedgerSync`, `nullPrototypeFields`, `validRoutePolicy`,
`validRepresentationPolicy`, `writerProcessStartIdentity`, `writerOwnerState`) verified to have no
remaining user in the store. Two names could not move with them:

- `MAX_SCRATCHPAD_WORKER_ENTRIES` / `MAX_SCRATCHPAD_SHARED_ENTRIES` are the store's exported surface
  (imported by `scratchpad-33-red` and `scratchpad-write-red`). They relocate to
  `coordination-internals.mjs` and the store re-exports the imported bindings — the slice-1 precedent
  — so every existing import path resolves to the same binding.
- `CANONICAL_ORDER_MIGRATION` is shared with the staying `migrateCanonicalOrderLedger`. It relocates
  to `canonical-order.mjs`, its domain module, and both the store and the ledger-writes module import
  it.

The layering stays one-way and acyclic: the store imports the module; the module imports
`coordination-internals.mjs`, `canonical-order.mjs` and the policy normalizers, never the store (CLW1
fails on that import).

## 2. The map

`impl/scripts/seam-inventory.mjs` gains one target and one rule:

- a module target `{ file: 'impl/src/coordination-ledger-writes.mjs', className: null, receiver:
  'store' }` — the same convention slices 1, 3 and 4 use;
- `effect:ledger_writes_port` (weight 3), matching `coordinationLedgerWrites.<member>(` — without it
  a delegate like `waitAfter`, whose only evidence was its body, would fall to the surface fallback.

The store's seam counts are unchanged — every one of the 26 delegates keeps `effect` — and the module
bodies keep their pre-move evidence verbatim (the receiver normalization rewrites `store.` to `this.`,
so the catalogue reads the moved body as the member it was). The corpus grows from 2 110 to 2 141 members (the 26
bodies plus the 5 relocated function declarations, which the module target collects like any other):

| seam | before | after | delta |
| --- | ---: | ---: | ---: |
| effect | 151 | 179 | +28 (26 bodies + the two writer-lease helpers) |
| observation | 782 | 784 | +2 (`validRoutePolicy`, `validRepresentationPolicy`) |
| surface | 443 | 444 | +1 (`nullPrototypeFields`, fallback) |
| admission / recovery | 518 / 216 | 518 / 216 | 0 |

The corpus fallback bucket gains exactly one member (`nullPrototypeFields`).

## 3. The pins that keyed code to the store file

- `frame-economics-red` F1 exempted the writer lease's exec buffer (`maxBuffer: 4_096`, riding
  `writerProcessStartIdentity`) by file. Slices 4 and 8 had already restructured those exemptions as
  `STORE_MODULE_FILES` in `impl/test/seam-member-source.mjs` — the files the store's module scope
  spans. This slice adds the fourth file; the pattern list is unchanged.
- `coordination-internals.test.mjs` CI2 pins the internals delegate census at 103; the two
  orientation read delegates now name the ledger-writes port, so the census is 101 and the comment
  says why.
- `coordination-admission.test.mjs` CA6 pins `STORE_MODULE_FILES` exactly; it gains the fourth file
  with the slice named.
- `worker-verdict-surface-red` needed no edit: slice 2 keyed its digest pins to member names, and no
  member it names moved in this slice.

## 4. Size

| file | before | after |
| --- | ---: | ---: |
| `impl/src/coordination-store.mjs` | 3 557 | 2 723 |
| `impl/src/coordination-ledger-writes.mjs` | — | 951 |
| `impl/src/coordination-internals.mjs` | — | +7 |
| `impl/src/canonical-order.mjs` | — | +5 |

The 26 moved members were 716 lines of store source and are 26 delegates (one line each; the
constructor three). The remaining delta is the 13 relocated declarations and the pruned builtin
imports (`node:fs` drops to the two functions the store still uses; `node:async_hooks`,
`node:child_process` and `node:v8` leave the store entirely).

## 5. Evidence

**The move is behavior-preserving, pinned before the edit landed.** The fixture (lease claim, create,
idempotent retry, task claim, the cheap moved-member paths, compaction, checkpoint, release, re-claim,
restart; then the canonical-order store and its receipt) ran against the pre-move store at `36295b70`
and against the moved store, producing identical output: the segment digest
(`7918adfd…`), the segment index digest, the post-compaction ledger digest (`0baa9c18…`), the
checkpoint digest (`05ae87e4…`), the canonical receipt digest (`a1d6aed1…`), the canonical ledger
digest, the restart's startup report (`segments_checkpoint`, 6 events, checkpoint valid) and full
snapshot parity. `CLW5` pins those digests.

**The generator refuses drift.** The extraction was produced mechanically from the parsed class: a
body whose string, template (substitutions masked), number or regex literals differ between the class
and the module aborts the generation; a `this` that is not a member access, a nested function with its
own receiver, or a local named `store` does the same.

**Names, arities and the port are pinned.** `CLW4` checks all 26 members against the class: each is
still declared, each delegate carries the member's own parameters, and `Function.length` on the
prototype is unchanged per member. `CLW2` requires the committed map, the delegates and the module's
exports to agree — 26 delegates, 26 exports, one name each — and the module's 31 map members to be
exactly the 26 bodies plus the 5 relocated helpers. `CLW6` constructs a store through the module
function on a blank prototype and requires the same startup report and append behavior as `new`.

**Determinism.** `CLW3` calls every moved export against two independently built, identically seeded
stores and requires identical values or identical refusals, normalizing the identities a write mints
(lease tokens, temp paths).

**Commands run** (in the shared checkout at `60714734` with the slice applied; the verify ran with
`BATON_HOST_CAPACITY_DISABLED=1`, the documented operator bypass this host's load requires):

```
node impl/scripts/seam-inventory.mjs --write   # regenerated after the last edit; check mode: ok (2 141 members)
node impl/scripts/surface-gate.mjs             # surface-gate: ok
node impl/scripts/run-suite.mjs test/seam-inventory.test.mjs test/coordination-ledger-writes.test.mjs \
  test/coordination-internals.test.mjs test/coordination-admission.test.mjs \
  test/frame-economics-red.test.mjs test/worker-verdict-surface-red.test.mjs \
  test/kg-activation-red.test.mjs test/issue286-ceilings.test.mjs \
  test/ledger-compaction-223-red.test.mjs test/segment-adopt-skip-fold-285-red.test.mjs \
  test/issue290-checkpoint-shape.test.mjs test/issue366-run-stop-replay-ceiling.test.mjs \
  test/phase57-acceptance-revocation.test.mjs test/orientation-red.test.mjs \
  test/blind-waits-red.test.mjs test/issue351-open-liveness.test.mjs \
  test/issue351-startup-answer.test.mjs test/issue434-deferred-open-reconstruction.test.mjs \
  test/cross-deployment-knowledge-red.test.mjs test/issue306-reincarnation-red.test.mjs \
  test/production-convergence.test.mjs test/create-driver-wiring.test.mjs \
  test/runtime-recorder-port.test.mjs test/coordination-ledger.test.mjs test/runtime-recovery.test.mjs
#   GREEN — 245 passed, 47 expected red, 0 unexpected, 0 stale expectation, 0 hung, 0 stalled
```

The fixture digests in CLW5 were captured against the pre-move store and re-verified unchanged after
slices 5 and 8 landed (the capture was re-run on the current tree before the move).

## 6. What this slice does not claim

- The class is not smaller in members — it is smaller in code. All 26 members still exist as
  delegates; inlining them into their call sites is a later slice's move, and the map's
  `ledger_writes_port` evidence is how it will find them.
- The module does not consume the recorder port. These functions are the write authorities the port
  carries; adapting them to record through the port is the runtime-effects work (slice 9), not this
  move.
- `grantContextPack` and `revokeBoardGrants` have no behavioral suite that names them; `CLW5`
  exercises both directly, and the store-level suites that drive them through the coordinator
  (`orientation-red`, the acceptance-revocation and compaction suites) are green.
