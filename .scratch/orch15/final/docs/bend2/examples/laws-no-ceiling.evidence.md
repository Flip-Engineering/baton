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
32a33
> # Control A: a size ceiling (for example maxTextBytes). Work above the ceiling is refused.
34c35,37
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
32a33,34
> # Control B: a deadline. Work that has waited past the deadline is refused (a queue timeout,
> # a caller deadline, the 90 s run-stop deadline of #583).
34c36,41
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
32a33,50
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
34c52
<   expected(authorized, available)
---
>   refuse_when(exceeds(size, physical_capacity()), expected(authorized, available))
71c89
<       match elapsed:
---
>       match s:
73,91c91,133
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

## Revision 12a adopted admission inputs and transition obligations

The adopted statement of 2026-09-25 adds to the scalar decision above two things: the
decision's inputs derive from the authenticated authority and the measured resource, not
from a magnitude or a clock; and the transitions are constrained as well as the decision.
The declarations above are unchanged. The extension declares `authorized_from`,
`available_from`, `admitted`, a work record (`Disposition`, `Request`, `Work`) and the
events `Tick`, `Completion`, `Cancellation`, `ExternalFailure` and `AttemptTimeout`, with
`named_disposition` and `step`. Six laws are discharged:

| Law | Proposition |
|---|---|
| `admission_inputs_derive_from_authority_and_measurement` | the admission input is the authenticated grant and the measured availability; size and elapsed time are not inputs |
| `a_work_event_sets_the_disposition_it_names` | a completion, a cancellation and an external failure name their own disposition; a tick and an attempt timeout name the current one |
| `a_tick_preserves_the_work_disposition`, `an_attempt_timeout_preserves_the_work_disposition` | a tick and an attempt timeout preserve the work disposition while telemetry and retry scheduling may change |
| `pending_work_keeps_its_request_across_a_tick`, `pending_work_keeps_its_request_across_an_attempt_timeout` | pending work keeps its owner, owed data and continuation across a tick and across an attempt timeout |

The model under the laws, re-run at this revision:

```sh
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-no-ceiling.bend --check-only
All terms check.
exit=0
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-no-ceiling.bend
no-ceiling: the decision ignores magnitude and clock; law checked.
exit=0
```

### Control 1: size becomes false authority

```diff
103,104c103,106
< def admitted(grant: Bool, measured: Bool, size: Nat, elapsed: Nat) -> Decision:
<   decide(size, elapsed, authorized_from(grant), available_from(measured))
---
> def admitted(grant: Bool, measured: Bool, size: Nat, elapsed: Nat) -> Decision:
>   match size:
>     case 0n: decide(0n, elapsed, grant, measured)
>     case 1n+s: decide(1n+s, elapsed, False{}, measured)
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/a12-size-becomes-false-authority.bend --check-only
Error:
- expected : admitted(grant, measured, size, elapsed)
- observed : expected(grant, measured)
Context:
- grant    : Bool
- measured : Bool
- size     : Nat
- elapsed  : Nat
Location: admission_inputs_derive_from_authority_and_measurement
115 | def admission_inputs_derive_from_authority_and_measurement(grant, measured, size, elapsed):
116>|   {==}
117 |
```

### Control 2: timer terminalizes pending work

```diff
138,139c138,139
<     case Tick{}: current
<     case Completion{}: Completed{}
---
>     case Tick{}: Failed{0n}
>     case Completion{}: Completed{}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/a12-timer-terminalizes-pending-work.bend --check-only
Error:
- expected : Failed{0n}
- observed : disposition
Context:
- disposition : Disposition
- telemetry   : Nat
- retry       : Nat
- request     : Request
Location: a_tick_preserves_the_work_disposition
177 |   match w:
178>|     case Work{+disposition, +telemetry, +retry, +request}: {==}
179 |
```

### Control 3: timeout terminalizes pending work

```diff
141,142c141,142
<     case ExternalFailure{+id}: Failed{id}
<     case AttemptTimeout{}: current
---
>     case ExternalFailure{+id}: Failed{id}
>     case AttemptTimeout{}: Failed{0n}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/a12-timeout-terminalizes-pending-work.bend --check-only
Error:
- expected : Failed{0n}
- observed : disposition
Context:
- disposition : Disposition
- telemetry   : Nat
- retry       : Nat
- request     : Request
Location: an_attempt_timeout_preserves_the_work_disposition
185 |   match w:
186>|     case Work{+disposition, +telemetry, +retry, +request}: {==}
187 |
```

### Control 4: transition drops the request

```diff
147c147,147
<       Work{named_disposition(e, disposition), telemetry, retry, request}
---
>       Work{named_disposition(e, disposition), telemetry, retry, Request{0n, 0n, []}}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/a12-transition-drops-the-request.bend --check-only
Error:
- expected : Request{0n, 0n, []}
- observed : request
Context:
- disposition : Disposition
- telemetry   : Nat
- retry       : Nat
- request     : Request
Location: pending_work_keeps_its_request_across_a_tick
193 |   match w:
194>|     case Work{+disposition, +telemetry, +retry, +request}: {==}
195 |
```

## Scope

The laws constrain one admission decision and one work record's transitions. The model has
no scheduler, queue, admission order or clock: a measured shortage makes work wait, and the
measurement itself is a host effect. The work record is a pure value, and the attempt is
modelled as the retry counter on that record. The runtime's own limits are
`goal-plan.mjs` `policy.limits`, the host-capacity gate, `drainPolicy` and the budget stop.
