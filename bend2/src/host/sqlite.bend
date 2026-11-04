import Base

def Sql.query(path: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Runs `sql` with the spool byte range bound as parameter 1. The bytes stay in
# the immutable stdout spool and never become a Bend String. Rows use the
# Sql.query format.
def Sql.query_span(path: String, spool: String, offset: String, length: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# The same binding with `text` as parameter 2.
def Sql.query_span_text(path: String, spool: String, offset: String, length: String, sql: String, text: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# The same binding with `first` and `second` as parameters 2 and 3.
def Sql.query_span_2text(path: String, spool: String, offset: String, length: String, sql: String, first: String, second: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Opens the existing coordination database at `path` read-write and returns its
# canonical physical-instance binding. A missing, read-only, in-memory,
# URI-selected, moved or otherwise unqualified database is refused before any
# caller SQL runs.
def Sql.binding(path: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Acquires one stable role lock file named from the verified physical database
# tuple and a caller supplied role digest. The returned descriptor holds the
# physical role until the caller closes it or exits; owner incarnation must be
# checked separately at each owner work admission.
def Sql.role_guard(path: String, binding: String, role_key: String) -> IO(Result<&1, &1, U32 & String, U32>):
  import "./sqlite.c"

# Observes the binding of `path` on a fresh connection and compares it with
# `expected` before running `sql`. A mismatch is refused without executing the
# caller SQL; a match returns rows in the same format as Sql.query.
def Sql.query_bound(path: String, binding: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Opens an existing database read-only and returns rows in the same format as
# Sql.query. Ordinary reads may reuse a connection within the current IO helper
# thread. SQL that changes connection-local state runs, then its connection closes.
# Sql.binding and Sql.role_guard establish physical database binding and role custody.
def Sql.read(path: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Installs the coordinator change projection and its triggers in one write transaction.
def Sql.ensure_projection(path: String, schema: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"
