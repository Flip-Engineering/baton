# Account and API-credit system: independent critic audit and repair specification

Status: review record, 2026-10-16, seat accounts-glm (ensemble `account-credit-product`).
Source: isolated Git snapshot commit `dd62ce8` (integrated Bend2 `180a4b1388bfe1f0d164e19d17636c2f73e975b2`,
tree `5dc08f12d8de3ff4212a4ba732eeaea04d3c7147`). Issues #793, #702, #681, #694, #703, #711 and #792
were read in full from the tracker. Official sources were read on 2026-10-16:

- https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans
- https://platform.claude.com/docs/en/manage-claude/usage-cost-api
- https://platform.claude.com/docs/en/api/errors

This audit covers source contracts only. It names no executable, installation, or live provider
proof. The preserved provider694 sessions and their raw model streams were not accessed. Account
and Console organization identities are unknown at this commit; a browser sign-in identifies no API
organization, so every account-to-organization fact below stays an unverified unknown until root's
verification records it.

## 1. Existing contracts the credit system builds on

**A1 — Account profiles bind credential directories.** `Profile{harness,label,store}`
(`bend2/src/coordinator/subscription-fallback.bend:16`). The operator list `<db>.profiles` is an
ordered plain file; the per-session record `<db>.profile-<hex(id)>` is append-only and its last
line is the binding in force (`subscription-fallback.bend:270-284`, `turn.bend:855-872`).
`store_variable` maps `codex` to `CODEX_HOME` and `claude-code`/`claude` to `CLAUDE_CONFIG_DIR`
(`subscription-fallback.bend:90-91`). The record harness set is closed:
`{codex, omp, muse, claude-code, claude}` (`subscription-fallback.bend:130-131`).

**A2 — Launch carries environment bindings as argv elements.** The retained launch builds
`/usr/bin/env BATON_DATABASE=... BATON_SESSION=... BATON_ATTEMPT_DIRECTORY=...` plus the harness
argv (`turn.bend:932-948`). The profile route prepends `/usr/bin/env -u ANTHROPIC_API_KEY
-u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN` and then the store assignment
(`bend2/src/harness/claude-player.bend:27-43`). The C layer spawns with
`posix_spawnp(..., environ)` and takes no environment parameter
(`bend2/src/host/process-spawn.c:161,633`; `bend2/src/host/process.bend:5`). Every per-session
environment override therefore travels in process arguments, visible to `ps` for the child's
lifetime. Directory paths in argv are public facts; secret values in argv are a disclosure.

**A3 — Exhaustion classification is wording-based on failed terminals only.**
`exhausted_marker_sql` matches Codex, OMP and Claude subscription-limit wordings plus the generic
`insufficient balance`, `out of credits`, `spend cap`, `spend limit reached/unavailable`,
`quota exceeded` fragments, and only on a genuinely failed terminal frame: Codex `turn.failed`,
Claude `result` with `is_error=1` (the frame carries `api_error_status` since CLI v2.1.110), OMP
`agent_end` with `stopReason:"error"` (`subscription-fallback.bend:231-268`). A successful result
that quotes limit words classifies as nothing.

**A4 — Transient provider errors stay on the same account.** Settled OMP rate refusals
(`errorStatus=429` on the error terminal), socket closures, and Muse transport timeouts continue
on the same binding and record the failed turn with its cause
(`subscription-fallback.bend:361-381`, `receive.bend:512-562`).

**A5 — Same-harness handoff keeps the conversation; cross-harness handoff drops only the
incompatible native binding.** `advance_profile` appends the next operator-listed profile, records
a `profile-handoff-<label>` report carrying the provider cause, and preserves the provider history
home through the packaged `native-history.mjs` helper
(`subscription-fallback.bend:311-545`). `clear_incompatible_native` sets `sessions.native=''` only
when the harness changes (`subscription-fallback.bend:846-856`); old attempt, event, request and
history rows stay. Cross-harness route selection reads `<db>.routes` in operator order and a
per-session refusal lineage whose entries carry an exhaustion-epoch marker (latest turn rowid) and
a task-assignment marker (latest message seq); a later non-exhausted terminal or a new task
assignment ends the episode (`subscription-fallback.bend:547-814`). Opus models run only on the
`claude-code` harness (`subscription-fallback.bend:626-636`). Exhausted-list and no-route outcomes
write `profile-exhausted` and `route-unavailable` reports; the task stays retained with its owed
input, and the direct-turn path wakes the conductor (`subscription-fallback.bend:816-844`,
`turn.bend:1194-1220`).

