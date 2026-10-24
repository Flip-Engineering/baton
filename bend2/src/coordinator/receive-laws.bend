# M-8 exclusive-claim application obligations for native receive (#625, #656).
# For a canonical coordinator database and session, native admission holds
# the session guard and resolves its current durable attempt before launching.
# An unreleased attempt is observed through its recorded recovery arguments.
# Completion is prepared before either observer or process custody is released.
# The compiler verifies these branches and their order over real receive code.
# Host flock custody, kernel birth/lifetime observations and retained stdout
# remain runtime obligations witnessed by controlled and native measurements.
# The M-17 laws below constrain the recovery sequencing of the native receive
# path: the branch a not-refused and a refused recorded conversation each take,
# the order in which the recovery input is recorded, the observer and the native
# process are released and the wake is delivered, and the one guarded
# transaction that writes the workspace note. These equations prove neither
# process liveness nor that a replacement identity exists. SQLite's own
# transaction and changes() semantics remain a host obligation witnessed by the
# receive tests.
import Base
import ./receive.bend as Receive
import ./accounts.bend as Accounts
import ./usage-windows.bend as UW
import ./stop.bend as Stop
import ../host/process.bend as P
import ../host/instance.bend as Custody
import ../host/session-lock.bend as Lock
import ./turn.bend as Turn
import ./subscription-fallback.bend as Subs
import ./control.bend as Control
import ./delivery.bend as Delivery
import ./native-requests.bend as NativeRequests
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../host/text.bend as Text
import ../storage/lifecycle.bend as Storage
import ./store.bend as Store
import ./control.bend as Control
import ./usage-windows.bend as UW

law direct_replay_keeps_output_failure_for_completion:
  for +db: String
  for +player: String
  for +id: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +task: String
  for log: String
  for session: String
  for harness: String
  for directory: String
  for prompt: String
  for +lock: U32
  {Turn.choose(db,player,id,cmd,model,effort,cwd,task,log,session,harness,directory,prompt,lock,True{}) == (do IO<Unit>:
    receiver : Unit <- Control.default_receiver(db,player,cmd,model,effort,cwd,log)
    +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
    written : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output(saved)
    Turn.direct_replay_finished(db,player,lock,written)) : IO(Unit)}

def direct_replay_keeps_output_failure_for_completion(db,player,id,cmd,model,effort,cwd,task,log,session,harness,directory,prompt,lock):
  {==}

law failed_replay_releases_and_wakes_before_reporting_output_error:
  for db: String
  for player: String
  for lock: U32
  for -output: Result<&1,&1,U32 & String,Unit>
  {Turn.replay_finished(db,player,lock,output) == (do IO<Unit>:
    released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
    wake : Result<&1,&1,U32 & String,Unit> <- Delivery.wake_pending(db,player,"0")
    IO.pass(Unit,Turn.combine(output,wake))) : IO(Unit)}

def failed_replay_releases_and_wakes_before_reporting_output_error(db,player,lock,output):
  {==}

law failed_replay_output_reaches_the_completion_boundary:
  for db: String
  for player: String
  for id: String
  for log: String
  for lock: U32
  for -error: U32 & String
  {Turn.complete_locked(db,player,id,log,lock,Fail{error}) == Turn.replay_finished(db,player,lock,Fail{error}) : IO(Unit)}

def failed_replay_output_reaches_the_completion_boundary(db,player,id,log,lock,error):
  {==}

law replay_output_failure_is_preserved:
  for -error: U32 & String
  {Turn.replay_result(Fail{error}) == Fail{error} : Result<&1,&1,U32 & String,Maybe<Turn.Outcome>>}

def replay_output_failure_is_preserved(error):
  {==}

# Completion output returns its failure through the finish result. The caller
# joins queued work before it reports that result. The host write is tested
# with a pipe whose reader closes after both completion branches start.
law completion_output_preserves_delivery_errors_and_returns_write_failure:
  for +db: String
  for +player: String
  for +id: String
  {Turn.player_finished(db,player,id,False{},True{},"") == (do IO<Result<&1,&1,U32 & String,Unit>>:
    +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
    exit_id : String <- Bool.pick(IO(String),True{},Subs.exit_report_id(db,player,id,""),IO.pure(String,id ++ ":exit"))
    diagnostic_delivery : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id ++ ":observation","1","")
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id,"1",saved)
    exit_delivery : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,exit_id,"1","")
    stopped : Result<&1,&1,U32 & String,Unit> <- Stop.deliver(db,player,id)
    written : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output(saved)
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Turn.delivery_result(Turn.remember(Turn.remember(Turn.remember("",diagnostic_delivery),delivered),exit_delivery)),Turn.combine(stopped,written)))) : IO(Result<&1,&1,U32 & String,Unit>)}

