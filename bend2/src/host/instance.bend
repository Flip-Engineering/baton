import Base
import ./process.bend as P

# One owner process serves one canonical database. It holds every admitted
# attempt's stdin writer, wait authority and stdout spool, so an observer or a
# coordinator can exit without losing the native work or its output.
def Instance.owner(database: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Starts a native attempt under the database owner and joins it as its observer.
# The result carries the attempt handle, or the reason no native child started.
def Instance.admit_start(database: String, directory: String, argv: String, cwd: String, stderr: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32> & String>):
  import "./process-spawn.c"

# Joins an existing attempt as its observer.
def Instance.attach(database: String, directory: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

# Adopts an attempt whose observer died while the caller holds the session
# guard. It refuses a second native launch for the same attempt.
def Instance.attach_owned(database: String, directory: String, lock: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

# Asks the owner to exit once its last attempt is gone. A database with no
# running owner is already shut down.
def Instance.shutdown(database: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Terminal capability cleanup after acknowledgment. The attempt directory and
# its status, released and acknowledged markers remain the durable record.
def Instance.retire(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def Instance.started(result: Result<&1,&1,U32 & String,Maybe<U32> & String>) -> Result<&1,&1,U32 & String,P.RetainedStart>:
  match result:
    case Fail{error}: Fail{error}
    case Done{(handle,error)}:
      match handle:
        case Some{value}: Done{P.Retained{value}}
        case None{}: Done{P.Unstarted{error}}

# Starts a native attempt under the database owner. No lock means the caller
# holds no session guard for this attempt.
def Instance.admit(database: String, directory: String, argv: String, cwd: String, stderr: String, initial: String, keep_stdin: U32, lock: Maybe<U32>, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  match lock:
    case None{}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- Instance.admit_start(database,directory,argv,cwd,stderr,initial,keep_stdin,0,recovery_argv)
      IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Instance.started(result))
    case Some{value_lock}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- Instance.admit_start(database,directory,argv,cwd,stderr,initial,keep_stdin,value_lock,recovery_argv)
      IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Instance.started(result))
