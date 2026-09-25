# arch-replay-stop — the stop-replay differential corpus

## Claim

One frozen source trace, replayed under a supplied policy basis and a stated row state, decides the
same required logical behaviour in a pure Bend2 model and in the branch's own coordination fold: the
recorded stop is admitted when the basis that authorized it is supplied, and a refusal classifies its
cause, preserves the projection and owed delivery it was admitted against, and enters quarantine
only for corrupt source bytes.

The corpus exists to test one correction of the external architecture review: startup, doctor and
recovery must use one recorded policy basis and classify the cause of a refusal before offering
repair (ARCH-CLOSE-11, with M-5, M-14 and M-17 in `../target-architecture.md`).

## Halves

| File | Holds |
|---|---|
| `arch-replay-stop.ledger.jsonl` | the frozen source trace: three coordination rows as the implementation writes them |
| `arch-replay-stop.cases` | the case inputs, read by both halves |
| `arch-replay-stop.expect` | the required logical behaviour per case, read by neither half |
| `arch-replay-stop.bend` | the Bend2 half: a pure decision model over the case file |
| `arch-replay-stop.mjs` | the reference half: it drives the branch's `CoordinationStore` over the trace |

The trace is a real ledger: two `task.created` rows for one run and one `run.stop_admitted` row
carrying the policy-bearing field set (`scope`, `throughSeq`, `targetRunIds`) that the run-lineage
admission derives. `arch-replay-stop.mjs --emit-ledger` writes it; the frozen bytes are the ones
committed here, at sha256 `52106794cc79264cdcd00a687ba7167dbf804e2e74f3fcc426066b74f8d604c4`.

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); Node v25.8.0.
- Toolchain: `bend 2.0.25`, installed at the worktree root under `.bend/` from
  `../reference/toolchain/install-2.0.25.sh`; language source pin
  `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` (`../reference/README.md`).
- Every command below ran from the worktree root with
  `export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1`.

## Commands and output

### The Bend2 half

```sh
bend docs/bend2/examples/arch-replay-stop.bend --check-only
```

```text
All terms check.
```

```sh
bend docs/bend2/examples/arch-replay-stop.bend
```

```text
RESULT|stop-policy-bearing|admitted=true|refusal=none|classification=none|quarantine=false|targets=2|cursor=3|owed=2|remedy=none
RESULT|stop-missing-policy|admitted=false|refusal=unspecified|classification=missing_policy_basis|quarantine=false|targets=0|cursor=2|owed=1|remedy=none
RESULT|stop-corrupt-row|admitted=false|refusal=unspecified|classification=corrupt_source_bytes|quarantine=true|targets=0|cursor=2|owed=1|remedy=quarantine
```

