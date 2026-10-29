# Provider usage holds decided by live reads of the provider's usage API (#1025).
#
# A seat is held when the newest readable live read for its provider and account
# reports an exhausted window, and it is released only by a later live read that
# reports every window open. The read is the only decision input. Provider refusal
# text is recorded in usage_windows as evidence and starts a read; a reset time in
# that text, a window length, an operator-entered time or a successful attempt does
# not hold or release a seat. The observed failure: a z.ai UTC+8 reset clock parsed
# from 429 text held four GLM seats about 8 hours after a live read showed 3% of the
# 5-hour window used.
#
# A read runs on these events: a provider exhaustion terminal, an input addressed to
# a held seat, the provider's reported reset time of a held window passing, and
# usage-window-refresh. The hold state derives from the usage_reads rows after a
# crash. Announcements derive their identities from the read rows and the seat, so
# a repeated wake adds no second message. Contract: docs/bend2/usage-live-reads-1025.md.
import Base
import ../coordinator/commands.bend as C
import ../json/canonical.bend as J
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../git/process.bend as Process
import ../host/sqlite.bend as DB
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ./store.bend as Store
import ./usage-reads.bend as UR

# GateHeld carries the exhausted window with the latest provider reset, that reset in
# UTC milliseconds (empty when the provider reported none), the source of the read
# and the receipt usage-read:EPISODE, where EPISODE is the first exhausted read of
# the current hold. GateUnknown is an unreadable newest read; it does not hold.
type Gate is Data:
  GateNone{}
  GateHeld{window: String, resets_at: String, source: String, receipt: String}
  GateUnknown{source: String, reason: String, receipt: String}

# The provider qualifier of a recorded model: the text before the first '/'.
# A model without a provider prefix has no provider-bound window identity.
def provider_go(rest: String, +acc: String) -> String:
  match rest:
    case SNil{}: ""
    case SCon{+head,tail}: Bool.pick(String,Char.is_eq(head,Char.from_u32(47)),acc,provider_go(tail,acc ++ SCon{head,SNil{}}))

def provider_of(model: String) -> String:
  provider_go(model,"")

# The provider whose usage API a harness's unqualified models draw on.
def harness_provider(+harness: String) -> String:
  match harness:
    case "codex": "codex"
    case "claude-code": "claude"
    case "muse": "muse"
    case "dsh": "deepseek"
    case _: ""

# The provider a seat is read against: the model's provider prefix, or the
# harness's provider for an unqualified model.
def seat_provider(+harness: String, +model: String) -> String:
  Bool.pick(String,String.is_empty(provider_of(model)),harness_provider(harness),provider_of(model))

# --- window labels from provider text ----------------------------------------
#
# The refusal evidence keeps the window kind the provider's text names. The label
# is part of the refusal report identity and is not a hold input.

def lower_char(+c: Char) -> Char:
  Bool.pick(Char,Bool.and(U32.is_lt(Char.to_u32(Char.from_u32(64)),Char.to_u32(c)),U32.is_lt(Char.to_u32(c),Char.to_u32(Char.from_u32(91)))),Char.from_u32(U32.add(Char.to_u32(c),32)),c)

def lower_go(rest: String, +acc: String) -> String:
  match rest:
    case SNil{}: acc
    case SCon{+head,tail}: lower_go(tail,acc ++ SCon{lower_char(head),SNil{}})

def lower_ascii(s: String) -> String:
  lower_go(s,"")

def has_sub_at(+needle: String, +rest: String) -> Bool:
  match rest:
    case SNil{}: False{}
    case SCon{_,tail}: Bool.pick(Bool,Tx.starts_with(rest,needle),True{},has_sub_at(needle,tail))

def has_sub(+needle: String, +hay: String) -> Bool:
  has_sub_at(needle,hay)

# The canonical window kinds, most specific first. Unrecognized wording keeps
# an empty label; the receipt retains the provider's own text either way.
def window_label_of(+text: String) -> String:
  Bool.pick(String,Bool.or(has_sub("5-hour",text),has_sub("5 hour",text)),"5-hour",
  Bool.pick(String,Bool.or(has_sub("7-day",text),Bool.or(has_sub("7 day",text),has_sub("weekly",text))),"7-day",
  Bool.pick(String,Bool.or(has_sub("monthly",text),has_sub("billing cycle",text)),"monthly","")))

def now_ms() -> String:
  "CAST(strftime('%s','now') AS INTEGER)*1000"

# The provider prefix computed in SQL from the recorded model: the text before
# the first '/', or empty when the model is not provider-qualified.
def model_provider_sql(+model: String) -> String:
  "CASE WHEN instr(" ++ model ++ ",'/')>0 THEN substr(" ++ model ++ ",1,instr(" ++ model ++ ",'/')-1) ELSE '' END"

# --- refusal evidence ----------------------------------------------------------
#
# One evidence row per provider exhaustion terminal, recorded before any account
# advance. It keeps the provider's text and the window it names. resets_at stays
# NULL: a reset time written in refusal text is not recorded as a reset.

def exhausted_sql(+alias: String) -> String:
  "((" ++ alias ++ ".used_fraction IS NOT NULL AND " ++ alias ++ ".used_fraction >= 1) OR " ++ alias ++ ".reset_source='provider-message')"

def record_cause_sql(+session: String, +account: String, +window: String, +cause: String, +message: String) -> String:
  "INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) SELECT " ++ now_ms() ++ ",harness,model," ++ model_provider_sql("model") ++ "," ++ C.q(account) ++ "," ++ C.q(window) ++ ",NULL,'provider-message',NULL," ++ C.q(cause) ++ "," ++ C.q(message) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ ";"

# A failed evidence insert reports its own cause and never blocks the account
# advance.
def window_report(db: String, session: String, id: String, kind: String, body: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":" ++ kind) ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(body) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
    IO.pure(Unit,Unit{})

