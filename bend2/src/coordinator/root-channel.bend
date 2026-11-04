# Root attachment (#1054, #1217). A root is a parentless session that holds the
# operator role, whatever its harness, or a parentless session whose recorded
# endpoint runs mcp-conductor.mjs or mcp-root.mjs. A root with owed input is
# unattached when nothing can deliver to its running conversation:
#
# - A Claude Code root, or a root with a conductor endpoint, needs the
#   conductor's '--session ID --deliver SOCKET' endpoint and a process that
#   accepts a connect on the socket that endpoint names. A socket file left by a
#   conductor that died abruptly refuses the connect.
# - A Codex root needs a native conversation and a recorded managed receiver.
#   The check runs 'codex app-server proxy' with the endpoint's recorded
#   environment and a closed standard input; the proxy exits 0 after it
#   connects to the control socket and a nonzero status when it cannot. An
#   empty endpoint cannot establish a route to a conversation on another host.
# - A root of any other harness needs a recorded endpoint.
#
# Every check derives this from sessions, messages and a connect when it runs.
#
# status, session and orchestra print one error line per unattached root on
# stderr. A committed message, report or question to an unattached root prints
# the same line to its sender and appends it to the database's .root.log.
import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/files.bend as F
import ../host/text.bend as Text
import ../git/text.bend as Tx
import ../git/process.bend as Process
import ../git/types.bend as T
import ./codex-route.bend as CodexRoute

def conductor_endpoint_sql() -> String:
  "(CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)=8 AND (json_extract(s.endpoint,'$[1]') LIKE '%/mcp-conductor.mjs' OR json_extract(s.endpoint,'$[1]') LIKE '%/mcp-root.mjs') AND json_extract(s.endpoint,'$[4]')='--session' AND json_extract(s.endpoint,'$[5]')=s.id AND json_extract(s.endpoint,'$[6]')='--deliver' ELSE 0 END)"

def channel_root_sql() -> String:
  "(s.parent IS NULL AND (" ++ C.assigned_role("s.id") ++ "='operator' OR coalesce(s.endpoint,'') LIKE '%/mcp-conductor.mjs%' OR coalesce(s.endpoint,'') LIKE '%/mcp-root.mjs%'))"

# The conductor endpoints that name a Claude Code channel, valid or not.
def channel_endpoint_sql() -> String:
  "(coalesce(s.endpoint,'') LIKE '%/mcp-conductor.mjs%' OR coalesce(s.endpoint,'') LIKE '%/mcp-root.mjs%')"

# A recorded argv array with an executable.
def argv_endpoint_sql() -> String:
  "(CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 ELSE 0 END)"

# A Codex session reaches its thread through the managed inbox when it records a
# native conversation and either no endpoint or a managed Codex endpoint.
def codex_managed_sql() -> String:
  "(s.harness='codex' AND s.native<>'' AND CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 AND " ++ CodexRoute.managed_sql("s.endpoint","s.id","s.native") ++ " ELSE 0 END)"

def owed_sql() -> String:
  "(SELECT count(*) FROM messages owed WHERE owed.recipient=s.id AND " ++ C.owed_sql("owed") ++ ")"

# The conductor listens on a socket name relative to the database directory.
def socket_sql() -> String:
  "CASE WHEN substr(json_extract(s.endpoint,'$[7]'),1,1)='/' THEN json_extract(s.endpoint,'$[7]') ELSE rtrim(json_extract(s.endpoint,'$[2]'),replace(json_extract(s.endpoint,'$[2]'),'/','')) || json_extract(s.endpoint,'$[7]') END"

def endpoint_cause_sql() -> String:
  "CASE WHEN coalesce(s.endpoint,'')='' THEN 'no channel endpoint is registered' ELSE 'the registered endpoint is not a conductor channel: ' || replace(replace(s.endpoint,char(9),' '),char(10),' ') END"

# The repair text names the attachment that suits the root's harness.
def remedy_sql() -> String:
  "CASE WHEN " ++ conductor_endpoint_sql() ++ " AND s.harness='codex' THEN 'codex' WHEN " ++ conductor_endpoint_sql() ++ " OR " ++ channel_endpoint_sql() ++ " OR s.harness='claude-code' THEN 'claude' WHEN s.harness='codex' THEN 'codex' ELSE 'other' END"

