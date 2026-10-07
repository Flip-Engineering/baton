import Base
import ../host/sqlite.bend as DB

# Read the durable cursor after the caller's write transaction has committed.
# Instance.publish_commit receives this decimal text and sends a cursor-only
# notification to the elected database owner.
def high_water_sql() -> String:
  "SELECT CAST(coalesce(max(change_id),0) AS TEXT) FROM native_changes;"

def committed_high_water(+db: String) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.query(db,high_water_sql())
