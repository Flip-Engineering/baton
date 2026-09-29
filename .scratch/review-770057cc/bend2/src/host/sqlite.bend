import Base

def Sql.query(path: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"
