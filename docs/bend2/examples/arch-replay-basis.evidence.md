# arch-replay-basis — the authorization-basis differential corpus

## Claim

One frozen lease trace, replayed under the basis that issued it, under a changed basis, and under no
basis, decides the same required logical behaviour in a pure Bend2 model and in the branch's own
coordination fold: a self-consistent recorded row reconstructs from its own bytes and folds, a basis
that changed out from under it is refused and classified as its own cause, and the diagnostic path
reaches the verdict the same basis implies.

This corpus continues the test of one correction of the external architecture review: startup, doctor
and recovery must use one recorded policy basis and classify the cause of a refusal before offering
repair (ARCH-CLOSE-11, with M-5, M-14 and M-17 in `../target-architecture.md`).

## Halves

| File | Holds |
|---|---|
| `arch-replay-basis.ledger.jsonl` | the frozen source trace, produced by the implementation's own admission verbs |
| `arch-replay-basis.cases` | the case inputs, read by both halves |
| `arch-replay-basis.expect` | the required logical behaviour per case, read by neither half |
| `arch-replay-basis.bend` | the Bend2 half: a pure decision model over the case file |
| `arch-replay-basis.mjs` | the reference half: it replays the trace and asks the diagnostic path too |

The trace is three rows the real store wrote: `task.created`, `task.claimed`, and the
`run.orchestrator_lease_issued` row the deployment issued under its run-lineage policy. The lease
row carries `policyDigest`, which is the digest of the policy that issued it. The frozen bytes are
at sha256 `b233f19c443e6b7be422bd31fcf4be513fa56235bdf54eaaa9eadedc691655c7`.

`--emit-ledger` rebuilds the trace with the implementation's own `createTask`, `claimTask` and
`issueRunOrchestratorLease` verbs; the corpus therefore replays a trace the implementation produced
rather than one hand-written to match it.

## Host and toolchain

- Host: Darwin 27.0.0, arm64 (Apple M4); Node v25.8.0.
- Toolchain: `bend 2.0.25` at the worktree root under `.bend/`; language source pin
  `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` (`../reference/README.md`).
- Commands run from the worktree root with `export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1`.

## Commands and output

### The Bend2 half

```sh
bend docs/bend2/examples/arch-replay-basis.bend --check-only
```

```text
All terms check.
```

```sh
bend docs/bend2/examples/arch-replay-basis.bend
```

```text
RESULT|lease-same-basis|admitted=true|refusal=none|classification=none|quarantine=false|cursor=3|owed=1|doctor=clean|remedy=none
RESULT|lease-changed-basis|admitted=false|refusal=unspecified|classification=authorization_basis_changed|quarantine=false|cursor=2|owed=0|doctor=refused|remedy=none
RESULT|lease-missing-basis|admitted=true|refusal=none|classification=none|quarantine=false|cursor=3|owed=1|doctor=clean|remedy=none
RESULT|lease-invalid-row|admitted=false|refusal=unspecified|classification=invalid_payload|quarantine=false|cursor=2|owed=0|doctor=refused|remedy=none
```

Exit code 0.

### The reference half

```sh
node docs/bend2/examples/arch-replay-basis.mjs --run
```

```text
RESULT|lease-same-basis|admitted=true|refusal=none|classification=none|quarantine=false|cursor=3|owed=1|doctor=clean|doctorCode=none|remedy=none
RESULT|lease-changed-basis|admitted=false|refusal=run_orchestrator_lease_integrity|classification=replay_refused|quarantine=false|cursor=2|owed=0|doctor=clean|doctorCode=none|remedy=none
RESULT|lease-missing-basis|admitted=true|refusal=none|classification=none|quarantine=false|cursor=3|owed=1|doctor=clean|doctorCode=none|remedy=none
RESULT|lease-invalid-row|admitted=false|refusal=run_orchestrator_lease_integrity|classification=replay_refused|quarantine=false|cursor=2|owed=0|doctor=refused|doctorCode=run_orchestrator_lease_integrity|remedy=none
```

Exit code 0. Its stderr names what the resident fold and the diagnostic probe reported:

