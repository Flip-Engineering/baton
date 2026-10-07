import Base
import ../../src/coordinator/stop.bend as Stop

# Independent minimal probe for the process-global halt semantics that
# docs/bend2/shared-owner-task-custody-design.md relies on: "IO.try and IO.die
# halt the whole process on failure, and a forked fiber does not catch that
# halt", with die=23, failed IO.try=24, the stopped-admission helper=2 and a
# returned Fail=0 with the caller surviving.
#
# Each mode forks exactly one task and joins it. `probe-ready` is printed
# before the fork and `probe-survived` after the join, so the stdout stream
# shows which of the two boundaries the process actually reached.
#
# The extra code pairs (die-41, try-19) are the critic's own controls: they
# show the exit status is the code argument and the failure payload, not a
# constant that happens to match the cited numbers.
#
# Every mode's result is a value of the same type, so the halt is the only
# difference between them.

def halted(exit: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.die(Result<&1,&1,U32 & String,Unit>,exit,text)

def tried(exit: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    value : Unit <- IO.try(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(exit,text)}))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{value})

def stopped() -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    value : Unit <- Stop.require_open(True{})
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{value})

def task(mode: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match mode:
    case "die-23": halted(23,"probe-die")
    case "die-41": halted(41,"probe-die")
    case "try-24": tried(24,"probe-try")
    case "try-19": tried(19,"probe-try")
    case "stopped": stopped()
    case "result-25": IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(25,"probe-result")})
    case "done": IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case other: IO.die(Result<&1,&1,U32 & String,Unit>,2,"Unknown probe mode.")

def show(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: "done"
    case Fail{(code,text)}: U32.show(code) ++ ":" ++ text

def run(mode: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- IO.print("probe-ready\n")
    child : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,task(mode))
    result : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,child)
    shown : Unit <- IO.print(show(result) ++ "\n")
    IO.print("probe-survived\n")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Con{mode,Nil{}}: run(mode)
    case other: IO.die(Unit,2,"Expected one mode argument.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)
