import Base
import ./commands.bend as C
import ./store.bend as Store
import ./stop.bend as Stop
import ./delivery.bend as Delivery
import ../host/session-lock.bend as Lock
import ./guidance.bend as Guidance
import ./native-requests.bend as NativeRequests
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../host/process.bend as P
import ../git/text.bend as Tx
import ../harness/claude-player.bend as Claude
import ../harness/omp-player.bend as Omp
import ../harness/muse-player.bend as Muse
import ../harness/codex-player.bend as Codex
import ../git/process.bend as GitProc
import ../git/types.bend as G

type Outcome is Data:
  Ended{status: String, event: String, error: String}

def error_text(error: U32 & String) -> String:
  (code,text)=error
  U32.show(code) ++ ": " ++ text

def remember(+previous: String, result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: Bool.pick(String,String.is_empty(previous),error_text(error),previous)
    case Done{value}: previous

def remember_write(previous: String, result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Fail{error}: remember(previous,Fail{error})
    case Done{unit}: previous

# The stored report and native outcome retain the failure or recovery note.
# Its stdout copy is best effort and cannot interrupt native completion.
def report(db: String, player: String, id: String, body: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.commit(db,C.Report{id,player,body}))
    written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)
    IO.pure(Unit,Unit{})

def diagnostic(db: String, player: String, id: String, text: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: report(db,player,id ++ ":observation","Native output observation failed: " ++ text)

def result_missing(db: String, player: String, id: String, log: String, stderr: String, status: String, found: Bool) -> IO(Unit):
  match found:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: report(db,player,id,"Player process ended without a native result (" ++ status ++ "). Output: " ++ log ++ ". Stderr: " ++ stderr)

def exit_failure(db: String, player: String, id: String, status: String, success: Bool) -> IO(Unit):
  match success:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: report(db,player,id ++ ":exit","Player process ended with " ++ status)

def failed(+status: String, +event: String, error: String) -> Bool:
  Bool.or(Bool.not(String.eq(status,"exit 0")),Bool.or(String.is_empty(event),Bool.not(String.is_empty(error))))

def combine(first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: second

def delivery_result(+error: String) -> Result<&1,&1,U32 & String,Unit>:
  Bool.pick(Result<&1,&1,U32 & String,Unit>,String.is_empty(error),Done{Unit{}},Fail{(1,error)})

def prepare_finished(+db: String, +player: String, +id: String, log: String, stderr: String, +error: String, +status: String) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM turns WHERE id=" ++ C.q(id) ++ ";"))
    noted : Unit <- diagnostic(db,player,id,error,String.is_empty(error))
    missing : Unit <- result_missing(db,player,id,log,stderr,status,String.eq(result,"1\n"))
    exit_failure(db,player,id,status,String.eq(status,"exit 0"))

def prepare_player(db: String, player: String, id: String, log: String, stderr: String, error: String, status: String, early: Bool) -> IO(Unit):
  match early:
    case False{}: prepare_finished(db,player,id,log,stderr,error,status)
    case True{}: report(db,player,id,error)

def prepare_parent(db: String, player: String, id: String, log: String, stderr: String, outcome: Outcome, parent: Bool) -> IO(Unit):
  match outcome:
    case Ended{+status,event,error}:
      match parent:
        case False{}: IO.pure(Unit,Unit{})
        case True{}: prepare_player(db,player,id,log,stderr,error,status,Bool.or(String.eq(status,"start failed"),String.eq(status,"input failed")))

# Failure reports are committed while this invocation still owns the session.
def prepare(+db: String, +player: String, id: String, log: String, stderr: String, outcome: Outcome) -> IO(Unit):
  do IO<Unit>:
    recipient : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.report_recipient(C.q(player)) ++ " IS NOT NULL;"))
    prepare_parent(db,player,id,log,stderr,outcome,String.eq(recipient,"1\n"))

def record_exit(db: String, player: String, id: String, log: String, outcome: Outcome) -> IO(Unit):
  match outcome:
    case Ended{status,event,error}: Stop.exited(db,player,id,status,event,error,log)

def player_finished(+db: String, player: String, +id: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
    diagnostic_delivery : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id ++ ":observation","1","")
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id,"1",saved)
    exit_delivery : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id ++ ":exit","1","")
    stopped : Result<&1,&1,U32 & String,Unit> <- Stop.deliver(db,player,id)
    written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)
    IO.pure(Result<&1,&1,U32 & String,Unit>,combine(delivery_result(remember(remember(remember("",diagnostic_delivery),delivered),exit_delivery)),combine(stopped,written)))

def finish_parent(db: String, player: String, id: String, log: String, outcome: Outcome, parent: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match outcome:
    case Ended{+status,+event,error}:
      match parent:
        case True{}: player_finished(db,player,id)
        case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
          output : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(player) ++ ",'status'," ++ C.q(status) ++ ",'event',CASE WHEN " ++ C.q(event) ++ "='' THEN NULL ELSE json(" ++ C.q(event) ++ ") END,'error'," ++ C.q(error) ++ ");"))
          T.Text.control_output(output)

