import Base
import ./commands.bend as C
import ./store.bend as Store
import ./stop.bend as Stop
import ./delivery.bend as Delivery
import ../host/session-lock.bend as Lock
import ./guidance.bend as Guidance
import ./native-requests.bend as NativeRequests
import ./observer-checkpoint.bend as Observer
import ./logs.bend as Logs
import ../host/log-checkpoint.bend as Checkpoint
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

def checkpoint_write_failed(result: Result<&1,&1,U32 & String,Unit>) -> Bool:
  match result:
    case Fail{error}: True{}
    case Done{unit}: False{}

def checkpoint_failure_notice(db: String, player: String, id: String, attempt: String, enabled: Bool, result: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match enabled:
    case False{}: IO.pure(Unit,Unit{})
    case True{}:
      match result:
        case Fail{error}: report(db,player,id ++ ":checkpoint","Native observer checkpoint commit failed for attempt " ++ attempt ++ ": " ++ error_text(error) ++ ". Raw output remains replayable from the last validated checkpoint.")
        case Done{unit}: IO.pure(Unit,Unit{})

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

def generation_log(+log: String, +id: String) -> String:
  Logs.attempt_log(log,id)

# Failure reports are committed while this invocation still owns the session.
def prepare(+db: String, +player: String, +id: String, log: String, stderr: String, outcome: Outcome) -> IO(Unit):
  do IO<Unit>:
    +generation : String <- IO.pure(String,generation_log(log,id))
    recipient : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.report_recipient(C.q(player)) ++ " IS NOT NULL;"))
    prepare_parent(db,player,id,generation,stderr,outcome,String.eq(recipient,"1\n"))

def record_exit(db: String, player: String, +id: String, log: String, outcome: Outcome) -> IO(Unit):
  match outcome:
    case Ended{status,event,error}: Stop.exited(db,player,id,status,event,error,generation_log(log,id))

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
def codex_finished(+db: String, player: String, id: String, +source: String, previous: String, codex: Bool) -> IO(String):
  match codex:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      +bounded_source : String <- IO.pure(String,Bool.pick(String,String.is_empty(source),previous,source))
      +event : String <- IO.try(String,DB.Sql.query(db,codex_result_sql(bounded_source)))
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

# The completion reader calls json_extract for content block fields. Keep
# object blocks on assistant messages in order and give non-array content an
# empty extraction list. The raw native frame remains in the log.
def omp_content_sql(+message: String) -> String:
  "CASE WHEN json_extract(" ++ message ++ ",'$.role')='assistant' THEN json_set(" ++ message ++ ",'$.content',json(CASE WHEN json_type(" ++ message ++ ",'$.content')='array' THEN coalesce((SELECT json_group_array(json(CASE WHEN json_type(" ++ message ++ ",'$.content[' || content.key || ']')='object' THEN content.value ELSE '{}' END)) FROM (SELECT c.value AS value,c.key AS key FROM json_each(" ++ message ++ ",'$.content') c WHERE json_type(" ++ message ++ ",'$.content[' || c.key || ']')='object' ORDER BY c.key) content),'[]') ELSE '[]' END)) ELSE json(" ++ message ++ ") END"

# Normalize extraction input for agent_end while retaining all source frames in
# the native log. JSON object messages and content blocks retain source order.
def omp_terminal_objects_sql(+event: String) -> String:
  "(SELECT count(*) FROM json_each(" ++ C.q(event) ++ ",'$.messages') m WHERE json_type(" ++ C.q(event) ++ ",'$.messages[' || m.key || ']')='object')"

def omp_terminal_kept_sql(+event: String) -> String:
  "coalesce((SELECT json_group_array(json(message.value)) FROM (SELECT CASE WHEN json_type(" ++ C.q(event) ++ ",'$.messages[' || m.key || ']')='object' THEN " ++ omp_content_sql("m.value") ++ " ELSE '{}' END AS value,m.key AS key FROM json_each(" ++ C.q(event) ++ ",'$.messages') m WHERE json_type(" ++ C.q(event) ++ ",'$.messages[' || m.key || ']')='object' ORDER BY m.key) message),'[]')"

def omp_terminal_messages_sql(+event: String, +message: String) -> String:
  +objects = omp_terminal_objects_sql(event)
  +kept = omp_terminal_kept_sql(event)
  "CASE WHEN " ++ objects ++ "=0 AND json_valid(" ++ C.q(message) ++ ") THEN json_array(json(" ++ C.q(message) ++ ")) ELSE " ++ kept ++ " END"

