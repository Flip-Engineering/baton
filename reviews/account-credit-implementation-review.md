# #793/#702 implementation review: commit `393cf9d` on `accounts-deepseek-793-702`

Status: critic review record, 2026-10-17, seat accounts-glm, requested by conductor
accounts-wonder (task `message:accounts-wonder:9861c3b1a1f76efa65f4875530625f60`). Reviewed
`git show 393cf9d` against parent `dd62ce8` in the ensemble repository, against this seat's
`reviews/account-credit-critic-audit-20261016.md` (F1-F8, C1-C12) and
`reviews/account-credit-api-research-20261017.md`. The commit is the worker's checkpoint,
committed by the conductor after the worker's turn stalled; the worker retains ownership. The
commit message records four known unfinished items; this review confirms all four and adds
defects D1-D5, two of which make the committed test suite fail on the candidate itself.

**Verdict: the design core is sound and advances F1, F2, F4, F5 and F6 to implemented or
better; do not spend the remote build slot yet.** Defect D3 falsifies the per-attempt funding
record on three of four launchable harnesses, D2 silently keeps a rotated-out credential, and
three of the nine behavioral tests fail on the candidate by trace (two because the pool action
is unwired, one on a fixture-clock error). Repair D3, D4 and the pool wiring first; D1, D2 and
D5 follow. Evaluator outcome is stated separately at the end: nothing has been built or run.

## What the commit verifies against the critic contracts

- **F1 account identity.** `AccountRecord{id,provider,harness,funding,secret_ref,organization,
  verified_at}` with a CHECK on the funding route and the label as primary key — the key's
  uniqueness closes the alias-duplication hazard the audit raised for A1's harness aliasing.
  Recording admits only launchable harnesses and control-free references. Stronger than the
  contract: the operator cannot state an organization at all — the column is written only by a
  `reported` organization observation, so the account-to-Console mapping enters the system only
  through the supported `/v1/organizations/me` verification (accounts.bend `record` refuses the
  organization field outright; `observe_insert_sql` writes it).
- **F4 organization pooling.** `credit_observations` carries organization, fact
  (`promotional_credit` | `purchased_credit` | `external_spend` | `subscription_usage` |
  `organization`), state CHECK (`reported` | `unavailable`), balance/unit/expires/cycle as TEXT,
  source, the verbatim detail document, observed_at and authority. The pool read ranks newest
  per (organization, fact), lists every account viewing the organization, and for an
  unavailable newest reading carries the last reported value with its cycle. C1's dedup holds
  for the normal case: two accounts observing one organization produce one pool entry.
- **F5 no derived balance.** No code path computes a balance from spend; no model-output source
  kind exists; imports require a verified organization, a canonical unsigned decimal
  (`decimal_text` rejects signs, exponents, prose, double dots), a named unit and a named
  source; the verbatim import document is stored beside the parsed fields, so the reading's raw
  evidence survives (the C4 requirement). `import-credit` may record `unavailable` with the
  display's own condition instead of a value.
- **F6 per-attempt record.** `account_attempts` keys on the attempt directory, records
  account, organization, funding, secret_ref and predecessor, joins the executions row by
  directory, and is written inside `retained_prepare` before the spawn is attempted — an
  unstarted or resolver-less launch keeps its attribution, and a record failure reports its own
  cause and leaves the launch to run, so bookkeeping never blocks the work it describes
  (`record_current_attempt`). Direct turns are covered: the direct path calls the same
  `retained_prepare` (turn.bend lines 1001 and 1479), so binding and attribution are unified
  across receive and `turn`.
- **F2 secret confinement — judged against the spec-file ABI.** `api-key-exec.mjs` meets the
  invariant, which is the contract; my C-layer spec file was one shape of meeting it. The
  reference is the only secret-adjacent argv element; the value reaches the harness only in the
  spawned child's environment; refusals are typed (`secretUnavailable`,
  `secretFilePermissions`, `unsupportedSecretReference`, `secretStorageUnavailable`,
  `spawnFailed`) and print only the reference's kind prefix, never its path; secret files must
  be owner-only or they are refused unread; the keychain value stays off stderr. The
  coordinator's strip list keeps unsetting all three credential variables before the wrapper
  inherits, so an inherited operator key cannot leak into a subscription run and subscription
  tokens cannot leak into an API-key run — the binding order the audit required holds. The
  exposure class equals the C-layer design (value in one process's heap plus the child's
  environment); the differences are D5 below.
- **Exhaustion wording — judged.** Adding both documented wordings
  (`credit balance is too low`, `credit balance too low`) to the shared
  `exhausted_marker_sql` is accepted: both strings are vendor-published text (research record
  section 2), the failed-terminal gate is unchanged so a successful terminal quoting the
  phrase still classifies as nothing, and the false-positive class is the one every existing
  fragment already carries. The gap stays open, not new: no status-first 402/400/429
  classification and no C12 429 scoping yet (see Gaps).
- **Selection.** Availability is a preference, never a gate: the blocked set is organizations
  whose newest promotional-credit reading is `unavailable`; an unknown organization is never
  preferred against; a funding filter narrows; no match dies with an actionable message.
  Nothing refuses work from an observation, per #598.
- **Mechanical observe helper.** `claude-credit-observe.mjs` calls only the three documented
  endpoints (`/v1/organizations/me`, `cost_report`, `usage_report/messages`), stamps source as
  `anthropic-admin-api:<endpoint>`, copies reported documents whole, and returns typed
  `unavailable` records with the HTTP status and a truncated failure body. The credential
  resolution mirrors the launcher's rules.

## Defects

