import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../json/canonical.bend as J

# The strict chain reports what it observed and renders nothing itself. A refusal
# carries the code to report and any identity already known; a reached outcome
# carries the recipient, the disposition, whether a process was attempted and the
# observed status, so each caller maps one total value into its own result.
type ReportOutcome is Data:
  Refused{code: U32, selected: String, recipient: String, disposition: String, detail: String}
  Reached{code: U32, selected: String, recipient: String, disposition: String, attempted: Bool, status: String, detail: String}

# How one admission treats a decoded row: accepted, refused as ineligible by a
# strict admission, retained for the shared handoff, or terminally stopped.
type ReportRouting is Data:
  Accepted{}
  Ineligible{}
  Retained{}
  Stopped{}

# The routing mode has exactly two values, "strict" for the committed report path
# and "ordinary" for best-effort delivery of any kind, and this definition is its
# only reader. The decision is total over the mode, the decoded kind and the
# decoded stopped state, and it is taken after the decode and before any launch.
def report_routing(mode: String, kind: String, stop_state: String) -> ReportRouting:
  match String.eq(mode,"strict"):
    case True{}: report_routing_strict(kind,String.is_empty(stop_state))
    case False{}: report_routing_ordinary(kind,String.is_empty(stop_state))

# A strict admission refuses every kind that is not a report before any
# invocation, exactly as the projection's kind-equals-report predicate does today.
def report_routing_strict(kind: String, running: Bool) -> ReportRouting:
  match String.eq(kind,"report"):
    case False{}: Ineligible{}
    case True{}: report_routing_handoff(running)

# An ordinary admission accepts every unstopped row, retains a stopped report or
# question for the handoff, and terminally stops a stopped row of any other kind.
def report_routing_ordinary(kind: String, running: Bool) -> ReportRouting:
  match running:
    case True{}: Accepted{}
    case False{}: report_routing_retained(kind)

def report_routing_retained(kind: String) -> ReportRouting:
  match Bool.or(String.eq(kind,"report"),String.eq(kind,"question")):
    case True{}: Retained{}
    case False{}: Stopped{}

def report_routing_handoff(running: Bool) -> ReportRouting:
  match running:
    case True{}: Accepted{}
    case False{}: Retained{}

# The strict rendering is the only place an envelope is built, over the outcome
# the chain produced. A zero code is a completion; any other code is a failure.
def strict_outcome(+requested: String, outcome: ReportOutcome) -> Result<&1,&1,U32 & String,String>:
  match outcome:
    case Refused{code,selected,recipient,disposition,detail}: Fail{(code,report_envelope(requested,selected,recipient,disposition,False{},"",detail))}
    case Reached{code,selected,recipient,disposition,attempted,status,detail}: strict_reached(requested,code,selected,recipient,disposition,attempted,status,detail)

def strict_reached(+requested: String, +code: U32, +selected: String, +recipient: String, +disposition: String, +attempted: Bool, +status: String, +detail: String) -> Result<&1,&1,U32 & String,String>:
  match U32.is_lt(code,1):
    case True{}: Done{report_envelope(requested,selected,recipient,disposition,attempted,status,detail)}
    case False{}: Fail{(code,report_envelope(requested,selected,recipient,disposition,attempted,status,detail))}

# The ordinary rendering is best effort: a row it cannot use completes as the
# saved result, a terminally stopped row keeps its text, and an observed query
# failure keeps its code and detail.
def ordinary_outcome(+db: String, +id: String, +saved: String, outcome: ReportOutcome) -> Result<&1,&1,U32 & String,String>:
  match outcome:
    case Refused{code,selected,recipient,disposition,detail}: ordinary_refused(db,id,saved,code,selected,disposition,detail)
    case Reached{code,selected,recipient,disposition,attempted,status,detail}: ordinary_reached(db,saved,disposition)

