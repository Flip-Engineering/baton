import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../json/canonical.bend as J

# The historical .root.log pathname remains the delivery log for existing databases.
# The endpoint is an argv JSON array. The committed message ID is its last argument.
def endpoint_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT (SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)) FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' ELSE 0 END AND " ++ condition ++ "),'');"

def result(saved: String, log: String, run: T.RunRes) -> Result<&1,&1,U32 & String,String>:
  match run:
    case T.RRun{T.SExit{0},out}: Done{saved}
    case other: Fail{(1,"Message committed; session delivery failed. Read " ++ log ++ " and retry delivery from the pending inbox.")}

def completed(db: String, saved: String, run: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match run:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+output}: do IO<Result<&1,&1,U32 & String,String>>:
      +log : String <- IO.pure(String,db ++ ".root.log")
      written : Unit <- IO.try(Unit,Text.Text.append(log,output ++ "\n"))
      IO.pure(Result<&1,&1,U32 & String,String>,result(saved,log,Tx.run_res(Done{output})))

def launch(db: String, id: String, saved: String, argv: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match empty:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})
    case False{}: do IO<Result<&1,&1,U32 & String,String>>:
      run : Result<&1,&1,U32 & String,String> <- Process.Process.run(argv ++ Tx.enc_argv(Con{id,Nil{}}),".")
      completed(db,saved,run)

# A stopped recipient retains its original message and receipt. Its parent gets
# one ordinary report naming the retained input and work.
def stopped_kind_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT m.kind FROM messages m JOIN session_stops st ON st.session=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ condition ++ "),'');"

