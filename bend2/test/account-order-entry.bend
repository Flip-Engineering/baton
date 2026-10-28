import Base
import ../harness/usage-read.bend as Reader
import ../src/coordinator/claude-usage.bend as Claude
import ../src/coordinator/accounts.bend as A
import ../src/coordinator/usage-windows.bend as UW
import ../src/coordinator/commands.bend as C
import ../src/host/sqlite.bend as DB
import ../src/host/text.bend as Text
import ../src/host/clock.bend as Clock
import ../src/git/text.bend as Tx

# Focused entry for the #1059 account-order fallback. It imports the real accounts
# and usage-window modules and runs the order handoff, the wake gate and the launch
# move with HELPER standing in for the usage-read helper:
#   account-order-entry DB account ACTION ID PROVIDER HARNESS FUNDING SECRET ORGANIZATION DETAIL SESSION
#   account-order-entry DB handoff SESSION ID EVENT            (the installed helper)
#   account-order-entry DB handoff-with SESSION ID EVENT HELPER
#   account-order-entry DB current SESSION HARNESS
#   account-order-entry DB read SESSION ACCOUNT HELPER          (one live read)
#   account-order-entry DB refusal-hold SESSION ACCOUNT ATTEMPT CAUSE  (a recorded credit refusal)
#   account-order-entry DB wake SESSION HELPER                  (wake gate, then launch move)
#   account-order-entry DB wake-native SESSION HELPER NATIVE
#   account-order-entry --fixture-usage-read PROVIDER REFERENCE
#   account-order-entry --wake-message DB MESSAGE               (the #1025 release wake)
# The release wake appends "MESSAGE gate=CLASS moved=BOOL current=LABEL" to DB.wake-mark.
# It reads the helper path from DB.helper because the wake argv carries none.

# The real credential resolver and Claude parser consume a fixture HTTP response.
def fixture_request(+reference: String) -> IO(Result<&1,&1,U32 & String,String & String>):
  do IO<Result<&1,&1,U32 & String,String & String>>:
    body : String <- IO.try(String,Text.Text.read(Reader.after_colon(reference) ++ ".response"))
    IO.pure(Result<&1,&1,U32 & String,String & String>,Done{("200",body)})

def fixture_read_at(+provider: String, +reference: String, +observed: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(Reader.scheme_of(reference),"claude-oauth"),
    Reader.read_http(provider,Claude.claude_source(),observed,reference,key => fixture_request(reference),response => Claude.claude_windows_sql(response),response => Claude.claude_problem_sql(response)),
    Reader.read_claude(observed,reference))

