import Base
import ../coordinator/commands.bend as C
import ./agent-input.bend as AgentInput
import ../host/sqlite.bend as DB
import ../host/process.bend as P
import ../host/text.bend as Text
import ../git/text.bend as Tx

import ./../coordinator/frame-span.bend as Frame

def relevant(+kind: String, omp: Bool) -> Bool:
  Bool.or(Bool.not(omp),Bool.or(String.eq(kind,"response\n"),
    Bool.or(String.eq(kind,"message_end\n"),Bool.or(String.eq(kind,"tool_execution_start\n"),
    Bool.or(String.eq(kind,"tool_execution_end\n"),String.eq(kind,"agent_end\n"))))))

# The guidance this attempt already forwarded, as the highest message seq in
# <attempt>/guidance-forwarded. A rejected observer checkpoint replays the
# observation spool from its beginning; this journal keeps that replay from
# writing a steer frame the native stdin already carried. It is transport state
# for one attempt, not an acknowledgement: the message stays owed (receipt
# stays NULL), and a new attempt has no journal, so it receives the pending
# input again exactly once.
def journal_path(+attempt: String) -> String:
  attempt ++ "/guidance-forwarded"

def journal_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{text}: text
    case Fail{error}: ""

def last_line(lines: List<String>, +value: String) -> String:
  match lines:
    case Nil{}: value
    case +head <> tail: last_line(tail,head)

def forwarded_high(db: String, +attempt: String) -> IO(String):
  Bool.pick(IO(String),Bool.not(String.is_empty(attempt)),
    (do IO<String>:
      read : Result<&1,&1,U32 & String,String> <- Text.Text.read(journal_path(attempt))
      +text : String <- IO.pure(String,journal_text(read))
      +line : String <- IO.pure(String,last_line(Tx.split_lines(text),""))
      value : String <- IO.try(String,DB.Sql.query(db,"SELECT CAST(" ++ C.q(Tx.trim_nl(line)) ++ " AS INTEGER);"))
      IO.pure(String,Tx.trim_nl(value))),
    IO.pure(String,"0"))

# The position a replay resumes guidance from: the send cursor, unless this
# attempt already forwarded more.
def replay_cursor(+db: String, +attempt: String, +cursor: String) -> IO(String):
  do IO<String>:
    high : String <- forwarded_high(db,attempt)
    value : String <- IO.try(String,DB.Sql.query(db,"SELECT CAST(max(CAST(" ++ C.q(cursor) ++ " AS INTEGER),CAST(" ++ C.q(high) ++ " AS INTEGER)) AS TEXT);"))
    IO.pure(String,Tx.trim_nl(value))

def record_forwarded(+attempt: String, +next: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(attempt),IO.pure(Unit,Unit{}),
    (do IO<Unit>:
      written : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(journal_path(attempt),Tx.trim_nl(next) ++ "\n")
      IO.pass(Unit,written)))

def send(+db: String, +player: String, handle: U32, +attempt: String, cursor: String, +next: String, same: Bool) -> IO(String):
  match same:
    case True{}: IO.pure(String,cursor)
    case False{}: do IO<String>:
      frame : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('type','steer','id',id,'message',body) FROM messages WHERE seq=CAST(" ++ C.q(next) ++ " AS INTEGER);"))
      sent : Unit <- IO.try(Unit,P.ProcessChild.write(handle,frame))
      recorded : Unit <- AgentInput.forward_read(db,player,next)
      logged : Unit <- record_forwarded(attempt,next)
      IO.pure(String,next)

# Guidance stays owed until its recipient records the read. The send cursor
# records which messages this attempt has already forwarded.
def outstanding_sql(+player: String) -> String:
  "coalesce((SELECT group_concat(id,',') FROM (SELECT id FROM messages WHERE recipient=" ++ C.q(player) ++ " AND kind='guidance' AND " ++ C.owed_sql("messages") ++ " AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " ORDER BY seq)),'')"