def completion_output_preserves_delivery_errors_and_returns_write_failure(db,player,id):
  {==}

law completion_without_parent_returns_output_failure:
  for +db: String
  for +player: String
  for id: String
  for log: String
  for +status: String
  for +event: String
  for error: String
  {Turn.finish_parent(db,player,id,log,Turn.Ended{status,event,error,False{}},False{},False{}) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    output : String <- IO.try(String,DB.Sql.query(db,"WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) SELECT json_object('session'," ++ C.q(player) ++ ",'status'," ++ C.q(status) ++ ",'event',CASE WHEN value='' THEN NULL ELSE json(value) END,'error'," ++ C.q(error) ++ ") FROM frame;"))
    Text.Text.control_output(output)) : IO(Result<&1,&1,U32 & String,Unit>)}

def completion_without_parent_returns_output_failure(db,player,id,log,status,event,error):
  {==}

law receive_status_returns_output_failure:
  for +db: String
  for +session: String
  for +status: String
  {Receive.receive_status(db,session,status) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    result : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(session) ++ ",'status'," ++ C.q(status) ++ ");"))
    Text.Text.control_output(result)) : IO(Result<&1,&1,U32 & String,Unit>)}

def receive_status_returns_output_failure(db,session,status):
  {==}

# A busy session admits nothing; the invocation result reports none.
law busy_receive_defers_to_the_invocation_result:
  for +db: String
  for +session: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for log: String
  for again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for predecessor: String
  for -updates: Chan(String)
  {Receive.acquired(db,session,cmd,model,effort,cwd,log,None{},again,predecessor,updates) == Receive.receive_silent("queued") : IO(Result<&1,&1,U32 & String,Unit>)}

def busy_receive_defers_to_the_invocation_result(db,session,cmd,model,effort,cwd,log,again,predecessor,updates):
  {==}

# The recovery attachment boundary opens the supplied attempt directory and
# passes the returned handle to its continuation. Receive.recover supplies its
# retained-output observation continuation.
# The attach result carries its own code and detail, so a failed attach is
# returned through Receive.attach_handle and a SQLITE_BUSY attach is recorded
# as a typed cause.
def attached_recovery(+db: String, +directory: String, +log: String, next: @+handle: U32 -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  Storage.with_writer_leases(Result<&1,&1,U32 & String,Unit>, log, directory,
    error => IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error}),
    unit => do IO<Result<&1,&1,U32 & String,Unit>>:
      attached : Result<&1,&1,U32 & String,U32> <- Custody.Instance.attach(db,directory)
      Receive.attach_handle(attached, next))

law recovery_attaches_recorded_attempt:
  for +db: String
  for +directory: String
  for +log: String
  for -next: @+handle: U32 -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.attach_recorded(db,directory,log,next) == attached_recovery(db,directory,log,next) : IO(Result<&1,&1,U32 & String,Unit>)}

def recovery_attaches_recorded_attempt(db,directory,log,next):
  {==}

# Both native entry paths use this acquisition helper. Its continuation receives
# the canonical database and exact lock result for the supplied session.
def canonical_session_admission(-A: Type, database: String, session: String, next: @+canonical: String -> Maybe<U32> -> IO(A)) -> IO(A):
  do IO<A>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(database))
    lock : Maybe<U32> <- IO.try(Maybe<U32>,Lock.SessionLock.try_acquire(canonical,session))
    next(canonical,lock)

law session_admission_uses_canonical_identity:
  for -A: Type
  for +database: String
  for +session: String
  for -next: @+canonical: String -> Maybe<U32> -> IO(A)
  {Lock.SessionLock.acquire_session(A,database,session,next) == canonical_session_admission(A,database,session,next) : IO(A)}

def session_admission_uses_canonical_identity(A,database,session,next):
  {==}

# ---------------------------------------------------------------------------
# M-17: a receive whose recorded conversation is not refused completes the
# attempt; a receive whose recorded conversation is refused dispatches to the
# restart branch; the restart records the recovery input and clears the refused
# native identity before the observer release and the wake; the fresh
# replacement identity is recorded later by its caller. These equations prove
# neither process liveness nor that a replacement identity exists.

# M-17: the branch taken when the recorded conversation is not refused
# (gone = False, which includes a turn that failed) completes the attempt and
# records no recovery.
law m17_not_refused_conversation_completes_the_attempt:
  for +db: String
  for +session: String
  for +id: String
  for +log: String
  for +stderr: String
  for attempt: String
  for +cursor: String
  for native: String
  for cwd: String
  for +handle: U32
  for -lock: Maybe<U32>
  for +outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.complete_or_restart(db,session,id,log,stderr,attempt,cursor,native,cwd,handle,lock,outcome,deliveries,again,False{},False{}) == Receive.completed(db,session,id,log,attempt,stderr,cursor,handle,lock,outcome,deliveries,again,False{}) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_not_refused_conversation_completes_the_attempt(db,session,id,log,stderr,attempt,cursor,native,cwd,handle,lock,outcome,deliveries,again):
  {==}

