import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/process.bend as P
import ../host/text.bend as Text
import ../host/files.bend as F
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ../harness/omp-player.bend as Omp
import ../git/text.bend as Tx
import ../json/canonical.bend as J

# Registration admits a harness command by what it does, not by its path. The
# command runs with the same OMP rpc argv the receiver records, and the first
# stdout line must be a JSON object with type "ready". The probe sends no
# prompt and writes no coordination row, so a refused command leaves the
# recorded endpoint, workspace, model and native identity untouched.
#
# The session directory the probe passes is a fresh token-named directory next
# to the coordination database, never the recorded store. Observed real-harness
# rpc startup prints the ready frame as the first stdout line, creates no
# session files before a request frame arrives, keeps its own state under
# HOME/.omp, and exits cleanly when stdin ends. The outcome alone decides
# admission: the readiness read ends when the child prints its first line or
# closes its output, and the only cleanup is the probe's own child and the
# probe's own token-named files.
type Probe is Data:
  Probed{}
  Refused{condition: String, stdout: String, stderr: String}

def probe_cwd(+workspace: String) -> String:
  Bool.pick(String,String.is_empty(workspace),".",workspace)

# The recorded harness command with the receiver's own non-session OMP argv: no
# resume identity and no prompt, so the child cannot start an agent task.
def probe_argv(+cmd: String, +model: String, +effort: String, +sessions: String) -> String:
  P.argv(Omp.arguments(cmd,model,effort,sessions))

# One read-only query validates the frame: a JSON object carrying the exact
# top-level member "type":"ready". The line is text, so it is quoted and never
# becomes a statement of its own.
def ready_frame_sql(+line: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(line) ++ ")) SELECT CASE WHEN json_valid(value) THEN coalesce(CASE WHEN json_extract(value,'$.type')='ready' THEN 1 ELSE 0 END,0) ELSE 0 END FROM frame;"

def ready_frame_checked(value: Result<&1,&1,U32 & String,String>) -> Bool:
  match value:
    case Fail{error}: False{}
    case Done{text}: String.eq(Tx.trim_nl(text),"1")

def ready_frame(+db: String, +line: String) -> IO(Bool):
  do IO<Bool>:
    value : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,ready_frame_sql(line))
    IO.pure(Bool,ready_frame_checked(value))

def probe_token(+db: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.read(db,"SELECT lower(hex(randomblob(8)));"))
    IO.pure(String,Tx.trim_nl(value))

# The probe's own scratch state: a stderr file and a fresh session directory,
# both named by one token. The child's stderr goes to a file of its own so it
# cannot block on a pipe, and the file is read once and removed on every path
# before the answer is used.
def probe_stderr_path(+db: String, +token: String) -> String:
  db ++ ".receiver-probe-" ++ token ++ ".stderr"

def probe_sessions_path(+db: String, +token: String) -> String:
  db ++ ".receiver-probe-" ++ token ++ ".sessions"

def probe_diagnostics(read: Result<&1,&1,U32 & String,String>) -> IO(String):
  match read:
    case Fail{error}: IO.pure(String,"")
    case Done{text}: IO.pure(String,text)

