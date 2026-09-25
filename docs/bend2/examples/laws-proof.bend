# CLAIM: the quantified M-5 history, M-10 worker and M-14 refusal model
# obligations check, and the forty-three revision 11 and revision 12 obligations adopted
# 2026-09-25 check over the re-encoded example models. Actual application laws remain open as
# recorded in ../laws-trace.md.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-check.evidence.md.
import Base
import ../laws.bend as Laws
import ../examples/laws-history-model.bend as History
import ../examples/laws-refusal-model.bend as Refusal
import ../examples/laws-no-ledger.bend as NoLedger
import ../examples/laws-independence.bend as Independence
import ../examples/laws-prerequisite.bend as Prerequisite
import ../examples/laws-no-ceiling.bend as NoCeiling
import ../examples/laws-derived-catalog.bend as DerivedCatalog
import ../examples/laws-orchestrator-authority.bend as Orchestrator
import ../examples/laws-no-park.bend as NoPark

# Nat.is_eq(n, n) is True: the reflexivity the identity comparisons need. Two cases, and the step
# case is the induction hypothesis.
def nat_eq_self(n: Nat) -> {Nat.is_eq(n, n) == True{} : Bool}:
  match n:
    case 0n: {==}
    case 1n+p:
      %nat_eq_self(p) : {Nat.is_eq(p, p) == _ : Bool}
      {==}

def Laws.m5_prior_reviews(history, row):
  match history:
    case Nil{}: {==}
    case h <> t:
      %Laws.m5_prior_reviews(t, row) : {h <> History.prefix(History.length(t), History.append_review(t, row)) == h <> _ : +List<History.Review>}
      {==}

def Laws.m5_appended_review(history, row):
  match history:
    case Nil{}: {==}
    case h <> t:
      Laws.m5_appended_review(t, row)

def Laws.m10_worker_admitted(mt, bf):
  {==}

def Laws.m14_field_matches_row(k, c):
  match k:
    case Refusal.UnknownField{}: {==}
    case Refusal.ClosedSet{}: {==}
    case Refusal.RequiredField{}: {==}
    case Refusal.IdentityKeyed{}: {==}
    case Refusal.ShaUnresolved{}: {==}
    case Refusal.PublishUndeclared{}: {==}

def Laws.m14_rule_matches_row(k, c):
  match k:
    case Refusal.UnknownField{}: {==}
    case Refusal.ClosedSet{}: {==}
    case Refusal.RequiredField{}: {==}
    case Refusal.IdentityKeyed{}: {==}
    case Refusal.ShaUnresolved{}: {==}
    case Refusal.PublishUndeclared{}: {==}

def Laws.m14_remedy_from_row(k):
  match k:
    case Refusal.UnknownField{}: {==}
    case Refusal.ClosedSet{}: {==}
    case Refusal.RequiredField{}: {==}
    case Refusal.IdentityKeyed{}: {==}
    case Refusal.ShaUnresolved{}: {==}
    case Refusal.PublishUndeclared{}: {==}

def Laws.m14_context_redacted(k, s):
  match k:
    case Refusal.UnknownField{}: {==}
    case Refusal.ClosedSet{}: {==}
    case Refusal.RequiredField{}: {==}
    case Refusal.IdentityKeyed{}: {==}
    case Refusal.ShaUnresolved{}: {==}
    case Refusal.PublishUndeclared{}: {==}

def Laws.m18_dispatch_targets_declared_remote(r):
  {==}

def Laws.m18_undeclared_refuses():
  {==}

def Laws.m18_declared_does_not_refuse(r):
  {==}

# ---------------------------------------------------------------------------
# Revision 11 (adopted 2026-09-25): the gate and the landing read the observations only.

def Laws.r11_gate_reads_only_observations(ledger, change, target):
  {==}

def Laws.r11_landing_reads_only_observations(ledger, runs):
  match runs:
    case Nil{}: {==}
    case h <> t:
      %Laws.r11_landing_reads_only_observations(ledger, t) : {Bool.or(NoLedger.gate_observed(ledger, h), NoLedger.landing_blocks(ledger, t)) == Bool.or(NoLedger.gate_observed(ledger, h), _) : Bool}
      {==}

def Laws.r11_an_absent_target_blocks_every_change_failure(failure):
  {==}

def Laws.r11_an_unjudged_target_blocks_every_change_failure(failure):
  {==}

def Laws.r11_a_judged_target_compares_failure_identities(failure, observed):
  {==}

def Laws.r11_an_unjudged_change_cannot_authorize_landing(target):
  {==}

def Laws.r11_a_passing_change_blocks_nothing(target):
  {==}

def Laws.r11_an_absent_change_blocks_nothing(target):
  {==}

def Laws.r11_every_selected_invocation_is_accounted_for(ledger, runs):
  match runs:
    case Nil{}: {==}
    case h <> t:
      %Laws.r11_every_selected_invocation_is_accounted_for(ledger, t) : {Nat.add(1n, List.length(&1, Bool, NoLedger.report(ledger, t))) == Nat.add(1n, _) : Nat}
      {==}

# ---------------------------------------------------------------------------
# G1 (adopted 2026-09-25): no administrative annotation changes a decision, and each domain
# keeps its positive behavior.

def Laws.g1_admission_is_independent_of_annotations(annotations, r):
  {==}

def Laws.g1_refusal_identity_is_independent_of_annotations(annotations, r):
  {==}

def Laws.g1_selected_checks_are_independent_of_annotations(annotations, r):
  {==}

