import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/store.bend as Store
import ../src/coordinator/repl.bend as Repl
import ../src/coordinator/repl-model.bend as M
import ../src/host/instance.bend as Custody
import ../src/host/text.bend as T
import ../src/context/raw.bend as Raw

# A focused native entry for the REPL fixtures. It reaches the same command
# handler, notebook model and runtime as the normal coordinator for the
# attach, repl and repl-observe routes, without building the complete
# coordinator. The F2/F3 fixtures use it as .scratch/bend2/baton2.

def raw_anchor() -> IO(Unit):
  do IO<Unit>:
    _ : Raw.RawRead <- IO.try(Raw.RawRead,Raw.Raw.read_text_utf8("/dev/null"))
    IO.pure(Unit,Unit{})

def actor_for(db: String) -> IO(String):
  M.scalar(db,"SELECT id FROM sessions ORDER BY rowid LIMIT 1")

def attach(db: String, args: List<String>) -> IO(Unit):
  match args:
    case id <> harness <> native <> endpoint <> Nil{}: do IO<Unit>:
      result : String <- IO.try(String,Store.apply(db,C.Attach{id,harness,native,endpoint}))
      IO.write(result)
    case other: IO.die(Unit,2,"attach SESSION HARNESS NATIVE ENDPOINT")

def run(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case "attach" <> rest: attach(db,rest)
    case "as" <> actor <> "repl" <> rest: Repl.execute(db,actor,rest)
    case "repl" <> rest: do IO<Unit>:
      actor : String <- actor_for(db)
      Repl.execute(db,actor,rest)
    case "repl-observe" <> cell <> Nil{}: Repl.observe(db,cell)
    case "observe-file" <> id <> actor <> path <> Nil{}: do IO<Unit>:
      event : String <- IO.try(String,T.Text.read(path))
      saved : String <- IO.try(String,Store.apply(db,C.Observe{id,actor,event,False{},"fixture"}))
      IO.write(saved)
    case other: IO.die(Unit,2,"focused REPL entry: attach|repl|repl-observe")

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "--instance-owner" <> db <> Nil{}: IO.try(Unit,Custody.Instance.owner(db))
    case "--instance-shutdown" <> db <> Nil{}: IO.try(Unit,Custody.Instance.shutdown(db))
    case db <> rest: run(db,rest)
    case Nil{}: IO.die(Unit,2,"DATABASE ACTION")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
