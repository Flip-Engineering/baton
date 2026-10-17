# #792 implementation review: commit `44db78d` on `account-credit-base`

Status: critic review record, 2026-10-17, seat accounts-glm, requested by conductor
accounts-wonder (task `message:accounts-wonder:e52fc0ac1921523edcfe7a3ee7480760`). Diffed
`44db78d` against `c393c23` and checked against the design critique in
`reviews/model-discovery-792-design-critique.md` (C1-C6). Evaluator separation at the end:
nothing built or run.

**Verdict: approve for the remote bundle, with one new defect to fix in the next landing
(D-M1: the Muse dedup omission) and three residuals (R2, R3, R4), none blocking the build.**
The per-session read is behavior-identical, the absent/empty distinction is correct, no
secret reference reaches any output surface, and the new test traces red on the parent and
green on the candidate.

## 1. Per-session behavior unchanged by the refactor

The old `models_command` computed the argv, produced an unknown answer for an unsupported
harness or an empty recorded command, and otherwise queried and printed through
`models_query`. The new code splits the same expressions into `models_answer` (the branch
selection, identical predicates and identical unknown shapes with the identical argv
argument) and `models_query_answer` (the run plus `models_result`, verbatim). `models_print`
is untouched, and `models_command` is now `models_answer` followed by `models_print` — the
same three outcomes, the same fields, the same `observedAt` stamping. `models_query` had
exactly one callsite; its removal breaks nothing. The existing per-session tests (the codex
`debug models` read and the unparseable-catalog case) still exercise this path unchanged.

## 2. Dedup correctness

- **Endpoint forms:** the command derivation in `models_sources_sql` is the same CASE the
  single-session read uses in `harness_command_sql` — `json_valid` guard, nine-element
  receiver form takes index 4, seventeen-element takes index 12, everything else empty — so
  `models-all` and `models --session` can never disagree about what command a session
  records.
- **Workspace NULL:** `coalesce(workspace,'')` groups NULL and empty workspaces together, and
  the collected source runs an empty cwd at the process default (`"."`), so grouping and
  execution agree: two default-workspace sessions produce one query at the same effective
  directory.
- **D-M1 (new, medium): the partition key omits `model`, and the Muse query is
  model-dependent.** `Muse.models_args` builds `model-profile show <model>`
  (muse-player.bend:4-5). Two Muse sessions sharing command and workspace with different
  models collapse to one ranked row, one query shows only the representative's model, and the
  other Muse source disappears from the set entirely. Codex and OMP catalogs are
  model-independent, so they are unaffected. Repair: add `model` to the partition key (one
  line; an extra identical query per model variant for codex/omp at worst, or scope the extra
  key to Muse). Required in the next landing, before #792 closes; it does not invalidate the
  other assertions in this commit.
- **R2:** a source row whose fields break the unit-separator split is silently dropped
  (`models_collect_fields`'s catch-all skips it). Unreachable in practice — session ids are
  hex and the harness set is closed — but a workspace or command containing U+001F would
  vanish without a trace. If it is ever hardened, the row should surface as an unknown source
  with its cause.

## 3. Accounts table absent versus empty

Correct and tested on the absent side. `models_accounts_state_sql` counts `sqlite_master` rows
for `accounts`: zero rows mean the table was never created, and the section reads
`{"state":"unknown","reason":"noRecordedAccounts","accounts":[]}`; one or more rows mean the
table exists and the section reads `state:"reported"` with the recorded accounts, which is an
empty array when no account is recorded. The distinction matters because `models_all` does not
install the account schema — it reports the absence as a fact instead. R3: the empty-table
`reported` side has no test; one assertion would pin it.

## 4. Secret-reference leakage: none

Every output surface was swept: source rows carry id, harness, model, workspace, command;
source answers carry the `models_answer` fields (schema, state, session, harness, command,
argv, workspace, requestedModel, response/raw, reason, observedAt); the accounts projection
carries label, provider, harness, funding, organization, organizationKnown; the capability
fields are constants. `secretRef` appears nowhere, matching the design's rule and this seat's
narrower-projection requirement — the implementation did not reuse `account_object_sql`.
Command paths do appear, exactly as they already do in the single-session read.

## 5. Test trace

`test_models_all_aggregates_each_distinct_source_and_names_absent_assessments` calls the
binary as `[EXE, DB, "models-all"]`. On the parent, `models-all` is an unknown verb — the CLI
exits nonzero and the first `returncode` assertion fails: **red on parent**. On the candidate:
the top-level parse (`parse_verb_only`) yields `ModelsAll{}`; the OMP source answers
`reported` with the fixture catalog and its own `observedAt`; the attached Muse session
records no endpoint command and answers `unknown` with `noRecordedHarnessCommand`; the
accounts section reads `unknown`/`noRecordedAccounts` because the fixture database never
installs the account schema; the capability fields are the constants; and the provider stub's
`queried.json` holds exactly one invocation (`models --json` in the recorded workspace),
pinning the dedup. **Green on candidate by trace.** The agent-form entry was also traced:
`models-all` is in `Domain.known`, so the `as SESSION` form parses through
`Domain.parse` → `Call` → `agent-native` → `["models-all"]` → the same top-level parse. Both
public forms reach `models_all`.

## 6. Design-critique resolution

C2 resolved by construction: account-only sources are a separate identity section rather than
fake query answers, with exactly the narrow projection the critique required. C3 resolved
structurally: every source answer flows through `models_answer`, whose unsupported branch
yields the explicit `unsupportedHarness` unknown — a claude-code source can only ever read as
unknown, never silence. C1 remains partially open (R4): the sections are implicitly typed and
carry no explicit enumeration-basis counts; acceptable at this layer since the sections are
disjoint, and the basis fields stay on the follow-up list together with the routes-list third
source. C6 (shared-execution marking) is unaddressed: a group of sessions sharing one query
shows one source entry, and the reader is not told other sessions share it.

## Remote bundle

This review confirms the bundle update the conductor requested: add
`bend2/test/observed-usage.py` to the requested remote runs; the pin is `account-credit-base`
HEAD `44db78d` (changes since `06c67c1` are the two docs commits and this commit). The same
build should run: the native build of that HEAD, `account-credits.py`, the
`account-credits.bend` laws via check-native.sh, `observed-usage.py`, and the #769 suites
(`logs.py`, `turn.py`). Expected on this HEAD per the traces: twelve green account-credit
tests, the new models-all test green, the existing observed-usage suite green, three green #769
tests, and the laws fixture compile+run.

## Evaluator separation

No build, compiler check, or behavioral suite has executed for `44db78d`. Every red/green and
leakage statement above is a code-path trace over the commit's sources. The remote slot owns
the first real verdict; D-M1 predicts one under-reported Muse source in multi-model Muse
fleets, which the current fixture cannot exhibit (it uses one Muse session).
