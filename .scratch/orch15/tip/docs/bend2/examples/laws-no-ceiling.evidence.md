# laws-no-ceiling — evidence

CLAIM: in the model, the decision on requested work depends only on authority and on whether the
resource the work uses is available now. It is the same for every size and every elapsed time.
Work waits while an observed resource is short and is refused only for lack of authority.

Status: this example backs revision 12a (2026-09-25), a proposed revision of M-10 that removes its
exception for bounds derived from a physical resource. The operator rulings behind it are #258
(no budget hard stops), 2026-09-20 ("do not check the derivation of a max limit"), #541 (no caller
deadline, queue timeout or wait ceiling on an intent) and #583 (the 90 s run-stop deadline). The
entry is not approved.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

## The model under the law

```sh
$ bend docs/bend2/examples/laws-no-ceiling.bend --check-only
All terms check.
exit=0
$ bend docs/bend2/examples/laws-no-ceiling.bend
no-ceiling: the decision ignores magnitude and clock; law checked.
exit=0
```

`decide(size, elapsed, authorized, available)` stands for any runtime decision on requested work.
`size` is any magnitude of the work (bytes, nodes, items, tokens, spend), `elapsed` the time it
has waited or run. The law `decision_ignores_magnitude_and_clock` equates `decide` with
`expected(authorized, available)` for every size and elapsed time. The proof splits size and
elapsed at zero and one-or-more and every authority and resource case, so each control below
fails on a named case. Each control replaces only `decide` in a scratch copy.

## Control A: a size ceiling

```diff
28a29
> # Control A: a size ceiling (for example maxTextBytes). Work above the ceiling is refused.
30c31,33
<   expected(authorized, available)
---
>   match size:
>     case 0n: expected(authorized, available)
>     case 1n+s: Refused{}
```

```sh
$ bend <scratch>/laws-no-ceiling-size.bend --check-only
Error:
- expected : Refused{}
- observed : Admitted{}
Context:
- s : Nat
Location: decision_ignores_magnitude_and_clock
74 |               match available:
75>|                 case True{}: {==}
76 |                 case False{}: {==}
exit=1
```

Failing case: size 1 or more, elapsed 0, authorized, resource available. The work is refused
while the specification admits it. This is the `maxTextBytes: 4096` refusal of a 4244-byte
recruit brief (2026-09-20) and every entry of the goal/plan `policy.limits` schema.

## Control B: a deadline on waiting work

```diff
28a29,30
> # Control B: a deadline. Work that has waited past the deadline is refused (a queue timeout,
> # a caller deadline, the 90 s run-stop deadline of #583).
30c32,37
<   expected(authorized, available)
---
>   match elapsed:
>     case 0n: expected(authorized, available)
>     case 1n+e:
>       match available:
>         case True{}: expected(authorized, True{})
>         case False{}: Refused{}
```

```sh
$ bend <scratch>/laws-no-ceiling-deadline.bend --check-only
Error:
- expected : Refused{}
- observed : Waiting{}
Context:
- e : Nat
Location: decision_ignores_magnitude_and_clock
67 |                 case True{}: {==}
68>|                 case False{}: {==}
69 |             case False{}:
exit=1
```

Failing case: size 0, elapsed 1 or more, authorized, resource short. Work that should be waiting
is refused. This is the host-capacity queue timeout and the CLI request bound of #541, and the
run-stop deadline of #583.

## Control C: a ceiling derived from a physical resource

The bound is the host's capacity for the work (`physical_capacity()`), stated with its
derivation. Its proof splits size one level further so a size above capacity is reached.

```diff
28a29,46
> # Control C: a ceiling derived from a physical resource. The bound is the host's capacity for
> # the work, stated with its derivation; work larger than it is refused.
> def physical_capacity() -> Nat:
>   1n
> 
> def exceeds(size: Nat, bound: Nat) -> Bool:
>   match size:
>     case 0n: False{}
>     case 1n+s:
>       match bound:
>         case 0n: True{}
>         case 1n+b: exceeds(s, b)
> 
> def refuse_when(over: Bool, otherwise: Decision) -> Decision:
>   match over:
>     case True{}: Refused{}
>     case False{}: otherwise
> 
30c48
<   expected(authorized, available)
---
>   refuse_when(exceeds(size, physical_capacity()), expected(authorized, available))
67c85
<       match elapsed:
---
>       match s:
69,87c87,129
<           match authorized:
<             case True{}:
<               match available:
<                 case True{}: {==}
<                 case False{}: {==}
<             case False{}:
<               match available:
<                 case True{}: {==}
<                 case False{}: {==}
<         case 1n+e:
<           match authorized:
<             case True{}:
<               match available:
<                 case True{}: {==}
<                 case False{}: {==}
<             case False{}:
<               match available:
<                 case True{}: {==}
<                 case False{}: {==}
---
>           match elapsed:
>             case 0n:
>               match authorized:
>                 case True{}:
>                   match available:
>                     case True{}: {==}
>                     case False{}: {==}
>                 case False{}:
>                   match available:
>                     case True{}: {==}
>                     case False{}: {==}
>             case 1n+e:
>               match authorized:
>                 case True{}:
>                   match available:
>                     case True{}: {==}
>                     case False{}: {==}
>                 case False{}:
>                   match available:
>                     case True{}: {==}
>                     case False{}: {==}
>         case 1n+t:
>           match elapsed:
>             case 0n:
>               match authorized:
>                 case True{}:
>                   match available:
>                     case True{}: {==}
>                     case False{}: {==}
>                 case False{}:
>                   match available:
>                     case True{}: {==}
>                     case False{}: {==}
>             case 1n+e:
>               match authorized:
>                 case True{}:
>                   match available:
>                     case True{}: {==}
>                     case False{}: {==}
>                 case False{}:
>                   match available:
>                     case True{}: {==}
>                     case False{}: {==}
```

```sh
$ bend <scratch>/laws-no-ceiling-derived.bend --check-only
Error:
- expected : Refused{}
- observed : Admitted{}
Context:
- t : Nat
Location: decision_ignores_magnitude_and_clock
113 |                   match available:
114>|                     case True{}: {==}
115 |                     case False{}: {==}
exit=1
```

Failing case: size 2 or more (above a capacity of 1), elapsed 0, authorized, resource available.
Size 1 (within capacity) discharges. A stated physical derivation does not make the refusal
lawful: the law fails in the same way as for a bare constant. This is why revision 12a removes
M-10's derivation exception. A physical shortage observed now makes work wait (`available` is
`False{}`); it is not a pre-declared bound on the work.

## Scope

The model decides one work item. It does not model the queue, the order of admission, or a
caller's own cancellation, which M-10 keeps as separate semantics. It does not import Baton's
admission code (`goal-plan.mjs` `policy.limits`, the host-capacity gate, `drainPolicy`).
