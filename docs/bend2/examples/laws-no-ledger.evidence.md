# laws-no-ledger — evidence

CLAIM: The model is the adopted revision 11 comparison policy. For one selected invocation the
landing gate decides from the change's outcome and the target run's outcome, and from nothing else.
A failure with the change blocks when the target run supplies no failure with the same identity,
where the identity is the file, the test, the failure kind and the specified stable semantic code.
An absent or unjudged target invocation supplies no matching failure. An unjudged change cannot
authorize landing. The gate accounts for every selected invocation. `../laws.bend` states the nine
obligations and `laws-proof.bend` discharges them.

Status: Proposed addition to the law set (revision 11, re-encoded 2026-09-25) from the operator ban
on bookkeeping ledgers in place of function (AGENTS.md, #579, #580) and from the adopted comparison
policy in `../reviews/astra-law-review-r11-r12.md`. The entry is not part of the approved set.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `/Users/wahargis/Development/Experiments/baton-resident/.baton/wt/ws-bb964de517ed7cdcfb2ab5bf2ed09021/node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

This worktree carries no `node_modules/.bend`; the binary is the installed 2.0.25 toolchain, and
its digest is the one the repo's earlier law evidence records. Every invocation sets
`BEND_NO_TELEMETRY=1`.

```sh
$ BEND=/Users/wahargis/Development/Experiments/baton-resident/.baton/wt/ws-bb964de517ed7cdcfb2ab5bf2ed09021/node_modules/.bend/bin/bend
$ BEND_NO_TELEMETRY=1 "$BEND" version
bend 2.0.25
exit=0
```

## The model under the law

```sh
$ $BEND docs/bend2/examples/laws-no-ledger.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/examples/laws-no-ledger.bend
no-ledger: the gate reads only observations; the laws are checked in laws-proof.bend.
exit=0
```

`docs/bend2/examples/laws-no-ledger.bend` sha256 `aa4a7f6919aa480a28362eb4f6fda7648de2d3cb3735258fd16b21028aaffb7f`.

## The laws

[../laws.bend](../laws.bend) states these obligations over the model and
[laws-proof.bend](laws-proof.bend) discharges every one.

| Law | What it fixes |
|---|---|
| `r11_gate_reads_only_observations` | the gate equals the policy for every stored record |
| `r11_landing_reads_only_observations` | the landing equals the OR of those decisions |
| `r11_an_absent_target_blocks_every_change_failure` | an absent target invocation blocks |
| `r11_an_unjudged_target_blocks_every_change_failure` | an unjudged target blocks |
| `r11_a_judged_target_compares_failure_identities` | two judged failures compare identities |
| `r11_an_unjudged_change_cannot_authorize_landing` | an unjudged change blocks |
| `r11_a_passing_change_blocks_nothing` | a passed invocation blocks nothing |
| `r11_an_absent_change_blocks_nothing` | an absent invocation blocks nothing |
| `r11_every_selected_invocation_is_accounted_for` | the report carries one decision per invocation |

```sh
$ $BEND docs/bend2/laws.bend --check-only
Error: 53 TODOs found.
The code is incomplete, and not a valid proof yet.
exit=1
$ $BEND docs/bend2/examples/laws-proof.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/examples/laws-proof.bend
M-5 reviews, M-10 worker admission, M-14 refusal rows, M-18 landing decision and the adopted revision 11 and revision 12 obligations: model proofs checked.
exit=0
```

`laws.bend` reports 53 open obligations: the ten the approved set carries and the
forty-three the operator adopted on 2026-09-25. The proof file discharges all 53, so an
open obligation is a claim whose proof lives in `laws-proof.bend`, and the check of
`laws.bend` on its own is not the gate. `laws.bend` sha256
`b11b991f897f2b20f7f16ee73c9d61d35700dfe09ae6ec26b00db260691485fe`; `laws-proof.bend` sha256 `88a13e217a27fa057d1f9e29def34f8928c25b66b7b84115b968d791e51b2949`.

## Controls

Each control replaces part of the model in a scratch copy and re-checks the laws, so a
scratch root.

### Control A: r11 expected failure allowance

Replays `census-test.bend / forge-outcomes.bend` at the pin.

```diff
61c61,63
<   blocks(change, target)
---
>   match ledger:
>     case 0n: blocks(change, target)
>     case 1n+p: False{}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-no-ledger.gate(ledger, change, target)
- observed : ../examples/laws-no-ledger.blocks(change, target)
Context:
- ledger : Nat
- change : ../examples/laws-no-ledger.Outcome
- target : ../examples/laws-no-ledger.Outcome
Location: ../laws.r11_gate_reads_only_observations
92 | def Laws.r11_gate_reads_only_observations(ledger, change, target):
93>|   {==}
94 |
exit=1
```

### Control B: r11 count pin

Replays `select-tests.bend` at the pin.

```diff
61c61,63
<   blocks(change, target)
---
>   match ledger:
>     case 0n: blocks(change, target)
>     case 1n+p: Bool.not(blocks(change, target))
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-no-ledger.gate(ledger, change, target)
- observed : ../examples/laws-no-ledger.blocks(change, target)
Context:
- ledger : Nat
- change : ../examples/laws-no-ledger.Outcome
- target : ../examples/laws-no-ledger.Outcome
Location: ../laws.r11_gate_reads_only_observations
92 | def Laws.r11_gate_reads_only_observations(ledger, change, target):
93>|   {==}
94 |
exit=1
```

### Control C: r11 no target comparison

Replays `forge-outcomes.bend` at the pin.

```diff
53c53
<     case Failed{+f}: Bool.not(matches(f, target))
---
>     case Failed{+f}: True{}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : True{}
- observed : Bool.not(../examples/laws-no-ledger.same_identity(failure, observed))
Context:
- failure  : ../examples/laws-no-ledger.Identity
- observed : ../examples/laws-no-ledger.Identity
Location: ../laws.r11_a_judged_target_compares_failure_identities
108 | def Laws.r11_a_judged_target_compares_failure_identities(failure, observed):
109>|   {==}
110 |
exit=1
```

### Control D: r11 unjudged change authorizes

Replays `no-verdict.bend` at the pin.

```diff
56c56
<     case Unjudged{}: True{}
---
>     case Unjudged{}: False{}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- target : ../examples/laws-no-ledger.Outcome
Location: ../laws.r11_an_unjudged_change_cannot_authorize_landing
111 | def Laws.r11_an_unjudged_change_cannot_authorize_landing(target):
112>|   {==}
113 |
exit=1
```

### Control E: r11 selection not accounted

Replays `select-tests.bend` at the pin.

```diff
92c92
<     case h <> t: gate_observed(ledger, h) <> report(ledger, t)
---
>     case h <> t: report(ledger, t)
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : {List.length(&1, Bool, ../examples/laws-no-ledger.report(ledger, t)) == 1n+List.length(&1, ../examples/laws-no-ledger.Observed, t) : Nat}
- observed : {1n+List.length(&1, Bool, ../examples/laws-no-ledger.report(ledger, t)) == 1n+List.length(&1, ../examples/laws-no-ledger.Observed, t) : Nat}
Context:
- ledger : Nat
- h      : ../examples/laws-no-ledger.Observed
- t      : List<&1, ../examples/laws-no-ledger.Observed>
Location: ../laws.r11_every_selected_invocation_is_accounted_for
123 |     case h <> t:
124>|       %Laws.r11_every_selected_invocation_is_accounted_for(ledger, t) : {Nat.add(1n, List.length(&1, Bool, NoLedger.report(ledger, t))) == Nat.add(1n, _) : Nat}
125 |       {==}
exit=1
```

## The bypass probes at the pin

The revision 11 bypass probes import this model. The six that import it now fail at the pin, because
the composition they build is no longer expressible over the re-encoded decision. The five probes of
the same review that already failed at the review's own pin (`private-runner`, `opaque-runner`,
`empty-forge`, `scoped-forge`, `opaque-forge`) are its expressibility probes and are unchanged.

The review directory is not on this lane's branch. Its files are the ones commit
`692a5fb977f58d77c888ed7c1d641e40a66ac9fd` records, and each was run from a byte-identical copy placed at the same relative
depth under `.scratch/mirror/docs/bend2/reviews/`, beside a copy of `docs/bend2/`, so the probe's
`../../examples/...` imports resolve against the re-encoded models. `.scratch/` is gitignored and
carries no committed content. The copy method, with the digest check that establishes
byte-equality, is recorded in [laws-check.evidence.md](laws-check.evidence.md). Every command
below runs from the mirror root, so `$BEND docs/bend2/reviews/astra-r11-r12-probes/<probe>.bend
--check-only` is the command a checkout that carries the review directory runs.


| Probe | sha256 | Exit |
|---|---|---|
| `census-test.bend` | `ba1541ea14a38c4ab9057f5180235bbcc60595faf7b157e4a9e166a6ce0cd899` | 1 |
| `failure-kind.bend` | `0337e2bb686afa618f2105d2b76f7e31ecc7752a0b819fea8725d3a830275278` | 1 |
| `forge-outcomes.bend` | `e3b1831970a32d9e496c4e8c1f85b16a33666c48419ad9845f271f385fadf5f8` | 1 |
| `no-verdict.bend` | `2ed94a7080af26f565348c94aa995bf11afc110d6f1799b85f88f6cdf27e5b5e` | 1 |
| `select-tests.bend` | `5c4aa5017b759b98cd5c75a07d4ab049b386d07ef6bcb1398359da42d6b5dd88` | 1 |
| `semantics.bend` | `20db9c6afdfa5e47d8fb3f023a854bdd005ddde189657b08799c526620fa8690` | 1 |

```sh
$ $BEND docs/bend2/reviews/astra-r11-probes/census-test.bend --check-only
Error:
- expected : ../../examples/laws-no-ledger.Failed with 1 field
- observed : ../../examples/laws-no-ledger.Failed{}
Location: assertion_outcome
21 |     case True{}: M.Passed{}
22>|     case False{}: M.Failed{}
23 |
exit=1
$ $BEND docs/bend2/reviews/astra-r11-probes/failure-kind.bend --check-only
Error:
- expected : ../../examples/laws-no-ledger.Identity
- observed : String
Location: main
4 | def main() -> M.Outcome:
5>|   M.Failed{"fixtureLeak"}
6 |
exit=1
$ $BEND docs/bend2/reviews/astra-r11-probes/forge-outcomes.bend --check-only
Error:
- expected : ../../examples/laws-no-ledger.Failed with 1 field
- observed : ../../examples/laws-no-ledger.Failed{}
Context:
- p      : Nat
- actual : ../../examples/laws-no-ledger.Outcome
Location: target_from_record
10 |     case 0n: actual
11>|     case 1n+p: M.Failed{}
12 |
exit=1
$ $BEND docs/bend2/reviews/astra-r11-probes/no-verdict.bend --check-only
Error:
- expected : a declared constructor (../../examples/laws-no-ledger.Outcome declares ../../examples/laws-no-ledger.Passed, ../../examples/laws-no-ledger.Failed, ../../examples/laws-no-ledger.Absent, ../../examples/laws-no-ledger.Unjudged)
- observed : M.NoVerdict{}
Location: main
4 | def main() -> M.Outcome:
5>|   M.NoVerdict{}
6 |
exit=1
$ $BEND docs/bend2/reviews/astra-r11-probes/select-tests.bend --check-only
Error:
- expected : ../../examples/laws-no-ledger.Failed with 1 field
- observed : ../../examples/laws-no-ledger.Failed{}
Location: main
16 | def main() -> List<Bool>:
17>|   [gate_from_record(0n, [M.Observed{M.Failed{}, M.Passed{}}]),
18 |    gate_from_record(stored_record(), [M.Observed{M.Failed{}, M.Passed{}}])]
exit=1
$ $BEND docs/bend2/reviews/astra-r11-probes/semantics.bend --check-only
Error:
- expected : a defined name
- observed : M.breaks
Location: main
5 | def main() -> List<Bool>:
6>|   [M.breaks(M.Failed{}, M.Absent{}),
7 |    M.breaks(M.Failed{}, M.Failed{}),
exit=1
```
