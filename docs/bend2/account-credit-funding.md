# Account funding routes and organization API credits (#793, #702)

Baton records provider accounts, the funding route each account uses, and the
organization credit readings that belong to those accounts. Issue #793 owns this
feature; #702 owns the named-profile handoff it extends, #681 and #694 own
provider failover after a refusal, #703 owns project settings that refer to
accounts, #711 owns numeric fidelity and #792 owns model discovery.

## What is recorded

Three tables, created by `bend2/src/coordinator/accounts.bend`.

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

Anthropic API-key accounts remain recorded but their launch binding is held
until request-level promotional-credit admission is installed. The coordinator
refuses the attempt before spawn, and the packaged `api-key-exec` helper returns
`creditAdmissionUnavailable` before resolving a secret or starting a child.
The credit observations describe source readings; they do not authorize a spend.

An API-key account does not launch through the current package. Its input stays
owed, and the attempt records the refusal. Subscription routes and other
harnesses keep their existing bindings.

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

The rule is a preference over recorded facts. A reported balance, including a
reported zero, never refuses work; an observation never gates admission,
continuation or input acceptance. The automatic route change stays driven by the
provider's own refusal, which is the rule #702 established.

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

## Command surface

```
account --action record|read|bind|attempts|select|observe|import-credit
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
- No budget, expiry deadline, retry, cost estimate or configurable ceiling
  controls admission, continuation or validation.
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
decimal and reference legality rules, the launch binding for both funding
routes, the account-binding fallback and the selection rule.
`bend2/test/account-credits.py` drives the compiled coordinator through the
account actions, the organization verification, the unavailable observation,
the pool deduplication and the launch's attempt record. Both are wired into
`bend2/scripts/check-native.sh` and the selected-check recorder.

The coordinator-level test and the fixture require a Bend 2.0.25 compiler and
clang, which the operator host does not have, so their result is recorded from
the remote run rather than claimed here.
