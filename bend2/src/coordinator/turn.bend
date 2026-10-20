import Base
import ./agent-input.bend as AgentInput
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./stop.bend as Stop
import ./subscription-fallback.bend as Subs
import ./accounts.bend as Accounts
import ./delivery.bend as Delivery
import ./control.bend as Control
import ../host/session-lock.bend as Lock
import ../host/control.bend as HostControl
import ./guidance.bend as Guidance
import ./native-requests.bend as NativeRequests
import ./native-initial-input.bend as NativeInitialInput
import ./usage-windows.bend as UW
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
import ../harness/dsh-player.bend as Dsh
import ../git/process.bend as GitProc
import ../git/types.bend as G
import ../context/request.bend as Req
import ../json/canonical.bend as J
import ./../coordinator/frame-span.bend as Frame

type Outcome is Data:
  Ended{status: String, event: String, error: String, incomplete: Bool}

type RetainedLaunch is Data:
  Prepared{arguments: String, input: String, prompt: String, keep_stdin: U32, file_input: Bool}

type DirectSetup is Data:
  Ready{launch: RetainedLaunch, recovery: String, level: String}

type DirectRequest is Data:
  Saved{id: String, harness: String, command: String, model: String, effort: String, workspace: String, task_path: String, task: String, output: String, native: String, directory: String, original_directory: String}

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
    saved : String <- IO.try(String,Store.apply(db,C.Report{id,player,body}))
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

def exit_failure(db: String, player: String, id: String, status: String, success: Bool, event: String) -> IO(Unit):
  match success:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      +message_id : String <- Subs.exit_report_id(db,player,id,event)
      report(db,player,message_id,"Player process ended with " ++ status)

def failed(+status: String, +event: String, error: String) -> Bool:
  Bool.or(Bool.not(String.eq(status,"exit 0")),Bool.or(String.is_empty(event),Bool.not(String.is_empty(error))))

def combine(first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: second

def shared_result(-A: Data, result: Result<&1,&1,U32 & String,A>) -> Result<&2,&2,Sigma<&2,&2,U32,_ => String>,A>:
  match result:
    case Fail{(code,cause)}: Fail{(code,cause)}
    case Done{value}: Done{value}

def unshared_result(-A: Data, result: Result<&2,&2,Sigma<&2,&2,U32,_ => String>,A>) -> Result<&1,&1,U32 & String,A>:
  match result:
    case Fail{(code,cause)}: Fail{(code,cause)}
    case Done{value}: Done{value}

def shared_result_io(-A: Data, action: IO(Result<&1,&1,U32 & String,A>)) -> IO(Result<&2,&2,Sigma<&2,&2,U32,_ => String>,A>):
  do IO<Result<&2,&2,Sigma<&2,&2,U32,_ => String>,A>>:
    result : Result<&1,&1,U32 & String,A> <- action
    IO.pure(Result<&2,&2,Sigma<&2,&2,U32,_ => String>,A>,shared_result(A,result))

def with_frame_step(-R: Type, step: List<String> & String, next: List<String> -> String -> IO(R)) -> IO(R):
  match step:
    case (lines,held): next(lines,held)

def delivery_result(+error: String) -> Result<&1,&1,U32 & String,Unit>:
  Bool.pick(Result<&1,&1,U32 & String,Unit>,String.is_empty(error),Done{Unit{}},Fail{(1,error)})

def prepare_finished(+db: String, +player: String, +id: String, log: String, stderr: String, +error: String, +status: String, +event: String) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM turns WHERE id=" ++ C.q(id) ++ ";"))
    noted : Unit <- diagnostic(db,player,id,error,event,String.is_empty(error))
    missing : Unit <- result_missing(db,player,id,log,stderr,status,String.eq(result,"1\n"))
    exit_failure(db,player,id,status,String.eq(status,"exit 0"),event)

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

def settlement_success(db: String, outcome: Outcome) -> IO(Bool):
  match outcome:
    case Ended{status,+event,error,incomplete}: do IO<Bool>:
      semantic_error : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(event) ++ ") THEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.is_error'),0)=1 OR " ++ C.omp_terminal_error_sql(event) ++ " OR (coalesce(json_extract(" ++ C.q(event) ++ ",'$.payload.kind'),'')='run_terminal' AND coalesce(json_extract(" ++ C.q(event) ++ ",'$.payload.terminal'),'')<>'completed') ELSE 1 END;"))
      IO.pure(Bool,Bool.and(Bool.not(incomplete),Bool.and(Bool.not(failed(status,event,error)),String.eq(semantic_error,"0\n"))))

# A failed Direct turn retains its original input for supported recovery.
# Later input still reaches the current receiver through the ordinary wake.
# A held provider window keeps that wake owed and schedules its post-reset
# continuation, so the same account is not retried before its reported reset.
def direct_wake_gate(+db: String, +player: String, +message: String, gate: UW.Gate) -> IO(Result<&1,&1,U32 & String,Unit>):
  match gate:
    case UW.GateHeld{+window,+resets_at,+source,+receipt}:
      Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.is_empty(message),
        IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
        do IO<Result<&1,&1,U32 & String,Unit>>:
          reported : Unit <- UW.report_held(db,player,message,UW.GateHeld{window,resets_at,source,receipt})
          scheduled : Unit <- UW.schedule_held(db,message,resets_at)
          IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    case other: Delivery.wake_pending(db,player,message)

def direct_wake_gated(+db: String, +player: String, cursor: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +label : String <- Accounts.handoff_label_io(db,player)
    gate : UW.Gate <- UW.window_gate(db,player,Tx.trim_nl(label))
    found : String <- IO.try(String,DB.Sql.query(db,Delivery.wake_sql(player,cursor)))
    next : Result<&1,&1,U32 & String,Unit> <- direct_wake_gate(db,player,Tx.trim_nl(found),gate)
    IO.pure(Result<&1,&1,U32 & String,Unit>,next)

def direct_wake(+db: String, +player: String, id: String, outcome: Outcome) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    success : Bool <- settlement_success(db,outcome)
    cursor : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT CAST(seq AS TEXT) FROM messages WHERE id=" ++ C.q(id ++ ":task-input") ++ " AND recipient=" ++ C.q(player) ++ "),'0');"))
    next : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),success,Delivery.wake_pending(db,player,"0"),direct_wake_gated(db,player,Tx.trim_nl(cursor)))
    IO.pure(Result<&1,&1,U32 & String,Unit>,next)

def direct_window_gate(+db: String, +player: String) -> IO(UW.Gate):
  do IO<UW.Gate>:
    +label : String <- Accounts.handoff_label_io(db,player)
    gate : UW.Gate <- UW.window_gate(db,player,Tx.trim_nl(label))
    IO.pure(UW.Gate,gate)

def direct_gate_held(gate: UW.Gate) -> Bool:
  match gate:
    case UW.GateHeld{window,resets_at,source,receipt}: True{}
    case other: False{}

def direct_gate_refusal(gate: UW.Gate) -> String:
  match gate:
    case UW.GateHeld{window,resets_at,source,receipt}: "Provider usage window held: window=" ++ window ++ "; resetsAt=" ++ resets_at ++ "; source=" ++ source ++ "; the direct task remains retained."
    case other: "Provider usage window held; the direct task remains retained."

def task_instructions() -> String:
  "Carry out the coordinator-authorized assignment. Keep unfinished work and outstanding qualification in your reports and project state. Direct operator instructions and explicit stops remain effective.\n"

def knowledge_instructions() -> String:
  "Record authored evidence, findings, hypotheses, experiments, decisions and principles with knowledge record --kind KIND --claim TEXT --evidence TEXT --limits TEXT. Baton generates the finding identity. Optional --links JSON records authored source, relation and target references. Use Supports, Contradicts, Produced, Informed, DerivedFrom, TestedBy and Supersedes for the corresponding evidence relationships. knowledge search --query TEXT reads scoped findings and retained evidence; knowledge traverse --reference REFERENCE --direction in|out|both follows their recorded relations. Use help knowledge for the available actions. Preserve uncertainty and complete evidence.\n"

def direct_task_prompt(+db: String, +player: String, +id: String, prompt: String) -> IO(String):
  do IO<String>:
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    parent : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(parent,'') FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    header : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":task-input") ++ " AND recipient=" ++ C.q(player) ++ " AND kind='task-assignment') THEN 'Message (task-assignment) from ' || " ++ C.q(player) ++ " || ' [id: ' || " ++ C.q(id ++ ":task-input") ++ " || ']:' ELSE '' END;"))
    IO.pure(String,task_instructions() ++ knowledge_instructions() ++ "Coordinator executable, database and session argv: [" ++ J.string_literal(executable) ++ "," ++ J.string_literal(db) ++ "," ++ J.string_literal(player) ++ "]. Recorded parent: " ++ Tx.trim_nl(parent) ++ ".\nUse baton inbox to read complete owed input. Baton resolves your session and database from the launch context. Baton records delivery and complete reads internally. Use baton completion-request --text SUMMARY when the assignment is ready; your recorded parent resolves and confirms the current request.\n" ++ Tx.trim_nl(header) ++ "\n" ++ prompt)

def generation_log(+log: String, +id: String) -> String:
  Logs.attempt_log(log,id)

# Failure reports are committed while this invocation still owns the session.
# finish delivers the settled turn to its recorded coordinator.
def prepare(+db: String, +player: String, +id: String, log: String, stderr: String, +outcome: Outcome) -> IO(Unit):
  do IO<Unit>:
    +generation : String <- IO.pure(String,generation_log(log,id))
    recipient : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.report_recipient(C.q(player)) ++ " IS NOT NULL;"))
    reported : Unit <- prepare_parent(db,player,id,generation,stderr,outcome,String.eq(recipient,"1\n"))
    success : Bool <- settlement_success(db,outcome)
    AgentInput.settle_if(db,player,id,success)

def record_exit(db: String, player: String, +id: String, log: String, outcome: Outcome) -> IO(Unit):
  match outcome:
    case Ended{status,event,error,incomplete}: Stop.exited(db,player,id,status,event,error,generation_log(log,id))

def player_finished(+db: String, player: String, +id: String, quiet: Bool, failed: Bool, event: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
    exit_id : String <- Bool.pick(IO(String),failed,Subs.exit_report_id(db,player,id,event),IO.pure(String,id ++ ":exit"))
    diagnostic_delivery : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id ++ ":observation","1","")
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id,"1",saved)
    exit_delivery : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,exit_id,"1","")
    stopped : Result<&1,&1,U32 & String,Unit> <- Stop.deliver(db,player,id)
    written : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),quiet,
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),T.Text.control_output(saved))
    IO.pure(Result<&1,&1,U32 & String,Unit>,combine(delivery_result(remember(remember(remember("",diagnostic_delivery),delivered),exit_delivery)),combine(stopped,written)))

def finish_parent(db: String, player: String, id: String, log: String, outcome: Outcome, parent: Bool, quiet: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match outcome:
    case Ended{+status,+event,error,incomplete}:
      match parent:
        case True{}: player_finished(db,player,id,quiet,Bool.not(String.eq(status,"exit 0")),event)
        case False{}: Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),quiet,
          IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
          do IO<Result<&1,&1,U32 & String,Unit>>:
            output : String <- IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT json_object('session'," ++ C.q(player) ++ ",'status'," ++ C.q(status) ++ ",'event',CASE WHEN value='' THEN NULL ELSE json(value) END,'error'," ++ C.q(error) ++ ") FROM frame;"))
            T.Text.control_output(output))

def finish(+db: String, +player: String, id: String, log: String, outcome: Outcome, quiet: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recipient : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.report_recipient(C.q(player)) ++ " IS NOT NULL;"))
    finish_parent(db,player,id,log,outcome,String.eq(recipient,"1\n"),quiet)

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
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>), String.eq(harness,"dsh\n"),
    Dsh.input(handle,prompt),
    Claude.input(handle,prompt)))))

def stdin_kept_open(+harness: String) -> Bool:
  String.eq(harness,"omp\n")

