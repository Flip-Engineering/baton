# Focused fixture for the DSH player. It drives the real argument composition,
# patch preparation and event projection; no model provider is contacted.
import Base
import ../src/harness/dsh-player.bend as Dsh
import ../src/git/text.bend as Tx

def print_arg_list(+label: String, xs: List<String>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> rest: do IO<Unit>:
      IO.print(label ++ "\t" ++ head)
      print_arg_list(label,rest)

def print_argv(label: String, value: String) -> IO(Unit):
  print_arg_list(label,Tx.split_nul(value))

def print_prepared(result: Result<&1,&1,U32 & String,Dsh.Prepared>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit,2,"prepare failed")
    case Done{unit}: IO.print("prepared\tok")

def cli(args: List<String>) -> IO(Unit):
  match args:
    case "argv-fresh" <> home <> cmd <> model <> effort <> tools <> model_patch <> Nil{}:
      print_argv("arg",Dsh.argv(home,cmd,model,effort,tools,model_patch,"",True{}))
    case "argv-resume" <> home <> cmd <> model <> effort <> tools <> model_patch <> session <> Nil{}:
      print_argv("arg",Dsh.argv(home,cmd,model,effort,tools,model_patch,session,False{}))
    case "prepare" <> directory <> model <> effort <> hooks <> Nil{}: do IO<Unit>:
      result : Result<&1,&1,U32 & String,Dsh.Prepared> <- Dsh.prepare(directory,model,effort,hooks)
      print_prepared(result)
    case "kind" <> line <> Nil{}:
      IO.print("kind\t" ++ Dsh.kind(line))
    case "model" <> model <> Nil{}:
      IO.print("model\t" ++ Dsh.model_id(model))
    case "event" <> db <> line <> Nil{}: do IO<Unit>:
      value : String <- Dsh.event(db,line)
      IO.print("event\t" ++ value)
    case "usage" <> db <> line <> Nil{}: do IO<Unit>:
      value : String <- Dsh.usage(db,line)
      IO.print("usage\t" ++ value)
    case other: IO.die(Unit,2,"unknown fixture command")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
