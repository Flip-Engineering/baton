# Baton's laws proposed for the operator's approval — revision 6 (narrowed per the r5 review)

Provenance: work-bend2-laws, pillar 3 of issue #539. Revision 6 applies Codex's review of the
minimal set (`codex-minimal-review-r5.md`, 2026-09-21; reviewed draft `ad740ae0…`): the
prohibitions are narrowed to single restrictions, overreaching clauses are split or reduced,
two entries leave the set, one rejected entry returns in a narrow form, and every entry now
carries an honest enforcement-status label. It supersedes revision 5 (landed as `c9e51892`).
Still a minimal contract of inviolables for agentic development — not a correctness
specification — and still no `laws.bend` entries and no rewrite implementation.

What changed, per the review:

- **M-16 excluded.** Prose style and document placement stay binding in AGENTS.md and normal
  review; they do not prevent a banned behavior from being coded into the application.
- **M-15 deferred.** "Whole mandate" and "completing" are undefined; the operator's instruction
  is preserved in the design notes, and no interpretation is invented to force a law.
- **M-3 split.** One heading carried seven restrictions, some duplicating other entries. Now:
  publication-evidence (narrowed), no unauthorized duplicate logical effect under the same
  operation identity, and no claiming a new effect that did not occur — with the dirty-tree
  clause scoped to the artifact the evidence covers, and revision resolvability folded into the
  evidence conditions.
- **M-7 rewritten.** The banned behavior is trusting an unvalidated assertion as authority or
  established attribution — the arrival of a caller-supplied field is not itself forgery.
- **M-8 rewritten.** Granting is separated from personally holding: an explicit provisioning
  authority may grant without executing. A read-only observer may report an existing change but
  must not claim its request performed one. Fail-open scope handling is banned.
- **M-1 and M-12 narrowed.** Queries, refusals and clarifications answer without recording;
  retries preserve identity and committed meaning while the reported state progresses; M-12 bans
  only requiring a caller to stay blocked until accepted work completes.
- **M-5 restated as logical preservation.** Physical layouts may change; accepted facts,
  identities, required ordering and owed events may not be lost or altered; an atomic
  validate-and-commit is permitted.
- **M-9 reduced to ownership preservation.** Waiting, serializable transactions and compatible
  subdivisions are valid coordination; conflicting unauthorized mutation is the ban.
- **New M-15: no silent abandonment.** The CX-6 rejection was unsound — Codex's counterexample
  (accept, receipt, then detach from every scheduler without a terminal disposition; M-10 and
  M-12 both hold) shows the gap. The narrow prohibition is adopted.
- **Status labels replace the blanket `runtime` mark**: `extracted` (enforced today, with the
  specific evidence), `partly enforced`, or `proposed`, per row.
- **Reduction record repaired**: the admission test now states all six questions the verdicts
  cite; CAP-3 no longer points at a withdrawn entry; CS-02's verdict is reworded so the
  mechanical count and the tally agree; reduced/rejected rows name the surviving home of their
  guarantees where one exists.

Design-notes routing is unchanged: CX-4's full interface-equivalence theorem, the
recovery/codec correctness work and the ready-work progress specifications stay in
`docs/bend2/laws-design-notes.md`; the authority and intent boundaries below apply through every
exposed path, so a new interface cannot become an exception to an approved prohibition, and an
uncovered concrete violation can still justify a new law.

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
post-admission proof-mechanics step, held until the set is validated.)

---

## The proposed set (14 prohibitions)

**M-1 · No acceptance claim without recoverable matching intent.** [partly enforced]
Forbidden: acknowledging that managed work has been accepted or recorded unless a recoverable
intent with the same operation identity, committed meaning and admitted authority already
survives a crash and recovery performed now. A retry preserves identity and committed meaning
while the reported state progresses (queued, admitted, completed); a query, a refusal or a
clarification answers without recording and is outside this rule.
Binding reason: callers treat acceptance as "recorded" and build on it; an acceptance that
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
target.** [extracted]
Forbidden: publishing an artifact or moving a target when the applicable review, verification or
repository-authority conditions for that actual artifact version and target state are not
satisfied — including a claimed revision that does not resolve in the named repository, and a
report about an artifact whose own tree state is unrecorded (unrelated dirty files are
irrelevant).
Binding reason: review and verification apply to an exact version; a merge is the act that
matters.
Evidence: CL-03, CL-04 (scoped), CL-08, CL-12 (completeness half), CL-13 (green and current-head
halves), CL-15 (authority), PM-11 (attribution binding).

