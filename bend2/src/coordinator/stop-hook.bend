# The Claude Code Stop hook of a Baton seat (#1054, instance B1). Claude Code
# runs `baton --stop-hook` when its agent ends a turn and passes the hook input
# as JSON on standard input; the retained launch records the seat in
# BATON_SESSION and the database in BATON_DATABASE.
#
# Input that arrives while a Claude Code turn runs had reached the agent only
# when it read its inbox: the turn's stdin closes after the first frame. The
# hook now hands owed input to the same turn, and tells an agent whose
# assignment is open with no completion request to request completion or
# continue. Claude Code reports stop_hook_active when an earlier block already
# continued this turn; the stop is then allowed, so the hook cannot keep a
# turn alive that has nothing more to do. Owed input left at that point starts
# the next turn through the ordinary turn-end continuation.
import Base
import ../coordinator/commands.bend as C
import ./native-input.bend as NativeInput
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

def owed_sql(+session: String) -> String:
  "(SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ")"

def owed_lines_sql(+session: String) -> String:
  "(SELECT group_concat(line,char(10)) FROM (SELECT 'Message (' || kind || ') from ' || sender || ' [id: ' || id || '] retained ' || CAST(length(CAST(body AS BLOB)) AS TEXT) || ' bytes; read the complete body with baton read ' || id || '.' AS line FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " ORDER BY seq))"

# The hook's answer: a JSON block decision, or empty to let the turn end.
def decision_sql(+session: String, +input: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(input) ++ ") AND coalesce(json_extract(" ++ C.q(input) ++ ",'$.stop_hook_active'),0) THEN ''"
  ++ " WHEN " ++ owed_sql(session) ++ ">0 THEN json_object('decision','block','reason','Baton holds ' || " ++ owed_sql(session) ++ " || ' owed inputs for ' || " ++ C.q(session) ++ " || '. Read and handle them before ending the turn:' || char(10) || " ++ owed_lines_sql(session) ++ ")"
  ++ " WHEN " ++ C.task_open_sql(C.q(session)) ++ " AND " ++ C.task_request_sql(C.q(session)) ++ " IS NULL THEN json_object('decision','block','reason','Assignment ' || (SELECT id FROM messages WHERE seq=" ++ C.task_assignment_sql(C.q(session)) ++ ") || ' is still open and you have sent no completion request. When the work is ready, run completion-request --text SUMMARY; otherwise continue the work.')"
  ++ " ELSE '' END;"

def input_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{text}: text
    case Fail{error}: ""

def environment(name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    IO.pure(String,input_text(result))

# A database failure lets the turn end; the turn-end continuation and the
# coordinator's turn report still cover owed input.
def answered(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{+text}: Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(text)),IO.pure(Unit,Unit{}),IO.print(Tx.trim_nl(text)))
    case Fail{error}: IO.pure(Unit,Unit{})

def decided(+db: String, +session: String, +input: String, unknown: Bool) -> IO(Unit):
  match unknown:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,decision_sql(session,input))
      answered(result)

def run() -> IO(Unit):
  do IO<Unit>:
    +session : String <- environment("BATON_SESSION")
    +db : String <- environment("BATON_DATABASE")
    read : Result<&1,&1,U32 & String,String> <- NativeInput.text_value("-")
    decided(db,session,input_text(read),Bool.or(String.is_empty(session),String.is_empty(db)))
