# CLAIM: two M-5 obligations, one M-10 obligation, four M-14 obligations and three
# M-18 decision obligations are stated over pure example functions;
# examples/laws-proof.bend supplies their proofs.
# Approval: all 16 operative entries at 1fab9a1d, operator authorization
# relayed in the bend2-laws-lead4 brief; final Codex review r9.1 APPROVED.
# Actual application proofs remain open for all 16 entries; see laws-trace.md.
# Adopted 2026-09-25: the forty-three revision 11 and revision 12 obligations below are stated
# over the re-encoded example models (laws-no-ledger, laws-independence, laws-prerequisite,
# laws-no-ceiling, laws-derived-catalog, laws-orchestrator-authority) and proven in
# examples/laws-proof.bend. Each ban the revision states is followed by the positive laws that
# hold beside it over input derivation, dispatch and the terminal transitions. These entries are
# adopted by the operator but are not part of the approved set above: the approval line, the
# sixteen entries and their ten open model obligations are unchanged.
# Reference: reference/README.md, bend 2.0.25, a4952426.
# Evidence: examples/laws-check.evidence.md.
import Base
import ./examples/laws-history-model.bend as History
import ./examples/laws-worker-model.bend as Worker
import ./examples/laws-refusal-model.bend as Refusal
import ./examples/laws-decision-model.bend as Decision
import ./examples/laws-no-ledger.bend as NoLedger
import ./examples/laws-independence.bend as Independence
import ./examples/laws-prerequisite.bend as Prerequisite
import ./examples/laws-no-ceiling.bend as NoCeiling
import ./examples/laws-derived-catalog.bend as DerivedCatalog
import ./examples/laws-orchestrator-authority.bend as Orchestrator
import ./examples/laws-no-park.bend as NoPark

# M-5: every prior review row, including identity, author, artifact, basis
# and decision, is preserved in order by this model transition.
law m5_prior_reviews:
  for +history: +List<History.Review>
  for row: History.Review
  {History.prefix(History.length(history), History.append_review(history, row)) == history : +List<History.Review>}

# M-5: the model appends exactly the new accepted row. This obligation
# rejects an implementation that preserves history by dropping the new row.
law m5_appended_review:
  for +history: +List<History.Review>
  for +row: History.Review
  {History.suffix(History.length(history), History.append_review(history, row)) == [row] : +List<History.Review>}

# M-10: the recovered worker-admission lemma, restricted to this pure model.
# The two booleans model verify memory pressure and available verify bytes.
law m10_worker_admitted:
  for mt: Bool
  for bf: Bool
  {Worker.room_for(Worker.Worker{}, mt, bf) == True{} : Bool}

# M-14: a refusal's field is the failed check's own vocabulary row's field.
law m14_field_matches_row:
  for +k: Refusal.Check
  for c: Refusal.Context
  {Refusal.field_of(Refusal.explain(k, c)) == Refusal.table_field(k) : Refusal.Field}

# M-14: a refusal's rule is the failed check's own vocabulary row's rule. One
# table serves the validator and the explanation, so the two cannot disagree.
law m14_rule_matches_row:
  for +k: Refusal.Check
  for c: Refusal.Context
  {Refusal.rule_of(Refusal.explain(k, c)) == Refusal.table_rule(k) : Refusal.Rule}

# M-14: the remedy is composed from the same row, which is what holds a remedy
# to the values the row admits.
law m14_remedy_from_row:
  for +k: Refusal.Check
  {Refusal.remedy_of(Refusal.explain(k, Refusal.Safe{0n})) == Refusal.table_rem(k) : Refusal.Remedy}

# M-14: the rendered context carries no secret material.
law m14_context_redacted:
  for +k: Refusal.Check
  for s: Nat
  {Refusal.context_of(Refusal.explain(k, Refusal.WithSecret{s})) == 0n : Nat}

# M-18: a declared deployment dispatches to exactly the remote it declares, so no
# inferred or substituted destination can appear.
law m18_dispatch_targets_declared_remote:
  for r: Nat
  {Decision.target_of(Decision.decide(Decision.Declared{r})) == r : Nat}

# M-18: an undeclared deployment refuses with the undeclared code, which is the
# behavior a real landing has (#558).
law m18_undeclared_refuses:
  {Decision.code_of(Decision.decide(Decision.Undeclared{})) == Decision.undeclared_code() : Nat}

