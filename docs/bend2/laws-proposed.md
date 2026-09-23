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
