import Base

def Sql.query(path: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
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

# Opens an existing database read-only, refuses an invalid UTF-8 path or statement,
# runs no write pragma, and returns rows in the same format as Sql.query. This is a
# separate connection from every other call: it checks nothing about a binding and
# it establishes no custody.
def Sql.read(path: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Installs the coordinator change projection and its triggers in one write transaction.
def Sql.ensure_projection(path: String, schema: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

# Composed from the native-context lineage for the fixed coordinator:
# Sql.binding and Sql.role_guard at aa4ee4e6 on
# codex/native-context-managed-successor-luna-20261007, with the host-result
# typing fix from 022dcd95, qualified at dc1f0aa7 with the corrected
# role_guard(path, binding, role_key) signature carrying the descriptor.
# The binding names the canonical physical database
# instance; the role guard holds one physical role until close or process
# death. The coordinator owns these declarations on this branch; the C body in
# ./sqlite.c is the matching composed hunk.
def Sql.binding(path: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

def Sql.role_guard(path: String, binding: String, role_key: String) -> IO(Result<&1, &1, U32 & String, U32>):
  import "./sqlite.c"
