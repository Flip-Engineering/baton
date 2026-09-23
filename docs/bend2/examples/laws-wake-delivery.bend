# CLAIM: replaying explicit turn-end, report and wake-delivery fixtures rejects a live wait with no
# observed delivered wake, keeps a wake whose correlation is unknown or missing unconfirmed, and
# never lets the wake table's routing metadata decide delivery either way.
# Scope: a fixture corpus and a pure decision table, plus a host half that derives the routing
# metadata of the adapter fixtures from impl/src/wake-stream.mjs. No impl file is modified.
#
# The routing column is ROUTING METADATA, not delivery: it is what the wake table derives from a
# coordination row, and a task-addressed frame does not show that a seat's orchestrator was not
# reached. Delivery is decided only by the observation column and by a delivery receipt, and a
# correlation that is unknown or missing stays unconfirmed rather than becoming a rejection.
#
# The four facts the operator's decision needs do not exist in the tree at this pin: nothing
# composes a turn report, `parentId` is the seat's lineage and is never a wake address, no record
# says which wake is owed, and the only delivery receipt in the tree is `message.delivered` for a
# peer message, not for a wake. The receipt column is therefore declared by the fixtures.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-wake-delivery.evidence.md.
import Base

# Where a fixture comes from: a synthesized model case, or a row taken from a real adapter event.
type Source is Data:
  Model{}
  Adapter{}

# The explicit turn end and the turn's report.
type TurnEnd is Data:
  Ended{}
  NotEnded{}

type Report is Data:
  Reported{}
  NoReport{}

# Whether the seat is in a live wait at that turn end.
type Wait is Data:
  Live{}
  Settled{}

# Whether the frame could be correlated to this turn by worker, task and turn epoch.
type Correlation is Data:
  Correlated{}
  Unknown{}
  Missing{}

# Whether the seat's orchestrator (its parent seat, or the root) resolved as a wake address.
type Parent is Data:
  ParentResolved{}
  ParentMissing{}

# The wake table's ROUTING metadata for this turn's row. Never evidence of delivery.
type Routing is Data:
  SeatAddressed{}
  TaskAddressed{}
  NoFrame{}

# What was observed about a delivered wake for this turn.
type Observation is Data:
  WakeDelivered{}
  WakeAbsent{}
  WakeUnobserved{}

# A delivery receipt keyed by worker, task and turn epoch for this turn's wake.
type Receipt is Data:
  ReceiptOnFile{}
  ReceiptMissing{}
  ReceiptNotChecked{}

type Turn is Data:
  Turn{ended: TurnEnd, report: Report, wait: Wait, co: Correlation, parent: Parent,
       receipt: Receipt, observation: Observation, routing: Routing}

type Verdict is Data:
  Delivered{}
  Rejected{}
  Unconfirmed{}
  NotApplicable{}

type Fixture is Data:
  ParkWakeAbsent{}
  ParkWakeObserved{}
  RecoverySeatAddressed{}
  ParkTransitionNoFrame{}
  UnknownCorrelation{}
  MissingCorrelation{}
  ReceiptPresent{}
  DeliveredNoReceipt{}
  UnresolvedParent{}
  SettledTurn{}

def decide(t: Turn) -> Verdict:
  match t:
    case Turn{_, _, Settled{}, _, _, _, _, _}: NotApplicable{}
    case Turn{NotEnded{}, _, _, _, _, _, _, _}: NotApplicable{}
    case Turn{Ended{}, NoReport{}, _, _, _, _, _, _}: NotApplicable{}
    case Turn{Ended{}, Reported{}, Live{}, Unknown{}, _, _, _, _}: Unconfirmed{}
    case Turn{Ended{}, Reported{}, Live{}, Missing{}, _, _, _, _}: Unconfirmed{}
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentMissing{}, _, _, _}: Rejected{}
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, ReceiptOnFile{}, _, _}: Delivered{}
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, _, WakeDelivered{}, SeatAddressed{}}: Delivered{}
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, _, WakeDelivered{}, TaskAddressed{}}: Unconfirmed{}
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, _, WakeDelivered{}, NoFrame{}}: Unconfirmed{}
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, _, WakeAbsent{}, _}: Rejected{}
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, _, WakeUnobserved{}, _}: Unconfirmed{}