def Laws.g1_required_prerequisites_are_independent_of_annotations(annotations, r):
  {==}

def Laws.g1_management_permissions_are_independent_of_annotations(annotations, leads, target):
  {==}

def Laws.g1_continuation_transitions_are_independent_of_annotations(annotations, state, event):
  match event:
    case Independence.Tick{}: {==}
    case Independence.TurnEnd{}: {==}
    case Independence.Stop{}: {==}

def Laws.g1_authorized_work_with_available_resources_is_admitted(annotations):
  {==}

def Laws.g1_work_without_authority_is_refused(annotations):
  {==}

def Laws.g1_authorized_work_with_short_resources_waits(annotations):
  {==}

# ---------------------------------------------------------------------------
# G2 in its refined form (adopted 2026-09-25): the prerequisite is derived, never declared.

def Laws.g2_the_prerequisite_is_derived_from_the_semantic_state(s):
  {==}

def Laws.g2_maintained_declarations_do_not_change_the_prerequisite(semantic, maintained):
  {==}

def Laws.g2_the_derived_prerequisite_is_never_administrative(s):
  match s:
    case Prerequisite.State{+semantic, +maintained}:
      match semantic:
        case Prerequisite.Ready{}: {==}
        case Prerequisite.NeedsResource{}: {==}
        case Prerequisite.NeedsAuthority{}: {==}
        case Prerequisite.NeedsInput{}: {==}
        case Prerequisite.NeedsOrchestrator{}: {==}

def Laws.g2_an_administrative_declaration_satisfies_nothing(record, ready):
  {==}

def Laws.g2_a_ready_prerequisite_admits_without_an_acknowledgment(s):
  match s:
    case Prerequisite.State{+semantic, +maintained}:
      match semantic:
        case Prerequisite.Ready{}: {==}
        case Prerequisite.NeedsResource{}: {==}
        case Prerequisite.NeedsAuthority{}: {==}
        case Prerequisite.NeedsInput{}: {==}
        case Prerequisite.NeedsOrchestrator{}: {==}

def Laws.g2_a_blocked_continuation_names_a_woken_party(s):
  match s:
    case Prerequisite.State{+semantic, +maintained}:
      match semantic:
        case Prerequisite.Ready{}: {==}
        case Prerequisite.NeedsResource{}: {==}
        case Prerequisite.NeedsAuthority{}: {==}
        case Prerequisite.NeedsInput{}: {==}
        case Prerequisite.NeedsOrchestrator{}: {==}

# ---------------------------------------------------------------------------
# Revision 12a (adopted 2026-09-25): admission derives from authority and measured resources,
# and every terminal transition is bound to its event.

def Laws.r12a_admission_is_derived_from_authority_and_measured_resources(r):
  {==}

def Laws.r12a_admission_ignores_magnitude_and_clock(r):
  match r:
    case NoCeiling.Request{+authority, +resources, +magnitude, +elapsed}: {==}

def Laws.r12a_valid_authority_with_available_resources_admits(magnitude, elapsed):
  {==}

def Laws.r12a_valid_authority_with_short_resources_retains_the_work_pending(magnitude, elapsed):
  {==}

def Laws.r12a_invalid_authority_refuses(magnitude, elapsed):
  {==}

def Laws.r12a_tick_preserves_the_work_disposition(state):
  {==}

def Laws.r12a_completion_terminalizes_the_work(owner, owed, continuation):
  {==}

def Laws.r12a_cancellation_terminalizes_the_work(owner, owed, continuation):
  {==}

def Laws.r12a_external_failure_reports_its_observed_cause(state, cause):
  {==}

# ---------------------------------------------------------------------------
# Revision 12b (adopted 2026-09-25): the served set follows discovery and operator policy.

def Laws.r12b_discovery_reports_the_observed_routes(observation):
  {==}

def Laws.r12b_served_set_equals_discovery_less_operator_policy(observation, policy):
  {==}

def Laws.r12b_availability_table_does_not_change_serving(observation, policy):
  match observation:
    case DerivedCatalog.Observation{+provided, +listed}: {==}

def Laws.r12b_missing_discovery_is_reported_not_asserted_empty(cause, policy):
  {==}

# ---------------------------------------------------------------------------
# Revision 12c (adopted 2026-09-25): scope and every management act are derived from current
# authority, and the effect follows the dispatch decision.

def Laws.r12c_revoked_authority_derives_no_scope(delegation):
  match delegation:
    case Orchestrator.Delegation{+actor, +leads, +revoked, +current}: {==}

def Laws.r12c_stale_authority_derives_no_scope(delegation):
  match delegation:
    case Orchestrator.Delegation{+actor, +leads, +revoked, +current}:
      match revoked:
        case True{}: {==}
        case False{}: {==}

def Laws.r12c_no_act_is_dispatched_outside_the_derived_scope(delegation, act, target):
  {==}

def Laws.r12c_the_delegation_carries_every_management_act(delegation, target, act):
  {==}

def Laws.r12c_the_effect_follows_the_dispatch_decision(delegation, act, target):
  {==}

def Laws.r12c_self_stop_is_authorized(seat):
  %Equal.sym(Bool, Nat.is_eq(seat, seat), True{}, nat_eq_self(seat)) : {Bool.or(_, Orchestrator.member(seat, [])) == True{} : Bool}
  {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("M-5 reviews, M-10 worker admission, M-14 refusal rows, M-18 landing decision and the adopted revision 11 and revision 12 obligations: model proofs checked.")
