# #793/#702 repair re-review: commit `637f6b6` on `account-credit-base`

Status: critic re-review record, 2026-10-17, seat accounts-glm, requested by conductor
accounts-wonder (task `message:accounts-wonder:f1b4408d0b2e91ed2915daec9c01a9dc`). Diffed
`637f6b6` against `8738708` (the tree my implementation review covered, plus the mirrored review
commit). Every repair is verified against the defect definition it claims to close; the expanded
suite is traced; the conductor's three specific questions are answered. Evaluator separation at
the end: nothing is built or run; the remote slot is the first real verdict.

**Verdict: approve. All eight claimed repairs close their defects; the twelve-test suite traces
green on this commit and red on every earlier tree. The residual notes R1-R3 below are recorded
assumptions and a bounded false-positive, none blocking. The conductor may request the remote
build slot for the named bundle.**

## Repair-by-repair verification

**D-K1 (pool unwired) — closed.** `run` dispatches `pool` to `pool(db,organization)`;
`unknown_action`'s message and the `account` help text list it. The two tests that call
`send('pool', ...)` now execute against real behavior.

**D1 (no conflict fact) — closed, with residual R1.** Each pool fact entry now carries
`conflict` — JSON true when more than one distinct nonempty reported balance exists for the
(organization, fact) — and `readings`, the full set of distinct reported readings
(balance, unit, source, observedAt, authority). Both divergent values stay readable in the view
and the divergence is named, which is what C1 required. R1: the distinct count spans cycles, so
a legitimate cross-cycle refresh (a different balance for a new cycle) flags `conflict:true`,
and `readings` omits the cycle and the observing account. Conflicts never gate anything, and
the raw rows keep the full facts; suggested follow-up is scoping the count to the newest cycle
and adding the cycle to each reading.

**Known item 2 (account-only organizations) — closed.** The pool's organization list is a UNION
of organizations present in `credit_observations` and nonempty organizations present in
`accounts`, both under the same `where` filter, so a verified organization with no observation
appears with `observationState:'unknown'` from the new three-way CASE
(`reported` when the newest promotional observation is reported, `unavailable` when it is
unavailable, `unknown` when none exists).

