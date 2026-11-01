# The drain sweep (#1399). The database keeps each deferred session and a
# generation for its current sweep obligation. The top-level sweep starts one
# worker per session. A worker holds a separate nonblocking session lock while
# it uses the existing delivery path, so a blocked admission cannot hold up
# other sessions and later timer rounds do not queue behind it. The receiver
# still owns the ordinary session lock, wake claim and retained native identity.
import Base
import ../git/text.bend as Tx
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/control.bend as HostControl
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./receive.bend as Receive
import ./wake.bend as Wake
import ./delivery.bend as Delivery
import ./instance-drain.bend as Drain

def sweep_failed(+db: String, +session: String, +message: String, +code: U32, +detail: String) -> IO(Unit):
  Delivery.failure_report(db,session,message ++ ":drain-sweep-failed",Drain.sweep_failed_text(U32.show(code),detail,session))

def sweep_row_failed(+db: String, +session: String, +generation: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.pure(Unit,Unit{})
    case Fail{(+code,+detail)}: sweep_failed(db,session,"drain-sweep:" ++ generation,code,detail)

def message_current(+db: String, +session: String, +generation: String, +message: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: Store.clear_drain_deferred(db,session,generation)
    case False{}:
      do IO<Unit>:
        state : String <- Store.claim_state(db,session)
        directory : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ "),'');"))
        +trimmed : String <- IO.pure(String,Tx.trim_nl(directory))
        dead : Bool <- Receive.custody_dead(db,trimmed,String.is_empty(trimmed))
        Bool.pick(IO(Unit),Bool.and(String.eq(Tx.trim_nl(state),"claimed"),Bool.not(dead)),
          IO.pure(Unit,Unit{}),
          do IO<Unit>:
            result : Result<&1,&1,U32 & String,Unit> <- IO.try(Result<&1,&1,U32 & String,Unit>,Wake.drive_session(db,session,message))
            sweep_row_failed(db,session,generation,result))

def sweep_record_parts(+db: String, +session: String, +expected_generation: String, parts: List<String>) -> IO(Unit):
  match parts:
    case generation <> Nil{}:
      Bool.pick(IO(Unit),String.eq(generation,expected_generation),
        do IO<Unit>:
          owed : String <- IO.try(String,DB.Sql.query(db,Delivery.wake_sql(session,"0")))
          +head : String <- IO.pure(String,Tx.trim_nl(owed))
          message_current(db,session,generation,head,String.is_empty(head)),
        IO.pure(Unit,Unit{}))
    case other: IO.pure(Unit,Unit{})

def sweep_locked(+db: String, +session: String, +generation: String, lock: U32) -> IO(Unit):
  do IO<Unit>:
    saved : String <- Store.deferred_record(db,session)
    result : Result<&1,&1,U32 & String,Unit> <- IO.try(Result<&1,&1,U32 & String,Unit>,sweep_record_parts(db,session,generation,[Tx.trim_nl(saved)]))
    released : Result<&1,&1,U32 & String,Unit> <- IO.try(Result<&1,&1,U32 & String,Unit>,Lock.SessionLock.release(lock))
    sweep_row_failed(db,session,generation,result)

def sweep_lock_acquired(+db: String, +session: String, +generation: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit,Unit{})
    case Some{handle}: sweep_locked(db,session,generation,handle)

# The synthetic lock is separate from the receiver's session lock. It is
# nonblocking so timer rounds start no waiting worker for a session whose
# delivery call is still active. The OS releases it if this worker exits.
def sweep_one(+db: String, +session: String, +generation: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(canonical,worker_lock_key(session)))
    sweep_lock_acquired(canonical,session,generation,lock)

def worker_lock_key(session: String) -> String:
  "drain-sweep:" ++ session

def worker_argv(executable: String, db: String, session: String, generation: String) -> List<String>:
  [executable,"--drain-sweep-session",db,session,generation]

def launched(+db: String, +session: String, +generation: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{output}: IO.pure(Unit,Unit{})
    case Fail{(+code,+detail)}: sweep_failed(db,session,"drain-sweep:" ++ generation,code,detail)

def launch_session(+db: String, +session: String, +generation: String) -> IO(Unit):
  do IO<Unit>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    result : Result<&1,&1,U32 & String,String> <- HostControl.Control.launch(
      Tx.enc_argv(worker_argv(executable,canonical,session,generation)),
      canonical,"drain-sweep:" ++ session ++ ":" ++ generation)
    launched(canonical,session,generation,result)

def launch_parts(+db: String, parts: List<String>) -> IO(Unit):
  match parts:
    case session <> generation <> Nil{}: launch_session(db,Tx.trim_nl(session),Tx.trim_nl(generation))
    case other: IO.pure(Unit,Unit{})

def launch_each(+db: String, rows: List<String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> rest: do IO<Unit>:
      launched : Unit <- launch_parts(db,Tx.split_tabs(Tx.trim_nl(head)))
      launch_each(db,rest)

def sweep(+db: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- Store.deferred_sessions(db)
    launch_each(db,Tx.split_lines(Tx.trim_nl(found)))
