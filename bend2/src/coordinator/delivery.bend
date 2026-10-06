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

# One projection carries what both delivery modes need from one messages and
# sessions association. Fields are newline separated, and the two fields that may
# contain anything - the recipient and the encoded endpoint argv - are each
# preceded by their Unicode character count in decimal from SQLite's text length.
# The decoder consumes exactly that many characters one at a time, so internal and
# trailing newlines and valid UTF-8 survive and the inner argv encoding keeps its
# own byte lengths because its characters pass through unchanged. JSON iteration
# and type access stay behind json_valid.
def report_projection_sql(+id: String) -> String:
  "SELECT coalesce((SELECT 'o' || char(10) || CASE WHEN m.receipt IS NULL THEN 'p' ELSE 'a' END || char(10) || CASE WHEN s.endpoint IS NULL OR s.endpoint='' THEN 'e' WHEN json_valid(s.endpoint) THEN CASE WHEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 AND json_extract(s.endpoint,'$[0]')<>'' AND NOT EXISTS(SELECT 1 FROM json_each(s.endpoint) WHERE type<>'text' OR instr(value,char(0))>0) THEN 'a' ELSE 'x' END ELSE 'x' END || char(10) || CAST(length(m.recipient) AS TEXT) || char(10) || m.recipient || char(10) || CAST(length(coalesce(CASE WHEN json_valid(s.endpoint) THEN (SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)) ELSE '' END,'')) AS TEXT) || char(10) || coalesce(CASE WHEN json_valid(s.endpoint) THEN (SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)) ELSE '' END,'') FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.kind='report' AND m.recipient IS NOT NULL),(SELECT CASE WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") THEN 'i' ELSE 'm' END));"

# The token before the first newline, and that token with its newline removed.
def report_token(rest: String, seen: String) -> String:
  match rest:
    case SNil{}: seen
    case SCon{c, more}: report_token_step(Tx.is_nl(c), c, more, seen)

def report_token_step(nl: Bool, c: Char, more: String, seen: String) -> String:
  match nl:
    case True{}: seen
    case False{}: report_token(more, seen ++ Tx.one_char(c))

def report_drop_token(rest: String) -> String:
  match rest:
    case SNil{}: SNil{}
    case SCon{c, more}: report_drop_step(Tx.is_nl(c), more)

def report_drop_step(nl: Bool, more: String) -> String:
  match nl:
    case True{}: more
    case False{}: report_drop_token(more)

# A nonempty ASCII decimal field up to the next newline. Scaling by ten and adding
# the digit are each range checked before they happen, so an out-of-range declared
# length is refused rather than wrapped, and a missing, empty or non-digit field is
# refused too.
def report_digits(rest: String, value: U32, seen: Bool) -> Maybe<U32>:
  match rest:
    case SNil{}: report_digits_end(seen, value)
    case SCon{c, more}: report_digits_step(Tx.is_nl(c), c, more, value, seen)

def report_digits_end(seen: Bool, value: U32) -> Maybe<U32>:
  match seen:
    case True{}: Some{value}
    case False{}: None{}

def report_digits_step(nl: Bool, c: Char, more: String, value: U32, seen: Bool) -> Maybe<U32>:
  match nl:
    case True{}: report_digits_end(seen, value)
    case False{}: report_accumulate(report_digit(c), more, value, seen)

def report_accumulate(digit: Maybe<U32>, more: String, value: U32, seen: Bool) -> Maybe<U32>:
  match digit:
    case None{}: None{}
    case Some{d}: report_scale(U32.is_lt(value,429496730), d, more, value, seen)

def report_scale(room: Bool, d: U32, more: String, value: U32, seen: Bool) -> Maybe<U32>:
  match room:
    case False{}: None{}
    case True{}: report_fit(Bool.not(U32.is_lt(((4294967295 - d) : U32),((value * 10 : U32)))), d, more, value, seen)

