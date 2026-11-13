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
# stderr. Committed root input records channel diagnostics in .root.log and
# returns the committed message with a separate noticeDelivery result.
import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/files.bend as F
import ../host/text.bend as Text
import ../git/text.bend as Tx
import ../git/process.bend as Process
import ../git/types.bend as T
import ./codex-route.bend as CodexRoute

type ChannelIssue is Data:
  Issue{reason: String, diagnostic: String}

def issue_reason(issue: ChannelIssue) -> String:
  match issue:
    case Issue{reason,diagnostic}: reason

def issue_diagnostic(issue: ChannelIssue) -> String:
  match issue:
    case Issue{reason,diagnostic}: diagnostic

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

def error_text(+session: String, +owed: String, +cause: String, +remedy: String, +harness: String) -> ChannelIssue:
  Issue{cause,"Baton error: root session " ++ session ++ " has " ++ owed ++ " owed inputs and no attached channel: " ++ cause ++ ". " ++ remedy_text(remedy,harness)}

def socket_checked(+session: String, +owed: String, +socket: String, +remedy: String, +harness: String, probe: Result<&1,&1,U32 & String,Unit>) -> ChannelIssue:
  match probe:
    case Done{connected}: Issue{"",""}
    case Fail{(code,text)}: error_text(session,owed,"no process accepts connections on the conductor socket " ++ socket ++ " (" ++ U32.show(code) ++ ": " ++ text ++ ")",remedy,harness)

def codex_checked(+session: String, +owed: String, +remedy: String, +harness: String, run: T.RunRes) -> ChannelIssue:
  match run:
    case T.RRun{T.SExit{0},output}: Issue{"",""}
    case T.RRun{T.SExit{+code},+output}: error_text(session,owed,"the Codex app-server is not reachable through the recorded route (exit " ++ U32.show(code) ++ "): " ++ Tx.trim_nl(output),remedy,harness)
    case T.RRun{T.SSignal{+signal},+output}: error_text(session,owed,"the Codex app-server route ended on signal " ++ U32.show(signal) ++ ": " ++ Tx.trim_nl(output),remedy,harness)
    case T.RSpawn{+detail}: error_text(session,owed,"the Codex app-server route could not start: " ++ detail,remedy,harness)

# The proxy connects to the control socket under the recorded CODEX_HOME and
# exits when its standard input ends.
def codex_probe_argv(+endpoint: String) -> IO(List<String>):
  CodexRoute.arguments(Bool.pick(String,String.is_empty(endpoint),"[]",endpoint),["/bin/sh","-c","exec codex app-server proxy </dev/null 2>&1"])

