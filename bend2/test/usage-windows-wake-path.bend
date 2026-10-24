# Production wake-path fixture for the #1025 usage hold. It drives Receive.wake_due,
# the gate path the coordinator uses, with a test launch callback that records one
# delivery and writes no messaging state; the recipient's read row is recorded by
# the coordinator when the recipient reads the input. A seat whose newest live read
# is exhausted keeps its owed input, reports the hold once, and schedules a
# continuation at the provider's reported reset; the continuation re-enters this
# path. When the reset passes, the gate reads the provider again; in this binary no
# usage-read helper is installed, so that read is unreadable and the input stays
# owed. When an open read is recorded before the continuation fires the input is
# delivered once and the release is reported. A read message is a no-op. The
# unqualified case covers the Muse shape: a model without a provider prefix reads
# the harness's provider and is held by that provider's read. Held seats keep
# starting continuations once a read interval, so the fixture ends by recording
# every owed message read; each later continuation then finds nothing owed.
#
# The retained start path (#1016) admits the attempt before it checks the gate.
# A held start must leave no execution row, so a route change is admitted at once.
#
# usage: usage-windows-wake-path DB
#        usage-windows-wake-path --wake-message DB MESSAGE
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/receive.bend as Receive
import ../src/coordinator/stop.bend as Stop
import ../src/coordinator/usage-windows.bend as UW
import ../src/host/sqlite.bend as DB
import ../src/host/session-lock.bend as Lock
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
    pending : String <- read(db,"SELECT count(*) FROM messages WHERE id=" ++ C.q(target) ++ " AND " ++ C.owed_sql("messages") ++ ";")
    delivered : Unit <- Bool.pick(IO(Unit),String.eq(pending,"1\n"),query(db,"INSERT OR IGNORE INTO wake_deliveries(message,receipt) VALUES(" ++ C.q(target) ++ ",'delivered');"),IO.pure(Unit,Unit{}))
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

# One live read of a provider's 5-hour window for the default account.
def read_row_sql(+provider: String, +percent: String, +resets: String, +exhausted: String) -> String:
  "INSERT INTO usage_reads(observed_at,provider,account,session,trigger,state,source,reason,document) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000," ++ C.q(provider) ++ ",'','','fixture','read','fixture','',json_object('schema','baton2-usage-read-v1','provider'," ++ C.q(provider) ++ ",'source','fixture','observedAt',1,'state','read','windows',json_array(json_object('window','5-hour','usedPercent'," ++ percent ++ ",'resetsAt'," ++ resets ++ ",'exhausted',json(" ++ C.q(exhausted) ++ ")))));"

# Each seat's model names its own provider, session-kimi, so the cases do not share a hold.
def held_read(+db: String, +session: String, +ms_offset: String) -> IO(Unit):
  query(db,read_row_sql(session ++ "-kimi","100","CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms_offset,"true"))

def open_read(+db: String, +session: String) -> IO(Unit):
  query(db,read_row_sql(session ++ "-kimi","3","CAST(strftime('%s','now') AS INTEGER)*1000+18000000","false"))

def hold_reports_sql(+session: String, +kind: String) -> String:
  "SELECT count(*) FROM messages WHERE id GLOB " ++ C.q("usage-read:*:" ++ kind ++ ":" ++ session) ++ " AND sender=" ++ C.q(session) ++ " AND kind='report';"

def message(+db: String, +session: String, +message: String, +receipt: String) -> IO(Unit):
  do IO<Unit>:
    saved : Unit <- query(db,"INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(" ++ C.q(message) ++ ",'root'," ++ C.q(session) ++ ",'guidance','owed',nullif(" ++ C.q(receipt) ++ ",''));")
    marked : Unit <- Bool.pick(IO(Unit),String.is_empty(receipt),IO.pure(Unit,Unit{}),
      query(db,"INSERT OR IGNORE INTO message_reads(attempt,message,recipient,native,identity) VALUES('legacy'," ++ C.q(message) ++ "," ++ C.q(session) ++ ",'','receipt');"))
    IO.pure(Unit,Unit{})

def unqualified_session(+db: String, +id: String) -> IO(Unit):
  query(db,"INSERT OR IGNORE INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES(" ++ C.q(id) ++ ",'root','muse','muse-wonder-1.0','high','','');")

def unqualified_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- unqualified_session(db,"muse-unqualified")
    window : Unit <- query(db,read_row_sql("muse","100","CAST(strftime('%s','now') AS INTEGER)*1000+2000","true"))
    owed : Unit <- message(db,"muse-unqualified","m-muse-unqualified","")
    held : Result<&1,&1,U32 & String,Unit> <- drive(db,"muse-unqualified")
    none : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-muse-unqualified';","0\n","unqualified-seat-held-no-delivery")
    expect_read(db,hold_reports_sql("muse-unqualified","hold"),"1\n","unqualified-seat-hold-reported")

def sleep_ms(ms: String) -> IO(Unit):
  do IO<Unit>:
    waited : Result<&1,&1,U32 & String,String> <- Proc.Process.run(Tx.enc_argv(["/bin/sh","-c","sleep " ++ ms]),".")
    IO.pure(Unit,Unit{})

# The provider reset passes: the continuation re-enters the wake path, the gate reads
# the provider again, the unreadable read keeps the seat held, and the hold is
# reported once.
def passed_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"later")
    window : Unit <- held_read(db,"later","2000")
    owed : Unit <- message(db,"later","m-later","")
    held : Result<&1,&1,U32 & String,Unit> <- drive(db,"later")
    waited : Unit <- sleep_ms("3")
    none : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-later';","0\n","passed-reset-without-open-read-no-delivery")
    reread : Unit <- expect_read(db,"SELECT count(*)||'|'||min(state) FROM usage_reads WHERE provider='later-kimi' AND trigger='held-account-due';","1|unreadable\n","passed-reset-reads-the-provider-again")
    expect_read(db,hold_reports_sql("later","hold"),"1\n","repeated-held-wakes-report-once")

# An open read is recorded before the continuation fires: the continuation
# delivers the owed input once and the release is reported.
def open_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"early")
    window : Unit <- held_read(db,"early","2000")
    owed : Unit <- message(db,"early","m-early","")
    held : Result<&1,&1,U32 & String,Unit> <- drive(db,"early")
    opened : Unit <- open_read(db,"early")
    waited : Unit <- sleep_ms("3")
    once : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-early';","1\n","open-read-delivery-once")
    released : Unit <- expect_read(db,hold_reports_sql("early","release"),"1\n","open-read-release-reported")
    expect_read(db,"SELECT count(*) FROM messages WHERE id='m-early' AND receipt IS NOT NULL;","0\n","open-read-keeps-stored-receipt-empty")

