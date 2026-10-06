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
import ./stop.bend as Stop
import ../host/process.bend as P
import ../host/session-lock.bend as Lock
import ./turn.bend as Turn
import ./delivery.bend as Delivery
import ./native-requests.bend as NativeRequests
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../host/text.bend as Text
import ./store.bend as Store

law report_persists_before_best_effort_control_output:
  for db: String
  for player: String
  for id: String
  for body: String
  {Turn.report(db,player,id,body) == (do IO<Unit>:
    saved : String <- IO.try(String,Store.commit(db,C.Report{id,player,body}))
    written : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output(saved)
    IO.pure(Unit,Unit{})) : IO(Unit)}

def report_persists_before_best_effort_control_output(db,player,id,body):
  {==}

law direct_replay_keeps_output_failure_for_completion:
  for +db: String
  for +player: String
  for +id: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for +task: String
  for log: String
  for session: String
  for harness: String
  {Turn.choose(db,player,id,cmd,model,effort,cwd,task,log,session,harness,True{}) == (do IO<Result<&1,&1,U32 & String,Maybe<Turn.Outcome>>>:
    +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
    written : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output(saved)
    IO.pure(Result<&1,&1,U32 & String,Maybe<Turn.Outcome>>,Turn.replay_result(written))) : IO(Result<&1,&1,U32 & String,Maybe<Turn.Outcome>>)}

def direct_replay_keeps_output_failure_for_completion(db,player,id,cmd,model,effort,cwd,task,log,session,harness):
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
  for player: String
  for +id: String
  {Turn.player_finished(db,player,id) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    +saved : String <- IO.try(String,Store.commit(db,C.Delivery{id}))
    diagnostic_delivery : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id ++ ":observation","1","")
    delivered : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id,"1",saved)
    exit_delivery : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db,id ++ ":exit","1","")
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
  {Turn.finish_parent(db,player,id,log,Turn.Ended{status,event,error},False{}) == (do IO<Result<&1,&1,U32 & String,Unit>>:
    output : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(player) ++ ",'status'," ++ C.q(status) ++ ",'event',CASE WHEN " ++ C.q(event) ++ "='' THEN NULL ELSE json(" ++ C.q(event) ++ ") END,'error'," ++ C.q(error) ++ ");"))
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

# A busy session reports queued without consulting the admission operation.
law busy_receive_only_reports_queued:
  for +db: String
  for +session: String
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  for fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired(db,session,None{},again,fresh) == Receive.receive_status(db,session,"queued") : IO(Result<&1,&1,U32 & String,Unit>)}

def busy_receive_only_reports_queued(db,session,again,fresh):
  {==}

# The recovery attachment boundary opens the supplied attempt directory and
# passes the returned handle to its continuation. Receive.recover supplies its
# retained-output observation continuation.
def attached_recovery(directory: String, next: @+handle: U32 -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    handle : U32 <- IO.try(U32,P.ProcessChild.attach(directory))
    next(handle)

law recovery_attaches_recorded_attempt:
  for +directory: String
  for -next: @+handle: U32 -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.attach_recorded(directory,next) == attached_recovery(directory,next) : IO(Result<&1,&1,U32 & String,Unit>)}

