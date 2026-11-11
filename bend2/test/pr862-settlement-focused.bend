# Focused behavioral fixture for PR862 completion settlement. It calls the
# production AgentInput.consume_delivered transaction and the production
# Receive.consume_completed failure gate against a real SQLite database built by
# Store.ensure_before_begin. Input and read rows are fixture state; the
# settlement SQL is not copied.
import Base
import ../src/coordinator/store.bend as Store
import ../src/coordinator/agent-input.bend as AgentInput
import ../src/coordinator/receive.bend as Receive
import ../src/coordinator/turn.bend as Turn
import ../src/coordinator/observer-checkpoint.bend as Observer
import ../src/coordinator/commands.bend as C
import ../src/host/sqlite.bend as DB
import ../src/host/session-lock.bend as SessionLock
import ../src/git/text.bend as Tx

def check(name: String, actual: String, expected: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(actual,expected),IO.pure(Unit,Unit{}),
    IO.die(Unit,1,name ++ ": value mismatch"))

def one(+db: String, sql: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.query(db,sql))
    IO.pure(String,Tx.trim_nl(value))

def expect_consumed(+db: String, +attempt: String, +message: String) -> IO(Unit):
  do IO<Unit>:
    combined : String <- one(db,"SELECT CASE WHEN m.receipt='native-turn:' || r.attempt AND r.handled=m.receipt THEN 'true' ELSE 'false' END FROM messages m JOIN message_reads r ON r.message=m.id WHERE m.id=" ++ C.q(message) ++ " AND r.attempt=" ++ C.q(attempt) ++ ";")
    check("receipt and read handling",combined,"true")

def expect_unread(+db: String, +message: String) -> IO(Unit):
  do IO<Unit>:
    state : String <- one(db,"SELECT coalesce(receipt,'<null>') || ':' || (SELECT count(*) FROM message_reads r WHERE r.message=m.id) FROM messages m WHERE m.id=" ++ C.q(message) ++ ";")
    check("unread message remains pending",state,"<null>:0")

def expect_owed(+db: String, +attempt: String, +message: String) -> IO(Unit):
  do IO<Unit>:
    state : String <- one(db,"SELECT CASE WHEN m.receipt IS NULL AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.attempt=" ++ C.q(attempt) ++ " AND r.handled IS NOT NULL) THEN 'true' ELSE 'false' END FROM messages m WHERE m.id=" ++ C.q(message) ++ ";")
    check("message remains owed",state,"true")

# One session and attempt with four ordered messages: initial task, a task
# after the admitted prompt, a delivered guidance, and a guidance after the
# delivered cursor. The message_reads rows use read_native so a changed
# session identity can be tested without changing the read rows.
def seed(+db: String, +session: String, +attempt: String, +session_native: String,
         +read_native: String, +phase: String, +base: U32, +stopped: Bool) -> IO(Unit):
  do IO<Unit>:
    rows : String <- IO.try(String,DB.Sql.query(db,
      "CREATE TEMP TABLE IF NOT EXISTS pr862_fixture(session TEXT,attempt TEXT,session_native TEXT,read_native TEXT,phase TEXT,base INTEGER,stopped INTEGER);"
      ++ "DELETE FROM pr862_fixture;INSERT INTO pr862_fixture VALUES(" ++ C.q(session) ++ "," ++ C.q(attempt) ++ "," ++ C.q(session_native) ++ "," ++ C.q(read_native) ++ "," ++ C.q(phase) ++ "," ++ U32.show(base) ++ "," ++ Bool.pick(String,stopped,"1","0") ++ ");"
      ++ "INSERT INTO sessions(id,parent,harness,model,effort,native) SELECT session,NULL,'omp','controlled','low',session_native FROM pr862_fixture;"
      ++ "INSERT INTO executions(session,id,mode,directory,phase) SELECT session,attempt,'retained','/fixture/attempt',phase FROM pr862_fixture;"
      ++ "INSERT INTO messages(seq,id,sender,recipient,kind,body) SELECT base+1,session||'-initial',session,session,'task','initial' FROM pr862_fixture;"
      ++ "INSERT INTO messages(seq,id,sender,recipient,kind,body) SELECT base+2,session||'-later-task',session,session,'task','later task' FROM pr862_fixture;"
      ++ "INSERT INTO messages(seq,id,sender,recipient,kind,body) SELECT base+3,session||'-guidance',session,session,'guidance','delivered guidance' FROM pr862_fixture;"
      ++ "INSERT INTO messages(seq,id,sender,recipient,kind,body) SELECT base+4,session||'-later-guidance',session,session,'guidance','later guidance' FROM pr862_fixture;"
      ++ "INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT attempt,session||'-initial',session,read_native,session||'-identity' FROM pr862_fixture;"
      ++ "INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT attempt,session||'-later-task',session,read_native,session||'-identity' FROM pr862_fixture;"
      ++ "INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT attempt,session||'-guidance',session,read_native,session||'-identity' FROM pr862_fixture;"
      ++ "INSERT INTO message_reads(attempt,message,recipient,native,identity) SELECT attempt,session||'-later-guidance',session,read_native,session||'-identity' FROM pr862_fixture;"
      ++ "INSERT INTO session_stops(session,id,reason,outcome) SELECT session,session||'-stop','fixture','stopped' FROM pr862_fixture WHERE stopped=1;"))
    IO.pure(Unit,Unit{})

