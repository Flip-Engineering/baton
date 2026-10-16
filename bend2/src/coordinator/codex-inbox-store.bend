import Base
import ./agent-guidance.bend as Guidance
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../context/request.bend as Req
import ../git/text.bend as Tx
import ../json/canonical.bend as J

# Wake metadata is fenced by the recorded session, native conversation and token.
# SQLite's host busy handler waits for the real writer to release each operation.
type Snapshot is Data:
  Inbox{native: String, parent: String, stopped: Bool, pending: String,input_seq: String, handled: String, control_seq: String, message: String}

def native(row: Snapshot) -> String:
  match row:
    case Inbox{value,parent,stopped,pending,input_seq,handled,control_seq,message}: value

def stopped(row: Snapshot) -> Bool:
  match row:
    case Inbox{native,parent,value,pending,input_seq,handled,control_seq,message}: value

def pending(row: Snapshot) -> String:
  match row:
    case Inbox{native,parent,stopped,value,input_seq,handled,control_seq,message}: value

def input_seq(row: Snapshot) -> String:
  match row:
    case Inbox{native,parent,stopped,pending,value,handled,control_seq,message}: value

def handled(row: Snapshot) -> String:
  match row:
    case Inbox{native,parent,stopped,pending,input_seq,value,control_seq,message}: value

def control_seq(row: Snapshot) -> String:
  match row:
    case Inbox{native,parent,stopped,pending,input_seq,handled,value,message}: value

def message(row: Snapshot) -> String:
  match row:
    case Inbox{native,parent,stopped,pending,input_seq,handled,control_seq,value}: value

def has_pending(row: Snapshot) -> Bool:
  Bool.not(String.eq(pending(row),"0"))

def schema_sql() -> String:
  "CREATE TABLE IF NOT EXISTS codex_inbox_wakes(session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),native TEXT NOT NULL,token TEXT NOT NULL,cause TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TRIGGER IF NOT EXISTS codex_inbox_wake_receipt AFTER UPDATE OF receipt ON messages WHEN OLD.receipt IS NULL AND NEW.receipt IS NOT NULL BEGIN DELETE FROM codex_inbox_wakes WHERE session=NEW.recipient;END;"

def input_sql() -> String:
  "coalesce((SELECT max(seq) FROM messages WHERE recipient=s.id),0)"

def control_sql() -> String:
  "coalesce((SELECT max(m.seq) FROM messages m WHERE m.recipient=s.id AND (m.kind IN ('task','guidance','recovery','task-assignment','task-continuation','completion-confirmed','question') OR EXISTS(SELECT 1 FROM session_roles r WHERE r.session=m.sender AND r.role='operator'))),0)"

def row_sql() -> String:
  "hex(s.native)||char(9)||hex(s.parent)||char(9)||EXISTS(SELECT 1 FROM session_stops WHERE session=s.id)||char(9)||(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NULL)||char(9)||"
  ++ input_sql() ++ "||char(9)||(SELECT count(*) FROM messages WHERE recipient=s.id AND receipt IS NOT NULL)||char(9)||" ++ control_sql()
  ++ "||char(9)||hex(coalesce((SELECT id FROM messages WHERE recipient=s.id AND receipt IS NULL ORDER BY seq LIMIT 1),''))||char(9)"

def text_decoded(value: Req.Scalar) -> IO(String):
  match value:
    case Req.ScalarText{text}: IO.pure(String,text)
    case other: IO.die(String,22,"Recorded Codex input text is invalid: " ++ Req.scalar_reason(other))

def text(+value: String) -> IO(String):
  text_decoded(Req.decode_scalar_utf8(Tx.hex_decode(value)))

def row_fields(fields: List<String>) -> IO(Result<&1,&1,U32 & String,Snapshot>):
  match fields:
    case native_hex <> parent_hex <> stopped <> pending <> input_seq <> handled <> control_seq <> message_hex <> Nil{}: do IO<Result<&1,&1,U32 & String,Snapshot>>:
      +native : String <- text(native_hex)
      +parent : String <- text(parent_hex)
      +message : String <- text(message_hex)
      IO.pure(Result<&1,&1,U32 & String,Snapshot>,Done{Inbox{native,parent,String.eq(stopped,"1"),pending,input_seq,handled,control_seq,message}})
    case other: IO.pure(Result<&1,&1,U32 & String,Snapshot>,Fail{(2,"The recorded Codex inbox snapshot is absent or invalid.")})