# M-17: the branch taken when the recorded conversation is refused (gone =
# True) restarts, naming the attempt's own native identity and workspace.
law m17_refused_conversation_restarts_the_attempt:
  for +db: String
  for +session: String
  for +id: String
  for log: String
  for stderr: String
  for attempt: String
  for +cursor: String
  for native: String
  for cwd: String
  for +handle: U32
  for -lock: Maybe<U32>
  for outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.complete_or_restart(db,session,id,log,stderr,attempt,cursor,native,cwd,handle,lock,outcome,deliveries,again,True{},False{}) == Receive.restart_pending(db,session,id,attempt,cursor,native,cwd,handle,lock,deliveries,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_refused_conversation_restarts_the_attempt(db,session,id,log,stderr,attempt,cursor,native,cwd,handle,lock,outcome,deliveries,again):
  {==}

# M-17: the receive entry's own dispatch. The branch argument is the refusal
# predicate Turn.refusal(attempt ++ "/native",
# Bool.not(String.is_empty(native)), outcome) while the session remains open.
# The exit and terminal stop are recorded before dispatch. The stderr path handed to
# the branches is the derived attempt ++ "/native.stderr". The written-out
# dispatch below is the whole obligation: reading a different predicate, or
# passing the undecorated attempt, breaks this proof.
def observed_dispatch(+db: String, +session: String, +id: String, +log: String, cursor: String, +native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    exited : Unit <- Turn.record_exit(db,session,id,log,outcome)
    closed : Bool <- Stop.stopped(db,session)
    gone : Bool <- Turn.refusal(attempt ++ "/native.stderr", Bool.not(String.is_empty(native)), outcome)
    retained : Bool = Bool.and(Bool.not(Receive.native_observation_failed(outcome)),Bool.and(gone,Bool.not(closed)))
    Receive.complete_or_restart(db,session,id,log,attempt ++ "/native.stderr",attempt,cursor,native,cwd,handle,lock,outcome,deliveries,again,retained,superseded)

law m17_the_observed_dispatch_is_the_refusal_it_read:
  for +db: String
  for +session: String
  for +id: String
  for +log: String
  for +cursor: String
  for +native: String
  for +cwd: String
  for +attempt: String
  for +handle: U32
  for -lock: Maybe<U32>
  for +outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for superseded: Bool
  {Receive.observed(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,superseded) == observed_dispatch(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,superseded) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_the_observed_dispatch_is_the_refusal_it_read(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,superseded):
  {==}

# M-17: the restart reads the recovery-input row, records the recovery, and
# only then releases the observer and the native process, delivers the wake
# and settles question deliveries before acknowledging and retiring it. The
# written-out order is the whole obligation: a reordering of any two steps
# breaks this proof.
def restart_records_before_releasing_and_waking(+db: String, +session: String, +id: String, +attempt: String, +cursor: String, native: String, cwd: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");"))
    saved : Unit <- Receive.record_recovery(db,session,id,native,cwd,String.eq(recorded,"1\n"))
    observer_released : Unit <- Receive.release_observer(lock)
    native_released : Unit <- Receive.release_native(db,handle)
    delivery_task : Chan(Result<&1,&1,U32 & String,String>) <- IO.fork(Result<&1,&1,U32 & String,String>,Delivery.deliver(db,id ++ ":recovery","1",""))
    next : Result<&1,&1,U32 & String,Unit> <- again(attempt)
    woken : Result<&1,&1,U32 & String,Unit> <- Receive.wake_due(db,session,cursor,launch => Receive.wake_launch(db,launch))
    delivered : Result<&1,&1,U32 & String,String> <- IO.join(Result<&1,&1,U32 & String,String>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
    cleaned : Unit <- Store.delete_ticket(db,session,attempt)
    retired : Unit <- IO.try(Unit,Custody.Instance.retire(handle))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Delivery.wake_result(delivered),Turn.combine(questions,Turn.combine(next,woken))))

law m17_restart_records_before_releasing_and_waking:
  for +db: String
  for +session: String
  for +id: String
  for +attempt: String
  for +cursor: String
  for +native: String
  for +cwd: String
  for +handle: U32
  for -lock: Maybe<U32>
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.restart_pending(db,session,id,attempt,cursor,native,cwd,handle,lock,deliveries,again) == restart_records_before_releasing_and_waking(db,session,id,attempt,cursor,native,cwd,handle,lock,deliveries,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_restart_records_before_releasing_and_waking(db,session,id,attempt,cursor,native,cwd,handle,lock,deliveries,again):
  {==}


# M-17: a recovery-input row already recorded writes nothing, so a replayed
# attempt leaves the session's recorded identity as it stands.
law m17_recorded_recovery_writes_nothing:
  for db: String
  for session: String
  for id: String
  for native: String
  for cwd: String
  {Receive.record_recovery(db,session,id,native,cwd,True{}) == IO.pure(Unit,Unit{}) : IO(Unit)}

def m17_recorded_recovery_writes_nothing(db,session,id,native,cwd):
  {==}

# M-17: an unrecorded recovery writes the workspace note Turn.refused_note
# builds and hands it, and nothing else, to the recovery input.
def unrecorded_recovery_writes_the_workspace_note(db: String, session: String, id: String, native: String, cwd: String) -> IO(Unit):
  do IO<Unit>:
    note : String <- Turn.refused_note(cwd,"")
    Receive.recovery_input(db,session,id,native,note)

law m17_unrecorded_recovery_writes_the_workspace_note:
  for db: String
  for session: String
  for id: String
  for native: String
  for cwd: String
  {Receive.record_recovery(db,session,id,native,cwd,False{}) == unrecorded_recovery_writes_the_workspace_note(db,session,id,native,cwd) : IO(Unit)}

def m17_unrecorded_recovery_writes_the_workspace_note(db,session,id,native,cwd):
  {==}

# M-17: the recovery input is one guarded transaction. This law pins the
# statements the function builds: the INSERT OR IGNORE that records the
# workspace note for the session whose recorded native is this attempt's, the
# clear of that native only where changes()=1, the parent report only where the
# recovery-input row exists, and the COMMIT. SQLite's own transaction and
# changes() semantics remain a host assumption witnessed by the receive tests.
def recovery_input_transaction(db: String, +session: String, +id: String, native: String, note: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;"
      ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":recovery-input") ++ ",id,id,'recovery'," ++ C.q(note) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND native=" ++ C.q(native) ++ " AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ ";"
      ++ "UPDATE sessions SET native='' WHERE id=" ++ C.q(session) ++ " AND changes()=1;"
      ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":recovery") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q("The recorded conversation could not be resumed; pending input will continue in a fresh conversation with the workspace's current state.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");COMMIT;"))
    IO.pure(Unit,Unit{})

law m17_recovery_input_is_one_guarded_transaction:
  for +db: String
  for +session: String
  for +id: String
  for +native: String
  for +note: String
  {Receive.recovery_input(db,session,id,native,note) == recovery_input_transaction(db,session,id,native,note) : IO(Unit)}

def m17_recovery_input_is_one_guarded_transaction(db,session,id,native,note):
  {==}


def acquired_recorded_with_setup(+db: String, +session: String, cmd: String, model: String, effort: String, cwd: String, log: String, +lock: U32, predecessor: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>), +updates: Chan(String)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    ensured : Unit <- Store.ensure_before_begin(db)
    Receive.acquired_recorded(db,session,lock,again,continuation => Receive.acquired_pending(db,session,cmd,model,effort,cwd,log,lock,continuation,predecessor,updates))
# M-8: one owner resolves the durable attempt before admitting another native.
law acquired_native_owner_resolves_recorded_attempt:
  for db: String
  for session: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for log: String
  for lock: U32
  for predecessor: String
  for again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for -updates: Chan(String)
  {Receive.acquired(db,session,cmd,model,effort,cwd,log,Some{lock},again,predecessor,updates) == acquired_recorded_with_setup(db,session,cmd,model,effort,cwd,log,lock,predecessor,again,updates) : IO(Result<&1,&1,U32 & String,Unit>)}


def acquired_native_owner_resolves_recorded_attempt(db,session,cmd,model,effort,cwd,log,lock,predecessor,again,updates):
  {==}

# M-8: the canonical guard owner reads its current durable attempt and only then
# runs the pending admission continuation. The acquired attempt retains the
# supplied lock while its recorded recovery arguments are used.
def recorded_attempt_before_pending(+db: String, +session: String, +lock: U32, again: String -> IO(Result<&1,&1,U32 & String,Unit>), pending: (String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +directory : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='retained'),'');"))
    +attempt : String <- IO.pure(String,Tx.trim_nl(directory))
    recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.recovery_argv(attempt))
    Receive.acquired_attempt(db,session,lock,attempt,recovery,again,pending)

