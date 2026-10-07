import Base
import ./commands.bend as C
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

# Sessions holding actionable pending input: unacknowledged messages on live
# Codex or OMP sessions with a registered receiver endpoint, excluding
# terminally stopped sessions like the wake path. The full pending set is
# read every pass, so older actionable IDs replay after any restart.
def endpoint_field_sql(+session: String, index: String) -> String:
  "SELECT COALESCE(CASE WHEN json_valid(endpoint) THEN json_extract(endpoint,'$[" ++ index ++ "]') ELSE '' END,'') FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def recorded_endpoint(+db: String, +session: String, index: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String, DB.Sql.query(db, endpoint_field_sql(session, index)))
    IO.pure(String, Tx.trim_nl(saved))

def dirty_session_sql() -> String:
  "SELECT DISTINCT m.recipient FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.receipt IS NULL AND m.recipient <> '' AND NOT " ++ C.stopped_session_sql("m.recipient") ++ " AND s.harness IN ('codex','omp') AND s.endpoint <> '' ORDER BY m.recipient;"

def dirty_sessions(saved: String) -> List<String>:
  Tx.split_lines(saved)

def snapshot(+db: String) -> IO(List<String>):
  do IO<List<String>>:
    saved : String <- IO.try(String, DB.Sql.query(db, dirty_session_sql()))
    IO.pure(List<String>, dirty_sessions(saved))

# One session task runs the recorded receive entry with the recorded harness
# executable and log resolved from the receiver endpoint array. Model, effort
# and workspace stay empty so the entry selects the recorded route. The
# session lock inside Receive refuses a second task for the same session with
# queued, so a fresh snapshot can fork without tracking live tasks. Stop
# admission, native conversation identity, pending-input recovery and parent
# notification run in that path unchanged.
def serve_task(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    cmd : String <- recorded_endpoint(db, session, "4")
    log : String <- recorded_endpoint(db, session, "8")
    Receive.run(db, session, cmd, "", "", "", log, "")

@unsafe
def fork_tasks(+db: String, sessions: List<String>) -> IO(List<Chan(Result<&1,&1,U32 & String,Unit>)>):
  match sessions:
    case Nil{}: IO.pure(List<Chan(Result<&1,&1,U32 & String,Unit>)>, Nil{})
    case session <> rest: do IO<List<Chan(Result<&1,&1,U32 & String,Unit>)>>:
      task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>, serve_task(db, session))
      others : List<Chan(Result<&1,&1,U32 & String,Unit>)> <- fork_tasks(db, rest)
      IO.pure(List<Chan(Result<&1,&1,U32 & String,Unit>)>, Con{task, others})

# A failed task carries its failure to the shutdown exit. A stop racing the
# snapshot can fail a task whose input the stop retained; the next serve
# excludes that stopped input, so the exit stays truthful while the input
# stays pending.
def note_task(failed: Bool, done: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match done:
    case Done{unit}: IO.pure(Bool, failed)
    case Fail{error}: IO.pure(Bool, True{})

def close_subscription(+handle: U32, +failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match failed:
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      closed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.unsubscribe(handle)
      IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{(1, "The serve recorded a swept task failure.")})
    case False{}: Custody.Instance.unsubscribe(handle)

# Joins one forked list to its flag. Fresh snapshots fork through drain_tasks
# below, so this helper never names the drive loop.
@unsafe
def drain_now(+db: String, +handle: U32, +failed: Bool, tasks: List<Chan(Result<&1,&1,U32 & String,Unit>)>) -> IO(Bool):
  match tasks:
    case Nil{}: IO.pure(Bool, failed)
    case task <> rest: do IO<Bool>:
      done : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>, task)
      failed_now : Bool <- note_task(failed, done)
      drain_now(db, handle, failed_now, rest)

# Tasks join one at a time. After every joined task the loop re-snapshots and
# forks newly dirty sessions, draining those before rejoining the older tasks,
# so discovery never waits for all tasks to end. The continuation carries the
# loop without naming it, keeping every definition ordered before its callers.
@unsafe
def drain_tasks(+db: String, +handle: U32, +failed: Bool, tasks: List<Chan(Result<&1,&1,U32 & String,Unit>)>, again: Bool -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match tasks:
    case Nil{}: again(failed)
    case task <> rest: do IO<Result<&1,&1,U32 & String,Unit>>:
      done : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>, task)
      failed_now : Bool <- note_task(failed, done)
      fresh : List<String> <- snapshot(db)
      extra : List<Chan(Result<&1,&1,U32 & String,Unit>)> <- fork_tasks(db, fresh)
      failed_fresh : Bool <- drain_now(db, handle, failed_now, extra)
      drain_tasks(db, handle, failed_fresh, rest, again)

def notice_closed(+db: String, +handle: U32, +failed: Bool, result: Result<&1,&1,U32 & String,String>, again: Bool -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Fail{error}: close_subscription(handle, failed)
    case Done{text}: again(failed)

# Idle serves block on the owner notice. A notice carries only the cursor
# high-water, so every notice replays the full pending snapshot; a gap notice
# is served by the same snapshot. A failed notice means the owner is gone, and
# the serve closes its subscription and exits with the carried status.
def idle(+db: String, +handle: U32, +failed: Bool, again: Bool -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : Result<&1,&1,U32 & String,String> <- Custody.Instance.notice(handle)
    notice_closed(db, handle, failed, result, again)

def drive_sessions(+db: String, +handle: U32, +failed: Bool, sessions: List<String>, again: Bool -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match sessions:
    case Nil{}: idle(db, handle, failed, again)
    case session <> rest: do IO<Result<&1,&1,U32 & String,Unit>>:
      first : List<Chan(Result<&1,&1,U32 & String,Unit>)> <- fork_tasks(db, sessions)
      drain_tasks(db, handle, failed, first, again)

@unsafe
def drive(+db: String, +handle: U32, +failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    sessions : List<String> <- snapshot(db)
    drive_sessions(db, handle, failed, sessions, failed_next => drive(db, handle, failed_next))

def admitted(+db: String, subscribed: Result<&1,&1,U32 & String,U32 & String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match subscribed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>, Fail{error})
    case Done{(handle, readiness)}: do IO<Result<&1,&1,U32 & String,Unit>>:
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
    case Done{(handle, readiness)}: do IO<Result<&1,&1,U32 & String,Unit>>:
      ready : Unit <- IO.write(readiness ++ "\n")
      Custody.Instance.unsubscribe(handle)

# One-shot owner readiness for admission and discovery: the generation, the
# committed cursor and the gap flag, then the subscription closes.
def owner_status(+db: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    subscribed : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db, "0", "0")
    status_read(db, subscribed)