def close_input(handle: U32, close: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match close:
    case True{}: P.ProcessChild.close_stdin(handle)
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

# OMP keeps stdin open for steer frames. Every other harness, including DSH,
# writes one prompt and receives EOF at the same point.
def send_prompt(+handle: U32,prompt: String,+harness: String,level: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    sent : Result<&1,&1,U32 & String,Unit> <- input(handle,prompt,harness,level)
    closed : Result<&1,&1,U32 & String,Unit> <- close_input(handle,Bool.not(stdin_kept_open(harness)))
    IO.pure(Result<&1,&1,U32 & String,Unit>,send_result(sent,closed))

# An EOF projection preserves the terminal report already bound to this player.
# The current native result still supplies the outcome and remains in its log.
def codex_report_recorded_sql(+player: String, id: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM messages m JOIN turns t ON t.id=m.id WHERE m.id=" ++ C.q(id) ++ " AND m.sender=" ++ C.q(player) ++ " AND m.recipient=" ++ C.report_recipient(C.q(player)) ++ " AND m.kind='report' AND t.worker=" ++ C.q(player) ++ ");"

def codex_report(+db: String, +player: String, +id: String, event: String, empty: Bool, sealed: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      recorded : String <- IO.try(String,DB.Sql.query(db,codex_report_recorded_sql(player,id)))
      saved : String <- IO.try(String,Store.apply(db,C.Observe{id,player,event,Bool.or(sealed,String.eq(recorded,"1\n"))}))
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
def omp_message_sql(+value: String, +previous_value: String) -> String:
  "WITH frame(value,previous) AS (VALUES(" ++ value ++ "," ++ previous_value ++ ")) SELECT CASE WHEN json_extract(value,'$.type')='message_end' AND json_extract(value,'$.message.role')='assistant' THEN json_extract(value,'$.message') ELSE previous END FROM frame;"

def omp_message_text(+db: String, +line: String, +previous: String) -> IO(String):
  do IO<String>:
    message : String <- IO.try(String,DB.Sql.query(db,omp_message_sql(C.q(line),C.q(previous))))
    IO.pure(String,Tx.trim_nl(message))

def omp_message_span(+db: String, +spool: String, +offset: String, +length: String, +previous: String) -> IO(String):
  do IO<String>:
    message : String <- IO.try(String,DB.Sql.query_span_text(db,spool,offset,length,omp_message_sql("?1","?2"),previous))
    IO.pure(String,Tx.trim_nl(message))



def omp_message_decoded(+db: String, decoded: Frame.FrameDecoded, +previous: String) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: omp_message_text(db,line,previous)
    case Frame.SpanFrame{spool,offset,length}: omp_message_span(db,spool,offset,length,previous)
    case Frame.InvalidFrame{line}: IO.pure(String,previous)
def omp_message(+db: String, decoded: Frame.FrameDecoded, +previous: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,previous)
    case True{}: omp_message_decoded(db,decoded,previous)

# A completed provider error's response identity establishes when an elided
# terminal repeats observed history. Any later assistant start or completion
# updates the activity that the stream reached last.
def omp_activity_sql(+value: String, +previous_value: String) -> String:
  "WITH frame(value,previous) AS (VALUES(" ++ value ++ "," ++ previous_value ++ ")),activity(value) AS (SELECT CASE WHEN json_valid(previous) THEN previous ELSE json_object('kind','','id','','errors',json_array()) END FROM frame) SELECT CASE WHEN json_extract(frame.value,'$.message.role')='assistant' AND json_extract(frame.value,'$.type') IN ('message_start','message_end') THEN json_set(CASE WHEN json_extract(frame.value,'$.type')='message_end' AND json_extract(frame.value,'$.message.stopReason')='error' AND coalesce(json_extract(frame.value,'$.message.responseId'),'')<>'' AND NOT EXISTS(SELECT 1 FROM json_each(activity.value,'$.errors') e WHERE e.value=json_extract(frame.value,'$.message.responseId')) THEN json_insert(activity.value,'$.errors[#]',json_extract(frame.value,'$.message.responseId')) ELSE activity.value END,'$.kind',json_extract(frame.value,'$.type'),'$.id',coalesce(json_extract(frame.value,'$.message.responseId'),'')) ELSE activity.value END FROM frame,activity;"

def omp_activity_text(+db: String, +line: String, +previous: String) -> IO(String):
  do IO<String>:
    activity : String <- IO.try(String,DB.Sql.query(db,omp_activity_sql(C.q(line),C.q(previous))))
    IO.pure(String,Tx.trim_nl(activity))

def omp_activity_span(+db: String, +spool: String, +offset: String, +length: String, +previous: String) -> IO(String):
  do IO<String>:
    activity : String <- IO.try(String,DB.Sql.query_span_text(db,spool,offset,length,omp_activity_sql("?1","?2"),previous))
    IO.pure(String,Tx.trim_nl(activity))

# The completion reader calls json_extract for content block fields. Keep
# object blocks on assistant messages in order and give non-array content an
# empty extraction list. Normalization changes nothing retained elsewhere: a
# retained receive keeps the raw frame stream in the attempt stdout spool until
# acknowledgement, and the provider's own journal holds the provider's raw
# record. The public log holds the compact projection of a terminal frame.

def omp_activity_decoded(+db: String, decoded: Frame.FrameDecoded, +previous: String) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: omp_activity_text(db,line,previous)
    case Frame.SpanFrame{spool,offset,length}: omp_activity_span(db,spool,offset,length,previous)
    case Frame.InvalidFrame{line}: IO.pure(String,previous)
def omp_activity(+db: String, decoded: Frame.FrameDecoded, +previous: String, enabled: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,previous)
    case True{}: omp_activity_decoded(db,decoded,previous)


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

# A new assistant start has no completed answer to restore into an empty terminal.
def omp_retained_answer_sql(+message: String, +activity: String) -> String:
  "CASE WHEN json_valid(" ++ message ++ ") THEN CASE WHEN json_valid(" ++ activity ++ ") THEN coalesce(json_extract(" ++ activity ++ ",'$.kind'),'')<>'message_start' ELSE 1 END ELSE 0 END"

def omp_terminal_messages_sql(+source: String, +message: String, +activity: String) -> String:
  +objects = omp_terminal_objects_sql(source)
  +kept = omp_terminal_kept_sql(source)
  "CASE WHEN " ++ objects ++ "=0 AND " ++ omp_retained_answer_sql(message,activity) ++ " THEN json_array(json(" ++ message ++ ")) WHEN " ++ omp_elided_completion_sql(source,message,activity) ++ "=1 THEN json_array(json(" ++ omp_content_sql(message) ++ ")) ELSE " ++ kept ++ " END"

# OMP may return valid terminal envelopes whose messages array contains a
# non-object metadata marker. Keep object messages in their original order for
# result extraction. The value here is the observed event the turns row
# receives. A terminal frame reaches the public log as the compact projection
# built by logs.bend terminal_object_sql. The raw frame stream stays in the
# attempt stdout spool of a retained receive until acknowledgement, and the
# provider's own journal holds the provider's raw record.
# The frame, fallback message and activity each enter the one-row relation once.
# Extraction reads their SQL columns.
def omp_terminal_sql(+value: String, +message_value: String, +activity_value: String) -> String:
  +messages = omp_terminal_messages_sql("frame.value","frame.message","frame.activity")
  "WITH frame(value,message,activity) AS (VALUES(" ++ value ++ "," ++ message_value ++ "," ++ activity_value ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN json_extract(value,'$.type')='agent_end' AND coalesce(json_extract(value,'$.isTerminal'),1)=1 THEN CASE WHEN json_type(value,'$.messages')='array' THEN json_set(value,'$.messages',json(" ++ messages ++ ")) WHEN " ++ omp_retained_answer_sql("frame.message","frame.activity") ++ " THEN json_set(value,'$.messages',json_array(json(frame.message))) ELSE value END ELSE value END ELSE value END FROM frame;"

def omp_terminal_text(+db: String, +line: String, +message: String, +activity: String) -> IO(String):
  do IO<String>:
    normalized : String <- IO.try(String,DB.Sql.query(db,omp_terminal_sql(C.q(line),C.q(message),C.q(activity))))
    IO.pure(String,Tx.trim_nl(normalized))

def omp_terminal_span(+db: String, +spool: String, +offset: String, +length: String, +message: String, +activity: String) -> IO(String):
  do IO<String>:
    normalized : String <- IO.try(String,DB.Sql.query_span_2text(db,spool,offset,length,omp_terminal_sql("?1","?2","?3"),message,activity))
    IO.pure(String,Tx.trim_nl(normalized))
# DSH frames that carry identity or terminal state are projected through the
# player; text, thinking and tool frames stay as received.
def dsh_event(+db: String, +line: String, enabled: Bool, event: String) -> IO(String):
  match enabled:
    case True{}: Dsh.event(db,line)
    case False{}: IO.pure(String,event)


# The root turn input identifies the admitted Muse invocation. Nested task
# streams can complete while that invocation is still running.

def omp_terminal_decoded(+db: String, decoded: Frame.FrameDecoded, +message: String, +activity: String) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: omp_terminal_text(db,line,message,activity)
    case Frame.SpanFrame{spool,offset,length}: omp_terminal_span(db,spool,offset,length,message,activity)
    case Frame.InvalidFrame{line}: IO.pure(String,"")
def observation_frame(decoded: Frame.FrameDecoded, relevant: Bool) -> IO(String):
  match relevant:
    case False{}: IO.pure(String,"")
    case True{}: IO.try(String,Frame.text_result_decoded(decoded))

def omp_terminal(+db: String, decoded: Frame.FrameDecoded, +message: String, +activity: String, enabled: Bool, relevant: Bool) -> IO(String):
  match enabled:
    case False{}: observation_frame(decoded,relevant)
    case True{}: omp_terminal_decoded(db,decoded,message,activity)


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

def observed_initial(db: String, player: String, id: String, line: String, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{saved}: do IO<Result<&1,&1,U32 & String,String>>:
      observed : Unit <- AgentInput.initial_observed(db,player,id,line)
      IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})

def observe_event(+db: String, +player: String, +id: String, +event: String, relevant: Bool, sealed: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match relevant:
    case True{}: do IO<Result<&1,&1,U32 & String,String>>:
      stored : Result<&1,&1,U32 & String,String> <- Store.apply(db,C.Observe{id,player,event,sealed})
      observed_initial(db,player,id,event,stored)
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})

# Later native episodes keep the first report and publish their own reports.
def deferred_terminal_sql(+event: String, +terminal: String) -> String:
  "WITH frame(value,terminal) AS (VALUES(" ++ C.q(event) ++ "," ++ C.q(terminal) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN value='' THEN 0 WHEN terminal='' THEN 0 WHEN value=terminal THEN 0 WHEN " ++ C.terminal_expr("frame.value") ++ " THEN 1 ELSE 0 END ELSE 0 END FROM frame;"

def muse_deferred_terminal_sql(+event: String, +terminal: String, +primary: String, +current: String) -> String:
  +candidate = primary_terminal_expr("frame.value",current)
  "WITH frame(value,terminal) AS (VALUES(" ++ C.q(event) ++ "," ++ C.q(terminal) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN value='' THEN 0 WHEN terminal='' THEN 0 WHEN value=terminal THEN 0 WHEN " ++ candidate ++ " THEN 1 ELSE 0 END ELSE 0 END FROM frame;"

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
  "A later native terminal was observed after the report " ++ id ++ " was sealed; the episode is retained in the native log" ++ deferred_pending(pending) ++ "."

# A later OMP failure sends its observed status and diagnostic to the parent.
def deferred_failure_text(+id: String, +failure: String, +pending: String) -> String:
  "A later native terminal failed after the report " ++ id ++ " was sealed: " ++ failure ++ "; the episode is retained in the native log" ++ deferred_pending(pending) ++ "."

def write_deferred(+db: String, +player: String, +id: String, +failure: String, +pending: String, recorded: Bool) -> IO(Unit):
  match recorded:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      noted : Unit <- report(db,player,id ++ ":deferred",Bool.pick(String,String.is_empty(failure),deferred_text(id,pending),deferred_failure_text(id,failure,pending)))
      IO.pure(Unit,Unit{})

# The episode sequence names later terminal positions across raw-spool replay.
def deferred_report_id_sql(+id: String, +event: String, +episode: String) -> String:
  +text = "CASE WHEN json_type(frame.value,'$.result')='text' THEN json_extract(frame.value,'$.result') WHEN json_extract(frame.value,'$.payload.kind')='run_terminal' AND json_type(frame.value,'$.payload.text')='text' THEN json_extract(frame.value,'$.payload.text') ELSE " ++ C.assistant_text_sql_expr("frame.value") ++ " END"
  +failed = "coalesce(json_extract(frame.value,'$.is_error'),0)=1 OR (json_extract(frame.value,'$.payload.kind')='run_terminal' AND json_extract(frame.value,'$.payload.terminal')<>'completed') OR " ++ C.omp_terminal_error_sql_expr("frame.value")
  "WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT CASE WHEN coalesce(" ++ text ++ ",'')<>'' OR " ++ failed ++ " THEN " ++ C.q(id ++ ":episode:" ++ episode) ++ " ELSE '' END FROM frame;"

def publish_deferred(+db: String, +player: String, +id: String, +event: String, +report_id: String, substantive: Bool) -> IO(Unit):
  match substantive:
    case False{}: do IO<Unit>:
      presence : String <- IO.try(String,DB.Sql.query(db,deferred_recorded_sql(id)))
      pending : String <- IO.try(String,DB.Sql.query(db,deferred_pending_sql(player)))
      failure : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(" ++ C.omp_terminal_error_text_sql(event) ++ ",'');"))
      write_deferred(db,player,id,Tx.trim_nl(failure),Tx.trim_nl(pending),String.eq(presence,"1\n"))
    case True{}: do IO<Unit>:
      +saved : String <- IO.try(String,Store.apply(db,C.Observe{report_id,player,event,False{}}))
      delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,report_id,"1",saved)
      written : Result<&1,&1,U32 & String,Unit> <- T.Text.control_output(saved)
      IO.pure(Unit,Unit{})

def record_deferred(+db: String, +player: String, +id: String, +event: String, +episode: String, later: Bool) -> IO(String):
  match later:
    case False{}: IO.pure(String,episode)
    case True{}: do IO<String>:
      incremented : String <- IO.try(String,DB.Sql.query(db,"SELECT CAST(CAST(" ++ C.q(episode) ++ " AS INTEGER)+1 AS TEXT);"))
      +next_episode : String <- IO.pure(String,Tx.trim_nl(incremented))
      found : String <- IO.try(String,DB.Sql.query(db,deferred_report_id_sql(id,event,next_episode)))
      +report_id : String <- IO.pure(String,Tx.trim_nl(found))
      published : Unit <- publish_deferred(db,player,id,event,report_id,Bool.not(String.is_empty(report_id)))
      IO.pure(String,next_episode)

def deferred_query(event: String, terminal: String, primary: String, current: String, muse: Bool) -> String:
  match muse:
    case False{}: deferred_terminal_sql(event,terminal)
    case True{}: muse_deferred_terminal_sql(event,terminal,primary,current)

# Only a later terminal can produce this note. Progress frames keep draining
# without constructing a query that embeds the saved terminal.
def deferred_note(+db: String, player: String, id: String, +event: String, terminal: String, primary: String, current: String, episode: String, enabled: Bool, muse: Bool) -> IO(String):
  match enabled:
    case False{}: IO.pure(String,episode)
    case True{}: do IO<String>:
      query : String <- IO.pure(String,deferred_query(event,terminal,primary,current,muse))
      later : String <- IO.try(String,DB.Sql.query(db,query))
      record_deferred(db,player,id,event,episode,String.eq(later,"1\n"))
# Read the OMP frame type once for level filtering and event observation.
def omp_frame_kind_sql(+value: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ value ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE json_extract(value,'$.type') WHEN 'message_update' THEN 'message_update' WHEN 'tool_execution_update' THEN 'tool_execution_update' WHEN 'message_start' THEN 'message_start' WHEN 'response' THEN 'response' WHEN 'message_end' THEN 'message_end' WHEN 'tool_execution_start' THEN 'tool_execution_start' WHEN 'tool_execution_end' THEN 'tool_execution_end' WHEN 'turn_end' THEN 'turn_end' WHEN 'agent_end' THEN 'agent_end' WHEN 'extension_ui_request' THEN 'extension_ui_request' ELSE '' END ELSE '' END FROM frame;"

def omp_frame_kind_decoded(+db: String, decoded: Frame.FrameDecoded) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: IO.try(String,DB.Sql.query(db,omp_frame_kind_sql(C.q(line))))
    case Frame.SpanFrame{spool,offset,length}: IO.try(String,DB.Sql.query_span(db,spool,offset,length,omp_frame_kind_sql("?1")))
    case Frame.InvalidFrame{line}: IO.pure(String,"")

def omp_frame_kind(+db: String, decoded: Frame.FrameDecoded, omp: Bool) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: omp_frame_kind_decoded(db,decoded)

def codex_frame_kind(db: String, line: String) -> IO(String):
  IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(line) ++ ")) SELECT CASE WHEN json_valid(value) THEN CASE WHEN json_extract(value,'$.item.type')='command_execution' AND json_type(value,'$.item.id')='text' AND json_extract(value,'$.item.id')<>'' THEN CASE json_extract(value,'$.type') WHEN 'item.started' THEN 'codex_command_start' WHEN 'item.completed' THEN 'codex_command_end' ELSE '' END ELSE '' END ELSE '' END FROM frame;"))


