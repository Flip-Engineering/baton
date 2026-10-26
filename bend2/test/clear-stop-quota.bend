# Focused fixture for the clear-only terminal stop and the durable quota hold.
# It drives the real Stop.clear and UsageWindows functions over a temporary
# database: the stop row is removed while the session, native identity,
# workspace, messages, executions, refusal evidence and live reads stay
# unchanged; a seat held by an exhausted live read stays held after the clear and
# after an unreadable read; a later open read makes the seat selectable without
# starting an execution. The stop.py and usage-windows.py suites cover the
# operator-facing command answers.
# Store publishes committed changes through the database owner. This executable
# handles the owner and shutdown modes so the host can start and stop that owner.
#
# usage: clear-stop-quota DB
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/stop.bend as Stop
import ../src/coordinator/usage-windows.bend as UW
import ../src/host/sqlite.bend as DB
import ../src/host/instance.bend as Custody
import ../src/coordinator/agent-domain.bend as D
import ../src/git/text.bend as Tx

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-clear-stop " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-clear-stop " ++ label ++ ": refused"))

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

def gate_class(gate: UW.Gate) -> String:
  match gate:
    case UW.GateNone{}: "none"
    case UW.GateHeld{window,resets_at,source,receipt}: "held"
    case UW.GateUnknown{source,reason,receipt}: "unknown"