def probe_captured(+path: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
    removed : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(path)
    probe_diagnostics(read)

# Every outcome stops the probe's own child before the answer is used: stdin
# ends first because the real harness exits cleanly on it, then the terminate
# signal covers a child that ignores its input, and the wait reaps it. This
# stop runs once per probe after the protocol outcome is already known; it
# guards process ownership, not the admission decision.
def probe_stopped(+handle: U32) -> IO(Unit):
  do IO<Unit>:
    closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
    sent : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.signal(handle,15)
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    IO.pure(Unit,Unit{})

def probe_frame_result(+path: String, +handle: U32, +first: String, ready: Bool) -> IO(Probe):
  match ready:
    case True{}: do IO<Probe>:
      stopped : Unit <- probe_stopped(handle)
      removed : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(path)
      IO.pure(Probe,Probed{})
    case False{}: do IO<Probe>:
      stopped : Unit <- probe_stopped(handle)
      captured : String <- probe_captured(path)
      IO.pure(Probe,Refused{"The harness command printed a first line that is not a JSON object with type \"ready\".",first,captured})

def probe_frame(+db: String, +path: String, +handle: U32, +first: String) -> IO(Probe):
  do IO<Probe>:
    ready : Bool <- ready_frame(db,first)
    probe_frame_result(path,handle,first,ready)

def probe_closed(+db: String, +path: String, +handle: U32, line: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Probe):
  match line:
    case Fail{(code,detail)}: do IO<Probe>:
      stopped : Unit <- probe_stopped(handle)
      captured : String <- probe_captured(path)
      IO.pure(Probe,Refused{"The harness command's first output line could not be read: " ++ detail ++ ".","",captured})
    case Done{None{}}: do IO<Probe>:
      stopped : Unit <- probe_stopped(handle)
      captured : String <- probe_captured(path)
      IO.pure(Probe,Refused{"The harness command exited without printing a ready frame.","",captured})
    case Done{Some{+text}}: probe_frame(db,path,handle,text)

def probe_opened(+db: String, +path: String, +handle: U32) -> IO(Probe):
  do IO<Probe>:
    line : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
    probe_closed(db,path,handle,line)

def probe_spawned(+db: String, +path: String, spawned: Result<&1,&1,U32 & String,U32>) -> IO(Probe):
  match spawned:
    case Fail{(code,detail)}: do IO<Probe>:
      removed : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(path)
      IO.pure(Probe,Refused{"The harness command could not be started: " ++ detail ++ ".","",""})
    case Done{handle}: probe_opened(db,path,handle)

def probe(+db: String, +cmd: String, +model: String, +effort: String, +sessions: String, +workspace: String) -> IO(Probe):
  do IO<Probe>:
    token : String <- probe_token(db)
    +path : String <- IO.pure(String,probe_stderr_path(db,token))
    spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn(probe_argv(cmd,model,effort,sessions),probe_cwd(workspace),path)
    probe_spawned(db,path,spawned)

# The typed refusal names the frame requirement and carries both captured
# streams, so the operator sees what the command actually printed. The recorded
# endpoint and assignment are preserved because nothing was written.
def refusal(+session: String, +cmd: String, probed: Probe) -> IO(Unit):
  match probed:
    case Probed{}: IO.pure(Unit,Unit{})
    case Refused{+condition, +stdout, +stderr}: IO.die(Unit,2,
      "{\"error\":\"receiver-refused\",\"session\":" ++ J.string_literal(session)
      ++ ",\"command\":" ++ J.string_literal(cmd)
      ++ ",\"condition\":" ++ J.string_literal(condition)
      ++ ",\"stdout\":" ++ J.string_literal(stdout)
      ++ ",\"stderr\":" ++ J.string_literal(stderr)
      ++ ",\"next\":\"Pass the harness executable that answers the OMP rpc handshake with a JSON ready frame as HARNESS_COMMAND, then retry register-receiver. The session endpoint, workspace, model and native identity are unchanged and no attempt was created.\"}\n")

# Registration runs the probe before the endpoint transaction, only for the
# OMP route. The probe reads the recorded model and effort, resolves the
# command the receiver itself would launch, and runs it against a fresh
# token-named session directory that is removed after the outcome; the
# recorded session store is never an input to the probe.
def registration(+db: String, +session: String, cmd: String, model: String, +workspace: String) -> IO(Unit):
  do IO<Unit>:
    effort : String <- IO.try(String,DB.Sql.read(db,"SELECT effort FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +native : String <- IO.try(String,Host.Control.command(cmd))
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    token : String <- probe_token(database)
    +scratch : String = probe_sessions_path(database,token)
    made : Unit <- IO.try(Unit,F.Files.mkdir(scratch))
    probed : Probe <- probe(database,native,model,Tx.trim_nl(effort),scratch,workspace)
    cleared : Unit <- IO.try(Unit,F.Files.rmdir(scratch))
    refusal(session,native,probed)
