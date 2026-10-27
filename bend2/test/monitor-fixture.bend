import Base
import ../src/coordinator/store.bend as Store
import ../src/coordinator/commands.bend as C
import ../src/host/sqlite.bend as DB
import ../src/host/process.bend as P
import ../src/host/instance.bend as Custody
import ../src/host/session-lock.bend as Lock

# Seeds the isolated coordinator database with one registered session and one
# unread task message. The message sequence is the attempt's input
# cursor, so a later observation that reads no further input retains it.
def init_cli(+db: String, +harness: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    seeded : String <- IO.try(String,DB.Sql.query(db,
      "INSERT INTO sessions(id,parent,harness,model,effort,native) VALUES('parent',NULL," ++ C.q(harness) ++ ",'controlled-model','low','native-uuid');"
      ++ "INSERT INTO messages(id,sender,recipient,kind,body) VALUES('task','parent','parent','task','Monitor the retained attempt.');"))
    IO.pure(Unit,Unit{})

def started(start: P.RetainedStart) -> IO(Unit):
  match start:
    case P.Retained{+handle}: IO.print("started " ++ U32.show(handle))
    case P.Unstarted{+error}: IO.die(Unit,1,"native did not start: " ++ error)

# Starts one retained native under the database owner, records its execution
# row, prints the handle and exits. The owner and native keep running after the
# observer process ends, which leaves the attempt with no retained status.
def start_locked(lock: Maybe<U32>, +db: String, +directory: String, +cwd: String,
                 +recovery: String, program: List<String>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,1,"fixture session busy")
    case Some{+handle}: do IO<Unit>:
      start : P.RetainedStart <- IO.try(P.RetainedStart,Custody.Instance.admit(
        db,directory,P.argv(program),cwd,directory ++ "/native.stderr","",0,Some{handle},recovery))
      started(start)

def start_cli(+db: String, +attempt: String, +directory: String, +cwd: String, +log: String,
              +native: String, +recovery_executable: String, +harness: String, +model: String, +effort: String,
              program: List<String>) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    recorded : String <- IO.try(String,DB.Sql.query(db,
      "INSERT OR REPLACE INTO executions(session,id,mode,directory,phase) VALUES('parent',"
      ++ C.q(attempt) ++ ",'retained'," ++ C.q(directory) ++ ",'running');"))
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    recovery : String <- IO.pure(String,P.argv([recovery_executable,"--recover-receive",db,"parent",attempt,"1",
      "controlled","controlled-model","low",cwd,log,harness,directory,native]))
    Lock.SessionLock.acquire_session(Unit,db,"parent",
      canonical => lock => start_locked(lock,db,directory,cwd,recovery,program))

def shutdown_result(result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.print("shutdown-ok")
    case Fail{(code,text)}: IO.die(Unit,1,U32.show(code) ++ ": " ++ text)

def shutdown_cli(+db: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.shutdown(db)
    shutdown_result(result)

def keeper_locked(directory: String, lock: Maybe<&2,U32>) -> IO(Unit):
  match lock:
    case Some{+handle}: IO.try(Unit,P.ProcessChild.keeper(directory,handle))
    case None{}: IO.die(Unit,2,"invalid keeper lock")

def keeper_cli(directory: String, lock: String) -> IO(Unit):
  keeper_locked(directory,U32.read(lock))

def mode_number(+mode: String) -> U32:
  Bool.pick(U32,String.eq(mode,"init"),1,
  Bool.pick(U32,String.eq(mode,"start"),2,
  Bool.pick(U32,String.eq(mode,"shutdown"),3,
  Bool.pick(U32,String.eq(mode,"--host-process-keeper"),4,
  Bool.pick(U32,String.eq(mode,"--instance-owner"),5,0)))))

def dispatch_number(number: U32, rest: List<String>) -> IO(Unit):
  match number:
    case 1: match rest:
      case db <> harness <> Nil{}: init_cli(db,harness)
      case other: IO.die(Unit,2,"monitor-fixture init DB HARNESS")
    case 2: match rest:
      case db <> attempt <> directory <> cwd <> log <> native <> recovery_executable <> harness <> model <> effort <> program:
        start_cli(db,attempt,directory,cwd,log,native,recovery_executable,harness,model,effort,program)
      case other: IO.die(Unit,2,"monitor-fixture start DB ATTEMPT DIR CWD LOG NATIVE RECOVERY HARNESS MODEL EFFORT PROGRAM...")
    case 3: match rest:
      case db <> Nil{}: shutdown_cli(db)
      case other: IO.die(Unit,2,"monitor-fixture shutdown DB")
    case 4: match rest:
      case directory <> lock <> Nil{}: keeper_cli(directory,lock)
      case other: IO.die(Unit,2,"--host-process-keeper ATTEMPT LOCK")
    case 5: match rest:
      case db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
      case other: IO.die(Unit,2,"--instance-owner DATABASE")
    case other: IO.die(Unit,2,"monitor-fixture init DB HARNESS | start ... | shutdown DB")

def dispatch_mode(mode: String, rest: List<String>) -> IO(Unit):
  dispatch_number(mode_number(mode),rest)

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> rest: dispatch_mode(mode,rest)
    case other: IO.die(Unit,2,"monitor-fixture init DB HARNESS | start ... | shutdown DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