def recovery_attaches_recorded_attempt(directory,next):
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
  for +cursor: String
  for native: String
  for cwd: String
  for +handle: U32
  for -lock: Maybe<U32>
  for +outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.complete_or_restart(db,session,id,log,stderr,cursor,native,cwd,handle,lock,outcome,deliveries,again,False{}) == Receive.completed(db,session,id,log,stderr,cursor,handle,lock,outcome,deliveries,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_not_refused_conversation_completes_the_attempt(db,session,id,log,stderr,cursor,native,cwd,handle,lock,outcome,deliveries,again):
  {==}

# M-17: the branch taken when the recorded conversation is refused (gone =
# True) restarts, naming the attempt's own native identity and workspace.
law m17_refused_conversation_restarts_the_attempt:
  for +db: String
  for +session: String
  for +id: String
  for log: String
  for stderr: String
  for cursor: String
  for native: String
  for cwd: String
  for +handle: U32
  for -lock: Maybe<U32>
  for outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.complete_or_restart(db,session,id,log,stderr,cursor,native,cwd,handle,lock,outcome,deliveries,again,True{}) == Receive.restart_pending(db,session,id,native,cwd,handle,lock,deliveries,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_refused_conversation_restarts_the_attempt(db,session,id,log,stderr,cursor,native,cwd,handle,lock,outcome,deliveries,again):
  {==}

# M-17: the receive entry's own dispatch. The branch argument is the refusal
# predicate Turn.refusal(attempt ++ "/native",
# Bool.not(String.is_empty(native)), outcome) while the session remains open.
# The exit and terminal stop are recorded before dispatch. The stderr path handed to
# the branches is the derived attempt ++ "/native.stderr". The written-out
# dispatch below is the whole obligation: reading a different predicate, or
# passing the undecorated attempt, breaks this proof.
def observed_dispatch(+db: String, +session: String, +id: String, +log: String, cursor: String, +native: String, cwd: String, +attempt: String, handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    exited : Unit <- Turn.record_exit(db,session,id,log,outcome)
    closed : Bool <- Stop.stopped(db,session)
    gone : Bool <- Turn.refusal(attempt ++ "/native", Bool.not(String.is_empty(native)), outcome)
    Receive.complete_or_restart(db,session,id,log,attempt ++ "/native.stderr",cursor,native,cwd,handle,lock,outcome,deliveries,again,Bool.and(gone,Bool.not(closed)))

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
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.observed(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again) == observed_dispatch(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_the_observed_dispatch_is_the_refusal_it_read(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again):
  {==}

# M-17: the restart reads the recovery-input row, records the recovery, and
# only then releases the observer and the native process, delivers the wake
# and settles question deliveries before acknowledging it. The written-out order is the whole obligation: a
# reordering of any two steps breaks this proof.
def restart_records_before_releasing_and_waking(+db: String, +session: String, +id: String, native: String, cwd: String, +handle: U32, lock: Maybe<U32>, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");"))
    saved : Unit <- Receive.record_recovery(db,session,id,native,cwd,String.eq(recorded,"1\n"))
    observer_released : Unit <- Receive.release_observer(lock)
    native_released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
    delivery_task : Chan(Result<&1,&1,U32 & String,String>) <- IO.fork(Result<&1,&1,U32 & String,String>,Delivery.deliver(db,id ++ ":recovery","1",""))
    next : Result<&1,&1,U32 & String,Unit> <- again(Unit{})
    delivered : Result<&1,&1,U32 & String,String> <- IO.join(Result<&1,&1,U32 & String,String>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Delivery.wake_result(delivered),Turn.combine(questions,next)))

law m17_restart_records_before_releasing_and_waking:
  for +db: String
  for +session: String
  for +id: String
  for +native: String
  for +cwd: String
  for +handle: U32
  for -lock: Maybe<U32>
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.restart_pending(db,session,id,native,cwd,handle,lock,deliveries,again) == restart_records_before_releasing_and_waking(db,session,id,native,cwd,handle,lock,deliveries,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_restart_records_before_releasing_and_waking(db,session,id,native,cwd,handle,lock,deliveries,again):
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


# M-8: one owner resolves the durable attempt before admitting another native.
law acquired_native_owner_resolves_recorded_attempt:
  for db: String
  for session: String
  for lock: U32
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  for fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired(db,session,Some{lock},again,fresh) == Receive.acquired_recorded(db,session,lock,again,fresh) : IO(Result<&1,&1,U32 & String,Unit>)}

def acquired_native_owner_resolves_recorded_attempt(db,session,lock,again,fresh):
  {==}

def recorded_attempt_before_pending(+db: String, +session: String, +lock: U32, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +directory : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT directory FROM executions WHERE session=" ++ C.q(session) ++ " AND mode='retained'),'');"))
    +attempt : String <- IO.pure(String,Tx.trim_nl(directory))
    recovery : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.recovery_argv(attempt))
    Receive.acquired_attempt(db,session,lock,attempt,recovery,again,fresh)

law native_admission_reads_current_attempt_before_pending_input:
  for +db: String
  for +session: String
  for +lock: U32
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  for -fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired_recorded(db,session,lock,again,fresh) == recorded_attempt_before_pending(db,session,lock,again,fresh) : IO(Result<&1,&1,U32 & String,Unit>)}

def native_admission_reads_current_attempt_before_pending_input(db,session,lock,again,fresh):
  {==}

