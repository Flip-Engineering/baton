import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./stop.bend as Stop
import ./subscription-fallback.bend as Subs
import ./delivery.bend as Delivery
import ./control.bend as Control
import ../host/session-lock.bend as Lock
import ../host/control.bend as HostControl
import ./guidance.bend as Guidance
import ./native-requests.bend as NativeRequests
import ./observer-checkpoint.bend as Observer
import ./../coordinator/logs.bend as Logs
import ../host/log-checkpoint.bend as Checkpoint
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../host/process.bend as P
import ../host/instance.bend as Custody
import ../git/text.bend as Tx
import ../harness/claude-player.bend as Claude
import ../harness/omp-player.bend as Omp
import ../harness/muse-player.bend as Muse
import ../harness/codex-player.bend as Codex
import ../git/process.bend as GitProc
import ../git/types.bend as G

type Outcome is Data:
  Ended{status: String, event: String, error: String, incomplete: Bool}

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

def append_error(+previous: String, +next: String) -> String:
  Bool.pick(String,String.is_empty(next),previous,Bool.pick(String,String.is_empty(previous),next,previous ++ "\n" ++ next))

def append_write_error(previous: String, result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Fail{error}: append_error(previous,error_text(error))
    case Done{unit}: previous

def append_store_error(previous: String, result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: append_error(previous,error_text(error))
    case Done{value}: previous

# The stored report and native outcome retain the failure or recovery note.
# Its stdout copy is best effort and cannot interrupt native completion.
def report(db: String, player: String, id: String, body: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.commit(db,C.Report{id,player,body}))
    written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)
    IO.pure(Unit,Unit{})

def diagnostic(db: String, player: String, id: String, text: String, +event: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: report(db,player,id ++ ":observation","Native output observation failed: " ++ text ++ Bool.pick(String,String.is_empty(event),"","\nNative event: " ++ event))

def checkpoint_write_failed(result: Result<&1,&1,U32 & String,Unit>) -> Bool:
  match result:
    case Fail{error}: True{}
    case Done{unit}: False{}

def observation_store_failed(result: Result<&1,&1,U32 & String,String>) -> Bool:
  match result:
    case Fail{error}: True{}
    case Done{value}: False{}

def wait_failed(result: Result<&1,&1,U32 & String,String>) -> Bool:
  observation_store_failed(result)

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

def prepare_finished(+db: String, +player: String, +id: String, log: String, stderr: String, +error: String, +status: String, event: String) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM turns WHERE id=" ++ C.q(id) ++ ";"))
    noted : Unit <- diagnostic(db,player,id,error,event,String.is_empty(error))
    missing : Unit <- result_missing(db,player,id,log,stderr,status,String.eq(result,"1\n"))
    exit_failure(db,player,id,status,String.eq(status,"exit 0"))

def prepare_player(db: String, player: String, id: String, log: String, stderr: String, error: String, status: String, event: String, early: Bool) -> IO(Unit):
  match early:
    case False{}: prepare_finished(db,player,id,log,stderr,error,status,event)
    case True{}: report(db,player,id,error)

def prepare_parent(db: String, player: String, id: String, log: String, stderr: String, outcome: Outcome, parent: Bool) -> IO(Unit):
  match outcome:
    case Ended{+status,event,error,incomplete}:
      match parent:
        case False{}: IO.pure(Unit,Unit{})
        case True{}: prepare_player(db,player,id,log,stderr,error,status,event,Bool.or(String.eq(status,"start failed"),String.eq(status,"input failed")))

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
    case Ended{status,event,error,incomplete}: Stop.exited(db,player,id,status,event,error,generation_log(log,id))

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
    case Ended{+status,+event,error,incomplete}:
      match parent:
        case True{}: player_finished(db,player,id)
        case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
          output : String <- IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT json_object('session'," ++ C.q(player) ++ ",'status'," ++ C.q(status) ++ ",'event',CASE WHEN value='' THEN NULL ELSE json(value) END,'error'," ++ C.q(error) ++ ") FROM frame;"))
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

def policy_level(policy: Logs.Policy) -> String:
  match policy:
    case Logs.Policy{level}: level

def input(+handle: U32, +prompt: String, +harness: String, level: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"omp\n"),
    Omp.input(handle,prompt,level),
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"muse\n"),
    Muse.input(handle,prompt),
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"codex\n"),
    Codex.input(handle,prompt),
    Claude.input(handle,prompt))))

