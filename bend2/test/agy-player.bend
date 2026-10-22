# Focused fixture for the agy player. It drives the real argument composition,
# user frame encoding and event projection; no model provider is contacted.
import Base
import ../src/harness/agy-player.bend as Agy
import ../src/git/text.bend as Tx

def print_arg_list(+label: String, xs: List<String>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> rest: do IO<Unit>:
      IO.print(label ++ "\t" ++ head)
      print_arg_list(label,rest)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case "arguments" <> cmd <> model <> effort <> Nil{}:
      print_arg_list("arg",Agy.arguments(cmd,model,effort))
    case "argv-fresh" <> cmd <> model <> effort <> session <> Nil{}:
      print_arg_list("arg",Agy.argv(cmd,model,effort,session,True{}))
    case "argv-resume" <> cmd <> model <> effort <> session <> Nil{}:
      print_arg_list("arg",Agy.argv(cmd,model,effort,session,False{}))
    case "frame" <> text <> Nil{}:
      IO.print("frame\t" ++ Tx.trim_nl(Agy.user_frame(text)))
    case "kind" <> line <> Nil{}:
      IO.print("kind\t" ++ Agy.kind(line))
    case "admitted" <> kind <> Nil{}:
      IO.print("admitted\t" ++ Bool.pick(String,Agy.admitted(kind),"true","false"))
    case "event" <> db <> line <> Nil{}: do IO<Unit>:
      value : String <- Agy.event(db,line)
      IO.print("event\t" ++ value)
    case "usage" <> db <> line <> Nil{}: do IO<Unit>:
      value : String <- Agy.usage(db,line)
      IO.print("usage\t" ++ value)
    case other: IO.die(Unit,2,"unknown fixture command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
