import Base

# argv contains each argument followed by NUL, including the executable.
# stderr is retained in a file so a child cannot block on an unread error pipe.
def ProcessChild.spawn(argv: String, cwd: String, stderr: String) -> IO(Result<&1,&1,U32 & String,U32>):
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

def ProcessChild.pid(handle: U32) -> IO(Result<&1,&1,U32 & String,U32>):
  import "./process-spawn.c"

def argv(args: List<String>) -> String:
  match args:
    case Nil{}: ""
    case arg <> rest: arg ++ SCon{Char.from_u32(0),SNil{}} ++ argv(rest)
