# Production wake-path fixture for #797. It drives Receive.wake_due, the gate
# path the coordinator uses, with a test launch callback that records one
# delivery and sets the message receipt. A held window reports and schedules a
# continuation; the continuation re-enters this path, so a reset moved later is
# re-evaluated and does not deliver at the old time, a reset moved earlier
# delivers once, and a handled message is a no-op. The unqualified case
# covers the account DB Muse shape: a model without a provider prefix and empty
# provider/window/account rows hold before the recorded reset.
#
# usage: usage-windows-wake-path DB
#        usage-windows-wake-path --wake-message DB MESSAGE
#        usage-windows-wake-path --wake-check DB MESSAGE
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/receive.bend as Receive
import ../src/coordinator/usage-windows.bend as UW
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx
import ../src/git/process.bend as Proc

def expect(+label: String, is_ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit),is_ok,IO.print("fixture-window-wake-path " ++ label ++ ": ok"),IO.die(Unit,1,"fixture-window-wake-path " ++ label ++ ": refused"))

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

def deliver_record(+db: String, +target: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    pending : String <- read(db,"SELECT count(*) FROM messages WHERE id=" ++ C.q(target) ++ " AND receipt IS NULL;")
    delivered : Unit <- Bool.pick(IO(Unit),String.eq(pending,"1\n"),query(db,"INSERT OR IGNORE INTO wake_deliveries(message,receipt) VALUES(" ++ C.q(target) ++ ",'delivered');UPDATE messages SET receipt='delivered' WHERE id=" ++ C.q(target) ++ " AND receipt IS NULL;"),IO.pure(Unit,Unit{}))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def deliver_test(+db: String) -> String -> IO(Result<&1,&1,U32 & String,Unit>):
  target => deliver_record(db,target)

def drive(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Receive.wake_due(db,session,"0",deliver_test(db))

def session(+db: String, +id: String) -> IO(Unit):
  query(db,"INSERT OR IGNORE INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES(" ++ C.q(id) ++ ",'root','omp'," ++ C.q(id ++ "-kimi/kimi-for-coding") ++ ",'high','','');")

def setup(+db: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    root : Unit <- query(db,"INSERT OR IGNORE INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','','');")
    deliveries : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_deliveries(message TEXT PRIMARY KEY NOT NULL, receipt TEXT NOT NULL);")
    checks : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_held_checks(id TEXT PRIMARY KEY NOT NULL);")
    IO.pure(Unit,Unit{})

def window(+db: String, +session: String, +message: String, +ms_offset: String) -> IO(Unit):
  query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp'," ++ C.q(session ++ "-kimi/kimi-for-coding") ++ "," ++ C.q(session ++ "-kimi") ++ ",'', '5-hour',CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms_offset ++ ",'provider-message',NULL,'window'," ++ C.q(message) ++ ");")

def message(+db: String, +session: String, +message: String, +receipt: String) -> IO(Unit):
  query(db,"INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(" ++ C.q(message) ++ ",'root'," ++ C.q(session) ++ ",'guidance','owed',nullif(" ++ C.q(receipt) ++ ",''));")

def unqualified_session(+db: String, +id: String) -> IO(Unit):
  query(db,"INSERT OR IGNORE INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES(" ++ C.q(id) ++ ",'root','muse','muse-wonder-1.0','high','','');")

def unqualified_window(+db: String, +session: String, +message: String, +ms_offset: String) -> IO(Unit):
  query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'muse','muse-wonder-1.0','','','',CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms_offset ++ ",'provider-message',NULL,'window'," ++ C.q(message) ++ ");")

def unqualified_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- unqualified_session(db,"muse-unqualified")
    window : Unit <- unqualified_window(db,"muse-unqualified","m-muse-unqualified","2000")
    owed : Unit <- message(db,"muse-unqualified","m-muse-unqualified","")
    held : Result<&1,&1,U32 & String,Unit> <- drive(db,"muse-unqualified")
    none : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-muse-unqualified';","0\n","unqualified-window-held-no-delivery")
    report : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m-muse-unqualified:usage-window-held';","1\n","unqualified-window-held-report")
    IO.pure(Unit,Unit{})

def move_reset(+db: String, +message: String, +ms_offset: String) -> IO(Unit):
  query(db,"UPDATE usage_windows SET resets_at=CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms_offset ++ " WHERE message=" ++ C.q(message) ++ ";")

def sleep_ms(ms: String) -> IO(Unit):
  do IO<Unit>:
    waited : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","sleep " ++ ms]),".")
    IO.pure(Unit,Unit{})

def later_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"later")
    window : Unit <- window(db,"later","m-later","2000")
    owed : Unit <- message(db,"later","m-later","")
    held : Result<&1,&1,U32 & String,Unit> <- drive(db,"later")
    moved : Unit <- move_reset(db,"m-later","6000")
    waited : Unit <- sleep_ms("3")
    none : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-later';","0\n","moved-later-no-delivery-at-old-time")
    noticed : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m-later:usage-window-held';","1\n","moved-later-held-report")
    IO.pure(Unit,Unit{})

def earlier_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"early")
    window : Unit <- window(db,"early","m-early","2000")
    owed : Unit <- message(db,"early","m-early","")
    held : Result<&1,&1,U32 & String,Unit> <- drive(db,"early")
    moved : Unit <- move_reset(db,"m-early","-1000")
    waited : Unit <- sleep_ms("3")
    once : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-early';","1\n","moved-earlier-delivery-once")
    receipt : Unit <- expect_read(db,"SELECT receipt FROM messages WHERE id='m-early';","delivered\n","moved-earlier-receipt")
    IO.pure(Unit,Unit{})

def handled_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"handled")
    window : Unit <- window(db,"handled","m-handled","-1000")
    handled : Unit <- message(db,"handled","m-handled","handled-first")
    driven : Result<&1,&1,U32 & String,Unit> <- drive(db,"handled")
    none : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-handled';","0\n","handled-no-delivery")
    receipt : Unit <- expect_read(db,"SELECT receipt FROM messages WHERE id='m-handled';","handled-first\n","handled-keeps-receipt")
    IO.pure(Unit,Unit{})