def fixture_read_clock(+provider: String, +reference: String, now: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match now:
    case Fail{(code,detail)}: Reader.clock_failed(provider,code,detail)
    case Done{+value}: fixture_read_at(provider,reference,Tx.trim_nl(value))

def fixture_read(+provider: String, +reference: String) -> IO(Unit):
  do IO<Unit>:
    now : Result<&1,&1,U32 & String,String> <- Clock.Clock.millis()
    fixture_read_clock(provider,reference,now)

def fixture_args(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +provider <> +reference <> Nil{}: fixture_read(provider,reference)
    case other: IO.die(Unit,2,"account-order-entry --fixture-usage-read PROVIDER REFERENCE")

def gate_class(gate: UW.Gate) -> String:
  match gate:
    case UW.GateHeld{window,resets_at,source,receipt}: "held"
    case UW.GateUnknown{source,reason,receipt}: "unknown"
    case UW.GateNone{}: "none"

def current_label(account: Maybe<&2,A.AccountRecord>) -> String:
  match account:
    case None{}: ""
    case Some{+chosen}: A.account_id(chosen)

# The wake decision a woken seat makes before it starts its turn: the current
# account's live gate, the order gate, then the launch move.
def wake_native(+db: String, +session: String, +helper: String, +native: String) -> IO(String):
  do IO<String>:
    +label : String <- A.handoff_label_io(db,session)
    current : UW.Gate <- UW.window_gate_with(db,session,label,helper)
    +gate : UW.Gate <- A.order_gate_with(db,session,helper,current)
    +admitted : Bool <- IO.pure(Bool,Bool.not(UW.gate_held(gate)))
    moved : Bool <- Bool.pick(IO(Bool),admitted,A.order_move_with(db,session,native,"/bin/false","/"),IO.pure(Bool,False{}))
    +harness : String <- IO.pure(String,"claude-code")
    account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
    IO.pure(String,"gate=" ++ gate_class(gate) ++ " moved=" ++ Bool.pick(String,moved,"true","false") ++ " current=" ++ current_label(account))

def wake(+db: String, +session: String, +helper: String) -> IO(String):
  wake_native(db,session,helper,"")

def wake_recipient(+db: String, +helper: String, recipient: Result<&1,&1,U32 & String,String>) -> IO(String):
  match recipient:
    case Fail{(code,detail)}: IO.pure(String,"recipient-unread " ++ detail)
    case Done{+session}: wake(db,Tx.trim_nl(session),helper)

def wake_message(+db: String, +message: String) -> IO(Unit):
  do IO<Unit>:
    +helper_text : String <- IO.try(String,Text.Text.read(db ++ ".helper"))
    recipient : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT recipient FROM messages WHERE id=" ++ C.q(message) ++ ";")
    line : String <- wake_recipient(db,Tx.trim_nl(helper_text),recipient)
    appended : Unit <- IO.try(Unit,Text.Text.append(db ++ ".wake-mark",message ++ " " ++ line ++ "\n"))
    IO.pure(Unit,Unit{})

# The command word is matched in the first column only; the release wake's flag is
# tested before the database argument is read.
def command(+db: String, arguments: List<String>) -> IO(Unit):
  match arguments:
    case "account" <> +action <> +id <> +provider <> +harness <> +funding <> +secret <> +organization <> +detail <> +session <> Nil{}:
      A.run(db,action,id,provider,harness,funding,secret,organization,detail,session)
    case "handoff" <> +session <> +id <> +event <> Nil{}:
      do IO<Unit>:
        advanced : Bool <- A.handoff(db,session,id,event,"","","")
        IO.print(Bool.pick(String,advanced,"advanced","exhausted"))
    case "handoff-with" <> +session <> +id <> +event <> +helper <> Nil{}:
      do IO<Unit>:
        advanced : Bool <- A.handoff_with(db,session,id,event,"","","",helper)
        IO.print(Bool.pick(String,advanced,"advanced","exhausted"))
    case "wake-native" <> +session <> +helper <> +native <> Nil{}:
      do IO<Unit>:
        line : String <- wake_native(db,session,helper,native)
        IO.print(line)
    case "current" <> +session <> +harness <> Nil{}:
      do IO<Unit>:
        account : Maybe<&2,A.AccountRecord> <- A.current_account(db,session,harness)
        IO.print(current_label(account))
    case "read" <> +session <> +account <> +helper <> Nil{}:
      do IO<Unit>:
        +provider : String <- UW.seat_provider_io(db,session)
        read : Unit <- UW.read_with(db,session,provider,account,helper,"usage-window-refresh")
        IO.print("read")
    case "refusal-hold" <> +session <> +account <> +attempt <> +cause <> Nil{}:
      do IO<Unit>:
        +provider : String <- UW.seat_provider_io(db,session)
        held : Unit <- UW.record_refusal_hold(db,session,provider,account,attempt,cause)
        IO.print("recorded")
    case "wake" <> +session <> +helper <> Nil{}:
      do IO<Unit>:
        line : String <- wake(db,session,helper)
        IO.print(line)
    case other: IO.die(Unit,2,"account-order-entry: account|handoff|handoff-with|current|read|refusal-hold|wake|--wake-message")

def wake_args(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +db <> +message <> Nil{}: wake_message(db,message)
    case other: IO.die(Unit,2,"account-order-entry --wake-message DB MESSAGE")

def dispatch_first(+first: String, rest: List<String>) -> IO(Unit):
  match first:
    case "--wake-message": wake_args(rest)
    case "--fixture-usage-read": fixture_args(rest)
    case other: command(first,rest)

def dispatch(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +first <> rest: dispatch_first(first,rest)
    case Nil{}: IO.die(Unit,2,"account-order-entry: DB COMMAND ARGS")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    dispatch(arguments)
