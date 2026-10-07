import Base
import ../host/instance.bend as Instance

# The view server starts this ordinary CLI command for each event stream. The
# subscription handle belongs to the elected native database owner; stdout is
# the line protocol used by the Node loopback server.
def notice_lines(handle: U32) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Instance.notice(handle)
    match result:
      case Fail{error}:
        closed : Result<&1,&1,U32 & String,Unit> <- Instance.unsubscribe(handle)
        IO.die(Unit,2,"The native change subscription ended: " ++ error)
      case Done{+notice}:
        written : Unit <- IO.write(notice ++ "\n")
        notice_lines(handle)

# Readiness is the first line. It is sent only after the owner has atomically
# registered the subscriber and returned the generation/cursor/gap facts.
def run(db: String, after_cursor: String, generation: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,U32 & String> <- Instance.subscribe(db,after_cursor,generation)
    match result:
      case Fail{error}: IO.die(Unit,2,"The native owner subscription failed: " ++ error)
      case Done{(handle,readiness)}:
        ready : Unit <- IO.write(readiness ++ "\n")
        notice_lines(handle)