def finish(+db: String, +player: String, id: String, log: String, outcome: Outcome) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recipient : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.report_recipient(C.q(player)) ++ " IS NOT NULL;"))
    finish_parent(db,player,id,log,outcome,String.eq(recipient,"1\n"))

def status_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: "wait failed: " ++ error_text(error)
    case Done{status}: status

def send_result(first: Result<&1,&1,U32 & String,Unit>, closed: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: closed

def input(+handle: U32, +prompt: String, +harness: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"omp\n"),
    Omp.input(handle,prompt),
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"muse\n"),
    Muse.input(handle,prompt),
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"codex\n"),
    Codex.input(handle,prompt),
    Claude.input(handle,prompt))))

def close_input(handle: U32, open: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match open:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: P.ProcessChild.close_stdin(handle)

def send_prompt(+handle: U32,prompt: String,+harness: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    sent : Result<&1,&1,U32 & String,Unit> <- input(handle,prompt,harness)
    closed : Result<&1,&1,U32 & String,Unit> <- close_input(handle,String.eq(harness,"omp\n"))
    IO.pure(Result<&1,&1,U32 & String,Unit>,send_result(sent,closed))

def codex_report(db: String, player: String, id: String, event: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      saved : String <- IO.try(String,Store.commit(db,C.Observe{id,player,event,False{}}))
      IO.pure(Unit,Unit{})

def codex_result_sql(source: String) -> String:
  +events = "'[' || replace(trim(" ++ C.q(source) ++ ",char(10)),char(10),',') || ']'"
  "SELECT json_object('type','result','is_error',json_extract(e.value,'$.type')='turn.failed','nativeEvent',json(e.value),'result',CASE WHEN json_extract(e.value,'$.type')='turn.failed' THEN json_extract(e.value,'$.error.message') ELSE (SELECT json_extract(m.value,'$.item.text') FROM json_each(" ++ events ++ ") m WHERE m.key<e.key AND json_extract(m.value,'$.type')='item.completed' AND json_extract(m.value,'$.item.type')='agent_message' ORDER BY m.key DESC LIMIT 1) END) FROM json_each(" ++ events ++ ") e WHERE json_extract(e.value,'$.type') IN ('turn.completed','turn.failed') ORDER BY e.key DESC LIMIT 1;"

# Keep this invocation's latest Codex assistant message and terminal event.
def codex_finished(+db: String, player: String, id: String, source: String, previous: String, codex: Bool) -> IO(String):
  match codex:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      +event : String <- IO.try(String,DB.Sql.query(db,codex_result_sql(source)))
      saved : Unit <- codex_report(db,player,id,event,String.is_empty(event))
      IO.pure(String,event)

# The live issue-608-reclaim turn emitted its report in message_end, then an
# agent_end with messages=[] and messageCount=352. Keep the latest assistant
# message in this reader and use it when the terminal envelope omits messages.
# The native log keeps both original frames.
def omp_message(db: String, +event: String, previous: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      message : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='message_end' AND json_extract(" ++ C.q(event) ++ ",'$.message.role')='assistant' THEN json_extract(" ++ C.q(event) ++ ",'$.message') ELSE " ++ C.q(previous) ++ " END;"))
      IO.pure(String,Tx.trim_nl(message))

# The assistant activity this attempt's stream has carried, in order: one entry
# per assistant message_start or message_end frame, with its kind and the
# response it names when it names one. An assistant frame that names no response
# still records its kind, because a later activity of any identity ends the
# authority of the retained completion. Native output that is not JSON, and any
# frame that is not an assistant activity, leave the retained state alone.
def omp_activity_sql(+event: String, +previous: String) -> String:
  "SELECT CASE WHEN CASE WHEN json_valid(" ++ C.q(event) ++ ") AND json_extract(" ++ C.q(event) ++ ",'$.type') IN ('message_start','message_end') AND json_extract(" ++ C.q(event) ++ ",'$.message.role')='assistant' THEN json_object('kind',json_extract(" ++ C.q(event) ++ ",'$.type'),'id',coalesce(json_extract(" ++ C.q(event) ++ ",'$.message.responseId'),'')) END IS NOT NULL THEN json_insert(CASE WHEN json_valid(" ++ C.q(previous) ++ ") AND json_type(" ++ C.q(previous) ++ ")='array' THEN " ++ C.q(previous) ++ " ELSE json_array() END,'$[#]',json(CASE WHEN json_valid(" ++ C.q(event) ++ ") AND json_extract(" ++ C.q(event) ++ ",'$.type') IN ('message_start','message_end') AND json_extract(" ++ C.q(event) ++ ",'$.message.role')='assistant' THEN json_object('kind',json_extract(" ++ C.q(event) ++ ",'$.type'),'id',coalesce(json_extract(" ++ C.q(event) ++ ",'$.message.responseId'),'')) END)) ELSE CASE WHEN json_valid(" ++ C.q(previous) ++ ") AND json_type(" ++ C.q(previous) ++ ")='array' THEN " ++ C.q(previous) ++ " ELSE json_array() END END;"

def omp_activity(db: String, +event: String, previous: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      +activity : String <- IO.try(String,DB.Sql.query(db,omp_activity_sql(event,previous)))
      IO.pure(String,Tx.trim_nl(activity))

def omp_activity_enabled(harness: String) -> Bool:
  String.eq(harness,"omp\n")

def omp_terminal_enabled(harness: String, relevant: Bool) -> Bool:
  Bool.and(String.eq(harness,"omp\n"),relevant)

# The terminal's own message list, or an empty list when the frame carries none.
def omp_transcript_sql(+event: String) -> String:
  "CASE WHEN coalesce(json_type(" ++ C.q(event) ++ ",'$.messages'),'')='array' THEN " ++ C.q(event) ++ " ELSE json_object('messages',json_array()) END"

# A terminal whose own list is absent, empty or ends in something other than an
# assistant message.
def omp_terminal_elided_sql(+event: String) -> String:
  "json_extract(" ++ C.q(event) ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ C.q(event) ++ ",'$.isTerminal'),1)=1 AND (coalesce(json_array_length(" ++ C.q(event) ++ ",'$.messages'),0)=0 OR (SELECT CASE WHEN CASE WHEN t.type='object' THEN json_extract(t.value,'$.role') END='assistant' THEN 0 ELSE 1 END FROM json_each(" ++ omp_transcript_sql(event) ++ ",'$.messages') t ORDER BY t.key DESC LIMIT 1)=1)"

# Whether the terminal's own last assistant carries a provider error, and which
# response that assistant names.
def omp_terminal_error_sql(+event: String) -> String:
  "coalesce((SELECT CASE WHEN CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' THEN CASE WHEN json_extract(a.value,'$.stopReason')='error' THEN 1 ELSE 0 END ELSE 0 END FROM json_each(" ++ omp_transcript_sql(event) ++ ",'$.messages') a WHERE CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' ORDER BY a.key DESC LIMIT 1),0)"

def omp_terminal_error_id_sql(+event: String) -> String:
  "coalesce((SELECT CASE WHEN CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' THEN json_extract(a.value,'$.responseId') END FROM json_each(" ++ omp_transcript_sql(event) ++ ",'$.messages') a WHERE CASE WHEN a.type='object' THEN json_extract(a.value,'$.role') END='assistant' ORDER BY a.key DESC LIMIT 1),'')"

def omp_terminal_retained_sql(+event: String, +message: String) -> String:
  "CASE WHEN " ++ C.q(message) ++ "<>'' THEN json_set(" ++ C.q(event) ++ ",'$.messages',json_array(json(" ++ C.q(message) ++ "))) ELSE " ++ C.q(event) ++ " END"

def omp_terminal_conflict_sql(+event: String) -> String:
  "json_set(" ++ C.q(event) ++ ",'$.messages',json_array())"

# The last assistant activity the stream reached, and whether it is the
# completion the receive retained.
def omp_activity_last_sql(+activity: String) -> String:
  "CASE WHEN json_valid(" ++ C.q(activity) ++ ") AND json_type(" ++ C.q(activity) ++ ")='array' AND json_array_length(" ++ C.q(activity) ++ ")>0 THEN json_extract(" ++ C.q(activity) ++ ",'$[#-1]') ELSE json_object('kind','','id','') END"

def omp_activity_commanding_sql(+activity: String) -> String:
  "CASE WHEN coalesce(json_extract(" ++ omp_activity_last_sql(activity) ++ ",'$.kind'),'')='message_end' THEN 1 ELSE 0 END"

def omp_activity_seen_sql(+activity: String, +error_id: String) -> String:
  "CASE WHEN " ++ error_id ++ "<>'' AND json_valid(" ++ C.q(activity) ++ ") AND json_type(" ++ C.q(activity) ++ ")='array' AND EXISTS(SELECT 1 FROM json_each(" ++ C.q(activity) ++ ") o WHERE coalesce(json_extract(o.value,'$.id'),'')=" ++ error_id ++ ") THEN 1 ELSE 0 END"

def omp_activity_same_sql(+activity: String, +message: String) -> String:
  "CASE WHEN coalesce(json_extract(" ++ omp_activity_last_sql(activity) ++ ",'$.id'),'')<>'' AND " ++ C.q(message) ++ "<>'' AND coalesce(json_extract(" ++ omp_activity_last_sql(activity) ++ ",'$.id'),'')=coalesce(json_extract(" ++ C.q(message) ++ ",'$.responseId'),'') THEN 1 ELSE 0 END"

# The stream observed the terminal's error and then reached the retained
# completion, which is the only case where that completion replaces the error.
def omp_terminal_justified_sql(+activity: String, +message: String, +error_id: String) -> String:
  "CASE WHEN " ++ omp_activity_commanding_sql(activity) ++ "=1 AND " ++ omp_activity_same_sql(activity,message) ++ "=1 AND " ++ omp_activity_seen_sql(activity,error_id) ++ "=1 THEN 1 ELSE 0 END"

# Whether the terminal's own last assistant error is the activity the stream
# reached last, which keeps the terminal's own list.
def omp_terminal_named_sql(+activity: String, +error_id: String) -> String:
  "CASE WHEN " ++ error_id ++ "<>'' AND coalesce(json_extract(" ++ omp_activity_last_sql(activity) ++ ",'$.id'),'')=" ++ error_id ++ " THEN 1 ELSE 0 END"

def omp_terminal_sql(+event: String, +message: String, +activity: String) -> String:
  "SELECT CASE WHEN " ++ omp_terminal_elided_sql(event) ++ " THEN CASE WHEN " ++ omp_terminal_error_sql(event) ++ "=0 AND " ++ C.q(message) ++ "<>'' AND " ++ omp_activity_commanding_sql(activity) ++ "=1 THEN " ++ omp_terminal_retained_sql(event,message) ++ " WHEN " ++ omp_terminal_justified_sql(activity,message,omp_terminal_error_id_sql(event)) ++ "=1 THEN " ++ omp_terminal_retained_sql(event,message) ++ " WHEN " ++ omp_terminal_named_sql(activity,omp_terminal_error_id_sql(event)) ++ "=1 THEN " ++ C.q(event) ++ " WHEN " ++ C.q(message) ++ "<>'' THEN " ++ omp_terminal_conflict_sql(event) ++ " WHEN " ++ omp_terminal_error_sql(event) ++ "=1 THEN " ++ omp_terminal_conflict_sql(event) ++ " ELSE " ++ C.q(event) ++ " END ELSE " ++ C.q(event) ++ " END;"

def omp_terminal(db: String, +event: String, +message: String, +activity: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,event)
    case True{}: do IO<String>:
      normalized : String <- IO.try(String,DB.Sql.query(db,omp_terminal_sql(event,message,activity)))
      IO.pure(String,Tx.trim_nl(normalized))

# The frame step the native loop runs for every line: which frames update the
# retained message, which update the assistant activity, and what the terminal
# normalizer is handed. The loop calls these wrappers, so the composition and its
# gates that the laws bind are the ones the runtime runs.
def omp_retained_message(+db: String, +harness: String, +line: String, previous: String, relevant: Bool) -> IO(String):
  omp_message(db,line,previous,omp_terminal_enabled(harness,relevant))

def omp_retained_activity(+db: String, +harness: String, +line: String, previous: String) -> IO(String):
  omp_activity(db,line,previous,omp_activity_enabled(harness))

def omp_normalized_step(+db: String, +harness: String, +line: String, message: String, +activity: String, relevant: Bool) -> IO(String):
  omp_terminal(db,line,message,activity,omp_terminal_enabled(harness,relevant))

def observe_event(db: String, player: String, id: String, line: String, relevant: Bool, sealed: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match relevant:
    case True{}: Store.commit(db,C.Observe{id,player,line,sealed})
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})

# A terminal that completes after the managed completion was sealed cannot be
# recorded as a report under the sealed identity: the first terminal stays the
# report of this receive attempt, and a later episode is named once in the
# separate diagnostic with the guidance it leaves for the next receive.
def deferred_terminal_sql(+event: String, +terminal: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ C.q(event) ++ "='' THEN 0 WHEN " ++ C.q(terminal) ++ "='' THEN 0 WHEN " ++ C.q(event) ++ "=" ++ C.q(terminal) ++ " THEN 0 WHEN " ++ C.terminal(event) ++ " THEN 1 ELSE 0 END ELSE 0 END;"

# The note is written once: a later terminal frame must not try a second body
# under the same identity, which the same-identity store guard would refuse.
# The presence decision reads the note identity alone, so no message identity
# can name it.
def deferred_recorded_sql(+id: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":deferred") ++ ") THEN 1 ELSE 0 END;"

def deferred_pending_sql(+player: String) -> String:
  "SELECT " ++ Guidance.outstanding_sql(player) ++ ";"

def deferred_pending(+pending: String) -> String:
  Bool.pick(String,String.is_empty(pending),""," and the deferred guidance " ++ pending ++ " stays pending for the next receive")

def deferred_text(id: String, pending: String) -> String:
  "A later native terminal completed after the report " ++ id ++ " was sealed; the episode is retained in the native log" ++ deferred_pending(pending) ++ "."

def write_deferred(+db: String, +player: String, +id: String, recorded: Bool) -> IO(Unit):
  match recorded:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      +pending : String <- IO.try(String,DB.Sql.query(db,deferred_pending_sql(player)))
      noted : Unit <- report(db,player,id ++ ":deferred",deferred_text(id,Tx.trim_nl(pending)))
      IO.pure(Unit,Unit{})

def record_deferred(+db: String, +player: String, +id: String, later: Bool) -> IO(Unit):
  match later:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      presence : String <- IO.try(String,DB.Sql.query(db,deferred_recorded_sql(id)))
      written : Unit <- write_deferred(db,player,id,String.eq(presence,"1\n"))
      IO.pure(Unit,Unit{})

def deferred_note(+db: String, player: String, id: String, +event: String, +terminal: String, sealed: Bool) -> IO(Unit):
  match sealed:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      later : String <- IO.try(String,DB.Sql.query(db,deferred_terminal_sql(event,terminal)))
      noted : Unit <- record_deferred(db,player,id,String.eq(later,"1\n"))
      IO.pure(Unit,Unit{})

def append_frame(log: String, line: String, keep: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match keep:
    case True{}: T.Text.append(log,line ++ "\n")
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

# Read the OMP frame type once for log retention and event observation.
def frame_kind(db: String, line: String, omp: Bool) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(line) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE json_extract(value,'$.type') WHEN 'message_update' THEN 'message_update' WHEN 'response' THEN 'response' WHEN 'message_end' THEN 'message_end' WHEN 'message_start' THEN 'message_start' WHEN 'tool_execution_start' THEN 'tool_execution_start' WHEN 'tool_execution_end' THEN 'tool_execution_end' WHEN 'agent_end' THEN 'agent_end' WHEN 'extension_ui_request' THEN 'extension_ui_request' ELSE '' END ELSE '' END FROM frame;"))

# The live #379 trial filled the disk with OMP's cumulative message_update
# snapshots. message_end supplies the complete message; keep every other frame.
def record_frame(log: String, line: String, kind: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  append_frame(log,line,Bool.not(String.eq(kind,"message_update\n")))

# The projection is active only when the server answered the set_event_filter
# request successfully with the complete requested selection: an explicitly
# echoed null events value forwards every category and a delta messageUpdates
# value replaces accumulated snapshots. A successful answer without that
# selection is unconfirmed, an unsuccessful answer is refused, and a response
# for another command or any other line leaves the turn's mode unchanged. The
# nested CASE keeps json extraction behind the validity check, so unrelated
# non-JSON native output never becomes an observer error.
def filter_mode_sql(+line: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(line) ++ ") THEN CASE WHEN json_extract(" ++ C.q(line) ++ ",'$.type')='response' AND json_extract(" ++ C.q(line) ++ ",'$.id')='baton:filter' AND json_extract(" ++ C.q(line) ++ ",'$.command')='set_event_filter' THEN CASE WHEN json_extract(" ++ C.q(line) ++ ",'$.success')=1 THEN CASE WHEN json_type(" ++ C.q(line) ++ ",'$.data.events')='null' AND json_extract(" ++ C.q(line) ++ ",'$.data.messageUpdates')='delta' THEN 'delta' ELSE 'unconfirmed' END ELSE 'refused' END ELSE '' END ELSE '' END;"

def filter_mode(db: String, +line: String, omp: Bool) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,DB.Sql.query(db,filter_mode_sql(line)))

def record_filter(log: String, +state: String, omp: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match omp:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: append_frame(log,Omp.filter_note(state),True{})

def terminal_event(db: String, +event: String, +previous: String, relevant: Bool) -> IO(String):
  match relevant:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      selected : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ C.terminal(event) ++ " THEN CASE WHEN " ++ C.q(previous) ++ "='' THEN " ++ C.q(event) ++ " ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END;"))
      IO.pure(String,Tx.trim_nl(selected))

def codex_frames(db: String, +previous: String, +line: String, codex: Bool) -> IO(String):
  match codex:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      value : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(line) ++ ") THEN CASE WHEN json_extract(" ++ C.q(line) ++ ",'$.type')='item.completed' AND json_extract(" ++ C.q(line) ++ ",'$.item.type')='agent_message' THEN " ++ C.q(line) ++ " WHEN json_extract(" ++ C.q(line) ++ ",'$.type') IN ('turn.completed','turn.failed') THEN " ++ C.q(previous) ++ " || char(10) || " ++ C.q(line) ++ " ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END;"))
      IO.pure(String,Tx.trim_nl(value))

@unsafe
def consume(+db: String, +player: String, +id: String, +log: String, +handle: U32, +harness: String, cursor: String, last_message: String, last_activity: String, +terminal: String, filter: String, codex_log: String, +first_error: String, sender: Chan(Result<&1,&1,U32 & String,Unit>), +attempt: String, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  match result:
    case Fail{error}: do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
      closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
      sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(Ended{status_text(waited),terminal,"Native output read failed: " ++ error_text(error)},deliveries))
    case Done{None{}}:
      do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
        sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
        status : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
        event : String <- codex_finished(db,player,id,codex_log,terminal,String.eq(harness,"codex\n"))
        noted : Result<&1,&1,U32 & String,Unit> <- record_filter(log,filter,String.eq(harness,"omp\n"))
        closed : Result<&1,&1,U32 & String,String> <- NativeRequests.closed(db,attempt,Bool.not(String.is_empty(attempt)))
        IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(Ended{status_text(status),event,remember(remember_write(remember_write(first_error,sent),noted),closed)},deliveries))
    case Done{Some{+line}}:
      do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
        +kind : String <- frame_kind(db,line,String.eq(harness,"omp\n"))
        written : Result<&1,&1,U32 & String,Unit> <- record_frame(log,line,kind)
        +relevant : Bool <- IO.pure(Bool,Guidance.relevant(kind,String.eq(harness,"omp\n")))
        +sealed : Bool <- IO.pure(Bool,Bool.not(String.is_empty(terminal)))
        next_cursor : String <- Guidance.observe(db,player,handle,line,cursor,Bool.and(String.eq(harness,"omp\n"),relevant),sealed)
        +message : String <- omp_retained_message(db,harness,line,last_message,relevant)
        +activity : String <- omp_retained_activity(db,harness,line,last_activity)
        +event : String <- omp_normalized_step(db,harness,line,message,activity,relevant)
        deferred : Unit <- deferred_note(db,player,id,event,terminal,sealed)
        observed : Result<&1,&1,U32 & String,String> <- observe_event(db,player,id,event,relevant,sealed)
        ended : String <- terminal_event(db,event,terminal,relevant)
        codex_state : String <- codex_frames(db,codex_log,line,String.eq(harness,"codex\n"))
        questions : List<Chan(Result<&1,&1,U32 & String,String>)> & String <- NativeRequests.observe(db,player,id,attempt,line,deliveries,Bool.and(Bool.not(String.is_empty(attempt)),String.eq(kind,"extension_ui_request\n")))
        +mode : String <- filter_mode(db,line,String.eq(harness,"omp\n"))
        +next_filter : String <- IO.pure(String,Omp.filter_next(filter,Tx.trim_nl(mode)))
        NativeRequests.with_observation(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,questions,wakes => question_error => do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
          next : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
          consume(db,player,id,log,handle,harness,next_cursor,message,activity,ended,next_filter,codex_state,remember(remember_write(Bool.pick(String,String.is_empty(first_error),question_error,first_error),written),observed),sender,attempt,wakes,next))

def direct_observed(observation: Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>) -> IO(Outcome):
  (outcome,deliveries)=observation
  do IO<Outcome>:
    settled : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    IO.pure(Outcome,outcome)

def started(+db: String, +player: String, +id: String, +log: String, prompt: String, +harness: String, result: Result<&1,&1,U32 & String,U32>) -> IO(Outcome):
  match result:
    case Fail{error}: IO.pure(Outcome,Ended{"start failed","","Player process could not start: " ++ error_text(error)})
    case Done{+handle}:
      do IO<Outcome>:
        sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,send_prompt(handle,prompt,harness))
        first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
        observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- consume(db,player,id,log,handle,harness,"0\n","","","","","","",sender,"",Nil{},first)
        direct_observed(observation)

# The retained process sends its initial input once. Reattachment reads the same
# attempt from its first frame so native completion can be reconstructed.
def retained_output(db: String, player: String, id: String, log: String, +harness: String, attempt: String, +handle: U32) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
    sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
    consume(db,player,id,log,handle,harness,"0\n","","","","","","",sender,attempt,Nil{},first)

def retained(+db: String, +player: String, +directory: String, +cmd: String, +model: String, +effort: String, cwd: String, +session: String, +harness: String, +sessions: String, +prompt: String, lock: U32, recovery: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
    alternate : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(sessions) ++ "=" ++ C.q(db ++ ".sessions") ++ " THEN CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END ELSE " ++ C.q(db ++ ".sessions") ++ " END FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    +native : String <- Omp.resume_file(sessions,Tx.trim_nl(alternate),session,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(session))))
    args : String <- IO.pure(String,Bool.pick(String,String.eq(harness,"omp\n"),Omp.argv(cmd,model,effort,sessions,native,String.is_empty(native)),Codex.argv(cmd,model,effort,native,String.is_empty(native))))
    input : String <- IO.pure(String,Bool.pick(String,String.eq(harness,"omp\n"),Omp.prompt(prompt),prompt))
    P.ProcessChild.retain(directory,args,cwd,directory ++ "/native.stderr",input,Bool.pick(U32,String.eq(harness,"omp\n"),1,0),lock,recovery)

def claude_launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Claude.start_player(cmd,model,effort,cwd,stderr)
    case False{}: Claude.resume_player(cmd,model,effort,cwd,stderr,session)

def muse_launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Muse.start_player(cmd,model,effort,cwd,stderr,task)
    case False{}: Muse.resume_player(cmd,model,effort,cwd,stderr,session,task)

def launch(sessions: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +session: String, +harness: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"omp\n"),
    Omp.start_player(cmd,model,effort,cwd,log,sessions,session,String.is_empty(session)),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"muse\n"),
    muse_launch(cmd,model,effort,cwd,log ++ ".stderr",session,task,String.is_empty(session)),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"codex\n"),
    Codex.start_player(cmd,model,effort,cwd,log ++ ".stderr",session,String.is_empty(session)),
    claude_launch(cmd,model,effort,cwd,log ++ ".stderr",session,String.is_empty(session)))))

