import Base
import ../host/sqlite.bend as DB
import ./commands.bend as C
import ./root.bend as Root

# Root delivery starts after the message transaction commits.
def committed(db: String, command: C.Command, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{saved}: Root.after(db,command,saved)
def commit(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;")

def apply(+db: String, +command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- commit(db,command)
    committed(db,command,result)
