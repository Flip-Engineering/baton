# laws-wake-delivery — evidence

CLAIM: `bend docs/bend2/examples/laws-wake-delivery.bend` exits 0 in both runtime lanes, thirteen
fixtures replay with the verdicts the corpus records, an adapter row's derived routing is asserted
against the routing its fixture declares with a disagreement ending the run, and six controls fail
the law they target — one of them the host half answering no-frame for every row, which stops both
lanes.

Status: a witness for the delivery half of the proposed no-park entry. The entry stays proposed:
this file approves nothing, and `docs/bend2/laws-proposed.md` and `docs/bend2/laws-trace.md` are
unchanged by it. This witness replaces the first revision of the same two files; the host-mutation
check that revision lacked is the control below.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Node | v25.8.0 |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`, bend 2.0.25 |
| Base | the accepted laws tip `ea0bfbeb` on `baton/bend2-laws-r10-6f` |

Files under check, with the sha256 values this report records:

| File | sha256 |
|---|---|
| `examples/laws-wake-delivery.bend` | `40056d7acf7bcb69f7bbcf2383003ebced508c0a134edb4d344395cb538f7953` |
| `examples/laws-wake-delivery.js` | `727952f4ec4d9c589bcdff35996287f4fb887ec38ca59fcb739f9da93c4e8b87` |

## The routing column is metadata

`deriveWakeFrame` answers from the wake class table. It reports where a coordination row is routed,
projected from the row and the attribution it is given, and a frame with no `participantId` is
task-addressed in this witness. That is a statement about where the frame goes, and it carries
nothing about whether a seat's orchestrator was reached.

The witness therefore asserts the routing column and computes no verdict from it: the decision
table takes no routing parameter, and `routing_is_not_an_input_to_the_decision` holds every fixture
to the same verdict when its routing column is replaced by no-frame.

Delivery is decided by two other columns: the observation a fixture records about a delivered wake,
and a delivery receipt. Both are keyed by the turn's own worker, task and turn epoch, and both must
name the resolved orchestrator as the recipient.

## Identity, and what stays unconfirmed

Each fixture carries the turn's identity (`KeyStated{worker, task, turn}` or `KeyUnstated{}`), the
resolved orchestrator (`ResolvedSeat{seat}` or `Unresolved{}`), an observation
(`DeliveredToSeat{seat, key}`, `DeliveredToTask{key}`, `RecordedAbsent{key}` or `NotObserved{}`) and
a receipt (`ReceiptOnFile{seat, key}`, `ReceiptMissing{key}` or `ReceiptNotChecked{}`). The
comparisons are real: `key_matches` compares the three identity values with `Nat.is_eq`, and the
recipient is compared against the resolved seat id.

An unstated identity, an observation whose key differs from the turn's own key, a receipt recorded
for a different turn, and a delivery to another seat all leave the verdict unconfirmed. A recorded
absence whose key matches the turn rejects the wait. A live turn that ended without its report has
an unmet obligation, which is its own verdict.

## Commands and observed output

Every command ran from the worktree root. Output is verbatim.

### 1. The witness checks

```sh
$ bend docs/bend2/examples/laws-wake-delivery.bend --check-only
All terms check, but 5 defs rely on unsafe or foreign code:
- Real.adapter_routing
- replay_adapter
- replay
- one
- main
```

Exit code 0. The named defs are the ones that cross into the host half.

### 2. The corpus replays, interpreter lane

```sh
$ bend docs/bend2/examples/laws-wake-delivery.bend
park-routing-recorded-absent source=adapter derived=task-addressed declared=task-addressed verdict=rejected
park-observed-to-task source=adapter derived=task-addressed declared=task-addressed verdict=unconfirmed
recovery-delivered-to-orchestrator source=adapter derived=seat-addressed declared=seat-addressed verdict=delivered
park-transition-not-observed source=adapter derived=no-frame declared=no-frame verdict=unconfirmed
turn-key-unstated source=model verdict=unconfirmed
observation-key-unstated source=model verdict=unconfirmed
observation-key-differs source=model verdict=unconfirmed
delivered-to-another-seat source=model verdict=unconfirmed
receipt-on-file source=model verdict=delivered
receipt-key-differs source=model verdict=unconfirmed
no-report-live-turn source=model verdict=obligation-unmet
parent-unresolved source=model verdict=rejected
settled-turn source=model verdict=not-applicable
wake-delivery witness: 13 fixtures replayed; each adapter row's derived routing is asserted against the routing it declares, and every verdict must equal the corpus expectation.
```

Exit code 0.

### 3. The same corpus, emitted-JavaScript lane

```sh
$ bend docs/bend2/examples/laws-wake-delivery.bend -o <scratch>/laws-wake-delivery.js
$ node <scratch>/laws-wake-delivery.js
```

Exit code 0 for the emit and for the run, with the thirteen lines and the closing line byte-identical
to the interpreter lane. Both lanes reach `impl/src/wake-stream.mjs` through `require` from
`process.cwd()`.

The three adapter rows and the routing each derives:

| Row | Derived routing | Fixtures |
|---|---|---|
| `turn.paused` (the turn-end park's own row) | `task-addressed` | `park-routing-recorded-absent`, `park-observed-to-task` |
| `swarm.resume_decision_requested` | `seat-addressed` | `recovery-delivered-to-orchestrator` |
| `task.paused` (the park's coordination transition) | `no-frame` | `park-transition-not-observed` |

### 4. Controls

Every control is a scratch copy with its own edits; the witness itself is unchanged.

#### 4.1 The host half answers no-frame for every row

`return addressed ? 0 : 1;` becomes `return 2;`. The run stops on the first adapter fixture, in both
lanes.

```sh
$ bend <scratch>/c1/laws-wake-delivery.bend
park-routing-recorded-absent routing DISAGREE: declared task-addressed derived no-frame
```
Exit code 1.

```sh
$ bend <scratch>/c1/laws-wake-delivery.bend -o <scratch>/c1/out.js
$ node <scratch>/c1/out.js
park-routing-recorded-absent routing DISAGREE: declared task-addressed derived no-frame
```
Exit code 1.

#### 4.2 The remaining five

Control 2, an unstated identity treated as matching: `key_matches` answers `True{}` for
`KeyUnstated{}` on both sides.

```sh
$ bend <scratch>/c2/laws-wake-delivery.bend --check-only
Error:
- expected : Delivered{}
- observed : Unconfirmed{}
Location: every_fixture_matches_its_expectation
```
Exit code 1. Control 2b also moves the two corpus expectations, so the named law is the failing one:

```sh
$ bend <scratch>/c2b/laws-wake-delivery.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: an_unstated_identity_stays_unconfirmed
```
Exit code 1.

Control 3, the key comparison dropping the turn epoch: the third `Nat.is_eq` leaves `key_matches`.

```sh
$ bend <scratch>/c3/laws-wake-delivery.bend --check-only
Error:
- expected : Rejected{}
- observed : Unconfirmed{}
Location: every_fixture_matches_its_expectation
```
Exit code 1.

Control 4, a live turn with no report mapped to `NotApplicable{}`.

```sh
$ bend <scratch>/c4/laws-wake-delivery.bend --check-only
Error:
- expected : NotApplicable{}
- observed : ObligationUnmet{}
Location: every_fixture_matches_its_expectation
```
Exit code 1. Control 4b moves the corpus expectation too:

```sh
$ bend <scratch>/c4b/laws-wake-delivery.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: a_reportless_live_turn_is_an_unmet_obligation
```
Exit code 1.

Control 5, a receipt establishing delivery without its key.

```sh
$ bend <scratch>/c5/laws-wake-delivery.bend --check-only
Error:
- expected : Delivered{}
- observed : Unconfirmed{}
Location: every_fixture_matches_its_expectation
```
Exit code 1. Control 5b moves the corpus expectation too:

```sh
$ bend <scratch>/c5b/laws-wake-delivery.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: a_foreign_identity_stays_unconfirmed
```
Exit code 1.

Control 6, the routing-independence comparison given a variant that differs in a decision input:
`turn_without_routing` replaces the observation with a recorded absence as well as the routing.

```sh
$ bend <scratch>/c6/laws-wake-delivery.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: routing_is_not_an_input_to_the_decision
```
Exit code 1.

## The four facts the operator's decision needs

The witness declares the receipt column rather than reading it, because the tree carries no receipt
for a wake. At `origin/master`, whose wake table file is the same blob as this base
(`89059fcfca31a7c7140f695baa017f9aafaa779f`):

```sh
$ git grep -n "turn_report\|turnReport\|turn-report" origin/master -- impl/src
$ echo $?
1
```

```sh
$ git grep -n "owed_wake\|owedWake\|reportOwed" origin/master -- impl/src
$ echo $?
1
```

```sh
$ git grep -n "parentId" origin/master -- impl/src | grep -i "wake\|notify\|guide\|attention"
$ echo $?
1
```

The one write of a seat's parent is its lineage, and the tree's one delivery receipt is a peer
message's:

```sh
$ git grep -n "kind: 'message.delivered'" origin/master -- impl/src
origin/master:impl/src/coordinator.mjs:3452:          turnEpoch: this._safeTurnEpoch(handle), kind: 'message.delivered', actor: 'orchestrator',
origin/master:impl/src/runtime-event-handlers/observation-events.mjs:263:          worker: ctx.workerId, harness: ctx.harness, turnEpoch: ctx.turnEpoch, kind: 'message.delivered', actor: 'hub',
```

```sh
$ git grep -n "operationalKind('message.delivered')" origin/master -- impl/src/wake-stream.mjs
origin/master:impl/src/wake-stream.mjs:303:    rows: [operationalKind('message.delivered')],
```

That row projects the `guidance_delivered` class, whose summary reads "a message reached the
participant it was addressed to".

## Scope

This is a fixture replay and a pure decision table over it, plus routing metadata derived by the
deployment's own wake table. The corpus is enumerated: thirteen fixtures, chosen for the shapes the
proposed entry and the operator's decision name.

The witness reads nothing about a live resident. The adapter rows are built from the shapes the
runtime writes, with placeholder payload values, and the host half measures the derivation's shape.
A resident's own parked row and a resident's own delivery history are outside this check.

## Verdict

The claim holds at pin `a4952426` with bend 2.0.25 on this host: the witness checks and replays
thirteen fixtures in both runtime lanes with the recorded verdicts, each adapter row's derived
routing is asserted against the routing its fixture declares and a disagreement ends the run, an
unstated or foreign identity stays unconfirmed, an observation delivered to another seat stays
unconfirmed, a receipt establishes delivery only with this turn's identity and the resolved seat, a
reportless live turn has an unmet obligation, and six controls fail the law they target.