# Delivery is established by a receipt, or by an observed wake addressed to the seat. Routing alone
# establishes neither, and an absent receipt is not evidence that nothing was delivered.
def confirmed(t: Turn) -> Bool:
  match t:
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, ReceiptOnFile{}, _, _}: True{}
    case Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, _, WakeDelivered{}, SeatAddressed{}}: True{}
    case Turn{_, _, _, _, _, _, _, _}: False{}

def turn_of(f: Fixture) -> Turn:
  match f:
    case ParkWakeAbsent{}: Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, ReceiptNotChecked{}, WakeAbsent{}, TaskAddressed{}}
    case ParkWakeObserved{}: Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, ReceiptNotChecked{}, WakeDelivered{}, TaskAddressed{}}
    case RecoverySeatAddressed{}: Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, ReceiptNotChecked{}, WakeDelivered{}, SeatAddressed{}}
    case ParkTransitionNoFrame{}: Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, ReceiptNotChecked{}, WakeUnobserved{}, NoFrame{}}
    case UnknownCorrelation{}: Turn{Ended{}, Reported{}, Live{}, Unknown{}, ParentResolved{}, ReceiptNotChecked{}, WakeDelivered{}, SeatAddressed{}}
    case MissingCorrelation{}: Turn{Ended{}, Reported{}, Live{}, Missing{}, ParentResolved{}, ReceiptNotChecked{}, WakeAbsent{}, NoFrame{}}
    case ReceiptPresent{}: Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, ReceiptOnFile{}, WakeUnobserved{}, NoFrame{}}
    case DeliveredNoReceipt{}: Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentResolved{}, ReceiptMissing{}, WakeDelivered{}, SeatAddressed{}}
    case UnresolvedParent{}: Turn{Ended{}, Reported{}, Live{}, Correlated{}, ParentMissing{}, ReceiptNotChecked{}, WakeUnobserved{}, NoFrame{}}
    case SettledTurn{}: Turn{Ended{}, Reported{}, Settled{}, Correlated{}, ParentResolved{}, ReceiptNotChecked{}, WakeUnobserved{}, NoFrame{}}

def source_of(f: Fixture) -> Source:
  match f:
    case ParkWakeAbsent{}: Adapter{}
    case ParkWakeObserved{}: Adapter{}
    case RecoverySeatAddressed{}: Adapter{}
    case ParkTransitionNoFrame{}: Adapter{}
    case UnknownCorrelation{}: Model{}
    case MissingCorrelation{}: Model{}
    case ReceiptPresent{}: Model{}
    case DeliveredNoReceipt{}: Model{}
    case UnresolvedParent{}: Model{}
    case SettledTurn{}: Model{}

def adapter_index(f: Fixture) -> Nat:
  match f:
    case ParkWakeAbsent{}: 0n
    case ParkWakeObserved{}: 0n
    case RecoverySeatAddressed{}: 1n
    case ParkTransitionNoFrame{}: 2n
    case UnknownCorrelation{}: 3n
    case MissingCorrelation{}: 3n
    case ReceiptPresent{}: 3n
    case DeliveredNoReceipt{}: 3n
    case UnresolvedParent{}: 3n
    case SettledTurn{}: 3n

def label_of(f: Fixture) -> String:
  match f:
    case ParkWakeAbsent{}: "park-wake-absent"
    case ParkWakeObserved{}: "park-wake-observed"
    case RecoverySeatAddressed{}: "recovery-seat-addressed"
    case ParkTransitionNoFrame{}: "park-transition-no-frame"
    case UnknownCorrelation{}: "correlation-unknown"
    case MissingCorrelation{}: "correlation-missing"
    case ReceiptPresent{}: "receipt-present"
    case DeliveredNoReceipt{}: "delivered-no-receipt"
    case UnresolvedParent{}: "parent-unresolved"
    case SettledTurn{}: "settled-turn"

def expected_of(f: Fixture) -> Verdict:
  match f:
    case ParkWakeAbsent{}: Rejected{}
    case ParkWakeObserved{}: Unconfirmed{}
    case RecoverySeatAddressed{}: Delivered{}
    case ParkTransitionNoFrame{}: Unconfirmed{}
    case UnknownCorrelation{}: Unconfirmed{}
    case MissingCorrelation{}: Unconfirmed{}
    case ReceiptPresent{}: Delivered{}
    case DeliveredNoReceipt{}: Delivered{}
    case UnresolvedParent{}: Rejected{}
    case SettledTurn{}: NotApplicable{}

