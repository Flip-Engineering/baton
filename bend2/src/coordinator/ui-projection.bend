import Base
import ../host/sqlite.bend as DB
import ../host/instance.bend as Custody
import ../git/text.bend as Tx

# Read the durable cursor after the caller's write transaction has committed.
# Custody.Instance.publish_commit receives this decimal text and sends a cursor-only
# notification to the elected database owner.
def high_water_sql() -> String:
  "SELECT CAST(coalesce(max(change_id),0) AS TEXT) FROM native_changes;"

def committed_high_water(+db: String) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.query(db,high_water_sql())

def publish_committed(+db: String, high_water: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match high_water:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{+cursor}: Custody.Instance.publish_commit(db,Tx.trim_nl(cursor))
