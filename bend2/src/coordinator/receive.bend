import Base
import ./commands.bend as C
import ./store.bend as Store
import ./stop.bend as Stop
import ./turn.bend as Turn
import ./native-requests.bend as NativeRequests
import ./delivery.bend as Delivery
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../host/process.bend as P
import ../git/text.bend as Tx
import ../host/text.bend as Text

def field(+db: String, session: String, name: String, +supplied: String) -> IO(String):
  do IO<String>:
    value : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(supplied) ++ "<>'' THEN " ++ C.q(supplied) ++ " ELSE " ++ name ++ " END FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    IO.pure(String,Tx.trim_nl(value))

def shell_chars(value: String) -> String:
  match value:
    case SNil{}: ""
    case SCon{+char,rest}: Bool.pick(String,Char.is_eq(char,Char.from_u32(39)),"'\\''",SCon{char,SNil{}}) ++ shell_chars(rest)

def shell(value: String) -> String:
  "'" ++ shell_chars(value) ++ "'"

def inspection_cli(+command: String, +session: String) -> String:
  "  " ++ command ++ " inbox " ++ shell(session) ++ " --index\n"
  ++ "  " ++ command ++ " inbox " ++ shell(session) ++ " --index --sender PLAYER --kind report --state all\n"
  ++ "  " ++ command ++ " delivery MESSAGE_ID\n"
  ++ "  " ++ command ++ " orchestra --index --for " ++ shell(session) ++ " --pretty\n"

law inspection_examples_scope_metadata_to_the_recorded_session:
  for +command: String
  for +session: String
  {inspection_cli(command,session) == ("  " ++ command ++ " inbox " ++ shell(session) ++ " --index\n"
    ++ "  " ++ command ++ " inbox " ++ shell(session) ++ " --index --sender PLAYER --kind report --state all\n"
    ++ "  " ++ command ++ " delivery MESSAGE_ID\n"
    ++ "  " ++ command ++ " orchestra --index --for " ++ shell(session) ++ " --pretty\n") : String}

def inspection_examples_scope_metadata_to_the_recorded_session(command,session):
  {==}

