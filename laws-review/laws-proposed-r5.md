# Baton's laws proposed for the operator's approval — revision 5 (the minimal set, reduced)

Provenance: work-bend2-laws, pillar 3 of issue #539. Revision 5 applies the operator's confirmed
admission threshold: `laws.bend` is a minimal contract of inviolables — its purpose is
agentic-development guidance, stopping an implementation agent from coding banned behaviors into
the application, whatever architecture or implementation it otherwise chooses. This revision is a
reduction, not another restructure: the 38 Candidates of revision 4 (landed as `a1e2b240`) and
Codex's six contract families were judged row by row against the test, and the surviving set is
16 prohibitions. Revision 4 landed with the reviewer's counts (38/46/29/20/1/4) and carries the
language pillar's probe corrections (`f9cbfbf2`); this revision reduces that material.

The reduction record is row by row: per row kept, the forbidden behavior and its binding reason;
per row reduced or rejected, one line naming which test question it failed. Nothing is thrown
away: the demoted material — the 46 Split decompositions, the 29 Policy decisions, the 20
Implementation pairs, the retired row, the evidence tasks, and the six families' full
propositions — lives in `docs/bend2/laws-design-notes.md`, which this document names as the home
of everything not in the minimal set. `laws.bend` still takes no entries.

## The admission test

1. What is the specific forbidden behavior?
2. Why must that prohibition bind every otherwise-valid implementation — would allowing it
   destroy something the operator's system exists to protect, regardless of architecture?

A row passes only if both answers are concrete. A desirable feature, an architecture preference,
a workflow, an interface inventory or a comprehensive correctness property fails the test even
where a Bend2 proof for it exists. Scope limits from the independent review are kept: the
mechanism probes refute the naive encodings only (proof-indexed encodings are not excluded), and
the history-preservation check is a worked instance — the quantified theorem is open work.

---

## The surviving set (16 prohibitions)

Kind is marked `runtime` (the current implementation enforces it), `development` (an operator
ruling produces it), or both. Every entry is one banned behavior.

**M-1 · An acknowledgment refers to recoverable work.** [development + runtime]
Forbidden: answering an operation whose intent would not survive a crash-and-recovery performed
now; or answering a retry of a known operation identity with anything other than the original
disposition.
Binding reason: callers treat an acknowledgment as "recorded" and move on — any architecture
that acks before recoverability loses accepted work silently.
Evidence: DEV-2 (durable half), LEDG-3, LEDG-6, CS-19.

**M-2 · An unresolved external attempt stays unresolved.** [runtime]
Forbidden: reporting or acting on an external attempt whose outcome is not established as if it
had succeeded or failed; repeating it except through a justified recovery protocol.
Binding reason: a lost response after a real effect is permanent; inventing the outcome
duplicates agents or fabricates evidence.
Evidence: CAP-6, CL-14, LEDG-4.

**M-3 · Publication is bound to its recorded evidence, once and truthfully.** [development +
runtime]
Forbidden: merging or publishing work the recorded review, verification and authority evidence
does not authorize, for the exact artifact version and target state; publishing the same
contribution twice; recording a landing when no change occurred; a report claiming a delivered
revision that does not resolve, or results from a dirty tree without saying so; mutation of the
target without repository authority.
Binding reason: review and verification are otherwise decorative — the merge is the act that
matters, and a false or repeated landing corrupts the record every agent relies on.
Evidence: CL-03, CL-05, CL-07, CL-08, CL-10 (truthful half), CL-12 (completeness half), CL-13,
CL-14, CL-15 (authority clause), CS-17, CS-19, PM-11, DEV-5 (evidence and independent-review
halves).

**M-4 · Workspace custody is never violated.** [runtime]
Forbidden: destroying or resetting a workspace whose custody is unsettled or whose latest
observation is not of the same generation as the destruction target; admitting a new worker to a
workspace generation that has begun closing; any caller-supplied flag bypassing preservation.
Binding reason: work is the product and destruction is irreversible; generations age
independently of observations; a bypass flag converts every downstream bug into data loss.
Evidence: CUST-1, CUST-2, CUST-4, CUST-5, CUST-6 (evidence requirement), CUST-11.