# The state the workspace holds when a turn restarts: the work an interrupted
# turn had already written.
def state_note_go(g: G.GitOut, +cwd: String) -> String:
  match g:
    case G.GRun{code, out}:
      +o2 = out
      Bool.pick(String, Tx.non_empty(o2),
        "The workspace at " ++ cwd ++ " holds uncommitted changes:\n" ++ Tx.trim_nl(o2),
        "The workspace at " ++ cwd ++ " holds no uncommitted changes.")
    case G.GBroken{detail}: "The workspace at " ++ cwd ++ " could not be read for its changes: " ++ detail

def state_note(cwd: String) -> IO(String):
  +c2 = cwd
  do IO<String>:
    g : G.GitOut <- GitProc.runGit(c2, ["status", "--porcelain"])
    IO.pure(String, state_note_go(g, c2))

# The prompt a restarted turn delivers: the pending input plus the state the
# interrupted turn left, so the work continues instead of repeating.
def refused_note(cwd: String, prompt: String) -> IO(String):
  do IO<String>:
    note : String <- state_note(cwd)
    IO.pure(String, prompt ++ "\n\nThe conversation this session had before was not saved, so this is a fresh conversation. " ++ note ++ "\nContinue the task and keep the work the workspace already holds.")

# A resume value this host no longer holds: the harness refuses the identity
# before any turn runs, and its stderr says so.
def refusal_body(resumable: Bool, event: String, text: String) -> Bool:
  Bool.and(resumable,
    Bool.and(String.is_empty(event), Tx.starts_with(Tx.trim_nl(text), "Error: Session")))

