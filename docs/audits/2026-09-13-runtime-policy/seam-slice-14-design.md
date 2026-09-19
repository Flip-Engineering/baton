# Seam slice 14 design — the `_handleEvent` family split into runtime-event-handlers/

Issue #259, slice 14 — the map's last coordinator act (§3 row 1). `_handleEvent`
(coordinator.mjs:6069–7176, 1 108 lines) is the coordinator's event reducer: a 286-line prologue
of cross-cutting guards, a `switch (kind)` over 19 case groups, and a post-switch tail whose
observers see every event. Both ports it needs exist (slice 6's recorder port; the observation
and effect extractions landed). This document is the execution contract; the landed slice gets
its own `seam-slice-14.md`. The family inventory this design reads is kimi-effectsr's
scratchpad analysis (2026-09-19, "handleEvent family inventory").

The invariant is the program's standing one: no behavior change. Every guard, refusal, log row,
coordination write, state mutation, and return value keeps its exact shape and ordering.

## 1. What this slice is, and what it is not

The map's row 1 describes an end state where each handler *returns* effects and observations for
the seams to execute. That is NOT this slice. These arms are not pure: they read live state
between records (`_coordTransition` mutates the task a later line reads; the crash arm's retry
branch reads `handle.memberRetries` it just reassigned). Collect-then-execute would reorder
record/act interleaves that are observable in the ledger. This slice is the mechanical family
split: every body moves verbatim, recording inline through the recorder port exactly as slices
9–12. The reducer refactor, if it ever happens, is a per-family design act of its own with
ordering proofs, and is out of scope here.

## 2. The module layout

`impl/src/runtime-event-handlers/`, five modules:

| module | arms (kind) | approx. lines |
| --- | --- | ---: |
| `dispatcher.mjs` | the prologue guards, the switch, the post-switch tail, the two stop-confirmation arms (`control.interrupt_confirmed`, `kill.confirmed` — two-line delegations to `coordinator._onStopConfirmed`), the `default` arm | ~600 |
| `process-lifecycle.mjs` | `lifecycle.process_started`, `lifecycle.process_ready`, `lifecycle.process_closed`, `lifecycle.process_reap_unconfirmed` | ~120 |
| `turn-terminal.mjs` | `lifecycle.turn_completed`, `lifecycle.crashed`, `lifecycle.exited` | ~250 |
| `interaction.mjs` | `question.*`, `approval.*`, `decision.*` | ~220 |
| `observation-events.mjs` | `resource.tokens`, `worker_policy.observed`, `scratchpad.write`, `context.read`, `orientation.rate`, `board.claim`, `board.report`, `message.send`, `native.subagent_observed` | ~120 |

The stop-confirmation arms stay in the dispatcher because they contain no logic beyond the
delegation; moving them would create a module of two forwarding lines. The `default` arm is
dispatcher-local for the same reason.

The class keeps `_handleEvent(event, sourceVendor = null, opts = {})` as a plain non-async
forwarder to `dispatcher.mjs`'s `handleEvent(coordinator, recorder, event, sourceVendor, opts)`.
Every caller — the adapter observer chain in `runtime-recovery.mjs`, the four admission-buffer
flushes, and the spawn/reattach admissions — reaches the class member unchanged.

## 3. The context contract

The prologue computes locals the arms read. The arms move verbatim, so the dispatcher passes one
mutable context record:

```
const ctx = { event, workerId, kind, harness, turnEpoch, payload, actor, handle,
              turnWasTerminal, sourceVendor, opts /*, …exactly the prologue locals arms read */ };
```

Rules:

- The executor computes the exact prologue-local set by reading every arm's free variables; the
  set is enumerated in the slice doc and pinned (EH2). No local joins the record without an arm
  reading it.