# What the check does for the root: 'socket' connects to the conductor socket,
# 'codex' connects to the Codex app-server, 'endpoint' reports the cause, and
# 'endpoint' reports a missing or unsupported route. Only recognized root
# notification routes pass this check.
def kind_sql() -> String:
  "CASE WHEN " ++ conductor_endpoint_sql() ++ " THEN 'socket' || char(9) || " ++ socket_sql()
  ++ " WHEN " ++ channel_endpoint_sql() ++ " OR s.harness='claude-code' THEN 'endpoint' || char(9) || " ++ endpoint_cause_sql()
  ++ " WHEN " ++ codex_managed_sql() ++ " THEN 'codex' || char(9) || s.native"
  ++ " WHEN s.harness='codex' AND (s.native='' OR coalesce(s.endpoint,'')='' OR s.endpoint='[]') THEN 'endpoint' || char(9) || 'no native conversation or channel endpoint is registered'"
  ++ " WHEN " ++ argv_endpoint_sql() ++ " THEN 'endpoint' || char(9) || 'the recorded argv endpoint is not a supported root notification channel: ' || replace(replace(s.endpoint,char(9),' '),char(10),' ')"
  ++ " ELSE 'endpoint' || char(9) || CASE WHEN coalesce(s.endpoint,'')='' THEN 'no channel endpoint is registered' ELSE 'the registered endpoint is not an argv array: ' || replace(replace(s.endpoint,char(9),' '),char(10),' ') END END"

# One line per root with owed input: ID, owed count, repair, kind, argument, harness.
def row_sql() -> String:
  "s.id || char(9) || " ++ owed_sql() ++ " || char(9) || " ++ remedy_sql() ++ " || char(9) || " ++ kind_sql() ++ " || char(9) || s.harness"

def roots_sql(+condition: String) -> String:
  "SELECT coalesce((SELECT group_concat(line,char(10)) FROM (SELECT " ++ row_sql() ++ " AS line FROM sessions s WHERE " ++ channel_root_sql() ++ " AND NOT " ++ C.stopped_session_sql("s.id") ++ " AND " ++ owed_sql() ++ ">0 AND " ++ condition ++ " ORDER BY s.id)),'');"

def remedy_text(remedy: String, harness: String) -> String:
  match remedy:
    case "claude": "Attach a Claude Code channel with bend2/scripts/mcp-conductor.mjs as described in bend2/README.md, section \"Root on another host\"."
    case "codex": "Attach a Codex root relay through the managed app-server that owns its conversation."
    case other: "The recorded endpoint does not provide a supported root notification route for harness '" ++ harness ++ "'."

def error_text(+session: String, +owed: String, +cause: String, +remedy: String, +harness: String) -> String:
  "Baton error: root session " ++ session ++ " has " ++ owed ++ " owed inputs and no attached channel: " ++ cause ++ ". " ++ remedy_text(remedy,harness)

def socket_checked(+session: String, +owed: String, +socket: String, +remedy: String, +harness: String, probe: Result<&1,&1,U32 & String,Unit>) -> String:
  match probe:
    case Done{connected}: ""
    case Fail{(code,text)}: error_text(session,owed,"no process accepts connections on the conductor socket " ++ socket ++ " (" ++ U32.show(code) ++ ": " ++ text ++ ")",remedy,harness)

def codex_checked(+session: String, +owed: String, +remedy: String, +harness: String, run: T.RunRes) -> String:
  match run:
    case T.RRun{T.SExit{0},output}: ""
    case T.RRun{T.SExit{+code},+output}: error_text(session,owed,"the Codex app-server is not reachable through the recorded route (exit " ++ U32.show(code) ++ "): " ++ Tx.trim_nl(output),remedy,harness)
    case T.RRun{T.SSignal{+signal},+output}: error_text(session,owed,"the Codex app-server route ended on signal " ++ U32.show(signal) ++ ": " ++ Tx.trim_nl(output),remedy,harness)
    case T.RSpawn{+detail}: error_text(session,owed,"the Codex app-server route could not start: " ++ detail,remedy,harness)

