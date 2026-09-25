# Baton application laws — approved revision 9.1

The operator approved all 16 operative entries reviewed at
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
- **Bookkeeping.** The operative set has 16 entries after splitting M-3 into a/b/c and absorbing M-9; the design-notes
  reduction record is corrected (DEV-6 deferred, DEV-7 excluded, PM-10 routed, the old CX-6
  rejection marked historical).

Extraction base `bc2e4fcd`; design snapshot `23d3b857`; traces anchor-verified as recorded in
revisions 1–4.

## The admission test (as cited by the reduction record)

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

## The approved set (16 independent entries; M-9 is absorbed into M-8)

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

Status: proposed 2026-09-25; the encoding is checked at the pin and its three controls fail as
required. Law review pending (an external review by a gpt-6-astra seat is requested). Not part of
the operative set.

**Statement.** A gate decides from observed runs only. No gate, test or check reads a
hand-maintained record of expected results in place of running the software: no expected-failure
list, no converged declaration, no count or census pin. A landing blocks exactly when a test fails
with the change and does not fail on the target. A test that is new with the change is absent on
the target, so its failure blocks.

**Evidence from current Baton.**

- `impl/scripts/expected-red-tests.json` listed 417 `file :: test name` rows expected to
  fail, each with a reason, and 161 `converged` files. The gate passed a failure when the manifest
  listed it. Keeping it current required `--write-expected-red` rewrites after landings, and guard
  tests checked the list itself.
- The #565 landing re-listed 27 rows at closed issues, and the list then hid a regression (#566).
- #571's fixture-leak rows had run-specific names, so the list could not list them, and every broad
  gate went red until the key was fixed (78123579).
- Census pins (SI6, `CORPUS_COUNTS`) and count literals in tests (the runtime-api count removed in
  c66098c1) failed on every change that added a member, and each such change carried a re-pin
  commit (for example 83c40b4e).
- 5df1acf5 removed SI6 and added the AGENTS.md ban. #579 removes the remaining count pins. #580
  deletes the manifest and changes `swarm integrate` to re-run the change's failing files on the
  target and block only on failures the target does not share.

