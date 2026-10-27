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
type Probe is Data:
  Probed{}
  Refused{condition: String, stdout: String, stderr: String}

def probe_tick() -> U32:
  50

# Ten seconds of ticks, with the terminate signal at the fifth second of the
# count. A harness that answers the handshake prints the ready frame before any
# provider work, so only a stuck child reaches these bounds.
def probe_watch_ticks() -> U32:
  200

def probe_term_ticks() -> U32:
  100

def probe_term() -> U32:
  15

def probe_kill() -> U32:
  9

# The refusal retains a bounded transcript. A child that prints without end
# cannot grow the answer past this many lines.
def probe_lines() -> U32:
  64

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

# The child's stderr goes to a file of its own so it cannot block on a pipe.
# The file is read once and removed on every path, before the answer is used.
def probe_stderr_path(+db: String, +token: String) -> String:
  db ++ ".receiver-probe-" ++ token ++ ".stderr"

def probe_diagnostics(read: Result<&1,&1,U32 & String,String>) -> IO(String):
  match read:
    case Fail{(code,detail)}: IO.pure(String,"")
    case Done{text}: IO.pure(String,text)

def probe_captured(+path: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
    removed : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(path)
    probe_diagnostics(read)

# The child still holds its slot while the probe runs, so a wait before it is
# reaped reports exactly that. A reaped or retired handle reports closed or
# stale, and no deadline then signals the slot.
def probe_alive_result(closed: Result<&1,&1,U32 & String,U32>) -> Bool:
  match closed:
    case Fail{error}: False{}
    case Done{value}: U32.is_eq(value,0)

def probe_alive(+handle: U32) -> IO(Bool):
  do IO<Bool>:
    closed : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.input_closed(handle)
    IO.pure(Bool,probe_alive_result(closed))

def probe_signal_live(+handle: U32, sig: U32) -> IO(Unit):
  do IO<Unit>:
    alive : Bool <- probe_alive(handle)
    sent : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),alive,P.ProcessChild.signal(handle,sig),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    IO.pure(Unit,Unit{})

def probe_watch_terminate(+handle: U32, +ticks: U32) -> IO(Unit):
  Bool.pick(IO(Unit),U32.is_eq(ticks,probe_term_ticks()),probe_signal_live(handle,probe_term()),IO.pure(Unit,Unit{}))

# The watch task ends as soon as the probe reaps its child, so a finished probe
# leaves no parked action and no process. A child that ignores the terminate
# signal is killed at the second deadline, and the tick loop ends after that
# kill because the signal cannot be ignored. The checker cannot derive the tick
# bound, so this def is unchecked like the compile queue's wait loop.
@unsafe
def probe_watchdog(+handle: U32, +ticks: U32) -> IO(Unit):
  do IO<Unit>:
    +alive : Bool <- probe_alive(handle)
    +expired : Bool = U32.is_eq(ticks,0)
    +waiting : Bool = Bool.and(alive,Bool.not(expired))
    Bool.pick(IO(Unit),waiting,
      do IO<Unit>:
        signaled : Unit <- probe_watch_terminate(handle,ticks)
        slept : Unit <- IO.sleep(probe_tick())
        probe_watchdog(handle,U32.sub(ticks,1)),
      Bool.pick(IO(Unit),Bool.and(alive,expired),
        do IO<Unit>:
          killed : Unit <- probe_signal_live(handle,probe_kill())
          IO.pure(Unit,Unit{}),
        IO.pure(Unit,Unit{})))

def drain_text(line: Result<&1,&1,U32 & String,Maybe<String>>) -> String:
  match line:
    case Done{Some{+text}}: text
    case other: ""

def drain_more(line: Result<&1,&1,U32 & String,Maybe<String>>) -> Bool:
  match line:
    case Done{Some{text}}: True{}
    case other: False{}

# The transcript keeps at most probe_lines() further lines; the countdown bounds
# the answer, so the checker cannot derive the termination from the line data.
@unsafe
def probe_drain(+handle: U32, +acc: String, +remaining: U32) -> IO(String):
  Bool.pick(IO(String),U32.is_eq(remaining,0),IO.pure(String,acc),
    do IO<String>:
      +line : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
      +text : String = drain_text(line)
      +more : Bool = drain_more(line)
      Bool.pick(IO(String),more,probe_drain(handle,acc ++ text ++ "\n",U32.sub(remaining,1)),IO.pure(String,acc)))

# Every path after a successful spawn terminates and reaps the child. The
# terminate signal reaches the child's process group, so a wrapper's children
# stop with it, and the wait returns whether the signal took effect or the
# child had already exited.
def probe_stopped(+handle: U32) -> IO(Unit):
  do IO<Unit>:
    sent : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.signal(handle,probe_term())
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    IO.pure(Unit,Unit{})

def probe_transcript(+handle: U32, +first: String) -> IO(String):
  do IO<String>:
    sent : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.signal(handle,probe_term())
    drained : String <- probe_drain(handle,first ++ "\n",probe_lines())
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    IO.pure(String,drained)

def probe_frame_result(+path: String, +handle: U32, +first: String, ready: Bool) -> IO(Probe):
  match ready:
    case True{}: do IO<Probe>:
      stopped : Unit <- probe_stopped(handle)
      removed : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(path)
      IO.pure(Probe,Probed{})
    case False{}: do IO<Probe>:
      transcript : String <- probe_transcript(handle,first)
      captured : String <- probe_captured(path)
      IO.pure(Probe,Refused{"The harness command printed a first line that is not a JSON object with type \"ready\".",transcript,captured})

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
    watching : Unit <- IO.spawn(Unit,probe_watchdog(handle,probe_watch_ticks()))
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

# The session storage directory the launch path records for a native
# conversation, written here as the receiver and usage commands write it.
def sessions_sql(+db: String, +session: String) -> String:
  "SELECT CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END FROM sessions WHERE id=" ++ C.q(session) ++ ";"

# Registration runs the probe before the endpoint transaction, only for the OMP
# route. The session storage directory and the recorded model, effort and
# workspace are the values the receiver itself would launch with.
def registration(+db: String, +session: String, cmd: String, model: String, +workspace: String) -> IO(Unit):
  do IO<Unit>:
    effort : String <- IO.try(String,DB.Sql.read(db,"SELECT effort FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +native : String <- IO.try(String,Host.Control.command(cmd))
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    sessions : String <- IO.try(String,DB.Sql.read(database,sessions_sql(database,session)))
    probed : Probe <- probe(database,native,model,Tx.trim_nl(effort),Tx.trim_nl(sessions),workspace)
    refusal(session,native,probed)
