# G2 repair re-review and G3-G6 adjudication

Status: adjudication record, 2026-10-17, seat accounts-glm, answering conductor guidance
`message:accounts-wonder:e5d2e39757b05763814bb8ff2dc4ca4e` and
`message:accounts-wonder:fd6bb1812c1cecc3b36e3d571f576abc`. Part one re-reviews the G2 repair
`1658d45` on `account-credit-base` (parent `895f995`); part two adjudicates G3-G6 from
`reviews/account-credit-gap-review-20261017.md` at `3db1098`. Ruler: this seat's contracts
(F1-F8, C1-C12, A5-A6 semantics). Evaluator separation at the end: nothing built or run.

**Ruling summary: the G2 repair is accepted — it implements the required shape with no
straggler callsites and a regression test that asserts every contract element; one residual
(R-G2a) is recorded. G3-G6 adjudication: G3 accepted (low + medium), G4 accepted (medium, two
checked-in contracts disagree), G5 accepted as known-open, G6 accepted (two-line fix). None of
G3-G6 blocks spending the remote slot; the bundle pin `1658d45` is confirmed. G2 blocked
acceptance and its repair now precedes the build, so one slot spend at `1658d45` can validate
everything.**

## Part one: the G2 repair (`1658d45`) re-reviewed

The defect (flash review G2, verified independently by the conductor and by this seat's source
reading): `account bind` puts an account in force through the account sidecar, the launch
prefers it, and the only exhaustion advance wrote the profile record — so an account-bound
session relaunched on the refused credential while the handoff report named a profile change.

The repair, checked against the required shape this seat stated:

- **Sidecar-not-profile write.** `advance_account_decided` appends the next account label to
  the account sidecar; the profile record is untouched on this path. The next
  `retained_prepare` reads the advanced label, resolves the next secret reference, and
  `record_current_attempt` names the next account beside the new attempt identity — the
  per-attempt record stays truthful, which was the core of requirement 2.
- **Refused-account exclusion and next-match selection.** `next_account_after` walks the
  operator's recording order (the account table's rowid order), skips forward until the
  refused label, and takes the first later account matching the session's harness through
  `account_matches` — which carries the `funding_route_ok` constraint, so a Muse dedup-style
  impossible pairing cannot be selected. The refused account is reached only through the
  seen-gate and cannot match again. The empty funding filter is deliberate and correct:
  harness compatibility is the launch constraint; funding preference between matching
  accounts remains the conductor's reading.
- **All-exhausted fact and conductor wake.** No next match writes the `account-exhausted`
  report carrying the harness, the refused account and the provider cause, through
  `Subs.report_body` — the report recipient is the session's recorded coordinator, and the
  ordinary admission driver wakes an owed recipient, so the conductor wakes with the task
  retained and owed input untouched. This is the account-layer form of C7.
- **Profile path preserved.** `handoff_decided` routes to `Subs.profile_handoff` exactly when
  no binding is in force; `bound_account` deliberately performs no profile fallback, so a
  session that predates accounts keeps its existing handoff. A grep over the commit shows the
  only remaining `profile_handoff` callsites are its definition and that arm — no straggler.
  All three former direct callsites (receive `completed_observation`, turn
  `direct_second_started`, turn `direct_handoff_checked`) now call `Accounts.handoff`, so the
  retained receive path and both direct-turn paths share one rule.
- **Failure handling mirrors the profile pattern.** A sidecar append failure writes
  `account-append-failed` with the codes, advances nothing, and leaves the provider cause
  standing — the attempt's own outcome, cause and owed input stay as the failure path leaves
  them.
- **Empty-cause gate.** Both arms refuse to advance without a provider-reported exhaustion
  cause, matching `profile_handoff`'s own gate; transient and unrelated failures advance
  nothing.

**Regression test.** `test_exhaustion_advances_the_bound_account_and_records_the_next_attempt`
binds `omp-main`, records `omp-next`, delivers a failed terminal with the documented
subscription-limit wording (matching the shared marker's `hit your ... limit` fragment on a
failed terminal), and asserts: the attempts sequence is `['omp-main','omp-next']`, the second
attempt's `secretRef` is the next account's reference, both rows belong to the session, the
resumed launch carries the same native identity (same-harness advance preserves the
conversation — no incompatible-binding clear exists on this path), and exactly one
`account handoff:` report names the refused account, the bound account and the provider cause.
Red on the parent by trace: without `Accounts.handoff` the profile advance runs with no
profiles listed, the account sidecar is never written, and the attempts assertion fails on
`['omp-main']`. Green on the candidate by trace.