def refusal_read(resumable: Bool, event: String, text: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match text:
    case Fail{error}: IO.pure(Bool,False{})
    case Done{value}: IO.pure(Bool,refusal_body(resumable,event,value))

def refusal(+log: String, resumable: Bool, +outcome: Outcome) -> IO(Bool):
  match outcome:
    case Ended{status,event,error}:
      do IO<Bool>:
        text : Result<&1,&1,U32 & String,String> <- T.Text.read(log ++ ".stderr")
        refusal_read(resumable,event,text)

# The refused conversation is gone, so the pending input runs fresh and names
# the state the workspace holds; the fresh turn records its own identity.
def restart(+db: String, +player: String, +id: String, +log: String, +note: String, +harness: String, child: Result<&1,&1,U32 & String,U32>) -> IO(Outcome):
  do IO<Outcome>:
    noted : Unit <- report(db,player,id ++ ":recovery","The recorded conversation could not be resumed; the turn restarted in a fresh conversation that names the workspace's current state.")
    started(db,player,id,log,note,harness,child)

def supervise_gone(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +sessions: String, +prompt: String, +first: Outcome, gone: Bool) -> IO(Outcome):
  match gone:
    case False{}: IO.pure(Outcome,first)
    case True{}: do IO<Outcome>:
      note : String <- refused_note(cwd,prompt)
      child : Result<&1,&1,U32 & String,U32> <- launch(sessions,cmd,model,effort,cwd,log,"",harness,task)
      restart(db,player,id,log,note,harness,child)

def supervise_retry(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +sessions: String, +native: String, +prompt: String, +first: Outcome) -> IO(Outcome):
  do IO<Outcome>:
    resumable : Bool <- IO.pure(Bool, Bool.not(String.is_empty(native)))
    gone : Bool <- refusal(log,resumable,first)
    supervise_gone(db,player,id,cmd,model,effort,cwd,task,log,harness,sessions,prompt,first,gone)

def supervise(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String, +harness: String, +sessions: String, +prompt: String) -> IO(Outcome):
  do IO<Outcome>:
    alternate : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(sessions) ++ "=" ++ C.q(db ++ ".sessions") ++ " THEN CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END ELSE " ++ C.q(db ++ ".sessions") ++ " END FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    +native : String <- Omp.resume_file(sessions,Tx.trim_nl(alternate),session,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(session))))
    child : Result<&1,&1,U32 & String,U32> <- launch(sessions,cmd,model,effort,cwd,log,native,harness,task)
    first : Outcome <- started(db,player,id,log,prompt,harness,child)
    supervise_retry(db,player,id,cmd,model,effort,cwd,task,log,harness,sessions,native,prompt,first)

def task_read(db: String, player: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String, harness: String, sessions: String, result: Result<&1,&1,U32 & String,String>) -> IO(Outcome):
  match result:
    case Fail{error}: IO.pure(Outcome,Ended{"input failed","","Player task could not be read: " ++ error_text(error)})
    case Done{prompt}: supervise(db,player,id,cmd,model,effort,cwd,task,log,session,harness,sessions,prompt)

def replay_result(result: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Maybe<Outcome>>:
  match result:
    case Fail{error}: Fail{error}
    case Done{unit}: Done{None{}}

def choose(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, +task: String, log: String, session: String, harness: String, replay: Bool) -> IO(Result<&1,&1,U32 & String,Maybe<Outcome>>):
  match replay:
    case True{}:
      do IO<Result<&1,&1,U32 & String,Maybe<Outcome>>>:
        +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
        written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)
        IO.pure(Result<&1,&1,U32 & String,Maybe<Outcome>>,replay_result(written))
    case False{}: do IO<Result<&1,&1,U32 & String,Maybe<Outcome>>>:
      allowed : Bool <- Stop.admit(db,player,id,"direct","")
      admitted : Unit <- Stop.admitted(allowed)
      prompt : Result<&1,&1,U32 & String,String> <- T.Text.read(task)
      result : Outcome <- task_read(db,player,id,cmd,model,effort,cwd,task,log,session,harness,db ++ ".sessions",prompt)
      IO.pure(Result<&1,&1,U32 & String,Maybe<Outcome>>,Done{Some{result}})

def supported_harness(supported: Bool) -> IO(Unit):
  match supported:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"No turn adapter for the player's recorded harness.")

