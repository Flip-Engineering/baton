# laws-no-ceiling — evidence

CLAIM: The model is the adopted revision 12a. The admission decision derives from the authority the
caller holds and from the resource state observed now, and is the same for every magnitude and every
elapsed time. Valid authority with available resources admits; valid authority with short resources
retains the work pending; invalid authority refuses. Every terminal transition is bound to an event:
a tick preserves the work disposition, completion and cancellation terminate the work, and a
provider failure carries the cause the provider or host observably reported. `../laws.bend` states
the nine obligations and `laws-proof.bend` discharges them.

Status: Proposed revision of M-10 (revision 12a, re-encoded 2026-09-25) from the operator rulings of
2026-09-13, 2026-09-20 and 2026-09-21 (#258, #541, #583) and from the adopted statement in
`../reviews/astra-law-review-r11-r12.md`. Removing M-10's physical-bound exception is a new policy
decision; the entry is not part of the approved set.

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
$ $BEND docs/bend2/examples/laws-no-ceiling.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/examples/laws-no-ceiling.bend
no-ceiling: the decision is derived from authority and measured resources; the laws are checked in laws-proof.bend.
exit=0
```

`docs/bend2/examples/laws-no-ceiling.bend` sha256 `6f332c47c63297d70fd4bf484339bc5bec5d43b9fa4d4c4d4d909a049b0451be`.

## The laws

[../laws.bend](../laws.bend) states these obligations over the model and
[laws-proof.bend](laws-proof.bend) discharges every one.

| Law | What it fixes |
|---|---|
| `r12a_admission_is_derived_from_authority_and_measured_resources` | the decision is the specification of those two inputs |
| `r12a_admission_ignores_magnitude_and_clock` | clearing magnitude and elapsed changes nothing |
| `r12a_valid_authority_with_available_resources_admits` | available resources admit |
| `r12a_valid_authority_with_short_resources_retains_the_work_pending` | short resources retain the work |
| `r12a_invalid_authority_refuses` | invalid authority refuses |
| `r12a_tick_preserves_the_work_disposition` | a tick preserves the state, owner, owed data and continuation |
| `r12a_completion_terminalizes_the_work` | completion terminates |
| `r12a_cancellation_terminalizes_the_work` | cancellation terminates |
| `r12a_external_failure_reports_its_observed_cause` | a provider failure carries its observed cause |

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

### Control A: r12a size ceiling

Replays `a-inputs.bend` at the pin.

```diff
67c67,71
<   expected(authority_of(r), resources_of(r))
---
>   match r:
>     case Request{+authority, +resources, +magnitude, +elapsed}:
>       match magnitude:
>         case 0n: expected(authority, resources)
>         case 1n+s: Refused{}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-no-ceiling.admit(r)
- observed : ../examples/laws-no-ceiling.expected(../examples/laws-no-ceiling.authority_of(r), ../examples/laws-no-ceiling.resources_of(r))
Context:
- r : ../examples/laws-no-ceiling.Request
Location: ../laws.r12a_admission_is_derived_from_authority_and_measured_resources
207 | def Laws.r12a_admission_is_derived_from_authority_and_measured_resources(r):
208>|   {==}
209 |
exit=1
```

### Control B: r12a waiting deadline

Replays `a-timer.bend` at the pin.

```diff
65a66,70
> def unavailable_after_wait(authority: Authority, +resources: Resources) -> Authority:
>   match resources:
>     case Available{}: authority
>     case Short{}: Invalid{}
> 
67c72,76
<   expected(authority_of(r), resources_of(r))
---
>   match r:
>     case Request{+authority, +resources, +magnitude, +elapsed}:
>       match elapsed:
>         case 0n: expected(authority, resources)
>         case 1n+e: expected(unavailable_after_wait(authority, resources), resources)
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-no-ceiling.admit(r)
- observed : ../examples/laws-no-ceiling.expected(../examples/laws-no-ceiling.authority_of(r), ../examples/laws-no-ceiling.resources_of(r))
Context:
- r : ../examples/laws-no-ceiling.Request
Location: ../laws.r12a_admission_is_derived_from_authority_and_measured_resources
207 | def Laws.r12a_admission_is_derived_from_authority_and_measured_resources(r):
208>|   {==}
209 |
exit=1
```

### Control C: r12a tick fabricates a failure

Replays `a-timer.bend` at the pin.

```diff
87c87
<     case Tick{}: state
---
>     case Tick{}: Failed{0n}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-no-ceiling.Failed{0n}
- observed : state
Context:
- state : ../examples/laws-no-ceiling.Work
Location: ../laws.r12a_tick_preserves_the_work_disposition
223 | def Laws.r12a_tick_preserves_the_work_disposition(state):
224>|   {==}
225 |
exit=1
```

### Control D: r12a failure without its cause

Replays `a-timer.bend` at the pin.

```diff
90c90
<     case ProviderFailure{+cause}: Failed{cause}
---
>     case ProviderFailure{+cause}: Failed{0n}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-no-ceiling.Failed{0n}
- observed : ../examples/laws-no-ceiling.Failed{cause}
Context:
- state : ../examples/laws-no-ceiling.Work
- cause : Nat
Location: ../laws.r12a_external_failure_reports_its_observed_cause
232 | def Laws.r12a_external_failure_reports_its_observed_cause(state, cause):
233>|   {==}
234 |
exit=1
```

## The bypass probes at the pin

Two revision 12a probes import this model and now fail at the pin. `a-transition` is the positive
illustration of the transition shape (its `step` is a function of the event alone and its law
holds); the re-encoded law generalizes it to the work record, so the state a tick preserves carries
the owner, the owed data and the continuation.

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
| `a-inputs.bend` | `1df89628e1d003821586305ac589802d847c0dddcd72aa2535743a3502a39e09` | 1 |
| `a-timer.bend` | `51ee5a47e30db63d4698848cda449199d04ececeb3527d818dbf91cfa7f139e7` | 1 |

```sh
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/a-inputs.bend --check-only
Error:
- expected : a defined name
- observed : M.Decision
Context:
- size : Nat
Location: via_authority
 8 | 
 9>| def via_authority(+size: Nat) -> M.Decision:
10 |   M.decide(size, 0n, admits_size(size), True{})
exit=1
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/a-timer.bend --check-only
Error:
- expected : a defined name
- observed : M.Decision
Context:
- elapsed : Nat
Location: timer_callback
3 | 
4>| def timer_callback(elapsed: Nat, previous: M.Decision) -> M.Decision:
5 |   match elapsed:
exit=1
```

The positive illustration in the same directory stays green:

```sh
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/a-transition.bend --check-only
All terms check.
exit=0
```
