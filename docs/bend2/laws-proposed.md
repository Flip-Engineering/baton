# Baton application laws — approved revision 9.1

The operator approved the operative entries reviewed at
`1fab9a1da60db3d5d9c9d3cef89d3caabd68fe35`. The final Codex r9.1 review records
`APPROVED`; the operator authorization is relayed in the bend2-laws-lead4 brief.
M-6 and M-9 are absorbed into M-8, M-15 is deferred, and M-16 remains the repository
writing rule. The law-suitability and no-development holds are superseded.

The operative statements below retain their approved behavioral meaning. Their bracketed
classifications describe enforcement at the historical extraction base. Encoding status,
checked scope, source/test verification and remaining application obligations are recorded
in [laws-trace.md](laws-trace.md).

Historical revision 9 changes follow. Revision 9.1 corrected the design-notes reduction
record; routine maintenance here corrects the three historical references identified by the
final review.

What changed, per the r6 review:

- **M-18 incorporated (proposed).** No substitution of a publication destination — the #556
  incident formalized. Codex independently verified the proof shape against the pinned 2.0.25
  compiler (a destination-matching law passes; the mismatching dispatch is rejected).
- **M-4 scoped to both obligations.** Disposal is banned when it violates current custody or
  preservation — the settled-but-unpreserved counterexample no longer escapes.
- **M-5 narrowed to logical preservation; the validation-mechanics clause moved.** Using
  evidence after its state basis no longer holds belongs to M-3a; gate purity is not frozen as a
  law.
- **M-8 completed.** Authority must be valid for the particular resource instance and action at
  the time of effect; the observer-false-claim clause is routed to M-3c where it belongs.
- **M-14's body now requires the safe explanation.** A bare refusal without it no longer
  complies.
- **M-17 clarified.** A continuation owner means actual retained responsibility or a recoverable
  handoff; an authorized suspension names its reason and resumption authority.

Extraction base `bc2e4fcd`; design snapshot `23d3b857`; traces anchor-verified as recorded in
revisions 1–4.

## The admission test

1. What is the specific forbidden behavior?
2. Why must that prohibition bind every otherwise-valid implementation?
3. Does it state only the necessary restriction — would a useful alternative design that
   violates the wording still meet the guarantee?
4. Are scope, premises and authorized exceptional transitions explicit?
5. Could it be satisfied trivially while the intended guarantee fails?
6. Is it consistent with the other accepted contracts and later operator rulings?

(Connection to implementation, proof command and external effect assumptions is the
post-admission proof-mechanics step, tracked in laws-trace.md.)

---

## The approved set

**M-1 · No acceptance claim without recoverable matching intent.** [partly enforced]
Forbidden: acknowledging that managed work has been accepted or recorded unless a recoverable
intent with the same operation identity, committed meaning and admitted authority already
survives a crash and recovery performed now. A retry preserves identity and committed meaning
while the reported state progresses (queued, admitted, completed); a query, a refusal or a
clarification answers without recording and is outside this rule.
Binding reason: callers treat an acknowledgment as "recorded" and build on it; an acceptance that
vanishes on recovery strands every actor that moved.
Evidence: LEDG-3 (keyed replay), LEDG-6 (no durability claim after failed persistence), CS-19
(receipts name their inputs), DEV-2 (the durable half). Partly enforced: identity replay is
tested; the crash-window proposition is not.

**M-2 · An unresolved external attempt stays unresolved until justified.** [proposed]
Forbidden: reporting or acting on an external attempt as succeeded or failed when its outcome is
not established; repeating the attempt except through a justified recovery protocol or a newly
authorized action that accounts for the uncertain attempt.
Binding reason: a lost response after a real effect is a permanent possibility; inventing the
outcome duplicates agents or fabricates evidence. A lost response can be resolved later — the
ban is on inventing, not on eventual resolution.
Evidence: proposed (CX-2); partial enforcement in the ledger's prospective-fold and quarantine
machinery.

**M-3a · Publication carries its authority and evidence conditions for the actual artifact and
target.** [partly enforced; two clauses are proposed — the evidence-staleness prohibition and
the artifact-scoped dirty-tree requirement]
Forbidden: publishing an artifact or moving a target when the applicable review, verification or
repository-authority conditions for that actual artifact version and target state are not
satisfied — including a claimed revision that does not resolve in the named repository, a report
about an artifact whose own tree state is unrecorded (unrelated dirty files are irrelevant), and
the use of review, verification or attribution evidence after the state basis it was recorded
against no longer holds.
Binding reason: review and verification apply to an exact version against a live state basis; a
merge is the act that matters.
Evidence: CL-03, CL-08, CL-12 (completeness half), CL-13 (green and current-head halves), CL-15
(authority), PM-11 (attribution binding), LEDG-15 (the stale-basis clause; its checked-equality
carrier is the gate form); the artifact-scoped dirty-tree clause is proposed (CL-04's
truthful-status stamp is a policy row, carried in the design notes).

