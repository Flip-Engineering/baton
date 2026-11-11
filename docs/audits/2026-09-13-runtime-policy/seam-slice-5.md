# Seam slice 5 — the store's admission bucket moves out

Issue #259, slice 5. Slice 4 moved the store's observation bucket into `coordination-ledger.mjs`;
this slice takes the other large bucket the map names for the store (seam-map §5):
`coordination-admission.mjs`, the 172 members the committed artifact classifies admission — the
validators, the guards, the authority gates and the normalizers that decide what may start.

Revision under audit: `5677e147` plus this slice's working tree. Write scope: the new module, the
store, `impl/scripts/seam-inventory.mjs` (one target, one rule, and one restored slice-4 hunk) and its
regenerated artifact, `impl/test/coordination-admission.test.mjs`, `impl/test/seam-member-source.mjs`
(the shared file list gains this module), the four source-scan pins §2 names, and this file.

The invariant is slice 1's: **no behavior change**. Every member keeps its name, parameter list,
arity, return shape and error codes; the store keeps every call site; no durable format, segment,
digest, or idempotency key moves.

## 1. What moved

All 172 members the map places in the admission bucket leave the class, into
`impl/src/coordination-admission.mjs`, and every one keeps a delegate on `CoordinationStore` — same
name, same parameter list, same arity:

| state convention | count | delegate shape |
| --- | ---: | --- |
| no state | 18 | `foo(a) { return coordinationAdmission.foo(a); }` |
| one collection | 3 | `foo(a) { return coordinationAdmission.foo(this._c, a); }` |
| the store | 151 | `foo(a) { return coordinationAdmission.foo(this, a); }` |

The module is one-way and acyclic, and it imports the observation module for the primitives slice 4
relocated there (`boardBounded`, `coachingRefusal`, `validEnvRef`, the board digests, the knowledge
vocabularies) rather than re-declaring any of them: the store imports both, neither imports the store
(`CA1` fails on that import, on a `this` outside a relocated class, and on module-level state that is
ever assigned).

**A moved body still reaches its siblings through the class**, exactly as in slice 4: `this._apply(…)`
becomes `store._apply(…)` — the delegate — so an in-place instance patch of a moved member is still
honoured (`CA5` patches `_validateTaskTopology` and requires the create path to see it).

The moved bodies pull **17 declarations** out of the store's module scope with them (the
canonical-order policy normalizer, the provider-failure codes, the representation and board
vocabularies, the task-topology helper `assertTargetSetAdmissible`). The declarations the store still
reads are exported from the module and imported back, so the store's own code and its re-export
surface are unchanged.

## 2. The pins that read a moved member's own text

