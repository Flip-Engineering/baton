# The seam map — admission, effect, observation, recovery in the three runtime monoliths

Audit date: 2026-09-13. Revision under audit: `bfdebd53a127aa6d85dd8e34c4f900a557f7f7bc`
(`Make the canonical suite a verdict: per-file scheduler, expected-red manifest, progress
deadline`). Issue #259, slice 0: **no behavior change and no source move**. The only repository
writes are this file, `impl/scripts/seam-inventory.mjs`, `impl/scripts/seam-inventory.json`, and
the two tests named at the end.

Scope: the three classes that carry the runtime —
`Coordinator` (`impl/src/coordinator.mjs`, 15 498 lines),
`BatonApplication` (`impl/src/application.mjs`, 13 935 lines) and
`CoordinationStore` (`impl/src/coordination-store.mjs`, 18 043 lines) — 1 148 class members in
total. The question this map answers is mechanical:

> For every member of those three classes: which one runtime concern does it belong to, and on
> what evidence — so a later slice can split on measured entanglement instead of prose?

```
node impl/scripts/seam-inventory.mjs            # check the committed map; exit 1 when stale
node impl/scripts/seam-inventory.mjs --write    # regenerate impl/scripts/seam-inventory.json
node impl/scripts/seam-inventory.mjs --report   # counts + the entangled members
```

---

## 1. Method

Every member is a top-level `method_definition` of the named class, extracted with
`@ast-grep/napi`. Classification is by evidence, in three layers, and the fired rules are committed
with the member (`impl/scripts/seam-inventory.json`), so each label is traceable to a line of
source:

| Layer | Evidence | Example |
| --- | --- | --- |
| 1. Transport reachability | The class's own dispatcher calls the member (`_commandDispatch`'s `this.<verb>(` call sites) | `messageSend` → `surface` |
| 2. Authority + vocabulary rules | Calls into an authority that *is* a seam (`_log.append`, `_coordination.*`, adapter verbs, `_worktrees.*`, `fs` mutation, `reconcile*`), plus a closed name-family dictionary | `kill` → `effect`, `_validateTaskTopology` → `admission` |
| 3. Delegation | The member touches no authority but calls members already resolved by 1–2 (majority vote) | a pure forwarder inherits the seam of what it forwards to |

The member's seam is the **strongest** signal among layers 2–3 — not the sum, so a ubiquitous
recorder cannot outvote the one act a member exists to perform — with ties broken by
`SEAM_PRIORITY = [effect, recovery, admission, observation, surface]`: the seam a split must
centralize wins the tie. Evidence from *every* seam is retained; an **entangled member** is then a
mechanical fact, not a judgement call: one whose evidence spans three or more seams.

A member that still touches nothing is `surface` with the evidence
`surface:no_authority_touched` — a named finding for the split, never a silent default.

---

## 2. Counts per seam per file

| File | admission | effect | observation | recovery | surface | total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `impl/src/coordinator.mjs` (`Coordinator`) | 79 | 87 | 118 | 32 | 31 | 347 |
| `impl/src/application.mjs` (`BatonApplication`) | 34 | 9 | 78 | 15 | 93 | 229 |
| `impl/src/coordination-store.mjs` (`CoordinationStore`) | 173 | 22 | 227 | 50 | 100 | 572 |
| **All three** | **286** | **118** | **423** | **97** | **224** | **1 148** |

Three readings of that table matter for the split:

- **The coordinator is where the runtime acts** (87 of the 118 effect members). The application
  class owns almost no effect of its own (9): it translates transport into durable facts and
  coordinator calls, which is what makes it a surface (93 of its 229 members, the highest share
  of any file).
- **The store is a validator and a projection engine** (173 admission + 227 observation of 572),
  with only 22 effect members — the segment/ledger writes.
- **Recovery is small but load-bearing** (97 members): every one of them is a named
  reconcile/replay/recover/startup path, and they are the members most likely to be treated as
  "just another effect" by a careless split.

