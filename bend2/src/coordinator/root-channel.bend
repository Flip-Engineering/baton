# Root channel attachment (#1054). A channel root is a parentless Claude Code
# session that holds the operator role, or a parentless session whose recorded
# endpoint runs mcp-conductor.mjs or mcp-root.mjs. It uses an attached Claude Code
# channel: the conductor's '--session ID --deliver SOCKET' endpoint and the
# socket file that endpoint names beside the database. A channel root with
# owed input is unattached when it has no such endpoint or when no process
# accepts a connect on the socket that endpoint names. A socket file left by a
# conductor that died abruptly refuses the connect. Every check derives this
# from sessions, messages and a connect probe when it runs.
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

def conductor_endpoint_sql() -> String:
  "(CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)=8 AND (json_extract(s.endpoint,'$[1]') LIKE '%/mcp-conductor.mjs' OR json_extract(s.endpoint,'$[1]') LIKE '%/mcp-root.mjs') AND json_extract(s.endpoint,'$[4]')='--session' AND json_extract(s.endpoint,'$[5]')=s.id AND json_extract(s.endpoint,'$[6]')='--deliver' ELSE 0 END)"

def channel_root_sql() -> String:
  "(s.parent IS NULL AND ((" ++ C.assigned_role("s.id") ++ "='operator' AND s.harness='claude-code') OR coalesce(s.endpoint,'') LIKE '%/mcp-conductor.mjs%' OR coalesce(s.endpoint,'') LIKE '%/mcp-root.mjs%'))"

def owed_sql() -> String:
  "(SELECT count(*) FROM messages owed WHERE owed.recipient=s.id AND " ++ C.owed_sql("owed") ++ ")"

# The conductor listens on a socket name relative to the database directory.
def socket_sql() -> String:
  "CASE WHEN substr(json_extract(s.endpoint,'$[7]'),1,1)='/' THEN json_extract(s.endpoint,'$[7]') ELSE rtrim(json_extract(s.endpoint,'$[2]'),replace(json_extract(s.endpoint,'$[2]'),'/','')) || json_extract(s.endpoint,'$[7]') END"

def endpoint_cause_sql() -> String:
  "CASE WHEN coalesce(s.endpoint,'')='' THEN 'no channel endpoint is registered' ELSE 'the registered endpoint is not a conductor channel: ' || replace(replace(s.endpoint,char(9),' '),char(10),' ') END"

# One line per channel root with owed input: ID, owed count, then 'socket' and
# the socket path, or 'endpoint' and the cause.
def row_sql() -> String:
  "s.id || char(9) || " ++ owed_sql() ++ " || char(9) || CASE WHEN " ++ conductor_endpoint_sql() ++ " THEN 'socket' || char(9) || " ++ socket_sql() ++ " ELSE 'endpoint' || char(9) || " ++ endpoint_cause_sql() ++ " END"

def roots_sql(+condition: String) -> String:
  "SELECT coalesce((SELECT group_concat(line,char(10)) FROM (SELECT " ++ row_sql() ++ " AS line FROM sessions s WHERE " ++ channel_root_sql() ++ " AND NOT " ++ C.stopped_session_sql("s.id") ++ " AND " ++ owed_sql() ++ ">0 AND " ++ condition ++ " ORDER BY s.id)),'');"

def error_text(+session: String, +owed: String, +cause: String) -> String:
  "Baton error: root session " ++ session ++ " has " ++ owed ++ " owed inputs and no attached channel: " ++ cause ++ ". Attach a Claude Code channel with bend2/scripts/mcp-conductor.mjs as described in bend2/README.md, section \"Root on another host\"."

def socket_checked(+session: String, +owed: String, +socket: String, probe: Result<&1,&1,U32 & String,Unit>) -> String:
  match probe:
    case Done{connected}: ""
    case Fail{(code,text)}: error_text(session,owed,"no process accepts connections on the conductor socket " ++ socket ++ " (" ++ U32.show(code) ++ ": " ++ text ++ ")")

def row_error(fields: List<String>) -> IO(String):
  match fields:
    case session <> owed <> "socket" <> +socket <> Nil{}: do IO<String>:
      probe : Result<&1,&1,U32 & String,Unit> <- F.Files.listening(socket)
      IO.pure(String,socket_checked(session,owed,socket,probe))
    case session <> owed <> "endpoint" <> cause <> Nil{}: IO.pure(String,error_text(session,owed,cause))
    case other: IO.pure(String,"")

def kept(empty: Bool, text: String, rest: List<String>) -> List<String>:
  match empty:
    case True{}: rest
    case False{}: Con{text,rest}

def errors_from(lines: List<String>) -> IO(List<String>):
  match lines:
    case Nil{}: IO.pure(List<String>,Nil{})
    case head <> tail: do IO<List<String>>:
      +text : String <- row_error(Tx.split_tabs(head))
      rest : List<String> <- errors_from(tail)
      IO.pure(List<String>,kept(String.is_empty(text),text,rest))

def errors_found(found: Result<&1,&1,U32 & String,String>) -> IO(List<String>):
  match found:
    case Done{text}: errors_from(Tx.split_lines(Tx.trim_nl(text)))
    case Fail{(code,text)}: IO.pure(List<String>,Con{"Baton error: the root channel check could not read the database: " ++ U32.show(code) ++ ": " ++ text,Nil{}})

def errors(+db: String, +condition: String) -> IO(List<String>):
  do IO<List<String>>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,roots_sql(condition))
    errors_found(found)

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