**Operator decision (2026-09-24).** The pattern is banned in AGENTS.md ("No bookkeeping ledgers
in place of function"), and "If the solution is removal please remove." On 2026-09-25 the operator
asked for the ban as a Bend2 law.

**Shape in the rewrite.** The law quantifies over a stored record: the gate is handed a value that
stands for any manifest entry, pin or flag, and the law requires the gate's decision to equal the
specification `breaks(change, target)` for every value of that record. A gate whose decision
depends on the record makes the law false at a named case. `examples/laws-no-ledger.bend` states
the model and two laws: `gate_reads_only_observations` (per test, proved by splitting every case)
and `landing_blocks_iff_breaks` (per landing, proved by induction over the selected tests).
`examples/laws-no-ledger.evidence.md` records three controls at the pin:

- A: an expected-failure list. A listed test that fails with the change and passes on the target
  does not block.
- B: a count pin. At pin 0 it blocks a failure the target shares. At pin 1 it blocks a run with no
  failure until the pin is updated.
- C: no comparison with the target. It blocks a failure the target shares.

**Questions for law review.**

1. Is the entry a law under the definition (a quantified theorem over the implementation, or an
   unrepresentable state), or is it tested behaviour that belongs in the trace as a test obligation?
2. The model takes outcomes as values any caller can write. Can the rewrite make an `Outcome`
   constructible only by the test runner at the pin, given that an exported constructor is
   forgeable from an importing module? If it cannot, what does the law guarantee without that?
3. Does the specification handle the cases the JavaScript gate handles: a failing file new with the
   change (`Absent{}` on the target), a file-level failure (hung, crashed, leaked fixtures)
   compared by file and failure type, and a target run that produced no verdict (every failure
   blocks)?
4. A test that fails on the target and with the change never blocks. Does that let a change make
   an already-failing test fail differently without notice, and should the law distinguish failure
   types or messages?

---

## Revision 12: the operator's banned runtime patterns as laws

Status: proposed 2026-09-25; each encoding is checked at the pin and each control fails as
required. Law review pending (an external review by a gpt-6-astra seat is requested). Not part of
the operative set.

The operator asked for the banned patterns to be codified as laws. The table maps each operator
ban to the law that carries it, or states why it is not an application law.

| Operator ban | Law |
|---|---|
| No pausing, idling or truncating agents (AGENTS.md, #572) | Revision 10 |
| No bookkeeping ledgers in place of function (AGENTS.md, #579, #580, #582) | Revision 11 (under review with its broader form) |
| Wake is never an action the agent takes (#529) | M-13, approved |
| Accept now, finish later; no held connection (#541) | M-12, approved |
| No numeric ceiling or deadline that refuses work, derived or not (#258, #541, #583) | 12a, revising M-10 |
| Catalogs derived from the harness, never hand-listed (#440, #549) | 12b |
| Leads hold full authority over their own swarm, including landing (2026-09-21) | 12c |
| Writing rules (plain technical English and the rest of AGENTS.md) | Not an application law; M-16 precedent |
| Routing preferences (providers and models in use) | Operator configuration, changed by the operator; not a law |
| Working rules for agents (file findings first, a workaround is a blocker, do not hand-slice work) | Process rules for the people and agents developing Baton; not application behaviour |

### 12a. No ceiling and no clock on requested work (revises M-10)

**Statement.** The runtime decides on requested work from authority and from the resource state it
observes now. The decision is the same for every size, count, spend and elapsed time. Work that has
authority is admitted when its resource is available and waits while it is short. It is refused
only for lack of authority. No constant, and no bound derived from a physical resource, turns
waiting or admitted work into a refusal, and no timer turns a pending operation into a failure.
Explicit cancellation by the caller and the work's own stopping condition remain separate
semantics.

**Change to M-10.** M-10 forbids cutoffs "unless the bound derives from a physical resource, is
stated with its derivation". The operator rejected that exception on 2026-09-20 ("DO NOT CHECK THE
DERIVATION OF A MAX LIMIT ... THAT SHOULD NEVER HAVE A CONSTANT APPLIED TO IT OR A LIMIT AT ALL").
12a removes it. A physical shortage observed now makes work wait; it is not a pre-declared bound.

**Evidence from current Baton.**

- A default 100M-token hard stop killed a productive worker on 2026-09-13 (#258).
- `goal-plan.mjs` `policy.limits.maxTextBytes: 4096` refused a legitimate 4244-byte recruit brief on
  2026-09-20; the same schema carries `maxNodes`, `maxDepsPerNode`, `maxItems`, `maxTokens`,
  `maxUsd`, `maxWallMin` and more.
- The host-capacity gate's 2 s queue wait and `load1m <= 10` refusal, and the CLI's 30 s
  `commandTimeoutMs` (#541).
- `drainPolicy: { maxWorkers: 64, timeoutMs: 90_000 }`: `swarm stop` answered
  `coordinator_run_stop_incomplete` after 90 s on 2026-09-25 and the stop then completed (#583). A
  #500 test pins the values.

**Shape in the rewrite.** `examples/laws-no-ceiling.bend` models one decision
`decide(size, elapsed, authorized, available)` and the law `decision_ignores_magnitude_and_clock`,
which equates it with `expected(authorized, available)` for every size and elapsed time.
`examples/laws-no-ceiling.evidence.md` records three controls that fail as required: a size
ceiling, a deadline on waiting work, and a ceiling derived from a physical resource.

### 12b. Served catalogs follow observation

**Statement.** The set of routes Baton serves is the set the harness and credential state
observably provide, less the routes the operator excludes. A hand-kept table can neither add a
route the harness does not provide nor hide one it does.

**Evidence from current Baton.** On 2026-09-24 the codex model cache listed 8 models and the
hand-kept `DEFAULT_ROUTES` table named 2 of them; a new model was added by hand as one more row.
The operator ruled "why do you hardcode things like this when they need to be derived from the
relevant harness?". #440 already derives omp routes from credential files; #549 tracks the direct
harnesses.

**Shape in the rewrite.** `examples/laws-derived-catalog.bend` models `served(provided, listed,
excluded)` and the law `served_follows_observation`, which equates it with `expected(provided,
excluded)` for every value of `listed`. Two controls fail as required: a hand-kept table and a
hand-kept allowlist over observation.

### 12c. An orchestrator holds every management act over the seats it leads

**Statement.** An orchestrator (a seat's parent seat, or the root for a top-level lead) holds
recruit, guide, stop, review, integrate and resume over every seat it leads. A seat can stop
itself. No act is granted over a seat the actor does not lead.

**Evidence from current Baton.** On 2026-09-25 bend2-orchestrator14 reported that `swarm.stop` was
not in its seat grant, so it could not stop its own parked seat and asked the root to do it. The
operator ruling of 2026-09-21 gives leads their swarm's whole scope and full authority, including
`swarm integrate`. Revision 10 states that a seat stops when it declares itself done or its
orchestrator stops it, which requires the orchestrator to hold stop.

**Shape in the rewrite.** `examples/laws-orchestrator-authority.bend` models `granted(rel, act)`
and the law `orchestrator_holds_management` over all eighteen relation and act cases. Two controls
fail as required: the grant observed on 2026-09-25 (no stop) and landing reserved to the root.

### Questions for law review

1. For each of 12a, 12b and 12c: is it a law under the definition (a quantified theorem over the
   implementation, or an unrepresentable state), or tested behaviour that belongs in the trace?
2. 12a: does removing M-10's derivation exception leave any legitimate case unhandled? Consider a
   provider's own context-window limit, a kernel bound such as the 103-byte socket path, and
   memory exhaustion observed now. The proposed answer is that the first two are facts the work
   meets (the work fails with the provider's or kernel's own refusal, stated as such) and the third
   makes work wait.
3. 12a models time as a parameter the decision ignores. Is that enough to exclude a timer that
   fires independently of the decision, as in #583, or does the law need the pending state to be
   modelled as a value only an event can change?
4. 12b: is an operator exclusion distinguishable in the model from a hand-kept table? The model
   separates them as inputs; is that separation meaningful at the pin?
5. 12c: does granting every act to the orchestrator conflict with M-8 (no effect beyond valid
   authority)? The proposed answer is that 12c defines which authority is valid for an
   orchestrator over its own seats and M-8 keeps it from extending past them.
6. Is any ban in the table missing, or placed in the wrong row?

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

## Disposition and reduction record (repairs)

The row-by-row verdict table of revision 5 stands, with these repairs: CAP-3's verdict now reads
"reduced → M-10 and M-17 (narrow abandonment, incorporated in revision 6)"; CS-02's
verdict reads "reduced → boundary-decoder obligations; the associated flagged entry was
withdrawn" (removing the embedded "rejected" so the mechanical count and the tally agree);
PM-10's and LEDG-17's routes now name M-7/M-8 and the interface clause respectively. Verdict
precedence for mechanical counting: a row is `reduced` if its verdict contains "reduced", else
`rejected` if it contains "rejected", else `kept`. Mechanical count of the carried record: kept
47, reduced 29, rejected 57, retired 1, evidence block 1 — 135 rows, each accounted for; the
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