# The requested selection is active only when the server answered the
# set_event_filter request successfully with that exact selection: the echoed
# events value must equal the requested events JSON and the echoed
# messageUpdates value must match it, null with full and the array with delta.
# A successful answer without that selection is unconfirmed, an unsuccessful
# answer is refused, and a response for another command or any other line
# leaves the turn's mode unchanged. The nested CASE keeps json extraction
# behind the validity check, so unrelated non-JSON native output never becomes
# an observer error. The requested selection is captured when the turn starts.
# OMP 17.4 answers an unknown set_event_filter request with success false and
# no id (issue #769). That explicit refusal names the command, so it classifies
# as refused without the request id; a missing success value classifies as
# nothing, and only the id-matched answer can confirm a selection.

def dsh_frame_kind(line: String) -> IO(String):
  IO.pure(String,Dsh.kind(line))

def frame_kind_other(+db: String, decoded: Frame.FrameDecoded, +line: String, +harness: String) -> IO(String):
  match harness:
    case "dsh\n": dsh_frame_kind(line)
    case other: omp_frame_kind(db,decoded,String.eq(harness,"omp\n"))

def frame_kind_selected(+db: String, decoded: Frame.FrameDecoded, +line: String, harness: String, codex: Bool) -> IO(String):
  match codex:
    case True{}: codex_frame_kind(db,line)
    case False{}: frame_kind_other(db,decoded,line,harness)

def frame_kind(+db: String, decoded: Frame.FrameDecoded, +line: String, +harness: String) -> IO(String):
  frame_kind_selected(db,decoded,line,harness,String.eq(harness,"codex\n"))

def filter_mode_sql(+value: String, +requested_sql: String) -> String:
  "SELECT CASE WHEN json_valid(" ++ value ++ ") THEN CASE WHEN json_extract(" ++ value ++ ",'$.type')='response' AND json_extract(" ++ value ++ ",'$.command')='set_event_filter' AND coalesce(json_extract(" ++ value ++ ",'$.success'),1)=0 THEN 'refused' WHEN json_extract(" ++ value ++ ",'$.type')='response' AND json_extract(" ++ value ++ ",'$.id')='baton:filter' AND json_extract(" ++ value ++ ",'$.command')='set_event_filter' THEN CASE WHEN json_extract(" ++ value ++ ",'$.success')=1 THEN CASE WHEN CASE WHEN " ++ requested_sql ++ "='unknown' THEN 0 WHEN " ++ requested_sql ++ "='null' THEN json_type(" ++ value ++ ",'$.data.events')='null' AND json_extract(" ++ value ++ ",'$.data.messageUpdates')='full' ELSE CASE WHEN json_type(" ++ value ++ ",'$.data.events')='array' THEN json(json_extract(" ++ value ++ ",'$.data.events'))=json(" ++ requested_sql ++ ") AND json_extract(" ++ value ++ ",'$.data.messageUpdates')='delta' ELSE 0 END END THEN CASE WHEN " ++ requested_sql ++ "='null' THEN 'null+full' ELSE 'array+delta' END ELSE 'unconfirmed' END ELSE 'refused' END ELSE '' END ELSE '' END;"

def filter_mode_decoded(+db: String, decoded: Frame.FrameDecoded, +requested: String) -> IO(String):
  match decoded:
    case Frame.TextFrame{line}: IO.try(String,DB.Sql.query(db,filter_mode_sql(C.q(line),C.q(requested))))
    case Frame.SpanFrame{spool,offset,length}: IO.try(String,DB.Sql.query_span_text(db,spool,offset,length,filter_mode_sql("?1","?2"),requested))
    case Frame.InvalidFrame{line}: IO.pure(String,"")

def filter_mode(+db: String, decoded: Frame.FrameDecoded, omp: Bool, +requested: String) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: filter_mode_decoded(db,decoded,requested)

def filter_lines(+state: String, +requested: String, omp: Bool) -> List<String>:
  match omp:
    case False{}: Nil{}
    case True{}: [Omp.filter_note(state,requested)]

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
type WakeRead is Type:
  AwakeEnd{notice: String, active: Bool}
  AwakeLine{line: String, notice: String, active: Bool}
  Again{policy: Logs.Policy, held: String, log_failed: Bool, cursor: String, last_message: String, primary: String, current: String, terminal: String, filter: String, codex_log: String, first_error: String, checkpoint_state: Observer.State, incomplete: Bool, alive: Bool, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, next: Result<&1,&1,U32 & String,WakeRead>}

def wake_read(line: Maybe<String>, notice: String, active: Bool) -> WakeRead:
  match line:
    case None{}: AwakeEnd{notice,active}
    case Some{text}: AwakeLine{text,notice,active}

def subscribe_fields(opened: Result<&1,&1,U32 & String,U32 & String>) -> Sigma<&2,&2,U32,_ => Bool>:
  match opened:
    case Fail{error}: (0,False{})
    case Done{(sub,readiness)}: (sub,True{})

def subscribe_handle(opened: Sigma<&2,&2,U32,_ => Bool>) -> U32:
  match opened:
    case (sub,active): sub

def subscribe_active(opened: Sigma<&2,&2,U32,_ => Bool>) -> Bool:
  match opened:
    case (sub,active): active

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

# The span read returns the retained line as its byte range. The token carries
# that range, so every consumer can bind the spool bytes without a Bend String.
def span_wake_read(spool: String, offset: Maybe<String>, length: String, notice: String, active: Bool) -> WakeRead:
  match offset:
    case None{}: AwakeEnd{notice,active}
    case Some{start}: AwakeLine{Frame.token_of(spool,start,length),notice,active}

def span_wake_value(spool: String, sub: U32, value: Maybe<String> & (String & (String & U32))) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  (offset,(length,(notice,health)))=value
  +active=U32.is_eq(health,1)
  do IO<Result<&1,&1,U32 & String,WakeRead>>:
    closed : Result<&1,&1,U32 & String,Unit> <- wake_close(sub,Bool.not(active))
    IO.pure(Result<&1,&1,U32 & String,WakeRead>,Done{span_wake_read(spool,offset,length,notice,active)})

def plain_span_wake_result(spool: String, result: Result<&1,&1,U32 & String,Maybe<String> & String>) -> Result<&1,&1,U32 & String,WakeRead>:
  match result:
    case Fail{error}: Fail{error}
    case Done{(offset,length)}: Done{span_wake_read(spool,offset,length,"",False{})}


def plain_span_wake_line(spool: String, read: U32) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  do IO<Result<&1,&1,U32 & String,WakeRead>>:
    value : Result<&1,&1,U32 & String,Maybe<String> & String> <- P.ProcessChild.read_retained_line_span(read)
    IO.pure(Result<&1,&1,U32 & String,WakeRead>,plain_span_wake_result(spool,value))


def notice_span_wake_result(spool: String, +read: U32, sub: U32, result: Result<&1,&1,U32 & String,Maybe<String> & (String & (String & U32))>) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  match result:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,WakeRead>>:
      closed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.unsubscribe(sub)
      plain_span_wake_line(spool,read)
    case Done{value}: span_wake_value(spool,sub,value)

def notice_span_wake_line(spool: String, +read: U32, +sub: U32) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  do IO<Result<&1,&1,U32 & String,WakeRead>>:
    result : Result<&1,&1,U32 & String,Maybe<String> & (String & (String & U32))> <- P.ProcessChild.read_awake_span(read,sub)
    notice_span_wake_result(spool,read,sub,result)

def span_wake_line(+spool: String, +read: U32, sub: U32, active: Bool) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  Bool.pick(IO(Result<&1,&1,U32 & String,WakeRead>),active,notice_span_wake_line(spool,read,sub),plain_span_wake_line(spool,read))

def next_wake(+spool: String, +read: U32, sub: U32, active: Bool, spanned: Bool) -> IO(Result<&1,&1,U32 & String,WakeRead>):
  match spanned:
    case False{}: wake_line(read,sub,active)
    case True{}: span_wake_line(spool,read,sub,active)

@unsafe
def consume_exhausted(+db: String, +player: String, +id: String, +log: String, +spool: String, held: String, +log_failed: Bool, +handle: U32, +harness: String, codex_log: String, terminal: String, filter: String, requested: String, first_error: String, sender: Chan(Result<&1,&1,U32 & String,Unit>), +attempt: String, +checkpoint_state: Observer.State, +incomplete_observation: Bool, +monitor: Bool, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, wake_sub: U32, wake_on: Bool) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
    +wake_closed : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,wake_close(wake_sub,wake_on))
    +sent : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,IO.join(Result<&1,&1,U32 & String,Unit>,sender))
    +status : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,String> <- shared_result_io(String,P.ProcessChild.wait(handle))
    output_lines : List<String> <- IO.pure(List<String>,List.append(&1,String,Logs.flush(held),filter_lines(filter,requested,String.eq(harness,"omp\n"))))
    +positioned : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,String> <- shared_result_io(String,Logs.write_positioned(log,output_lines,Observer.output(checkpoint_state),Bool.or(log_failed,Observer.output_done(checkpoint_state)),Bool.not(String.is_empty(attempt)),True{}))
    +flushed : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,Logs.position_write(log,unshared_result(String,positioned))))
    +write_failed : Bool <- IO.pure(Bool,Logs.failed_now(log_failed,unshared_result(Unit,flushed)))
    +event : String <- codex_finished(db,player,id,codex_log,terminal,String.eq(harness,"codex\n"),write_failed)
    +checkpoint_done : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,checkpoint(Bool.and(String.is_empty(attempt),Bool.not(write_failed)),log,""))
    +closed : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,String> <- shared_result_io(String,NativeRequests.closed(db,attempt,Bool.not(String.is_empty(attempt))))
    +checkpoint_enabled : Bool <- IO.pure(Bool,Bool.and(Bool.not(String.is_empty(attempt)),Bool.and(Bool.not(incomplete_observation),Bool.and(Bool.not(write_failed),Bool.and(Bool.not(Observer.output_done(checkpoint_state)),Bool.not(observation_store_failed(unshared_result(String,closed))))))))
    +checkpointed : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,Observer.commit_with_held(db,handle,spool,Observer.finish_output(checkpoint_state,Logs.position(Observer.output(checkpoint_state),unshared_result(String,positioned))),checkpoint_enabled,monitor))
    checkpoint_notice : Unit <- checkpoint_failure_notice(db,player,id,attempt,checkpoint_enabled,unshared_result(Unit,checkpointed))
    sent_error : String <- IO.pure(String,append_write_error(append_write_error(first_error,unshared_result(Unit,wake_closed)),unshared_result(Unit,sent)))
    waited_error : String <- IO.pure(String,append_store_error(sent_error,unshared_result(String,status)))
    log_error : String <- IO.pure(String,append_write_error(append_write_error(append_write_error(waited_error,unshared_result(Unit,flushed)),unshared_result(Unit,checkpoint_done)),unshared_result(Unit,checkpointed)))
    +error : String <- IO.pure(String,append_store_error(log_error,unshared_result(String,closed)))
    +incomplete : Bool <- IO.pure(Bool,Bool.or(incomplete_observation,Bool.or(checkpoint_write_failed(unshared_result(Unit,wake_closed)),Bool.or(wait_failed(unshared_result(String,status)),Bool.or(checkpoint_write_failed(unshared_result(Unit,sent)),Bool.or(checkpoint_write_failed(unshared_result(Unit,flushed)),Bool.or(checkpoint_write_failed(unshared_result(Unit,checkpoint_done)),Bool.or(checkpoint_write_failed(unshared_result(Unit,checkpointed)),observation_store_failed(unshared_result(String,closed))))))))))
    IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(Ended{status_text(unshared_result(String,status)),event,error,incomplete},deliveries))

# The question frame carries the extension request bytes; a read failure
# yields an empty frame and its error reaches the observation error chain.
def question_frame_result(needed: Bool, decoded: Frame.FrameDecoded, +line: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>),needed,
    Frame.materialize(Frame.span_value(decoded),line),
    IO.pure(Result<&1,&1,U32 & String,String>,Done{""}))

def question_frame_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{line}: line
    case Fail{error}: ""

