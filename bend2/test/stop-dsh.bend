# Focused fixture for stop request recording on DSH sessions. It drives the
# real Stop.request over a temporary database: a live retained DSH attempt records a
# requested stop; an exact retry reads that operation; a different stop ID is
# refused with the identity message; FORCE records KILL on the live attempt; a
# terminal DSH session records a stopped outcome; and a session with a harness
# outside the supported list is refused with the supported harness list.
# It does not run Stop.reconcile or a native DSH process.
# Store publishes committed changes through the database owner. This executable
# handles the owner and shutdown modes so the host can start and stop that owner.
#
# usage: stop-dsh DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/stop.bend as Stop
import ../src/host/sqlite.bend as DB
import ../src/host/instance.bend as Custody
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-stop-dsh " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-stop-dsh " ++ label ++ ": failed"))

def query(+db: String, +text: String) -> IO(Unit):
  do IO<Unit>:
    ignore : String <- IO.try(String,DB.Sql.query(db,text))
    IO.pure(Unit,Unit{})

def read(+db: String, +text: String) -> IO(String):
  IO.try(String,DB.Sql.read(db,text))

def expect_read(+db: String, +text: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    value : String <- read(db,text)
    expect(label,String.eq(value,expected))

# Stop.request returns the validation text of the committed operation. An empty
# text means the request was accepted, the same test Stop.run applies.
def request_error(+db: String, +session: String, +id: String, +reason: String, force: Bool) -> IO(String):
  do IO<String>:
    error : String <- IO.try(String,Stop.request(db,session,id,reason,force))
    IO.pure(String,Tx.trim_nl(error))

def session_row(+id: String, harness: String, native: String, workspace: String) -> String:
  "INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES("
  ++ C.q(id) ++ ",NULL," ++ C.q(harness) ++ ",'deepseek/deepseek-flash','high'," ++ C.q(native)
  ++ ",''," ++ C.q(workspace) ++ "," ++ C.q(id ++ "-branch") ++ ",'base-sha');"

def exec_row(session: String, attempt: String, directory: String, phase: String, status: String) -> String:
  "INSERT INTO executions(session,id,mode,directory,phase,status) VALUES("
  ++ C.q(session) ++ "," ++ C.q(attempt) ++ ",'retained'," ++ C.q(directory) ++ "," ++ C.q(phase) ++ "," ++ C.q(status) ++ ");"

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    live : Unit <- query(db,session_row("dsh-live","dsh","dsh-native-live","/workspace/dsh-live"))
    live_attempt : Unit <- query(db,exec_row("dsh-live","attempt-live","/workspace/dsh-live.attempt","running",""))
    done : Unit <- query(db,session_row("dsh-done","dsh","dsh-native-done","/workspace/dsh-done"))
    done_attempt : Unit <- query(db,exec_row("dsh-done","attempt-done","/workspace/dsh-done.attempt","exited","exit 0"))
    other : Unit <- query(db,session_row("shell-other","shell","shell-native","/workspace/shell-other"))
    IO.pure(Unit,Unit{})

def request_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    requested : String <- request_error(db,"dsh-live","stop-live","operator stop",False{})
    accepted : Unit <- expect("dsh-request-accepted",String.is_empty(requested))
    requested_row : Unit <- expect_read(db,"SELECT outcome || ':' || attempt || ':' || directory FROM session_stops WHERE session='dsh-live';","requested:attempt-live:/workspace/dsh-live.attempt\n","dsh-live-requested")
    retry : String <- request_error(db,"dsh-live","stop-live","operator stop",False{})
    retried : Unit <- expect("dsh-exact-retry-accepted",String.is_empty(retry))
    other_id : String <- request_error(db,"dsh-live","stop-other","operator stop",False{})
    refused_id : Unit <- expect("dsh-different-id-refused",String.eq(other_id,"Stop identity differs from the recorded operation; read the session and retry its exact stop ID and reason."))
    forced : String <- request_error(db,"dsh-live","stop-live","",True{})
    force_accepted : Unit <- expect("dsh-force-accepted",String.is_empty(forced))
    signal : Unit <- expect_read(db,"SELECT signal FROM session_stops WHERE session='dsh-live';","9\n","dsh-force-records-kill")
    done : String <- request_error(db,"dsh-done","stop-done","operator stop",False{})
    terminal_accepted : Unit <- expect("dsh-terminal-accepted",String.is_empty(done))
    done_row : Unit <- expect_read(db,"SELECT outcome FROM session_stops WHERE session='dsh-done';","stopped\n","dsh-terminal-stopped")
    refused : String <- request_error(db,"shell-other","stop-shell","operator stop",False{})
    unsupported : Unit <- expect("unsupported-harness-names-supported-retained-harnesses",String.eq(refused,"Stop supports retained OMP, Codex, Muse, Claude Code, DSH and Antigravity sessions; a legacy direct turn without a keeper directory was left unchanged."))
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case "--instance-witness" <> db <> Nil{}: do IO<Unit>:
      witness : Result<&1,&1,U32 & String,String> <- Custody.Instance.owner_witness(db)
      match witness:
        case Fail{error}: IO.die(Unit,2,"owner witness failed")
        case Done{value}: IO.print(value)
    case +path <> Nil{}: do IO<Unit>:
      initialized : Unit <- setup(path)
      exercised : Unit <- request_cases(path)
      IO.print("fixture-stop-dsh-ok")
    case other: IO.die(Unit,2,"usage: stop-dsh DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