def record_cause_result(+db: String, +session: String, +id: String, saved: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match saved:
    case Done{unit}: IO.pure(Unit,Unit{})
    case Fail{(code,detail)}: window_report(db,session,id,"usage-window-record-failed","usage window evidence insert failed: " ++ U32.show(code) ++ ": " ++ detail ++ "; the provider cause stands and the account advance proceeds.")

def record_cause(+db: String, +session: String, +id: String, account: String, +cause: String) -> IO(Unit):
  do IO<Unit>:
    saved : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,record_cause_sql(session,Tx.trim_nl(account),window_label_of(lower_ascii(cause)),Tx.trim_nl(cause),id))
    record_cause_result(db,session,id,saved)

# --- the read record -------------------------------------------------------------
#
# usage_reads keeps one row per live read: the provider, the account label, the seat
# whose event started it, the trigger, the state, the source the helper read, the
# reason an unreadable read gives, and the helper's document. A readable document
# carries the normalized windows array; the hold derives from it with json_each.

def scope_sql(+alias: String, +provider: String, +account: String) -> String:
  alias ++ "provider=" ++ C.q(provider) ++ " AND " ++ alias ++ "account=" ++ C.q(account)

def window_exhausted_sql(+w: String) -> String:
  "(coalesce(json_extract(" ++ w ++ ".value,'$.exhausted'),0)=1)"

def readable_document_sql(+provider: String) -> String:
  "(json_valid(d) AND json_extract(d,'$.schema')=" ++ C.q(UR.read_schema()) ++ " AND json_extract(d,'$.state')='read' AND coalesce(json_extract(d,'$.provider'),'')=" ++ C.q(provider) ++ " AND json_type(d,'$.windows')='array')"

def read_reason_sql(+provider: String, +fallback: String) -> String:
  "CASE WHEN " ++ readable_document_sql(provider) ++ " THEN '' WHEN json_valid(d) AND json_extract(d,'$.state')='unreadable' THEN coalesce(json_extract(d,'$.reason'),'') WHEN json_valid(d) AND json_extract(d,'$.state')='read' THEN 'the usage-read document is not a " ++ UR.read_schema() ++ " read for provider " ++ C.escaped(provider) ++ "' ELSE " ++ C.q(fallback) ++ " END"

def record_read_sql(+provider: String, +account: String, +session: String, +trigger: String, +document: String, +fallback: String) -> String:
  "INSERT INTO usage_reads(observed_at,provider,account,session,trigger,state,source,reason,document) SELECT CASE WHEN json_valid(d) AND json_type(d,'$.observedAt') IN ('integer','real') THEN CAST(json_extract(d,'$.observedAt') AS INTEGER) ELSE " ++ now_ms() ++ " END," ++ C.q(provider) ++ "," ++ C.q(account) ++ "," ++ C.q(session) ++ "," ++ C.q(trigger) ++ ",CASE WHEN " ++ readable_document_sql(provider) ++ " THEN 'read' ELSE 'unreadable' END,CASE WHEN json_valid(d) THEN coalesce(json_extract(d,'$.source'),'') ELSE '' END,replace(replace(" ++ read_reason_sql(provider,fallback) ++ ",char(10),' '),char(31),' '),CASE WHEN json_valid(d) THEN d ELSE json_object('output',d) END FROM (SELECT " ++ C.q(document) ++ " AS d);SELECT last_insert_rowid();"

# --- the hold decision -----------------------------------------------------------
#
# A window named WINDOW:SCOPE (for example 7-day:opus) applies only to a seat whose
# recorded model contains SCOPE; a window without a scope applies to every seat of the
# provider and account. Newest means observed_at, then row identity.
# latest readable: the newest read with state 'read'. episode:
# for one model, the first read that holds it after the newest readable read that did
# not. The episode is non-NULL exactly when the latest readable read holds the model.

def window_applies_sql(+w: String, +model: String) -> String:
  "(instr(coalesce(json_extract(" ++ w ++ ".value,'$.window'),''),':')=0 OR instr(lower(" ++ C.q(model) ++ "),lower(substr(json_extract(" ++ w ++ ".value,'$.window'),instr(json_extract(" ++ w ++ ".value,'$.window'),':')+1)))>0)"

def window_holds_sql(+w: String, +model: String) -> String:
  "(" ++ window_exhausted_sql(w) ++ " AND " ++ window_applies_sql(w,model) ++ ")"

def read_holds_sql(+r: String, +model: String) -> String:
  "EXISTS(SELECT 1 FROM json_each(" ++ r ++ ".document,'$.windows') w WHERE " ++ window_holds_sql("w",model) ++ ")"

def latest_readable_sql(+provider: String, +account: String) -> String:
  "(SELECT id FROM usage_reads WHERE " ++ scope_sql("",provider,account) ++ " AND state='read' ORDER BY observed_at DESC,id DESC LIMIT 1)"

def latest_read_sql(+provider: String, +account: String) -> String:
  "(SELECT id FROM usage_reads WHERE " ++ scope_sql("",provider,account) ++ " ORDER BY observed_at DESC,id DESC LIMIT 1)"

# An unreadable episode starts after the newest readable observation.
def unknown_episode_sql(+provider: String, +account: String) -> String:
  "(SELECT e.id FROM usage_reads e WHERE " ++ scope_sql("e.",provider,account) ++ " AND e.state='unreadable' AND NOT EXISTS(SELECT 1 FROM usage_reads r WHERE r.id=" ++ latest_readable_sql(provider,account) ++ " AND (r.observed_at,r.id)>=(e.observed_at,e.id)) ORDER BY e.observed_at,e.id LIMIT 1)"