- ~~If any arm REASSIGNS a prologue local~~ **Gate outcome (fired, resolved):** the mechanical
  census found exactly one write-back — `nativeObservationEvent` (declared at coordinator.mjs:6353,
  assigned by the `resource.tokens` arm at :6477 and the `default` arm at :7162, read by the tail
  at :7164–7170; 34 prologue locals otherwise read-only in the arms, no shadowing). The resolution
  is ctx threading: the key initializes as `nativeObservationEvent: null` in the ctx record, the
  two arm assignments become `ctx.nativeObservationEvent = …`, and the tail reads
  `ctx.nativeObservationEvent` — the mutable ctx record this section specifies already carries the
  pre-move shared-local semantics, and the inverse-transform audit treats the three re-spellings as
  named glue. The return-channel alternative was rejected: it adds a return-shape convention for
  two family functions to save one shared mutable key, and the EH pin below makes that key
  exhaustive, so the mutation surface is pinned smaller than the convention would make it.
- EH2 pins the write-back surface: `nativeObservationEvent` is the ONLY ctx key an arm function
  assigns (a spelling scan over the family modules admits `ctx.nativeObservationEvent =` and no
  other `ctx.<key> =`).
- Each arm becomes an exported function in its family module:
  `export function processClosed(coordinator, recorder, ctx)` — receiver, port, context. Arms
  with fall-through (grouped cases like `question.answered`/`approval.resolved`/`decision.settled`)
  move as one function per case GROUP, preserving the grouping exactly.

## 4. Recording reroutes

The proven four, plus the slice-12 generalization, applied inside dispatcher and family modules
alike: `this._log.` → `recorder.log.`, `this._coordMapEvent(` → `recorder.mapEvent(`,
`this._coordRecord(` → `recorder.recordDriver(`, `this._coordination` → `recorder.coordination`,
every other `this.` → `coordinator.`. The inventory's counts — 12 `log.append`, 16 `_coordMapEvent`,
8 `_coordRecord`, 5 `coordination` reads across the whole member — distribute across the five
modules and the census pins each module's share; the total must equal the pre-move count.

The relocation closure is computed transitively (the slice-10 lesson) for the module-scope
declarations the moved texts read; `runtime-event-handlers/` modules import from the existing
homes (`runtime-recovery.mjs` for the base-layer names, `runtime-api.mjs` for the moved helpers
they read through the receiver — no: helper reads stay receiver calls, `coordinator._harnessOf`,
so instance patches keep firing; only true module-scope declarations relocate or import).

## 5. The map

Five new targets, one per module, each `{ className: null, receiver: 'coordinator' }`. A port
rule per the established pattern: `effect:event_handlers_port` (weight 3) matching
`eventHandlers.` / the family-module call spellings in the dispatcher, so the delegate and the
dispatcher keep `effect` — `_handleEvent` is effect-classified today on its adapter-facing
evidence, and the delegate's only authority is the call. The SI6 `CORPUS_COUNTS` table gains one
row per new file in the same commit as the regenerated inventory; the coordinator's row stays
424 (the body becomes a delegate). The executor reports the per-file counts in the slice doc.

## 6. Pins

The EH series in a new `impl/test/runtime-event-handlers.test.mjs`:

- EH1: receiver discipline and one-way imports — family modules import no other
  `runtime-event-handlers/` module; the dispatcher imports the four family modules; nothing but
  `coordinator.mjs` imports the dispatcher; the recorder is the only recording path.
- EH2: the arm census — the pre-move switch's exact kind set (19 case groups, the grouped cases
  enumerated) maps bijectively to the family functions plus the dispatcher-local arms, and the
  ctx key list is frozen.
- EH3: the recording census per module; the totals equal 12/16/8/5.
- EH4: the inverse-transform audit — prologue, tail, and every arm reconstruct the pre-move
  `_handleEvent` text token-for-token modulo the reroutes, the ctx threading, and the arm-call
  glue.
- EH5: behavior — the event-driven suites (turn-checkpoints-31a/31b, phase91, the lifecycle and
  stop-confirmation suites) green unchanged, and one driven instance per family observed recording
  through the port (a spawn for process-lifecycle, a completion for turn-terminal, a question
  round for interaction, a token row for observation-events).

## 7. What this slice does not claim

- The reducer refactor (handlers returning effects and observations) — see §1.
- The turn-admission buffering machinery (`this._turnAdmission*`) stays on the class; the
  prologue reads it through the receiver.
- The application.mjs program is the next design act (the root's 2026-09-19 scope decision),
  sequenced after this slice lands.
- The slice-8/9/10 async-delegate hop retrofit and the delegate inlining remain follow-ups.
