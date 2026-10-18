# Account and API-credit system for #793 and #702

## Scope

This document specifies the standard product account and API-credit system.
It covers #793 and #702. It uses facts from #681, #694, #703, #711 and #792.
Product policy and state machines are Bend2 code.
Host code provides file, process, SQLite, secret-store and network byte operations.

## Official facts recorded on 2026-10-17

Sources:

- [Monthly API credits for Max and Team plans](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans)
- [API credits for Max and Team plans](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)
- [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api)
- [Organization API](https://platform.claude.com/docs/en/api/organization)

Facts from the platform document:

- Max 5x includes $100 USD per billing cycle. Max 20x includes $200 USD per billing cycle.
- Team credits pool across seats into one organization balance. The pool cap is $500 USD.
- Credits deposit into one linked Claude Console organization.
- Every API key and workspace in that organization draws from the same balance.
- Included credits are spent before purchased credits.
- Credits expire at the end of the billing cycle. Unused credits do not roll over.
- Credits appear in the Promotional credits section of the Console Billing page.
  The page shows amount and expiry date.
- Credits cover the Claude API, Claude Managed Agents, the Claude Agent SDK and the playground.
- Credits do not cover Claude Code and do not cover extra usage in the Claude apps.
- An organization that holds only these credits and sends a Claude Code session
  receives a credit-balance-too-low message.
- When the balance is exhausted, API requests return this text:
  `Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.`
- Credits do not change Claude or Claude Code subscription usage limits.

Eligibility depends on launch origin and authentication.
The support article states: API credits cover `claude -p` and the Claude Agent SDK
when the operator runs them with an API key from the linked Console organization,
because that usage bills as Agent SDK usage.
When signed in with a Claude plan, the same commands draw plan usage limits.
Runs started by the Claude Code GitHub Action, an IDE extension or the desktop app
count as Claude Code usage and are not covered, even with `-p`.
Interactive Claude Code sessions are not covered.
The platform document table lists Claude Code as not covered.
The support article FAQ gives the self-run headless case.
This specification records `launch_origin` and `auth_kind` for each attempt and
applies the support article rule to self-run headless work.
Baton native attempts spawn `claude --print` in
[bend2/src/harness/claude-player.bend](bend2/src/harness/claude-player.bend:5).
A Baton attempt with an API-key route from a verified linked organization records
`credit_eligible` as true. A subscription-authenticated attempt records it as false.

Two clocks stay distinct in every observation and classifier.
Organization spend caps reset on the first of a calendar month.
Promotional credits refresh on the plan billing cycle.
A request can fail on a spend cap while promotional credit remains, and
promotional credit can expire while a spend cap has reset.
The classifier records which fact the provider reported.
Documented exhaustion wording from the platform document:
`Your credit balance is too low to access the Anthropic API.`
Classification is status-first on Claude result frames
(`api_error_status` 402, spend-limit 400, tier-cap 429 without retry-after),
scoped to the funding route that produced the frame.
The OMP `errorStatus=429` transient rule stays scoped to OMP frame shapes.

## Supported observation sources

The Organization API provides `GET /v1/organizations/me`.
The request uses an API key. The response contains organization `id` and `name`.
This endpoint verifies which organization a credential belongs to.
The secret value is resolved only at launch time for this request.

The Usage and Cost Admin API provides:

- `GET /v1/organizations/usage_report/messages`
- `GET /v1/organizations/cost_report`

These endpoints require an Admin API key or an OAuth token with the `org:admin` scope.
They report historical usage and cost for an organization.
They do not report a remaining promotional credit balance.

No documented endpoint for remaining promotional credit balance and expiry was found
in the official documents read on 2026-10-17.
The product records balance from these source kinds only:

| Source kind | Balance | Spend | Expiry |
| --- | --- | --- | --- |
| `console-billing-display` | operator read from Console Billing page, imported with source and verbatim text | no | yes, as displayed |
| `operator-imported` | operator supplied value with source text | optional | optional |
| `anthropic-admin-api` | unknown; usage and cost reports only | yes (cost_report) | no |
| `provider-error` | unknown; records exhaustion cause | no | no |

Credit refresh is an operator-run flow: the packaged helper
`bend2/harness/claude-credit-observe.mjs` performs the organization, cost and
usage reads against the documented endpoints, and the operator records each
outcome through `account observe`; Console Billing readings are recorded
through `account import-credit` with their source named. No command performs
an implicit or scheduled refresh. An undocumented OAuth prepaid-credits
endpoint appears in third-party tooling; it is not a source this product
reads, and the standard route records balance only from the source kinds
above.

## Data model

All amounts are decimal strings from record through JSON output.
This preserves authored precision from #711.

### Account record

Implemented in [accounts.bend](bend2/src/coordinator/accounts.bend) as the `accounts` table
and the `record`/`read` output:

- `id`: operator label for the account; the primary key, so one label is one account.
  Labels contain no whitespace or control characters.
- `provider`: provider name, for example `anthropic`.
- `harness`: the launchable harness (`codex`, `omp`, `muse` or `claude-code`).
  API-key funding launches only on `claude-code`.
- `funding`: `subscription` or `api_key`.
- `secret_ref`: secret-store reference (`file:PATH` or `keychain:SERVICE/ACCOUNT`),
  or the credential directory for subscription profiles. The record stores the
  reference only and never a secret value. A label re-recorded with different
  fields is refused, so a rotated credential cannot silently stay in force.
- `organization`: verified Console organization id, or empty when unverified.
  Written only by a `reported` organization observation; the record verb cannot
  state it.
- `verified_at`: observation time of the verification, or empty when unverified.

A browser sign-in does not verify an organization.
The two operator Chrome sign-ins stay unmapped until root verifies each
account-to-organization mapping and places credentials in the native secret store.

### Credit observation

One observation belongs to one organization. Accounts that share an organization
share one observation. The organization id is the deduplication key.

Implemented in [accounts.bend](bend2/src/coordinator/accounts.bend) as the
`credit_observations` table. Fields:

- `organization`: verified Console organization id; the pool key. An
  unverified account pools nothing.
- `fact`: `promotional_credit`, `purchased_credit`, `external_spend` or
  `subscription_usage`. Monthly API credits and subscription usage are
  separate facts and never reinterpret one another.
- `state`: `reported` or `unavailable`. An unavailable newest reading carries
  the last reported value beside it as `previous`, with the cycle it was
  observed in.
- `balance`: decimal string exactly as the source reported it, or empty.
  Reported balances require a canonical decimal and a named unit.
- `unit`: unit text from the source, or empty.
- `expires` and `cycle`: expiry instant and billing-cycle anchor from the
  source, or empty when unknown. Age is data beside the state; no wall-clock
  deadline decides anything.
- `source`: the named source, for example `console-billing-display` for an
  operator import or `anthropic-admin-api:/v1/organizations/cost_report` for
  an Admin API read. A named source is required for every import.
- `detail`: the verbatim observation document, so every reading carries its
  own raw evidence beside the parsed fields.
- `observed_at` and `authority`: observation time in milliseconds and the
  recording actor.

Conflicting same-organization readings are named: when more than one distinct
reported balance exists for the newest cycle, the pool view flags the conflict
and lists every reading with its source.

Code derives a display age from `observed_at` and the current time.
### Attempt funding record

Implemented in [accounts.bend](bend2/src/coordinator/accounts.bend) as the
`account_attempts` table, written at admit time before the spawn and read by
`account attempts`:

- `attempt`: the attempt directory the retained launch records; the primary key.
- `session` and `turn`: the session and its execution row.
- `account`, `organization`, `funding`, `secret_ref`: the selected account, its
  verified organization, its funding route (`subscription` or `api_key`) and its
  credential reference at the moment of selection.
- `workload`: `agent-sdk` for API-key funding (self-run `claude --print` with the
  organization's key is billed as Agent SDK usage), `subscription` for a
  subscription-bound claude-code launch, and the harness name otherwise.
- `outcome` and `error_text`: written once per finished attempt by
  `Accounts.attempt_completed`, the single coordinated hook called from the
  receive and turn completion paths (runtime seat owns the call).
- `started_at` and `ended_at`: admit time and completion time.
- `predecessor` and `recorded`: the advance chain and the record time.

Selection-time availability facts ride beside the route, never inside it:
`select` reports `preferredByObservation`, `creditEligible`,
`observationState` and `creditCycle`, and an exhausted or unknown balance is
a preference and reporting fact, never an admission gate.
Monthly API credits and subscription usage stay separate facts: credit
observations record `promotional_credit`, `purchased_credit`,
`external_spend` and `subscription_usage` as distinct facts against the
verified organization, and a funding route never reinterprets one as the other.


## Route selection

Input: the session's harness, the configured accounts in operator recording
order, and the newest promotional-credit observation per organization.

The first account whose harness and funding match and whose organization's
newest promotional observation is not `unavailable` is preferred by
observation. When every matching account is preferred-against, the operator's
order decides and the answer records `preferredByObservation` as false. An
organization with no observation is never preferred against. No observation
refuses work: an exhausted or invalid credential produces the actual provider
failure and the fallback path.
Selection reads the observation state and cycle as recorded facts, so an
unknown or aged balance stays visible to the conductor without gating
anything.
## Fallback

Fallback follows #702 and #681.

- A fallback triggers only on an actual provider outcome:
  subscription usage exhaustion, credit exhaustion text from the platform
  document, an invalid-credential refusal, or another provider failure that
  the conductor classifies from the retained error text.
- The original attempt, its account, its funding route and its provider error
  stay recorded. Code appends records. Code does not rewrite the failed attempt.
- The next attempt keeps the same player id, parent, workspace, branch, task,
  pending inbox and native conversation id.
- Re-entry does not create a replacement conversation.
- Re-entry does not acknowledge unread input.
- When no configured route remains, code records every retained cause and
  sends a report to the conductor. The pending input stays owed.
- A later refresh observation or a renewed credential makes an account
  selectable again. No historical exhaustion record blocks selection.

Existing code that this extends:

- Profile order and next-profile selection sit in
  [subscription-fallback.bend](bend2/src/coordinator/subscription-fallback.bend:103).
- Exhaustion wording detection sits in the same file at line 262.
  The API-credit exhaustion text from the platform document is a separate marker.
  It must not reuse subscription-limit wording.
- The Muse profile route clears `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`
  and `CLAUDE_CODE_OAUTH_TOKEN` before binding a credential store in
  [claude-player.bend](bend2/src/harness/claude-player.bend:27).
  An API-key route needs the inverse binding: resolve one secret reference at
  launch, set `ANTHROPIC_API_KEY` for the child process only, and record the
  credential label in the attempt record. The secret value appears in no
  argv display, message, transcript, report or file.
- Provider usage observations sit in
  [usage.bend](bend2/src/coordinator/usage.bend:240).
  Credit observations add an organization scope beside that read.
  Conversation token totals stay separate from account observations (#694).

## Host boundary

Bend2 code owns account records, observations, selection and fallback decisions.

Host operations and their error results:

| Operation | Input | Result | Error |
| --- | --- | --- | --- |
| secret resolve | secret reference | secret bytes for one launch | store code and detail, no secret text |
| HTTPS request | method, URL, headers with resolved secret, body bytes | status, body bytes | transport code and detail |
| process spawn | argv array, environment bindings, cwd | exit or signal status, stdout | spawn code and detail |
| SQLite query | database path, SQL text | rows as text | SQLite code and detail |
| file append | path, one record line | unit | filesystem code and detail |

Each argv element and each environment binding travels as one host-encoded value.
A store path or secret reference with spaces stays one value.
A host failure returns its code and detail to the Bend2 caller.
Bend2 code records that cause in the attempt or observation record.

## Commands

The product adds these reads and writes to the existing command surface:

- `account-credit` read: accounts, organizations, observations and attempt
  funding records for the project database.
- `account-bind`: record one account with its secret reference and auth kind.
  This command follows `profile-bind` in
  [agent-domain.bend](bend2/src/coordinator/agent-domain.bend:81).
- `credit-observe`: record one credit observation from a listed source kind.
  A `usage-cost-api` observation records spend and leaves balance empty.
- `credit-refresh`: run the supported organization verification request and,
  when an Admin credential reference exists, the Usage and Cost requests.
  The command records each outcome, including failures, with its source.

## Fixtures

Fixtures live with the Bend2 laws for this module. Each fixture states whether
its exhaustion is a fixture or an actual provider outcome.

1. Two accounts with independent organizations select independent routes.
2. Two credentials for one organization read one pooled observation.
3. External spend in a `usage-cost-api` observation reconciles against the
   Console-observed balance without changing the balance value.
4. An observation past its cycle end records expiry. The next cycle observation
   replaces the balance and keeps the expired record.
5. Unknown balance selects `api-unknown`. Code does not report it as available.
6. A `reported` observation selects `api-credit` for an `agent-sdk` workload.
7. A subscription-authenticated headless workload records `credit_eligible`
   as false and selects a subscription route. An API-key headless workload
   from a verified organization records `credit_eligible` as true.
8. Credit exhaustion on attempt one selects the next account.
   Player, task, conversation and pending inbox ids stay equal across attempts.
   Attempt one keeps its original error text.
9. A non-exhaustion provider error does not advance the account.
10. All routes exhausted records every cause and reports to the conductor.
    Pending input stays unacknowledged.
11. A refresh observation after exhaustion makes the account selectable again.
12. Decimal strings `200.00`, `0.123456789012345678901234567890` and
    `9007199254740993` round-trip through record, read and JSON output unchanged.

## Validation

Compiler, build and test execution runs on remote runners.
This assignment coordinates one compiler slot with the release and compiler operators.
No full Main generation is admitted by this assignment.
Source, tests, executable, installation and actual provider proof stay separate claims.
Live provider proof requires root-placed credentials and a verified organization.
That proof is outstanding until root completes account setup.

## Model discovery for #792

The `models` read in [usage.bend](bend2/src/coordinator/usage.bend)
reads one recorded session's harness. It does not enumerate the operator's
configured harnesses or accounts. Muse inspection resolves one supplied
model identifier and reports `modelExistence` as unknown.

The product adds a `models-all` read with these rules:

- Sources are the recorded sessions and the recorded accounts in the project
  database. The project database bounds the set; a harness configured outside
  it does not appear. Each distinct harness, command and workspace is queried
  once through the existing per-harness query. The read runs no new process type.
- The answer states its enumeration basis: recorded session count, queried
  source count, recorded account count, and whether the declared route list
  is included. The route list is not a source in this read.
- An account with no session sharing its harness contributes its identity to
  the accounts section and no query. A source whose harness the query does
  not support reads unknown with the cause `unsupportedHarness`.
- Each source answer keeps its schema, observation time and source identity.
  A failed or unsupported query stays in the result as unknown with its cause.
- Accounts appear by label with provider, harness, funding route and
  organization state. Secret-store references do not appear in this read.
- Muse model enumeration stays unknown. The Muse client resolves one
  supplied identifier; the read states that limit per Muse source.
- Capability assessments appear only from a recorded source with its date.
  No recorded native assessment source exists today, so the read returns an
  empty assessment list with the reason `noRecordedAssessmentSource`.
  The legacy Artificial Analysis cache is stale from 2026-09-20.
  The read lists configured sessions and accounts as its sources.
- Observations report facts. The read adds no admission or selection rule.

## Open facts

- Account-to-organization mapping for the two Chrome sign-ins: unverified. Owner: root.
- Native secret-store references for API credentials: not placed yet. Owner: root.
- Eligibility rule recorded from the support article FAQ on 2026-10-17. Live billing proof for a Baton attempt is outstanding.
- Remote compiler result for the new module: not run yet.
