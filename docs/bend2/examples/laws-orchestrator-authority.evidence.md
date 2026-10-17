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
51a52,53
> # Control A: the grant observed on 2026-09-25. An orchestrator seat holds recruit, guide,
> # review, integrate and resume, and not stop; only the root stops a seat.
53c55,65
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
51a52
> # Control B: landing reserved to the root. An orchestrator cannot integrate its own swarm's work.
53c54,64
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

## Revision 12c adopted scope derivation and dispatch boundary

The adopted statement of 2026-09-25 derives the actor's scope and relation from
authenticated current authority and enforces them at dispatch and effect. The declarations
above are unchanged. The extension declares `Scope` (`Delegated`, `Own`, `Bare`), `Grant` (a
scope and whether the grant is current), `relation_of`, `dispatch(grant, claimed, act)`,
`effect(grant, act)` and `allow`. Six laws are discharged:

| Law | Proposition |
|---|---|
| `a_stale_grant_confers_no_authority` | a revoked or expired grant derives no relation |
| `the_caller_cannot_supply_the_relation` | the caller's claimed relation does not change the dispatch decision |
| `the_effect_rechecks_the_current_authority` | the effect-time check uses the relation dispatch used |
| `no_second_permission_after_a_lawful_grant` | no additional check denies an act its lawful grant admitted |
| `a_current_delegation_holds_every_management_act` | a current delegation holds every management act over its delegated scope |
| `a_seat_stops_itself_under_its_own_scope` | a seat stops itself under its own scope |

The model under the laws, re-run at this revision:

```sh
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-orchestrator-authority.bend --check-only
All terms check.
exit=0
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-orchestrator-authority.bend
orchestrator-authority: an orchestrator holds every management act; law checked.
exit=0
```

### Control 1: caller supplies the relation

```diff
116,117c116,117
< def dispatch(grant: Grant, claimed: Relation, act: Act) -> Bool:
<   granted(relation_of(grant), act)
---
> def dispatch(grant: Grant, claimed: Relation, act: Act) -> Bool:
>   granted(claimed, act)
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/c12-caller-supplies-the-relation.bend --check-only
Error:
- expected : expected(claimed, act)
- observed : False{}
Context:
- grant   : Grant
- claimed : Relation
- act     : Act
Location: the_caller_cannot_supply_the_relation
144 | def the_caller_cannot_supply_the_relation(grant, claimed, act):
145>|   {==}
146 |
```

### Control 2: second check denies a lawful grant

```diff
124,125c124,125
< def allow(authorized: Bool, additional_permission: Bool) -> Bool:
<   authorized
---
> def allow(authorized: Bool, additional_permission: Bool) -> Bool:
>   additional_permission
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/c12-second-check-denies-a-lawful-grant.bend --check-only
Error:
- expected : additional
- observed : authorized
Context:
- authorized : Bool
- additional : Bool
Location: no_second_permission_after_a_lawful_grant
160 | def no_second_permission_after_a_lawful_grant(authorized, additional):
161>|   {==}
162 |
```

### Control 3: stale grant confers authority

```diff
107c107,107
<     case Grant{Delegated{}, False{}}: Other{}
---
>     case Grant{Delegated{}, False{}}: Leads{}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/c12-stale-grant-confers-authority.bend --check-only
Error:
- expected : True{}
- observed : False{}
Context:
- act : Act
Location: a_stale_grant_confers_no_authority
133 |   match scope:
134>|     case Delegated{}: {==}
135 |     case Own{}: {==}
```

### Control 4: effect skips the current authority

```diff
120,121c120,121
< def effect(grant: Grant, act: Act) -> Bool:
<   granted(relation_of(grant), act)
---
> def effect(grant: Grant, act: Act) -> Bool:
>   True{}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/c12-effect-skips-the-current-authority.bend --check-only
Error:
- expected : True{}
- observed : expected(relation_of(grant), act)
Context:
- grant : Grant
- act   : Act
Location: the_effect_rechecks_the_current_authority
152 | def the_effect_rechecks_the_current_authority(grant, act):
153>|   {==}
154 |
```

## Scope

The laws constrain the derived relation, the dispatch check and the effect check. The
authenticated delegation is a model value: the runtime that issues and revokes it, the
resource instance, generation and time-of-effect checks M-8 requires, and the full
management-action universe are not modelled. Whether a seat's orchestrator is its parent
seat or the root remains the `parentId` lineage question.
