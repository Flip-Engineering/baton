# The Google Antigravity CLI (`agy`) adapter for its stream-json print mode.
#
# `agy` reads one NDJSON `user` event per line on stdin, runs a turn for each,
# and writes `init`, `step_update` and `result` events on stdout:
#   agy --input-format stream-json --output-format stream-json --model M --effort E
# The conversation identity is the `conversation_id` of the `init` event, and
# `--conversation ID` resumes it. Baton writes one frame and closes stdin, so
# each process runs one turn and exits. Credentials come from the account that
# ran `agy` and signed in; this module never places a credential in argv.
import Base
import ../host/process.bend as P
import ../host/sqlite.bend as DB
import ../json/canonical.bend as J
import ../git/text.bend as Tx
import ./dsh-player.bend as Dsh

# --- argv --------------------------------------------------------------------

# The model id carries its effort tier (`claude-sonnet-5-5-high`); Baton records
# that id as the model and the tier word as the effort and passes both.
# `--print-timeout 0` waits for the turn to complete.
def arguments(cmd: String, model: String, effort: String) -> List<String>:
  [cmd,"--input-format","stream-json","--output-format","stream-json","--dangerously-skip-permissions","--print-timeout","0","--model",model,"--effort",effort]

# The retained receive path builds the same argv the direct turn path spawns. A
# recorded conversation continues and an empty one starts fresh.
def argv(cmd: String, model: String, effort: String, session: String, fresh: Bool) -> String:
  match fresh:
    case True{}: P.argv(arguments(cmd,model,effort))
    case False{}: P.argv(List.append(&1,String,arguments(cmd,model,effort),["--conversation",session]))

def start_player(cmd: String, model: String, effort: String, cwd: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(arguments(cmd,model,effort)),cwd,stderr)

def resume_player(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  P.ProcessChild.spawn(P.argv(List.append(&1,String,arguments(cmd,model,effort),["--conversation",session])),cwd,stderr)

# --- input -------------------------------------------------------------------

def user_frame(text: String) -> String:
  "{\"event\":\"user\",\"message\":{\"content\":" ++ J.string_literal(text) ++ "}}\n"

def input(handle: U32, text: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  P.ProcessChild.write(handle,user_frame(text))

# --- event stream ------------------------------------------------------------

# Every stdout line is one object with `event` first: init, step_update, result.
def kind(+line: String) -> String:
  Bool.pick(String,Tx.starts_with(line,"{\"event\":\"init\""),"init",
  Bool.pick(String,Tx.starts_with(line,"{\"event\":\"step_update\""),"step_update",
  Bool.pick(String,Tx.starts_with(line,"{\"event\":\"result\""),"result","")))

# Baton reads identity and terminal state from a frame. `init` becomes the
# session frame that carries the conversation identity. `result` becomes the
# terminal frame: any status other than SUCCESS is an error whose text is the
# provider's `error`, or the status name when `error` is absent. Step frames
# stay as received, and the public log keeps every raw line.
def event_sql(line: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ Dsh.sql_quote(line) ++ ")) SELECT CASE WHEN NOT json_valid(value) THEN '' ELSE CASE json_extract(value,'$.event') "
  ++ "WHEN 'init' THEN json_object('type','session','id',json_extract(value,'$.conversation_id'),'cwd',json_extract(value,'$.init.cwd')) "
  ++ "WHEN 'result' THEN json_object('type','result','is_error',CASE WHEN json_extract(value,'$.result.status')='SUCCESS' THEN 0 ELSE 1 END,"
  ++ "'result',CASE WHEN json_extract(value,'$.result.status')='SUCCESS' THEN coalesce(json_extract(value,'$.result.response'),'') ELSE coalesce(nullif(json_extract(value,'$.result.error'),''),json_extract(value,'$.result.status'),'agy error') END) "
  ++ "ELSE value END END FROM frame;"

def event_trimmed(line: String, value: String) -> String:
  match value:
    case "": line
    case other: other

def event_value(line: String, found: Result<&1,&1,U32 & String,String>) -> String:
  match found:
    case Fail{error}: line
    case Done{value}: event_trimmed(line,Tx.trim_nl(value))

def event(+db: String, +line: String) -> IO(String):
  do IO<String>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,event_sql(line))
    IO.pure(String,event_value(line,found))

# Session identity and terminal state are the only frames Baton parses for its
# own state.
def admitted(+kind: String) -> Bool:
  Bool.or(String.eq(kind,"init"),String.eq(kind,"result"))

# The provider usage of a turn rides its `result` frame. observed-usage reads
# this object from the public log.
def usage_sql(line: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ Dsh.sql_quote(line) ++ ")) SELECT CASE WHEN json_valid(value) AND json_extract(value,'$.event')='result' THEN coalesce(json_extract(value,'$.result.usage'),'') ELSE '' END FROM frame;"

def usage_value(found: Result<&1,&1,U32 & String,String>) -> String:
  match found:
    case Fail{error}: ""
    case Done{value}: Tx.trim_nl(value)

def usage(db: String, line: String) -> IO(String):
  do IO<String>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,usage_sql(line))
    IO.pure(String,usage_value(found))