# OMP may return valid terminal envelopes whose messages array contains a
# non-object metadata marker. Keep object messages in their original order for
# result extraction. The native log retains the unmodified frame.
def omp_terminal_sql(+event: String, +message: String) -> String:
  +messages = omp_terminal_messages_sql(event,message)
  "SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='agent_end' AND coalesce(json_extract(" ++ C.q(event) ++ ",'$.isTerminal'),1)=1 THEN CASE WHEN json_type(" ++ C.q(event) ++ ",'$.messages')='array' THEN json_set(" ++ C.q(event) ++ ",'$.messages',json(" ++ messages ++ ")) WHEN json_valid(" ++ C.q(message) ++ ") THEN json_set(" ++ C.q(event) ++ ",'$.messages',json_array(json(" ++ C.q(message) ++ "))) ELSE " ++ C.q(event) ++ " END ELSE " ++ C.q(event) ++ " END ELSE " ++ C.q(event) ++ " END;"

def omp_terminal(db: String, +event: String, +message: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,event)
    case True{}: do IO<String>:
      normalized : String <- IO.try(String,DB.Sql.query(db,omp_terminal_sql(event,message)))
      IO.pure(String,Tx.trim_nl(normalized))

# The root turn input identifies the admitted Muse invocation. Nested task
# streams can complete while that invocation is still running.
def primary_command_sql(+event: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.payload_type')='turn.input.user' AND json_extract(" ++ C.q(event) ++ ",'$.payload.kind')='turn_input_user' THEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.payload.command_id'),'') ELSE '' END ELSE '' END;"

def primary_command(db: String, +event: String, +previous: String, muse: Bool) -> IO(String):
  match muse:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      found : String <- IO.try(String,DB.Sql.query(db,primary_command_sql(event)))
      selected : String <- IO.pure(String,Tx.trim_nl(found))
      IO.pure(String,Bool.pick(String,String.is_empty(previous),selected,previous))

def current_command(db: String, +event: String, +previous: String, muse: Bool) -> IO(String):
  match muse:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      found : String <- IO.try(String,DB.Sql.query(db,primary_command_sql(event)))
      +selected : String <- IO.pure(String,Tx.trim_nl(found))
      IO.pure(String,Bool.pick(String,String.is_empty(selected),previous,selected))

def primary_terminal_expr(+event: String, +primary: String) -> String:
  "CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.payload.kind')='run_terminal' AND " ++ C.q(primary) ++ "<>'' AND json_extract(" ++ C.q(event) ++ ",'$.payload.command_id')=" ++ C.q(primary) ++ " THEN 1 ELSE 0 END ELSE 0 END"

def primary_terminal_sql(+event: String, +primary: String) -> String:
  "SELECT " ++ primary_terminal_expr(event,primary) ++ ";"

def primary_terminal(db: String, +event: String, +primary: String, muse: Bool) -> IO(Bool):
  match muse:
    case False{}: do IO<Bool>:
      found : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN " ++ C.terminal(event) ++ " ELSE 0 END;"))
      IO.pure(Bool,String.eq(Tx.trim_nl(found),"1"))
    case True{}: do IO<Bool>:
      found : String <- IO.try(String,DB.Sql.query(db,primary_terminal_sql(event,primary)))
      IO.pure(Bool,String.eq(Tx.trim_nl(found),"1"))

# A completion identity may already name a delivered report or a different
# terminal. Compare the report body before committing so the upsert guard never
# turns a changed observation into a NOT NULL failure.
def completion_state_expr(+id: String, +player: String, +event: String) -> String:
  "CASE WHEN EXISTS(SELECT 1 FROM turns WHERE id=" ++ C.q(id) ++ ") AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(player) ++ " AND kind='report' AND body=" ++ C.terminal_body(event) ++ ") THEN 'same' WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(player) ++ " AND kind='report' AND body=" ++ C.terminal_body(event) ++ ") THEN '' WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") OR EXISTS(SELECT 1 FROM turns WHERE id=" ++ C.q(id) ++ ") THEN 'conflict' ELSE '' END"

def completion_state_sql(+id: String, +player: String, +event: String) -> String:
  "SELECT " ++ completion_state_expr(id,player,event) ++ ";"