law native_admission_reads_current_attempt_before_pending_input:
  for +db: String
  for +session: String
  for +lock: U32
  for again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for pending: (String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired_recorded(db,session,lock,again,pending) == recorded_attempt_before_pending(db,session,lock,again,pending) : IO(Result<&1,&1,U32 & String,Unit>)}

def native_admission_reads_current_attempt_before_pending_input(db,session,lock,again,pending):
  {==}

law surviving_attempt_recovery_preserves_its_guard:
  for +db: String
  for +session: String
  for +lock: U32
  for +directory: String
  for +args: String
  for again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for pending: (String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired_attempt(db,session,lock,directory,Some{args},again,pending) == Receive.recover_owned(db,session,directory,lock,String.split(args,Char.from_u32(0)),again) : IO(Result<&1,&1,U32 & String,Unit>)}

def surviving_attempt_recovery_preserves_its_guard(db,session,lock,directory,args,again,pending):
  {==}

def completion_prepares_before_owner_release(+db: String, +session: String, +id: String, +log: String, +attempt: String, stderr: String, +cursor: String, +handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), +superseded: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +failed : Bool <- Receive.outcome_failed(db,outcome)
    transient : Bool <- Receive.transient_provider_error(db,outcome)
    +pending_cursor : String <- IO.pure(String,Bool.pick(String,Bool.and(failed,Bool.not(Bool.and(transient,Receive.observation_clear(outcome)))),cursor,"0"))
    prepared : Unit <- Turn.prepare(db,session,id,log,stderr,outcome)
    settled : Unit <- Accounts.attempt_settled(db,session,attempt,failed,Receive.terminal_event(outcome))
    observer_released : Unit <- Receive.release_observer(lock)
    native_released : Unit <- Receive.release_native(db,handle)
    finished : Result<&1,&1,U32 & String,Unit> <- Receive.finish_pending(db,session,id,attempt,log,pending_cursor,outcome,deliveries,again,u => Receive.ack_then_retire(db,session,attempt,handle),superseded)
    Receive.wake_if_kept(db,session,pending_cursor,superseded,finished)

