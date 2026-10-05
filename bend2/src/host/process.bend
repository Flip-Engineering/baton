import Base

# argv contains each argument followed by NUL, including the executable.
# stderr is retained in a file so a child cannot block on an unread error pipe.
def ProcessChild.spawn(argv: String, cwd: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

type RetainedStart is Data:
  Retained{handle: U32}
  Unstarted{error: String}


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

# Prepared mode retains the exact bootstrap identity and starts after a grant.
def ProcessChild.prepare_start(directory: String, argv: String, cwd: String, stderr: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String, identity: String) -> IO(Result<&1,&1,U32 & String,Maybe<U32> & String>):
  import "./process-spawn.c"

def ProcessChild.prepare(directory: String, argv: String, cwd: String, stderr: String, initial: String, keep_stdin: U32, lock: U32, recovery_argv: String, identity: String) -> IO(Result<&1,&1,U32 & String,RetainedStart>):
  do IO<Result<&1,&1,U32 & String,RetainedStart>>:
    result : Result<&1,&1,U32 & String,Maybe<U32> & String> <- ProcessChild.prepare_start(directory,argv,cwd,stderr,initial,keep_stdin,lock,recovery_argv,identity)
    IO.pure(Result<&1,&1,U32 & String,RetainedStart>,retained_start(result))

# Each answer is the keeper's structured state, including its birth identity.
def ProcessChild.start(handle: U32, identity: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

def ProcessChild.state(handle: U32) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

def ProcessChild.cancel_prepared(handle: U32, identity: String) -> IO(Result<&1,&1,U32 & String,String>):
  import "./process-spawn.c"

# The phase tag and retained JSON detail come from one locked keeper snapshot.
type PreparedState is Data:
  StatePrepared{detail: String}
  StateStarting{detail: String}
  StateRunning{detail: String}
  StateExited{detail: String}
  StateUnstarted{detail: String}
  StateUnknown{detail: String}
  StateCancelled{detail: String}

def prepared_state_detail(state: PreparedState) -> String:
  match state:
    case StatePrepared{detail}: detail
    case StateStarting{detail}: detail
    case StateRunning{detail}: detail
    case StateExited{detail}: detail
    case StateUnstarted{detail}: detail
    case StateUnknown{detail}: detail
    case StateCancelled{detail}: detail

def prepared_state_tag(tag: U32, detail: String) -> Result<&1,&1,U32 & String,PreparedState>:
  match tag:
    case 0: Done{StatePrepared{detail}}
    case 1: Done{StateStarting{detail}}
    case 2: Done{StateRunning{detail}}
    case 3: Done{StateExited{detail}}
    case 4: Done{StateUnstarted{detail}}
    case 5: Done{StateUnknown{detail}}
    case 6: Done{StateCancelled{detail}}
    case _: Fail{(22,"Invalid retained process state tag: " ++ detail)}

def prepared_state(result: Result<&1,&1,U32 & String,U32 & String>) -> Result<&1,&1,U32 & String,PreparedState>:
  match result:
    case Fail{error}: Fail{error}
    case Done{(tag,detail)}: prepared_state_tag(tag,detail)

def ProcessChild.start_snapshot(handle: U32, identity: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  import "./process-spawn.c"

def ProcessChild.state_snapshot(handle: U32) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  import "./process-spawn.c"

def ProcessChild.cancel_snapshot(handle: U32, identity: String) -> IO(Result<&1,&1,U32 & String,U32 & String>):
  import "./process-spawn.c"

def ProcessChild.start_typed(handle: U32, identity: String) -> IO(Result<&1,&1,U32 & String,PreparedState>):
  do IO<Result<&1,&1,U32 & String,PreparedState>>:
    result : Result<&1,&1,U32 & String,U32 & String> <- ProcessChild.start_snapshot(handle,identity)
    IO.pure(Result<&1,&1,U32 & String,PreparedState>,prepared_state(result))

def ProcessChild.state_typed(handle: U32) -> IO(Result<&1,&1,U32 & String,PreparedState>):
  do IO<Result<&1,&1,U32 & String,PreparedState>>:
    result : Result<&1,&1,U32 & String,U32 & String> <- ProcessChild.state_snapshot(handle)
    IO.pure(Result<&1,&1,U32 & String,PreparedState>,prepared_state(result))

def ProcessChild.cancel_typed(handle: U32, identity: String) -> IO(Result<&1,&1,U32 & String,PreparedState>):
  do IO<Result<&1,&1,U32 & String,PreparedState>>:
    result : Result<&1,&1,U32 & String,U32 & String> <- ProcessChild.cancel_snapshot(handle,identity)
    IO.pure(Result<&1,&1,U32 & String,PreparedState>,prepared_state(result))

law prepared_snapshot_keeps_its_unstarted_phase:
  for detail: String
  {prepared_state(Done{(0,detail)}) == Done{StatePrepared{detail}} : Result<&1,&1,U32 & String,PreparedState>}

def prepared_snapshot_keeps_its_unstarted_phase(detail):
  {==}

law unknown_snapshot_preserves_uncertainty:
  for detail: String
  {prepared_state(Done{(5,detail)}) == Done{StateUnknown{detail}} : Result<&1,&1,U32 & String,PreparedState>}

def unknown_snapshot_preserves_uncertainty(detail):
  {==}

law snapshot_transport_failure_is_preserved:
  for error: U32 & String
  {prepared_state(Fail{error}) == Fail{error} : Result<&1,&1,U32 & String,PreparedState>}

def snapshot_transport_failure_is_preserved(error):
  {==}

law typed_start_reads_one_original_identity_snapshot:
  for handle: U32
  for identity: String
  {ProcessChild.start_typed(handle,identity) == do IO<Result<&1,&1,U32 & String,PreparedState>>:
    result : Result<&1,&1,U32 & String,U32 & String> <- ProcessChild.start_snapshot(handle,identity)
    IO.pure(Result<&1,&1,U32 & String,PreparedState>,prepared_state(result))
   : IO(Result<&1,&1,U32 & String,PreparedState>)}

def typed_start_reads_one_original_identity_snapshot(handle,identity):
  {==}

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