def close_input(handle: U32, open: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match open:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: P.ProcessChild.close_stdin(handle)

def send_prompt(+handle: U32,prompt: String,+harness: String,level: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    sent : Result<&1,&1,U32 & String,Unit> <- input(handle,prompt,harness,level)
    closed : Result<&1,&1,U32 & String,Unit> <- close_input(handle,String.eq(harness,"omp\n"))
    IO.pure(Result<&1,&1,U32 & String,Unit>,send_result(sent,closed))

def codex_report(db: String, player: String, id: String, event: String, empty: Bool, sealed: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      saved : String <- IO.try(String,Store.commit(db,C.Observe{id,player,event,sealed}))
      IO.pure(Unit,Unit{})

def codex_result_sql(source: String) -> String:
  +events = "'[' || replace(trim(" ++ C.q(source) ++ ",char(10)),char(10),',') || ']'"
  "WITH frames(value) AS (SELECT " ++ events ++ ") SELECT json_object('type','result','is_error',json_extract(e.value,'$.type')='turn.failed','nativeEvent',json(e.value),'result',CASE WHEN json_extract(e.value,'$.type')='turn.failed' THEN json_extract(e.value,'$.error.message') ELSE (SELECT json_extract(m.value,'$.item.text') FROM json_each(frames.value) m WHERE m.key<e.key AND json_extract(m.value,'$.type')='item.completed' AND json_extract(m.value,'$.item.type')='agent_message' ORDER BY m.key DESC LIMIT 1) END) FROM frames,json_each(frames.value) e WHERE json_extract(e.value,'$.type') IN ('turn.completed','turn.failed') ORDER BY e.key DESC LIMIT 1;"

# Keep this invocation's latest Codex assistant message and terminal event.
def codex_finished(+db: String, player: String, id: String, +source: String, previous: String, codex: Bool, sealed: Bool) -> IO(String):
  match codex:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      +bounded_source : String <- IO.pure(String,Bool.pick(String,String.is_empty(source),previous,source))
      +event : String <- IO.try(String,DB.Sql.query(db,codex_result_sql(bounded_source)))
      saved : Unit <- codex_report(db,player,id,event,String.is_empty(event),sealed)
      IO.pure(String,event)

# The live issue-608-reclaim turn emitted its report in message_end, then an
# agent_end with messages=[] and messageCount=352. Keep the latest assistant
# message in this reader and use it when the terminal envelope omits messages.
# The message_end frame is written as received; the agent_end frame reaches the
# log as the compact projection, and the raw record stays in the attempt stdout
# spool of a retained receive until acknowledgement and in the provider's own
# journal.
def omp_message(db: String, +event: String, previous: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      message : String <- IO.try(String,DB.Sql.query(db,"WITH frame(value,previous) AS (VALUES(" ++ C.q(event) ++ "," ++ C.q(previous) ++ ")) SELECT CASE WHEN json_extract(value,'$.type')='message_end' AND json_extract(value,'$.message.role')='assistant' THEN json_extract(value,'$.message') ELSE previous END FROM frame;"))
      IO.pure(String,Tx.trim_nl(message))

# A completed provider error's response identity establishes when an elided
# terminal repeats observed history. Any later assistant start or completion
# updates the activity that the stream reached last.
def omp_activity_sql(+event: String, +previous: String) -> String:
  "WITH frame(value,previous) AS (VALUES(" ++ C.q(event) ++ "," ++ C.q(previous) ++ ")),activity(value) AS (SELECT CASE WHEN json_valid(previous) THEN previous ELSE json_object('kind','','id','','errors',json_array()) END FROM frame) SELECT CASE WHEN json_extract(frame.value,'$.message.role')='assistant' AND json_extract(frame.value,'$.type') IN ('message_start','message_end') THEN json_set(CASE WHEN json_extract(frame.value,'$.type')='message_end' AND json_extract(frame.value,'$.message.stopReason')='error' AND coalesce(json_extract(frame.value,'$.message.responseId'),'')<>'' AND NOT EXISTS(SELECT 1 FROM json_each(activity.value,'$.errors') e WHERE e.value=json_extract(frame.value,'$.message.responseId')) THEN json_insert(activity.value,'$.errors[#]',json_extract(frame.value,'$.message.responseId')) ELSE activity.value END,'$.kind',json_extract(frame.value,'$.type'),'$.id',coalesce(json_extract(frame.value,'$.message.responseId'),'')) ELSE activity.value END FROM frame,activity;"

def omp_activity(db: String, event: String, previous: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,previous)
    case True{}: do IO<String>:
      activity : String <- IO.try(String,DB.Sql.query(db,omp_activity_sql(event,previous)))
      IO.pure(String,Tx.trim_nl(activity))

# The completion reader calls json_extract for content block fields. Keep
# object blocks on assistant messages in order and give non-array content an
# empty extraction list. Normalization changes nothing retained elsewhere: a
# retained receive keeps the raw frame stream in the attempt stdout spool until
# acknowledgement, and the provider's own journal holds the provider's raw
# record. The public log holds the compact projection of a terminal frame.
def omp_content_sql(+message: String) -> String:
  "CASE WHEN json_extract(" ++ message ++ ",'$.role')='assistant' THEN json_set(" ++ message ++ ",'$.content',json(CASE WHEN json_type(" ++ message ++ ",'$.content')='array' THEN coalesce((SELECT json_group_array(json(content.value)) FROM (SELECT c.value AS value FROM json_each(" ++ message ++ ",'$.content') c WHERE c.type='object' ORDER BY c.key) content),'[]') ELSE '[]' END)) ELSE json(" ++ message ++ ") END"

# Normalize extraction input for agent_end. JSON object messages and content
# blocks retain source order, and the raw frame stream stays in the attempt
# stdout spool of a retained receive until acknowledgement.
def omp_terminal_objects_sql(+source: String) -> String:
  "(SELECT count(*) FROM json_each(" ++ source ++ ",'$.messages') m WHERE m.type='object')"

def omp_terminal_kept_sql(+source: String) -> String:
  "coalesce((SELECT json_group_array(json(message.value)) FROM (SELECT " ++ omp_content_sql("m.value") ++ " AS value,m.key AS key FROM json_each(" ++ source ++ ",'$.messages') m WHERE m.type='object' ORDER BY m.key) message),'[]')"

# An elided terminal can carry earlier tool use or an already observed error.
# The stream's last assistant activity identifies the retained completion.
def omp_elided_completion_sql(+source: String, +message: String, +activity: String) -> String:
  +assistant = C.last_assistant_sql_expr(source)
  "CASE WHEN json_valid(" ++ message ++ ") AND json_valid(" ++ activity ++ ") THEN CASE WHEN (SELECT CASE WHEN tail.type='object' THEN coalesce(json_extract(tail.value,'$.role')='assistant',0) ELSE 0 END FROM json_each(" ++ source ++ ",'$.messages') tail ORDER BY tail.key DESC LIMIT 1)=0 AND coalesce(json_extract(" ++ assistant ++ ",'$.responseId'),'')<>'' AND json_extract(" ++ activity ++ ",'$.kind')='message_end' AND coalesce(json_extract(" ++ activity ++ ",'$.id'),'')<>'' AND json_extract(" ++ activity ++ ",'$.id')=json_extract(" ++ message ++ ",'$.responseId') AND json_extract(" ++ assistant ++ ",'$.responseId')<>json_extract(" ++ activity ++ ",'$.id') AND ((json_extract(" ++ assistant ++ ",'$.stopReason')='toolUse' AND json_extract(" ++ message ++ ",'$.stopReason')='stop') OR (json_extract(" ++ assistant ++ ",'$.stopReason')='error' AND EXISTS(SELECT 1 FROM json_each(" ++ activity ++ ",'$.errors') observed WHERE observed.value=json_extract(" ++ assistant ++ ",'$.responseId')))) THEN 1 ELSE 0 END ELSE 0 END"

def omp_terminal_messages_sql(+source: String, +message: String, +activity: String) -> String:
  +objects = omp_terminal_objects_sql(source)
  +kept = omp_terminal_kept_sql(source)
  "CASE WHEN " ++ objects ++ "=0 AND json_valid(" ++ message ++ ") THEN json_array(json(" ++ message ++ ")) WHEN " ++ omp_elided_completion_sql(source,message,activity) ++ "=1 THEN json_array(json(" ++ omp_content_sql(message) ++ ")) ELSE " ++ kept ++ " END"

# OMP may return valid terminal envelopes whose messages array contains a
# non-object metadata marker. Keep object messages in their original order for
# result extraction. The value here is the observed event the turns row
# receives. A terminal frame reaches the public log as the compact projection
# built by logs.bend terminal_object_sql. The raw frame stream stays in the
# attempt stdout spool of a retained receive until acknowledgement, and the
# provider's own journal holds the provider's raw record.
# The frame, fallback message and activity each enter the one-row relation once.
# Extraction reads their SQL columns.
def omp_terminal_sql(+event: String, +message: String, +activity: String) -> String:
  +messages = omp_terminal_messages_sql("frame.value","frame.message","frame.activity")
  "WITH frame(value,message,activity) AS (VALUES(" ++ C.q(event) ++ "," ++ C.q(message) ++ "," ++ C.q(activity) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN json_extract(value,'$.type')='agent_end' AND coalesce(json_extract(value,'$.isTerminal'),1)=1 THEN CASE WHEN json_type(value,'$.messages')='array' THEN json_set(value,'$.messages',json(" ++ messages ++ ")) WHEN json_valid(frame.message) THEN json_set(value,'$.messages',json_array(json(frame.message))) ELSE value END ELSE value END ELSE value END FROM frame;"

def omp_terminal(db: String, +event: String, +message: String, activity: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,event)
    case True{}: do IO<String>:
      normalized : String <- IO.try(String,DB.Sql.query(db,omp_terminal_sql(event,message,activity)))
      IO.pure(String,Tx.trim_nl(normalized))

# The root turn input identifies the admitted Muse invocation. Nested task
# streams can complete while that invocation is still running.
def primary_command_sql(+event: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN json_extract(value,'$.payload_type')='turn.input.user' AND json_extract(value,'$.payload.kind')='turn_input_user' THEN coalesce(json_extract(value,'$.payload.command_id'),'') ELSE '' END ELSE '' END FROM frame;"

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
  "CASE WHEN json_valid(" ++ event ++ ") THEN CASE WHEN json_extract(" ++ event ++ ",'$.payload.kind')='run_terminal' AND " ++ C.q(primary) ++ "<>'' AND json_extract(" ++ event ++ ",'$.payload.command_id')=" ++ C.q(primary) ++ " THEN 1 ELSE 0 END ELSE 0 END"

def primary_terminal_sql(+event: String, +primary: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT " ++ primary_terminal_expr("frame.value",primary) ++ " FROM frame;"

def primary_terminal(db: String, +event: String, +primary: String, muse: Bool) -> IO(Bool):
  match muse:
    case False{}: do IO<Bool>:
      found : String <- IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT CASE WHEN json_valid(value) THEN " ++ C.terminal_expr("frame.value") ++ " ELSE 0 END FROM frame;"))
      IO.pure(Bool,String.eq(Tx.trim_nl(found),"1"))
    case True{}: do IO<Bool>:
      found : String <- IO.try(String,DB.Sql.query(db,primary_terminal_sql(event,primary)))
      IO.pure(Bool,String.eq(Tx.trim_nl(found),"1"))

# The generic terminal predicate is read once for each frame. Muse also binds
# an admitted terminal to the primary command of this receive.
def terminal_admitted(db: String, event: String, primary: String, candidate: Bool, muse: Bool) -> IO(Bool):
  match candidate muse:
    case False{} False{}: IO.pure(Bool,False{})
    case False{} True{}: IO.pure(Bool,False{})
    case True{} False{}: IO.pure(Bool,True{})
    case True{} True{}: primary_terminal(db,event,primary,True{})

# A completion identity may already name a delivered report or a different
# terminal. Compare the report body before committing so the upsert guard never
# turns a changed observation into a NOT NULL failure.
def completion_state_expr(+id: String, +player: String, +event: String) -> String:
  "CASE WHEN EXISTS(SELECT 1 FROM turns WHERE id=" ++ C.q(id) ++ ") AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(player) ++ " AND kind='report' AND body=" ++ C.terminal_body_expr(event) ++ ") THEN 'same' WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ " AND sender=" ++ C.q(player) ++ " AND kind='report' AND body=" ++ C.terminal_body_expr(event) ++ ") THEN '' WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") OR EXISTS(SELECT 1 FROM turns WHERE id=" ++ C.q(id) ++ ") THEN 'conflict' ELSE '' END"

def completion_state_sql(+id: String, +player: String, +event: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT " ++ completion_state_expr(id,player,"frame.value") ++ " FROM frame;"

def completion_state(db: String, +id: String, +player: String, +event: String) -> IO(String):
  do IO<String>:
    state : String <- IO.try(String,DB.Sql.query(db,completion_state_sql(id,player,event)))
    IO.pure(String,Tx.trim_nl(state))

def completion_state_event(db: String, id: String, player: String, event: String, admitted: Bool) -> IO(String):
  match admitted:
    case False{}: IO.pure(String,"")
    case True{}: completion_state(db,id,player,event)

def completion_note_id_sql(+id: String, +event: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT " ++ C.q(id ++ ":observation-conflict:") ++ " || coalesce(json_extract(value,'$.id'),json_extract(value,'$.payload.command_id'),json_extract(value,'$.command_id'),'unknown') FROM frame;"

def completion_conflict_note(+db: String, player: String, +id: String, +event: String, conflict: Bool) -> IO(Unit):
  match conflict:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      note_id : String <- IO.try(String,DB.Sql.query(db,completion_note_id_sql(id,event)))
      saved : Unit <- report(db,player,Tx.trim_nl(note_id),"A native terminal produced output for report ID " ++ id ++ " after a different report already used that ID. The original report is preserved; this terminal event remains in the native log.")
      IO.pure(Unit,Unit{})

def terminal_observation_sealed(sealed: Bool, terminal: Bool, admitted: Bool, +state: String) -> Bool:
  match sealed:
    case True{}: True{}
    case False{}: Bool.and(terminal,Bool.or(Bool.not(admitted),Bool.not(String.is_empty(state))))

def observe_event(db: String, player: String, id: String, line: String, relevant: Bool, sealed: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match relevant:
    case True{}: Store.commit(db,C.Observe{id,player,line,sealed})
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})

# A terminal that completes after the managed completion was sealed cannot be
# recorded as a report under the sealed identity: the first terminal stays the
# report of this receive attempt, and a later episode is named once in the
# separate diagnostic with the guidance it leaves for the next receive.
def deferred_terminal_sql(+event: String, +terminal: String) -> String:
  "WITH frame(value,terminal) AS (VALUES(" ++ C.q(event) ++ "," ++ C.q(terminal) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN value='' THEN 0 WHEN terminal='' THEN 0 WHEN value=terminal THEN 0 WHEN " ++ C.terminal_expr("frame.value") ++ " THEN 1 ELSE 0 END ELSE 0 END FROM frame;"

def muse_deferred_terminal_sql(+event: String, +terminal: String, +primary: String, +current: String) -> String:
  +candidate = primary_terminal_expr("frame.value",current)
  +later = C.q(current) ++ "<>'' AND " ++ C.q(current) ++ "<>" ++ C.q(primary)
  "WITH frame(value,terminal) AS (VALUES(" ++ C.q(event) ++ "," ++ C.q(terminal) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN value='' THEN 0 WHEN terminal='' THEN 0 WHEN value=terminal THEN 0 WHEN " ++ candidate ++ " AND " ++ later ++ " THEN 1 ELSE 0 END ELSE 0 END FROM frame;"

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

# A later OMP failure sends its observed status and diagnostic to the parent.
def deferred_failure_text(+id: String, +failure: String, +pending: String) -> String:
  "A later native terminal failed after the report " ++ id ++ " was sealed: " ++ failure ++ "; the episode is retained in the native log" ++ deferred_pending(pending) ++ "."

def write_deferred(+db: String, +player: String, +id: String, +failure: String, +pending: String, recorded: Bool) -> IO(Unit):
  match recorded:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      noted : Unit <- report(db,player,id ++ ":deferred",Bool.pick(String,String.is_empty(failure),deferred_text(id,pending),deferred_failure_text(id,failure,pending)))
      IO.pure(Unit,Unit{})

def record_deferred(+db: String, +player: String, +id: String, +event: String, later: Bool) -> IO(Unit):
  match later:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      presence : String <- IO.try(String,DB.Sql.query(db,deferred_recorded_sql(id)))
      pending : String <- IO.try(String,DB.Sql.query(db,deferred_pending_sql(player)))
      failure : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(" ++ C.omp_terminal_error_text_sql(event) ++ ",'');"))
      written : Unit <- write_deferred(db,player,id,Tx.trim_nl(failure),Tx.trim_nl(pending),String.eq(presence,"1\n"))
      IO.pure(Unit,Unit{})

def deferred_query(event: String, terminal: String, primary: String, current: String, muse: Bool) -> String:
  match muse:
    case False{}: deferred_terminal_sql(event,terminal)
    case True{}: muse_deferred_terminal_sql(event,terminal,primary,current)

# Only a later terminal can produce this note. Progress frames keep draining
# without constructing a query that embeds the saved terminal.
def deferred_note(+db: String, player: String, id: String, +event: String, terminal: String, primary: String, current: String, enabled: Bool, muse: Bool) -> IO(Unit):
  match enabled:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      query : String <- IO.pure(String,deferred_query(event,terminal,primary,current,muse))
      later : String <- IO.try(String,DB.Sql.query(db,query))
      noted : Unit <- record_deferred(db,player,id,event,String.eq(later,"1\n"))
      IO.pure(Unit,Unit{})

def append_frame(log: String, line: String, keep: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match keep:
    case True{}: T.Text.append(log,line ++ "\n")
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

# Read the OMP frame type once for level filtering and event observation.
def omp_frame_kind(db: String, line: String, omp: Bool) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(line) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE json_extract(value,'$.type') WHEN 'message_update' THEN 'message_update' WHEN 'tool_execution_update' THEN 'tool_execution_update' WHEN 'message_start' THEN 'message_start' WHEN 'response' THEN 'response' WHEN 'message_end' THEN 'message_end' WHEN 'tool_execution_start' THEN 'tool_execution_start' WHEN 'tool_execution_end' THEN 'tool_execution_end' WHEN 'turn_end' THEN 'turn_end' WHEN 'agent_end' THEN 'agent_end' WHEN 'extension_ui_request' THEN 'extension_ui_request' ELSE '' END ELSE '' END FROM frame;"))

# Codex command pairs use the text identifier at item.id. Unidentified and
# unrelated frames keep an empty kind and remain at every level.
def codex_frame_kind(db: String, line: String) -> IO(String):
  IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(line) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN json_extract(value,'$.item.type')='command_execution' AND json_type(value,'$.item.id')='text' AND json_extract(value,'$.item.id')<>'' THEN CASE json_extract(value,'$.type') WHEN 'item.started' THEN 'codex_command_start' WHEN 'item.completed' THEN 'codex_command_end' ELSE '' END ELSE '' END ELSE '' END FROM frame;"))

def frame_kind_selected(db: String, line: String, harness: String, codex: Bool) -> IO(String):
  match codex:
    case True{}: codex_frame_kind(db,line)
    case False{}: omp_frame_kind(db,line,String.eq(harness,"omp\n"))

def frame_kind(db: String, line: String, +harness: String) -> IO(String):
  frame_kind_selected(db,line,harness,String.eq(harness,"codex\n"))

# The requested selection is active only when the server answered the
# set_event_filter request successfully with that exact selection: the echoed
# events value must equal the requested events JSON and the echoed
# messageUpdates value must match it, null with full and the array with delta.
# A successful answer without that selection is unconfirmed, an unsuccessful
# answer is refused, and a response for another command or any other line
# leaves the turn's mode unchanged. The nested CASE keeps json extraction
# behind the validity check, so unrelated non-JSON native output never becomes
# an observer error. The requested selection is captured when the turn starts.
def filter_mode_sql(+line: String, +requested: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ C.q(line) ++ ") THEN CASE WHEN json_extract(" ++ C.q(line) ++ ",'$.type')='response' AND json_extract(" ++ C.q(line) ++ ",'$.id')='baton:filter' AND json_extract(" ++ C.q(line) ++ ",'$.command')='set_event_filter' THEN CASE WHEN json_extract(" ++ C.q(line) ++ ",'$.success')=1 THEN CASE WHEN CASE WHEN " ++ C.q(requested) ++ "='unknown' THEN 0 WHEN " ++ C.q(requested) ++ "='null' THEN json_type(" ++ C.q(line) ++ ",'$.data.events')='null' AND json_extract(" ++ C.q(line) ++ ",'$.data.messageUpdates')='full' ELSE CASE WHEN json_type(" ++ C.q(line) ++ ",'$.data.events')='array' THEN json(json_extract(" ++ C.q(line) ++ ",'$.data.events'))=json(" ++ C.q(requested) ++ ") AND json_extract(" ++ C.q(line) ++ ",'$.data.messageUpdates')='delta' ELSE 0 END END THEN CASE WHEN " ++ C.q(requested) ++ "='null' THEN 'null+full' ELSE 'array+delta' END ELSE 'unconfirmed' END ELSE 'refused' END ELSE '' END ELSE '' END;"

def filter_mode(db: String, +line: String, omp: Bool, +requested: String) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,DB.Sql.query(db,filter_mode_sql(line,requested)))

def record_filter(log: String, +state: String, +requested: String, omp: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match omp:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: append_frame(log,Omp.filter_note(state,requested),True{})

def terminal_event(event: String, previous: String, selected: Bool) -> IO(String):
  match selected:
    case False{}: IO.pure(String,previous)
    case True{}: IO.pure(String,event)

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

def with_restore_result(-A: Type, result: Result<&1,&1,U32 & String,Unit>, next: String -> Bool -> IO(A)) -> IO(A):
  match result:
    case Fail{error}: next(error_text(error),True{})
    case Done{unit}: next("",False{})

# The host returns a right-nested line, notice and subscription status.
type WakeRead is Data:
  AwakeEnd{notice: String, active: Bool}
  AwakeLine{line: String, notice: String, active: Bool}

def wake_read(line: Maybe<String>, notice: String, active: Bool) -> WakeRead:
  match line:
    case None{}: AwakeEnd{notice,active}
    case Some{text}: AwakeLine{text,notice,active}

def subscribe_handle(opened: Result<&1,&1,U32 & String,U32 & String>) -> U32:
  match opened:
    case Fail{error}: 0
    case Done{(sub,readiness)}: sub

def subscribe_active(opened: Result<&1,&1,U32 & String,U32 & String>) -> Bool:
  match opened:
    case Fail{error}: False{}
    case Done{value}: True{}

def wake_close(sub: U32, active: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),active,Custody.Instance.unsubscribe(sub),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))

def plain_wake_result(result: Result<&1,&1,U32 & String,Maybe<String>>) -> Result<&1,&1,U32 & String,WakeRead>:
  match result:
    case Fail{error}: Fail{error}
    case Done{line}: Done{wake_read(line,"",False{})}

def plain_wake_line(read: U32) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  do IO<Result<&1,&1,U32 & String,WakeRead>>:
    line : Result<&1,&1,U32 & String,Maybe<String>> <- P.ProcessChild.read_line(read)
    IO.pure(Result<&1,&1,U32 & String,WakeRead>,plain_wake_result(line))

def notice_wake_value(sub: U32, value: Maybe<String> & (String & U32)) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  (line,(notice,health))=value
  +active=U32.is_eq(health,1)
  do IO<Result<&1,&1,U32 & String,WakeRead>>:
    closed : Result<&1,&1,U32 & String,Unit> <- wake_close(sub,Bool.not(active))
    IO.pure(Result<&1,&1,U32 & String,WakeRead>,Done{wake_read(line,notice,active)})

def notice_wake_result(+read: U32, sub: U32, result: Result<&1,&1,U32 & String,Maybe<String> & (String & U32)>) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  match result:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,WakeRead>>:
      closed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.unsubscribe(sub)
      plain_wake_line(read)
    case Done{value}: notice_wake_value(sub,value)

def notice_wake_line(+read: U32, +sub: U32) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  do IO<Result<&1,&1,U32 & String,WakeRead>>:
    result : Result<&1,&1,U32 & String,Maybe<String> & (String & U32)> <- P.ProcessChild.read_awake(read,sub)
    notice_wake_result(read,sub,result)

def wake_line(+read: U32, sub: U32, active: Bool) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  Bool.pick(IO(Result<&1,&1,U32 & String,WakeRead>),active,notice_wake_line(read,sub),plain_wake_line(read))

@unsafe
def consume_exhausted(+db: String, player: String, id: String, +log: String, held: String, +log_failed: Bool, handle: U32, +harness: String, codex_log: String, terminal: String, filter: String, requested: String, first_error: String, sender: Chan(Result<&1,&1,U32 & String,Unit>), +attempt: String, incomplete_observation: Bool, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, wake_sub: U32, wake_on: Bool) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
    +wake_closed : Result<&1,&1,U32 & String,Unit> <- wake_close(wake_sub,wake_on)
    +sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
    +status : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    +flushed : Result<&1,&1,U32 & String,Unit> <- Logs.write_lines(log,Logs.flush(held),log_failed)
    +write_failed : Bool <- IO.pure(Bool,Logs.failed_now(log_failed,flushed))
    +event : String <- codex_finished(db,player,id,codex_log,terminal,String.eq(harness,"codex\n"),write_failed)
    +checkpoint_done : Result<&1,&1,U32 & String,Unit> <- checkpoint(Bool.and(String.is_empty(attempt),Bool.not(write_failed)),log,"")
    +noted : Result<&1,&1,U32 & String,Unit> <- record_filter(log,filter,requested,Bool.and(String.eq(harness,"omp\n"),Bool.not(write_failed)))
    +closed : Result<&1,&1,U32 & String,String> <- NativeRequests.closed(db,attempt,Bool.not(String.is_empty(attempt)))
    sent_error : String <- IO.pure(String,append_write_error(append_write_error(first_error,wake_closed),sent))
    waited_error : String <- IO.pure(String,append_store_error(sent_error,status))
    log_error : String <- IO.pure(String,append_write_error(append_write_error(append_write_error(waited_error,flushed),checkpoint_done),noted))
    +error : String <- IO.pure(String,append_store_error(log_error,closed))
    +incomplete : Bool <- IO.pure(Bool,Bool.or(incomplete_observation,Bool.or(checkpoint_write_failed(wake_closed),Bool.or(wait_failed(status),Bool.or(checkpoint_write_failed(sent),Bool.or(checkpoint_write_failed(flushed),Bool.or(checkpoint_write_failed(checkpoint_done),Bool.or(checkpoint_write_failed(noted),observation_store_failed(closed)))))))))
    IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(Ended{status_text(status),event,error,incomplete},deliveries))

@unsafe
def consume(+db: String, +player: String, +id: String, +log: String, +policy: Logs.Policy, +held: String, +log_failed: Bool, +handle: U32, +harness: String, +cursor: String, +last_message: String, +primary: String, +current: String, +terminal: String, +filter: String, +requested: String, +codex_log: String, +first_error: String, +sender: Chan(Result<&1,&1,U32 & String,Unit>), +attempt: String, +checkpoint_state: Observer.State, +incomplete_observation: Bool, +wake_sub: U32, wake_on: Bool, +deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, result: Result<&1,&1,U32 & String,WakeRead>) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  match result:
    case Fail{error}: do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
      wake_closed : Result<&1,&1,U32 & String,Unit> <- wake_close(wake_sub,wake_on)
      closed : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.close_stdin(handle)
      sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
      +waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
      +flushed : Result<&1,&1,U32 & String,Unit> <- Logs.write_lines(log,Logs.flush(held),log_failed)
      +write_failed : Bool <- IO.pure(Bool,Logs.failed_now(log_failed,flushed))
      checkpoint_done : Result<&1,&1,U32 & String,Unit> <- checkpoint(Bool.and(String.is_empty(attempt),Bool.not(write_failed)),log,"")
      named : Result<&1,&1,U32 & String,Unit> <- Logs.write_lines(log,Logs.interrupted(held),write_failed)
      read_error : String <- IO.pure(String,append_error(first_error,"Native output read failed: " ++ error_text(error)))
      sent_error : String <- IO.pure(String,append_write_error(append_write_error(append_write_error(read_error,wake_closed),closed),sent))
      waited_error : String <- IO.pure(String,append_store_error(sent_error,waited))
      error : String <- IO.pure(String,append_write_error(append_write_error(append_write_error(waited_error,flushed),checkpoint_done),named))
      IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(Ended{status_text(waited),terminal,error,True{}},deliveries))
    case Done{AwakeEnd{+notice,+alive}}: do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
      +drained : String <- Guidance.awake_pending(db,player,handle,cursor,Bool.and(String.eq(harness,"omp\n"),Bool.and(Bool.not(String.is_empty(notice)),String.is_empty(terminal))))
      Bool.pick(IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>),String.is_empty(notice),
        consume_exhausted(db,player,id,log,held,log_failed,handle,harness,codex_log,terminal,filter,requested,first_error,sender,attempt,incomplete_observation,deliveries,wake_sub,alive),
        do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
          next : Result<&1,&1,U32 & String,WakeRead> <- wake_line(handle,wake_sub,alive)
          consume(db,player,id,log,policy,held,log_failed,handle,harness,drained,last_message,primary,current,terminal,filter,requested,codex_log,first_error,sender,attempt,checkpoint_state,incomplete_observation,wake_sub,alive,deliveries,next))
    case Done{AwakeLine{+line,notice,+alive}}:
      do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
        +drained : String <- Guidance.awake_pending(db,player,handle,cursor,Bool.and(String.eq(harness,"omp\n"),Bool.and(Bool.not(String.is_empty(notice)),String.is_empty(terminal))))
        +current_policy : Logs.Policy <- Logs.level_open(db,player)
        +kind : String <- frame_kind(db,line,harness)
        +frame_key : String <- Logs.frame_identity(db,line,Tx.trim_nl(kind),String.eq(harness,"omp\n"))
        +message_frame : Bool <- IO.pure(Bool,Bool.and(String.eq(harness,"omp\n"),String.eq(Tx.trim_nl(kind),"message_end")))
        +message : String <- omp_message(db,line,last_message,message_frame)
        +activity_frame : Bool <- IO.pure(Bool,Bool.and(String.eq(harness,"omp\n"),Bool.or(String.eq(Tx.trim_nl(kind),"message_start"),String.eq(Tx.trim_nl(kind),"message_end"))))
        +activity : String <- omp_activity(db,line,Observer.omp_activity(checkpoint_state),activity_frame)
        +event : String <- omp_terminal(db,line,message,activity,Bool.and(String.eq(harness,"omp\n"),String.eq(Tx.trim_nl(kind),"agent_end")))
        +kept : String <- Logs.retained(db,current_policy,Tx.trim_nl(kind),line,event,log)
        +step : List<String> & String <- IO.pure(List<String> & String,Logs.frame_step(current_policy,Tx.trim_nl(kind),frame_key,kept,held))
        +next_held : String <- IO.pure(String,Logs.step_held(step))
        +logged : Result<&1,&1,U32 & String,Unit> <- Logs.write_lines(log,Logs.step_lines(step),log_failed)
        +saved_checkpoint : Result<&1,&1,U32 & String,Unit> <- checkpoint_written(logged,Bool.and(String.is_empty(attempt),Bool.and(Bool.not(log_failed),Bool.not(String.eq(held,next_held)))),log,next_held)
        +written : Result<&1,&1,U32 & String,Unit> <- IO.pure(Result<&1,&1,U32 & String,Unit>,Logs.first_failure(saved_checkpoint,logged))
        +failed : Bool <- IO.pure(Bool,Logs.failed_now(log_failed,written))
        +relevant : Bool <- IO.pure(Bool,Guidance.relevant(kind,String.eq(harness,"omp\n")))
        +sealed : Bool <- IO.pure(Bool,Bool.not(String.is_empty(terminal)))
        +next_cursor : String <- Guidance.observe(db,player,handle,line,drained,Bool.and(String.eq(harness,"omp\n"),relevant))
        +next_primary : String <- primary_command(db,event,primary,String.eq(harness,"muse\n"))
        +next_current : String <- current_command(db,event,current,String.eq(harness,"muse\n"))
        +terminal_frame : Bool <- primary_terminal(db,event,"",False{})
        +admitted : Bool <- terminal_admitted(db,event,next_primary,terminal_frame,String.eq(harness,"muse\n"))
        +state : String <- completion_state_event(db,id,player,event,admitted)
        +observation_sealed : Bool <- IO.pure(Bool,terminal_observation_sealed(sealed,terminal_frame,admitted,state))
        conflict_note : Unit <- completion_conflict_note(db,player,id,event,String.eq(state,"conflict"))
        deferred : Unit <- deferred_note(db,player,id,event,terminal,next_primary,next_current,Bool.and(sealed,terminal_frame),String.eq(harness,"muse\n"))
        +observed : Result<&1,&1,U32 & String,String> <- observe_event(db,player,id,event,relevant,Bool.or(observation_sealed,failed))
        +terminal_selected : Bool <- IO.pure(Bool,Bool.and(relevant,Bool.and(admitted,Bool.not(sealed))))
        +ended : String <- terminal_event(event,terminal,terminal_selected)
        +closed_input : Result<&1,&1,U32 & String,Unit> <- close_input(handle,Bool.not(Bool.and(String.eq(harness,"omp\n"),Bool.and(String.is_empty(terminal),Bool.not(String.is_empty(ended))))))
        +codex_frame : Bool <- IO.pure(Bool,String.eq(harness,"codex\n"))
        +codex_state : String <- codex_frames(db,codex_log,line,codex_frame)
        questions : List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool <- NativeRequests.observe(db,player,id,attempt,line,deliveries,Bool.and(Bool.not(String.is_empty(attempt)),String.eq(kind,"extension_ui_request\n")))
        +mode : String <- filter_mode(db,line,Bool.and(String.eq(harness,"omp\n"),String.eq(Tx.trim_nl(kind),"response")),requested)
        +next_filter : String <- IO.pure(String,Omp.filter_next(filter,Tx.trim_nl(mode)))
        +next_checkpoint : Observer.State <- IO.pure(Observer.State,Observer.with_omp_activity(Observer.make(next_cursor,message,next_primary,next_current,ended,next_filter,codex_state,next_held),activity))
        NativeRequests.with_observation(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,questions,wakes => question_error => question_incomplete => do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
          +question_text : String <- IO.pure(String,question_error)
          +request_incomplete : Bool <- IO.pure(Bool,question_incomplete)
          +checkpoint_enabled : Bool <- IO.pure(Bool,Bool.and(Bool.not(incomplete_observation),Bool.and(Bool.not(failed),Bool.and(Bool.not(request_incomplete),Bool.and(Bool.not(String.is_empty(attempt)),Observer.checkpoint_due_fields(checkpoint_state,next_checkpoint,message_frame,terminal_selected,codex_frame))))))
          +checkpointed : Result<&1,&1,U32 & String,Unit> <- Observer.after_observation(db,handle,next_checkpoint,checkpoint_enabled,observed)
          checkpoint_notice : Unit <- checkpoint_failure_notice(db,player,id,attempt,checkpoint_enabled,checkpointed)
          +next_error : String <- IO.pure(String,append_write_error(append_write_error(append_store_error(append_write_error(append_error(first_error,question_text),written),observed),closed_input),checkpointed))
          +next_incomplete : Bool <- IO.pure(Bool,Bool.or(incomplete_observation,Bool.or(request_incomplete,Bool.or(observation_store_failed(observed),Bool.or(checkpoint_write_failed(closed_input),Bool.or(checkpoint_write_failed(checkpointed),failed))))))
          next : Result<&1,&1,U32 & String,WakeRead> <- wake_line(handle,wake_sub,alive)
          consume(db,player,id,log,current_policy,next_held,failed,handle,harness,next_cursor,message,next_primary,next_current,ended,next_filter,requested,codex_state,next_error,sender,attempt,next_checkpoint,next_incomplete,wake_sub,alive,wakes,next))

def direct_observed(observation: Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>) -> IO(Outcome):
  (outcome,deliveries)=observation
  do IO<Outcome>:
    settled : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    IO.pure(Outcome,outcome)

def started(+db: String, +player: String, +id: String, +log: String, prompt: String, +harness: String, result: Result<&1,&1,U32 & String,U32>) -> IO(Outcome):
  match result:
    case Fail{error}: IO.pure(Outcome,Ended{"start failed","","Player process could not start: " ++ error_text(error),True{}})
    case Done{+handle}:
      do IO<Outcome>:
        +generation : String <- IO.pure(String,generation_log(log,id))
        +policy : Logs.Policy <- Logs.open_attempt(db,player,log,id)
        +level : String <- IO.pure(String,policy_level(policy))
        +requested : String <- IO.pure(String,Omp.filter_events(level))
        restored : Result<&1,&1,U32 & String,Unit> <- checkpoint_restore(generation)
        with_restore_result(Outcome,restored,restore_error => restore_failed => do IO<Outcome>:
          sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,send_prompt(handle,prompt,harness,level))
          first : Result<&1,&1,U32 & String,WakeRead> <- plain_wake_line(handle)
          observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- consume(db,player,id,generation,policy,"",False{},handle,harness,"0\n","","","","","",requested,"",restore_error,sender,"",Observer.empty(),restore_failed,0,False{},Nil{},first)
          direct_observed(observation))

# The retained process sends its initial input once. Reattachment reads the same
# attempt from its first frame so native completion can be reconstructed.
@unsafe
def retained_output(+db: String, +player: String, +id: String, +log: String, +harness: String, attempt: String, +handle: U32, +supplied_requested: String) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
    +generation : String <- IO.pure(String,generation_log(log,id))
    +policy : Logs.Policy <- Logs.open_attempt(db,player,log,id)
    sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    +checkpoint_state : Observer.State <- Observer.restore(db,handle)
    +opened : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db,"0","0")
    +wake_sub : U32 <- IO.pure(U32,subscribe_handle(opened))
    +wake_on : Bool <- IO.pure(Bool,subscribe_active(opened))
    first : Result<&1,&1,U32 & String,WakeRead> <- wake_line(handle,wake_sub,wake_on)
    cursor : String <- IO.pure(String,Observer.cursor(checkpoint_state))
    last_message : String <- IO.pure(String,Observer.last_message(checkpoint_state))
    primary : String <- IO.pure(String,Observer.muse_primary(checkpoint_state))
    current : String <- IO.pure(String,Observer.muse_current(checkpoint_state))
    terminal : String <- IO.pure(String,Observer.terminal(checkpoint_state))
    filter : String <- IO.pure(String,Observer.filter_mode(checkpoint_state))
    +requested : String <- IO.pure(String,Bool.pick(String,String.eq(supplied_requested,"unknown"),Omp.filter_requested(Observer.filter_mode(checkpoint_state)),supplied_requested))
    codex_log : String <- IO.pure(String,Observer.codex_log(checkpoint_state))
    held : String <- IO.pure(String,Observer.held(checkpoint_state))
    consume(db,player,id,generation,policy,held,False{},handle,harness,cursor,last_message,primary,current,terminal,filter,requested,codex_log,"",sender,attempt,checkpoint_state,False{},wake_sub,wake_on,Nil{},first)