law native_completion_is_committed_before_owner_release:
  for +db: String
  for +session: String
  for +id: String
  for +log: String
  for +attempt: String
  for stderr: String
  for +cursor: String
  for +handle: U32
  for -lock: Maybe<U32>
  for +outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for +superseded: Bool
  {Receive.completed(db,session,id,log,attempt,stderr,cursor,handle,lock,outcome,deliveries,again,superseded) == completion_prepares_before_owner_release(db,session,id,log,attempt,stderr,cursor,handle,lock,outcome,deliveries,again,superseded) : IO(Result<&1,&1,U32 & String,Unit>)}

def native_completion_is_committed_before_owner_release(db,session,id,log,attempt,stderr,cursor,handle,lock,outcome,deliveries,again,superseded):
  {==}

# An incomplete native observation keeps the attempt available for recovery.
law incomplete_observation_skips_acknowledgement:
  for -acknowledge: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acknowledge_if_observed(True{},acknowledge) == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def incomplete_observation_skips_acknowledgement(acknowledge):
  {==}

# Retirement follows acknowledgment on the same attempt handle: the shared
# owner frees the attempt slot and advances its generation. The combined
# result keeps an acknowledgment failure first, and the admission ticket is
# removed only after the acknowledgment succeeded (Receive.ack_retire_ticket).
def retired_after_acknowledgement(+db: String, +session: String, +attempt: String, +handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    acked : Result<&1,&1,U32 & String,Unit> <- P.ProcessChild.acknowledge(handle)
    Receive.ack_retire_ticket(db,session,attempt,handle,acked)

law retired_slot_advances_only_after_acknowledgement:
  for +db: String
  for +session: String
  for +attempt: String
  for +handle: U32
  {Receive.ack_then_retire(db,session,attempt,handle) == retired_after_acknowledgement(db,session,attempt,handle) : IO(Result<&1,&1,U32 & String,Unit>)}

def retired_slot_advances_only_after_acknowledgement(db,session,attempt,handle):
  {==}

# Direct turns share the guard and check the retained attempt before Stop.admit
# can replace its execution record or the direct task can launch a native.
def direct_admission_checks_receive(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, +log: String, session: String, missing: Bool, handle: U32) -> IO(Unit):
  do IO<Unit>:
    retained : Unit <- Turn.retained_receive_guard(db,player)
    direct : Unit <- Turn.unresolved_direct_execution_guard(db,player)
    harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    Turn.player_checked(db,player,id,cmd,model,effort,cwd,task,log,session,harness,handle,missing,None{})

law direct_turn_checks_receive_before_admission:
  for +db: String
  for +player: String
  for +id: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for task: String
  for +log: String
  for session: String
  for missing: Bool
  for handle: U32
  {Turn.acquired(db,player,id,cmd,model,effort,cwd,task,log,session,missing,Some{handle}) == direct_admission_checks_receive(db,player,id,cmd,model,effort,cwd,task,log,session,missing,handle) : IO(Unit)}

def direct_turn_checks_receive_before_admission(db,player,id,cmd,model,effort,cwd,task,log,session,missing,handle):
  {==}

def direct_receive_guard_reads_current(+db: String, player: String) -> IO(Unit):
  do IO<Unit>:
    directory : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(player) ++ " AND mode='retained'),'');"))
    recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.recovery_argv(Tx.trim_nl(directory)))
    Turn.retained_receive_admitted(recovery)