def last_open_sql(+provider: String, +account: String, +model: String) -> String:
  "(SELECT o.id FROM usage_reads o WHERE " ++ scope_sql("o.",provider,account) ++ " AND o.state='read' AND NOT " ++ read_holds_sql("o",model) ++ " ORDER BY o.observed_at DESC,o.id DESC LIMIT 1)"

def episode_sql(+provider: String, +account: String, +model: String) -> String:
  "(SELECT e.id FROM usage_reads e WHERE " ++ scope_sql("e.",provider,account) ++ " AND e.state='read' AND NOT EXISTS(SELECT 1 FROM usage_reads o WHERE o.id=" ++ last_open_sql(provider,account,model) ++ " AND (o.observed_at,o.id)>=(e.observed_at,e.id)) AND " ++ read_holds_sql("e",model) ++ " ORDER BY e.observed_at,e.id LIMIT 1)"

# The window of the latest readable read that holds the model and resets last; a
# window without a reported reset sorts first, because no reset time ends it.
def held_window_sql(+provider: String, +account: String, +model: String, +field: String) -> String:
  "(SELECT " ++ field ++ " FROM usage_reads r, json_each(r.document,'$.windows') w WHERE r.id=" ++ latest_readable_sql(provider,account) ++ " AND " ++ window_holds_sql("w",model) ++ " ORDER BY json_extract(w.value,'$.resetsAt') IS NULL DESC, json_extract(w.value,'$.resetsAt') DESC LIMIT 1)"

def field_sql(+value: String) -> String:
  "coalesce(" ++ value ++ ",'')"

# One line: state, window, reset, source, receipt and reason separated by char(31).
def decision_sql(+provider: String, +account: String, +model: String) -> String:
  +episode = episode_sql(provider,account,model)
  +latest = latest_read_sql(provider,account)
  "SELECT CASE WHEN " ++ episode ++ " IS NOT NULL THEN 'held'||char(31)||" ++ field_sql(held_window_sql(provider,account,model,"json_extract(w.value,'$.window')")) ++ "||char(31)||" ++ field_sql(held_window_sql(provider,account,model,"CAST(CAST(json_extract(w.value,'$.resetsAt') AS INTEGER) AS TEXT)")) ++ "||char(31)||" ++ field_sql("(SELECT source FROM usage_reads WHERE id=" ++ latest_readable_sql(provider,account) ++ ")") ++ "||char(31)||'usage-read:'||" ++ episode ++ "||char(31)||''"
  ++ " WHEN (SELECT state FROM usage_reads WHERE id=" ++ latest ++ ")='unreadable' THEN 'unknown'||char(31)||''||char(31)||''||char(31)||" ++ field_sql("(SELECT source FROM usage_reads WHERE id=" ++ latest ++ ")") ++ "||char(31)||'usage-read:'||" ++ unknown_episode_sql(provider,account) ++ "||char(31)||" ++ field_sql("(SELECT reason FROM usage_reads WHERE id=" ++ latest ++ ")")
  ++ " ELSE 'none'||char(31)||''||char(31)||''||char(31)||''||char(31)||''||char(31)||'' END;"

def gate_of_state(+state: String, +window: String, +resets: String, +source: String, +receipt: String, +reason: String) -> Gate:
  match state:
    case "held": GateHeld{window,resets,source,receipt}
    case "unknown": GateUnknown{source,reason,receipt}
    case _: GateNone{}

def gate_of_fields(fields: List<&2,String>) -> Gate:
  match fields:
    case +state <> +window <> +resets <> +source <> +receipt <> +reason <> Nil{}: gate_of_state(state,window,resets,source,receipt,reason)
    case other: GateNone{}

def decide(+db: String, +provider: String, +account: String, +model: String) -> IO(Gate):
  do IO<Gate>:
    +text : String <- IO.try(String,DB.Sql.read(db,decision_sql(provider,account,model)))
    IO.pure(Gate,gate_of_fields(String.split(Tx.trim_nl(text),Char.from_u32(31))))

def gate_held(gate: Gate) -> Bool:
  match gate:
    case GateHeld{window,resets_at,source,receipt}: True{}
    case other: False{}


# A recorded provider reset ends the hold it named. Until the next live read, a
# held window whose reset instant is not in the future is elapsed: the owed
# input is admitted and the read that admission performs decides the next hold.
# A window with no recorded reset keeps its hold.
def reset_passed_sql(+resets_at: String) -> String:
  "SELECT CASE WHEN " ++ C.q(resets_at) ++ "<>'' AND CAST(" ++ C.q(resets_at) ++ " AS INTEGER)>0 AND CAST(" ++ C.q(resets_at) ++ " AS INTEGER)<=" ++ now_ms() ++ " THEN 1 ELSE 0 END;"

def current_gate(+db: String, gate: Gate) -> IO(Gate):
  match gate:
    case GateHeld{+window,+resets_at,+source,+receipt}: do IO<Gate>:
      +passed : String <- IO.try(String,DB.Sql.read(db,reset_passed_sql(resets_at)))
      IO.pure(Gate,Bool.pick(Gate,String.eq(passed,"1\n"),GateNone{},GateHeld{window,resets_at,source,receipt}))
    case other: IO.pure(Gate,other)

# --- the read effect -------------------------------------------------------------
#
# The credential reference of an account record, else the provider's configured
# reference. The helper reads the credential inside its request; the coordinator
# passes only the reference.

def default_credential_ref(+provider: String) -> String:
  match provider:
    case "zai": "omp-models:zai"
    case "kimi-code": "omp-models:kimi-code"
    case "deepseek": "omp-auth:deepseek"
    case "codex": "codex-home:"
    case "claude": "claude-oauth:"
    case _: ""

def credential_ref_sql(+account: String) -> String:
  "SELECT coalesce((SELECT CASE WHEN funding='api_key' THEN secret_ref WHEN harness='codex' THEN 'codex-home:'||secret_ref WHEN harness='claude-code' THEN 'claude-oauth:'||secret_ref||'/.credentials.json' ELSE '' END FROM accounts WHERE id=" ++ C.q(account) ++ "),'');"