def muse_retained_arguments(cmd: String, model: String, effort: String, prompt_file: String, +session: String) -> List<String>:
  Muse.resume_arguments(cmd,model,effort,prompt_file,session)

def retained_arguments(omp: Bool, claude: Bool, +cmd: String, +model: String, +effort: String, sessions: String, +native: String) -> String:
  Bool.pick(String,claude,
    Claude.argv(cmd,model,effort,native,String.is_empty(native)),
  Bool.pick(String,omp,Omp.argv(cmd,model,effort,sessions,native,String.is_empty(native)),Codex.argv(cmd,model,effort,native,String.is_empty(native))))

def profile_path(+db: String, player: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,Subs.profile_record_sql(db,player)))
    IO.pure(String,Tx.trim_nl(saved))

# The profile in use is the last line of the session's append-only record. A missing
# record keeps the harness's default store. Other read failures stop the launch with
# the filesystem's code and detail.
def current_store(db: String, player: String) -> IO(String):
  do IO<String>:
    path : String <- profile_path(db,player)
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    text : String <- IO.pass(String,Subs.optional_text(read))
    IO.pure(String,Subs.record_store(Subs.last_line(Tx.split_lines(text))))

def history_path(+db: String, player: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,Subs.history_record_sql(db,player)))
    IO.pure(String,Tx.trim_nl(saved))

