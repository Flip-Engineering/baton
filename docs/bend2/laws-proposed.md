# Operative laws

The operator directed these statements to govern bend2-v2 on 2026-09-28.
The statements below are copied verbatim from `docs/bend2/laws-proposed.md`
at `1fab9a1d`. Their bracketed labels are retained as source text. That
revision has no `docs/bend2/laws.bend` file.

**M-1 · No acceptance claim without recoverable matching intent.** [partly enforced]
Forbidden: acknowledging that managed work has been accepted or recorded unless a recoverable
intent with the same operation identity, committed meaning and admitted authority already
survives a crash and recovery performed now. A retry preserves identity and committed meaning
while the reported state progresses (queued, admitted, completed); a query, a refusal or a
clarification answers without recording and is outside this rule.

**M-2 · An unresolved external attempt stays unresolved until justified.** [proposed]
Forbidden: reporting or acting on an external attempt as succeeded or failed when its outcome is
not established; repeating the attempt except through a justified recovery protocol or a newly
authorized action that accounts for the uncertain attempt.

**M-3a · Publication carries its authority and evidence conditions for the actual artifact and
target.** [partly enforced; two clauses are proposed — the evidence-staleness prohibition and
the artifact-scoped dirty-tree requirement]
Forbidden: publishing an artifact or moving a target when the applicable review, verification or
repository-authority conditions for that actual artifact version and target state are not
satisfied — including a claimed revision that does not resolve in the named repository, a report
about an artifact whose own tree state is unrecorded (unrelated dirty files are irrelevant), and
the use of review, verification or attribution evidence after the state basis it was recorded
against no longer holds.

**M-3b · No unauthorized duplicate logical effect under one operation identity.** [extracted]
Forbidden: one operation identity producing the same logical effect twice — a second landing of
the same contribution, or a retried append creating a second event. Deliberate reapplication of
a reverted change, or publishing one contribution to several authorized destinations, is not
this ban.

**M-3c · No claiming a new effect that did not occur.** [partly enforced]
Forbidden: reporting a retry as a new landing, or any answer asserting an effect this attempt
did not perform; a read-only observer claiming that its own request performed a change it
merely reports. An idempotent retry may truthfully report the earlier outcome.

**M-4 · No disposal that violates custody or preservation.** [extracted]
Forbidden: disposing of workspace work in violation of either obligation that holds over it —
current custody (an unsettled handle, including a terminal handle whose release has not
completed) or preservation (un-captured content of the same workspace generation). Ordinary
disposal requires the current preservation evidence for that generation; a separately authorized
decision to discard work names that disposition explicitly; releasing custody is not itself
evidence of preservation; genuinely disposable files need no preservation ceremony.

**M-5 · Accepted facts, identities, required ordering and owed events survive recovery,
compaction, replay and delivery.** [partly enforced — the WAKE-5 drop persisted at the
extraction base and is retired per #541]
Forbidden: any of recovery, compaction, checkpointing, replay or delivery losing or altering the
accepted facts, their identities, the required ordering, or an event still owed to a subscriber.

**M-7 · No unvalidated assertion acquires authority or established attribution.** [partly
enforced]
Forbidden: trusting a caller-supplied actor, author, reviewer, scope or attribution value as
authority or established attribution without validating it against the authority records under
the applicable authority rules; no particular authority-record store is mandated. Presenting
the value is legitimate — trusting it unvalidated is the ban. A custody or status record asserts
nothing it did not verify.

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

**M-10 · No cutoff of valid requested work or owed data without a physically-derived, stated
bound.** [partly enforced — the WAKE-5 drop persisted at the extraction base and is retired per
#541]
Forbidden: stopping, refusing or dropping valid requested work, or owed data, for elapsed time,
queue position, input size or count — unless the bound derives from a physical resource, is
stated with its derivation, and leaves the remainder available with processing continuing. A
physical shortage can justify waiting or a truthful failure; explicit cancellation and the
work's own stopping condition are separate semantics.

**M-11 · Caller input must not fabricate established facts.** [extracted]
Forbidden: caller input manufacturing established execution, verification or publication facts.

**M-12 · No mandatory wait for managed work to finish before its acceptance is acknowledged.**
[extracted]
Forbidden: requiring a caller to remain blocked until accepted managed work completes. Queries,
the durability write that M-1 requires, and an optional caller-selected wait are permitted.

**M-13 · Required progress notifications reach the agent's interface without agent-invoked
fetch or re-arm.** [extracted]
Forbidden: required progress notifications being delivered only on an agent-invoked fetch or
re-arm; delivery means reaching the agent's actual interface. Optional history inspection remains
permitted.

**M-14 · A refusal states the actual failed rule and safe relevant context.** [partly enforced]
Forbidden: a refusal omitting the safe explanation of what failed, inventing a rule, misstating
the input or state, or fabricating a remedy. A remedy is given when known; an explicitly unknown
or unavailable remedy is valid; protected inputs are not disclosed.

**M-17 · No silent abandonment of accepted, unsettled work.** [proposed]
Forbidden: detaching an accepted, unsettled operation from every continuation owner without a
terminal disposition or an explicit authorized suspension. A continuation owner means an actual
retained responsibility or a recoverable handoff path — an orphaned identifier pointing to a
terminated worker does not satisfy this by its presence — and an authorized suspension names its
actual reason and its resumption authority or condition; an operator may intentionally pause
work without any external dependency. Deadlines, fairness, scheduler topology and eventual
provider success stay outside this entry.

**M-18 · No substitution of a publication destination.** [proposed]
Forbidden: dispatching the publication effect of a publish/integrate operation to any repository
or target other than the canonical shared destination designated by its admitted repository
authority, or treating effects at another destination as completion. A local checkout does not
become that destination merely because `origin` resolves to it.
