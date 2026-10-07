import Base
import ../host/sqlite.bend as DB
import ./commands.bend as C
import ./delivery.bend as Delivery
import ../git/text.bend as Tx

def accepted(db: String, command: C.Command, saved: String, +: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match stopped:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Session is terminally stopped; input was not committed. Read its session and retained inbox, or recruit a new session.")})
    case False{}: Delivery.after(db,command,saved)

# Endpoint delivery starts after the message transaction commits.
def route_accepted(db: String, command: C.Command, +saved: String, denied: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match denied:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,saved)})
    case False{}: accepted(db,command,saved,Tx.starts_with(saved,"{\"error\":\"session-stopped\""))

def naming_refused(+saved: String) -> Bool:
  Bool.or(Tx.starts_with(saved,"{\"error\":\"invalid-role\""),Tx.starts_with(saved,"{\"error\":\"section-refused\""))

def refused(+saved: String) -> Bool:
  Bool.or(naming_refused(saved),Bool.or(Tx.starts_with(saved,"{\"error\":\"player-assignment-conflict\""),Bool.or(Tx.starts_with(saved,"{\"error\":\"message-route-denied\""),Tx.starts_with(saved,"{\"error\":\"invalid-endpoint\""))))

def committed(db: String, command: C.Command, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+saved}: route_accepted(db,command,saved,refused(saved))
def commit(db: String, command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ C.sql(command) ++ "COMMIT;")

def apply(+db: String, +command: C.Command) -> IO(Result<&1, &1, U32 & String, String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- commit(db,command)
    committed(db,command,result)
