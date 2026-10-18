import Base
import ../host/sqlite.bend as DB
import ../context/raw.bend as Raw
import ../context/request.bend as Req
import ../git/text.bend as Tx
import ../coordinator/commands.bend as C

def raw_result(result: Result<&1,&1,U32 & String,Raw.RawRead>) -> Result<&1,&1,U32 & String,String>:
  match result:
    case Fail{error}: Fail{error}
    case Done{read}:
      match read:
        case Raw.RawText{value}: Done{value}
        case Raw.RawInvalidUtf8{offset}: Fail{(2,"invalidUtf8 byte " ++ offset)}
        case Raw.RawNul{offset}: Fail{(2,"embeddedNul byte " ++ offset)}
        case Raw.RawBom{}: Fail{(2,"leadingBom")}

def text_value(path: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,Raw.RawRead> <- Raw.Raw.read_text_utf8(path)
    IO.pure(Result<&1,&1,U32 & String,String>,raw_result(result))

def input_scalar(scalar: Req.Scalar) -> IO(String):
  match scalar:
    case Req.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,2,"agent-native-input has an invalid Unicode scalar: " ++ Req.scalar_reason(other))

def input_field(fields: List<String>) -> IO(String):
  match fields:
    case encoded <> "end" <> Nil{}: input_scalar(Req.decode_scalar_utf8(Tx.hex_decode(encoded)))
    case other: IO.die(String,2,"agent-native-input has an incomplete encoded argument.")

def input_fields(rows: List<String>) -> IO(List<String>):
  match rows:
    case Nil{}: IO.pure(List<String>,Nil{})
    case row <> rest: do IO<List<String>>:
      value : String <- input_field(Tx.split_tabs(row))
      tail : List<String> <- input_fields(rest)
      IO.pure(List<String>,Con{value,tail})

# This private child input carries complete native arguments through stdin.
def input(+db: String) -> IO(List<String>):
  do IO<List<String>>:
    +body : String <- IO.try(String,text_value("-"))
    valid : String <- IO.try(String,DB.Sql.read(db,"SELECT CASE WHEN json_valid(" ++ C.q(body) ++ ") THEN CASE WHEN json_type(" ++ C.q(body) ++ ")='array' THEN NOT EXISTS(SELECT 1 FROM json_each(" ++ C.q(body) ++ ") WHERE type<>'text' OR instr(value,char(0))>0) ELSE 0 END ELSE 0 END;"))
    Bool.pick(IO(List<String>),String.eq(Tx.trim_nl(valid),"1"),
      (do IO<List<String>>:
        rows : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(value)||char(9)||'end' FROM json_each(" ++ C.q(body) ++ ") ORDER BY CAST(key AS INTEGER);"))
        input_fields(Tx.split_lines(rows))),
      IO.die(List<String>,2,"agent-native-input requires a complete JSON array of UTF-8 strings without NUL."))

