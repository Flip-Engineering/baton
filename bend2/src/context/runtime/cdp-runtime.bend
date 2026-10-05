# CLAIM: the native side of the CDP runtime contract is a pure admission function over
# typed runtime records. A runtime record carries its state, pause epoch, mutation
# generation, pending intent and target liveness; one event advances it or refuses, and
# one intent decision checks the caller's grants, the state the intent is admitted from,
# the serialization of state-changing intents and the release-signal order.
#
# Contract: docs/bend2/semantic-context-spec.md, "Runtime contract", with the retained
# counter decision (runtime-counter-boundary-69): the pause epoch and the mutation
# generation are canonical unsigned decimal text, "0" or [1-9][0-9]*, incremented by an
# exact successor with no finite numeric conversion and no wrap. A counter that is not
# admitted text refuses the transition, so no retired reference can be re-admitted by an
# overflow or a lost precision.
#
# Runtime state is starting, waitingForStart, running, pausePending, paused, releasing,
# exited or failed. The startup wait and a later actual paused event are distinct states.
# A pause request acknowledged by the protocol records pausePending and the stopped event
# completes it. An adapter failure may coexist with a still-running target, so `failed`
# alone is never a target-exit assertion: only target exit evidence changes the recorded
# liveness. The epoch advances at every observed pause, at an invalidating resume and at
# an execution-context destruction; the mutation generation advances before an explicit
# evaluation, which retires previously issued live-value references.
#
# The public intent union is exactly launch, observe, pause, resume-step, evaluate and
# release. Generated-location breakpoints belong to the launch intent's startup stop and
# are set by the adapter's control path; there is no separate breakpoint intent.
#
# Ownership: this module is the native admission side of the packet boundary. It consumes
# the typed members a parsed frame carries; text parsing and the canonical reference
# serialization belong to the canonical codec owner. The adapter process states the same
# rules over its own operative functions in bend2/context/runtime/cdp-state.mjs,
# cdp-counter.mjs and cdp-intents.mjs and emits the envelope this side admits.
#
# The laws over these functions are stated beside them in cdp-runtime-laws.bend. This
# module imports no shared law module and nothing outside Base.

import Base

type RuntimeState is Data:
  Starting{}
  WaitingForStart{}
  Running{}
  PausePending{}
  Paused{}
  Releasing{}
  Exited{}
  Failed{}

// Target liveness: whether the owned child is believed alive, exited, or unobserved. This
// is distinct from stop liveness below and only target exit evidence sets it to exited.
type Liveness is Data:
  LivenessUnknown{}
  LivenessLive{}
  LivenessExited{}

// Recorded-stop liveness: whether the last recorded stop is current evidence. It is a
// separate fact from target liveness, because a rejected resume or a destroyed context
// invalidates the stop while the target is still alive.
type StopLiveness is Data:
  StopAbsent{}
  StopLive{}
  StopHistorical{}
  StopUnknown{}

type Pending is Data:
  Idle{}
  Evaluation{query: String}
  InFlight{intent: String, query: String}

type RuntimeEvent is Data:
  EvLaunchStarted{}
  EvEndpointDiscovered{}
  EvStartReleaseSent{}
  EvPauseRequested{}
  EvPaused{}
  EvResumed{}
  EvResumeSent{}
  EvEvaluationSent{query: String}
  EvEvaluationSettled{}
  EvContextDestroyed{}
  EvIntentStarted{intent: String, query: String}
  EvIntentSettled{}
  EvResumeRejected{}
  EvReleaseCommitted{}
  EvAdapterFailed{}
  EvChildExit{}

type RuntimeRecord is Data:
  Rec{state: RuntimeState, epoch: String, mutation: String, pending: Pending, liveness: Liveness}

type Transition is Data:
  Advanced{record: RuntimeRecord}
  Refused{reason: String}

type Effect is Data:
  ExecuteTarget{}
  PlanTargetSql{}
  ReplayMigrations{}
  EvaluateRuntime{}
  ControlRuntime{}

type IntentName is Data:
  IntentLaunch{}
  IntentObserve{}
  IntentPause{}
  IntentResumeStep{}
  IntentEvaluate{}
  IntentRelease{}

