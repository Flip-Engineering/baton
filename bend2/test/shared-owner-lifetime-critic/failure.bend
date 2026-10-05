import Base
import ../../src/coordinator/stop.bend as Stop

def failure(mode: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match mode:
    case "die": IO.die(Result<&1,&1,U32 & String,Unit>,23,"task-die")
    case "try": do IO<Result<&1,&1,U32 & String,Unit>>:
      value : Unit <- IO.try(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(24,"task-try")}))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{value})
    case "stopped": do IO<Result<&1,&1,U32 & String,Unit>>:
      value : Unit <- Stop.require_open(True{})
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{value})
    case other: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(25,"task-result")})

def show(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: "done"
    case Fail{(code,text)}: U32.show(code) ++ ":" ++ text

def run(mode: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- IO.print("owner-ready")
    child : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,failure(mode))
    result : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,child)
    reported : Unit <- IO.print(show(result))
    IO.print("owner-survived")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Con{mode,Nil{}}: run(mode)
    case other: IO.die(Unit,2,"Expected failure mode.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)
