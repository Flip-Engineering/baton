# Claude Code invokes this entry at Stop and PostToolUse tool boundaries.
# The retained launch supplies the seat and database in the environment.
import Base
import ../coordinator/commands.bend as C
import ./native-input.bend as NativeInput
import ./message-status.bend as Status
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ./input-hook.bend as InputHook

def owed_sql() -> String:
  "(SELECT count(*) FROM json_each((SELECT value FROM owed)))"

def owed_lines_sql() -> String:
  "(SELECT group_concat(line,char(10)) FROM (SELECT " ++ Status.complete_message_sql("json_extract(j.value,'$.id')","json_extract(j.value,'$.kind')","json_extract(j.value,'$.sender')","json_extract(j.value,'$.body')") ++ " || char(10) || 'The complete input is available in this turn.' AS line FROM json_each((SELECT value FROM owed)) j ORDER BY CAST(j.key AS INTEGER)))"

# The hook's answer as a statement over an owed(value) CTE: a JSON block
# decision, or empty to let the turn end.
def decision_body_sql(+session: String) -> String:
  "SELECT CASE WHEN " ++ owed_sql() ++ ">0 THEN json_object('decision','block','reason','Baton holds ' || " ++ owed_sql() ++ " || ' unread inputs for ' || " ++ C.q(session) ++ " || '. Read the complete bodies and continue the work. When the assignment is ready, run completion-request --text SUMMARY:' || char(10) || " ++ owed_lines_sql() ++ ")"
  ++ " WHEN " ++ C.task_open_sql(C.q(session)) ++ " AND " ++ C.task_request_sql(C.q(session)) ++ " IS NULL THEN json_object('decision','block','reason','Assignment ' || (SELECT id FROM messages WHERE seq=" ++ C.task_assignment_sql(C.q(session)) ++ ") || ' is still open and you have sent no completion request. When the work is ready, run completion-request --text SUMMARY; otherwise continue the work.')"
  ++ " ELSE '' END;"

def decision_sql(+session: String) -> String:
  "WITH owed(value) AS (" ++ InputHook.selection_sql(session) ++ ") " ++ decision_body_sql(session)

# The decision over the owed input already selected for this hook call.
def decision_for_sql(+session: String, +saved: String) -> String:
  "WITH owed(value) AS (SELECT " ++ C.q(saved) ++ ") " ++ decision_body_sql(session)

def input_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{text}: text
    case Fail{error}: ""

def environment(name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    IO.pure(String,input_text(result))

# Input shown in a block decision is delivered to the conversation, so its
# reads are recorded against the running attempt like PostToolUse reads. A
# database failure lets the turn end; the turn-end continuation and the
# coordinator's turn report still cover owed input.
def stopped(+db: String, +session: String, +directory: String, witness: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+saved}: do IO<Unit>:
      output : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,decision_for_sql(session,Tx.trim_nl(saved)))
      InputHook.delivered(db,session,directory,witness,Tx.trim_nl(saved),output)

def route(+db: String, +session: String, tool: Bool) -> IO(Unit):
  match tool:
    case True{}: InputHook.run(db,session)
    case False{}: do IO<Unit>:
      +directory : String <- InputHook.environment("BATON_ATTEMPT_DIRECTORY")
      +bound : String <- InputHook.witness(db,directory,String.is_empty(directory))
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,InputHook.selection_sql(session))
      stopped(db,session,directory,bound,result)

def decided(+db: String, +session: String, +input: String, unknown: Bool) -> IO(Unit):
  match unknown:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      event : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT CASE WHEN json_valid(" ++ C.q(input) ++ ") THEN json_extract(" ++ C.q(input) ++ ",'$.hook_event_name') ELSE '' END;")
      route(db,session,String.eq(Tx.trim_nl(input_text(event)),"PostToolUse"))

def run() -> IO(Unit):
  do IO<Unit>:
    +session : String <- environment("BATON_SESSION")
    +db : String <- environment("BATON_DATABASE")
    read : Result<&1,&1,U32 & String,String> <- NativeInput.text_value("-")
    decided(db,session,input_text(read),Bool.or(String.is_empty(session),String.is_empty(db)))