def question_frame_error(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{line}: ""
    case Fail{(code,text)}: "Native request frame read failed: " ++ text

def question_frame_failed(result: Result<&1,&1,U32 & String,String>) -> Bool:
  match result:
    case Done{line}: False{}
    case Fail{error}: True{}

@unsafe
def consume_frame(+db: String, +player: String, +id: String, +log: String, +policy: Logs.Policy, +held: String, +log_failed: Bool, +handle: U32, +harness: String, +spool: String, +spanned: Bool, +cursor: String, +last_message: String, +primary: String, +current: String, +terminal: String, +filter: String, +requested: String, +codex_log: String, +first_error: String, +attempt: String, +checkpoint_state: Observer.State, +incomplete_observation: Bool, +monitor: Bool, +wake_sub: U32, +alive: Bool, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, +line: String, +notice: String) -> IO(WakeRead):
  do IO<WakeRead>:
    +drained : String <- Guidance.awake_pending(db,player,handle,cursor,Bool.and(String.eq(harness,"omp\n"),Bool.and(Bool.not(String.is_empty(notice)),String.is_empty(terminal))))
    +decoded : Frame.FrameDecoded <- IO.pure(Frame.FrameDecoded,Frame.decode(line,spool,spanned))
    +invalid : Bool <- IO.pure(Bool,Frame.is_invalid(decoded))
    +decode_error : String <- IO.pure(String,Bool.pick(String,invalid,Frame.invalid_error(),""))
    +kind : String <- frame_kind(db,decoded,line,harness)
    +dsh : Bool <- IO.pure(Bool,String.eq(harness,"dsh\n"))
    +frame_key_raw : String <- Logs.frame_identity(db,decoded,line,Tx.trim_nl(kind),String.eq(harness,"omp\n"))
    +frame_key : String <- IO.pure(String,Tx.trim_nl(frame_key_raw))
    +message_frame : Bool <- IO.pure(Bool,Bool.and(String.eq(harness,"omp\n"),String.eq(Tx.trim_nl(kind),"message_end")))
    +message : String <- omp_message(db,decoded,last_message,message_frame)
    +activity_frame : Bool <- IO.pure(Bool,Bool.and(String.eq(harness,"omp\n"),Bool.or(String.eq(Tx.trim_nl(kind),"message_start"),String.eq(Tx.trim_nl(kind),"message_end"))))
    +activity : String <- omp_activity(db,decoded,Observer.omp_activity(checkpoint_state),activity_frame)
    +raw_event : String <- omp_terminal(db,decoded,message,activity,Bool.and(String.eq(harness,"omp\n"),String.eq(Tx.trim_nl(kind),"agent_end")),Guidance.relevant(kind,String.eq(harness,"omp\n")))
    +event : String <- dsh_event(db,line,Bool.and(dsh,Dsh.admitted(Tx.trim_nl(kind))),raw_event)
    +kept : String <- Logs.retained(db,policy,Tx.trim_nl(kind),decoded,event,log)
    step : List<String> & String <- IO.pure(List<String> & String,Logs.frame_step(policy,Tx.trim_nl(kind),frame_key,kept,held))
    with_frame_step(WakeRead,step,lines => next_held_value => do IO<WakeRead>:
      +next_held : String <- IO.pure(String,next_held_value)
      +positioned : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,String> <- shared_result_io(String,Logs.write_positioned(log,lines,Observer.output(checkpoint_state),log_failed,Bool.not(String.is_empty(attempt)),False{}))
      +logged : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,Logs.position_write(log,unshared_result(String,positioned))))
      +saved_checkpoint : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,checkpoint_written(unshared_result(Unit,logged),Bool.and(String.is_empty(attempt),Bool.and(Bool.not(log_failed),Bool.not(String.eq(held,next_held)))),log,next_held))
      +written : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,Logs.first_failure(unshared_result(Unit,saved_checkpoint),unshared_result(Unit,logged))))
      +failed : Bool <- IO.pure(Bool,Logs.failed_now(log_failed,unshared_result(Unit,written)))
      +relevant : Bool <- IO.pure(Bool,Guidance.relevant(kind,String.eq(harness,"omp\n")))
      +sealed : Bool <- IO.pure(Bool,Bool.not(String.is_empty(terminal)))
      +next_cursor : String <- Guidance.observe(db,player,handle,decoded,line,drained,Bool.and(String.eq(harness,"omp\n"),relevant),monitor)
      +next_primary : String <- primary_command(db,event,primary,String.eq(harness,"muse\n"))
      +next_current : String <- current_command(db,event,current,String.eq(harness,"muse\n"))
      +terminal_frame : Bool <- primary_terminal(db,event,"",False{})
      +admitted : Bool <- terminal_admitted(db,event,next_primary,terminal_frame,String.eq(harness,"muse\n"))
      +state : String <- completion_state_event(db,id,player,event,Bool.and(admitted,Bool.not(sealed)))
      +observation_sealed : Bool <- IO.pure(Bool,terminal_observation_sealed(sealed,terminal_frame,admitted,state))
      conflict_note : Unit <- completion_conflict_note(db,player,id,event,String.eq(state,"conflict"))
      +episode : String <- deferred_note(db,player,id,event,terminal,next_primary,next_current,Observer.episode(checkpoint_state),Bool.and(sealed,terminal_frame),String.eq(harness,"muse\n"))
      +observed : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,String> <- shared_result_io(String,observe_event(db,player,id,event,relevant,Bool.or(observation_sealed,failed)))
      +terminal_selected : Bool <- IO.pure(Bool,Bool.and(relevant,Bool.and(admitted,Bool.not(sealed))))
      +ended : String <- terminal_event(event,terminal,terminal_selected)
      +closed_input : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,close_input(handle,Bool.and(Bool.not(monitor),Bool.and(String.eq(harness,"omp\n"),Bool.and(String.is_empty(terminal),Bool.not(String.is_empty(ended)))))))
      +codex_frame : Bool <- IO.pure(Bool,String.eq(harness,"codex\n"))
      +codex_state : String <- codex_frames(db,codex_log,line,codex_frame)
      +question_needed : Bool <- IO.pure(Bool,Bool.and(Bool.not(String.is_empty(attempt)),String.eq(kind,"extension_ui_request\n")))
      +question_result : Result<&1,&1,U32 & String,String> <- question_frame_result(question_needed,decoded,line)
      +question_frame : String <- IO.pure(String,question_frame_text(question_result))
      questions : List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool <- NativeRequests.observe(db,player,id,attempt,question_frame,deliveries,question_needed)
      +mode : String <- filter_mode(db,decoded,Bool.and(String.eq(harness,"omp\n"),String.eq(Tx.trim_nl(kind),"response")),requested)
      +next_filter : String <- IO.pure(String,Omp.filter_next(filter,Tx.trim_nl(mode)))
      +next_checkpoint : Observer.State <- IO.pure(Observer.State,Observer.make_full(next_cursor,message,next_primary,next_current,ended,next_filter,codex_state,next_held,activity,Logs.position(Observer.output(checkpoint_state),unshared_result(String,positioned)),episode))
      NativeRequests.with_observation(WakeRead,questions,wakes => question_error => question_incomplete => do IO<WakeRead>:
        +question_text : String <- IO.pure(String,question_error)
        +request_incomplete : Bool <- IO.pure(Bool,question_incomplete)
        +checkpoint_enabled : Bool <- IO.pure(Bool,Bool.and(Bool.not(incomplete_observation),Bool.and(Bool.not(failed),Bool.and(Bool.not(request_incomplete),Bool.and(Bool.not(invalid),Bool.and(Bool.not(observation_store_failed(unshared_result(String,observed))),Bool.and(Bool.not(String.is_empty(attempt)),Observer.checkpoint_due_fields(checkpoint_state,next_checkpoint,message_frame,terminal_selected,codex_frame))))))))
        +next_checkpoint_state : Observer.State <- Observer.checkpoint_state(spool,next_checkpoint,checkpoint_enabled)
        +checkpointed : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,Observer.after_materialized_observation(db,handle,next_checkpoint_state,checkpoint_enabled,monitor,unshared_result(String,observed)))
        checkpoint_notice : Unit <- checkpoint_failure_notice(db,player,id,attempt,checkpoint_enabled,unshared_result(Unit,checkpointed))
        +next_error : String <- IO.pure(String,append_write_error(append_write_error(append_store_error(append_write_error(append_error(append_error(append_error(first_error,decode_error),question_frame_error(question_result)),question_text),unshared_result(Unit,written)),unshared_result(String,observed)),unshared_result(Unit,closed_input)),unshared_result(Unit,checkpointed)))
        +next_incomplete : Bool <- IO.pure(Bool,Bool.or(invalid,Bool.or(incomplete_observation,Bool.or(request_incomplete,Bool.or(question_frame_failed(question_result),Bool.or(observation_store_failed(unshared_result(String,observed)),Bool.or(checkpoint_write_failed(unshared_result(Unit,closed_input)),Bool.or(checkpoint_write_failed(unshared_result(Unit,checkpointed)),failed))))))))
        +stopping : Bool <- IO.pure(Bool,Bool.or(invalid,Bool.not(String.is_empty(next_error))))
        next : Result<&1,&1,U32 & String,WakeRead> <- Bool.pick(IO(Result<&1,&1,U32 & String,WakeRead>),stopping,IO.pure(Result<&1,&1,U32 & String,WakeRead>,Fail{(0,"stopping before the next span read after a failure")}),next_wake(spool,handle,wake_sub,alive,spanned))
        IO.pure(WakeRead,Again{policy,Observer.held_after_checkpoint(checkpoint_enabled,Observer.held(next_checkpoint_state),next_held,unshared_result(Unit,checkpointed)),failed,next_cursor,message,next_primary,next_current,ended,next_filter,codex_state,next_error,next_checkpoint_state,next_incomplete,alive,wakes,next})))

@unsafe
def consume(+db: String, +player: String, +id: String, +log: String, +policy: Logs.Policy, +held: String, +log_failed: Bool, +handle: U32, +harness: String, +spool: String, +spanned: Bool, +cursor: String, +last_message: String, +primary: String, +current: String, +terminal: String, +filter: String, +requested: String, +codex_log: String, +first_error: String, +sender: Chan(Result<&1,&1,U32 & String,Unit>), +attempt: String, +checkpoint_state: Observer.State, +incomplete_observation: Bool, +monitor: Bool, +wake_sub: U32, wake_on: Bool, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, result: Result<&1,&1,U32 & String,WakeRead>) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  match result:
    case Fail{error}: do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
      wake_closed : Result<&1,&1,U32 & String,Unit> <- wake_close(wake_sub,wake_on)
      closed : Result<&1,&1,U32 & String,Unit> <- close_input(handle,Bool.not(monitor))
      sent : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,sender)
      +waited : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,String> <- shared_result_io(String,P.ProcessChild.wait(handle))
      +positioned : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,String> <- shared_result_io(String,Logs.write_positioned(log,Logs.flush(held),Observer.output(checkpoint_state),log_failed,Bool.not(String.is_empty(attempt)),False{}))
      +flushed : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,Logs.position_write(log,unshared_result(String,positioned))))
      +write_failed : Bool <- IO.pure(Bool,Logs.failed_now(log_failed,unshared_result(Unit,flushed)))
      checkpoint_done : Result<&1,&1,U32 & String,Unit> <- checkpoint(Bool.and(String.is_empty(attempt),Bool.not(write_failed)),log,"")
      named_position : Result<&1,&1,U32 & String,String> <- Logs.write_positioned(log,Logs.interrupted(held),Logs.position(Observer.output(checkpoint_state),unshared_result(String,positioned)),write_failed,Bool.not(String.is_empty(attempt)),True{})
      named : Result<&1,&1,U32 & String,Unit> <- IO.pure(Result<&1,&1,U32 & String,Unit>,Logs.position_write(log,named_position))
      read_error : String <- IO.pure(String,append_error(first_error,"Native output read failed: " ++ error_text(error)))
      sent_error : String <- IO.pure(String,append_write_error(append_write_error(append_write_error(read_error,wake_closed),closed),sent))
      waited_error : String <- IO.pure(String,append_store_error(sent_error,unshared_result(String,waited)))
      error : String <- IO.pure(String,append_write_error(append_write_error(append_write_error(waited_error,unshared_result(Unit,flushed)),checkpoint_done),named))
      IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(Ended{status_text(unshared_result(String,waited)),terminal,error,True{}},deliveries))
    case Done{Again{policy,held,log_failed,cursor,last_message,primary,current,terminal,filter,codex_log,first_error,checkpoint_state,incomplete,alive,deliveries,next}}: consume(db,player,id,log,policy,held,log_failed,handle,harness,spool,spanned,cursor,last_message,primary,current,terminal,filter,requested,codex_log,first_error,sender,attempt,checkpoint_state,incomplete,monitor,wake_sub,alive,deliveries,next)
    case Done{AwakeEnd{+notice,+alive}}: do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
      +drained : String <- Guidance.awake_pending(db,player,handle,cursor,Bool.and(String.eq(harness,"omp\n"),Bool.and(Bool.not(String.is_empty(notice)),String.is_empty(terminal))))
      continuation : (List<Chan(Result<&1,&1,U32 & String,String>)> -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>)) <- IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)> -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>),Bool.pick(List<Chan(Result<&1,&1,U32 & String,String>)> -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>),String.is_empty(notice),
        pending => consume_exhausted(db,player,id,log,spool,held,log_failed,handle,harness,codex_log,terminal,filter,requested,first_error,sender,attempt,checkpoint_state,incomplete_observation,monitor,pending,wake_sub,alive),
        pending => do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
          +wake_safe : Bool <- IO.pure(Bool,Bool.and(String.is_empty(first_error),Bool.and(Bool.not(incomplete_observation),Bool.not(log_failed))))
          next : Result<&1,&1,U32 & String,WakeRead> <- Bool.pick(IO(Result<&1,&1,U32 & String,WakeRead>),wake_safe,next_wake(spool,handle,wake_sub,alive,spanned),IO.pure(Result<&1,&1,U32 & String,WakeRead>,Fail{(0,"stopping after an earlier observation or durable write failure")}))
          consume(db,player,id,log,policy,held,log_failed,handle,harness,spool,spanned,drained,last_message,primary,current,terminal,filter,requested,codex_log,first_error,sender,attempt,checkpoint_state,incomplete_observation,monitor,wake_sub,alive,pending,next)))
      continuation(deliveries)
    case Done{AwakeLine{+line,notice,+alive}}:
      do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
        step : WakeRead <- consume_frame(db,player,id,log,policy,held,log_failed,handle,harness,spool,spanned,cursor,last_message,primary,current,terminal,filter,requested,codex_log,first_error,attempt,checkpoint_state,incomplete_observation,monitor,wake_sub,alive,deliveries,line,notice)
        consume(db,player,id,log,policy,held,log_failed,handle,harness,spool,spanned,cursor,last_message,primary,current,terminal,filter,requested,codex_log,first_error,sender,attempt,checkpoint_state,incomplete_observation,monitor,wake_sub,alive,Nil{},Done{step})

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
          observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- consume(db,player,id,generation,policy,"",False{},handle,harness,"",False{},"0\n","","","","","",requested,"",restore_error,sender,"",Observer.empty(),restore_failed,False{},0,False{},Nil{},first)
          direct_observed(observation))

# Monitor custody cannot report native completion because the keeper has no
# retained child exit status.
def monitor_outcome(monitor: Bool, outcome: Outcome) -> Outcome:
  match monitor:
    case False{}: outcome
    case True{}: match outcome:
      case Ended{status,event,error,incomplete}: Ended{status,event,error,True{}}

