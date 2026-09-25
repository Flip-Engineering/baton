# laws-prerequisite — evidence

CLAIM: The model is the adopted G2 in its refined form. The prerequisite for a valid authorized
request is derived from the work's semantic state, so the administrative declarations the agent
maintains never enter it and an administrative record is never the enabler. A blocked continuation
names the actual missing resource, authority, semantic input or explicit operator or orchestrator
decision, and it waits on a party the runtime wakes. Each enabler has an enabling effect, and an
administrative declaration satisfies none of them however it is labelled. When the prerequisite is
satisfied the work is admitted with no separate administrative acknowledgment. `../laws.bend` states
the six obligations and `laws-proof.bend` discharges them.

Status: Adopted by the operator 2026-09-25 (G2 in its refined form, which admits waits on semantic
input and on a woken orchestrator decision consistent with revision 10), encoded here. G2 is a
proposed application property; the entry is not part of the approved set.

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
$ $BEND docs/bend2/examples/laws-prerequisite.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/examples/laws-prerequisite.bend
prerequisite: every blocked continuation names an actual enabler and a woken party; the laws are checked in laws-proof.bend.
exit=0
```

`docs/bend2/examples/laws-prerequisite.bend` sha256 `69dce198df3a3f975cf078d74a263771dbb3a14954b773bf708143b108c6860e`.

## The laws

[../laws.bend](../laws.bend) states these obligations over the model and
[laws-proof.bend](laws-proof.bend) discharges every one.

| Law | What it fixes |
|---|---|
| `g2_the_prerequisite_is_derived_from_the_semantic_state` | the prerequisite is the semantic state's expectation |
| `g2_maintained_declarations_do_not_change_the_prerequisite` | maintained declarations change nothing |
| `g2_the_derived_prerequisite_is_never_administrative` | no derivation yields an administrative record |
| `g2_an_administrative_declaration_satisfies_nothing` | a declaration satisfies nothing |
| `g2_a_ready_prerequisite_admits_without_an_acknowledgment` | a ready prerequisite admits |
| `g2_a_blocked_continuation_names_a_woken_party` | a blocked continuation waits on a woken party |

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

### Control A: g2 declaration is the prerequisite

Replays `g2-label.bend` at the pin.

```diff
64c64,68
<   expected_enabler(semantic_of(s))
---
>   match s:
>     case State{+semantic, +maintained}:
>       match maintained:
>         case 0n: expected_enabler(semantic)
>         case 1n+p: Resource{}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-prerequisite.enabler_of(s)
- observed : ../examples/laws-prerequisite.expected_enabler(../examples/laws-prerequisite.semantic_of(s))
Context:
- s : ../examples/laws-prerequisite.State
Location: ../laws.g2_the_prerequisite_is_derived_from_the_semantic_state
164 | def Laws.g2_the_prerequisite_is_derived_from_the_semantic_state(s):
165>|   {==}
166 |
exit=1
```

### Control B: g2 orchestrator decision as bookkeeping

Replays `g2-orchestrator-wait.bend` at the pin.

```diff
60c60
<     case NeedsOrchestrator{}: OrchestratorDecision{}
---
>     case NeedsOrchestrator{}: Administrative{0n}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- maintained : Nat
Location: ../laws.g2_the_derived_prerequisite_is_never_administrative
177 |         case Prerequisite.NeedsInput{}: {==}
178>|         case Prerequisite.NeedsOrchestrator{}: {==}
179 |
exit=1
```

### Control C: g2 declaration satisfies

Replays `g2-label.bend` at the pin.

```diff
80c80
<     case Administrative{+record}: False{}
---
>     case Administrative{+record}: ready
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ready
- observed : False{}
Context:
- record : Nat
- ready  : Bool
Location: ../laws.g2_an_administrative_declaration_satisfies_nothing
180 | def Laws.g2_an_administrative_declaration_satisfies_nothing(record, ready):
181>|   {==}
182 |
exit=1
```

### Control D: g2 blocked without a woken party

Replays `g2-orchestrator-wait.bend` at the pin.

```diff
93c93
<     case Resource{}: NoPark.Runtime{}
---
>     case Resource{}: NoPark.Unwoken{}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- maintained : Nat
Location: ../laws.g2_a_blocked_continuation_names_a_woken_party
197 |         case Prerequisite.Ready{}: {==}
198>|         case Prerequisite.NeedsResource{}: {==}
199 |         case Prerequisite.NeedsAuthority{}: {==}
exit=1
```

## The bypass probes at the pin

`g2` is the positive probe of the literal G2 shape and stays green. `g2-label` and `g2-orchestrator-
wait` are bypass probes that carry their own copy of the law, so they do not import this model and
cannot fail as files; the controls below hold their two constructions against the re-encoded law and
each fails at a named law. `g2-label` classifies a census rewrite as a resource; over the re-encoded
model the prerequisite is derived from the semantic state, so a maintained declaration cannot become
the enabler. `g2-orchestrator-wait` records that the literal G2 forbids the orchestrator decision;
the refined form the operator adopted admits it, and `g2_a_blocked_continuation_names_a_woken_party`
covers it with the revision 10 party vocabulary by importing `laws-no-park.bend`.

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
| `g2.bend` | `711c1fbb9e60d7a0abdfa3ebcd6d7fa8e12371047b14531e53d5bd93cb675467` | 0 |
| `g2-label.bend` | `fac91d679679f92f5c8f560c36567eeb908d45c9cabc5ba32df7743ac524ef43` | 0 |
| `g2-orchestrator-wait.bend` | `9ef8872de9ea951b4a18ca5103891dc7423a68a02b593c854e905becc5461964` | 0 |

```sh
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/g2.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/g2-label.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/g2-orchestrator-wait.bend --check-only
All terms check.
exit=0
```