# M-18: a declared deployment's outcome carries no refusal code, so the decision
# cannot refuse a landing that has a destination.
law m18_declared_does_not_refuse:
  for r: Nat
  {Decision.code_of(Decision.decide(Decision.Declared{r})) == 0n : Nat}

# ---------------------------------------------------------------------------
# Adopted 2026-09-25, revision 11: no bookkeeping ledger in place of function.
# The ban: the landing gate's decision reads the two observed runs and nothing else.
# Beside it, the positive laws that fix the comparison policy the decision must be.

law r11_gate_reads_only_observations:
  for ledger: Nat
  for change: NoLedger.Outcome
  for target: NoLedger.Outcome
  {NoLedger.gate(ledger, change, target) == NoLedger.blocks(change, target) : Bool}

law r11_landing_reads_only_observations:
  for +ledger: Nat
  for runs: List<NoLedger.Observed>
  {NoLedger.landing_blocks(ledger, runs) == NoLedger.any_blocks(runs) : Bool}

# A failure with the change and an absent target invocation: the target supplies no matching
# failure identity, so the landing blocks.
law r11_an_absent_target_blocks_every_change_failure:
  for failure: NoLedger.Identity
  {NoLedger.blocks(NoLedger.Failed{failure}, NoLedger.Absent{}) == True{} : Bool}

# A failure with the change and an unjudged target: the target supplies no matching failure, so
# the landing blocks.
law r11_an_unjudged_target_blocks_every_change_failure:
  for failure: NoLedger.Identity
  {NoLedger.blocks(NoLedger.Failed{failure}, NoLedger.Unjudged{}) == True{} : Bool}

# Two judged failures: the landing blocks exactly when their identities differ, so a matched
# failure identity does not block and a mismatched one does.
law r11_a_judged_target_compares_failure_identities:
  for failure: NoLedger.Identity
  for observed: NoLedger.Identity
  {NoLedger.blocks(NoLedger.Failed{failure}, NoLedger.Failed{observed})
    == Bool.not(NoLedger.same_identity(failure, observed)) : Bool}

# An unjudged change cannot authorize landing, whatever the target supplies.
law r11_an_unjudged_change_cannot_authorize_landing:
  for target: NoLedger.Outcome
  {NoLedger.blocks(NoLedger.Unjudged{}, target) == True{} : Bool}

# A change that passed or is absent contributes no failure of its own.
law r11_a_passing_change_blocks_nothing:
  for target: NoLedger.Outcome
  {NoLedger.blocks(NoLedger.Passed{}, target) == False{} : Bool}

law r11_an_absent_change_blocks_nothing:
  for target: NoLedger.Outcome
  {NoLedger.blocks(NoLedger.Absent{}, target) == False{} : Bool}

# Every selected invocation is accounted for: the report carries one decision per invocation.
law r11_every_selected_invocation_is_accounted_for:
  for +ledger: Nat
  for runs: List<NoLedger.Observed>
  {List.length(&1, Bool, NoLedger.report(ledger, runs))
    == List.length(&1, NoLedger.Observed, runs) : Nat}

# ---------------------------------------------------------------------------
# Adopted 2026-09-25, G1: independence from administrative annotations.
# The ban: no administrative annotation changes any decision. Beside it, the positive behavior
# each domain must keep, so an implementation cannot satisfy independence by refusing everything.

law g1_admission_is_independent_of_annotations:
  for annotations: Independence.Annotation
  for r: Independence.Request
  {Independence.admit(annotations, r) == Independence.admit(Independence.no_annotations(), r) : Independence.Admission}

law g1_refusal_identity_is_independent_of_annotations:
  for annotations: Independence.Annotation
  for r: Independence.Request
  {Independence.refusal_identity(annotations, r)
    == Independence.refusal_identity(Independence.no_annotations(), r) : Nat}

law g1_selected_checks_are_independent_of_annotations:
  for annotations: Independence.Annotation
  for r: Independence.Request
  {Independence.selected_checks(annotations, r)
    == Independence.selected_checks(Independence.no_annotations(), r) : List<Independence.Check>}

law g1_required_prerequisites_are_independent_of_annotations:
  for annotations: Independence.Annotation
  for r: Independence.Request
  {Independence.prerequisites(annotations, r)
    == Independence.prerequisites(Independence.no_annotations(), r) : Independence.Prereq}

law g1_management_permissions_are_independent_of_annotations:
  for annotations: Independence.Annotation
  for +leads: +List<Nat>
  for target: Nat
  {Independence.manages(annotations, leads, target)
    == Independence.manages(Independence.no_annotations(), leads, target) : Bool}