# Both values appear, so the law below is not vacuous.
def expected_confirmed(f: Fixture) -> Bool:
  match f:
    case ParkWakeAbsent{}: False{}
    case ParkWakeObserved{}: False{}
    case RecoverySeatAddressed{}: True{}
    case ParkTransitionNoFrame{}: False{}
    case UnknownCorrelation{}: False{}
    case MissingCorrelation{}: False{}
    case ReceiptPresent{}: True{}
    case DeliveredNoReceipt{}: True{}
    case UnresolvedParent{}: False{}
    case SettledTurn{}: False{}

def verdict_of(f: Fixture) -> Verdict:
  decide(turn_of(f))

def delivery_confirmed(f: Fixture) -> Bool:
  confirmed(turn_of(f))

def source_label(s: Source) -> String:
  match s:
    case Model{}: "model"
    case Adapter{}: "adapter"

def route_label(is_seat: Bool, is_task: Bool) -> String:
  match is_seat:
    case True{}: "seat-addressed"
    case False{}:
      match is_task:
        case True{}: "task-addressed"
        case False{}: "no-frame"

def observation_label(t: Turn) -> String:
  match t:
    case Turn{_, _, _, _, _, _, WakeDelivered{}, _}: "wake-delivered"
    case Turn{_, _, _, _, _, _, WakeAbsent{}, _}: "wake-absent"
    case Turn{_, _, _, _, _, _, WakeUnobserved{}, _}: "wake-unobserved"

def receipt_label(t: Turn) -> String:
  match t:
    case Turn{_, _, _, _, _, ReceiptOnFile{}, _, _}: "present"
    case Turn{_, _, _, _, _, ReceiptMissing{}, _, _}: "absent"
    case Turn{_, _, _, _, _, ReceiptNotChecked{}, _, _}: "not-checked"

def verdict_label(v: Verdict) -> String:
  match v:
    case Delivered{}: "delivered"
    case Rejected{}: "rejected"
    case Unconfirmed{}: "unconfirmed"
    case NotApplicable{}: "not-applicable"

def is_unconfirmed(v: Verdict) -> Bool:
  match v:
    case Delivered{}: False{}
    case Rejected{}: False{}
    case Unconfirmed{}: True{}
    case NotApplicable{}: False{}

# Every fixture's verdict is the one the corpus records.
law every_fixture_matches_its_expectation:
  for +f: Fixture
  {verdict_of(f) == expected_of(f) : Verdict}

def every_fixture_matches_its_expectation(f):
  match f:
    case ParkWakeAbsent{}: {==}
    case ParkWakeObserved{}: {==}
    case RecoverySeatAddressed{}: {==}
    case ParkTransitionNoFrame{}: {==}
    case UnknownCorrelation{}: {==}
    case MissingCorrelation{}: {==}
    case ReceiptPresent{}: {==}
    case DeliveredNoReceipt{}: {==}
    case UnresolvedParent{}: {==}
    case SettledTurn{}: {==}

# A correlation that is unknown or missing is never a rejection and never a delivery.
def unknown_correlation_is_unconfirmed(t: Turn, v: Verdict) -> Bool:
  match t:
    case Turn{_, _, _, Unknown{}, _, _, _, _}: is_unconfirmed(v)
    case Turn{_, _, _, Missing{}, _, _, _, _}: is_unconfirmed(v)
    case Turn{_, _, _, _, _, _, _, _}: True{}

law unknown_or_missing_correlation_stays_unconfirmed:
  for +f: Fixture
  {unknown_correlation_is_unconfirmed(turn_of(f), verdict_of(f)) == True{} : Bool}

def unknown_or_missing_correlation_stays_unconfirmed(f):
  match f:
    case ParkWakeAbsent{}: {==}
    case ParkWakeObserved{}: {==}
    case RecoverySeatAddressed{}: {==}
    case ParkTransitionNoFrame{}: {==}
    case UnknownCorrelation{}: {==}
    case MissingCorrelation{}: {==}
    case ReceiptPresent{}: {==}
    case DeliveredNoReceipt{}: {==}
    case UnresolvedParent{}: {==}
    case SettledTurn{}: {==}

# Routing metadata never decides: an observed wake that is not addressed to the seat leaves the
# answer unconfirmed, neither delivered nor rejected.
def routing_never_decides(t: Turn, v: Verdict) -> Bool:
  match t:
    case Turn{_, _, _, _, _, _, WakeDelivered{}, TaskAddressed{}}: is_unconfirmed(v)
    case Turn{_, _, _, _, _, _, WakeDelivered{}, NoFrame{}}: is_unconfirmed(v)
    case Turn{_, _, _, _, _, _, _, _}: True{}