def instructions(executable: String, database: String, +session: String) -> String:
  +command = shell(executable) ++ " " ++ shell(database)
  "You are session " ++ session ++ " in a Baton2 Orchestra. A Player is an individual agent. Review pending messages and follow your task.\n"
  ++ "The Principal Conductor is the main orchestrator. An Associate Conductor is a sub-orchestrator. An Ensemble is a coordinated team of agents. A Section is a capability-specific subgroup. The Orchestra is the whole coordinated system. When coordinating players, direct their work according to your task.\n"
  ++ "The players command lists all Players, including Principal and Associate Conductors. PLAYER denotes a player session ID.\n"
  ++ "Public messages follow assigned roles, parent links and explicit tight Ensemble membership. A Conductor can message its descendants; report and ask reach your immediate parent. Peer messages require a shared tight Ensemble; Conductor peers must have equal hierarchy depth.\n"
  ++ "Coordinator CLI: inspect message metadata first, then retrieve the selected complete body.\n" ++ inspection_cli(command,session)
  ++ "Index filters combine by exact sender/kind equality. State defaults to pending; --state all also includes acknowledged messages. pending --index selects across recipients and accepts --recipient SESSION. Index reads do not acknowledge input; receipt state records acknowledgment, not review or completed work. Legacy inbox/pending/players/turns/orchestra readers include full bodies or histories; use them when that payload is needed.\n"
  ++ "  " ++ command ++ " ack MESSAGE_ID " ++ shell(session) ++ " RECEIPT\n"
  ++ "Acknowledge each message after reading and accepting it.\n  " ++ command ++ " session ID\n  " ++ command ++ " worktree ID\n  " ++ command ++ " turns ID\n"
  ++ "  " ++ command ++ " recruit PLAYER " ++ shell(session) ++ " HARNESS MODEL EFFORT REPO BRANCH PATH BASE\n"
  ++ "  " ++ command ++ " receiver PLAYER HARNESS_CMD OUTPUT_LOG\n  " ++ command ++ " dispatch-file ID " ++ shell(session) ++ " PLAYER task TASK_FILE\n"
  ++ "  " ++ command ++ " dispatch-turn PLAYER TURN_ID HARNESS_CMD OUTPUT_LOG TASK_FILE\n  " ++ command ++ " status --pretty\n"
  ++ "  " ++ command ++ " message ID " ++ shell(session) ++ " PLAYER guidance BODY\n  " ++ command ++ " land-checked PLAYER REPO TARGET CHECK FILES\n"
  ++ "  " ++ command ++ " role SESSION\n  " ++ command ++ " role SESSION player|principal-conductor|associate-conductor|operator\n  " ++ command ++ " ensemble ENSEMBLE\n  " ++ command ++ " ensemble ENSEMBLE OWNER [loose|tight]\n  " ++ command ++ " ensemble-member ENSEMBLE OWNER PLAYER add|remove\n  " ++ command ++ " section ENSEMBLE SECTION [OWNER CAPABILITY]\n  " ++ command ++ " section-member ENSEMBLE SECTION OWNER PLAYER add|remove\n"
  ++ "  " ++ command ++ " native-reply " ++ shell(session) ++ " REQUEST RESPONSE_JSON\n  " ++ command ++ " native-reply-file " ++ shell(session) ++ " REQUEST PATH\n"
  ++ "  " ++ command ++ " record FINDING_ID " ++ shell(session) ++ " CLAIM message:MESSAGE_ID LIMITS\n  " ++ command ++ " knowledge " ++ shell(session) ++ "\n"
  ++ "  " ++ command ++ " promote PROMOTION_ID " ++ shell(session) ++ " SOURCE " ++ shell(session) ++ " FINDING_ID\n"
  ++ "Author findings from reviewed evidence. Cite an existing retained message you sent or received and state the claim's limits. knowledge lists every finding visible to your session, with its cited evidence and promotion history. Review a finding before explicitly promoting it from its recorded SOURCE into your own scope; its original author remains recorded. A promotion notice names a finding shared into your scope. Retrieve it with knowledge, review its evidence and decide which players should receive a message about it.\n"
  ++ "Run coordinator operations through these CLI commands. Use receiver then dispatch-file for Codex and OMP Players. Use dispatch-turn for Muse and Claude Players. Dispatch returns the launched delivery PID; inspect turns, inbox and output logs for completion. These commands take identity and workspace from the recorded assignment and apply configured model Git identities. Dispatch independent Players concurrently and finish your native turn so their reports can continue your session.\n\n"

def receive_status(db: String, session: String, status: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(session) ++ ",'status'," ++ C.q(status) ++ ");"))
    Text.Text.control_output(result)

def exit_status(failed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match failed:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(1,"Native receive failed; read the retained native log and pending inbox.")})

def outcome_failed(db: String, outcome: Turn.Outcome) -> IO(Bool):
  match outcome:
    case Turn.Ended{+status,+event,+error}: do IO<Bool>:
      failure : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN " ++ C.q(event) ++ "='' THEN 1 ELSE coalesce(json_extract(" ++ C.q(event) ++ ",'$.is_error'),0) END;"))
      IO.pure(Bool,Bool.or(Turn.failed(status,event,error),String.eq(failure,"1\n")))

def continue_if(again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), present: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case True{}: again(Unit{})

# How much input is still owed after the cursor. Busy writers have committed
# before trying the lock, so the owner reads this again after releasing it.
def pending_count_sql(+session: String, cursor: String) -> String:
  "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"

def continue_pending(db: String, session: String, cursor: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    pending : String <- IO.try(String,DB.Sql.query(db,pending_count_sql(session,cursor)))
    continue_if(again,Bool.not(String.eq(pending,"0\n")))

def release_observer(lock: Maybe<U32>) -> IO(Unit):
  match lock:
    case None{}: IO.pure(Unit,Unit{})
    case Some{handle}: IO.try(Unit,Lock.SessionLock.release(handle))

# The queued continuation runs beside this attempt's own finish: the parent
# delivery, native-request settle and attempt acknowledge join before the
# continuation does, so a completed attempt releases while later work runs.
# The acknowledge callback returns its Result as a value. An acknowledge
# failure returns through that Result; the queued continuation is joined and
# the failure is part of the combined outcome.
def finish_pending(+db: String, +session: String, id: String, log: String, cursor: String, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), acknowledge: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    failed : Bool <- outcome_failed(db,outcome)
    delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Turn.finish(db,session,id,log,outcome))
    continued_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,continue_pending(db,session,cursor,again))
    finished : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    ack : Result<&1,&1,U32 & String,Unit> <- acknowledge(Unit{})
    status : Result<&1,&1,U32 & String,Unit> <- exit_status(failed)
    next : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,continued_task)
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(finished,Turn.combine(questions,Turn.combine(next,Turn.combine(ack,status)))))