def matching_turn(matches: Bool) -> IO(Unit):
  match matches:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"The turn ID already belongs to a different player or message kind.")

# The turn identity is admitted only when the message it names was sent by this
# player as a report: the count is zero for every other sender or kind.
def id_owner_sql(id: String, player: String) -> String:
  "SELECT count(*) FROM messages WHERE id=" ++ C.q(id) ++ " AND (sender<>" ++ C.q(player) ++ " OR kind<>'report');"

# The turn identity is admitted only when the store already holds that message.
def turn_present_sql(id: String) -> String:
  "SELECT count(*) FROM messages WHERE id=" ++ C.q(id) ++ ";"

def player_checked(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String, +harness: String, missing: Bool) -> IO(Result<&1,&1,U32 & String,Maybe<Outcome>>):
  match missing:
    case True{}: IO.die(Result<&1,&1,U32 & String,Maybe<Outcome>>,2,"Player has no recorded parent and workspace; register it before starting a turn.")
    case False{}:
      do IO<Result<&1,&1,U32 & String,Maybe<Outcome>>>:
        supported : Unit <- supported_harness(Bool.or(String.eq(harness,"omp\n"),Bool.or(String.eq(harness,"codex\n"),Bool.or(String.eq(harness,"claude-code\n"),String.eq(harness,"muse\n")))))
        foreign : String <- IO.try(String,DB.Sql.query(db,id_owner_sql(id,player)))
        identity : Unit <- matching_turn(String.eq(foreign,"0\n"))
        found : String <- IO.try(String,DB.Sql.query(db,turn_present_sql(id)))
        choose(db,player,id,cmd,model,effort,cwd,task,log,session,harness,String.eq(found,"1\n"))

