import Base
import ../../src/instance/event-registry.bend as Registry

# Fixture for the instance event-destination registry decisions. Compile-
# verified laws in the imported module fail this build when false; the run
# prints one line per runtime check. This scope covers the pure decisions
# only: the retained destination table, event queue and synchronization are
# hosted-owner-loop and Controls duties.

def check(name: String, ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print(name ++ "-ok\n")
    case False{}: IO.die(Unit,1,name ++ "-failed\n")

def retained_destination(result: Registry.Resolution) -> Registry.DestinationLease:
  match result:
    case Registry.Retained{lease}: lease
    case other: Registry.DestinationLease{Registry.Destination{"","","","",0,0},False{}}

def checks() -> IO(Unit):
  do IO<Unit>:
    resolved : Registry.Resolution <- IO.pure(Registry.Resolution,Registry.resolve_destination(Registry.DestinationLease{Registry.Destination{"db","owner-1","req-1","sess-1",0,0},True{}},"db","owner-1","req-1","sess-1",2))
    +retained : Registry.DestinationLease <- IO.pure(Registry.DestinationLease,retained_destination(resolved))
    added : Unit <- check("matching-resolution-adds-reference",U32.is_eq(Registry.dest_references_of(Registry.dest_of(retained)),1))
    capped : Registry.Resolution <- IO.pure(Registry.Resolution,Registry.resolve_destination(retained,"db","owner-1","req-1","sess-1",1))
    refusedcap : Unit <- match capped:
      case Registry.AtCapacity{+lease}: check("at-capacity-resolution-unchanged",U32.is_eq(Registry.dest_references_of(Registry.dest_of(lease)),1))
      case other: check("at-capacity-resolution-unchanged",False{})
    created : Registry.Resolution <- IO.pure(Registry.Resolution,Registry.resolve_destination(retained,"other-db","owner-1","req-1","sess-1",2))
    newone : Unit <- match created:
      case Registry.Created{+old,+fresh}: check("new-correlation-preserves-retained-and-creates-fresh",Bool.and(U32.is_eq(Registry.dest_references_of(Registry.dest_of(old)),1),U32.is_eq(Registry.dest_references_of(Registry.dest_of(fresh)),1)))
      case other: check("new-correlation-preserves-retained-and-creates-fresh",False{})
    +reg : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1",Registry.Generation{"owner-1","cap-1",3},2,False{},False{},False{}})
    armedreg : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(reg,Registry.Generation{"owner-1","cap-1",3}))
    armed : Unit <- check("current-revision-arms",Registry.reg_armed_of(armedreg))
    busy : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(armedreg,Registry.Generation{"owner-1","cap-1",3}))
    rearmrefused : Unit <- check("armed-registration-refuses-rearm",Bool.and(Registry.reg_armed_of(busy),Bool.not(Registry.reg_event_retained_of(busy))))
    foreign : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(armedreg,Registry.Generation{"other-owner","other-cap",3}))
    unchanged : Unit <- check("foreign-capability-refused",Bool.and(Registry.reg_armed_of(foreign),Bool.not(Registry.reg_event_retained_of(foreign))))
    +eligible : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1b",Registry.Generation{"owner-1","cap-1",3},2,False{},False{},False{}})
    stale : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(eligible,Registry.Generation{"owner-1","cap-1",4}))
    unarmed : Unit <- check("changed-revision-retains-event-unarmed",Bool.and(Registry.reg_event_retained_of(stale),Bool.not(Registry.reg_armed_of(stale))))
    +dest : Registry.Destination <- IO.pure(Registry.Destination,Registry.Destination{"db","owner-1","req-1","sess-1",3,0})
    adoption : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(stale,dest,2))
    transferred : Unit <- match adoption:
      case Registry.Adopted{+registration,+destination}: check("accept-transfers-wake-to-task",Bool.and(Bool.and(Bool.not(Registry.reg_event_retained_of(registration)),Bool.not(Registry.reg_armed_of(registration))),U32.is_eq(Registry.dest_tasks_of(destination),1)))
      case other: check("accept-transfers-wake-to-task",False{})
    duplicate : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(stale,dest,2))
    refuseddup : Unit <- match duplicate:
      case Registry.Refused{+registration,+destination}: check("duplicate-adoption-refused",Bool.and(U32.is_eq(Registry.dest_tasks_of(destination),1),Bool.not(Registry.reg_event_retained_of(registration))))
      case other: check("duplicate-adoption-refused",False{})
    requeue : Registry.Requeue <- IO.pure(Registry.Requeue,Registry.requeue_event(stale,dest))
    back : Unit <- match requeue:
      case Registry.Requeued{+registration,+destination}: check("failed-delivery-requeues-event",Bool.and(Registry.reg_event_retained_of(registration),U32.is_eq(Registry.dest_tasks_of(destination),0)))
      case other: check("failed-delivery-requeues-event",False{})
    requeueagain : Registry.Requeue <- IO.pure(Registry.Requeue,Registry.requeue_event(stale,dest))
    unowned : Unit <- match requeueagain:
      case Registry.Unowned{+registration,+destination}: check("stranded-requeue-refused",Bool.and(U32.is_eq(Registry.dest_tasks_of(destination),0),Bool.not(Registry.reg_event_retained_of(registration))))
      case other: check("stranded-requeue-refused",False{})
    +cancelled : Registry.Registration <- IO.pure(Registry.Registration,Registry.cancel_registration(stale))
    stillbusy : Unit <- check("cancelled-with-event-blocks-disposal",Bool.not(Registry.registration_disposable(cancelled)))
    +releasedreg : Registry.Registration <- IO.pure(Registry.Registration,Registry.release_registration_reference(Registry.release_registration_reference(cancelled)))
    disposable : Unit <- check("released-references-allow-disposal",Bool.and(U32.is_eq(Registry.reg_references_of(releasedreg),0),Registry.registration_disposable(releasedreg)))
    unreleased : Unit <- check("held-references-block-disposal",Bool.not(Registry.registration_disposable(cancelled)))
    idle : Unit <- check("idle-destination-disposable",Registry.destination_disposable(Registry.Destination{"db","owner-1","req-1","sess-1",0,0}))
    +releasedlease : Registry.DestinationLease <- IO.pure(Registry.DestinationLease,Registry.release_destination_reference(retained))
    dropped : Unit <- check("release-drops-reference",U32.is_eq(Registry.dest_references_of(Registry.dest_of(releasedlease)),0))
    held : Unit <- check("held-lease-blocks-destination-disposal",Bool.not(Registry.destination_disposable(Registry.dest_of(retained))))

def main() -> IO(Unit):
  do IO<Unit>:
    ran : Unit <- checks()
    IO.print("event-registry-ok\n")
