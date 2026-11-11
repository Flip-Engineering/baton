import Base
import ../src/host/sqlite.bend as DB

def report(result: Result<&1, &1, U32 & String, String>) -> IO(Unit):
  match result:
    case Done{value}: IO.print("done:" ++ value)
    case Fail{(code, text)}: IO.print("fail:" ++ U32.show(code) ++ ":" ++ text)

def run_args(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: IO.pure(Unit,Unit{})
    case spool <> offset <> length <> sql <> rest:
      do IO<Unit>:
        result : Result<&1, &1, U32 & String, String> <- DB.Sql.query_span_memory(spool,offset,length,sql)
        reported : Unit <- report(result)
        run_args(rest)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run_args(args)