def completion_state(db: String, +id: String, +player: String, +event: String) -> IO(String):
  do IO<String>:
    state : String <- IO.try(String,DB.Sql.query(db,completion_state_sql(id,player,event)))
    IO.pure(String,Tx.trim_nl(state))

def completion_state_event_sql(+id: String, +player: String, +event: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ C.terminal(event) ++ " THEN " ++ completion_state_expr(id,player,event) ++ " ELSE '' END ELSE '' END;"

def completion_state_event(+db: String, +id: String, +player: String, +event: String, +primary: String, muse: Bool) -> IO(String):
  do IO<String>:
    accepted : Bool <- primary_terminal(db,event,primary,muse)
    selected : String <- Bool.pick(IO(String),accepted,IO.try(String,DB.Sql.query(db,completion_state_event_sql(id,player,event))),IO.pure(String,""))
    IO.pure(String,Tx.trim_nl(selected))

def completion_note_id_sql(+id: String, +event: String) -> String:
  "SELECT " ++ C.q(id ++ ":observation-conflict:") ++ " || coalesce(json_extract(" ++ C.q(event) ++ ",'$.id'),json_extract(" ++ C.q(event) ++ ",'$.payload.command_id'),json_extract(" ++ C.q(event) ++ ",'$.command_id'),'unknown');"

def completion_conflict_note(+db: String, player: String, +id: String, +event: String, conflict: Bool) -> IO(Unit):
  match conflict:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      note_id : String <- IO.try(String,DB.Sql.query(db,completion_note_id_sql(id,event)))
      saved : Unit <- report(db,player,Tx.trim_nl(note_id),"A native terminal produced output for report ID " ++ id ++ " after a different report already used that ID. The original report is preserved; this terminal event remains in the native log.")
      IO.pure(Unit,Unit{})

def terminal_observation_sealed(sealed: Bool, terminal: Bool, admitted: Bool, +state: String) -> Bool:
  Bool.or(sealed,Bool.and(terminal,Bool.or(Bool.not(admitted),Bool.not(String.is_empty(state)))))

def observe_sealed(+db: String, id: String, player: String, +event: String, +primary: String, sealed: Bool, +muse: Bool) -> IO(Bool):
  do IO<Bool>:
      terminal_text : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN " ++ C.terminal(event) ++ " ELSE 0 END;"))
      +terminal : Bool <- IO.pure(Bool,String.eq(Tx.trim_nl(terminal_text),"1"))
      accepted : Bool <- primary_terminal(db,event,primary,muse)
      +admitted : Bool <- IO.pure(Bool,Bool.and(terminal,Bool.or(Bool.not(muse),accepted)))
      state : String <- Bool.pick(IO(String),admitted,completion_state(db,id,player,event),IO.pure(String,""))
      IO.pure(Bool,terminal_observation_sealed(sealed,terminal,admitted,state))

def observe_projection(saved: Result<&1,&1,U32 & String,String>, +db: String, +player: String, +id: String, +line: String, +log: String, project_terminal: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match saved:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{value}:
      match project_terminal:
        case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
        case True{}: do IO<Result<&1,&1,U32 & String,String>>:
          recorded : Unit <- Logs.record_terminal_projection(db,player,id,line,log)
          IO.pure(Result<&1,&1,U32 & String,String>,Done{value})

def observe_event(+db: String, +player: String, +id: String, +line: String, log: String, relevant: Bool, +sealed: Bool, project_terminal: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match relevant:
    case True{}: do IO<Result<&1,&1,U32 & String,String>>:
      saved : Result<&1,&1,U32 & String,String> <- Store.commit(db,C.Observe{id,player,line,sealed})
      observe_projection(saved,db,player,id,line,log,project_terminal)
    case False{}:
      match project_terminal:
        case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})
        case True{}: do IO<Result<&1,&1,U32 & String,String>>:
          recorded : Unit <- Logs.record_terminal_projection(db,player,id,line,log)
          IO.pure(Result<&1,&1,U32 & String,String>,Done{""})

# A terminal that completes after the managed completion was sealed cannot be
# recorded as a report under the sealed identity: the first terminal stays the
# report of this receive attempt, and a later episode is named once in the
# separate diagnostic with the guidance it leaves for the next receive.
def deferred_terminal_sql(+event: String, +terminal: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ C.q(event) ++ "='' THEN 0 WHEN " ++ C.q(terminal) ++ "='' THEN 0 WHEN " ++ C.q(event) ++ "=" ++ C.q(terminal) ++ " THEN 0 WHEN " ++ C.terminal(event) ++ " THEN 1 ELSE 0 END ELSE 0 END;"

def muse_deferred_terminal_sql(+event: String, +terminal: String, +primary: String, +current: String) -> String:
  +candidate = primary_terminal_expr(event,current)
  +later = C.q(current) ++ "<>'' AND " ++ C.q(current) ++ "<>" ++ C.q(primary)
  "SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ C.q(event) ++ "='' THEN 0 WHEN " ++ C.q(terminal) ++ "='' THEN 0 WHEN " ++ C.q(event) ++ "=" ++ C.q(terminal) ++ " THEN 0 WHEN " ++ candidate ++ " AND " ++ later ++ " THEN 1 ELSE 0 END ELSE 0 END;"

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

def deferred_note(+db: String, player: String, id: String, +event: String, +terminal: String, +primary: String, +current: String, sealed: Bool, muse: Bool) -> IO(Unit):
  match sealed:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      query : String <- IO.pure(String,Bool.pick(String,muse,muse_deferred_terminal_sql(event,terminal,primary,current),deferred_terminal_sql(event,terminal)))
      later : String <- IO.try(String,DB.Sql.query(db,query))
      noted : Unit <- record_deferred(db,player,id,String.eq(later,"1\n"))
      IO.pure(Unit,Unit{})

def append_frame(log: String, line: String, keep: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match keep:
    case True{}: T.Text.append(log,line ++ "\n")
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

# Read the OMP frame type once for log retention and event observation. The
# classification names the frame types the retention policy distinguishes; a
# frame outside it keeps an empty kind and is retained at every level.
def frame_kind(db: String, line: String, omp: Bool) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(line) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE json_extract(value,'$.type') WHEN 'message_update' THEN 'message_update' WHEN 'tool_execution_update' THEN 'tool_execution_update' WHEN 'message_start' THEN 'message_start' WHEN 'response' THEN 'response' WHEN 'message_end' THEN 'message_end' WHEN 'tool_execution_start' THEN 'tool_execution_start' WHEN 'tool_execution_end' THEN 'tool_execution_end' WHEN 'agent_end' THEN 'agent_end' WHEN 'extension_ui_request' THEN 'extension_ui_request' ELSE '' END ELSE '' END FROM frame;"))

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

def muse_terminal_event(db: String, +event: String, +previous: String, +primary: String, relevant: Bool) -> IO(String):
  match relevant:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      selected : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN CASE WHEN " ++ primary_terminal_expr(event,primary) ++ " THEN CASE WHEN " ++ C.q(previous) ++ "='' THEN " ++ C.q(event) ++ " ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END;"))
      IO.pure(String,Tx.trim_nl(selected))

def codex_frames(db: String, +previous: String, +line: String, codex: Bool) -> IO(String):
  match codex:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      value : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(line) ++ ") THEN CASE WHEN json_extract(" ++ C.q(line) ++ ",'$.type')='item.completed' AND json_extract(" ++ C.q(line) ++ ",'$.item.type')='agent_message' THEN " ++ C.q(line) ++ " WHEN json_extract(" ++ C.q(line) ++ ",'$.type') IN ('turn.completed','turn.failed') THEN CASE WHEN " ++ C.q(previous) ++ "='' THEN " ++ C.q(line) ++ " ELSE " ++ C.q(previous) ++ " || char(10) || " ++ C.q(line) ++ " END ELSE " ++ C.q(previous) ++ " END ELSE " ++ C.q(previous) ++ " END;"))
      IO.pure(String,Tx.trim_nl(value))

# The checkpoint contains each incomplete identity's newest frame and stays
# available when the native observer exits before its EOF handler runs.
def checkpoint(enabled: Bool, +log: String, held: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),Bool.or(Bool.not(enabled),String.is_empty(log)),
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
    Checkpoint.LogCheckpoint.save(log ++ ".pending",Tx.join("\n",Logs.flush(held))))

