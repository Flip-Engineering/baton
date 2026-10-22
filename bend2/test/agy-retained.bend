# Retained-launch fixture for agy. It composes the retained launch through the real
# coordinator wiring (Turn.retained_launch_checked, agy branch) and, in admit mode,
# admits it through the instance owner (Turn.retained_admit). The admitted child is the
# fake agy, so the fixture observes the argv, the stdin frame and the stdin close.
#   launch CMD DIRECTORY MODEL EFFORT NATIVE INITIAL
#   admit DB DIRECTORY CMD MODEL EFFORT NATIVE INITIAL
#   shutdown DB
import Base
import ../src/coordinator/turn.bend as Turn
import ../src/harness/dsh-player.bend as Dsh
import ../src/host/process.bend as P
import ../src/host/instance.bend as Custody
import ../src/host/session-lock.bend as Lock
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
    case Fail{error}: IO.die(Unit,2,"agy retained launch failed")
    case Done{+launch}: print_launch(launch)

# The coordinator passes the prepared DSH patches through; the agy branch ignores them.
def unused_prepared() -> Result<&1,&1,U32 & String,Dsh.Prepared>:
  Done{Dsh.Prepared{"",""}}

@unsafe
def admitted_lines(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case Some{text}: do IO<Unit>:
      IO.print(text)
      next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      admitted_lines(handle,next)
    case None{}: do IO<Unit>:
      status : String <- IO.try(String,P.ProcessChild.wait(handle))
      IO.print("native-" ++ status)
      released : Unit <- IO.try(Unit,P.ProcessChild.release(handle))
      acknowledged : Unit <- IO.try(Unit,P.ProcessChild.acknowledge(handle))
      IO.try(Unit,Custody.Instance.retire(handle))

def admission_value(start: P.RetainedStart) -> IO(Unit):
  match start:
    case P.Unstarted{error}: IO.die(Unit,2,error)
    case P.Retained{+handle}: do IO<Unit>:
      line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      admitted_lines(handle,line)

def launch_mode(directory: String, cmd: String, model: String, effort: String, native: String, initial: String) -> IO(Unit):
  do IO<Unit>:
    launch : Result<&1,&1,U32 & String,Turn.RetainedLaunch> <- Turn.retained_launch_checked(unused_prepared(),False{},True{},"","",cmd,model,effort,native,False{},"",initial,False{},False{},"default",False{})
    launch_value(launch)

def admit(+db: String, +directory: String, +cmd: String, model: String, effort: String, native: String, +initial: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    launch : Turn.RetainedLaunch <- IO.try(Turn.RetainedLaunch,Turn.retained_launch_checked(unused_prepared(),False{},True{},"","",cmd,model,effort,native,False{},"",initial,False{},False{},"default",False{}))
    start : P.RetainedStart <- IO.try(P.RetainedStart,Turn.retained_admit(canonical,directory,".",initial,0,P.argv(["/bin/true"]),launch))
    admission_value(start)

def shutdown(db: String) -> IO(Unit):
  IO.try(Unit,Custody.Instance.shutdown(db))

def run(args: List<String>) -> IO(Unit):
  match args:
    case "launch" <> cmd <> directory <> model <> effort <> native <> initial <> Nil{}:
      launch_mode(directory,cmd,model,effort,native,initial)
    case "admit" <> db <> directory <> cmd <> model <> effort <> native <> initial <> Nil{}:
      admit(db,directory,cmd,model,effort,native,initial)
    case "shutdown" <> db <> Nil{}:
      shutdown(db)
    case other: IO.die(Unit,2,"usage: agy-retained launch|admit|shutdown ...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
