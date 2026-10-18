import Base
import ../src/host/files.bend as F
import ../src/host/process.bend as P

# Focused source-boundary entry for the environment specification effect:
#   api-key-spec SPEC RESULT
#   api-key-spec write PATH VALUE
# The first form spawns /bin/sh with a spec-provided environment and writes the
# value the child observes to RESULT. The second exercises Files.write_private.

def waited_result(waited: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match waited:
    case Fail{(code,detail)}: IO.die(Unit,2,detail)
    case Done{+status}: IO.print(status)

def spawn_waited(handle: U32, +result: String) -> IO(Unit):
  do IO<Unit>:
    waited : Result<&1,&1,U32 & String,String> <- P.ProcessChild.wait(handle)
    waited_result(waited)

def spawn_decided(spawned: Result<&1,&1,U32 & String,U32>, +result: String) -> IO(Unit):
  match spawned:
    case Fail{(code,detail)}: IO.die(Unit,2,detail)
    case Done{handle}: spawn_waited(handle,result)

def spawn(spec: String, +result: String) -> IO(Unit):
  do IO<Unit>:
    command : String = "/bin/sh"
    args : List<String> = Con{"-c",Con{"printf %s \"$BATON_SPEC_VALUE\" > " ++ result,Nil{}}}
    spawned : Result<&1,&1,U32 & String,U32> <- P.ProcessChild.spawn_env_spec(spec,P.argv(Con{command,args}),".","")
    spawn_decided(spawned,result)

def write_decided(written: Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  match written:
    case Fail{(code,detail)}: IO.die(Unit,2,detail)
    case Done{value}: IO.print("written")

def write(path: String, value: String) -> IO(Unit):
  do IO<Unit>:
    written : Result<&1,&1,U32 & String,Unit> <- F.Files.write_private(path,value)
    write_decided(written)

def dispatch(arguments: List<String>) -> IO(Unit):
  match arguments:
    case "write" <> +path <> +value <> Nil{}: write(path,value)
    case +spec <> +result <> Nil{}: spawn(spec,result)
    case other: IO.die(Unit,2,"SPEC RESULT | write PATH VALUE")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    dispatch(arguments)