def completed(+db: String, +session: String, +id: String, +log: String, stderr: String, cursor: String, +handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    prepared : Unit <- Turn.prepare(db,session,id,log,stderr,outcome)
    observer_released : Unit <- release_observer(lock)
    native_released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
    finish_pending(db,session,id,log,cursor,outcome,deliveries,again,u => P.ProcessChild.acknowledge(handle))

# The recovery input records the workspace state and makes clearing the refused
# identity atomic. Replaying the old attempt preserves a later native identity.
def recovery_input(db: String, +session: String, +id: String, native: String, note: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;"
      ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":recovery-input") ++ ",id,id,'recovery'," ++ C.q(note) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND native=" ++ C.q(native) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"
      ++ "UPDATE sessions SET native='' WHERE id=" ++ C.q(session) ++ " AND changes()=1;"
      ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":recovery") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q("The recorded conversation could not be resumed; pending input will continue in a fresh conversation with the workspace's current state.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");COMMIT;"))
    IO.pure(Unit,Unit{})

def record_recovery(db: String, session: String, id: String, native: String, cwd: String, recorded: Bool) -> IO(Unit):
  match recorded:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      note : String <- Turn.refused_note(cwd,"")
      recovery_input(db,session,id,native,note)

def restart_pending(+db: String, +session: String, +id: String, native: String, cwd: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");"))
    saved : Unit <- record_recovery(db,session,id,native,cwd,String.eq(recorded,"1\n"))
    observer_released : Unit <- release_observer(lock)
    native_released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
    delivery_task : Chan(Result<&1,&1,U32 & String,String>) <- IO.fork(Result<&1,&1,U32 & String,String>,Delivery.deliver(db,id ++ ":recovery","1",""))
    next : Result<&1,&1,U32 & String,Unit> <- again(Unit{})
    delivered : Result<&1,&1,U32 & String,String> <- IO.join(Result<&1,&1,U32 & String,String>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Delivery.wake_result(delivered),Turn.combine(questions,next)))

def complete_or_restart(db: String, session: String, id: String, log: String, stderr: String, cursor: String, native: String, cwd: String, handle: U32, lock: Maybe<U32>, outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), gone: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match gone:
    case False{}: completed(db,session,id,log,stderr,cursor,handle,lock,outcome,deliveries,again)
    case True{}: restart_pending(db,session,id,native,cwd,handle,lock,deliveries,again)

def observed(+db: String, +session: String, +id: String, +log: String, cursor: String, +native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    exited : Unit <- Turn.record_exit(db,session,id,log,outcome)
    closed : Bool <- Stop.stopped(db,session)
    gone : Bool <- Turn.refusal(attempt ++ "/native",Bool.not(String.is_empty(native)),outcome)
    complete_or_restart(db,session,id,log,attempt ++ "/native.stderr",cursor,native,cwd,handle,lock,outcome,deliveries,again,Bool.and(gone,Bool.not(closed)))

def reconciled_cursor(cursor: String, adopted: Bool, outcome: Turn.Outcome) -> String:
  match adopted:
    case False{}: cursor
    case True{}: match outcome:
      case Turn.Ended{status,event,error}:
        Bool.pick(String,Bool.and(String.eq(status,"unknown after keeper loss"),Bool.and(String.is_empty(event),String.is_empty(error))),"0",cursor)

def observed_output(db: String, session: String, id: String, log: String, cursor: String, native: String, cwd: String, attempt: String, handle: U32, lock: Maybe<U32>, observation: Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  (outcome,deliveries)=observation
  +current=outcome
  observed(db,session,id,log,reconciled_cursor(cursor,adopted,current),native,cwd,attempt,handle,lock,current,deliveries,again)

def started(+db: String, +session: String, +id: String, +log: String, cursor: String, native: String, cwd: String, +attempt: String, harness: String, lock: U32, start: P.RetainedStart, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match start:
    case P.Retained{+handle}: do IO<Result<&1,&1,U32 & String,Unit>>:
      reconciled : Unit <- Stop.started(db,session,id,attempt)
      observation : Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- Turn.retained_output(db,session,id,log,harness,attempt,handle)
      observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,Some{lock},observation,again,False{})
    case P.Unstarted{error}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +outcome : Turn.Outcome <- IO.pure(Turn.Outcome,Turn.Ended{"start failed","","Player process could not start: " ++ error})
      exited : Unit <- Turn.record_exit(db,session,id,log,outcome)
      prepared : Unit <- Turn.prepare(db,session,id,log,attempt ++ "/native.stderr",outcome)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      finish_pending(db,session,id,log,cursor,outcome,Nil{},again,u => IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}))