# The preserved provider history home recorded at the last handoff, or "" when the
# session has no such record: an empty home adds no argument, so a session that never
# switched store spawns with the environment and configuration it has today. The last
# non-empty line is the handoff in force; the home is read through the database's
# JSON reader, which retains a malformed JSON failure.
def current_history(+db: String, player: String) -> IO(String):
  do IO<String>:
    path : String <- history_path(db,player)
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    text : String <- IO.pass(String,Subs.optional_text(read))
    +line : String <- IO.pure(String,Subs.last_line(Tx.split_lines(text)))
    home : String <- Bool.pick(IO(String),String.is_empty(line),IO.pure(String,""),IO.try(String,DB.Sql.query(db,Subs.history_home_sql(line))))
    IO.pure(String,Tx.trim_nl(home))

# The recorded route with the profile's credential store bound into the spawn argv and
# the preserved provider history home carried as an ordinary config argument; an empty
# binding keeps today's argv through retained_arguments, so a session with no record
# spawns exactly as before.
def retained_profile_other(omp: Bool, binding: List<String>, override: List<String>, cmd: String, model: String, effort: String, sessions: String, +native: String) -> String:
  match omp:
    case True{}: Omp.argv(cmd,model,effort,sessions,native,String.is_empty(native))
    case False{}: Codex.argv_profile(binding,override,cmd,model,effort,native,String.is_empty(native))