def pending_sql(+player: String, +cursor: String) -> String:
  "SELECT coalesce((SELECT seq FROM messages WHERE recipient=" ++ C.q(player) ++ " AND kind='guidance' AND " ++ C.owed_sql("messages") ++ " AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq LIMIT 1),CAST(" ++ C.q(cursor) ++ " AS INTEGER));"

def pending(+db: String, +player: String, handle: U32, +attempt: String, +cursor: String) -> IO(String):
  do IO<String>:
    +next : String <- IO.try(String,DB.Sql.query(db,pending_sql(player,cursor)))
    send(db,player,handle,attempt,cursor,next,String.eq(cursor,next))

# An attempt with closed input keeps its current forwarding cursor.
def pending_live(db: String, player: String, handle: U32, attempt: String, cursor: String, closed: U32) -> IO(String):
  match closed:
    case 0: pending(db,player,handle,attempt,cursor)
    case other: IO.pure(String,cursor)

def continued(db: String, player: String, +handle: U32, +attempt: String, cursor: String, ended: Bool, monitor: Bool) -> IO(String):
  match ended:
    case True{}: match monitor:
      case True{}: IO.pure(String,cursor)
      case False{}: do IO<String>:
        closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
        IO.pure(String,cursor)
    case False{}: do IO<String>:
      closed : U32 <- IO.try(U32,P.ProcessChild.input_closed(handle))
      pending_live(db,player,handle,attempt,cursor,closed)

# A commit notice drains guidance while this native attempt accepts input.
@unsafe
def drain_pending(+db: String, +player: String, +handle: U32, +attempt: String, +cursor: String) -> IO(String):
  do IO<String>:
    +next : String <- continued(db,player,handle,attempt,cursor,False{},False{})
    Bool.pick(IO(String),String.eq(next,cursor),IO.pure(String,cursor),drain_pending(db,player,handle,attempt,next))

def awake_pending(+db: String, player: String, handle: U32, +attempt: String, +cursor: String, woke: Bool) -> IO(String):
  match woke:
    case False{}: IO.pure(String,cursor)
    case True{}: do IO<String>:
      start : String <- replay_cursor(db,attempt,cursor)
      drain_pending(db,player,handle,attempt,start)

def terminal_sql(+value: String) -> String:
  "SELECT CASE WHEN " ++ C.terminal(value) ++ " THEN 1 ELSE 0 END;"

def terminal_span_sql(+value: String) -> String:
  "SELECT CASE WHEN " ++ C.terminal_span(value) ++ " THEN 1 ELSE 0 END;"

def observe_text(+db: String, +player: String, handle: U32, +attempt: String, +line: String, +cursor: String, monitor: Bool) -> IO(String):
  do IO<String>:
    ended : String <- IO.try(String,DB.Sql.query(db,terminal_sql(line)))
    continued(db,player,handle,attempt,cursor,String.eq(ended,"1\n"),monitor)

def observe_span(+db: String, +player: String, handle: U32, +attempt: String, +spool: String, +offset: String, +length: String, +cursor: String, monitor: Bool) -> IO(String):
  do IO<String>:
    ended : String <- IO.try(String,DB.Sql.query_span(db,spool,offset,length,terminal_span_sql("?1")))
    continued(db,player,handle,attempt,cursor,String.eq(ended,"1\n"),monitor)

def observe_decoded(+db: String, +player: String, handle: U32, +attempt: String, decoded: Frame.FrameDecoded, cursor: String, monitor: Bool) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: observe_text(db,player,handle,attempt,line,cursor,monitor)
    case Frame.SpanFrame{spool,offset,length}: observe_span(db,player,handle,attempt,spool,offset,length,cursor,monitor)
    case Frame.InvalidFrame{line}: IO.pure(String,cursor)

# Native responses remain in the observed stream. Terminal frames close stdin
# for the process owner; monitor observers preserve input ownership.
def observe(+db: String, +player: String, handle: U32, +attempt: String, decoded: Frame.FrameDecoded, +line: String, cursor: String, enabled: Bool, monitor: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,cursor)
    case True{}: observe_decoded(db,player,handle,attempt,decoded,cursor,monitor)
