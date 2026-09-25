# laws-no-ledger — evidence

CLAIM: for fixed supplied outcomes and a fixed supplied selection, the gate equals `breaks` for
every explicit record argument, and landing is the OR of those comparisons. Provenance,
completeness, test policy and application composition remain open. In the model a landing gate
therefore decides from the two observed runs only and blocks exactly when a test fails with the
change and does not fail on the target, because the stored record is a parameter the law
quantifies over and a gate that reads it makes a law false at a named case.

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
44a45,46
> # Control A: an expected-failure list. A record above zero lists the test as expected to fail,
> # and a listed test never blocks.
46c48,50
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
44a45,57
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
46c59,61
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
44a45,51
> def failed(o: Outcome) -> Bool:
>   match o:
>     case Passed{}: False{}
>     case Failed{}: True{}
>     case Absent{}: False{}
> 
> # Control C: no comparison with the target. Every failure with the change blocks.
46c53
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

## Revision 11 adopted comparison: failure identity, unjudged verdicts and invocation accounting

The adopted statement of 2026-09-25 adds to the comparison above a failure identity, the
reporting of unjudged verdicts and the accounting of every selected invocation. The
declarations above are unchanged. The extension declares `FailureKind`, `FailureId` (the
file, the test where available, the failure kind and the specified stable semantic code),
`Verdict` (`Cleared`, `Broke{id}`, `NotRun`, `NoVerdict`), `Invocation`, the
per-invocation rule `invocation_breaks`, the runtime's landing decision
`judged_landing(record, selected)`, the selection `selected`, the accounting `accounted`
and the target verdict `target_verdict`. The laws discharged are:

| Law | Proposition |
|---|---|
| `id_self_match`, `a_different_failure_kind_is_a_different_identity`, `a_different_file_is_a_different_identity`, `a_different_code_is_a_different_identity` | the failure identity is reflexive in each component and differs when a component differs |
| `passing_change_does_not_block`, `unjudged_change_cannot_authorize_landing`, `target_absence_contributes_no_matching_failure`, `unjudged_target_supplies_no_matching_failure` | a passing change does not block; an unjudged change cannot authorize landing; target absence and an unjudged target supply no matching failure |
| `a_matching_failure_identity_does_not_block`, `a_different_failure_kind_blocks` | a matching identity does not block, and a different identity does |
| `judged_landing_blocks_iff_a_selected_invocation_breaks` | the landing blocks exactly when a selected invocation breaks, over the runtime's own selection |
| `selection_is_the_changes_selected_set` | the selection is the change's selected set, so no stored record narrows it |
| `every_selected_invocation_is_accounted` | the accounting reports one verdict per selected invocation |
| `target_verdict_is_the_observed_run` | the compared target verdict is the observed run's, so no stored record supplies it |

The model under the laws, re-run at this revision:

```sh
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-no-ledger.bend --check-only
All terms check.
exit=0
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-no-ledger.bend
no-ledger: the gate reads only observations; both laws checked.
exit=0
```

Each control below replaces one function in a scratch copy and keeps the laws unchanged.
Bend reports the first case that does not discharge.

### Control 1: forged target

```diff
287,288c287,290
< def target_verdict(record: Nat, observed: Verdict) -> Verdict:
<   observed
---
> def target_verdict(record: Nat, observed: Verdict) -> Verdict:
>   match record:
>     case 0n: observed
>     case 1n+p: Broke{FailureId{0n, 0n, Assertion{}, 0n}}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/r11-forged-target.bend --check-only
Error:
- expected : target_verdict(record, observed)
- observed : observed
Context:
- record   : Nat
- observed : Verdict
Location: target_verdict_is_the_observed_run
388 | def target_verdict_is_the_observed_run(record, observed):
389>|   {==}
390 |
```

### Control 2: empty selection

```diff
279,280c279,282
< def selected(record: Nat, invocations: List<Invocation>) -> List<Invocation>:
<   invocations
---
> def selected(record: Nat, invocations: List<Invocation>) -> List<Invocation>:
>   match record:
>     case 0n: invocations
>     case 1n+p: []
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/r11-empty-selection.bend --check-only
Error:
- expected : judged_landing(record, selected(record, []))
- observed : False{}
Context:
- record : Nat
Location: judged_landing_blocks_iff_a_selected_invocation_breaks
339 |   match invocations:
340>|     case []: {==}
341 |     case h <> t:
```

### Control 3: same failure always matches

```diff
263c263,263
<         case Broke{+t}: not_bool(id_eq(c, t))
---
>         case Broke{+t}: False{}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/r11-same-failure-always-matches.bend --check-only
Error:
- expected : {False{} == False{} : Bool}
- observed : {not_bool(id_eq(id, id)) == False{} : Bool}
Context:
- id : FailureId
Location: a_matching_failure_identity_does_not_block
327 | def a_matching_failure_identity_does_not_block(id):
328>|   %id_self_match(id) : {not_bool(_) == False{} : Bool}
329 |   {==}
```

### Control 4: unjudged change passes

```diff
257,258c257,258
<     case NoVerdict{}: True{}
<     case Broke{+c}:
---
>     case NoVerdict{}: False{}
>     case Broke{+c}:
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/r11-unjudged-change-passes.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- target : Verdict
Location: unjudged_change_cannot_authorize_landing
306 | def unjudged_change_cannot_authorize_landing(target):
307>|   {==}
308 |
```

### Control 5: unjudged target matches

```diff
262,263c262,263
<         case NoVerdict{}: True{}
<         case Broke{+t}: not_bool(id_eq(c, t))
---
>         case NoVerdict{}: False{}
>         case Broke{+t}: not_bool(id_eq(c, t))
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/r11-unjudged-target-matches.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- id : FailureId
Location: unjudged_target_supplies_no_matching_failure
320 | def unjudged_target_supplies_no_matching_failure(id):
321>|   {==}
322 |
```

### Control 6: accounting drops an invocation

```diff
285c285,285
<     case h <> t: h <> accounted(t)
---
>     case h <> t: accounted(t)
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/r11-accounting-drops-an-invocation.bend --check-only
Error:
- expected : {count(accounted(t)) == 1n+count(t) : Nat}
- observed : {1n+count(accounted(t)) == 1n+count(t) : Nat}
Context:
- h : Invocation
- t : List<&1, Invocation>
Location: every_selected_invocation_is_accounted
377 |     case h <> t:
378>|       %every_selected_invocation_is_accounted(t) : {1n+count(accounted(t)) == 1n+_ : Nat}
379 |       {==}
```

## Scope

The laws constrain the model's selection, comparison, accounting and landing decision.
The observations are still values a caller can write, and the derivation of the failure
key from the run is the observer's obligation. The runtime's own gate is
`defaultIntegrationGates` in `impl/src/swarm-runtime.mjs`, whose replacement is #580. The
census test in `astra-r11-probes/census-test.bend` observes a real difference and is a
legitimate test of a prohibited obligation; no law distinguishes it, and the repository
test-policy clause covers it.
