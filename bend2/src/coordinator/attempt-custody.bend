# Public read of one session's recorded execution and its passive host job
# reference. The host response is retained as a complete JSON object. Read
# failures retain their host or database code and text through IO.try.
import Base
import ../coordinator/commands.bend as C
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx

def snapshot_sql(session: String) -> String:
  "SELECT json_object('session',s.id,'execution',json_object('attempt',e.id,'mode',e.mode,'phase',e.phase,'status',e.status,'directory',e.directory,'qualification','recorded')) FROM sessions s JOIN executions e ON e.session=s.id WHERE s.id=" ++ C.q(session) ++ ";"

def recorded_directory(db: String, snapshot: String) -> IO(String):
  do IO<String>:
    path : String <- IO.try(String,DB.Sql.read(db,"SELECT json_extract(" ++ C.q(snapshot) ++ ",'$.execution.directory');"))
    IO.pure(String,Tx.trim_nl(path))

def render_sql(snapshot: String, body: String) -> String:
  "WITH payload(meta,raw) AS (VALUES(" ++ C.q(snapshot) ++ "," ++ C.q(body) ++ ")) SELECT json_patch(json(meta),CASE WHEN json_valid(raw) THEN json_object('jobRead','read','job',json(raw)) ELSE json_object('jobRead','corrupt','jobRaw',raw) END) FROM payload;"

def render(db: String, snapshot: String, body: String) -> IO(String):
  do IO<String>:
    answer : String <- IO.try(String,DB.Sql.read(db,render_sql(snapshot,body)))
    IO.pure(String,Tx.trim_nl(answer))

def read_host(+db: String, snapshot: String, directory: String) -> IO(String):
  do IO<String>:
    body : String <- IO.try(String,Custody.Instance.job(db,directory))
    render(db,snapshot,body)

def read_recorded_case(+db: String, +snapshot: String, empty: Bool) -> IO(String):
  match empty:
    case True{}: IO.die(String,1,"No recorded execution for this session.")
    case False{}: do IO<String>:
      directory : String <- recorded_directory(db,snapshot)
      read_host(db,snapshot,directory)

def read_recorded(+db: String, +snapshot: String) -> IO(String):
  read_recorded_case(db,snapshot,String.is_empty(snapshot))

def read(+db: String, session: String) -> IO(String):
  do IO<String>:
    snapshot : String <- IO.try(String,DB.Sql.read(db,snapshot_sql(session)))
    read_recorded(db,Tx.trim_nl(snapshot))
