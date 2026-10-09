import Base
import ../coordinator/commands.bend as C
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../host/process.bend as Child
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../harness/codex-player.bend as Codex
import ../json/canonical.bend as J

# The historical .root.log pathname remains the delivery log for existing databases.
# The endpoint is an argv JSON array. The committed message ID is its last argument.
def endpoint_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT (SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)) FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND CASE WHEN json_valid(s.endpoint) THEN json_type(s.endpoint)='array' ELSE 0 END AND " ++ condition ++ "),'');"

def result(saved: String, log: String, run: T.RunRes) -> Result<&1,&1,U32 & String,String>:
  match run:
    case T.RRun{T.SExit{0},out}: Done{saved}
    case other: Fail{(1,"Message committed; session delivery failed. Read " ++ log ++ " and retry delivery from the pending inbox.")}

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

# A stopped recipient retains its original message and receipt. Its parent gets
# one ordinary report naming the retained input and work.
def stopped_kind_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT m.kind FROM messages m JOIN session_stops st ON st.session=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ condition ++ "),'');"

def handoff_sql(+id: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO messages(id,sender,recipient,kind,body) SELECT 'stopped-input:' || lower(hex(m.id)),s.id," ++ C.report_recipient("s.id") ++ ",'report',json_object('type','stopped-recipient-input','recipient',s.id,'stopId',st.id,'originalMessage',m.id,'originalSender',m.sender,'originalKind',m.kind,'originalBody',m.body,'retainedWorkSession',m.sender,'disposition','The original message and work remain available. The stopped recipient has not accepted or reviewed this input.') FROM messages m JOIN sessions s ON s.id=m.recipient JOIN session_stops st ON st.session=s.id WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL" ++ C.message_upsert()
  ++ "SELECT coalesce((SELECT n.id FROM messages n WHERE n.id='stopped-input:' || lower(hex(" ++ C.q(id) ++ ")) AND (n.receipt IS NOT NULL OR EXISTS(SELECT 1 FROM sessions p WHERE p.id=n.recipient AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=p.id) AND (CASE WHEN json_valid(p.endpoint) THEN json_type(p.endpoint)='array' AND json_array_length(p.endpoint)>0 ELSE 0 END OR p.harness='codex')))),'');COMMIT;"

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
  "SELECT coalesce((SELECT s.harness FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ condition ++ "),'');"

def endpointless_native_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT s.native FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ condition ++ "),'');"

def endpointless_recipient_sql(id: String, condition: String) -> String:
  "SELECT coalesce((SELECT m.recipient FROM messages m WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ condition ++ "),'');"

# One notification names the recipient's whole durable inbox. Recipient-owned
# acknowledgement clears its marker so a later admission can notify again.
def queue_retry_sql(recipient: String, retry: Bool) -> String:
  match retry:
    case False{}: ""
    case True{}: "DELETE FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ " AND cause<>'';"

def queue_claim_sql(+id: String, +condition: String, +recipient: String, +native: String, retry: Bool) -> String:
  "BEGIN IMMEDIATE;"
  ++ "CREATE TABLE IF NOT EXISTS codex_inbox_wakes(session TEXT PRIMARY KEY NOT NULL REFERENCES sessions(id),native TEXT NOT NULL,token TEXT NOT NULL,cause TEXT NOT NULL DEFAULT '');"
  ++ "CREATE TRIGGER IF NOT EXISTS codex_inbox_wake_receipt AFTER UPDATE OF receipt ON messages WHEN OLD.receipt IS NULL AND NEW.receipt IS NOT NULL BEGIN DELETE FROM codex_inbox_wakes WHERE session=NEW.recipient;END;"
  ++ "DELETE FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ " AND native<>" ++ C.q(native) ++ ";"
  ++ queue_retry_sql(recipient,retry)
  ++ "INSERT INTO codex_inbox_wakes(session,native,token) SELECT s.id,s.native,lower(hex(randomblob(16))) FROM sessions s WHERE s.id=" ++ C.q(recipient) ++ " AND s.harness='codex' AND s.native=" ++ C.q(native) ++ " AND NOT " ++ C.stopped_session_sql("s.id") ++ " AND EXISTS(SELECT 1 FROM messages m WHERE m.id=" ++ C.q(id) ++ " AND m.recipient=s.id AND m.receipt IS NULL AND " ++ condition ++ ") ON CONFLICT(session) DO NOTHING;"
  ++ "SELECT CASE WHEN changes()=1 THEN (SELECT token FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ ") ELSE '' END;COMMIT;"

def queue_pointer(db: String, id: String, recipient: String, pending: String) -> String:
  "Baton input is pending.\n{\"database\":" ++ J.string_literal(db) ++ ",\"message\":" ++ J.string_literal(id) ++ ",\"recipient\":" ++ J.string_literal(recipient) ++ ",\"pendingCount\":" ++ pending ++ "}\nRead all owed input with baton2 DATABASE inbox RECIPIENT. Read any complete message with baton2 DATABASE delivery MESSAGE. Handle the work and acknowledge each of your own messages with baton2 DATABASE ack MESSAGE RECIPIENT RECEIPT. This notification records queue admission; Baton receipts remain pending until you accept the input."

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
      recorded : String <- IO.try(String,DB.Sql.query(db,"UPDATE codex_inbox_wakes SET cause=" ++ C.q(cause) ++ " WHERE session=" ++ C.q(recipient) ++ " AND token=" ++ C.q(token) ++ ";"))
      IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,cause)})

