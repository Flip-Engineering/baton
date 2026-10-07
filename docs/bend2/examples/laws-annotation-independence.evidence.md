# laws-annotation-independence — evidence

CLAIM: for the same validated semantic request, authenticated authority, observed resources
and external events, changing administrative annotations about work cannot change the
runtime's derived plan, and the plan derives those inputs from the specified sources.

Status: this example encodes the adopted G1 statement of 2026-09-25 from
[../reviews/astra-law-review-r11-r12.md](../reviews/astra-law-review-r11-r12.md). The entry
is proposed and is not part of the operative set. The review's `g1.bend` probe proves record
independence for six work-act constructors and records two limits: an always-refusing
runtime discharges it, and a caller that computes the observed value from the record
satisfies the same law. This model answers both limits.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

## The model under the laws

```sh
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-annotation-independence.bend --check-only
All terms check.
exit=0
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-annotation-independence.bend
annotation-independence: the plan ignores every annotation; four laws checked.
exit=0
```

`derive(act, observed, annotation)` is the plan the runtime derives for one act from the
validated request, the authenticated authority and the observed resources. `Annotation`
holds expected-failure allowances, convergence declarations, an incidental census and a
status value, none of which has a semantic effect. `annotation_allows` is the runtime's
reader of an administrative allowance and returns a constant, so no annotation reaches the
plan. `observed_from` is the runtime's reader of the observation and returns the
observation itself. Four laws are discharged:

- `annotations_do_not_change_the_plan`: for every act, observation and annotation, the plan
  equals the plan for the zero annotation. The annotation is a parameter the law quantifies
  over, so a plan that reads one makes the law false at a named case.
- `an_authorized_available_request_is_admitted`: the positive behavior law the review
  requires. An authorized request whose resource is available is admitted, so the
  always-refusing runtime the review recorded fails this law.
- `the_observation_is_not_derived_from_the_annotation`: the observation the runtime reads is
  the specified observation, so the record-derived input the review recorded fails.
- `the_decision_reads_the_specified_source`: the composed decision equals the decision over
  the specified observation, which is the review's composition requirement.

Each control below replaces one function in a scratch copy and keeps the laws unchanged.

### Control 1: runtime reads the annotation

```diff
37,38c37,39
< def annotation_allows(annotation: Annotation) -> Bool:
<   True{}
---
> def annotation_allows(annotation: Annotation) -> Bool:
>   match annotation:
>     case Annotation{+expected_failures, +converged, +census, +status}: Nat.is_eq(census, 0n)
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/g1-runtime-reads-the-annotation.bend --check-only
Error:
- expected : Plan{[request_of(observed)], Bool.and(authorized_of(observed), annotation_allows(annotation)), Bool.not(authorized_of(observed)), authorized_of(observed), needs_of(request_of(observed)), available_of(observed)}
- observed : Plan{[request_of(observed)], Bool.and(authorized_of(observed), True{}), Bool.not(authorized_of(observed)), authorized_of(observed), needs_of(request_of(observed)), available_of(observed)}
Context:
- observed   : Observed
- annotation : Annotation
Location: annotations_do_not_change_the_plan
87 |   match act:
88>|     case Landing{}: {==}
89 |     case Admission{}: {==}
```

### Control 2: always refusing runtime

```diff
61c61,61
<     case Landing{}: Plan{[request_of(observed)], Bool.and(authorized_of(observed), annotation_allows(annotation)), Bool.not(authorized_of(observed)), authorized_of(observed), needs_of(request_of(observed)), available_of(observed)}
---
>     case Landing{}: Plan{[], False{}, True{}, False{}, [], False{}}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/g1-always-refusing-runtime.bend --check-only
Error:
- expected : False{}
- observed : True{}
Context:
- annotation : Annotation
Location: an_authorized_available_request_is_admitted
101 |   match act:
102>|     case Landing{}: {==}
103 |     case Admission{}: {==}
```

### Control 3: observation derived from the annotation

```diff
72,73c72,74
< def observed_from(annotation: Annotation, observed: Observed) -> Observed:
<   observed
---
> def observed_from(annotation: Annotation, observed: Observed) -> Observed:
>   match annotation:
>     case Annotation{+expected_failures, +converged, +census, +status}: Observed{0n, Nat.is_eq(census, 0n), False{}}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/g1-observation-derived-from-the-annotation.bend --check-only
Error:
- expected : Plan{[request_of(observed)], Bool.and(authorized_of(observed), True{}), Bool.not(authorized_of(observed)), authorized_of(observed), needs_of(request_of(observed)), available_of(observed)}
- observed : Plan{[0n], True{}, False{}, True{}, [], False{}}
Context:
- observed   : Observed
- annotation : Annotation
Location: annotations_do_not_change_the_plan
87 |   match act:
88>|     case Landing{}: {==}
89 |     case Admission{}: {==}
```

## Scope

The plan is a pure value. The runtime's own source selection, dispatch, admission, refusal,
management permission and continuation are `impl/src` transitions this model does not
import; the model covers their composition shape. The temporal progress claim of the
adopted G2 statement carries scheduler and host assumptions this model does not state. The
classification of which records are administrative annotations belongs to the semantic
contract, and this model declares its producers.