**M-5 · Accepted history and owed events survive recovery, compaction, replay and delivery.**
[runtime]
Forbidden: losing, reordering or rewriting accepted recorded history in replay, compaction,
checkpointing or recovery; dropping a recorded event a subscriber is still owed; a pre-write
gate altering the state it judged; a write against state whose recovery has not established
validity.
Binding reason: the log and the feeds are what agents act on; a lost review, operation identity
or owed event changes what Baton permits behind the agents' backs. (WAKE-5's drop behavior is
the violation of this entry — retired per #541. The quantified preservation theorem is open work
for the owning lane.)
Evidence: WAKE-3, WAKE-5 (retired row's retained guarantee), PROP-2, CL-07, LEDG-1, LEDG-7,
LEDG-10, LEDG-15, LEDG-16, LEDG-19.

**M-6 · Dispositions are exact-instance bound.** [runtime]
Forbidden: a release, cancel or reclaim acting on a resource instance other than the one its
token or authority was issued for — including a stale token reaching a newer reservation that
reused the identifier.
Binding reason: identifiers are recycled by every substrate; exact binding is the only thing
keeping one instance's disposition off another.
Evidence: CAP-7, CAP-14, AB-05.

**M-7 · Authority provenance is derived, never asserted.** [runtime]
Forbidden: any recorded act carrying an actor, author, reviewer, scope or attribution value
supplied by the caller rather than derived from authenticated authority; fabricating another
participant's system-issued scope authority; a custody record asserting authorship.
Binding reason: assertion-based identity is forgery by construction, in any architecture.
Evidence: AB-09, AB-14, CL-02, PM-11, CUST-8, PM-07 (authority is currency-checked), AB-05
(derived binding).

**M-8 · No elevation or enlargement beyond held authority.** [runtime]
Forbidden: granting an authority the granter does not hold; nested options enlarging what a
read-only admission permits; a read-only result claiming an authorized change; a malformed scope
degrading into unrestricted access; a child forging delegated resource authority.
Binding reason: one elevation path undoes the entire permission model.
Evidence: PM-08, AB-10, AB-11, CAP-12, PR-01, AB-12 (enlargement half), AB-06 (transfer needs
valid authority).

**M-9 · Exclusive claims require an explicit coordination rule.** [runtime]
Forbidden: conflicting concurrent mutation of an exclusively claimed resource without a stated
coordination rule; absent the rule, the second claimant refuses before any write.
Binding reason: silent overlap destroys work; the rule may be leases, transactions or anything
stated.
Evidence: AB-04.

**M-10 · No cutoff without a physically-derived, stated bound.** [development + runtime]
Forbidden: stopping, refusing or dropping an agent's work — or an input, or an owed event —
because of elapsed time, queue position, input size or a count, unless the bound derives from a
physical resource, is stated with its derivation, and leaves the remainder available with
processing continuing.
Binding reason: arbitrary cutoffs are hidden stop buttons on the pipeline (ruling #541, applied
class-wide per the cutoff audit).
Evidence: DEV-1, CAP-2, CAP-3, PROP-1, and the audit rows: AB-12 (entry cap), CAP-8 (byte
ceiling), CAP-15 (terminal lock refusal — resolved as queue-and-admit-in-order, per the
adjudication citing both files), CAP-17 (retire or operator exception), LEDG-14 (constant),
WAKE-12 (page bound).

**M-11 · No forged internal facts.** [runtime]
Forbidden: caller commands fabricating internal execution, verification or landing facts.
Binding reason: the log is evidence.
Evidence: CL-17.

**M-12 · The caller is never held for the operation.** [development]
Forbidden: holding a requester synchronously while the requested operation executes.
Binding reason: a slow or stuck operation freezes the caller, and a crash mid-operation looks
like the caller's failure.
Evidence: DEV-2 (never-wait half), LEDG-6.

**M-13 · Wake is delivered at the boundary, never fetched.** [development]
Forbidden: making an agent's progress depend on invoking a command to fetch or re-arm event
delivery.
Binding reason: an agent that never learns the fetch command waits forever; polling taxes every
agent for the benefit of none.
Evidence: DEV-3, WAKE-8.

**M-14 · A refusal carries the truthful rule, input and remedy.** [development]
Forbidden: refusing a request without a structured, truthful statement of the rule that failed,
the input or state involved, and what to change.
Binding reason: agents act on refusals; unactionable refusals turn one misformatted field into a
dead run.
Evidence: DEV-4; enforcement halves CS-05, CS-16, CS-17.

**M-15 · A seat is admitted on a whole mandate with the authority to complete it.**
[development; flagged: the precise meanings of "whole" and "completing" are owed]
Forbidden: admitting a seat on a fragment of a mandate it cannot finish for lack of authority,
or on authority unrelated to the assignment.
Binding reason: work stalls on authority gaps and half-assignments, and the coordinator becomes
the limit on how much work can proceed.
Evidence: DEV-6. Codex classed this Policy ("needs precise meanings"); it is kept because the
operator's ruling names scope-slicing explicitly, with the meaning-writing as the owed debt.

**M-16 · Prose in the repository's documents is plain technical English.** [development;
review-enforced]
Forbidden: aphorism, metaphor, poetic or contrast-form description, or operational journaling in
product-facing documents.
Binding reason: the written surface is what agents and humans act on; rhetoric is unactionable.
Evidence: DEV-7; AGENTS.md at the repository root.

