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

# The SQL claim row below is the admission record. Liveness is held by the
# host custody election in the stable per-user IPC directory; this row
# records the live holder for status and crash recovery.
def owner_schema() -> String:
  "CREATE TABLE IF NOT EXISTS instance_owner (owner TEXT PRIMARY KEY NOT NULL, heartbeat INTEGER NOT NULL, generation INTEGER NOT NULL);"

def guarded(+body: String) -> String:
  "BEGIN IMMEDIATE;" ++ owner_schema() ++ body ++ "COMMIT;"

# Seconds after which a heartbeat counts as lapsed. The owner refreshes its
# heartbeat on every serve iteration, so a row older than this bound belongs
# to an owner that no longer runs.
def claim_lapse_seconds() -> String:
  "300"

# A claim first deletes lapsed rows, then inserts the claimant when no other
# holder remains, refreshing its heartbeat when it already holds the row. A
# refused claimant inserts nothing. A different held row refuses with the
# duplicate-owner error naming the current holder. Each new holder epoch
# carries the next generation number; subscribers use it to detect owner
# replacement. Each statement has its own builder so no single checker term
# carries the whole transaction.
def claim_clear_sql(+owner: String) -> String:
  "DELETE FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ " AND heartbeat<CAST((SELECT strftime('%s','now')) AS INTEGER)-" ++ claim_lapse_seconds() ++ ";"

def claim_insert_sql(+owner: String) -> String:
  "INSERT INTO instance_owner(owner, heartbeat, generation) SELECT " ++ C.q(owner) ++ ",(SELECT strftime('%s','now')),coalesce((SELECT max(generation)+1 FROM instance_owner),1) WHERE NOT EXISTS(SELECT 1 FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ " AND heartbeat>=CAST((SELECT strftime('%s','now')) AS INTEGER)-" ++ claim_lapse_seconds() ++ ") ON CONFLICT(owner) DO UPDATE SET heartbeat=excluded.heartbeat;"