# The proxy connects to the control socket under the recorded CODEX_HOME and
# exits when its standard input ends.
def codex_probe_argv(+endpoint: String) -> IO(List<String>):
  CodexRoute.arguments(Bool.pick(String,String.is_empty(endpoint),"[]",endpoint),["/bin/sh","-c","exec codex app-server proxy </dev/null 2>&1"])

def codex_row_error(+db: String, +session: String, +owed: String, +remedy: String, +harness: String) -> IO(String):
  do IO<String>:
    +recorded : String <- IO.try(String,DB.Sql.read(db,"SELECT endpoint FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    args : List<String> <- codex_probe_argv(Tx.trim_nl(recorded))
    run : T.RunRes <- Process.runFull(args,".")
    IO.pure(String,codex_checked(session,owed,remedy,harness,run))

def row_error(+db: String, fields: List<String>) -> IO(String):
  match fields:
    case session <> owed <> remedy <> "socket" <> +socket <> harness <> Nil{}: do IO<String>:
      probe : Result<&1,&1,U32 & String,Unit> <- F.Files.listening(socket)
      IO.pure(String,socket_checked(session,owed,socket,remedy,harness,probe))
    case session <> owed <> remedy <> "codex" <> native <> harness <> Nil{}: codex_row_error(db,session,owed,remedy,harness)
    case session <> owed <> remedy <> "endpoint" <> cause <> harness <> Nil{}: IO.pure(String,error_text(session,owed,cause,remedy,harness))
    case other: IO.pure(String,"")

def kept(empty: Bool, text: String, rest: List<String>) -> List<String>:
  match empty:
    case True{}: rest
    case False{}: Con{text,rest}

def errors_from(+db: String, lines: List<String>) -> IO(List<String>):
  match lines:
    case Nil{}: IO.pure(List<String>,Nil{})
    case head <> tail: do IO<List<String>>:
      +text : String <- row_error(db,Tx.split_tabs(head))
      rest : List<String> <- errors_from(db,tail)
      IO.pure(List<String>,kept(String.is_empty(text),text,rest))

def errors_found(+db: String, found: Result<&1,&1,U32 & String,String>) -> IO(List<String>):
  match found:
    case Done{text}: errors_from(db,Tx.split_lines(Tx.trim_nl(text)))
    case Fail{(code,text)}: IO.pure(List<String>,Con{"Baton error: the root channel check could not read the database: " ++ U32.show(code) ++ ": " ++ text,Nil{}})

def errors(+db: String, +condition: String) -> IO(List<String>):
  do IO<List<String>>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,roots_sql(condition))
    errors_found(db,found)

def printed(lines: List<String>) -> IO(Unit):
  match lines:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> tail: do IO<Unit>:
      shown : Unit <- IO.print_err(head)
      printed(tail)

def log_written(+log: String, written: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match written:
    case Done{unit}: IO.pure(Unit,Unit{})
    case Fail{(code,text)}: IO.print_err("Baton error: the delivery log " ++ log ++ " could not be written: " ++ U32.show(code) ++ ": " ++ text)

# Each line goes to stderr and to the delivery log.
def reported(+log: String, lines: List<String>) -> IO(Unit):
  match lines:
    case Nil{}: IO.pure(Unit,Unit{})
    case +head <> tail: do IO<Unit>:
      shown : Unit <- IO.print_err(head)
      written : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(log,head ++ "\n")
      checked : Unit <- log_written(log,written)
      reported(log,tail)

# status, session and orchestra.
def warn(+db: String) -> IO(Unit):
  do IO<Unit>:
    found : List<String> <- errors(db,"1")
    printed(found)

# A committed message: only the root it was addressed to, while it is owed.
def warn_message(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    found : List<String> <- errors(db,"EXISTS(SELECT 1 FROM messages admitted WHERE admitted.id=" ++ C.q(id) ++ " AND admitted.recipient=s.id AND " ++ C.owed_sql("admitted") ++ ")")
    reported(db ++ ".root.log",found)
