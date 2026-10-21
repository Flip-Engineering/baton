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
`bend2/src/coordinator/accounts.bend`. When the route qualification is enabled,
the gate records the request reservation and a `credit_authorizations` row,
then returns the packaged `api-key-exec` helper with the account secret
reference. The helper requires the `BATON2_CREDIT_RESERVATION` environment
marker naming the attempt to match `BATON_ATTEMPT_DIRECTORY`, then consumes the
authorization with one guarded `UPDATE`: only `changes()=1` admits the launch.
A consumed row refuses `creditAuthorizationConsumed`, a row naming another
reference refuses `creditAuthorizationMismatch`, and a failed or zero-change
consume refuses `creditAdmissionUnavailable` before any secret is resolved or
child started. A marker by itself is not authorization. The SQLite busy handler
in `bend2/src/host/sqlite.c` waits at most 3000 retries of 10ms for one lock and
then returns `SQLITE_BUSY` to the caller.

`credit_guard_qualified` returns false in this source. The gate therefore
returns the hold sentence, writes no reservation and writes no authorization.
The attempt is not started and its input stays owed. Subscription routes and
other harnesses keep their existing bindings.

## Request-level reservation

`credit_reservations` records one reservation per request identity. The launch
reservation uses the attempt directory as its request identity. A row carries
the session, attempt, account, organization, grant cycle, cap period, observed
balance, unit, reserved maximum, balance after the reserve, cap after the
reserve, state, actual cost and outcome.

The grant cycle is the `cycle` value on the newest reported promotional-credit
observation, for example `grant:2026-10-11`. The calendar does not create a
grant: a new allowance requires a new verified provider observation with its own
cycle and expiry. The cap period is the current calendar month and remains a
separate field.

`credit_reserve_for` reads the newest reported promotional-credit observation
and the recorded reservations for the verified organization. It refuses with a
named reason when the route is not the Anthropic `claude-code` `api_key` route,
the organization is unverified, the observation is absent or unavailable, the
grant cycle is empty, the cap period is empty, the expiry is absent, malformed
or past, reported balances conflict for the grant cycle, the unit is not `USD`,
an amount is not a canonical decimal, an active reservation exists, the grant or
monthly spend exceeds the `$200` ceiling, the balance is zero, the ceiling is
spent, or the lower bound is zero.

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
reconciled provider external spend. The guard reserves the whole bound, so a
second launch cannot start until the first settles.
`credit_reservations_active` is a unique index on the organization, grant cycle
and cap period for rows in state `reserved`. A repeated request returns its
recorded row and does not reserve again.

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

`credit_launch_gate` is the production caller before send. For an Anthropic
`claude-code` `api_key` account it records the reservation, then the one-use
authorization, and returns the packaged resolver binding.
`credit_guard_qualified` returns false in this source, so the gate starts no
paid launch and #884 remains in force. The release sets that qualification
source true only after the installed qualification passes.

The provider enforces the promotional balance on each API request. A retained
launch can contain more than one provider request, and Baton has no point that
sees each request the Claude CLI makes. The current reservation bounds the whole
launch. Per-request interception remains the next required implementation. The
policy and persistent state stay in Bend2; host code may provide the transport
I/O, and a Node policy/proxy is not an approved boundary.

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
The API-key launch reservation guard is the admission control for that route;
subscription routes and continuation keep the provider-driven rule. The
automatic route change stays driven by the provider's own refusal, which is the
rule #702 established.

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
- Promotional-credit admission for one API-key launch uses the reservation
  guard above. Subscription launches keep the selection and fallback rules in
  the sections above.
- Linking a plan to a Console organization, accepting program terms, purchasing
  credits and changing billing settings remain operator setup actions.
- The observed Muse wording `Subscription quota exhausted` is not a marker of
  this module. Whether that refusal should advance an account is a separate
  finding for #670 and #702, recorded in the delivery report rather than changed
  here without an observed run.

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
through the reservation guard: the lower-bound reserve, one-active
serialization, provider-spend reconciliation, conflicting readings, non-USD and
expiry refusal, missing-cost settlement, duplicate request idempotence, the
qualified binding and the held launch, missing and stale observations, and
process-failure settlement. `bend2/test/api-key-exec.test.mjs` covers the
helper's credential boundary and one-use authorization. The focused and helper
fixtures are wired into `bend2/scripts/check-native.sh`.

The native fixtures require Bend 2.0.25 and clang. Source checks run with the
installed compiler; native build and execution go through the shared compile
queue and the installed qualification.
