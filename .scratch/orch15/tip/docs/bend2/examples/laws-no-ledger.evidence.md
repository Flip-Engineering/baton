# laws-no-ledger — evidence

CLAIM: in the model, a landing gate decides from two observed runs only, and it blocks exactly when
a test fails with the change and does not fail on the target. The laws quantify over a stored
record (`record: Nat`), so a gate whose decision depends on the record makes a law false at a
named case.

Status: this example backs a proposed addition to the law set (revision 11, 2026-09-25). Its source
is the operator ban "No bookkeeping ledgers in place of function" in AGENTS.md and the removals
tracked by #579 and #580. The entry is not approved, and its laws are not approved.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

## The model under the laws

```sh
$ bend docs/bend2/examples/laws-no-ledger.bend --check-only
All terms check.
exit=0
$ bend docs/bend2/examples/laws-no-ledger.bend
no-ledger: the gate reads only observations; both laws checked.
exit=0
```

The file declares `Outcome` (`Passed{}`, `Failed{}`, `Absent{}`; a test new with the change
is `Absent{}` on the target), `Observed` (one test observed with the change and on the target),
the specification `breaks`, the per-test `gate(record, change, target)`, and the landing
decision `landing_blocks(record, runs)` over every selected test. Two laws are discharged:

- `gate_reads_only_observations`: for every record and every pair of outcomes, the gate equals
  `breaks`. The proof splits every record, change and target case (two record cases, nine
  outcome pairs), so a gate that reads the record fails on a named case.
- `landing_blocks_iff_breaks`: for every record and every list of observations, the landing
  blocks exactly when some test breaks. The proof is by induction over the list.

Each control below replaces only the gate definition in a scratch copy and keeps the case-split
proof unchanged. Bend reports the first case that does not discharge, as `expected` (the gate)
against `observed` (the specification).

## Control A: an expected-failure list

A record above zero lists the test as expected to fail, and a listed test never blocks.

```diff
40a41,42
> # Control A: an expected-failure list. A record above zero lists the test as expected to fail,
> # and a listed test never blocks.
42c44,46
<   breaks(change, target)
---
>   match record:
>     case 0n: breaks(change, target)
>     case 1n+p: False{}
```

```sh
$ bend <scratch>/laws-no-ledger-expected-failure.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- p : Nat
Location: gate_reads_only_observations
104 |           match target:
105>|             case Passed{}: {==}
106 |             case Failed{}: {==}
exit=1
```

Failing case: record listed, change `Failed{}`, target `Passed{}`. The gate lets through a test
the change breaks. This is the failure the manifest produced for #565, where 27 rows re-listed at
closed issues hid a regression (#566).

## Control B: a count pin

The record is the pinned failure count, and the gate blocks when the observed count differs from
the pin.

```diff
40a41,53
> def failed(o: Outcome) -> Bool:
>   match o:
>     case Passed{}: False{}
>     case Failed{}: True{}
>     case Absent{}: False{}
> 
> def negate(b: Bool) -> Bool:
>   match b:
>     case True{}: False{}
>     case False{}: True{}
> 
> # Control B: a count pin. The record is the pinned failure count; the gate blocks when the
> # observed failure count differs from the pin.
42c55,57
<   breaks(change, target)
---
>   match record:
>     case 0n: failed(change)
>     case 1n+p: negate(failed(change))
```

```sh
$ bend <scratch>/laws-no-ledger-count-pin.bend --check-only
Error:
- expected : True{}
- observed : False{}
Location: gate_reads_only_observations
 99 |             case Passed{}: {==}
100>|             case Failed{}: {==}
101 |             case Absent{}: {==}
exit=1
```

Failing case: pin 0, change `Failed{}`, target `Failed{}`. The gate blocks a failure the target
already has.

The same control, with the pin-1 branch of the proof placed first:

```sh
$ bend <scratch>/laws-no-ledger-count-pin-1.bend --check-only
Error:
- expected : True{}
- observed : False{}
Context:
- p : Nat
Location: gate_reads_only_observations
93 |           match target:
94>|             case Passed{}: {==}
95 |             case Failed{}: {==}
exit=1
```

Failing case: pin 1, change `Passed{}`, target `Passed{}`. The gate blocks a run where nothing
fails, until someone updates the pin. This is the re-pin work the census pins required (SI6,
`CORPUS_COUNTS`, the runtime-api count literal removed in c66098c1).

## Control C: no comparison with the target

Every failure with the change blocks. The record is not read. This control shows that `breaks`
is not a trivial specification: the target observation decides the outcome.

```diff
40a41,47
> def failed(o: Outcome) -> Bool:
>   match o:
>     case Passed{}: False{}
>     case Failed{}: True{}
>     case Absent{}: False{}
> 
> # Control C: no comparison with the target. Every failure with the change blocks.
42c49
<   breaks(change, target)
---
>   failed(change)
```

```sh
$ bend <scratch>/laws-no-ledger-no-target.bend --check-only
Error:
- expected : True{}
- observed : False{}
Location: gate_reads_only_observations
91 |             case Passed{}: {==}
92>|             case Failed{}: {==}
93 |             case Absent{}: {==}
exit=1
```

Failing case: change `Failed{}`, target `Failed{}`. The gate blocks a failure the target
already has.

## Scope

The laws constrain the model gate. They do not import Baton's gate
(`defaultIntegrationGates` in `impl/src/swarm-runtime.mjs`), whose implementation is #580. The
laws do not prove that the observations are real test runs: an `Outcome` value in this model can
be written by any caller. Whether the rewrite can make an outcome constructible only by the runner
is review question 2 in [../laws-proposed.md](../laws-proposed.md), revision 11.