def checkpoint_written(written: Result<&1,&1,U32 & String,Unit>, enabled: Bool, log: String, held: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match written:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: checkpoint(enabled,log,held)

# A later direct turn appends an earlier observer's incomplete checkpoint
# before producing new frames. Removal follows the successful append.
def checkpoint_restore_read(found: Result<&1,&1,U32 & String,String>, +log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match found:
    case Fail{(+code,text)}:
      IO.pure(Result<&1,&1,U32 & String,Unit>,Bool.pick(Result<&1,&1,U32 & String,Unit>,U32.is_eq(code,2),Done{Unit{}},Fail{(code,text)}))
    case Done{text}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        written : Result<&1,&1,U32 & String,Unit> <- T.Text.append(log,text ++ "\n")
        cleared : Result<&1,&1,U32 & String,Unit> <- checkpoint_written(written,True{},log,"")
        IO.pure(Result<&1,&1,U32 & String,Unit>,cleared)

def checkpoint_restore_file(+log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    found : Result<&1,&1,U32 & String,String> <- T.Text.read(log ++ ".pending")
    checkpoint_restore_read(found,log)

def checkpoint_restore(+log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.is_empty(log),
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),checkpoint_restore_file(log))

@unsafe
def consume(+db: String, +player: String, +id: String, +log: String, +policy: Logs.Policy, +held: String, +log_failed: Bool, +handle: U32, +harness: String, cursor: String, last_message: String, primary: String, current: String, +terminal: String, filter: String, codex_log: String, +first_error: String, sender: Chan(Result<&1,&1,U32 & String,Unit>), +attempt: String, +checkpoint_state: Observer.State, +checkpoint_blocked: Bool, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, result: Result<&1,&1,U32 & String,Maybe<String>>) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  match result:
    case Fail{error}: do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
      closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
      sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
      waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      +end_policy : Logs.Policy <- Logs.policy(db,player)
      +flushed : Result<&1,&1,U32 & String,Unit> <- Logs.write_lines(end_policy,log,Logs.flush(held),log_failed)
      checkpoint_done : Result<&1,&1,U32 & String,Unit> <- checkpoint_written(flushed,Bool.and(String.is_empty(attempt),Bool.not(log_failed)),log,"")
      named : Result<&1,&1,U32 & String,Unit> <- Logs.write_lines(end_policy,log,Logs.interrupted(held),log_failed)
      IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(Ended{status_text(waited),terminal,"Native output read failed: " ++ error_text(error)},deliveries))
    case Done{None{}}:
      do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
        sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
        +end_policy : Logs.Policy <- Logs.policy(db,player)
        status : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
        event : String <- codex_finished(db,player,id,codex_log,terminal,String.eq(harness,"codex\n"))
        +flushed : Result<&1,&1,U32 & String,Unit> <- Logs.write_lines(end_policy,log,Logs.flush(held),log_failed)
        checkpoint_done : Result<&1,&1,U32 & String,Unit> <- checkpoint_written(flushed,Bool.and(String.is_empty(attempt),Bool.not(log_failed)),log,"")
        noted : Result<&1,&1,U32 & String,Unit> <- record_filter(log,filter,String.eq(harness,"omp\n"))
        closed : Result<&1,&1,U32 & String,String> <- NativeRequests.closed(db,attempt,Bool.not(String.is_empty(attempt)))
        IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(Ended{status_text(status),event,remember(remember_write(remember_write(remember_write(first_error,sent),flushed),noted),closed)},deliveries))
    case Done{Some{+line}}:
      do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
        +current_policy : Logs.Policy <- Logs.policy(db,player)
        +kind : String <- frame_kind(db,line,String.eq(harness,"omp\n"))
        +frame_key : String <- Logs.frame_identity(db,line,Tx.trim_nl(kind),String.eq(harness,"omp\n"))
        +next_held : String <- IO.pure(String,Logs.step_held(Logs.frame_step(current_policy,Tx.trim_nl(kind),frame_key,line,held)))
        +logged : Result<&1,&1,U32 & String,Unit> <- Logs.write_lines(current_policy,log,Logs.step_lines(Logs.frame_step(current_policy,Tx.trim_nl(kind),frame_key,line,held)),log_failed)
        +saved_checkpoint : Result<&1,&1,U32 & String,Unit> <- checkpoint_written(logged,Bool.and(String.is_empty(attempt),Bool.and(Bool.not(log_failed),Bool.not(String.eq(held,next_held)))),log,next_held)
        +written : Result<&1,&1,U32 & String,Unit> <- IO.pure(Result<&1,&1,U32 & String,Unit>,Logs.first_failure(saved_checkpoint,logged))
        +failed : Bool <- IO.pure(Bool,Logs.failed_now(log_failed,written))
        +relevant : Bool <- IO.pure(Bool,Guidance.relevant(kind,String.eq(harness,"omp\n")))
        +sealed : Bool <- IO.pure(Bool,Bool.not(String.is_empty(terminal)))
        +next_cursor : String <- Guidance.observe(db,player,handle,line,cursor,Bool.and(String.eq(harness,"omp\n"),relevant),sealed)
        +message : String <- omp_message(db,line,last_message,Bool.and(String.eq(harness,"omp\n"),relevant))
        +event : String <- omp_terminal(db,line,message,Bool.and(String.eq(harness,"omp\n"),relevant))
        +next_primary : String <- primary_command(db,event,primary,String.eq(harness,"muse\n"))
        +next_current : String <- current_command(db,event,current,String.eq(harness,"muse\n"))
        +state : String <- completion_state_event(db,id,player,event,next_primary,String.eq(harness,"muse\n"))
        +observation_sealed : Bool <- observe_sealed(db,id,player,event,next_primary,sealed,String.eq(harness,"muse\n"))
        +project_terminal : Bool <- primary_terminal(db,event,next_primary,String.eq(harness,"muse\n"))
        conflict_note : Unit <- completion_conflict_note(db,player,id,event,String.eq(state,"conflict"))
        deferred : Unit <- deferred_note(db,player,id,event,terminal,next_primary,next_current,sealed,String.eq(harness,"muse\n"))
        +observed : Result<&1,&1,U32 & String,String> <- observe_event(db,player,id,event,log,relevant,observation_sealed,project_terminal)
        +ended : String <- Bool.pick(IO(String),String.eq(harness,"muse\n"),muse_terminal_event(db,event,terminal,next_primary,relevant),terminal_event(db,event,terminal,relevant))
        +codex_state : String <- codex_frames(db,codex_log,line,String.eq(harness,"codex\n"))
        questions : List<Chan(Result<&1,&1,U32 & String,String>)> & String <- NativeRequests.observe(db,player,id,attempt,line,deliveries,Bool.and(Bool.not(String.is_empty(attempt)),String.eq(kind,"extension_ui_request\n")))
        +mode : String <- filter_mode(db,line,String.eq(harness,"omp\n"))
        +next_filter : String <- IO.pure(String,Omp.filter_next(filter,Tx.trim_nl(mode)))
        +next_checkpoint : Observer.State <- IO.pure(Observer.State,Observer.make(next_cursor,message,next_primary,next_current,ended,next_filter,codex_state,next_held))
        NativeRequests.with_observation(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,questions,wakes => question_error => do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
          +question_text : String <- IO.pure(String,question_error)
          +checkpoint_enabled : Bool <- IO.pure(Bool,Bool.and(Bool.not(checkpoint_blocked),Bool.and(Bool.not(failed),Bool.and(String.is_empty(question_text),Bool.and(Bool.not(String.is_empty(attempt)),Observer.checkpoint_due(checkpoint_state,next_checkpoint))))))
          +checkpointed : Result<&1,&1,U32 & String,Unit> <- Observer.after_observation(db,handle,next_checkpoint,checkpoint_enabled,observed)
          checkpoint_notice : Unit <- checkpoint_failure_notice(db,player,id,attempt,Bool.and(checkpoint_enabled,Bool.not(checkpoint_blocked)),checkpointed)
          +next_error : String <- IO.pure(String,remember(remember_write(Bool.pick(String,String.is_empty(first_error),question_text,first_error),written),observed))
          +checkpoint_failed : Bool <- IO.pure(Bool,Bool.or(checkpoint_blocked,Bool.or(Bool.not(String.is_empty(next_error)),checkpoint_write_failed(checkpointed))))
          next : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
          consume(db,player,id,log,current_policy,next_held,failed,handle,harness,next_cursor,message,next_primary,next_current,ended,next_filter,codex_state,next_error,sender,attempt,next_checkpoint,checkpoint_failed,wakes,next))

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
        +generation : String <- IO.pure(String,generation_log(log,id))
        +policy : Logs.Policy <- Logs.open_attempt(db,player,log,id)
        restored : Result<&1,&1,U32 & String,Unit> <- checkpoint_restore(generation)
        sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,send_prompt(handle,prompt,harness))
        first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
        observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- consume(db,player,id,generation,policy,"",False{},handle,harness,"0\n","","","","","","",remember_write("",restored),sender,"",Observer.empty(),False{},Nil{},first)
        direct_observed(observation)

