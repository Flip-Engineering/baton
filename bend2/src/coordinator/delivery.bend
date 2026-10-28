import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../host/process.bend as Child
import ../host/session-lock.bend as Lock
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T
import ./codex-route.bend as CodexRoute
import ../json/canonical.bend as J
import ../context/request.bend as Req

# The historical .root.log pathname remains the delivery log for existing databases.
# The endpoint is an argv JSON array. The committed message ID is its last argument.
def endpoint_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT (SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)) FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("m") ++ " AND CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' ELSE 0 END AND " ++ condition ++ "),'');"

def native_receiver_sql() -> String:
  "CASE WHEN json_valid(s.endpoint) THEN s.harness IN ('codex','omp','muse','claude-code','dsh','antigravity') AND json_extract(s.endpoint,'$[#-7]')='receive' AND json_extract(s.endpoint,'$[#-6]')=s.id ELSE 0 END"

def codex_inbox_endpoint_sql(id: String, condition: String) -> String:
  "SELECT EXISTS(SELECT 1 FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("m") ++ " AND " ++ condition ++ " AND s.harness='codex' AND " ++ CodexRoute.managed_sql("s.endpoint","s.id","s.native") ++ ");"

def result(saved: String, log: String, run: T.RunRes) -> Result<&1,&1,U32 & String,String>:
  match run:
    case T.RRun{T.SExit{0},out}: Done{saved}
    case T.RRun{T.SExit{code},out}: Fail{(1,"Message committed; session delivery failed (exit " ++ U32.show(code) ++ "): " ++ out ++ "\nRead " ++ log ++ " and retry delivery from the pending inbox.")}
    case T.RRun{T.SSignal{signal},out}: Fail{(1,"Message committed; session delivery failed (signal " ++ U32.show(signal) ++ "): " ++ out ++ "\nRead " ++ log ++ " and retry delivery from the pending inbox.")}
    case T.RSpawn{detail}: Fail{(1,"Message committed; session delivery failed: " ++ detail ++ ". Read " ++ log ++ " and retry delivery from the pending inbox.")}

