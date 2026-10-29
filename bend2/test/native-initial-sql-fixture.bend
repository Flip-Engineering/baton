import Base
import ../src/coordinator/commands.bend as C
import ../src/coordinator/native-initial-input.bend as N

# Prints the statements the native initial input builds, so a test can prepare
# and run them on the system SQLite library.
def usage() -> IO(Unit):
  IO.die(Unit,2,"usage: native-initial-sql-fixture schema | recipient SESSION | predecessor SESSION INPUTS_JSON")

def run(args: List<String>) -> IO(Unit):
  match args:
    case "schema" <> Nil{}: IO.write(C.schema() ++ N.schema())
    case "recipient" <> +session <> Nil{}: IO.write("SELECT " ++ C.report_recipient(C.q(session)) ++ ";")
    case "predecessor" <> +session <> +inputs <> Nil{}: IO.write(N.predecessor_sql(session,inputs))
    case other: usage()

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