def replay_finished(db: String, player: String, lock: U32, output: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  do IO<Unit>:
    released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
    wake : Result<&1,&1,U32 & String,Unit> <- Delivery.wake_pending(db,player,"0")
    IO.pass(Unit,combine(output,wake))

def complete_outcome_locked(+db: String, +player: String, +id: String, +log: String, lock: U32, result: Maybe<Outcome>) -> IO(Unit):
  match result:
    case None{}: replay_finished(db,player,lock,Done{Unit{}})
    case Some{+outcome}: do IO<Unit>:
      exited : Unit <- record_exit(db,player,id,log,outcome)
      prepared : Unit <- prepare(db,player,id,log,log ++ ".stderr",outcome)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,finish(db,player,id,log,outcome))
      wake : Result<&1,&1,U32 & String,Unit> <- Delivery.wake_pending(db,player,"0")
      finished : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,delivery_task)
      IO.pass(Unit,combine(finished,wake))

def complete_locked(db: String, player: String, id: String, log: String, lock: U32, result: Result<&1,&1,U32 & String,Maybe<Outcome>>) -> IO(Unit):
  match result:
    case Fail{error}: replay_finished(db,player,lock,Fail{error})
    case Done{outcome}: complete_outcome_locked(db,player,id,log,lock,outcome)

