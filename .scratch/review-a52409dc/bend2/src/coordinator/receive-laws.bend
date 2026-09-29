# M-8 exclusive-claim application obligations for native receive (#625).
# For a canonical coordinator database and session with a surviving keeper,
# the runtime invariant is one native owner through actual exit and recovery
# attachment to that owner's attempt. These equations constrain the busy
# admission branch, the shared session identity, and recovery attachment. The
# compiler reports the foreign dependencies. Host exclusivity, descriptor custody, and
# release after actual native process exit remain runtime obligations witnessed
# by the receive tests.
import Base
import ./receive.bend as Receive
import ../host/process.bend as P
import ../host/session-lock.bend as Lock

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
