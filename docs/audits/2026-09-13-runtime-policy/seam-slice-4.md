# Seam slice 4 — the store's observation bucket moves out

Issue #259, slice 4. The map (`docs/audits/2026-09-13-runtime-policy/seam-map.md` §5) names
`coordination-ledger.mjs` as the store's observation successor, and the committed artifact has carried
241 store members in that bucket — the projection, the fold, the scratchpad and board projections,
the knowledge projections, the run/lineage/topology accessors — since slice 0. This slice is that
move.

Revision under audit: `f20a5ad7` plus this slice's working tree. Write scope: the new module, the
store, `impl/scripts/seam-inventory.mjs` (one target, one rule, one collector change) and its
regenerated artifact, `impl/test/coordination-ledger.test.mjs`, `impl/test/seam-member-source.mjs`,
the seven source-scan pins §2 names, and this file.

The invariant is slice 1's: **no behavior change**. Every member keeps its name, parameter list,
arity, return shape and error codes; the store keeps every call site; no durable format, segment,
digest, or idempotency key moves. The ledger's bytes and the projection the fold builds are
byte-identical for the same fixture (§5).

## 1. What moved

All 241 members the map places in the observation bucket leave the class, into
`impl/src/coordination-ledger.mjs`, and every one keeps a delegate on `CoordinationStore` — same
name, same parameter list, same arity:

| state convention | count | delegate shape |
| --- | ---: | --- |
| no state | 21 | `foo(a) { return coordinationLedger.foo(a); }` |
| one collection | 33 | `foo(a) { return coordinationLedger.foo(this._c, a); }` |
| the store | 187 | `foo(a) { return coordinationLedger.foo(this, a); }` |

The module is one-way and acyclic: the store imports it, it never imports the store (`CL1` fails on
that import, on a `this` outside a relocated class, and on module-level state that is ever assigned).

**A moved body still reaches its siblings through the class.** `this._append(…)` becomes
`store._append(…)` — the delegate — not a bare module-local call to the moved function. The delegate
is the member's one entry point, so a store whose instance member is patched in place still sees the
patch: `phase85-coordination-projection-poison-red` CP85-P1 installs a throwing `_apply` on one store
and requires the write path to honour it, and it is green. A module-local call would bypass that
patch, which is why the rewrite goes the long way round.

The one exception is `#knowledgeRecallPreview`, a **private** method in the bucket. `store.#name(` is
not addressable outside the class body, and a private name cannot be overridden from outside it
either, so its body moves to the module as `knowledgeRecallPreview` and the moved
`recallKnowledgeBounded` calls it module-locally; the class keeps a `#knowledgeRecallPreview`
delegate like every other member. `CL4` pins the name pairing.

The moved bodies also pull the store primitives they read: **72 declarations** (board bounds and
digests, knowledge vocabularies and projections, scratchpad grammar, the projection-poison readers,
the markdown/URL helpers) travel with them, and the declarations the store still reads are exported
from the module and imported back, so the store's own code and its re-export surface are unchanged.
`STORE_EXEMPTIONS`/F1 and `CL2` both check the second half of that: every name the store imports from
the module exists there.

```js
// before, in the class
_taskTopologyHint(event) { … 11 lines … }
// after, on the class …
_taskTopologyHint(event) { return coordinationLedger._taskTopologyHint(this, event); }
// … and in coordination-ledger.mjs
export function _taskTopologyHint(store, event) { … the same 11 lines, `this.` → `store.` … }
```

## 2. The pins that read a moved member's own text

Nothing stayed behind for a pin's sake. Seven source scans *were* keyed to the old file, and each one
reads a member's text rather than its behavior, so each was converted to resolve the member by name:

| pin | what it read | what it reads now |
| --- | --- | --- |
| `frame-economics-red` F1 | 13 file-keyed store exemptions (`MAX_SCRATCHPAD_*`, `scratchpadString(…, 2_048)`, the identity-lane alternation) | one table stated once, exempted in **both** files the store's module scope spans |
| `repl1-kind-inventory-red` KI1/KI2 | `CoordinationStore.prototype._apply.toString()` | `memberSource('_apply')` |
| `scratchpad-33-red` SP4 | `…prototype._apply` / `…prototype._appendBatch` `.toString()` | `memberSource('_apply')` / `memberSource('_appendBatch')` |
| `scratchpad-write-red` P-A4/P-A7 | `grep -an` over `coordination-store.mjs` for the `_byKey` replay terms and the worker-partition refusal | `grepSourceLines(memberSource('writeScratchpad'), …)` |
| `issue366-run-stop-replay-ceiling` (c) | the store text between two member headers | `siteSource('_runStopContextTargets')` + `siteSource('_runStopTargets')` |
| `issue391-store-goal-plan-pages` (c)/(d) | the store file's `goalPlanPage` import and its one `goal_plan_status_oversize` site | the reader list (`…internals`, `…ledger`) and both files of the store's module scope |
| `orchestrator-plan-object-red` R3 | `grep -an SCRATCHPAD_STEP_STATES coordination-store.mjs` | the same grep over both files |

`impl/test/seam-member-source.mjs` (new) is the shared resolver: it reads the live seam inventory,
returns every window a member occupies — the class delegate and, for a moved member, the body in its
module, joined — and normalizes a module target's explicit receiver back to `this.`, so a scan keyed
to the member reads the source it read before the move. It is the mechanism slice 2 introduced for
F1's `F_MEMBER_EXEMPTIONS` and `worker-verdict-surface-red` C4/E4, used by name from the other side.
`CL6` pins it: `_apply` resolves to both files, the fold literals and the tripwire are reachable
through it, `writeScratchpad`'s partition refusal and `_byKey` terms come with it, and a name that is
not a member resolves to nothing rather than to a stray file.

Two of these pins needed a second look, and both are recorded here rather than papered over:

- **issue366**: the pin's window always ran from `_runStopContextTargets` through `_runStopTargets`,
  so it reads both members. A member-scoped window covering only the first lost the sentence the pin
  asserts (`a projection of the ledger`), which is what the conversion now preserves.
- **issue391 (c)**: after the move the *store* no longer imports `goalPlanPage` at all — its only
  reader left — so the pin's claim is now stated over the modules that call it, plus the new claim
  that the store cuts no pages of its own.

## 3. Size

| file | before | after |
| --- | ---: | ---: |
| `impl/src/coordination-store.mjs` | 17 143 | 10 324 |
| `impl/src/coordination-ledger.mjs` | — | 7 482 |
| `impl/test/coordination-ledger.test.mjs` | — | 467 |
| `impl/test/seam-member-source.mjs` | — | 71 |

The 241 moved members were 6 613 lines of store source and are 241 delegate lines. The 72 relocated
declarations are the rest of the delta, with the header and import bookkeeping.

## 4. The map

`impl/scripts/seam-inventory.mjs` gains:

- a module target for `impl/src/coordination-ledger.mjs` with `receiver: 'store'`, so the moved
  bodies stay mapped by name in their new home;
- `observation:ledger_port` (weight 3) — the member's body delegates into the module — the same
  evidence slice 1 added for the replay port and slice 3 for the brief port. Without it a delegate is
  read off its name; with it the 241 keep the seam their bodies had;
- one collector change: a module target reads `generator_function_declaration` as well as
  `function_declaration`, or `_openCheckpointRefresh` — the one moved member whose body is a
  generator — would leave the map at the moment it moved. `CL2` fails on that gap.

The store, before and after (members are constant: 604 both times):

| seam | slice 3 | slice 4 |
| --- | ---: | ---: |
| admission | 172 | 172 |
| effect | 26 | 26 |
| observation | 241 | 243 |
| recovery | 52 | 52 |
| surface | 113 | 111 |
| — of which the fallback | 4 | 4 |