type Decision is Data:
  Admitted{}
  MissingEffect{effect: String}
  IntentNotAdmitted{intent: String}
  RuntimeBusy{pending: String}
  SignalDowngrade{}
  SignalUnsupported{signal: String}

# The exact decimal successor. `inc` walks the text once and returns the incremented
# value with a carry flag; `counter_next` prepends the final carry. No numeric
# conversion takes place, so a counter of any length increments by one.

type Carry is Data:
  Carry{value: String, out: Bool}

def is_decimal_digit(+c: Char) -> Bool:
  Bool.and(U32.is_ge(Char.to_u32(c), 48), U32.is_le(Char.to_u32(c), 57))

def is_zero_char(+c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 48)

def is_nine_char(+c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 57)

def one_up(+c: Char) -> Char:
  Char.from_u32(U32.add(Char.to_u32(c), 1))

def is_nil(xs: String) -> Bool:
  match xs:
    case SNil{}: True{}
    case other: False{}

def all_digits(xs: String) -> Bool:
  match xs:
    case SNil{}: True{}
    case SCon{h, t}: Bool.and(is_decimal_digit(h), all_digits(t))

# "0" or [1-9][0-9]*
def counter_valid(+text: String) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{h, t}:
      Bool.and(is_decimal_digit(h),
        Bool.and(Bool.pick(Bool, is_zero_char(h), is_nil(t), True{}), all_digits(t)))

def inc(text: String) -> Carry:
  match text:
    case SNil{}: Carry{SNil{}, True{}}
    case SCon{h, t}:
      match inc(t):
        case Carry{value, out}:
          Bool.pick(Carry, out,
            Bool.pick(Carry, is_nine_char(h),
              Carry{SCon{one_zero(), value}, True{}},
              Carry{SCon{one_up(h), value}, False{}}),
            Carry{SCon{h, value}, False{}})

def one_zero() -> Char:
  Char.from_u32(48)

def counter_next(+text: String) -> String:
  match inc(text):
    case Carry{value, out}: Bool.pick(String, out, SCon{Char.from_u32(49), value}, value)

# State predicates. A value is compared by matching it, so no separate equality
# procedure over Data is introduced.

def is_starting(state: RuntimeState) -> Bool:
  match state:
    case Starting{}: True{}
    case other: False{}

def is_waiting(state: RuntimeState) -> Bool:
  match state:
    case WaitingForStart{}: True{}
    case other: False{}

def is_running(state: RuntimeState) -> Bool:
  match state:
    case Running{}: True{}
    case other: False{}

def is_paused(state: RuntimeState) -> Bool:
  match state:
    case Paused{}: True{}
    case other: False{}

def is_pause_pending(state: RuntimeState) -> Bool:
  match state:
    case PausePending{}: True{}
    case other: False{}

def is_exited(state: RuntimeState) -> Bool:
  match state:
    case Exited{}: True{}
    case other: False{}

# A stopped event is admitted from running, from an acknowledged pause request and from
# an earlier stop, and it may precede the protocol response of the request that caused it.
def stopped_state(+state: RuntimeState) -> Bool:
  match state:
    case Running{}: True{}
    case PausePending{}: True{}
    case Paused{}: True{}
    case WaitingForStart{}: True{}
    case other: False{}

# An observed resume is admitted only from a stop or an acknowledged pause request.
def resumed_state(+state: RuntimeState) -> Bool:
  match state:
    case Paused{}: True{}
    case PausePending{}: True{}
    case other: False{}

def evaluable(+state: RuntimeState) -> Bool:
  match state:
    case Running{}: True{}
    case Paused{}: True{}
    case other: False{}

def not_terminal(+state: RuntimeState) -> Bool:
  match state:
    case Exited{}: False{}
    case other: True{}

def is_idle(+pending: Pending) -> Bool:
  match pending:
    case Idle{}: True{}
    case other: False{}

def pending_name(+pending: Pending) -> String:
  match pending:
    case Idle{}: ""
    case Evaluation{query}: "evaluate"
    case InFlight{intent, query}: intent

def pending_evaluation(+pending: Pending) -> Bool:
  match pending:
    case Evaluation{query}: True{}
    case Idle{}: False{}
    case InFlight{intent, query}: False{}

