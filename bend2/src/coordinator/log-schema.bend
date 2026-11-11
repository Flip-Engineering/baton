import Base
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

def stderr_runs_table() -> String:
  "CREATE TABLE IF NOT EXISTS log_stderr_runs(session TEXT NOT NULL,attempt TEXT NOT NULL,run INTEGER NOT NULL,generation TEXT NOT NULL,stderr TEXT NOT NULL,PRIMARY KEY(session,attempt,run),UNIQUE(stderr));"

def tables() -> String:
  "CREATE TABLE IF NOT EXISTS log_policies (session TEXT PRIMARY KEY NOT NULL,level TEXT NOT NULL CHECK(level IN ('quiet','default','diagnostic')));"
  ++ "CREATE TABLE IF NOT EXISTS log_files (session TEXT NOT NULL,log TEXT NOT NULL,PRIMARY KEY(session,log));"
  ++ stderr_runs_table()

def migration() -> String:
  "BEGIN IMMEDIATE;"
  ++ "ALTER TABLE log_policies RENAME TO log_policies_legacy;"
  ++ tables()
  ++ "INSERT INTO log_policies(session,level) SELECT session,level FROM log_policies_legacy;"
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
    ready : String <- IO.try(String,DB.Sql.query(db,tables() ++ "SELECT count(*) FROM pragma_table_info('log_policies');"))
    done : Unit <- migrate_if(String.eq(Tx.trim_nl(ready),"2"),db)
    IO.pure(Unit,Unit{})
