import Base
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

# The retention count uses the unsigned integer representation read by Bend.
def tables() -> String:
  "CREATE TABLE IF NOT EXISTS log_policies (session TEXT PRIMARY KEY NOT NULL,level TEXT NOT NULL CHECK(level IN ('quiet','default','diagnostic')),budget_bytes INTEGER NOT NULL CHECK(budget_bytes BETWEEN 65536 AND 4294967295),keep_segments INTEGER NOT NULL CHECK(keep_segments BETWEEN 1 AND 4294967295));"
  ++ "CREATE TABLE IF NOT EXISTS log_files (session TEXT NOT NULL,log TEXT NOT NULL,PRIMARY KEY(session,log));"

def migration() -> String:
  "BEGIN IMMEDIATE;"
  ++ "ALTER TABLE log_policies RENAME TO log_policies_legacy;"
  ++ tables()
  ++ "INSERT INTO log_policies(session,level,budget_bytes,keep_segments) SELECT session,level,budget_bytes,keep_segments FROM log_policies_legacy;"
  ++ "DROP TABLE log_policies_legacy;COMMIT;"

def migrate_if(ready: Bool, db: String) -> IO(Unit):
  match ready:
    case True{}: IO.pure(Unit,Unit{})
    case False{}:
      do IO<Unit>:
        saved : String <- IO.try(String,DB.Sql.query(db,migration()))
        IO.pure(Unit,Unit{})

# An existing policy row and registered file survive the constraint migration.
def ensure(+db: String) -> IO(Unit):
  do IO<Unit>:
    ready : String <- IO.try(String,DB.Sql.query(db,tables() ++ "SELECT count(*) FROM sqlite_master WHERE name='log_policies' AND instr(sql,'keep_segments BETWEEN 1 AND 4294967295')>0;"))
    done : Unit <- migrate_if(String.eq(Tx.trim_nl(ready),"1"),db)
    IO.pure(Unit,Unit{})