law g1_continuation_transitions_are_independent_of_annotations:
  for annotations: Independence.Annotation
  for state: Independence.WorkState
  for event: Independence.WorkEvent
  {Independence.step(annotations, state, event)
    == Independence.step(Independence.no_annotations(), state, event) : Independence.WorkState}

law g1_authorized_work_with_available_resources_is_admitted:
  for annotations: Independence.Annotation
  {Independence.admit(annotations, Independence.Request{True{}, True{}}) == Independence.Admitted{} : Independence.Admission}

law g1_work_without_authority_is_refused:
  for annotations: Independence.Annotation
  {Independence.admit(annotations, Independence.Request{False{}, True{}}) == Independence.Refused{} : Independence.Admission}

law g1_authorized_work_with_short_resources_waits:
  for annotations: Independence.Annotation
  {Independence.admit(annotations, Independence.Request{True{}, False{}}) == Independence.Waiting{} : Independence.Admission}

# ---------------------------------------------------------------------------
# Adopted 2026-09-25, G2 in its refined form: no administrative prerequisite.
# The ban: no agent-maintained declaration is a prerequisite. Beside it, the positive law that
# every blocked continuation names an actual enabler and a party the runtime wakes.

law g2_the_prerequisite_is_derived_from_the_semantic_state:
  for s: Prerequisite.State
  {Prerequisite.enabler_of(s) == Prerequisite.expected_enabler(Prerequisite.semantic_of(s)) : Prerequisite.Enabler}

law g2_maintained_declarations_do_not_change_the_prerequisite:
  for +semantic: Prerequisite.Semantic
  for maintained: Nat
  {Prerequisite.enabler_of(Prerequisite.State{semantic, maintained})
    == Prerequisite.enabler_of(Prerequisite.State{semantic, 0n}) : Prerequisite.Enabler}

law g2_the_derived_prerequisite_is_never_administrative:
  for s: Prerequisite.State
  {Prerequisite.legitimate(Prerequisite.enabler_of(s)) == True{} : Bool}

law g2_an_administrative_declaration_satisfies_nothing:
  for record: Nat
  for ready: Bool
  {Prerequisite.satisfied(Prerequisite.Administrative{record}, ready) == False{} : Bool}

law g2_a_ready_prerequisite_admits_without_an_acknowledgment:
  for s: Prerequisite.State
  {Prerequisite.admitted(Prerequisite.progress(s, True{})) == True{} : Bool}

law g2_a_blocked_continuation_names_a_woken_party:
  for s: Prerequisite.State
  {NoPark.woken(Prerequisite.waiter(Prerequisite.blocked_enabler(Prerequisite.progress(s, False{})))) == True{} : Bool}

# ---------------------------------------------------------------------------
# Adopted 2026-09-25, revision 12a: no administrative magnitude or clock bound.
# The ban: admission ignores magnitude and elapsed time. Beside it, the derivation of the
# decision and every terminal transition over the work.

law r12a_admission_is_derived_from_authority_and_measured_resources:
  for r: NoCeiling.Request
  {NoCeiling.admit(r) == NoCeiling.expected(NoCeiling.authority_of(r), NoCeiling.resources_of(r)) : NoCeiling.Admission}

law r12a_admission_ignores_magnitude_and_clock:
  for r: NoCeiling.Request
  {NoCeiling.admit(r) == NoCeiling.admit(NoCeiling.cleared(r)) : NoCeiling.Admission}

law r12a_valid_authority_with_available_resources_admits:
  for magnitude: Nat
  for elapsed: Nat
  {NoCeiling.admit(NoCeiling.Request{NoCeiling.Valid{}, NoCeiling.Available{}, magnitude, elapsed}) == NoCeiling.Admitted{} : NoCeiling.Admission}

law r12a_valid_authority_with_short_resources_retains_the_work_pending:
  for magnitude: Nat
  for elapsed: Nat
  {NoCeiling.admit(NoCeiling.Request{NoCeiling.Valid{}, NoCeiling.Short{}, magnitude, elapsed}) == NoCeiling.Pending{} : NoCeiling.Admission}

law r12a_invalid_authority_refuses:
  for magnitude: Nat
  for elapsed: Nat
  {NoCeiling.admit(NoCeiling.Request{NoCeiling.Invalid{}, NoCeiling.Available{}, magnitude, elapsed}) == NoCeiling.Refused{} : NoCeiling.Admission}