def ordinary_refused(+db: String, +id: String, +saved: String, +code: U32, +selected: String, +disposition: String, +detail: String) -> Result<&1,&1,U32 & String,String>:
  match String.eq(disposition,"terminally-stopped"):
    case True{}: Fail{(2,detail)}
    case False{}: ordinary_refused_query(db,saved,code,disposition,detail)

def ordinary_refused_query(+db: String, +saved: String, +code: U32, +disposition: String, +detail: String) -> Result<&1,&1,U32 & String,String>:
  match String.starts_with(disposition,"report-query-failed"):
    case True{}: Fail{(code,detail)}
    case False{}: ordinary_refused_route(db,saved,code,disposition,detail)

def ordinary_refused_route(+db: String, +saved: String, +code: U32, +disposition: String, +detail: String) -> Result<&1,&1,U32 & String,String>:
  match String.starts_with(disposition,"stopped-route-query-failed"):
    case True{}: Fail{(code,detail)}
    case False{}: ordinary_refused_unavailable(db,saved,code,disposition,detail)

def ordinary_refused_unavailable(+db: String, +saved: String, +code: U32, +disposition: String, +detail: String) -> Result<&1,&1,U32 & String,String>:
  match String.starts_with(disposition,"stopped-route-unavailable"):
    case True{}: Fail{(2,detail)}
    case False{}: Done{saved}

def ordinary_reached(+db: String, +saved: String, disposition: String) -> Result<&1,&1,U32 & String,String>:
  match String.starts_with(disposition,"invoked"):
    case True{}: ordinary_reached_invoked(db,saved,disposition)
    case False{}: Done{saved}

def ordinary_reached_invoked(+db: String, +saved: String, disposition: String) -> Result<&1,&1,U32 & String,String>:
  match String.eq(disposition,"invoked"):
    case True{}: Done{saved}
    case False{}: Fail{(1,"Message committed; session delivery failed. Read " ++ db ++ ".root.log and retry delivery from the pending inbox.")}

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
def handoff_sql(+id: String) -> String:
  "BEGIN IMMEDIATE;INSERT INTO messages(id,sender,recipient,kind,body) SELECT 'stopped-input:' || lower(hex(m.id)),s.id," ++ C.report_recipient("s.id") ++ ",'report',json_object('type','stopped-recipient-input','recipient',s.id,'stopId',st.id,'originalMessage',m.id,'originalSender',m.sender,'originalKind',m.kind,'originalBody',m.body,'retainedWorkSession',m.sender,'disposition','The original message and work remain available. The stopped recipient has not accepted or reviewed this input.') FROM messages m JOIN sessions s ON s.id=m.recipient JOIN session_stops st ON st.session=s.id WHERE m.id=" ++ C.q(id) ++ " AND m.receipt IS NULL AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL" ++ C.message_upsert()
  ++ "SELECT coalesce((SELECT n.id FROM messages n WHERE n.id='stopped-input:' || lower(hex(" ++ C.q(id) ++ ")) AND (n.receipt IS NOT NULL OR EXISTS(SELECT 1 FROM sessions p WHERE p.id=n.recipient AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=p.id) AND CASE WHEN json_valid(p.endpoint) THEN json_type(p.endpoint)='array' AND json_array_length(p.endpoint)>0 ELSE 0 END))),'');COMMIT;"

def handoff_selected(id: String, notification: String, next: String -> IO(ReportOutcome), empty: Bool) -> IO(ReportOutcome):
  match empty:
    case False{}: next(notification)
    case True{}: IO.pure(ReportOutcome,Refused{2,id,"","stopped-route-unavailable","Message " ++ id ++ " is retained for a stopped session. Higher-parent delivery is unavailable; inspect the retained inbox and work."})

def handoff(db: String, +id: String, next: String -> IO(ReportOutcome)) -> IO(ReportOutcome):
  do IO<ReportOutcome>:
    selected : String <- IO.try(String,DB.Sql.query(db,handoff_sql(id)))
    +notification : String <- IO.pure(String,Tx.trim_nl(selected))
    handoff_selected(id,notification,next,String.is_empty(notification))

