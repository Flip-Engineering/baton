# CLAIM: the operative laws of the CDP runtime lane, stated over the real functions of
# bend2/src/context/runtime/cdp-runtime.bend: canonical decimal counter admission and its
# exact successor, the pause/resume/context-destruction epoch advance, the mutation
# generation advance before an evaluation send, target liveness evidence, the grant and
# signal-order predicates of the public intent union, and serialization against a pending
# intent.
#
# Contract: docs/bend2/semantic-context-spec.md, "Runtime contract", with the retained
# counter decision (runtime-counter-boundary-69). Each law is a definitional equality the
# compiler checks beside its proof, so a change to the admitted function that violates the
# statement fails this module's compile.
#
# Import handoff: this module belongs in the coordinator entry's law graph. The sole owner
# of bend2/src/coordinator/laws.bend adds
#   import ../context/runtime/cdp-runtime-laws.bend as CdpRuntimeLaws
# and the production compile then verifies every statement here. Until that import lands,
# this module is a partial compilation target only and no gate is claimed for it.
#
# This module imports no shared law module. It imports Base and its own operative module.

import Base
import ./cdp-runtime.bend as R

# ---------------------------------------------------------------------------
# The canonical counter text and its exact successor.

law counter_valid_admits_only_canonical_decimal:
  {R.counter_valid("0") == True{} : Bool}

def counter_valid_admits_only_canonical_decimal():
  {==}

law counter_valid_refuses_a_leading_zero:
  {R.counter_valid("01") == False{} : Bool}

def counter_valid_refuses_a_leading_zero():
  {==}

law counter_valid_admits_the_empty_string_as_refused:
  {R.counter_valid("") == False{} : Bool}

def counter_valid_admits_the_empty_string_as_refused():
  {==}

law counter_valid_admits_a_counter_past_the_u32_range:
  {R.counter_valid("4294967296") == True{} : Bool}

def counter_valid_admits_a_counter_past_the_u32_range():
  {==}

law counter_next_increments_the_last_digit:
  {R.counter_next("123") == "124" : String}

def counter_next_increments_the_last_digit():
  {==}

law counter_next_carries_across_a_nine:
  {R.counter_next("19") == "20" : String}

def counter_next_carries_across_a_nine():
  {==}

law counter_next_carries_the_u32_boundary:
  {R.counter_next("4294967295") == "4294967296" : String}

def counter_next_carries_the_u32_boundary():
  {==}

law counter_next_carries_the_double_precision_boundary:
  {R.counter_next("9007199254740992") == "9007199254740993" : String}

def counter_next_carries_the_double_precision_boundary():
  {==}

law counter_next_carries_a_long_all_nine_run:
  {R.counter_next("9999999999") == "10000000000" : String}

def counter_next_carries_a_long_all_nine_run():
  {==}

# ---------------------------------------------------------------------------
# The runtime transitions.

law a_pause_advances_the_epoch_by_one_successor:
  for +epoch: String
  for +mutation: String
  for +pending: R.Pending
  for +liveness: R.Liveness
  {R.advance(R.Rec{R.Running{}, epoch, mutation, pending, liveness}, R.EvPaused{}) == Bool.pick(R.Transition, R.counter_valid(epoch), R.Advanced{R.Rec{R.Paused{}, R.counter_next(epoch), mutation, pending, R.LivenessLive{}}}, R.Refused{"counterMalformed"}) : R.Transition}

def a_pause_advances_the_epoch_by_one_successor(epoch, mutation, pending, liveness):
  {==}

law a_malformed_epoch_refuses_the_stop:
  {R.advance(R.Rec{R.Running{}, "01", "0", R.Idle{}, R.LivenessLive{}}, R.EvPaused{}) == R.Refused{"counterMalformed"} : R.Transition}

def a_malformed_epoch_refuses_the_stop():
  {==}

law the_u32_boundary_epoch_does_not_wrap:
  {R.advance(R.Rec{R.Running{}, "4294967295", "0", R.Idle{}, R.LivenessLive{}}, R.EvPaused{}) == R.Advanced{R.Rec{R.Paused{}, "4294967296", "0", R.Idle{}, R.LivenessLive{}}} : R.Transition}

def the_u32_boundary_epoch_does_not_wrap():
  {==}

law a_destroyed_context_ends_a_stop_and_advances_the_epoch:
  for +epoch: String
  for +mutation: String
  for +pending: R.Pending
  for +liveness: R.Liveness
  {R.advance(R.Rec{R.Paused{}, epoch, mutation, pending, liveness}, R.EvContextDestroyed{}) == Bool.pick(R.Transition, R.counter_valid(epoch), R.Advanced{R.Rec{R.Running{}, R.counter_next(epoch), mutation, pending, liveness}}, R.Refused{"counterMalformed"}) : R.Transition}