---

## The reduction record (38 candidates and 6 families, row by row)

Kept entries name the M-entry that carries them. Reduced entries name the M-entry whose clause
now carries the guarantee, with the failed test question. Rejected entries name the failed
question.

| Row | Verdict | Reason |
|---|---|---|
| CUST-1 | kept → M-4 | passes |
| CUST-2 | kept → M-4 | passes |
| CUST-3 | reduced → M-4 scope note | failed Q3: one authoritative determination is required; the live-handle registry is an implementation |
| CUST-4 | kept → M-4 | passes |
| CUST-5 | kept → M-4 | passes |
| CUST-6 | reduced → M-4 | failed Q3: the evidence requirement is the law; the metadata and path rules are one mechanism |
| CUST-7 | reduced → M-4 | failed Q3: protection follows ownership, not one folder name |
| CUST-8 | kept → M-7 | passes |
| CUST-9 | rejected | failed Q1: a workspace-representation property, not a forbidden behavior |
| CUST-10 | rejected | failed Q3: branch-moving is one preservation method |
| CUST-11 | reduced → M-4 | failed Q3: custody-before-effects is the law; the receipt mechanism is not |
| CUST-12 | rejected | failed Q3/independence: agreement is a theorem or a routing choice, not a prohibition |
| CAP-1 | reduced → M-10 | failed Q3: derivation honesty is required; the formula is not |
| CAP-2 | reduced → M-10 | failed independence: carried by the no-cutoff entry |
| CAP-3 | reduced → M-10 and M-18 (flagged) | failed Q3: FIFO is policy; the durable hold and admission-on-release are the guarantees |
| CAP-4 | rejected (policy) | failed Q2: a workload choice, and the extraction overstated the source (derived share, not measured cost) |
| CAP-5 | rejected (policy) | failed Q2: a chosen fallback with operation-specific justification |
| CAP-6 | kept → M-2 | passes |
| CAP-7 | kept → M-6 | passes |
| CAP-8 | reduced → M-10 | failed Q3: the closed shape is construction hygiene; the byte ceiling is an unjustified cutoff |
| CAP-9 | rejected | failed Q1: housekeeping design, not a forbidden behavior |
| CAP-10 | rejected (policy) | failed Q2: one recovery response among possible ones |
| CAP-11 | rejected (policy) | failed Q2: tunable scheduling |
| CAP-12 | kept → M-8 | passes |
| CAP-13 | rejected | failed Q3: exclusive accounting is required; the seal, root and lock are mechanisms |
| CAP-14 | kept → M-6 | passes |
| CAP-15 | reduced → M-10 | failed Q3: the terminal refusal dies under the no-cutoff ruling; the bounded queue survives (adjudicated wording) |
| CAP-16 | rejected | failed Q3/independence: agreement is the property, one predicate is an organization |
| CAP-17 | rejected (policy) | failed Q6: conflicts with the no-cutoff ruling; retire or state as an operator exception |
| WAKE-1 | rejected | failed Q3: defined delivery meaning is required; the one-class-per-row design is not the law |
| WAKE-2 | rejected (policy) | failed Q3: truthful refusal of unknown filters kept at the decoder; the vocabulary is versioned |
| WAKE-3 | kept → M-5 | passes |
| WAKE-4 | rejected (policy) | failed Q3: a stated default, not a universal one |
| WAKE-5 | RETIRED | conflicts with the #541 ruling (dropping recorded events from a slow reader) |
| WAKE-6 | rejected (policy) | failed Q3: per-signal subscription semantics |
| WAKE-7 | rejected (policy) | failed Q3: the consistency half is noted in the design notes; the vocabulary is policy |
| WAKE-8 | kept → M-13 | passes |
| WAKE-9 | rejected (policy) | failed Q3: metadata-only is one design; verified content may be valid later |
| WAKE-10 | rejected | failed Q3: one push implementation among possible ones |
| WAKE-11 | rejected (policy) | failed Q3: the once-per-pull consistency half is noted; the cadence is policy |
| WAKE-12 | reduced → M-10 | failed Q3: continuation is the guarantee; the ceiling needs physical derivation |
| WAKE-13 | rejected | failed Q3: transport conformance; Baton2 may use other transports |
| PROP-1 | reduced → M-10 | failed independence: bounded processing is carried by the no-cutoff entry |
| PROP-2 | kept → M-5 | passes |
| PROP-3 | reduced → M-4 scope | failed Q3: one ordering authority is required; the writer count is not |
| LEDG-1 | kept → M-5 | passes |
| LEDG-2 | rejected | failed Q3: detection is required; UTF-8 and newlines are codec choices |
| LEDG-3 | kept → M-1 | passes |
| LEDG-4 | kept → M-2 | passes |
| LEDG-5 | rejected | failed Q3: one exclusion protocol among possible ones |
| LEDG-6 | kept → M-1 and M-12 | passes |
| LEDG-7 | kept → M-5 | passes |
| LEDG-8 | rejected (policy) | failed Q3: actionable provenance is required; the codes and fields are versioned protocol |
| LEDG-9 | rejected | failed Q3: evidence preservation is required; the write pattern is one implementation |
| LEDG-10 | kept → M-5 | passes |
| LEDG-11 | rejected | failed Q3: checkpoints are derived state; coalescing is performance |
| LEDG-12 | kept → M-5 | passes |
| LEDG-13 | rejected | failed Q3: consistent resolution is required; the grammar table is an interface |
| LEDG-14 | rejected | failed Q3: bounded memory is required; the literal 256 is tuning |
| LEDG-15 | kept → M-5 | passes |
| LEDG-16 | kept → M-5 | passes |
| LEDG-17 | rejected | failed independence: carried by the interface-agreement question (M-17, flagged in revision 4, now rejected with it) |
| LEDG-18 | rejected | failed Q3: session integrity is required; the second ledger and byte format are mechanisms |
| LEDG-19 | reduced → M-5 | failed Q3: cursor validation is the guarantee; head-only waiting is an implementation |
| CS-01 | rejected (policy) | failed Q2: thirteen kinds is today's vocabulary, not a permanent bound |
| CS-02 | reduced → M-17 (flagged, now rejected with it) and the decoder obligations | failed independence |
| CS-03 | reduced → boundary-decoder obligation of M-1/M-7 | failed Q3: decode-before-effect is an implementation order |
| CS-04 | rejected | failed Q3: declared retry identity is required; the two-verb list is one encoding |
| CS-05 | reduced → M-14 | failed Q3: the structured refusal is the law; the template is presentation |
| CS-06 | reduced → boundary-decoder obligation of M-1/M-7 | failed Q3, as CS-03 |
| CS-07 | reduced → boundary-decoder obligation of M-7 | failed Q3, as CS-03 |
| CS-08 | rejected (policy) | failed Q2: a boundary decision owed, with the recorded incident as the justification |
| CS-09 | rejected (policy) | failed Q3: a versioned query API |
| CS-10 | reduced → M-8 | failed independence: read-only preservation carried by the enlargement ban |
| CS-11 | rejected (policy) | failed Q3: a scheduling interface choice |
| CS-12 | rejected (policy) | failed Q3: prove the transitions; do not freeze the lists |
| CS-13 | rejected (policy) | failed Q2: product choices need a reason |
| CS-14 | rejected (policy) | failed Q2: exclusivity needs a product reason to be impossible |
| CS-15 | rejected | failed Q3: the two-field plan encodes today's API |
| CS-16 | reduced → M-14 | failed Q3: meaning-per-code is the law; the registry inventory is versioned |
| CS-17 | kept → M-3 | passes |
| CS-18 | rejected (policy) | failed Q2: three statuses constrain future reporting without proving correctness |
| CS-19 | kept → M-1 and M-3 | passes |
| CS-20 | rejected | failed Q1: development tooling, not a domain behavior |
| AB-01 | rejected | failed Q3: total deterministic matching is required; the glob dialect is one representation |
| AB-02 | reduced → M-8 scope | failed Q3: lexical rules are necessary and do not establish containment |
| AB-03 | rejected | failed Q3: unambiguous targets are required; the list form is subordinate |
| AB-04 | kept → M-9 | passes |
| AB-05 | reduced → M-6 and M-7 | failed independence: carried by the binding entries |
| AB-06 | reduced → M-8 | failed Q4: valid-authority transfer is the law; revocation and recovery scopes are owed |
| AB-07 | rejected | failed Q3: truthful provenance is required; the reserved-prefix strategy is a recording choice |
| AB-08 | rejected | failed Q3: the distinction is required; the exemptions are mechanism |
| AB-09 | kept → M-7 | passes |
| AB-10 | kept → M-8 | passes |
| AB-11 | kept → M-8 | passes |
| AB-12 | reduced → M-10 and M-8 | failed Q6: the 64-entry cap is a superseded cutoff; duplicate rejection needs its own reason |
| AB-13 | reduced → M-7 (boundary recheck) | failed Q3: loopback-only is deployment policy |
| AB-14 | kept → M-7 | passes |
| PM-01 | rejected (policy) | failed Q2: today's vocabulary, not a permanent capability bound |
| PM-02 | rejected (policy) | failed Q3: defaults are policy; explicitness is the property |
| PM-03 | rejected (policy) | failed Q3: defined requirement per action; single-value may prohibit valid conjunctions |
| PM-04 | rejected (policy) | failed Q3: today's mappings are reviewed policy |
| PM-05 | rejected | failed independence: agreement is the law; one shared function is one way (finding 6) |
| PM-06 | rejected (policy) | failed Q2: per-operation justification owed |
| PM-07 | reduced → M-7 | failed Q4: membership currency is part of authority validity |
| PM-08 | kept → M-8 | passes |
| PM-09 | rejected (policy) | failed Q3: the table evolves under a versioned policy contract |
| PM-10 | reduced → M-3 scope | failed Q3: independence of authority is the guarantee; label inequality is not proof — the inequality proposition route is owed |
| PM-11 | kept → M-7 | passes |
| CL-01 | rejected (policy) | failed Q3: explicit form is required; the six-key heuristic is compatibility |
| CL-02 | kept → M-7 | passes |
| CL-03 | kept → M-3 | passes |
| CL-04 | rejected (policy) | failed Q3: truthful status is required; the stamp vocabulary is not frozen |
| CL-05 | kept → M-3 | passes |
| CL-06 | rejected (policy) | failed Q2: last-accept-wins is a resolution policy with a named alternative |
| CL-07 | kept → M-3 and M-5 | passes |
| CL-08 | kept → M-3 | passes |
| CL-09 | rejected | failed Q3: preservation of the approved change is the contract; one squash commit is a strategy |
| CL-10 | kept → M-3 | passes |
| CL-11 | rejected (policy) | failed Q3: overwrite protection is the guarantee; blanket overlap refusal rejects valid work |
| CL-12 | reduced → M-3 | failed Q3: required-gate coverage is the guarantee; the derivation is a strategy |
| CL-13 | kept → M-3 | passes |
| CL-14 | reduced → M-2 and M-3 | failed independence: three separate properties, each carried |
| CL-15 | kept → M-3 | passes |
| CL-16 | rejected (policy) | failed Q2: prose scanning needs its incident-based justification |
| CL-17 | kept → M-11 | passes |
| PR-01 | kept → M-8 | passes |
| PR-02..PR-05 | evidence tasks | unchanged — work items in `laws-design-notes.md` |
| DEV-1 | kept → M-10 | passes (operator ruling) |
| DEV-2 | kept → M-1 and M-12 | passes (operator ruling) |
| DEV-3 | kept → M-13 | passes (operator ruling) |
| DEV-4 | kept → M-14 | passes (operator ruling) |
| DEV-5 | kept → M-3 | passes (operator ruling; chronology and exclusive publication split into development controls) |
| DEV-6 | kept → M-15 | passes (operator ruling; precise meanings owed) |
| DEV-7 | kept → M-16 | passes (operator ruling) |

