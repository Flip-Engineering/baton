# laws-orchestrator-authority — evidence

CLAIM: The model is the adopted revision 12c. The runtime derives the scope from authenticated
current authority; a revoked or stale delegation derives no scope. Every management act - recruit,
guide, stop, review, integrate and resume - carries the same decision for a target, so no act its
scope covers waits on another seat to perform it. No act is dispatched outside the derived scope.
The effect follows the same dispatch decision, so no second check can deny an act the scope admits.
A seat leads itself, so self actions remain a valid source of authority. `../laws.bend` states the
six obligations and `laws-proof.bend` discharges them.

Status: Proposed addition (revision 12c, re-encoded 2026-09-25) from the operator ruling of
2026-09-21 and from the adopted statement in `../reviews/astra-law-review-r11-r12.md`. The
2026-09-25 stop-grant incident (a seat whose available actions omitted `swarm.stop`) is the open
instance. The entry, the whole-mandate boundary and M-15 remain open; the entry is not part of the
approved set.

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
$ $BEND docs/bend2/examples/laws-orchestrator-authority.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/examples/laws-orchestrator-authority.bend
orchestrator-authority: the scope and every management act are derived from current authority; the laws are checked in laws-proof.bend.
exit=0
```

`docs/bend2/examples/laws-orchestrator-authority.bend` sha256 `64847fb48aa0db4af2b965fbadace5c3ecdf2586d0d9cdf9f44276ea33a283f4`.

## The laws

[../laws.bend](../laws.bend) states these obligations over the model and
[laws-proof.bend](laws-proof.bend) discharges every one.

| Law | What it fixes |
|---|---|
| `r12c_revoked_authority_derives_no_scope` | revocation derives no scope |
| `r12c_stale_authority_derives_no_scope` | a stale generation derives no scope |
| `r12c_no_act_is_dispatched_outside_the_derived_scope` | dispatch is exactly the derived scope |
| `r12c_the_delegation_carries_every_management_act` | every management act carries the management decision |
| `r12c_the_effect_follows_the_dispatch_decision` | the effect is derived from the dispatch decision |
| `r12c_self_stop_is_authorized` | a seat stops itself |

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

### Control A: r12c forged relation

Replays `c-relation.bend` at the pin.

```diff
68c68
<   scope_when(d, revoked_of(d), current_of(d))
---
>   leads_of(d)
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : leads
- observed : []
Context:
- actor   : Nat
- leads   : List<&2, Nat>
- revoked : Bool
- current : Bool
Location: ../laws.r12c_revoked_authority_derives_no_scope
256 |   match delegation:
257>|     case Orchestrator.Delegation{+actor, +leads, +revoked, +current}: {==}
258 |
exit=1
```

### Control B: r12c stop not carried

Replays `c-relation.bend` at the pin.

```diff
72c72,78
<   member(target, derive(d))
---
>   match act:
>     case Stop{}: False{}
>     case Recruit{}: member(target, derive(d))
>     case Guide{}: member(target, derive(d))
>     case Review{}: member(target, derive(d))
>     case Integrate{}: member(target, derive(d))
>     case Resume{}: member(target, derive(d))
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-orchestrator-authority.dispatch(delegation, act, target)
- observed : ../examples/laws-orchestrator-authority.member(target, ../examples/laws-orchestrator-authority.scope_when(delegation, ../examples/laws-orchestrator-authority.revoked_of(delegation), ../examples/laws-orchestrator-authority.current_of(delegation)))
Context:
- delegation : ../examples/laws-orchestrator-authority.Delegation
- act        : ../examples/laws-orchestrator-authority.Act
- target     : Nat
Location: ../laws.r12c_no_act_is_dispatched_outside_the_derived_scope
266 | def Laws.r12c_no_act_is_dispatched_outside_the_derived_scope(delegation, act, target):
267>|   {==}
268 |
exit=1
```

### Control C: r12c second check denies

Replays `c-dispatch.bend` at the pin.

```diff
84a85,87
> def second_permission() -> Bool:
>   False{}
> 
86c89
<   performed_when(dispatch(d, act, target))
---
>   performed_when(Bool.and(dispatch(d, act, target), second_permission()))
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-orchestrator-authority.performed_when(Bool.and(../examples/laws-orchestrator-authority.member(target, ../examples/laws-orchestrator-authority.scope_when(delegation, ../examples/laws-orchestrator-authority.revoked_of(delegation), ../examples/laws-orchestrator-authority.current_of(delegation))), False{}))
- observed : ../examples/laws-orchestrator-authority.performed_when(../examples/laws-orchestrator-authority.member(target, ../examples/laws-orchestrator-authority.scope_when(delegation, ../examples/laws-orchestrator-authority.revoked_of(delegation), ../examples/laws-orchestrator-authority.current_of(delegation))))
Context:
- delegation : ../examples/laws-orchestrator-authority.Delegation
- act        : ../examples/laws-orchestrator-authority.Act
- target     : Nat
Location: ../laws.r12c_the_effect_follows_the_dispatch_decision
272 | def Laws.r12c_the_effect_follows_the_dispatch_decision(delegation, act, target):
273>|   {==}
274 |
exit=1
```

### Control D: r12c self action denied

Replays `c-relation.bend` at the pin.

```diff
100c100
<   Delegation{seat, [seat], False{}, True{}}
---
>   Delegation{seat, [], False{}, True{}}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : {False{} == True{} : Bool}
- observed : {Bool.or(Cmp.is_eq(Nat.cmp(seat, seat)), False{}) == True{} : Bool}
Context:
- seat : Nat
Location: ../laws.r12c_self_stop_is_authorized
275 | def Laws.r12c_self_stop_is_authorized(seat):
276>|   %Equal.sym(Bool, Nat.is_eq(seat, seat), True{}, nat_eq_self(seat)) : {Bool.or(_, Orchestrator.member(seat, [])) == True{} : Bool}
277 |   {==}
exit=1
```

## The bypass probes at the pin

The two revision 12c probes import this model and now fail at the pin. `c-relation` supplies the
relation as a caller-chosen value; the re-encoded model derives the scope from the delegation, so no
caller-supplied relation exists. `c-dispatch` adds a second dispatch check after the lawful grant;
the re-encoded model derives the effect from the single dispatch decision.

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
| `c-dispatch.bend` | `7c9ad92bbaa3d6e72df9b3cbd9aeb9f29fcbd04bd72cacd6b409d735a8b43f90` | 1 |
| `c-relation.bend` | `63c88d7bbaecd5c5295182fc53cc72374265d2c65c25125d3c4cf3b751cea762` | 1 |

```sh
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/c-dispatch.bend --check-only
Error:
- expected : a defined name
- observed : M.granted
Location: main
10 | def main() -> List<Bool>:
11>|   [M.granted(M.Leads{}, M.Stop{}),
12 |    dispatch(M.granted(M.Leads{}, M.Stop{}), False{})]
exit=1
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/c-relation.bend --check-only
Error:
- expected : a defined name
- observed : M.granted
Location: main
5 | def main() -> List<Bool>:
6>|   [M.granted(M.Other{}, M.Stop{}), M.granted(M.Leads{}, M.Stop{}),
7 |    M.granted(M.Itself{}, M.Integrate{}), M.granted(M.Itself{}, M.Recruit{})]
exit=1
```
