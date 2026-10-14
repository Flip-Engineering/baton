import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../git/text.bend as Tx
import ../context/request.bend as Req

def instruction() -> String:
  "Ideate briefly on the abstract qualities of the random seed above, and use those qualities to guide your interpretation of the task below. Apply the task's explicit requirements and evidence."

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS native_initial_inputs (attempt TEXT PRIMARY KEY NOT NULL,session TEXT NOT NULL REFERENCES sessions(id),turn TEXT NOT NULL,seed TEXT NOT NULL,instruction TEXT NOT NULL,guidance TEXT NOT NULL);"

# The execution identity joins fresh and profile retries to their original seed.
# Each native attempt retains the complete guidance it actually receives.
def record_sql(+session: String, +attempt: String, guidance: String) -> String:
  "BEGIN IMMEDIATE;" ++ schema()
  ++ "INSERT INTO native_initial_inputs(attempt,session,turn,seed,instruction,guidance) SELECT " ++ C.q(attempt) ++ ",e.session,e.id,coalesce((SELECT seed FROM native_initial_inputs WHERE session=e.session AND turn=e.id ORDER BY rowid LIMIT 1),lower(hex(randomblob(64))))," ++ C.q(instruction()) ++ "," ++ C.q(guidance) ++ " FROM executions e WHERE e.session=" ++ C.q(session) ++ " AND e.directory=" ++ C.q(attempt) ++ " ON CONFLICT(attempt) DO NOTHING;"
  ++ "SELECT hex(n.seed || char(10,10) || n.instruction || char(10,10) || n.guidance) FROM native_initial_inputs n JOIN executions e ON e.session=n.session AND e.id=n.turn AND e.directory=n.attempt WHERE n.session=" ++ C.q(session) ++ " AND n.attempt=" ++ C.q(attempt) ++ ";COMMIT;"

def decoded(+encoded: String) -> IO(Result<&1,&1,U32 & String,String>):
  match Req.decode_scalar_utf8(Tx.hex_decode(Tx.trim_nl(encoded))):
    case Req.ScalarText{text}: IO.pure(Result<&1,&1,U32 & String,String>,Done{text})
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(22,"Stored native initialization input could not be decoded: " ++ Req.scalar_reason(other))})

def prepare(+db: String, session: String, attempt: String, guidance: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +encoded : String <- IO.try(String,Store.transact_sql(db,record_sql(session,attempt,guidance)))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(Tx.trim_nl(encoded)),
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Native initialization requires the recorded current execution and attempt.")}),decoded(encoded))

def saved_guidance(+db: String, +attempt: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +encoded : String <- IO.try(String,DB.Sql.read(db,"SELECT coalesce((SELECT hex(guidance) FROM native_initial_inputs WHERE attempt=" ++ C.q(attempt) ++ "),'absent');"))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(Tx.trim_nl(encoded),"absent"),T.Text.read(attempt ++ "/prompt.txt"),decoded(encoded))

# Older attempts retain their original prompt file as recovery evidence.
def guidance(+db: String, +attempt: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    exists : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_initial_inputs');"))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(exists,"1\n"),saved_guidance(db,attempt),T.Text.read(attempt ++ "/prompt.txt"))
