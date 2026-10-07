import Base

# argv contains each argument followed by NUL, including the executable.
# stderr is retained in a file so a child cannot block on an unread error pipe.
def ProcessChild.spawn(argv: String, cwd: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

# Retains full producer stderr at spool. After wait, stderr contains at most
# stderr_limit bytes and meta records exact observed/retained counts, truncation,
# and the spool path. The configured ceiling is source-controlled by the caller.
def ProcessChild.spawn_with_file_bounded(argv: String, cwd: String, stderr: String, stderr_limit: U32, spool: String, meta: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

type RetainedStart is Data:
  Retained{handle: U32}
  Unstarted{error: String}


# The prepared file input variant. The host creates the attempt directory, writes
# and flushes one private artifact of exactly these bytes inside it before any
# child is spawned, binds the artifact's name and the digest of its bytes into
# the admission identity, and leaves the caller's argv to name
# directory ++ "/" ++ artifact_name. `initial_stdin` is the only initial input.
def ProcessChild.retain_with_file(directory: String, argv: String, cwd: String, stderr: String, artifact_name: String, artifact_bytes: String, initial_stdin: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,RetainedStart>):
  import "./process-spawn.c"

# The bounded variant retains the complete stderr stream at stderr ++ ".full".
# After the child exits it writes at most stderr_limit bytes to stderr and records
# the observed and retained byte counts plus the full-spool path in stderr ++ ".meta".
# The limit is positive and is part of the durable attempt manifest.
def ProcessChild.retain_with_file_bounded(directory: String, argv: String, cwd: String, stderr: String, stderr_limit: U32, artifact_name: String, artifact_bytes: String, initial_stdin: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,RetainedStart>):
  import "./process-spawn.c"

def ProcessChild.retain_start(directory: String, argv: String, cwd: String, stderr: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32> & String>):
  import "./process-spawn.c"


def retained_start(result: Result<&1,&1,U32 & String,Maybe<U32> & String>) -> Result<&1,&1,U32 & String,RetainedStart>:
  match result:
    case Fail{error}: Fail{error}
    case Done{(handle,error)}:
      match handle:
        case Some{value}: Done{Retained{value}}
        case None{}: Done{Unstarted{error}}

# A keeper retains native input, output and process ownership across observer loss.
def ProcessChild.retain(directory: String, argv: String, cwd: String, stderr: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String) -> IO(Result<&1,&1,U32 & String,RetainedStart>):
  do IO<Result<&1,&1,U32 & String,RetainedStart>>:
    result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- ProcessChild.retain_start(directory,argv,cwd,stderr,initial,keep_stdin,lock,recovery_argv)
    IO.pure(Result<&1,&1,U32 & String,RetainedStart>,retained_start(result))

def ProcessChild.attach(directory: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

# A newly acquired session guard remains held while a dead keeper's attempt is observed.
def ProcessChild.attach_owned(directory: String, lock: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

# An unacknowledged launched attempt returns its original recovery invocation.
def ProcessChild.recovery_argv(directory: String) -> IO(Result<&1,&1,U32 & String,Maybe<String>>):
  import "./process-spawn.c"

# These commands address the retained attempt without replacing its observer.
# A write succeeds after all bytes enter stdin; native acceptance is separate.
def ProcessChild.control_write(directory: String, data: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Success records the signal syscall. Actual exit remains a separate observation.
def ProcessChild.control_signal(directory: String, sig: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def ProcessChild.release(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def ProcessChild.acknowledge(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

# Internal entry point; retain passes the lock descriptor through posix_spawn.
def ProcessChild.keeper(directory: String, lock: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def ProcessChild.write(handle: U32, data: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def ProcessChild.close_stdin(handle: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def ProcessChild.read_line(handle: U32) -> IO(Result<&1,&1,U32 & String,Maybe<String>>):
  import "./process-spawn.c"

def ProcessChild.wait(handle: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

def ProcessChild.signal(handle: U32, sig: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  import "./process-spawn.c"

def ProcessChild.input_closed(handle: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

def ProcessChild.pid(handle: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

def argv(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case arg <> rest: arg ++ SCon{Char.from_u32(0),SNil{}} ++ argv(rest)
