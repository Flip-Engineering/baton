# Antigravity hooks inject complete owed messages before each model invocation
# and keep open assignments active until a completion request is recorded.
import Base
import ../coordinator/commands.bend as C
import ../coordinator/message-status.bend as Status
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ./input-hook.bend as InputHook

def message_text_sql(+saved: String) -> String:
  "coalesce((SELECT group_concat(" ++ Status.complete_message_sql("json_extract(j.value,'$.id')","json_extract(j.value,'$.kind')","json_extract(j.value,'$.sender')","json_extract(j.value,'$.body')") ++ ",char(10)||char(10)) FROM json_each(" ++ C.q(saved) ++ ") j ORDER BY CAST(j.key AS INTEGER)),'')"

def pre_invocation_sql(+saved: String) -> String:
  "SELECT json_object('injectSteps',CASE WHEN json_array_length(" ++ C.q(saved) ++ ")=0 THEN json('[]') ELSE json_array(json_object('userMessage','Baton input for this turn. Handle the following complete messages:' || char(10) || " ++ message_text_sql(saved) ++ ")) END);"

def stop_sql(+session: String, +saved: String) -> String:
  "SELECT CASE WHEN json_array_length(" ++ C.q(saved) ++ ")>0 THEN json_object('decision','continue','reason','Baton has complete input for this turn:' || char(10) || " ++ message_text_sql(saved) ++ " || char(10) || 'Continue the work. When the assignment is ready, call completion-request --text SUMMARY with run_command.')"
  ++ " WHEN " ++ C.task_open_sql(C.q(session)) ++ " AND " ++ C.task_request_sql(C.q(session)) ++ " IS NULL THEN json_object('decision','continue','reason','The current assignment remains open. Continue the work. When it is ready, call completion-request --text SUMMARY with run_command so the conductor can review it.')"
  ++ " ELSE json_object('decision','allow') END;"

def output_sql(+db: String, +sql: String) -> Result<&1,&1,U32 & String,String>:
  DB.Sql.read(db,sql)

def read_input(+db: String, +session: String, +directory: String, +witness: String, +saved: String, +output: String) -> IO(Unit):
  do IO<Unit>:
    printed : Unit <- IO.print(output)
    scope : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT hex(e.id)||char(9)||hex(s.native)||char(9)||hex(json_extract(" ++ C.q(witness) ++ ",'$.identity')) FROM executions e JOIN sessions s ON s.id=e.session WHERE e.session=" ++ C.q(session) ++ " AND e.directory=" ++ C.q(directory) ++ " AND e.phase='running' AND s.native<>'' AND json_extract(" ++ C.q(witness) ++ ",'$.live')=1 AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";")
    InputHook.recorded(db,session,directory,saved,Tx.split_tabs(InputHook.text(scope)))

def output_pre(+db: String, +session: String, +directory: String, +witness: String, saved: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{output}: read_input(db,session,directory,witness,saved,Tx.trim_nl(output))

def pre_invocation(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    +directory : String <- InputHook.environment("BATON_ATTEMPT_DIRECTORY")
    +witness : String <- InputHook.witness(db,directory,String.is_empty(directory))
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,InputHook.selection_sql(session))
    case saved:
      case Fail{error}: IO.pure(Unit,Unit{})
      case Done{value}: do IO<Unit>:
        +messages : String <- IO.pure(String,Tx.trim_nl(value))
        output : Result<&1,&1,U32 & String,String> <- output_sql(db,pre_invocation_sql(messages))
        output_pre(db,session,directory,witness,messages,output)

def stop_output(+db: String, +session: String, +directory: String, +witness: String, saved: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{output}:
      Bool.pick(IO(Unit),String.is_empty(saved),IO.print(Tx.trim_nl(output)),read_input(db,session,directory,witness,saved,Tx.trim_nl(output)))

def stop(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    +directory : String <- InputHook.environment("BATON_ATTEMPT_DIRECTORY")
    +witness : String <- InputHook.witness(db,directory,String.is_empty(directory))
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,InputHook.selection_sql(session))
    case saved:
      case Fail{error}: IO.pure(Unit,Unit{})
      case Done{value}: do IO<Unit>:
        +messages : String <- IO.pure(String,Tx.trim_nl(value))
        output : Result<&1,&1,U32 & String,String> <- output_sql(db,stop_sql(session,messages))
        stop_output(db,session,directory,witness,messages,output)
