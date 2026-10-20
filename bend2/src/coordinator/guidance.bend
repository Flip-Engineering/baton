import Base
import ../coordinator/commands.bend as C
import ../coordinator/agent-input.bend as AgentInput
import ../host/sqlite.bend as DB
import ../host/process.bend as P

import ./../coordinator/frame-span.bend as Frame

def relevant(+kind: String, omp: Bool) -> Bool:
  Bool.or(Bool.not(omp),Bool.or(String.eq(kind,"response\n"),
    Bool.or(String.eq(kind,"message_end\n"),Bool.or(String.eq(kind,"tool_execution_start\n"),
    Bool.or(String.eq(kind,"tool_execution_end\n"),String.eq(kind,"agent_end\n"))))))

# A frame written to the native input stream is read by the recipient at
# forwarding time. The read row is recorded against the running attempt,
# independent of how the turn later ends.
def send(+db: String, +player: String, handle: U32, cursor: String, +next: String, same: Bool) -> IO(String):
  match same:
    case True{}: IO.pure(String,cursor)
    case False{}: do IO<String>:
      frame : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('type','steer','id',id,'message',body) FROM messages WHERE seq=CAST(" ++ C.q(next) ++ " AS INTEGER);"))
      sent : Unit <- IO.try(Unit,P.ProcessChild.write(handle,frame))
      recorded : Unit <- AgentInput.forward_read(db,player,next)
      IO.pure(String,next)

# Guidance stays owed until its recipient records the read. The send cursor
# records which messages this attempt has already forwarded.
def outstanding_sql(+player: String) -> String:
  "coalesce((SELECT group_concat(id,',') FROM (SELECT id FROM messages WHERE recipient=" ++ C.q(player) ++ " AND kind='guidance' AND " ++ C.owed_sql("messages") ++ " AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " ORDER BY seq)),'')"

def pending_sql(+player: String, +cursor: String) -> String:
  "SELECT coalesce((SELECT seq FROM messages WHERE recipient=" ++ C.q(player) ++ " AND kind='guidance' AND " ++ C.owed_sql("messages") ++ " AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq LIMIT 1),CAST(" ++ C.q(cursor) ++ " AS INTEGER));"

def pending(+db: String, +player: String, handle: U32, +cursor: String) -> IO(String):
  do IO<String>:
    +next : String <- IO.try(String,DB.Sql.query(db,pending_sql(player,cursor)))
    send(db,player,handle,cursor,next,String.eq(cursor,next))

# An attempt with closed input keeps its current forwarding cursor.
def pending_live(db: String, player: String, handle: U32, cursor: String, closed: U32) -> IO(String):
  match closed:
    case 0: pending(db,player,handle,cursor)
    case other: IO.pure(String,cursor)

def continued(db: String, player: String, +handle: U32, cursor: String, ended: Bool, monitor: Bool) -> IO(String):
  match ended:
    case True{}: match monitor:
      case True{}: IO.pure(String,cursor)
      case False{}: do IO<String>:
        closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
        IO.pure(String,cursor)
    case False{}: do IO<String>:
      closed : U32 <- IO.try(U32,P.ProcessChild.input_closed(handle))
      pending_live(db,player,handle,cursor,closed)

# A commit notice drains guidance while this native attempt accepts input.
@unsafe
def drain_pending(+db: String, +player: String, +handle: U32, +cursor: String) -> IO(String):
  do IO<String>:
    +next : String <- continued(db,player,handle,cursor,False{},False{})
    Bool.pick(IO(String),String.eq(next,cursor),IO.pure(String,cursor),drain_pending(db,player,handle,next))

def awake_pending(db: String, player: String, handle: U32, +cursor: String, woke: Bool) -> IO(String):
  Bool.pick(IO(String),woke,drain_pending(db,player,handle,cursor),IO.pure(String,cursor))

def terminal_sql(+value: String) -> String:
  "SELECT CASE WHEN " ++ C.terminal(value) ++ " THEN 1 ELSE 0 END;"

def terminal_span_sql(+value: String) -> String:
  "SELECT CASE WHEN " ++ C.terminal_span(value) ++ " THEN 1 ELSE 0 END;"

def observe_text(+db: String, +player: String, handle: U32, +line: String, +cursor: String, monitor: Bool) -> IO(String):
  do IO<String>:
    ended : String <- IO.try(String,DB.Sql.query(db,terminal_sql(line)))
    continued(db,player,handle,cursor,String.eq(ended,"1\n"),monitor)

def observe_span(+db: String, +player: String, handle: U32, +spool: String, +offset: String, +length: String, +cursor: String, monitor: Bool) -> IO(String):
  do IO<String>:
    ended : String <- IO.try(String,DB.Sql.query_span(db,spool,offset,length,terminal_span_sql("?1")))
    continued(db,player,handle,cursor,String.eq(ended,"1\n"),monitor)

def observe_decoded(+db: String, +player: String, handle: U32, decoded: Frame.FrameDecoded, cursor: String, monitor: Bool) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: observe_text(db,player,handle,line,cursor,monitor)
    case Frame.SpanFrame{spool,offset,length}: observe_span(db,player,handle,spool,offset,length,cursor,monitor)
    case Frame.InvalidFrame{line}: IO.pure(String,cursor)

# Native responses remain in the observed stream. Terminal frames close stdin
# for the process owner; monitor observers preserve input ownership.
def observe(+db: String, +player: String, handle: U32, decoded: Frame.FrameDecoded, +line: String, cursor: String, enabled: Bool, monitor: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,cursor)
    case True{}: observe_decoded(db,player,handle,decoded,cursor,monitor)