**M-3b · No unauthorized duplicate logical effect under one operation identity.** [extracted]
Forbidden: one operation identity producing the same logical effect twice — a second landing of
the same contribution, or a retried append creating a second event. Deliberate reapplication of
a reverted change, or publishing one contribution to several authorized destinations, is not
this ban.
Binding reason: duplicated effects corrupt the target and the record together.
Evidence: CL-14 (once-only), CL-05 (identity disposition), LEDG-3 (keyed replay).

**M-3c · No claiming a new effect that did not occur.** [partly enforced]
Forbidden: reporting a retry as a new landing, or any answer asserting an effect this attempt
did not perform; a read-only observer claiming that its own request performed a change it
merely reports. An idempotent retry may truthfully report the earlier outcome.
Binding reason: false effect claims corrupt every downstream decision.
Evidence: CL-10 (truthful no-op), LEDG-3 (the returned row is the original). Partly enforced:
the ledger half is pinned; the reporting half is carried by the contract.

**M-4 · No disposal that violates custody or preservation.** [extracted]
Forbidden: disposing of workspace work in violation of either obligation that holds over it —
current custody (an unsettled handle, including a terminal handle whose release has not
completed) or preservation (un-captured content of the same workspace generation). Ordinary
disposal requires the current preservation evidence for that generation; a separately authorized
decision to discard work names that disposition explicitly; releasing custody is not itself
evidence of preservation; genuinely disposable files need no preservation ceremony.
Binding reason: work is the product; destruction is irreversible; settled custody without
preserved content still loses the only copy, and stale observations authorize deletions that
look checked.
Evidence: CUST-1, CUST-4, CUST-6 (evidence requirement), CUST-11.