**R-G2a (recorded residual, follow-up):** the cross-harness route trigger
(`route_trigger`) gates on the `profile-exhausted` report identity, so an account-bound
session that exhausts its last account records `account-exhausted` and wakes the conductor
but does not automatically cross to another harness the way a profile-bound session does.
The conductor wake and retained task are intact; automatic cross-harness continuation for
account-bound sessions is the follow-up. R-G2b (noted, consistent with the profile path):
repeated advances across different exhaustion events to the same next label reuse the
`INSERT OR IGNORE` report id, so a second identical handoff report is suppressed — the
profile path has the same shape.

## Part two: G3-G6 adjudication

**G3 — accepted, two parts.** Part 1, low: `json_valid` is computed, bound as `valid`, and
never consulted; `observe` or `import-credit` with non-JSON `--detail` dies on the SQLite
`malformed JSON` error before the typed refusal is reachable. Nothing is recorded either way,
so this is a failure-condition contract break, not an admission hole. Part 2, medium: the
verification UPDATE writes `organization` from `$.document.id` for every reported organization
observation, while `verified_at` is written only when that id is nonempty — a valid document
without an id clears a verified organization and leaves a stale verification time, silently
removing the account from every pool. Repairs are one-line guards: pass `valid` into the
admission predicate; gate both assignments on the extracted id being nonempty (or refuse
`reported` without an id at admission). Neither blocks the slot; both should ride the next
landing.

**G4 — accepted, medium.** Two checked-in documents state different contracts: the
specification promises workload kind, provider outcome with original error text, start and end
times on every attempt record, a state-dependent route vocabulary, a `credit-refresh` command,
a closed source-kind set and named account fields; the funding document describes the
implemented surface, which stores a static route, a free-text source and none of those attempt
facts. The reconciliation rule this seat set: the attempt record must let a reader reconstruct
what funded the attempt and what was known at selection. Recommended resolution: amend the
attempt record with workload kind, outcome, error text and times; keep the binary funding
route plus the selection-time observation state instead of the three-way vocabulary (same
information, no migration); describe the operator-run helper as the specified refresh
mechanism; close the source-kind set; then amend whichever document loses. Non-blocking for
the slot; blocking for acceptance.

**G5/C12 — accepted as known-open.** This is this seat's F3/C12, recorded as a required
follow-up before the gap review read it. The wording path classifies the documented credit
stop; the status-first 402/400/429 classification and 429 scoping remain required before #793
closes. Non-blocking for the slot; no test covers it yet.

**G6 — accepted.** Verified against `895f995`: SELECTED names `account-credits.py` and
`turn.py`; `logs.py` and `observed-usage.py` are absent, so the selected target/candidate
verdict never judges the #769 logs tests or the #792 suite even though the candidate suite
runs them. Two lines fix it; it should ride the next landing. Non-blocking for the slot — the
conductor's bundle request already names both suites — blocking for the completeness of the
landing verdict.

**G1 — agreed.** The absence of execution evidence is the state every seat records; the single
named remote bundle is the remedy.

## Slot ruling and bundle pin

**The bundle pin `1658d45` is confirmed** — it is `account-credit-base` HEAD and carries the
G2 repair with its regression test. With G2 landed, nothing remains that must precede the
slot: **the slot may be spent now at `1658d45`** with the named bundle
(`check-native.sh`, `account-credits.py` — now thirteen tests including the G2 regression —
`logs.py`, `turn.py`, `observed-usage.py`, the laws fixture). G3's guards and G6's two lines
are small enough to fold into a pre-build commit if the conductor prefers a complete landing
verdict in one run; otherwise they land after and ride the next validation. G4's document
reconciliation proceeds in parallel and blocks acceptance, not the build. G5/C12 remains on
the post-acceptance list with the other recorded follow-ups (C1 basis fields, C6
shared-execution marking, R1 readings columns, R-G2a route trigger).

Expected on this HEAD per the traces: thirteen green account-credit tests, the new models-all
test green, the existing observed-usage suite green, three green #769 tests, and the laws
fixture compile+run.

Evaluator separation: no build, compiler check, behavioral suite or focused run has executed
for `1658d45` or any commit this record names. Every red/green and behavior statement is a
code-path trace; the remote slot owns the first real verdict, and this record predicts what it
should confirm or refute.
