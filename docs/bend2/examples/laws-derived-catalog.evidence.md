# laws-derived-catalog — evidence

CLAIM: in the model, a route is served exactly when the harness observably provides it and the
operator has not excluded it, for every value of a hand-kept table.

Status: this example backs revision 12b (2026-09-25). The operator ruling behind it is 2026-09-24
("why do you hardcode things like this when they need to be derived from the relevant harness?"),
with #440 (omp routes derived from credential files) as the precedent and #549 (direct-harness
model catalogs) as the open instance. The entry is not approved.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

## The model under the law

```sh
$ bend docs/bend2/examples/laws-derived-catalog.bend --check-only
All terms check.
exit=0
$ bend docs/bend2/examples/laws-derived-catalog.bend
derived-catalog: served routes follow observation; law checked.
exit=0
```

`served(provided, listed, excluded)` decides one candidate route. `provided` is whether the
harness provides it now (model cache, credential file), `listed` whether a hand-kept table names
it, `excluded` whether the operator excluded it. The law `served_follows_observation` equates
`served` with `expected(provided, excluded)` for every value of `listed`, by splitting all
eight cases.

## Control A: a hand-kept table

```diff
34a35
> # Control A: a hand-kept table. A route is served when the table lists it.
36c37,39
<   expected(provided, excluded)
---
>   match excluded:
>     case True{}: False{}
>     case False{}: listed
```

```sh
$ bend <scratch>/laws-derived-catalog-table.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: served_follows_observation
53 |             case True{}: {==}
54>|             case False{}: {==}
55 |     case False{}:
exit=1
```