def normal_delivery(+db: String, +id: String, condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    outcome : ReportOutcome <- report_selected(db,id,"","ordinary",id,condition)
    IO.pure(Result<&1,&1,U32 & String,String>,ordinary_outcome(db,id,saved,outcome))

def deliver(+db: String, +id: String, +condition: String, saved: String) -> IO(Result<&1,&1,U32 & String,String>):
  normal_delivery(db,id,condition,saved)

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
# sessions association. Fields are newline separated, and the four fields that may
# contain anything - the recipient, the encoded endpoint argv, the kind and the
# recipient's stopped state - are each preceded by their Unicode character count
# in decimal from SQLite's text length. The decoder consumes exactly that many characters one at a time, so internal and
# trailing newlines and valid UTF-8 survive and the inner argv encoding keeps its
# own byte lengths because its characters pass through unchanged. JSON iteration
# and type access stay behind json_valid.
def report_projection_sql(+id: String, +condition: String) -> String:
  "SELECT coalesce((SELECT 'o' || char(10) || CASE WHEN m.receipt IS NULL THEN 'p' ELSE 'a' END || char(10) || CASE WHEN s.endpoint IS NULL OR s.endpoint='' THEN 'e' WHEN json_valid(s.endpoint) THEN CASE WHEN json_type(s.endpoint)='array' AND json_array_length(s.endpoint)>0 AND json_extract(s.endpoint,'$[0]')<>'' AND NOT EXISTS(SELECT 1 FROM json_each(s.endpoint) WHERE type<>'text' OR instr(value,char(0))>0) THEN 'a' ELSE 'x' END ELSE 'x' END || char(10) || CAST(length(m.recipient) AS TEXT) || char(10) || m.recipient || char(10) || CAST(length(coalesce(CASE WHEN json_valid(s.endpoint) THEN (SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)) ELSE '' END,'')) AS TEXT) || char(10) || coalesce(CASE WHEN json_valid(s.endpoint) THEN (SELECT group_concat(length(CAST(value AS BLOB)) || ':' || value,'') FROM json_each(s.endpoint)) ELSE '' END,'') || char(10) || CAST(length(m.kind) AS TEXT) || char(10) || coalesce(m.kind,'') || char(10) || CAST(length(CASE WHEN EXISTS(SELECT 1 FROM session_stops WHERE session=m.recipient) THEN 'stopped' ELSE '' END) AS TEXT) || char(10) || CASE WHEN EXISTS(SELECT 1 FROM session_stops WHERE session=m.recipient) THEN 'stopped' ELSE '' END FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(id) ++ " AND m.recipient IS NOT NULL AND " ++ condition ++ "),(SELECT CASE WHEN EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id) ++ ") THEN 'i' ELSE 'm' END));"

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
def report_row(+db: String, +requested: String, +selected: String, mode: String, +id: String, +row: String) -> IO(ReportOutcome):
  report_classify(db,requested,selected,mode,id,report_token(row,""),row)

# A missing, ineligible or unknown marker carries nothing but its own token, so the
# complete raw row is compared with its exact frame before anything is dropped. The
# token helper consumes the newline, so an empty remainder would also accept a row
# with no delimiter at all. A selection already established by a completed handoff
# is still reported on these paths, while an initial admission reports none.
def report_classify(+db: String, +requested: String, +selected: String, mode: String, +id: String, marker: String, row: String) -> IO(ReportOutcome):
  match marker:
    case "o": report_head(db,requested,selected,mode,id,report_drop_token(row))
    case "i": report_bounded(requested,selected,"report-ineligible","The message is not an eligible retained report; its input is retained.",row,"i\n")
    case "m": report_bounded(requested,selected,"report-missing","No message matches this report id; its input is retained.",row,"m\n")
    case other: report_selected_failed(requested,selected,"","report-marker-unknown","The retained report marker is unknown; the report and its input are retained.")