def state_name(+state: RuntimeState) -> String:
  match state:
    case Starting{}: "starting"
    case WaitingForStart{}: "waitingForStart"
    case Running{}: "running"
    case PausePending{}: "pausePending"
    case Paused{}: "paused"
    case Releasing{}: "releasing"
    case Exited{}: "exited"
    case Failed{}: "failed"

def intent_name(+intent: IntentName) -> String:
  match intent:
    case IntentLaunch{}: "launch"
    case IntentObserve{}: "observe"
    case IntentPause{}: "pause"
    case IntentResumeStep{}: "resume-step"
    case IntentEvaluate{}: "evaluate"
    case IntentRelease{}: "release"

def signal_supported(+signal: String) -> Bool:
  Bool.or(String.eq(signal, "SIGTERM"), String.eq(signal, "SIGKILL"))

# The grants a caller holds. A missing required grant refuses before the effect.
def granted(effects: List<Effect>, +want: Effect) -> Bool:
  match effects:
    case Nil{}: False{}
    case h <> t:
      match h:
        case ExecuteTarget{}:
          match want:
            case ExecuteTarget{}: True{}
            case other: granted(t, want)
        case PlanTargetSql{}:
          match want:
            case PlanTargetSql{}: True{}
            case other: granted(t, want)
        case ReplayMigrations{}:
          match want:
            case ReplayMigrations{}: True{}
            case other: granted(t, want)
        case EvaluateRuntime{}:
          match want:
            case EvaluateRuntime{}: True{}
            case other: granted(t, want)
        case ControlRuntime{}:
          match want:
            case ControlRuntime{}: True{}
            case other: granted(t, want)

def granted_control(+effects: List<Effect>) -> Bool:
  granted(effects, ControlRuntime{})

def granted_evaluate(+effects: List<Effect>) -> Bool:
  granted(effects, EvaluateRuntime{})

# The states each public intent is admitted from.
def launch_state(+state: RuntimeState) -> Bool:
  Bool.or(is_starting(state), is_waiting(state))

def observe_state(+state: RuntimeState) -> Bool:
  not_terminal(state)

def pause_state(+state: RuntimeState) -> Bool:
  is_running(state)

def resume_step_state(+state: RuntimeState) -> Bool:
  is_paused(state)

def evaluate_state(+state: RuntimeState) -> Bool:
  evaluable(state)

def release_state(+state: RuntimeState) -> Bool:
  Bool.not(is_exited(state))

# State-changing CDP intents serialize per runtime; observe and release do not. Release
# stays available to the owner while an evaluation is pending.
def serialized(+intent: IntentName) -> Bool:
  match intent:
    case IntentObserve{}: False{}
    case IntentRelease{}: False{}
    case other: True{}

