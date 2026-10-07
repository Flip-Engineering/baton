import Base
import ./native-requests.bend as Requests
import ../host/process.bend as P
import ../host/sqlite.bend as DB
import ../git/text.bend as Tx
import ./commands.bend as C
import ../host/text.bend as Text

law parentless_request_preserves_its_error_after_control_output:
  for +db: String
  for player: String
  for turn: String
  for attempt: String
  for event: String
  for -tasks: List<Chan(Result<&1,&1,U32 & String,String>)>
  {Requests.record(db,player,turn,attempt,event,tasks,False{}) == (do IO<List<Chan(Result<&1,&1,U32 & String,String>)> & String>:
    shown : Result<&1,&1,U32 & String,Unit> <- Text.Text.control_output("Native OMP UI request is unsupported for a session without a registered parent; its full frame remains in the native log.\n")
    IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)> & String,(tasks,"Native OMP UI request has no registered parent; interaction requires a registered parent."))) : IO(List<Chan(Result<&1,&1,U32 & String,String>)> & String)}

def parentless_request_preserves_its_error_after_control_output(db,player,turn,attempt,event,tasks):
  {==}

# SQL validation supplies admission and the recorded attempt. Host tests cover
# socket identity, complete pipe writes, observer ownership and native exit.
law native_reply_refusal_cannot_write:
  for +attempt: String
  for +frame: String
  {Requests.dispatch(attempt,frame,False{}) == IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{(1,"Native request is closed, unavailable, or belongs to another parent.")}) : IO(Result<&1,&1,U32 & String,Unit>)}

def native_reply_refusal_cannot_write(attempt,frame):
  {==}

law native_reply_uses_recorded_attempt_and_frame:
  for +attempt: String
  for +frame: String
  {Requests.dispatch(attempt,frame,True{}) == P.ProcessChild.control_write(attempt,frame) : IO(Result<&1,&1,U32 & String,Unit>)}

def native_reply_uses_recorded_attempt_and_frame(attempt,frame):
  {==}

law native_question_failed_record_cannot_wake:
  for +db: String
  for +code: U32
  for +text: String
  for -tasks: List<Chan(Result<&1,&1,U32 & String,String>)>
  {Requests.saved(db,tasks,Fail{(code,text)}) == IO.pure(List<Chan(Result<&1,&1,U32 & String,String>)> & String,(tasks,U32.show(code) ++ ": " ++ text)) : IO(List<Chan(Result<&1,&1,U32 & String,String>)> & String)}

def native_question_failed_record_cannot_wake(db,code,text,tasks):
  {==}

def recorded_send(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    allowed : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM native_requests WHERE id=" ++ C.q(id) ++ " AND reply IS NOT NULL AND closed IS NULL AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=native_requests.worker));"))
    attempt : String <- IO.try(String,DB.Sql.query(db,"SELECT attempt FROM native_requests WHERE id=" ++ C.q(id) ++ ";"))
    frame : String <- IO.try(String,DB.Sql.query(db,"SELECT reply FROM native_requests WHERE id=" ++ C.q(id) ++ ";"))
    result : Result<&1,&1,U32 & String,Unit> <- Requests.dispatch(Tx.trim_nl(attempt),frame,String.eq(allowed,"1\n"))
    Requests.written(db,id,result)

# The called send function performs these request lookups before dispatch. The
# previous dispatch laws constrain the two branches reached by that result.
law native_reply_send_reads_recorded_request:
  for +db: String
  for +id: String
  {Requests.send(db,id) == recorded_send(db,id) : IO(Result<&1,&1,U32 & String,String>)}

def native_reply_send_reads_recorded_request(db,id):
  {==}

law native_reply_failed_write_has_no_success_marker:
  for db: String
  for id: String
  for +code: U32
  for +text: String
  {Requests.written(db,id,Fail{(code,text)}) == IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,text)}) : IO(Result<&1,&1,U32 & String,String>)}

def native_reply_failed_write_has_no_success_marker(db,id,code,text):
  {==}

def admitted_reply(+db: String, +parent: String, +id: String, +response: String) -> IO(Unit):
  do IO<Unit>:
    accepted : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ C.schema() ++ Requests.schema() ++ Requests.response_sql(parent,id,response) ++ "SELECT changes();COMMIT;"))
    written : String <- IO.try(String,DB.Sql.query(db,"SELECT written FROM native_requests WHERE id=" ++ C.q(id) ++ ";"))
    result : String <- IO.try(String,Requests.reply_result(db,id,String.eq(accepted,"1\n"),String.eq(written,"1\n")))
    IO.write(result)

law native_reply_dispatch_follows_response_admission:
  for +db: String
  for +parent: String
  for +id: String
  for +response: String
  {Requests.reply(db,parent,id,response) == admitted_reply(db,parent,id,response) : IO(Unit)}

def native_reply_dispatch_follows_response_admission(db,parent,id,response):
  {==}

def refusal_context(db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    context : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT json_object('request',id,'player',worker,'parent',parent,'method',method,'closed',closed,'stdinWritten',written,'responseStored',reply IS NOT NULL,'sessionStopped',EXISTS(SELECT 1 FROM session_stops WHERE session=native_requests.worker)) FROM native_requests WHERE id=" ++ C.q(id) ++ "),json_object('request'," ++ C.q(id) ++ ",'condition','unknown-request'));"))
    IO.pure(Result<&1,&1,U32 & String,String>,Fail{(1,"Native reply refused. Use the recorded parent and response shape; closed requests and stopped sessions cannot accept replies. " ++ context)})

law native_reply_unadmitted_response_cannot_send:
  for +db: String
  for +id: String
  for already: Bool
  {Requests.reply_result(db,id,False{},already) == refusal_context(db,id) : IO(Result<&1,&1,U32 & String,String>)}

def native_reply_unadmitted_response_cannot_send(db,id,already):
  {==}

# This equation binds the generated parent/method/selection and immutable-answer
# predicates. SQLite execution is exercised by the native receive fixtures.
law native_reply_sql_checks_parent_method_and_immutable_answer:
  for +parent: String
  for +id: String
  for +response: String
  {Requests.response_sql(parent,id,response) == "WITH supplied(value) AS (VALUES(" ++ C.q(response) ++ ")), valid(frame) AS (SELECT json_patch(json_object('type','extension_ui_response','id',r.native_id),json(supplied.value)) FROM supplied,native_requests r WHERE r.id=" ++ C.q(id) ++ " AND r.parent=" ++ C.q(parent) ++ " AND r.closed IS NULL AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=r.worker) AND CASE WHEN json_valid(supplied.value) THEN json_type(supplied.value)='object' AND (SELECT count(*) FROM json_each(supplied.value))=1 AND (json_type(supplied.value,'$.cancelled')='true' OR (r.method='confirm' AND json_type(supplied.value,'$.confirmed') IN ('true','false')) OR (r.method IN ('input','editor') AND json_type(supplied.value,'$.value')='text') OR (r.method='select' AND json_type(supplied.value,'$.value')='text' AND EXISTS(SELECT 1 FROM json_each(r.event,'$.options') o WHERE o.value=json_extract(supplied.value,'$.value')))) ELSE 0 END) UPDATE native_requests SET id=CASE WHEN reply IS NULL OR reply=(SELECT frame FROM valid) THEN id ELSE NULL END,reply=coalesce(reply,(SELECT frame FROM valid)) WHERE id=" ++ C.q(id) ++ " AND EXISTS(SELECT 1 FROM valid);" : String}

def native_reply_sql_checks_parent_method_and_immutable_answer(parent,id,response):
  {==}