**Known item 3 (selection facts) — closed.** `org_observation_sql` reads the newest
promotional reading per organization as `state<US>cycle`, defaulting to `unknown` with an empty
cycle; `selection_json` adds `creditEligible` (api_key funding with a nonempty organization —
the audit's eligibility predicate), `observationState` and `creditCycle`.
`selection_fields_json` degrades to `unknown`/empty on a malformed split, so the read never
dies on its own projection.

**D3 (funding route recorded untruthfully off claude-code) — closed at three layers.**
`funding_route_ok` admits `api_key` only with `claude-code`; `record` ANDs it into admission, so
the lying row can no longer be created; `account_matches` ANDs it into selection, so a
hand-crafted or legacy wrong row is invisible to selection; `launch_binding` returns no binding
for `api_key` off claude-code, and the existing `retained_launch_arguments` refusal then stops
the launch fail-closed before any spawn — an attempt row may exist for such a legacy selection,
but no execution row does, which is the honest unstarted-spawn attribution the contract requires.
The refusal message names the missing resolver rather than the constraint (R2: wording only,
reachable only through a hand-crafted database, since recording now refuses the combination).

**D2 (rotation silently ignored) — closed.** `record` first reads
`record_state_sql` — `new`, `same`, or `different` by exact field comparison — and
`record_decided` refuses `different` with a message that names the rule and suggests a new
label; `same` re-prints the stored row; `new` inserts. The stored reference therefore cannot be
silently displaced. The conductor's flow question is confirmed: `run` calls `ensure(db)` before
dispatch, and `ensure` creates the module tables when absent, so `record_state_sql`'s read never
meets a missing relation, and the state read strictly precedes the insert.

**D5 (wrapper grandchild escapes custody) — closed for the reachable stop paths, residual R3.**
The harness now spawns `detached`, leading its own process group, and the wrapper forwards
SIGINT, SIGTERM and SIGHUP to that group (`process.kill(-child.pid, signal)` with a direct-kill
fallback), so a stop signal reaching the wrapper takes down the harness and anything it
spawned. The wrapper sits outside the child's group, so it survives its own forward and still
reaps the exit. R3: a SIGKILL delivered to the wrapper remains unforwardable by construction —
the orphan window shrinks to the hard-kill path only, which the graceful-first stop order
reaches last.

**D4 (fixture clock) — closed.** The reported import in the selection test now stamps
`observedAt=...001` and the later unavailable reading keeps `...004`, so newest-wins ranking is
fixture-determined: the unavailable reading ranks first, `org-max` enters the blocked set, and
the asserted `preferredByObservation:false` is produced by the fallback tier. That fallback is
itself verified: `select_preferred` filters blocked accounts out of the preference tier while
`select_matching` ignores the blocked set, so a fully-blocked harness still selects its
operator-ordered account — "a preference key, never a gate" holds in both directions.

## New tests

`test_api_key_funding_records_only_for_the_claude_code_harness` (record refusal + empty read),
`test_rerecording_a_label_with_different_fields_is_refused` (same re-record idempotent,
different refused, stored reference unchanged), and
`test_the_pool_names_conflicting_readings_and_unknown_credit_state` (unknown state from the
UNION arm, then two same-cycle imports with explicit stamps producing `conflict:true`, both
readings listed, and a selection with `creditEligible:true` and `observationState:'reported'`).
All three trace green on this commit; the conflict test's assertions match the SQL field by
field, including `json('true')` parsing to a real JSON boolean for `assertTrue`.

## Twelve-test trace on the candidate

Green by code-path trace: record/read round trip with the organization unknown; the record
refusal matrix (label, provider, harness, funding, reference — all refused before any write,
verified empty read); the new harness-constraint test; the new rotation test; harness-matched
binding; organization verification with source, authority and verifiedAt; the unavailable
cost observation (pool now wired, `external_spend` unavailable with empty amount, organization
reported); the import matrix (unverified organization, prose, negative, exponent, double dot,
empty refused; the good import stored with expiry and cycle); the one-organization-two-accounts
pool count with the explicit-stamp import; the selection preference test under the stamped
clock; the launch-time attempt record with its executions join (omp subscription binding
degenerates to the empty binding exactly as the legacy path); and the new conflict/unknown pool
test. Twelve of twelve green on `637f6b6`; all twelve red on the parent and on `39ca8c1` (no
`account` verb before the checkpoint, and pool/conflict/unknown behaviors absent at the
checkpoint).

## Conductor's specific questions

1. Pool CTE union: verified — both UNION arms carry the same `where`, so a named-organization
   pool read filters both sources; the observationState CASE reads the ranked promotional
   newest per organization.
2. `org_observation_sql`: verified as above, including the empty-cycle `unknown` default and
   the defensive split fallback in `selection_fields_json`.
3. Record flow: confirmed — `run` ensures the schema before dispatch, and
   `record_state_sql` executes before any insert in `record`, so the state read is never
   against a missing relation and never races the admission predicate.

## Same-build #769 scope

`logs.bend`, `logs.py` and `turn.py` are byte-unchanged since `32efd84`; `turn.bend`'s only
delta since then is the account binding seam, which does not touch `filter_mode_sql` or the
`consume` extraction. The #769 review's predictions carry unchanged into the same build:
`turn.py`'s missing-id refusal test and the two `logs.py` snapshot tests red on pre-`32efd84`
code, green on this HEAD.

## Residuals and evaluator separation

R1: cross-cycle refresh flags `conflict:true` and readings omit cycle/account (above).
R2: the legacy off-harness `api_key` refusal message names the resolver, not the constraint.
R3: SIGKILL to the wrapper stays unforwardable; graceful signals are covered.

No build, compiler check, behavioral suite or focused run has executed for `637f6b6`; every
red/green statement is a code-path trace. The remote slot's first real verdict should confirm
or refute: twelve green account-credit tests, three green #769 tests on this HEAD, and the
laws fixture compile+run under check-native.sh.
