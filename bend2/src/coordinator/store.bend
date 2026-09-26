import Base
import ../host/sqlite.bend as DB
import ./commands.bend as C

# Each call completes its transaction before returning the command result.
def apply(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;")
