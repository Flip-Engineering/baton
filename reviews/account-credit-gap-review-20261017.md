# Account-credit product gap review, 2026-10-17

Status: read-only review record. Seat `flash-account-credit-1017` (ensemble
`account-credit-product`, tight coupling). Parent `accounts-wonder`. Source pin
`account-credit-base` `895f995`. No shared branch was edited. No build, compiler
check, behavioral suite or focused run executed for this record.

Scope: the #793/#702 account-credit implementation on `account-credit-base`, its
acceptance evidence, the #769 changes in the same bundle, and the #792
`models-all` read that shares the pin.

## Assignment state

- `accounts-deepseek` (implementer) holds
  `message:accounts-wonder:2f5ccec4005a5a481d708af580949c1d`, open, with 10
  pending inbox items. Its branch `accounts-deepseek-793-702` is at `393cf9d`.
  `account-credit-base` carries the repairs and later work: `637f6b6` (D1-D5 and
  the pool action), `06c67c1` (pool conflict scoped to the newest cycle),
  `44db78d` (`models-all`) and `895f995` (enumeration basis). A resumed worker
  must read the integration branch first; its own branch is superseded.
- `accounts-glm` (critic) delivered
  `reviews/account-credit-implementation-review.md`,
  `reviews/account-credit-repair-review.md`,
  `reviews/logging-769-wonder-fix-review.md` and
  `reviews/model-discovery-792-review.md`. Its task-completion record remains
  open.
- The conductor `accounts-wonder` process is recorded as exited 1. This review
  answers the dispatch without editing source.

## Gap list

### G1. The bundle has no execution evidence (blocking acceptance)

No build, compiler check, behavioral suite or focused run has executed for
`637f6b6`, `44db78d` or `895f995`. The repair re-review records this at
`reviews/account-credit-repair-review.md:132-135`; the #792 review records it at
`reviews/model-discovery-792-review.md:114-117`; the specification records
"Remote compiler result for the new module: not run yet" at
`docs/bend2/account-credit-793-702.md:340`.

The tree holds no run artifact for these suites: no `.scratch` result, no
evidence directory and no workflow run record. The helper checks described at
`docs/bend2/account-credit-funding.md:158-163` are prose claims; no stdout or
stderr artifact is stored.

Consequence: the twelve-test green trace, the three #769 traces and the laws
fixture compile remain predictions. The landing gate has received no verdict.

### G2. Provider-reported exhaustion does not advance a bound account (high)

`account bind` appends the account label to the per-session account sidecar
(`bend2/src/coordinator/accounts.bend:350-361`). The retained launch reads that
sidecar last and chooses the last label; it reads the profile record only when
the account sidecar is empty (`bend2/src/coordinator/accounts.bend:380-390`).
When an account is chosen, `account_binding` resolves that account's
`secret_ref`; the profile store is used only when no account is chosen
(`bend2/src/coordinator/accounts.bend:217-220`).

The only automatic advance on a provider-reported exhaustion is
`profile_handoff`, which calls `advance_profile`
(`bend2/src/coordinator/subscription-fallback.bend:544-547`). `advance_profile`
appends the next operator-listed profile to the profile record
(`bend2/src/coordinator/subscription-fallback.bend:525-541`). The account
sidecar is not written by this path. The credit wordings are in the shared
marker list (`bend2/src/coordinator/subscription-fallback.bend:265-266`), so an
API-credit refusal reaches the same handoff.

Result for a session bound with `account bind`: the next launch reads the same
account label, resolves the same secret reference and records the same account
in `account_attempts`, while the handoff report names a profile change. The
failed credential remains in force.

`account select` has no input for the refused account or the current attempt.
It reads the account table and the promotional-credit observations
(`bend2/src/coordinator/accounts.bend:144-185`, `:533-563`). An exhaustion
terminal does not write a `credit_observations` row; those rows are written
only by `observe` and `import-credit`
(`bend2/src/coordinator/accounts.bend:436-439`, `:481-483`). A later selection
therefore prefers the same account unless the operator imported an unavailable
observation for the organization.

No test covers the account handoff. `bend2/test/account-credits.py:264-282`
drives one attempt and checks its row; it sends no exhaustion terminal.

### G3. Observation admission does not enforce JSON validity; a reported organization observation can clear a verified organization (medium)

`observe_fields_sql` computes `json_valid` and calls `json_extract` in the same
SELECT (`bend2/src/coordinator/accounts.bend:422-426`). `observe_fields` binds
that first field as `valid` and never passes it to `observe_selected` or
`observe_admitted` (`bend2/src/coordinator/accounts.bend:441-458`). The import
path has the same shape (`bend2/src/coordinator/accounts.bend:475-501`). The
admission messages state that a JSON document is required; the code path with
invalid JSON reaches SQLite first.

I checked the two expressions against SQLite: `json_extract('not json', '$')`
and `json_type('not json', '$')` raise `malformed JSON`. A command with
`--detail` that is not JSON exits on the SQL error, before any typed refusal.
No test calls `observe` or `import-credit` with an invalid document;
`bend2/test/account-credits.py:164-221` uses well-formed documents throughout.

The same UPDATE writes `organization = coalesce(json_extract(detail,
'$.document.id'), '')` whenever the fact is `organization` and the state is
`reported` (`bend2/src/coordinator/accounts.bend:437`). A valid document with
no `document.id`, for example `{"operation": "organization", "state":
"reported"}`, clears a previously verified organization to the empty string and
leaves `verified_at` at its old value. The SQL check confirmed the result
`('', old_verified_at)`. The record then reports no organization with a
verification time, and the account leaves every organization pool.

