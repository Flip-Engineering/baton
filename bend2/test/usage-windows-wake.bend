# Post-reset continuation fixture for the #797 usage-window gate. A held gate
# schedules one detached single-shot continuation that sleeps until the
# recorded reset and then re-enters the wake driver, which re-checks the gate.
# The fixture proves: the continuation names the wake entry, not the direct
# delivery entry; a read message is a no-op; a still-held window records a
# check and delivers nothing; an admitted window delivers once; duplicate
# continuations leave one delivery and one held report; and the delay is
# capped at one day with the next segment still capped while held.
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
    case UW.GateElapsed{window,resets_at,source,receipt}: "elapsed"

def expect_gate(+db: String, +session: String, +account: String, +expected: String, +label: String) -> IO(Unit):
  do IO<Unit>:
    gate : UW.Gate <- UW.window_gate(db,session,account)
    expect(label,String.eq(gate_class(gate),expected))

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    root : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','','');")
    one : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('wa','root','omp','kimi-code/kimi-for-coding','high','','');")
    two : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('wb','root','omp','kimi-code/kimi-for-coding','high','','');")
    three : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('wc','root','omp','kimi-code/kimi-for-coding','high','','');")
    four : Unit <- query(db,"INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('ws','root','omp','kimi-code/kimi-for-coding','high','','');")
    deliveries : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_deliveries(message TEXT PRIMARY KEY NOT NULL, receipt TEXT NOT NULL);")
    reports : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_reports(id TEXT PRIMARY KEY NOT NULL);")
    checks : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_held_checks(id TEXT PRIMARY KEY NOT NULL);")
    IO.pure(Unit,Unit{})

def window(+db: String, +session: String, +message: String, +ms_offset: String) -> IO(String):
  do IO<String>:
    +reset : String <- read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms_offset ++ ";")
    window : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code'," ++ C.q(session) ++ ",'5-hour'," ++ Tx.trim_nl(reset) ++ ",'provider-message',NULL,'window'," ++ C.q(message) ++ ");")
    IO.pure(String,Tx.trim_nl(reset))

def message(+db: String, +session: String, +message: String, +receipt: String) -> IO(Unit):
  do IO<Unit>:
    saved : Unit <- query(db,"INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(" ++ C.q(message) ++ ",'root'," ++ C.q(session) ++ ",'guidance','owed',nullif(" ++ C.q(receipt) ++ ",''));")
    marked : Unit <- Bool.pick(IO(Unit),String.is_empty(receipt),IO.pure(Unit,Unit{}),
      query(db,"INSERT OR IGNORE INTO message_reads(attempt,message,recipient,native,identity) VALUES('legacy'," ++ C.q(message) ++ "," ++ C.q(session) ++ ",'','receipt');"))
    IO.pure(Unit,Unit{})

def session(+db: String, +id: String) -> IO(Unit):
  # The window rows bind provider 'kimi-code'; the session model must name that
  # provider or the gate sees no matching window. Account isolates the cases.
  query(db,"INSERT OR IGNORE INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES(" ++ C.q(id) ++ ",'root','omp','kimi-code/kimi-for-coding','high','','');")

def handled_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +reset : String <- window(db,"wa","m-wa","2000")
    handled : Unit <- message(db,"wa","m-wa","handled-first")
    held : Unit <- expect_gate(db,"wa","wa","held","handled-case-held")
    UW.schedule_wake(db,"m-wa",reset,self)
    IO.pure(Unit,Unit{})

def duplicate_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +reset : String <- window(db,"wb","m-wb","2000")
    owed : Unit <- message(db,"wb","m-wb","")
    held : Unit <- expect_gate(db,"wb","wb","held","duplicate-case-held")
    UW.schedule_wake(db,"m-wb",reset,self)
    UW.schedule_wake(db,"m-wb",reset,self)
    IO.pure(Unit,Unit{})