# A delivery whose log record cannot be written is reported as one that needs
# inspection: the endpoint ran, and the delivery record does not exist.
def logged(saved: String, log: String, output: String, written: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,String>:
  match written:
    case Fail{(code,text)}: Fail{(1,"Message delivered; the delivery log " ++ log ++ " could not be written: " ++ U32.show(code) ++ ": " ++ text ++ ". Read the recipient's inbox and the retained native log.")}
    case Done{unit}: result(saved,log,Tx.run_res(Done{output}))

def failed_record(log: String, +code: U32, +detail: String, written: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,String>:
  match written:
    case Done{unit}: Fail{(code,"Message committed; session delivery failed: " ++ U32.show(code) ++ ": " ++ detail ++ ". Read " ++ log ++ " and retry delivery from the pending inbox.")}
    case Fail{(log_code,log_error)}: Fail{(code,"Message committed; session delivery failed: " ++ U32.show(code) ++ ": " ++ detail ++ ". Delivery log " ++ log ++ " could not be written: " ++ U32.show(log_code) ++ ": " ++ log_error)}

def completed(db: String, saved: String, run: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match run:
    case Fail{(+code,+detail)}: do IO<Result<&1,&1,U32 & String,String>>:
      +log : String <- IO.pure(String,db ++ ".root.log")
      written : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(log,"delivery error " ++ U32.show(code) ++ ": " ++ detail ++ "\n")
      IO.pure(Result<&1,&1,U32 & String,String>,failed_record(log,code,detail,written))
    case Done{+output}: do IO<Result<&1,&1,U32 & String,String>>:
      +log : String <- IO.pure(String,db ++ ".root.log")
      written : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(log,output ++ "\n")
      IO.pure(Result<&1,&1,U32 & String,String>,logged(saved,log,output,written))

def launch(db: String, id: String, saved: String, argv: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    run : Result<&1,&1,U32 & String,String> <- Process.Process.run(argv ++ Tx.enc_argv(Con{id,Nil{}}),".")
    completed(db,saved,run)

# A stopped recipient retains its original message and read state. Its parent gets
# one ordinary report naming the retained input and work.
def stopped_kind_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT m.kind FROM messages m JOIN session_stops st ON st.session=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("m") ++ " AND " ++ condition ++ "),'');"

def handoff_sql(+id: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO messages(id,sender,recipient,kind,body) SELECT 'stopped-input:' || lower(hex(m.id)),s.id," ++ C.report_recipient("s.id") ++ ",'report',json_object('type','stopped-recipient-input','recipient',s.id,'stopId',st.id,'originalMessage',m.id,'originalSender',m.sender,'originalKind',m.kind,'originalBody',m.body,'retainedWorkSession',m.sender,'disposition','The original message and work remain available. The stopped recipient has not accepted or reviewed this input.') FROM messages m JOIN sessions s ON s.id=m.recipient JOIN session_stops st ON st.session=s.id WHERE m.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("m") ++ " AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL" ++ C.message_upsert()
  ++ "SELECT coalesce((SELECT n.id FROM messages n WHERE n.id='stopped-input:' || lower(hex(" ++ C.q(id) ++ ")) AND (" ++ C.read_sql("n") ++ " OR EXISTS(SELECT 1 FROM sessions p WHERE p.id=n.recipient AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=p.id) AND (CASE WHEN json_valid(p.endpoint) THEN json_type(p.endpoint)='array' AND json_array_length(p.endpoint)>0 ELSE 0 END OR p.harness='codex')))),'');COMMIT;"

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

def endpointless_harness_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT s.harness FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("m") ++ " AND " ++ condition ++ "),'');"

def endpointless_native_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT s.native FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("m") ++ " AND " ++ condition ++ "),'');"

def endpointless_recipient_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT m.recipient FROM messages m WHERE m.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("m") ++ " AND " ++ condition ++ "),'');"

# The claim retains admission custody for the whole inbox. Recipient progress
# and newer coordinator control input permit another notification.
def queue_metadata_sql(+value: String) -> String:
  "CASE WHEN json_valid(" ++ value ++ ") THEN json_type(" ++ value ++ ")='object' AND json_type(" ++ value ++ ",'$.inputSeq') IN ('integer','real') AND json_extract(" ++ value ++ ",'$.inputSeq')=CAST(json_extract(" ++ value ++ ",'$.inputSeq') AS INTEGER) ELSE 0 END"

def queue_retry_sql(recipient: String, retry: Bool) -> String:
  match retry:
    case False{}: ""
    case True{}: "DELETE FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ " AND CASE WHEN " ++ queue_metadata_sql("cause") ++ " THEN json_type(cause,'$.cause') IS NOT NULL ELSE cause<>'' END;"

def queue_claim_sql(+id: String, +condition: String, +recipient: String, +native: String, retry: Bool) -> String:
  "BEGIN IMMEDIATE;"
  ++ "CREATE TABLE IF NOT EXISTS codex_inbox_wakes(session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),native TEXT NOT NULL,token TEXT NOT NULL,cause TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TRIGGER IF NOT EXISTS codex_inbox_wake_read AFTER INSERT ON message_reads BEGIN DELETE FROM codex_inbox_wakes WHERE session=NEW.recipient;END;"
  ++ "DELETE FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ " AND native<>" ++ C.q(native) ++ ";"
  ++ queue_retry_sql(recipient,retry)
  ++ "DELETE FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ " AND EXISTS(SELECT 1 FROM messages m WHERE m.id=" ++ C.q(id) ++ " AND m.recipient=codex_inbox_wakes.session AND " ++ C.owed_sql("m") ++ " AND " ++ condition ++ " AND (m.kind IN ('task','guidance','recovery','task-assignment','task-continuation','completion-confirmed','question') OR EXISTS(SELECT 1 FROM session_roles r WHERE r.session=m.sender AND r.role='operator') OR CASE WHEN " ++ queue_metadata_sql("codex_inbox_wakes.cause") ++ " THEN json_type(codex_inbox_wakes.cause,'$.cause') IS NOT NULL ELSE codex_inbox_wakes.cause<>'' END) AND m.seq>CASE WHEN " ++ queue_metadata_sql("codex_inbox_wakes.cause") ++ " THEN json_extract(codex_inbox_wakes.cause,'$.inputSeq') ELSE (SELECT max(seq) FROM messages WHERE recipient=codex_inbox_wakes.session AND seq<m.seq) END);"
  ++ "INSERT INTO codex_inbox_wakes(session,native,token,cause) SELECT s.id,s.native,lower(hex(randomblob(16))),json_object('inputSeq',(SELECT max(seq) FROM messages WHERE recipient=s.id)) FROM sessions s WHERE s.id=" ++ C.q(recipient) ++ " AND s.harness='codex' AND s.native=" ++ C.q(native) ++ " AND NOT " ++ C.stopped_session_sql("s.id") ++ " AND EXISTS(SELECT 1 FROM messages m WHERE m.id=" ++ C.q(id) ++ " AND m.recipient=s.id AND " ++ C.owed_sql("m") ++ " AND " ++ condition ++ ") ON CONFLICT(session) DO NOTHING;"
  ++ "SELECT CASE WHEN changes()=1 THEN (SELECT token FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ ") ELSE '' END;COMMIT;"

def queue_pointer(db: String, id: String, recipient: String, pending: String, token: String) -> String:
  "Baton input is pending.\n{\"database\":" ++ J.string_literal(db) ++ ",\"message\":" ++ J.string_literal(id) ++ ",\"recipient\":" ++ J.string_literal(recipient) ++ ",\"pendingCount\":" ++ pending ++ ",\"claimToken\":" ++ J.string_literal(token) ++ "}"

def queue_waited(output: String, result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  match result:
    case Fail{error}: Fail{error}
    case Done{status}: Done{status ++ "\n" ++ output}

@unsafe
def queue_read_result(line: Result<&1,&1,U32 & String,Maybe<String>>, +handle: U32, output: String) -> IO(Result<&1,&1,U32 & String,String>):
  match line:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,String>>:
      waited : Result<&1,&1,U32 & String,String> <- Child.ProcessChild.wait(handle)
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{None{}}: do IO<Result<&1,&1,U32 & String,String>>:
      waited : Result<&1,&1,U32 & String,String> <- Child.ProcessChild.wait(handle)
      IO.pure(Result<&1,&1,U32 & String,String>,queue_waited(output,waited))
    case Done{Some{text}}: do IO<Result<&1,&1,U32 & String,String>>:
      next : Result<&1,&1,U32 & String,Maybe<String>> <- Child.ProcessChild.read_line(handle)
      queue_read_result(next,handle,output ++ text ++ "\n")

def queue_closed(+handle: U32, closed: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,String>):
  match closed:
    case Fail{error}: do IO<Result<&1,&1,U32 & String,String>>:
      waited : Result<&1,&1,U32 & String,String> <- Child.ProcessChild.wait(handle)
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{unit}: do IO<Result<&1,&1,U32 & String,String>>:
      line : Result<&1,&1,U32 & String,Maybe<String>> <- Child.ProcessChild.read_line(handle)
      queue_read_result(line,handle,"")

def queue_spawned(spawned: Result<&1,&1,U32 & String,U32>) -> IO(Result<&1,&1,U32 & String,String>):
  match spawned:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+handle}: do IO<Result<&1,&1,U32 & String,String>>:
      closed : Result<&1,&1,U32 & String,Unit> <- Child.ProcessChild.close_stdin(handle)
      queue_closed(handle,closed)

def queue_stderr(db: String, saved: String, output: String, error: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match error:
    case Fail{(code,detail)}: completed(db,saved,Fail{(code,output ++ "Queue stderr read failed: " ++ detail)})
    case Done{text}: completed(db,saved,Done{output ++ text})

def queue_captured(+db: String, saved: String, stderr: String, run: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match run:
    case Fail{error}: completed(db,saved,Fail{error})
    case Done{output}: do IO<Result<&1,&1,U32 & String,String>>:
      error : Result<&1,&1,U32 & String,String> <- Text.Text.read(stderr)
      queue_stderr(db,saved,output,error)

def queue_recorded(+db: String, recipient: String, token: String, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Done{output}: IO.pure(Result<&1,&1,U32 & String,String>,Done{output})
    case Fail{(+code,+cause)}: do IO<Result<&1,&1,U32 & String,String>>:
      recorded : String <- IO.try(String,DB.Sql.query(db,"UPDATE codex_inbox_wakes SET cause=CASE WHEN json_valid(cause) THEN json_set(cause,'$.cause'," ++ C.q(cause) ++ ") ELSE json_object('cause'," ++ C.q(cause) ++ ") END WHERE session=" ++ C.q(recipient) ++ " AND token=" ++ C.q(token) ++ ";"))
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,cause)})

# Public lifecycle stderr and stdout are retained with the admission result. Ordinary
# admissions share the notification; explicit resume retries a failed attempt.
def queue_launch(+db: String, id: String, saved: String, native: String, +recipient: String, +token: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    pending : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE recipient=" ++ C.q(recipient) ++ " AND " ++ C.owed_sql("messages") ++ ";"))
    pointer : String <- IO.pure(String,queue_pointer(db,id,recipient,Tx.trim_nl(pending),token))
    +stderr : String <- IO.pure(String,db ++ ".queue-" ++ token ++ ".stderr")
    spawned : Result<&1,&1,U32 & String,U32> <- CodexRoute.admission(db,recipient,native,pointer,stderr)
    run : Result<&1,&1,U32 & String,String> <- queue_spawned(spawned)
    result : Result<&1,&1,U32 & String,String> <- queue_captured(db,saved,stderr,run)
    queue_recorded(db,recipient,token,result)

def queue_cause(decoded: Req.Scalar) -> IO(String):
  match decoded:
    case Req.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,22,"Stored Codex wake failure could not be decoded: " ++ Req.scalar_reason(other))

def queue_refresh(saved: String, token: String, next: String -> IO(Result<&1,&1,U32 & String,String>), fresh: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match fresh:
    case True{}: next(token)
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Done{saved})

def queue_coalesced(+db: String, id: String, saved: String, +recipient: String, cause: String, failed: Bool, next: String -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Result<&1,&1,U32 & String,String>):
  match failed:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(1,cause)})
    case False{}: do IO<Result<&1,&1,U32 & String,String>>:
      row : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT w.token FROM codex_inbox_wakes w JOIN messages m ON m.recipient=w.session WHERE w.session=" ++ C.q(recipient) ++ " AND m.id=" ++ C.q(id) ++ " AND " ++ C.owed_sql("m") ++ " AND CASE WHEN " ++ queue_metadata_sql("w.cause") ++ " THEN json_type(w.cause,'$.turnId')='text' AND m.seq>json_extract(w.cause,'$.inputSeq') ELSE 0 END),'');"))
      +token : String <- IO.pure(String,Tx.trim_nl(row))
      queue_refresh(saved,token,next,Bool.not(String.is_empty(token)))