# A retained attempt reaches recovery with its saved arguments; the supplied
# fresh admission operation is never evaluated on this branch.
law surviving_attempt_recovery_preserves_its_guard:
  for db: String
  for session: String
  for lock: U32
  for directory: String
  for args: String
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  for fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired_attempt(db,session,lock,directory,Some{args},again,fresh) == Receive.recover_owned(db,session,directory,lock,String.split(args,Char.from_u32(0)),again) : IO(Result<&1,&1,U32 & String,Unit>)}

def surviving_attempt_recovery_preserves_its_guard(db,session,lock,directory,args,again,fresh):
  {==}

# Without a recorded attempt the guard hands its canonical database and its lock
# to the supplied fresh admission operation.
def fresh_only_admission(database: String, held: U32, fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  fresh(database,held)

law absent_attempt_runs_the_supplied_fresh_admission:
  for +db: String
  for session: String
  for +lock: U32
  for directory: String
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  for -fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired_attempt(db,session,lock,directory,None{},again,fresh) == fresh_only_admission(db,lock,fresh) : IO(Result<&1,&1,U32 & String,Unit>)}

def absent_attempt_runs_the_supplied_fresh_admission(db,session,lock,directory,again,fresh):
  {==}

# The guarded caller passes the database the session lock acquisition resolved,
# so the fresh admission runs on the same database identity as the
# recorded-attempt path.
def guarded_admission_carries_the_canonical_database(+db: String, +session: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>), closed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match closed:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(2,"Session is terminally stopped; queued input will not execute. Read its session and retained inbox.")})
    case False{}: Lock.SessionLock.acquire_session(Result<&1,&1,U32 & String,Unit>,db,session,
      +database => lock => Receive.acquired(database,session,lock,again,fresh))

law canonical_database_reaches_the_guarded_fresh_admission:
  for +db: String
  for +session: String
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  for -fresh: @+database: String -> @+lock: U32 -> IO(Result<&1,&1,U32 & String,Unit>)
  for closed: Bool
  {Receive.available(db,session,again,fresh,closed) == guarded_admission_carries_the_canonical_database(db,session,again,fresh,closed) : IO(Result<&1,&1,U32 & String,Unit>)}

def canonical_database_reaches_the_guarded_fresh_admission(db,session,again,fresh,closed):
  {==}

# The ordinary fresh admission runs the queued-input admission on the database
# its caller supplies as the canonical one.
def guarded_pending_admission(canonical: String, held: U32, session: String, cmd: String, model: String, effort: String, cwd: String, log: String, next: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  Receive.acquired_pending(canonical,session,cmd,model,effort,cwd,log,held,next)

law fresh_pending_admission_selects_the_guarded_database:
  for canonical: String
  for held: U32
  for session: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for log: String
  for -next: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.fresh_pending_admission(canonical,held,session,cmd,model,effort,cwd,log,next) == guarded_pending_admission(canonical,held,session,cmd,model,effort,cwd,log,next) : IO(Result<&1,&1,U32 & String,Unit>)}

def fresh_pending_admission_selects_the_guarded_database(canonical,held,session,cmd,model,effort,cwd,log,next):
  {==}

# The ordinary receive entry commits and reads the session, refuses an
# unregistered one, reads the stopped state and admits through the canonical
# guard. The fresh admission binds the database the guard resolved, and the
# continuation re-enters with this entry's own database argument.
def ordinary_receive_admission(+db: String, +session: String, +cmd: String, +model: String, +effort: String, +cwd: String, +log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,Store.commit(db,C.Session{session}))
    exists : Unit <- Receive.registered(Bool.not(String.is_empty(recorded)))
    closed : Bool <- Stop.stopped(db,session)
    Receive.available(db,session,u => Receive.run(db,session,cmd,model,effort,cwd,log,""),canonical => lock => Receive.fresh_pending_admission(canonical,lock,session,cmd,model,effort,cwd,log,u => Receive.run(db,session,cmd,model,effort,cwd,log,"")),closed)

law ordinary_receive_admission_binds_the_guarded_database:
  for +db: String
  for +session: String
  for +cmd: String
  for +model: String
  for +effort: String
  for +cwd: String
  for +log: String
  {Receive.run(db,session,cmd,model,effort,cwd,log,"") == ordinary_receive_admission(db,session,cmd,model,effort,cwd,log) : IO(Result<&1,&1,U32 & String,Unit>)}

def ordinary_receive_admission_binds_the_guarded_database(db,session,cmd,model,effort,cwd,log):
  {==}

