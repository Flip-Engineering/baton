import Base
import ../../src/context/custody-tasks.bend as Custody
import ../../src/coordinator/stop.bend as Stop

# Fixture for the pure custody-task decisions. Modes: "laws" exercises the
# decision functions and prints one line per check; "die", "try", "stopped"
# and "result" reproduce the process-global halt semantics around a forked
# task. Compile-verified laws in the imported module fail this build when
# false.

def sample_owner() -> Custody.OwnerInstance:
  Custody.Owner{"dev:main","token-1"}

def sample_attempt() -> Custody.Attempt:
  Custody.Attempt{"attempt-a","/tmp/db.attempt-attempt-a","session-1","7",2}

def check(name: String, ok: Bool) -> IO(Unit):
  match ok:
    case True{}: IO.print(name ++ "-ok\n")
    case False{}: IO.die(Unit,1,name ++ "-failed\n")

def duty_done(result: Result<&1,&1,Custody.Refusal,Custody.Duty>) -> Bool:
  match result:
    case Done{duty}: True{}
    case other: False{}

def refused_stale_owner_is(result: Result<&1,&1,Custody.Refusal,Custody.Duty>, expected: String) -> Bool:
  match result:
    case Fail{Custody.StaleOwner{current}}: String.eq(current,expected)
    case other: False{}

def refused_stale_slot_is(result: Result<&1,&1,Custody.Refusal,Custody.Slot>, expected: U32) -> Bool:
  match result:
    case Fail{Custody.StaleSlot{current}}: U32.is_eq(current,expected)
    case other: False{}

def rebuild_empty(result: Maybe<Custody.Duty>) -> Bool:
  match result:
    case None{}: True{}
    case other: False{}

def rebuild_open_with_wake(result: Maybe<Custody.Duty>) -> Bool:
  match result:
    case Some{duty}: Bool.and(Custody.duty_open(duty),Custody.wake_owed_of(duty))
    case None{}: False{}