def checked_native(row: Snapshot, +session: String, +thread: String, +same: Bool) -> IO(Result<&1,&1,U32 & String,Snapshot>):
  match same:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Snapshot>,Done{row})
    case False{}: IO.pure(Result<&1,&1,U32 & String,Snapshot>,Fail{(1,"Baton session now records another native conversation: {\"session\":" ++ J.string_literal(session) ++ ",\"native\":" ++ J.string_literal(native(row)) ++ "}")})

def read_checked(result: Result<&1,&1,U32 & String,Snapshot>, +session: String, +thread: String) -> IO(Result<&1,&1,U32 & String,Snapshot>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Snapshot>,Fail{error})
    case Done{+row}: checked_native(row,session,thread,String.eq(native(row),thread))

def read_result(result: Result<&1,&1,U32 & String,String>, +session: String, +thread: String) -> IO(Result<&1,&1,U32 & String,Snapshot>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Snapshot>,Fail{error})
    case Done{value}: do IO<Result<&1,&1,U32 & String,Snapshot>>:
      row : Result<&1,&1,U32 & String,Snapshot> <- row_fields(Tx.split_tabs(Tx.trim_nl(value)))
      read_checked(row,session,thread)

def read(+db: String, +session: String, +thread: String) -> IO(Result<&1,&1,U32 & String,Snapshot>):
  do IO<Result<&1,&1,U32 & String,Snapshot>>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT " ++ row_sql() ++ " FROM sessions s WHERE s.id=" ++ C.q(session) ++ ";")
    read_result(result,session,thread)

def metadata_sql(+value: String) -> String:
  "CASE WHEN json_valid(" ++ value ++ ") THEN json_type(" ++ value ++ ")='object' AND json_type(" ++ value ++ ",'$.inputSeq') IN ('integer','real') AND json_extract(" ++ value ++ ",'$.inputSeq')=CAST(json_extract(" ++ value ++ ",'$.inputSeq') AS INTEGER) ELSE 0 END"

def claimed_sql(+thread: String) -> String:
  "EXISTS(SELECT 1 FROM codex_inbox_wakes w WHERE w.session=s.id AND w.native=" ++ C.q(thread)
  ++ " AND CASE WHEN " ++ metadata_sql("w.cause") ++ " THEN json_extract(w.cause,'$.inputSeq')>=" ++ input_sql() ++ " ELSE 1 END)"

def claimed(+db: String, +session: String, +thread: String) -> IO(Bool):
  do IO<Bool>:
    +ensured : String <- IO.try(String,DB.Sql.query(db,schema_sql()))
    +result : String <- IO.try(String,DB.Sql.read(db,"SELECT " ++ claimed_sql(thread) ++ " FROM sessions s WHERE s.id=" ++ C.q(session) ++ ";"))
    IO.pure(Bool,String.eq(result,"1\n"))

def active_sql(+session: String, +thread: String) -> String:
  "s.id=" ++ C.q(session) ++ " AND s.native=" ++ C.q(thread) ++ " AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=s.id) AND EXISTS(SELECT 1 FROM messages WHERE recipient=s.id AND receipt IS NULL)"

def claim_sql(+session: String, +thread: String) -> String:
  "BEGIN IMMEDIATE;" ++ schema_sql()
  ++ "INSERT INTO codex_inbox_wakes(session,native,token,cause) SELECT s.id,s.native,lower(hex(randomblob(16))),json_object('inputSeq'," ++ input_sql() ++ ") FROM sessions s WHERE " ++ active_sql(session,thread) ++ " AND NOT " ++ claimed_sql(thread)
  ++ " ON CONFLICT(session) DO UPDATE SET native=excluded.native,token=excluded.token,cause=excluded.cause;"
  ++ "SELECT token FROM codex_inbox_wakes WHERE session=" ++ C.q(session) ++ " AND changes()=1;COMMIT;"

