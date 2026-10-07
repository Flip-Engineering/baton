# Provider and model discovery (#683)

State at this record: `models` and `provider-probe` are implemented in
`bend2/src/coordinator/{models,probes,continuation,discovery-laws}.bend`, the
adapter reads live in `bend2/src/harness/{codex,omp,muse}-player.bend`, and the
harness laws in `bend2/src/harness/laws.bend` pin them. This file records the
surface, the observed provider boundary, and what the implementation does not
know.

## The two operations

```
models [SESSION] [--pretty]                    read; starts no process
provider-probe HARNESS HARNESS_CMD [MODEL]     control; runs the adapter's read
```

They are separate because the read must be answerable with no probe ever run and
must be law-pinnable as starting no process, while the probe is a new host effect
that takes the write lock. `models` selects stored rows and reads the series
registry; it runs no `BEGIN IMMEDIATE` and calls no `Store.apply` of its own. The
coordinator database is created by the coordinator's own commands, so `models`
expects an initialized database.

## Adapter reads, observed 2026-10-06 on the operator laptop

| Harness | Read | Output |
| --- | --- | --- |
| `codex` 0.160.1 | `codex debug models` | JSON, `$.models[].slug`; 11 slugs |
| `codex` 0.160.1 | `codex doctor --json` | redacted report, `$.checks."auth.credentials"` |
| `omp` 17.4.0 | `omp models --json` | JSON, `$.models[].selector`; 92 models |
| `omp` 17.4.0 | `omp usage --json` | JSON, `$.capacity` per provider, `$.reports[].limits`, `$.disabledCredentials` |
| `muse` | `muse model-profile show MODEL` | text profile for one named model |
| `claude-code` 2.1.287 | none | the adapter exposes no metadata read |

The Codex access report states the stored credential mode and carries no quota
window. The OMP catalog carries provider, id, selector, name, context window and
thinking levels, and no quota, account or authentication field. Muse publishes no
catalog listing, so its read is model-scoped and its `metadata.absent` names
`catalog`. `claude-code` is recorded `refused`, which is an explicit observed
state rather than an absent row.

An identifier is stored as the provider stated it: a catalog read groups the
identifiers the catalog states by the `provider` field that catalog carries, and a
model-scoped read lists only the identifier that read echoed in its own output. The
caller's MODEL is recorded beside it as `requestedModel`; where the output echoes no
identifier, `provenance` is `caller-stated`, `models` is null, and `absent` names
`model-identifier`, so a caller's string is never presented as provider output.
`provenance` is `provider-catalog`, `provider-echoed` or `caller-stated`. A
candidate matches only its own harness's reported identifier, by exact string
equality, so a bare id is not matched against another provider's selector;
`proposal.basis` names the admission (`listed-exact-selector` or
`configured-registry-alias`).

## Storage