# The hold from the recorded reads; window_state performs no read.
def expect_state(+db: String, +session: String, +account: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_state(db,session,account)
    expect(label,String.eq(gate_class(gate),expected))

# One readable live read of the kimi-code 5-hour window for account acct.
def read_row_sql(+percent: String, +exhausted: String) -> String:
  "INSERT INTO usage_reads(observed_at,provider,account,session,trigger,state,source,reason,document) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'kimi-code','acct','leaf','fixture','read','fixture','',json_object('schema','baton2-usage-read-v1','provider','kimi-code','source','fixture','observedAt',1,'state','read','windows',json_array(json_object('window','5-hour','usedPercent'," ++ percent ++ ",'resetsAt',32472144000000,'exhausted',json(" ++ C.q(exhausted) ++ ")))));"

def unreadable_row_sql() -> String:
  "INSERT INTO usage_reads(observed_at,provider,account,session,trigger,state,source,reason,document) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'kimi-code','acct','leaf','fixture','unreadable','fixture','HTTP 503 from the provider',json_object('schema','baton2-usage-read-v1','provider','kimi-code','source','fixture','observedAt',1,'state','unreadable','reason','HTTP 503 from the provider'));"

def kimi_cause() -> String:
  "You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends."

def session_row(id: String, parent_sql: String, native: String, workspace: String, branch: String, base: String) -> String:
  "INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint,workspace,branch,base) VALUES("
  ++ C.q(id) ++ "," ++ parent_sql
  ++ ",'omp','kimi-code/kimi-for-coding','high'," ++ C.q(native)
  ++ ",''," ++ C.q(workspace) ++ "," ++ C.q(branch) ++ "," ++ C.q(base) ++ ");"

def exec_row(session: String, directory: String, attempt: String, phase: String, status: String) -> String:
  "INSERT INTO executions(session,id,mode,directory,phase,status) VALUES("
  ++ C.q(session) ++ "," ++ C.q(attempt) ++ ",'managed'," ++ C.q(directory) ++ "," ++ C.q(phase) ++ "," ++ C.q(status) ++ ");"

def stop_row(session: String, directory: String, stop: String, attempt: String, outcome: String, report_id: String) -> String:
  "INSERT INTO session_stops(session,id,reason,attempt,directory,signal,applied_signal,outcome,native_status,report_id) VALUES("
  ++ C.q(session) ++ "," ++ C.q(stop) ++ ",'operator stop'," ++ C.q(attempt) ++ "," ++ C.q(directory)
  ++ ",15,15," ++ C.q(outcome) ++ ",'exit 0'," ++ C.q(report_id) ++ ");"

def message_row(id: String, sender: String, recipient: String, kind: String, body: String, receipt_sql: String) -> String:
  "INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES("
  ++ C.q(id) ++ "," ++ C.q(sender) ++ "," ++ C.q(recipient) ++ "," ++ C.q(kind) ++ "," ++ C.q(body)
  ++ "," ++ receipt_sql ++ ");"

def messages_state_sql(session: String) -> String:
  "SELECT group_concat(id || ':' || kind || ':' || body || ':' || coalesce(receipt,'-'),'|') FROM (SELECT id,kind,body,receipt FROM messages WHERE recipient="
  ++ C.q(session) ++ " ORDER BY seq);"

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    root : Unit <- query(db,session_row("root","NULL","","","",""))
    leaf : Unit <- query(db,session_row("leaf",C.q("root"),"01a15437-e5d7-7301-b994-51623c8a339c","/workspace/leaf","leaf-branch","base-sha"))
    attempt : Unit <- query(db,exec_row("leaf","/workspace/leaf","attempt-1","exited","exit 0"))
    stopped : Unit <- query(db,stop_row("leaf","/workspace/leaf","stop-1","attempt-1","stopped","stop-result:stop-1"))
    task : Unit <- query(db,message_row("task-1","root","leaf","task","Retain this task.","NULL"))
    guidance : Unit <- query(db,message_row("guidance-1","root","leaf","guidance","Retain this guidance.","NULL"))
    report : Unit <- query(db,message_row("report-1","leaf","root","report","Work completed.",C.q("root-received")))
    absent : Unit <- query(db,session_row("leaf2",C.q("root"),"native-leaf2","/workspace/leaf2","leaf2-branch","base-sha"))
    live : Unit <- query(db,session_row("leaf3",C.q("root"),"native-leaf3","/workspace/leaf3","leaf3-branch","base-sha"))
    live_attempt : Unit <- query(db,exec_row("leaf3","/workspace/leaf3","attempt-live","running",""))
    live_stop : Unit <- query(db,stop_row("leaf3","/workspace/leaf3","stop-live","attempt-live","requested","stop-result:stop-live"))
    IO.pure(Unit,Unit{})

def clear_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    native_before : Unit <- expect_read(db,"SELECT native FROM sessions WHERE id='leaf';","01a15437-e5d7-7301-b994-51623c8a339c\n","native-before")
    place_before : Unit <- expect_read(db,"SELECT workspace || ':' || branch || ':' || base FROM sessions WHERE id='leaf';","/workspace/leaf:leaf-branch:base-sha\n","placement-before")
    messages_before : String <- read(db,messages_state_sql("leaf"))
    executions_before : Unit <- expect_read(db,"SELECT count(*) FROM executions WHERE session='leaf';","1\n","executions-before")
    limit : Unit <- UW.record_cause(db,"leaf","m-leaf","acct",kimi_cause())
    exhausted : Unit <- query(db,read_row_sql("100","true"))
    held_before : Unit <- expect_state(db,"leaf","acct","held","held-before-clear")
    windows_before : Unit <- expect_read(db,"SELECT count(*) FROM usage_windows WHERE account='acct';","1\n","windows-before")
    unreadable : Unit <- query(db,unreadable_row_sql())
    held_after_unknown : Unit <- expect_state(db,"leaf","acct","held","unreadable-read-keeps-hold")
    +reads_before : String <- read(db,"SELECT group_concat(id||':'||state,',') FROM usage_reads;")
    cleared : Unit <- Stop.clear(db,"leaf")
    gone : Unit <- expect_read(db,"SELECT count(*) FROM session_stops WHERE session='leaf';","0\n","stop-removed")
    native_after : Unit <- expect_read(db,"SELECT native FROM sessions WHERE id='leaf';","01a15437-e5d7-7301-b994-51623c8a339c\n","native-preserved")
    place_after : Unit <- expect_read(db,"SELECT workspace || ':' || branch || ':' || base FROM sessions WHERE id='leaf';","/workspace/leaf:leaf-branch:base-sha\n","placement-preserved")
    messages_after : String <- read(db,messages_state_sql("leaf"))
    expect("messages-preserved",String.eq(messages_after,messages_before))
    executions_after : Unit <- expect_read(db,"SELECT count(*) FROM executions WHERE session='leaf';","1\n","no-execution-created")
    executions_exited : Unit <- expect_read(db,"SELECT phase FROM executions WHERE session='leaf';","exited\n","execution-unchanged")
    windows_after : Unit <- expect_read(db,"SELECT count(*) FROM usage_windows WHERE account='acct';","1\n","usage-windows-untouched")
    +reads_after : String <- read(db,"SELECT group_concat(id||':'||state,',') FROM usage_reads;")
    expect("usage-reads-untouched",String.eq(reads_after,reads_before))
    held_after_clear : Unit <- expect_state(db,"leaf","acct","held","held-after-clear")
    IO.pure(Unit,Unit{})

def reset_cases(+db: String) -> IO(Unit):
  do IO<Unit>:
    provider_rows : Unit <- expect_read(db,"SELECT count(*) FROM usage_windows WHERE reset_source='provider-message' AND account='acct';","1\n","provider-exhaustion-retained")
    executions_before : Unit <- expect_read(db,"SELECT count(*) FROM executions WHERE session='leaf';","1\n","executions-before-reset")
    opened : Unit <- query(db,read_row_sql("3","false"))
    selectable : Unit <- expect_state(db,"leaf","acct","none","open-read-selectable")
    executions_after : Unit <- expect_read(db,"SELECT count(*) FROM executions WHERE session='leaf';","1\n","open-read-creates-no-execution")
    provider_still : Unit <- expect_read(db,"SELECT count(*) FROM usage_windows WHERE account='acct';","1\n","open-read-adds-no-usage-window-row")
    expect_read(db,"SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:release:leaf' AND recipient='root';","1\n","open-read-release-reported")

def expect_clear_stop(+label: String, parsed: C.Command, expected_session: String) -> IO(Unit):
  match parsed:
    case C.ClearStop{session}: expect(label,String.eq(session,expected_session))
    case other: IO.die(Unit,1,"fixture-clear-stop " ++ label ++ ": unexpected command")

def expect_resume_lift_stop(+label: String, parsed: C.Command, expected_session: String) -> IO(Unit):
  match parsed:
    case C.Resume{session,lift_stop}: expect(label,Bool.and(String.eq(session,expected_session),lift_stop))
    case other: IO.die(Unit,1,"fixture-clear-stop " ++ label ++ ": unexpected command")

def expect_invalid(+label: String, parsed: C.Command) -> IO(Unit):
  match parsed:
    case C.Invalid{}: expect(label,True{})
    case other: IO.die(Unit,1,"fixture-clear-stop " ++ label ++ ": accepted invalid command")

def parse_cases() -> IO(Unit):
  do IO<Unit>:
    expect_clear_stop("parse-clear-stop",C.parse(["clear-stop","leaf"]),"leaf")
    expect_clear_stop("parse-resume-clear-stop",C.parse(["resume","leaf","--clear-stop"]),"leaf")
    expect_clear_stop("parse-stop-clear",C.parse(["stop","leaf","--clear"]),"leaf")
    expect_resume_lift_stop("parse-resume-lift-stop",C.parse(["resume","leaf","--lift-stop"]),"leaf")
    expect_invalid("reject-clear-stop-surplus",C.parse(["clear-stop","leaf","extra"]))
    expect_invalid("reject-resume-clear-stop-surplus",C.parse(["resume","leaf","--clear-stop","extra"]))
    IO.pure(Unit,Unit{})

def expect_parse_error(+label: String, parsed: D.Parsed) -> IO(Unit):
  match parsed:
    case D.Error{cause}: expect(label,Bool.not(String.is_empty(cause)))
    case D.Calls{items}: IO.die(Unit,1,"fixture-clear-stop " ++ label ++ ": unexpectedly parsed")

def expect_clear_parse(+label: String, parsed: D.Parsed) -> IO(Unit):
  match parsed:
    case D.Calls{items}: match items:
      case D.Call{verb,options} <> Nil{}:
        expect(label,Bool.and(String.eq(verb,"resume"),D.present(options,"--clear-stop")))
      case other: IO.die(Unit,1,"fixture-clear-stop " ++ label ++ ": incomplete call")
    case D.Error{cause}: IO.die(Unit,1,"fixture-clear-stop " ++ label ++ ": refused " ++ cause)

def agent_parse_cases() -> IO(Unit):
  do IO<Unit>:
    expect_clear_parse("agent-resume-clear-stop",D.parse(["resume","--session","leaf","--clear-stop"]))
    expect_parse_error("agent-rejects-clear-and-lift",D.parse(["resume","--session","leaf","--clear-stop","--lift-stop"]))
    expect_parse_error("agent-rejects-clear-with-reason",D.parse(["stop","--session","leaf","--clear","--reason","stop it"]))
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case +path <> Nil{}: do IO<Unit>:
      setup(path)
      parse_cases()
      agent_parse_cases()
      clear_cases(path)
      reset_cases(path)
      IO.print("fixture-clear-stop-quota-ok")
    case other: IO.die(Unit,2,"usage: clear-stop-quota DB")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
