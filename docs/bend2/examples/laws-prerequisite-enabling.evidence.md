# laws-prerequisite-enabling — evidence

CLAIM: a blocked continuation names the actual missing resource, authority, semantic input
or explicit operator/orchestrator decision; each prerequisite has an enabling effect;
administrative maintenance supplies none; no status, census, convergence or completion
declaration is a prerequisite; and a satisfied prerequisite makes progress without a
separate administrative acknowledgment.

Status: this example encodes the adopted G2 statement of 2026-09-25 from
[../reviews/astra-law-review-r11-r12.md](../reviews/astra-law-review-r11-r12.md). The entry
is proposed and is not part of the operative set. The review's `g2.bend` probe proves that
every returned prerequisite falls in a classification with `Bookkeeping` forbidden, and
records the boundary the refined wording closes: a classification that labels both
acquiring a socket and rewriting a census as `Resource` satisfies the classification law,
so a prerequisite needs its actual enabling effect.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

## The model under the laws

```sh
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-prerequisite-enabling.bend --check-only
All terms check.
exit=0
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-prerequisite-enabling.bend
prerequisite-enabling: each prerequisite has its own enabling effect; six laws checked.
exit=0
```

`required(request)` is the prerequisite the runtime demands, `missing(request)` the
request's actual missing need, and `supplies(event, need)` decides which event supplies a
need. `AnnotationRewritten` stands for administrative maintenance: filing a declaration,
rewriting a census. The supplying events are `ResourceFreed`, `GrantGranted`,
`InputSupplied` and `OrchestratorDecided`. Six laws are discharged:

- `every_prerequisite_has_an_enabling_effect`: each prerequisite the runtime returns has an
  event that supplies it, so a prerequisite with a resource or authority label and no
  enabling effect fails.
- `administrative_maintenance_enables_nothing`: rewriting an annotation supplies no
  prerequisite, for every need and every annotation.
- `the_prerequisite_is_the_actual_missing_need`: the runtime's prerequisite is the request's
  actual missing need, so a classification that labels a census rewrite `Resource` fails.
- `no_bookkeeping_prerequisite`: no returned prerequisite is a status, census, convergence
  or completion declaration.
- `an_orchestrator_decision_is_a_legitimate_prerequisite`: a woken orchestrator's decision
  is a legitimate prerequisite and not bookkeeping, so the boundary the review recorded is
  closed by the wording rather than by a label.
- `a_satisfied_prerequisite_makes_progress`: a satisfied prerequisite progresses without a
  separate administrative acknowledgment.

Each control below replaces one function in a scratch copy and keeps the laws unchanged.

### Control 1: stored census labelled a resource

```diff
60,61c60,61
< def required(request: Nat) -> Need:
<   missing(request)
---
> def required(request: Nat) -> Need:
>   Resource{0n}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/g2-stored-census-labelled-a-resource.bend --check-only
Error:
- expected : Resource{0n}
- observed : missing(request)
Context:
- request : Nat
Location: the_prerequisite_is_the_actual_missing_need
114 | def the_prerequisite_is_the_actual_missing_need(request):
115>|   {==}
116 |
```

### Control 2: bookkeeping prerequisite

```diff
60,61c60,61
< def required(request: Nat) -> Need:
<   missing(request)
---
> def required(request: Nat) -> Need:
>   Bookkeeping{0n}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/g2-bookkeeping-prerequisite.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: every_prerequisite_has_an_enabling_effect
 98 |   match request:
 99>|     case 0n: {==}
100 |     case 1n+r: {==}
```

### Control 3: maintenance satisfies a prerequisite

```diff
51c51,51
<     case AnnotationRewritten{_}: False{}
---
>     case AnnotationRewritten{_}: True{}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/g2-maintenance-satisfies-a-prerequisite.bend --check-only
Error:
- expected : True{}
- observed : False{}
Context:
- which : Nat
- need  : Need
Location: administrative_maintenance_enables_nothing
107 | def administrative_maintenance_enables_nothing(which, need):
108>|   {==}
109 |
```

### Control 4: orchestrator decision labelled bookkeeping

```diff
41,42c41,42
< def is_bookkeeping(need: Need) -> Bool:
<   Nat.is_eq(kind_of(need), 5n)
---
> def is_bookkeeping(need: Need) -> Bool:
>   Nat.is_eq(kind_of(need), 4n)
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/g2-orchestrator-decision-labelled-bookkeeping.bend --check-only
Error:
- expected : True{}
- observed : False{}
Context:
- party : Nat
Location: an_orchestrator_decision_is_a_legitimate_prerequisite
130 | def an_orchestrator_decision_is_a_legitimate_prerequisite(party):
131>|   {==}
132 |
```

## Scope

The prerequisite relation is pure. The runtime's admission, continuation, wake and delivery
transitions are `impl/src` transitions this model does not import. The progress law states
the ordering of a satisfied prerequisite and progress and assumes the enabling event
occurs; a temporal progress claim carries scheduler and host assumptions. The semantic
inputs and the operator/orchestrator decisions are model values.
