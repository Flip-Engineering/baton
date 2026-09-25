# laws-derived-catalog — evidence

CLAIM: The model is the adopted revision 12b. Discovery derives its route set from the observed
harness and credential state. The served route set equals the discovered set less the routes the
authenticated operator excluded. A programmer-maintained availability table cannot add a route,
restrict discovery, alter an observation or suppress serving. A missing or failed discovery is
reported with its cause and is never asserted to be an empty catalog. `../laws.bend` states the four
obligations and `laws-proof.bend` discharges them.

Status: Proposed addition (revision 12b, re-encoded 2026-09-25) from the operator ruling of
2026-09-24 and from the adopted statement in `../reviews/astra-law-review-r11-r12.md`. #440 is a
test-fixture precedent (it derives a credential fixture from the routes a test declares); #549 is
the open instance. The entry is not part of the approved set.

## Environment

| | |
|---|---|
| Host | macOS 27.0.0, arm64 (Apple M4) |
| Toolchain | bend 2.0.25 at `/Users/wahargis/Development/Experiments/baton-resident/.baton/wt/ws-bb964de517ed7cdcfb2ab5bf2ed09021/node_modules/.bend/bin/bend`, sha256 `3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c` |
| Reference pin | `../reference/README.md`, `bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868` |

This worktree carries no `node_modules/.bend`; the binary is the installed 2.0.25 toolchain, and
its digest is the one the repo's earlier law evidence records. Every invocation sets
`BEND_NO_TELEMETRY=1`.

```sh
$ BEND=/Users/wahargis/Development/Experiments/baton-resident/.baton/wt/ws-bb964de517ed7cdcfb2ab5bf2ed09021/node_modules/.bend/bin/bend
$ BEND_NO_TELEMETRY=1 "$BEND" version
bend 2.0.25
exit=0
```

## The model under the law

```sh
$ $BEND docs/bend2/examples/laws-derived-catalog.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/examples/laws-derived-catalog.bend
derived-catalog: the served set follows discovery and operator policy; the laws are checked in laws-proof.bend.
exit=0
```

`docs/bend2/examples/laws-derived-catalog.bend` sha256 `6a2794c2f63223d0a6b43fc6c4901c8b41891a9b5d5e47a2768523a29e7d50e1`.

## The laws

[../laws.bend](../laws.bend) states these obligations over the model and
[laws-proof.bend](laws-proof.bend) discharges every one.

| Law | What it fixes |
|---|---|
| `r12b_discovery_reports_the_observed_routes` | discovery derives its routes from the observation |
| `r12b_served_set_equals_discovery_less_operator_policy` | serving is discovery less operator policy |
| `r12b_availability_table_does_not_change_serving` | the table cannot change serving |
| `r12b_missing_discovery_is_reported_not_asserted_empty` | a failed discovery is reported |

```sh
$ $BEND docs/bend2/laws.bend --check-only
Error: 53 TODOs found.
The code is incomplete, and not a valid proof yet.
exit=1
$ $BEND docs/bend2/examples/laws-proof.bend --check-only
All terms check.
exit=0
$ $BEND docs/bend2/examples/laws-proof.bend
M-5 reviews, M-10 worker admission, M-14 refusal rows, M-18 landing decision and the adopted revision 11 and revision 12 obligations: model proofs checked.
exit=0
```

`laws.bend` reports 53 open obligations: the ten the approved set carries and the
forty-three the operator adopted on 2026-09-25. The proof file discharges all 53, so an
open obligation is a claim whose proof lives in `laws-proof.bend`, and the check of
`laws.bend` on its own is not the gate. `laws.bend` sha256
`b11b991f897f2b20f7f16ee73c9d61d35700dfe09ae6ec26b00db260691485fe`; `laws-proof.bend` sha256 `88a13e217a27fa057d1f9e29def34f8928c25b66b7b84115b968d791e51b2949`.

## Controls

Each control replaces part of the model in a scratch copy and re-checks the laws, so a
scratch root.

### Control A: r12b table replaces observation

Replays `b-exclusion.bend` at the pin.

```diff
74c74
<   Discovered{provided_of(o)}
---
>   Discovered{listed_of(o)}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-derived-catalog.Discovered{../examples/laws-derived-catalog.listed_of(observation)}
- observed : ../examples/laws-derived-catalog.Discovered{../examples/laws-derived-catalog.provided_of(observation)}
Context:
- observation : ../examples/laws-derived-catalog.Observation
Location: ../laws.r12b_discovery_reports_the_observed_routes
238 | def Laws.r12b_discovery_reports_the_observed_routes(observation):
239>|   {==}
240 |
exit=1
```

### Control B: r12b observed route omitted

Replays `b-discovery.bend` at the pin.

