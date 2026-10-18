import Base
import ../src/host/sqlite.bend as Sql
import ../src/coordinator/frame-span.bend as Frame

def report_result(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(code,text)}: IO.print("span-error:" ++ U32.show(code) ++ ":" ++ text)
    case Done{text}: IO.print("span-value:" ++ text)

def run_query(db: String, spool: String, offset: String, length: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- Sql.query_span(db,spool,offset,length,"SELECT json_valid(?1), coalesce(json_extract(?1,'$.ok'),'');")
    report_result(result)

def report_span(expected: String, span: Maybe<FrameSpan>) -> IO(Unit):
  match span:
    case None{}: IO.print("token-refused")
    case Some{span}: IO.print(Bool.pick(String,String.eq(Frame.spool(span),expected),"token-accepted","wrong-spool-accepted"))

def report_token(expected: String, token: String) -> IO(Unit):
  report_span(expected,Frame.span_of(token))

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case "query" <> db <> spool <> offset <> length <> Nil{}: run_query(db,spool,offset,length)
    case "token" <> expected <> token <> Nil{}: report_token(expected,token)
    case _: IO.die(Unit,2,"query DB SPOOL OFFSET LENGTH | token EXPECTED_SPOOL TOKEN")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