**A6 — Receipts and re-entry.** Continuation guidance is written only when the session's inbox
holds nothing owed at cursor `0` (`receive.bend:496-510`); no receipt is reset and no operator
task is repeated. The failed turn stays recorded with the provider cause. Reports addressed to a
stopped session follow its parent handoff (`wake.bend:32-42,76-83`), so an all-accounts-exhausted
report reaches the conductor.

**A7 — Observation honesty.** `observed-usage SESSION` copies the provider document whole with
`observedAt`, `command`, `argv` and named failure conditions, and restricts provider queries to
the `omp` harness (`bend2/src/coordinator/usage.bend:240-312`). The recorded projection leaves
source-absent components absent, sums a component only when every observation states it, lists
conflicting repeated identities by signature, and counts malformed lines
(`usage.bend:105-238`). Model discovery supports codex/omp/muse and reports `unsupportedHarness`
otherwise (`usage.bend:348-409`).

**A8 — Numeric fidelity precedent.** #711 and its correction `966e593c` preserve authored numeric
tokens through reads, storage and rendering; `0.123456789012345678901234567890` survived the full
native path unchanged. Balances, costs and expiry instants are quantities in the same class.

## 2. Official funding facts the product must encode

From the support article (read 2026-10-16):

- Monthly promotional API credits: Max 5x $100, Max 20x $200; Team pools $20 per Standard seat and
  $100 per Premium seat, capped at $500 per month, computed from seats at deposit time.
- Eligibility: active Max or Team plan, seven days on the plan, claimed by linking one Console
  organization from claude.ai billing settings. One Console organization per plan; each
  organization receives credits from only one plan; self-service link changes are unavailable.
- Mechanics: credits refresh each billing cycle, do not roll over, are spent before purchased
  credits, and are shared by every API key in the linked organization. Balance and expiry appear
  in Console Settings > Billing.
- Coverage: Claude API, Message Batches, Playground, Claude Managed Agents, Claude Agent SDK.
  Self-run `claude -p` and Agent SDK runs billed as Agent SDK usage are covered when authenticated
  with an API key from the linked organization. Subscription-authenticated runs draw plan usage
  limits. Claude Code interactive surfaces, the GitHub Action, IDE extensions and the desktop app
  draw Claude Code usage even with `-p`. Bedrock, Vertex AI and Foundry are separate products.
- When credits are gone: purchased credits or auto-reload continue the spend; otherwise API
  requests stop until the next deposit; subscription usage is never charged.

From the Usage and Cost API page: the Admin API exposes
`GET /v1/organizations/usage_report/messages` (token usage buckets) and
`GET /v1/organizations/cost_report` (costs in USD, decimal strings in cents), authenticated by an
Admin API key (`sk-ant-admin01-...`), an OAuth token with `org:admin` scope, or an unscoped
personal or service account key; workspace keys are rejected. No remaining-credit endpoint is
documented on either official page. The documented exhaustion surfaces in the errors page are:
HTTP 402 `billing_error`; HTTP 400 `invalid_request_error` when usage reaches an organization or
workspace spend limit (Claude Code workspace spend limits can return 429); HTTP 429
`rate_limit_error` for organization rate limits and tier monthly spend caps, where the tier
spend-cap 429 carries no `retry-after` and keeps failing until access resumes.

Consequence for #793 requirement 4: the supported balance sources are the Console billing view and
operator import. The Usage and Cost API supports external-spend reconciliation and usage
observations. A remaining-balance endpoint is unnamed in official documentation at this date; the
product records that fact and names each observation's provenance.

## 3. Findings and precise repairs