**M-5 · Accepted facts, identities, required ordering and owed events survive recovery,
compaction, replay and delivery.** [partly enforced — the WAKE-5 drop persisted at the
extraction base and is retired per #541]
Forbidden: any of recovery, compaction, checkpointing, replay or delivery losing or altering the
accepted facts, their identities, the required ordering, or an event still owed to a subscriber.
Binding reason: the log and the feeds are what agents act on; physical layouts may change
freely, the agreed facts may not. (The quantified preservation theorem is open work for the
owning lane.)
Evidence: WAKE-3, WAKE-5 (retired row), PROP-2, CL-07, LEDG-1, LEDG-7, LEDG-10, LEDG-19.

**M-7 · No unvalidated assertion acquires authority or established attribution.** [partly
enforced]
Forbidden: trusting a caller-supplied actor, author, reviewer, scope or attribution value as
authority or established attribution without validating it against the authority records under
the applicable authority rules; no particular authority-record store is mandated. Presenting
the value is legitimate — trusting it unvalidated is the ban. A custody or status record asserts
nothing it did not verify.
Binding reason: assertion-based authority is forgery by construction, in any architecture.
Evidence: AB-09, AB-14, CL-02, PM-11, CUST-8, PM-07, AB-05; partly enforced — the derivation
points are tested, the generalized rule is the proposal.

**M-8 · No effect, publication, delegation or grant beyond valid authority.** [partly enforced]
Forbidden: performing an effect, publishing, delegating or granting beyond the authority valid
for the particular resource instance and action at the time of the effect — authority for an
earlier instance cannot authorize an effect on its replacement (generation counters are one
implementation, not a required design); including granting beyond an explicitly held granting
authority (a provisioning role may grant without personally executing), fail-open scope
handling, and exclusive-claim coordination that fails to preserve the approved ownership
semantics. Permitted coordination includes waiting for the holder, serializable transactions,
and compatible subdivisions of the resource (absorbing M-9, whose identifier is retained for
traceability).
Binding reason: one unguarded path undoes the permission model; delegation stays open under
stated granting authority.
Evidence: PM-08, AB-10, AB-11, CAP-12, PR-01 (fail-open), AB-06 (valid-authority transfer),
CL-15, AB-12 (enlargement half), CAP-7, CAP-14, AB-05 (the exact-instance clause), AB-04 (the
exclusive-claim guarantee). Partly enforced: several points tested, the granting-authority
separation is proposed.


**M-10 · No cutoff of valid requested work or owed data without a physically-derived, stated
bound.** [partly enforced — the WAKE-5 drop persisted at the extraction base and is retired per
#541]
Forbidden: stopping, refusing or dropping valid requested work, or owed data, for elapsed time,
queue position, input size or count — unless the bound derives from a physical resource, is
stated with its derivation, and leaves the remainder available with processing continuing. A
physical shortage can justify waiting or a truthful failure; explicit cancellation and the
work's own stopping condition are separate semantics.
Binding reason: arbitrary cutoffs are hidden stop buttons (ruling #541).
Evidence: DEV-1, CAP-2, CAP-3, CAP-15 (as adjudicated), PROP-1, AB-12; the cutoff-audit rows
CAP-17 and LEDG-14 are policy and implementation material, carried in the design notes.

**M-11 · Caller input must not fabricate established facts.** [extracted]
Forbidden: caller input manufacturing established execution, verification or publication facts.
Binding reason: the log is evidence. Overlap note: invented outcomes of uncertain attempts are
M-2; false new-effect claims are M-3c; forged attribution is M-7 — this entry is the boundary
truthfulness of caller-supplied content.
Evidence: CL-17.

**M-12 · No mandatory wait for managed work to finish before its acceptance is acknowledged.**
[extracted]
Forbidden: requiring a caller to remain blocked until accepted managed work completes. Queries,
the durability write that M-1 requires, and an optional caller-selected wait are permitted.
Binding reason: a slow or stuck operation then freezes the caller, and a crash looks like the
caller's failure.
Evidence: DEV-2 (never-wait half), LEDG-6.

**M-13 · Required progress notifications reach the agent's interface without agent-invoked
fetch or re-arm.** [extracted]
Forbidden: required progress notifications being delivered only on an agent-invoked fetch or
re-arm; delivery means reaching the agent's actual interface. Optional history inspection remains
permitted.
Binding reason: an agent that never learns the fetch command waits forever; polling taxes every
agent.
Evidence: DEV-3, WAKE-8.

**M-14 · A refusal states the actual failed rule and safe relevant context.** [partly enforced]
Forbidden: a refusal omitting the safe explanation of what failed, inventing a rule, misstating
the input or state, or fabricating a remedy. A remedy is given when known; an explicitly unknown
or unavailable remedy is valid; protected inputs are not disclosed.
Binding reason: agents act on refusals; an unactionable or dishonest refusal turns one
misformatted field into a dead run.
Evidence: DEV-4; enforcement halves CS-05, CS-16, CS-17.

**M-17 · No silent abandonment of accepted, unsettled work.** [proposed]
Forbidden: detaching an accepted, unsettled operation from every continuation owner without a
terminal disposition or an explicit authorized suspension. A continuation owner means an actual
retained responsibility or a recoverable handoff path — an orphaned identifier pointing to a
terminated worker does not satisfy this by its presence — and an authorized suspension names its
actual reason and its resumption authority or condition; an operator may intentionally pause
work without any external dependency. Deadlines, fairness, scheduler topology and eventual
provider success stay outside this entry.
Binding reason: Codex's counterexample — accept, receipt, then detach from all schedulers; no
cutoff occurs and no caller was held, yet the work is silently abandoned. M-10 and M-12 hold;
this entry is the gap they leave.
Evidence: proposed (CX-6, narrowed per the r5 review; the broader ready-work and temporal-progress
specifications stay in the design notes).

**M-18 · No substitution of a publication destination.** [proposed]
Forbidden: dispatching the publication effect of a publish/integrate operation to any repository
or target other than the canonical shared destination designated by its admitted repository
authority, or treating effects at another destination as completion. A local checkout does not
become that destination merely because `origin` resolves to it.
Binding reason: the reported #556 incident delivered a push to a local intermediary while the
intended shared repository remained behind, and every review check applied to the wrong
repository. None of M-3a (evidence conditions), M-8 (authority breadth), M-3c (honest reporting)
or M-11 (caller facts) excludes it — the substitution arises from local configuration with no
fabricated caller input.
Proof shape: Codex's checked probe (a destination-matching law over a two-destination model
passes with Bend 2.0.25; the mismatching dispatch is rejected) demonstrates the form; the real
law imports the actual Baton2 dispatch effect, with adapter conformance, endpoint identity,
configuration stability and delivery as explicit assumptions. If destination identity cannot be
established before dispatch, the publication effect is not authorized; an uncertain dispatched
outcome stays unresolved under M-2.
Evidence: proposed — the #556 incident and the operator direction relayed 2026-09-21.

---

## Revision 10: no parking pending an external act

Status: accepted by the swarm; external law review accept. The swarm review accepted the entry
on 2026-09-23 (bend2-reviewer4, contribution-2b03cd1a): the encoding is verified at the pin, both
controls fail as required, and the three questions below are answered — the statement is
expressible at the pin as written, the entry meets the law definition, and the law admits the
waits whose waited-on party Baton wakes. The external law review of 2026-09-24
([reviews/kimi-law-review-r10.md](reviews/kimi-law-review-r10.md), verdict accept) independently
re-verified the encoding at the pin, reproduced both controls as failing as required, and
answered the three questions the same way. The entry enters the operative set as the seventeenth
entry.

**Statement.** The runtime never deliberately pauses, idles or truncates an agent's work. No
transition may move live work into a state whose only exit is an explicit act by another party
(claim, nudge, guide, resume decision, review).

**Evidence from current Baton.**

- Commit `89661c1f` (2026-09-12, "fix: preserve native agent capabilities and explicit completion
  authority") changed turn checkpoints so every completed swarm turn parks until an external
  `claim_turn` or `nudge_turn`. The commit carries no issue and no review.
- `c200ced7` forced every swarm participant through that park.
- On 2026-09-23 every live seat of this deployment parked by 06:40 UTC and stayed parked for seven
  hours: work that finished after the last external act was not resumed by the runtime.
- Issue #572 removes the park, and AGENTS.md bans the pattern.

**Operator decision (2026-09-23).** At every turn end Baton wakes the seat's orchestrator (its
parent seat, or the root) with the turn's report, and the orchestrator decides whether to nudge the
seat on. The seat stops when it declares itself done or its orchestrator stops it. Root wake is
#564. The law below is stated in that shape: a live state may wait, but only on a party Baton wakes
to decide it.

**Shape in the rewrite.** The law is stated so a state waiting on a party the runtime does not wake
is unrepresentable rather than merely forbidden. The work state's type names, for every state, the
party the state waits on: the runtime itself, the orchestrator Baton wakes at turn end with the
report, or a party Baton does not wake. A total function answers whether Baton wakes a party, and
the law requires every state's waiter to be a woken one. Neither half can be given up silently: a
state whose waiter the function does not name is refused, and a state parked on an unwoken party
makes the law's obligation unsatisfiable. `examples/laws-no-park.bend` states the model and the
law, and `examples/laws-no-park.evidence.md` records both controls at the pin.

**Questions for law review.**

1. Is the statement expressible at the pin as written, where a state waiting only on an unwoken
   party cannot be constructed beside the law, or does the unrepresentability claim need a stronger
   obligation than the discharged law and its two controls supply?
2. Does the entry meet the law definition (a forbidden behavior with an enforcement anchor), or is
   it tested behaviour that belongs in the trace as a test obligation rather than as a law?
3. Does the law admit the waits that are not parks - a run waiting on a verification lease, a seat
   waiting on a provider retry, a gate run waiting on a runner - where the waited-on party is one
   Baton wakes? The model admits them through the party the state names, and it states no
   obligation that a wait ends without a wake.

---

## Revision 11: no bookkeeping ledgers in place of function

Status: proposed 2026-09-25. The encoding is checked at the pin and its controls fail as
required. The external law review of 2026-09-25
([reviews/astra-law-review-r11-r12.md](reviews/astra-law-review-r11-r12.md), verdict revise)
re-verified the encoding at the pin and reproduced every recorded control. On 2026-09-25 the
operator adopted the refined statement below; encoding is pending. Not part of the operative set.

**Adopted statement (operator, 2026-09-25; encoding pending).** A gate decides from observed
runs only; no gate, test or check reads a hand-maintained record of expected results in place of
running the software: no expected-failure allowance, no converged declaration, no count or
census pin. A judged landing blocks when a failure with the change has no matching failure
identity on the target. Target absence contributes no matching failure. An unjudged target is
reported as unjudged and supplies no matching failure. An unjudged change cannot authorize
landing. Every selected invocation must be accounted for. Failure identity is defined by file, test
where available, failure kind and specified stable semantic code; variable paths and timings
stay in diagnostics. A test that is new with the change has no matching target failure, so its
failure blocks.

**Evidence from current Baton.**

- `impl/scripts/expected-red-tests.json` listed 417 `file :: test name` rows expected to fail
  and 161 `converged` files, measured at master `c66098c1`; the unchanged `impl` at rewrite base
  `770e89e3` carries 451 and 173. These are historical measurements at their commits. The gate
  passed a failure when the manifest listed it. Keeping it current required
  `--write-expected-red` rewrites after landings, and guard tests checked the list itself.
- The #565/#566 chronology: `d1288fd9` introduced the MCP regression and added no manifest rows.
  `c71329c` later added 27 allowances while preparing the #565 repair, and its message and #566
  report those failures on target `65c913f0` too, so a differential comparison against that
  target admits that repair as well. What the earlier green gates depended on remains unresolved
  in the issue.
- #571's fixture-leak rows had run-specific names, so the list could not list them, and every
  broad gate went red until the identity key was fixed; `78123579` stabilized the identities and
  added 125 observed leaking files at that commit.
- Census pins (SI6, `CORPUS_COUNTS`) and count literals in tests failed on every change that
  added a member, and each such change carried a re-pin commit (`83c40b4e` repaired two stale
  SI6 counts after a functional landing). SI6 also asserted corpus coverage; its incidental
  totals are removed and the coverage property is checked directly. `5df1acf5` removed SI6 and
  `CORPUS_COUNTS` and added the AGENTS.md ban; `c66098c1` removed the count literals in five
  further tests (#579). #580 deletes the manifest and re-runs the change's failing files on the
  target; the manifest gate still runs at both reviewed bases, so that deletion is pending.

**Operator decision.** The pattern is banned in AGENTS.md ("No bookkeeping ledgers in place of
function") with the direction "If the solution is removal please remove." On 2026-09-24 the
operator asked for the ban as a Bend2 law; on 2026-09-25 the operator adopted the refined
statement above in response to the review.

**Shape in the rewrite.** The checked model proves a limited result: for fixed supplied outcomes
and a fixed supplied selection, the gate equals the specification `breaks(change, target)` for
every explicit record argument, and landing is the OR of those comparisons. Outcome provenance,
selection completeness, test policy and the application composition remain open; G1 and G2 in
revision 12 carry the runtime-side composition. `examples/laws-no-ledger.bend` states the model
and two laws: `gate_reads_only_observations` (per test, proved by splitting every case) and
`landing_blocks_iff_breaks` (per landing, proved by induction over the selected tests).
`examples/laws-no-ledger.evidence.md` records three controls at the pin:

- A: an expected-failure list. A listed test that fails with the change and passes on the target
  does not block.
- B: a count pin. At pin 0 it blocks a failure the target shares. At pin 1 it blocks a run with
  no failure until the pin is updated.
- C: no comparison with the target. It blocks a failure the target shares.

The pending encoding of the adopted statement adds failure identity, unjudged-verdict
reporting, invocation accounting, and controls for forged outcomes, empty selection, mismatched
failure kinds, missing verdicts and test selection. Selection and test-contract changes do not
authorize omission of their own failures; the repository test-policy clause is enforced
separately.

**Review outcome (2026-09-25).** The review answered the four questions the proposal raised:
the two equalities are laws of the model, and the repository-wide ban needs the composition
above; `Outcome` forgery from an importing module is expressible at the pin (`private type` is
rejected, an open datatype is fillable, an empty one is vacuous) while a scoped abstract
consumer constrains its own side and the trusted provider, execution, freshness and invocation
identity remain obligations; the model carries no failure identity and no unjudged verdict, so
the JavaScript gate's cases (new file, file-level failure, absent verdict) are not represented;
and Failed/Failed admits a change that makes a failing test fail differently. The operator
adopted the comparison policy above in response.

---

## Revision 12: the operator's banned runtime patterns as laws

Status: proposed 2026-09-25. Each encoding is checked at the pin and each control fails as
required. The external law review of 2026-09-25
([reviews/astra-law-review-r11-r12.md](reviews/astra-law-review-r11-r12.md), verdict revise)
checked every submitted model, reproduced every recorded negative control, and demonstrated
adversarial implementations that satisfy each checked equality while violating the entry's
broader wording. On 2026-09-25 the operator adopted the refined statements below; encoding is
pending. The checked model equalities stand as explicitly limited results. Not part of the
operative set.

The operator asked for the banned patterns to be codified as laws. The table maps each operator
ban to the law that carries it, or states why it is not an application law. The operator
adopted the corrected table on 2026-09-25.

| Operator ban | Law |
|---|---|
| No pausing, idling or truncating agents (AGENTS.md, #572) | Revision 10 covers waits on parties Baton wakes; M-17 and 12a carry continuation and cutoff obligations. |
| No bookkeeping ledgers in place of function (AGENTS.md, #579, #580, #582) | G1 and G2 for the runtime's decision and prerequisite composition; AGENTS.md for repository maintenance. Revision 11 carries one comparison rule. The subject includes agent-authored change declarations used to gate check selection (#582). |
| Wake is never an action the agent takes (#529) | M-13 and M-12, with their host-effect obligations; acceptance alone does not ensure eventual execution. |
| Accept now, finish later; no held connection (#541) | M-12, approved. |
| No numeric ceiling or deadline that refuses work, derived or not (#258, #541, #583) | 12a, revising M-10; M-10's data-preservation scope is retained, and removing the physical-bound exception is a new policy decision. |
| Catalogs derived from the harness, never hand-listed (#440, #549) | 12b covers observation and honoring operator policy; provider and model choices are configuration, and the obligation to honor them is application behavior. |
| Leads hold full authority over their own swarm, including landing (2026-09-21) | 12c with M-8, at actual delegation and effect boundaries; whole-mandate assignment is a distinct unresolved subject (M-15, deferred). |
| Writing rules (plain technical English and the rest of AGENTS.md) | AGENTS.md and document review (M-16 precedent); mechanical reduction-record counts are historical evidence only. |
| Routing preferences (providers and models in use) | Operator configuration, changed by the operator; not a law. |
| Working rules for agents (file findings first, a workaround is a blocker, do not hand-slice work) | Filing findings and documenting blockers are process rules. "Do not hand-slice work" can also concern the runtime's assignment and delegation model; M-15's deferred status is retained until the forbidden behavior is defined. |

### G1. Record independence for all work decisions

**Adopted statement (operator, 2026-09-25; encoding pending).** For the same validated semantic
request, authenticated authority, observed resources and external events, changing
administrative annotations about work cannot change the runtime's selected checks, derived
decision inputs, admission, refusal, management permissions, required prerequisites, or
continuation transitions. Administrative annotations include expected-failure allowances,
convergence declarations, incidental code censuses and status declarations with no
corresponding semantic effect. The runtime derives decision inputs from the specified sources.
The complete composition, including source selection and dispatch, satisfies this independence.

**Motivation and model evidence.** A record of an actual effect can legitimately affect a
decision: source changes, work requests, cancellation, evidence of completed effects and
authenticated grants or reviews are records with semantic force. The semantic contract states
which records are administrative annotations, and their producers are covered by the proof or
declared as host assumptions. The review's model probe proves, for six work-act constructors,
that the decision is unchanged by every record (`decide(act, observed_allowed, notes) ==
decide(act, observed_allowed, 0n)`), and records two limits that shape the pending encoding: an
always-refusing runtime discharges record independence, so each domain keeps a positive
behavior law; and a caller that computes the observed value from the record satisfies the same
law, so decision-input provenance must be specified.

### G2. No administrative prerequisite for admission or continuation

**Adopted statement (operator, 2026-09-25; encoding pending).** For a valid authorized work
request with its required semantic inputs, the runtime imposes no agent-maintained status,
census, convergence or completion declaration as a prerequisite for admission or continued
execution. A blocked continuation names the actual missing resource, authority, semantic input,
or explicit operator/orchestrator decision that enables it. Each prerequisite has a specified
enabling effect; administrative maintenance cannot satisfy that description merely by receiving
a resource or authority label. The runtime preserves the continuation and wakes the responsible
party as required by revision 10. When the prerequisite is satisfied, the runtime makes
progress without a separate administrative acknowledgment.

**Motivation and model evidence.** The refined form admits waits on semantic input and on a
woken orchestrator decision, consistent with revision 10: a request may omit which repository
to change, require a user decision, or await an awake orchestrator's choice of further work.
The review's model probe proves that every returned prerequisite falls in a classification with
`Bookkeeping` forbidden, and shows the boundary the refined wording closes: a classification
that labels both acquiring a socket and rewriting a census as `Resource` satisfies the
classification law, so a prerequisite needs its actual enabling effect, or an authenticated
grant and scope. A temporal progress claim carries stated scheduler and host assumptions; an
external party may never supply an input.

### 12a. No ceiling and no clock on requested work (revises M-10)

**Adopted statement (operator, 2026-09-25; encoding pending).** For valid supported requests
under valid authority, the runtime admits work when its measured resources are available and
retains it pending while those resources are unavailable. Administrative magnitude or
elapsed-time bounds cannot reject, truncate, discard, or terminalize that work. Measured
resource requirements may determine availability and representation. Actual provider or host
failures are reported with their observed cause and disposition; they cannot be fabricated from
a runtime deadline. Explicit cancellation, revoked authority and the work's specified stopping
condition have separate transitions. Pending work retains its owner, owed data and continuation.

**Change to M-10.** M-10 forbids cutoffs "unless the bound derives from a physical resource, is
stated with its derivation". 12a removes that exception as a new policy decision adopted
2026-09-25. A physical shortage observed now makes work wait; it is not a pre-declared bound.
M-10's data-preservation scope is retained: remainders, queued work and owed data keep their
protection, connected to M-4, M-5 and M-17.

**Evidence from current Baton.**

- A default 100M-token hard stop killed a productive worker on 2026-09-13 (#258). That issue's
  remedy makes defaults notify-only; an explicit owner hard-stop policy and derived physical
  constraints remain possible.
- The `goal-plan.mjs` schema carries the listed policy limits (`maxTextBytes`, `maxNodes`,
  `maxDepsPerNode`, `maxItems`, `maxTokens`, `maxUsd`, `maxWallMin`). Commit `3e06ad64`
  documents an earlier fixed-limit recruit-brief failure. At the reviewed deployment
  `maxTextBytes` derives from the run.objective frame limit.
- #541 reports the historical 2 s queue wait, the `load1m <= 10` host-load refusal and the
  CLI's 30 s `commandTimeoutMs`; `bc2e4fcd` removed the host load and queue refusals.
- `drainPolicy: { maxWorkers: 64, timeoutMs: 90_000 }` in `application-deployment.mjs`, with
  `runtime-effects.mjs` racing stop attempts against the deadline and throwing
  `coordinator_run_stop_incomplete`; `issue500-deployment-capacity.test.mjs` pins the values.
  #583 reports a stop answering that code after 90 s on 2026-09-25 and completing later; the
  later completion is issue-reported.

**Shape in the rewrite.** `examples/laws-no-ceiling.bend` models one decision
`decide(size, elapsed, authorized, available)` and the law `decision_ignores_magnitude_and_clock`,
which equates it with `expected(authorized, available)` for every size and elapsed time.
`examples/laws-no-ceiling.evidence.md` records three controls that fail as required: a size
ceiling, a deadline on waiting work, and a ceiling derived from a physical resource. The
pending encoding constrains the transitions as well as the scalar decision: terminal
transitions (completion, cancellation, external failure) bind to actual events, attempts are
modelled separately from the durable work request so a transport timeout leaves the attempt
unresolved, and a production law preserves work disposition while telemetry and retry
scheduling change.

### 12b. Served catalogs follow observation

**Adopted statement (operator, 2026-09-25; encoding pending).** For a successfully observed
harness/credential catalog, the served route set equals the complete set supported by that
harness and credential state after applying the authenticated operator's route policy.
Programmer-maintained availability tables cannot add routes, restrict discovery, alter
observations, or suppress serving. Missing or failed discovery is reported explicitly and is
not asserted to be an empty catalog.

**Evidence from current Baton.** On the September 24 observation recorded in #549, the codex
model cache listed 8 models and the hand-kept `DEFAULT_ROUTES` table named 2 of them; a new
model had been added by hand as one more row (`0b6c6334`, September 22). The operator ruled
"why do you hardcode things like this when they need to be derived from the relevant
harness?". #549 tracks the direct harnesses and calls for an operator per-harness allow rule;
an explicit operator allowlist is authenticated policy applied over discovery. #440 is a
credential-fixture precedent: `a21bd055` changes only `impl/test/route-truth.test.mjs`, which
derives fixture credentials from routes the test declares.

**Shape in the rewrite.** `examples/laws-derived-catalog.bend` models `served(provided, listed,
excluded)` and the law `served_follows_observation`, which equates it with `expected(provided,
excluded)` for every value of `listed`. Two controls fail as required: a hand-kept table and a
hand-kept allowlist over observation. The pending encoding defines route identity, adapter
support, discovery completeness, credential scope and policy provenance, and distinguishes
advertised routes from temporary scheduling eligibility and exhausted quota; observing the
harness is a host effect and a stated assumption.

### 12c. An orchestrator holds every management act over its delegated scope

**Adopted statement (operator, 2026-09-25; encoding pending).** A valid orchestrator delegation
carries every management capability needed for its delegated work scope, including recruit,
guide, stop, review, integrate and resume. The runtime derives that scope and actor
relationship from authenticated current authority and enforces it at dispatch and effect.
Resource identity, generation, revocation and time-of-effect checks satisfy M-8. Self actions
and explicit scoped delegations remain valid sources of authority. No actor can exercise an
action beyond its valid scope.

**Evidence from current Baton.** On 2026-09-25 bend2-orchestrator14 reported that `swarm.stop`
was not in its seat grant, so it could not stop its own parked seat and asked the root to do it
(contribution-7073ae820a93e04c2ba3bb3205a7d28f). The operator ruling of 2026-09-21 gives leads
their swarm's whole scope and full authority, including `swarm integrate`, and is preserved in
`docs/bend2/MANDATE.md`. Revision 10 states that a seat stops when it declares itself done or
its orchestrator stops it, which requires the orchestrator to hold stop.

**Shape in the rewrite.** `examples/laws-orchestrator-authority.bend` models `granted(rel, act)`
and the law `orchestrator_holds_management` over all eighteen relation and act cases. Two
controls fail as required: the grant observed on 2026-09-25 (no stop) and landing reserved to
the root. The pending encoding defines each action's target and the full management-action
universe, covers prospective recruits, the lead's own work, authorized reviewers and the root,
and derives prospective scope for recruitment. Full capability keeps each action's semantic
preconditions, such as an independently verified landing; those preconditions satisfy G1 and
G2.

**Review outcome (2026-09-25).** The review answered the six questions the proposal raised:
each submitted equality is a law of its model at the pin; the refined 12a handles measured
resource requirements, actual provider and host failures, explicit cancellation, revoked
authority and the work's own stopping condition; an ignored time parameter does not exclude an
independent timer, so the pending encoding constrains transitions; an operator exclusion and a
hand-kept table need source identity, which the refined 12b supplies; full orchestrator
authority coexists with M-8 as a scoped, time-of-effect authority rule; and the table above
carries the review's corrections, with the whole-mandate question retained as unresolved under
M-15's deferral.

---

## Deferred and excluded

- **M-15 (whole-mandate admission) — deferred to the design notes.** The forbidden behavior is
  not yet precisely defined; the operator's instruction is preserved there, and no interpretation
  is invented to force a law.
- **M-16 (plain technical English) — excluded from the application laws.** It stays binding in
  AGENTS.md and normal document review; its subject is repository prose, not application
  behavior.
- **M-6 (exact-instance dispositions) — absorbed** into M-8 as the exact resource, generation
  and time-of-effect binding clause of the authority boundary (Codex: it may be a necessary
  clause rather than a separate law); the clause is written into M-8's forbidden text above.
- **M-9 (exclusive claims) — absorbed** into M-8, which already forbids exclusive-claim
  coordination that fails to preserve the approved ownership semantics; AB-04 is its evidence
  row, and its identifier is retained for traceability.

---

## Verdict repairs and reference closure

The row-by-row verdict table of revision 5 stands, with these repairs: CAP-3's verdict now reads
"reduced → M-10 and M-17 (narrow abandonment, incorporated in revision 6)"; CS-02's verdict
reads "reduced → boundary-decoder obligations; the associated flagged entry was withdrawn";
PM-10's and LEDG-17's routes now name M-7/M-8 and the interface clause respectively. The
demoted material lives in `docs/bend2/laws-design-notes.md`, the historical extraction at
`23d3b857`. Reference closure for withdrawn or renumbered marks, in both documents: M-6 → the
exact-instance clause of the authority boundary (M-8); M-9 → absorbed into M-8 (AB-04 is its
evidence row); M-3 → M-3a, M-3b, M-3c; M-15 → deferred (design notes, DEV-6); M-16 → excluded
(AGENTS.md, DEV-7); revision 5's flagged interface entry → the interface clause of the authority
boundary.

---

## Encoding and evidence

The seven proof-mechanics requirements in `laws-design-notes.md` apply to each approved
entry. `laws-trace.md` records the exact checked propositions, passing and violating examples,
source and test links, application connection and external assumptions. A compiled model
establishes only its stated scope. Application proof status stays open until the laws import
the actual Baton2 transitions and their host assumptions have evidence.

M-6 and M-9 are retained as clauses of M-8. M-15 remains deferred in the design notes;
M-16 remains in AGENTS.md. No further law-suitability decision is pending.