def start_admitted(+db: String, +session: String, +id: String, cmd: String, route: String, thinking: String, +workspace: String, +log: String, +lock: U32, cursor: String, +native: String, +attempt: String, +harness: String, storage: String, prompt: String, recovery: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), allowed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match allowed:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      start : P.RetainedStart <- IO.try(P.RetainedStart,Turn.retained(db,session,attempt,cmd,route,thinking,workspace,native,harness,storage,prompt,lock,recovery))
      started(db,session,id,log,cursor,native,workspace,attempt,harness,lock,start,again)

def selected(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, +lock: U32, +cursor: String, present: Bool, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match present:
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
      empty : Result<&1,&1,U32 & String,Unit> <- receive_status(db,session,"empty")
      continue_pending(db,session,cursor,again)
    case True{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +executable : String <- IO.try(String,Lock.SessionLock.executable())
      +harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      supported : Unit <- Turn.supported_harness(Bool.or(String.eq(harness,"omp\n"),String.eq(harness,"codex\n")))
      +native : String <- field(db,session,"native","")
      +route : String <- field(db,session,"model",model)
      +thinking : String <- field(db,session,"effort",effort)
      +workspace : String <- field(db,session,"workspace",cwd)
      storage : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN parent IS NULL THEN " ++ C.q(db ++ ".root-sessions") ++ " ELSE " ++ C.q(db ++ ".session-") ++ " || lower(hex(id)) END FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
      ident : String <- IO.try(String,DB.Sql.query(db,"SELECT 'receive:' || " ++ C.q(session) ++ " || ':' || CAST(" ++ C.q(cursor) ++ " AS INTEGER) || ':' || lower(hex(randomblob(16)));"))
      +id : String <- IO.pure(String,Tx.trim_nl(ident))
      body : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(group_concat(body,char(10)||char(10)), '') FROM (SELECT 'Message (' || kind || ') from ' || sender || ' [id: ' || id || ']:' || char(10) || body AS body FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq<=CAST(" ++ C.q(cursor) ++ " AS INTEGER) ORDER BY seq);"))
      directory : String <- IO.try(String,DB.Sql.query(db,"SELECT " ++ C.q(db ++ ".attempt-") ++ " || lower(hex(" ++ C.q(id) ++ "));"))
      +attempt : String <- IO.pure(String,Tx.trim_nl(directory))
      recovery : String <- IO.pure(String,P.argv([executable,"--recover-receive",db,session,id,cursor,cmd,route,thinking,workspace,log,harness,attempt,native]))
      allowed : Bool <- Stop.admit(db,session,id,"retained",attempt)
      start_admitted(db,session,id,cmd,route,thinking,workspace,log,lock,cursor,native,attempt,harness,Tx.trim_nl(storage),instructions(executable,db,session) ++ body,recovery,again,allowed)

def acquired_pending(+db: String, +session: String, cmd: String, model: String, effort: String, cwd: String, log: String, lock: U32, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +cursor : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(max(seq),0) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL;"))
    selected(db,session,cmd,model,effort,cwd,log,lock,cursor,Bool.not(String.eq(cursor,"0\n")),again)

def observe_guarded(+db: String, +session: String, +id: String, cursor: String, cmd: String, model: String, effort: String, +cwd: String, +log: String, harness: String, +directory: String, native: String, +handle: U32, lock: Maybe<U32>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    reconciled : Unit <- Stop.reconcile(db,session,id,directory)
    observation : Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- Turn.retained_output(db,session,id,log,harness,directory,handle)
    observed_output(db,session,id,log,cursor,native,cwd,directory,handle,lock,observation,again,adopted)

def recover_owned(+db: String, +session: String, +directory: String, +lock: U32, args: List<&2,String>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match args:
    case executable <> flag <> saved_db <> saved_session <> id <> cursor <> cmd <> model <> effort <> cwd <> log <> harness <> saved_directory <> native <> Nil{}:
      do IO<Result<&1,&1,U32 & String,Unit>>:
        valid : Unit <- Stop.error_result("Recorded native recovery arguments differ from the current session; retain the attempt and inspect its manifest.",Bool.and(String.eq(flag,"--recover-receive"),Bool.and(String.eq(db,saved_db),Bool.and(String.eq(session,saved_session),String.eq(directory,saved_directory)))))
        handle : U32 <- IO.try(U32,P.ProcessChild.attach_owned(directory,lock))
        observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,Some{lock},again,True{})
    case other: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Recorded native recovery arguments are invalid; retain the attempt and inspect its manifest.")})

def acquired_attempt(db: String, session: String, cmd: String, model: String, effort: String, cwd: String, log: String, lock: U32, directory: String, recovery: Maybe<String>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match recovery:
    case None{}: acquired_pending(db,session,cmd,model,effort,cwd,log,lock,again)
    case Some{args}: recover_owned(db,session,directory,lock,String.split(args,Char.from_u32(0)),again)

# The canonical guard owner resolves the current durable attempt before admission.
def acquired_recorded(+db: String, +session: String, cmd: String, model: String, effort: String, cwd: String, log: String, +lock: U32, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +directory : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='retained'),'');"))
    +attempt : String <- IO.pure(String,Tx.trim_nl(directory))
    recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.recovery_argv(attempt))
    acquired_attempt(db,session,cmd,model,effort,cwd,log,lock,attempt,recovery,again)

def acquired(db: String, session: String, cmd: String, model: String, effort: String, cwd: String, log: String, result: Maybe<U32>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  match result:
    case None{}: receive_status(db,session,"queued")
    case Some{lock}: acquired_recorded(db,session,cmd,model,effort,cwd,log,lock,again)

def registered(exists: Bool) -> IO(Unit):
  match exists:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: IO.die(Unit,2,"Session is not registered; attach a conductor or recruit a player before receiving messages.")

def available(+db: String, +session: String, cmd: String, model: String, effort: String, cwd: String, log: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), closed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match closed:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})
    case False{}: Lock.SessionLock.acquire_session(Result<&1,&1,U32 & String,Unit>,db,session,
      +database => lock => acquired(database,session,cmd,model,effort,cwd,log,lock,again))

# MESSAGE_ID names the wake. The lock owner reads all pending inputs together.
@unsafe
def run(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, message: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{session}))
    exists : Unit <- registered(Bool.not(String.is_empty(recorded)))
    closed : Bool <- Stop.stopped(db,session)
    available(db,session,cmd,model,effort,cwd,log,u => run(db,session,cmd,model,effort,cwd,log,""),closed)

def attach_recorded(directory: String, next: @+handle: U32 -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    handle : U32 <- IO.try(U32,P.ProcessChild.attach(directory))
    next(handle)

def observe_attached(+db: String, +session: String, id: String, cursor: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, harness: String, directory: String, native: String, +handle: U32, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,None{},again,False{})

# The keeper invokes this with the original attempt and inbox cutoff after the
# observer exits. Attachment never launches a native process or sends its prompt.
def recover(+db: String, +session: String, id: String, cursor: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String, harness: String, +directory: String, native: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  attach_recorded(directory,handle => observe_attached(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,u => run(db,session,cmd,model,effort,cwd,log,"")))