**F1 — No funding-route or organization identity exists.** A1's profile is
`(harness, label, credential directory)`. #793 requires explicit provider, account and
organization identity and a funding route per account. Repair: extend the account record with
`provider`, `account identity`, `organization identity`, `verification source`, `verification
time`, `funding route` (`subscription` or `api-key`), and for `api-key` a secret-store reference.
Keep the credential directory for store-bound profiles. The harness set and sidecar formats are
extended compatibly: new fields ride new appended record shapes or a parallel account sidecar, and
A1's legacy-line rules keep parsing old lines.

**F2 — An API-key route bound through argv would publish the key.** A2 shows the only existing
environment mechanism. Repair: add a mechanical host boundary that applies a child environment map
resolved from secret references at spawn time, inside `process-spawn.c`, so the resolved value
exists in the child's environment and in no argv element, no Bend2 `String`, no database row, no
message body, and no log. Precise ABI: `ProcessChild.spawn_with_secrets(secret_spec_path, argv,
cwd, stderr)` where `secret_spec_path` names a 0600 file of `NAME=REFERENCE` lines (references,
never values); the host resolves each reference through the system store, applies `setenv`, spawns
with the resulting `envp`, and reports typed failures (`missingReference`, `unresolvableReference`
with the store's own code, `specUnreadable` with the filesystem code). The spec file is removed by
the host before the first child output is read. Failure causes surface through the ordinary
attempt-failure path with their original codes. This is a mechanical byte-level operation, which
the product language/policy boundary permits.

**F3 — Credit-exhaustion classification misses the API surfaces.** A3's marker list covers
subscription wordings and one generic balance fragment. The documented API-key funding failures
are the 402 `billing_error`, the spend-limit 400, and the tier spend-cap 429 without
`retry-after`. Repair: extend classification by frame shape and status first — a Claude `result`
frame with `is_error=1` and `api_error_status` 402, or a spend-limit 400, classifies as
funding exhaustion for the account that owns the failing credential; the tier spend-cap 429
classifies as account exhaustion for the API-key route while the OMP `errorStatus=429` transient
rule (A4) stays scoped to the OMP frame shape it was observed on. Wording fragments extend only
from an observed, fixture-identified provider terminal, per the repository's observed-failure
rule for mechanisms. The observed text is retained whole in the failure record either way.

**F4 — Organization-pooled accounting needs one pool per verified organization.** Repair: credit
observations are recorded against the organization identity, and the org view deduplicates
account views of one organization. One observation record carries: organization identity, observed
balance or explicit `unknown`/`stale` state, units and currency, expiry instant, billing-cycle
anchor, refresh and source identity (`console-billing` | `operator-import`), observing account
label and credential reference, and `observedAt`. Two accounts of one organization produce one
pool view; simultaneous conflicting values from one organization are recorded as a conflict fact
in the A7 signature-conflict style. An Admin-API-derived spend or usage record is a separate
sourced observation and never rewrites a balance.

**F5 — Balance is never derived.** No product path computes a balance by subtracting observed or
estimated spend from an assumed or imported grant. The balance field exists only when an import
or Console observation supplied it. A model-produced number in any transcript is text, and no
source of kind model output exists. This is the seed lesson applied: a high-entropy value carries
no provenance, and provenance is the only admissible origin for a balance.

**F6 — Per-attempt account and funding-route persistence.** The session profile sidecar names the
binding in force, and continued attempt directories already carry the `.continued-<label>` suffix
(`turn.bend:1129-1136`). Repair: record `(account label, funding route, credential reference)` in
each attempt's own record at admit time, so every attempt row identifies the exact account and
route that ran it, independent of later advances. Handoff reports remain the human-readable
lineage; the attempt record is the queryable one.

**F7 — Account observation commands are a new family.** A7 restricts provider queries to `omp`.
Repair: account and organization observations ride their own command family with the A7
discipline — whole documents, `observedAt`, actual argv, named failure conditions, explicit
unknowns. A Claude credential's supported observations are the Admin-API usage and cost reports
(when the operator supplies an Admin credential reference) and the operator's Console/import
balance entry. The product documents per source what it can and cannot observe, and unknown stays
unknown.

**F8 — Decimal fidelity for money.** Repair: balances, credit amounts and costs are stored,
compared and printed as the recorded decimal strings with their units, in the A8/#711 fidelity
class. Currency is a recorded field; no conversion is performed without a sourced rate
observation, and the default is no conversion.

## 4. Eligibility policy for credit-funded routing

A native attempt is credit-eligible when all of these hold, each recorded as a fact:

1. The selected account's funding route is `api-key` and its credential reference resolves at
   launch (F2).
2. The workload is the self-run headless path Baton already spawns: `claude --print` with the
   API key from the linked organization.
3. The organization identity is verified (root's account-to-Console mapping), and the latest org
   balance observation is fresh or explicitly stale — staleness routes with a stale flag, an
   unknown balance routes with an unknown flag, and the flags appear in the attempt record and in
   the conductor-facing view. Availability never gates admission: an exhausted or invalid route
   produces the actual provider failure and the A5 fallback path, and the conductor wakes on
   all-routes-unavailable.

Subscription-bound profiles (`CLAUDE_CONFIG_DIR` OAuth login, A2's strip list) route as
`subscription` funding and draw plan usage; they are recorded under their own funding route.
Claiming, linking, purchased credits, auto-reload and billing changes are operator actions;
Baton records their verified outcomes.

## 5. Counterexample fixtures required for acceptance

Each names the behavior that fails if the implementation is wrong. Fixture data is
fixture-identified; no live account values.

- **C1 same-org dedup:** profiles `max-a` and `team-b`, both verified to organization `org-fixture-1`;
  one balance import under `max-a`; the org view reports one pool with source, `observedAt` and the
  observing label; a second observation under `team-b` with a different value records a conflict
  fact and both values stay readable.
- **C2 provenance:** a transcript line containing "you have $184.32 remaining" produces no
  observation of any kind.
- **C3 stale and unknown:** an observation whose billing-cycle anchor has passed reads `stale`;
  an org with no observation reads `unknown` with its actual condition; neither is refreshed by
  derivation.
- **C4 external spend:** a `cost_report` observation in USD cents records against the org and
  leaves every balance value unchanged.
- **C5 expiry and refresh:** an expired grant and a new-cycle deposit produce two retained
  observations; the newer is current, the older stays queryable with its expiry.
- **C6 same-conversation fallback:** an API-key claude profile returns a failed `result` frame
  with `api_error_status=402`; the advance selects the next operator-listed `claude-code` profile,
  the native conversation identity is preserved (same harness), the failed frame and its text stay
  in the original attempt record, and player, parentage, task and inbox are unchanged.
- **C7 all-routes-unavailable:** the last profile exhausts; `profile-exhausted` and (with no
  route configured) `route-unavailable` are recorded, the task stays retained with owed input,
  and the conductor wakes through its report recipient.
- **C8 credential confinement:** an `api-key` launch argv contains the reference name and no
  key value; the resolved value is absent from the database, every message and report body, the
  attempt directory files, and the observer stream. The host ABI test spawns a probe child that
  prints its own environment and argv, and asserts the value's presence and placement.
- **C9 concurrent isolation:** two sessions advance independently on two accounts of one
  organization; one session's exhaustion leaves the other session's binding and record untouched.
- **C10 decimal fidelity:** an imported balance of `0.123456789012345678901234567890` USD reads
  back identically at the CLI, in the org view, and after a UI round trip.
- **C11 inbox owed across exhaustion:** an exhaustion terminal arrives while an unacknowledged
  task sits in the inbox; the continuation writes no guidance, the owed input keeps its receipt
  state, the handoff report still records, and the resumed attempt reads the owed input exactly
  once.
- **C12 429 scoping:** an OMP `agent_end` terminal with `errorStatus=429` continues on the same
  account (A4); a Claude `result` terminal with `api_error_status=429` and the tier spend-cap
  shape on an `api-key` profile classifies as account exhaustion and advances. Neither case
  matches the other's rule.

## 6. Boundaries of this audit

The provider694 Muse conductor, DeepSeek worker and GLM critic sessions and their unfinished
handles are preserved locally and were not opened; the contracts above derive from this snapshot's
source and the public tracker. Native runtime `Main11` may predate every contract here; source,
tests, executable, installation and live provider proof remain distinct claims, and this record
asserts only the first two. Compiler, build and test execution is remote and coordinates the
single compiler slot with the release and compiler operators.
