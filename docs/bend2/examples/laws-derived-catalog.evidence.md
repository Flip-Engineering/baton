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
29a30
> # Control A: a hand-kept table. A route is served when the table lists it.
31c32,34
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
29a30,31
> # Control B: a hand-kept allowlist over observation. A route is served when the harness
> # provides it and the table also lists it.
31c33,35
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
