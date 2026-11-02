# The drain sweep (#1399). The database keeps each deferred session and a
# generation for its current sweep obligation. The top-level sweep starts one
# worker per session. A worker holds a separate nonblocking sweep lock while
# it uses the existing delivery path, so a blocked admission cannot hold up
# other sessions and later timer rounds do not queue behind it. The receiver
# still owns the ordinary session lock, wake claim and retained native identity.
import Base
import ../git/text.bend as Tx
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/control.bend as HostControl
import ./store.bend as Store
import ./wake.bend as Wake
import ./delivery.bend as Delivery
import ./instance-drain.bend as Drain

def sweep_failed(+db: String, +session: String, +message: String, +code: U32, +detail: String) -> IO(Unit):
  Delivery.failure_report(db,session,message ++ ":drain-sweep-failed",Drain.sweep_failed_text(U32.show(code),detail,session))

def sweep_row_failed(+db: String, +session: String, +generation: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.pure(Unit,Unit{})
    case Fail{(+code,+detail)}: sweep_failed(db,session,"drain-sweep:" ++ session ++ ":" ++ generation,code,detail)

def message_current(+db: String, +session: String, +generation: String, +message: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: Store.clear_drain_deferred(db,session,generation)
    case False{}:
      do IO<Unit>:
        result : Result<&1,&1,U32 & String,Unit> <- Wake.drive_session(db,session,message)
        sweep_row_failed(db,session,generation,result)

def sweep_record_parts(+db: String, +session: String, +expected_generation: String, parts: List<String>) -> IO(Unit):
  match parts:
    case generation <> Nil{}:
      +current_generation = generation
      Bool.pick(IO(Unit),String.eq(current_generation,expected_generation),
        do IO<Unit>:
          owed : String <- IO.try(String,DB.Sql.query(db,Delivery.wake_sql(session,"0")))
          +head : String <- IO.pure(String,Tx.trim_nl(owed))
          message_current(db,session,current_generation,head,String.is_empty(head)),
        IO.pure(Unit,Unit{}))
    case other: IO.pure(Unit,Unit{})

def sweep_locked_work(+db: String, +session: String, +generation: String, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{saved}: do IO<Result<&1,&1,U32 & String,Unit>>:
      processed : Unit <- sweep_record_parts(db,session,generation,[Tx.trim_nl(saved)])
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

def sweep_release_result(+db: String, +session: String, +generation: String, processed: Result<&1,&1,U32 & String,Unit>, released: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match released:
    case Done{unit}: sweep_row_failed(db,session,generation,processed)
    case Fail{(+code,+detail)}: IO.die(Unit,code,"drain sweep lock release failed: " ++ detail)

def sweep_locked(+db: String, +session: String, +generation: String, lock: U32) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.deferred_record(db,session))
    processed : Result<&1,&1,U32 & String,Unit> <- sweep_locked_work(db,session,generation,Done{saved})
    released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(lock)
    sweep_release_result(db,session,generation,processed,released)

def sweep_lock_acquired(+db: String, +session: String, +generation: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit,Unit{})
    case Some{handle}: sweep_locked(db,session,generation,handle)

# The host stores sweep locks in a distinct purpose namespace from receiver
# session locks. Acquisition is nonblocking, so timer rounds start no waiting
# worker for a session whose delivery call is still active. The OS releases it
# if this worker exits.
def sweep_one(+db: String, +session: String, +generation: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire_drain_sweep(canonical,session))
    sweep_lock_acquired(canonical,session,generation,lock)

def worker_argv(executable: String, db: String, session: String, generation: String) -> List<String>:
  [executable,"--drain-sweep-session",db,session,generation]

def launched(+db: String, +session: String, +generation: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{output}: IO.pure(Unit,Unit{})
    case Fail{(+code,+detail)}: sweep_failed(db,session,"drain-sweep:" ++ session ++ ":" ++ generation,code,detail)

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
    case session <> generation <> Nil{}: launch_session(db,Tx.hex_decode(Tx.trim_nl(session)),Tx.trim_nl(generation))
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