# The retained process sends its initial input once. Reattachment reads the same
# attempt from its first frame so native completion can be reconstructed.
def retained_output(+db: String, +player: String, +id: String, +log: String, +harness: String, attempt: String, +handle: U32) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
    +generation : String <- IO.pure(String,generation_log(log,id))
    +policy : Logs.Policy <- Logs.open_attempt(db,player,log,id)
    sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    +checkpoint_state : Observer.State <- Observer.restore(db,handle)
    first : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(handle)
    cursor : String <- IO.pure(String,Observer.cursor(checkpoint_state))
    last_message : String <- IO.pure(String,Observer.last_message(checkpoint_state))
    primary : String <- IO.pure(String,Observer.muse_primary(checkpoint_state))
    current : String <- IO.pure(String,Observer.muse_current(checkpoint_state))
    terminal : String <- IO.pure(String,Observer.terminal(checkpoint_state))
    filter : String <- IO.pure(String,Observer.filter_mode(checkpoint_state))
    codex_log : String <- IO.pure(String,Observer.codex_log(checkpoint_state))
    held : String <- IO.pure(String,Observer.held(checkpoint_state))
    consume(db,player,id,generation,policy,held,False{},handle,harness,cursor,last_message,primary,current,terminal,filter,codex_log,"",sender,attempt,checkpoint_state,False{},Nil{},first)

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

