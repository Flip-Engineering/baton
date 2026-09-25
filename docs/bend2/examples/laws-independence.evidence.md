# laws-independence — evidence

CLAIM: The model is the adopted G1. For the same validated request, authority and observed
resources, changing an administrative annotation about the work changes nothing: the admission, the
refusal identity, the selected checks, the required prerequisites, the management permissions and
the continuation transitions are the same as they are with no annotations at all. The decision
inputs are derived from the request. Beside the independence laws, the model carries the positive
behavior each domain must keep, so an implementation that satisfies independence by refusing
everything fails. `../laws.bend` states the nine obligations and `laws-proof.bend` discharges them.

Status: Adopted by the operator 2026-09-25 (G1 of the astra review), encoded here. G1 is a proposed
application property; the entry is not part of the approved set.

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
$ $BEND docs/bend2/examples/laws-independence.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/examples/laws-independence.bend
independence: every decision is the same for every administrative annotation; the laws are checked in laws-proof.bend.
exit=0
```

`docs/bend2/examples/laws-independence.bend` sha256 `9a1891cf2de9769eb49f79e565fdcbfe9cfe434f6c2db42807f1ccc730f0f67b`.

## The laws

[../laws.bend](../laws.bend) states these obligations over the model and
[laws-proof.bend](laws-proof.bend) discharges every one.

| Law | What it fixes |
|---|---|
| `g1_admission_is_independent_of_annotations` | admission is annotation-independent |
| `g1_refusal_identity_is_independent_of_annotations` | the refusal identity is annotation-independent |
| `g1_selected_checks_are_independent_of_annotations` | the selected checks are annotation-independent |
| `g1_required_prerequisites_are_independent_of_annotations` | the prerequisites are annotation-independent |
| `g1_management_permissions_are_independent_of_annotations` | management permissions are annotation-independent |
| `g1_continuation_transitions_are_independent_of_annotations` | continuation transitions are annotation-independent |
| `g1_authorized_work_with_available_resources_is_admitted` | authorized work with resources is admitted |
| `g1_work_without_authority_is_refused` | work without authority is refused |
| `g1_authorized_work_with_short_resources_waits` | authorized work without resources waits |

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

### Control A: g1 always deny

Replays `g1-always-deny.bend` at the pin.

```diff
88c88
<   expected(authority_of(r), resources_of(r))
---
>   Refused{}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-independence.Refused{}
- observed : ../examples/laws-independence.Admitted{}
Context:
- annotations : ../examples/laws-independence.Annotation
Location: ../laws.g1_authorized_work_with_available_resources_is_admitted
152 | def Laws.g1_authorized_work_with_available_resources_is_admitted(annotations):
153>|   {==}
154 |
exit=1
```

### Control B: g1 record derived input

Replays `g1-smuggle.bend` at the pin.

```diff
86a87,95
> def admitted_when(record: Nat, observed: Bool) -> Bool:
>   match record:
>     case 0n: observed
>     case 1n+p: Bool.not(observed)
> 
> def allowances_of(a: Annotation) -> Nat:
>   match a:
>     case Annotation{+allowances, _, _, _}: allowances
> 
88c97
<   expected(authority_of(r), resources_of(r))
---
>   expected(authority_of(r), admitted_when(allowances_of(annotations), resources_of(r)))
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-independence.expected(../examples/laws-independence.authority_of(r), ../examples/laws-independence.admitted_when(../examples/laws-independence.allowances_of(annotations), ../examples/laws-independence.resources_of(r)))
- observed : ../examples/laws-independence.expected(../examples/laws-independence.authority_of(r), ../examples/laws-independence.resources_of(r))
Context:
- annotations : ../examples/laws-independence.Annotation
- r           : ../examples/laws-independence.Request
Location: ../laws.g1_admission_is_independent_of_annotations
131 | def Laws.g1_admission_is_independent_of_annotations(annotations, r):
132>|   {==}
133 |
exit=1
```

### Control C: g1 annotation selects checks

Replays `g1.bend` at the pin.

```diff
106a107,111
> def status_of(a: Annotation) -> Bool:
>   match a:
>     case Annotation{_, _, _, +status}:
>       Nat.is_eq(status, 0n)
> 
108c113
<   checks_when(authority_of(r))
---
>   checks_when(status_of(annotations))
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-independence.checks_when(../examples/laws-independence.status_of(annotations))
- observed : [../examples/laws-independence.Build{}, ../examples/laws-independence.Gates{}, ../examples/laws-independence.Coverage{}]
Context:
- annotations : ../examples/laws-independence.Annotation
- r           : ../examples/laws-independence.Request
Location: ../laws.g1_selected_checks_are_independent_of_annotations
137 | def Laws.g1_selected_checks_are_independent_of_annotations(annotations, r):
138>|   {==}
139 |
exit=1
```

### Control D: g1 annotation terminalizes

Replays `g1.bend` at the pin.

```diff
128,131c128,132
<   match event:
<     case Tick{}: state
<     case TurnEnd{}: state
<     case Stop{}: Stopped{}
---
>   match annotations:
>     case Annotation{_, +converged, _, _}:
>       match converged:
>         case 0n: state
>         case 1n+p: Stopped{}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-independence.step(annotations, state, ../examples/laws-independence.Tick{})
- observed : state
Context:
- annotations : ../examples/laws-independence.Annotation
- state       : ../examples/laws-independence.WorkState
Location: ../laws.g1_continuation_transitions_are_independent_of_annotations
147 |   match event:
148>|     case Independence.Tick{}: {==}
149 |     case Independence.TurnEnd{}: {==}
exit=1
```

## The bypass probes at the pin

`g1` is the positive probe of the G1 shape: it proves a quantified noninterference law over six
work-act constructors and stays green. `g1-always-deny` and `g1-smuggle` are bypass probes that
carry their own copy of the law, so they do not import this model and cannot fail as files; the
controls below hold the same two constructions against the re-encoded law and each fails at a named
law. `g1-always-deny` is the obstructive implementation (`decide` returns False for every act);
`g1-smuggle` computes the supposedly observed input from the record before the lawful call.

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
| `g1.bend` | `25b948ebb2ea4b05cc7e4134d458d4efa8998b42fe0b69109d31da74bef3d853` | 0 |
| `g1-always-deny.bend` | `7a452291d5d06efabda0b130e7f78d21c32e61ca553980fb95c58839edd8a0a5` | 0 |
| `g1-smuggle.bend` | `70c34bc2d880ca44a54d8d10e270eb0b34c66fb01ca2850fbf490c7d4fa6dc8a` | 0 |

```sh
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/g1.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/g1-always-deny.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/g1-smuggle.bend --check-only
All terms check.
exit=0
```
