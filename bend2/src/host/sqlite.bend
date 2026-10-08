import Base

def Sql.query(path: String, sql: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./sqlite.c"

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
