# Retained-launch fixture for DSH. It exercises DSH_HOME, patch preparation,
# argv composition and admission under the shared instance owner.
import Base
import ../src/coordinator/turn.bend as Turn
import ../src/harness/dsh-player.bend as Dsh
import ../src/host/process.bend as P
import ../src/host/instance.bend as Custody
import ../src/host/session-lock.bend as Lock
import ../src/git/text.bend as Tx
import ../src/storage/state.bend as Storage

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

def admit(+db: String, +directory: String, +cmd: String, +model: String, +effort: String, native: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    home : String <- Turn.dsh_home(db,canonical,"dsh-fixture")
    prepared : Result<&1,&1,U32 & String,Dsh.Prepared> <- Turn.dsh_prepare_if(True{},directory,model,effort)
    launch : Turn.RetainedLaunch <- IO.try(Turn.RetainedLaunch,Turn.retained_launch_checked(prepared,True{},"",home,cmd,model,effort,native,False{},"","fixture task",False{},False{},"default",True{}))
    start : P.RetainedStart <- IO.try(P.RetainedStart,Turn.retained_admit(canonical,directory,".","fixture task",0,P.argv(["/bin/true"]),launch))
    admission_value(start)

def storage_mode(selected: Bool, +directory: String, +path: String, phase: String) -> IO(Unit):
  match selected:
    case True{}: do IO<Unit>:
      +rows : List<&2,Storage.ExecutionRow> <- IO.pure(List<&2,Storage.ExecutionRow>,[Storage.ExecutionRow{"dsh-fixture","turn",directory,phase,""}])
      IO.print("owners\t" ++ Tx.join(",",Storage.execution_owners(rows,path,Nil{})))
      IO.print("active\t" ++ Storage.active_execution(rows,path))
    case False{}: IO.die(Unit,2,"expected storage mode")

def instance_mode(owner: Bool, shutdown: Bool, db: String) -> IO(Unit):
  match owner:
    case True{}: IO.try(Unit,Custody.Instance.owner(db))
    case False{}:
      match shutdown:
        case True{}: IO.try(Unit,Custody.Instance.shutdown(db))
        case False{}: IO.die(Unit,2,"expected instance mode")

def admission_mode(selected: Bool, db: String, directory: String, cmd: String, model: String, effort: String, native: String) -> IO(Unit):
  match selected:
    case True{}: admit(db,directory,cmd,model,effort,native)
    case False{}: IO.die(Unit,2,"expected admission mode")

def run(args: List<String>) -> IO(Unit):
  match args:
    case +mode <> +db <> Nil{}:
      instance_mode(String.eq(mode,"--instance-owner"),String.eq(mode,"shutdown"),db)
    case +mode <> +directory <> +path <> +phase <> Nil{}:
      storage_mode(String.eq(mode,"storage"),directory,path,phase)
    case +mode <> +db <> +directory <> +cmd <> +model <> +effort <> +native <> Nil{}:
      admission_mode(String.eq(mode,"admit"),db,directory,cmd,model,effort,native)
    case +db <> +directory <> +cmd <> +model <> +effort <> +native <> Nil{}: do IO<Unit>:
      canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
      home : String <- Turn.dsh_home(db,canonical,"dsh-fixture")
      prepared : Result<&1,&1,U32 & String,Dsh.Prepared> <- Turn.dsh_prepare_if(True{},directory,model,effort)
      prefix : String <- IO.pure(String,P.argv(["/usr/bin/env","BATON_SESSION=dsh-fixture"]))
      launch : Result<&1,&1,U32 & String,Turn.RetainedLaunch> <- Turn.retained_launch_checked(prepared,True{},prefix,home,cmd,model,effort,native,False{},"","fixture task",False{},False{},"default",False{})
      launch_value(launch)
    case other: IO.die(Unit,2,"usage: dsh-retained DB DIRECTORY CMD MODEL EFFORT NATIVE")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
