import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./message-batch.bend as MessageBatch
import ./agent-command.bend as AgentCommand
import ../context/request.bend as Req
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ../json/canonical.bend as J

def invalid(+condition: String) -> IO(String):
  IO.die(String,2,"{\"error\":\"task-input\",\"condition\":" ++ J.string_literal(condition) ++ "}")

def validate_object(+db: String, +text: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Store.ensure_before_begin(db)
    valid : String <- IO.try(String,DB.Sql.read(db,Req.validity_sql(text)))
    +unique : String <- MessageBatch.validate_duplicates(db,text,String.eq(valid,"1\n"))
    root : String <- IO.try(String,DB.Sql.read(db,MessageBatch.root_type_sql(unique)))
    Bool.pick(IO(String),String.eq(Tx.trim_nl(root),"object"),IO.pure(String,unique),invalid("rootNotObject"))

def request_id_sql(+text: String) -> String:
  "WITH raw(t) AS (SELECT " ++ C.q(text) ++ ") SELECT CASE WHEN json_type(t,'$.id')='text' AND length(json_extract(t,'$.id'))>0 AND instr(json_extract(t,'$.id'),char(0))=0 THEN hex(json_extract(t,'$.id')) ELSE '' END FROM raw;"

def decoded_id(+encoded: String) -> IO(String):
  +reason = MessageBatch.decoded_reason("id",encoded)
  Bool.pick(IO(String),String.is_empty(reason),IO.pure(String,MessageBatch.decoded(encoded)),invalid(reason))

def request_id(+db: String, +text: String) -> IO(String):
  do IO<String>:
    +encoded : String <- IO.try(String,DB.Sql.read(db,request_id_sql(text)))
    Bool.pick(IO(String),String.is_empty(Tx.trim_nl(encoded)),invalid("idNotNonemptyString"),decoded_id(Tx.trim_nl(encoded)))

def write_rows(rows: List<String>, original: String) -> IO(Unit):
  match rows:
    case status <> +answer <> Nil{}:
      Bool.pick(IO(Unit),String.eq(status,"recorded"),IO.write(answer),IO.die(Unit,2,answer))
    case other: IO.die(Unit,1,"Task input storage returned an invalid response: " ++ original)

def write_saved(+saved: String) -> IO(Unit):
  write_rows(Tx.split_lines(saved),saved)

def record_status(+id: String, +text: String) -> String:
  "CASE WHEN (SELECT request FROM task_input_requests WHERE id=" ++ C.q(id) ++ ")=" ++ C.q(text) ++ " THEN 'recorded' ELSE 'requestConflict' END"

def record_sql(+id: String, +text: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO task_input_requests(id,request) VALUES(" ++ C.q(id) ++ "," ++ C.q(text) ++ ") ON CONFLICT(id) DO NOTHING;"
  ++ "SELECT " ++ record_status(id,text) ++ ";SELECT json_object('id'," ++ C.q(id) ++ ",'status'," ++ record_status(id,text) ++ ");COMMIT;"

def record(+db: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    raw : String <- MessageBatch.read_input(path)
    +text : String <- validate_object(db,raw)
    id : String <- request_id(db,text)
    saved : String <- IO.try(String,Store.transact_sql(db,record_sql(id,text)))
    write_saved(saved)

def result_status(+id: String, +text: String) -> String:
  "CASE WHEN NOT EXISTS(SELECT 1 FROM task_input_requests WHERE id=" ++ C.q(id) ++ ") THEN 'requestAbsent' WHEN (SELECT result FROM task_input_requests WHERE id=" ++ C.q(id) ++ ")=" ++ C.q(text) ++ " THEN 'recorded' ELSE 'resultConflict' END"

def result_sql(+id: String, +text: String) -> String:
  "BEGIN IMMEDIATE;UPDATE task_input_requests SET result=" ++ C.q(text) ++ " WHERE id=" ++ C.q(id) ++ " AND result IS NULL;"
  ++ "SELECT " ++ result_status(id,text) ++ ";SELECT json_object('id'," ++ C.q(id) ++ ",'status'," ++ result_status(id,text) ++ ");COMMIT;"

def result(+db: String, +id: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    raw : String <- MessageBatch.read_input(path)
    +text : String <- validate_object(db,raw)
    saved : String <- IO.try(String,Store.transact_sql(db,result_sql(id,text)))
    write_saved(saved)

def read_sql(+id: String) -> String:
  "SELECT CASE WHEN EXISTS(SELECT 1 FROM task_input_requests WHERE id=" ++ C.q(id) ++ ") THEN 'recorded' ELSE 'requestAbsent' END;"
  ++ "SELECT CASE WHEN EXISTS(SELECT 1 FROM task_input_requests WHERE id=" ++ C.q(id) ++ ") THEN (SELECT json_object('id',id,'request',json(request),'result',json(result)) FROM task_input_requests WHERE id=" ++ C.q(id) ++ ") ELSE json_object('id'," ++ C.q(id) ++ ",'status','requestAbsent') END;"

def read(+db: String, +id: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    saved : String <- IO.try(String,DB.Sql.read(db,read_sql(id)))
    write_saved(saved)

def current_actor(+db: String) -> IO(String):
  do IO<String>:
    +session : String <- AgentCommand.environment("BATON_SESSION")
    native : String <- AgentCommand.environment("CODEX_THREAD_ID")
    Bool.pick(IO(String),Bool.and(String.is_empty(session),String.is_empty(native)),IO.pure(String,"operator"),
      (do IO<String>:
        +actor : String <- AgentCommand.implicit_session(db)
        known : String <- IO.try(String,DB.Sql.read(db,"SELECT count(*) FROM sessions WHERE id=" ++ C.q(actor) ++ ";"))
        Bool.pick(IO(String),String.eq(known,"1\n"),IO.pure(String,actor),IO.die(String,2,"No recorded session matches the current agent context."))))

def scoped_read(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    actor : String <- current_actor(db)
    +encoded : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(id) FROM task_input_requests WHERE json_extract(request,'$.sender')=" ++ C.q(actor) ++ " AND (" ++ C.q(session) ++ "='' OR json_extract(request,'$.session')=" ++ C.q(session) ++ ") ORDER BY rowid DESC LIMIT 1;"))
    Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(encoded)),
      IO.die(Unit,2,"No dispatched request is recorded for the current actor and selected session."),
      (do IO<Unit>:
        id : String <- decoded_id(Tx.trim_nl(encoded))
        read(db,id)))

def read_selector(+db: String, +selector: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.eq(selector,"--current"),scoped_read(db,""),read(db,selector))