### G4. The attempt record and route vocabulary follow the funding document, not the #793 specification (medium)

The specification lists these attempt fields: task input id, native
conversation id, account label, auth kind, funding route, organization,
workload kind, provider outcome, provider error text, and start and end times
(`docs/bend2/account-credit-793-702.md:152-162`). The `account_attempts` table
stores `attempt, session, turn, account, organization, funding, secret_ref,
predecessor, recorded` (`bend2/src/coordinator/accounts.bend:228`). The insert
writes those columns (`:394-396`); the read returns them (`:414-418`). Workload
kind, outcome, error text and attempt times are absent.

The specification defines route values `api-credit`, `api-purchased` and
`api-unknown` (`docs/bend2/account-credit-793-702.md:164-174`). The account
record stores `subscription` or `api_key` (`bend2/src/coordinator/accounts.bend:87-98`);
the attempt record copies that field. `creditEligible` appears in the selection
JSON (`:541-542`) and in no attempt row.

The specification defines a `credit-refresh` command that runs the
organization, usage and cost requests and records each outcome
(`docs/bend2/account-credit-793-702.md:253-266`). The account command dispatch
has `record`, `read`, `bind`, `attempts`, `select`, `pool`, `observe` and
`import-credit` (`bend2/src/coordinator/accounts.bend:573-584`). No action runs
`bend2/harness/claude-credit-observe.mjs`; the operator runs the helper and
passes its line to `observe`.

The specification names source kinds `console-observed`, `operator-imported`,
`usage-cost-api` and `provider-error`
(`docs/bend2/account-credit-793-702.md:85-95`). The table stores a free-text
`source` and does not check it against a closed set
(`bend2/src/coordinator/accounts.bend:481-483`). The specification lists
`credential_label` and `organization_source` on the account record
(`docs/bend2/account-credit-793-702.md:110-118`); the table has `secret_ref` and
`verified_at` only (`bend2/src/coordinator/accounts.bend:227`).

`docs/bend2/account-credit-funding.md:9-46` describes the tables the source
implements. The two documents disagree on the attempt fields, the route
vocabulary, the command surface, the source-kind set and the account fields.
The acceptance criteria need one contract; the current source follows the
funding document.

### G5. Status-first exhaustion classification is specified and absent (medium)

The specification requires status-first classification on Claude result frames:
`api_error_status` 402, spend-limit 400 and tier-cap 429 without a retry-after,
scoped to the funding route (`docs/bend2/account-credit-793-702.md:60-65`).
`exhausted_marker_sql` contains text fragments only
(`bend2/src/coordinator/subscription-fallback.bend:265-266`), and the marker
path requires a failed terminal (`:270-271`). A 402 `billing_error`, a 400
spend-limit refusal and a 429 tier-cap refusal whose text lacks a listed
fragment do not advance the route. The implementation review names this gap as
C12 at `reviews/account-credit-implementation-review.md:131-134`.

### G6. Selected-check coverage omits the new #769 and #792 tests; no test covers G2 or G3 (medium)

`.github/scripts/record-native-checks.py:14-21` lists `account-credits.py` and
`turn.py`. It does not list `logs.py` or `observed-usage.py`. The #792 review
requests `observed-usage.py` in the bundle at
`reviews/model-discovery-792-review.md:103-110`; the #769 review predicts the
`logs.py` snapshot tests at
`reviews/logging-769-wonder-fix-review.md:111-117`. The selected target
comparison does not judge either file. `bend2/scripts/check-native.sh:23` runs
`check-native-parallel.py` over every `bend2/test/*.py`; `:24-25` builds and
runs the laws fixture. Those tests execute in the candidate suite; they do not
enter the selected target verdict.

No selected test covers the G2 handoff or the G3 invalid-document and
missing-`document.id` cases.

## Resolved or accepted since the last review

- D-M1 (Muse model variants collapsed in `models-all`) is closed:
  `models_sources_sql` partitions by the model for Muse sources
  (`bend2/src/coordinator/usage.bend:468-469`).
- R1 (pool conflict spanned cycles) is closed: the conflict count and readings
  are scoped to the newest reading's cycle
  (`bend2/src/coordinator/accounts.bend:521`).
- D1-D5 and the pool wiring are closed per
  `reviews/account-credit-repair-review.md:15-78`; the source matches the
  described repairs at `bend2/src/coordinator/accounts.bend:144-185`, `:217-220`,
  `:296-317`, `:516-529`.
- R2 (the legacy off-harness `api_key` refusal names the resolver) and R3
  (SIGKILL to the wrapper is not forwarded) remain recorded residuals at
  `reviews/account-credit-repair-review.md:128-130`.
- #769 is approved as a source fix with no remote verdict
  (`reviews/logging-769-wonder-fix-review.md:1-11`).

## One bounded next step

Repair G2 in one bounded change on `account-credit-base`: make the
provider-reported exhaustion advance the account in force, excluding the
refused account for the continuation and recording the next operator-ordered
matching account before the relaunch, and add one regression test to
`bend2/test/account-credits.py` that binds an API-key account, delivers the
credit-stop terminal and asserts the next `account attempts` row names the next
account.

The acceptance gate after that repair is the single named remote bundle at the
resulting pin: `bend2/scripts/check-native.sh`, `account-credits.py`, `logs.py`,
`turn.py` and `observed-usage.py`. That run is the first real acceptance
evidence for G1.

The repair comes first because the current twelve-test suite would pass on the
current source while the fallback remains untested.