def credential_ref_of(+provider: String, recorded: Result<&1,&1,U32 & String,String>) -> String:
  match recorded:
    case Fail{error}: default_credential_ref(provider)
    case Done{+text}: Bool.pick(String,String.is_empty(Tx.trim_nl(text)),default_credential_ref(provider),Tx.trim_nl(text))

def credential_ref(+db: String, +provider: String, +account: String) -> IO(String):
  do IO<String>:
    recorded : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,credential_ref_sql(account))
    IO.pure(String,credential_ref_of(provider,recorded))

def drop_last(parts: List<String>) -> List<String>:
  match parts:
    case Nil{}: Nil{}
    case part <> Nil{}: Nil{}
    case part <> rest: Con{part,drop_last(rest)}

def copy_parts(parts: List<&2,String>) -> List<String>:
  match parts:
    case Nil{}: Nil{}
    case part <> rest: Con{part,copy_parts(rest)}

def directory_of(path: String) -> String:
  Tx.join("/",drop_last(copy_parts(String.split(path,Char.from_u32(47)))))

# The usage-read helper is installed beside the runtime's identity helper, like
# api-key-exec. An unresolved runtime answers the empty path.
def helper_beside(+helper: String) -> String:
  Bool.pick(String,String.is_empty(helper),"",directory_of(helper) ++ "/usage-read")

def helper_of_identity(identity: String & String) -> String:
  (registry,helper)=identity
  helper_beside(helper)

def helper_identity(found: Result<&1,&1,U32 & String,String & String>) -> String:
  match found:
    case Fail{error}: ""
    case Done{identity}: helper_of_identity(identity)

def helper_executable(found: Result<&1,&1,U32 & String,String>) -> IO(String):
  match found:
    case Fail{error}: IO.pure(String,"")
    case Done{+executable}: do IO<String>:
      identity : Result<&1,&1,U32 & String,String & String> <- Host.Control.identity(executable)
      IO.pure(String,helper_identity(identity))

def read_helper() -> IO(String):
  do IO<String>:
    found : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.executable()
    helper_executable(found)

# The helper's document and the reason recorded when the document is not readable.
def run_outcome(outcome: T.RunRes) -> String & String:
  match outcome:
    case T.RRun{T.SExit{0},+out}: (Tx.trim_nl(out),"the usage-read helper printed no read document")
    case T.RRun{T.SExit{code},+out}: ("","the usage-read helper exited " ++ U32.show(code) ++ ": " ++ Tx.trim_nl(out))
    case T.RRun{T.SSignal{num},out}: ("","the usage-read helper ended by signal " ++ U32.show(num))
    case T.RSpawn{detail}: ("","the usage-read helper did not start: " ++ detail)

# The codex executable recorded for a Codex seat: the harness command in its receiver
# endpoint, at the positions Usage.harness_command_sql reads. Another seat's harness
# records no codex command, so it answers ''.
def recorded_codex_sql(+session: String) -> String:
  "SELECT coalesce((SELECT CASE WHEN harness='codex' AND json_valid(endpoint) THEN CASE json_array_length(endpoint) WHEN 9 THEN coalesce(json_extract(endpoint,'$[4]'),'') WHEN 17 THEN coalesce(json_extract(endpoint,'$[12]'),'') WHEN 19 THEN coalesce(json_extract(endpoint,'$[14]'),'') ELSE '' END ELSE '' END FROM sessions WHERE id=" ++ C.q(session) ++ "),'');"

def recorded_text(found: Result<&1,&1,U32 & String,String>) -> String:
  match found:
    case Fail{error}: ""
    case Done{+text}: Tx.trim_nl(text)

def recorded_codex(+db: String, +session: String) -> IO(String):
  do IO<String>:
    found : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,recorded_codex_sql(session))
    IO.pure(String,recorded_text(found))

# The executable passed to the helper for a Codex read, or '' for another provider.
def read_executable(+db: String, +session: String, +provider: String) -> IO(String):
  Bool.pick(IO(String),String.eq(provider,"codex"),recorded_codex(db,session),IO.pure(String,""))

def read_argv(+helper: String, +provider: String, +ref: String, +executable: String) -> List<String>:
  Bool.pick(List<String>,String.is_empty(executable),[helper,provider,ref],[helper,provider,ref,executable])

def run_read_present(+helper: String, +provider: String, +ref: String, +executable: String) -> IO(String & String):
  do IO<String & String>:
    run : Result<&1,&1,U32 & String,String> <- Process.Process.run(Tx.enc_argv(read_argv(helper,provider,ref,executable)),".")
    IO.pure(String & String,run_outcome(Tx.run_res(run)))

def run_read(+helper: String, +provider: String, +ref: String, +executable: String) -> IO(String & String):
  Bool.pick(IO(String & String),String.is_empty(helper),
    IO.pure(String & String,("","no usage-read helper is installed beside the runtime identity helper")),
    run_read_present(helper,provider,ref,executable))

# --- announcements ---------------------------------------------------------------
#
# Each announcement goes to the seat's orchestrator and, under the same identity
# with ':root' appended, to the root of the seat's parent chain when the root is a
# different session.

def root_sql(+seat: String) -> String:
  "(WITH RECURSIVE up(id,parent) AS (SELECT id,parent FROM sessions WHERE id=" ++ seat ++ " UNION ALL SELECT s.id,s.parent FROM sessions s JOIN up ON s.id=up.parent) SELECT id FROM up WHERE parent IS NULL LIMIT 1)"