def launch_bounded(sessions: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +session: String, +harness: String, task: String, limit: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"omp\n"),
    Omp.start_player_bounded(cmd,model,effort,cwd,log,sessions,session,String.is_empty(session),limit),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"muse\n"),
    Bool.pick(IO(Result<&1,&1,U32 & String,U32>),String.is_empty(session),Muse.start_player_bounded(cmd,model,effort,cwd,log ++ ".stderr",task,limit),Muse.resume_player_bounded(cmd,model,effort,cwd,log ++ ".stderr",session,task,limit)),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"codex\n"),
    Codex.start_player_bounded(cmd,model,effort,cwd,log ++ ".stderr",session,String.is_empty(session),limit),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>),String.is_empty(session),Claude.start_player_bounded(cmd,model,effort,cwd,log ++ ".stderr",limit),Claude.resume_player_bounded(cmd,model,effort,cwd,log ++ ".stderr",session,limit)))))

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

def supervise_gone(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +sessions: String, +prompt: String, limit: U32, +first: Outcome, gone: Bool) -> IO(Outcome):
  match gone:
    case False{}: IO.pure(Outcome,first)
    case True{}: do IO<Outcome>:
      note : String <- refused_note(cwd,prompt)
      child : Result<&1,&1,U32 & String,U32> <- launch_bounded(sessions,cmd,model,effort,cwd,generation_log(log,id),"",harness,task,limit)
      restart(db,player,id,log,note,harness,child)

