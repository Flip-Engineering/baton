# arch-replay-mutation — the rejected-mutation differential corpus

## Claim

One case file of requests the implementation must judge decides the same required logical behaviour in
a pure Bend2 model and in the branch's own admission verb: the request admission accepts writes one
row and advances the projection, and each refused request writes no row, leaves the cursor and the
owed delivery where they were, and reports the cause the refusal names.

This corpus closes the last case of the review's track 1 that the other three corpora did not cover:
rejected mutations with preserved history (`arch-replay-stop.evidence.md` and
`arch-replay-basis.evidence.md` cover recorded rows, `arch-replay-cursor.evidence.md` covers restarts).

## Halves

| File | Holds |
|---|---|
| `arch-replay-mutation.cases` | the case inputs, read by both halves |
| `arch-replay-mutation.expect` | the required logical behaviour per case, read by neither half |
| `arch-replay-mutation.bend` | the Bend2 half: a pure decision model over the case file |
| `arch-replay-mutation.mjs` | the reference half: it seeds a store per case and offers the request |

There is no frozen ledger here: the trace is not recorded rows but a request. Each case seeds a store
holding two rows (a working parent task and its claim) and offers one run-orchestrator lease request
against it — the request admission accepts, the same request carrying one field it does not admit, and
the same request whose session expired before the event clock.

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); Node v25.8.0.
- Toolchain: `bend 2.0.25` at the worktree root under `.bend/`; language source pin
  `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` (`../reference/README.md`).
- Commands run from the worktree root with `export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1`.

## Commands and output

### The Bend2 half

```sh
bend docs/bend2/examples/arch-replay-mutation.bend --check-only
```

```text
All terms check.
```

```sh
bend docs/bend2/examples/arch-replay-mutation.bend
```

```text
RESULT|mutation-valid|admitted=true|refusal_class=none|rows_written=1|cursor=3|owed=2
RESULT|mutation-unknown-field|admitted=false|refusal_class=invalid_request|rows_written=0|cursor=2|owed=1
RESULT|mutation-expired-session|admitted=false|refusal_class=expired_authority|rows_written=0|cursor=2|owed=1
```

Exit code 0.

### The reference half

```sh
node docs/bend2/examples/arch-replay-mutation.mjs --run
```

```text
RESULT|mutation-valid|admitted=true|refusal=none|rows_written=1|cursor=3|owed=2
RESULT|mutation-unknown-field|admitted=false|refusal=run_orchestrator_lease_invalid|rows_written=0|cursor=2|owed=1
RESULT|mutation-expired-session|admitted=false|refusal=run_orchestrator_lease_invalid|rows_written=0|cursor=2|owed=1
```

Exit code 0. Its stderr carries the refusal message each case produced:

```text
mutation-valid: {"admitted":true,"refusal":"none","cursor":3,"owed":2,"rowsBefore":2,"rowsAfter":3,"rowsWritten":1,"message":null}
mutation-unknown-field: {"admitted":false,"refusal":"run_orchestrator_lease_invalid","cursor":2,"owed":1,"rowsBefore":2,"rowsAfter":2,"rowsWritten":0,"message":"run orchestrator lease request is invalid"}
mutation-expired-session: {"admitted":false,"refusal":"run_orchestrator_lease_invalid","cursor":2,"owed":1,"rowsBefore":2,"rowsAfter":2,"rowsWritten":0,"message":"run orchestrator lease timestamp is invalid"}
```

### The three-way comparison

```sh
node docs/bend2/examples/arch-replay-mutation.mjs --compare
```

```text
CASE mutation-valid: AGREEMENT
  required   : admitted=true refusal_class=none rows_written=1 cursor=3 owed=2
  reference  : admitted=true refusal_class=none rows_written=1 cursor=3 owed=2
  prototype  : admitted=true refusal_class=none rows_written=1 cursor=3 owed=2
CASE mutation-unknown-field: DISAGREEMENT
  required   : admitted=false refusal_class=invalid_request rows_written=0 cursor=2 owed=1
  reference  : admitted=false refusal_class=run_orchestrator_lease_invalid rows_written=0 cursor=2 owed=1
  reference differs on: refusal_class
  prototype  : admitted=false refusal_class=invalid_request rows_written=0 cursor=2 owed=1
CASE mutation-expired-session: DISAGREEMENT
  required   : admitted=false refusal_class=expired_authority rows_written=0 cursor=2 owed=1
  reference  : admitted=false refusal_class=run_orchestrator_lease_invalid rows_written=0 cursor=2 owed=1
  reference differs on: refusal_class
  prototype  : admitted=false refusal_class=expired_authority rows_written=0 cursor=2 owed=1
cases compared: 3; disagreements: 2
```

## Verdict

The claim holds. Every case agrees on admission, on the rows written, and on the state the attempt
left behind. The two refused cases differ on one field: the cause the refusal names.

## What the corpus establishes

- **A refused mutation leaves history alone.** Both refusals wrote zero ledger rows, left the cursor at
  seq 2 and left the consumer owed its one row. Refusal is not a partial write.
- **One code covers two causes.** The request shape that is not admitted and the authority that
  expired before the event clock are reported under the single code
  `run_orchestrator_lease_invalid`, with different messages ("run orchestrator lease request is
  invalid" against "run orchestrator lease timestamp is invalid"). An operator reading the code cannot
  tell which repair applies, which is the vocabulary M-14 asks for: the refusal should report the
  failure it actually is.
- **The message carries what the code does not.** The distinction does survive in the message text,
  so this is a code-and-classification gap rather than a lost cause; the other two corpora's refusals
  carry the same shape.

## Limits

- One verb (the run-orchestrator lease admission) and one store shape. A refusal census across the
  admission surface belongs to a later increment.
- The Bend2 half models the decision; it seeds no store and writes nothing.
- The reference half counts ledger rows after the attempt on a freshly seeded store; it does not
  exercise a group-commit boundary.

## Related

- `../target-architecture.md`: ARCH-CLOSE-11, M-5, M-14.
- `arch-replay-stop.evidence.md`, `arch-replay-basis.evidence.md`, `arch-replay-cursor.evidence.md`:
  the recorded-row, changed-basis and restart corpora of the same track.