Failing case: provided, not listed, not excluded. The table hides a route the harness provides.
This is the 2026-09-24 codex catalog: 6 of 8 models the codex model cache listed were absent from
`DEFAULT_ROUTES` (#549).

## Control B: a hand-kept allowlist over observation

```diff
34a35,36
> # Control B: a hand-kept allowlist over observation. A route is served when the harness
> # provides it and the table also lists it.
36c38,40
<   expected(provided, excluded)
---
>   match listed:
>     case False{}: False{}
>     case True{}: expected(provided, excluded)
```

```sh
$ bend <scratch>/laws-derived-catalog-allowlist.bend --check-only
Error:
- expected : False{}
- observed : True{}
Location: served_follows_observation
54 |             case True{}: {==}
55>|             case False{}: {==}
56 |     case False{}:
exit=1
```

Failing case: provided, not listed, not excluded. Filtering observation through a table hides the
same route. An operator exclusion is a separate input: the law serves nothing the operator
excluded.

## Scope

The model decides one candidate. It does not model how the harness is observed (reading a model
cache or credential file), which is a host effect.

## Revision 12b adopted discovery identity, policy provenance and failed-discovery reporting

The adopted statement of 2026-09-25 adds to the per-candidate law above the route identity,
the completeness of discovery, the provenance of the operator policy and the reporting of a
failed observation. The declarations above are unchanged. The extension declares `Entry` (a
stable route id, the observation and the table flag), `Discovery` (`Observed` or `Failed`
with a reason), `Policy`, `Catalog` (whether an observation happened and the routes it
serves), `served_list`, `expected_list`, `discovered`, `policy_of`, `exclusion_from` and
`report`. Five laws are discharged:

| Law | Proposition |
|---|---|
| `served_matches_expected` | the pointwise rule: the served decision is the specification's, for every table value |
| `the_served_list_is_the_expected_list` | the served route list equals the expected list over the complete observed catalog |
| `discovery_is_the_complete_observation` | the runtime's discovery is the observation, so a stored table cannot restrict it |
| `the_exclusion_is_the_authenticated_policy` | the exclusion input is the authenticated operator policy, not a stored record |
| `a_failed_discovery_is_reported_not_an_empty_catalog` | a failed observation is reported as unobserved and is not asserted to be an empty catalog |

The model under the laws, re-run at this revision:

```sh
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-derived-catalog.bend --check-only
All terms check.
exit=0
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-derived-catalog.bend
derived-catalog: served routes follow observation; law checked.
exit=0
```

### Control 1: stored table restricts discovery

```diff
106,107c106,114
< def discovered(entries: +List<Entry>) -> +List<Entry>:
<   entries
---
> def discovered(entries: +List<Entry>) -> +List<Entry>:
>   match entries:
>     case []: []
>     case h <> t:
>       match h:
>         case Entry{+id, +provided, +listed, +excluded}:
>           match listed:
>             case True{}: Entry{id, provided, listed, excluded} <> discovered(t)
>             case False{}: discovered(t)
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/b12-stored-table-restricts-discovery.bend --check-only
Error:
- expected : discovered(entries)
- observed : entries
Context:
- entries : List<&2, Entry>
Location: discovery_is_the_complete_observation
160 | def discovery_is_the_complete_observation(entries):
161>|   {==}
162 |
```

### Control 2: stored record supplies the exclusion

```diff
113,114c113,116
< def exclusion_from(record: Nat, policy: Policy) -> Bool:
<   policy_of(policy)
---
> def exclusion_from(record: Nat, policy: Policy) -> Bool:
>   match record:
>     case 0n: policy_of(policy)
>     case 1n+p: False{}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/b12-stored-record-supplies-the-exclusion.bend --check-only
Error:
- expected : exclusion_from(record, policy)
- observed : policy_of(policy)
Context:
- record : Nat
- policy : Policy
Location: the_exclusion_is_the_authenticated_policy
163 | def the_exclusion_is_the_authenticated_policy(record, policy):
164>|   {==}
165 |
```

### Control 3: served list ignores observation

```diff
97c97,97
<         case Entry{+id, +provided, +listed, +excluded}: served(provided, listed, excluded) <> served_list(t)
---
>         case Entry{+id, +provided, +listed, +excluded}: listed <> served_list(t)
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/b12-served-list-ignores-observation.bend --check-only
Error:
- expected : {expected(provided, excluded) <> expected_list(t) == listed <> served_list(t) : List<&2, Bool>}
- observed : {expected(provided, excluded) <> expected_list(t) == expected(provided, excluded) <> served_list(t) : List<&2, Bool>}
Context:
- id       : Nat
- provided : Bool
- listed   : Bool
- excluded : Bool
- t        : List<&2, Entry>
Location: the_served_list_is_the_expected_list
144 |         case Entry{+id, +provided, +listed, +excluded}:
145>|           %served_matches_expected(provided, listed, excluded) : {expected(provided, excluded) <> expected_list(t) == _ <> served_list(t) : +List<Bool>}
146 |           %the_served_list_is_the_expected_list(t) : {expected(provided, excluded) <> expected_list(t) == expected(provided, excluded) <> _ : +List<Bool>}
```

### Control 4: failed discovery is an empty catalog

```diff
119c119,119
<     case Failed{_}: Catalog{False{}, []}
---
>     case Failed{_}: Catalog{True{}, []}
```

```sh
$ BEND_NO_TELEMETRY=1 $BEND .scratch/controls/b12-failed-discovery-is-an-empty-catalog.bend --check-only
Error:
- expected : Catalog{True{}, []}
- observed : Catalog{False{}, []}
Context:
- reason : Nat
Location: a_failed_discovery_is_reported_not_an_empty_catalog
168 | def a_failed_discovery_is_reported_not_an_empty_catalog(reason):
169>|   {==}
170 |
```

## Scope

The laws constrain the served set, the discovery outcome and the policy input. Observing
the harness and the credential file is a host effect: `Entry` values are supplied by the
observer, and catalog authenticity remains a stated assumption. A route's adapter support,
its credential scope, and the distinction between an advertised route and a temporary
scheduling eligibility are not modelled.