def codex_row_error(+db: String, +session: String, +owed: String, +remedy: String, +harness: String) -> IO(ChannelIssue):
  do IO<ChannelIssue>:
    +recorded : String <- IO.try(String,DB.Sql.read(db,"SELECT endpoint FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    args : List<String> <- codex_probe_argv(Tx.trim_nl(recorded))
    run : T.RunRes <- Process.runFull(args,".")
    IO.pure(ChannelIssue,codex_checked(session,owed,remedy,harness,run))

def row_error(+db: String, fields: List<String>) -> IO(ChannelIssue):
  match fields:
    case session <> owed <> remedy <> "socket" <> +socket <> harness <> Nil{}: do IO<ChannelIssue>:
      probe : Result<&1,&1,U32 & String,Unit> <- F.Files.listening(socket)
      IO.pure(ChannelIssue,socket_checked(session,owed,socket,remedy,harness,probe))
    case session <> owed <> remedy <> "codex" <> native <> harness <> Nil{}: codex_row_error(db,session,owed,remedy,harness)
    case session <> owed <> remedy <> "endpoint" <> cause <> harness <> Nil{}: IO.pure(ChannelIssue,error_text(session,owed,cause,remedy,harness))
    case other: IO.pure(ChannelIssue,Issue{"",""})

def kept(empty: Bool, text: ChannelIssue, rest: List<ChannelIssue>) -> List<ChannelIssue>:
  match empty:
    case True{}: rest
    case False{}: Con{text,rest}

def errors_from(+db: String, lines: List<String>) -> IO(List<ChannelIssue>):
  match lines:
    case Nil{}: IO.pure(List<ChannelIssue>,Nil{})
    case head <> tail: do IO<List<ChannelIssue>>:
      +text : ChannelIssue <- row_error(db,Tx.split_tabs(head))
      rest : List<ChannelIssue> <- errors_from(db,tail)
      IO.pure(List<ChannelIssue>,kept(String.is_empty(issue_reason(text)),text,rest))

def errors_found(+db: String, found: Result<&1,&1,U32 & String,String>) -> IO(List<ChannelIssue>):
  match found:
    case Done{text}: errors_from(db,Tx.split_lines(Tx.trim_nl(text)))
    case Fail{(code,+text)}: IO.pure(List<ChannelIssue>,Con{Issue{text,"Baton error: the root channel check could not read the database: " ++ U32.show(code) ++ ": " ++ text},Nil{}})

def errors(+db: String, +condition: String) -> IO(List<ChannelIssue>):
  do IO<List<ChannelIssue>>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,roots_sql(condition))
    errors_found(db,found)

def printed(lines: List<ChannelIssue>) -> IO(Unit):
  match lines:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> tail: do IO<Unit>:
      shown : Unit <- IO.print_err(issue_diagnostic(head))
      printed(tail)

def log_written(+log: String, written: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match written:
    case Done{unit}: IO.pure(Unit,Unit{})
    case Fail{(code,text)}: IO.print_err("Baton error: the delivery log " ++ log ++ " could not be written: " ++ U32.show(code) ++ ": " ++ text)

# Each line goes to the delivery log.
def reported(+log: String, lines: List<ChannelIssue>) -> IO(Unit):
  match lines:
    case Nil{}: IO.pure(Unit,Unit{})
    case +head <> tail: do IO<Unit>:
      written : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(log,issue_diagnostic(head) ++ "\n")
      checked : Unit <- log_written(log,written)
      reported(log,tail)

# status, session and orchestra.
def warn(+db: String) -> IO(Unit):
  do IO<Unit>:
    found : List<ChannelIssue> <- errors(db,"1")
    printed(found)

# A committed message: only the root it was addressed to, while it is owed.
def warn_message(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    found : List<ChannelIssue> <- errors(db,"EXISTS(SELECT 1 FROM messages admitted WHERE admitted.id=" ++ C.q(id) ++ " AND admitted.recipient=s.id AND " ++ C.owed_sql("admitted") ++ ")")
    reported(db ++ ".root.log",found)

# A committed message identifies its root from the current recorded recipient.
def message_root_sql(+id: String, +condition: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND " ++ channel_root_sql() ++ " AND NOT " ++ C.stopped_session_sql("s.id") ++ " AND " ++ condition ++ ");"

def message_condition(+id: String) -> String:
  "EXISTS(SELECT 1 FROM messages admitted WHERE admitted.id=" ++ C.q(id) ++ " AND admitted.recipient=s.id AND " ++ C.owed_sql("admitted") ++ ")"

def message_root(+db: String, id: String, condition: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- IO.try(String,DB.Sql.query(db,message_root_sql(id,condition)))
    IO.pure(Bool,String.eq(found,"1\n"))

def notice_text() -> String:
  "The message is committed. The root reads it from its inbox."

def pending_notice_text() -> String:
  "The finding is committed. Its notice remains in the recipient's inbox."

def notice_sql(status: String, code: U32, cause: String, detail: String) -> String:
  "json_object('status'," ++ C.q(status) ++ ",'code'," ++ U32.show(code) ++ ",'detail'," ++ C.q(detail) ++ ",'cause'," ++ C.q(cause) ++ ")"

# Message, report, question, observation, continuation and finding answers are
# objects. Internal wakes pass an empty answer; other values keep their bytes.
def answer_selected(db: String, saved: String, status: String, code: U32, cause: String, detail: String, object: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match object:
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})
    case True{}: DB.Sql.read(db,"SELECT json_set(" ++ C.q(saved) ++ ",'$.committed',json('true'),'$.noticeDelivery'," ++ notice_sql(status,code,cause,detail) ++ ");")

def answer(+db: String, +saved: String, status: String, code: U32, cause: String, detail: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    object : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(saved) ++ ") THEN json_type(" ++ C.q(saved) ++ ")='object' ELSE 0 END;"))
    answer_selected(db,saved,status,code,cause,detail,String.eq(object,"1\n"))

def notice_result(+db: String, saved: String, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Done{output}: answer(db,saved,"notified",0,"",notice_text())
    case Fail{(code,cause)}: answer(db,saved,"undelivered",code,cause,notice_text())

def checked_notice(+db: String, +saved: String, found: List<ChannelIssue>, next: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Result<&1,&1,U32 & String,String>):
  match found:
    case Nil{}: do IO<Result<&1,&1,U32 & String,String>>:
      result : Result<&1,&1,U32 & String,String> <- next(Unit{})
      notice_result(db,saved,result)
    case +head <> tail: do IO<Result<&1,&1,U32 & String,String>>:
      logged : Unit <- reported(db ++ ".root.log",head <> tail)
      answer(db,saved,"undelivered",1,issue_reason(head),notice_text())

def selected_notice(+db: String, id: String, saved: String, root: Bool, next: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Result<&1,&1,U32 & String,String>):
  match root:
    case False{}: next(Unit{})
    case True{}: do IO<Result<&1,&1,U32 & String,String>>:
      found : List<ChannelIssue> <- errors(db,message_condition(id))
      checked_notice(db,saved,found,next)

def notice(+db: String, +id: String, condition: String, saved: String, next: Unit -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    root : Bool <- message_root(db,id,condition)
    selected_notice(db,id,saved,root,next)

# The root endpoint writes stderr into its retained delivery output. Conductor
# socket names are relative to the database directory.
def endpoint_run(+db: String, argv: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    directory : String <- IO.try(String,DB.Sql.read(db,"SELECT rtrim(" ++ C.q(db) ++ ",replace(" ++ C.q(db) ++ ",'/',''));"))
    +cwd : String = Tx.trim_nl(directory)
    Process.Process.run(Tx.enc_argv(["/bin/sh","-c","exec \"$@\" 2>&1","baton-root-notice"]) ++ argv,Bool.pick(String,String.is_empty(cwd),".",cwd))

def run_result(saved: String, run: T.RunRes) -> Result<&1,&1,U32 & String,String>:
  match run:
    case T.RRun{T.SExit{0},output}: Done{saved}
    case T.RRun{T.SExit{code},output}: Fail{(code,Tx.trim_nl(output))}
    case T.RRun{T.SSignal{signal},output}: Fail{(1,"The root notification process ended on signal " ++ U32.show(signal) ++ ": " ++ Tx.trim_nl(output))}
    case T.RSpawn{detail}: Fail{(1,detail)}

def run_logged(saved: String, run: T.RunRes, written: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,String>:
  match written:
    case Done{unit}: run_result(saved,run)
    case Fail{(code,cause)}: Fail{(code,"The root notification log could not be written: " ++ cause)}

def completed(+db: String, saved: String, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{(code,+cause)}: do IO<Result<&1,&1,U32 & String,String>>:
      written : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(db ++ ".root.log",cause ++ "\n")
      IO.pure(Result<&1,&1,U32 & String,String>,run_logged(saved,T.RSpawn{cause},written))
    case Done{+output}: do IO<Result<&1,&1,U32 & String,String>>:
      written : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(db ++ ".root.log",output ++ "\n")
      IO.pure(Result<&1,&1,U32 & String,String>,run_logged(saved,Tx.run_res(Done{output}),written))