`provider_probes` is append-only: `id`, `harness`, `executable`, `outcome`
(`ok`/`refused`/`error`), `cause`, `reported` (the provider's own text, verbatim),
`metadata`, `capacity`, `at` from `datetime('now')`. The read takes the newest row
per harness by `rowid`. The probe's identifier derives from the table's own
`rowid`, so no caller-supplied identity is needed and no update or delete occurs.

`metadata` carries the parsed catalog (`models`, `absent`), the access report
(`access`), and the parsed capacity components with nulls preserved. A parsed
report that states no credential check answers `access.state = "unknown"` with the
component named; one that does not parse answers `"error"` with the cause.

## Capacity

Capacity is a value the provider stated. A probe that stated no limit, usage,
remaining or reset time leaves `capacity.state = "unknown"` and names all four in
`absent`. `known` and `expired` require at least one stated component; `expired`
applies the provider's own reset instant at read time. No provider read on this
host states a window today, so capacity is `unknown` for every harness while the
account facts a provider does state remain recorded. A generic nonzero provider
exit is an `error` row with the exit status and the provider's text, and no
capacity or quota conclusion follows from it.

## Continuation

Candidates are the routes recorded in `sessions` and the routes observed from
provider events, restricted to the four turn adapters. A candidate is `proposed`
when the latest probe of its harness succeeded and its model is either a
registry-mapped alias or an identifier that read listed. Tiers order the same
harness with a different model, then the same route, then another harness, then
the rest; ties break by harness, model and effort. A registry that maps no key for
a model does not refuse that model, so `configure`'s registry resolution is not
the discovery precedence.

When no candidate is established as usable, `continuation.refusal` is
`continuation-capacity-unknown` and lists the would-be candidates with their fixed
conditions. `continuation.seat` reports the seat's recorded route, stop state and
owed input count, so the same seat's pending work stays named across the
selection. A recorded quota failure stays history: the candidate set never
consults past failures.

`continuation.proposal` is the first usable candidate in tier order. The seat's own
route stays in the list with no unavailability claim, since a harness read that
answers and lists the model is a current observation; a caller failing over from a
named route takes the first proposed candidate that differs from it. The read takes
no failure reason, so the choice among proposed routes belongs to the caller.

## Laws

Nine laws in `bend2/src/coordinator/discovery-laws.bend` and four in
`bend2/src/harness/laws.bend`, each stated over the function that implements it and
each with a mutation control in `bend2/scripts/laws-check.mjs`:

- `m12b_served_follows_observation`, `m12b_failed_discovery_is_not_an_empty_catalog`
- `m14_a_models_answer_records_provenance_per_field`
- `m1_a_models_answer_reads_the_stored_rows`
- `m8_a_models_read_starts_no_process` (in `main.bend`, over the entry dispatch)
- `m8_a_probe_records_only_provider_reported_facts`
- `m8_a_continuation_proposes_only_admitted_routes`
- `m12_a_continuation_asserts_no_unobserved_capacity`
- `m5_a_probe_leaves_the_inbox_in_sequence`
- `m8_codex_query_reads_its_own_catalog`, `m8_codex_access_read_is_the_redacted_report`,
  `m8_omp_query_reads_its_own_catalog`, `m8_muse_query_reads_one_named_model`
- `m8_a_model_scoped_read_lists_only_the_echoed_identifier` (finding F1)
- `m12_a_continuation_refusal_names_a_harness` (finding F2)
- `m8_a_catalog_metadata_groups_the_provider_scopes` (#694)

## Provider scope and freshness (#694)

A harness may serve several providers, and two routes can share a model name. The
`models` document keeps them apart:

- `providers[].metadata.providers` groups the reported identifiers by the
  `provider` field the catalog itself states, as
  `{"provider": <as reported>, "models": [...]}`. The omp catalog states
  `deepseek`, `google-antigravity`, `kimi-code`, `opencode-go` and `zai`; the codex
  catalog states none, so its single scope carries an empty provider.
- `providers[].capacity.scope` names the harness whose observation the capacity row
  came from, so `opencode-go/gpt-6-luna` under the omp scope is a different row from
  `gpt-6-luna` under the codex scope and a reader does not assume they share limits.
- `providers[].probe.at` and `providers[].probe.ageSeconds` date the observation;
  `capacity.state` is `known` only for a component the provider stated, so a
  successful read establishes observed usability at that time and never a remaining
  amount.

The OMP adapter answers provider usage limits for every authenticated account
through `omp usage --json`, observed 2026-10-07: `capacity` holds one entry per
provider with `window`, `durationMs`, `accounts`, `usedAccounts` and
`remainingAccounts`; `reports[].limits[]` holds each labelled limit with its
`window.durationMs`, `window.resetsAt` and `amount` (`used`, `limit`, `remaining`,
`unit`, `usedFraction`, `remainingFraction`) and `status`; `disabledCredentials`
holds the provider's own credential refusals with their cause. The probe records
that report in `metadata.usage`: `providers[]` and `limits[]` carry the provider's
own values, `disabledCredentials` carries the refusals, and account identifiers and
endpoints are left out and named in `absent`. The verbatim report stays in the probe
row. A report that parsed without windows answers `unknown`, and one that did not
parse answers `error` with the cause, so an absent usage answer is never read as an
available allowance.

## Unobserved

- Whether any adapter states a quota window through a non-interactive read. None
  observed so far does, so the capacity states `known` and `expired` are exercised
  by fixture rows rather than by a live provider.
- Whether the Codex, Muse or Claude conversation frames carry a model field. The
  observed-model path reads provider events and is unchanged here.
- Whether the registry on another host maps keys this host does not, and which
  models a Codex subscription exposes beyond the slugs its catalog states.

## Not in this change

Applying a selected route to an existing seat, and recording that route change
with its prior route, belong to the `configure` operation and the #681 failover
verb. The selection this change answers hands those verbs the route tuple, the
basis and the capacity state.