law direct_turn_guard_reads_current_retained_attempt:
  for +db: String
  for player: String
  {Turn.retained_receive_guard(db,player) == direct_receive_guard_reads_current(db,player) : IO(Unit)}

def direct_turn_guard_reads_current_retained_attempt(db,player):
  {==}

law direct_turn_refuses_unreleased_receive:
  for args: String
  {Turn.retained_receive_admitted(Some{args}) == IO.die(Unit,2,"Session retains an interrupted native receive; run receive to observe its output and completion before starting a direct turn.") : IO(Unit)}

def direct_turn_refuses_unreleased_receive(args):
  {==}

# An adopted attempt with no retained wait, result or observation error replays
# all unread input after the existing completion and owner release.
# The native birth and output observations remain host obligations.
law adopted_unknown_attempt_replays_the_retained_inbox:
  for cursor: String
  {Receive.reconciled_cursor(cursor,True{},Turn.Ended{"unknown after keeper loss","","",True{}}) == "0" : String}

def adopted_unknown_attempt_replays_the_retained_inbox(cursor):
  {==}

law fresh_attempt_preserves_its_input_cursor:
  for cursor: String
  for outcome: Turn.Outcome
  {Receive.reconciled_cursor(cursor,False{},outcome) == cursor : String}

def fresh_attempt_preserves_its_input_cursor(cursor,outcome):
  {==}

law adopted_known_native_failure_preserves_its_input_cursor:
  for cursor: String
  {Receive.reconciled_cursor(cursor,True{},Turn.Ended{"exit 1","","",False{}}) == cursor : String}

def adopted_known_native_failure_preserves_its_input_cursor(cursor):
  {==}

law adopted_terminal_result_preserves_its_input_cursor:
  for cursor: String
  {Receive.reconciled_cursor(cursor,True{},Turn.Ended{"unknown after keeper loss","retained result","",False{}}) == cursor : String}

def adopted_terminal_result_preserves_its_input_cursor(cursor):
  {==}

law adopted_observation_error_preserves_its_input_cursor:
  for cursor: String
  {Receive.reconciled_cursor(cursor,True{},Turn.Ended{"unknown after keeper loss","","retained read failed",True{}}) == cursor : String}

def adopted_observation_error_preserves_its_input_cursor(cursor):
  {==}

law retained_observation_uses_the_reconciled_input_cursor:
  for db: String
  for session: String
  for id: String
  for log: String
  for cursor: String
  for native: String
  for cwd: String
  for attempt: String
  for handle: U32
  for lock: Maybe<U32>
  for +outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for adopted: Bool
  for +superseded: Bool
  {Receive.observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,lock,(outcome,deliveries),again,adopted,superseded) == Receive.observed(db,session,id,log,Receive.reconciled_cursor(cursor,adopted,outcome),native,cwd,attempt,handle,lock,outcome,deliveries,again,superseded) : IO(Result<&1,&1,U32 & String,Unit>)}

def retained_observation_uses_the_reconciled_input_cursor(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,adopted,superseded):
  {==}

def guarded_attempt_observation(+db: String, +session: String, +id: String, cursor: String, cmd: String, model: String, effort: String, +cwd: String, +log: String, harness: String, +directory: String, native: String, +handle: U32, lock: Maybe<U32>, again: String -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  Storage.with_writer_leases(Result<&1,&1,U32 & String,Unit>, log, directory,
    error => IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error}),
    unit => do IO<Result<&1,&1,U32 & String,Unit>>:
      reconciled : Result<&1,&1,U32 & String,Unit> <- Stop.observing_result(db,session,id,directory)
      Receive.observe_guarded_reconciled(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,lock,again,adopted,reconciled))

law guarded_observation_preserves_its_adopted_origin:
  for +db: String
  for +session: String
  for +id: String
  for cursor: String
  for cmd: String
  for model: String
  for effort: String
  for +cwd: String
  for +log: String
  for harness: String
  for +directory: String
  for native: String
  for +handle: U32
  for lock: Maybe<U32>
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for adopted: Bool
  {Receive.observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,lock,again,adopted) == guarded_attempt_observation(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,lock,again,adopted) : IO(Result<&1,&1,U32 & String,Unit>)}

def guarded_observation_preserves_its_adopted_origin(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,lock,again,adopted):
  {==}

