# CLAIM: replaying explicit turn-end, report and wake-delivery fixtures rejects a live wait with no
# delivered wake recorded for its own worker/task/turn identity, keeps a correlation that does not
# hold at unconfirmed, and asserts that the routing metadata the wake table derives for each adapter
# row equals the routing that row declares. A disagreement ends the run non-zero.
# Scope: a fixture corpus, a pure decision table over explicit identities, and a host half that
# derives each adapter row's routing from impl/src/wake-stream.mjs. No impl file is modified.
#
# The routing column is ROUTING METADATA. It is replayed and asserted, and no verdict is computed
# from it: a frame routed to a task says where the frame goes and nothing about whether a seat's
# orchestrator was reached.
#
# Delivery is established by an observation of a delivered wake whose key equals the turn's own
# worker/task/turn identity and whose recipient is the resolved orchestrator, or by a delivery
# receipt with that same key and recipient. A turn whose key is unstated, an observation whose key
# is unstated, and an observation or receipt recorded for a different turn all stay unconfirmed.
#
# The four facts the operator's decision needs do not exist in the tree at this pin: nothing composes
# a turn report, `parentId` is the seat's lineage and is never a wake address, no record says which
# wake is owed, and the only delivery receipt in the tree is `message.delivered` for a peer message.
# The receipt column is declared by the fixtures.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-wake-delivery.evidence.md.
import Base

# Where a fixture comes from: a synthesized model case, or a row taken from a real adapter event.
type Source is Data:
  Model{}
  Adapter{}

type TurnEnd is Data:
  Ended{}
  NotEnded{}

type Report is Data:
  Reported{}
  NoReport{}

type Wait is Data:
  Live{}
  Settled{}

# A turn's identity: the worker, the task and the turn epoch. Unstated means the deployment cannot
# name it, which is not the same as naming a different one.
type Key is Data:
  KeyStated{worker: Nat, task: Nat, turn: Nat}
  KeyUnstated{}

# The resolved orchestrator the wake is owed to: the seat's parent seat, or the root.
type Parent is Data:
  ResolvedSeat{seat: Nat}
  Unresolved{}

# The wake table's ROUTING metadata for this turn's row. Never evidence of delivery.
type Routing is Data:
  SeatAddressed{}
  TaskAddressed{}
  NoFrame{}

# What was observed about a delivered wake, with the identity it was delivered for.
type Observation is Data:
  DeliveredToSeat{seat: Nat, key: Key}
  DeliveredToTask{key: Key}
  RecordedAbsent{key: Key}
  NotObserved{}

# A delivery receipt for this turn's wake, keyed by recipient and identity.
type Receipt is Data:
  ReceiptOnFile{seat: Nat, key: Key}
  ReceiptMissing{key: Key}
  ReceiptNotChecked{}

type Turn is Data:
  Turn{ended: TurnEnd, report: Report, wait: Wait, key: Key, parent: Parent,
       receipt: Receipt, observation: Observation, routing: Routing}

type Verdict is Data:
  Delivered{}
  Rejected{}
  Unconfirmed{}
  ObligationUnmet{}
  NotApplicable{}

type Fixture is Data:
  ParkRoutingRecordedAbsent{}
  ParkObservedToTask{}
  RecoveryDeliveredToOrchestrator{}
  ParkTransitionNotObserved{}
  TurnKeyUnstated{}
  ObservationKeyUnstated{}
  ObservationKeyDiffers{}
  DeliveredToAnotherSeat{}
  ReceiptEvidence{}
  ReceiptKeyDiffers{}
  NoReportLiveTurn{}
  ParentUnresolvedCase{}
  SettledTurnCase{}
