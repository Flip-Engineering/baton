# Focused fixture for the SQLite version note (#1485): runs one statement whose
# expression nests 300 parentheses and prints the answer or the failure text.
# SQLite before 3.46 refuses it with "parser stack overflow".
import Base
import ../src/host/sqlite.bend as DB

def answered(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{value}: IO.print("answer " ++ value)
    case Fail{(code,detail)}: IO.print("failure " ++ detail)

def main() -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(":memory:","SELECT ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((1))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))));")
    answered(result)