def supervise_retry(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +sessions: String, +native: String, +prompt: String, limit: U32, +first: Outcome) -> IO(Outcome):
  do IO<Outcome>:
    resumable : Bool <- IO.pure(Bool, Bool.not(String.is_empty(native)))
    gone : Bool <- refusal(generation_log(log,id),resumable,first)
    supervise_gone(db,player,id,cmd,model,effort,cwd,task,log,harness,sessions,prompt,limit,first,gone)

def supervise(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String, +harness: String, +sessions: String, +prompt: String) -> IO(Outcome):
  do IO<Outcome>:
    alternate : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(sessions) ++ "=" ++ C.q(db ++ ".sessions") ++ " THEN CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END ELSE " ++ C.q(db ++ ".sessions") ++ " END FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    +native : String <- Omp.resume_file(sessions,Tx.trim_nl(alternate),session,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(session))))
    +policy : Logs.Policy <- Logs.policy(db,player)
    limit : U32 <- IO.pure(U32,Logs.stderr_limit(policy))
    child : Result<&1,&1,U32 & String,U32> <- launch_bounded(sessions,cmd,model,effort,cwd,generation_log(log,id),native,harness,task,limit)
    first : Outcome <- started(db,player,id,log,prompt,harness,child)
    supervise_retry(db,player,id,cmd,model,effort,cwd,task,log,harness,sessions,native,prompt,limit,first)

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