# Queue stderr and stdout are retained with the submission result. Ordinary
# admissions share the notification; explicit resume retries a failed attempt.
def queue_launch(+db: String, id: String, saved: String, native: String, +recipient: String, +token: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    pending : String <- IO.try(String,DB.Sql.query(db,"SELECT count(*) FROM messages WHERE recipient=" ++ C.q(recipient) ++ " AND receipt IS NULL;"))
    pointer : String <- IO.pure(String,queue_pointer(db,id,recipient,Tx.trim_nl(pending)))
    +stderr : String <- IO.pure(String,db ++ ".queue-" ++ token ++ ".stderr")
    spawned : Result<&1,&1,U32 & String,U32> <- Child.ProcessChild.spawn(Child.argv(Codex.queue_admission(native,pointer)),".",stderr)
    run : Result<&1,&1,U32 & String,String> <- queue_spawned(spawned)
    result : Result<&1,&1,U32 & String,String> <- queue_captured(db,saved,stderr,run)
    queue_recorded(db,recipient,token,result)

def queue_previous(saved: String, cause: String, notified: Bool) -> Result<&1,&1,U32 & String,String>:
  match notified:
    case True{}: Done{saved}
    case False{}: Fail{(1,cause)}

def queue_selected(+db: String, id: String, saved: String, native: String, +recipient: String, token: String, coalesced: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match coalesced:
    case False{}: queue_launch(db,id,saved,native,recipient,token)
    case True{}: do IO<Result<&1,&1,U32 & String,String>>:
      row : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce((SELECT hex(cause) FROM codex_inbox_wakes WHERE session=" ++ C.q(recipient) ++ "),'');"))
      +cause : String = Tx.hex_decode(Tx.trim_nl(row))
      IO.pure(Result<&1,&1,U32 & String,String>,queue_previous(saved,cause,String.is_empty(cause)))

def queue_claimed(+db: String, +id: String, condition: String, saved: String, +native: String, +recipient: String, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    row : String <- IO.try(String,DB.Sql.query(db,queue_claim_sql(id,condition,recipient,native,retry)))
    +token : String = Tx.trim_nl(row)
    queue_selected(db,id,saved,native,recipient,token,String.is_empty(token))

def queue_native(db: String, id: String, condition: String, saved: String, native: String, recipient: String, retry: Bool, absent: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match absent:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"Message " ++ id ++ " is addressed to a Codex session that records no native session identity, so the public queue cannot address it. Connect an endpoint or record the session's native identity, then retry delivery from the pending inbox.")})
    case False{}: queue_claimed(db,id,condition,saved,native,recipient,retry)

def codex_queue_mode(+db: String, +id: String, +condition: String, saved: String, retry: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    native_row : String <- IO.try(String,DB.Sql.query(db,endpointless_native_sql(id,condition)))
    +native : String <- IO.pure(String,Tx.trim_nl(native_row))
    recipient_row : String <- IO.try(String,DB.Sql.query(db,endpointless_recipient_sql(id,condition)))
    recipient : String <- IO.pure(String,Tx.trim_nl(recipient_row))
    queue_native(db,id,condition,saved,native,recipient,retry,String.is_empty(native))

# Explicit resume can retry a rejected notification. Ordinary admissions keep
# that rejection coalesced until recipient acknowledgement permits another wake.
def codex_queue(db: String, id: String, condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  codex_queue_mode(db,id,condition,saved,True{})

def endpointless(+db: String, +id: String, +condition: String, +saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    harness_row : String <- IO.try(String,DB.Sql.query(db,endpointless_harness_sql(id,condition)))
    +harness : String <- IO.pure(String,Tx.trim_nl(harness_row))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.eq(harness,"codex"),
      codex_queue_mode(db,id,condition,saved,False{}),
      IO.pure(Result<&1,&1,U32 & String,String>,Done{saved}))

def normal_delivery(+db: String, +id: String, +condition: String, +saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    encoded : String <- IO.try(String,DB.Sql.query(db,endpoint_sql(id,condition)))
    +argv : String <- IO.pure(String,Tx.trim_nl(encoded))
    Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(argv),
      endpointless(db,id,condition,saved),launch(db,id,saved,argv))

def routed(+db: String, +id: String, condition: String, +saved: String, +kind: String, ordinary: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match ordinary:
    case False{}: stopped_delivery(db,id,notification => normal_delivery(db,notification,"1",saved),Bool.or(String.eq(kind,"report"),String.eq(kind,"question")))
    case True{}: normal_delivery(db,id,condition,saved)

def deliver(+db: String, +id: String, +condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    value : String <- IO.try(String,DB.Sql.query(db,stopped_kind_sql(id,condition)))
    +kind : String <- IO.pure(String,Tx.trim_nl(value))
    routed(db,id,condition,saved,kind,String.is_empty(kind))

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
