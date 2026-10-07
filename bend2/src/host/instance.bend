import Base
import ./process.bend as P

# One owner process serves one canonical database. It holds every admitted
# attempt's stdin writer, wait authority and stdout spool, so an observer or a
# coordinator can exit without losing the native work or its output.
def Instance.owner(database: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def Instance.admit_with_file_start(database: String, directory: String, argv: String, cwd: String, stderr: String, artifact_name: String, artifact_bytes: String, initial_stdin: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32> & String>):
  import "./process-spawn.c"

# The prepared file-input variant on the shared owner: the same private artifact
# preparation and identity binding as ProcessChild.retain_with_file, with the
# owner elected for the database instead of a keeper per attempt.
def Instance.admit_with_file(database: String, directory: String, argv: String, cwd: String, stderr: String, artifact_name: String, artifact_bytes: String, initial_stdin: String, keep_stdin: U32, lock: Maybe<U32>, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  match lock:
    case None{}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- Instance.admit_with_file_start(database,directory,argv,cwd,stderr,artifact_name,artifact_bytes,initial_stdin,keep_stdin,0,recovery_argv)
      IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Instance.started(result))
    case Some{value_lock}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- Instance.admit_with_file_start(database,directory,argv,cwd,stderr,artifact_name,artifact_bytes,initial_stdin,keep_stdin,value_lock,recovery_argv)
      IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Instance.started(result))

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

# Writes one atomic record carrying the consumed offset and the reducer state the
# caller committed after its own durable store and reducer effects for that
# frame. The state is versioned JSON text and the schema is supplied explicitly;
# the record is bound to this attempt's manifest, native process and spool file.
def Instance.commit(handle: U32, schema: U32, state: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Returns the persisted reducer state and positions the reader at the validated
# matching offset. An empty String means no usable checkpoint and offset zero: a
# corrupted or stale record returns empty with a durable diagnostic, while an
# actual transport or effect error returns a failure.
def Instance.restore(handle: U32, schema: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

# Rewinds this admitted reader to the beginning after its own decode of the
# restored state was rejected. The child, its custody and its spool are
# untouched; the reader replays with its own deduplication.
def Instance.replay(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# A compact reference to a retained job: the owner-side attempt identity when an
# owner holds it, the retained output extent, the committed checkpoint offset and
# the terminal status when it is recorded. One attempt has one observation owner;
# any number of callers read the retained result through this reference.
def Instance.job(database: String, directory: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

def Instance.started(result: Result<&1,&1,U32 & String,Maybe<U32> & String>) -> Result<&1,&1,U32 & String,P.RetainedStart>:
  match result:
    case Fail{error}: Fail{error}
    case Done{(handle,error)}:
      match handle:
        case Some{value}: Done{P.Retained{value}}
        case None{}: Done{P.Unstarted{error}}

def Instance.admit_with_file_start(database: String, directory: String, argv: String, cwd: String, stderr: String, artifact_name: String, artifact_bytes: String, initial_stdin: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32> & String>):
  import "./process-spawn.c"

# The prepared file-input variant on the shared owner: the same private artifact
# preparation and identity binding as ProcessChild.retain_with_file, with the
# owner elected for the database instead of a keeper per attempt.
def Instance.admit_with_file(database: String, directory: String, argv: String, cwd: String, stderr: String, artifact_name: String, artifact_bytes: String, initial_stdin: String, keep_stdin: U32, lock: Maybe<U32>, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  match lock:
    case None{}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- Instance.admit_with_file_start(database,directory,argv,cwd,stderr,artifact_name,artifact_bytes,initial_stdin,keep_stdin,0,recovery_argv)
      IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Instance.started(result))
    case Some{value_lock}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- Instance.admit_with_file_start(database,directory,argv,cwd,stderr,artifact_name,artifact_bytes,initial_stdin,keep_stdin,value_lock,recovery_argv)
      IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Instance.started(result))

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