Exit code 0. (`refusal=unspecified` marks the field the requirement does not fix; a refusal code is
the refusing implementation's own vocabulary.)

### The reference half

```sh
node docs/bend2/examples/arch-replay-stop.mjs --run
```

```text
RESULT|stop-policy-bearing|admitted=true|refusal=none|classification=none|quarantine=false|targets=2|cursor=3|owed=2|remedy=none
RESULT|stop-missing-policy|admitted=false|refusal=run_stop_integrity|classification=replay_refused|quarantine=false|targets=0|cursor=2|owed=1|remedy=none
RESULT|stop-corrupt-row|admitted=false|refusal=run_stop_integrity|classification=replay_refused|quarantine=false|targets=0|cursor=2|owed=1|remedy=none
```

Exit code 0. Its stderr names what the fold and the `baton doctor` probe reported:

```text
stop-policy-bearing: {"admitted":true,"refusal":"none","classification":"none","quarantine":false,"targets":2,"cursor":3,"owed":2,"remedy":"none","declaredTargets":2}
stop-missing-policy: {"admitted":false,"refusal":"run_stop_integrity","classification":"replay_refused","quarantine":false,"targets":0,"cursor":2,"owed":1,"remedy":"none","declaredTargets":2,"probeSeq":3,"probeKind":"run.stop_admitted","probeMessage":"run stop admission is invalid"}
stop-corrupt-row: {"admitted":false,"refusal":"run_stop_integrity","classification":"replay_refused","quarantine":false,"targets":0,"cursor":2,"owed":1,"remedy":"none","declaredTargets":2,"probeSeq":3,"probeKind":"run.stop_admitted","probeMessage":"run stop admission is invalid"}
```

### The three-way comparison

```sh
node docs/bend2/examples/arch-replay-stop.mjs --compare
```

```text
CASE stop-policy-bearing: AGREEMENT
  required   : admitted=true classification=none quarantine=false targets=2 cursor=3 owed=2
  reference  : admitted=true classification=none quarantine=false targets=2 cursor=3 owed=2 refusal=none remedy=none
  prototype  : admitted=true classification=none quarantine=false targets=2 cursor=3 owed=2
CASE stop-missing-policy: DISAGREEMENT
  required   : admitted=false classification=missing_policy_basis quarantine=false targets=0 cursor=2 owed=1
  reference  : admitted=false classification=replay_refused quarantine=false targets=0 cursor=2 owed=1 refusal=run_stop_integrity remedy=none
  reference differs on: classification
  prototype  : admitted=false classification=missing_policy_basis quarantine=false targets=0 cursor=2 owed=1
CASE stop-corrupt-row: DISAGREEMENT
  required   : admitted=false classification=corrupt_source_bytes quarantine=true targets=0 cursor=2 owed=1
  reference  : admitted=false classification=replay_refused quarantine=false targets=0 cursor=2 owed=1 refusal=run_stop_integrity remedy=none
  reference differs on: classification, quarantine
  prototype  : admitted=false classification=corrupt_source_bytes quarantine=true targets=0 cursor=2 owed=1
cases compared: 3; disagreements: 2
```

Exit code 0. The comparison reports the required behaviour, not a pass or fail of either half.

## Verdict

The claim holds. The Bend2 model reproduces the required behaviour of all three cases; the reference
implementation agrees on the admitted case and on every projection field of the two refused cases,
and differs on the cause classification only.

## What the disagreement establishes

Both refused cases reach the fold as `run.stop_admitted` at seq 3 with the same refusal code
(`run_stop_integrity`), the same message (`run stop admission is invalid`) and the same prescription:
keep the projection at cursor 2, owe 1 row, enter no quarantine. One of them is a valid row that the
supplied basis cannot validate and the other is a row whose own binding no longer recomputes, and the
implementation reports them identically. The doctor probe adds no distinction either: it falls back
to `restart after repairing the coordination ledger`, which this build sets no `remedy` for
(`impl/src/coordination-store.mjs` reads `error?.remedy ?? 'restart after repairing the coordination
ledger'`, and `CoordinationIntegrityError` carries no `remedy` at `impl/src/coordination-internals.mjs`).
An operator reading either result cannot tell a missing basis from damaged bytes, which is the state
ARCH-CLOSE-11 excludes: the basis must be recorded and reconstructible, and the cause classified
before repair is offered.

Both halves also agree on what the refusal must preserve: the projection stops at the last row it
folded (cursor 2), the consumer that had read through seq 1 is still owed one row, and the refused
row is neither replaced nor silently skipped.

## Limits

- The Bend2 half models the decision over the case file. It folds no ledger, opens no journal and
  writes nothing; the classification it prints is its own decision, and the reference half's own
  vocabulary for the same refusal is not part of the requirement.
- The trace is one run of three rows. It exercises no replay of a changed authorization basis, no
  rejected mutation, and no restart; those are the next increments of this track.
- The corpus compares behaviour, not performance.

## Related

- `../target-architecture.md`: ARCH-CLOSE-11 and the authority and recovery rules.
- `../architecture-review.md`: F9's validation basis, F22's one policy basis.
- `../rewrite-plan.md`: the Phase 1 proof corpus and ARCH-CLOSE-11.