def a_destroyed_context_ends_a_stop_and_advances_the_epoch(epoch, mutation, pending, liveness):
  {==}

law an_evaluation_advances_the_mutation_generation_before_its_send:
  for +epoch: String
  for +mutation: String
  for +query: String
  for +liveness: R.Liveness
  {R.advance(R.Rec{R.Running{}, epoch, mutation, R.Idle{}, liveness}, R.EvEvaluationSent{query}) == Bool.pick(R.Transition, R.counter_valid(mutation), R.Advanced{R.Rec{R.Running{}, epoch, R.counter_next(mutation), R.Evaluation{query}, liveness}}, R.Refused{"counterMalformed"}) : R.Transition}

def an_evaluation_advances_the_mutation_generation_before_its_send(epoch, mutation, query, liveness):
  {==}

law a_second_evaluation_refuses_while_one_is_pending:
  {R.advance(R.Rec{R.Running{}, "0", "0", R.Evaluation{"q"}, R.LivenessLive{}}, R.EvEvaluationSent{"q2"}) == R.Refused{"runtimeBusy evaluate"} : R.Transition}

def a_second_evaluation_refuses_while_one_is_pending():
  {==}

law adapter_failure_preserves_the_liveness_evidence:
  for +state: R.RuntimeState
  for +epoch: String
  for +mutation: String
  for +pending: R.Pending
  for +liveness: R.Liveness
  {R.advance(R.Rec{state, epoch, mutation, pending, liveness}, R.EvAdapterFailed{}) == Bool.pick(R.Transition, R.is_exited(state), R.Refused{"adapterFailed after exited"}, R.Advanced{R.Rec{R.Failed{}, epoch, mutation, pending, liveness}}) : R.Transition}

def adapter_failure_preserves_the_liveness_evidence(state, epoch, mutation, pending, liveness):
  {==}

law an_adapter_failure_after_exit_is_refused:
  {R.advance(R.Rec{R.Exited{}, "0", "0", R.Idle{}, R.LivenessExited{}}, R.EvAdapterFailed{}) == R.Refused{"adapterFailed after exited"} : R.Transition}

def an_adapter_failure_after_exit_is_refused():
  {==}

