import Base

def Sql.query(path: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Opens the existing coordination database at `path` read-write and returns its
# canonical physical-instance binding. A missing, read-only, in-memory,
# URI-selected, moved or otherwise unqualified database is refused before any
# caller SQL runs.
def Sql.binding(path: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Observes the binding of `path` on a fresh connection and compares it with
# `expected` before running `sql`. A mismatch is refused without executing the
# caller SQL; a match returns rows in the same format as Sql.query.
def Sql.query_bound(path: String, binding: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"
