# The Claude Code Stop hook entry and the Claude launch arguments (#1054,
# instance B1). '--stop-hook' runs the hook; 'arguments' prints the Claude argv
# one argument per line.
import Base
import ../src/coordinator/stop-hook.bend as StopHook
import ../src/harness/claude-player.bend as Claude
import ../src/coordinator/input-hook.bend as InputHook
import ../src/coordinator/message-status.bend as Status
import ../src/host/instance.bend as Custody
import ../src/host/process.bend as P

# This fixture admits the fake Claude under the production custody host.
@unsafe
def observed(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case Some{value}: do IO<Unit>:
      printed : Unit <- IO.print(value)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      observed(handle,next)
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
      acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
      retired : Unit <- IO.try(Unit,Custody.Instance.retire(handle))
      IO.print(status)

def admitted(start: P.RetainedStart) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{+handle}: do IO<Unit>:
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      observed(handle,line)

def state_statements() -> IO(Unit):
  do IO<Unit>:
    selected : Unit <- IO.print(InputHook.selection_sql("worker","/attempt","{\"live\":true,\"identity\":\"identity-1\"}"))
    recorded : Unit <- IO.print(InputHook.record_sql("worker","/attempt","receive:worker:100:feed","native-1","identity-1","@INPUT@"))
    IO.print(Status.settle_sql("worker","receive:worker:100:feed","identity-1"))

def lines(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> tail: do IO<Unit>:
      printed : Unit <- IO.print(head)
      lines(tail)

def route(args: List<String>) -> IO(Unit):
  match args:
    case "--stop-hook" <> Nil{}: StopHook.run()
    case "arguments" <> Nil{}: lines(Claude.arguments("claude","claude-opus-5-5","high"))
    case "state-statements" <> Nil{}: state_statements()
    case "--instance-owner" <> database <> Nil{}: IO.try(Unit,Custody.Instance.owner(database))
    case "shutdown" <> database <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(database))
    case "admit" <> database <> +directory <> cwd <> program: do IO<Unit>:
      start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit(database,directory,P.argv(program),cwd,directory ++ "/native.stderr","",0,None{},P.argv(["/usr/bin/false"])))
      admitted(start)
    case other: IO.die(Unit,2,"usage: stop-hook-entry --stop-hook|arguments")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    route(args)
