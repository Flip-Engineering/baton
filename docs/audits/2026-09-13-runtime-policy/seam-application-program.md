# The application.mjs seam program — slices 15–19

Issue #259, the root's 2026-09-19 scope decision: `application.mjs` is in this swarm's scope —
the issue names three files, and `BatonApplication` (13.9k lines, 236 classified members) goes
through the same seam-cut discipline the store (slices 4–7) and the coordinator (slices 8–13)
went through. This document is the program plan; each slice gets its own execution design where
the bucket needs one, and its own `seam-slice-N.md` when it lands.

The invariant is the program's standing one: no behavior change, reviewable slices, delegates
keep name/parameter-list/arity, recording reroutes through the established ports, the inventory
regenerates after the last edit, and the SI6 corpus rows update in the same commit.

## 1. What the analysis establishes

`BatonApplication` holds no `this._log`, no `this._coordination`, and no recorder field. Its
members reach durable state through the driver's faces — `this.driver.coordination` (the raw
`CoordinationStore`; 20 `recordDriver` writes among the reads) and `this.driver.coordinator`.
The extraction therefore needs NO new port: the modules take the bare `application` receiver
(slice 3's briefing precedent, extended by slice 13's authority-free module), and moved bodies
keep their `application.driver.coordination.*` / `application.driver.coordinator.*` spellings
verbatim — recording stays exactly where it was, through the same store face, in the same order.
Calls into `coordinator.<member>(...)` are delegates into the coordinator's seam modules and
record through the coordinator's recorder port — that discipline is inherited, not rebuilt.

Bucket census at `3eef5139` (the committed inventory): observation 80, surface 95, admission 36,
recovery 15, effect 10.

## 2. Slice order

By the discipline that worked twice: the big mechanical read bucket first, the entangled
transport last.

| slice | bucket | members | target module |
| --- | --- | ---: | --- |
| 15 | observation | 80 | `application-observation.mjs` |
| 16 | admission | 36 | `application-admission.mjs` |
| 17 | recovery | 15 | `application-recovery.mjs` |
| 18 | effect | 10 | `application-effects.mjs` (thin; most effects pass through, per the map) |
| 19 | surface | 95 | `application-surface.mjs` |

Slice 15 and 16 are verbatim-bucket slices in the slice-10/11 discipline; each is a design-free
execution under this program doc unless the executor hits an entangled member, which it names and
brings back. Slices 17–19 each get their own short design act first: recovery carries `_buildView`
(467 lines, the corpus's largest member) and the restart-adjacent projections; effects is ten
members and the question is which of them are pass-throughs; surface is the transport — the
dispatcher members (`command`, `_commandDispatch`, `act` — the target's declared dispatchers) and
the 92 members they reach, where §4 finding 4's conclusion applies in the opposite direction from
the coordinator's: this class IS where the transport lives, so `application-surface.mjs` is a
transport module and the new target re-declares the dispatchers so their
`surface:transport_dispatch` evidence follows them.

## 3. The map and the corpus

One new target per module, each `{ className: null, receiver: 'application' }`;
`application-surface.mjs`'s target additionally re-declares `dispatchers` and any `surface`
members the class target declares today. The corpus grows by the moved bodies (the class keeps
236 members as delegates); the SI6 table gains one row per module in each slice's own commit.
The `application.mjs` row stays 236 throughout — delegates, as in the coordinator program.

## 4. Standing pins

Each slice adds its own pin series in the established shape: receiver discipline and one-way
imports by importer enumeration, the delegate census against the pre-move arity table, the
recording-census (empty for application-observation's read projections; present where bodies
record through coordinator delegates), the transitive relocation closure, the inverse-transform
audit, and the behavior suites the bucket's members answer to. `surface-truth.test.mjs` and the
MCP profile parity suites are slice 19's named gates.

## 5. What this program does not claim

- The coordinator's remaining 96 unmoved effect bodies (post-slice-12 tranches) are independent
  of this program and can interleave as mechanical filler when a lane is idle; neither blocks the
  other.
- The `_handleEvent` reducer refactor (handlers returning effects) is nobody's slice; the map's
  end state is recorded in the slice-14 design as a per-family design act with ordering proofs.
- The slice-8/9/10 async-delegate hop retrofit and delegate inlining remain follow-ups after the
  buckets are all extracted.
