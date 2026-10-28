# Account funding routes and organization API credits (#793, #702)

Baton records provider accounts, the funding route each account uses, and the
organization credit readings that belong to those accounts. Issue #793 owns this
feature; #702 owns the named-profile handoff it extends, #681 and #694 own
provider failover after a refusal, #703 owns project settings that refer to
accounts, #711 owns numeric fidelity and #792 owns model discovery.

## What is recorded

Five tables, created by `bend2/src/coordinator/accounts.bend`.

`accounts` names one provider identity:

| Column | Meaning |
| --- | --- |
| `id` | The account label. One printable ASCII word, so it stays one field and one report word. |
| `provider` | The provider name, for example `anthropic` or `openai`. |
| `harness` | The Baton harness the account launches: `codex`, `omp`, `muse` or `claude-code`. |
| `funding` | `subscription` or `api_key`. |
| `secret_ref` | A reference into the provider credential store or the local secret store. Never a credential value. |
| `organization` | The verified Console organization id, empty while the mapping is unknown. |
| `verified_at` | The observation time that wrote the organization. |

`account_attempts` records the account and funding route selected for one
attempt:

| Column | Meaning |
| --- | --- |
| `attempt` | The attempt directory the retained launch records. The same value `native_initial_inputs.attempt` carries. |
| `session` | The Player. |
| `turn` | `executions.id` for that attempt, empty when the execution row is absent. |
| `workload` | The execution class of the launch: `agent-sdk` for API-key funding, `subscription` for a subscription-bound claude-code launch, the harness name otherwise. Written at admit. |
| `outcome`, `error_text`, `ended_at` | Written once per finished attempt by `Accounts.attempt_completed`, the coordinated hook the receive and turn completion paths call. Empty until that call, by design: an unfinished attempt carries no outcome. |
| `started_at` | Admit time, written before the spawn, so an unstarted or failed launch keeps its attribution. |
| `account`, `organization`, `funding`, `secret_ref` | The selection in force for the attempt. |
| `predecessor` | The attempt this one continues, so an account change keeps its lineage. |

`credit_observations` records what a named source reported about one
organization:

| Column | Meaning |
| --- | --- |
| `organization` | The pool key. Every account and key of one organization shares it. Empty when the account is unverified. |
| `fact` | `organization`, `subscription_usage`, `external_spend`, `promotional_credit` or `purchased_credit`. |
| `state` | `reported` or `unavailable`. |
| `balance`, `unit` | The reported amount and its unit, or empty when the source reported none. |
| `expires`, `cycle` | The stated expiry and billing cycle, or empty. |
| `source`, `detail`, `observed_at`, `authority` | Where the reading came from, the document or condition it carries, when it was taken and which actor recorded it. |

## The credential boundary

An account stores a reference. The launch resolves it.

A subscription account binds the credential directory the harness reads, through
the existing `CODEX_HOME` or `CLAUDE_CONFIG_DIR` binding.

