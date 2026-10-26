# PostToolUse points to the oldest unread message. The recipient's supported
# read operation supplies the complete body and records the actual read.
import Base
import ../coordinator/commands.bend as C
import ../coordinator/message-status.bend as Status
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

def selection_sql(+session: String) -> String:
  "SELECT coalesce((SELECT json_object('id',m.id,'sender',m.sender,'kind',m.kind) FROM messages m WHERE m.recipient=" ++ C.q(session)
  ++ " AND " ++ Status.owed_sql("m") ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " ORDER BY m.seq LIMIT 1),'');"

def output_sql(+saved: String) -> String:
  "SELECT CASE WHEN " ++ C.q(saved) ++ "<>'' THEN json_object('hookSpecificOutput',json_object('hookEventName','PostToolUse','additionalContext','Baton input is pending. Message (' || json_extract(" ++ C.q(saved) ++ ",'$.kind') || ') from ' || json_extract(" ++ C.q(saved) ++ ",'$.sender') || ' [id: ' || json_extract(" ++ C.q(saved) ++ ",'$.id') || '] is unread. Read the complete body with baton read ' || json_extract(" ++ C.q(saved) ++ ",'$.id') || '.')) ELSE '' END;"

def selected(db: String, saved: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match saved:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+row}: do IO<Unit>:
      answer : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,output_sql(Tx.trim_nl(row)))
      match answer:
        case Fail{error}: IO.pure(Unit,Unit{})
        case Done{output}: Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(output)),IO.pure(Unit,Unit{}),IO.print(Tx.trim_nl(output)))

# Database failures preserve the successful tool result and unread input.
def run(+db: String, session: String) -> IO(Unit):
  do IO<Unit>:
    row : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,selection_sql(session))
    selected(db,row)