def report_fit(fits: Bool, d: U32, more: String, value: U32, seen: Bool) -> Maybe<U32>:
  match fits:
    case False{}: None{}
    case True{}: report_digits(more, ((value * 10 + d) : U32), True{})

def report_digit(c: Char) -> Maybe<U32>:
  match c:
    case '0': Some{0}
    case '1': Some{1}
    case '2': Some{2}
    case '3': Some{3}
    case '4': Some{4}
    case '5': Some{5}
    case '6': Some{6}
    case '7': Some{7}
    case '8': Some{8}
    case '9': Some{9}
    case other: None{}

# Exactly the declared number of characters, with the unused suffix returned so
# the next field is read from it. A shorter row is refused.
def report_take(count: U32, target: U32, rest: String, seen: String) -> Maybe<String & String>:
  report_take_step(U32.is_lt(count,target), count, target, rest, seen)

def report_take_step(short: Bool, count: U32, target: U32, rest: String, seen: String) -> Maybe<String & String>:
  match short:
    case False{}: Some{(seen, rest)}
    case True{}: report_take_more(count, target, rest, seen)

def report_take_more(count: U32, target: U32, rest: String, seen: String) -> Maybe<String & String>:
  match rest:
    case SNil{}: None{}
    case SCon{c, more}: report_take((count + 1 : U32), target, more, seen ++ Tx.one_char(c))