Of the 224 `surface` members, 70 are transport members reached by a dispatcher, 4 are `surface` by
delegation, and **150 are the `surface:no_authority_touched` fallback** (coordinator 30,
application 20, store 100): members whose bodies touch no catalogue authority at all — payload
keys, digests, segment paths, pure predicates. They are enumerated in the committed artifact and
are the one bucket the later slices must place by hand.

---

## 3. The ten largest entangled members

Entangled = evidence spans three or more seams. There are **60** such members; the ten largest by
body size, with the proposal each one implies. Line numbers are as of the revision above.

| # | Member (file:line) | Lines | Seams in evidence | One-line split proposal |
| ---: | --- | ---: | --- | --- |
| 1 | `_handleEvent` (`coordinator.mjs:12973`) | 1 074 | effect, admission, observation | Split by event family into `runtime-event-handlers/*`; each handler *returns* effects for the effect seam to execute and observations for the observation seam to record, so the reducer stops being the place both happen. |
| 2 | `_replay` (`coordinator.mjs:14469`) | 976 | recovery, admission, observation | Belongs to `coordination-replay.mjs` (recovery); the per-payload checks it walks move to the admission validators it already calls, so replay walks transactions and does not re-decide them. |
| 3 | `constructor` (`coordinator.mjs:814`) | 668 | recovery, effect, admission, observation | Keep the composition root in the façade, but move each wiring block (log facade, provider governance, lineage policy, atlas, advisory feeds) into a small `wire*()` factory: a constructor assembles, it does not validate. |
| 4 | `_recover` (`coordinator.mjs:5637`) | 548 | recovery, effect, admission, observation | `runtime-recovery.mjs` with an injected effect port — today it spawns, reaps and records inline, which is exactly why it cannot be tested at restart alone. |
| 5 | `_spawn` (`coordinator.mjs:4639`) | 421 | recovery, effect, admission, observation | The dispatch primitive belongs to `runtime-effects.mjs`; its preserved-session/reattach branch is recovery and moves behind a `resumePreserved*` entry that calls the primitive. |
| 6 | `_dispatch` (`coordinator.mjs:3614`) | 291 | effect, admission, observation | `runtime-effects.mjs`; extract the policy/liveness preflight into `runtime-admission.mjs` so the body reads: admitted → act → record. |
| 7 | `act` (`application.mjs:12601`) | 271 | recovery, effect, observation, surface | Keep a thin verb in `application-surface.mjs`; the semantic-control replay goes to `application-recovery.mjs`, the effect to the coordinator through `runtime-effects.mjs`. |
| 8 | `start` (`application.mjs:4656`) | 255 | effect, observation, surface | `application-surface.mjs` translates the command; the run-start effect itself belongs to the coordinator's effect seam. |
| 9 | `_spawnPlanWave` (`coordinator.mjs:4390`) | 239 | effect, admission, observation | Wave fan-out is effect (`runtime-effects.mjs`); the plan-node admission it performs is `runtime-admission.mjs`. |
| 10 | `_resolveRecord` (`coordinator.mjs:10486`) | 237 | effect, admission, observation | Split the decision (admission: which option is admissible) from the delivery (effect: adapter `respond`), which is currently one member. |

Beyond the ten, the same shape repeats at smaller size: `_commandDispatch` (202 lines,
application), `recover` (180), `_deliver` (176), `stopRunTargets` (171), `_finalizeStop` (156).

---

## 4. Findings the map produced

1. **`Coordinator` declares `_removeTaskWorktree` twice** (`coordinator.mjs:8999` and `:9116`).
   The second definition silently wins for every call site, including `coordinator.mjs:6419`
   (`this._removeTaskWorktree(task)`) and `:9253` (`…{ excludeHolderId: handle.id }`) — the first
   is dead code. Harmless today (the live one is a superset), but it is exactly the class of thing
   a seam split must not carry forward, and the map found it mechanically: the artifact lists both
   definitions and the checker keys members by definition, not by name.
