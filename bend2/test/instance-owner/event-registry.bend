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
    fresh : Registry.DestinationLease <- IO.pure(Registry.DestinationLease,Registry.resolve_destination(Registry.DestinationLease{Registry.Destination{"db","owner-1","req-1","sess-1",0,0},True{}},"db","owner-1","req-1","sess-1",False{}))
    same : Unit <- check("matching-resolution-retains-destination",Registry.dest_live_of(fresh))
    added : Unit <- check("matching-resolution-adds-reference",U32.is_eq(Registry.dest_references_of(Registry.dest_of(fresh)),1))
    capped : Registry.DestinationLease <- IO.pure(Registry.DestinationLease,Registry.resolve_destination(fresh,"db","owner-1","req-1","sess-1",True{}))
    refused : Unit <- check("at-capacity-resolution-unchanged",U32.is_eq(Registry.dest_references_of(Registry.dest_of(capped)),1))
    changed : Registry.DestinationLease <- IO.pure(Registry.DestinationLease,Registry.resolve_destination(fresh,"other-db","owner-1","req-1","sess-1",False{}))
    newone : Unit <- check("new-correlation-creates-one-destination",U32.is_eq(Registry.dest_references_of(Registry.dest_of(changed)),1))
    +reg : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(Registry.Registration{"reg-1",Registry.Generation{"owner-1","cap-1",3},2,False{},False{},False{}},Registry.Generation{"owner-1","cap-1",3}))
    armed : Unit <- check("current-revision-arms",Registry.reg_armed_of(reg))
    busy : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(reg,Registry.Generation{"owner-1","cap-1",3}))
    rearmrefused : Unit <- check("armed-registration-refuses-rearm",Bool.and(Registry.reg_armed_of(busy),Bool.not(Registry.reg_event_retained_of(busy))))
    stale : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(reg,Registry.Generation{"owner-1","cap-1",4}))
    unarmed : Unit <- check("changed-revision-retains-event-unarmed",Bool.and(Registry.reg_event_retained_of(stale),Bool.not(Registry.reg_armed_of(stale))))
    foreign : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(reg,Registry.Generation{"other-owner","other-cap",3}))
    unchanged : Unit <- check("foreign-capability-refused",Bool.and(Bool.and(Registry.reg_armed_of(foreign),Bool.not(Registry.reg_event_retained_of(foreign))),U32.is_eq(Registry.reg_references_of(foreign),2)))
    +dest : Registry.Destination <- IO.pure(Registry.Destination,Registry.Destination{"db","owner-1","req-1","sess-1",3,0})
    pair : (Registry.Registration & Registry.Destination) <- IO.pure((Registry.Registration & Registry.Destination),Registry.accept_ready(stale,dest))
    (acceptedreg,accepteddest) = pair
    transferred : Unit <- check("accept-transfers-event-to-task",Bool.and(Bool.and(Bool.not(Registry.reg_event_retained_of(acceptedreg)),Bool.not(Registry.reg_armed_of(acceptedreg))),U32.is_eq(Registry.dest_tasks_of(accepteddest),1)))
    requeued : Registry.Registration <- IO.pure(Registry.Registration,Registry.requeue_event(acceptedreg))
    back : Unit <- check("failed-delivery-requeues-event",Registry.reg_event_retained_of(requeued))
    +cancelled : Registry.Registration <- IO.pure(Registry.Registration,Registry.cancel_registration(requeued))
    stillbusy : Unit <- check("cancelled-with-event-blocks-disposal",Bool.not(Registry.registration_disposable(cancelled)))
    rearmed : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(cancelled,Registry.Generation{"owner-1","cap-1",4}))
    refusedrearm : Unit <- check("cancelled-registration-refuses-rearm",Bool.and(Bool.not(Registry.reg_armed_of(rearmed)),Bool.not(Registry.registration_disposable(rearmed))))
    +clean : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-3",Registry.Generation{"owner-1","cap-1",5},0,False{},False{},True{}})
    disposable : Unit <- check("clean-cancelled-registration-disposes",Registry.registration_disposable(clean))
    idle : Unit <- check("idle-destination-disposable",Registry.destination_disposable(Registry.Destination{"db","owner-1","req-1","sess-1",0,0}))
    released : Registry.DestinationLease <- IO.pure(Registry.DestinationLease,Registry.release_destination_reference(fresh))
    dropped : Unit <- check("release-drops-reference",U32.is_eq(Registry.dest_references_of(Registry.dest_of(released)),1))
    freetask : Unit <- check("zero-task-destination-disposable",Registry.destination_disposable(Registry.dest_of(released)))

def main() -> IO(Unit):
  do IO<Unit>:
    ran : Unit <- checks()
    IO.print("event-registry-ok\n")