def observed_result(monitor: Bool, observation: Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  (outcome,deliveries)=observation
  IO.pure(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>,(monitor_outcome(monitor,outcome),deliveries))

# The retained process sends its initial input once. Reattachment reads the same
# attempt from its first frame so native completion can be reconstructed.
@unsafe
def retained_output(+db: String, +player: String, +id: String, +log: String, +harness: String, +attempt: String, +directory: String, +handle: U32, +supplied_requested: String) -> IO(Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>):
  do IO<Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>>:
    +generation : String <- IO.pure(String,generation_log(log,id))
    +monitor : Bool <- Observer.monitor_handle(db,handle)
    +policy : Logs.Policy <- Logs.open_attempt(db,player,log,id)
    sender : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
    output_present : Bool <- Logs.prepare_retained_output(generation)
    +checkpoint_state : Observer.State <- Bool.pick(IO(Observer.State),Bool.or(monitor,output_present),Observer.restore(db,handle,monitor),Observer.reset_empty(db,handle,monitor))
    +resumed : Result<&2,&2,Sigma<&2,&2,U32,_ => String>,Unit> <- shared_result_io(Unit,NativeRequests.resume(db,player,id,attempt,Bool.and(String.eq(harness,"omp\n"),Bool.and(Bool.not(String.is_empty(attempt)),String.is_empty(Observer.terminal(checkpoint_state))))))
    +resume_error : String <- IO.pure(String,append_write_error("",unshared_result(Unit,resumed)))
    +resume_failed : Bool <- IO.pure(Bool,checkpoint_write_failed(unshared_result(Unit,resumed)))
    opened : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db,"0","0")
    +subscription : Sigma<&2,&2,U32,_ => Bool> <- IO.pure(Sigma<&2,&2,U32,_ => Bool>,subscribe_fields(opened))
    +wake_sub : U32 <- IO.pure(U32,subscribe_handle(subscription))
    +wake_on : Bool <- IO.pure(Bool,subscribe_active(subscription))
    +spool : String <- IO.pure(String,directory ++ "/stdout")
    +spanned : Bool <- IO.pure(Bool,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(attempt))))
    first : Result<&1,&1,U32 & String,WakeRead> <- next_wake(spool,handle,wake_sub,wake_on,spanned)
    cursor : String <- IO.pure(String,Observer.cursor(checkpoint_state))
    last_message : String <- IO.pure(String,Observer.last_message(checkpoint_state))
    primary : String <- IO.pure(String,Observer.muse_primary(checkpoint_state))
    current : String <- IO.pure(String,Observer.muse_current(checkpoint_state))
    terminal : String <- IO.pure(String,Observer.terminal(checkpoint_state))
    filter : String <- IO.pure(String,Observer.filter_mode(checkpoint_state))
    +requested : String <- IO.pure(String,Bool.pick(String,String.eq(supplied_requested,"unknown"),Omp.filter_requested(Observer.filter_mode(checkpoint_state)),supplied_requested))
    codex_log : String <- IO.pure(String,Observer.codex_log(checkpoint_state))
    held : String <- IO.pure(String,Observer.held(checkpoint_state))
    observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- consume(db,player,id,generation,policy,held,False{},handle,harness,spool,spanned,cursor,last_message,primary,current,terminal,filter,requested,codex_log,resume_error,sender,attempt,checkpoint_state,resume_failed,monitor,wake_sub,wake_on,Nil{},first)
    observed_result(monitor,observation)

def muse_retained_arguments(cmd: String, model: String, effort: String, prompt_file: String, +session: String) -> List<String>:
  Muse.resume_arguments(cmd,model,effort,prompt_file,session)

def retained_arguments(omp: Bool, claude: Bool, muse: Bool, +cmd: String, +model: String, +effort: String, sessions: String, +prompt_file: String, +native: String) -> String:
  Bool.pick(String,claude,
    Claude.argv(cmd,model,effort,native,String.is_empty(native)),
  Bool.pick(String,omp,Omp.argv(cmd,model,effort,sessions,native,String.is_empty(native)),
  Bool.pick(String,muse,P.argv(muse_retained_arguments(cmd,model,effort,prompt_file,native)),Codex.argv(cmd,model,effort,native,String.is_empty(native)))))

def profile_path(+db: String, player: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,Subs.profile_record_sql(db,player)))
    IO.pure(String,Tx.trim_nl(saved))

# The profile in use is the last line of the session's append-only record. A missing
# record keeps the harness's default store. A record written under another harness
# binds nothing, so a Codex store never becomes CLAUDE_CONFIG_DIR after a route
# switch; legacy harness-less records keep today's binding. Other read failures stop
# the launch with the filesystem's code and detail.
def current_store(db: String, player: String, +harness: String) -> IO(String):
  do IO<String>:
    path : String <- profile_path(db,player)
    read : Result<&1,&1,U32 & String,String> <- T.Text.read(path)
    text : String <- IO.pass(String,Subs.optional_text(read))
    +last : String <- IO.pure(String,Subs.last_line(Tx.split_lines(text)))
    +recorded : String <- IO.pure(String,Subs.record_harness(last))
    IO.pure(String,Bool.pick(String,Bool.or(String.is_empty(recorded),String.eq(recorded,Tx.trim_nl(harness))),Subs.record_store(last),""))

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
# spawns exactly as before. OMP binds PI_CODING_AGENT_DIR and Muse binds
# XDG_CONFIG_HOME; a selected profile assignment overrides an inherited store.
def retained_profile_other(omp: Bool, muse: Bool, binding: List<String>, override: List<String>, cmd: String, model: String, effort: String, sessions: String, prompt_file: String, +native: String) -> String:
  match omp:
    case True{}: Omp.argv_profile(binding,cmd,model,effort,sessions,native,String.is_empty(native))
    case False{}:
      match muse:
        case True{}: Muse.argv_profile(binding,cmd,model,effort,prompt_file,native,String.is_empty(native))
        case False{}: Codex.argv_profile(binding,override,cmd,model,effort,native,String.is_empty(native))

def retained_profile_arguments(omp: Bool, claude: Bool, muse: Bool, binding: List<String>, override: List<String>, cmd: String, model: String, effort: String, sessions: String, prompt_file: String, +native: String) -> String:
  match claude:
    case True{}: Claude.argv_profile(binding,cmd,model,effort,native,String.is_empty(native))
    case False{}: retained_profile_other(omp,muse,binding,override,cmd,model,effort,sessions,prompt_file,native)

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

# DSH persists sessions under DSH_HOME. One home per seat keeps two sessions
# from sharing a conversation store. The database directory holds it so the
# seat's existing mutable area needs no extra installation step.
def dsh_home_text(+base: String, value: String) -> String:
  match value:
    case "": base ++ ".dsh-home"
    case other: other

def dsh_home_value(+base: String, result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: base ++ ".dsh-home"
    case Done{value}: dsh_home_text(base,Tx.trim_nl(value))

def dsh_home(+db: String, +base: String, +player: String) -> IO(String):
  do IO<String>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT " ++ C.q(base ++ ".dsh-home-") ++ " || lower(hex(id)) FROM sessions WHERE id=" ++ C.q(player) ++ ";")
    IO.pure(String,dsh_home_value(base,found))

# Legacy Node OMP adapters stored custom parentless IDs in the per-session directory.
def retained_native(+db: String, +player: String, +sessions: String, +session: String, +harness: String) -> IO(String):
  do IO<String>:
    alternate : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(sessions) ++ "=" ++ C.q(db ++ ".sessions") ++ " THEN CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END ELSE " ++ C.q(db ++ ".sessions") ++ " END FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    +enabled : Bool <- IO.pure(Bool,Bool.and(String.eq(harness,"omp\n"),Bool.not(String.is_empty(session))))
    +selected : String <- Omp.resume_file(sessions,Tx.trim_nl(alternate),session,enabled)
    legacy : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    Omp.resume_file(Tx.trim_nl(legacy),sessions,selected,Bool.and(enabled,String.eq(selected,session)))

def dsh_home_if(dsh: Bool, +db: String, +base: String, +player: String) -> IO(String):
  match dsh:
    case True{}: dsh_home(db,base,player)
    case False{}: IO.pure(String,"")

def dsh_prepare_if(dsh: Bool, +directory: String, +model: String, +effort: String) -> IO(Result<&1,&1,U32 & String,Dsh.Prepared>):
  match dsh:
    case True{}: Dsh.prepare(directory,model,effort)
    case False{}: IO.pure(Result<&1,&1,U32 & String,Dsh.Prepared>,Done{Dsh.Prepared{"",""}})

type IdentityParts is Data:
  IdParts{prefix: String, resolver: String}

def maybe_text(value: Maybe<String>) -> String:
  match value:
    case None{}: ""
    case Some{text}: text

def text_maybe(text: String) -> Maybe<String>:
  match text:
    case "": None{}
    case other: Some{other}

def identity_prefix(parts: IdentityParts) -> String:
  match parts:
    case IdParts{prefix,resolver}: prefix

def identity_resolver(parts: IdentityParts) -> Maybe<String>:
  match parts:
    case IdParts{prefix,resolver}: text_maybe(resolver)

def identity_products(model: String, identity: String & String) -> IdentityParts:
  (registry,+helper)=identity
  +configured=registry
  +prefix = P.argv(Bool.pick(List<String>,String.is_empty(configured),Nil{},["node",helper,"launch","--registry",configured,"--model-key",model,"--"]))
  +resolver = maybe_text(Accounts.api_key_resolver_value(Accounts.api_key_helper(helper)))
  IdParts{prefix,resolver}

def retained_launch_result(checked: Result<&1,&1,U32 & String,Unit>, arguments: String, input: String, initial: String, keep_stdin: U32, file_input: Bool) -> IO(Result<&1,&1,U32 & String,RetainedLaunch>):
  match checked:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,RetainedLaunch>,Fail{error})
    case Done{made}: IO.pure(Result<&1,&1,U32 & String,RetainedLaunch>,Done{Prepared{arguments,input,initial,keep_stdin,file_input}})

def retained_launch_checked(prepared: Result<&1,&1,U32 & String,Dsh.Prepared>, +dsh: Bool, +prefix: String, +home: String, +cmd: String, +model: String, +effort: String, +native: String, +muse: Bool, +args: String, +initial: String, +omp: Bool, +claude: Bool, +level: String, seal_prompt: Bool) -> IO(Result<&1,&1,U32 & String,RetainedLaunch>):
  match prepared:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,RetainedLaunch>,Fail{error})
    case Done{Dsh.Prepared{tools, model_patch}}: do IO<Result<&1,&1,U32 & String,RetainedLaunch>>:
      +arguments : String = Bool.pick(String,dsh,prefix ++ Dsh.argv(home,cmd,model,effort,tools,model_patch,native,String.is_empty(native)),args)
      checked : Result<&1,&1,U32 & String,Unit> <- Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),omp,Omp.preflight_arguments(arguments),IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))
      retained_launch_result(checked,arguments,retained_input(muse,omp,claude,initial,level),initial,retained_keep_stdin(muse,omp,claude),Bool.or(muse,seal_prompt))

def retained_launch_plain(omp: Bool, claude: Bool, muse: Bool, cmd: String, model: String, effort: String, sessions: String, prompt_file: String, +native: String, +prefix: String, account: Maybe<&2,Accounts.AccountRecord>, +credit_refusal: String) -> Result<&1,&1,U32 & String,String>:
  match account:
    case None{}: Done{prefix ++ retained_arguments(omp,claude,muse,cmd,model,effort,sessions,prompt_file,native)}
    case Some{+refused}: Fail{(2,Bool.pick(String,String.is_empty(credit_refusal),Accounts.credit_api_key_refusal(refused),credit_refusal))}

def retained_launch_arguments(omp: Bool, claude: Bool, muse: Bool, cmd: String, model: String, effort: String, sessions: String, prompt_file: String, +native: String, +prefix: String, +history: String, harness: String, account: Maybe<&2,Accounts.AccountRecord>, binding: Maybe<List<String>>, +credit_refusal: String) -> Result<&1,&1,U32 & String,String>:
  match binding:
    case Some{bound}: Done{prefix ++ retained_profile_arguments(omp,claude,muse,bound,Subs.history_override(Tx.trim_nl(harness),history),cmd,model,effort,sessions,prompt_file,native)}
    case None{}: retained_launch_plain(omp,claude,muse,cmd,model,effort,sessions,prompt_file,native,prefix,account,credit_refusal)

def retained_prepare_checked(+db: String, +player: String, +directory: String, +cmd: String, +model: String, +effort: String, +session: String, +harness: String, +sessions: String, +prompt: String, +level: String, seal_prompt: Bool, +predecessor: String, checked: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,RetainedLaunch>):
  match checked:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,RetainedLaunch>,Fail{error})
    case Done{made}: do IO<Result<&1,&1,U32 & String,RetainedLaunch>>:
      +initial : String <- IO.try(String,NativeInitialInput.prepare(db,player,directory,prompt,predecessor))
      +native : String <- retained_native(db,player,sessions,session,harness)
      +prompt_file : String <- IO.pure(String,directory ++ "/prompt.txt")
      +executable : String <- IO.try(String,Lock.SessionLock.executable())
      identity : String & String <- IO.try(String & String,HostControl.Control.identity(executable))
      +absolute_db : String <- IO.try(String,Lock.SessionLock.canonical(db))
      +parts : IdentityParts <- IO.pure(IdentityParts,identity_products(model,identity))
      +omp : Bool <- IO.pure(Bool,String.eq(harness,"omp\n"))
      +claude : Bool <- IO.pure(Bool,String.eq(harness,"claude-code\n"))
      +dsh : Bool <- IO.pure(Bool,String.eq(harness,"dsh\n"))
      +muse : Bool <- IO.pure(Bool,String.eq(harness,"muse\n"))
      home : String <- dsh_home_if(dsh,db,absolute_db,player)
      prepared : Result<&1,&1,U32 & String,Dsh.Prepared> <- dsh_prepare_if(dsh,directory,model,effort)
      +prefix : String <- IO.pure(String,P.argv(["/usr/bin/env","BATON_DATABASE=" ++ absolute_db,"BATON_SESSION=" ++ player,"BATON_ATTEMPT_DIRECTORY=" ++ directory]) ++ identity_prefix(parts))
      +account : Maybe<&2,Accounts.AccountRecord> <- Accounts.current_account(db,player,harness)
      store : String <- current_store(db,player,harness)
      history : String <- current_history(db,player)
      credit_refusal : String <- Accounts.credit_launch_refusal_for(db,account)
      binding : Maybe<List<String>> <- Accounts.credit_launch_binding(db,player,directory,Tx.trim_nl(harness),account,identity_resolver(parts),store)
      recorded : Unit <- Accounts.record_current_attempt(db,player,directory,predecessor,account)
      +args : String <- IO.try(String,IO.pure(Result<&1,&1,U32 & String,String>,retained_launch_arguments(omp,claude,muse,cmd,model,effort,sessions,prompt_file,native,prefix,history,Tx.trim_nl(harness),account,binding,credit_refusal)))
      launch : Result<&1,&1,U32 & String,RetainedLaunch> <- retained_launch_checked(prepared,dsh,prefix,home,cmd,model,effort,native,muse,args,initial,omp,claude,level,seal_prompt)
      IO.pure(Result<&1,&1,U32 & String,RetainedLaunch>,launch)

