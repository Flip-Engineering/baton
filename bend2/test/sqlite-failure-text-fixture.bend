import Base
import ../src/host/sqlite.bend as DB

# Runs one SQL text through DB.Sql.query or DB.Sql.read and prints the answer,
# so a test can read the failure text a locked database produces.
def report(result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{+out}: IO.write("ok\n" ++ out)
    case Fail{(+code,+text)}: IO.write("failed " ++ U32.show(code) ++ ": " ++ text ++ "\n")

def query(+db: String, +sql: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,sql)
    report(result)

def read(+db: String, +sql: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,sql)
    report(result)

def run(args: List<String>) -> IO(Unit):
  match args:
    case "query" <> +db <> +sql <> Nil{}: query(db,sql)
    case "read" <> +db <> +sql <> Nil{}: read(db,sql)
    case other: IO.die(Unit,2,"usage: sqlite-failure-text-fixture query DB SQL | read DB SQL")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