def report_bounded(+requested: String, +selected: String, +disposition: String, +detail: String, row: String, +frame: String) -> IO(ReportOutcome):
  report_bounded_step(requested,selected,disposition,detail,String.eq(row,frame))

def report_bounded_step(+requested: String, +selected: String, +disposition: String, +detail: String, bounded: Bool) -> IO(ReportOutcome):
  match bounded:
    case True{}: report_selected_failed(requested,selected,"",disposition,detail)
    case False{}: report_selected_failed(requested,selected,"","report-framing-rejected","The retained report row does not end in exactly one host delimiter; the report and its input are retained.")

def report_head(+db: String, +requested: String, +selected: String, mode: String, +id: String, +rest: String) -> IO(ReportOutcome):
  report_head2(db,requested,selected,mode,id,report_token(rest,""),report_drop_token(rest))

def report_head2(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +rest: String) -> IO(ReportOutcome):
  report_head3(db,requested,selected,mode,id,receipt,report_token(rest,""),report_drop_token(rest))

def report_head3(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +rest: String) -> IO(ReportOutcome):
  report_length(db,requested,selected,mode,id,receipt,state,report_digits(report_token(rest,""),0,False{}),report_drop_token(rest))

def report_length(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, target: Maybe<U32>, rest: String) -> IO(ReportOutcome):
  match target:
    case None{}: report_selected_failed(requested,selected,"","report-length-refused","The retained report recipient length is missing, malformed or out of range; the report and its input are retained.")
    case Some{n}: report_recipient(db,requested,selected,mode,id,receipt,state,report_take(0,n,rest,""))

# The producer owes exactly one separator after the recipient, so other text
# before that newline is refused rather than skipped.
def report_recipient(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, taken: Maybe<String & String>) -> IO(ReportOutcome):
  match taken:
    case None{}: report_selected_failed(requested,selected,"","report-truncated","The retained report row is shorter than its declared recipient length; the report and its input are retained.")
    case Some{(recipient, after)}: report_separator(db,requested,selected,mode,id,receipt,state,recipient,after,String.starts_with(after,"\n"))

def report_separator(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +recipient: String, after: String, ok: Bool) -> IO(ReportOutcome):
  match ok:
    case False{}: report_selected_failed(requested,selected,recipient,"report-separator-required","The retained report row does not carry exactly one separator after the recipient; the report and its input are retained.")
    case True{}: report_argv_length(db,requested,selected,mode,id,receipt,state,recipient,report_drop_token(after))

def report_argv_length(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +recipient: String, +rest: String) -> IO(ReportOutcome):
  report_argv_value(db,requested,selected,mode,id,receipt,state,recipient,report_digits(report_token(rest,""),0,False{}),report_drop_token(rest))

def report_argv_value(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +recipient: String, target: Maybe<U32>, rest: String) -> IO(ReportOutcome):
  match target:
    case None{}: report_selected_failed(requested,selected,recipient,"report-length-refused","The retained report argv length is missing, malformed or out of range; the report and its input are retained.")
    case Some{n}: report_argv_payload(db,requested,selected,mode,id,receipt,state,recipient,report_take(0,n,rest,""))

def report_argv_payload(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +recipient: String, taken: Maybe<String & String>) -> IO(ReportOutcome):
  match taken:
    case None{}: report_selected_failed(requested,selected,recipient,"report-truncated","The retained report row is shorter than its declared argv length; the report and its input are retained.")
    case Some{(payload, suffix)}: report_suffix(db,requested,selected,mode,id,receipt,state,recipient,payload,suffix)

def report_suffix(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +recipient: String, +payload: String, suffix: String) -> IO(ReportOutcome):
  report_kind(db,requested,selected,mode,id,receipt,state,recipient,payload,suffix)

