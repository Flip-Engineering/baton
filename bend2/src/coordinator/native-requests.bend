import Base
import ../coordinator/commands.bend as C
import ./delivery.bend as Delivery
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../host/process.bend as P
import ../git/text.bend as Tx
import ../host/text.bend as Text

def with_observation(-A: Type, observation: List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool, next: List<Chan(Result<&1,&1,U32 & String,String>)> -> String -> Bool -> IO(A)) -> IO(A):
  (tasks,(error,incomplete))=observation
  next(tasks,error,incomplete)

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS native_requests (id TEXT PRIMARY KEY NOT NULL,worker TEXT NOT NULL REFERENCES sessions(id),parent TEXT NOT NULL REFERENCES sessions(id),attempt TEXT NOT NULL,native_id TEXT NOT NULL,method TEXT NOT NULL,event TEXT NOT NULL,reply TEXT,written INTEGER NOT NULL DEFAULT 0,closed TEXT,UNIQUE(attempt,native_id));"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_requests_insert AFTER INSERT ON native_requests BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('native-request',NEW.id,NEW.worker,'insert','native-request',NEW.method || ' request recorded'); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_requests_update AFTER UPDATE ON native_requests WHEN OLD.reply IS NOT NEW.reply OR OLD.written IS NOT NEW.written OR OLD.closed IS NOT NEW.closed BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('native-request',NEW.id,NEW.worker,'update','native-request',NEW.method || CASE WHEN NEW.reply IS NOT OLD.reply THEN ' response stored' WHEN NEW.written IS NOT OLD.written THEN ' response written' WHEN NEW.closed IS NOT OLD.closed THEN ' request closed' ELSE ' request updated' END); END;"
  ++ "CREATE TRIGGER IF NOT EXISTS native_changes_requests_delete AFTER DELETE ON native_requests BEGIN INSERT INTO native_changes(entity,entity_id,session_id,operation,kind,summary) VALUES('native-request',OLD.id,OLD.worker,'delete','native-request',OLD.method || ' request removed'); END;"

def request_matches(+player: String, +attempt: String, +event: String) -> String:
  "worker=" ++ C.q(player) ++ " AND parent=(SELECT parent FROM sessions WHERE id=" ++ C.q(player) ++ ") AND attempt=" ++ C.q(attempt) ++ " AND native_id=json_extract(" ++ C.q(event) ++ ",'$.id') AND event=" ++ C.q(event)

def question_body() -> String:
  "json_object('nativeRequest',json(event),'requestId',id,'replyCommand',json_array('native-reply',parent,id),'replyFormat',CASE WHEN method='confirm' THEN '{\"confirmed\":true} or {\"confirmed\":false} or {\"cancelled\":true}' ELSE '{\"value\":\"answer\"} or {\"cancelled\":true}' END,'completion','stdin-written records transport completion; native continuation is observed separately')"

def request_conflict_sql(+player: String, turn: String, +attempt: String, +event: String) -> String:
  "SELECT json_object('error','native-request-id-conflict','request',id,'attempt'," ++ C.q(attempt) ++ ",'nativeId',json_extract(" ++ C.q(event) ++ ",'$.id'),'stored',json_object('worker',worker,'parent',parent,'attempt',attempt,'nativeId',native_id,'method',method),'condition','The native request identity is already stored with different content.','next','Use the retained question and request ID to answer the original request; the incoming frame remains in the native log.') FROM native_requests WHERE (id=" ++ C.q(turn ++ ":native:") ++ " || lower(hex(json_extract(" ++ C.q(event) ++ ",'$.id'))) OR (attempt=" ++ C.q(attempt) ++ " AND native_id=json_extract(" ++ C.q(event) ++ ",'$.id'))) AND NOT (" ++ request_matches(player,attempt,event) ++ ");"

