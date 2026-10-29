import Base
import ../coordinator/commands.bend as C
import ./agent-input.bend as AgentInput
import ../coordinator/message-status.bend as Status
import ../host/sqlite.bend as DB
import ../host/process.bend as P
import ../host/text.bend as Text
import ../host/files.bend as Files
import ../git/text.bend as Tx

import ./../coordinator/frame-span.bend as Frame

def relevant(+kind: String, omp: Bool) -> Bool:
  Bool.or(Bool.not(omp),Bool.or(String.eq(kind,"response\n"),
    Bool.or(String.eq(kind,"message_end\n"),Bool.or(String.eq(kind,"tool_execution_start\n"),
    Bool.or(String.eq(kind,"tool_execution_end\n"),String.eq(kind,"agent_end\n"))))))

# The highest message sequence this attempt already forwarded, in
# <attempt>/guidance-forwarded. A rejected observer checkpoint replays the
# observation spool from its beginning; this journal keeps that replay from
# writing a steer frame the native stdin already carried. The message read is
# recorded separately after the native write succeeds.
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

# The frame a forwarded message becomes. OMP reads a steer frame; Claude Code
# reads a stream-json user frame carrying the complete message text (#1298).
def frame_sql(+next: String) -> String:
  +complete = Status.complete_message_sql("id","kind","sender","body")
  "SELECT CASE WHEN coalesce((SELECT harness FROM sessions WHERE id=messages.recipient),'')='claude-code' THEN json_object('type','user','message',json_object('role','user','content'," ++ complete ++ ")) ELSE json_object('type','steer','id',id,'message'," ++ complete ++ ") END FROM messages WHERE seq=CAST(" ++ C.q(next) ++ " AS INTEGER);"

# The read row follows a successful write, so a crash between the two can only
# forward the message again. A write the native's closed stdin refuses records
# nothing and leaves the cursor and the owed row where they were; the normal wake
# path delivers the message (#1298).
def forwarded(+db: String, +player: String, +attempt: String, cursor: String, +next: String, written: Result<&1,&1,U32 & String,Unit>) -> IO(String):
  match written:
    case Fail{error}: IO.pure(String,cursor)
    case Done{unit}: do IO<String>:
      recorded : Unit <- AgentInput.forward_read(db,player,next)
      logged : Unit <- record_forwarded(attempt,next)
      IO.pure(String,next)

def send(+db: String, +player: String, handle: U32, +attempt: String, cursor: String, +next: String, same: Bool) -> IO(String):
  match same:
    case True{}: IO.pure(String,cursor)
    case False{}: do IO<String>:
      frame : String <- IO.try(String,DB.Sql.query(db,frame_sql(next)))
      written : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.write(handle,frame)
      forwarded(db,player,attempt,cursor,next,written)

# Forwarded input is read by its recipient when the write succeeds. The send
# cursor records which messages this attempt has already forwarded.
def outstanding_sql(+player: String) -> String:
  "coalesce((SELECT group_concat(id,',') FROM (SELECT id FROM messages WHERE recipient=" ++ C.q(player) ++ " AND " ++ C.owed_sql("messages") ++ " AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " ORDER BY seq)),'')"

def pending_sql(+player: String, +cursor: String) -> String:
  "SELECT coalesce((SELECT seq FROM messages WHERE recipient=" ++ C.q(player) ++ " AND " ++ C.owed_sql("messages") ++ " AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ " AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq LIMIT 1),CAST(" ++ C.q(cursor) ++ " AS INTEGER));"

def pending(+db: String, +player: String, handle: U32, +attempt: String, +cursor: String) -> IO(String):
  do IO<String>:
    +next : String <- IO.try(String,DB.Sql.query(db,pending_sql(player,cursor)))
    send(db,player,handle,attempt,cursor,next,String.eq(cursor,next))

# An attempt with closed input keeps its current forwarding cursor.
def pending_live(db: String, player: String, handle: U32, attempt: String, cursor: String, closed: U32) -> IO(String):
  match closed:
    case 0: pending(db,player,handle,attempt,cursor)
    case other: IO.pure(String,cursor)