# The two routing facts ride the tail of the frame as newline bounded tokens,
# after the payload and before the host's row delimiter. The kind is read first,
# then the recipient's stopped state, and only then must the frame end exactly at
# the delimiter. Both are SQL enumerations, so neither can contain a newline.
def report_kind(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +recipient: String, +payload: String, +suffix: String) -> IO(ReportOutcome):
  report_stopped(db,requested,selected,mode,id,receipt,state,recipient,payload,report_token(suffix,""),report_drop_token(suffix))

def report_stopped(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +recipient: String, +payload: String, +kind: String, +rest: String) -> IO(ReportOutcome):
  report_stopped_done(db,requested,selected,mode,id,receipt,state,recipient,payload,kind,report_token(rest,""),report_drop_token(rest))

def report_stopped_done(+db: String, +requested: String, +selected: String, mode: String, +id: String, +receipt: String, +state: String, +recipient: String, +payload: String, +kind: String, +stop_state: String, after: String) -> IO(ReportOutcome):
  match String.is_empty(after):
    case False{}: report_selected_failed(requested,selected,recipient,"report-framing-rejected","The retained report row does not end in exactly one host delimiter; the report and its input are retained.")
    case True{}: report_receipt(db,requested,selected,mode,id,recipient,receipt,state,kind,stop_state,payload)

# The envelope carries the requested identity, the selected identity once one is
# selected, the recipient, the disposition and the observed status.
def report_envelope(requested: String, selected: String, recipient: String, disposition: String, attempted: Bool, status: String, detail: String) -> String:
  "{\"status\":\"report-delivery\",\"requestedReport\":" ++ J.string_literal(requested) ++ ",\"deliveredReport\":" ++ J.string_literal(selected) ++ ",\"recipient\":" ++ J.string_literal(recipient) ++ ",\"disposition\":" ++ J.string_literal(disposition) ++ ",\"invocationAttempted\":" ++ Bool.pick(String,attempted,"true","false") ++ ",\"exit\":" ++ J.string_literal(status) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}"

def report_selected_failed(+requested: String, +id: String, +recipient: String, +disposition: String, +detail: String) -> IO(ReportOutcome):
  IO.pure(ReportOutcome,Refused{2,id,recipient,disposition,detail})

def report_launch_outcome(+requested: String, +id: String, +recipient: String, run: Result<&1,&1,U32 & String,String>) -> ReportOutcome:
  match run:
    case Fail{(code,detail)}: Reached{code,id,recipient,"invocation-failed",True{},"",detail}
    case Done{_}: Reached{0,id,recipient,"invoked",True{},"0","Endpoint process completed and exited zero."}

def report_launch(+db: String, +requested: String, +id: String, +recipient: String, +payload: String) -> IO(ReportOutcome):
  do IO<ReportOutcome>:
    run : Result<&1,&1,U32 & String,String> <- launch(db,id,"",payload,False{})
    IO.pure(ReportOutcome,report_launch_outcome(requested,id,recipient,run))

def report_endpoint(+db: String, +requested: String, +id: String, +recipient: String, state: String, +payload: String) -> IO(ReportOutcome):
  match state:
    case "e": report_selected_failed(requested,id,recipient,"endpoint-absent","The recorded endpoint is absent; the report and its input are retained.")
    case "x": report_selected_failed(requested,id,recipient,"endpoint-malformed","The recorded endpoint is not a complete usable argument array; the report and its input are retained.")
    case "a": report_launch(db,requested,id,recipient,payload)
    case other: report_selected_failed(requested,id,recipient,"endpoint-unknown","The recorded endpoint state is unknown; the report and its input are retained.")

def report_receipt(+db: String, +requested: String, +selected: String, mode: String, +id: String, +recipient: String, receipt: String, +state: String, +kind: String, +stop_state: String, +payload: String) -> IO(ReportOutcome):
  match receipt:
    case "a": IO.pure(ReportOutcome,Reached{0,id,recipient,"already-acknowledged",False{},"","The retained report already has a receipt; no endpoint was invoked."})
    case "p": report_pending(db,requested,id,recipient,kind,stop_state,state,payload,mode)
    case other: report_selected_failed(requested,id,recipient,"report-state-unknown","The retained report state is unknown; the report and its input are retained.")