law r12a_tick_preserves_the_work_disposition:
  for state: NoCeiling.Work
  {NoCeiling.step(state, NoCeiling.Tick{}) == state : NoCeiling.Work}

law r12a_completion_terminalizes_the_work:
  for owner: Nat
  for owed: Nat
  for continuation: Nat
  {NoCeiling.step(NoCeiling.Working{owner, owed, continuation}, NoCeiling.Completion{}) == NoCeiling.Completed{} : NoCeiling.Work}

law r12a_cancellation_terminalizes_the_work:
  for owner: Nat
  for owed: Nat
  for continuation: Nat
  {NoCeiling.step(NoCeiling.Working{owner, owed, continuation}, NoCeiling.Cancellation{}) == NoCeiling.Cancelled{} : NoCeiling.Work}

law r12a_external_failure_reports_its_observed_cause:
  for state: NoCeiling.Work
  for cause: Nat
  {NoCeiling.step(state, NoCeiling.ProviderFailure{cause}) == NoCeiling.Failed{cause} : NoCeiling.Work}

# ---------------------------------------------------------------------------
# Adopted 2026-09-25, revision 12b: no hand-kept catalog in place of derivation.
# The ban: a programmer-maintained table cannot change serving. Beside it, the served set and the
# reporting of a failed discovery.

law r12b_discovery_reports_the_observed_routes:
  for observation: DerivedCatalog.Observation
  {DerivedCatalog.discover(observation) == DerivedCatalog.Discovered{DerivedCatalog.provided_of(observation)} : DerivedCatalog.Discovery}

law r12b_served_set_equals_discovery_less_operator_policy:
  for observation: DerivedCatalog.Observation
  for policy: DerivedCatalog.Policy
  {DerivedCatalog.serve(DerivedCatalog.discover(observation), policy)
    == DerivedCatalog.Served{DerivedCatalog.remove(DerivedCatalog.provided_of(observation), DerivedCatalog.excluded_of(policy))} : DerivedCatalog.Serving}

law r12b_availability_table_does_not_change_serving:
  for observation: DerivedCatalog.Observation
  for policy: DerivedCatalog.Policy
  {DerivedCatalog.serve(DerivedCatalog.discover(observation), policy)
    == DerivedCatalog.serve(DerivedCatalog.discover(DerivedCatalog.unlisted(observation)), policy) : DerivedCatalog.Serving}

law r12b_missing_discovery_is_reported_not_asserted_empty:
  for cause: Nat
  for policy: DerivedCatalog.Policy
  {DerivedCatalog.serve(DerivedCatalog.Missing{cause}, policy) == DerivedCatalog.Report{cause} : DerivedCatalog.Serving}

# ---------------------------------------------------------------------------
# Adopted 2026-09-25, revision 12c: authority derived from current authenticated scope.
# The ban: no act beyond the derived scope, and no second check over a lawful grant. Beside it,
# the positive law that a delegation carries every management act for the scope it covers.

law r12c_revoked_authority_derives_no_scope:
  for delegation: Orchestrator.Delegation
  {Orchestrator.derive(Orchestrator.revoked(delegation)) == [] : +List<Nat>}

law r12c_stale_authority_derives_no_scope:
  for delegation: Orchestrator.Delegation
  {Orchestrator.derive(Orchestrator.stale(delegation)) == [] : +List<Nat>}

law r12c_no_act_is_dispatched_outside_the_derived_scope:
  for delegation: Orchestrator.Delegation
  for act: Orchestrator.Act
  for target: Nat
  {Orchestrator.dispatch(delegation, act, target) == Orchestrator.member(target, Orchestrator.derive(delegation)) : Bool}

law r12c_the_delegation_carries_every_management_act:
  for delegation: Orchestrator.Delegation
  for act: Orchestrator.Act
  for target: Nat
  {Orchestrator.dispatch(delegation, act, target) == Orchestrator.management(delegation, target) : Bool}

law r12c_the_effect_follows_the_dispatch_decision:
  for delegation: Orchestrator.Delegation
  for act: Orchestrator.Act
  for target: Nat
  {Orchestrator.effect(delegation, act, target)
    == Orchestrator.performed_when(Orchestrator.dispatch(delegation, act, target)) : Orchestrator.Effect}

law r12c_self_stop_is_authorized:
  for seat: Nat
  {Orchestrator.dispatch(Orchestrator.self_delegation(seat), Orchestrator.Stop{}, seat) == True{} : Bool}
