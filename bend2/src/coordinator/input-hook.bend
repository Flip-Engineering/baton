# PostToolUse supplies unread owed bodies at the next successful tool boundary.
# Complete reads use the admitted attempt's existing native custody identity.
import Base
import ../coordinator/commands.bend as C
import ../coordinator/message-status.bend as Status
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

def text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: Tx.trim_nl(value)
    case Fail{error}: ""

def environment(name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    IO.pure(String,text(result))

# A missing witness leaves read status unrecorded and permits later delivery.
def witness(+db: String, directory: String, empty: Bool) -> IO(String):
  match empty:
    case True{}: IO.pure(String,"{}")
    case False{}: do IO<String>:
      result : Result<&1,&1,U32 & String,String> <- Custody.Instance.input_witness(db,directory)
      +value : String <- IO.pure(String,text(result))
      IO.pure(String,Bool.pick(String,String.is_empty(value),"{}",value))

def selection_sql(+session: String) -> String:
  "SELECT coalesce(json_group_array(json(item)),'[]') FROM (SELECT json_object('id',m.id,'recipient',m.recipient,'sender',m.sender,'kind',m.kind,'body',m.body) AS item FROM messages m WHERE m.recipient=" ++ C.q(session)
  ++ " AND " ++ Status.owed_sql("m") ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " ORDER BY m.seq)"

def output_sql(+saved: String) -> String:
  "SELECT CASE WHEN json_array_length(" ++ C.q(saved) ++ ")>0 THEN json_object('hookSpecificOutput',json_object('hookEventName','PostToolUse','additionalContext','Baton input for this turn. Handle the following complete messages:' || char(10) || (SELECT group_concat('Message (' || json_extract(value,'$.kind') || ') from ' || json_extract(value,'$.sender') || ' [id: ' || json_extract(value,'$.id') || ']:' || char(10) || json_extract(value,'$.body') || char(10) || 'The complete input is available in this turn.',char(10)||char(10)) FROM json_each(" ++ C.q(saved) ++ ")))) ELSE '' END;"

# The statement binds the complete body to the active owned execution.
def record_sql(+session: String, +directory: String, +attempt: String, +native: String, identity: String, saved: String) -> String:
  Status.record_sql(session,directory,attempt,native,identity,saved,False{})

def recorded(db: String, session: String, directory: String, saved: String, fields: List<String>) -> IO(Unit):
  match fields:
    case attempt <> native <> identity <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,record_sql(session,directory,Tx.hex_decode(attempt),Tx.hex_decode(native),Tx.hex_decode(identity),saved))
      IO.pure(Unit,Unit{})
    case other: IO.pure(Unit,Unit{})

def delivered(+db: String, +session: String, +directory: String, +witness: String, +saved: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+output}:
      Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(output)),IO.pure(Unit,Unit{}),
        (do IO<Unit>:
          printed : Unit <- IO.print(Tx.trim_nl(output))
          scope : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT hex(e.id)||char(9)||hex(s.native)||char(9)||hex(json_extract(" ++ C.q(witness) ++ ",'$.identity')) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ C.q(session) ++ " AND e.directory=" ++ C.q(directory) ++ " AND e.phase='running' AND s.native<>'' AND json_extract(" ++ C.q(witness) ++ ",'$.live')=1 AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";")
          recorded(db,session,directory,saved,Tx.split_tabs(text(scope)))))

def selected(+db: String, +session: String, +directory: String, witness: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+saved}: do IO<Unit>:
      output : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,output_sql(Tx.trim_nl(saved)))
      delivered(db,session,directory,witness,Tx.trim_nl(saved),output)

# Database and custody failures leave the tool call's result available.
def run(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    +directory : String <- environment("BATON_ATTEMPT_DIRECTORY")
    +bound : String <- witness(db,directory,String.is_empty(directory))
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,selection_sql(session))
    selected(db,session,directory,bound,result)
