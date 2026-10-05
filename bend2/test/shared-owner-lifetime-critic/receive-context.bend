import Base
import ../../src/context/receive-request.bend as R

def stream(value: String) -> R.Stream:
  match value:
    case "stderr": R.Stderr{}
    case other: R.Stdout{}

def stream_name(value: R.Stream) -> String:
  match value:
    case R.Stdout{}: "stdout"
    case R.Stderr{}: "stderr"

def correlation(value: R.Correlation) -> String:
  match value:
    case R.Correlation{database,owner,request,session}:
      database ++ ":" ++ owner ++ ":" ++ request ++ ":" ++ session

def frame(value: R.OutputFrame) -> String:
  match value:
    case R.OutputFrame{identity,channel,cursor,bytes}:
      correlation(identity) ++ ":" ++ stream_name(channel) ++ ":" ++ cursor ++ ":" ++ bytes

def route(value: R.OutputRoute) -> String:
  match value:
    case R.Matched{output}: "matched:" ++ frame(output)
    case R.Mismatched{output}: "mismatched:" ++ frame(output)

def wake(value: Maybe<String>) -> String:
  match value:
    case None{}: "none"
    case Some{message}: "some:" ++ message

def cli(args: List<String>) -> IO(Unit):
  match args:
    case "wake" <> message <> Nil{}: IO.print(wake(R.wake(message)))
    case "route" <> database <> owner <> request <> session <> channel <> cursor <> bytes <> Nil{}:
      IO.print(route(R.route(R.Correlation{"db","owner","request","session"},R.OutputFrame{R.Correlation{database,owner,request,session},stream(channel),cursor,bytes})))
    case other: IO.die(Unit,2,"Expected wake MESSAGE or route DATABASE OWNER REQUEST SESSION STREAM CURSOR BYTES.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)