def retained_profile_arguments(omp: Bool, claude: Bool, binding: List<String>, override: List<String>, cmd: String, model: String, effort: String, sessions: String, +native: String) -> String:
  match claude:
    case True{}: Claude.argv_profile(binding,cmd,model,effort,native,String.is_empty(native))
    case False{}: retained_profile_other(omp,binding,override,cmd,model,effort,sessions,native)

def retained_identity_prefix(model: String, identity: String & String) -> String:
  (registry,helper)=identity
  +configured=registry
  P.argv(Bool.pick(List<String>,String.is_empty(configured),Nil{},["node",helper,"launch","--registry",configured,"--model-key",model,"--"]))

# Claude reads one user frame from its input; OMP reads its prompt frames there.
# The OMP frames carry the filter request for the session log level read
# before admission, so the provider receives the selection before get_state.
def retained_input(muse: Bool, omp: Bool, claude: Bool, +prompt: String, level: String) -> String:
  Bool.pick(String,muse,"",Bool.pick(String,claude,Claude.user_frame(prompt),Bool.pick(String,omp,Omp.prompt(prompt,level),prompt)))

# The Muse task file, Claude's single frame and Codex's stdin all close the child's
# input; OMP keeps it open for steer frames.
def retained_keep_stdin(muse: Bool, omp: Bool, claude: Bool) -> U32:
  Bool.pick(U32,muse,0,Bool.pick(U32,claude,0,Bool.pick(U32,omp,1,0)))