# Claude Code keeps stdin open after its first prompt (#1298). Once a result has
# been seen, owed input is written to stdin as it arrives. Stdin closes when the
# native announces no background task: the mode is "hold" while its latest
# background_tasks_changed lists tasks, "drain" when it lists none (owed input is
# written, then stdin closes), and empty for every other harness and for a Claude
# Code native that has not ended a turn, where hooks deliver owed input.
def claude_mode(claude: Bool, settled: Bool, background: Bool) -> String:
  Bool.pick(String,Bool.and(claude,settled),Bool.pick(String,background,"hold","drain"),"")

# The native's own list of background tasks: '1' when the frame lists tasks, '0'
# when it lists none, empty for any other frame.
def background_sql(+value: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ value ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN json_extract(value,'$.type')='system' AND json_extract(value,'$.subtype')='background_tasks_changed' THEN CASE WHEN coalesce(json_array_length(json_extract(value,'$.tasks')),0)>0 THEN '1' ELSE '0' END ELSE '' END ELSE '' END FROM frame;"

def background_decoded(+db: String, decoded: Frame.FrameDecoded) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: IO.try(String,DB.Sql.query(db,background_sql(C.q(line))))
    case Frame.SpanFrame{spool,offset,length}: IO.try(String,DB.Sql.query_span(db,spool,offset,length,background_sql("?1")))
    case Frame.InvalidFrame{line}: IO.pure(String,"")

def background_next(+observed: String, previous: String) -> String:
  Bool.pick(String,String.is_empty(Tx.trim_nl(observed)),previous,Tx.trim_nl(observed))

# The background state after one frame, kept in the observer state's text field:
# '1' while tasks are listed, '0' once none are, unchanged by other frames.
def background_after(+db: String, decoded: Frame.FrameDecoded, previous: String, claude: Bool) -> IO(String):
  match claude:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      observed : String <- background_decoded(db,decoded)
      IO.pure(String,background_next(observed,previous))

def background_live(state: String) -> Bool:
  String.eq(state,"1")

# The latest task list in the retained stdout, read from the file so that an
# observer which did not see the earlier frames (a recovery observer replaying
# from its checkpoint) closes on the native's current list and not on a list it
# passed on the way. The result is '0' when the list names no task, '1' when it
# names tasks, 'none' when no list was ever written and '?' when the file or its
# last list cannot be read.
def spool_background_sql() -> String:
  "WITH s(v) AS (SELECT replace(?1,'\"subtype\":\"background_tasks_changed\"',char(1))), "
  ++ "t(tail) AS (SELECT replace(v,rtrim(v,replace(v,char(1),'')),'') FROM s), "
  ++ "f(value) AS (SELECT '{\"type\":\"system\",\"subtype\":\"background_tasks_changed\"' || substr(tail,1,instr(tail || char(10),char(10))-1) AS value FROM t) "
  ++ "SELECT CASE WHEN instr((SELECT v FROM s),char(1))=0 THEN 'none' WHEN json_valid(value) THEN CASE WHEN coalesce(json_array_length(json_extract(value,'$.tasks')),0)>0 THEN '1' ELSE '0' END ELSE '?' END FROM f;"

def spool_background_text(read: Result<&1,&1,U32 & String,String>) -> String:
  match read:
    case Fail{error}: "?"
    case Done{text}: Tx.trim_nl(text)

def spool_background_sized(+db: String, +spool: String, sized: Result<&1,&1,U32 & String,U32>) -> IO(String):
  match sized:
    case Fail{error}: IO.pure(String,"?")
    case Done{size}: do IO<String>:
      read : Result<&1,&1,U32 & String,String> <- DB.Sql.query_span(db,spool,"0",U32.show(size),spool_background_sql())
      IO.pure(String,spool_background_text(read))

def spool_background(+db: String, +spool: String) -> IO(String):
  do IO<String>:
    sized : Result<&1,&1,U32 & String,U32> <- Files.Files.size(spool)
    spool_background_sized(db,spool,sized)

# Stdin closes only when the stdout file agrees with the observer's state.
def background_clear(+state: String) -> Bool:
  Bool.or(String.eq(state,"0"),String.eq(state,"none"))

# Forwards every owed message while stdin is open; a closed stdin forwards none.
@unsafe
def forward_all(+db: String, +player: String, +handle: U32, +attempt: String, +cursor: String) -> IO(String):
  do IO<String>:
    closed : U32 <- IO.try(U32,P.ProcessChild.input_closed(handle))
    +next : String <- pending_live(db,player,handle,attempt,cursor,closed)
    Bool.pick(IO(String),String.eq(next,cursor),IO.pure(String,cursor),forward_all(db,player,handle,attempt,next))

def close_confirmed(+db: String, +spool: String, +handle: U32) -> IO(Unit):
  do IO<Unit>:
    state : String <- spool_background(db,spool)
    Bool.pick(IO(Unit),background_clear(state),IO.try(Unit,P.ProcessChild.close_stdin(handle)),IO.pure(Unit,Unit{}))

# Monitor observers preserve input ownership and never close stdin. Other
# observers close an open stdin once the stdout file's latest task list is empty.
def close_open(+db: String, +spool: String, +handle: U32, monitor: Bool) -> IO(Unit):
  match monitor:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      closed : U32 <- IO.try(U32,P.ProcessChild.input_closed(handle))
      Bool.pick(IO(Unit),U32.is_eq(closed,0),close_confirmed(db,spool,handle),IO.pure(Unit,Unit{}))

def continued_plain(db: String, player: String, +handle: U32, +attempt: String, cursor: String, ended: Bool, monitor: Bool) -> IO(String):
  match ended:
    case True{}: match monitor:
      case True{}: IO.pure(String,cursor)
      case False{}: do IO<String>:
        closed : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
        IO.pure(String,cursor)
    case False{}: do IO<String>:
      closed : U32 <- IO.try(U32,P.ProcessChild.input_closed(handle))
      pending_live(db,player,handle,attempt,cursor,closed)

def continued(db: String, player: String, +handle: U32, +attempt: String, +cursor: String, +spool: String, ended: Bool, mode: String, monitor: Bool) -> IO(String):
  match mode:
    case "hold": forward_all(db,player,handle,attempt,cursor)
    case "drain": do IO<String>:
      +drained : String <- forward_all(db,player,handle,attempt,cursor)
      shut : Unit <- close_open(db,spool,handle,monitor)
      IO.pure(String,drained)
    case other: continued_plain(db,player,handle,attempt,cursor,ended,monitor)

# A commit notice drains guidance while this native attempt accepts input.
@unsafe
def drain_pending(+db: String, +player: String, +handle: U32, +attempt: String, +cursor: String) -> IO(String):
  do IO<String>:
    +next : String <- continued_plain(db,player,handle,attempt,cursor,False{},False{})
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

def observe_text(+db: String, +player: String, handle: U32, +attempt: String, +line: String, +cursor: String, +spool: String, mode: String, monitor: Bool) -> IO(String):
  do IO<String>:
    ended : String <- IO.try(String,DB.Sql.query(db,terminal_sql(line)))
    continued(db,player,handle,attempt,cursor,spool,String.eq(ended,"1\n"),mode,monitor)

def observe_span(+db: String, +player: String, handle: U32, +attempt: String, +spool: String, +offset: String, +length: String, +cursor: String, mode: String, monitor: Bool) -> IO(String):
  do IO<String>:
    ended : String <- IO.try(String,DB.Sql.query_span(db,spool,offset,length,terminal_span_sql("?1")))
    continued(db,player,handle,attempt,cursor,spool,String.eq(ended,"1\n"),mode,monitor)

def observe_decoded(+db: String, +player: String, handle: U32, +attempt: String, decoded: Frame.FrameDecoded, cursor: String, +stdout: String, mode: String, monitor: Bool) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: observe_text(db,player,handle,attempt,line,cursor,stdout,mode,monitor)
    case Frame.SpanFrame{spool,offset,length}: observe_span(db,player,handle,attempt,spool,offset,length,cursor,mode,monitor)
    case Frame.InvalidFrame{line}: IO.pure(String,cursor)

# Native responses remain in the observed stream. Terminal frames close stdin
# for the process owner; monitor observers preserve input ownership.
def observe(+db: String, +player: String, handle: U32, +attempt: String, decoded: Frame.FrameDecoded, +line: String, cursor: String, +stdout: String, enabled: Bool, mode: String, monitor: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,cursor)
    case True{}: observe_decoded(db,player,handle,attempt,decoded,cursor,stdout,mode,monitor)