def duplicate_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"dup")
    window : Unit <- window(db,"dup","m-dup","-1000")
    owed : Unit <- message(db,"dup","m-dup","")
    first : Result<&1,&1,U32 & String,Unit> <- drive(db,"dup")
    second : Result<&1,&1,U32 & String,Unit> <- drive(db,"dup")
    once : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-dup';","1\n","duplicate-delivery-once")
    receipt : Unit <- expect_read(db,"SELECT receipt FROM messages WHERE id='m-dup';","delivered\n","duplicate-receipt")
    IO.pure(Unit,Unit{})

def far_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"far")
    window : Unit <- window(db,"far","m-far","172800000")
    owed : Unit <- message(db,"far","m-far","")
    +far : String <- read(db,"SELECT CAST(CAST(strftime('%s','now') AS INTEGER)*1000+172800000 AS TEXT);")
    +delay : String <- read(db,UW.schedule_delay_sql(Tx.trim_nl(far)))
    capped : Unit <- expect("far-segment-is-86400",String.eq(Tx.trim_nl(delay),"86400"))
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--wake-message" <> +db <> +msg <> Nil{}: do IO<Unit>:
      +recipient : String <- read(db,"SELECT coalesce((SELECT recipient FROM messages WHERE id=" ++ C.q(msg) ++ " AND receipt IS NULL),'');")
      present : Bool = Bool.not(String.is_empty(Tx.trim_nl(recipient)))
      outcome : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),present,drive(db,Tx.trim_nl(recipient)),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
      IO.pure(Unit,Unit{})
    case +db <> Nil{}: do IO<Unit>:
      setup(db)
      later_case(db)
      earlier_case(db)
      unqualified_case(db)
      handled_case(db)
      duplicate_case(db)
      far_case(db)
      IO.print("fixture-window-wake-path-ok")
    case other: IO.die(Unit,2,"usage")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
