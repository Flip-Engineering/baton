# Wake witness review, 2026-09-23

The witness at `656ee105f0151b9b4dc5c698b1b49fc991f04aee` requires revision.
Its baseline passes, but three admitted inputs establish delivery from evidence
that does not describe delivery to the orchestrator. This review concerns the
prototype model and its host adapter. Revision 10 remains proposed.

## Earlier adapter finding

At `1be5c81ffa68c7c52dce0869fb3fffd78d00a8cd`, replacing the host adapter's
`return addressed ? 0 : 1;` with `return 2;` made every routed fixture print
`derived=no-frame`. The interpreter still exited 0 with unchanged model verdicts
and the closing success statement. The returned routing value was only printed.
That contribution was rejected at seq 165906.

The revised source at `656ee105` compares the returned code with the declared
routing and calls `IO.die` on disagreement. The following new finding concerns
its evidence predicates.

An independent check of that fix used fresh Git-object copies of both files at
`656ee105` and replaced `return addressed ? 0 : 1;` with `return 2;` in the
copied JavaScript host file. With `BEND_NO_TELEMETRY=1`, running the copied Bend
program exited 1. Emitting JavaScript exited 0, and running that output with Node
exited 1. Both executions printed:

```text
park-routing-recorded-absent routing DISAGREE: declared task-addressed derived no-frame
```

The reviewer reported a separate interpreter run that exited 0 after printing
disagreements. Its exact command and artifact were not supplied. The fresh-copy
reproduction above supports the repaired adapter assertion. The independently
reproduced zero-seat counterexamples below remain the reason for rejection.

## Zero-seat counterexample

The model uses `Nat` for a resolved seat identity and admits `ResolvedSeat{0n}`.
`receipt_seat` returns `0n` for every receipt constructor except `ReceiptOnFile`.
`obs_seat` returns `0n` for every observation constructor except
`DeliveredToSeat`. The predicates compare those fallback values with the resolved
seat without first requiring the corresponding delivery constructor.

Hold the turn key at `KeyStated{11n, 22n, 33n}`, with an ended, reported, live
turn and `ResolvedSeat{0n}`. The measured cases are:

| Receipt | Observation | Required result | Observed result |
|---|---|---|---|
| `ReceiptMissing{sameKey}` | `NotObserved{}` | `Unconfirmed{}` | `Delivered{}` |
| `ReceiptNotChecked{}` | `DeliveredToTask{sameKey}` | `Unconfirmed{}` | `Delivered{}` |
| `ReceiptNotChecked{}` | `RecordedAbsent{sameKey}` | `Rejected{}` | `Delivered{}` |

The required results follow the witness's own evidence contract: a missing
receipt leaves delivery unconfirmed; delivery to a task does not establish
delivery to the resolved orchestrator; an identity-matched recorded absence
rejects the wait. No valid delivery receipt or observation is present in these
three inputs.

## Reproduction

Use the repository's pinned Bend 2.0.25 installer under `node_modules/.bend`.
The measured executable SHA256 was
`3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` on Darwin arm64.
Run from the repository root so the witness's foreign adapter reads `impl/src`.

```sh
mkdir -p .scratch/wake-review7-r2
git show 656ee105:docs/bend2/examples/laws-wake-delivery.bend > .scratch/wake-review7-r2/laws-wake-delivery.bend
git show 656ee105:docs/bend2/examples/laws-wake-delivery.js > .scratch/wake-review7-r2/laws-wake-delivery.js
```

Save this program as `.scratch/wake-review7-r2/zero-seat.bend`:

```text
import Base
import ./laws-wake-delivery.bend as W

def missing_receipt() -> W.Turn:
  W.Turn{W.Ended{}, W.Reported{}, W.Live{}, W.KeyStated{11n, 22n, 33n},
    W.ResolvedSeat{0n}, W.ReceiptMissing{W.KeyStated{11n, 22n, 33n}},
    W.NotObserved{}, W.NoFrame{}}

def task_delivery() -> W.Turn:
  W.Turn{W.Ended{}, W.Reported{}, W.Live{}, W.KeyStated{11n, 22n, 33n},
    W.ResolvedSeat{0n}, W.ReceiptNotChecked{},
    W.DeliveredToTask{W.KeyStated{11n, 22n, 33n}}, W.NoFrame{}}

def absent_delivery() -> W.Turn:
  W.Turn{W.Ended{}, W.Reported{}, W.Live{}, W.KeyStated{11n, 22n, 33n},
    W.ResolvedSeat{0n}, W.ReceiptNotChecked{},
    W.RecordedAbsent{W.KeyStated{11n, 22n, 33n}}, W.NoFrame{}}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("receipt-missing:" ++ W.verdict_label(W.verdict_turn(missing_receipt())))
    IO.print("delivered-to-task:" ++ W.verdict_label(W.verdict_turn(task_delivery())))
    IO.print("recorded-absent:" ++ W.verdict_label(W.verdict_turn(absent_delivery())))
```

```sh
BEND_NO_TELEMETRY=1 node_modules/.bend/bin/bend .scratch/wake-review7-r2/zero-seat.bend
BEND_NO_TELEMETRY=1 node_modules/.bend/bin/bend .scratch/wake-review7-r2/zero-seat.bend -o .scratch/wake-review7-r2/zero-seat.js
node .scratch/wake-review7-r2/zero-seat.js
```

Both executions exit 0 and print:

```text
receipt-missing:delivered
delivered-to-task:delivered
recorded-absent:delivered
```

The unmodified witness baseline also exits 0 with its thirteen fixture lines and
closing statement. The existing fixture proofs quantify over the enumerated
`Fixture` constructors; their coverage excludes these three admitted `Turn`
values.

## Required change and scope

Match `ReceiptOnFile` and `DeliveredToSeat` explicitly before comparing the key
and recipient. Add these three negative cases and valid delivery to seat zero.
A zero-seat exclusion would add a restriction absent from the current model.

Keep the witness separate from accepted laws tip `ea0bfbeb` and from
`laws-check.py` until its corrected behavior has independent acceptance. Its
receipt and observation inputs are declared fixture facts; it does not observe
delivery in the active resident. No full-suite, deployment or landing result is
claimed by this review.
