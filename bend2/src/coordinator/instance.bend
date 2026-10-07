import Base
import ./commands.bend as C
import ./receive.bend as Receive
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../git/text.bend as Tx

# One native owner per canonical Orchestra database (#676).
#
# The owner is a single `serve` invocation per canonical database path. It
# claims the instance_owner row, runs one concurrent task per session that
# holds unacknowledged input, then releases the claim. Session admission,
# prepared grants, native conversation identity, pending input, stop handling
# and parent notification stay in the receive path the owner calls.
# Provider processes stay where the harness requires them. The host custody
# effect that holds provider children inside the owner process is defined in
# docs/bend2/shared-instance-676.md and implemented in process-spawn.c under
# its assigned owner.

# The owner guard file path beside the canonical database. The SQL claim row
# below is the admission check; this path names the file lock the host
# custody effect adds beside it.
def owner_path(+canonical: String) -> String:
  canonical ++ ".owner"

def owner_schema() -> String:
  "CREATE TABLE IF NOT EXISTS instance_owner (owner TEXT PRIMARY KEY NOT NULL, heartbeat INTEGER NOT NULL);"

def guarded(+body: String) -> String:
  "BEGIN IMMEDIATE;" ++ owner_schema() ++ body ++ "COMMIT;"

# A claim succeeds when no row exists or the claimant already holds the row,
# refreshing its heartbeat. A different held row refuses with the
# duplicate-owner error naming the current holder.
def claim_sql(+owner: String) -> String:
  "INSERT INTO instance_owner(owner, heartbeat) VALUES(" ++ C.q(owner) ++ ",(SELECT strftime('%s','now'))) ON CONFLICT(owner) DO UPDATE SET heartbeat=excluded.heartbeat;"
  ++ "SELECT json_object('error','duplicate-owner','owner'," ++ C.q(owner) ++ ",'current',(SELECT owner FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ " LIMIT 1),'condition','One native owner holds each Orchestra database.','next','Read owner status. Serve only after the current owner releases or its heartbeat lapses.') WHERE EXISTS(SELECT 1 FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ ");"
  ++ "SELECT json_object('owner',owner,'heartbeat',heartbeat) FROM instance_owner WHERE owner=" ++ C.q(owner) ++ " AND NOT EXISTS(SELECT 1 FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ ");"

def heartbeat_sql(+owner: String) -> String:
  "UPDATE instance_owner SET heartbeat=(SELECT strftime('%s','now')) WHERE owner=" ++ C.q(owner) ++ ";SELECT json_object('owner',owner,'heartbeat',heartbeat) FROM instance_owner WHERE owner=" ++ C.q(owner) ++ ";"

def release_sql(+owner: String) -> String:
  "DELETE FROM instance_owner WHERE owner=" ++ C.q(owner) ++ ";SELECT json_object('released'," ++ C.q(owner) ++ ");"

def owner_status_sql() -> String:
  "SELECT coalesce((SELECT json_object('owner',owner,'heartbeat',heartbeat) FROM instance_owner LIMIT 1),json('null'));"

# The next session at or after the cursor that holds unacknowledged input
# and is not terminally stopped. The owner walks this cursor to discover
# per-session tasks.
def next_session_sql(+after: String) -> String:
  "SELECT coalesce((SELECT id FROM sessions WHERE id>" ++ C.q(after) ++ " AND NOT " ++ C.stopped_session_sql("sessions.id") ++ " AND EXISTS(SELECT 1 FROM messages WHERE recipient=sessions.id AND receipt IS NULL) ORDER BY id LIMIT 1),'');"

def claim_refused(+saved: String) -> Bool:
  Tx.starts_with(saved,"{\"error\":\"duplicate-owner\"")

def claim_result(saved: String, denied: Bool) -> IO(String):
  match denied:
    case True{}: IO.die(String,2,saved)
    case False{}: IO.pure(String,saved)

def combine(first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: second

# One owned session task. The empty command, model, effort, workspace and
# message arguments select the session's recorded values and its full
# pending inbox through the receive entry.
def serve_session(+db: String, session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Receive.run(db,session,"","","","","","")

def join_all(tasks: List<Chan(Result<&1,&1,U32 & String,Unit>)>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match tasks:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case task <> rest: do IO<Result<&1,&1,U32 & String,Unit>>:
      tail : Result<&1,&1,U32 & String,Unit> <- join_all(rest)
      head : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,task)
      IO.pure(Result<&1,&1,U32 & String,Unit>,combine(head,tail))

def serve_step(+db: String, tasks: List<Chan(Result<&1,&1,U32 & String,Unit>)>, +id: String, empty: Bool, recurse: String -> List<Chan(Result<&1,&1,U32 & String,Unit>)> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match empty:
    case True{}: join_all(tasks)
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,serve_session(db,id))
      recurse(id,Con{task,tasks})

def serve_loop(+db: String, cursor: String, tasks: List<Chan(Result<&1,&1,U32 & String,Unit>)>) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    next : String <- IO.try(String,DB.Sql.query(db,next_session_sql(cursor)))
    +id : String <- IO.pure(String,Tx.trim_nl(next))
    serve_step(db,tasks,id,String.is_empty(id),next_id => next_tasks => serve_loop(db,next_id,next_tasks))

def serve_owned(+db: String, +owner: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    saved : String <- IO.try(String,DB.Sql.query(canonical,guarded(claim_sql(owner))))
    held : String <- claim_result(saved,claim_refused(saved))
    done : Result<&1,&1,U32 & String,Unit> <- serve_loop(canonical,"",Nil{})
    released : String <- IO.try(String,DB.Sql.query(canonical,guarded(release_sql(owner))))
    IO.pure(Result<&1,&1,U32 & String,Unit>,done)

def owner_status(+db: String) -> IO(String):
  do IO<String>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    IO.try(String,DB.Sql.query(canonical,guarded(owner_status_sql())))

def serve_unit(+db: String, +owner: String) -> IO(Unit):
  IO.try(Unit,serve_owned(db,owner))

def status_unit(+db: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- owner_status(db)
    IO.write(saved)

def serve_verb(+verb: String) -> Bool:
  Bool.or(String.eq(verb,"serve"),String.eq(verb,"owner-status"))

def route(+db: String, +verb: String, +owner: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(verb,"serve"),serve_unit(db,owner),
  Bool.pick(IO(Unit),String.eq(verb,"owner-status"),status_unit(db),
  IO.die(Unit,2,"Unknown instance command; use serve SESSION-OWNER or owner-status.")))