# The configuration-recovery hook keeps each blocked case explicit: a changed
# attempt, an absent responsible recipient and an unusable recipient endpoint each
# refuse with the original attempt preserved, and only a resolved report reaches
# delivery by its own id.
law changed_attempt_refuses_the_handoff:
  for +db: String
  for +session: String
  for requester: String
  for +directory: String
  for observed: String
  {Receive.recovery_attempt(db,session,requester,directory,observed,False{}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"The retained attempt changed or completed before the configuration-recovery handoff; the recorded attempt is " ++ observed ++ ". Configuration did not run and the attempt is preserved.")}) : IO(Result<&1,&1,U32 & String,String>)}

def changed_attempt_refuses_the_handoff(db,session,requester,directory,observed):
  {==}

law absent_recipient_refuses_the_handoff:
  for db: String
  for parent: String
  for retained: Result<&1,&1,U32 & String,String>
  {Receive.recovery_parent_ready(db,parent,retained,True{}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"The retained attempt has no responsible recorded recipient; configuration did not run and the attempt, its input and its manifest are preserved.")}) : IO(Result<&1,&1,U32 & String,String>)}

def absent_recipient_refuses_the_handoff(db,parent,retained):
  {==}

law unusable_recipient_endpoint_refuses_delivery:
  for db: String
  for parent: String
  for retained: Result<&1,&1,U32 & String,String>
  {Receive.recovery_endpoint_ready(db,parent,retained,True{}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"The responsible recipient " ++ parent ++ " has no usable recorded endpoint; the recovery report is retained in its inbox and the original attempt is preserved.")}) : IO(Result<&1,&1,U32 & String,String>)}

def unusable_recipient_endpoint_refuses_delivery(db,parent,retained):
  {==}

law retained_report_is_delivered_by_its_own_id:
  for +db: String
  for parent: String
  for +id: String
  {Receive.recovery_deliver(db,parent,Done{id}) == Delivery.deliver(db,id,"1","") : IO(Result<&1,&1,U32 & String,String>)}

def retained_report_is_delivered_by_its_own_id(db,parent,id):
  {==}

# The strict report delivery keeps a missing message, an ineligible message, an
# already-acknowledged report, an absent or malformed endpoint, an observed zero
# exit and a failed launch as distinct results, and always carries the requested
# and selected identities. The framing laws bind the whole row, not a supplied
# marker, so a truncated or suffixed marker row cannot pass.
law missing_row_requires_its_own_frame:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"m\n") == Delivery.report_failed(id,"report-missing","No message matches this report id; its input is retained.") : IO(Result<&1,&1,U32 & String,String>)}

def missing_row_requires_its_own_frame(db,id):
  {==}

law ineligible_row_requires_its_own_frame:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"i\n") == Delivery.report_failed(id,"report-ineligible","The message is not an eligible retained report; its input is retained.") : IO(Result<&1,&1,U32 & String,String>)}

def ineligible_row_requires_its_own_frame(db,id):
  {==}

law marker_row_without_its_delimiter_is_rejected:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"m") == Delivery.report_failed(id,"report-framing-rejected","The retained report row does not end in exactly one host delimiter; the report and its input are retained.") : IO(Result<&1,&1,U32 & String,String>)}

def marker_row_without_its_delimiter_is_rejected(db,id):
  {==}

law marker_row_with_a_suffix_is_rejected:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"m\njunk") == Delivery.report_failed(id,"report-framing-rejected","The retained report row does not end in exactly one host delimiter; the report and its input are retained.") : IO(Result<&1,&1,U32 & String,String>)}

def marker_row_with_a_suffix_is_rejected(db,id):
  {==}

law eligible_frame_decodes_to_its_fields:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"o\np\na\n4\nroot\n4\n2:ab\n") == Delivery.report_receipt(db,id,"root","p","a","2:ab") : IO(Result<&1,&1,U32 & String,String>)}

def eligible_frame_decodes_to_its_fields(db,id):
  {==}

law eligible_frame_with_a_short_payload_is_rejected:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"o\np\na\n4\nroot\n13\nshort\n") == Delivery.report_failed(id,"report-truncated","The retained report row is shorter than its declared argv length; the report and its input are retained.") : IO(Result<&1,&1,U32 & String,String>)}

def eligible_frame_with_a_short_payload_is_rejected(db,id):
  {==}