```text
lease-same-basis: {"admitted":true,...,"cursor":3,"owed":1,"doctor":"clean","probeCode":null}
lease-changed-basis: {"admitted":false,"refusal":"run_orchestrator_lease_integrity",...,"cursor":2,"doctor":"clean","probeCode":null,"thrownMessage":"run orchestrator lease binding is invalid"}
lease-missing-basis: {"admitted":true,...,"cursor":3,"owed":1,"doctor":"clean","probeCode":null}
lease-invalid-row: {"admitted":false,"refusal":"run_orchestrator_lease_integrity",...,"cursor":2,"doctor":"refused","probeCode":"run_orchestrator_lease_integrity","probeSeq":3,"thrownMessage":"run orchestrator lease payload is invalid"}
```

### The three-way comparison

```sh
node docs/bend2/examples/arch-replay-basis.mjs --compare
```

```text
CASE lease-same-basis: AGREEMENT
  required   : admitted=true classification=none quarantine=false cursor=3 owed=1 doctor=clean
  reference  : admitted=true classification=none quarantine=false cursor=3 owed=1 doctor=clean refusal=none
  prototype  : admitted=true classification=none quarantine=false cursor=3 owed=1 doctor=clean
CASE lease-changed-basis: DISAGREEMENT
  required   : admitted=false classification=authorization_basis_changed quarantine=false cursor=2 owed=0 doctor=refused
  reference  : admitted=false classification=replay_refused quarantine=false cursor=2 owed=0 doctor=clean refusal=run_orchestrator_lease_integrity
  reference differs on: classification, doctor
  prototype  : admitted=false classification=authorization_basis_changed quarantine=false cursor=2 owed=0 doctor=refused
CASE lease-missing-basis: AGREEMENT
  required   : admitted=true classification=none quarantine=false cursor=3 owed=1 doctor=clean
  reference  : admitted=true classification=none quarantine=false cursor=3 owed=1 doctor=clean refusal=none
  prototype  : admitted=true classification=none quarantine=false cursor=3 owed=1 doctor=clean
CASE lease-invalid-row: DISAGREEMENT
  required   : admitted=false classification=invalid_payload quarantine=false cursor=2 owed=0 doctor=refused
  reference  : admitted=false classification=replay_refused quarantine=false cursor=2 owed=0 doctor=refused refusal=run_orchestrator_lease_integrity
  reference differs on: classification
  prototype  : admitted=false classification=invalid_payload quarantine=false cursor=2 owed=0 doctor=refused
cases compared: 4; disagreements: 2
```

## Verdict

The claim holds. The Bend2 model reproduces the required behaviour of all four cases. The reference
implementation agrees on both admitted cases and on every projection field of the two refused cases,
and differs on the cause classification of both, and on the diagnostic verdict of the changed-basis
case.

## What the corpus establishes

- **A missing basis is not a refusal.** The lease row is self-consistent, and its kind reconstructs
  the payload from the row's own bytes: replayed with no policy at all it folds and the projection
  reaches cursor 3. This is the behaviour ARCH-CLOSE-11 asks of every kind, and
  `arch-replay-stop.evidence.md` records the same input shape refused with `run_stop_integrity`
  instead, because the stop payload's field set depends on the policy that admitted it.
- **A changed basis alone does not make a ledger unclean.** Replayed with a policy whose
  `maxChildrenPerRun` differs by one, the resident refuses the recorded row as
  `run_orchestrator_lease_integrity` / `run orchestrator lease binding is invalid`, and the
  diagnostic path — `coordinationReplayFailure`, the probe behind `baton doctor` — reports the same
  ledger **clean**, because it constructs its store with no deployment basis at all. A restart of the
  resident and a doctor run therefore disagree: one refuses and one says nothing is wrong.
- **One refusal code covers two causes.** The changed-basis case and the invalid-payload case both
  come back as `run_orchestrator_lease_integrity`. An operator reading either result cannot tell a
  basis that moved from a payload that never bound, so the repair each needs is not derivable from
  the refusal.

## Limits

- The corpus exercises one kind (the run-orchestrator lease) under three bases. The stop kind's
  treatment is in `arch-replay-stop.evidence.md`; a wider kind inventory belongs to the next
  increments.
- No restart, no compaction and no checkpoint staleness is exercised here.
- The Bend2 half models the decision; it folds no ledger and writes nothing.

## Related

- `../target-architecture.md`: ARCH-CLOSE-11 and the authority and recovery rules.
- `../architecture-review.md`: F9's validation basis, F22's one policy basis.
- `arch-replay-stop.evidence.md`: the same rehearsal for the stop kind, including the missing-basis
  negative case.