Family verdicts: CX-1 → reduced to M-1 · CX-2 → kept as M-2 · CX-3 → reduced to M-3 · CX-4 →
rejected, failed independence (its divergence ban restates M-7 and M-8 applied per interface;
returns as its own entry if Codex shows an uncovered failure) · CX-5 → split into M-5 and M-10 ·
CX-6 → split: the continuation prohibition rejected (failed the prohibition test — a positive
obligation; the stranding behaviors are already banned by M-10 and M-12), the ready-work half
rejected as a scheduler design duty, both recorded in `laws-design-notes.md`.

Tally: 135 of the 138 rows carry an individual verdict in the table (the four PR-02..05
evidence tasks are one block row); 49 are kept into the 16 prohibitions, 26 are reduced into
another entry's clause, and 58 are rejected — 32 of them marked policy, whose decisions live in
`laws-design-notes.md` — and 1 is retired. The six families: 4 reduced, 1 kept, 1 split, with
CX-4 and CX-6's halves rejected. Every demoted row's design material lives in
`docs/bend2/laws-design-notes.md`.
---

## Where everything lives

- The minimal set: this document, above.
- The 46 Split decompositions, 29 Policy decisions, 20 Implementation pairs, the retired WAKE-5,
  the four evidence tasks, the six families' full propositions, and every trace:
  `docs/bend2/laws-design-notes.md`.
- The historical extraction (statements, plain explanations, traces): landed at `23d3b857`.
- Policy decisions' absorption: `docs/bend2/rewrite-plan.md` (bend2-plan-lead). Implementation
  neutrality notes: `docs/bend2/target-architecture.md` (bend2-arch-lead). The
  development-governance contract: `docs/bend2/rewrite-plan.md`.

---

## Held for Codex

Per the root's instruction, this reduced set is held for Codex's review before it reaches the
operator. The review questions:

1. Does each surviving entry name one genuinely forbidden behavior that binds every
   otherwise-valid implementation?
2. Is the set minimal and independent — any entry derivable from the others? Any missing
   prohibition the evidence reveals?
3. Were the reductions and rejections right — in particular CX-4's rejection, CX-6's split, and
   the kept M-15/M-16 pair?
4. Only then: the seven proof-mechanics requirements are attached per surviving entry, with
   compiled examples under `docs/bend2/examples/laws-*`.

Still no `laws.bend` entries and no rewrite implementation; the lane holds under the pause
between reviews.