2. **The route authority is a one-line wiring dependency with no test of its own.** The
   2026-09-13 incident (`5bd37fbf`: the shared-custody checkpoint displaced `route.record = …`
   from `createDriver`) was silent because every consumer guards the call with
   `typeof this._route.record === 'function'` (`coordinator.mjs:14341`, `:14382`). The
   `surface` seam has the same shape for every other injected authority. See §6 for the test that
   now fails when it happens again.
3. **Effect and observation are the entangled pair, not admission and effect.** Every large
   effect member records as it acts (`observation:log_append`, `observation:coordination_authority`
   appear in nearly all of them). A split that factors effects out but leaves recording inline
   reproduces the entanglement one level down; the effect modules need an injected recorder, which
   is the same port the recovery seam needs.
4. **The store's surface is not a transport.** All 100 of its `surface` members are
   `surface:no_authority_touched` — payload keys, digests, segment paths, pure predicates. The
   coordinator's 31 surface members are 30 fallback plus `_publicHandle` (the caller-facing handle
   projection), so neither class should grow a transport module in the split: the transport lives
   in `BatonApplication` (69 dispatcher-reached members) and the protocol servers.

---

## 5. Proposed target modules for the split slices

Named per seam and per file; slice 0 does not create them. `runtime-*` are the coordinator's
successor modules, `application-*` the application's, `coordination-*` the store's.

| Seam | Coordinator | Application | Store |
| --- | --- | --- | --- |
| admission | `runtime-admission.mjs` | `application-admission.mjs` | `coordination-admission.mjs` |
| effect | `runtime-effects.mjs` | `application-effects.mjs` (thin; most effects pass through) | `coordination-ledger-writes.mjs` |
| observation | `runtime-observation.mjs` | `application-observation.mjs` | `coordination-ledger.mjs` |
| recovery | `runtime-recovery.mjs` | `application-recovery.mjs` | `coordination-replay.mjs` |
| surface | `runtime-api.mjs` (the façade the servers call) | `application-surface.mjs` | `coordination-internals.mjs` (keys, digests, paths — the fallback bucket) |
| entangled | `runtime-event-handlers/*` (§3 row 1) | — | — |

Suggested slice order, by measured payoff rather than by size: (1) `coordination-internals.mjs` +
`coordination-replay.mjs` (the store's fallback and recovery buckets are well separated already),
(2) `runtime-effects.mjs` with the injected recorder port (§4.3), (3) `runtime-recovery.mjs`,
(4) `application-surface.mjs` + `application-recovery.mjs`, (5) the event-handler family split last
— it is the largest single move and it is only safe once the effect and observation ports exist.

---

## 6. What checks this map

- `impl/test/seam-inventory.test.mjs` — the map classifies every member of all three classes
  exactly once (re-parsing the source to prove nothing was skipped); the committed artifact
  regenerates byte-identically and deterministically; the check mode refuses a stale artifact
  (reclassified member, dropped member, vanished member, shifted line, drifted evidence, corrupt
  JSON); the classifier's layers are pinned on members whose seam is readable from what they call;
  the `surface:no_authority_touched` bucket stays visible and small (< 25 % of the corpus).
- `impl/test/create-driver-wiring.test.mjs` — the injected authorities `createDriver` assembles are
  consulted by a real run: `route.record` (the exact 5bd37fbf regression, plus a control test
  showing the failure is *silent*: the run still reports `completed` while route learning is
  dead), the worktree custody provider, the verifier runtime (digest cited in the verdict, and a
  pinned command that can only pass under the injected runtime), and the goal-plan authority
  (`goal_define`, `plan_propose`, `plan_approve`, `plan_dispatch` each observed with the real
  principal).

## 7. What this map does not claim

- It is textual and rule-based: a member is placed by the strongest authority its body touches, so
  a member that talks to four authorities is *labelled* by one of them and *reported* as entangled.
  Rows 1–10 of §3 are proposals to read, not moves to apply.
- The 150 fallback members carry no seam claim at all; they are marked so the split places them
  explicitly instead of inheriting a default.
- Line numbers and spans are as of the audited revision. The check mode fails on drift, so the map
  cannot silently rot: any edit that moves a member forces `--write` and a reviewable diff.
