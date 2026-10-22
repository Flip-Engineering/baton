import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../git/text.bend as Tx
import ../context/request.bend as Req
import ../context/raw.bend as Raw

def instruction() -> String:
  "Ideate briefly on the abstract qualities of the random seed above, and use those qualities to guide your interpretation of the task below. Apply the task's explicit requirements and evidence."

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS native_initial_inputs (attempt TEXT PRIMARY KEY NOT NULL,session TEXT NOT NULL REFERENCES sessions(id),turn TEXT NOT NULL,seed TEXT NOT NULL,instruction TEXT NOT NULL,guidance TEXT NOT NULL);"

# The execution identity joins fresh and profile retries to their original seed.
# Each native attempt retains the complete guidance it actually receives.
def record_sql(+session: String, +attempt: String, guidance: String, +predecessor: String) -> String:
  "BEGIN IMMEDIATE;" ++ schema()
  ++ "INSERT INTO native_initial_inputs(attempt,session,turn,seed,instruction,guidance) SELECT " ++ C.q(attempt) ++ ",e.session,e.id,coalesce((SELECT seed FROM native_initial_inputs WHERE session=e.session AND turn=e.id ORDER BY rowid LIMIT 1),(SELECT seed FROM native_initial_inputs WHERE session=e.session AND attempt=" ++ C.q(predecessor) ++ "),lower(hex(randomblob(64))))," ++ C.q(instruction()) ++ "," ++ C.q(guidance) ++ " FROM executions e WHERE e.session=" ++ C.q(session) ++ " AND e.directory=" ++ C.q(attempt) ++ " AND (NOT EXISTS(SELECT 1 FROM native_initial_inputs WHERE attempt=" ++ C.q(predecessor) ++ ") OR EXISTS(SELECT 1 FROM native_initial_inputs WHERE session=e.session AND attempt=" ++ C.q(predecessor) ++ ")) ON CONFLICT(attempt) DO NOTHING;"
  ++ "SELECT hex(n.seed || char(10,10) || n.instruction || char(10,10) || n.guidance) FROM native_initial_inputs n JOIN executions e ON e.session=n.session AND e.id=n.turn AND e.directory=n.attempt WHERE n.session=" ++ C.q(session) ++ " AND n.attempt=" ++ C.q(attempt) ++ ";COMMIT;"

def decoded_scalar(scalar: Req.Scalar) -> IO(Result<&1,&1,U32 & String,String>):
  match scalar:
    case Req.ScalarText{text}: IO.pure(Result<&1,&1,U32 & String,String>,Done{text})
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(22,"Stored native initialization input could not be decoded: " ++ Req.scalar_reason(other))})

def decoded(encoded: String) -> IO(Result<&1,&1,U32 & String,String>):
  decoded_scalar(Req.decode_scalar_utf8(Tx.hex_decode(Tx.trim_nl(encoded))))

