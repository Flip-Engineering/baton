import Base
import ./proposal/lifetime-protocol.bend as Lifetime

def binding(generation: String) -> Lifetime.Binding:
  Lifetime.Bound{"owner","db","session","attempt-A","directory-A",generation}

def reason(value: Lifetime.Refusal) -> String:
  match value:
    case Lifetime.Stale{}: "stale"
    case Lifetime.Closed{}: "closed"
    case Lifetime.DuplicateOperation{}: "duplicate-operation"
    case Lifetime.UnknownOperation{}: "unknown-operation"
    case Lifetime.AcknowledgmentOwed{}: "acknowledgment-owed"
    case Lifetime.ReferencesPending{}: "references-pending"

def phase(value: Lifetime.Access) -> String:
  match value:
    case Lifetime.Open{}: "open"
    case Lifetime.Closing{}: "closing"
    case Lifetime.Retired{}: "retired"

def operation_text(operations: List<&2,String>) -> String:
  match operations:
    case Nil{}: ""
    case Con{head,tail}: head ++ ";" ++ operation_text(tail)

def capability_text(value: Lifetime.Capability) -> String:
  match value:
    case Lifetime.Cap{binding,access,operations,acknowledged}: phase(access) ++ ":" ++ operation_text(operations)

def change(value: Lifetime.Change) -> String:
  match value:
    case Lifetime.Changed{capability}: "changed:" ++ capability_text(capability)
    case Lifetime.Refused{why,capability}: "refused:" ++ reason(why) ++ ":" ++ capability_text(capability)

def boolean(value: Bool) -> String:
  match value:
    case True{}: "true"
    case False{}: "false"

def main() -> IO(Unit):
  do IO<Unit>:
    acquired : Unit <- IO.print("acquire=" ++ change(Lifetime.acquire(Lifetime.Cap{binding("old"),Lifetime.Open{},[],False{}},binding("old"),"read")))
    stale : Unit <- IO.print("stale=" ++ change(Lifetime.acquire(Lifetime.Cap{binding("new"),Lifetime.Open{},[],False{}},binding("old"),"read")))
    retiring : Unit <- IO.print("retire=" ++ change(Lifetime.begin_retire(Lifetime.Cap{binding("old"),Lifetime.Open{},["read"],True{}})))
    refused : Unit <- IO.print("closed=" ++ change(Lifetime.acquire(Lifetime.Cap{binding("old"),Lifetime.Closing{},["read"],True{}},binding("old"),"write")))
    blocked : Unit <- IO.print("busy=" ++ change(Lifetime.reclaim(Lifetime.Cap{binding("old"),Lifetime.Closing{},["read"],True{}})))
    drained : Unit <- IO.print("complete=" ++ change(Lifetime.complete(Lifetime.Cap{binding("old"),Lifetime.Closing{},["read"],True{}},binding("old"),"read")))
    reclaimed : Unit <- IO.print("reclaim=" ++ change(Lifetime.reclaim(Lifetime.Cap{binding("old"),Lifetime.Closing{},[],True{}})))
    failure : Unit <- IO.print("failure-settled=" ++ boolean(Lifetime.invocation_settled(Lifetime.Failed{"provider"})))
    accepted : Unit <- IO.print("accepted-owed=" ++ boolean(Lifetime.notice_owed(Lifetime.observe_notice(Lifetime.Notification{"parent","report",Lifetime.Owed{},None{}},Lifetime.EndpointAccepted{"request"}))))
    failed : Unit <- IO.print("failed-owed=" ++ boolean(Lifetime.notice_owed(Lifetime.observe_notice(Lifetime.Notification{"parent","report",Lifetime.Owed{},None{}},Lifetime.EndpointFailed{"transport"}))))
    IO.print("delivered-owed=" ++ boolean(Lifetime.notice_owed(Lifetime.observe_notice(Lifetime.Notification{"parent","report",Lifetime.Owed{},None{}},Lifetime.ParentObserved{"parent","report","witness"}))))
