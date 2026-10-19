# Standalone Bend2 entry for the registered-session log cleanup service.
# usage: logs-clean-all DATABASE
import Base
import ./logs.bend as Logs

def run(database: String) -> IO(Unit):
  do IO<Unit>:
    result : String <- Logs.clean_all(database)
    IO.write(result ++ "\n")

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case database <> Nil{}:
      run(database)
    case other: IO.die(Unit,2,"usage: logs-clean-all DATABASE")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