def retained_receive_admitted(recovery: Maybe<String>) -> IO(Unit):
  match recovery:
    case None{}: IO.pure(Unit,Unit{})
    case Some{args}: IO.die(Unit,2,"Session retains an interrupted native receive; run receive to observe its output and completion before starting a direct turn.")

# The acquired canonical guard protects this check before direct admission.
def retained_receive_guard(+db: String, player: String) -> IO(Unit):
  do IO<Unit>:
    directory : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(player) ++ " AND mode='retained'),'');"))
    recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.recovery_argv(Tx.trim_nl(directory)))
    retained_receive_admitted(recovery)

def acquired(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, +log: String, session: String, missing: Bool, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Session already has an active native turn; send a message to queue input.")
    case Some{handle}: do IO<Unit>:
      retained : Unit <- retained_receive_guard(db,player)
      harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
      result : Result<&1,&1,U32 & String,Maybe<Outcome>> <- player_checked(db,player,id,cmd,model,effort,cwd,task,log,session,harness,missing)
      complete_locked(db,player,id,log,handle,result)

def run(+db: String, +player: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{player}))
    Lock.SessionLock.acquire_session(Unit,db,player,
      +database => lock => acquired(database,player,id,cmd,model,effort,cwd,task,log,session,String.is_empty(recorded),lock))
