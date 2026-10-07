import Base
import ./process.bend as P

# One owner process serves one canonical database. It holds every admitted
# attempt's stdin writer, wait authority and stdout spool, so an observer or a
# coordinator can exit without losing the native work or its output.
def Instance.owner(database: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Reads the live owner's token and epoch. Callers pass this witness to owner
# work admissions so a restarted owner cannot accept stale authority.
def Instance.owner_witness(database: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

# Starts a native attempt under the database owner and joins it as its observer.
# The result carries the attempt handle, or the reason no native child started.
def Instance.admit_start(database: String, directory: String, argv: String, cwd: String, stderr: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32> & String>):
  import "./process-spawn.c"

# Prepares owner custody, attaches this observer, and returns after its ready acknowledgment.
# The host binds the opaque managed-query bootstrap and reports its durable ready witness.
def Instance.prepare_start(database: String, directory: String, argv: String, cwd: String, stderr: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String, bootstrap: String, owner_witness: String) -> IO(Result<&1,&1,U32 & String,U32 & String & String>):
  import "./process-spawn.c"

# The artifact bytes are sealed into attempt custody before the owner reports ready.
def Instance.prepare_with_file_start(database: String, directory: String, argv: String, cwd: String, stderr: String, artifact_name: String, artifact_bytes: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String, bootstrap: String, owner_witness: String) -> IO(Result<&1,&1,U32 & String,U32 & String & String>):
  import "./process-spawn.c"

# The configured stderr bound is persisted in the attempt manifest. The complete
# stream remains in stderr.full and stderr.meta reports the final byte counts after
# native exit. The bound must be positive.
def Instance.prepare_with_file_bounded_start(database: String, directory: String, argv: String, cwd: String, stderr: String, stderr_limit: U32, artifact_name: String, artifact_bytes: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String, bootstrap: String, owner_witness: String) -> IO(Result<&1,&1,U32 & String,U32 & String & String>):
  import "./process-spawn.c"

# Applies an accepted Core decision that the managed caller matched to the bootstrap.
def Instance.start(handle: U32, bootstrap: String, decision: String, owner_witness: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Applies a rejected Core decision before any start was latched.
def Instance.cancel(handle: U32, bootstrap: String, decision: String, owner_witness: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Joins an existing attempt as its observer.
def Instance.attach(database: String, directory: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

# Reads the attached attempt's durable host lifecycle record and actual observer
# readiness, owner witness, and process status.
def Instance.state(handle: U32) -> IO(Result<&1,&1,U32 & String,String>):
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

def Instance.admit_with_file_bounded_start(database: String, directory: String, argv: String, cwd: String, stderr: String, stderr_limit: U32, artifact_name: String, artifact_bytes: String, initial_stdin: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32> & String>):
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

def Instance.admit_with_file_bounded(database: String, directory: String, argv: String, cwd: String, stderr: String, stderr_limit: U32, artifact_name: String, artifact_bytes: String, initial_stdin: String, keep_stdin: U32, lock: Maybe<U32>, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,P.RetainedStart>):
  match lock:
    case None{}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- Instance.admit_with_file_bounded_start(database,directory,argv,cwd,stderr,stderr_limit,artifact_name,artifact_bytes,initial_stdin,keep_stdin,0,recovery_argv)
      IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Instance.started(result))
    case Some{value_lock}: do IO<Result<&1,&1,U32 & String,P.RetainedStart>>:
      result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- Instance.admit_with_file_bounded_start(database,directory,argv,cwd,stderr,stderr_limit,artifact_name,artifact_bytes,initial_stdin,keep_stdin,value_lock,recovery_argv)
      IO.pure(Result<&1,&1,U32 & String,P.RetainedStart>,Instance.started(result))

# Opens a committed-change subscription on the elected owner for this database.
# The ok value carries the subscription handle and the readiness facts: the owner
# incarnation, the committed cursor the caller may replay rows up to, and whether
# a gap forces a fresh snapshot. Cursors are decimal text because this dialect has
# no 64-bit integer type; the host refuses a malformed or oversized value instead
# of truncating it.
def Instance.subscribe(database: String, after_cursor: String, expected_generation: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  import "./process-spawn.c"

# Waits for the next committed-change notice on a subscription and returns it as
# JSON: kind commit or gap, the committed cursor high-water, and the incarnation
# that sent it. A notice carries no row data; the caller rereads rows from SQLite
# up to the cursor inside its own read transaction.
def Instance.notice(handle: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

# Ends a subscription locally. The owner drops the connection when it reads the
# closed socket, so no request is needed.
def Instance.unsubscribe(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Publishes one committed change after the caller's transaction committed: the
# cursor is the durable native_changes high-water. The owner records it and
# notifies every subscriber, and a cursor that does not advance changes nothing.
# A rolled-back transaction publishes nothing because it never calls here.
def Instance.publish_commit(database: String, cursor: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

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
