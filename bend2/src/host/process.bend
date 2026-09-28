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

def ProcessChild.attach(directory: String) -> IO(Result<&1,&1,U32 & String,U32>):
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

def ProcessChild.exited(handle: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

def ProcessChild.pid(handle: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

def argv(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case arg <> rest: arg ++ SCon{Char.from_u32(0),SNil{}} ++ argv(rest)