# Pending input splits here, after the framing and receipt classification. A
# stopped admission reaches the shared handoff whether or not its own endpoint is
# usable, and an ordinary admission reaches endpoint classification. A handoff
# notification was already selected, so its identity is reported and its own
# endpoint governs the result.
def report_pending(+db: String, +requested: String, +id: String, +recipient: String, +kind: String, +stop_state: String, state: String, +payload: String, mode: String) -> IO(ReportOutcome):
  match report_routing(mode,kind,stop_state):
    case Accepted{}: report_endpoint(db,requested,id,recipient,state,payload)
    case Ineligible{}: report_selected_failed(requested,id,"","report-ineligible","The message is not an eligible retained report; its input is retained.")
    case Retained{}: report_handoff_admit(db,requested,id)
    case Stopped{}: report_selected_failed(requested,id,recipient,"terminally-stopped","Session is terminally stopped; the retained input will not execute. Inspect its session and inbox.")

# The shared handoff expression is read before the handoff runs, so a query
# failure and an unavailable higher-parent route are reported as strict outcomes
# carrying the requested identity and the observed code and detail. Nothing has
# been selected at this point, so no selected identity is claimed.
def report_handoff_admit(+db: String, +requested: String, +id: String) -> IO(ReportOutcome):
  do IO<ReportOutcome>:
    available : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,handoff_sql(id))
    report_handoff_available(db,requested,id,available)

def report_handoff_available(+db: String, +requested: String, +id: String, available: Result<&1,&1,U32 & String,String>) -> IO(ReportOutcome):
  match available:
    case Fail{(code,detail)}: IO.pure(ReportOutcome,Refused{code,"","","stopped-route-query-failed",detail})
    case Done{+notification}: report_handoff_unavailable(db,requested,id,notification,String.is_empty(Tx.trim_nl(notification)))

def report_handoff_unavailable(+db: String, +requested: String, +id: String, notification: String, unavailable: Bool) -> IO(ReportOutcome):
  match unavailable:
    case True{}: IO.pure(ReportOutcome,Refused{2,"","","stopped-route-unavailable","Higher-parent delivery is unavailable; the retained input and the original report are preserved."})
    case False{}: handoff(db,id,n => report_handoff(db,requested,n))

# The handoff entry trims the selected notification and delegates; the selection
# step performs the strict query for that notification's own result.
def report_handoff(+db: String, +requested: String, notification: String) -> IO(ReportOutcome):
  report_handoff_selected(db,requested,Tx.trim_nl(notification))

def report_handoff_selected(+db: String, +requested: String, +notification: String) -> IO(ReportOutcome):
  report_selected(db,requested,notification,"strict",notification,"1")

def report_queried(+db: String, +requested: String, +selected: String, mode: String, +id: String, result: Result<&1,&1,U32 & String,String>) -> IO(ReportOutcome):
  match result:
    case Fail{(code,detail)}: IO.pure(ReportOutcome,Refused{code,selected,"","report-query-failed",detail})
    case Done{+row}: report_row(db,requested,selected,mode,id,row)

# The selected identity is empty for a fresh query and carries the handoff
# notification when one has already been selected, so a failure before any
# selection never claims a delivered report.
def report_selected(+db: String, +requested: String, +selected: String, mode: String, +id: String, condition: String) -> IO(ReportOutcome):
  do IO<ReportOutcome>:
    queried : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,report_projection_sql(id,condition))
    report_queried(db,requested,selected,mode,id,queried)

# The strict entry for one committed report. The caller resolves the report id;
# nothing here accepts a caller-supplied recipient or endpoint. One projection
# query carries the routing facts, so no separate kind query remains.
def deliver_report(+db: String, +id: String) -> IO(ReportOutcome):
  report_selected(db,id,"","strict",id,"1")

# The superseded strict block was removed with the lossless projection above.
