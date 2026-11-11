# laws-wake-delivery — evidence

CLAIM: `bend docs/bend2/examples/laws-wake-delivery.bend` exits 0 in both runtime lanes, eighteen
fixtures replay with the verdicts the corpus records, delivery is confirmed only by an explicit
`DeliveredToSeat` observation or `ReceiptOnFile` receipt whose key equals the turn's own
worker/task/turn identity and whose recipient is the resolved orchestrator, an adapter row's
derived routing is asserted against the routing its fixture declares with a disagreement ending
the run, and the host-mutation control stops both lanes.

Status: a witness for the delivery half of the proposed no-park entry. The entry stays proposed:
this file approves nothing, and `docs/bend2/laws-proposed.md` and `docs/bend2/laws-trace.md` are
unchanged by it. This witness supersedes the first revision (`1be5c81f`, rejected at seq 165906
for a routing value that was printed and never asserted) and the second revision (`656ee105`,
rejected at seq 167985 because a `Nat` fallback of `0n` in the seat extractors let a matching key
alone confirm delivery at seat zero). The branch is cut from `origin/bend2-rewrite` at `e16023e0`,
which carries the accepted laws tip `ea0bfbeb` byte-identically; the accepted tip and
`docs/bend2/laws-check.py` are unchanged by this work.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Node | v25.8.0 |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868`, bend 2.0.25 |
| Base | `origin/bend2-rewrite` `e16023e0` (the landing of the accepted laws tip `ea0bfbeb`), branch `baton/bend2-laws-witness7f` |

Files under check, with the sha256 values this report records:

| File | sha256 |
|---|---|
| `examples/laws-wake-delivery.bend` | `0762ac97c210817c9ac7f03dac05336d6461ba0cb1b1f0ad0d1ae3c5f20208a7` |
| `examples/laws-wake-delivery.js` | `727952f4ec4d9c589bcdff35996287f4fb887ec38ca59fcb739f9da93c4e8b87` |

## The correction the third revision makes

Revision 2 derived the recipient of a receipt or observation through `receipt_seat` and
`obs_seat`, which returned `0n` for every constructor other than `ReceiptOnFile` and
`DeliveredToSeat`. With the orchestrator resolved to `ResolvedSeat{0n}`, a receipt or observation
of any kind whose key matched the turn confirmed `Delivered`. The reviewer's three admitted inputs
were: a `ReceiptMissing` with a matching key beside `NotObserved` (required `Unconfirmed`,
observed `Delivered`), a `DeliveredToTask` with a matching key (required `Unconfirmed`, observed
`Delivered`), and a `RecordedAbsent` with a matching key (required `Rejected`, observed
`Delivered`).

The third revision removes the `Nat` fallbacks. `receipt_holds` and `obs_seat_holds` match the
`ReceiptOnFile` and `DeliveredToSeat` constructors directly and answer `False{}` for every other
constructor, so no non-delivery row is delivery evidence at any seat id. The five zero-seat
fixtures below carry both the reviewer's three rows and valid delivery to seat zero, which the
model confirms: the corpus excludes non-delivery rows, seat zero itself stays a legal recipient.

The routing column is unchanged: it is replayed and asserted, and the decision table takes no
routing parameter.

## The zero-seat fixtures

All five carry `Ended{}`, `Reported{}`, `Live{}`, `KeyStated{11n, 22n, 33n}` and
`ResolvedSeat{0n}`:

| Fixture | Receipt | Observation | Verdict |
|---|---|---|---|
| `zero-seat-receipt-missing` | `ReceiptMissing{same key}` | `NotObserved{}` | `Unconfirmed` |
| `zero-seat-observed-to-task` | `ReceiptNotChecked{}` | `DeliveredToTask{same key}` | `Unconfirmed` |
| `zero-seat-recorded-absent` | `ReceiptNotChecked{}` | `RecordedAbsent{same key}` | `Rejected` |
| `zero-seat-delivered-by-observation` | `ReceiptNotChecked{}` | `DeliveredToSeat{0n, same key}` | `Delivered` |
| `zero-seat-delivered-by-receipt` | `ReceiptOnFile{0n, same key}` | `NotObserved{}` | `Delivered` |

## Commands and observed output

Every command ran from the witness worktree root, with the pinned toolchain on `PATH`:

```sh
export PATH="$PWD/node_modules/.bend/bin:$PATH"
```

Output is verbatim. The zero-seat program is the reviewer's program: it imports the witness
module as `W` and prints `verdict_label(verdict_turn(...))` for the three inputs of the review.

### 1. The type check

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
All terms check, but 5 defs rely on unsafe or foreign code:
- Real.adapter_routing
- replay_adapter
- replay
- one
- main
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
zero-seat-receipt-missing source=model verdict=unconfirmed
zero-seat-observed-to-task source=model verdict=unconfirmed
zero-seat-recorded-absent source=model verdict=rejected
zero-seat-delivered-by-observation source=model verdict=delivered
zero-seat-delivered-by-receipt source=model verdict=delivered
wake-delivery witness: 18 fixtures replayed; delivery needs an explicit DeliveredToSeat observation or ReceiptOnFile receipt at the turn's own identity and the resolved seat, each adapter row's derived routing is asserted against the routing it declares, and every verdict must equal the corpus expectation.
```