law keeper_recovery_preserves_the_original_input_cursor:
  for +db: String
  for +session: String
  for id: String
  for cursor: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  for harness: String
  for directory: String
  for native: String
  for +handle: U32
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.observe_attached(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,None{},again) == Receive.observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,None{},again,False{}) : IO(Result<&1,&1,U32 & String,Unit>)}

def keeper_recovery_preserves_the_original_input_cursor(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,again):
  {==}

# M-5 and M-8 for the post-exit wake (#685). The driver reads the pending count
# for the session, takes the session lock, re-reads the count under the lock,
# reads the one message the obligation names, claims it while it holds the lock,
# releases the lock and only then launches that message. Each claim below is a
# written-out body of the function it constrains.
def wake_due_reads_the_count_then_locks(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    owed : Bool <- Receive.wake_owed(db,session,cursor)
    Receive.wake_locked(db,session,cursor,launch,owed)

law the_wake_driver_reads_the_count_before_it_locks:
  for +db: String
  for +session: String
  for +cursor: String
  for -launch: String -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.wake_due(db,session,cursor,launch) == wake_due_reads_the_count_then_locks(db,session,cursor,launch) : IO(Result<&1,&1,U32 & String,Unit>)}

def the_wake_driver_reads_the_count_before_it_locks(db,session,cursor,launch):
  {==}

def continuation_reads_the_count_then_locks(+db: String, +session: String, +cursor: String, again: String -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    pending : String <- IO.try(String,DB.Sql.query(db,Receive.pending_count_sql(session,cursor)))
    Receive.continue_locked(db,session,cursor,again,Bool.not(String.eq(pending,"0\n")))

law the_continuation_reads_the_count_before_it_locks:
  for +db: String
  for +session: String
  for +cursor: String
  for -again: String -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.continue_pending(db,session,cursor,again) == continuation_reads_the_count_then_locks(db,session,cursor,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def the_continuation_reads_the_count_before_it_locks(db,session,cursor,again):
  {==}

def handed_invocation_settles_the_claim_under_the_lock(+db: String, +session: String) -> IO(Unit):
  Lock.SessionLock.acquire_session(Unit,db,session,
    +canonical => lock => Receive.settle_owned(canonical,session,"","","",lock))

law a_handed_invocation_settles_the_claim_only_while_holding_the_lock:
  for +db: String
  for +session: String
  {Receive.claim_left(db,session) == handed_invocation_settles_the_claim_under_the_lock(db,session) : IO(Unit)}

def a_handed_invocation_settles_the_claim_only_while_holding_the_lock(db,session):
  {==}

law a_queued_invocation_without_the_lock_clears_nothing:
  for +db: String
  for +session: String
  {Receive.settle_owned(db,session,"","","",None{}) == IO.pure(Unit,Unit{}) : IO(Unit)}

def a_queued_invocation_without_the_lock_clears_nothing(db,session):
  {==}

law the_holder_releases_only_its_own_ticket:
  for +db: String
  for +session: String
  for +handle: U32
  {Receive.settle_owned(db,session,"","","",Some{handle}) == (do IO<Unit>:
    +owner : String <- Store.claim_owner(db,session)
    +generation : String <- Store.claim_generation(db,session)
    pending : String <- IO.try(String,DB.Sql.query(db,Receive.pending_count_sql(session,"0")))
    dir : String <- IO.try(String,DB.Sql.query(db,Receive.attempt_dir_sql(session)))
    +trimmed : String <- IO.pure(String,Tx.trim_nl(dir))
    dead : Bool <- Receive.custody_dead(db,trimmed,String.is_empty(trimmed))
    +settled : Bool = Bool.and(String.eq(pending,"0\n"),Bool.and(dead,Receive.ticket_match("","",owner,generation)))
    left : Unit <- Receive.release_if_ticket(db,session,Tx.trim_nl(owner),generation,settled)
    +remove : String = Bool.pick(String,String.is_empty(""),trimmed,"")
    cleaned : Unit <- Bool.pick(IO(Unit),settled,Store.delete_ticket(db,session,remove),IO.pure(Unit,Unit{}))
    unlocked : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
    IO.pure(Unit,Unit{})) : IO(Unit)}

def the_holder_releases_only_its_own_ticket(db,session,handle):
  {==}

# Negative controls. Each names the step a mutant would take and shows the code
# does not take it. A held session lock launches nothing; an absent wake target
# claims nothing; a zero count continues nothing.
law a_held_session_lock_never_launches_the_wake:
  for +db: String
  for +session: String
  for +cursor: String
  for launch: String -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.wake_owned(db,session,cursor,launch,None{}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def a_held_session_lock_never_launches_the_wake(db,session,cursor,launch):
  {==}

def owned_wake_fences_under_the_lock(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), +lock: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    owed : Bool <- Receive.wake_owed(db,session,cursor)
    Receive.wake_fenced(db,session,cursor,launch,lock,owed)

law an_owned_wake_admits_through_the_fence:
  for +db: String
  for +session: String
  for +cursor: String
  for launch: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for +lock: U32
  {Receive.wake_owned(db,session,cursor,launch,Some{lock}) == owned_wake_fences_under_the_lock(db,session,cursor,launch,lock) : IO(Result<&1,&1,U32 & String,Unit>)}

def an_owned_wake_admits_through_the_fence(db,session,cursor,launch,lock):
  {==}

def fenced_admission_reads_claim_and_custody(+db: String, +session: String, +cursor: String, launch: String -> IO(Result<&1,&1,U32 & String,Unit>), +lock: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    state : String <- Store.claim_state(db,session)
    dir : String <- IO.try(String,DB.Sql.query(db,Receive.attempt_dir_sql(session)))
    +trimmed : String <- IO.pure(String,Tx.trim_nl(dir))
    +dead : Bool <- Receive.custody_dead(db,trimmed,String.is_empty(trimmed))
    recovered : Unit <- Receive.recover_if_dead(db,session,dead)
    replay_cursor : String = Bool.pick(String,Bool.and(dead,Bool.not(String.is_empty(trimmed))),"0",cursor)
    Receive.wake_admit(db,session,replay_cursor,launch,lock,state,dead)

law the_wake_admits_on_claim_and_custody:
  for +db: String
  for +session: String
  for +cursor: String
  for launch: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for +lock: U32
  {Receive.wake_fenced_owed(db,session,cursor,launch,lock) == fenced_admission_reads_claim_and_custody(db,session,cursor,launch,lock) : IO(Result<&1,&1,U32 & String,Unit>)}

def the_wake_admits_on_claim_and_custody(db,session,cursor,launch,lock):
  {==}

law a_claimed_obligation_with_ambiguous_custody_is_held:
  {Receive.wake_held("claimed\n",False{}) == True{} : Bool}

def a_claimed_obligation_with_ambiguous_custody_is_held():
  {==}

law an_observed_death_releases_the_obligation:
  {Receive.wake_held("claimed\n",True{}) == False{} : Bool}

def an_observed_death_releases_the_obligation():
  {==}

law no_claim_names_no_holder:
  {Receive.wake_held("",False{}) == False{} : Bool}

def no_claim_names_no_holder():
  {==}

law recovery_markers_mean_no_holder:
  {Receive.custody_recovery_none(Done{None{}}) == True{} : Bool}

def recovery_markers_mean_no_holder():
  {==}

law a_started_attempt_without_terminal_marks_is_ambiguous:
  {Receive.custody_recovery_none(Done{Some{""}}) == False{} : Bool}

def a_started_attempt_without_terminal_marks_is_ambiguous():
  {==}

law a_failed_recovery_read_keeps_the_obligation:
  {Receive.custody_recovery_none(Fail{(2,"")}) == False{} : Bool}

def a_failed_recovery_read_keeps_the_obligation():
  {==}

law an_owned_obligation_releases_and_launches_its_input:
  for +db: String
  for +session: String
  for +cursor: String
  for launch: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for lock: U32
  {Receive.wake_stand(db,session,cursor,launch,lock,True{}) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    +found : String <- Receive.wake_found(db,session,cursor)
    released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
    Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),String.is_empty(found),
      IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),Receive.wake_launch(db,found))) : IO(Result<&1,&1,U32 & String,Unit>)}