Corpus: 1 596 → 1 870 members across nine targets; the new target carries 272 (the 241 moved members
and 31 relocated module-scope functions), classified observation 254, surface 11, admission 6, effect
1. The fallback bucket — the map's own measure of how much the split has placed by hand — goes from
237 to 248 corpus-wide, with the store's share unchanged at 4.

Two store members reclassify, and both are the same mechanism worth naming: `contextCalls` and
`traceKnowledgeBounded` were `surface:no_authority_touched` by name; their bodies forward to moved
projections, so they now inherit `observation` from what they forward to. No other member of any
target changed seam.

## 5. Evidence

**The move is behavior-preserving.** The same fixture (create, idempotent retry, claim, restart) run
against the pre-move store and the moved store produces identical results, and the durable bytes are
identical: ledger SHA-256
`5ca071974bfd257f484103ab482443d9e5e7994142f10f405104fc2e82c9de72` and projection digest
`6f9c213243f5170ee116d2f3ad2a0ee0559ab65ea01607a94aeca9143301bb0a`, both pinned in `CL5`.

**Every literal is byte-identical.** The generator compares the multiset of string, template, number
and regex literals of each member before the move against the module function after it, normalizing
only the receiver spelling; the report is **0 findings over 241 members**.

**The helpers are pure or explicitly state-fed.** `CL3` calls every exported helper of the module
against two independently built, identically seeded stores and requires identical values (or
identical refusals), and requires the helpers handed one collection not to write it. `CL1` proves
context-freedom structurally (no `this`, no module-level binding ever assigned, no store import).

**Names, arities, and the port are pinned.** `CL4` checks all 241 moved members against the class:
each is still declared, each delegate carries the member's own parameters and `Function.length` on
the prototype is unchanged, and the delegate names the member's own body. `CL2` requires the
committed map, the delegates, the module's exports and the store's imports to agree, one delegate per
helper.

**Commands run:**

```
node impl/scripts/seam-inventory.mjs --write   # regenerated the committed map
node impl/scripts/seam-inventory.mjs           # seam-inventory: ok (1 870 members)
node impl/scripts/run-suite.mjs test/seam-inventory.test.mjs test/coordination-internals.test.mjs \
  test/coordination-ledger.test.mjs test/frame-economics-red.test.mjs test/worker-verdict-surface-red.test.mjs
  # GREEN — 86 passed, 13 expected red, 0 unexpected, 0 stale
node impl/scripts/run-suite.mjs <the 23 files that pin or drive the moved members>
  # GREEN — 263 passed, 61 expected red, 0 unexpected, 0 stale
node impl/scripts/run-suite.mjs <every test file that names the store or a split module: 216 files>
  # RED — 2 504 passed, 281 expected red, 1 unexpected, 0 stale
```

The one unexpected row is `test/served-commit-306.test.mjs :: #306 (2)`, and it is red at the
pre-slice tree too: a pristine copy of this worktree with the pre-move store, run over the same 216
files, reports that row by name (`not ok 2296 - #306 (2) …`). It is the environment (§3 of slice 3's
note records the same row), not this slice. The canonical suite was not run: it is environment-red at
baseline on this host, which the brief records as a precondition.

## 6. What this slice does not claim

- The class is not smaller in members — it is smaller in code. All 241 moved members still exist as
  delegates; inlining them into their call sites (and deleting the ones with no external caller) is a
  later slice, and `ledger_port` is how it will find them.
- The map does not classify *inside* `coordination-ledger.mjs` by hand: its 272 members carry the
  seam the classifier reads off their bodies and evidence. `coordination-ledger.test.mjs` pins the
  module's shape instead (context-freedom, the bijection, purity, arity, the fixture).
- Seven source-scan pins were converted (§2). Each conversion preserves the pin's claim and none
  changes a test's expectation about behavior; two of them (issue366's window, issue391's reader
  list) also had to restate their claim in the module's terms, which §2 records.
- `seam-map.md` remains slice 0's audit at revision `bfdebd53`; its §2 table and its §5 proposal for
  the store describe that revision. The committed artifact is the live map; this file records the
  delta.