def retained_prepare(+db: String, +player: String, +directory: String, +cmd: String, +model: String, +effort: String, +session: String, +harness: String, +sessions: String, +prompt: String, +level: String, seal_prompt: Bool, predecessor: String) -> IO(Result<&1,&1,U32 & String,RetainedLaunch>):
  do IO<Result<&1,&1,U32 & String,RetainedLaunch>>:
    retained_prepare_checked(db,player,directory,cmd,model,effort,session,harness,sessions,prompt,level,seal_prompt,predecessor,Done{Unit{}})

def retained_admit(+db: String, +directory: String, +cwd: String, +prompt: String, +lock: U32, +recovery: String, launch: RetainedLaunch) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  match launch:
    case Prepared{+arguments,+input,+initial,+keep_stdin,file_input}:
      Bool.pick(IO(Result<&1,&1,U32 & String,P.RetainedStart>),file_input,Custody.Instance.admit_with_file(db,directory,arguments,cwd,directory ++ "/native.stderr","prompt.txt",initial,input,keep_stdin,Some{lock},recovery),Custody.Instance.admit(db,directory,arguments,cwd,directory ++ "/native.stderr",input,keep_stdin,Some{lock},recovery))

def retained_mode(+db: String, player: String, +directory: String, cmd: String, model: String, effort: String, cwd: String, session: String, harness: String, sessions: String, +prompt: String, lock: U32, recovery: String, level: String, seal_prompt: Bool, predecessor: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
    launch : RetainedLaunch <- IO.try(RetainedLaunch,retained_prepare(db,player,directory,cmd,model,effort,session,harness,sessions,prompt,level,seal_prompt,predecessor))
    retained_admit(db,directory,cwd,prompt,lock,recovery,launch)

def retained(+db: String, +player: String, +directory: String, +cmd: String, +model: String, +effort: String, +cwd: String, +session: String, +harness: String, +sessions: String, +prompt: String, +lock: U32, +recovery: String, +level: String, predecessor: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  retained_mode(db,player,directory,cmd,model,effort,cwd,session,harness,sessions,prompt,lock,recovery,level,True{},predecessor)

def direct_setup_note(+db: String, +player: String, +id: String, log: String, +cause: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    exited : Unit <- record_exit(db,player,id,log,Ended{"setup failed","",cause,True{}})
    sequence : String <- IO.try(String,DB.Sql.query(db,"SELECT CAST(coalesce(max(seq),0)+1 AS TEXT) FROM messages;"))
    +notice : String <- IO.pure(String,id ++ ":setup:" ++ Tx.trim_nl(sequence))
    noted : Unit <- report(db,player,notice,"Direct turn setup failed: " ++ cause ++ ". The retained request " ++ id ++ " remains unfinished; correct the setup and resume the session.")
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,notice,"1","")
    IO.pure(Result<&1,&1,U32 & String,Unit>,Delivery.wake_result(delivered))

def direct_setup_failure(-A: Type, +db: String, +player: String, +id: String, log: String, lock: U32, error: U32 & String) -> IO(A):
  (+code,+cause)=error
  do IO<A>:
    noted : Result<&1,&1,U32 & String,Unit> <- direct_setup_note(db,player,id,log,U32.show(code) ++ ": " ++ cause)
    released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(lock)
    IO.die(A,code,append_write_error(append_write_error(cause,noted),released))

def direct_retained_prepared(+db: String, +player: String, +directory: String, +cwd: String, +prompt: String, +lock: U32, +recovery: String, prepared: Result<&1,&1,U32 & String,RetainedLaunch>) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  match prepared:
    case Done{launch}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      +gate : UW.Gate <- direct_window_gate(db,player)
      Bool.pick(IO<Result<&1,&1,U32 & String,P.RetainedStart>>,direct_gate_held(gate),
        IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Done{P.Unstarted{direct_gate_refusal(gate)}}),
        retained_admit(db,directory,cwd,prompt,lock,recovery,launch))
    case Fail{error}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      id : String <- IO.try(String,DB.Sql.query(db,"SELECT id FROM executions WHERE session=" ++ C.q(player) ++ " AND mode='direct';"))
      log : String <- IO.try(String,DB.Sql.query(db,"SELECT r.output FROM direct_turn_requests r JOIN executions e ON e.id=r.id AND e.session=r.session WHERE e.session=" ++ C.q(player) ++ " AND e.mode='direct';"))
      direct_setup_failure(Result<&1,&1,U32 & String,P.RetainedStart>,db,player,Tx.trim_nl(id),Tx.trim_nl(log),lock,error)

def direct_retained(+db: String, +player: String, +directory: String, +cmd: String, +model: String, +effort: String, +cwd: String, +session: String, +harness: String, +sessions: String, +prompt: String, +lock: U32, +recovery: String, +level: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
    prepared : Result<&1,&1,U32 & String,RetainedLaunch> <- retained_prepare(db,player,directory,cmd,model,effort,session,harness,sessions,prompt,level,True{},"")
    direct_retained_prepared(db,player,directory,cwd,prompt,lock,recovery,prepared)

def claude_launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Claude.start_player(cmd,model,effort,cwd,stderr)
    case False{}: Claude.resume_player(cmd,model,effort,cwd,stderr,session)

def muse_launch(cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String, task: String, fresh: Bool) -> IO(Result<&1,&1,U32 & String,U32>):
  match fresh:
    case True{}: Muse.start_player(cmd,model,effort,cwd,stderr,task)
    case False{}: Muse.resume_player(cmd,model,effort,cwd,stderr,session,task)

def omp_launch_checked(sessions: String, cmd: String, model: String, effort: String, cwd: String, stderr: String, +session: String, checked: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,U32>):
  match checked:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32>,Fail{error})
    case Done{made}: Omp.start_player(cmd,model,effort,cwd,sessions,session,String.is_empty(session),stderr)

def omp_launch(sessions: String, cmd: String, model: String, effort: String, cwd: String, stderr: String, session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    checked : Result<&1,&1,U32 & String,Unit> <- Omp.preflight()
    omp_launch_checked(sessions,cmd,model,effort,cwd,stderr,session,checked)

def binding_list(binding: Maybe<List<String>>) -> List<String>:
  match binding:
    case None{}: Nil{}
    case Some{bound}: bound

def direct_binding(+db: String, +player: String, +harness: String) -> IO(Maybe<List<String>>):
  do IO<Maybe<List<String>>>:
    account : Maybe<&2,Accounts.AccountRecord> <- Accounts.current_account(db,player,harness)
    store : String <- current_store(db,player,harness)
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    identity : String & String <- IO.try(String & String,HostControl.Control.identity(executable))
    binding : Maybe<List<String>> <- Accounts.credit_launch_binding(db,player,"",Tx.trim_nl(harness),account,Accounts.api_key_resolver(identity),store)
    IO.pure(Maybe<List<String>>,binding)

def omp_launch_configured(+db: String, +player: String, sessions: String, cmd: String, model: String, effort: String, cwd: String, stderr: String, +session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    binding : Maybe<List<String>> <- direct_binding(db,player,"omp\n")
    Omp.start_player_profile(binding_list(binding),cmd,model,effort,cwd,sessions,session,String.is_empty(session),stderr)

def muse_launch_configured(+db: String, +player: String, cmd: String, model: String, effort: String, cwd: String, stderr: String, +session: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    binding : Maybe<List<String>> <- direct_binding(db,player,"muse\n")
    Muse.start_player_profile(binding_list(binding),cmd,model,effort,cwd,stderr,task,session,String.is_empty(session))

def dsh_launch_prepared(prepared: Result<&1,&1,U32 & String,Dsh.Prepared>, +home: String, +cmd: String, +model: String, +effort: String, +cwd: String, +stderr: String, +session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  match prepared:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,U32>,Fail{error})
    case Done{Dsh.Prepared{tools, model_patch}}:
      match session:
        case "": Dsh.start_player(home,cmd,model,effort,cwd,stderr,tools,model_patch)
        case other: Dsh.resume_player(home,cmd,model,effort,cwd,stderr,other,tools,model_patch)

def dsh_launch(+db: String, +player: String, +log: String, +cmd: String, +model: String, +effort: String, +cwd: String, +stderr: String, +session: String) -> IO(Result<&1,&1,U32 & String,U32>):
  do IO<Result<&1,&1,U32 & String,U32>>:
    canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    home : String <- dsh_home(db,canonical,player)
    directory : String <- IO.pure(String,log ++ ".dsh")
    prepared : Result<&1,&1,U32 & String,Dsh.Prepared> <- Dsh.prepare(directory,model,effort)
    dsh_launch_prepared(prepared,home,cmd,model,effort,cwd,stderr,session)

def launch(+db: String, +player: String, sessions: String, +cmd: String, +model: String, +effort: String, +cwd: String, +stderr: String, +session: String, +harness: String, +log: String, task: String) -> IO(Result<&1,&1,U32 & String,U32>):
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"omp\n"),
    omp_launch_configured(db,player,sessions,cmd,model,effort,cwd,stderr,session),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"muse\n"),
    muse_launch_configured(db,player,cmd,model,effort,cwd,stderr,session,task),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"dsh\n"),
    dsh_launch(db,player,log,cmd,model,effort,cwd,stderr,session),
  Bool.pick(IO(Result<&1,&1,U32 & String,U32>), String.eq(harness,"codex\n"),
    Codex.start_player(cmd,model,effort,cwd,stderr,session,String.is_empty(session)),
    claude_launch(cmd,model,effort,cwd,stderr,session,String.is_empty(session))))))

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

# DSH refuses an unknown or moved session before the task runs and names the
# refusal on stderr, even when its --json stream also carries an error line.
def refusal_kind(+text: String) -> String:
  Bool.pick(String, Tx.starts_with(Tx.trim_nl(text), "dsh: session "), "dsh",
  Bool.pick(String, Tx.starts_with(Tx.trim_nl(text), "Error: Session"), "codex", ""))

def refusal_kind_decision(kind: String, event: String) -> Bool:
  match kind:
    case "dsh": True{}
    case "codex": String.is_empty(event)
    case other: False{}

# A resume value this host no longer holds: the harness refuses the identity
# before any turn runs, and its stderr says so.
def refusal_body(resumable: Bool, event: String, text: String) -> Bool:
  kind = refusal_kind(text)
  Bool.and(resumable,refusal_kind_decision(kind,event))

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
      child : Result<&1,&1,U32 & String,U32> <- launch(db,player,sessions,cmd,model,effort,cwd,stderr,"",harness,log,task)
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
    child : Result<&1,&1,U32 & String,U32> <- launch(db,player,sessions,cmd,model,effort,cwd,stderr,native,harness,log,task)
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
  ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":task-input") ++ ",worker.id,worker.id,'task-assignment'," ++ C.q(prompt) ++ " FROM sessions worker WHERE worker.id=" ++ C.q(player) ++ " AND worker.parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") AND EXISTS(SELECT 1 FROM direct_turn_requests WHERE " ++ direct_request_match(id,player,harness,cmd,model,effort,cwd,task,prompt,log,session,directory) ++ ");"
  ++ "SELECT CASE WHEN EXISTS(SELECT 1 FROM direct_turn_requests WHERE " ++ direct_request_match(id,player,harness,cmd,model,effort,cwd,task,prompt,log,session,directory) ++ ") THEN '' WHEN EXISTS(SELECT 1 FROM direct_turn_requests WHERE id=" ++ C.q(id) ++ ") THEN 'The direct turn ID belongs to a different retained request; use a new turn ID.' WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") THEN 'The direct turn ID has a stored result without retained request input; use delivery to read that result and a new ID for new work.' ELSE 'The direct turn request could not be retained.' END;COMMIT;"

def direct_request_checked(+db: String, +id: String, +player: String, +harness: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +prompt: String, +log: String, +session: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    +error : String <- IO.try(String,DB.Sql.query(db,direct_request_sql(id,player,harness,cmd,model,effort,cwd,task,prompt,log,session,directory)))
    Stop.error_result(Tx.trim_nl(error),String.is_empty(Tx.trim_nl(error)))

# Recovery accepts the original, fresh, account-continuation, and same-account
# retry directories: a provider continuation appends .retry to its own attempt, so the
# check names both the plain and the fresh-prefixed retry forms.
def direct_recovery_checked(+db: String, +player: String, +id: String, +harness: String, +directory: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM direct_turn_requests WHERE id=" ++ C.q(id) ++ " AND session=" ++ C.q(player) ++ " AND harness=" ++ C.q(harness) ++ " AND (directory=" ++ C.q(directory) ++ " OR directory || '.fresh'=" ++ C.q(directory) ++ " OR substr(" ++ C.q(directory) ++ ",1,length(directory)+11)=directory || '.continued-' OR substr(" ++ C.q(directory) ++ ",1,length(directory)+17)=directory || '.fresh.continued-' OR substr(" ++ C.q(directory) ++ ",1,length(directory)+6)=directory || '.retry' OR substr(" ++ C.q(directory) ++ ",1,length(directory)+12)=directory || '.fresh.retry');"))
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

# The terminal event carried by an Ended outcome, for the direct route decision.
def direct_event(outcome: Outcome) -> String:
  match outcome:
    case Ended{status,event,error,incomplete}: event

# The recovery guidance for a direct route switch names the original turn, the old
# native lineage and the complete saved direct task. It is written even when other
# reports are owed, so the continuation carries its provenance on a busy session too.
# Parentless turns keep no :task-input row; the saved request row carries the task.
def direct_route_guidance(+db: String, +player: String, +id: String, conversation: String, harness: String, model: String) -> IO(Unit):
  do IO<Unit>:
    task : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT task FROM direct_turn_requests WHERE id=" ++ C.q(id) ++ " AND session=" ++ C.q(player) ++ "),'');"))
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":route-guidance") ++ ",id,id,'guidance'," ++ C.q("All subscription accounts refused with provider-reported usage exhaustion and the task continues on another operator-listed route: harness=" ++ harness ++ " model=" ++ model ++ ". Continue the original direct turn from its assignment and context; the previous native conversation lineage is " ++ conversation ++ "; the failed turn stays recorded with the provider cause; the complete saved direct task: " ++ Tx.trim_nl(task)) ++ " FROM sessions WHERE id=" ++ C.q(player) ++ " AND NOT " ++ C.stopped_session_sql(C.q(player)) ++ ";"))
    IO.pure(Unit,Unit{})

