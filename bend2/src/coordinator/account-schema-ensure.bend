import Base
import ../host/session-lock.bend as Lock
import ./accounts.bend as Accounts

def ensure_account_schema(+path: String) -> IO(Unit):
  do IO<Unit>:
    canonical : String <- IO.try(String,Lock.SessionLock.canonical(path))
    installed : String <- IO.try(String,Accounts.commit_read(canonical,""))
    IO.write("{\"schema\":\"baton2-account-schema-ensure-v1\",\"status\":\"ready\"}\n")

def main_arguments(arguments: List<String>) -> IO(Unit):
  match arguments:
    case +path <> Nil{}: ensure_account_schema(path)
    case other: IO.die(Unit,2,"usage: account-schema-ensure DATABASE")

def main() -> IO(Unit):
  do IO<Unit>:
    arguments : List<String> <- IO.args()
    main_arguments(arguments)
