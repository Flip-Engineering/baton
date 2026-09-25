# laws-no-park — evidence

CLAIM: in the model, every state's waiter is a party Baton wakes to decide it, and the law
`waiter_is_woken` is discharged exactly while that holds. A state added with a waiter the runtime
does not wake makes the obligation unsatisfiable, and a state the waiter function does not cover is
refused at the pin.

Status: this example backs a proposed addition to the law set (revision 10, 2026-09-23). Its shape
is the operator's decision for #572: at every turn end Baton wakes the seat's orchestrator (its
parent seat, or the root) with the turn's report, and the orchestrator decides whether to nudge the
seat on; the seat stops when it declares itself done or its orchestrator stops it. The entry is not
approved, and its law is not approved.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

## The model under the law

```sh
$ bend docs/bend2/examples/laws-no-park.bend --check-only
All terms check.
exit=0
$ bend docs/bend2/examples/laws-no-park.bend
All terms check.
exit=0
```

The file declares `Party` with `Runtime{}`, `Orchestrator{}` and `Unwoken{}`, a `State` whose two
non-terminal constructors wait on the runtime itself or on the orchestrator, a total `woken`, and
the law `waiter_is_woken` discharged for all three states. The obligation is discharged, not open:
both commands answer `All terms check.` with exit 0. The model carries the wait the operator
sanctioned in one constructor and no wait on an unwoken party in any constructor.

## Control A: a state that waits on a party Baton does not wake

Three lines added to a scratch copy: `Parked{turn: Nat}` to `State`,
`case Parked{+turn}: Unwoken{}` to `waiter_of`, and `case Parked{+turn}: {==}` to the law's
discharge.

```diff
23a24
>   Parked{turn: Nat}
29a31
>     case Parked{+turn}: Unwoken{}
47a50
>     case Parked{+turn}: {==}
```

```sh
$ bend <scratch>/laws-no-park-parked-unwoken.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- turn : Nat
Location: waiter_is_woken
49 |     case Complete{}: {==}
50>|     case Parked{+turn}: {==}
51 |
exit=1
```

The parked state cannot be discharged under the law: the law demands a woken party at that state
while its waiter is `Unwoken{}`, so the obligation is unsatisfiable rather than merely unproved.

## Control B: a state the waiter function does not cover

Two lines added to a scratch copy: `Parked{turn: Nat}` to `State`, and `case Parked{+turn}: {==}` to
the law's discharge; `waiter_of` is left unchanged.

```diff
23a24
>   Parked{turn: Nat}
47a49
>     case Parked{+turn}: {==}
```

```sh
$ bend <scratch>/laws-no-park-parked-unhandled.bend --check-only
Error:
- expected : cases for Parked
- observed : \{}
Location: waiter_of
26 | def waiter_of(s: State) -> Party:
27>|   match s:
28 |     case Working{+turn}: Runtime{}
exit=1
```

A state whose waiter the model does not name is refused, so a state cannot be added to this model
without either naming a party Baton wakes or failing to check.

## Scope

This is a law over a pure model. It constrains the rewrite's work-state type, its waiter function
and the runtime's wake rule. It does not prove anything about the JavaScript Baton in this
repository, whose park is removed by issue #572 rather than by this law, and it does not model the
wake itself or the orchestrator's decision: those are host effects, and root wake is #564.

## Verdict

The claim holds at pin `a4952426` with bend 2.0.25 on this host: the model's every state names a
waiter, the law is discharged while every waiter is one Baton wakes, a state parked on a party the
runtime does not wake makes the obligation unsatisfiable, and a state the waiter function does not
cover is refused at the pin.