Four more source scans were keyed to the old file, and each is converted the same way slice 4
converted its seven: resolve the member (or the store's module scope) by name through
`impl/test/seam-member-source.mjs`.

| pin | what it read | what it reads now |
| --- | --- | --- |
| `frame-economics-red` F1 | the store's file-keyed byte exemptions | the same table, exempted in every file of `STORE_MODULE_FILES` |
| `issue286-ceilings` CEIL1 | `coordination-store.mjs` for the removed revocation ceilings and the "no ceiling" note | the same claim over `STORE_MODULE_FILES` |
| `kg-activation-red` KG-A5 | `coordination-store.mjs` for the admit gate's lease binding, its refusal taxonomy and exactly one gate definition; and a src-wide scan for an auto-admit caller | the same claim over `STORE_MODULE_FILES`, plus one gate body in the module and one delegate on the class |
| `issue366-run-stop-replay-ceiling` (d) | the store text around `assertTargetSetAdmissible` | `siteSource('assertTargetSetAdmissible')` — the live map carries the helper |

`impl/test/seam-member-source.mjs` grows the one new fact these four share: `STORE_MODULE_FILES`, the
files the store's module scope spans after slices 4 and 5 — `coordination-store.mjs`,
`coordination-ledger.mjs`, `coordination-admission.mjs`. `CA6` pins it, and pins that the gate body
left the store file (a file-keyed scan would now miss it).

## 3. Size

| file | before | after |
| --- | ---: | ---: |
| `impl/src/coordination-store.mjs` | 10 324 | 3 557 |
| `impl/src/coordination-admission.mjs` | — | 7 167 |
| `impl/test/coordination-admission.test.mjs` | — | 430 |

The 172 moved members were 6 851 lines of store source (measured at the slice-0 revision) and are 172
delegate lines. The 17 relocated declarations are the rest of the delta.

## 4. The map

`impl/scripts/seam-inventory.mjs` gains a module target for `impl/src/coordination-admission.mjs`
(`receiver: 'store'`) and the `admission:admission_port` rule (weight 3), the counterpart of slice
4's `ledger_port`. This slice also **restores the slice-4 ledger target**, which slice 8's commit
(`5677e147`) dropped while editing the same `TARGETS` array: without it the map no longer saw
`coordination-ledger.mjs` at all, so the 272 members it carries (241 observation bodies and 31
relocated declarations) were missing from the committed artifact, which read 1 661 members. The class
target keeps all 604 store members throughout.

The store, before and after (members are constant: 604 both times):

| seam | slice 4 | slice 5 |
| --- | ---: | ---: |
| admission | 172 | 175 |
| effect | 26 | 26 |
| observation | 243 | 243 |
| recovery | 52 | 52 |
| surface | 111 | 108 |
| — of which the fallback | 4 | 4 |

Corpus: 1 661 → 2 110 members across eleven targets; the new target carries 177 (the 172 moved members
and 5 relocated module-scope functions), the restored ledger target 272. Three store members
reclassify — `contextCallArtifacts`, `contextCompletedCallSource`,
`contextCompletedCallSourceAndArtifacts`, all `surface` with only the fallback evidence and now
`admission` because their bodies forward to moved validators. No other member of any target changed
seam.

## 5. Evidence

**The move is behavior-preserving.** The same fixture (create, claim, the five admission refusals,
idempotent retry, restart) run against the pre-move store and the moved store refuses with the same
typed codes — `already_assigned`, `duplicate_task`, `missing_dependency`, `deps_unsatisfied`,
`run_stop_invalid` — and writes identical bytes: ledger SHA-256
`9bbb02a1dcbea7f50474a8a54d7162b01236f761c7be17e219becb0d93d1b962` and projection digest
`84cc51b61594ef9dec990893f9b51c4e83c21196895a26a7a19ca2989d4538f7`, both pinned in `CA5`.

**Every literal is byte-identical.** The generator compares the multiset of string, template, number
and regex literals of each member before the move against the module function after it, normalizing
only the receiver spelling; the report is **0 findings over 172 members**.

**The helpers are pure or explicitly state-fed.** `CA3` calls every exported helper of the module
against two independently built, identically seeded stores and requires identical values (or
identical refusals), and requires the helpers handed one collection not to write it. `CA1` proves
context-freedom structurally.

**Names, arities, and the port are pinned.** `CA4` checks all 172 moved members against the class:
each is still declared, each delegate carries the member's own parameters and `Function.length` on the
prototype is unchanged. `CA2` requires the committed map, the delegates, the module's exports and the
store's imports to agree, one delegate per helper.

**Commands run:**

```
node impl/scripts/seam-inventory.mjs --write   # regenerated the committed map (last edit before check)
node impl/scripts/seam-inventory.mjs           # seam-inventory: ok (2 110 members)
node impl/scripts/run-suite.mjs test/seam-inventory.test.mjs test/coordination-internals.test.mjs \
  test/coordination-ledger.test.mjs test/coordination-admission.test.mjs test/frame-economics-red.test.mjs \
  test/worker-verdict-surface-red.test.mjs
  # GREEN — 92 passed, 13 expected red, 0 unexpected, 0 stale
node impl/scripts/run-suite.mjs <the 30 files that pin or drive the moved members>
  # GREEN — 312 passed, 62 expected red, 0 unexpected, 0 stale
node impl/scripts/run-suite.mjs <every test file that names the store or a split module: 219 files>
  # RED — 2 513 passed, 281 expected red, 6 unexpected, 0 stale
```

None of the six unexpected rows is this slice's, and each is accounted for by a run that does not
contain it:

- `test/served-commit-306.test.mjs :: #306 (2)` — red at the pre-slice baseline too (§3 of slice 3's
  note records the same row).
- `test/phase10.1-reconciliation.test.mjs :: WF1-WF4` and `test/phase11-persistent-sessions.test.mjs`
  (three rows, all `Promise resolution is still pending…`) — a clean `git worktree add` at `5677e147`
  (this slice's changes absent) runs the same two files and reports **the same four rows, name for
  name**: WF1-WF4, SC18, NR1/NR3 and NR3/NR5. They belong to the concurrent slice 8 and the host, not
  to this move.

## 6. What this slice does not claim

- The class is not smaller in members — it is smaller in code. All 172 moved members still exist as
  delegates.
- The map does not classify inside `coordination-admission.mjs` by hand;
  `coordination-admission.test.mjs` pins the module's shape.
- Four source-scan pins were converted (§2); each conversion preserves the pin's claim, and none
  changes an expectation about behavior.
- The ledger target's restoration (§4) repairs a hunk this slice's neighbour dropped; it is the same
  entry slice 4 committed, and the artifact's regeneration is what makes it visible.
- `seam-map.md` remains slice 0's audit at revision `bfdebd53`; the committed artifact is the live map,
  and this file records the delta.
