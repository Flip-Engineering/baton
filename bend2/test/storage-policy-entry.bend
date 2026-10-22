# Focused storage entry. It calls the same Logs functions the coordinator
# entry calls for the storage commands, so the recorded answers are the
# coordinator's.
#
# usage: storage-policy-entry DB storage-policy
#        storage-policy-entry DB logs-storage
#        storage-policy-entry DB storage-preview SESSION
#        storage-policy-entry DB storage-apply SESSION
#        storage-policy-entry DB logs-clean SESSION
import Base
import ../src/coordinator/logs.bend as Logs

def print_result(+result: String) -> IO(Unit):
  IO.write(result)

def dispatch(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case "storage-policy" <> Nil{}: IO.write(Logs.storage_policy())
    case "logs-storage" <> Nil{}: do IO<Unit>:
      saved : String <- Logs.storage(db)
      print_result(saved)
    case "storage-preview" <> +session <> Nil{}: do IO<Unit>:
      saved : String <- Logs.storage_preview(db, session)
      print_result(saved)
    case "storage-apply" <> +session <> Nil{}: do IO<Unit>:
      saved : String <- Logs.storage_apply(db, session)
      print_result(saved)
    case "logs-clean" <> +session <> Nil{}: do IO<Unit>:
      saved : String <- Logs.clean(db, session)
      print_result(saved)
    case _: IO.die(Unit, 2, "usage: storage-policy-entry DB COMMAND ARGS")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case +db <> rest: dispatch(db, rest)
    case Nil{}: IO.die(Unit, 2, "usage: storage-policy-entry DB COMMAND ARGS")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
