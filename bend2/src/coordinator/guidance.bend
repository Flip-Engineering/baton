import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../host/process.bend as P

def relevant(db: String, event: String, omp: Bool) -> IO(Bool):
  match omp:
    case False{}: IO.pure(Bool,True{})
    case True{}: do IO<Bool>:
      selected : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type') IN ('response','message_end','tool_execution_start','tool_execution_end','agent_end') THEN 1 ELSE 0 END;"))
      IO.pure(Bool,String.eq(selected,"1\n"))

def send(+db: String, handle: U32, cursor: String, +next: String, same: Bool) -> IO(String):
  match same:
    case True{}: IO.pure(String,cursor)
    case False{}: do IO<String>:
      frame : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('type','steer','id',id,'message',body) FROM messages WHERE seq=CAST(" ++ C.q(next) ++ " AS INTEGER);"))
      sent : Unit <- IO.try(Unit,P.ProcessChild.write(handle,frame))
      IO.pure(String,next)

def pending(+db: String, worker: String, handle: U32, +cursor: String) -> IO(String):
  do IO<String>:
    +next : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT seq FROM messages WHERE recipient=" ++ C.q(worker) ++ " AND kind='guidance' AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq LIMIT 1),CAST(" ++ C.q(cursor) ++ " AS INTEGER));"))
    send(db,handle,cursor,next,String.eq(cursor,next))

def continued(db: String, worker: String, handle: U32, cursor: String, ended: Bool) -> IO(String):
  match ended:
    case True{}: do IO<String>:
      closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
      IO.pure(String,cursor)
    case False{}: pending(db,worker,handle,cursor)

# A native steer response records acceptance; the cursor covers this process's sends.
def observe(+db: String, +worker: String, handle: U32, +event: String, cursor: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,cursor)
    case True{}: do IO<String>:
      ended : String <- IO.try(String,DB.Sql.query(db,"UPDATE messages SET receipt=coalesce(receipt," ++ C.q(event) ++ ") WHERE recipient=" ++ C.q(worker) ++ " AND kind='guidance' AND id=json_extract(" ++ C.q(event) ++ ",'$.id') AND json_extract(" ++ C.q(event) ++ ",'$.type')='response' AND json_extract(" ++ C.q(event) ++ ",'$.command')='steer' AND json_extract(" ++ C.q(event) ++ ",'$.success')=1;SELECT CASE WHEN " ++ C.terminal(event) ++ " THEN 1 ELSE 0 END;"))
      continued(db,worker,handle,cursor,String.eq(ended,"1\n"))
