# Seam slice 13 design — the coordinator's surface bucket moves to runtime-api.mjs

Issue #259, slice 13. The coordinator's surface bucket — 46 members, the last classified bucket
left on the class after slices 8–12 — moves to `impl/src/runtime-api.mjs`. This document is the
execution contract; the landed slice gets its own `seam-slice-13.md` in this directory.

The invariant is the program's standing one: no behavior change.

## 1. What the bucket is

The seam map's §5 table names `runtime-api.mjs` as the coordinator surface seam's home, "the
façade the servers call", and §4 finding 4 found the bucket's actual content: 45 of 46 members
are `surface:no_authority_touched` — payload keys, digests, pure predicates, in-memory
projections — plus `_publicHandle`, the caller-facing handle projection. Finding 4's conclusion
stands: no transport module grows here. The façade the servers call is the Coordinator class
itself, whose public verbs are now delegates into the seam modules.

`runtime-api.mjs` is therefore the coordinator's counterpart to the store's
`coordination-internals.mjs` (slice 1): the authority-free fallback bucket, under the map's name
for the surface cell. The design tension the name carries is recorded here so the slice review
does not have to rediscover it: the module holds helpers, not an API surface, and `_publicHandle`
is its one caller-facing member.

The §4.1 hazard did not carry forward: `_removeTaskWorktree`'s double definition is already
resolved on the class (one definition, classified `effect`), so this slice moves 46 distinct
members and no dead code.

## 2. The receiver convention: no recorder

Every member of this bucket is `surface:no_authority_touched`: none appends to the log, writes
coordination, drives an adapter, or touches a process or the filesystem. The module therefore
takes the bare receiver — `runtimeApi._harnessOf(coordinator, vendor)` — with NO recorder
parameter. The precedent is slice 3's `runtime-briefing.mjs`: an authority-free module whose
functions take `coordinator` and explicit value ports only. The delegates are plain non-async
forwarders without the recorder argument:

```
_harnessOf(vendor) { return runtimeApi._harnessOf(this, vendor); }
```

A pin proves the property rather than asserting it in prose: the module's source contains no
`recorder` spelling, no `this._log`, no `this._coordination`, and no adapter/process/fs call —
if a future edit moves recording into one of these helpers, the pin fails and the member no
longer belongs here.

The transform is verbatim with one reroute: `this.` → `coordinator.`. There is no recording
reroute because there is no recording. All 46 members are sync plain methods, so no async
forwarding and no `yield*` delegate appears in this slice.

## 3. The members

The 46, exactly as the committed inventory classifies them (`seam: surface` on
`impl/src/coordinator.mjs`): the 45 `no_authority_touched` helpers and `_publicHandle`
(96 lines, evidence `admission:policy_gate` + `surface:transport_dispatch` — a pure projection
of instance state; it reads `coordinator._fences.current`, `coordinator._tasks`,
`coordinator._harnessOf`, `coordinator._workerPolicyProjection`,
`coordinator._taskTopologyProjection` and records nothing). `_publicHandle` anchors the module:
it is the one member whose value crosses the package surface to the servers, which is the
justification the map's name for this cell carries.

Self-calls to moved members route through the class delegate (`coordinator.<member>(...)`), so
instance-level patches keep firing — the RO3 discipline. `_publicHandle`'s call to
`_harnessOf` becomes `coordinator._harnessOf(...)`, which delegates back into the module; that
round-trip is the same shape every extracted module already performs.

## 4. The map

One new target: `{ file: 'impl/src/runtime-api.mjs', className: null, receiver: 'coordinator',
surface: ['_publicHandle'] }`. The receiver normalization makes the catalogue's `this._fences`
spelling see the module body, so `_publicHandle`'s `admission:policy_gate` evidence follows it;
the `surface` declaration re-declares module-side exactly what the coordinator target declares
class-side, so `surface:transport_dispatch` follows it too. No port rule: the other 45 delegates'
bodies touch no authority, so they keep `surface` by the fallback rule — the same classification
they carry today. The corpus reads 2 461 members (2 415 + 46);
the coordinator keeps 424 members as delegates. The SI6 `CORPUS_COUNTS` table gains the
`impl/src/runtime-api.mjs: 46` row in the same commit as the regenerated inventory; no other row
changes.

The relocation closure is computed transitively (the slice-10 lesson): the moved bodies'
module-scope reads move with them and are imported back only where staying code still reads
them. The executor reports the closure in the slice doc.

## 5. Pins

The AP series in a new `impl/test/runtime-api.test.mjs`:

- AP1: receiver discipline — every module function's first parameter is `coordinator`; no
  `recorder` parameter or spelling anywhere in the module; one-way imports (the module imports
  no other `runtime-*` module).
- AP2: the delegate census — 46 delegates, name/parameter-list/arity preserved (all sync), each
  forwarding `this` and no recorder.
- AP3: the inverse-transform audit — each moved body reconstructed token-for-token from the
  landed module text under the inverse reroute, as in slice 10.
- AP4: the authority-free proof — the classifier's evidence for every module member is exactly
  `surface:no_authority_touched` on the module side too, except `_publicHandle`, whose
  `admission:policy_gate` + `surface:transport_dispatch` evidence follows it.
- Behavior: the surface-gate stays ok; the suites that exercise the helpers through the class
  (coordinator.test.mjs, surface-truth.test.mjs) are green unchanged.

## 6. What this slice does not claim

- The delegates are delegates; inlining call sites is a later slice's move.
- The `_handleEvent` family split is untouched; it is the map's last act and its design follows
  this slice.
- The `application-*` buckets remain outside this swarm's brief scope pending the root's
  decision.
- The slice-8/9/10 async-delegate hop retrofit remains a separate follow-up.