law routing_metadata_is_never_decisive:
  for +f: Fixture
  {routing_never_decides(turn_of(f), verdict_of(f)) == True{} : Bool}

def routing_metadata_is_never_decisive(f):
  match f:
    case ParkWakeAbsent{}: {==}
    case ParkWakeObserved{}: {==}
    case RecoverySeatAddressed{}: {==}
    case ParkTransitionNoFrame{}: {==}
    case UnknownCorrelation{}: {==}
    case MissingCorrelation{}: {==}
    case ReceiptPresent{}: {==}
    case DeliveredNoReceipt{}: {==}
    case UnresolvedParent{}: {==}
    case SettledTurn{}: {==}

law delivery_confirmed_only_by_evidence:
  for +f: Fixture
  {delivery_confirmed(f) == expected_confirmed(f) : Bool}

def delivery_confirmed_only_by_evidence(f):
  match f:
    case ParkWakeAbsent{}: {==}
    case ParkWakeObserved{}: {==}
    case RecoverySeatAddressed{}: {==}
    case ParkTransitionNoFrame{}: {==}
    case UnknownCorrelation{}: {==}
    case MissingCorrelation{}: {==}
    case ReceiptPresent{}: {==}
    case DeliveredNoReceipt{}: {==}
    case UnresolvedParent{}: {==}
    case SettledTurn{}: {==}

# The corpus carries an explicit turn end and the turn's report on every fixture.
def carries_turn_end_and_report(t: Turn) -> Bool:
  match t:
    case Turn{Ended{}, Reported{}, _, _, _, _, _, _}: True{}
    case Turn{_, _, _, _, _, _, _, _}: False{}

law every_fixture_carries_a_turn_end_and_report:
  for f: Fixture
  {carries_turn_end_and_report(turn_of(f)) == True{} : Bool}

def every_fixture_carries_a_turn_end_and_report(f):
  match f:
    case ParkWakeAbsent{}: {==}
    case ParkWakeObserved{}: {==}
    case RecoverySeatAddressed{}: {==}
    case ParkTransitionNoFrame{}: {==}
    case UnknownCorrelation{}: {==}
    case MissingCorrelation{}: {==}
    case ReceiptPresent{}: {==}
    case DeliveredNoReceipt{}: {==}
    case UnresolvedParent{}: {==}
    case SettledTurn{}: {==}

# The host half: impl/src/wake-stream.mjs's ROUTING metadata for an adapter fixture's own row.
# 0 = seat-addressed, 1 = task-addressed, 2 = no frame derived.
def Real.adapter_routing(index: Nat) -> IO(U32):
  import "./laws-wake-delivery.js"

def render_model(+f: Fixture) -> IO(Unit):
  do IO<Unit>:
    IO.print(label_of(f) ++ " source=model derived=n/a observation=" ++ observation_label(turn_of(f)) ++ " receipt=" ++ receipt_label(turn_of(f)) ++ " verdict=" ++ verdict_label(verdict_of(f)))

def render_adapter(+f: Fixture) -> IO(Unit):
  do IO<Unit>:
    seat : U32 <- Real.adapter_routing(adapter_index(f))
    task : U32 <- Real.adapter_routing(adapter_index(f))
    IO.print(label_of(f) ++ " source=adapter derived=" ++ route_label(U32.is_eq(seat, 0), U32.is_eq(task, 1)) ++ " observation=" ++ observation_label(turn_of(f)) ++ " receipt=" ++ receipt_label(turn_of(f)) ++ " verdict=" ++ verdict_label(verdict_of(f)))

def render(s: Source, f: Fixture) -> IO(Unit):
  match s:
    case Model{}: render_model(f)
    case Adapter{}: render_adapter(f)

def one(+f: Fixture) -> IO(Unit):
  render(source_of(f), f)

def main() -> IO(Unit):
  do IO<Unit>:
    one(ParkWakeAbsent{})
    one(ParkWakeObserved{})
    one(RecoverySeatAddressed{})
    one(ParkTransitionNoFrame{})
    one(UnknownCorrelation{})
    one(MissingCorrelation{})
    one(ReceiptPresent{})
    one(DeliveredNoReceipt{})
    one(UnresolvedParent{})
    one(SettledTurn{})
    IO.print("wake-delivery witness: 10 fixtures replayed; every adapter derivation must agree with its declared routing, and every verdict must equal the corpus expectation.")
