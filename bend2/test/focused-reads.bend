# Focused command entry for the model discovery, observed usage and harness
# inventory reads (#792, #794). It calls the same module functions the
# coordinator entry calls for those commands, so the recorded answers and exit
# codes are the coordinator's. It also exposes attach and connect so a test
# driver can set up its fixtures without a full Main build.
#
# status is accepted and does nothing: the status projection lives in the
# control module, which this entry does not import. The one driver call that
# uses status only checks that the call succeeds before reading usage.
#
# usage: focused-reads DB attach SESSION HARNESS NATIVE ENDPOINT
#        focused-reads DB connect SESSION NATIVE ENDPOINT_JSON
#        focused-reads DB status
#        focused-reads DB models SESSION [--all]
#        focused-reads DB observed-usage SESSION
#        focused-reads DB harness-inventory
import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/usage.bend as Usage
import ../src/coordinator/subscription-fallback.bend as Subscription
import ../src/host/sqlite.bend as DB

def output(value: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,1,"No matching session or message; inspect status and the requested ID.")
    case False{}: IO.write(value)

def print_result(+result: String) -> IO(Unit):
  output(result, String.is_empty(result))

# The single statement a commit runs, as the store composes it.
def commit_sql(command: C.Command) -> String:
  "BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;"

def apply_command(+db: String, +command: C.Command) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String, DB.Sql.query(db,commit_sql(command)))
    print_result(result)

def read_status(+db: String) -> IO(Unit):
  IO.pure(Unit,Unit{})

def dispatch(+db: String, args: List<String>) -> IO(Unit):
  match args:
    case "attach" <> id <> harness <> native <> endpoint <> Nil{}: apply_command(db,C.Attach{id,harness,native,endpoint})
    case "connect" <> id <> native <> endpoint <> Nil{}: apply_command(db,C.Connect{id,native,endpoint})
    case "status" <> Nil{}: read_status(db)
    case "models" <> id <> "--all" <> Nil{}: Usage.models_all(db,id)
    case "models" <> id <> Nil{}: Usage.models(db,id)
    case "observed-usage" <> id <> Nil{}: Usage.observed_usage(db,id)
    case "harness-inventory" <> Nil{}: Subscription.inventory(db)
    case other: IO.die(Unit,2,"usage: focused-reads DB COMMAND ARGS")

def main_args(args: List<String>) -> IO(Unit):
  match args:
    case path <> rest: dispatch(path,rest)
    case Nil{}: IO.die(Unit,2,"usage: focused-reads DB COMMAND ARGS")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    main_args(args)