**M-3b · No unauthorized duplicate logical effect under one operation identity.** [extracted]
Forbidden: one operation identity producing the same logical effect twice — a second landing of
the same contribution, or a retried append creating a second event. Deliberate reapplication of
a reverted change, or publishing one contribution to several authorized destinations, is not
this ban.
Binding reason: duplicated effects corrupt the target and the record together.
Evidence: CL-14 (once-only), CL-05 (identity disposition), LEDG-3 (keyed replay).

**M-3c · No claiming a new effect that did not occur.** [partly enforced]
Forbidden: reporting a retry as a new landing, or any answer asserting an effect this attempt did
not perform. An idempotent retry may truthfully report the earlier outcome.
Binding reason: false effect claims corrupt every downstream decision.
Evidence: CL-10 (truthful no-op), LEDG-3 (the returned row is the original). Partly enforced:
the ledger half is pinned; the reporting half is carried by the contract.

**M-4 · No disposal of unsettled or unpreserved workspace work.** [extracted]
Forbidden: destroying or resetting workspace work whose custody is unsettled — including a
terminal handle whose release has not completed — unless the disposal action is itself
explicitly authorized and the preservation observation covers the same workspace generation and
is fresh at destruction; retained-artifact cases are defined, not implicit.
Binding reason: work is the product; destruction is irreversible; stale observations authorize
deletions that look checked.
Evidence: CUST-1, CUST-4, CUST-6 (evidence requirement), CUST-11.

**M-5 · Accepted facts, identities, required ordering and owed events survive recovery,
compaction, replay and delivery.** [extracted, with one proposed clause]
Forbidden: any of recovery, compaction, checkpointing, replay or delivery losing or altering the
accepted facts, their identities, the required ordering, or an event still owed to a subscriber;
a validation gate changing the state it judged outside an atomic validate-and-commit.
Binding reason: the log and the feeds are what agents act on; physical layouts may change
freely, the agreed facts may not. (WAKE-5's drop is the violated form — retired per #541. The
quantified preservation theorem is open work for the owning lane.)
Evidence: WAKE-3, WAKE-5 (retired row), PROP-2, CL-07, LEDG-1, LEDG-7, LEDG-10, LEDG-15, LEDG-16,
LEDG-19.

**M-7 · No unvalidated assertion acquires authority or established attribution.** [partly
enforced]
Forbidden: trusting a caller-supplied actor, author, reviewer, scope or attribution value as
authority or established attribution without validating it against the authority records;
presenting the value is legitimate — trusting it unvalidated is the ban. A custody or status
record asserts nothing it did not verify.
Binding reason: assertion-based authority is forgery by construction, in any architecture.
Evidence: AB-09, AB-14, CL-02, PM-11, CUST-8, PM-07, AB-05; partly enforced — the derivation
points are tested, the generalized rule is the proposal.

**M-8 · No effect, publication, delegation or grant beyond valid authority.** [partly enforced]
Forbidden: performing an effect, publishing, delegating or granting beyond the authority valid
for it — including granting beyond an explicitly held granting authority (a provisioning role
may grant without personally executing), fail-open scope handling, and a read-only observer
claiming that its own request performed a change it merely reports.
Binding reason: one unguarded path undoes the permission model; delegation stays open under
stated granting authority.
Evidence: PM-08, AB-10, AB-11, CAP-12, PR-01 (fail-open), AB-06 (valid-authority transfer),
CL-15, AB-12 (enlargement half). Partly enforced: several points tested, the granting-authority
separation is proposed.