law a_start_release_from_the_startup_wait_runs:
  {R.advance(R.Rec{R.WaitingForStart{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.EvStartReleaseSent{}) == R.Advanced{R.Rec{R.Running{}, "0", "0", R.Idle{}, R.LivenessLive{}}} : R.Transition}

def a_start_release_from_the_startup_wait_runs():
  {==}

law a_start_release_after_an_observed_stop_keeps_the_stop:
  for +epoch: String
  for +mutation: String
  for +pending: R.Pending
  for +liveness: R.Liveness
  {R.advance(R.Rec{R.Paused{}, epoch, mutation, pending, liveness}, R.EvStartReleaseSent{}) == R.Advanced{R.Rec{R.Paused{}, epoch, mutation, pending, liveness}} : R.Transition}

def a_start_release_after_an_observed_stop_keeps_the_stop(epoch, mutation, pending, liveness):
  {==}

law a_start_release_before_the_endpoint_is_refused:
  {R.advance(R.Rec{R.Starting{}, "0", "0", R.Idle{}, R.LivenessUnknown{}}, R.EvStartReleaseSent{}) == R.Refused{"startReleaseSent from starting"} : R.Transition}

def a_start_release_before_the_endpoint_is_refused():
  {==}

law child_exit_records_the_exited_liveness:
  for +liveness: R.Liveness
  {R.advance(R.Rec{R.Running{}, "0", "0", R.Idle{}, liveness}, R.EvChildExit{}) == R.Advanced{R.Rec{R.Exited{}, "0", "0", R.Idle{}, R.LivenessExited{}}} : R.Transition}

def child_exit_records_the_exited_liveness(liveness):
  {==}

law a_stopped_event_completes_an_acknowledged_pause_request:
  for +epoch: String
  for +mutation: String
  for +liveness: R.Liveness
  {R.advance(R.Rec{R.PausePending{}, epoch, mutation, R.Idle{}, liveness}, R.EvPaused{}) == Bool.pick(R.Transition, R.counter_valid(epoch), R.Advanced{R.Rec{R.Paused{}, R.counter_next(epoch), mutation, R.Idle{}, R.LivenessLive{}}}, R.Refused{"counterMalformed"}) : R.Transition}

def a_stopped_event_completes_an_acknowledged_pause_request(epoch, mutation, liveness):
  {==}

# ---------------------------------------------------------------------------
# The public intent union and its predicates.

law observe_needs_no_grant:
  {R.admit_intent(R.Rec{R.Running{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.IntentObserve{}, Nil{}, "", "") == R.Admitted{} : R.Decision}

def observe_needs_no_grant():
  {==}

law evaluate_requires_the_control_grant_first:
  for +epoch: String
  for +mutation: String
  for +liveness: R.Liveness
  {R.admit_intent(R.Rec{R.Paused{}, epoch, mutation, R.Idle{}, liveness}, R.IntentEvaluate{}, Nil{}, "", "") == R.MissingEffect{"controlRuntime"} : R.Decision}

def evaluate_requires_the_control_grant_first(epoch, mutation, liveness):
  {==}

law evaluate_requires_its_own_grant_after_the_control_grant:
  {R.admit_intent(R.Rec{R.Paused{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.IntentEvaluate{}, [R.ControlRuntime{}], "", "") == R.MissingEffect{"evaluateRuntime"} : R.Decision}

def evaluate_requires_its_own_grant_after_the_control_grant():
  {==}

law evaluate_is_admitted_with_both_grants:
  {R.admit_intent(R.Rec{R.Paused{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.IntentEvaluate{}, [R.ControlRuntime{}, R.EvaluateRuntime{}], "", "") == R.Admitted{} : R.Decision}

def evaluate_is_admitted_with_both_grants():
  {==}

law launch_is_admitted_only_before_the_target_starts:
  {R.admit_intent(R.Rec{R.Running{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.IntentLaunch{}, [R.ControlRuntime{}], "", "") == R.IntentNotAdmitted{"launch"} : R.Decision}

def launch_is_admitted_only_before_the_target_starts():
  {==}

law launch_requires_the_control_grant:
  {R.admit_intent(R.Rec{R.Starting{}, "0", "0", R.Idle{}, R.LivenessUnknown{}}, R.IntentLaunch{}, Nil{}, "", "") == R.MissingEffect{"controlRuntime"} : R.Decision}

def launch_requires_the_control_grant():
  {==}

law launch_is_admitted_with_the_control_grant_before_the_start:
  {R.admit_intent(R.Rec{R.WaitingForStart{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.IntentLaunch{}, [R.ControlRuntime{}], "", "") == R.Admitted{} : R.Decision}

def launch_is_admitted_with_the_control_grant_before_the_start():
  {==}

law launch_is_refused_while_an_intent_is_pending:
  {R.admit_intent(R.Rec{R.WaitingForStart{}, "0", "0", R.Evaluation{"q"}, R.LivenessLive{}}, R.IntentLaunch{}, [R.ControlRuntime{}], "", "") == R.RuntimeBusy{"evaluate"} : R.Decision}

def launch_is_refused_while_an_intent_is_pending():
  {==}

law serialized_intents_refuse_runtime_busy:
  {R.admit_intent(R.Rec{R.Paused{}, "0", "0", R.Evaluation{"q"}, R.LivenessLive{}}, R.IntentResumeStep{}, [R.ControlRuntime{}], "", "") == R.RuntimeBusy{"evaluate"} : R.Decision}

def serialized_intents_refuse_runtime_busy():
  {==}

law release_is_admitted_while_an_evaluation_is_pending:
  {R.admit_intent(R.Rec{R.Paused{}, "0", "0", R.Evaluation{"q"}, R.LivenessLive{}}, R.IntentRelease{}, [R.ControlRuntime{}], "SIGKILL", "") == R.Admitted{} : R.Decision}

def release_is_admitted_while_an_evaluation_is_pending():
  {==}

law release_requires_the_control_grant:
  {R.admit_intent(R.Rec{R.Running{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.IntentRelease{}, Nil{}, "SIGTERM", "") == R.MissingEffect{"controlRuntime"} : R.Decision}

def release_requires_the_control_grant():
  {==}

law sigterm_cannot_overwrite_an_explicit_sigkill_intent:
  {R.admit_intent(R.Rec{R.Running{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.IntentRelease{}, [R.ControlRuntime{}], "SIGTERM", "SIGKILL") == R.SignalDowngrade{} : R.Decision}

def sigterm_cannot_overwrite_an_explicit_sigkill_intent():
  {==}

law an_unlisted_release_signal_refuses:
  {R.admit_intent(R.Rec{R.Running{}, "0", "0", R.Idle{}, R.LivenessLive{}}, R.IntentRelease{}, [R.ControlRuntime{}], "SIGUSR1", "") == R.SignalUnsupported{"SIGUSR1"} : R.Decision}

def an_unlisted_release_signal_refuses():
  {==}

law release_is_refused_after_the_target_exited:
  {R.admit_intent(R.Rec{R.Exited{}, "0", "0", R.Idle{}, R.LivenessExited{}}, R.IntentRelease{}, [R.ControlRuntime{}], "SIGTERM", "") == R.IntentNotAdmitted{"release"} : R.Decision}

def release_is_refused_after_the_target_exited():
  {==}