def claim(+db: String, +session: String, +thread: String) -> IO(String):
  do IO<String>:
    +token : String <- IO.try(String,DB.Sql.query(db,claim_sql(session,thread)))
    IO.pure(String,Tx.trim_nl(token))

def refresh_condition(+session: String, +thread: String, +token: String, +status: String) -> String:
  active_sql(session,thread)
  ++ " AND (" ++ C.q(token) ++ "='' OR EXISTS(SELECT 1 FROM codex_inbox_wakes w WHERE w.session=s.id AND w.native=s.native AND w.token=" ++ C.q(token) ++ "))"
  ++ " AND NOT EXISTS(SELECT 1 FROM codex_inbox_wakes w WHERE w.session=s.id AND CASE WHEN json_valid(w.cause) THEN json_extract(w.cause,'$.turnId') IS NOT NULL AND (" ++ input_sql() ++ "<=json_extract(w.cause,'$.inputSeq') OR (" ++ C.q(status) ++ "='active' AND " ++ control_sql() ++ "<=json_extract(w.cause,'$.inputSeq') AND json_extract(w.cause,'$.cause') IS NULL)) ELSE 0 END)"

def refresh_sql(+session: String, +thread: String, +token: String, +status: String) -> String:
  "BEGIN IMMEDIATE;" ++ schema_sql()
  ++ "SELECT coalesce((SELECT token FROM codex_inbox_wakes WHERE session=s.id),'')||char(9)||" ++ row_sql() ++ " FROM sessions s WHERE " ++ refresh_condition(session,thread,token,status) ++ ";"
  ++ "UPDATE codex_inbox_wakes SET cause=json_remove(json_set(cause,'$.inputSeq',(SELECT " ++ input_sql() ++ " FROM sessions s WHERE s.id=" ++ C.q(session) ++ ")), '$.cause') WHERE session=" ++ C.q(session) ++ " AND " ++ metadata_sql("cause")
  ++ " AND EXISTS(SELECT 1 FROM sessions s WHERE " ++ refresh_condition(session,thread,token,status) ++ ");COMMIT;"

def refresh(+db: String, +session: String, +thread: String, +token: String, +status: String) -> IO(String):
  do IO<String>:
    +result : String <- IO.try(String,DB.Sql.query(db,refresh_sql(session,thread,token,status)))
    IO.pure(String,Tx.trim_nl(result))

def admitted(+db: String, +session: String, +thread: String, +token: String, +turn: String) -> IO(Unit):
  do IO<Unit>:
    +stored : String <- IO.try(String,DB.Sql.query(db,"UPDATE codex_inbox_wakes SET cause=json_set(cause,'$.turnId'," ++ C.q(turn) ++ ") WHERE session=" ++ C.q(session) ++ " AND native=" ++ C.q(thread) ++ " AND token=" ++ C.q(token) ++ " AND " ++ C.q(token) ++ "<>'' AND " ++ C.q(turn) ++ "<>'' AND json_valid(cause);"))
    IO.pure(Unit,Unit{})

def failed(+db: String, +session: String, +thread: String, +input_seq: String, +cause: String, +turn: String) -> IO(Unit):
  do IO<Unit>:
    +stored : String <- IO.try(String,DB.Sql.query(db,"UPDATE codex_inbox_wakes SET cause=CASE WHEN json_valid(cause) THEN json_set(cause,'$.cause'," ++ C.q(cause) ++ ") ELSE json_object('inputSeq',CAST(" ++ C.q(input_seq) ++ " AS INTEGER),'cause'," ++ C.q(cause) ++ ") END WHERE session=" ++ C.q(session) ++ " AND native=" ++ C.q(thread) ++ " AND (" ++ C.q(turn) ++ "='' OR CASE WHEN json_valid(cause) THEN json_extract(cause,'$.turnId') IS NULL OR json_extract(cause,'$.turnId')=" ++ C.q(turn) ++ " ELSE 1 END);"))
    IO.pure(Unit,Unit{})

def pointer(+executable: String, +db: String, +session: String, +row: Snapshot) -> String:
  Guidance.pending()
