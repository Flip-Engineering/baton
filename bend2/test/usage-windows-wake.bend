# Held-seat continuation fixture for the #1025 usage hold. A held wake starts one
# detached single-shot continuation that sleeps until the provider's reported reset
# of the held window or for one read interval (60 seconds), whichever is sooner, and
# then re-enters the wake driver, which decides again from the recorded live reads.
# The fixture proves: the continuation names the wake entry, not the direct delivery
# entry; the gate carries the provider reset that the continuation sleeps until; a
# read message is a no-op; a continuation that fires while the newest read is
# exhausted records a check and delivers nothing, also when that read's reset time
# has passed; an open read admits one delivery; duplicate continuations leave one
# delivery and one report; and a reset two days ahead, or one already passed, sleeps
# one read interval.
#
# usage: usage-windows-wake DB SELF_SCRIPT
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage-windows.bend as UW
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx
import ../src/git/process.bend as Proc

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-window-wake " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-window-wake " ++ label ++ ": refused"))

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

def gate_reset(gate: UW.Gate) -> String:
  match gate:
    case UW.GateHeld{window,resets_at,source,receipt}: resets_at
    case other: ""

def expect_gate(+db: String, +session: String, +account: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_gate(db,session,account)
    expect(label,String.eq(gate_class(gate),expected))

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    root : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','','');")
    seats : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('wa','root','omp','kimi-code/kimi-for-coding','high','',''),('wb','root','omp','kimi-code/kimi-for-coding','high','',''),('ws','root','omp','kimi-code/kimi-for-coding','high','',''),('wf','root','omp','kimi-code/kimi-for-coding','high','','');")
    deliveries : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_deliveries(message TEXT PRIMARY KEY NOT NULL, receipt TEXT NOT NULL);")
    reports : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_reports(id TEXT PRIMARY KEY NOT NULL);")
    checks : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_held_checks(id TEXT PRIMARY KEY NOT NULL);")
    IO.pure(Unit,Unit{})

# One live read of the kimi-code 5-hour window for an account. Each case uses its
# seat id as the account label, so the cases do not share a hold.
def read_row_sql(+account: String, +percent: String, +resets: String, +exhausted: String) -> String:
  "INSERT INTO usage_reads(observed_at,provider,account,session,trigger,state,source,reason,document) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'kimi-code'," ++ C.q(account) ++ ",'','fixture','read','fixture','',json_object('schema','baton2-usage-read-v1','provider','kimi-code','source','fixture','observedAt',1,'state','read','windows',json_array(json_object('window','5-hour','usedPercent'," ++ percent ++ ",'resetsAt'," ++ resets ++ ",'exhausted',json(" ++ C.q(exhausted) ++ ")))));"

# An exhausted read whose provider reset is ms_offset from now; answers that reset.
def held_read(+db: String, +account: String, +ms_offset: String) -> IO(String):
  do IO<String>:
    +reset : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms_offset ++ " AS TEXT);")
    saved : Unit <- query(db,read_row_sql(account,"100",Tx.trim_nl(reset),"true"))
    IO.pure(String,Tx.trim_nl(reset))

def open_read(+db: String, +account: String) -> IO(Unit):
  query(db,read_row_sql(account,"3","CAST(strftime('%s','now') AS INTEGER)*1000+18000000","false"))

def message(+db: String, +session: String, +message: String, +receipt: String) -> IO(Unit):
  do IO<Unit>:
    saved : Unit <- query(db,"INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(" ++ C.q(message) ++ ",'root'," ++ C.q(session) ++ ",'guidance','owed',nullif(" ++ C.q(receipt) ++ ",''));")
    marked : Unit <- Bool.pick(IO(Unit),String.is_empty(receipt),IO.pure(Unit,Unit{}),
      query(db,"INSERT OR IGNORE INTO message_reads(attempt,message,recipient,native,identity) VALUES('legacy'," ++ C.q(message) ++ "," ++ C.q(session) ++ ",'','receipt');"))
    IO.pure(Unit,Unit{})

def run_marker(+db: String, +self: String, +message: String) -> IO(Unit):
  do IO<Unit>:
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv([self,"--wake-message",db,message]),".")
    IO.pure(Unit,Unit{})

def handled_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +reset : String <- held_read(db,"wa","2000")
    handled : Unit <- message(db,"wa","m-wa","handled-first")
    +gate : UW.Gate <- UW.window_gate(db,"wa","wa")
    held : Unit <- expect("handled-case-held",String.eq(gate_class(gate),"held"))
    carried : Unit <- expect("gate-carries-provider-reset",String.eq(gate_reset(gate),reset))
    UW.schedule_wake(db,"m-wa",gate_reset(gate),self)

