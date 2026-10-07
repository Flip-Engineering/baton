import Base
import ../host/instance.bend as Custody

# The view server starts this ordinary CLI command for each event stream. The
# subscription handle belongs to the elected native database owner; stdout is
# the line protocol used by the Node loopback server.
def notice_loop(handle: U32, result: Result<&1,&1,U32 & String,String>, again: Unit -> IO(Unit)) -> IO(Unit):
  match result:
    case Fail{(code,text)}: do IO<Unit>:
      closed : Result<&1,&1,U32 & String,Unit> <- Custody.Instance.unsubscribe(handle)
      IO.die(Unit,code,"The native change subscription ended: " ++ text)
    case Done{+notice}: do IO<Unit>:
      written : Unit <- IO.write(notice ++ "\n")
      again(Unit{})

def notice_lines(handle: U32) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Custody.Instance.notice(handle)
    notice_loop(handle,result,unit => notice_lines(handle))

def subscription_result(result: Result<&1,&1,U32 & String,U32 & String>) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.die(Unit,code,"The native owner subscription failed: " ++ text)
    case Done{(handle,readiness)}: do IO<Unit>:
      ready : Unit <- IO.write(readiness ++ "\n")
      notice_lines(handle)

# Readiness is the first line. It is sent only after the owner has atomically
# registered the subscriber and returned the generation/cursor/gap facts.
def run(db: String, after_cursor: String, generation: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,U32 & String> <- Custody.Instance.subscribe(db,after_cursor,generation)
    subscription_result(result)