def announce_sql(+id: String, +seat: String, +body: String, +cond: String) -> String:
  "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ id ++ ",s.id," ++ C.report_recipient("s.id") ++ ",'report'," ++ body ++ " FROM sessions s WHERE s.id=" ++ seat ++ " AND " ++ cond ++ " AND " ++ C.report_recipient("s.id") ++ " IS NOT NULL;"
  ++ "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ id ++ "||':root',s.id," ++ root_sql("s.id") ++ ",'report'," ++ body ++ " FROM sessions s WHERE s.id=" ++ seat ++ " AND " ++ cond ++ " AND " ++ root_sql("s.id") ++ " IS NOT NULL AND " ++ root_sql("s.id") ++ "<>s.id AND " ++ root_sql("s.id") ++ "<>coalesce(" ++ C.report_recipient("s.id") ++ ",'');"

def iso_sql(+ms: String) -> String:
  "strftime('%Y-%m-%dT%H:%M:%SZ'," ++ ms ++ "/1000,'unixepoch')"

# The windows of one read as text: window, used percent, provider reset.
def windows_text_sql(+read: String) -> String:
  "coalesce((SELECT group_concat(coalesce(json_extract(w.value,'$.window'),'unnamed') || ' ' || coalesce(CAST(json_extract(w.value,'$.usedPercent') AS TEXT),'unreported') || '% used, resets ' || coalesce(" ++ iso_sql("CAST(json_extract(w.value,'$.resetsAt') AS INTEGER)") ++ ",'unreported') || CASE WHEN " ++ window_exhausted_sql("w") ++ " THEN ' (exhausted)' ELSE '' END,'; ') FROM usage_reads r, json_each(r.document,'$.windows') w WHERE r.id=" ++ read ++ "),'no windows')"

def read_text_sql(+read: String) -> String:
  "('live read ' || " ++ read ++ " || ' of ' || (SELECT source FROM usage_reads WHERE id=" ++ read ++ ") || ' at ' || " ++ iso_sql("(SELECT observed_at FROM usage_reads WHERE id=" ++ read ++ ")") ++ " || ': ' || " ++ windows_text_sql(read) ++ ")"

def scope_text(+provider: String, +account: String) -> String:
  "provider " ++ provider ++ ", account " ++ Bool.pick(String,String.is_empty(account),"(default)",account)

def hold_sql(+seat: String, +provider: String, +account: String, +model: String) -> String:
  +episode = episode_sql(provider,account,model)
  +latest = latest_readable_sql(provider,account)
  announce_sql("'usage-read:'||" ++ episode ++ "||':hold:'||" ++ C.q(seat),C.q(seat),"'usage hold: seat " ++ C.escaped(seat) ++ " (model " ++ C.escaped(model) ++ ") on " ++ C.escaped(scope_text(provider,account)) ++ " is held by window ' || " ++ field_sql(held_window_sql(provider,account,model,"json_extract(w.value,'$.window')")) ++ " || '. ' || " ++ read_text_sql(latest) ++ " || '. Owed input stays queued. Only a live read releases the hold; Baton reads this provider account again at admission, at a future reported reset time and on usage-window-refresh.'",episode ++ " IS NOT NULL")

def unknown_sql(+seat: String, +provider: String, +account: String) -> String:
  +latest = latest_read_sql(provider,account)
  announce_sql("'usage-read:'||" ++ unknown_episode_sql(provider,account) ++ "||':unreadable:'||" ++ C.q(seat),C.q(seat),"'usage read unreadable: seat " ++ C.escaped(seat) ++ " on " ++ C.escaped(scope_text(provider,account)) ++ ". ' || (SELECT source FROM usage_reads WHERE id=" ++ latest ++ ") || ': ' || (SELECT reason FROM usage_reads WHERE id=" ++ latest ++ ") || '. The hold state is unknown; Baton does not hold the seat on an unknown read and keeps any hold an earlier readable read recorded.'","(SELECT state FROM usage_reads WHERE id=" ++ latest ++ ")='unreadable'")

# The seat's hold announcements without a release, each answered with a release that
# keeps the hold's recipient. The id prefix lets the read use the unique id index.
def release_sql(+seat: String, +provider: String, +account: String) -> String:
  +latest = latest_readable_sql(provider,account)
  "INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT replace(h.id,':hold:',':release:'),h.sender,h.recipient,'report','usage hold released: seat " ++ C.escaped(seat) ++ " on " ++ C.escaped(scope_text(provider,account)) ++ ". ' || coalesce(" ++ read_text_sql(latest) ++ ",'No readable read is recorded for this provider and account') || '. Owed input is admitted.' FROM messages h, usage_reads e WHERE h.id GLOB 'usage-read:'||e.id||':hold:*' AND " ++ scope_sql("e.",provider,account) ++ " AND h.sender=" ++ C.q(seat) ++ " AND h.kind='report' AND NOT EXISTS(SELECT 1 FROM messages x WHERE x.id=replace(h.id,':hold:',':release:'));SELECT changes();"

def announce(+db: String, +seat: String, +provider: String, +account: String, +model: String, gate: Gate) -> IO(Unit):
  match gate:
    case GateHeld{window,resets_at,source,receipt}: do IO<Unit>:
      held : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,hold_sql(seat,provider,account,model))
      unread : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,unknown_sql(seat,provider,account))
      IO.pure(Unit,Unit{})
    case GateUnknown{source,reason,receipt}: do IO<Unit>:
      unread : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,unknown_sql(seat,provider,account))
      released : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,release_sql(seat,provider,account))
      IO.pure(Unit,Unit{})
    case GateNone{}: do IO<Unit>:
      released : Result<&1,&1,U32 & String,String> <- DB.Sql.query(db,release_sql(seat,provider,account))
      IO.pure(Unit,Unit{})

# --- the seat -------------------------------------------------------------------------

def seat_field_sql(+session: String, +field: String) -> String:
  "SELECT coalesce((SELECT " ++ field ++ " FROM sessions WHERE id=" ++ C.q(session) ++ "),'');"

