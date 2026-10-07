import Base
import ./commands.bend as C
import ./stop.bend as Stop
import ./receive.bend as Receive
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../git/text.bend as Tx

# The fixed coordinator drives every session with actionable pending input as
# concurrent native tasks under the elected database owner. One serve process
# holds one committed-change subscription per database; the subscription is
# opened before the first snapshot, so no committed input falls between the
# snapshot and the subscriber registration. Task completion wakes the loop
# through the join below, and committed changes wake it through the owner
# notice while it is idle. The owner publishes the high-water; this loop only
# reads rows and never publishes.

# Sessions holding actionable pending input: unacknowledged messages that are
# not execution input to a terminally stopped session, on live Codex or OMP
# sessions. The pending predicate matches the players/status projection; the
# harness filter keeps the serve on sessions Receive admits. The full pending
# set is read every pass, so older actionable IDs replay after any restart.
def dirty_session_sql() -> String:
  "SELECT DISTINCT m.recipient FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL AND m.recipient <> '' AND NOT (" ++ C.stopped_session_sql("m.recipient") ++ " AND " ++ C.execution_input_sql("m.kind") ++ ") AND s.harness IN ('codex','omp') ORDER BY m.recipient;"

def dirty_sessions(saved: String) -> List<String>:
  Tx.split_lines(saved)

def snapshot(+db: String) -> IO(List<String>):
  do IO<List<String>>:
    saved : String <- IO.try(String, DB.Sql.query(db, dirty_session_sql()))
    IO.pure(List<String>, dirty_sessions(saved))

# One session task runs the recorded receive entry with empty overrides, which
# selects the recorded harness, route and inbox. The session lock inside
# Receive refuses a second task for the same session with queued, so a fresh
# snapshot can fork without tracking live tasks. Stop admission, native
# conversation identity, pending-input recovery and parent notification run in
# that path unchanged.
def serve_task(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Receive.run(db, session, "", "", "", "", "", "")

@unsafe
def fork_tasks(+db: String, sessions: List<String>) -> IO(List<Chan(Result<&1,&1,U32 & String,Unit>)>):
  match sessions:
    case Nil{}: IO.pure(List<Chan(Result<&1,&1,U32 & String,Unit>)>, Nil{})
    case session <> rest: do IO<List<Chan(Result<&1,&1,U32 & String,Unit>)>>:
      task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>, serve_task(db, session))
      others : List<Chan(Result<&1,&1,U32 & String,Unit>)> <- fork_tasks(db, rest)
      IO.pure(List<Chan(Result<&1,&1,U32 & String,Unit>)>, Con{task, others})

# A task that fails on a session which stopped after the snapshot is not a
# serve failure: the stop retained its input by design. Any other failure is
# carried to the shutdown exit.
@unsafe
def note_task(+db: String, +failed: Bool, +session: String, done: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match done:
    case Done{unit}: IO.pure(Bool, failed)
    case Fail{error}: do IO<Bool>:
      stopped : Bool <- Stop.stopped(db, session)
      IO.pure(Bool, Bool.or(failed, Bool.not(stopped)))

# Tasks join one at a time. After every joined task the loop re-snapshots and
# forks newly dirty sessions, draining those before rejoining the older tasks,
# so discovery never waits for all tasks to end.
@unsafe
def drain(+db: String, +handle: U32, +failed: Bool, tasks: List<Chan(Result<&1,&1,U32 & String,Unit>)>, sessions: List<String>) -> IO(Bool):
  match tasks:
    case Nil{}: IO.pure(Bool, failed)
    case task <> rest_tasks:
      match sessions:
        case Nil{}: IO.pure(Bool, failed)
        case session <> rest_sessions: do IO<Bool>:
          done : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>, task)
          failed_now : Bool <- note_task(db, failed, session, done)
          +fresh : List<String> <- snapshot(db)
          extra : List<Chan(Result<&1,&1,U32 & String,Unit>)> <- fork_tasks(db, fresh)
          failed_fresh : Bool <- drain(db, handle, failed_now, extra, fresh)
          drain(db, handle, failed_fresh, rest_tasks, rest_sessions)

def close_subscription(+handle: U32, +failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match failed:
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      closed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.unsubscribe(handle)
      IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{(1, "The serve recorded a swept task failure.")})
    case False{}: Custody.Instance.unsubscribe(handle)

# Idle serves block on the owner notice. A notice carries only the cursor
# high-water, so every notice replays the full pending snapshot; a gap notice
# is served by the same snapshot. A failed notice means the owner is gone, and
# the serve closes its subscription and exits with the carried status.
# The loop is one self-recursive function: every back edge below targets drive
# itself, so discovery never waits for all tasks to end and no join-all gate
# stands between a commit and its snapshot.
@unsafe
def drive(+db: String, +handle: U32, +failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    sessions : List<String> <- snapshot(db)
    match sessions:
      case Nil{}: do IO<Result<&1,&1,U32 & String,Unit>>:
        result : Result<&1,&1,U32 & String,String> <- Custody.Instance.notice(handle)
        match result:
          case Fail{error}: close_subscription(handle, failed)
          case Done{text}: drive(db, handle, failed)
      case session <> rest: do IO<Result<&1,&1,U32 & String,Unit>>:
        +both : List<String> <- IO.pure(List<String>, Con{session, rest})
        first : List<Chan(Result<&1,&1,U32 & String,Unit>)> <- fork_tasks(db, both)
        failed_now : Bool <- drain(db, handle, failed, first, both)
        drive(db, handle, failed_now)

def admitted(+db: String, subscribed: Result<&1,&1,U32 & String,U32 & String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match subscribed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
    case Done{(+handle, +readiness)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      ready : Unit <- IO.write(readiness ++ "\n")
      drive(db, handle, False{})

# The readiness line is printed after the owner registers the subscriber, so a
# supervisor reading the first line knows the snapshot that follows is coherent.
def serve(+db: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    subscribed : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db, "0", "0")
    admitted(db, subscribed)

def status_read(+db: String, subscribed: Result<&1,&1,U32 & String,U32 & String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match subscribed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
    case Done{(+handle, +readiness)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      ready : Unit <- IO.write(readiness ++ "\n")
      Custody.Instance.unsubscribe(handle)

# One-shot owner readiness for admission and discovery: the generation, the
# committed cursor and the gap flag, then the subscription closes.
def owner_status(+db: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    subscribed : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db, "0", "0")
    status_read(db, subscribed)
