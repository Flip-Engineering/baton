# M-8 exclusive-claim application obligations for native receive (#625).
# For a canonical coordinator database and session with a surviving keeper,
# the runtime invariant is one native owner through actual exit and recovery
# attachment to that owner's attempt. These equations constrain the busy
# admission branch, the shared session identity, and recovery attachment. The
# compiler reports the foreign dependencies. Host exclusivity, descriptor custody, and
# release after actual native process exit remain runtime obligations witnessed
# by the receive tests.
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
import ../host/process.bend as P
import ../host/session-lock.bend as Lock
import ./turn.bend as Turn
import ./root.bend as Root
import ./commands.bend as C
import ../host/sqlite.bend as DB

# A busy session reports queued for every launch argument and continuation.
law busy_receive_only_reports_queued:
  for +db: String
  for +session: String
  for cmd: String
  for model: String
  for effort: String
  for cwd: String
  for log: String
  for again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.acquired(db,session,cmd,model,effort,cwd,log,None{},again) == Receive.receive_status(db,session,"queued") : IO(Result<&1,&1,U32 & String,Unit>)}

def busy_receive_only_reports_queued(db,session,cmd,model,effort,cwd,log,again):
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
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.complete_or_restart(db,session,id,log,stderr,cursor,native,cwd,handle,lock,outcome,again,False{}) == Receive.completed(db,session,id,log,stderr,cursor,handle,lock,outcome,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_not_refused_conversation_completes_the_attempt(db,session,id,log,stderr,cursor,native,cwd,handle,lock,outcome,again):
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
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.complete_or_restart(db,session,id,log,stderr,cursor,native,cwd,handle,lock,outcome,again,True{}) == Receive.restart_pending(db,session,id,native,cwd,handle,lock,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_refused_conversation_restarts_the_attempt(db,session,id,log,stderr,cursor,native,cwd,handle,lock,outcome,again):
  {==}

# M-17: the restart reads the recovery-input row, records the recovery, and
# only then releases the observer and the native process, delivers the wake
# and acknowledges it. The written-out order below is the whole obligation: a
# reordering of any two steps breaks this proof.
def restart_records_before_releasing_and_waking(+db: String, +session: String, +id: String, native: String, cwd: String, +handle: U32, lock: Maybe<U32>, again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    recorded : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");"))
    saved : Unit <- Receive.record_recovery(db,session,id,native,cwd,String.eq(recorded,"1\n"))
    observer_released : Unit <- Receive.release_observer(lock)
    native_released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
    delivery_task : Chan(Result<&1,&1,U32 & String,String>) <- IO.fork(Result<&1,&1,U32 & String,String>,Root.deliver(db,id ++ ":recovery","1",""))
    next : Result<&1,&1,U32 & String,Unit> <- again(Unit{})
    delivered : Result<&1,&1,U32 & String,String> <- IO.join(Result<&1,&1,U32 & String,String>,delivery_task)
    acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
    IO.pure(Result<&1,&1,U32 & String,Unit>,Turn.combine(Root.wake_result(delivered),next))

law m17_restart_records_before_releasing_and_waking:
  for +db: String
  for +session: String
  for +id: String
  for +native: String
  for +cwd: String
  for +handle: U32
  for -lock: Maybe<U32>
  for -again: Unit -> IO(Result<&1,&1,U32 & String,Unit>)
  {Receive.restart_pending(db,session,id,native,cwd,handle,lock,again) == restart_records_before_releasing_and_waking(db,session,id,native,cwd,handle,lock,again) : IO(Result<&1,&1,U32 & String,Unit>)}

def m17_restart_records_before_releasing_and_waking(db,session,id,native,cwd,handle,lock,again):
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
      ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":recovery-input") ++ ",id,id,'recovery'," ++ C.q(note) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND native=" ++ C.q(native) ++ ";"
      ++ "UPDATE sessions SET native='' WHERE id=" ++ C.q(session) ++ " AND changes()=1;"
      ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":recovery") ++ ",id,parent,'report'," ++ C.q("The recorded conversation could not be resumed; pending input will continue in a fresh conversation with the workspace's current state.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND parent IS NOT NULL AND EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":recovery-input") ++ ");COMMIT;"))
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
