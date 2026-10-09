import Base
import ../../src/instance/event-registry.bend as Registry
import ../../src/instance/retained-table.bend as Table
import ../../src/instance/owner-service.bend as Service

# Fixture for the instance event-destination registry decisions. Compile-
# verified laws in the imported module fail this build when false; the run
# prints one line per runtime check. This scope covers the pure decisions
# and the keyed state values: the hosted table, event queue and
# synchronization are owner-entry and Controls duties. Every transition
# result is matched against its actual constructor and threaded onward; an
# unexpected constructor stops the run with a typed failure.

def check(name: String, ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print(name ++ "-ok\n")
    case False{}: IO.die(Unit,1,name ++ "-failed\n")

# Stored occurrence compared against an explicit expected occurrence. None
# fails; only the matching Some value passes, so a vanished occurrence
# cannot satisfy an expected-value check.
def occurrence_is(+outstanding: Maybe<U32>, +expected: U32) -> Bool:
  match outstanding:
    case None{}: False{}
    case Some{value}: U32.is_eq(value,expected)

# Exact returned phase: only ReturnedToRegistration passes, distinguishing
# the queued retry token from an adopted or completed token.
def returned_phase(token: Registry.TaskEvent) -> Bool:
  match Registry.token_phase_of(token):
    case Registry.ReturnedToRegistration{}: True{}
    case other: False{}

def checks() -> IO(Unit):
  do IO<Unit>:
    resolved : Registry.Resolution <- IO.pure(Registry.Resolution,Registry.resolve_destination(Registry.DestinationLease{Registry.Destination{"db","owner-1","req-1","sess-1",0,0},True{}},"db","owner-1","req-1","sess-1",2))
    +retained : Registry.DestinationLease <- match resolved:
      case Registry.Retained{+lease}: IO.pure(Registry.DestinationLease,lease)
      case other: IO.die(Registry.DestinationLease,1,"resolution-unexpected\n")
    added : Unit <- check("matching-resolution-adds-reference",U32.is_eq(Registry.dest_references_of(Registry.dest_of(retained)),1))
    capped : Registry.Resolution <- IO.pure(Registry.Resolution,Registry.resolve_destination(retained,"db","owner-1","req-1","sess-1",1))
    refusedcap : Unit <- match capped:
      case Registry.AtCapacity{+old}: check("at-capacity-resolution-unchanged",U32.is_eq(Registry.dest_references_of(Registry.dest_of(old)),1))
      case other: check("at-capacity-resolution-unchanged",False{})
    created : Registry.Resolution <- IO.pure(Registry.Resolution,Registry.resolve_destination(retained,"other-db","owner-1","req-1","sess-1",2))
    newone : Unit <- match created:
      case Registry.Created{+old,+fresh}: check("new-correlation-preserves-retained-and-creates-fresh",Bool.and(U32.is_eq(Registry.dest_references_of(Registry.dest_of(old)),1),U32.is_eq(Registry.dest_references_of(Registry.dest_of(fresh)),1)))
      case other: check("new-correlation-preserves-retained-and-creates-fresh",False{})
    +reg : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1",Registry.Generation{"owner-1","cap-1",3},"db","owner-1","req-1","sess-1",0,2,False{},False{},False{},None{},False{}})
    +armedreg : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(reg,Registry.Generation{"owner-1","cap-1",3}))
    armed : Unit <- check("current-revision-arms",Registry.reg_armed_of(armedreg))
    +busy : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(armedreg,Registry.Generation{"owner-1","cap-1",3}))
    rearmrefused : Unit <- check("armed-registration-refuses-rearm",Bool.and(Registry.reg_armed_of(busy),Bool.not(Registry.reg_event_retained_of(busy))))
    +foreign : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(armedreg,Registry.Generation{"other-owner","other-cap",3}))
    unchanged : Unit <- check("foreign-capability-refused",Bool.and(Registry.reg_armed_of(foreign),Bool.not(Registry.reg_event_retained_of(foreign))))
    +eligible : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1b",Registry.Generation{"owner-1","cap-1",3},"db","owner-1","req-1","sess-1",0,2,False{},False{},False{},None{},False{}})
    +stale : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(eligible,Registry.Generation{"owner-1","cap-1",4}))
    unarmed : Unit <- check("changed-revision-retains-event-unarmed",Bool.and(Registry.reg_event_retained_of(stale),Bool.not(Registry.reg_armed_of(stale))))
    foreigndest : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(stale,Registry.Destination{"other-db","owner-1","req-1","sess-1",1,0},4,1000))
    wrongbind : Unit <- match foreigndest:
      case Registry.Refused{+registration,+destination}: check("foreign-destination-adoption-refused",Bool.and(Registry.reg_event_retained_of(registration),U32.is_eq(Registry.dest_tasks_of(destination),0)))
      case other: check("foreign-destination-adoption-refused",False{})
    +dest : Registry.Destination <- IO.pure(Registry.Destination,Registry.Destination{"db","owner-1","req-1","sess-1",3,0})
    +adoption : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(stale,dest,4,1000))
    +adoptedreg : Registry.Registration <- match adoption:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.Registration,registration)
      case other: IO.die(Registry.Registration,1,"adoption-unexpected\n")
    +adopteddest : Registry.Destination <- match adoption:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.Destination,destination)
      case other: IO.die(Registry.Destination,1,"adoption-unexpected\n")
    +outstanding : Registry.TaskEvent <- match adoption:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.TaskEvent,outstanding)
      case other: IO.die(Registry.TaskEvent,1,"adoption-unexpected\n")
    transferred : Unit <- check("accept-transfers-wake-to-task",Bool.and(Bool.and(Bool.not(Registry.reg_event_retained_of(adoptedreg)),U32.is_eq(Registry.dest_tasks_of(adopteddest),1)),U32.is_eq(Registry.reg_adoptions_of(adoptedreg),1)))
    duplicate : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(adoptedreg,adopteddest,4,1000))
    refuseddup : Unit <- match duplicate:
      case Registry.Refused{+registration,+destination}: check("duplicate-adoption-refused-records-preserved",Bool.and(Bool.and(U32.is_eq(Registry.dest_tasks_of(destination),1),Bool.not(Registry.reg_event_retained_of(registration))),U32.is_eq(Registry.reg_adoptions_of(registration),1)))
      case other: check("duplicate-adoption-refused-records-preserved",False{})
    +refusedreg : Registry.Registration <- match duplicate:
      case Registry.Refused{+registration,+destination}: IO.pure(Registry.Registration,registration)
      case other: IO.die(Registry.Registration,1,"duplicate-refusal-unexpected\n")
    +refuseddest : Registry.Destination <- match duplicate:
      case Registry.Refused{+registration,+destination}: IO.pure(Registry.Destination,destination)
      case other: IO.die(Registry.Destination,1,"duplicate-refusal-unexpected\n")
    +requeue : Registry.Requeue <- IO.pure(Registry.Requeue,Registry.requeue_event(refusedreg,refuseddest,outstanding))
    +requeuedreg : Registry.Registration <- match requeue:
      case Registry.Requeued{+registration,+destination,+returned}: IO.pure(Registry.Registration,registration)
      case other: IO.die(Registry.Registration,1,"requeue-unexpected\n")
    +requeueddest : Registry.Destination <- match requeue:
      case Registry.Requeued{+registration,+destination,+returned}: IO.pure(Registry.Destination,destination)
      case other: IO.die(Registry.Destination,1,"requeue-unexpected\n")
    +returned : Registry.TaskEvent <- match requeue:
      case Registry.Requeued{+registration,+destination,+returned}: IO.pure(Registry.TaskEvent,returned)
      case other: IO.die(Registry.TaskEvent,1,"requeue-unexpected\n")
    back : Unit <- check("failed-delivery-requeues-event",Bool.and(Registry.reg_event_retained_of(requeuedreg),U32.is_eq(Registry.dest_tasks_of(requeueddest),0)))
    requeueagain : Registry.Requeue <- IO.pure(Registry.Requeue,Registry.requeue_event(requeuedreg,requeueddest,returned))
    consumed : Unit <- match requeueagain:
      case Registry.Unowned{+registration,+destination,+outstanding}: check("returned-token-cannot-debit-again",Bool.and(U32.is_eq(Registry.dest_tasks_of(destination),0),Registry.reg_event_retained_of(registration)))
      case other: check("returned-token-cannot-debit-again",False{})
    +readopt : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(requeuedreg,requeueddest,4,1000))
    +secondreg : Registry.Registration <- match readopt:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.Registration,registration)
      case other: IO.die(Registry.Registration,1,"readoption-unexpected\n")
    +seconddest : Registry.Destination <- match readopt:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.Destination,destination)
      case other: IO.die(Registry.Destination,1,"readoption-unexpected\n")
    +secondoutstanding : Registry.TaskEvent <- match readopt:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.TaskEvent,outstanding)
      case other: IO.die(Registry.TaskEvent,1,"readoption-unexpected\n")
    conserved : Unit <- check("requeued-event-readopts-with-new-occurrence",Bool.and(U32.is_eq(Registry.dest_tasks_of(seconddest),1),U32.is_eq(Registry.reg_adoptions_of(secondreg),2)))
    staletoken : Registry.Completion <- IO.pure(Registry.Completion,Registry.complete_event(secondreg,seconddest,outstanding))
    staletokendone : Unit <- match staletoken:
      case Registry.Unowned{+registration,+destination,+outstanding}: check("saved-original-token-refused-with-new-task-live",Bool.and(U32.is_eq(Registry.dest_tasks_of(destination),1),Bool.and(Bool.not(Registry.outstanding_is_none(registration)),occurrence_is(Registry.reg_outstanding_of(registration),1))))
      case other: check("saved-original-token-refused-with-new-task-live",False{})
    +notified : Registry.Registration <- IO.pure(Registry.Registration,Registry.record_pending(secondreg))
    pendingset : Unit <- check("notification-during-task-records-pending",Registry.reg_pending_of(notified))
    occkept : Unit <- check("notification-preserves-occurrence",occurrence_is(Registry.reg_outstanding_of(notified),1))
    +refusedpending : Registry.Completion <- IO.pure(Registry.Completion,Registry.complete_event(notified,seconddest,secondoutstanding))
    +refusalreg : Registry.Registration <- match refusedpending:
      case Registry.Unowned{+registration,+destination,+outstanding}: IO.pure(Registry.Registration,registration)
      case other: IO.die(Registry.Registration,1,"pending-completion-unexpected\n")
    +refusaldest : Registry.Destination <- match refusedpending:
      case Registry.Unowned{+registration,+destination,+outstanding}: IO.pure(Registry.Destination,destination)
      case other: IO.die(Registry.Destination,1,"pending-completion-unexpected\n")
    +refusaltoken : Registry.TaskEvent <- match refusedpending:
      case Registry.Unowned{+registration,+destination,+outstanding}: IO.pure(Registry.TaskEvent,outstanding)
      case other: IO.die(Registry.TaskEvent,1,"pending-completion-unexpected\n")
    pendingkept : Unit <- check("pending-completion-refusal-keeps-pending-count-occurrence",Bool.and(Bool.and(Registry.reg_pending_of(refusalreg),U32.is_eq(Registry.dest_tasks_of(refusaldest),1)),occurrence_is(Registry.reg_outstanding_of(refusalreg),1)))
    refusaltokenok : Unit <- check("pending-completion-refusal-retains-adopted-token",Bool.and(Bool.and(String.eq(Registry.token_identity_of(refusaltoken),"reg-1b"),U32.is_eq(Registry.token_occurrence_of(refusaltoken),1)),Bool.and(Registry.token_is_adopted(refusaltoken),Bool.and(String.eq(Registry.token_database_of(refusaltoken),"db"),String.eq(Registry.token_session_of(refusaltoken),"sess-1")))))
    +pendingrequeue : Registry.Requeue <- IO.pure(Registry.Requeue,Registry.requeue_event(refusalreg,refusaldest,refusaltoken))
    pendingrequeued : Unit <- match pendingrequeue:
      case Registry.Requeued{+registration,+destination,+returned}: check("pending-requeue-clears-occurrence-returns-token-keeps-duty",Bool.and(Bool.and(Registry.reg_pending_of(registration),Registry.reg_event_retained_of(registration)),Bool.and(U32.is_eq(Registry.dest_tasks_of(destination),0),Bool.and(Registry.outstanding_is_none(registration),returned_phase(returned))))
      case other: check("pending-requeue-clears-occurrence-returns-token-keeps-duty",False{})
    undisposable : Unit <- check("pending-registration-not-disposable",Bool.not(Registry.registration_disposable(notified)))
    +basereg : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1g",Registry.Generation{"owner-1","cap-1",3},"db","owner-1","req-1","sess-1",0,2,False{},False{},False{},None{},False{}})
    +basestale : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(basereg,Registry.Generation{"owner-1","cap-1",4}))
    +baseadopt : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(basestale,dest,4,1000))
    +basereg2 : Registry.Registration <- match baseadopt:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.Registration,registration)
      case other: IO.die(Registry.Registration,1,"baseline-adoption-unexpected\n")
    +basedest : Registry.Destination <- match baseadopt:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.Destination,destination)
      case other: IO.die(Registry.Destination,1,"baseline-adoption-unexpected\n")
    +basetoken : Registry.TaskEvent <- match baseadopt:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.TaskEvent,outstanding)
      case other: IO.die(Registry.TaskEvent,1,"baseline-adoption-unexpected\n")
    completion : Registry.Completion <- IO.pure(Registry.Completion,Registry.complete_event(basereg2,basedest,basetoken))
    finished : Unit <- match completion:
      case Registry.Completed{+registration,+destination,+returned}: check("no-pending-completion-releases-task-count",U32.is_eq(Registry.dest_tasks_of(destination),0))
      case other: check("no-pending-completion-releases-task-count",False{})
    +exreg : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1d",Registry.Generation{"owner-1","cap-1",3},"db","owner-1","req-1","sess-1",5,2,True{},True{},False{},None{},False{}})
    +exhausted : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(exreg,dest,4,5))
    exdone : Unit <- match exhausted:
      case Registry.Exhausted{+registration,+destination}: check("exhausted-bound-refuses-before-capacity",Bool.and(U32.is_eq(Registry.reg_adoptions_of(registration),5),U32.is_eq(Registry.dest_tasks_of(destination),0)))
      case other: check("exhausted-bound-refuses-before-capacity",False{})
    +obsreg : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1f",Registry.Generation{"owner-1","cap-1",3},"db","owner-1","req-1","sess-1",0,2,False{},False{},False{},None{},False{}})
    +obsstale : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(obsreg,Registry.Generation{"owner-1","cap-1",4}))
    +obsadopt : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(obsstale,dest,4,1000))
    +obsreg2 : Registry.Registration <- match obsadopt:
      case Registry.Adopted{+registration,+destination,+outstanding}: IO.pure(Registry.Registration,registration)
      case other: IO.die(Registry.Registration,1,"observation-adoption-unexpected\n")
    +obsarmed : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(obsreg2,Registry.Generation{"owner-1","cap-1",3}))
    +obsnotify : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(obsarmed,Registry.Generation{"owner-1","cap-1",5}))
    armednotify : Unit <- check("armed-then-changed-revision-records-notification",Bool.and(Bool.and(Registry.reg_armed_of(obsnotify),Registry.reg_pending_of(obsnotify)),Bool.and(occurrence_is(Registry.reg_outstanding_of(obsnotify),0),Bool.not(Registry.reg_event_retained_of(obsnotify)))))
    +pendingonly : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1e",Registry.Generation{"owner-1","cap-1",3},"db","owner-1","req-1","sess-1",0,0,False{},False{},True{},None{},True{}})
    pendingdisposal : Unit <- check("pending-blocks-disposal-alone",Bool.not(Registry.registration_disposable(pendingonly)))
    +pendingclear : Registry.Registration <- IO.pure(Registry.Registration,Registry.Registration{"reg-1e",Registry.Generation{"owner-1","cap-1",3},"db","owner-1","req-1","sess-1",0,0,False{},False{},True{},None{},False{}})
    cleardisposal : Unit <- check("cancelled-clean-disposable",Registry.registration_disposable(pendingclear))
    +cancelledevent : Registry.Registration <- IO.pure(Registry.Registration,Registry.register_ready(Registry.Registration{"reg-2",Registry.Generation{"owner-1","cap-1",3},"db","owner-1","req-1","sess-1",0,1,False{},False{},False{},None{},False{}},Registry.Generation{"owner-1","cap-1",4}))
    +cancelleddst : Registry.Destination <- IO.pure(Registry.Destination,Registry.Destination{"db","owner-1","req-1","sess-1",1,0})
    cancelledaccept : Registry.Acceptance <- IO.pure(Registry.Acceptance,Registry.accept_ready(Registry.cancel_registration(cancelledevent),cancelleddst,2,1000))
    cancelledref : Unit <- match cancelledaccept:
      case Registry.Refused{+registration,+destination}: check("cancelled-registration-refuses-adoption",Bool.and(Registry.reg_event_retained_of(registration),U32.is_eq(Registry.dest_tasks_of(destination),0)))
      case other: check("cancelled-registration-refuses-adoption",False{})
    +cancelaccept : Registry.Registration <- IO.pure(Registry.Registration,Registry.cancel_registration(cancelledevent))
    settle : Registry.Settlement <- IO.pure(Registry.Settlement,Registry.settle_cancelled_event(cancelaccept,True{}))
    settledok : Unit <- match settle:
      case Registry.Settled{+registration}: check("accepted-receipt-gate-clears-retained-event",Bool.not(Registry.reg_event_retained_of(registration)))
      case other: check("accepted-receipt-gate-clears-retained-event",False{})
    refusedsettle : Registry.Settlement <- IO.pure(Registry.Settlement,Registry.settle_cancelled_event(cancelledevent,True{}))
    kept : Unit <- match refusedsettle:
      case Registry.Refused{+registration}: check("uncancelled-settlement-refused",Registry.reg_event_retained_of(registration))
      case other: check("uncancelled-settlement-refused",False{})
    +unaccepted : Registry.Settlement <- IO.pure(Registry.Settlement,Registry.settle_cancelled_event(cancelaccept,False{}))
    kept2 : Unit <- match unaccepted:
      case Registry.Refused{+registration}: check("unaccepted-transfer-refused-preserves-event-and-outstanding",Bool.and(Registry.reg_event_retained_of(registration),Registry.outstanding_is_none(registration)))
      case other: check("unaccepted-transfer-refused-preserves-event-and-outstanding",False{})
    +releasedreg : Registry.RegistrationRelease <- IO.pure(Registry.RegistrationRelease,Registry.release_registration_reference(cancelledevent))
    +releasedout : Registry.Registration <- match releasedreg:
      case Registry.Released{+registration}: IO.pure(Registry.Registration,registration)
      case other: IO.die(Registry.Registration,1,"registration-release-unexpected\n")
    droppedref : Unit <- check("registration-reference-releases",U32.is_eq(Registry.reg_references_of(releasedout),0))
    releasedagain : Registry.RegistrationRelease <- IO.pure(Registry.RegistrationRelease,Registry.release_registration_reference(releasedout))
    already : Unit <- match releasedagain:
      case Registry.AlreadyReleased{+registration}: check("double-registration-release-refused",U32.is_eq(Registry.reg_references_of(registration),0))
      case other: check("double-registration-release-refused",False{})
    +releasedlease : Registry.LeaseRelease <- IO.pure(Registry.LeaseRelease,Registry.release_destination_reference(retained))
    droppedlease : Unit <- match releasedlease:
      case Registry.LeaseReleased{+lease}: check("lease-reference-releases",U32.is_eq(Registry.dest_references_of(Registry.dest_of(lease)),0))
      case other: check("lease-reference-releases",False{})
    idle : Unit <- check("idle-destination-disposable",Registry.destination_disposable(Registry.Destination{"db","owner-1","req-1","sess-1",0,0}))

def main() -> IO(Unit):
  do IO<Unit>:
    ran : Unit <- checks()
    IO.print("event-registry-ok\n")