def handoff_sql(+id: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO messages(id,sender,recipient,kind,body) SELECT 'stopped-input:' || lower(hex(m.id)),s.id," ++ C.report_recipient("s.id") ++ ",'report',json_object('type','stopped-recipient-input','recipient',s.id,'stopId',st.id,'originalMessage',m.id,'originalSender',m.sender,'originalKind',m.kind,'originalBody',m.body,'retainedWorkSession',m.sender,'disposition','The original message and work remain available. The stopped recipient has not accepted or reviewed this input.') FROM messages m JOIN sessions s ON s.id=m.recipient JOIN session_stops st ON st.session=s.id WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL" ++ C.message_upsert()
  ++ "SELECT coalesce((SELECT n.id FROM messages n WHERE n.id='stopped-input:' || lower(hex(" ++ C.q(id) ++ ")) AND (n.receipt IS NOT NULL OR EXISTS(SELECT 1 FROM sessions p WHERE p.id=n.recipient AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=p.id) AND CASE WHEN json_valid(p.endpoint) THEN json_type(p.endpoint)='array' AND json_array_length(p.endpoint)>0 ELSE 0 END))),'');COMMIT;"

def handoff_selected(id: String, notification: String, next: String -> IO(Result<&1,&1,U32 & String,String>), empty: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match empty:
    case False{}: next(notification)
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Message " ++ id ++ " is retained for a stopped session. Higher-parent delivery is unavailable; inspect the retained inbox and work.")})

def handoff(db: String, +id: String, next: String -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    selected : String <- IO.try(String,DB.Sql.query(db,handoff_sql(id)))
    +notification : String <- IO.pure(String,Tx.trim_nl(selected))
    handoff_selected(id,notification,next,String.is_empty(notification))

def stopped_delivery(db: String, id: String, next: String -> IO(Result<&1,&1,U32 & String,String>), retained: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match retained:
    case True{}: handoff(db,id,next)
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Session is terminally stopped; the retained input will not execute. Inspect its session and inbox.")})

def normal_delivery(+db: String, +id: String, condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    encoded : String <- IO.try(String,DB.Sql.query(db,endpoint_sql(id,condition)))
    +argv : String <- IO.pure(String,Tx.trim_nl(encoded))
    launch(db,id,saved,argv,String.is_empty(argv))

def routed(+db: String, +id: String, condition: String, +saved: String, +kind: String, ordinary: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match ordinary:
    case False{}: stopped_delivery(db,id,notification => normal_delivery(db,notification,"1",saved),Bool.or(String.eq(kind,"report"),String.eq(kind,"question")))
    case True{}: normal_delivery(db,id,condition,saved)

def deliver(+db: String, +id: String, +condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    value : String <- IO.try(String,DB.Sql.query(db,stopped_kind_sql(id,condition)))
    +kind : String <- IO.pure(String,Tx.trim_nl(value))
    routed(db,id,condition,saved,kind,String.is_empty(kind))

# A sealed observation stored no completion, so it invokes no endpoint.
def observe_delivery(db: String, id: String, +event: String, saved: String, sealed: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match sealed:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})
    case False{}: deliver(db,id,C.terminal(event),saved)

def after(db: String, command: C.Command, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  match command:
    case C.Report{id,sender,body}: deliver(db,id,"1",saved)
    case C.Ask{id,player,body}: deliver(db,id,"1",saved)
    case C.Message{id,sender,recipient,kind,body}: deliver(db,id,"1",saved)
    case C.Observe{id,player,event,sealed}: observe_delivery(db,id,event,saved,sealed)
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})

def wake_result(result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,Unit>:
  match result:
    case Fail{error}: Fail{error}
    case Done{output}: Done{Unit{}}

# The first unacknowledged message for a session after the cursor, in the order
# the store accepted them. The wake reads this one message and nothing else.
def wake_sql(+session: String, cursor: String) -> String:
  "SELECT coalesce((SELECT id FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " ORDER BY seq LIMIT 1),'');"

# The completed native owner has released its session lock before this read.
def wake_pending(+db: String, session: String, cursor: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +id : String <- IO.try(String,DB.Sql.query(db,wake_sql(session,cursor)))
    delivered : Result<&1,&1,U32 & String,String> <- deliver(db,Tx.trim_nl(id),"1","")
    IO.pure(Result<&1,&1,U32 & String,Unit>,wake_result(delivered))

# The strict report delivery reads one projection of the retained report itself:
# its recipient, whether it already has a receipt, whether the recipient's
# endpoint is a usable argument array, and the endpoint encoding as hex so
# arbitrary bytes survive. The host adds one row delimiter, and trim_nl removes
# it from this bounded projection only; no path or argument text is trimmed.
def report_state_sql(+id: String) -> String:
  "SELECT lower(hex(m.recipient)) || ':' || CASE WHEN m.receipt IS NULL THEN 'p' ELSE 'a' END || ':' || CASE WHEN s.endpoint IS NULL OR s.endpoint='' THEN 'e' WHEN json_valid(s.endpoint) AND json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 THEN 'a' ELSE 'x' END || ':' || lower(hex(coalesce((SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)),''))) FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.recipient IS NOT NULL;"

# The envelope always carries the requested report identity, the selected report
# identity, its recipient and an explicit disposition. A completed result states
# only what was observed at this boundary.
def report_envelope(+id: String, +recipient: String, +disposition: String, attempted: Bool, +exit: String, +detail: String) -> String:
  "{\"status\":\"report-delivery\",\"requestedReport\":" ++ J.string_literal(id) ++ ",\"deliveredReport\":" ++ J.string_literal(id) ++ ",\"recipient\":" ++ J.string_literal(recipient) ++ ",\"disposition\":" ++ J.string_literal(disposition) ++ ",\"invocationAttempted\":" ++ Bool.pick(String,attempted,"true","false") ++ ",\"exit\":" ++ J.string_literal(exit) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}"

def report_run(+id: String, +recipient: String, run: T.RunRes) -> Result<&1,&1,U32 & String,String>:
  match run:
    case T.RRun{T.SExit{0},_}: Done{report_envelope(id,recipient,"invoked",True{},"0","Endpoint process completed and exited zero.")}
    case T.RRun{T.SExit{n},_}: Fail{(1,report_envelope(id,recipient,"invoked-failed",True{},U32.show(n),"Endpoint process completed without exit zero."))}
    case other: Fail{(1,report_envelope(id,recipient,"invocation-failed",True{},"","The endpoint process reported no exit status."))}

def report_logged(+id: String, +recipient: String, +output: String, written: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,String>:
  match written:
    case Fail{(code,detail)}: Fail{(code,report_envelope(id,recipient,"invoked-log-failed",True{},"0",detail))}
    case Done{_}: report_run(id,recipient,Tx.run_res(Done{output}))

def report_outcome(+db: String, +id: String, +recipient: String, run: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match run:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,report_envelope(id,recipient,"invocation-failed",True{},"",detail))})
    case Done{+output}: do IO<Result<&1,&1,U32 & String,String>>:
      log : String <- IO.pure(String,db ++ ".root.log")
      written : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(log,output ++ "\n")
      IO.pure(Result<&1,&1,U32 & String,String>,report_logged(id,recipient,output,written))

def report_launch(+db: String, +id: String, +recipient: String, +argv: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    run : Result<&1,&1,U32 & String,String> <- Process.Process.run(argv ++ Tx.enc_argv(Con{id,Nil{}}),".")
    report_outcome(db,id,recipient,run)

def report_endpoint(+db: String, +id: String, +recipient: String, state: String, +argv: String) -> IO(Result<&1,&1,U32 & String,String>):
  match state:
    case "e": IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,report_envelope(id,recipient,"endpoint-absent",False{},"","The recorded endpoint is absent; the report and its input are retained."))})
    case "x": IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,report_envelope(id,recipient,"endpoint-malformed",False{},"","The recorded endpoint is not a usable argument array; the report and its input are retained."))})
    case "a": report_launch(db,id,recipient,argv)
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,report_envelope(id,recipient,"endpoint-unknown",False{},"","The recorded endpoint state is unknown; the report and its input are retained."))})