# One event advances the record, or refuses with a named reason. No elapsed time, no
# timer and no caller request participates: every transition names its own evidence.
def advance(record: RuntimeRecord, event: RuntimeEvent) -> Transition:
  match record:
    case Rec{state, epoch, mutation, pending, liveness}:
      match event:
        case EvLaunchStarted{}:
          Bool.pick(Transition, is_starting(state),
            Advanced{Rec{Starting{}, epoch, mutation, pending, LivenessLive{}}},
            Refused{"launchStarted from " ++ state_name(state)})
        case EvEndpointDiscovered{}:
          Bool.pick(Transition, is_starting(state),
            Advanced{Rec{WaitingForStart{}, epoch, mutation, pending, LivenessLive{}}},
            Refused{"endpointDiscovered from " ++ state_name(state)})
        case EvStartReleaseSent{}:
          Bool.pick(Transition, is_waiting(state),
            Advanced{Rec{Running{}, epoch, mutation, pending, liveness}},
            Bool.pick(Transition, is_paused(state),
              Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}},
              Refused{"startReleaseSent from " ++ state_name(state)}))
        case EvPauseRequested{}:
          Bool.pick(Transition, is_running(state),
            Advanced{Rec{PausePending{}, epoch, mutation, pending, liveness}},
            Refused{"pauseRequested from " ++ state_name(state)})
        case EvPaused{}:
          Bool.pick(Transition, counter_valid(epoch),
            Bool.pick(Transition, stopped_state(state),
              Advanced{Rec{Paused{}, counter_next(epoch), mutation, pending, LivenessLive{}}},
              Refused{"paused from " ++ state_name(state)}),
            Refused{"counterMalformed"})
        case EvResumed{}:
          Bool.pick(Transition, counter_valid(epoch),
            Bool.pick(Transition, resumed_state(state),
              Advanced{Rec{Running{}, counter_next(epoch), mutation, pending, liveness}},
              Refused{"resumed from " ++ state_name(state)}),
            Refused{"counterMalformed"})
        case EvResumeSent{}:
          Bool.pick(Transition, counter_valid(epoch),
            Bool.pick(Transition, is_paused(state),
              Advanced{Rec{Running{}, counter_next(epoch), mutation, pending, liveness}},
              Refused{"resumeSent from " ++ state_name(state)}),
            Refused{"counterMalformed"})
        case EvEvaluationSent{query}:
          Bool.pick(Transition, counter_valid(mutation),
            Bool.pick(Transition, evaluable(state),
              Bool.pick(Transition, is_idle(pending),
                Advanced{Rec{state, epoch, counter_next(mutation), Evaluation{query}, liveness}},
                Refused{"runtimeBusy " ++ pending_name(pending)}),
              Refused{"evaluationSent from " ++ state_name(state)}),
            Refused{"counterMalformed"})
        case EvEvaluationSettled{}:
          Bool.pick(Transition, is_exited(state),
            Refused{"evaluationSettled after exited"},
            Bool.pick(Transition, pending_evaluation(pending),
              Advanced{Rec{state, epoch, mutation, Idle{}, liveness}},
              Refused{"evaluationSettled without a pending evaluation"}))
        case EvContextDestroyed{}:
          Bool.pick(Transition, counter_valid(epoch),
            Bool.pick(Transition, is_exited(state),
              Refused{"contextDestroyed after exited"},
              Advanced{Rec{context_after(state), counter_next(epoch), mutation, pending, liveness}}),
            Refused{"counterMalformed"})
        case EvReleaseCommitted{}:
          Bool.pick(Transition, is_exited(state),
            Refused{"releaseCommitted after exited"},
            Advanced{Rec{Releasing{}, epoch, mutation, pending, liveness}})
        case EvIntentStarted{intent, query}:
          Bool.pick(Transition, is_exited(state),
            Refused{"intentStarted after exited"},
            Bool.pick(Transition, is_idle(pending),
              Advanced{Rec{state, epoch, mutation, InFlight{intent, query}, liveness}},
              Refused{"runtimeBusy " ++ pending_name(pending)}))
        case EvIntentSettled{}:
          Bool.pick(Transition, is_exited(state),
            Refused{"intentSettled after exited"},
            Bool.pick(Transition, is_idle(pending),
              Refused{"intentSettled without an in-flight intent"},
              Advanced{Rec{state, epoch, mutation, Idle{}, liveness}}))
        case EvResumeRejected{}:
          Bool.pick(Transition, is_running(state),
            Advanced{Rec{Paused{}, epoch, mutation, pending, liveness}},
            Refused{"resumeRejected from " ++ state_name(state)})
        case EvAdapterFailed{}:
          Bool.pick(Transition, is_exited(state),
            Refused{"adapterFailed after exited"},
            Advanced{Rec{Failed{}, epoch, mutation, pending, liveness}})
        case EvChildExit{}:
          Bool.pick(Transition, is_exited(state),
            Refused{"childExit after exited"},
            Advanced{Rec{Exited{}, epoch, mutation, pending, LivenessExited{}}})

# A destroyed context ends a stop or an acknowledged pause request and leaves every other
# state as it was.
def context_after(+state: RuntimeState) -> RuntimeState:
  Bool.pick(RuntimeState, Bool.or(is_paused(state), is_pause_pending(state)), Running{}, state)

