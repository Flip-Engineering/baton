# Focused fixture for the retained-observer executing call.
#
# `init` installs the app schema and one parentless OMP session.
# `start` admits one retained native attempt under the database instance owner,
# records its recovery argv and exits. The owner and native stay alive; the
# admitting process is the observer, so its exit is observer loss while the
# keeper lives, and the keeper invokes the recorded `--recover-receive` call.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/stop.bend as Stop
import ../src/coordinator/turn.bend as Turn
import ../src/host/session-lock.bend as Lock
import ../src/host/process.bend as P

def session_name() -> String:
  "parent"

def init_db(db: String, harness: String) -> IO(Unit):
  do IO<Unit>:
    saved : Result<&1,&1,U32 & String,String> <- Store.transact_sql(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ "INSERT OR IGNORE INTO sessions(id,parent,harness,model) VALUES(" ++ C.q(session_name()) ++ ",NULL," ++ C.q(harness) ++ ",'');COMMIT;")
    IO.pure(Unit,Unit{})

def start_attempt(+db: String, +id: String, +directory: String, +workspace: String, +log: String, +observed: String, +helper: String, +harness: String, +model: String, +effort: String, +python: String, +native: String, +marker: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    allowed : Bool <- Stop.admit(canonical,session_name(),id,"retained",directory)
    admitted : Unit <- Stop.admitted(allowed)
    lock : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(canonical,session_name()))
    started : Unit <- Stop.started(canonical,session_name(),id,directory)
    +arguments : String = P.argv([python,native,observed,marker])
    +recovery : String = P.argv([helper,"--recover-receive",canonical,session_name(),id,"0",python,model,effort,workspace,log,harness,directory,observed])
    launch : Turn.RetainedLaunch = Turn.Prepared{arguments,"","fixture task",0,False{}}
    started_result : Result<&1,&1,U32 & String,P.RetainedStart> <- IO.try(P.RetainedStart,Turn.retained_admit(canonical,directory,workspace,"fixture task",lock,recovery,launch))
    IO.print("started " ++ id)
    IO.pure(Unit,Unit{})

def run(args: List<String>) -> IO(Unit):
  match args:
    case "init" <> +db <> +harness <> Nil{}: init_db(db,harness)
    case "start" <> +db <> +id <> +directory <> +workspace <> +log <> +observed <> +helper <> +harness <> +model <> +effort <> +python <> +native <> +native_uuid <> +marker <> Nil{}:
      start_attempt(db,id,directory,workspace,log,observed,helper,harness,model,effort,python,native,marker)
    case other: IO.die(Unit,2,"usage: observer-executing-fixture init DB HARNESS | start DB ID DIRECTORY WORKSPACE LOG NATIVE HELPER HARNESS MODEL EFFORT PYTHON SCRIPT NATIVE_UUID MARKER")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