An Anthropic API-key launch passes through `credit_launch_gate` in
`bend2/src/coordinator/accounts.bend`. The route spends promotional API credit
and is unavailable (#881, #1177). The gate returns `Anthropic API-key launches
are unavailable because no provider-enforced boundary keeps their request
charges within the promotional-credit grant`, writes no reservation and writes
no authorization. The attempt is not started and its input stays owed. A
retained launch can make more than one provider request, and no provider-enforced
per-request boundary keeps those charges within the grant and cap. A refused
provider request after paid requests does not provide one. The route stays
unavailable until such a boundary exists.

The account order marks an Anthropic `claude-code` `api_key` account
`not launchable: promotional-credit route is unavailable` and skips it.
Subscription routes and other harnesses keep their existing bindings.

`api-key-exec` remains the resolver for the route. It requires the
`BATON2_CREDIT_RESERVATION` environment marker naming the attempt to match
`BATON_ATTEMPT_DIRECTORY`, then consumes the attempt's `credit_authorizations`
row with one guarded `UPDATE`: only `changes()=1` admits the launch. A consumed
row refuses `creditAuthorizationConsumed`, a row naming another reference
refuses `creditAuthorizationMismatch`, and a failed or zero-change consume
refuses `creditAdmissionUnavailable` before any secret is resolved or child
started. A marker by itself is not authorization. `credit_record_authorization`
writes a row only from the organization's newest promotional-credit observation
when it is reported, names the independently current grant cycle, has a positive
canonical `USD` balance and a 13-digit expiry later than the database clock, and
only when the verified account's attempt holds a `reserved` row for the same
session, account, organization and grant cycle. No production
path writes either the marker or the row. The SQLite busy handler in
`bend2/src/host/sqlite.c` waits at most 3000 retries of 10ms for one lock and
then returns `SQLITE_BUSY` to the caller.

## Request-level reservation

`credit_reservations` records one reservation per request identity. The launch
reservation uses the attempt directory as its request identity. A row carries
the session, attempt, account, organization, grant cycle, cap period, observed
balance, unit, reserved maximum, balance after the reserve, cap after the
reserve, state, actual cost and outcome.

The grant cycle is the `cycle` value of a reported promotional-credit
observation, for example `grant:2026-10-11`. The grant in force is derived
separately from every reported observation of the organization: it is the one
cycle whose verified 13-digit expiry is later than the database clock. When no
cycle or more than one cycle is in force, no grant is current and the newest
observation refuses `creditCycleMismatch`. The calendar does not create a
grant: a new allowance requires a new verified provider observation with its own
cycle and expiry. The cap period is the current calendar month and remains a
separate field.

`credit_reserve_for` reads the newest reported promotional-credit observation
and the recorded reservations for the verified organization. It refuses with a
named reason when the route is not the Anthropic `claude-code` `api_key` route,
the organization is unverified, the observation is absent or unavailable, the
grant cycle is empty, the cap period is empty, the expiry is absent, malformed
or past, reported balances conflict for the grant cycle, the unit is not `USD`,
or an amount is not a canonical decimal. It refuses `monthlyCapExhausted` when the
monthly spend has reached the `$200` ceiling, `grantCapExhausted` when the grant
spend has reached it, `promotionalCreditExhausted` when the grant spend has
reached the reported balance (a reported `0.00` balance included), and
`creditChargeExceedsBound` when a supplied request charge exceeds the smaller
unspent amount.

The observed expiry text is preserved exactly. Admission requires an exact
13-digit epoch millisecond boundary. A date-only or otherwise unverified expiry
is retained but does not admit a request; no day is added to the observed date.

The conflict check compares reported balances recorded at the same observation
time for the grant. A chronological balance decrease from one verified reading
to a later one is normal consumption and keeps its historical provenance; it is
not a conflict. Different balances at the same observation time refuse
`creditReadingsConflict`.

The reserved maximum is the lower of the observed balance and the two unspent
ceilings: `min(balance, 200 - grant spend, 200 - monthly spend)`. Grant spend
sums the reservations for the same grant cycle. Monthly spend sums the
reservations for the same cap period and uses the larger of that ledger and the
reconciled provider external spend. `credit_reserve_bounded_for` reserves a
supplied request charge instead of the whole bound. A `reserved` row counts its
maximum against the grant and both ceilings until it settles. A launch reserves
the whole remaining amount, so a second launch for the same organization is
refused until the first settles. The ledger is keyed by organization: every
account of one verified organization shares the organization's grant and its
`$200` ceiling, so each account stays within `$200` for the cap period. A
repeated request returns its recorded row and does not reserve again.

`credit_settle_for` replaces the bound with the actual cost when one is
reported. The turn and receive completion paths pass the terminal Claude result
event to `attempt_completed_event`. That function scans the raw event at object
depth, reads the one root `total_cost_usd` field as an exact plain-decimal
token, and ignores a nested same-named field. A duplicate root field, an
exponent form, a non-result frame, a malformed document or a non-number field
stays unknown. A repeated cumulative frame settles once. A completed or failed
attempt without a usable cost keeps the reserved maximum counted and records
state `failed`; `account reconcile` settles that row with the provider's actual
cost later. `account import-spend` records the Admin cost report's numeric USD
amount for the organization and cap period.

The ledger has no production caller that creates a reservation:
`credit_launch_gate` does not call `credit_reserve_for`, and completion
settlement finds no reservation for a launch. `credit_reserve_bounded_for` and
the request pricing (`credit_request_facts_for`, `credit_request_price`) have no
production caller either. A launch reservation reserves the remaining amount
once, before the launch starts. Settlement compares the actual cost with the
reserved maximum only after the launch ends, so a reservation alone does not
keep a launch's charges within the grant.

## Funded credit observations

No documented endpoint returns the remaining promotional credit balance. The
documented surfaces are:

- The Console Billing page, which shows the promotional credit amount and its
  expiry. `account import-credit` records that reading with the operator's
  declared source, amount, unit, expiry and cycle.
- The Admin Usage and Cost API, which reports usage and cost in USD for an
  organization when the credential is an Admin key, an `org:admin` OAuth token
  or a key that is not scoped to a workspace.
- `GET /v1/organizations/me`, which returns the organization an API key belongs
  to. `account observe` with an `organization` document writes that mapping to
  the account and keeps the document as the observation's evidence.

The packaged native helper `bend2/harness/claude-credit-observe.bend`, built as
`claude-credit-observe`, performs the organization, usage and cost reads with a
resolved secret reference and prints one JSON line carrying the operation,
source, observed time, state, HTTP status, the whole parsed document and, on
failure, the actual condition. `account observe` records that
line.

A balance is written only by an import whose amount is a canonical decimal and
whose unit and source are named. Model output is recorded as an observation
document, never as a balance. An import whose reading found no value records the
fact as `unavailable` with the condition that caused it, which is how a refresh
for a new cycle that produced no value is represented. The pooled read reports,
for each organization and fact, the newest observation and, when it is
unavailable, the last reported value with the cycle it belongs to. No wall-clock
age or deadline decides anything, so an older reading is reported as the
previous one rather than marked stale by a policy.

Two accounts whose verified organization is the same appear as one organization
in `account pool`, with both accounts listed beside it and one balance per fact.

## Selection

`account select --harness H [--funding F]` returns the operator-ordered first
account whose harness and funding match, preferring one whose organization has
no observation that reported no value for the current cycle. When no such
account exists it returns the operator-ordered first matching account and says
so, with `preferredByObservation` false.

The rule is a preference over recorded facts. Selection never refuses work.
The automatic route change is driven by the provider's own refusal, which is the
rule #702 established, for subscription and API-key credit routes alike.

## Continuation after a refusal

`exhausted_marker_sql` in `bend2/src/coordinator/subscription-fallback.bend`
gains the two documented Claude API credit stops: `credit balance is too low`
and `credit balance too low`. A funded attempt that receives one advances to the
next operator-listed profile exactly as a subscription usage exhaustion does,
because the marker feeds the existing `profile_handoff` path.

The handoff keeps the Player identity, parentage, workspace, branch, native
conversation, retained messages and owed input, and records the account change
and the provider's own cause. The attempt's terminal event stays in `turns`, so
the failed attempt and its provider error are retained.

The native Max window gate evaluates the provider for every model, including a
native Claude id without a slash qualifier; an empty provider is not a bypass.
The profile store variable maps `codex` to `CODEX_HOME`, `claude-code` and
`claude` to `CLAUDE_CONFIG_DIR`, `omp` to `PI_CODING_AGENT_DIR` and `muse` to
`XDG_CONFIG_HOME`. Max subscription quota and promotional API credit remain
separate eligibility pools; neither is converted to the other.


## Command surface

```
account --action record|read|bind|attempts|select|observe|import-credit|import-spend|reconcile
        [--session SESSION] [--id LABEL] [--provider NAME] [--harness NAME]
        [--funding subscription|api_key] [--secret-ref REFERENCE]
        [--organization ID] [--detail JSON]
```

The positional argv carries the action and the eight named options in that
order, so one constructor serves every action. `bind` records the account in
force for the session's next attempts and wakes its due delivery. A session with
no account record falls back to its profile record's label, so a session
configured before accounts existed gains the attempt record without a second
configuration.

## Deliberate omissions

- No balance is synthesized from model output, and subscription quota is never
  read as API credit.
- No Anthropic API-key credit launch is admitted. The only spend the route may
  use is the existing monthly promotional credit, up to `$200` for a verified
  organization and grant cycle shared by every credential of that organization,
  and no source yet proves a launch stays within it. Baton takes no top-up,
  purchase or billing action and permits no paid overage. Subscription OAuth
  quota and promotional API credit remain separate routes, and subscription
  launches keep the selection and fallback rules in the sections above.
- Linking a plan to a Console organization, accepting program terms, purchasing
  credits and changing billing settings remain operator setup actions.
- The observed Muse wording `Subscription quota exhausted` classifies as
  provider usage exhaustion (#907). The account handoff records the provider
  reset and advances only to a further recorded account; the wake gate holds
  the refused account until that reset.

## Verification

Compiler, build and test execution happens on the remote runners. The two
helpers were exercised directly on the operator host, which has Node and no
compiler: the resolver's success path, its permission refusal, its unsupported
reference and its missing-command cases, and the observation helper's reported
and unavailable paths against a local fixture server and a closed port, each
checked for the absence of the secret value in stdout and stderr.

`bend2/test/account-credits.bend` drives the pure funding vocabulary, the
decimal and reference legality rules, exact decimal addition, subtraction and
comparison, the request-admission decision and its named refusals, the launch
binding for both funding routes, the account-binding fallback and the selection
rule.

`bend2/test/account-credits-focused.py` drives the compiled focused entry
through the reservation guard and the launch gate: the lower-bound reserve, the
refusal of a second request while a reservation holds the ceiling, a request
charge above the unspent amount, provider spend at the ceiling,
provider-spend reconciliation, conflicting readings, non-USD and expiry refusal,
missing-cost settlement, duplicate request idempotence, two accounts of one
organization sharing the ceiling, authorization only behind an admitted
reservation, process-failure settlement, and the gate's refusal of every credit
launch, with usable, unverified, unobserved, zero, expired, unavailable,
malformed or cycle-less funding, without a reservation or an authorization. `bend2/test/api-key-exec.test.mjs` covers the
helper's credential boundary and one-use authorization. The focused and helper
fixtures are wired into `bend2/scripts/check-native.sh`.

The native fixtures require Bend 2.0.25 and clang. Source checks run with the
installed compiler; native build and execution go through the shared compile
queue and the installed qualification.
