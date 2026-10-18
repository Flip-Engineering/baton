import Base
import ../src/host/sqlite.bend as DB

def report_result(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.print("span-error:" ++ U32.show(code) ++ ":" ++ text)
    case Done{text}: IO.print("span-value:" ++ text)

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case db <> spool <> offset <> length <> Nil{}:
      do IO<Unit>:
        result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_span(db,spool,offset,length,"SELECT json_valid(?1), coalesce(json_extract(?1,'$.ok'),'');")
        report_result(result)
    case _: IO.die(Unit,2,"DB SPOOL OFFSET LENGTH")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
