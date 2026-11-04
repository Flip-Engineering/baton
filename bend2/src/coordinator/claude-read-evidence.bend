# Claude Code reports completed native Read results in PostToolUse payloads.
# Match the complete formatted message before deriving a read from that event.
import Base
import ./commands.bend as C
import ./input-hook.bend as InputHook
import ./message-status.bend as Status
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

def text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: Tx.trim_nl(value)
    case Fail{error}: ""

def rendered(+row: String) -> String:
  "'Message (' || " ++ row ++ ".kind || ') from ' || " ++ row ++ ".sender || ' [id: ' || " ++ row ++ ".id || ']:' || char(10) || " ++ row ++ ".body || char(10) || 'The complete input is available in this turn.'"

def selection_sql(+session: String, event: String) -> String:
  "WITH native_event(value) AS (SELECT " ++ C.q(event) ++ "), read_result(content) AS (SELECT json_extract(value,'$.tool_response.file.content') FROM native_event WHERE json_valid(value) AND json_extract(value,'$.hook_event_name')='PostToolUse' AND json_extract(value,'$.tool_name')='Read' AND json_type(value,'$.tool_response.file.content')='text') "
  ++ "SELECT coalesce(json_group_array(json(item)),'[]') FROM (SELECT json_object('id',m.id,'recipient',m.recipient,'body',m.body) AS item FROM messages m JOIN read_result r ON instr(r.content," ++ rendered("m") ++ ")>0 WHERE m.recipient=" ++ C.q(session) ++ " AND " ++ Status.owed_sql("m") ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " ORDER BY m.seq);"

def selected(db: String, session: String, directory: String, witness: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+saved}: do IO<Unit>:
      count_result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT json_array_length(" ++ C.q(Tx.trim_nl(saved)) ++ ");")
      count : String <- IO.pure(String,text(count_result))
      Bool.pick(IO(Unit),String.eq(count,"0"),IO.pure(Unit,Unit{}),
        (do IO<Unit>:
          live : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT hex(e.id)||char(9)||hex(s.native)||char(9)||hex(json_extract(" ++ C.q(witness) ++ ",'$.identity')) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ C.q(session) ++ " AND e.directory=" ++ C.q(directory) ++ " AND e.phase='running' AND s.native<>'' AND json_extract(" ++ C.q(witness) ++ ",'$.live')=1 AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";")
          InputHook.recorded(db,session,directory,Tx.trim_nl(saved),Tx.split_tabs(text(live)))))

def witnessed(db: String, session: String, directory: String, event: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+witness}: do IO<Unit>:
      selected_result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,selection_sql(session,event))
      selected(db,session,directory,Tx.trim_nl(witness),selected_result)

# A Claude Read event records only the complete message bodies present in its
# native result, bound to the current admitted attempt and native witness.
def run(db: String, session: String, directory: String, event: String) -> IO(Unit):
  do IO<Unit>:
    witness : Result<&1,&1,U32 & String,String> <- Custody.Instance.input_witness(db,directory)
    witnessed(db,session,directory,event,witness)