# The decoded row: the marker, the receipt state, the endpoint state, then the
# recipient and the encoded argv each behind its declared character count, and
# finally exactly the one host delimiter, which is consumed. The requested
# identity is the report the caller asked for; the selected identity is the
# message this row actually came from, so a stopped handoff can report both.
# The bounded marker is classified first, so a missing or ineligible row reports
# its own disposition instead of failing a framed shape only the eligible row
# carries. The marker's trailing newline is consumed with the token.
def report_row(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +row: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_classify(db,requested,selected,stopped,id,report_token(row,""),row)

# A missing, ineligible or unknown marker carries nothing but its own token, so the
# complete raw row is compared with its exact frame before anything is dropped. The
# token helper consumes the newline, so an empty remainder would also accept a row
# with no delimiter at all. A selection already established by a completed handoff
# is still reported on these paths, while an initial admission reports none.
def report_classify(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, marker: String, row: String) -> IO(Result<&1,&1,U32 & String,String>):
  match marker:
    case "o": report_head(db,requested,selected,stopped,id,report_drop_token(row))
    case "i": report_bounded(requested,selected,"report-ineligible","The message is not an eligible retained report; its input is retained.",row,"i\n")
    case "m": report_bounded(requested,selected,"report-missing","No message matches this report id; its input is retained.",row,"m\n")
    case other: report_selected_failed(requested,selected,"","report-marker-unknown","The retained report marker is unknown; the report and its input are retained.")

def report_bounded(+requested: String, +selected: String, +disposition: String, +detail: String, row: String, +frame: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_bounded_step(requested,selected,disposition,detail,String.eq(row,frame))

def report_bounded_step(+requested: String, +selected: String, +disposition: String, +detail: String, bounded: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match bounded:
    case True{}: report_selected_failed(requested,selected,"",disposition,detail)
    case False{}: report_selected_failed(requested,selected,"","report-framing-rejected","The retained report row does not end in exactly one host delimiter; the report and its input are retained.")

def report_head(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +rest: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_head2(db,requested,selected,stopped,id,report_token(rest,""),report_drop_token(rest))

def report_head2(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +rest: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_head3(db,requested,selected,stopped,id,receipt,report_token(rest,""),report_drop_token(rest))

def report_head3(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, +rest: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_length(db,requested,selected,stopped,id,receipt,state,report_digits(report_token(rest,""),0,False{}),report_drop_token(rest))

def report_length(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, target: Maybe<U32>, rest: String) -> IO(Result<&1,&1,U32 & String,String>):
  match target:
    case None{}: report_selected_failed(requested,selected,"","report-length-refused","The retained report recipient length is missing, malformed or out of range; the report and its input are retained.")
    case Some{n}: report_recipient(db,requested,selected,stopped,id,receipt,state,report_take(0,n,rest,""))

# The producer owes exactly one separator after the recipient, so other text
# before that newline is refused rather than skipped.
def report_recipient(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, taken: Maybe<String & String>) -> IO(Result<&1,&1,U32 & String,String>):
  match taken:
    case None{}: report_selected_failed(requested,selected,"","report-truncated","The retained report row is shorter than its declared recipient length; the report and its input are retained.")
    case Some{(recipient, after)}: report_separator(db,requested,selected,stopped,id,receipt,state,recipient,after,String.starts_with(after,"\n"))

def report_separator(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, +recipient: String, after: String, ok: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match ok:
    case False{}: report_selected_failed(requested,selected,recipient,"report-separator-required","The retained report row does not carry exactly one separator after the recipient; the report and its input are retained.")
    case True{}: report_argv_length(db,requested,selected,stopped,id,receipt,state,recipient,report_drop_token(after))

def report_argv_length(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, +recipient: String, +rest: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_argv_value(db,requested,selected,stopped,id,receipt,state,recipient,report_digits(report_token(rest,""),0,False{}),report_drop_token(rest))

def report_argv_value(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, +recipient: String, target: Maybe<U32>, rest: String) -> IO(Result<&1,&1,U32 & String,String>):
  match target:
    case None{}: report_selected_failed(requested,selected,recipient,"report-length-refused","The retained report argv length is missing, malformed or out of range; the report and its input are retained.")
    case Some{n}: report_argv_payload(db,requested,selected,stopped,id,receipt,state,recipient,report_take(0,n,rest,""))

def report_argv_payload(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, +recipient: String, taken: Maybe<String & String>) -> IO(Result<&1,&1,U32 & String,String>):
  match taken:
    case None{}: report_selected_failed(requested,selected,recipient,"report-truncated","The retained report row is shorter than its declared argv length; the report and its input are retained.")
    case Some{(payload, suffix)}: report_suffix(db,requested,selected,stopped,id,receipt,state,recipient,payload,suffix)

def report_suffix(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, +recipient: String, +payload: String, suffix: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_suffix_step(db,requested,selected,stopped,id,receipt,state,recipient,payload,String.eq(suffix,"\n"))

def report_suffix_step(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +receipt: String, +state: String, +recipient: String, +payload: String, sealed: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match sealed:
    case False{}: report_selected_failed(requested,selected,recipient,"report-framing-rejected","The retained report row does not end in exactly one host delimiter; the report and its input are retained.")
    case True{}: report_receipt(db,requested,selected,stopped,id,recipient,receipt,state,payload)

# The envelope carries the requested identity, the selected identity once one is
# selected, the recipient, the disposition and the observed status.
def report_envelope(requested: String, selected: String, recipient: String, disposition: String, attempted: Bool, status: String, detail: String) -> String:
  "{\"status\":\"report-delivery\",\"requestedReport\":" ++ J.string_literal(requested) ++ ",\"deliveredReport\":" ++ J.string_literal(selected) ++ ",\"recipient\":" ++ J.string_literal(recipient) ++ ",\"disposition\":" ++ J.string_literal(disposition) ++ ",\"invocationAttempted\":" ++ Bool.pick(String,attempted,"true","false") ++ ",\"exit\":" ++ J.string_literal(status) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}"

def report_selected_failed(+requested: String, +id: String, +recipient: String, +disposition: String, +detail: String) -> IO(Result<&1,&1,U32 & String,String>):
  IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,report_envelope(requested,id,recipient,disposition,False{},"",detail))})

def report_launch_outcome(+requested: String, +id: String, +recipient: String, run: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  match run:
    case Fail{(code,detail)}: Fail{(code,report_envelope(requested,id,recipient,"invocation-failed",True{},"",detail))}
    case Done{_}: Done{report_envelope(requested,id,recipient,"invoked",True{},"0","Endpoint process completed and exited zero.")}

def report_launch(+db: String, +requested: String, +id: String, +recipient: String, +payload: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    run : Result<&1,&1,U32 & String,String> <- launch(db,id,"",payload,False{})
    IO.pure(Result<&1,&1,U32 & String,String>,report_launch_outcome(requested,id,recipient,run))

def report_endpoint(+db: String, +requested: String, +id: String, +recipient: String, state: String, +payload: String) -> IO(Result<&1,&1,U32 & String,String>):
  match state:
    case "e": report_selected_failed(requested,id,recipient,"endpoint-absent","The recorded endpoint is absent; the report and its input are retained.")
    case "x": report_selected_failed(requested,id,recipient,"endpoint-malformed","The recorded endpoint is not a complete usable argument array; the report and its input are retained.")
    case "a": report_launch(db,requested,id,recipient,payload)
    case other: report_selected_failed(requested,id,recipient,"endpoint-unknown","The recorded endpoint state is unknown; the report and its input are retained.")

def report_receipt(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, +recipient: String, receipt: String, +state: String, +payload: String) -> IO(Result<&1,&1,U32 & String,String>):
  match receipt:
    case "a": IO.pure(Result<&1,&1,U32 & String,String>,Done{report_envelope(requested,id,recipient,"already-acknowledged",False{},"","The retained report already has a receipt; no endpoint was invoked.")})
    case "p": report_pending(db,requested,id,recipient,state,payload,stopped)
    case other: report_selected_failed(requested,id,recipient,"report-state-unknown","The retained report state is unknown; the report and its input are retained.")

# Pending input splits here, after the framing and receipt classification. A
# stopped admission reaches the shared handoff whether or not its own endpoint is
# usable, and an ordinary admission reaches endpoint classification. A handoff
# notification was already selected, so its identity is reported and its own
# endpoint governs the result.
def report_pending(+db: String, +requested: String, +id: String, +recipient: String, state: String, +payload: String, stopped: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match stopped:
    case True{}: stopped_delivery(db,id,notification => report_handoff_go(db,requested,notification),True{})
    case False{}: report_endpoint(db,requested,id,recipient,state,payload)

def report_handoff_go(+db: String, +requested: String, notification: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_handoff_selected(db,requested,Tx.trim_nl(notification))

def report_handoff_selected(+db: String, +requested: String, +notification: String) -> IO(Result<&1,&1,U32 & String,String>):
  report_selected(db,requested,notification,False{},notification)

def report_queried(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String, result: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match result:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,report_envelope(requested,selected,"","report-query-failed",False{},"",detail))})
    case Done{+row}: report_row(db,requested,selected,stopped,id,row)

# The selected identity is empty for a fresh query and carries the handoff
# notification when one has already been selected, so a failure before any
# selection never claims a delivered report.
def report_selected(+db: String, +requested: String, +selected: String, stopped: Bool, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    queried : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,report_projection_sql(id))
    report_queried(db,requested,selected,stopped,id,queried)

# Both admissions run the same decoder. A stopped admission carries no known
# selection yet and is routed to the handoff after its receipt classification;
# an ordinary admission is routed to endpoint classification.
def report_route_kind(+db: String, +id: String, kind: String) -> IO(Result<&1,&1,U32 & String,String>):
  match kind:
    case "": report_selected(db,id,"",False{},id)
    case other: report_selected(db,id,"",True{},id)

def report_route(+db: String, +id: String, stopped: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match stopped:
    case Fail{(code,detail)}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,report_envelope(id,"","","report-route-query-failed",False{},"",detail))})
    case Done{+kind}: report_route_kind(db,id,Tx.trim_nl(kind))

# The strict entry for one committed report. The caller resolves the report id;
# nothing here accepts a caller-supplied recipient or endpoint.
def deliver_report(+db: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    stopped : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,stopped_kind_sql(id,"1"))
    report_route(db,id,stopped)

# The superseded strict block was removed with the lossless projection above.