Exit code 0. Every line's verdict equals the corpus expectation, and each adapter row's derived
routing equals the routing its fixture declares.

### 3. The corpus replays, compiled lane

```sh
$ bend docs/bend2/examples/laws-wake-delivery.bend -o .scratch/witness-r2/laws-wake-delivery-r3.js
$ node .scratch/witness-r2/laws-wake-delivery-r3.js
```

The compiled lane prints the same eighteen fixture lines and the same closing statement. Exit
code 0.

### 4. Red-first: the reviewer's zero-seat program against revision `656ee105`

The witness sources of the rejected revision, extracted with `git show 656ee105:...`, beside the
zero-seat program:

```sh
$ bend .scratch/witness-r2/zero-seat.bend
receipt-missing:delivered
delivered-to-task:delivered
recorded-absent:delivered
$ bend .scratch/witness-r2/zero-seat.bend -o .scratch/witness-r2/zero-seat.js
$ node .scratch/witness-r2/zero-seat.js
receipt-missing:delivered
delivered-to-task:delivered
recorded-absent:delivered
```

Exit code 0 in both lanes. This is the defect: three inputs with no delivery row report
`delivered`. The corrected module answers `unconfirmed`, `unconfirmed` and `rejected` for the
same program (command 5).

### 5. The reviewer's zero-seat program against the corrected module

```sh
$ bend .scratch/zero-seat-r3/zero-seat.bend
receipt-missing:unconfirmed
delivered-to-task:unconfirmed
recorded-absent:rejected
$ bend .scratch/zero-seat-r3/zero-seat.bend -o .scratch/zero-seat-r3/zero-seat.js
$ node .scratch/zero-seat-r3/zero-seat.js
receipt-missing:unconfirmed
delivered-to-task:unconfirmed
recorded-absent:rejected
```

Exit code 0 in both lanes. Each answer is the one the review's table requires. Valid delivery to
seat zero confirms in the corpus itself: `zero-seat-delivered-by-observation` and
`zero-seat-delivered-by-receipt` both read `delivered` in command 2.

### 6. The host-mutation control

With the adapter's `return addressed ? 0 : 1;` replaced by `return 2;`, every routed row derives
no-frame, and the assertion on the routing column stops the run in both lanes:

```sh
$ bend .scratch/mutation-r3/laws-wake-delivery.bend
All terms check, but 5 defs rely on unsafe or foreign code:
- Real.adapter_routing
- replay_adapter
- replay
- one
- main
park-routing-recorded-absent routing DISAGREE: declared task-addressed derived no-frame
```

Exit code 1. The compiled lane prints the same `routing DISAGREE` line and exits 1.

### 7. The aggregate driver stays green

```sh
$ /usr/bin/python3 docs/bend2/laws-check.py node_modules/.bend/bin/bend
```

Exit code 0. The JSON report records 24 result rows, all passed. The driver's eight-file list
covers the law models, the transition witness and their negative controls; it excludes this
witness corpus, whose checks are commands 1 through 6. The seat's `python3` is an asdf shim that
refuses with exit 126 outside its managed directories, so the driver runs under
`/usr/bin/python3`; the script is stdlib-only.

## Verdict

The corrected witness satisfies its claim at bend 2.0.25 on this host: eighteen fixtures replay
with the recorded verdicts in both runtime lanes, delivery is confirmed only by an identity-matched
`DeliveredToSeat` observation or `ReceiptOnFile` receipt to the resolved orchestrator, the three
inputs of the seq-167985 rejection read `unconfirmed`, `unconfirmed` and `rejected`, valid
delivery to seat zero confirms, the routing assertion and its host-mutation control hold, and
`docs/bend2/laws-check.py` exits 0 on the same tree. The no-park entry stays proposed.