def seat_model_io(+db: String, +session: String) -> IO(String):
  do IO<String>:
    +text : String <- IO.try(String,DB.Sql.read(db,seat_field_sql(session,"model")))
    IO.pure(String,Tx.trim_nl(text))

def seat_provider_io(+db: String, +session: String) -> IO(String):
  do IO<String>:
    +harness : String <- IO.try(String,DB.Sql.read(db,seat_field_sql(session,"harness")))
    +model : String <- seat_model_io(db,session)
    IO.pure(String,seat_provider(Tx.trim_nl(harness),model))

# --- release of the other held seats ------------------------------------------------
#
# After every read, each other seat with an unreleased hold on the same provider and
# account is decided again for its own model. A seat the read no longer holds has its
# release announced, and its head owed message is driven through the wake entry in a
# detached process, so its input is admitted on its retained assignment (#1020). The
# seat whose event made the read continues in its own caller.

def held_seats_sql(+provider: String, +account: String, +current: String) -> String:
  "SELECT DISTINCT h.sender FROM messages h, usage_reads e WHERE h.id GLOB 'usage-read:*:hold:*' AND h.id GLOB 'usage-read:'||e.id||':hold:*' AND " ++ scope_sql("e.",provider,account) ++ " AND h.sender<>" ++ C.q(current) ++ " AND NOT EXISTS(SELECT 1 FROM messages x WHERE x.id=replace(h.id,':hold:',':release:'));"

def owed_head_sql(+seat: String) -> String:
  "SELECT coalesce((SELECT id FROM messages m WHERE m.recipient=" ++ C.q(seat) ++ " AND " ++ C.owed_sql("m") ++ " AND NOT " ++ C.stopped_session_sql(C.q(seat)) ++ " ORDER BY seq LIMIT 1),'');"

def wake_argv(+self: String, +db: String, +message: String) -> List<String>:
  [self,"--wake-message",db,message]

