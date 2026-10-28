# The Claude Code Stop hook entry and the Claude launch arguments (#1054,
# instance B1). '--stop-hook' runs the hook; 'arguments' prints the Claude argv
# one argument per line.
import Base
import ../src/coordinator/stop-hook.bend as StopHook
import ../src/coordinator/message-status.bend as MessageStatus
import ../src/harness/claude-player.bend as Claude
import ../src/coordinator/commands.bend as C
import ../src/coordinator/agent-actions.bend as Actions
import ../src/coordinator/agent-command.bend as Agent
import ../src/coordinator/agent-input.bend as AgentInput
import ../src/coordinator/store.bend as Store
import ../src/coordinator/stop.bend as Stop
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

@unsafe
def lifecycle_observed(+db: String, +directory: String, +handle: U32, +last: String, line: Maybe<String>) -> IO(Unit):
  match line:
    case Some{+value}: do IO<Unit>:
      stored : String <- IO.try(String,Store.apply_through_busy(db,C.Observe{"attempt-1","worker",value,False{},"claude-code"}))
      printed : Unit <- IO.print(value)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      lifecycle_observed(db,directory,handle,value,next)
    case None{}: do IO<Unit>:
      +status : String <- IO.try(String,P.ProcessChild.wait(handle))
      recorded : Unit <- Stop.exited(db,"worker","attempt-1",status,last,"",directory ++ "/native.jsonl")
      released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
      acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
      retired : Unit <- IO.try(Unit,Custody.Instance.retire(handle))
      IO.print(status)

def lifecycle_admitted(+db: String, +directory: String, start: P.RetainedStart) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,1,error)
    case P.Retained{+handle}: do IO<Unit>:
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      lifecycle_observed(db,directory,handle,"",line)

def decision_statement() -> IO(Unit):
  IO.print(StopHook.decision_sql("worker"))

def record_statement(args: List<String>) -> IO(Unit):
  match args:
    case directory <> attempt <> native <> identity <> saved <> Nil{}:
      IO.print(MessageStatus.record_sql("worker",directory,attempt,native,identity,saved,False{}))
    case other: IO.die(Unit,2,"usage: stop-hook-entry record-sql DIRECTORY ATTEMPT NATIVE IDENTITY SAVED_JSON")

def lines(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> tail: do IO<Unit>:
      printed : Unit <- IO.print(head)
      lines(tail)

def route(args: List<String>) -> IO(Unit):
  match args:
    case "--stop-hook" <> Nil{}: StopHook.run()
    case "decision-sql" <> Nil{}: decision_statement()
    case "record-sql" <> rest: record_statement(rest)
    case "arguments" <> Nil{}: lines(Claude.arguments("claude","claude-opus-5-5","high"))
    case "schema" <> Nil{}: IO.write(C.schema())
    case "read" <> db <> id <> Nil{}: Agent.execute(db,"worker",Actions.Read{[id]})
    case "completion-request" <> db <> body <> Nil{}: Agent.execute(db,"worker",Actions.CompletionRequest{"",Actions.Text{body}})
    case "completion-request-id" <> db <> id <> body <> Nil{}: Agent.execute(db,"worker",Actions.CompletionRequest{id,Actions.Text{body}})
    case "inbox" <> db <> session <> Nil{}: Agent.execute(db,session,Actions.Inbox{})
    case "pending" <> db <> Nil{}: do IO<Unit>:
      saved : String <- IO.try(String,Store.read(db,C.Pending{}))
      AgentInput.command_output(db,C.Pending{},saved)
    case "lifecycle" <> +database <> +directory <> cwd <> program: do IO<Unit>:
      start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit(database,directory,P.argv(program),cwd,directory ++ "/native.stderr","",0,None{},P.argv(["/usr/bin/false"])))
      lifecycle_admitted(database,directory,start)
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
