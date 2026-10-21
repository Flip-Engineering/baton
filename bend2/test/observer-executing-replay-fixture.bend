# Focused fixture for a completed retained attempt and its observer transfer.
#
# `init` installs the app schema and one parentless OMP session.
# `start-obsolete` admits one retained native attempt under the database
# instance owner with a caller-supplied recovery executable. The native and
# the captured recovery argv are recorded; the admitting process prints
# `started` and waits for the optional gate file. Its exit is observer loss
# while the keeper lives.
# `probe` performs one attach and ready exchange, then exits. Repeating it
# drives the keeper's disconnect and ready cycles without observing the
# attempt.
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/stop.bend as Stop
import ../src/coordinator/turn.bend as Turn
import ../src/host/files.bend as F
import ../src/host/instance.bend as Custody
import ../src/host/sqlite.bend as DB
import ../src/host/session-lock.bend as Lock
import ../src/host/process.bend as P

def session_name() -> String:
  "parent"

def init_db(+db: String, harness: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ "INSERT OR IGNORE INTO sessions(id,parent,harness,model) VALUES(" ++ C.q(session_name()) ++ ",NULL," ++ C.q(harness) ++ ",'');" ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) VALUES(" ++ C.q("task") ++ "," ++ C.q(session_name()) ++ "," ++ C.q(session_name()) ++ ",'task'," ++ C.q("fixture owed input.") ++ ");COMMIT;")
    IO.pure(Unit,Unit{})

def wait_gate_for(+path: String, remaining: Nat) -> IO(Unit):
  match remaining:
    case 0n: IO.die(Unit,2,"fixture gate was not released: " ++ path)
    case 1n+p: do IO<Unit>:
      regular : String <- IO.try(String,F.Files.regular(path))
      Bool.pick(IO(Unit),String.eq(regular,"1"),
        IO.pure(Unit,Unit{}),
        do IO<Unit>:
          IO.sleep(20)
          wait_gate_for(path,p))

def wait_gate(path: String) -> IO(Unit):
  wait_gate_for(path,3000n)

def start_obsolete(+db: String, +id: String, +directory: String, +workspace: String,
                   +log: String, +observed: String, +recovery_executable: String,
                   +harness: String, +model: String, +effort: String, +python: String,
                   +native: String, +marker: String, +cursor: String, +gate: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    allowed : Bool <- Stop.admit(canonical,session_name(),id,"retained",directory)
    admitted : Unit <- Stop.admitted(allowed)
    lock : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(canonical,session_name()))
    started : Unit <- Stop.started(canonical,session_name(),id,directory)
    +arguments : String = P.argv([python,native,observed,marker])
    +recovery : String = P.argv([recovery_executable,"--recover-receive",canonical,session_name(),id,cursor,native,model,effort,workspace,log,harness,directory,observed])
    launch : Turn.RetainedLaunch = Turn.Prepared{arguments,"","fixture task",0,False{}}
    started_result : P.RetainedStart <- IO.try(P.RetainedStart,Turn.retained_admit(canonical,directory,workspace,"fixture task",lock,recovery,launch))
    IO.print("started " ++ id)
    gated : Unit <- Bool.pick(IO(Unit),String.is_empty(gate),IO.pure(Unit,Unit{}),wait_gate(gate))
    IO.pure(Unit,Unit{})

# One attach and ready exchange followed by process exit.
def probe(+db: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    handle : U32 <- IO.try(U32,Custody.Instance.attach(db,directory))
    IO.pure(Unit,Unit{})

# The completed native's durable status is reflected in the execution row so
# the supported stop request records the empty attempt and stopped outcome.
def stop_failed(error: U32 & String) -> IO(Unit):
  match error:
    case (code,text): IO.die(Unit,2,"fixture stop failed: " ++ U32.show(code) ++ ": " ++ text)

def stop_session(+db: String, +session: String, +id: String, +reason: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String,DB.Sql.query(db,"UPDATE executions SET phase='exited',status='exit 0' WHERE session=" ++ C.q(session) ++ ";"))
    result : Result<&1,&1,U32 & String,String> <- Stop.request(db,session,id,reason,False{})
    match result:
      case Fail{error}: stop_failed(error)
      case Done{+saved}: Stop.validate(saved)

def run(args: List<String>) -> IO(Unit):
  match args:
    case "init" <> +db <> +harness <> Nil{}: init_db(db,harness)
    case "start-obsolete" <> +db <> +id <> +directory <> +workspace <> +log <> +observed <> +recovery_executable <> +harness <> +model <> +effort <> +python <> +native <> +marker <> +cursor <> +gate <> Nil{}:
      start_obsolete(db,id,directory,workspace,log,observed,recovery_executable,harness,model,effort,python,native,marker,cursor,gate)
    case "probe" <> +db <> +directory <> Nil{}:
      probe(db,directory)
    case "stop" <> +db <> +session <> +id <> +reason <> Nil{}:
      stop_session(db,session,id,reason)
    case other: IO.die(Unit,2,"usage: observer-executing-fixture init DB HARNESS | start-obsolete DB ID DIRECTORY WORKSPACE LOG OBSERVED RECOVERY HARNESS MODEL EFFORT PYTHON SCRIPT MARKER CURSOR GATE | probe DB DIRECTORY | stop DB SESSION ID REASON")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