# A route switch runs only on a complete, clean exhaustion terminal that recorded the
# all-accounts-refused outcome on an unstopped session. An incomplete observation or
# a recorded observation error keeps the ordinary wake; a provider-exhaustion report
# alone does not clear it. History and lineage append IO failures and stops also keep
# the ordinary wake. Receive shares this decision through route_observed so both
# paths require the same completely observed availability episode.
def route_reported(+db: String, +player: String, +id: String, event: String, error_clear: Bool) -> IO(Bool):
  match error_clear:
    case True{}: do IO<Bool>:
      closed : Bool <- Stop.stopped(db,player)
      triggered : Bool <- Subs.route_trigger(db,player,id,event)
      IO.pure(Bool,Bool.and(Bool.not(closed),triggered))
    case False{}: IO.pure(Bool,False{})

def route_observed(+db: String, +player: String, +id: String, event: String, error: String, incomplete: Bool) -> IO(Bool):
  match incomplete:
    case True{}: IO.pure(Bool,False{})
    case False{}: route_reported(db,player,id,event,String.is_empty(error))

def direct_route_decided(+db: String, +player: String, +id: String, outcome: Outcome) -> IO(Bool):
  match outcome:
    case Ended{status,event,error,incomplete}: route_observed(db,player,id,event,error,incomplete)