def handled_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"handled")
    window : Unit <- open_read(db,"handled")
    handled : Unit <- message(db,"handled","m-handled","handled-first")
    driven : Result<&1,&1,U32 & String,Unit> <- drive(db,"handled")
    none : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-handled';","0\n","handled-no-delivery")
    receipt : Unit <- expect_read(db,"SELECT receipt FROM messages WHERE id='m-handled';","handled-first\n","handled-keeps-receipt")
    IO.pure(Unit,Unit{})

def duplicate_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    created : Unit <- session(db,"dup")
    window : Unit <- open_read(db,"dup")
    owed : Unit <- message(db,"dup","m-dup","")
    first : Result<&1,&1,U32 & String,Unit> <- drive(db,"dup")
    second : Result<&1,&1,U32 & String,Unit> <- drive(db,"dup")
    once : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries WHERE message='m-dup';","1\n","duplicate-delivery-once")
    receipt : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m-dup' AND receipt IS NOT NULL;","0\n","duplicate-keeps-stored-receipt-empty")
    IO.pure(Unit,Unit{})

# A retained start admitted under a held window: Stop.admit writes the execution
# row, then window_held_start runs the held branch the way start_admitted does.
def held_start(+db: String, +id: String, +attempt: String, +msg: String) -> IO(Bool):
  do IO<Bool>:
    created : Unit <- session(db,id)
    win : Unit <- held_read(db,id,"2000")
    owed : Unit <- message(db,id,msg,"")
    gate : UW.Gate <- UW.window_gate(db,id,"")
    admitted : Bool <- Stop.admit(db,id,attempt,"retained",id ++ "-dir")
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    lock : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(canonical,id))
    held : Bool <- Receive.window_held_start(db,id,attempt,msg,lock,gate)
    IO.pure(Bool,held)

def held_start_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    held : Bool <- held_start(db,"held-start","attempt-held-start","m-held-start")
    checked : Unit <- expect("held-start-is-held",held)
    none : Unit <- expect_read(db,"SELECT count(*) FROM executions WHERE session='held-start';","0\n","held-start-removes-execution-row")
    expect_read(db,hold_reports_sql("held-start","hold"),"1\n","held-start-reports-hold")

# Configuration with a changed model is admitted after the held start (#1016).
def held_route_case(+db: String) -> IO(Unit):
  do IO<Unit>:
    held : Bool <- held_start(db,"held-route","attempt-held-route","m-held-route")
    checked : Unit <- expect("held-route-is-held",held)
    changed : Unit <- query(db,"BEGIN IMMEDIATE;" ++ C.configure_sql("held-route","omp","held-route-next","high","","omp","held-route-kimi/kimi-for-coding","high") ++ "COMMIT;")
    model : Unit <- expect_read(db,"SELECT model FROM sessions WHERE id='held-route';","held-route-next\n","held-route-model-change-admitted")
    IO.pure(Unit,Unit{})

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--wake-message" <> +db <> +msg <> Nil{}: do IO<Unit>:
      +recipient : String <- read(db,"SELECT coalesce((SELECT recipient FROM messages WHERE id=" ++ C.q(msg) ++ " AND " ++ C.owed_sql("messages") ++ "),'');")
      present : Bool = Bool.not(String.is_empty(Tx.trim_nl(recipient)))
      outcome : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),present,drive(db,Tx.trim_nl(recipient)),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
      IO.pure(Unit,Unit{})
    case +db <> Nil{}: do IO<Unit>:
      ready : Unit <- setup(db)
      passed : Unit <- passed_case(db)
      opened : Unit <- open_case(db)
      unqualified : Unit <- unqualified_case(db)
      handled : Unit <- handled_case(db)
      duplicate : Unit <- duplicate_case(db)
      started : Unit <- held_start_case(db)
      route : Unit <- held_route_case(db)
      settled : Unit <- query(db,"INSERT OR IGNORE INTO message_reads(attempt,message,recipient,native,identity) SELECT 'legacy',id,recipient,'','receipt' FROM messages WHERE " ++ C.owed_sql("messages") ++ ";")
      IO.print("fixture-window-wake-path-ok")
    case other: IO.die(Unit,2,"usage")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
