import Base
import ../../src/context/receive-request.bend as R

def show_stream(stream: R.Stream) -> String:
  match stream:
    case R.Stdout{}: "stdout"
    case R.Stderr{}: "stderr"

def show_frame(frame: R.OutputFrame) -> String:
  match frame:
    case R.OutputFrame{correlation,stream,cursor,bytes}: show_stream(stream) ++ ":" ++ cursor ++ ":" ++ bytes

def show(value: R.OutputRoute) -> String:
  match value:
    case R.Matched{frame}: "matched:" ++ show_frame(frame)
    case R.Mismatched{frame}: "mismatched:" ++ show_frame(frame)

def show_wake(value: Maybe<String>) -> IO(Unit):
  match value:
    case None{}: IO.print("none")
    case Some{message}: IO.print("some:" ++ message)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Con{"wake",Con{message,Nil{}}}: show_wake(R.wake(message))
    case Con{"stderr",Con{database,Con{owner,Con{request,Con{session,Con{cursor,Con{bytes,Nil{}}}}}}}}:
      IO.print(show(R.route(R.Correlation{"db","owner","request","session"},R.OutputFrame{R.Correlation{database,owner,request,session},R.Stderr{},cursor,bytes})))
    case Con{database,Con{owner,Con{request,Con{session,Con{cursor,Con{bytes,Nil{}}}}}}}:
      IO.print(show(R.route(R.Correlation{"db","owner","request","session"},R.OutputFrame{R.Correlation{database,owner,request,session},R.Stdout{},cursor,bytes})))
    case other: IO.die(Unit,2,"Expected database, owner, request, session, cursor and bytes.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)
