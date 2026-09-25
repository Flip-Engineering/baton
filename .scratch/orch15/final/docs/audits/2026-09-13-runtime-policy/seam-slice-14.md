# Seam slice 14 — the `_handleEvent` family split into runtime-event-handlers/

Issue #259, slice 14 — the map's last coordinator act (§3 row 1). `_handleEvent` (1 108 lines:
a 286-line prologue of cross-cutting guards, a `switch (kind)` over 19 case groups, a post-switch
tail whose observers see every event) splits into `impl/src/runtime-event-handlers/` — five
modules, every body verbatim, recording inline through the recorder port. The execution contract
is `seam-slice-14-design.md` (7dc35096, gate amendment 940ff2f0); this file records what landed.

The reducer end state the map's row 1 describes (handlers *returning* effects and observations)
is explicitly NOT this slice — the arms are not pure, and collect-then-execute would reorder
record/act interleaves the ledger observes. This slice is the mechanical family split; the
invariant is the standing one: no behavior change.

Revision under audit: `3eef5139` (slice 13's landing) plus this slice's working tree. Write
scope: the five new modules, `impl/src/coordinator.mjs`, `impl/scripts/seam-inventory.mjs` (five
new TARGETS + the port rule) and its regenerated artifact, `impl/test/seam-inventory.test.mjs`
(five SI6 rows), `impl/test/runtime-event-handlers.test.mjs` (new), and this file.

## 1. The module layout (as designed)

| module | arms | members |
| --- | --- | ---: |
| `dispatcher.mjs` | the prologue guards, the switch, the tail, the two stop-confirmation arms, the default arm | 1 (`handleEvent`) |
| `process-lifecycle.mjs` | `lifecycle.process_started` / `process_ready` / `process_closed` / `process_reap_unconfirmed` | 4 |
| `turn-terminal.mjs` | `lifecycle.turn_completed` / `crashed` / `exited` | 3 |
| `interaction.mjs` | `question.*`, `approval.*`, `decision.*` (the answered/resolved/settled fall-through stays one function) + the relocated `isInteractionRequestId` | 6 |
| `observation-events.mjs` | `resource.tokens`, `scratchpad.write`, `context.read`, `orientation.rate`, `board.claim`, `board.report`, `message.send`, `native.subagent_observed` + the relocated `capBytesToScalar` | 9 |

The class keeps `_handleEvent` as a plain non-async forwarder
(`return eventHandlers.handleEvent(this, this._recorder, event, sourceVendor, opts);`). Every
caller — the adapter observer chain in runtime-recovery.mjs, the four admission-buffer flushes,
the spawn/reattach admissions — reaches the class member unchanged.

## 2. The gate finding and its resolution (design amendment 940ff2f0)

The pre-generation gate — no arm may reassign a prologue local the tail or a later guard reads —
fired on exactly one key: `nativeObservationEvent`, declared `let null` before the switch,
assigned by the `resource.tokens` and `default` arms, read by the tail's `route.observed` block
(the only write-back in the member; verified by AST walk over all 23 case groups — every other
arm only reads prologue locals, and the two prologue-internal reassignments are guard-local).
The lead ruled resolution (a): the key rides the ONE mutable ctx channel — arms assign
`ctx.nativeObservationEvent`, the tail reads it — and the amended EH2 pins the surface: a
spelling scan over the five modules admits `ctx.nativeObservationEvent =` and no other
`ctx.<key> =`.

The ctx record carries exactly the 11 keys the arms read (`event`, `workerId`, `kind`,
`harness`, `turnEpoch`, `payload`, `actor`, `handle`, `turnWasTerminal`, `appendAttributed`,
`nativeObservationEvent`) — the scope-aware free-variable computation (arm-local shadowing
excluded; shorthand property reads included); no key joins unread. `appendAttributed` rides ctx
as a prologue closure with its `this._log.append` rerouted to `recorder.log.append` inside.
Tail-only locals (`nativeObservation`, `observedModel`, `observedEffort`) stay dispatcher-local.

## 3. The transform

Per arm: the five reroutes (`this._log.` → `recorder.log.` — the slice-12 generalization —
plus mapEvent / recordDriver / coordination / receiver); ctx threading for the read keys
(shorthand properties expand: `{ harness }` → `{ harness: ctx.harness }`); switch-level `break`s
become `return`s in family functions (a family call returns to the dispatcher, which `break`s —
the tail runs either way, and no arm ever returned early past the tail, verified by exit
analysis: 23 groups, all `break`-terminated, zero early returns); the arm-terminating break is
dropped. Grouped cases move as one function per case GROUP. Unbraced cases (`resource.tokens`,
the stop-confirmations, `default`) keep their unbraced shape in the dispatcher.

Module-scope closure (the slice-10 lesson): `isInteractionRequestId` moves into
interaction.mjs with its only readers (the three interaction admission arms);
`capBytesToScalar` moves into observation-events.mjs and is imported back by the coordinator
(the staying `sendMessage` reads it). Everything else the moved texts read imports from its
existing home (runtime-recovery base layer, process-lifecycle.mjs, worker-policy.mjs, limits,
messages, coordination-internals, provider-faults).

## 4. The map and the census

Five new TARGETS, each `{ className: null, receiver: 'coordinator' }`, and one port rule
(`effect:event_handlers_port`, weight 3) matching the coordinator's `eventHandlers.` delegate
call and the dispatcher's `(coordinator, recorder, ctx)` family-call spelling. The delegate
keeps `effect` on the port evidence; the family functions classify on their own evidence
(processReapUnconfirmed reads `recovery` on its reconcile call; `isInteractionRequestId` reads
`admission` on its guard name; `capBytesToScalar` is `surface` fallback — all named, none hidden).

The corpus reads 2 485 members (2 462 + 23: the dispatcher's `handleEvent`, the 20 arm
functions, the two relocated helpers); the coordinator stays 424 (the body is a delegate). The
SI6 table gains the five module rows in this commit.

The recording census (EH3) — per module and in total equal to the pre-move member's, measured
against the pre-move text with the same needles (this corrects the rougher per-arm scan in the
family-inventory knowledge seed, which read 12/16/8/5; the audited numbers are):

| module | log.append | mapEvent | recordDriver | coordination |
| --- | ---: | ---: | ---: | ---: |
| dispatcher | 9 | 3 | 1 | 0 |
| process-lifecycle | 0 | 1 | 0 | 0 |
| turn-terminal | 0 | 3 | 0 | 0 |
| interaction | 0 | 12 | 10 | 1 |
| observation-events | 1 | 1 | 0 | 4 |
| **total = pre-move** | **10** | **20** | **11** | **5** |

## 5. Evidence

Pins that followed moved code, caught by the canonical suite's first run of this slice:

- `best-effort-catch-policy-red` G-46: the trust-gate call site (`_runTrustGate` naming its
  `_recordTrustGateEscape` handler) moved with the turn_completed arm to turn-terminal.mjs; the
  pin reads it there in the split's `coordinator.`/`ctx.handle` spelling.
- `worker-orchestrated-swarm-red` P-A10: the `message_depth_exceeded` refusal site moved with
  the message.send arm to observation-events.mjs; the anchor follows it.
- `runtime-api` AP4 caught a real regression this slice's own edit introduced: the new-targets
  edit to `seam-inventory.mjs` clobbered the slice-13 target's `surface: ['_publicHandle']`
  declaration, reclassifying `_publicHandle` admission module-side. Restored; AP4 green. The
  artifact regenerates clean over both slices' targets (2 485 members).

- The generation-time inverse-transform audit reconstructed the pre-move `_handleEvent` from the
  five modules token-for-token — IDENTICAL, 4 118 tokens — modulo exactly the glue §3 names.
- `EH1`–`EH5` green: receiver discipline and the import DAG (family modules import no sibling;
  the dispatcher imports the four; only coordinator.mjs imports the dispatcher — importer
  enumeration); the arm census bijection, the frozen ctx key list, and the one-key write-back
  surface; the recording census; the inverse-transform residue per family function; and one
  driven instance per family observed recording through the port on a real coordinator (a
  question round, a token row, a completion, a process-start refusal, and the stop confirmation
  through the RE3 kill flow).
- `node impl/scripts/seam-inventory.mjs` check mode: ok (2 485 members), regenerated after the
  last source edit. `node impl/scripts/surface-gate.mjs`: ok.
- Commands run (this checkout at `3eef5139` plus the slice; `BATON_HOST_CAPACITY_DISABLED=1` per
  this host's documented operator bypass):

```
node impl/scripts/run-suite.mjs test/runtime-event-handlers.test.mjs test/seam-inventory.test.mjs \
  test/coordinator.test.mjs test/turn-checkpoints-31a-red.test.mjs test/turn-checkpoints-31b-red.test.mjs \
  test/phase91-semantic-interrupt-preservation-red.test.mjs test/phase51-process-lifecycle.test.mjs \
  test/native-completion-loop.test.mjs test/omp-question-coordinator.test.mjs \
  test/phase56-drain-and-close.test.mjs test/peer-messages.test.mjs test/board-workerhalf-red.test.mjs \
  test/scratchpad-33-red.test.mjs test/orientation-red.test.mjs test/issue473-stop-incomplete-typed.test.mjs
#   415 passed, 1 unexpected — scratchpad-33 SP8, the host-environment row that fails identically
#   at the swarm base 90828b30 (named in slice 12's environmentRed); this slice adds no failing row
npm test --prefix impl   # the canonical suite; verdict recorded with the contribution
```

## 6. What this slice does not claim

- The reducer refactor (handlers returning effects and observations) — the slice-14 design §1
  records it as a per-family design act with ordering proofs, nobody's slice yet.
- The turn-admission buffering machinery stays on the class; the prologue reads it through the
  receiver.
- The coordinator's remaining 96 unmoved effect bodies (post-slice-12 tranches) are independent
  mechanical filler per the application program doc §5.
- The application.mjs program (slices 15–19) is next, per the root's 2026-09-19 scope decision.
- The slice-8/9/10 async-delegate hop retrofit and delegate inlining remain follow-ups.