law eligible_frame_keeps_an_empty_later_argument:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"o\np\na\n4\nroot\n6\n2:ab0:\n") == Delivery.report_receipt(db,id,"root","p","a","2:ab0:") : IO(Result<&1,&1,U32 & String,String>)}

def eligible_frame_keeps_an_empty_later_argument(db,id):
  {==}

law eligible_frame_keeps_an_internal_newline:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"o\np\na\n4\nroot\n11\n2:ab0:3:x\ny\n") == Delivery.report_receipt(db,id,"root","p","a","2:ab0:3:x\ny") : IO(Result<&1,&1,U32 & String,String>)}

def eligible_frame_keeps_an_internal_newline(db,id):
  {==}

law eligible_frame_keeps_a_trailing_newline:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"o\np\na\n4\nroot\n4\n2:x\n\n") == Delivery.report_receipt(db,id,"root","p","a","2:x\n") : IO(Result<&1,&1,U32 & String,String>)}

def eligible_frame_keeps_a_trailing_newline(db,id):
  {==}

law eligible_frame_keeps_a_unicode_recipient:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"o\np\na\n2\nrΩ\n4\n2:ab\n") == Delivery.report_receipt(db,id,"rΩ","p","a","2:ab") : IO(Result<&1,&1,U32 & String,String>)}

def eligible_frame_keeps_a_unicode_recipient(db,id):
  {==}

law eligible_frame_without_its_delimiter_is_rejected:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"o\np\na\n4\nroot\n4\n2:ab") == Delivery.report_failed(id,"report-framing-rejected","The retained report row does not end in exactly one host delimiter; the report and its input are retained.") : IO(Result<&1,&1,U32 & String,String>)}

def eligible_frame_without_its_delimiter_is_rejected(db,id):
  {==}

law marker_row_with_a_doubled_delimiter_is_rejected:
  for db: String
  for id: String
  {Delivery.report_row(db,id,"m\n\n") == Delivery.report_failed(id,"report-framing-rejected","The retained report row does not end in exactly one host delimiter; the report and its input are retained.") : IO(Result<&1,&1,U32 & String,String>)}

def marker_row_with_a_doubled_delimiter_is_rejected(db,id):
  {==}

law acknowledged_report_is_not_an_invocation:
  for db: String
  for id: String
  for recipient: String
  for payload: String
  {Delivery.report_receipt(db,id,recipient,"a","a",payload) == IO.pure(Result<&1,&1,U32 & String,String>,Done{Delivery.report_envelope(id,id,recipient,"already-acknowledged",False{},"","The retained report already has a receipt; no endpoint was invoked.")}) : IO(Result<&1,&1,U32 & String,String>)}

def acknowledged_report_is_not_an_invocation(db,id,recipient,payload):
  {==}

law absent_endpoint_is_not_an_invocation:
  for db: String
  for id: String
  for recipient: String
  for payload: String
  {Delivery.report_endpoint(db,id,recipient,"e",payload) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,Delivery.report_envelope(id,id,recipient,"endpoint-absent",False{},"","The recorded endpoint is absent; the report and its input are retained."))}) : IO(Result<&1,&1,U32 & String,String>)}

def absent_endpoint_is_not_an_invocation(db,id,recipient,payload):
  {==}

law malformed_endpoint_is_not_an_invocation:
  for db: String
  for id: String
  for recipient: String
  for payload: String
  {Delivery.report_endpoint(db,id,recipient,"x",payload) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,Delivery.report_envelope(id,id,recipient,"endpoint-malformed",False{},"","The recorded endpoint is not a complete usable argument array; the report and its input are retained."))}) : IO(Result<&1,&1,U32 & String,String>)}

def malformed_endpoint_is_not_an_invocation(db,id,recipient,payload):
  {==}

law zero_exit_reports_the_invoked_disposition:
  for id: String
  for recipient: String
  for saved: String
  {Delivery.report_launch_outcome(id,recipient,Done{saved}) == Done{Delivery.report_envelope(id,id,recipient,"invoked",True{},"0","Endpoint process completed and exited zero.")} : Result<&1,&1,U32 & String,String>}

def zero_exit_reports_the_invoked_disposition(id,recipient,saved):
  {==}

law failed_launch_keeps_its_code_and_identity:
  for id: String
  for recipient: String
  for code: U32
  for detail: String
  {Delivery.report_launch_outcome(id,recipient,Fail{(code,detail)}) == Fail{(code,Delivery.report_envelope(id,id,recipient,"invocation-failed",True{},"",detail))} : Result<&1,&1,U32 & String,String>}