# Recorded-stop liveness advances on the same events that invalidate a stop, on its own
# evidence and independently of target liveness. A stopped event records a live stop; a
# resume attempt, an observed resume and a destroyed context leave it historical; a rejected
# resume leaves it unknown, because no resumption was established and no fresh stop arrived.
def stop_liveness(+previous: StopLiveness, +event: RuntimeEvent) -> StopLiveness:
  match event:
    case EvPaused{}: StopLive{}
    case EvResumed{}: StopHistorical{}
    case EvResumeSent{}: StopHistorical{}
    case EvContextDestroyed{}: StopHistorical{}
    case EvResumeRejected{}: StopUnknown{}
    case EvAdapterFailed{}: stop_lost(previous)
    case other: previous

# An adapter failure invalidates a recorded stop without inventing stop history: a live or
# unknown stop becomes historical, and an absent stop stays absent.
def stop_lost(+previous: StopLiveness) -> StopLiveness:
  match previous:
    case StopAbsent{}: StopAbsent{}
    case other: StopHistorical{}

# A pause-scoped reference is admitted only against a live stop.
def stop_is_live(+stop: StopLiveness) -> Bool:
  match stop:
    case StopLive{}: True{}
    case other: False{}

# An intent that needs the control-runtime grant only.
def admit_control(
  +effects: List<Effect>,
  +state_ok: Bool,
  +pending: Pending,
  +serializes: Bool,
  +intent: IntentName
) -> Decision:
  Bool.pick(Decision, granted_control(effects),
    Bool.pick(Decision, state_ok,
      Bool.pick(Decision, Bool.and(serializes, Bool.not(is_idle(pending))),
        RuntimeBusy{pending_name(pending)},
        Admitted{}),
      IntentNotAdmitted{intent_name(intent)}),
    MissingEffect{"controlRuntime"})

# An intent that needs no grant of its own (observe) or is admitted by its own state.
def admit_granted(+state_ok: Bool, +intent: IntentName) -> Decision:
  Bool.pick(Decision, state_ok, Admitted{}, IntentNotAdmitted{intent_name(intent)})

def admit_evaluate(
  +effects: List<Effect>,
  +state_ok: Bool,
  +pending: Pending,
  +intent: IntentName
) -> Decision:
  Bool.pick(Decision, granted_control(effects),
    Bool.pick(Decision, granted_evaluate(effects),
      Bool.pick(Decision, state_ok,
        Bool.pick(Decision, is_idle(pending), Admitted{}, RuntimeBusy{pending_name(pending)}),
        IntentNotAdmitted{intent_name(intent)}),
      MissingEffect{"evaluateRuntime"}),
    MissingEffect{"controlRuntime"})

# Release stays available to the owner during a pending evaluation. An explicit SIGKILL
# intent cannot be overwritten by SIGTERM, and an unlisted signal refuses.
def admit_release(
  +effects: List<Effect>,
  +state_ok: Bool,
  +signal: String,
  +prior_signal: String,
  +intent: IntentName
) -> Decision:
  Bool.pick(Decision, granted_control(effects),
    Bool.pick(Decision, signal_supported(signal),
      Bool.pick(Decision,
        Bool.and(String.eq(prior_signal, "SIGKILL"), String.eq(signal, "SIGTERM")),
        SignalDowngrade{},
        Bool.pick(Decision, state_ok, Admitted{}, IntentNotAdmitted{intent_name(intent)})),
      SignalUnsupported{signal}),
    MissingEffect{"controlRuntime"})

# The admission decision for one public runtime intent. Grants and the signal domain are
# checked before the state, and the state before the serialization of a state-changing
# intent, so a refusal names the first failed predicate.
def admit_intent(
  record: RuntimeRecord,
  +intent: IntentName,
  +effects: List<Effect>,
  +signal: String,
  +prior_signal: String
) -> Decision:
  match record:
    case Rec{state, epoch, mutation, pending, liveness}:
      match intent:
        case IntentLaunch{}:
          admit_control(effects, launch_state(state), pending, serialized(intent), intent)
        case IntentObserve{}:
          admit_granted(observe_state(state), intent)
        case IntentPause{}:
          admit_control(effects, pause_state(state), pending, serialized(intent), intent)
        case IntentResumeStep{}:
          admit_control(effects, resume_step_state(state), pending, serialized(intent), intent)
        case IntentEvaluate{}:
          admit_evaluate(effects, evaluate_state(state), pending, intent)
        case IntentRelease{}:
          admit_release(effects, release_state(state), signal, prior_signal, intent)
