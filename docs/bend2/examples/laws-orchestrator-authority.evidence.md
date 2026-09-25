# laws-orchestrator-authority — evidence

CLAIM: in the model, an orchestrator holds recruit, guide, stop, review, integrate and resume over
every seat it leads, a seat can stop itself, and no act is granted over a seat the actor does not
lead.

Status: this example backs revision 12c (2026-09-25). The operator ruling behind it is 2026-09-21:
leads receive their swarm's whole scope and full authority, including landing their own work with
`swarm integrate`. Revision 10 states that a seat stops when it declares itself done or its
orchestrator stops it. On 2026-09-25 bend2-orchestrator14 reported that `swarm.stop` was not in
its seat grant (its actions were view, watch, recruit, guide, capture, check, notify,
notifications, integrate, update and the knowledge and seat read verbs), so it could not stop its
own parked seat and asked the root to do it. The entry is not approved.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

## The model under the law

```sh
$ bend docs/bend2/examples/laws-orchestrator-authority.bend --check-only
All terms check.
exit=0
$ bend docs/bend2/examples/laws-orchestrator-authority.bend
orchestrator-authority: an orchestrator holds every management act; law checked.
exit=0
```

`granted(rel, act)` is the runtime's grant for one act by an actor whose relation to the target
seat is `Leads{}`, `Itself{}` or `Other{}`. The law `orchestrator_holds_management` equates it
with `expected(rel, act)` over all eighteen cases.

## Control A: the grant observed on 2026-09-25

```diff
45a46,47
> # Control A: the grant observed on 2026-09-25. An orchestrator seat holds recruit, guide,
> # review, integrate and resume, and not stop; only the root stops a seat.
47c49,59
<   expected(rel, act)
---
>   match rel:
>     case Leads{}:
>       match act:
>         case Stop{}: False{}
>         case Recruit{}: True{}
>         case Guide{}: True{}
>         case Review{}: True{}
>         case Integrate{}: True{}
>         case Resume{}: True{}
>     case Itself{}: expected(Itself{}, act)
>     case Other{}: False{}
```

```sh
$ bend <scratch>/laws-orchestrator-authority-no-stop.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: orchestrator_holds_management
71 |         case Guide{}: {==}
72>|         case Stop{}: {==}
73 |         case Review{}: {==}
exit=1
```

Failing case: `Leads{}`, `Stop{}`. The orchestrator cannot stop a seat it leads.

## Control B: landing reserved to the root

```diff
45a46
> # Control B: landing reserved to the root. An orchestrator cannot integrate its own swarm's work.
47c48,58
<   expected(rel, act)
---
>   match rel:
>     case Leads{}:
>       match act:
>         case Integrate{}: False{}
>         case Stop{}: True{}
>         case Recruit{}: True{}
>         case Guide{}: True{}
>         case Review{}: True{}
>         case Resume{}: True{}
>     case Itself{}: expected(Itself{}, act)
>     case Other{}: False{}
```

```sh
$ bend <scratch>/laws-orchestrator-authority-no-integrate.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: orchestrator_holds_management
72 |         case Review{}: {==}
73>|         case Integrate{}: {==}
74 |         case Resume{}: {==}
exit=1
```

Failing case: `Leads{}`, `Integrate{}`. The orchestrator cannot land its own swarm's work, and
the root becomes the only path to the target branch.

## Scope

The model is the grant table only. Whether a seat's orchestrator is its parent seat or the root is
the `parentId` lineage question the wake-delivery example records; it is not modelled here.
