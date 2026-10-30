# The drain sweep (#1399). A draining instance owner refuses new starts, and each
# refused start keeps its owed input as a drain-deferred claim. The owner runs
# this entry when it starts and after it has exited its drain. The sweep drives
# every session that holds such a claim through the production wake driver, which
# takes the normal session lock, re-reads the claim and either adopts a live
# claimed owner or claims the owed message anew. A held session lock is a live
# owner that evaluates its own obligation, so the sweep leaves that session as
# it is; the claim stays and the next owner start or exit sweeps again. A failure
# is reported durably to the session's coordinator and does not stop the other
# sessions.
import Base
import ../git/text.bend as Tx
import ../host/sqlite.bend as DB
import ./store.bend as Store
import ./wake.bend as Wake
import ./delivery.bend as Delivery
import ./instance-drain.bend as Drain

def sweep_failed(+db: String, +session: String, +message: String, +code: U32, +detail: String) -> IO(Unit):
  Delivery.failure_report(db,session,message ++ ":drain-sweep-failed",Drain.sweep_failed_text(U32.show(code),detail,session))

def swept(+db: String, +session: String, +message: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match result:
    case Done{unit}: IO.pure(Unit,Unit{})
    case Fail{(+code,+detail)}: sweep_failed(db,session,message,code,detail)

def sweep_found(+db: String, +session: String, +message: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Unit> <- Wake.drive_session(db,session,message)
      swept(db,session,message,result)

def sweep_session(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,DB.Sql.query(db,Delivery.wake_sql(session,"0")))
    +message : String <- IO.pure(String,Tx.trim_nl(found))
    sweep_found(db,session,message,String.is_empty(message))

def sweep_each(+db: String, sessions: List<String>) -> IO(Unit):
  match sessions:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> rest: do IO<Unit>:
      driven : Unit <- sweep_session(db,Tx.trim_nl(head))
      sweep_each(db,rest)

def sweep(+db: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- Store.deferred_sessions(db)
    sweep_each(db,Tx.split_lines(Tx.trim_nl(found)))