def request_sql(+player: String, +turn: String, +attempt: String, +event: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")) INSERT INTO native_requests(id,worker,parent,attempt,native_id,method,event) SELECT " ++ C.q(turn ++ ":native:") ++ " || lower(hex(json_extract(value,'$.id'))),s.id,s.parent," ++ C.q(attempt) ++ ",json_extract(value,'$.id'),json_extract(value,'$.method'),value FROM frame,sessions s WHERE s.id=" ++ C.q(player) ++ " AND s.harness='omp' AND json_type(value,'$.id')='text' AND json_extract(value,'$.method') IN ('input','select','confirm','editor') ON CONFLICT DO NOTHING;"
  ++ request_conflict_sql(player,turn,attempt,event)
  ++ "UPDATE native_requests SET closed=coalesce(closed,'native-cancelled') WHERE attempt=" ++ C.q(attempt) ++ " AND native_id=json_extract(" ++ C.q(event) ++ ",'$.targetId') AND json_extract(" ++ C.q(event) ++ ",'$.method')='cancel';"
  ++ "INSERT INTO messages(id,sender,recipient,kind,body) SELECT id,worker,parent,'question'," ++ question_body() ++ " FROM native_requests WHERE " ++ request_matches(player,attempt,event) ++ C.message_upsert()
  ++ C.message_conflict_sql("(SELECT id FROM native_requests WHERE " ++ request_matches(player,attempt,event) ++ ")",C.q(player),"(SELECT parent FROM sessions WHERE id=" ++ C.q(player) ++ ")","'question'","(SELECT " ++ question_body() ++ " FROM native_requests WHERE " ++ request_matches(player,attempt,event) ++ ")","EXISTS(SELECT 1 FROM native_requests WHERE " ++ request_matches(player,attempt,event) ++ ")")
  ++ "SELECT id FROM native_requests WHERE " ++ request_matches(player,attempt,event) ++ " AND closed IS NULL AND EXISTS(SELECT 1 FROM messages m WHERE m.id=native_requests.id AND m.sender=native_requests.worker AND m.recipient=native_requests.parent AND m.kind='question' AND m.body=" ++ question_body() ++ ");"

def dispatch(attempt: String, frame: String, allowed: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match allowed:
    case False{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(1,"Native request is closed, unavailable, or belongs to another parent.")})
    case True{}: P.ProcessChild.control_write(attempt,frame)

def prepare_projection(db: String) -> IO(Result<&1,&1,U32 & String,String>):
  DB.Sql.ensure_projection(db,C.schema())

def written(+db: String, +id: String, result: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{unit}: do IO<Result<&1,&1,U32 & String,String>>:
      ready : String <- IO.try(String,prepare_projection(db))
      DB.Sql.query(db,"UPDATE native_requests SET written=1 WHERE id=" ++ C.q(id) ++ ";SELECT json_object('request'," ++ C.q(id) ++ ",'status','stdin-written');")

def send(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    allowed : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM native_requests WHERE id=" ++ C.q(id) ++ " AND reply IS NOT NULL AND closed IS NULL AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=native_requests.worker));"))
    attempt : String <- IO.try(String,DB.Sql.query(db,"SELECT attempt FROM native_requests WHERE id=" ++ C.q(id) ++ ";"))
    frame : String <- IO.try(String,DB.Sql.query(db,"SELECT reply FROM native_requests WHERE id=" ++ C.q(id) ++ ";"))
    result : Result<&1,&1,U32 & String,Unit> <- dispatch(Tx.trim_nl(attempt),frame,String.eq(allowed,"1\n"))
    written(db,id,result)

def deliver_pending(db: String, id: String, state: String) -> IO(Result<&1,&1,U32 & String,String>):
  match state:
    case "reply\n": send(db,id)
    case "question\n": Delivery.deliver(db,id,"1","")
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})

def deliver(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    state : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN closed IS NOT NULL OR written=1 THEN '' WHEN reply IS NOT NULL THEN 'reply' ELSE 'question' END FROM native_requests WHERE id=" ++ C.q(id) ++ ";"))
    deliver_pending(db,id,state)

def fork_saved(db: String, id: String, tasks: List<Chan(Result<&1,&1,U32 & String,String>)>, empty: Bool) -> IO(List<Chan(Result<&1,&1,U32 & String,String>)>):
  match empty:
    case True{}: IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)>,tasks)
    case False{}: do IO<List<Chan(Result<&1,&1,U32 & String,String>)>>:
      task : Chan(Result<&1,&1,U32 & String,String>) <- IO.fork(Result<&1,&1,U32 & String,String>,deliver(db,id))
      IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)>,task <> tasks)

# A failed transaction cannot publish a parent wake or send a stored answer.
def saved(db: String, tasks: List<Chan(Result<&1,&1,U32 & String,String>)>, result: Result<&1,&1,U32 & String,String>) -> IO(List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool):
  match result:
    case Fail{(code,+text)}: IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool,(tasks,(U32.show(code) ++ ": " ++ text,Bool.not(Store.refused(text)))))
    case Done{+id}: do IO<List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool>:
      next : List<Chan(Result<&1,&1,U32 & String,String>)> <- fork_saved(db,Tx.trim_nl(id),tasks,String.is_empty(id))
      IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool,(next,("",False{})))

def record(+db: String, player: String, turn: String, attempt: String, event: String, tasks: List<Chan(Result<&1,&1,U32 & String,String>)>, parent: Bool) -> IO(List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool):
  match parent:
    case False{}: do IO<List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool>:
      shown : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output("Native OMP UI request is unsupported for a session without a registered parent; its full frame remains in the native log.\n")
      IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool,(tasks,("Native OMP UI request has no registered parent; interaction requires a registered parent.",False{})))
    case True{}: do IO<List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool>:
      ready : String <- IO.try(String,prepare_projection(db))
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ schema() ++ request_sql(player,turn,attempt,event) ++ "COMMIT;")
      accepted : Result<&1,&1,U32 & String,String> <- Store.committed(result)
      saved(db,tasks,accepted)