def initial_cursor(base: U32) -> String:
  U32.show(U32.add(base,1))

def delivered_cursor(base: U32) -> String:
  U32.show(U32.add(base,3))

def success_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db,"s-success","a-success","n-success","n-success","exited",1,False{})
    success : Bool <- Turn.settlement_success(db,Turn.Ended{"exit 0","{}","",False{}})
    classified : Unit <- check("success classification",Bool.pick(String,success,"true","false"),"true")
    delivered : String = Observer.cursor(Observer.make(delivered_cursor(1),"","","","","","",""))
    consumed : Unit <- AgentInput.consume_delivered(db,"s-success","a-success","n-success",initial_cursor(1),delivered)
    initial : Unit <- expect_consumed(db,"a-success","s-success-initial")
    guidance : Unit <- expect_consumed(db,"a-success","s-success-guidance")
    later_task : Unit <- expect_owed(db,"a-success","s-success-later-task")
    later_guidance : Unit <- expect_owed(db,"a-success","s-success-later-guidance")
    IO.pure(Unit,Unit{})

def changed_native_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db,"s-native","a-native","n-current","n-old","exited",10,False{})
    consumed : Unit <- AgentInput.consume_delivered(db,"s-native","a-native","n-old",initial_cursor(10),delivered_cursor(10))
    initial : Unit <- expect_owed(db,"a-native","s-native-initial")
    guidance : Unit <- expect_owed(db,"a-native","s-native-guidance")
    later_task : Unit <- expect_owed(db,"a-native","s-native-later-task")
    later_guidance : Unit <- expect_owed(db,"a-native","s-native-later-guidance")
    IO.pure(Unit,Unit{})

def unread_summary_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db,"s-unread","a-unread","n-unread","n-unread","exited",15,False{})
    removed_read : String <- IO.try(String,DB.Sql.query(db,"DELETE FROM message_reads WHERE attempt='a-unread' AND message='s-unread-initial';"))
    consumed : Unit <- AgentInput.consume_delivered(db,"s-unread","a-unread","n-unread",initial_cursor(15),delivered_cursor(15))
    initial : Unit <- expect_owed(db,"a-unread","s-unread-initial")
    guidance : Unit <- expect_consumed(db,"a-unread","s-unread-guidance")
    IO.pure(Unit,Unit{})

def wrong_native_read_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db,"s-wrong-native","a-wrong-native","n-wrong-native","n-wrong-native","exited",17,False{})
    changed_read : String <- IO.try(String,DB.Sql.query(db,"UPDATE message_reads SET native='n-stale-native' WHERE attempt='a-wrong-native';"))
    consumed : Unit <- AgentInput.consume_delivered(db,"s-wrong-native","a-wrong-native","n-wrong-native",initial_cursor(17),delivered_cursor(17))
    initial : Unit <- expect_owed(db,"a-wrong-native","s-wrong-native-initial")
    guidance : Unit <- expect_owed(db,"a-wrong-native","s-wrong-native-guidance")
    IO.pure(Unit,Unit{})

def stopped_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db,"s-stop","a-stop","n-stop","n-stop","exited",20,True{})
    consumed : Unit <- AgentInput.consume_delivered(db,"s-stop","a-stop","n-stop",initial_cursor(20),delivered_cursor(20))
    initial : Unit <- expect_owed(db,"a-stop","s-stop-initial")
    guidance : Unit <- expect_owed(db,"a-stop","s-stop-guidance")
    later_task : Unit <- expect_owed(db,"a-stop","s-stop-later-task")
    later_guidance : Unit <- expect_owed(db,"a-stop","s-stop-later-guidance")
    IO.pure(Unit,Unit{})

def running_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db,"s-running","a-running","n-running","n-running","running",30,False{})
    consumed : Unit <- AgentInput.consume_delivered(db,"s-running","a-running","n-running",initial_cursor(30),delivered_cursor(30))
    initial : Unit <- expect_owed(db,"a-running","s-running-initial")
    guidance : Unit <- expect_owed(db,"a-running","s-running-guidance")
    IO.pure(Unit,Unit{})

def failed_gate_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    seeded : Unit <- seed(db,"s-failed","a-failed","n-failed","n-failed","exited",40,False{})
    failed : Bool <- Turn.settlement_success(db,Turn.Ended{"exit 0","","",False{}})
    classified : Unit <- check("failure classification",Bool.pick(String,failed,"true","false"),"false")
    not_consumed : Unit <- Receive.consume_completed(db,"s-failed","a-failed","n-failed",initial_cursor(40),False{},0)
    initial : Unit <- expect_owed(db,"a-failed","s-failed-initial")
    guidance : Unit <- expect_owed(db,"a-failed","s-failed-guidance")
    IO.pure(Unit,Unit{})

def run(+db: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    executable : String <- IO.try(String,SessionLock.executable())
    executable_checked : Unit <- check("test executable path is known",Bool.pick(String,String.is_empty(executable),"empty","present"),"present")
    success : Unit <- success_case(db)
    changed : Unit <- changed_native_case(db)
    unread_summary : Unit <- unread_summary_case(db)
    wrong_native : Unit <- wrong_native_read_case(db)
    stopped : Unit <- stopped_case(db)
    running : Unit <- running_case(db)
    failed : Unit <- failed_gate_case(db)
    IO.print("PR862-SETTLEMENT-PASS")

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case db <> Nil{}: run(db)
    case other: IO.die(Unit,2,"usage: pr862-settlement-focused DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