# Two continuations for one owed message; the open read lands before they fire.
def duplicate_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    reset : String <- held_read(db,"wb","2000")
    owed : Unit <- message(db,"wb","m-wb","")
    +gate : UW.Gate <- UW.window_gate(db,"wb","wb")
    held : Unit <- expect("duplicate-case-held",String.eq(gate_class(gate),"held"))
    first : Unit <- UW.schedule_wake(db,"m-wb",gate_reset(gate),self)
    second : Unit <- UW.schedule_wake(db,"m-wb",gate_reset(gate),self)
    open_read(db,"wb")

def stale_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    reset : String <- held_read(db,"ws","3600000")
    owed : Unit <- message(db,"ws","m-ws","")
    held : Unit <- expect_gate(db,"ws","ws","held","stale-case-held")
    before : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-ws';","0\n","stale-held-no-delivery-before")
    ran : Unit <- run_marker(db,self,"m-ws")
    checked : Unit <- expect_read(db,"SELECT count(*) FROM wake_held_checks WHERE id='m-ws';","1\n","stale-held-check-recorded")
    blocked : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-ws';","0\n","stale-held-no-delivery")
    passed : String <- held_read(db,"ws","-1000")
    still : Unit <- expect_gate(db,"ws","ws","held","passed-reset-without-open-read-held")
    rerun : Unit <- run_marker(db,self,"m-ws")
    waiting : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-ws';","0\n","passed-reset-no-delivery")
    opened : Unit <- open_read(db,"ws")
    admitted : Unit <- expect_gate(db,"ws","ws","none","open-read-admits")
    delivered_run : Unit <- run_marker(db,self,"m-ws")
    delivered : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-ws';","1\n","open-read-delivery-once")
    expect_read(db,"SELECT count(*) FROM messages WHERE id='m-ws' AND receipt IS NOT NULL;","0\n","open-read-keeps-stored-receipt-empty")

# A continuation that fires while the read is still exhausted delivers nothing. The
# continuation sleeps until a provider reset that is less than one read interval
# ahead, and one read interval otherwise.
def far_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +far : String <- held_read(db,"wf","172800000")
    owed : Unit <- message(db,"wf","m-wf","")
    held : Unit <- expect_gate(db,"wf","wf","held","far-continuation-held")
    +argv : String <- IO.pure(String,Tx.enc_argv(UW.schedule_argv(self,db,"m-wf","1")))
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(argv,".")
    checked : Unit <- expect_read(db,"SELECT count(*) FROM wake_held_checks WHERE id='m-wf';","1\n","far-continuation-held-check")
    blocked : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-wf';","0\n","far-continuation-no-delivery")
    far_delay : Unit <- expect_read(db,UW.schedule_delay_sql(far),"60\n","far-reset-sleeps-one-read-interval")
    +past : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000-1000 AS TEXT);")
    past_delay : Unit <- expect_read(db,UW.schedule_delay_sql(Tx.trim_nl(past)),"60\n","passed-reset-sleeps-one-read-interval")
    +near : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000+2000 AS TEXT);")
    +near_delay : String <- read(db,UW.schedule_delay_sql(Tx.trim_nl(near)))
    expect_read(db,"SELECT CAST(" ++ C.q(Tx.trim_nl(near_delay)) ++ " AS INTEGER) BETWEEN 1 AND 2;","1\n","near-reset-sleeps-until-reset")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> +self <> Nil{}: do IO<Unit>:
      ready : Unit <- setup(path)
      +argv_enc : String <- IO.pure(String,Tx.enc_argv(UW.schedule_argv(self,path,"m","1")))
      argv_wake : Unit <- expect_read(path,"SELECT instr(" ++ C.q(argv_enc) ++ ",'--wake-message')>0;","1\n","schedule-uses-wake-entry")
      argv_direct : Unit <- expect_read(path,"SELECT instr(" ++ C.q(argv_enc) ++ ",'--dispatch-message')=0;","1\n","schedule-not-direct-delivery")
      handled : Unit <- handled_case(path,self)
      duplicate : Unit <- duplicate_case(path,self)
      stale : Unit <- stale_case(path,self)
      far : Unit <- far_case(path,self)
      waited : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","sleep 5"]),".")
      handled_delivery : Unit <- expect_read(path,"SELECT count(*) FROM wake_deliveries WHERE message='m-wa';","0\n","handled-no-second-delivery")
      kept_receipt : Unit <- expect_read(path,"SELECT receipt FROM messages WHERE id='m-wa';","handled-first\n","handled-keeps-receipt")
      duplicate_delivery : Unit <- expect_read(path,"SELECT count(*) FROM wake_deliveries WHERE message='m-wb';","1\n","duplicate-single-delivery")
      duplicate_report : Unit <- expect_read(path,"SELECT count(*) FROM wake_reports WHERE id='m-wb:wake-delivered-report';","1\n","duplicate-single-delivery-report")
      IO.print("fixture-windows-wake-ok")
    case other: IO.die(Unit,2,"usage: usage-windows-wake DB SELF_SCRIPT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
