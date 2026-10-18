# Post-reset continuation fixture for the #797 usage-window gate. A held gate
# schedules one detached single-shot continuation that sleeps until the
# recorded reset and then re-runs the wake through the existing dispatch entry.
# The fixture proves: the gate holds a short reset and admits after it; a
# scheduled dispatch of an already handled message adds no second delivery and
# keeps the existing receipt; two continuations for the same message leave one
# delivery and one held report; and the continuation delay is capped so a far
# reset re-checks in bounded segments.
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
    case UW.GateUnknown{window,source,receipt}: "unknown"
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
    deliveries : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_deliveries(message TEXT PRIMARY KEY NOT NULL, receipt TEXT NOT NULL);")
    reports : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_reports(id TEXT PRIMARY KEY NOT NULL);")
    IO.pure(Unit,Unit{})

def short_window(+db: String, +session: String, +message: String) -> IO(String):
  do IO<String>:
    +reset : String <- read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000+2000;")
    window : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code'," ++ C.q(session) ++ ",'5-hour'," ++ Tx.trim_nl(reset) ++ ",'provider-message',NULL,'short reset window'," ++ C.q(message) ++ ");")
    IO.pure(String,Tx.trim_nl(reset))

def handled_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +reset : String <- short_window(db,"wa","m-wa")
    handled : Unit <- query(db,"INSERT INTO wake_deliveries(message,receipt) VALUES('m-wa','handled-first');")
    held : Unit <- expect_gate(db,"wa","wa","held","handled-case-held")
    UW.schedule_wake(db,"m-wa",reset,self)
    IO.pure(Unit,Unit{})

def duplicate_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +reset : String <- short_window(db,"wb","m-wb")
    report : Unit <- query(db,"INSERT INTO wake_reports(id) VALUES('m-wb:usage-window-held-report');")
    held : Unit <- expect_gate(db,"wb","wb","held","duplicate-case-held")
    UW.schedule_wake(db,"m-wb",reset,self)
    UW.schedule_wake(db,"m-wb",reset,self)
    IO.pure(Unit,Unit{})

def cap_case(+db: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +far : String <- read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000+172800000;")
    delay : Unit <- expect_read(db,UW.schedule_delay_sql(Tx.trim_nl(far)),"86400\n","far-reset-segment-capped")
    window : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','wc','5-hour'," ++ Tx.trim_nl(far) ++ ",'provider-message',NULL,'far reset window','m-wc');")
    held : Unit <- expect_gate(db,"wc","wc","held","far-reset-held")
    passed : Unit <- query(db,"UPDATE usage_windows SET resets_at=CAST(strftime('%s','now') AS INTEGER)*1000-1000 WHERE message='m-wc';")
    elapsed : Unit <- expect_gate(db,"wc","wc","elapsed","far-reset-elapsed")
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +path <> +self <> Nil{}: do IO<Unit>:
      setup(path)
      handled_case(path,self)
      duplicate_case(path,self)
      cap_case(path,self)
      waited : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","sleep 5"]),".")
      handled_delivery : Unit <- expect_read(path,"SELECT count(*) FROM wake_deliveries WHERE message='m-wa';","1\n","handled-single-delivery")
      kept_receipt : Unit <- expect_read(path,"SELECT receipt FROM wake_deliveries WHERE message='m-wa';","handled-first\n","handled-keeps-receipt")
      duplicate_delivery : Unit <- expect_read(path,"SELECT count(*) FROM wake_deliveries WHERE message='m-wb';","1\n","duplicate-single-delivery")
      duplicate_report : Unit <- expect_read(path,"SELECT count(*) FROM wake_reports WHERE id='m-wb:usage-window-held-report';","1\n","duplicate-single-held-report")
      IO.print("fixture-windows-wake-ok")
    case other: IO.die(Unit,2,"usage: usage-windows-wake DB SELF_SCRIPT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