def queue_existing(+db: String, id: String, saved: String, +recipient: String, next: String -> IO(Result<&1,&1,U32 & String,String>)) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    row : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT hex(CASE WHEN " ++ queue_metadata_sql("cause") ++ " THEN coalesce(json_extract(cause,'$.cause'),'') ELSE cause END) FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ "),'');"))
    +cause : String <- queue_cause(Req.decode_scalar_utf8(Tx.hex_decode(Tx.trim_nl(row))))
    queue_coalesced(db,id,saved,recipient,cause,Bool.not(String.is_empty(cause)),next)

def queue_selected(+db: String, +id: String, +saved: String, native: String, +recipient: String, token: String, coalesced: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match coalesced:
    case False{}: queue_launch(db,id,saved,native,recipient,token)
    case True{}: queue_existing(db,id,saved,recipient,next_token => queue_launch(db,id,saved,native,recipient,next_token))

def queue_claimed(+db: String, +id: String, condition: String, saved: String, +native: String, +recipient: String, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    row : String <- IO.try(String,DB.Sql.query(db,queue_claim_sql(id,condition,recipient,native,retry)))
    +token : String = Tx.trim_nl(row)
    queue_selected(db,id,saved,native,recipient,token,String.is_empty(token))

def queue_native(db: String, id: String, condition: String, saved: String, native: String, recipient: String, retry: Bool, absent: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match absent:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Message " ++ id ++ " is addressed to a Codex session that records no native session identity. Public Codex input requires that recorded identity. Connect an endpoint or record the session's native identity, then retry delivery from the pending inbox.")})
    case False{}: queue_claimed(db,id,condition,saved,native,recipient,retry)

def codex_queue_mode(+db: String, +id: String, +condition: String, saved: String, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    native_row : String <- IO.try(String,DB.Sql.query(db,endpointless_native_sql(id,condition)))
    +native : String <- IO.pure(String,Tx.trim_nl(native_row))
    recipient_row : String <- IO.try(String,DB.Sql.query(db,endpointless_recipient_sql(id,condition)))
    recipient : String <- IO.pure(String,Tx.trim_nl(recipient_row))
    queue_native(db,id,condition,saved,native,recipient,retry,String.is_empty(native))

# Explicit resume retries retained failed input. Newer committed input and
# recipient progress permit another admission.
def codex_queue(db: String, id: String, condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  codex_queue_mode(db,id,condition,saved,True{})

def endpointless(+db: String, +id: String, +condition: String, +saved: String, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    harness_row : String <- IO.try(String,DB.Sql.query(db,endpointless_harness_sql(id,condition)))
    +harness : String <- IO.pure(String,Tx.trim_nl(harness_row))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(harness,"codex"),
      codex_queue_mode(db,id,condition,saved,retry),
      IO.pure(Result<&1,&1,U32 & String,String>,Done{saved}))

def inbox_endpoint_launch(+db: String, id: String, saved: String, argv: String, recipient: String, +token: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    run : Result<&1,&1,U32 & String,String> <- Process.Process.run(argv ++ Tx.enc_argv(Con{id,Con{token,Nil{}}}),".")
    delivered : Result<&1,&1,U32 & String,String> <- completed(db,saved,run)
    queue_recorded(db,recipient,token,delivered)

def inbox_endpoint_selected(+db: String, +id: String, +saved: String, argv: String, +recipient: String, token: String, coalesced: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match coalesced:
    case True{}: queue_existing(db,id,saved,recipient,next_token => inbox_endpoint_launch(db,id,saved,argv,recipient,next_token))
    case False{}: inbox_endpoint_launch(db,id,saved,argv,recipient,token)

def inbox_endpoint(+db: String, +id: String, +condition: String, saved: String, argv: String, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    native_row : String <- IO.try(String,DB.Sql.query(db,endpointless_native_sql(id,condition)))
    +native : String <- IO.pure(String,Tx.trim_nl(native_row))
    recipient_row : String <- IO.try(String,DB.Sql.query(db,endpointless_recipient_sql(id,condition)))
    +recipient : String <- IO.pure(String,Tx.trim_nl(recipient_row))
    row : String <- IO.try(String,DB.Sql.query(db,queue_claim_sql(id,condition,recipient,native,retry)))
    +token : String <- IO.pure(String,Tx.trim_nl(row))
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    args : List<String> <- CodexRoute.command(db,recipient,[executable,db,"codex-inbox-session",recipient,native])
    inbox_endpoint_selected(db,id,saved,Tx.enc_argv(args),recipient,token,String.is_empty(token))

def endpoint_delivery(+db: String, +id: String, +condition: String, +saved: String, +argv: String, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    managed : String <- IO.try(String,DB.Sql.query(db,codex_inbox_endpoint_sql(id,condition)))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(managed,"1\n"),inbox_endpoint(db,id,condition,saved,argv,retry),launch(db,id,saved,argv))

def normal_delivery(+db: String, +id: String, +condition: String, +saved: String, +retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    encoded : String <- IO.try(String,DB.Sql.query(db,endpoint_sql(id,condition)))
    +argv : String <- IO.pure(String,Tx.trim_nl(encoded))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(argv),
      endpointless(db,id,condition,saved,retry),endpoint_delivery(db,id,condition,saved,argv,retry))

def routed(+db: String, +id: String, condition: String, +saved: String, +kind: String, ordinary: Bool, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match ordinary:
    case False{}: stopped_delivery(db,id,notification => normal_delivery(db,notification,"1",saved,False{}),Bool.or(String.eq(kind,"report"),String.eq(kind,"question")))
    case True{}: normal_delivery(db,id,condition,saved,retry)

def deliver_mode(+db: String, +id: String, +condition: String, saved: String, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    value : String <- IO.try(String,DB.Sql.query(db,stopped_kind_sql(id,condition)))
    +kind : String <- IO.pure(String,Tx.trim_nl(value))
    routed(db,id,condition,saved,kind,String.is_empty(kind),retry)

def deliver(db: String, id: String, condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  deliver_mode(db,id,condition,saved,False{})

# An explicit resume retries the retained failed admission through its current route.
def redeliver(db: String, id: String, condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  deliver_mode(db,id,condition,saved,True{})

def dispatch_canonical(executable: String, canonical_result: Result<&1,&1,U32 & String,String>, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  match canonical_result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+canonical}: Process.Process.run(Tx.enc_argv([executable,"--dispatch-message",canonical,id]),".")

def dispatch_argv(executable_result: Result<&1,&1,U32 & String,String>, canonical_result: Result<&1,&1,U32 & String,String>, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  match executable_result:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})
    case Done{+executable}: dispatch_canonical(executable,canonical_result,id)

def dispatch_existing(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    executable_result : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.executable()
    canonical_result : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(db)
    dispatch_argv(executable_result,canonical_result,id)

def failure_report_result(saved: Result<&1,&1,U32 & String,String>, +db: String, +id: String) -> IO(Unit):
  match saved:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{output}: do IO<Unit>:
      dispatched : Result<&1,&1,U32 & String,String> <- dispatch_existing(db,id)
      IO.pure(Unit,Unit{})

# A failure report is inserted first. Dispatch runs the existing self
# --dispatch-message entry only after a successful insert; that subprocess keeps
# the complete delivery route and returns a process Result. The insert and
# process Results are ignored so the caller keeps its original recovery or
# continuation failure.

def failure_report(+db: String, +session: String, +id: String, +body: String) -> IO(Unit):
  do IO<Unit>:
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id) ++ ",s.id," ++ C.report_recipient("s.id") ++ ",'report'," ++ C.q(body) ++ " FROM sessions s WHERE s.id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL;")
    failure_report_result(saved,db,id)

def wake_result(result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,Unit>:
  match result:
    case Fail{error}: Fail{error}
    case Done{output}: Done{Unit{}}

# The first unread task input for a session after the cursor, preferring
# task, assignment and continuation input over stale reports. The wake reads
# this one message and nothing else.
def wake_sql(+session: String, cursor: String) -> String:
  "SELECT coalesce((SELECT id FROM messages WHERE recipient=" ++ C.q(session) ++ " AND " ++ C.owed_sql("messages") ++ " AND seq>CAST(" ++ C.q(cursor) ++ " AS INTEGER) AND NOT " ++ C.stopped_session_sql(C.q(session)) ++ " ORDER BY CASE kind WHEN 'task' THEN 0 WHEN 'task-assignment' THEN 0 WHEN 'task-continuation' THEN 0 WHEN 'guidance' THEN 1 WHEN 'recovery' THEN 1 ELSE 2 END, seq LIMIT 1),'');"

# The completed native owner has released its session lock before this read.
def wake_pending(+db: String, session: String, cursor: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    +id : String <- IO.try(String,DB.Sql.query(db,wake_sql(session,cursor)))
    delivered : Result<&1,&1,U32 & String,String> <- deliver(db,Tx.trim_nl(id),"1","")
    IO.pure(Result<&1,&1,U32 & String,Unit>,wake_result(delivered))
