import Base
import ../../src/instance/event-registry.bend as Registry

# Fixture for the instance event-destination registry decisions. Compile-
# verified laws in the imported module fail this build when false; the run
# prints one line per runtime check.

def check(name: String, ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print(name ++ "-ok\n")
    case False{}: IO.die(Unit,1,name ++ "-failed\n")

def checks() -> IO(Unit):
  do IO<Unit>:
    fresh : Registry.DestinationLease <- IO.pure(Registry.DestinationLease,Registry.resolve_destination(Registry.DestinationLease{Registry.Destination{"db","owner-1","req-1","sess-1",0,0},True{}},"db","owner-1","req-1","sess-1"))
    same : Unit <- check("matching-resolution-retains-destination",Registry.dest_live_of(fresh))
    added : Unit <- check("matching-resolution-adds-reference",U32.is_eq(Registry.dest_references_of(Registry.dest_of(fresh)),1))
    changed : Registry.DestinationLease <- IO.pure(Registry.DestinationLease,Registry.resolve_destination(fresh,"other-db","owner-1","req-1","sess-1"))
    newone : Unit <- check("new-correlation-creates-one-destination",U32.is_eq(Registry.dest_references_of(Registry.dest_of(changed)),1))
    reg : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(Registry.Registration{"reg-1",Registry.Generation{"owner-1","cap-1",3},2,False{},False{},False{}},Registry.Generation{"owner-1","cap-1",3}))
    armed : Unit <- check("current-revision-arms",Registry.reg_armed_of(reg))
    stale : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(reg,Registry.Generation{"owner-1","cap-1",4}))
    retained : Unit <- check("changed-revision-retains-event",Registry.reg_event_retained_of(stale))
    accepted : Registry.Registration <- IO.pure(Registry.Registration,Registry.accept_ready(stale))
    transferred : Unit <- check("accept-transfers-event",Bool.and(Bool.not(Registry.reg_event_retained_of(accepted)),Bool.not(Registry.reg_armed_of(accepted))))
    cancelled : Registry.Registration <- IO.pure(Registry.Registration,Registry.cancel_registration(accepted))
    refused : Unit <- check("cancelled-registration-disposes-clean",Registry.registration_disposable(cancelled))
    busy : Registry.Registration <- IO.pure(Registry.Registration,Registry.cancel_registration(Registry.Registration{"reg-2",Registry.Generation{"owner-1","cap-1",3},1,False{},True{},False{}}))
    kept : Unit <- check("retained-event-blocks-disposal",Bool.not(Registry.registration_disposable(busy)))
    freetask : Unit <- check("idle-destination-disposable",Registry.destination_disposable(Registry.Destination{"db","owner-1","req-1","sess-1",0,0}))
    busytask : Unit <- check("task-event-blocks-disposal",Bool.not(Registry.destination_disposable(Registry.Destination{"db","owner-1","req-1","sess-1",0,2})))

def main() -> IO(Unit):
  do IO<Unit>:
    ran : Unit <- checks()
    IO.print("event-registry-ok\n")
