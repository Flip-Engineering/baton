import Base
import ../src/coordinator/control.bend as Control
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/host/instance.bend as Custody

def write_command(db: String, command: C.Command) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,Store.apply(db,command))
    IO.write(saved)

def ensure(db: String) -> IO(Unit):
  do IO<Unit>:
    ready : Unit <- Store.ensure_before_begin(db)
    IO.write("{}\n")

def run(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case +flag <> +db <> Nil{}:
      Bool.pick(IO(Unit),String.eq(flag,"--ensure-schema"),ensure(db),
        Bool.pick(IO(Unit),String.eq(db,"players"),write_command(flag,C.Players{}),
          IO.die(Unit,2,"Unsupported recruitment fixture command.")))
    case db <> verb <> id <> Nil{}:
      write_command(db,C.Session{id})
    case db <> verb <> id <> harness <> native <> endpoint <> Nil{}:
      write_command(db,C.Attach{id,harness,native,endpoint})
    case db <> verb <> id <> command <> log <> Nil{}:
      do IO<Unit>:
        saved : String <- Control.receiver(db,id,command,log,"")
        IO.write(saved)
    case db <> verb <> id <> parent <> harness <> model <> effort <> repo <> branch <> path <> base <> Nil{}:
      Control.recruit(db,id,parent,harness,model,effort,repo,branch,path,base)
    case db <> verb <> id <> parent <> harness <> model <> effort <> path <> Nil{}:
      Control.join(db,id,parent,harness,model,effort,path)
    case other: IO.die(Unit,2,"Unsupported recruitment fixture command.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