def failed_launch_keeps_its_code_and_identity(id,recipient,code,detail):
  {==}

def completion_prepares_before_owner_release(+db: String, +session: String, +id: String, +log: String, stderr: String, cursor: String, +handle: U32, lock: Maybe<U32>, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    prepared : Unit <- Turn.prepare(db,session,id,log,stderr,outcome)
    observer_released : Unit <- Receive.release_observer(lock)
    native_released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
    Receive.finish_pending(db,session,id,log,cursor,outcome,deliveries,again,u => P.ProcessChild.acknowledge(handle))

law native_completion_is_committed_before_owner_release:
  for +db: String
  for +session: String
  for +id: String
  for +log: String
  for +stderr: String
  for +cursor: String
  for +handle: U32
  for -lock: Maybe<U32>
  for +outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.completed(db,session,id,log,stderr,cursor,handle,lock,outcome,deliveries,again) == completion_prepares_before_owner_release(db,session,id,log,stderr,cursor,handle,lock,outcome,deliveries,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def native_completion_is_committed_before_owner_release(db,session,id,log,stderr,cursor,handle,lock,outcome,deliveries,again):
  {==}

# A completed attempt settles beside its queued continuation: the parent
# delivery, native-request settle and attempt acknowledge join before the
# continuation does, the acknowledge failure stays a combined value, and the
# combined outcome keeps the same failure order for a successful acknowledge.
def settle_attempt_before_joining_continuation(+db: String, +session: String, id: String, log: String, cursor: String, +outcome: Turn.Outcome, deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), acknowledge: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    failed : Bool <- Receive.outcome_failed(db,outcome)
    delivery_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Turn.finish(db,session,id,log,outcome))
    continued_task : Chan(Result<&1,&1,U32 & String,Unit>) <- IO.fork(Result<&1,&1,U32 & String,Unit>,Receive.continue_pending(db,session,cursor,again))
    finished : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,delivery_task)
    questions : Result<&1,&1,U32 & String,Unit> <- NativeRequests.settle(deliveries)
    ack : Result<&1,&1,U32 & String,Unit> <- acknowledge(Unit{})
    status : Result<&1,&1,U32 & String,Unit> <- Receive.exit_status(failed)
    next : Result<&1,&1,U32 & String,Unit> <- IO.join(Result<&1,&1,U32 & String,Unit>,continued_task)
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(finished,Turn.combine(questions,Turn.combine(next,Turn.combine(ack,status)))))

law completed_attempt_settles_before_continuation_joins:
  for +db: String
  for +session: String
  for id: String
  for log: String
  for cursor: String
  for +outcome: Turn.Outcome
  for -deliveries: List<Chan(Result<&1,&1,U32 & String,String>)>
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  for -acknowledge: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.finish_pending(db,session,id,log,cursor,outcome,deliveries,again,acknowledge) == settle_attempt_before_joining_continuation(db,session,id,log,cursor,outcome,deliveries,again,acknowledge) : IO(Result<&1,&1,U32 & String,Unit>)}

def completed_attempt_settles_before_continuation_joins(db,session,id,log,cursor,outcome,deliveries,again,acknowledge):
  {==}

# Direct turns share the guard and check the retained attempt before Stop.admit
# can replace its execution record or the direct task can launch a native.
def direct_admission_checks_receive(+db: String, +player: String, +id: String, cmd: String, model: String, effort: String, cwd: String, task: String, +log: String, session: String, missing: Bool, handle: U32) -> IO(Unit):
  do IO<Unit>:
    retained : Unit <- Turn.retained_receive_guard(db,player)
    harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    result : Result<&1,&1,U32 & String,Maybe<Turn.Outcome>> <- Turn.player_checked(db,player,id,cmd,model,effort,cwd,task,log,session,harness,missing)
    Turn.complete_locked(db,player,id,log,handle,result)

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
# all unacknowledged input after the existing completion and owner release.
# The native birth and output observations remain host obligations.
law adopted_unknown_attempt_replays_the_retained_inbox:
  for cursor: String
  {Receive.reconciled_cursor(cursor,True{},Turn.Ended{"unknown after keeper loss","",""}) == "0" : String}

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
  {Receive.reconciled_cursor(cursor,True{},Turn.Ended{"exit 1","",""}) == cursor : String}

