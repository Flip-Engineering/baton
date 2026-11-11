# Production wake-gate fixture for #797. It drives Receive.wake_due, the gate
# path the coordinator uses, with a test launch callback that records delivery
# and sets the message receipt. A held window must not launch; the held branch
# reports and schedules a continuation; the continuation re-enters this same
# path, so an operator-moved reset is re-evaluated when the segment fires.
#
# usage: usage-windows-wake-path DB SESSION MODE
#        usage-windows-wake-path --wake-message DB MESSAGE
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/receive.bend as Receive
import ../src/coordinator/usage-windows.bend as UW
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

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

def drive(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Receive.wake_due(db,session,"0",target => deliver_record(db,target))

def setup(+db: String, session: String) -> IO(Unit):
  do IO<Unit>:
    made : String <- IO.try(String,DB.Sql.query(db,C.schema()))
    root : Unit <- query(db,"INSERT OR IGNORE INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES('root',NULL,'omp','','','','');")
    leaf : Unit <- query(db,"INSERT OR IGNORE INTO sessions(id,parent,harness,model,effort,native,endpoint) VALUES(" ++ C.q(session) ++ ",'root','omp','kimi-code/kimi-for-coding','high','','');")
    deliveries : Unit <- query(db,"CREATE TABLE IF NOT EXISTS wake_deliveries(message TEXT PRIMARY KEY NOT NULL, receipt TEXT NOT NULL);")
    IO.pure(Unit,Unit{})

def window(+db: String, +session: String, +message: String, +ms_offset: String) -> IO(String):
  do IO<String>:
    +reset : String <- read(db,"SELECT CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms_offset ++ ";")
    inserted : Unit <- query(db,"INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code'," ++ C.q(session) ++ ",'5-hour'," ++ Tx.trim_nl(reset) ++ ",'provider-message',NULL,'window'," ++ C.q(message) ++ ");")
    IO.pure(String,Tx.trim_nl(reset))

def message(+db: String, +session: String, +message: String, +receipt: String) -> IO(Unit):
  query(db,"INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES(" ++ C.q(message) ++ ",'root'," ++ C.q(session) ++ ",'guidance','owed',nullif(" ++ C.q(receipt) ++ ",''));")

def move_reset(+db: String, +message: String, +ms_offset: String) -> IO(Unit):
  query(db,"UPDATE usage_windows SET resets_at=CAST(strftime('%s','now') AS INTEGER)*1000+" ++ ms_offset ++ " WHERE message=" ++ C.q(message) ++ ";")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case "--wake-message" <> +db <> +msg <> Nil{}: do IO<Unit>:
      recipient : String <- read(db,"SELECT coalesce((SELECT recipient FROM messages WHERE id=" ++ C.q(msg) ++ " AND receipt IS NULL),'');")
      present : Bool = Bool.not(String.is_empty(Tx.trim_nl(recipient)))
      outcome : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),present,drive(db,Tx.trim_nl(recipient)),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
      IO.pure(Unit,Unit{})
    case +db <> session <> mode <> Nil{}: do IO<Unit>:
      setup(db,session)
      +held_reset : String <- window(db,session,"m-held","2000")
      held_message : Unit <- message(db,session,"m-held","")
      check_zero : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries;","0\n","no-delivery-before")
      held : Result<&1,&1,U32 & String,Unit> <- drive(db,session)
      held_none : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries;","0\n","held-no-delivery")
      held_report : Unit <- expect_read(db,"SELECT count(*) FROM messages WHERE id='m-held:usage-window-held';","1\n","held-guidance")
      moved_later : Unit <- move_reset(db,"m-held","6000")
      later_zero : Unit <- expect_read(db,"SELECT count(*) FROM wake_deliveries;","0\n","moved-later-no-immediate-delivery")
      IO.print("fixture-window-wake-path-ok")
    case other: IO.die(Unit,2,"usage")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