def report_receipt(+db: String, +id: String, +recipient: String, receipt: String, +state: String, +argv: String) -> IO(Result<&1,&1,U32 & String,String>):
  match receipt:
    case "a": IO.pure(Result<&1,&1,U32 & String,String>,Done{report_envelope(id,recipient,"already-acknowledged",False{},"","The retained report already has a receipt; no endpoint was invoked.")})
    case "p": report_endpoint(db,id,recipient,state,argv)
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,report_envelope(id,recipient,"report-state-unknown",False{},"","The retained report state is unknown; the report and its input are retained."))})

def report_fields(+db: String, +id: String, rows: List<String>) -> IO(Result<&1,&1,U32 & String,String>):
  match rows:
    case recipient_hex <> receipt <> state <> argv_hex <> Nil{}: report_receipt(db,id,Tx.hex_decode(recipient_hex),receipt,state,Tx.hex_decode(argv_hex))
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,report_envelope(id,"","report-projection-malformed",False{},"","The retained report projection is not the expected four fields; the report and its input are retained."))})

def report_present(+db: String, +id: String, rows: String, missing: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match missing:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,report_envelope(id,"","report-missing",False{},"","No eligible retained report matches this id; its input is retained."))})
    case False{}: report_fields(db,id,String.split(rows,Char.from_u32(58)))

def report_selected(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    selected : String <- IO.try(String,DB.Sql.query(db,report_state_sql(id)))
    +rows : String <- IO.pure(String,Tx.trim_nl(selected))
    report_present(db,id,rows,String.is_empty(rows))

def report_route(+db: String, +id: String, ordinary: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match ordinary:
    case True{}: report_selected(db,id)
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,report_envelope(id,"","stopped-recipient-routing",False{},"","The recipient session is stopped with retained input; the stopped-route handoff is the next bounded slice, and no endpoint was invoked."))})

# The strict entry for one committed report. The caller resolves the report id;
# nothing here accepts a caller-supplied recipient or endpoint.
def deliver_report(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    stopped : String <- IO.try(String,DB.Sql.query(db,stopped_kind_sql(id,"1")))
    +kind : String <- IO.pure(String,Tx.trim_nl(stopped))
    report_route(db,id,String.is_empty(kind))