def wake_result(+db: String, +seat: String, +head: String, launched: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  match launched:
    case Done{out}: IO.pure(Bool,True{})
    case Fail{(code,+detail)}: do IO<Bool>:
      reported : Unit <- window_report(db,seat,head,"usage-release-wake-failed","usage release wake failed: " ++ U32.show(code) ++ ": " ++ detail ++ "; owed input remains queued for another release attempt.")
      IO.pure(Bool,False{})

def wake_head(+db: String, +self: String, +canonical: String, +seat: String, +head: String) -> IO(Bool):
  Bool.pick(IO(Bool),String.is_empty(head),IO.pure(Bool,True{}),do IO<Bool>:
    launched : Result<&1,&1,U32 & String,String> <- Host.Control.launch(Tx.enc_argv(wake_argv(self,canonical,head)),db,head ++ ":usage-read-release")
    wake_result(db,seat,head,launched))

def release_open(+db: String, +self: String, +canonical: String, +seat: String, +provider: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    +head : String <- IO.try(String,DB.Sql.read(db,owed_head_sql(seat)))
    launched : Bool <- wake_head(db,self,canonical,seat,Tx.trim_nl(head))
    released : String <- Bool.pick(IO(String),launched,IO.try(String,DB.Sql.query(db,release_sql(seat,provider,account))),IO.pure(String,""))
    IO.pure(Unit,Unit{})

def release_seat(+db: String, +self: String, +canonical: String, +seat: String, +provider: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    +model : String <- seat_model_io(db,seat)
    gate : Gate <- decide(db,provider,account,model)
    Bool.pick(IO(Unit),gate_held(gate),IO.pure(Unit,Unit{}),release_open(db,self,canonical,seat,provider,account))

def release_seats(+db: String, +self: String, +canonical: String, seats: List<String>, +provider: String, +account: String) -> IO(Unit):
  match seats:
    case Nil{}: IO.pure(Unit,Unit{})
    case +seat <> rest: do IO<Unit>:
      one : Unit <- Bool.pick(IO(Unit),String.is_empty(seat),IO.pure(Unit,Unit{}),release_seat(db,self,canonical,seat,provider,account))
      release_seats(db,self,canonical,rest,provider,account)

def release_with_runtime(+db: String, +current: String, +provider: String, +account: String, self: Result<&1,&1,U32 & String,String>, canonical: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match self:
    case Fail{error}: IO.pure(Unit,Unit{})
    case Done{+exe}:
      match canonical:
        case Fail{error}: IO.pure(Unit,Unit{})
        case Done{+path}: do IO<Unit>:
          +seats : String <- IO.try(String,DB.Sql.read(db,held_seats_sql(provider,account,current)))
          release_seats(db,exe,path,Tx.split_lines(seats),provider,account)

def release_others(+db: String, +current: String, +provider: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    self : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.executable()
    canonical : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(db)
    release_with_runtime(db,current,provider,account,self,canonical)

# --- the read and the gate ----------------------------------------------------------

def record_pair(+db: String, +session: String, +provider: String, +account: String, +trigger: String, +document: String, +fallback: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String,DB.Sql.query(db,record_read_sql(provider,account,session,trigger,document,fallback)))
    IO.pure(Unit,Unit{})

def record_document(+db: String, +session: String, +provider: String, +account: String, +trigger: String, answer: String & String) -> IO(Unit):
  (document,fallback)=answer
  record_pair(db,session,provider,account,trigger,document,fallback)

# One live read for a provider and account, recorded, followed by the release of the
# other seats it no longer holds. One read serves every seat on the provider account.
# helper is the usage-read executable. The physical account lock covers the
# request and insert; process exit releases the lock after an insert failure.
def read_with(+db: String, +session: String, +provider: String, +account: String, +helper: String, +trigger: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    lock : U32 <- IO.try(U32,Lock.SessionLock.wait_acquire(canonical,"usage-read:" ++ J.string_literal(provider) ++ ":" ++ J.string_literal(account)))
    +ref : String <- credential_ref(canonical,provider,account)
    +executable : String <- read_executable(canonical,session,provider)
    answer : String & String <- run_read(helper,provider,ref,executable)
    recorded : Unit <- record_document(canonical,session,provider,account,trigger,answer)
    released : Unit <- IO.try(Unit,Lock.SessionLock.release(lock))
    release_others(canonical,session,provider,account)

# The hold state of a seat from the recorded reads, with its announcements. No read.
def window_state(+db: String, +session: String, account: String) -> IO(Gate):
  do IO<Gate>:
    +provider : String <- seat_provider_io(db,session)
    +model : String <- seat_model_io(db,session)
    +label : String <- IO.pure(String,Tx.trim_nl(account))
    +gate : Gate <- Bool.pick(IO(Gate),String.is_empty(provider),IO.pure(Gate,GateNone{}),do IO<Gate>:
      raw : Gate <- decide(db,provider,label,model)
      current_gate(db,raw))
    noted : Unit <- Bool.pick(IO(Unit),String.is_empty(provider),IO.pure(Unit,Unit{}),announce(db,session,provider,label,model,gate))
    IO.pure(Gate,gate)

# Admission reads the seat's provider account before deciding from durable reads.
def window_gate_with(+db: String, +session: String, account: String, +helper: String) -> IO(Gate):
  do IO<Gate>:
    +provider : String <- seat_provider_io(db,session)
    +label : String <- IO.pure(String,Tx.trim_nl(account))
    read : Unit <- Bool.pick(IO(Unit),String.is_empty(provider),IO.pure(Unit,Unit{}),read_with(db,session,provider,label,helper,"admission"))
    window_state(db,session,label)

def window_gate(+db: String, +session: String, account: String) -> IO(Gate):
  do IO<Gate>:
    +helper : String <- read_helper()
    window_gate_with(db,session,account,helper)

# The read a provider exhaustion terminal starts, before the account advance reads
# the gates. attempt names the refused attempt in the trigger.
def read_refused_with(+db: String, +session: String, account: String, +attempt: String, +helper: String) -> IO(Unit):
  do IO<Unit>:
    +provider : String <- seat_provider_io(db,session)
    Bool.pick(IO(Unit),String.is_empty(provider),IO.pure(Unit,Unit{}),read_with(db,session,provider,Tx.trim_nl(account),helper,"provider-refusal:" ++ attempt))

def read_refused(+db: String, +session: String, account: String, +attempt: String) -> IO(Unit):
  do IO<Unit>:
    +helper : String <- read_helper()
    read_refused_with(db,session,account,attempt,helper)

# --- the held-seat continuation -----------------------------------------------------
#
# A held wake schedules a read at a future provider reset. A provider response
# with a passed or absent reset leaves the hold reported to its orchestrator.

def schedule_argv(+self: String, +db: String, +message: String, +delay_s: String) -> List<String>:
  ["/bin/sh","-c","sleep \"$1\"; shift; exec \"$@\"","sh",delay_s,self,"--wake-message",db,message]

def schedule_delay_sql(+resets_at: String) -> String:
  "SELECT CASE WHEN " ++ C.q(resets_at) ++ "<>'' AND CAST(" ++ C.q(resets_at) ++ " AS INTEGER)>" ++ now_ms() ++ " THEN CAST((CAST(" ++ C.q(resets_at) ++ " AS INTEGER)-" ++ now_ms() ++ "+999)/1000 AS TEXT) ELSE '' END;"

def schedule_launch(+db: String, +message: String, +delay_s: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    launched : Result<&1,&1,U32 & String,String> <- Host.Control.launch(Tx.enc_argv(schedule_argv(self,db,message,delay_s)),db,message ++ ":usage-window-wake")
    IO.pure(Unit,Unit{})

def schedule_wake(+db: String, +message: String, +resets_at: String, +self: String) -> IO(Unit):
  do IO<Unit>:
    +delay : String <- IO.try(String,DB.Sql.read(db,schedule_delay_sql(resets_at)))
    Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(delay)),IO.pure(Unit,Unit{}),schedule_launch(db,message,Tx.trim_nl(delay),self))

def schedule_held(+db: String, +message: String, +delay_s: String) -> IO(Unit):
  do IO<Unit>:
    +self : String <- IO.try(String,Lock.SessionLock.executable())
    +canonical : String <- IO.try(String,Lock.SessionLock.canonical(db))
    schedule_launch(canonical,message,delay_s,self)

# A held wake schedules a future reset read or reports the owed message and the
# absence of a future reset to its orchestrator.
def held(+db: String, +session: String, +message: String, +trigger: String, gate: Gate) -> IO(Unit):
  match gate:
    case GateHeld{+window,+resets_at,+source,+receipt}: Bool.pick(IO(Unit),String.is_empty(message),IO.pure(Unit,Unit{}),do IO<Unit>:
      +delay : String <- IO.try(String,DB.Sql.read(db,schedule_delay_sql(resets_at)))
      Bool.pick(IO(Unit),String.is_empty(Tx.trim_nl(delay)),
        window_report(db,session,receipt ++ ":" ++ message,"usage-hold-needs-read","usage hold: " ++ trigger ++ " for seat " ++ session ++ " keeps message " ++ message ++ " owed. Window " ++ window ++ " from " ++ source ++ " has no future provider reset. Its orchestrator can request usage-window-refresh or deliver further input to read the provider again."),
        schedule_held(db,message,Tx.trim_nl(delay))))
    case other: IO.pure(Unit,Unit{})

# --- the commands ---------------------------------------------------------------------

def observe_registered(saved: String) -> IO(Unit):
  match saved:
    case SNil{}: IO.die(Unit,2,"Session is not registered; inspect status and the requested ID.")
    case other: IO.pure(Unit,Unit{})

def hold_name(gate: Gate) -> String:
  match gate:
    case GateHeld{window,resets_at,source,receipt}: "held"
    case GateUnknown{source,reason,receipt}: "unknown"
    case GateNone{}: "open"

# The seat's hold state, its recent reads and its recent refusal evidence.
def query_answer_sql(+session: String, +provider: String, +account: String, +hold: String) -> String:
  "SELECT json_object('schema','baton2-usage-windows-v2','session'," ++ C.q(session) ++ ",'provider'," ++ C.q(provider) ++ ",'account'," ++ C.q(account) ++ ",'hold'," ++ C.q(hold)
  ++ ",'reads',coalesce((SELECT json_group_array(json(item)) FROM (SELECT json_object('read',r.id,'observedAt',r.observed_at,'trigger',r.trigger,'state',r.state,'source',r.source,'reason',nullif(r.reason,''),'windows',CASE WHEN r.state='read' THEN json_extract(r.document,'$.windows') END) AS item FROM usage_reads r WHERE " ++ scope_sql("r.",provider,account) ++ " ORDER BY r.observed_at DESC,r.id DESC LIMIT 10)),'[]')"
  ++ ",'refusals',coalesce((SELECT json_group_array(json(item)) FROM (SELECT json_object('recordedAt',u.recorded_at,'window',u.window,'source',u.reset_source,'receipt',u.receipt,'message',nullif(u.message,'')) AS item FROM usage_windows u, sessions s WHERE s.id=" ++ C.q(session) ++ " AND u.harness=s.harness AND u.provider=" ++ model_provider_sql("s.model") ++ " AND u.account=" ++ C.q(account) ++ " ORDER BY u.id DESC LIMIT 10)),'[]'));"

def query_print(+db: String, +session: String, +provider: String, +account: String, gate: Gate) -> IO(Unit):
  do IO<Unit>:
    +answer : String <- IO.try(String,DB.Sql.read(db,query_answer_sql(session,provider,account,hold_name(gate))))
    IO.print(Tx.trim_nl(answer))

def query(+db: String, +session: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,Store.read(db,C.Session{session}))
    present : Unit <- observe_registered(found)
    +provider : String <- seat_provider_io(db,session)
    gate : Gate <- window_state(db,session,account)
    query_print(db,session,provider,Tx.trim_nl(account),gate)

# usage-window-refresh: one live read for the seat's provider and account, then the
# same answer as the query. A provider without a reader records an unreadable read.
def refresh_with(+db: String, +session: String, +account: String, +helper: String) -> IO(Unit):
  do IO<Unit>:
    found : String <- IO.try(String,Store.read(db,C.Session{session}))
    present : Unit <- observe_registered(found)
    +provider : String <- seat_provider_io(db,session)
    +label : String <- IO.pure(String,Tx.trim_nl(account))
    read : Unit <- Bool.pick(IO(Unit),String.is_empty(provider),IO.die(Unit,2,"The session's harness and model name no provider with a usage API; nothing was read."),read_with(db,session,provider,label,helper,"usage-window-refresh"))
    gate : Gate <- window_state(db,session,label)
    query_print(db,session,provider,label,gate)

def refresh(+db: String, +session: String, +account: String) -> IO(Unit):
  do IO<Unit>:
    +helper : String <- read_helper()
    refresh_with(db,session,account,helper)

# --- refusal report identities ------------------------------------------------------
#
# Reports for the same refusal share one identity derived from the evidence row
# recorded for the attempt, so a later attempt adds no duplicate report.

def refusal_identity_sql(+session: String, +harness: String, +provider: String, +attempt: String) -> String:
  "SELECT coalesce((SELECT " ++ C.q(session) ++ " || char(31) || p.harness || char(31) || p.provider || char(31) || p.account || char(31) || p.window || char(31) || coalesce(CAST(p.resets_at AS TEXT),'-') || char(31) || p.reset_source FROM usage_windows p WHERE p.harness=" ++ C.q(harness) ++ " AND p.provider=" ++ C.q(provider) ++ " AND p.message=" ++ C.q(attempt) ++ " AND p.reset_source IN ('provider-message','provider-report') AND " ++ exhausted_sql("p") ++ " ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1),'')"

def refusal_account_identity_sql(+session: String, +harness: String, +provider: String, +account: String, +attempt: String) -> String:
  "SELECT coalesce((SELECT " ++ C.q(session) ++ " || char(31) || p.harness || char(31) || p.provider || char(31) || p.account || char(31) || p.window || char(31) || coalesce(CAST(p.resets_at AS TEXT),'-') || char(31) || p.reset_source FROM usage_windows p WHERE p.harness=" ++ C.q(harness) ++ " AND p.provider=" ++ C.q(provider) ++ " AND p.account=" ++ C.q(account) ++ " AND p.message=" ++ C.q(attempt) ++ " AND p.reset_source IN ('provider-message','provider-report') AND " ++ exhausted_sql("p") ++ " ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1),'')"

# --- laws -----------------------------------------------------------------------------

law kimi_message_names_the_5_hour_window:
  {window_label_of(lower_ascii("You've reached your 5-hour usage limit.")) == "5-hour" : String}

def kimi_message_names_the_5_hour_window():
  {==}

law provider_prefix_binds_provider_models:
  {provider_of("kimi-code/kimi-for-coding") == "kimi-code" : String}

def provider_prefix_binds_provider_models():
  {==}

law bare_model_carries_no_provider:
  {provider_of("gpt-6-astra") == "" : String}

def bare_model_carries_no_provider():
  {==}

law codex_seat_reads_the_codex_provider:
  {seat_provider("codex","gpt-6-astra") == "codex" : String}

def codex_seat_reads_the_codex_provider():
  {==}

law zai_seat_reads_the_zai_provider:
  {seat_provider("omp","zai/glm-5.3") == "zai" : String}

def zai_seat_reads_the_zai_provider():
  {==}