def direct_route_applied(+db: String, +player: String, +id: String, +log: String, +cause: String, +old_harness: String, old_model: String, +effort: String, +conversation: String, outcome: Outcome, chosen: Maybe<&2,Subs.Route>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match chosen:
    case None{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      noted : Unit <- Subs.report_route_unavailable(db,player,id,old_harness,cause)
      wake : Result<&1,&1,U32 & String,Unit> <- direct_wake(db,player,id,outcome)
      IO.pure(Result<&1,&1,U32 & String,Unit>,wake)
    case Some{+route}: do IO<Result<&1,&1,U32 & String,Unit>>:
      noted : Unit <- Subs.report_route_chosen(db,player,id,route,cause)
      configured : String <- Control.configure(db,player,Subs.route_harness(route),Subs.route_model(route),effort,Subs.route_cmd(route),log,old_harness,old_model,effort)
      cleared : Unit <- Subs.clear_incompatible_native(db,player,old_harness,Subs.route_harness(route))
      guided : Unit <- direct_route_guidance(db,player,id,conversation,Subs.route_harness(route),Subs.route_model(route))
      wake : Result<&1,&1,U32 & String,Unit> <- direct_wake(db,player,id,outcome)
      IO.pure(Result<&1,&1,U32 & String,Unit>,wake)

def direct_route_continue(+db: String, +player: String, +id: String, +log: String, +outcome: Outcome) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +cause : String <- Subs.exhaustion_cause(db,direct_event(outcome))
    +old_harness : String <- IO.try(String,DB.Sql.query(db,Subs.session_route_sql(db,player)))
    +old_model : String <- IO.try(String,DB.Sql.query(db,Subs.session_model_sql(db,player)))
    +effort : String <- IO.try(String,DB.Sql.query(db,"SELECT effort FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    +conversation : String <- direct_conversation(db,player,"")
    chosen : Maybe<&2,Subs.Route> <- Subs.select_route(db,player,id)
    direct_route_applied(db,player,id,log,cause,Tx.trim_nl(old_harness),Tx.trim_nl(old_model),Tx.trim_nl(effort),Tx.trim_nl(conversation),outcome,chosen)

def direct_route_wake(+db: String, +player: String, +id: String, +log: String, outcome: Outcome, routed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match routed:
    case False{}: direct_wake(db,player,id,outcome)
    case True{}: direct_route_continue(db,player,id,log,outcome)

# A route launches only on clean settlement: any native release, finish, question or
# acknowledgment failure keeps its own failed result and wakes ordinarily, matching
# the receive route_after_advance gate.
def direct_settled_wake(+db: String, +player: String, +id: String, +log: String, +outcome: Outcome, settled: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match settled:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      wake : Result<&1,&1,U32 & String,Unit> <- direct_wake(db,player,id,outcome)
      IO.pure(Result<&1,&1,U32 & String,Unit>,combine(Fail{error},wake))
    case Done{unit}: do IO<Result<&1,&1,U32 & String,Unit>>:
      routed : Bool <- direct_route_decided(db,player,id,outcome)
      wake : Result<&1,&1,U32 & String,Unit> <- direct_route_wake(db,player,id,log,outcome,routed)
      IO.pure(Result<&1,&1,U32 & String,Unit>,combine(Done{unit},wake))

def direct_completed(+db: String, +player: String, +id: String, +log: String, +directory: String, +handle: U32, lock: Maybe<U32>, observation: Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>) -> IO(Unit):
  (+outcome,deliveries)=observation
  do IO<Unit>:
    exited : Unit <- record_exit(db,player,id,log,outcome)
    prepared : Unit <- prepare(db,player,id,log,directory ++ "/native.stderr",outcome)
    observer_released : Unit <- direct_release_lock(lock)
    native_released : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.release(handle)
    finished : Result<&1,&1,U32 & String,Unit> <- finish(db,player,id,log,outcome,False{})
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    acknowledged : Result<&1,&1,U32 & String,Unit> <- direct_acknowledge(handle)
    settled : Result<&1,&1,U32 & String,Unit> <- IO.pure(Result<&1,&1,U32 & String,Unit>,combine(native_released,combine(finished,combine(questions,acknowledged))))
    wake : Result<&1,&1,U32 & String,Unit> <- direct_settled_wake(db,player,id,log,outcome,settled)
    IO.pass(Unit,wake)

def direct_unstarted(+db: String, +player: String, +id: String, +log: String, +directory: String, lock: Maybe<U32>, error: String) -> IO(Unit):
  do IO<Unit>:
    +outcome : Outcome <- IO.pure(Outcome,Ended{"start failed","","Player process could not start: " ++ error,True{}})
    exited : Unit <- record_exit(db,player,id,log,outcome)
    prepared : Unit <- prepare(db,player,id,log,directory ++ "/native.stderr",outcome)
    released : Unit <- direct_release_lock(lock)
    finished : Result<&1,&1,U32 & String,Unit> <- finish(db,player,id,log,outcome,False{})
    wake : Result<&1,&1,U32 & String,Unit> <- direct_wake(db,player,id,outcome)
    IO.pass(Unit,combine(finished,wake))

# Pass the delivery channels and lock to the selected continuation: the verdict is the
# account-handoff decision on the outer call and the same-account rate-retry decision
# on the nested call.
def direct_handoff_decided(advanced: Bool, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, lock: Maybe<U32>, otherwise: List<Chan(Result<&1,&1,U32 & String,String>)> -> Maybe<U32> -> IO(Unit), proceed: List<Chan(Result<&1,&1,U32 & String,String>)> -> Maybe<U32> -> IO(Unit)) -> IO(Unit):
  match advanced:
    case False{}: otherwise(deliveries,lock)
    case True{}: proceed(deliveries,lock)

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
      observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- retained_output(db,player,id,log,harness,directory,directory,handle,requested)
      with_retained_observation(observation,lock,
        +outcome => deliveries => direct_completed(db,player,id,log,directory,handle,None{},(outcome,deliveries)),
        +held => status => +event => +error => +incomplete => deliveries => do IO<Unit>:
          +conversation : String <- direct_conversation(db,player,session)
          advanced : Bool <- Accounts.handoff(db,player,id,event,conversation,cmd,cwd)
          direct_handoff_decided(advanced, deliveries, Some{held},
            moved_deliveries => moved_lock => do IO<Unit>:
              transient : Bool <- Subs.transient_provider_error(db,event)
              direct_handoff_decided(Bool.and(transient,Bool.and(Bool.not(incomplete),String.is_empty(error))), moved_deliveries, moved_lock,
                inner_deliveries => inner_lock => direct_completed(db,player,id,log,directory,handle,inner_lock,(Ended{status,event,error,incomplete},inner_deliveries)),
                inner_deliveries => inner_lock => do IO<Unit>:
                  cleaned : Unit <- direct_cleanup(handle,inner_deliveries)
                  +retry : String <- IO.pure(String,directory ++ ".retry")
                  allowed : Bool <- Stop.admit(db,player,id,"direct",retry)
                  admitted : Unit <- Stop.admitted(allowed)
                  +executable : String <- IO.try(String,Lock.SessionLock.executable())
                  +recovery : String <- IO.pure(String,direct_recovery_argv(executable,db,player,id,cmd,model,effort,cwd,log,harness,retry,conversation))
                  +policy : Logs.Policy <- Logs.policy(db,player)
                  +level : String <- IO.pure(String,policy_level(policy))
                  next : P.RetainedStart <- IO.try(P.RetainedStart,direct_retained(db,player,retry,cmd,model,effort,cwd,conversation,harness,db ++ ".sessions",prompt,held,recovery,level))
                  direct_second_started(db,player,id,log,retry,harness,Omp.filter_events(level),cmd,model,effort,cwd,task,prompt,conversation,inner_lock,next)),
            moved_deliveries => moved_lock => do IO<Unit>:
              cleaned : Unit <- direct_cleanup(handle,moved_deliveries)
              +continued : String <- direct_continued_directory(db,player,directory)
              allowed : Bool <- Stop.admit(db,player,id,"direct",continued)
              admitted : Unit <- Stop.admitted(allowed)
              +executable : String <- IO.try(String,Lock.SessionLock.executable())
              +recovery : String <- IO.pure(String,direct_recovery_argv(executable,db,player,id,cmd,model,effort,cwd,log,harness,continued,conversation))
              +policy : Logs.Policy <- Logs.policy(db,player)
              +level : String <- IO.pure(String,policy_level(policy))
              next : P.RetainedStart <- IO.try(P.RetainedStart,direct_retained(db,player,continued,cmd,model,effort,cwd,conversation,harness,db ++ ".sessions",prompt,held,recovery,level))
              direct_second_started(db,player,id,log,continued,harness,Omp.filter_events(level),cmd,model,effort,cwd,task,prompt,conversation,Some{held},next)))
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

# Retry a terminal request-rate refusal on the same conversation and subscription:
# the record is not advanced, so the retry takes a distinct retry directory while the
# spawn rebinds the unchanged profile. The held lock is already in hand on the observed
# path; keeper recovery reacquires it the same way a handoff does.
def direct_transient_relaunch_locked(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +retry: String, +prompt: String, +conversation: String, +lock: U32) -> IO(Unit):
  do IO<Unit>:
    allowed : Bool <- Stop.admit(db,player,id,"direct",retry)
    admitted : Unit <- Stop.admitted(allowed)
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    +recovery : String <- IO.pure(String,direct_recovery_argv(executable,db,player,id,cmd,model,effort,cwd,log,harness,retry,conversation))
    +policy : Logs.Policy <- Logs.policy(db,player)
    +level : String <- IO.pure(String,policy_level(policy))
    start : P.RetainedStart <- IO.try(P.RetainedStart,direct_retained(db,player,retry,cmd,model,effort,cwd,conversation,harness,db ++ ".sessions",prompt,lock,recovery,level))
    direct_second_started(db,player,id,log,retry,harness,Omp.filter_events(level),cmd,model,effort,cwd,task,prompt,conversation,Some{lock},start)

# Keeper recovery reacquires the session lock before retrying the same account.
def direct_transient_acquired(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +retry: String, +prompt: String, +conversation: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"The retained direct attempt ended before its provider continuation reacquired the session; inspect the attempt and retry its pending input.")
    case Some{held}: direct_transient_relaunch_locked(db,player,id,cmd,model,effort,cwd,task,log,harness,retry,prompt,conversation,held)

# Continue a settled provider failure with the held or reacquired session lock.
def direct_transient_settled(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +retry: String, +prompt: String, +conversation: String, lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case Some{held}: direct_transient_relaunch_locked(db,player,id,cmd,model,effort,cwd,task,log,harness,retry,prompt,conversation,held)
    case None{}: Lock.SessionLock.acquire_session(Unit,db,player,+database => next => direct_transient_acquired(database,player,id,cmd,model,effort,cwd,task,log,harness,retry,prompt,conversation,next))

# Provider-reported exhaustion advances through the operator's account list.
# Settle the completed attempt and continue its task and conversation.
def direct_handoff_checked(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +harness: String, +directory: String, +prompt: String, +session: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, outcome: Outcome) -> IO(Unit):
  match outcome:
    case Ended{status,+event,+error,+incomplete}: do IO<Unit>:
      +conversation : String <- direct_conversation(db,player,session)
      advanced : Bool <- Accounts.handoff(db,player,id,event,conversation,cmd,cwd)
      direct_handoff_decided(advanced, deliveries, lock,
        moved_deliveries => moved_lock => do IO<Unit>:
          transient : Bool <- Subs.transient_provider_error(db,event)
          direct_handoff_decided(Bool.and(transient,Bool.and(Bool.not(incomplete),String.is_empty(error))), moved_deliveries, moved_lock,
            inner_deliveries => inner_lock => direct_completed(db,player,id,log,directory,handle,inner_lock,(Ended{status,event,error,incomplete},inner_deliveries)),
            inner_deliveries => inner_lock => do IO<Unit>:
              cleaned : Unit <- direct_cleanup(handle,inner_deliveries)
              +retry : String <- IO.pure(String,directory ++ ".retry")
              direct_transient_settled(db,player,id,cmd,model,effort,cwd,task,log,harness,retry,prompt,conversation,inner_lock)),
        moved_deliveries => moved_lock => do IO<Unit>:
          cleaned : Unit <- direct_cleanup(handle,moved_deliveries)
          direct_handoff_settled(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,prompt,conversation,moved_lock))

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
      observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- retained_output(db,player,id,log,harness,directory,directory,handle,requested)
      direct_first_observed(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,session,prompt,handle,lock,observation)
    case P.Unstarted{error}: direct_unstarted(db,player,id,log,directory,lock,error)

# Setup completes before the request enters native custody. Its failures keep
# the saved input available for an explicit resume of the same turn.
def direct_setup(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +session: String, +harness: String, +directory: String, prompt: String) -> IO(Result<&1,&1,U32 & String,DirectSetup>):
  do IO<Result<&1,&1,U32 & String,DirectSetup>>:
    receiver : Unit <- Control.default_receiver(db,player,cmd,model,effort,cwd,log)
    executable : String <- IO.try(String,Lock.SessionLock.executable())
    recovery : String <- IO.pure(String,direct_recovery_argv(executable,db,player,id,cmd,model,effort,cwd,log,harness,directory,session))
    policy : Logs.Policy <- Logs.policy(db,player)
    +level : String <- IO.pure(String,policy_level(policy))
    launch : RetainedLaunch <- IO.try(RetainedLaunch,retained_prepare(db,player,directory,cmd,model,effort,session,harness,db ++ ".sessions",prompt,level,True{},""))
    IO.pure(Result<&1,&1,U32 & String,DirectSetup>,Done{Ready{launch,recovery,level}})

def direct_setup_result(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, task: String, +log: String, session: String, +harness: String, +directory: String, +prompt: String, +lock: U32, setup: Result<&1,&1,U32 & String,DirectSetup>) -> IO(Unit):
  match setup:
    case Fail{error}: direct_setup_failure(Unit,db,player,id,log,lock,error)
    case Done{Ready{launch,recovery,+level}}: do IO<Unit>:
      start : P.RetainedStart <- IO.try(P.RetainedStart,retained_admit(db,directory,cwd,prompt,lock,recovery,launch))
      direct_first_started(db,player,id,cmd,model,effort,cwd,task,log,harness,directory,session,prompt,Omp.filter_events(level),Some{lock},start)

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
      setup : Result<&1,&1,U32 & String,DirectSetup> <- direct_setup(db,player,id,cmd,model,effort,cwd,log,session,harness,directory,prompt)
      direct_setup_result(db,player,id,cmd,model,effort,cwd,task,log,session,harness,directory,prompt,lock,setup)

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

def supplied_task(task: String, supplied: Maybe<String>) -> IO(String):
  match supplied:
    case None{}: IO.try(String,T.Text.read(task))
    case Some{value}: IO.pure(String,value)

def player_checked(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +task: String, +log: String, +session: String, +harness: String, +lock: U32, missing: Bool, supplied: Maybe<String>) -> IO(Unit):
  match missing:
    case True{}: IO.die(Unit,2,"Player is not registered; register it before starting a turn.")
    case False{}:
      do IO<Unit>:
        supported : Unit <- supported_harness(Bool.or(String.eq(harness,"omp\n"),Bool.or(String.eq(harness,"codex\n"),Bool.or(String.eq(harness,"claude-code\n"),Bool.or(String.eq(harness,"muse\n"),String.eq(harness,"dsh\n"))))))
        foreign : String <- IO.try(String,DB.Sql.query(db,id_owner_sql(id,player)))
        identity : Unit <- matching_turn(String.eq(foreign,"0\n"))
        +prompt : String <- supplied_task(task,supplied)
        +directory : String <- direct_directory(db,id)
        request : Unit <- direct_request_checked(db,id,player,Tx.trim_nl(harness),cmd,model,effort,cwd,task,prompt,log,session,directory)
        found : String <- IO.try(String,DB.Sql.query(db,turn_present_sql(id)))
        launched_prompt : String <- direct_task_prompt(db,player,id,prompt)
        choose(db,player,id,cmd,model,effort,cwd,task,log,session,harness,directory,launched_prompt,lock,String.eq(found,"1\n"))

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
      delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,finish(db,player,id,log,outcome,False{}))
      wake : Result<&1,&1,U32 & String,Unit> <- direct_wake(db,player,id,outcome)
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

def acquired_source(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, +log: String, session: String, missing: Bool, lock: Maybe<U32>, supplied: Maybe<String>) -> IO(Unit):
  match lock:
    case None{}: IO.die(Unit,2,"Session already has an active native turn; send a message to queue input.")
    case Some{handle}: do IO<Unit>:
      retained : Unit <- retained_receive_guard(db,player)
      direct : Unit <- unresolved_direct_execution_guard(db,player)
      harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
      player_checked(db,player,id,cmd,model,effort,cwd,task,log,session,harness,handle,missing,supplied)

def acquired(db: String, player: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String, missing: Bool, lock: Maybe<U32>) -> IO(Unit):
  acquired_source(db,player,id,cmd,model,effort,cwd,task,log,session,missing,lock,None{})

def direct_decoded(decoded: Req.Scalar) -> IO(String):
  match decoded:
    case Req.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,22,"Retained direct request text could not be decoded: " ++ Req.scalar_reason(other))

def direct_field(encoded: String) -> IO(String):
  direct_decoded(Req.decode_scalar_utf8(Tx.hex_decode(encoded)))

def direct_request_fields(fields: List<&2,String>) -> IO(DirectRequest):
  match fields:
    case id <> harness <> command <> model <> effort <> workspace <> task_path <> task <> output <> native <> directory <> original_directory <> Nil{}: do IO<DirectRequest>:
      saved_id : String <- direct_field(id)
      saved_harness : String <- direct_field(harness)
      saved_command : String <- direct_field(command)
      saved_model : String <- direct_field(model)
      saved_effort : String <- direct_field(effort)
      saved_workspace : String <- direct_field(workspace)
      saved_task_path : String <- direct_field(task_path)
      saved_task : String <- direct_field(task)
      saved_output : String <- direct_field(output)
      saved_native : String <- direct_field(native)
      saved_directory : String <- direct_field(directory)
      saved_original_directory : String <- direct_field(original_directory)
      IO.pure(DirectRequest,Saved{saved_id,saved_harness,saved_command,saved_model,saved_effort,saved_workspace,saved_task_path,saved_task,saved_output,saved_native,saved_directory,saved_original_directory})
    case other: IO.die(DirectRequest,22,"Retained direct request fields could not be decoded.")

def direct_pending_sql(session: String, +id: String) -> String:
  "SELECT hex(r.id)||'|'||hex(r.harness)||'|'||hex(r.command)||'|'||hex(r.model)||'|'||hex(r.effort)||'|'||hex(r.workspace)||'|'||hex(r.task_path)||'|'||hex(r.task)||'|'||hex(r.output)||'|'||hex(CASE WHEN e.directory=r.directory THEN r.native WHEN e.directory=r.directory||'.fresh' THEN '' ELSE coalesce(nullif(s.native,''),r.native) END)||'|'||hex(e.directory)||'|'||hex(r.directory) FROM direct_turn_requests r JOIN executions e ON e.id=r.id AND e.session=r.session JOIN sessions s ON s.id=r.session WHERE r.session=" ++ C.q(session) ++ " AND (" ++ C.q(id) ++ "='' OR r.id=" ++ C.q(id) ++ ") AND e.mode='direct' AND (e.phase='starting' OR e.status='setup failed') AND NOT " ++ C.stopped_session_sql("r.session") ++ ";"

def direct_pending_value(value: String, empty: Bool) -> IO(Maybe<DirectRequest>):
  match empty:
    case True{}: IO.pure(Maybe<DirectRequest>,None{})
    case False{}: do IO<Maybe<DirectRequest>>:
      request : DirectRequest <- direct_request_fields(String.split(value,Char.from_u32(124)))
      IO.pure(Maybe<DirectRequest>,Some{request})

def direct_pending_table(+db: String, session: String, id: String, present: Bool) -> IO(Maybe<DirectRequest>):
  match present:
    case False{}: IO.pure(Maybe<DirectRequest>,None{})
    case True{}: do IO<Maybe<DirectRequest>>:
      row : String <- IO.try(String,DB.Sql.read(db,direct_pending_sql(session,id)))
      +value : String <- IO.pure(String,Tx.trim_nl(row))
      direct_pending_value(value,String.is_empty(value))

def direct_pending(+db: String, session: String, id: String) -> IO(Maybe<DirectRequest>):
  do IO<Maybe<DirectRequest>>:
    table : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='direct_turn_requests');"))
    direct_pending_table(db,session,id,String.eq(table,"1\n"))

def direct_resume_dispatch(+db: String, +player: String, request: Maybe<DirectRequest>) -> IO(Result<&1,&1,U32 & String,Maybe<String>>):
  match request:
    case None{}: IO.pure(Result<&1,&1,U32 & String,Maybe<String>>,Done{None{}})
    case Some{Saved{+id,harness,command,model,effort,workspace,task_path,task,output,native,directory,original_directory}}: do IO<Result<&1,&1,U32 & String,Maybe<String>>>:
      executable : String <- IO.try(String,Lock.SessionLock.executable())
      launched : String <- IO.try(String,HostControl.Control.launch(Tx.enc_argv([executable,"--recover-direct",db,player,id,command,model,effort,workspace,output,harness,directory,native]),db,id))
      answer : String <- IO.try(String,DB.Sql.read(db,"SELECT json_object('session'," ++ C.q(player) ++ ",'attempt'," ++ C.q(id) ++ ",'launch',json(" ++ C.q(launched) ++ "),'latestReportId',(SELECT id FROM messages WHERE sender=" ++ C.q(player) ++ " AND kind='report' ORDER BY seq DESC LIMIT 1),'latestReport',(SELECT body FROM messages WHERE sender=" ++ C.q(player) ++ " AND kind='report' ORDER BY seq DESC LIMIT 1));"))
      IO.pure(Result<&1,&1,U32 & String,Maybe<String>>,Done{Some{answer}})

def direct_resume_released(dispatched: Result<&1,&1,U32 & String,Maybe<String>>, released: Result<&1,&1,U32 & String,Unit>) -> IO(Maybe<String>):
  match dispatched:
    case Fail{(+code,cause)}: IO.die(Maybe<String>,code,append_write_error(cause,released))
    case Done{answer}: do IO<Maybe<String>>:
      closed : Unit <- IO.pass(Unit,released)
      IO.pure(Maybe<String>,answer)

def direct_resume_acquired(+db: String, +player: String, lock: Maybe<U32>) -> IO(Maybe<String>):
  match lock:
    case None{}: IO.pure(Maybe<String>,None{})
    case Some{handle}: do IO<Maybe<String>>:
      request : Maybe<DirectRequest> <- direct_pending(db,player,"")
      dispatched : Result<&1,&1,U32 & String,Maybe<String>> <- direct_resume_dispatch(db,player,request)
      released : Result<&1,&1,U32 & String,Unit> <- Lock.SessionLock.release(handle)
      direct_resume_released(dispatched,released)

# Public resume dispatches the saved request; native custody still owns any
# launched attempt. The recovery child acquires the session guard before setup.
def resume_pending_request(db: String, +player: String, request: Maybe<DirectRequest>) -> IO(Maybe<String>):
  match request:
    case None{}: IO.pure(Maybe<String>,None{})
    case Some{saved}: Lock.SessionLock.acquire_session(Maybe<String>,db,player,+database => lock => direct_resume_acquired(database,player,lock))

def resume_pending(+db: String, +player: String) -> IO(Maybe<String>):
  do IO<Maybe<String>>:
    request : Maybe<DirectRequest> <- direct_pending(db,player,"")
    resume_pending_request(db,player,request)

def direct_missing_prompt(db: String, player: String, id: String, directory: String, original_directory: String, cwd: String, +saved: String) -> IO(String):
  do IO<String>:
    prompt : String <- Bool.pick(IO(String),String.eq(directory,original_directory ++ ".fresh"),refused_note(cwd,saved),IO.pure(String,saved))
    direct_task_prompt(db,player,id,prompt)

def direct_saved_prompt(db: String, player: String, id: String, directory: String, original_directory: String, cwd: String, saved: String, read: Result<&1,&1,U32 & String,String>) -> IO(String):
  match read:
    case Done{prompt}: IO.pure(String,prompt)
    case Fail{(+code,cause)}:
      Bool.pick(IO(String),U32.is_eq(code,2),direct_missing_prompt(db,player,id,directory,original_directory,cwd,saved),IO.die(String,code,cause))

def direct_prelaunch_request(+db: String, +player: String, +lock: U32, request: Maybe<DirectRequest>) -> IO(Unit):
  match request:
    case None{}: do IO<Unit>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.die(Unit,2,"The session has no interrupted direct setup to resume; inspect its current execution and input.")
    case Some{Saved{+id,+harness,+command,+model,+effort,+workspace,task_path,+task,+output,+native,+directory,original_directory}}: do IO<Unit>:
      retained : Result<&1,&1,U32 & String,String> <- NativeInitialInput.guidance(db,directory)
      prompt : String <- direct_saved_prompt(db,player,id,directory,original_directory,workspace,task,retained)
      choose(db,player,id,command,model,effort,workspace,task_path,output,native,harness ++ "\n",directory,prompt,lock,False{})

def direct_prelaunch(+db: String, +player: String, id: String) -> IO(Unit):
  do IO<Unit>:
    +database : String <- IO.try(String,Lock.SessionLock.canonical(db))
    handle : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(database,player))
    request : Maybe<DirectRequest> <- direct_pending(database,player,id)
    direct_prelaunch_request(database,player,handle,request)

# The retained owner invokes this entry after the original observer exits. It
# attaches to the same native process and completes the same public turn ID.
def recover_retained(+db: String, +player: String, +id: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +harness: String, +directory: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    +recorded_harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    valid_harness : Unit <- Stop.error_result("Recorded direct recovery harness differs from the current session; preserve the attempt and inspect its manifest.",String.eq(Tx.trim_nl(recorded_harness),harness))
    prompt : String <- IO.try(String,NativeInitialInput.guidance(db,directory))
    +handle : U32 <- IO.try(U32,Custody.Instance.attach(db,directory))
    reconciled : Unit <- Stop.observing(db,player,id,directory)
    observation : Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- retained_output(db,player,id,log,recorded_harness,directory,directory,handle,"unknown")
    direct_first_observed(db,player,id,cmd,model,effort,cwd,"",log,recorded_harness,directory,session,prompt,handle,None{},observation)

def recover_launch(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, log: String, harness: String, directory: String, session: String, launch: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match launch:
    case Done{marker}: recover_retained(db,player,id,cmd,model,effort,cwd,log,harness,directory,session)
    case Fail{(+code,cause)}:
      Bool.pick(IO(Unit),U32.is_eq(code,2),direct_prelaunch(db,player,id),IO.die(Unit,code,cause))

def recover(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, log: String, +harness: String, +directory: String, session: String) -> IO(Unit):
  do IO<Unit>:
    checked : Unit <- direct_recovery_checked(db,player,id,harness,directory)
    launch : Result<&1,&1,U32 & String,String> <- T.Text.read(directory ++ "/launch")
    recover_launch(db,player,id,cmd,model,effort,cwd,log,harness,directory,session,launch)

def run(+db: String, +player: String, id: String, cmd: String, model: String, effort: String, cwd: String, task: String, log: String, session: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{player}))
    Lock.SessionLock.acquire_session(Unit,db,player,
      +database => lock => acquired(database,player,id,cmd,model,effort,cwd,task,log,session,String.is_empty(recorded),lock))


def run_text(+db: String, +player: String, id: String, cmd: String, model: String, effort: String, cwd: String, body: String, log: String, session: String) -> IO(Unit):
  do IO<Unit>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{player}))
    Lock.SessionLock.acquire_session(Unit,db,player,
      +database => lock => acquired_source(database,player,id,cmd,model,effort,cwd,"-",log,session,String.is_empty(recorded),lock,Some{body}))