def retained_mode(+db: String, +player: String, +directory: String, +cmd: String, +model: String, +effort: String, +cwd: String, +session: String, +harness: String, +sessions: String, +prompt: String, +lock: U32, +recovery: String, +level: String, seal_prompt: Bool) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
    alternate : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(sessions) ++ "=" ++ C.q(db ++ ".sessions") ++ " THEN CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END ELSE " ++ C.q(db ++ ".sessions") ++ " END FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    +native : String <- Omp.resume_file(sessions,Tx.trim_nl(alternate),session,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(session))))
    +prompt_file : String <- IO.pure(String,directory ++ "/prompt.txt")
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    identity : String & String <- IO.try(String & String,HostControl.Control.identity(executable))
    +prefix : String <- IO.pure(String,retained_identity_prefix(model,identity))
    muse_args : String <- IO.pure(String,prefix ++ P.argv(muse_retained_arguments(cmd,model,effort,prompt_file,session)))
    +omp : Bool <- IO.pure(Bool,String.eq(harness,"omp\n"))
    +claude : Bool <- IO.pure(Bool,String.eq(harness,"claude-code\n"))
    +store : String <- current_store(db,player)
    history : String <- current_history(db,player)
    +args : String <- IO.pure(String,prefix ++ Bool.pick(String,String.is_empty(store),retained_arguments(omp,claude,cmd,model,effort,sessions,native),retained_profile_arguments(omp,claude,Subs.store_binding(Tx.trim_nl(harness),store),Subs.history_override(Tx.trim_nl(harness),history),cmd,model,effort,sessions,native)))
    +input : String <- IO.pure(String,retained_input(False{},omp,claude,prompt,level))
    Bool.pick(IO(Result<&1,&1,U32 & String,P.RetainedStart>),String.eq(harness,"muse\n"),Custody.Instance.admit_with_file(db,directory,muse_args,cwd,directory ++ "/native.stderr","prompt.txt",prompt,retained_input(True{},omp,claude,prompt,level),retained_keep_stdin(True{},omp,claude),Some{lock},recovery),Bool.pick(IO(Result<&1,&1,U32 & String,P.RetainedStart>),seal_prompt,Custody.Instance.admit_with_file(db,directory,args,cwd,directory ++ "/native.stderr","prompt.txt",prompt,input,retained_keep_stdin(False{},omp,claude),Some{lock},recovery),Custody.Instance.admit(db,directory,args,cwd,directory ++ "/native.stderr",input,retained_keep_stdin(False{},omp,claude),Some{lock},recovery)))

def retained(+db: String, +player: String, +directory: String, +cmd: String, +model: String, +effort: String, +cwd: String, +session: String, +harness: String, +sessions: String, +prompt: String, +lock: U32, +recovery: String, +level: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  retained_mode(db,player,directory,cmd,model,effort,cwd,session,harness,sessions,prompt,lock,recovery,level,False{})

def direct_retained(+db: String, +player: String, +directory: String, +cmd: String, +model: String, +effort: String, +cwd: String, +session: String, +harness: String, +sessions: String, +prompt: String, +lock: U32, +recovery: String, +level: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  retained_mode(db,player,directory,cmd,model,effort,cwd,session,harness,sessions,prompt,lock,recovery,level,True{})

def claude_launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Claude.start_player(cmd,model,effort,cwd,stderr)
    case False{}: Claude.resume_player(cmd,model,effort,cwd,stderr,session)

def muse_launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Muse.start_player(cmd,model,effort,cwd,stderr,task)
    case False{}: Muse.resume_player(cmd,model,effort,cwd,stderr,session,task)

def launch(sessions: String, +cmd: String, +model: String, +effort: String, +cwd: String, +stderr: String, +session: String, +harness: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"omp\n"),
    Omp.start_player(cmd,model,effort,cwd,sessions,session,String.is_empty(session),stderr),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"muse\n"),
    muse_launch(cmd,model,effort,cwd,stderr,session,task,String.is_empty(session)),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"codex\n"),
    Codex.start_player(cmd,model,effort,cwd,stderr,session,String.is_empty(session)),
    claude_launch(cmd,model,effort,cwd,stderr,session,String.is_empty(session)))))

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
    case Ended{status,event,error,incomplete}:
      do IO<Bool>:
        text : Result<&1,&1,U32 & String,String> <- T.Text.read(log)
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
      stderr : String <- Logs.open_stderr_run(db,player,id,generation_log(log,id))
      child : Result<&1,&1,U32 & String,U32> <- launch(sessions,cmd,model,effort,cwd,stderr,"",harness,task)
      restart(db,player,id,log,note,harness,child)

def supervise_retry(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +sessions: String, +native: String, +stderr: String, +prompt: String, +first: Outcome) -> IO(Outcome):
  do IO<Outcome>:
    resumable : Bool <- IO.pure(Bool, Bool.not(String.is_empty(native)))
    gone : Bool <- refusal(stderr,resumable,first)
    supervise_gone(db,player,id,cmd,model,effort,cwd,task,log,harness,sessions,prompt,first,gone)

def supervise(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String, +harness: String, +sessions: String, +prompt: String) -> IO(Outcome):
  do IO<Outcome>:
    alternate : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(sessions) ++ "=" ++ C.q(db ++ ".sessions") ++ " THEN CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END ELSE " ++ C.q(db ++ ".sessions") ++ " END FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    +native : String <- Omp.resume_file(sessions,Tx.trim_nl(alternate),session,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(session))))
    +stderr : String <- Logs.open_stderr_run(db,player,id,generation_log(log,id))
    child : Result<&1,&1,U32 & String,U32> <- launch(sessions,cmd,model,effort,cwd,stderr,native,harness,task)
    first : Outcome <- started(db,player,id,log,prompt,harness,child)
    supervise_retry(db,player,id,cmd,model,effort,cwd,task,log,harness,sessions,native,stderr,prompt,first)

def task_read(db: String, player: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String, harness: String, sessions: String, result: Result<&1,&1,U32 & String,String>) -> IO(Outcome):
  match result:
    case Fail{error}: IO.pure(Outcome,Ended{"input failed","","Player task could not be read: " ++ error_text(error),True{}})
    case Done{prompt}: supervise(db,player,id,cmd,model,effort,cwd,task,log,session,harness,sessions,prompt)

def replay_result(result: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Maybe<Outcome>>:
  match result:
    case Fail{error}: Fail{error}
    case Done{unit}: Done{None{}}

# A public direct ID is bound to the bytes and launch fields that first used it.
# This table is the durable input for replay; the completion message remains the
# durable result. Existing reports without this input record stay readable by
# delivery ID and cannot be rebound by a later invocation.
def direct_request_schema() -> String:
  "CREATE TABLE IF NOT EXISTS direct_turn_requests(id TEXT PRIMARY KEY NOT NULL,session TEXT NOT NULL,harness TEXT NOT NULL,command TEXT NOT NULL,model TEXT NOT NULL,effort TEXT NOT NULL,workspace TEXT NOT NULL,task_path TEXT NOT NULL,task TEXT NOT NULL,output TEXT NOT NULL,native TEXT NOT NULL,directory TEXT NOT NULL);"

def direct_request_match(+id: String, +player: String, +harness: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +prompt: String, +log: String, +session: String, +directory: String) -> String:
  "id=" ++ C.q(id) ++ " AND session=" ++ C.q(player) ++ " AND harness=" ++ C.q(harness) ++ " AND command=" ++ C.q(cmd) ++ " AND model=" ++ C.q(model) ++ " AND effort=" ++ C.q(effort) ++ " AND workspace=" ++ C.q(cwd) ++ " AND task_path=" ++ C.q(task) ++ " AND task=" ++ C.q(prompt) ++ " AND output=" ++ C.q(log) ++ " AND native=" ++ C.q(session) ++ " AND directory=" ++ C.q(directory)

def direct_request_sql(+id: String, +player: String, +harness: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +prompt: String, +log: String, +session: String, +directory: String) -> String:
  "BEGIN IMMEDIATE;" ++ direct_request_schema()
  ++ "INSERT INTO direct_turn_requests(id,session,harness,command,model,effort,workspace,task_path,task,output,native,directory) SELECT " ++ C.q(id) ++ "," ++ C.q(player) ++ "," ++ C.q(harness) ++ "," ++ C.q(cmd) ++ "," ++ C.q(model) ++ "," ++ C.q(effort) ++ "," ++ C.q(cwd) ++ "," ++ C.q(task) ++ "," ++ C.q(prompt) ++ "," ++ C.q(log) ++ "," ++ C.q(session) ++ "," ++ C.q(directory) ++ " WHERE NOT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") ON CONFLICT(id) DO NOTHING;"
  ++ "SELECT CASE WHEN EXISTS(SELECT 1 FROM direct_turn_requests WHERE " ++ direct_request_match(id,player,harness,cmd,model,effort,cwd,task,prompt,log,session,directory) ++ ") THEN '' WHEN EXISTS(SELECT 1 FROM direct_turn_requests WHERE id=" ++ C.q(id) ++ ") THEN 'The direct turn ID belongs to a different retained request; use a new turn ID.' WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") THEN 'The direct turn ID has a stored result without retained request input; use delivery to read that result and a new ID for new work.' ELSE 'The direct turn request could not be retained.' END;COMMIT;"