def turn_of(f: Fixture) -> Turn:
  match f:
    case ParkRoutingRecordedAbsent{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptNotChecked{}, RecordedAbsent{KeyStated{11n, 22n, 33n}}, TaskAddressed{}}
    case ParkObservedToTask{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptNotChecked{}, DeliveredToTask{KeyStated{11n, 22n, 33n}}, TaskAddressed{}}
    case RecoveryDeliveredToOrchestrator{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptMissing{KeyStated{11n, 22n, 33n}}, DeliveredToSeat{7n, KeyStated{11n, 22n, 33n}}, SeatAddressed{}}
    case ParkTransitionNotObserved{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptNotChecked{}, NotObserved{}, NoFrame{}}
    case TurnKeyUnstated{}: Turn{Ended{}, Reported{}, Live{}, KeyUnstated{}, ResolvedSeat{7n}, ReceiptNotChecked{}, DeliveredToSeat{7n, KeyStated{11n, 22n, 33n}}, SeatAddressed{}}
    case ObservationKeyUnstated{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptNotChecked{}, DeliveredToSeat{7n, KeyUnstated{}}, SeatAddressed{}}
    case ObservationKeyDiffers{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptNotChecked{}, RecordedAbsent{KeyStated{11n, 22n, 34n}}, TaskAddressed{}}
    case DeliveredToAnotherSeat{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptNotChecked{}, DeliveredToSeat{9n, KeyStated{11n, 22n, 33n}}, SeatAddressed{}}
    case ReceiptEvidence{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptOnFile{7n, KeyStated{11n, 22n, 33n}}, NotObserved{}, NoFrame{}}
    case ReceiptKeyDiffers{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptOnFile{7n, KeyStated{11n, 22n, 34n}}, NotObserved{}, NoFrame{}}
    case NoReportLiveTurn{}: Turn{Ended{}, NoReport{}, Live{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptNotChecked{}, NotObserved{}, NoFrame{}}
    case ParentUnresolvedCase{}: Turn{Ended{}, Reported{}, Live{}, KeyStated{11n, 22n, 33n}, Unresolved{}, ReceiptNotChecked{}, NotObserved{}, NoFrame{}}
    case SettledTurnCase{}: Turn{Ended{}, Reported{}, Settled{}, KeyStated{11n, 22n, 33n}, ResolvedSeat{7n}, ReceiptNotChecked{}, NotObserved{}, NoFrame{}}

def source_of(f: Fixture) -> Source:
  match f:
    case ParkRoutingRecordedAbsent{}: Adapter{}
    case ParkObservedToTask{}: Adapter{}
    case RecoveryDeliveredToOrchestrator{}: Adapter{}
    case ParkTransitionNotObserved{}: Adapter{}
    case TurnKeyUnstated{}: Model{}
    case ObservationKeyUnstated{}: Model{}
    case ObservationKeyDiffers{}: Model{}
    case DeliveredToAnotherSeat{}: Model{}
    case ReceiptEvidence{}: Model{}
    case ReceiptKeyDiffers{}: Model{}
    case NoReportLiveTurn{}: Model{}
    case ParentUnresolvedCase{}: Model{}
    case SettledTurnCase{}: Model{}

def routing_of(f: Fixture) -> Routing:
  match f:
    case ParkRoutingRecordedAbsent{}: TaskAddressed{}
    case ParkObservedToTask{}: TaskAddressed{}
    case RecoveryDeliveredToOrchestrator{}: SeatAddressed{}
    case ParkTransitionNotObserved{}: NoFrame{}
    case TurnKeyUnstated{}: SeatAddressed{}
    case ObservationKeyUnstated{}: SeatAddressed{}
    case ObservationKeyDiffers{}: TaskAddressed{}
    case DeliveredToAnotherSeat{}: SeatAddressed{}
    case ReceiptEvidence{}: NoFrame{}
    case ReceiptKeyDiffers{}: NoFrame{}
    case NoReportLiveTurn{}: NoFrame{}
    case ParentUnresolvedCase{}: NoFrame{}
    case SettledTurnCase{}: NoFrame{}

def adapter_index(f: Fixture) -> Nat:
  match f:
    case ParkRoutingRecordedAbsent{}: 0n
    case ParkObservedToTask{}: 0n
    case RecoveryDeliveredToOrchestrator{}: 1n
    case ParkTransitionNotObserved{}: 2n
    case TurnKeyUnstated{}: 3n
    case ObservationKeyUnstated{}: 3n
    case ObservationKeyDiffers{}: 3n
    case DeliveredToAnotherSeat{}: 3n
    case ReceiptEvidence{}: 3n
    case ReceiptKeyDiffers{}: 3n
    case NoReportLiveTurn{}: 3n
    case ParentUnresolvedCase{}: 3n
    case SettledTurnCase{}: 3n

def label_of(f: Fixture) -> String:
  match f:
    case ParkRoutingRecordedAbsent{}: "park-routing-recorded-absent"
    case ParkObservedToTask{}: "park-observed-to-task"
    case RecoveryDeliveredToOrchestrator{}: "recovery-delivered-to-orchestrator"
    case ParkTransitionNotObserved{}: "park-transition-not-observed"
    case TurnKeyUnstated{}: "turn-key-unstated"
    case ObservationKeyUnstated{}: "observation-key-unstated"
    case ObservationKeyDiffers{}: "observation-key-differs"
    case DeliveredToAnotherSeat{}: "delivered-to-another-seat"
    case ReceiptEvidence{}: "receipt-on-file"
    case ReceiptKeyDiffers{}: "receipt-key-differs"
    case NoReportLiveTurn{}: "no-report-live-turn"
    case ParentUnresolvedCase{}: "parent-unresolved"
    case SettledTurnCase{}: "settled-turn"

def expected_of(f: Fixture) -> Verdict:
  match f:
    case ParkRoutingRecordedAbsent{}: Rejected{}
    case ParkObservedToTask{}: Unconfirmed{}
    case RecoveryDeliveredToOrchestrator{}: Delivered{}
    case ParkTransitionNotObserved{}: Unconfirmed{}
    case TurnKeyUnstated{}: Unconfirmed{}
    case ObservationKeyUnstated{}: Unconfirmed{}
    case ObservationKeyDiffers{}: Unconfirmed{}
    case DeliveredToAnotherSeat{}: Unconfirmed{}
    case ReceiptEvidence{}: Delivered{}
    case ReceiptKeyDiffers{}: Unconfirmed{}
    case NoReportLiveTurn{}: ObligationUnmet{}
    case ParentUnresolvedCase{}: Rejected{}
    case SettledTurnCase{}: NotApplicable{}

def expected_confirmed(f: Fixture) -> Bool:
  match f:
    case ParkRoutingRecordedAbsent{}: False{}
    case ParkObservedToTask{}: False{}
    case RecoveryDeliveredToOrchestrator{}: True{}
    case ParkTransitionNotObserved{}: False{}
    case TurnKeyUnstated{}: False{}
    case ObservationKeyUnstated{}: False{}
    case ObservationKeyDiffers{}: False{}
    case DeliveredToAnotherSeat{}: False{}
    case ReceiptEvidence{}: True{}
    case ReceiptKeyDiffers{}: False{}
    case NoReportLiveTurn{}: False{}
    case ParentUnresolvedCase{}: False{}
    case SettledTurnCase{}: False{}


def and2(a: Bool, b: Bool) -> Bool:
  match a:
    case True{}: b
    case False{}: False{}

def and3(a: Bool, b: Bool, c: Bool) -> Bool:
  and2(a, and2(b, c))

def key_matches(a: Key, b: Key) -> Bool:
  match a:
    case KeyStated{+worker, +task, +turn}:
      match b:
        case KeyStated{+w, +t, +n}: and3(Nat.is_eq(worker, w), Nat.is_eq(task, t), Nat.is_eq(turn, n))
        case KeyUnstated{}: False{}
    case KeyUnstated{}: False{}

def obs_key(o: Observation) -> Key:
  match o:
    case DeliveredToSeat{_, +k}: k
    case DeliveredToTask{+k}: k
    case RecordedAbsent{+k}: k
    case NotObserved{}: KeyUnstated{}

def obs_seat(o: Observation) -> Nat:
  match o:
    case DeliveredToSeat{+s, _}: s
    case _: 0n

def parent_seat(p: Parent) -> Nat:
  match p:
    case ResolvedSeat{+s}: s
    case Unresolved{}: 0n

def receipt_key(r: Receipt) -> Key:
  match r:
    case ReceiptOnFile{_, +k}: k
    case ReceiptMissing{+k}: k
    case ReceiptNotChecked{}: KeyUnstated{}

def receipt_seat(r: Receipt) -> Nat:
  match r:
    case ReceiptOnFile{+s, _}: s
    case _: 0n

# A receipt establishes delivery only when it names this turn's identity and the resolved seat.
def receipt_holds(key: Key, parent: Parent, +receipt: Receipt) -> Bool:
  and2(key_matches(receipt_key(receipt), key), Nat.is_eq(receipt_seat(receipt), parent_seat(parent)))

# An observation establishes delivery only when it names this turn's identity and the resolved seat.
def obs_key_holds(key: Key, obs: Observation) -> Bool:
  key_matches(obs_key(obs), key)

def obs_seat_holds(key: Key, parent: Parent, +obs: Observation) -> Bool:
  and2(key_matches(obs_key(obs), key), Nat.is_eq(obs_seat(obs), parent_seat(parent)))

# A recorded absence leaves the wait rejected; anything else that is not an identity-matched delivery
# leaves it unconfirmed.
def absent_or_unconfirmed(o: Observation) -> Verdict:
  match o:
    case RecordedAbsent{_}: Rejected{}
    case _: Unconfirmed{}

def decide(wait: Wait, ended: TurnEnd, report: Report, parent: Parent, obs: Observation,
           receipt_holds: Bool, obs_key_holds: Bool, obs_seat_holds: Bool) -> Verdict:
  match wait:
    case Settled{}: NotApplicable{}
    case Live{}:
      match ended:
        case NotEnded{}: NotApplicable{}
        case Ended{}:
          match report:
            case NoReport{}: ObligationUnmet{}
            case Reported{}:
              match parent:
                case Unresolved{}: Rejected{}
                case ResolvedSeat{_}:
                  match receipt_holds:
                    case True{}: Delivered{}
                    case False{}:
                      match obs_key_holds:
                        case False{}: Unconfirmed{}
                        case True{}:
                          match obs_seat_holds:
                            case True{}: Delivered{}
                            case False{}: absent_or_unconfirmed(obs)

def routing_code(r: Routing) -> U32:
  match r:
    case SeatAddressed{}: 0
    case TaskAddressed{}: 1
    case NoFrame{}: 2

def routing_label(r: Routing) -> String:
  match r:
    case SeatAddressed{}: "seat-addressed"
    case TaskAddressed{}: "task-addressed"
    case NoFrame{}: "no-frame"

def verdict_label(v: Verdict) -> String:
  match v:
    case Delivered{}: "delivered"
    case Rejected{}: "rejected"
    case Unconfirmed{}: "unconfirmed"
    case ObligationUnmet{}: "obligation-unmet"
    case NotApplicable{}: "not-applicable"

def is_unconfirmed(v: Verdict) -> Bool:
  match v:
    case Delivered{}: False{}
    case Rejected{}: False{}
    case Unconfirmed{}: True{}
    case ObligationUnmet{}: False{}
    case NotApplicable{}: False{}

def is_unmet(v: Verdict) -> Bool:
  match v:
    case Delivered{}: False{}
    case Rejected{}: False{}
    case Unconfirmed{}: False{}
    case ObligationUnmet{}: True{}
    case NotApplicable{}: False{}

def verdict_turn(t: Turn) -> Verdict:
  match t:
    case Turn{+ended, +report, +wait, +key, +parent, +receipt, +obs, _}:
      decide(wait, ended, report, parent, obs,
             receipt_holds(key, parent, receipt),
             obs_key_holds(key, obs),
             obs_seat_holds(key, parent, obs))

def verdict_of(f: Fixture) -> Verdict:
  verdict_turn(turn_of(f))

def confirmed_verdict(v: Verdict) -> Bool:
  match v:
    case Delivered{}: True{}
    case Rejected{}: False{}
    case Unconfirmed{}: False{}
    case ObligationUnmet{}: False{}
    case NotApplicable{}: False{}

def delivery_confirmed(f: Fixture) -> Bool:
  confirmed_verdict(verdict_of(f))

# Every fixture's verdict is the one the corpus records.
law every_fixture_matches_its_expectation:
  for +f: Fixture
  {verdict_of(f) == expected_of(f) : Verdict}

def every_fixture_matches_its_expectation(f):
  match f:
    case ParkRoutingRecordedAbsent{}: {==}
    case ParkObservedToTask{}: {==}
    case RecoveryDeliveredToOrchestrator{}: {==}
    case ParkTransitionNotObserved{}: {==}
    case TurnKeyUnstated{}: {==}
    case ObservationKeyUnstated{}: {==}
    case ObservationKeyDiffers{}: {==}
    case DeliveredToAnotherSeat{}: {==}
    case ReceiptEvidence{}: {==}
    case ReceiptKeyDiffers{}: {==}
    case NoReportLiveTurn{}: {==}
    case ParentUnresolvedCase{}: {==}
    case SettledTurnCase{}: {==}

# An identity the deployment cannot state leaves the answer unconfirmed.
def unstated_turn(t: Turn, v: Verdict) -> Bool:
  match t:
    case Turn{_, _, _, KeyUnstated{}, _, _, _, _}: is_unconfirmed(v)
    case Turn{_, _, _, _, _, _, DeliveredToSeat{_, KeyUnstated{}}, _}: is_unconfirmed(v)
    case Turn{_, _, _, _, _, _, DeliveredToTask{KeyUnstated{}}, _}: is_unconfirmed(v)
    case Turn{_, _, _, _, _, _, _, _}: True{}

def unstated_key_is_unconfirmed(+f: Fixture) -> Bool:
  unstated_turn(turn_of(f), verdict_of(f))

law an_unstated_identity_stays_unconfirmed:
  for +f: Fixture
  {unstated_key_is_unconfirmed(f) == True{} : Bool}

def an_unstated_identity_stays_unconfirmed(f):
  match f:
    case ParkRoutingRecordedAbsent{}: {==}
    case ParkObservedToTask{}: {==}
    case RecoveryDeliveredToOrchestrator{}: {==}
    case ParkTransitionNotObserved{}: {==}
    case TurnKeyUnstated{}: {==}
    case ObservationKeyUnstated{}: {==}
    case ObservationKeyDiffers{}: {==}
    case DeliveredToAnotherSeat{}: {==}
    case ReceiptEvidence{}: {==}
    case ReceiptKeyDiffers{}: {==}
    case NoReportLiveTurn{}: {==}
    case ParentUnresolvedCase{}: {==}
    case SettledTurnCase{}: {==}

# An observation or receipt recorded for a different turn leaves this turn's answer unconfirmed.
def keys_differ(same: Bool, v: Verdict) -> Bool:
  match same:
    case True{}: True{}
    case False{}: is_unconfirmed(v)

def foreign_key_verdict(w: Nat, t: Nat, n: Nat, w2: Nat, t2: Nat, n2: Nat, v: Verdict) -> Bool:
  keys_differ(and3(Nat.is_eq(w, w2), Nat.is_eq(t, t2), Nat.is_eq(n, n2)), v)

def foreign_turn(t: Turn, v: Verdict) -> Bool:
  match t:
    case Turn{_, _, _, KeyStated{+w, +t, +n}, _, _, DeliveredToSeat{_, KeyStated{+w2, +t2, +n2}}, _}:
      foreign_key_verdict(w, t, n, w2, t2, n2, v)
    case Turn{_, _, _, KeyStated{+w, +t, +n}, _, _, DeliveredToTask{KeyStated{+w2, +t2, +n2}}, _}:
      foreign_key_verdict(w, t, n, w2, t2, n2, v)
    case Turn{_, _, _, KeyStated{+w, +t, +n}, _, ReceiptOnFile{_, KeyStated{+w2, +t2, +n2}}, _, _}:
      foreign_key_verdict(w, t, n, w2, t2, n2, v)
    case Turn{_, _, _, _, _, _, _, _}: True{}

def foreign_identity_is_unconfirmed(+f: Fixture) -> Bool:
  foreign_turn(turn_of(f), verdict_of(f))

law a_foreign_identity_stays_unconfirmed:
  for +f: Fixture
  {foreign_identity_is_unconfirmed(f) == True{} : Bool}

def a_foreign_identity_stays_unconfirmed(f):
  match f:
    case ParkRoutingRecordedAbsent{}: {==}
    case ParkObservedToTask{}: {==}
    case RecoveryDeliveredToOrchestrator{}: {==}
    case ParkTransitionNotObserved{}: {==}
    case TurnKeyUnstated{}: {==}
    case ObservationKeyUnstated{}: {==}
    case ObservationKeyDiffers{}: {==}
    case DeliveredToAnotherSeat{}: {==}
    case ReceiptEvidence{}: {==}
    case ReceiptKeyDiffers{}: {==}
    case NoReportLiveTurn{}: {==}
    case ParentUnresolvedCase{}: {==}
    case SettledTurnCase{}: {==}

# Routing metadata is not an input to the decision: a verdict is unchanged when the routing column
# is replaced by another value. The decision table takes no routing parameter, and this law holds it
# to that.
def is_delivered(v: Verdict) -> Bool:
  match v:
    case Delivered{}: True{}
    case Rejected{}: False{}
    case Unconfirmed{}: False{}
    case ObligationUnmet{}: False{}
    case NotApplicable{}: False{}

def is_rejected(v: Verdict) -> Bool:
  match v:
    case Delivered{}: False{}
    case Rejected{}: True{}
    case Unconfirmed{}: False{}
    case ObligationUnmet{}: False{}
    case NotApplicable{}: False{}

def is_not_applicable(v: Verdict) -> Bool:
  match v:
    case Delivered{}: False{}
    case Rejected{}: False{}
    case Unconfirmed{}: False{}
    case ObligationUnmet{}: False{}
    case NotApplicable{}: True{}

def verdict_eq(a: Verdict, b: Verdict) -> Bool:
  match a:
    case Delivered{}: is_delivered(b)
    case Rejected{}: is_rejected(b)
    case Unconfirmed{}: is_unconfirmed(b)
    case ObligationUnmet{}: is_unmet(b)
    case NotApplicable{}: is_not_applicable(b)

def turn_without_routing(t: Turn) -> Turn:
  match t:
    case Turn{+ended, +report, +wait, +key, +parent, +receipt, +obs, _}:
      Turn{ended, report, wait, key, parent, receipt, obs, NoFrame{}}

def routing_same(+t: Turn) -> Bool:
  verdict_eq(verdict_turn(turn_without_routing(t)), verdict_turn(t))

def routing_irrelevant(+f: Fixture) -> Bool:
  routing_same(turn_of(f))

law routing_is_not_an_input_to_the_decision:
  for +f: Fixture
  {routing_irrelevant(f) == True{} : Bool}
def routing_is_not_an_input_to_the_decision(f):
  match f:
    case ParkRoutingRecordedAbsent{}: {==}
    case ParkObservedToTask{}: {==}
    case RecoveryDeliveredToOrchestrator{}: {==}
    case ParkTransitionNotObserved{}: {==}
    case TurnKeyUnstated{}: {==}
    case ObservationKeyUnstated{}: {==}
    case ObservationKeyDiffers{}: {==}
    case DeliveredToAnotherSeat{}: {==}
    case ReceiptEvidence{}: {==}
    case ReceiptKeyDiffers{}: {==}
    case NoReportLiveTurn{}: {==}
    case ParentUnresolvedCase{}: {==}
    case SettledTurnCase{}: {==}

# A live turn that ended without its report has an unmet obligation, which is not NotApplicable.
def report_turn(t: Turn, v: Verdict) -> Bool:
  match t:
    case Turn{Ended{}, NoReport{}, Live{}, _, _, _, _, _}: is_unmet(v)
    case Turn{_, _, _, _, _, _, _, _}: True{}

def no_report_is_unmet(+f: Fixture) -> Bool:
  report_turn(turn_of(f), verdict_of(f))

law a_reportless_live_turn_is_an_unmet_obligation:
  for +f: Fixture
  {no_report_is_unmet(f) == True{} : Bool}

def a_reportless_live_turn_is_an_unmet_obligation(f):
  match f:
    case ParkRoutingRecordedAbsent{}: {==}
    case ParkObservedToTask{}: {==}
    case RecoveryDeliveredToOrchestrator{}: {==}
    case ParkTransitionNotObserved{}: {==}
    case TurnKeyUnstated{}: {==}
    case ObservationKeyUnstated{}: {==}
    case ObservationKeyDiffers{}: {==}
    case DeliveredToAnotherSeat{}: {==}
    case ReceiptEvidence{}: {==}
    case ReceiptKeyDiffers{}: {==}
    case NoReportLiveTurn{}: {==}
    case ParentUnresolvedCase{}: {==}
    case SettledTurnCase{}: {==}

law delivery_confirmed_only_by_identity_matched_evidence:
  for +f: Fixture
  {delivery_confirmed(f) == expected_confirmed(f) : Bool}

def delivery_confirmed_only_by_identity_matched_evidence(f):
  match f:
    case ParkRoutingRecordedAbsent{}: {==}
    case ParkObservedToTask{}: {==}
    case RecoveryDeliveredToOrchestrator{}: {==}
    case ParkTransitionNotObserved{}: {==}
    case TurnKeyUnstated{}: {==}
    case ObservationKeyUnstated{}: {==}
    case ObservationKeyDiffers{}: {==}
    case DeliveredToAnotherSeat{}: {==}
    case ReceiptEvidence{}: {==}
    case ReceiptKeyDiffers{}: {==}
    case NoReportLiveTurn{}: {==}
    case ParentUnresolvedCase{}: {==}
    case SettledTurnCase{}: {==}

# The host half: impl/src/wake-stream.mjs's ROUTING metadata for an adapter fixture's own row.
# 0 = seat-addressed, 1 = task-addressed, 2 = no frame derived.
def Real.adapter_routing(index: Nat) -> IO(U32):
  import "./laws-wake-delivery.js"

def derived_label(+code: U32, is_seat: Bool, is_task: Bool) -> String:
  match is_seat:
    case True{}: "seat-addressed"
    case False{}:
      match is_task:
        case True{}: "task-addressed"
        case False{}: "no-frame"

def derived_words(+code: U32) -> String:
  derived_label(code, U32.is_eq(code, 0), U32.is_eq(code, 1))

def replay_model(+f: Fixture) -> IO(Unit):
  do IO<Unit>:
    IO.print(label_of(f) ++ " source=model verdict=" ++ verdict_label(verdict_of(f)))

def adapter_line(agree: Bool, +code: U32, +f: Fixture) -> IO(Unit):
  match agree:
    case True{}: IO.print(label_of(f) ++ " source=adapter derived=" ++ derived_words(code) ++ " declared=" ++ routing_label(routing_of(f)) ++ " verdict=" ++ verdict_label(verdict_of(f)))
    case False{}: IO.die(Unit, 1, label_of(f) ++ " routing DISAGREE: declared " ++ routing_label(routing_of(f)) ++ " derived " ++ derived_words(code))

# An adapter row's derived routing is ASSERTED against the routing the fixture declares; a
# disagreement ends the run with the code 1, in either runtime lane.
def adapter_result(+code: U32, +f: Fixture) -> IO(Unit):
  adapter_line(U32.is_eq(code, routing_code(routing_of(f))), code, f)

def replay_adapter(+f: Fixture) -> IO(Unit):
  do IO<Unit>:
    code : U32 <- Real.adapter_routing(adapter_index(f))
    adapter_result(code, f)

def replay(s: Source, +f: Fixture) -> IO(Unit):
  match s:
    case Model{}: replay_model(f)
    case Adapter{}: replay_adapter(f)

def one(+f: Fixture) -> IO(Unit):
  replay(source_of(f), f)

def main() -> IO(Unit):
  do IO<Unit>:
    one(ParkRoutingRecordedAbsent{})
    one(ParkObservedToTask{})
    one(RecoveryDeliveredToOrchestrator{})
    one(ParkTransitionNotObserved{})
    one(TurnKeyUnstated{})
    one(ObservationKeyUnstated{})
    one(ObservationKeyDiffers{})
    one(DeliveredToAnotherSeat{})
    one(ReceiptEvidence{})
    one(ReceiptKeyDiffers{})
    one(NoReportLiveTurn{})
    one(ParentUnresolvedCase{})
    one(SettledTurnCase{})
    IO.print("wake-delivery witness: 13 fixtures replayed; each adapter row's derived routing is asserted against the routing it declares, and every verdict must equal the corpus expectation.")
