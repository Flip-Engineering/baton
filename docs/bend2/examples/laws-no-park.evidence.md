# laws-no-park — evidence

CLAIM: the model's exit function is total over its state type, and the law `runtime_takes_every_exit`
is discharged exactly while every state returns the runtime's own exit. Adding a state whose exit is
an act by another party makes the obligation unsatisfiable, and adding a state the exit function does
not cover is refused at the pin.

Status: this example backs a proposed addition to the law set (revision 10, 2026-09-23). It is not
part of the approved 16, and its law is not approved.

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

The file declares `Exit` with two constructors, `Runtime{}` and `External{}`, a `State` whose two
constructors both leave by the runtime's own exit, the total `exit_of`, and the law
`runtime_takes_every_exit` discharged for both cases. The obligation is discharged, not open: the run
and the check both answer `All terms check.` with exit 0.

## Control A: a state whose exit is another party's

Three lines added to a scratch copy: `Parked{}` to `State`, `case Parked{}: External{}` to
`exit_of`, and `case Parked{}: {==}` to the law's discharge.

```sh
$ bend <scratch>/laws-no-park-parked-external.bend --check-only
Error:
- expected : External{}
- observed : Runtime{}
Location: runtime_takes_every_exit
38 |     case Complete{}: {==}
39>|     case Parked{}: {==}
40 |
exit=1
```

The parked state cannot be discharged under the law: the goal at that case demands the declared
`External{}` exit while the law requires the runtime's own, so the obligation is unsatisfiable rather
than merely unproved.

## Control B: a state the exit function does not cover

Two lines added to a scratch copy: `Parked{}` to `State`, and `case Parked{}: {==}` to the law's
discharge; `exit_of` is left unchanged.

```sh
$ bend <scratch>/laws-no-park-parked-unhandled.bend --check-only
Error:
- expected : cases for Parked
- observed : \{}
Location: exit_of
24 | def exit_of(s: State) -> Exit:
25>|   match s:
26 |     case Working{+turn}: Runtime{}
exit=1
```

A state the runtime's own function does not leave is refused, so a state cannot be added to this
model without either giving it a runtime exit or failing to check.

## Scope

This is a law over a pure model. It constrains the rewrite's work-state type and its turn loop; it
does not prove anything about the JavaScript Baton in this repository, whose park is removed by issue
#572 rather than by this law. The two controls are the evidence that the law has content: without
them the same file would check if the law were vacuous.

## Verdict

The claim holds at pin `a4952426` with bend 2.0.25 on this host: the exit function is total over the
state type, the law is discharged while every state leaves by the runtime's own exit, a state with an
external exit makes the obligation unsatisfiable, and a state the runtime's function does not cover is
refused at the pin.
