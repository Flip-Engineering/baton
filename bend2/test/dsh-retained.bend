# Bounded retained-launch fixture for DSH. It exercises the real DSH_HOME
# derivation, patch preparation and retained argv composition without the
# instance owner, so it needs no Store.apply or publish_commit.
import Base
import ../src/coordinator/turn.bend as Turn
import ../src/harness/dsh-player.bend as Dsh
import ../src/host/process.bend as P
import ../src/git/text.bend as Tx

def print_arg_list(+label: String, xs: List<String>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> rest: do IO<Unit>:
      IO.print(label ++ "\t" ++ head)
      print_arg_list(label,rest)

def print_launch(launch: Turn.RetainedLaunch) -> IO(Unit):
  match launch:
    case Turn.Prepared{+arguments,+input,+initial,+keep_stdin,file_input}: do IO<Unit>:
      print_arg_list("arg",Tx.split_nul(arguments))
      IO.print("input\t" ++ input)
      IO.print("keep\t" ++ U32.show(keep_stdin))
      IO.print("file\t" ++ Bool.pick(String,file_input,"true","false"))

def launch_value(result: Result<&1,&1,U32 & String,Turn.RetainedLaunch>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit,2,"retained launch failed")
    case Done{+launch}: print_launch(launch)

def run(args: List<String>) -> IO(Unit):
  match args:
    case +db <> +directory <> +cmd <> +model <> +effort <> +native <> Nil{}: do IO<Unit>:
      home : String <- Turn.dsh_home(db,db,"dsh-fixture")
      prepared : Result<&1,&1,U32 & String,Dsh.Prepared> <- Dsh.prepare(directory,model,effort)
      prefix : String <- IO.pure(String,P.argv(["/usr/bin/env","BATON_SESSION=dsh-fixture"]))
      launch : Result<&1,&1,U32 & String,Turn.RetainedLaunch> <- Turn.retained_launch_checked(prepared,True{},prefix,home,cmd,model,effort,native,False{},"","","fixture task",False{},False{},"default",False{})
      launch_value(launch)
    case other: IO.die(Unit,2,"usage: dsh-retained DB DIRECTORY CMD MODEL EFFORT NATIVE")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
