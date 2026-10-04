import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../host/process.bend as P

def relevant(+kind: String, omp: Bool) -> Bool:
  Bool.or(Bool.not(omp),Bool.or(String.eq(kind,"response\n"),
    Bool.or(String.eq(kind,"message_end\n"),Bool.or(String.eq(kind,"tool_execution_start\n"),
    Bool.or(String.eq(kind,"tool_execution_end\n"),String.eq(kind,"agent_end\n"))))))

def send(+db: String, handle: U32, cursor: String, +next: String, same: Bool) -> IO(String):
  match same:
    case True{}: IO.pure(String,cursor)
    case False{}: do IO<String>:
      frame : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('type','steer','id',id,'message',body) FROM messages WHERE seq=CAST(" ++ C.q(next) ++ " AS INTEGER);"))
      sent : Unit <- IO.try(Unit,P.ProcessChild.write(handle,frame))
      IO.pure(String,next)

# The guidance that no attempt has accepted, independent of any send cursor: a
# steer response that arrives after the input closed leaves no receipt, so the
# guidance stays here for the next receive.
def outstanding_sql(+player: String) -> String:
  "coalesce((SELECT group_concat(id,',') FROM (SELECT id FROM messages WHERE recipient=" ++ C.q(player) ++ " AND kind='guidance' AND receipt IS NULL AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " ORDER BY seq)),'')"

def pending_sql(+player: String, +cursor: String) -> String:
  "SELECT coalesce((SELECT seq FROM messages WHERE recipient=" ++ C.q(player) ++ " AND kind='guidance' AND receipt IS NULL AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq LIMIT 1),CAST(" ++ C.q(cursor) ++ " AS INTEGER));"

def pending(+db: String, +player: String, handle: U32, +cursor: String) -> IO(String):
  do IO<String>:
    +next : String <- IO.try(String,DB.Sql.query(db,pending_sql(player,cursor)))
    send(db,handle,cursor,next,String.eq(cursor,next))

# Replay observes receipts after this attempt stops accepting input.
def pending_live(db: String, player: String, handle: U32, cursor: String, closed: U32) -> IO(String):
  match closed:
    case 0: pending(db,player,handle,cursor)
    case other: IO.pure(String,cursor)

def continued(db: String, player: String, +handle: U32, cursor: String, ended: Bool) -> IO(String):
  match ended:
    case True{}: do IO<String>:
      closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
      IO.pure(String,cursor)
    case False{}: do IO<String>:
      closed : U32 <- IO.try(U32,P.ProcessChild.input_closed(handle))
      pending_live(db,player,handle,cursor,closed)

def accepted_sql(+player: String, +event: String) -> String:
  "UPDATE messages SET receipt=coalesce(receipt," ++ C.q(event) ++ ") WHERE recipient=" ++ C.q(player) ++ " AND kind='guidance' AND id=json_extract(" ++ C.q(event) ++ ",'$.id') AND json_extract(" ++ C.q(event) ++ ",'$.type')='response' AND json_extract(" ++ C.q(event) ++ ",'$.command')='steer' AND json_extract(" ++ C.q(event) ++ ",'$.success')=1;"

def terminal_sql(+event: String) -> String:
  "SELECT CASE WHEN " ++ C.terminal(event) ++ " THEN 1 ELSE 0 END;"

# A native steer response records acceptance while this process still accepts
# input. A response that arrives after the input closed is a replay of an
# earlier send: it leaves the guidance for the next receive.
def accepted(db: String, player: String, +event: String, closed: U32) -> IO(String):
  match closed:
    case 0: IO.try(String,DB.Sql.query(db,accepted_sql(player,event) ++ terminal_sql(event)))
    case other: IO.try(String,DB.Sql.query(db,terminal_sql(event)))

# The receipt records native acceptance; the cursor covers this process's sends.
def observe(+db: String, +player: String, +handle: U32, +event: String, cursor: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,cursor)
    case True{}: do IO<String>:
      closed : U32 <- IO.try(U32,P.ProcessChild.input_closed(handle))
      ended : String <- accepted(db,player,event,closed)
      continued(db,player,handle,cursor,String.eq(ended,"1\n"))