def prepare(+db: String, session: String, attempt: String, guidance: String, predecessor: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +encoded : String <- IO.try(String,Store.transact_sql(db,record_sql(session,attempt,guidance,predecessor)))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(Tx.trim_nl(encoded)),
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Native initialization requires the recorded current execution and attempt.")}),decoded(encoded))

# Managed Codex admissions retain their complete prompting and share the
# recorded native conversation's seed. Each admission keeps its actual guidance.
def managed_sql(+session: String, +thread: String, input_seq: String, guidance: String) -> String:
  +turn : String = "'codex-inbox:'||hex(" ++ C.q(thread) ++ ")"
  attempt : String = "'codex-inbox:'||hex(" ++ C.q(session) ++ ")||':'||hex(" ++ C.q(thread) ++ ")||':'||" ++ C.q(input_seq) ++ "||':'||lower(hex(randomblob(16)))"
  "BEGIN IMMEDIATE;" ++ schema()
  ++ "INSERT INTO native_initial_inputs(attempt,session,turn,seed,instruction,guidance) SELECT " ++ attempt ++ "," ++ C.q(session) ++ "," ++ turn ++ ",coalesce((SELECT seed FROM native_initial_inputs WHERE session=" ++ C.q(session) ++ " AND turn=" ++ turn ++ " ORDER BY rowid LIMIT 1),lower(hex(randomblob(64))))," ++ C.q(instruction()) ++ "," ++ C.q(guidance) ++ ";"
  ++ "SELECT hex(seed||char(10,10)||instruction||char(10,10)||guidance) FROM native_initial_inputs WHERE rowid=last_insert_rowid();COMMIT;"

def managed_recorded(result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{encoded}: decoded(encoded)

def managed(+db: String, session: String, thread: String, input_seq: String, guidance: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : Result<&1,&1,U32 & String,String> <- Store.transact_sql(db,managed_sql(session,thread,input_seq,guidance))
    managed_recorded(result)

# Claude attachments retain separate authored components on their active
# managed attempt or recorded external native conversation and share its seed.
def attachment_sql(+session: String, +component: String, +guidance: String) -> String:
  +owner : String = "WITH owner AS (SELECT s.id AS session,CASE WHEN n.attempt IS NOT NULL THEN 'execution:'||hex(e.directory) ELSE 'native:'||hex(s.native) END AS identity,CASE WHEN n.attempt IS NOT NULL THEN e.id ELSE 'attachment:'||hex(s.native) END AS turn,n.seed AS seed FROM sessions s LEFT JOIN executions e ON e.session=s.id AND e.phase IN('starting','running') LEFT JOIN native_initial_inputs n ON n.session=e.session AND n.turn=e.id AND n.attempt=e.directory WHERE s.id=" ++ C.q(session) ++ " AND s.harness='claude-code' AND (n.attempt IS NOT NULL OR s.native<>'') AND NOT " ++ C.stopped_session_sql("s.id") ++ ") "
  +key : String = "'attachment:'||hex(o.session)||':'||o.identity||':'||hex(" ++ C.q(component) ++ ")"
  "BEGIN IMMEDIATE;" ++ schema()
  ++ owner ++ "INSERT INTO native_initial_inputs(attempt,session,turn,seed,instruction,guidance) SELECT " ++ key ++ ",o.session,o.turn,coalesce(o.seed,(SELECT seed FROM native_initial_inputs WHERE session=o.session AND turn=o.turn ORDER BY rowid LIMIT 1),lower(hex(randomblob(64))))," ++ C.q(instruction()) ++ "," ++ C.q(guidance) ++ " FROM owner o WHERE 1 ON CONFLICT(attempt) DO NOTHING;"
  ++ owner ++ "SELECT hex(n.seed||char(10,10)||n.instruction||char(10,10)||n.guidance) FROM native_initial_inputs n JOIN owner o ON n.session=o.session WHERE n.attempt=" ++ key ++ " AND n.turn=o.turn AND n.guidance=" ++ C.q(guidance) ++ ";COMMIT;"

def attachment_body(+db: String, session: String, component: String, guidance: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    +encoded : String <- IO.try(String,Store.transact_sql(db,attachment_sql(session,component,guidance)))
    prompt : String <- IO.try(String,Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(Tx.trim_nl(encoded)),
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Native attachment initialization requires an unstopped initialized Claude execution or recorded native conversation and unchanged component guidance.")}),decoded(encoded)))
    IO.write(prompt)

def attachment_text(read: Raw.RawRead) -> IO(String):
  match read:
    case Raw.RawText{value}: IO.pure(String,value)
    case Raw.RawInvalidUtf8{offset}: IO.die(String,2,"Native attachment guidance contains invalid UTF-8 at byte " ++ offset ++ ".")
    case Raw.RawNul{offset}: IO.die(String,2,"Native attachment guidance contains NUL at byte " ++ offset ++ ".")
    case Raw.RawBom{}: IO.die(String,2,"Native attachment guidance could not preserve its leading BOM.")

def attachment_valid(valid: Bool, +db: String, session: String, component: String) -> IO(Unit):
  match valid:
    case False{}: IO.die(Unit,2,"Native attachment component must be mcp-instructions or initial-task.")
    case True{}: do IO<Unit>:
      read : Raw.RawRead <- IO.try(Raw.RawRead,Raw.Raw.read_text_utf8("-"))
      guidance : String <- attachment_text(read)
      attachment_body(db,session,component,guidance)

def attachment(db: String, session: String, +component: String) -> IO(Unit):
  attachment_valid(Bool.or(String.eq(component,"mcp-instructions"),String.eq(component,"initial-task")),db,session,component)

# Stored retry input names the execution that produced it. The current execution
# and exact selected control input retain that predecessor across a driver restart.
def profile_predecessor_sql(+inputs: String) -> String:
  +prefix : String = "'receive:'||e.session||':'"
  +cursor : String = "CAST(substr(e.id,length(" ++ prefix ++ ")+1) AS INTEGER)"
  "e.mode='retained' AND substr(e.id,1,length(" ++ prefix ++ "))=" ++ prefix
  ++ " AND EXISTS(SELECT 1 FROM messages h WHERE h.sender=e.session AND h.recipient=" ++ C.report_recipient("e.session") ++ " AND h.kind='report' AND substr(h.id,1,length(e.id||':profile-handoff-'))=e.id||':profile-handoff-')"
  ++ " AND EXISTS(SELECT 1 FROM messages m WHERE m.recipient=e.session AND " ++ C.owed_sql("m") ++ " AND m.id IN(SELECT value FROM json_each(" ++ C.q(inputs) ++ ")) AND m.seq<=" ++ cursor ++ ")"
  ++ " AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.recipient=e.session AND " ++ C.owed_sql("m") ++ " AND m.id IN(SELECT value FROM json_each(" ++ C.q(inputs) ++ ")) AND m.kind IN('task','task-assignment') AND m.seq>" ++ cursor ++ ")"

def predecessor_sql(+session: String, +inputs: String) -> String:
  "SELECT hex(coalesce((SELECT e.directory FROM executions e JOIN native_initial_inputs n ON n.session=e.session AND n.turn=e.id AND n.attempt=e.directory WHERE e.session=" ++ C.q(session) ++ " AND e.phase='exited' AND (EXISTS(SELECT 1 FROM messages m WHERE m.sender=e.session AND m.recipient=e.session AND " ++ C.owed_sql("m") ++ " AND m.id IN(SELECT value FROM json_each(" ++ C.q(inputs) ++ ")) AND ((m.kind='recovery' AND m.id=e.id||':recovery-input') OR (m.kind='guidance' AND m.id IN(e.id||':handoff-guidance',e.id||':transient-guidance',e.id||':route-guidance')))) OR (" ++ profile_predecessor_sql(inputs) ++ "))),''));"

def predecessor(+db: String, session: String, inputs: String, explicit: String) -> IO(String):
  match explicit:
    case SCon{head,tail}: IO.pure(String,SCon{head,tail})
    case SNil{}: do IO<String>:
      encoded : String <- IO.try(String,DB.Sql.query(db,schema() ++ predecessor_sql(session,inputs)))
      IO.try(String,decoded(encoded))

def saved_guidance(+db: String, +attempt: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +encoded : String <- IO.try(String,DB.Sql.read(db,"SELECT coalesce((SELECT hex(guidance) FROM native_initial_inputs WHERE attempt=" ++ C.q(attempt) ++ "),'absent');"))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(Tx.trim_nl(encoded),"absent"),T.Text.read(attempt ++ "/prompt.txt"),decoded(encoded))

# Older attempts retain their original prompt file as recovery evidence.
def guidance(+db: String, +attempt: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    exists : String <- IO.try(String,DB.Sql.read(db,"SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='native_initial_inputs');"))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(exists,"1\n"),saved_guidance(db,attempt),T.Text.read(attempt ++ "/prompt.txt"))