**M-9 · No conflicting unauthorized mutation of an exclusively claimed resource.** [extracted]
Forbidden: mutating an exclusively claimed resource in conflict with its claim, without the
claim's coordination rule — which may be waiting for the holder, a serializable transaction, or
a compatible subdivision of the resource.
Binding reason: silent overlap destroys work; the response is design freedom, the exclusivity is
not.
Evidence: AB-04.

**M-10 · No cutoff of valid requested work or owed data without a physically-derived, stated
bound.** [extracted]
Forbidden: stopping, refusing or dropping valid requested work, or owed data, for elapsed time,
queue position, input size or count — unless the bound derives from a physical resource, is
stated with its derivation, and leaves the remainder available with processing continuing. A
physical shortage can justify waiting or a truthful failure; explicit cancellation and the work's
own stopping condition are separate semantics.
Binding reason: arbitrary cutoffs are hidden stop buttons (ruling #541).
Evidence: DEV-1, CAP-2, CAP-3, CAP-15 (as adjudicated), PROP-1, and the audit rows AB-12, CAP-8,
CAP-17, LEDG-14, WAKE-12.

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
Forbidden: a refusal inventing a rule, misstating the input or state, or fabricating a remedy.
A remedy is given when known; an explicitly unknown or unavailable remedy is valid; protected
inputs are not disclosed.
Binding reason: agents act on refusals; an unactionable or dishonest refusal turns one
misformatted field into a dead run.
Evidence: DEV-4; enforcement halves CS-05, CS-16, CS-17.

**M-17 · No silent abandonment of accepted, unsettled work.** [proposed]
Forbidden: detaching an accepted, unsettled operation from every continuation owner without a
terminal disposition or an explicit authorized suspension that names the real dependency.
Binding reason: Codex's counterexample — accept, receipt, then detach from all schedulers; no
cutoff occurs and no caller was held, yet the work is silently abandoned. M-10 and M-12 hold;
this entry is the gap they leave.
Evidence: proposed (CX-6, narrowed per the r5 review; the broader ready-work and temporal-progress
specifications stay in the design notes).

---

## Deferred and excluded

- **M-15 (whole-mandate admission) — deferred to the design notes.** The forbidden behavior is
  not yet precisely defined; the operator's instruction is preserved there, and no interpretation
  is invented to force a law.
- **M-16 (plain technical English) — excluded from the application laws.** It stays binding in
  AGENTS.md and normal document review; its subject is repository prose, not application
  behavior.
- **M-6 (exact-instance dispositions) — absorbed** into M-7/M-8 as the exact resource, generation
  and authority binding clause of the authority boundary (Codex: it may be a necessary clause
  rather than a separate law).

---

## Disposition and reduction record (repairs)

The row-by-row verdict table of revision 5 stands, with these repairs: CAP-3's verdict now reads
"reduced → M-10 and the adopted M-17" (the pointed-at M-18 exists again, narrowed); CS-02's
verdict reads "reduced → boundary-decoder obligations; the associated flagged entry was
withdrawn" (removing the embedded "rejected" so the mechanical count and the tally agree);
PM-10's and LEDG-17's routes now name M-7/M-8 and the interface clause respectively. Verdict
precedence for mechanical counting: a row is `rejected` if its verdict contains "rejected",
else `reduced` if it contains "reduced", else `kept`. Mechanical count of this revision's
record: kept 49, reduced 26, rejected 58, retired 1, evidence block 1 — 135 rows, each
accounted for; the demoted material lives in `docs/bend2/laws-design-notes.md`, the historical
extraction at `23d3b857`.

---

## Held for Codex

Per the standing instruction, this revision is held for Codex before the operator. The questions:

1. Do the narrowed entries (M-1, M-3a/b/c, M-7, M-8, M-9, M-12, M-14) now state single
   restrictions that bind every otherwise-valid implementation?
2. Is the adopted M-17 the right narrow form of the continuation prohibition, and does its
   counterexample indeed escape M-10 and M-12?
3. Are the status labels (extracted / partly enforced / proposed) honest per the cited evidence?
4. Only after validation: the seven proof-mechanics requirements attach per entry, with compiled
   examples under `docs/bend2/examples/laws-*`. `laws.bend` stays empty; the lane holds under the
   pause between reviews.