def observe(+db: String, +player: String, turn: String, attempt: String, +event: String, tasks: List<Chan(Result<&1,&1,U32 & String,String>)>, enabled: Bool) -> IO(List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool):
  match enabled:
    case False{}: IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool,(tasks,("",False{})))
    case True{}: do IO<List<Chan(Result<&1,&1,U32 & String,String>)> & String & Bool>:
      parent : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN parent IS NULL AND json_extract(" ++ C.q(event) ++ ",'$.method') IN ('input','select','confirm','editor') THEN 0 ELSE 1 END FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
      record(db,player,turn,attempt,event,tasks,String.eq(parent,"1\n"))

def closed(+db: String, attempt: String, enabled: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match enabled:
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{""})
    case True{}: do IO<Result<&1,&1,U32 & String,String>>:
      ready : String <- IO.try(String,prepare_projection(db))
      DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ schema() ++ "UPDATE native_requests SET closed=coalesce(closed,'native-exited') WHERE attempt=" ++ C.q(attempt) ++ ";COMMIT;")

def combine(first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: second

@unsafe
def settle(tasks: List<Chan(Result<&1,&1,U32 & String,String>)>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match tasks:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case task <> rest: do IO<Result<&1,&1,U32 & String,Unit>>:
      result : Result<&1,&1,U32 & String,String> <- IO.join(Result<&1,&1,U32 & String,String>,task)
      others : Result<&1,&1,U32 & String,Unit> <- settle(rest)
      IO.pure(Result<&1,&1,U32 & String,Unit>,combine(Delivery.wake_result(result),others))

# The native ID and destination are read from the original request. A response
# contains exactly one method value or an explicit cancellation.
def response_sql(+parent: String, +id: String, +response: String) -> String:
  "WITH supplied(value) AS (VALUES(" ++ C.q(response) ++ ")), valid(frame) AS (SELECT json_patch(json_object('type','extension_ui_response','id',r.native_id),json(supplied.value)) FROM supplied,native_requests r WHERE r.id=" ++ C.q(id) ++ " AND r.parent=" ++ C.q(parent) ++ " AND r.closed IS NULL AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=r.worker) AND CASE WHEN json_valid(supplied.value) THEN json_type(supplied.value)='object' AND (SELECT count(*) FROM json_each(supplied.value))=1 AND (json_type(supplied.value,'$.cancelled')='true' OR (r.method='confirm' AND json_type(supplied.value,'$.confirmed') IN ('true','false')) OR (r.method IN ('input','editor') AND json_type(supplied.value,'$.value')='text') OR (r.method='select' AND json_type(supplied.value,'$.value')='text' AND EXISTS(SELECT 1 FROM json_each(r.event,'$.options') o WHERE o.value=json_extract(supplied.value,'$.value')))) ELSE 0 END) UPDATE native_requests SET reply=coalesce(reply,(SELECT frame FROM valid)) WHERE id=" ++ C.q(id) ++ " AND EXISTS(SELECT 1 FROM valid) AND (reply IS NULL OR reply=(SELECT frame FROM valid));"

def refused(db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    context : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT json_object('request',id,'player',worker,'parent',parent,'method',method,'closed',closed,'stdinWritten',written,'responseStored',reply IS NOT NULL,'sessionStopped',EXISTS(SELECT 1 FROM session_stops WHERE session=native_requests.worker)) FROM native_requests WHERE id=" ++ C.q(id) ++ "),json_object('request'," ++ C.q(id) ++ ",'condition','unknown-request'));"))
    IO.pure(Result<&1,&1,U32 & String,String>,Fail{(1,"Native reply refused. Use the recorded parent and response shape; closed requests and stopped sessions cannot accept replies. " ++ context)})

def reply_result(db: String, id: String, accepted: Bool, already: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match accepted:
    case False{}: refused(db,id)
    case True{}:
      match already:
        case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{"{\"status\":\"stdin-written\"}\n"})
        case False{}: send(db,id)

def reply(+db: String, +parent: String, +id: String, +response: String) -> IO(Unit):
  do IO<Unit>:
    ready : String <- IO.try(String,prepare_projection(db))
    accepted : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ schema() ++ response_sql(parent,id,response) ++ "SELECT changes();COMMIT;"))
    written : String <- IO.try(String,DB.Sql.query(db,"SELECT written FROM native_requests WHERE id=" ++ C.q(id) ++ ";"))
    result : String <- IO.try(String,reply_result(db,id,String.eq(accepted,"1\n"),String.eq(written,"1\n")))
    IO.write(result)
