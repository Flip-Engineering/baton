import Base
import ../src/host/codex-proxy.bend as Proxy

def main() -> IO(Unit):
  do IO<Unit>:
    +handle : U32 <- IO.try(U32,Proxy.CodexProxy.open())
    waiter : Chan(String) <- IO.fork(String,IO.try(String,Proxy.CodexProxy.next(handle)))
    sent : Unit <- IO.try(Unit,Proxy.CodexProxy.send(handle,"{\"id\":1,\"method\":\"transport-test\"}"))
    notice : String <- IO.join(String,waiter)
    shown_notice : Unit <- IO.print(notice)
    response : String <- IO.try(String,Proxy.CodexProxy.next(handle))
    shown_response : Unit <- IO.print(response)
    checked : Unit <- IO.try(Unit,Proxy.CodexProxy.cancel(handle,0))
    status : String <- IO.try(String,Proxy.CodexProxy.close(handle))
    IO.print(status)