def stale_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +reset : String <- window(db,"ws","m-ws","3600000")
    owed : Unit <- message(db,"ws","m-ws","")
    held : Unit <- expect_gate(db,"ws","ws","held","stale-case-held")
    before : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-ws';","0\n","stale-held-no-delivery-before")
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv([self,"--wake-message",db,"m-ws"]),".")
    checked : Unit <- expect_read(db,"SELECT count(*) FROM wake_held_checks WHERE id='m-ws';","1\n","stale-held-check-recorded")
    blocked : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-ws';","0\n","stale-held-no-delivery")
    passed : Unit <- query(db,"UPDATE usage_windows SET resets_at=CAST(strftime('%s','now') AS INTEGER)*1000-1000 WHERE message='m-ws';")
    admitted : Unit <- expect_gate(db,"ws","ws","elapsed","stale-case-elapsed")
    rerun : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv([self,"--wake-message",db,"m-ws"]),".")
    delivered : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-ws';","1\n","elapsed-delivery-once")
    receipt : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m-ws' AND receipt IS NOT NULL;","0\n","elapsed-keeps-stored-receipt-empty")
    IO.pure(Unit,Unit{})

def far_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +far : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000+172800000 AS TEXT);")
    created : Unit <- session(db,"far2")
    window : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','far2','5-hour'," ++ Tx.trim_nl(far) ++ ",'provider-message',NULL,'far window','m-far2');")
    owed : Unit <- message(db,"far2","m-far2","")
    held : Unit <- expect_gate(db,"far2","far2","held","far-continuation-held")
    +argv : String <- IO.pure(String,Tx.enc_argv(UW.schedule_argv(self,db,"m-far2","1")))
    ran : Result<&1,&1,U32 & String,String> <- Proc.Process.run(argv,".")
    checked : Unit <- expect_read(db,"SELECT count(*) FROM wake_held_checks WHERE id='m-far2';","1\n","far-continuation-held-check")
    blocked : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-far2';","0\n","far-continuation-no-delivery")
    next_segment : Unit <- expect_read(db,UW.schedule_delay_sql(Tx.trim_nl(far)),"86400\n","far-continuation-next-segment")
    IO.pure(Unit,Unit{})

def cap_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    +far : String <- read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000+172800000;")
    delay : Unit <- expect_read(db,UW.schedule_delay_sql(Tx.trim_nl(far)),"86400\n","far-reset-segment-capped")
    window : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','wc','5-hour'," ++ Tx.trim_nl(far) ++ ",'provider-message',NULL,'far window','m-wc');")
    held : Unit <- expect_gate(db,"wc","wc","held","far-reset-held")
    next_segment : Unit <- expect_read(db,UW.schedule_delay_sql(Tx.trim_nl(far)),"86400\n","next-segment-still-86400")
    passed : Unit <- query(db,"UPDATE usage_windows SET resets_at=CAST(strftime('%s','now') AS INTEGER)*1000-1000 WHERE message='m-wc';")
    elapsed : Unit <- expect_gate(db,"wc","wc","elapsed","far-reset-elapsed")
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> +self <> Nil{}: do IO<Unit>:
      setup(path)
      +argv_enc : String <- IO.pure(String,Tx.enc_argv(UW.schedule_argv(self,path,"m","1")))
      argv_wake : Unit <- expect_read(path,"SELECT instr(" ++ C.q(argv_enc) ++ ",'--wake-message')>0;","1\n","schedule-uses-wake-entry")
      argv_direct : Unit <- expect_read(path,"SELECT instr(" ++ C.q(argv_enc) ++ ",'--dispatch-message')=0;","1\n","schedule-not-direct-delivery")
      handled_case(path,self)
      duplicate_case(path,self)
      stale_case(path,self)
      far_case(path,self)
      cap_case(path)
      waited : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","sleep 5"]),".")
      handled_delivery : Unit <- expect_read(path,"SELECT count(*) FROM wake_deliveries WHERE message='m-wa';","0\n","handled-no-second-delivery")
      kept_receipt : Unit <- expect_read(path,"SELECT receipt FROM messages WHERE id='m-wa';","handled-first\n","handled-keeps-receipt")
      duplicate_delivery : Unit <- expect_read(path,"SELECT count(*) FROM wake_deliveries WHERE message='m-wb';","1\n","duplicate-single-delivery")
      duplicate_report : Unit <- expect_read(path,"SELECT count(*) FROM wake_reports WHERE id='m-wb:usage-window-held-report';","1\n","duplicate-single-held-report")
      IO.print("fixture-windows-wake-ok")
    case other: IO.die(Unit,2,"usage: usage-windows-wake DB SELF_SCRIPT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