def an_owned_obligation_releases_and_launches_its_input(db,session,cursor,launch,lock):
  {==}

law a_released_obligation_proceeds_to_claim_and_launch:
  for +db: String
  for +session: String
  for +cursor: String
  for launch: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for lock: U32
  {Receive.wake_stand(db,session,cursor,launch,lock,False{}) == Receive.wake_decided(db,session,cursor,launch,lock,True{}) : IO(Result<&1,&1,U32 & String,Unit>)}

def a_released_obligation_proceeds_to_claim_and_launch(db,session,cursor,launch,lock):
  {==}

law an_absent_wake_target_never_claims_the_obligation:
  for +db: String
  for +session: String
  for launch: String -> IO(Result<&1,&1,U32 & String,Unit>)
  for lock: U32
  {Receive.wake_target(db,session,"",launch,lock,True{}) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})) : IO(Result<&1,&1,U32 & String,Unit>)}

def an_absent_wake_target_never_claims_the_obligation(db,session,launch,lock):
  {==}

law no_owed_input_never_takes_the_lock:
  for +db: String
  for +session: String
  for +cursor: String
  for launch: String -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.wake_locked(db,session,cursor,launch,False{}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}) : IO(Result<&1,&1,U32 & String,Unit>)}

def no_owed_input_never_takes_the_lock(db,session,cursor,launch):
  {==}