def adopted_known_native_failure_preserves_its_input_cursor(cursor):
  {==}

law adopted_terminal_result_preserves_its_input_cursor:
  for cursor: String
  {Receive.reconciled_cursor(cursor,True{},Turn.Ended{"unknown after keeper loss","retained result",""}) == cursor : String}

def adopted_terminal_result_preserves_its_input_cursor(cursor):
  {==}

law adopted_observation_error_preserves_its_input_cursor:
  for cursor: String
  {Receive.reconciled_cursor(cursor,True{},Turn.Ended{"unknown after keeper loss","","retained read failed"}) == cursor : String}

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
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  for adopted: Bool
  {Receive.observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,lock,(outcome,deliveries),again,adopted) == Receive.observed(db,session,id,log,Receive.reconciled_cursor(cursor,adopted,outcome),native,cwd,attempt,handle,lock,outcome,deliveries,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def retained_observation_uses_the_reconciled_input_cursor(db,session,id,log,cursor,native,cwd,attempt,handle,lock,outcome,deliveries,again,adopted):
  {==}

def fresh_retained_observation(+db: String, +session: String, +id: String, +log: String, cursor: String, native: String, cwd: String, +attempt: String, harness: String, lock: U32, +handle: U32, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    reconciled : Unit <- Stop.started(db,session,id,attempt)
    observation : Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- Turn.retained_output(db,session,id,log,harness,attempt,handle)
    Receive.observed_output(db,session,id,log,cursor,native,cwd,attempt,handle,Some{lock},observation,again,False{})

law newly_started_process_uses_fresh_observation:
  for +db: String
  for +session: String
  for +id: String
  for +log: String
  for cursor: String
  for native: String
  for cwd: String
  for +attempt: String
  for harness: String
  for lock: U32
  for +handle: U32
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.started(db,session,id,log,cursor,native,cwd,attempt,harness,lock,P.Retained{handle},again) == fresh_retained_observation(db,session,id,log,cursor,native,cwd,attempt,harness,lock,handle,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def newly_started_process_uses_fresh_observation(db,session,id,log,cursor,native,cwd,attempt,harness,lock,handle,again):
  {==}

def owned_attempt_observation(+db: String, +session: String, +directory: String, +lock: U32, id: String, cursor: String, cmd: String, model: String, effort: String, cwd: String, log: String, harness: String, native: String, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    valid : Unit <- Stop.error_result("Recorded native recovery arguments differ from the current session; retain the attempt and inspect its manifest.",Bool.and(String.eq("--recover-receive","--recover-receive"),Bool.and(String.eq(db,db),Bool.and(String.eq(session,session),String.eq(directory,directory)))))
    handle : U32 <- IO.try(U32,P.ProcessChild.attach_owned(directory,lock))
    Receive.observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,Some{lock},again,True{})

law recorded_owner_uses_adopted_observation:
  for executable: String
  for +db: String
  for +session: String
  for +directory: String
  for +lock: U32
  for id: String
  for cursor: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for log: String
  for harness: String
  for native: String
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.recover_owned(db,session,directory,lock,[executable,"--recover-receive",db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native],again) == owned_attempt_observation(db,session,directory,lock,id,cursor,cmd,model,effort,cwd,log,harness,native,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def recorded_owner_uses_adopted_observation(executable,db,session,directory,lock,id,cursor,cmd,model,effort,cwd,log,harness,native,again):
  {==}

def guarded_attempt_observation(+db: String, +session: String, +id: String, cursor: String, cmd: String, model: String, effort: String, +cwd: String, +log: String, harness: String, +directory: String, native: String, +handle: U32, lock: Maybe<U32>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>), adopted: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    reconciled : Unit <- Stop.reconcile(db,session,id,directory)
    observation : Turn.Outcome & List<Chan(Result<&1,&1,U32 & String,String>)> <- Turn.retained_output(db,session,id,log,harness,directory,handle)
    Receive.observed_output(db,session,id,log,cursor,native,cwd,directory,handle,lock,observation,again,adopted)

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
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
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
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.observe_attached(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,again) == Receive.observe_guarded(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,None{},again,False{}) : IO(Result<&1,&1,U32 & String,Unit>)}

def keeper_recovery_preserves_the_original_input_cursor(db,session,id,cursor,cmd,model,effort,cwd,log,harness,directory,native,handle,again):
  {==}
