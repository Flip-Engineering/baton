# Focused entry for production worker admission and retained DSH launch.
import Base
import ../src/coordinator/agent-command.bend as Agent
import ../src/coordinator/agent-input.bend as AgentInput
import ../src/coordinator/agent-route.bend as Route
import ../src/coordinator/agent-native.bend as Native
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/turn.bend as Turn
import ../src/host/instance.bend as Custody
import ../src/host/session-lock.bend as Lock
import ../src/host/process.bend as P
import ../src/host/sqlite.bend as DB

def setup(+db: String, directory: String, cwd: String, native: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    saved : String <- IO.try(String,DB.Sql.query(db,
      "INSERT INTO sessions(id,parent,harness) VALUES('operator',NULL,'operator');"
      ++ "INSERT INTO session_roles(session,role) VALUES('operator','operator');"
      ++ "INSERT INTO sessions(id,parent,harness,model,effort,native,workspace,branch) VALUES('worker','operator','dsh','deepseek-flash','max'," ++ C.q(native) ++ "," ++ C.q(cwd) ++ ",'worker-branch');"
      ++ "INSERT INTO session_roles(session,role) VALUES('worker','player');"
      ++ "INSERT INTO executions(session,id,mode,directory,phase) VALUES('worker','worker-turn','receive'," ++ C.q(directory) ++ ",'running');"))
    IO.print("setup-complete")

@unsafe
def observe(+db: String, +handle: U32, +lock: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case Some{text}: do IO<Unit>:
      IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_text_line(handle))
      observe(db,handle,lock,next)
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      settled : Unit <- AgentInput.settle_if(db,"worker","worker-turn",String.eq(status,"exit 0"))
      IO.print("native-" ++ status)
      released_lock : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
      acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
      IO.try(Unit,Custody.Instance.retire(handle))

def started(start: P.RetainedStart, +db: String, +lock: U32) -> IO(Unit):
  match start:
    case P.Unstarted{error}: do IO<Unit>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.die(Unit,2,error)
    case P.Retained{+handle}: do IO<Unit>:
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_text_line(handle))
      observe(db,handle,lock,line)

def launch_locked(+db: String, +directory: String, cwd: String, command: String, native: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Fixture native session is busy.")
    case Some{+owned}: do IO<Unit>:
      launch : Turn.RetainedLaunch <- IO.try(Turn.RetainedLaunch,
        Turn.retained_prepare(db,"worker",directory,command,"deepseek-flash","max",native,"dsh\n",db ++ ".sessions","Fixture worker task.","default",True{},""))
      start : P.RetainedStart <- IO.try(P.RetainedStart,
        Turn.retained_admit(db,directory,cwd,"Fixture worker task.",owned,P.argv(["/bin/true"]),launch))
      started(start,db,owned)

def run(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case db <> "agent-worker-context" <> Nil{}: Agent.worker_context(db)
    case +db <> "agent-contextual-input" <> session <> Nil{}: do IO<Unit>:
      values : List<String> <- Native.input(db)
      Agent.route(Route.Explicit{db,session,values})
    case +db <> "agent-native-input" <> Nil{}: do IO<Unit>:
      values : List<String> <- Native.input(db)
      saved : String <- IO.try(String,Store.apply(db,C.parse(values)))
      IO.write(saved)
    case "setup" <> db <> directory <> cwd <> native <> Nil{}: setup(db,directory,cwd,native)
    case "launch" <> +db <> directory <> cwd <> command <> native <> Nil{}:
      Lock.SessionLock.acquire_session(Unit,db,"worker",canonical => lock => launch_locked(canonical,directory,cwd,command,native,lock))
    case other: IO.die(Unit,2,"Expected worker fixture setup, launch or contextual operation.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