```diff
72a73,77
> def without_head(xs: +List<Nat>) -> +List<Nat>:
>   match xs:
>     case Nil{}: Nil{}
>     case h <> t: t
> 
74c79
<   Discovered{provided_of(o)}
---
>   Discovered{without_head(provided_of(o))}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-derived-catalog.Discovered{../examples/laws-derived-catalog.without_head(../examples/laws-derived-catalog.provided_of(observation))}
- observed : ../examples/laws-derived-catalog.Discovered{../examples/laws-derived-catalog.provided_of(observation)}
Context:
- observation : ../examples/laws-derived-catalog.Observation
Location: ../laws.r12b_discovery_reports_the_observed_routes
238 | def Laws.r12b_discovery_reports_the_observed_routes(observation):
239>|   {==}
240 |
exit=1
```

### Control C: r12b invented exclusion

Replays `b-exclusion.bend` at the pin.

```diff
79c79
<     case Discovered{+routes}: Served{remove(routes, excluded_of(p))}
---
>     case Discovered{+routes}: Served{remove(routes, [0n])}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-derived-catalog.Served{../examples/laws-derived-catalog.remove(../examples/laws-derived-catalog.provided_of(observation), [0n])}
- observed : ../examples/laws-derived-catalog.Served{../examples/laws-derived-catalog.remove(../examples/laws-derived-catalog.provided_of(observation), ../examples/laws-derived-catalog.excluded_of(policy))}
Context:
- observation : ../examples/laws-derived-catalog.Observation
- policy      : ../examples/laws-derived-catalog.Policy
Location: ../laws.r12b_served_set_equals_discovery_less_operator_policy
241 | def Laws.r12b_served_set_equals_discovery_less_operator_policy(observation, policy):
242>|   {==}
243 |
exit=1
```

### Control D: r12b missing discovery asserted empty

Replays `b-discovery.bend` at the pin.

```diff
80c80
<     case Missing{+cause}: Report{cause}
---
>     case Missing{+cause}: Served{[]}
```

```sh
$ cd <scratch> && $BEND docs/bend2/examples/laws-proof.bend --check-only
Error:
- expected : ../examples/laws-derived-catalog.Served{[]}
- observed : ../examples/laws-derived-catalog.Report{cause}
Context:
- cause  : Nat
- policy : ../examples/laws-derived-catalog.Policy
Location: ../laws.r12b_missing_discovery_is_reported_not_asserted_empty
248 | def Laws.r12b_missing_discovery_is_reported_not_asserted_empty(cause, policy):
249>|   {==}
250 |
exit=1
```

## The bypass probes at the pin

The two revision 12b probes import this model and now fail at the pin. `b-discovery` supplies a
stored candidate list as the discovered set; over the re-encoded model the discovered set is the
observation, so the stored list has nowhere to enter. `b-exclusion` supplies the operator-exclusion
argument from a stored value; over the re-encoded model the exclusion is read from the authenticated
policy, so the stored value has nowhere to enter.

The review directory is not on this lane's branch. Its files are the ones commit
`692a5fb977f58d77c888ed7c1d641e40a66ac9fd` records, and each was run from a byte-identical copy placed at the same relative
depth under `.scratch/mirror/docs/bend2/reviews/`, beside a copy of `docs/bend2/`, so the probe's
`../../examples/...` imports resolve against the re-encoded models. `.scratch/` is gitignored and
carries no committed content. The copy method, with the digest check that establishes
byte-equality, is recorded in [laws-check.evidence.md](laws-check.evidence.md). Every command
below runs from the mirror root, so `$BEND docs/bend2/reviews/astra-r11-r12-probes/<probe>.bend
--check-only` is the command a checkout that carries the review directory runs.


| Probe | sha256 | Exit |
|---|---|---|
| `b-discovery.bend` | `7a86a6d74a8244d6db3b4ef107512138b001cc6c9aa51e22008f843dd4be935a` | 1 |
| `b-exclusion.bend` | `09369d9c532fc58f9a9a6b0213ec302504ba44ea2f0a85720b4e10ec92902078` | 1 |

```sh
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/b-discovery.bend --check-only
Error:
- expected : a defined name
- observed : M.served
Context:
- h : Nat
- t : List<&1, Nat>
Location: catalog
12 |     case []: []
13>|     case h <> t: include(M.served(True{}, False{}, False{}), h, catalog(t))
14 |
exit=1
$ $BEND docs/bend2/reviews/astra-r11-r12-probes/b-exclusion.bend --check-only
Error:
- expected : a defined name
- observed : M.served
Location: main
7 | def main() -> List<Bool>:
8>|   [M.served(True{}, False{}, False{}),
9 |    M.served(True{}, False{}, M.not_bool(stored_allowlist()))]
exit=1
```