def claim_decide_sql(+owner: String) -> String:
  "SELECT json_object('error','duplicate-owner','owner'," ++ C.q(owner) ++ ",'current',(SELECT owner FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ " LIMIT 1),'condition','One native owner holds each Orchestra database.','next','Read owner status. Serve only after the current owner releases or its heartbeat lapses.') WHERE EXISTS(SELECT 1 FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ ");"
  ++ "SELECT json_object('owner',owner,'heartbeat',heartbeat,'generation',generation) FROM instance_owner WHERE owner=" ++ C.q(owner) ++ " AND NOT EXISTS(SELECT 1 FROM instance_owner WHERE owner<>" ++ C.q(owner) ++ ");"

# The insert reads the generation counter before the clear deletes lapsed
# rows, so holder epochs stay ordered across owner crashes. A refused
# claimant inserts nothing. Two simultaneous first claims refuse together;
# the custody election owns liveness past that point.
def claim_sql(+owner: String) -> String:
  claim_insert_sql(owner) ++ claim_clear_sql(owner) ++ claim_decide_sql(owner)

def heartbeat_sql(+owner: String) -> String:
  "UPDATE instance_owner SET heartbeat=(SELECT strftime('%s','now')) WHERE owner=" ++ C.q(owner) ++ ";SELECT json_object('owner',owner,'heartbeat',heartbeat,'generation',generation) FROM instance_owner WHERE owner=" ++ C.q(owner) ++ ";"

def release_sql(+owner: String) -> String:
  "DELETE FROM instance_owner WHERE owner=" ++ C.q(owner) ++ ";SELECT json_object('released'," ++ C.q(owner) ++ ");"

def owner_status_sql() -> String:
  "SELECT coalesce((SELECT json_object('owner',owner,'heartbeat',heartbeat,'generation',generation) FROM instance_owner LIMIT 1),json('null'));"

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
def serve_session(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,Unit>):
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

# An empty heartbeat answer means the claim row is gone or belongs to
# another holder: this invocation is deposed. Custody follows the claim
# row and the per-session locks; a holder that lost its row joins its
# forked tasks and reports the loss.
def deposed(+beat: String) -> Bool:
  String.is_empty(beat)

def serve_fenced(+db: String, tasks: List<Chan(Result<&1,&1,U32 & String,Unit>)>, +id: String, gone: Bool, recurse: String -> List<Chan(Result<&1,&1,U32 & String,Unit>)> -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match gone:
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      joined : Result<&1,&1,U32 & String,Unit> <- join_all(tasks)
      IO.pure(Result<&1,&1,U32 & String,Unit>,combine(joined,Fail{(2,"The owner claim lapsed; this invocation stopped instead of running on. Read owner status and serve again.")}))
    case False{}: serve_step(db,tasks,id,String.is_empty(id),recurse)

# The cursor advances through store input read back from the database, as in
# the receive entry, so the loop carries the same marker. The heartbeat
# write precedes discovery on every iteration, bounding row staleness to one
# session task, and the fence stops a deposed holder before further work.
@unsafe
def serve_loop(+db: String, +owner: String, cursor: String, tasks: List<Chan(Result<&1,&1,U32 & String,Unit>)>) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    beat : String <- IO.try(String,DB.Sql.query(db,heartbeat_sql(owner)))
    next : String <- IO.try(String,DB.Sql.query(db,next_session_sql(cursor)))
    +id : String <- IO.pure(String,Tx.trim_nl(next))
    +held : String <- IO.pure(String,Tx.trim_nl(beat))
    serve_fenced(db,tasks,id,deposed(held),next_id => next_tasks => serve_loop(db,owner,next_id,next_tasks))

def serve_owned(+db: String, +owner: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    +saved : String <- IO.try(String,DB.Sql.query(canonical,guarded(claim_sql(owner))))
    held : String <- claim_result(saved,claim_refused(saved))
    done : Result<&1,&1,U32 & String,Unit> <- serve_loop(canonical,owner,"",Nil{})
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

# The subscription cursor for readers of this database: the holder record,
# the highest committed change and holder readiness. No row bodies cross
# this boundary; readers fetch rows through their own scope. The change
# table belongs to the projection owner, so its presence is checked before
# the cursor reads it.
def changes_present_sql() -> String:
  "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='native_changes';"

def changes_cursor_sql() -> String:
  "SELECT coalesce(max(change_id),0) FROM native_changes;"

def read_cursor_when_present(+db: String, present: Bool) -> IO(String):
  match present:
    case False{}: IO.pure(String,"0")
    case True{}: do IO<String>:
      cursor : String <- IO.try(String,DB.Sql.query(db,changes_cursor_sql()))
      IO.pure(String,Tx.trim_nl(cursor))

def subscribe_answer(+holder: String, +cursor: String) -> String:
  "{\"holder\":" ++ Tx.trim_nl(holder) ++ ",\"change_id\":" ++ cursor ++ ",\"ready\":" ++ Bool.pick(String,String.eq(Tx.trim_nl(holder),"null"),"0","1") ++ "}"

def subscribe(+db: String) -> IO(String):
  do IO<String>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    holder : String <- IO.try(String,DB.Sql.query(canonical,guarded(owner_status_sql())))
    present : String <- IO.try(String,DB.Sql.query(canonical,changes_present_sql()))
    cursor : String <- read_cursor_when_present(canonical,String.eq(present,"1\n"))
    IO.pure(String,subscribe_answer(holder,cursor))

def subscribe_unit(+db: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- subscribe(db)
    IO.write(saved)

def serve_verb(+verb: String) -> Bool:
  Bool.or(String.eq(verb,"serve"),Bool.or(String.eq(verb,"owner-status"),String.eq(verb,"subscribe")))

def route(+db: String, +verb: String, +owner: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(verb,"serve"),serve_unit(db,owner),
  Bool.pick(IO(Unit),String.eq(verb,"owner-status"),status_unit(db),
  Bool.pick(IO(Unit),String.eq(verb,"subscribe"),subscribe_unit(db),
  IO.die(Unit,2,"Unknown instance command; use serve SESSION-OWNER, owner-status or subscribe."))))
