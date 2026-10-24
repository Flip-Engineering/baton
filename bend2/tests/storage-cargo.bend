# Functional entry for Cargo output and the service-owned selection reader.
import Base
import ../src/storage/cargo.bend as Cargo
import ../src/storage/types.bend as T
import ../src/storage/lifecycle.bend as Lifecycle
import ../src/storage/observe.bend as O

def selected(+directory: String, +path: String) -> IO(T.Presence):
  Bool.pick(IO(T.Presence), String.is_empty(directory), Cargo.unknown_selection(path), Cargo.baton_selection(directory, path))

def show_result(result: O.RemoveResult) -> String:
  match result:
    case O.RemoveRemoved{bytes}: "removed\t" ++ Nat.show(bytes)
    case O.RemoveAbsent{}: "already-absent"
    case O.RemoveChanged{}: "changed"
    case O.RemoveRefused{detail}: "refused\t" ++ detail

def show_collection(result: Cargo.Collection) -> String:
  match result:
    case Cargo.Kept{reason}: "kept\t" ++ reason
    case Cargo.Applied{answer}: show_result(answer)

def show_output(output: Cargo.Output) -> String:
  match output:
    case Cargo.Cargo{identity, origin}: "cargo\t" ++ identity ++ "\t" ++ origin
    case Cargo.Unclassified{}: "unclassified"
    case Cargo.Unreadable{detail}: "unreadable\t" ++ detail

def args(arguments: List<String>) -> IO(Unit):
  match arguments:
    case "apply" <> db <> session <> Nil{}: Lifecycle.run_apply(db, session)
    case "preview" <> db <> session <> Nil{}: Lifecycle.run_preview(db, session)
    case "probe" <> path <> Nil{}: do IO<Unit>:
      output : Cargo.Output <- Cargo.observe(path)
      IO.print(show_output(output))
    case "collect" <> path <> associated <> db <> directory <> Nil{}: do IO<Unit>:
      result : Cargo.Collection <- Lifecycle.cargo_release(db, path, associated,
        candidate => selected(directory, candidate))
      IO.print(show_collection(result))
    case other: IO.die(Unit, 2, "storage-cargo probe PATH | collect PATH BUILD DB COMMAND_DIRECTORY")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    args(arguments)