def direct_request_checked(+db: String, +id: String, +player: String, +harness: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +prompt: String, +log: String, +session: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    +error : String <- IO.try(String,DB.Sql.query(db,direct_request_sql(id,player,harness,cmd,model,effort,cwd,task,prompt,log,session,directory)))
    Stop.error_result(Tx.trim_nl(error),String.is_empty(Tx.trim_nl(error)))

# Recovery accepts the original, fresh, and account-continuation directories.
def direct_recovery_checked(+db: String, +player: String, +id: String, +harness: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM direct_turn_requests WHERE id=" ++ C.q(id) ++ " AND session=" ++ C.q(player) ++ " AND harness=" ++ C.q(harness) ++ " AND (directory=" ++ C.q(directory) ++ " OR directory || '.fresh'=" ++ C.q(directory) ++ " OR substr(" ++ C.q(directory) ++ ",1,length(directory)+11)=directory || '.continued-' OR substr(" ++ C.q(directory) ++ ",1,length(directory)+17)=directory || '.fresh.continued-');"))
    Stop.error_result("Recorded direct recovery arguments differ from the retained request; preserve the attempt and inspect its manifest.",String.eq(found,"1\n"))

# Continue the requested conversation or the conversation recorded by the attempt.
def direct_conversation(+db: String, +player: String, +session: String) -> IO(String):
  do IO<String>:
    recorded : String <- IO.try(String,DB.Sql.query(db,"SELECT native FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    IO.pure(String,Bool.pick(String,String.is_empty(Tx.trim_nl(session)),Tx.trim_nl(recorded),Tx.trim_nl(session)))

# Each account continuation uses a separate retained attempt directory.
def direct_continued_directory(+db: String, +player: String, +directory: String) -> IO(String):
  do IO<String>:
    record_path : String <- profile_path(db,player)
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(record_path)
    text : String <- IO.pass(String,Subs.optional_text(read))
    +label : String <- IO.pure(String,Subs.record_label(Subs.last_line(Tx.split_lines(text))))
    IO.pure(String,directory ++ ".continued-" ++ label)

def direct_directory(+db: String, id: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.q(db ++ ".direct-") ++ " || lower(hex(" ++ C.q(id) ++ "));"))
    IO.pure(String,Tx.trim_nl(value))

def direct_recovery_argv(+executable: String, +db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +harness: String, +directory: String, +session: String) -> String:
  P.argv([executable,"--recover-direct",db,player,id,cmd,model,effort,cwd,log,Tx.trim_nl(harness),directory,session])

def direct_release_lock(lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit,Unit{})
    case Some{handle}: IO.try(Unit,Lock.SessionLock.release(handle))

def direct_acknowledge(+handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    acknowledged : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.acknowledge(handle)
    retired : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.retire(handle)
    IO.pure(Result<&1,&1,U32 & String,Unit>,combine(acknowledged,retired))

def direct_replay_finished(+db: String, +player: String, +lock: U32, output: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  do IO<Unit>:
    released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
    wake : Result<&1,&1,U32 & String,Unit> <- Delivery.wake_pending(db,player,"0")
    IO.pass(Unit,combine(output,wake))

def direct_cleanup(+handle: U32, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>) -> IO(Unit):
  do IO<Unit>:
    released : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    acknowledged : Result<&1,&1,U32 & String,Unit> <- direct_acknowledge(handle)
    IO.pass(Unit,combine(released,combine(questions,acknowledged)))

def direct_completed(+db: String, +player: String, +id: String, +log: String, +directory: String, +handle: U32, lock: Maybe<U32>, observation: Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>) -> IO(Unit):
  (+outcome,deliveries)=observation
  do IO<Unit>:
    exited : Unit <- record_exit(db,player,id,log,outcome)
    prepared : Unit <- prepare(db,player,id,log,directory ++ "/native.stderr",outcome)
    observer_released : Unit <- direct_release_lock(lock)
    native_released : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
    finished : Result<&1,&1,U32 & String,Unit> <- finish(db,player,id,log,outcome)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    acknowledged : Result<&1,&1,U32 & String,Unit> <- direct_acknowledge(handle)
    wake : Result<&1,&1,U32 & String,Unit> <- Delivery.wake_pending(db,player,"0")
    IO.pass(Unit,combine(native_released,combine(finished,combine(questions,combine(acknowledged,wake)))))

def direct_unstarted(+db: String, +player: String, +id: String, +log: String, +directory: String, lock: Maybe<U32>, error: String) -> IO(Unit):
  do IO<Unit>:
    +outcome : Outcome <- IO.pure(Outcome,Ended{"start failed","","Player process could not start: " ++ error,True{}})
    exited : Unit <- record_exit(db,player,id,log,outcome)
    prepared : Unit <- prepare(db,player,id,log,directory ++ "/native.stderr",outcome)
    released : Unit <- direct_release_lock(lock)
    finished : Result<&1,&1,U32 & String,Unit> <- finish(db,player,id,log,outcome)
    wake : Result<&1,&1,U32 & String,Unit> <- Delivery.wake_pending(db,player,"0")
    IO.pass(Unit,combine(finished,wake))

# Match a retained terminal observation as a signature parameter and run the
# locked continuation with its Ended fields.
def with_retained_outcome(held: U32, outcome: Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, locked: U32 -> String -> String -> String -> Bool -> List<Chan(Result<&1,&1,U32 & String,String>)> -> IO(Unit)) -> IO(Unit):
  match outcome:
    case Ended{status,event,error,incomplete}: locked(held,status,event,error,incomplete,deliveries)

# Dispatch a retained observation through unlocked and locked continuations.
def with_retained_observation(observation: Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>, lock: Maybe<U32>, unlocked: Outcome -> List<Chan(Result<&1,&1,U32 & String,String>)> -> IO(Unit), locked: U32 -> String -> String -> String -> Bool -> List<Chan(Result<&1,&1,U32 & String,String>)> -> IO(Unit)) -> IO(Unit):
  (outcome,deliveries)=observation
  match lock:
    case None{}: unlocked(outcome,deliveries)
    case Some{held}: with_retained_outcome(held,outcome,deliveries,locked)

# Self-recursive across successive handoffs, like the consume IO loops above.
@unsafe
def direct_second_started(+db: String, +player: String, +id: String, +log: String, +directory: String, +harness: String, +requested: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +prompt: String, +session: String, lock: Maybe<U32>, start: P.RetainedStart) -> IO(Unit):
  match start:
    case P.Retained{+handle}: do IO<Unit>:
      reconciled : Unit <- Stop.started(db,player,id,directory)
      observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- retained_output(db,player,id,log,harness,directory,handle,requested)
      with_retained_observation(observation,lock,
        +outcome => deliveries => direct_completed(db,player,id,log,directory,handle,None{},(outcome,deliveries)),
        +held => status => +event => error => incomplete => deliveries => do IO<Unit>:
          +conversation : String <- direct_conversation(db,player,session)
          advanced : Bool <- Subs.profile_handoff(db,player,id,event,conversation,cmd,cwd)
          match advanced:
            case False{}: direct_completed(db,player,id,log,directory,handle,Some{held},(Ended{status,event,error,incomplete},deliveries))
            case True{}: do IO<Unit>:
              cleaned : Unit <- direct_cleanup(handle,deliveries)
              +continued : String <- direct_continued_directory(db,player,directory)
              allowed : Bool <- Stop.admit(db,player,id,"direct",continued)
              admitted : Unit <- Stop.admitted(allowed)
              +executable : String <- IO.try(String,Lock.SessionLock.executable())
              +recovery : String <- IO.pure(String,direct_recovery_argv(executable,db,player,id,cmd,model,effort,cwd,log,harness,continued,conversation))
              +policy : Logs.Policy <- Logs.policy(db,player)
              +level : String <- IO.pure(String,policy_level(policy))
              next : P.RetainedStart <- IO.try(P.RetainedStart,direct_retained(db,player,continued,cmd,model,effort,cwd,conversation,harness,db ++ ".sessions",prompt,held,recovery,level))
              direct_second_started(db,player,id,log,continued,harness,Omp.filter_events(level),cmd,model,effort,cwd,task,prompt,conversation,Some{held},next))
    case P.Unstarted{error}: direct_unstarted(db,player,id,log,directory,lock,error)

def direct_restart_with_lock(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +outcome: Outcome, +lock: U32) -> IO(Unit):
  do IO<Unit>:
    +fresh : String <- IO.pure(String,directory ++ ".fresh")
    +note : String <- refused_note(cwd,prompt)
    exited : Unit <- record_exit(db,player,id,log,outcome)
    noted : Unit <- report(db,player,id ++ ":recovery","The recorded conversation could not be resumed; the turn restarted in a fresh conversation that names the workspace's current state.")
    allowed : Bool <- Stop.admit(db,player,id,"direct",fresh)
    admitted : Unit <- Stop.admitted(allowed)
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +recovery : String <- IO.pure(String,direct_recovery_argv(executable,db,player,id,cmd,model,effort,cwd,log,harness,fresh,""))
    +policy : Logs.Policy <- Logs.policy(db,player)
    +level : String <- IO.pure(String,policy_level(policy))
    start : P.RetainedStart <- IO.try(P.RetainedStart,direct_retained(db,player,fresh,cmd,model,effort,cwd,"",harness,db ++ ".sessions",note,lock,recovery,level))
    direct_second_started(db,player,id,log,fresh,harness,Omp.filter_events(level),cmd,model,effort,cwd,task,prompt,"",Some{lock},start)

def direct_restart_acquired(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +outcome: Outcome, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"The retained direct attempt ended before its recovery observer reacquired the session; inspect the attempt and retry its pending input.")
    case Some{handle}: direct_restart_with_lock(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,outcome,handle)

def direct_restart_cleaned(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +outcome: Outcome, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case Some{held}: direct_restart_with_lock(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,outcome,held)
    case None{}: Lock.SessionLock.acquire_session(Unit,db,player,+database => next => direct_restart_acquired(database,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,outcome,next))

# Start the next account on the same conversation while holding the session lock.
def direct_handoff_relaunch_locked(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +conversation: String, +lock: U32) -> IO(Unit):
  do IO<Unit>:
    +continued : String <- direct_continued_directory(db,player,directory)
    allowed : Bool <- Stop.admit(db,player,id,"direct",continued)
    admitted : Unit <- Stop.admitted(allowed)
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +recovery : String <- IO.pure(String,direct_recovery_argv(executable,db,player,id,cmd,model,effort,cwd,log,harness,continued,conversation))
    +policy : Logs.Policy <- Logs.policy(db,player)
    +level : String <- IO.pure(String,policy_level(policy))
    start : P.RetainedStart <- IO.try(P.RetainedStart,direct_retained(db,player,continued,cmd,model,effort,cwd,conversation,harness,db ++ ".sessions",prompt,lock,recovery,level))
    direct_second_started(db,player,id,log,continued,harness,Omp.filter_events(level),cmd,model,effort,cwd,task,prompt,conversation,Some{lock},start)

# Keeper recovery reacquires the session lock before starting the next account.
def direct_handoff_acquired(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +conversation: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"The retained direct attempt ended before its handoff continuation reacquired the session; inspect the attempt and retry its pending input.")
    case Some{held}: direct_handoff_relaunch_locked(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,conversation,held)

# Continue a settled handoff with the held or reacquired session lock.
def direct_handoff_settled(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +conversation: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case Some{held}: direct_handoff_relaunch_locked(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,conversation,held)
    case None{}: Lock.SessionLock.acquire_session(Unit,db,player,+database => next => direct_handoff_acquired(database,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,conversation,next))

# Provider-reported exhaustion advances through the operator's account list.
# Settle the completed attempt and continue its task and conversation.
def direct_handoff_checked(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +session: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, outcome: Outcome) -> IO(Unit):
  match outcome:
    case Ended{status,+event,error,incomplete}: do IO<Unit>:
      +conversation : String <- direct_conversation(db,player,session)
      advanced : Bool <- Subs.profile_handoff(db,player,id,event,conversation,cmd,cwd)
      match advanced:
        case False{}: direct_completed(db,player,id,log,directory,handle,lock,(Ended{status,event,error,incomplete},deliveries))
        case True{}: do IO<Unit>:
          cleaned : Unit <- direct_cleanup(handle,deliveries)
          direct_handoff_settled(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,conversation,lock)

def direct_restart(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, outcome: Outcome) -> IO(Unit):
  do IO<Unit>:
    cleaned : Unit <- direct_cleanup(handle,deliveries)
    direct_restart_cleaned(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,outcome,lock)

def direct_first_checked(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +session: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, outcome: Outcome, gone: Bool) -> IO(Unit):
  match gone:
    case True{}: direct_restart(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,handle,lock,deliveries,outcome)
    case False{}: direct_handoff_checked(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,session,handle,lock,deliveries,outcome)

def direct_first_observed(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +session: String, +prompt: String, +handle: U32, lock: Maybe<U32>, observation: Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>) -> IO(Unit):
  (+outcome,deliveries)=observation
  do IO<Unit>:
    gone : Bool <- refusal(directory ++ "/native.stderr",Bool.not(String.is_empty(session)),outcome)
    direct_first_checked(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,session,handle,lock,deliveries,outcome,gone)

def direct_first_started(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +session: String, +prompt: String, +requested: String, lock: Maybe<U32>, start: P.RetainedStart) -> IO(Unit):
  match start:
    case P.Retained{+handle}: do IO<Unit>:
      reconciled : Unit <- Stop.started(db,player,id,directory)
      observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- retained_output(db,player,id,log,harness,directory,handle,requested)
      direct_first_observed(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,session,prompt,handle,lock,observation)
    case P.Unstarted{error}: direct_unstarted(db,player,id,log,directory,lock,error)

def choose(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String, +harness: String, +directory: String, +prompt: String, +lock: U32, replay: Bool) -> IO(Unit):
  match replay:
    case True{}:
      do IO<Unit>:
        receiver : Unit <- Control.default_receiver(db,player,cmd,model,effort,cwd,log)
        +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
        written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)
        direct_replay_finished(db,player,lock,written)
    case False{}: do IO<Unit>:
      allowed : Bool <- Stop.admit(db,player,id,"direct",directory)
      admitted : Unit <- Stop.admitted(allowed)
      receiver : Unit <- Control.default_receiver(db,player,cmd,model,effort,cwd,log)
      +executable : String <- IO.try(String,Lock.SessionLock.executable())
      +recovery : String <- IO.pure(String,direct_recovery_argv(executable,db,player,id,cmd,model,effort,cwd,log,harness,directory,session))
      +policy : Logs.Policy <- Logs.policy(db,player)
      +level : String <- IO.pure(String,policy_level(policy))
      start : P.RetainedStart <- IO.try(P.RetainedStart,direct_retained(db,player,directory,cmd,model,effort,cwd,session,harness,db ++ ".sessions",prompt,lock,recovery,level))
      direct_first_started(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,session,prompt,Omp.filter_events(level),Some{lock},start)

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

def player_checked(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String, +harness: String, +lock: U32, missing: Bool) -> IO(Unit):
  match missing:
    case True{}: IO.die(Unit,2,"Player is not registered; register it before starting a turn.")
    case False{}:
      do IO<Unit>:
        supported : Unit <- supported_harness(Bool.or(String.eq(harness,"omp\n"),Bool.or(String.eq(harness,"codex\n"),Bool.or(String.eq(harness,"claude-code\n"),String.eq(harness,"muse\n")))))
        foreign : String <- IO.try(String,DB.Sql.query(db,id_owner_sql(id,player)))
        identity : Unit <- matching_turn(String.eq(foreign,"0\n"))
        +prompt : String <- IO.try(String,T.Text.read(task))
        +directory : String <- direct_directory(db,id)
        request : Unit <- direct_request_checked(db,id,player,Tx.trim_nl(harness),cmd,model,effort,cwd,task,prompt,log,session,directory)
        found : String <- IO.try(String,DB.Sql.query(db,turn_present_sql(id)))
        choose(db,player,id,cmd,model,effort,cwd,task,log,session,harness,directory,prompt,lock,String.eq(found,"1\n"))

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
# An exited execution can still retain an unfinished receive checkpoint.
def retained_receive_guard(+db: String, player: String) -> IO(Unit):
  do IO<Unit>:
    directory : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(player) ++ " AND mode='retained'),'');"))
    recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.recovery_argv(Tx.trim_nl(directory)))
    retained_receive_admitted(recovery)

def unresolved_direct_execution_guard(+db: String, player: String) -> IO(Unit):
  do IO<Unit>:
    active : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM executions WHERE session=" ++ C.q(player) ++ " AND mode='direct' AND phase<>'exited';"))
    Stop.error_result("Session retains an unresolved native attempt; observe its recorded receive or direct recovery before starting another turn.",String.eq(active,"0\n"))

def acquired(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, +log: String, session: String, missing: Bool, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Session already has an active native turn; send a message to queue input.")
    case Some{handle}: do IO<Unit>:
      retained : Unit <- retained_receive_guard(db,player)
      direct : Unit <- unresolved_direct_execution_guard(db,player)
      harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
      player_checked(db,player,id,cmd,model,effort,cwd,task,log,session,harness,handle,missing)

# The retained owner invokes this entry after the original observer exits. It
# attaches to the same native process and completes the same public turn ID.
def recover(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +harness: String, +directory: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    checked : Unit <- direct_recovery_checked(db,player,id,harness,directory)
    +recorded_harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    valid_harness : Unit <- Stop.error_result("Recorded direct recovery harness differs from the current session; preserve the attempt and inspect its manifest.",String.eq(Tx.trim_nl(recorded_harness),harness))
    prompt : String <- IO.try(String,T.Text.read(directory ++ "/prompt.txt"))
    +handle : U32 <- IO.try(U32,Custody.Instance.attach(db,directory))
    reconciled : Unit <- Stop.reconcile(db,player,id,directory)
    observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- retained_output(db,player,id,log,recorded_harness,directory,handle,"unknown")
    direct_first_observed(db,player,id,cmd,model,effort,cwd,"",log,recorded_harness,directory,session,prompt,handle,None{},observation)

def run(+db: String, +player: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{player}))
    Lock.SessionLock.acquire_session(Unit,db,player,
      +database => lock => acquired(database,player,id,cmd,model,effort,cwd,task,log,session,String.is_empty(recorded),lock))