**D3 (high) — the funding route is recorded untruthfully for three of four launchable
harnesses.** Recording, binding and selection admit `api_key` accounts on codex, omp, muse and
claude-code. The launch honors the route only for claude-code. For omp,
`retained_profile_other` calls `Omp.argv`, which takes no binding — the wrapper is silently
dropped and the session launches on OMP's own authentication while the attempt row says
`api_key` with the secret reference. For muse, `muse_args` is chosen before the binding is
consulted. For codex, the binding does reach `Codex.argv_profile`, but the wrapper hardcodes
`ANTHROPIC_API_KEY`, so codex receives a stray Claude key, no OpenAI key, and its forced-login
subscription path — again recorded as `api_key`. Requirement 2's record becomes false in every
one of these cases. Minimal repair: constrain `api_key` to `claude-code` at record, bind and
select (one predicate change in `harness_launchable` plus a funding check), and say so in the
help text; the general per-harness variable work can follow.

**D-K1 escalation (the conductor's known item 1 is load-bearing for the tests).** `pool` is
absent from `Accounts.run`, and two committed tests call it with success expected:
`test_an_unavailable_observation_keeps_the_condition_and_leaves_the_amount_unknown` and
`test_the_pool_counts_two_accounts_of_one_organization_once`. Both fail on the candidate —
`unknown_action` exits 2 — before any remote run reveals it.

**D4 (test defect, blocks green).** `test_selection_prefers_an_unavailable_free_organization_
and_never_gates_on_a_balance` imports a reported balance without `observedAt`, so
`observe_observed_at` stamps it with the real current time (2026), then imports the
unavailable reading with the fixture's fixed 2025 timestamp. Newest-wins ranking therefore
keeps the reported balance first, the organization never enters the blocked set, and the
asserted `preferredByObservation:false` reads `true`. The product rule is fine; the fixture is
clock-dependent. Fix: stamp `observedAt` explicitly on the fixture imports (make the
unavailable reading the newest).

**D2 (medium) — credentials cannot rotate.** `record` inserts with `ON CONFLICT DO NOTHING`
and no update, rotate or delete action exists. Re-recording a rotated key under the same label
silently keeps the old reference, and every later launch resolves the old credential while the
operator believes the new one is in force. Repair: refuse a re-record whose fields differ from
the stored row (fail closed, name the difference), or add an explicit rotate action.

**D1 (medium, C1 violation) — conflicting same-organization observations produce no conflict
fact.** Observation ids carry the account prefix, so two accounts importing different balances
for one organization both persist — but the pool view ranks and shows only the newest row and
gives no indication that a divergent reading exists. C1 required both values readable and the
conflict named. Repair direction: when the newest observations of one (organization, fact)
within the view carry distinct balances, emit a `conflicting` member listing them with their
sources and accounts; rows already retained make this a read-side change only.

**D5 (medium) — the wrapper changes custody semantics.** The retained handle now owns the
node wrapper; the harness is a grandchild. `stdio: 'inherit'` pipes frames through and the
wrapper re-raises the child's signal on natural exit, but a hard kill of the wrapper
(`force-stop` SIGKILL) orphans the harness, which no keeper tracks. Stop, force-stop and
recovery behavior for API-key launches therefore differ from every other launch. Repair
direction: forward signals and set a process group or `pdeathsig`-equivalent in the wrapper,
and pin the behavior in the remote stop suite.

## Gaps named, not defects at this layer

- C12 status-first classification (402 `billing_error`, spend-limit 400, tier-cap 429
  scoping) is unimplemented; the wording path covers the documented credit stop only.
- Known item 2: the pool read's organization list comes from `credit_observations`, so an
  account with a verified organization and no observation is absent from the pool. No test
  exercises it.
- Known item 3: selection output lacks `creditEligible` and the observation state; an
  older-cycle reported balance is preferred exactly like a current one — a visible consequence
  of the no-deadline rule that the conductor-facing view should surface as the recorded cycle
  it already stores.
- Known item 4: the check-native.sh and record-native-checks.py additions register the new
  suites; the justification is undocumented in the commit.
- C10's UI seam is unpinned — no UI reads balances yet; the storage and fixture layer pins
  decimal text including the #711 token (`0.123456789012345678901234567890` is a passing law).

## Test qualification (the conductor's question)

`bend2/test/account-credits.py` drives the built coordinator binary through the
control-identity helpers (`.scratch/bend2/baton2`); it cannot run interpreted and is one of
the remote-selected suites (`record-native-checks.py`). `bend2/test/account-credits.bend` is a
pure Bend fixture compiled and run by check-native.sh with the toolchain alone.

- Red on the parent: **all nine** Python tests — the parent has no `account` verb, so every
  test's first account call exits 2 under the success-asserting helper. The laws fixture fails
  to compile on the parent (`accounts.bend` does not exist).
- Red on the candidate by trace: **three** — the two pool tests (D-K1) and the selection test
  (D4). The remaining six trace green: record/read round trip with the organization unknown,
  record refusals, harness-matched binding, organization verification with source and
  authority, import refusals (unverified organization, prose, negative, exponent, double dot,
  empty) and the accepted import, and the launch-time attempt record with its executions join.
- Remote gate: the binary is built first by the existing flow; a suite run that skips (missing
  binary) prints a non-identity line and exits 1 under the selection gate.

## Evaluator separation

No build, no compiler check, no behavioral suite and no focused run has executed for
`393cf9d`. Every red/green statement above is a code-path trace against the parent's and the
candidate's sources. The remote compiler slot owns the first real verdict; the trace
predictions above are what it should confirm or refute, and D3/D4/D-K1 predict candidate-red
tests that the worker can repair before that slot is spent.