def checks() -> IO(Unit):
  do IO<Unit>:
    +owner : Custody.OwnerInstance <- IO.pure(Custody.OwnerInstance,sample_owner())
    +attempt : Custody.Attempt <- IO.pure(Custody.Attempt,sample_attempt())
    +sealed : Custody.Duty <- IO.pure(Custody.Duty,Custody.seal_completion(Custody.open_duty(owner,attempt),Custody.RefDone{"exit 0"}))
    failed : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_delivery(sealed,Custody.RefFail{"delivery failed"}))
    open1 : Unit <- check("failed-delivery-settles-and-leaves-duty-open",Custody.duty_open(failed))
    +delivered : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_delivery(sealed,Custody.RefDone{"report-1 delivered"}))
    wake : Unit <- check("delivered-outcome-clears-the-wake",Bool.not(Custody.wake_owed_of(delivered)))
    closed : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_continuation(Custody.record_ack(Custody.record_settle(delivered,Custody.RefFail{"settle failed"}),True{},Custody.RefDone{"acknowledged"}),Custody.RefDone{"continued"}))
    retained : Unit <- check("closed-duty-retains-its-errors",Bool.and(Bool.not(Custody.duty_open(closed)),Bool.not(String.eq(Custody.errors_of(closed),""))))
    unacked : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_continuation(Custody.record_ack(Custody.record_settle(delivered,Custody.RefDone{"none-pending"}),False{},Custody.RefDone{"returned-without-marker"}),Custody.RefDone{"continued"}))
    owed : Unit <- check("ack-without-marker-keeps-duty-open",Custody.duty_open(unacked))
    historical : Unit <- check("attempt-check-after-slot-replacement",duty_done(Custody.check_attempt(Custody.open_duty(owner,attempt),owner,attempt)))
    foreign : Unit <- check("foreign-owner-token-refused",refused_stale_owner_is(Custody.check_attempt(Custody.open_duty(owner,attempt),Custody.Owner{"dev:main","token-2"},attempt),"token-1"))
    superseded : Unit <- check("superseded-slot-generation-refused",refused_stale_slot_is(Custody.check_slot(Custody.Slot{"session-1",2},"session-1",3),2))
    advanced : Unit <- check("advanced-slot-refuses-old-generation",refused_stale_slot_is(Custody.check_slot(Custody.advance_slot(Custody.Slot{"session-1",1},"session-1",2),"session-1",1),2))
    empty : Unit <- check("rebuild-acknowledged-is-empty",rebuild_empty(Custody.rebuild(attempt,owner,True{},Custody.RefDone{"enumerated"},Custody.RefDone{"none-pending"},Custody.RefDone{"none-pending"})))
    window : Unit <- check("released-not-acknowledged-rebuilds-open",rebuild_open_with_wake(Custody.rebuild(attempt,owner,False{},Custody.RefDone{"enumerated"},Custody.RefOpen{},Custody.RefDone{"none-pending"})))
    acknotice : Unit <- check("acknowledged-owed-notice-stays-open",rebuild_open_with_wake(Custody.rebuild(attempt,owner,True{},Custody.RefDone{"enumerated"},Custody.RefFail{"delivery failed"},Custody.RefDone{"none-pending"})))
    clear : Unit <- check("acknowledged-fulfilled-rebuilds-empty",rebuild_empty(Custody.rebuild(attempt,owner,True{},Custody.RefDone{"enumerated"},Custody.RefDone{"report delivered"},Custody.RefDone{"settled"})))
    wrongattempt : Unit <- check("differing-attempt-refused",Bool.not(duty_done(Custody.check_attempt(Custody.open_duty(owner,attempt),owner,Custody.Attempt{"attempt-b","/tmp/db.attempt-attempt-b","session-1","7",2}))))
    +ackd : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_ack(Custody.record_delivery(Custody.seal_completion(Custody.open_duty(owner,attempt),Custody.RefDone{"exit 0"}),Custody.RefDone{"delivered"}),True{},Custody.RefDone{"acknowledged"}))
    +settlefail : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_settle(ackd,Custody.RefFail{"settle failed"}))
    survives : Unit <- check("failed-settlement-survives-ack",Bool.and(Custody.duty_open(settlefail),Custody.settle_owed_of(settlefail)))
    settled2 : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_settle(settlefail,Custody.RefDone{"settled"}))
    closes : Unit <- check("fulfilled-settlement-closes-duty",Bool.not(Custody.duty_open(settled2)))
    +noticed : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_delivery(Custody.seal_completion(Custody.open_duty(owner,attempt),Custody.RefDone{"exit 0"}),Custody.RefFail{"notice failed"}))
    wakekept : Unit <- check("failed-notice-keeps-wake-owed",Custody.duty_open(noticed))
    retried : Custody.Duty <- IO.pure(Custody.Duty,Custody.record_delivery(noticed,Custody.RefDone{"retry delivered"}))
    retires : Unit <- check("notice-retry-clears-wake",Bool.not(Custody.wake_owed_of(retried)))

def failure(mode: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match mode:
    case "die": IO.die(Result<&1,&1,U32 & String,Unit>,23,"task-die")
    case "try": do IO<Result<&1,&1,U32 & String,Unit>>:
      value : Unit <- IO.try(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(24,"task-try")}))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{value})
    case "stopped": do IO<Result<&1,&1,U32 & String,Unit>>:
      value : Unit <- Stop.require_open(True{})
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{value})
    case "laws": do IO<Result<&1,&1,U32 & String,Unit>>:
      ran : Unit <- checks()
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case other: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(25,"task-result")})

def show(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: "done"
    case Fail{(code,text)}: U32.show(code) ++ ":" ++ text

def run(mode: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- IO.print("owner-ready\n")
    child : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,failure(mode))
    result : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,child)
    shown : Unit <- IO.print(show(result) ++ "\n")
    IO.print("owner-survived\n")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Con{mode,Nil{}}: run(mode)
    case other: IO.die(Unit,2,"Expected a mode.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)
