# Subscription profiles bind each account's credential directory into its launch
# environment. DATABASE.profiles lists "<harness> <label> <store>" in fallback
# order. The store is the rest of the line. Each session records selections in a
# separate file beside the database.
import Base
import ../coordinator/commands.bend as C
import ../json/canonical.bend as J
import ../git/text.bend as Tx
import ../host/sqlite.bend as DB
import ../host/text.bend as Text
import ../host/session-lock.bend as Lock
import ../host/control.bend as Host
import ../git/process.bend as Proc
import ../git/types.bend as T

type Profile is Data:
  Pr{harness: String, label: String, store: String}

def profile_harness(profile: Profile) -> String:
  match profile:
    case Pr{harness,label,store}: harness

def profile_label(profile: Profile) -> String:
  match profile:
    case Pr{harness,label,store}: label

def profile_store(profile: Profile) -> String:
  match profile:
    case Pr{harness,label,store}: store

# A missing optional profile or history file has no recorded value. Other read
# failures retain the filesystem's code and detail.
def optional_text(result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  match result:
    case Fail{(2,detail)}: Done{""}
    case other: other

# The directory of a path, by dropping its last component. A path with no separator
# has no directory and yields "".
def drop_last(parts: List<String>) -> List<String>:
  match parts:
    case Nil{}: Nil{}
    case part <> Nil{}: Nil{}
    case part <> rest: Con{part,drop_last(rest)}

def split_parts(parts: List<&2,String>) -> List<String>:
  match parts:
    case Nil{}: Nil{}
    case part <> rest: Con{part,split_parts(rest)}

def directory_of(path: String) -> String:
  Tx.join("/",drop_last(split_parts(String.split(path,Char.from_u32(47)))))

# One three-field line: the third field is the rest of the line, so a store path with
# spaces survives. A line whose fields are empty is skipped rather than guessed at.
def profile_fields(+harness: String, +label: String, +store: String) -> Maybe<&2,Profile>:
  Bool.pick(Maybe<&2,Profile>,Bool.and(Bool.not(String.is_empty(harness)),Bool.and(Bool.not(String.is_empty(label)),Bool.not(String.is_empty(store)))),Some{Pr{harness,label,store}},None{})

def profile_of(fields: List<String>) -> Maybe<&2,Profile>:
  match fields:
    case harness <> label <> rest: profile_fields(harness,label,Tx.join(" ",rest))
    case other: None{}

def profile_line(parsed: Maybe<&2,Profile>, tail: List<&2,Profile>) -> List<&2,Profile>:
  match parsed:
    case Some{profile}: Con{profile,tail}
    case None{}: tail

# The walk is one recursive function and the parse beside it is nonrecursive.
def profile_lines(lines: List<String>) -> List<&2,Profile>:
  match lines:
    case Nil{}: Nil{}
    case line <> rest: profile_line(profile_of(split_parts(String.split(Tx.trim_nl(line),Char.from_u32(32)))),profile_lines(rest))

def profiles_for(profiles: List<&2,Profile>, +harness: String) -> List<&2,Profile>:
  match profiles:
    case Nil{}: Nil{}
    case +profile <> +rest: Bool.pick(List<&2,Profile>,String.eq(profile_harness(profile),harness),Con{profile,profiles_for(rest,harness)},profiles_for(rest,harness))

def first_selected(profiles: List<&2,Profile>) -> Maybe<&2,Profile>:
  match profiles:
    case Nil{}: None{}
    case +profile <> rest: Some{profile}

def first_profile(profiles: List<&2,Profile>, harness: String) -> Maybe<&2,Profile>:
  first_selected(profiles_for(profiles,harness))

# The credential-store variable each harness reads. A harness without one gets no
# binding, so an unknown harness adds nothing to the spawn environment.
def store_variable(+harness: String) -> Maybe<String>:
  Bool.pick(Maybe<String>,String.eq(harness,"codex"),Some{"CODEX_HOME"},Bool.pick(Maybe<String>,Bool.or(String.eq(harness,"claude-code"),String.eq(harness,"claude")),Some{"CLAUDE_CONFIG_DIR"},None{}))

def binding_for(variable: Maybe<String>, store: String) -> List<String>:
  match variable:
    case None{}: Nil{}
    case Some{variable}: Con{variable ++ "=" ++ store, Nil{}}

# One element per binding. The host encodes each argv element separately, so a store
# path with spaces stays a single argument and needs no shell quoting.
def store_binding(harness: String, store: String) -> List<String>:
  binding_for(store_variable(harness),store)

# The profile after the one that refused, in operator order, or none when the
# operator listed no further profile for that harness. Order is the file's own order;
# no history and no observation reorders or suppresses a listed profile.
def next_after(profiles: List<&2,Profile>, +harness: String, +current: String, seen: Bool) -> Maybe<&2,Profile>:
  match profiles:
    case Nil{}: None{}
    case +profile <> +rest:
      match seen:
        case True{}: Bool.pick(Maybe<&2,Profile>,String.eq(profile_harness(profile),harness),Some{profile},next_after(rest,harness,current,True{}))
        case False{}: Bool.pick(Maybe<&2,Profile>,Bool.and(String.eq(profile_harness(profile),harness),String.eq(profile_label(profile),current)),next_after(rest,harness,current,True{}),next_after(rest,harness,current,False{}))

def next_profile(profiles: List<&2,Profile>, harness: String, current: String) -> Maybe<&2,Profile>:
  next_after(profiles,harness,current,False{})

# A handoff with no profile record yet selects the head of the operator's list.
def started_or_next(+profiles: List<&2,Profile>, +harness: String, +current: String) -> Maybe<&2,Profile>:
  Bool.pick(Maybe<&2,Profile>,String.is_empty(current),first_profile(profiles,harness),next_profile(profiles,harness,current))

def record_fields(+label: String, +store: String) -> Maybe<&2,Profile>:
  Bool.pick(Maybe<&2,Profile>,Bool.and(Bool.not(String.is_empty(label)),Bool.not(String.is_empty(store))),Some{Pr{"",label,store}},None{})

# New record lines carry a leading empty field: the line starts with an ASCII space
# before the harness, a shape the old label-first writer could not emit because it
# required a nonempty label. Any line without that leading space is a legacy line and
# names a label plus the complete store, so legacy labels keep every word of a spaced
# store with no dependence on operator data and no harness-name or slash guesswork.
# The harness set is closed and code-defined.
def record_harness_known(+word: String) -> Bool:
  Bool.or(String.eq(word,"codex"),Bool.or(String.eq(word,"omp"),Bool.or(String.eq(word,"muse"),Bool.or(String.eq(word,"claude-code"),String.eq(word,"claude")))))

def record_profile(+harness: String, +label: String, +store: String) -> Maybe<&2,Profile>:
  Bool.pick(Maybe<&2,Profile>,Bool.and(record_harness_known(harness),Bool.and(Bool.not(String.is_empty(label)),Bool.not(String.is_empty(store)))),Some{Pr{harness,label,store}},None{})

def record_new(fields: List<String>) -> Maybe<&2,Profile>:
  match fields:
    case +harness <> +label <> +store <> +rest: record_profile(harness,label,Tx.join(" ",Con{store,rest}))
    case other: None{}

def record_legacy(fields: List<String>) -> Maybe<&2,Profile>:
  match fields:
    case +label <> +store <> +rest: record_fields(label,Tx.join(" ",Con{store,rest}))
    case other: None{}

# The marked shape is detected on the line so the read never depends on how the word
# splitter treats a leading separator: a marked line parses its words as a new record
# with the marker consumed whether the splitter keeps the empty head or drops it.
def record_marked(fields: List<String>) -> Maybe<&2,Profile>:
  match fields:
    case +head <> +tail: Bool.pick(Maybe<&2,Profile>,String.is_empty(head),record_new(tail),record_new(fields))
    case other: None{}

def record_trimmed(+trimmed: String) -> Maybe<&2,Profile>:
  Bool.pick(Maybe<&2,Profile>,Tx.starts_with(trimmed," "),record_marked(split_parts(String.split(trimmed,Char.from_u32(32)))),record_legacy(split_parts(String.split(trimmed,Char.from_u32(32)))))

# The per-session record is append-only: the last non-empty line is the profile in
# use, so advancing it needs no rewrite and no lock.
def record_of(line: String) -> Maybe<&2,Profile>:
  record_trimmed(Tx.trim_nl(line))

def last_line(lines: List<String>) -> String:
  match lines:
    case Nil{}: ""
    case +line <> rest:
      +last = last_line(rest)
      Bool.pick(String,String.is_empty(last),Tx.trim_nl(line),last)

def label_of(parsed: Maybe<&2,Profile>) -> String:
  match parsed:
    case Some{profile}: profile_label(profile)
    case None{}: ""

def record_label(line: String) -> String:
  label_of(record_of(line))

def store_of(parsed: Maybe<&2,Profile>) -> String:
  match parsed:
    case Some{profile}: profile_store(profile)
    case None{}: ""

def record_store(line: String) -> String:
  store_of(record_of(line))

def harness_of(parsed: Maybe<&2,Profile>) -> String:
  match parsed:
    case Some{profile}: profile_harness(profile)
    case None{}: ""

def record_harness(line: String) -> String:
  harness_of(record_of(line))

# The label in force for this harness: a record written under another harness restarts
# at the operator list head, so a route-switched session advances within its own
# harness list; legacy harness-less records keep today's label match.
def record_current_parsed(harness: String, parsed: Maybe<&2,Profile>) -> String:
  match parsed:
    case None{}: ""
    case Some{+profile}: Bool.pick(String,Bool.or(String.is_empty(profile_harness(profile)),String.eq(profile_harness(profile),harness)),profile_label(profile),"")

def record_current(harness: String, line: String) -> String:
  record_current_parsed(harness,record_of(line))

# The store in force for this harness: a record written under another harness selects
# nothing, so a route-switched session never searches the old harness's store for the
# new harness's transcript; legacy harness-less records keep today's store.
def record_source_parsed(harness: String, parsed: Maybe<&2,Profile>) -> String:
  match parsed:
    case None{}: ""
    case Some{+profile}: Bool.pick(String,Bool.or(String.is_empty(profile_harness(profile)),String.eq(profile_harness(profile),harness)),profile_store(profile),"")

def record_source(harness: String, line: String) -> String:
  record_source_parsed(harness,record_of(line))

def record_line(+profile: Profile) -> String:
  " " ++ profile_harness(profile) ++ " " ++ profile_label(profile) ++ " " ++ profile_store(profile)

# The report bodies carry the account change and the provider's own cause. Nothing
# here decides anything; the caller records and reports.
def handoff_body(harness: String, refused: String, bound: String, store: String, cause: String) -> String:
  "subscription profile handoff: harness=" ++ harness ++ "; refused profile=" ++ refused ++ "; bound profile=" ++ bound ++ "; credential store=" ++ store ++ "; original cause: " ++ cause

def all_refused_body(harness: String, refused: String, cause: String) -> String:
  "subscription profiles exhausted: harness=" ++ harness ++ "; profile=" ++ refused ++ " was the last operator-listed profile and the provider reported usage exhaustion; cause: " ++ cause

# The provider's own diagnostic text for a terminal error frame, per the shapes this
# tree already handles plus the Claude SDK result message:
#   OMP    {"type":"agent_end", ..., {"role":"assistant","stopReason":"error","errorMessage":"..."}}
#   Codex  {"type":"turn.failed","error":{"message":"..."}}
#   Claude {"type":"result","subtype":...,"is_error":true,"result":"...","errors":[...],
#           "api_error_status":429,...}   (ResultMessage: is_error, result, errors,
#           api_error_status; the CLI emits api_error_status since v2.1.110)
def usage_text_sql_expr(+event: String) -> String:
  "CASE WHEN json_extract(" ++ event ++ ",'$.type')='agent_end' THEN coalesce(json_extract((SELECT " ++ C.last_assistant_sql_expr(event) ++ "),'$.errorMessage'),'') WHEN json_extract(" ++ event ++ ",'$.type')='turn.failed' THEN coalesce(json_extract(" ++ event ++ ",'$.error.message'),'') WHEN json_extract(" ++ event ++ ",'$.type')='result' THEN coalesce(json_extract(" ++ event ++ ",'$.result'),'') || ' ' || coalesce((SELECT group_concat(value,' ') FROM json_each(CASE WHEN json_type(" ++ event ++ ",'$.errors')='array' THEN json_extract(" ++ event ++ ",'$.errors') ELSE '[]' END)),'') ELSE '' END"

# A genuinely failed provider terminal only:
#   Codex  {"type":"turn.failed","error":{"message":"..."}}
#   Claude {"type":"result","is_error":true,...}          (a successful result that merely
#                                                          quotes limit words is never one)
#   OMP    {"type":"agent_end", ... {"stopReason":"error","errorMessage":"..."}}
def failed_terminal_sql_expr(+event: String) -> String:
  "CASE WHEN json_extract(" ++ event ++ ",'$.type')='turn.failed' THEN 1 WHEN json_extract(" ++ event ++ ",'$.type')='result' AND json_extract(" ++ event ++ ",'$.is_error')=1 THEN 1 WHEN " ++ C.omp_terminal_error_sql_expr(event) ++ "=1 THEN 1 ELSE 0 END"

# The provider's own subscription-limit wordings. Codex (protocol src/error.rs Display):
# "You’ve hit your usage limit[ for {limit_name}]", "Your workspace is out of credits.",
# "You hit your spend cap ..." and "Quota exceeded. Check your plan and billing details.".
# Claude (error reference): "You've hit your <session|weekly|Opus|Sonnet> limit",
# "spend limit reached" and "spend limit unavailable". An observed OMP-fronted
# subscription diagnostic reports the window instead: "You've reached your 5-hour usage
# limit. Your quota will reset when the current 5-hour window ends.", which the
# "reached your" fragment below covers. The "hit your" fragment omits the apostrophe so
# the curly and ASCII forms both match. ZAI reports "Usage limit reached for 5 hour"
# with its reset time. The observed OMP 402 stopReason=error shape reports
# "402 Insufficient Balance" with type=unknown_error. Not matched: the upstream
# "limit reached" header flag, "rate limit exceeded", the context-window message,
# stream disconnection and timeouts.
def exhausted_marker_sql(+text: String) -> String:
  "CASE WHEN (instr(lower(" ++ text ++ "),'hit your')>0 AND (instr(lower(" ++ text ++ "),'limit')>0 OR instr(lower(" ++ text ++ "),'budget')>0)) OR (instr(lower(" ++ text ++ "),'reached your')>0 AND (instr(lower(" ++ text ++ "),'limit')>0 OR instr(lower(" ++ text ++ "),'quota')>0)) OR instr(lower(" ++ text ++ "),'usage limit reached for ')>0 OR instr(lower(" ++ text ++ "),'out of credits')>0 OR instr(lower(" ++ text ++ "),'spend cap')>0 OR instr(lower(" ++ text ++ "),'quota exceeded')>0 OR instr(lower(" ++ text ++ "),'spend limit reached')>0 OR instr(lower(" ++ text ++ "),'spend limit unavailable')>0 OR instr(lower(" ++ text ++ "),'insufficient balance')>0 THEN 1 ELSE 0 END"

# Bind the complete terminal once and extract its diagnostic once for the
# provider's subscription-limit wording and the returned cause.
def exhausted_reason_sql(event: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")), diagnostic(failed,text) AS MATERIALIZED (SELECT " ++ failed_terminal_sql_expr("frame.value") ++ "," ++ usage_text_sql_expr("frame.value") ++ " FROM frame) SELECT CASE WHEN diagnostic.failed=1 AND " ++ exhausted_marker_sql("diagnostic.text") ++ "=1 THEN 'provider-reported usage exhaustion: ' || diagnostic.text ELSE '' END FROM diagnostic;"

# The operator list and the per-session record are plain files beside the database,
# like the other coordinator sidecars: no schema, no daemon, no environment lookup.
def profile_list_sql(+db: String) -> String:
  "SELECT " ++ C.q(db ++ ".profiles") ++ ";"

def profile_record_sql(+db: String, +session: String) -> String:
  "SELECT " ++ C.q(db ++ ".profile-") ++ " || lower(hex(id)) FROM sessions WHERE id=" ++ C.q(session) ++ ";"

# The history-home sidecar: one plain per-session JSON file beside the profile record,
# one object per line. It records the provider history home that was in effect for the
# store the actor was using, so the next spawn carries the preserved home into the
# provider's own history lookup. JSON keeps a path with spaces intact. The list and the
# record are ordinary stored lists: no schema, no daemon.
def history_record_sql(+db: String, +session: String) -> String:
  "SELECT " ++ C.q(db ++ ".history-") ++ " || lower(hex(id)) FROM sessions WHERE id=" ++ C.q(session) ++ ";"

# The preserved home of one written line, read through the database's JSON reader.
# A missing home yields an empty value. Malformed JSON retains the query failure.
def history_home_sql(+line: String) -> String:
  "SELECT coalesce(json_extract(" ++ C.q(line) ++ ",'$.home'),'');"

# The packaged native history helper of the runtime this deployment resolves: it sits beside
# the resolved identity helper, so it is installed and versioned with that runtime. No
# resolved helper means no such capability in this deployment.
def history_helper(+helper: String) -> String:
  Bool.pick(String,String.is_empty(helper),"",directory_of(helper) ++ "/native-history.mjs")

# The helper's request: every element is one literal argv element and the host encodes them
# without a shell, so a store or home path with spaces stays one argument. The existing
# history line is passed as JSON, and a session with no previous line passes an empty one.
def history_prepare_args(script: String, harness: String, cmd: String, cwd: String, native: String, from_store: String, to_store: String, existing: String) -> List<String>:
  ["node",script,"prepare",harness,cmd,cwd,native,from_store,to_store,existing]

# The provider's own history override for the continued spawn. The installed Codex reads
# its configured sqlite_home ahead of the environment, and the profile store's own
# configuration ahead of the environment as well, so the preserved home travels as one
# explicit argument value in the config value's own string form. The host encodes each
# argv element separately, so the value reaches the provider without a shell.
def history_override(harness: String, +home: String) -> List<String>:
  Bool.pick(List<String>,Bool.and(String.eq(harness,"codex"),Bool.not(String.is_empty(home))),["-c","sqlite_home=" ++ J.string_literal(home)],Nil{})

# --- subscription profile handoff (#702) -------------------------------------
#
# Receive and direct turns share these account handoff helpers. Provider-reported
# usage exhaustion advances the account while retaining the task and conversation.
def file_text(path: String) -> IO(String):
  do IO<String>:
    read : Result<&1,&1,U32 & String,String> <- Text.Text.read(path)
    IO.pass(String,optional_text(read))

def profile_list_path(+db: String) -> IO(String):
  do IO<String>:
    listed : String <- IO.try(String,DB.Sql.query(db,profile_list_sql(db)))
    IO.pure(String,Tx.trim_nl(listed))

def profile_record_path(+db: String, session: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,profile_record_sql(db,session)))
    IO.pure(String,Tx.trim_nl(saved))

def exhaustion_stated(db: String, event: String) -> IO(String):
  do IO<String>:
    reason : String <- IO.try(String,DB.Sql.query(db,exhausted_reason_sql(event)))
    IO.pure(String,Tx.trim_nl(reason))

def exhaustion_present(db: String, event: String, empty: Bool) -> IO(String):
  match empty:
    case True{}: IO.pure(String,"")
    case False{}: exhaustion_stated(db,event)

# The provider's own cause for a terminal frame that names usage exhaustion, or "" for
# every other outcome. A terminal that stated no event carries no cause, and its text is
# never read as JSON.
def exhaustion_cause(db: String, +event: String) -> IO(String):
  exhaustion_present(db,event,String.is_empty(event))

# Settled OMP rate refusals and socket closures, and Muse transport timeouts,
# continue on the same account. Usage exhaustion follows the account handoff path.
def transient_provider_sql(event: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(event) ++ ")), diagnostic(terminal,assistant,muse_terminal,muse_reason) AS MATERIALIZED (SELECT json_extract(frame.value,'$.type')," ++ C.last_assistant_sql_expr("frame.value") ++ ",CASE WHEN json_extract(frame.value,'$.payload.kind')='run_terminal' THEN json_extract(frame.value,'$.payload.terminal') END,coalesce(json_extract(frame.value,'$.payload.reason'),'') FROM frame) SELECT CASE WHEN (diagnostic.terminal='agent_end' AND json_extract(diagnostic.assistant,'$.stopReason')='error' AND (json_extract(diagnostic.assistant,'$.errorStatus')=429 OR instr(coalesce(json_extract(diagnostic.assistant,'$.errorMessage'),''),'The socket connection was closed unexpectedly.')=1)) OR (diagnostic.muse_terminal='failed' AND instr(diagnostic.muse_reason,'transport error [net-timeout]:')=1) THEN 1 ELSE 0 END FROM diagnostic;"

def transient_provider_stated(+db: String, +event: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- IO.try(String,DB.Sql.query(db,transient_provider_sql(event)))
    cause : String <- exhaustion_cause(db,event)
    IO.pure(Bool,Bool.and(String.eq(found,"1\n"),String.is_empty(cause)))

def transient_provider_present(db: String, event: String, empty: Bool) -> IO(Bool):
  match empty:
    case True{}: IO.pure(Bool,False{})
    case False{}: transient_provider_stated(db,event)

# A settled native transport failure or request-rate refusal that states no usage
# exhaustion, shared by coordinator receives and direct turns. The empty check runs
# before any JSON is read. Startup and no-terminal failures keep their recorded cause.
def transient_provider_error(db: String, +event: String) -> IO(Bool):
  transient_provider_present(db,event,String.is_empty(event))

def history_path(+db: String, session: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,history_record_sql(db,session)))
    IO.pure(String,Tx.trim_nl(saved))

def run_text(result: T.RunRes) -> String:
  match result:
    case T.RRun{T.SExit{code}, out}: out
    case T.RRun{T.SSignal{num}, out}: out
    case T.RSpawn{detail}: ""

def history_helper_of(identity: String & String) -> String:
  (registry,helper)=identity
  history_helper(helper)

# The packaged native history helper of the runtime this coordinator runs: the sibling of the
# identity helper the host resolves. The script is invoked as it is, so a runtime that does not
# install it fails this step with the helper's own cause and no history value is substituted
# for the answer it did not give.
def helper_script() -> IO(String):
  do IO<String>:
    +executable : String <- IO.try(String,Lock.SessionLock.executable())
    identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
    IO.pure(String,history_helper_of(identity))

def run_status(result: T.RunRes) -> String:
  match result:
    case T.RRun{T.SExit{code}, out}: "exit " ++ U32.show(code)
    case T.RRun{T.SSignal{num}, out}: "signal " ++ U32.show(num)
    case T.RSpawn{detail}: detail

def report_body(db: String, session: String, id: String, kind: String, body: String) -> IO(Unit):
  do IO<Unit>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":" ++ kind) ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(body) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
    IO.pure(Unit,Unit{})

# The verdict of the sidecar write, at the head of the definition so the caller's do block
# ends on a term. A failed write reports its cause and returns false, so no profile is
# advanced and the original input stays owed.
def history_appended(db: String, session: String, id: String, path: String, variable: String, appended: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match appended:
    case Done{unit}: IO.pure(Bool,True{})
    case Fail{error}: match error:
      case (code,detail): do IO<Bool>:
        noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":profile-history-failed") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q("subscription profile history home record failed at " ++ path ++ " for " ++ variable ++ ": " ++ U32.show(code) ++ ": " ++ detail ++ "; the provider cause stands and no profile was advanced.") ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
        IO.pure(Bool,False{})

def history_recorded(db: String, session: String, id: String, variable: String, +path: String, line: String) -> IO(Bool):
  do IO<Bool>:
    appended : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(path,Tx.trim_nl(line) ++ "\n")
    history_appended(db,session,id,path,variable,appended)

def history_answered_empty(db: String, session: String, id: String, variable: String, path: String, answer: String, empty: Bool) -> IO(Bool):
  match empty:
    case True{}: do IO<Bool>:
      noted : Unit <- report_body(db,session,id,"profile-history-failed","the native history helper answered without a provider history home; the provider cause stands and no profile was advanced; helper output: " ++ Tx.trim_nl(answer))
      IO.pure(Bool,False{})
    case False{}: history_recorded(db,session,id,variable,path,answer)

# A usable answer is recorded whole, so the sidecar keeps what the helper resolved.
def history_answered(+db: String, +session: String, +id: String, variable: String, path: String, answer: String, +home: String) -> IO(Bool):
  history_answered_empty(db,session,id,variable,path,answer,String.is_empty(home))

def history_helper_result(+db: String, +session: String, +id: String, harness: String, variable: String, from_store: String, path: String, run: T.RunRes) -> IO(Bool):
  match run:
    case T.RRun{T.SExit{0}, out}: do IO<Bool>:
      +answer : String <- IO.pure(String,last_line(Tx.split_lines(Tx.trim_nl(out))))
      home : String <- IO.try(String,DB.Sql.query(db,history_home_sql(answer)))
      history_answered(db,session,id,variable,path,answer,Tx.trim_nl(home))
    case +other: do IO<Bool>:
      noted : Unit <- report_body(db,session,id,"profile-history-failed","the native history helper did not prepare the preserved provider history; the provider cause stands and no profile was advanced; helper exit and output: " ++ Tx.trim_nl(run_status(other)) ++ " " ++ Tx.trim_nl(run_text(other)))
      IO.pure(Bool,False{})

# The helper's own answer is the sidecar line: it carries the provider history home, the
# source and selected stores, the native identity and the rollout and history paths, and the
# continuation reads its home from it. An answer that names no home is not a usable one.
def history_from_helper(db: String, session: String, id: String, +harness: String, variable: String, +from_store: String, path: String, profile: Profile, script: String, cmd: String, +cwd: String, native: String, existing: String) -> IO(Bool):
  do IO<Bool>:
    run : T.RunRes <- Proc.runFull(history_prepare_args(script,harness,cmd,cwd,native,from_store,profile_store(profile),existing),cwd)
    history_helper_result(db,session,id,harness,variable,from_store,path,run)

def prepare_history_variable(+db: String, +session: String, id: String, harness: String, from_store: String, cmd: String, cwd: String, native: String, profile: Profile, selected: Maybe<String>, previous: String) -> IO(Bool):
  match selected:
    case None{}: IO.pure(Bool,True{})
    case Some{variable}: do IO<Bool>:
      +path : String <- history_path(db,session)
      script : String <- helper_script()
      history_from_helper(db,session,id,harness,variable,from_store,path,profile,script,cmd,cwd,native,previous)

# The preserved history home for this handoff. The packaged native runtime helper reads the
# original account's effective provider history home and materializes what the next account
# needs, and its answer is recorded for the continuation to bind. A helper that fails
# reports its own cause and leaves the original input owed, so no profile is advanced.
# The previous native-history record is the sidecar's last line for this handoff's own
# harness. An empty source store means no previous store on this harness (a harness
# reset or a fresh session), so no previous record is passed either; old lines stay.
def prepare_history(+db: String, +session: String, +id: String, +harness: String, +from_store: String, +cmd: String, +cwd: String, +native: String, decided: Maybe<&2,Profile>) -> IO(Bool):
  match decided:
    case None{}: IO.pure(Bool,True{})
    case Some{profile}: do IO<Bool>:
      +path : String <- history_path(db,session)
      recorded : String <- file_text(path)
      previous : String <- IO.pure(String,Bool.pick(String,String.is_empty(from_store),"",last_line(Tx.split_lines(recorded))))
      prepare_history_variable(db,session,id,harness,from_store,cmd,cwd,native,profile,store_variable(harness),previous)

# Each account advance records its provider cause under a separate report ID.
def record_handoff(db: String, session: String, id: String, harness: String, from_label: String, +profile: Profile, cause: String) -> IO(Bool):
  do IO<Bool>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":profile-handoff-" ++ profile_label(profile)) ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(handoff_body(harness,from_label,profile_label(profile),profile_store(profile),cause)) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
    IO.pure(Bool,True{})

def record_append_failure(db: String, session: String, id: String, record_path: String, detail: String) -> IO(Bool):
  do IO<Bool>:
    noted : Unit <- report_body(db,session,id,"profile-append-failed","subscription profile record append failed at " ++ record_path ++ ": " ++ detail ++ "; the provider cause stands and no profile was advanced.")
    IO.pure(Bool,False{})

def record_append_observed(db: String, session: String, id: String, record_path: String, harness: String, from_label: String, profile: Profile, cause: String, appended: Result<&1,&1,U32 & String,Unit>) -> IO(Bool):
  match appended:
    case Done{unit}: record_handoff(db,session,id,harness,from_label,profile,cause)
    case Fail{(code,detail)}: record_append_failure(db,session,id,record_path,U32.show(code) ++ ": " ++ detail)

# The append is observed: the advance proceeds only on success. A failed append reports
# the IO failure against this attempt and returns false, so no continuation runs and the
# attempt's own outcome, cause and owed input stay exactly as the failure path leaves them.
def record_and_report(+db: String, +session: String, +id: String, +record_path: String, harness: String, from_label: String, +profile: Profile, cause: String) -> IO(Bool):
  do IO<Bool>:
    appended : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(record_path,record_line(profile) ++ "\n")
    record_append_observed(db,session,id,record_path,harness,from_label,profile,cause,appended)

def report_all_refused(db: String, session: String, id: String, harness: String, from_label: String, cause: String) -> IO(Bool):
  do IO<Bool>:
    noted : String <- IO.try(String,DB.Sql.query(db,"INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT " ++ C.q(id ++ ":profile-exhausted") ++ ",id," ++ C.report_recipient("sessions.id") ++ ",'report'," ++ C.q(all_refused_body(harness,from_label,cause)) ++ " FROM sessions WHERE id=" ++ C.q(session) ++ " AND " ++ C.report_recipient("sessions.id") ++ " IS NOT NULL;"))
    IO.pure(Bool,False{})

def choose_profile(db: String, session: String, id: String, record_path: String, harness: String, from_label: String, cause: String, decided: Maybe<&2,Profile>) -> IO(Bool):
  match decided:
    case Some{+profile}: record_and_report(db,session,id,record_path,harness,from_label,profile,cause)
    case None{}: report_all_refused(db,session,id,harness,from_label,cause)

def advance_profile(+db: String, +session: String, +id: String, cause: String, native: String, cmd: String, cwd: String) -> IO(Bool):
  do IO<Bool>:
    +harness : String <- IO.try(String,DB.Sql.query(db,"SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    list_path : String <- profile_list_path(db)
    listed : String <- file_text(list_path)
    +profiles : List<&2,Profile> <- IO.pure(List<&2,Profile>,profile_lines(Tx.split_lines(listed)))
    +record_path : String <- profile_record_path(db,session)
    +current : String <- file_text(record_path)
    +last_record : String <- IO.pure(String,last_line(Tx.split_lines(current)))
    +from_label : String <- IO.pure(String,record_current(Tx.trim_nl(harness),last_record))
    from_store : String <- IO.pure(String,record_source(Tx.trim_nl(harness),last_record))
    prepared : Bool <- prepare_history(db,session,id,Tx.trim_nl(harness),from_store,cmd,cwd,native,started_or_next(profiles,Tx.trim_nl(harness),from_label))
    taken : Bool <- Bool.pick(IO(Bool),prepared,choose_profile(db,session,id,record_path,Tx.trim_nl(harness),from_label,cause,started_or_next(profiles,Tx.trim_nl(harness),from_label)),IO.pure(Bool,False{}))
    IO.pure(Bool,taken)

# True only when a next operator-listed profile was recorded, so the caller continues the
# same actor; false when the list is exhausted, which terminates with the report. The
# caller passes the terminal event text: the Outcome shutter stays in the calling
# module, so this shared worker takes no provider-harness type.
def profile_handoff(+db: String, session: String, id: String, +event: String, native: String, cmd: String, cwd: String) -> IO(Bool):
  do IO<Bool>:
    +cause : String <- exhaustion_cause(db,event)
    advanced : Bool <- Bool.pick(IO(Bool),String.is_empty(cause),IO.pure(Bool,False{}),advance_profile(db,session,id,cause,native,cmd,cwd))
    IO.pure(Bool,advanced)

# --- cross-harness route fallback --------------------------------------------
#
# When every operator-listed account for the session's harness refuses, the same actor
# continues on another operator-permitted harness/model route. The operator list is an
# ordered plain file beside the database; its order is the preference, and absence of
# a recorded refusal proves no present availability, so the choice is the first untried
# entry in operator order, never an availability claim. Refusal lineage is a
# per-session append-only file of refused pairs beside the database: the incident scope
# is this session's own records, so history from other sessions never blocks, and no
# availability store, catalog, TTL, or score exists anywhere. A model id naming Opus
# runs only on the subscription-backed claude-code harness. Chosen/unavailable reports
# and the guarded route application belong to the applying seam; this core only selects
# and records the refusal fact.

type Route is Data:
  Rt{harness: String, model: String, cmd: String}

def route_harness(route: Route) -> String:
  match route:
    case Rt{harness,model,cmd}: harness

def route_model(route: Route) -> String:
  match route:
    case Rt{harness,model,cmd}: model

def route_cmd(route: Route) -> String:
  match route:
    case Rt{harness,model,cmd}: cmd

def route_line(+route: Route) -> String:
  route_harness(route) ++ " " ++ route_model(route) ++ " " ++ route_cmd(route)

# One three-field line: the harness command is the rest of the line, so a command
# path with spaces survives; model ids carry no spaces. A two-field line parses with
# an empty command for refusal-lineage pairs, which name no executable. A line with
# an empty harness or model is skipped rather than guessed at.
def route_fields(+harness: String, +model: String, +cmd: String) -> Maybe<&2,Route>:
  Bool.pick(Maybe<&2,Route>,Bool.and(Bool.not(String.is_empty(harness)),Bool.not(String.is_empty(model))),Some{Rt{harness,model,cmd}},None{})

def route_of(fields: List<String>) -> Maybe<&2,Route>:
  match fields:
    case harness <> model <> cmd <> rest: route_fields(harness,model,Tx.join(" ",Con{cmd,rest}))
    case harness <> model <> Nil{}: route_fields(harness,model,"")
    case other: None{}

def route_entry(parsed: Maybe<&2,Route>, tail: List<&2,Route>) -> List<&2,Route>:
  match parsed:
    case Some{route}: Con{route,tail}
    case None{}: tail

def route_lines(lines: List<String>) -> List<&2,Route>:
  match lines:
    case Nil{}: Nil{}
    case line <> rest: route_entry(route_of(split_parts(String.split(Tx.trim_nl(line),Char.from_u32(32)))),route_lines(rest))

# Fold one ASCII uppercase letter to lowercase; every other code passes through.
def fold_upper(+code: U32) -> U32:
  Bool.pick(U32,Bool.and(Bool.not(U32.is_lt(code,65)),Bool.not(U32.is_lt(90,code))),U32.add(code,32),code)

def fold_eq(first: Char, second: Char) -> Bool:
  U32.is_eq(fold_upper(Char.to_u32(first)),fold_upper(Char.to_u32(second)))

# Each level matches its own head, so no match follows a bind and no arm rebuilds a
# string; definitions precede their first caller throughout the chain.
def starts_us(oc: Char, pc: Char, uc: Char, ur: String) -> Bool:
  match ur:
    case SNil{}: False{}
    case SCon{sc, sr}: Bool.and(Bool.and(fold_eq(oc,Char.from_u32(111)),fold_eq(pc,Char.from_u32(112))),Bool.and(fold_eq(uc,Char.from_u32(117)),fold_eq(sc,Char.from_u32(115))))

def starts_pus(pc: Char, pr: String, oc: Char) -> Bool:
  match pr:
    case SNil{}: False{}
    case SCon{uc, ur}: starts_us(oc,pc,uc,ur)

def starts_opus(+tc: Char, tr: String) -> Bool:
  match tr:
    case SNil{}: False{}
    case SCon{pc, pr}: Bool.pick(Bool,fold_eq(tc,Char.from_u32(111)),starts_pus(pc,pr,tc),False{})

# True when the model id names an Opus model anywhere in its text, matched
# case-insensitively: provider/model ids vary in prefix but keep the family name.
def names_opus(text: String) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{tc, +tr}: Bool.pick(Bool,starts_opus(tc,tr),True{},names_opus(tr))

# An Opus model runs only on the subscription-backed claude-code harness; every
# other listed model runs on any listed harness.
def route_permitted(+route: Route) -> Bool:
  Bool.or(Bool.not(names_opus(route_model(route))),String.eq(route_harness(route),"claude-code"))

def route_same(+first: Route, +second: Route) -> Bool:
  Bool.and(String.eq(route_harness(first),route_harness(second)),String.eq(route_model(first),route_model(second)))

def route_current(harness: String, model: String, +route: Route) -> Bool:
  Bool.and(String.eq(route_harness(route),harness),String.eq(route_model(route),model))

def route_member(refused: List<&2,Route>, +route: Route) -> Bool:
  match refused:
    case Nil{}: False{}
    case head <> rest: Bool.pick(Bool,route_same(head,route),True{},route_member(rest,route))

# A list entry without a named harness command cannot build a native binding, so
# selection skips it; refusal-lineage pairs carry no command by construction.
def route_runnable(+route: Route) -> Bool:
  Bool.not(String.is_empty(route_cmd(route)))

# Viable means untried in this incident, permitted, and runnable: not the just-refused
# current pair, not in the refusal lineage, no Opus model off the subscription harness,
# and a named harness command for the native binding. Operator order decides among
# viable entries; nothing here claims availability.
def route_viable(refused: List<&2,Route>, harness: String, model: String, +route: Route) -> Bool:
  Bool.and(Bool.not(route_current(harness,model,route)),Bool.and(Bool.not(route_member(refused,route)),Bool.and(route_permitted(route),route_runnable(route))))

def choose_route(routes: List<&2,Route>, +refused: List<&2,Route>, +harness: String, +model: String) -> Maybe<&2,Route>:
  match routes:
    case Nil{}: None{}
    case +route <> +rest: Bool.pick(Maybe<&2,Route>,route_viable(refused,harness,model,route),Some{route},choose_route(rest,refused,harness,model))

# A stored refusal carries its episode marker and task assignment: the latest turns
# rowid and the latest message seq when it was recorded. A refusal counts only while
# no later terminal on the session states a non-exhausted outcome and no later task
# assignment reached the session, so any later success, other failure or new task
# ends the exhaustion episode and a restored route returns without reusing stale
# history. Old lines stay in the file; only the read filters them. A line without
# markers is legacy and counts only on a session with neither marker since.
type Refusal is Data:
  Ref{route: Route, epoch: String, assignment: String}

def refusal_route(refusal: Refusal) -> Route:
  match refusal:
    case Ref{route,epoch,assignment}: route

def refusal_epoch(refusal: Refusal) -> String:
  match refusal:
    case Ref{route,epoch,assignment}: epoch

def refusal_assignment(refusal: Refusal) -> String:
  match refusal:
    case Ref{route,epoch,assignment}: assignment

def digit_code(+code: U32) -> Bool:
  Bool.and(Bool.not(U32.is_lt(code,48)),Bool.not(U32.is_lt(57,code)))

def epoch_tail(+text: String) -> Bool:
  match text:
    case SNil{}: True{}
    case SCon{head, tail}: Bool.and(digit_code(Char.to_u32(head)),epoch_tail(tail))

def epoch_digits(+text: String) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{head, tail}: Bool.and(digit_code(Char.to_u32(head)),epoch_tail(tail))

# A marked line names its episode marker and task assignment before the pair; any
# other shape is a legacy pair with marker 0 and no assignment. Pair heads are
# harness names, never digits, so a digit head is always a marker. A new task
# assignment after the write ends the episode even with no intervening terminal, so
# old refusals never exclude a recovered route from a new task.
def refusal_wrap(+epoch: String, +assignment: String, parsed: Maybe<&2,Route>) -> Maybe<&2,Refusal>:
  match parsed:
    case Some{+route}: Some{Ref{route,epoch,assignment}}
    case None{}: None{}

def refusal_fields(fields: List<String>) -> Maybe<&2,Refusal>:
  match fields:
    case +epoch <> +second <> +rest: Bool.pick(Maybe<&2,Refusal>,Bool.and(epoch_digits(epoch),epoch_digits(second)),refusal_wrap(epoch,second,route_of(rest)),refusal_wrap("0","0",route_of(Con{epoch,Con{second,rest}})))
    case +single <> Nil{}: refusal_wrap("0","0",route_of(Con{single,Nil{}}))
    case Nil{}: None{}

def refusal_of(line: String) -> Maybe<&2,Refusal>:
  refusal_fields(split_parts(String.split(Tx.trim_nl(line),Char.from_u32(32))))

def refusal_line(parsed: Maybe<&2,Refusal>, tail: List<&2,Refusal>) -> List<&2,Refusal>:
  match parsed:
    case Some{refusal}: Con{refusal,tail}
    case None{}: tail

def refusal_lines(lines: List<String>) -> List<&2,Refusal>:
  match lines:
    case Nil{}: Nil{}
    case line <> rest: refusal_line(refusal_of(line),refusal_lines(rest))

def exhausted_frame_sql(+event: String) -> String:
  "CASE WHEN " ++ failed_terminal_sql_expr(event) ++ "=1 AND " ++ exhausted_marker_sql(usage_text_sql_expr(event)) ++ "=1 THEN 1 ELSE 0 END"

# A new task assignment to the session ends the refusal episode even with no
# intervening terminal: only task and task-assignment messages count, so guidance,
# recovery and report traffic never resets it. The assignment kinds are the same
# ones the wake logic treats as task input.
def refusal_assigned(db: String, session: String, +assignment: String) -> IO(Bool):
  do IO<Bool>:
    newer : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE recipient=" ++ C.q(session) ++ " AND ((sender<>recipient AND kind='task') OR kind='task-assignment') AND seq>" ++ assignment ++ ");"))
    IO.pure(Bool,String.eq(newer,"0\n"))

# Whether any refusal row at this epoch is still current: a later
# non-exhausted terminal clears resolved rows.
def refusal_current(db: String, session: String, +epoch: String) -> IO(Bool):
  do IO<Bool>:
    kept : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN EXISTS(SELECT 1 FROM turns t WHERE t.worker=" ++ C.q(session) ++ " AND t.rowid>" ++ epoch ++ " AND " ++ C.terminal_expr("t.event") ++ " AND " ++ exhausted_frame_sql("t.event") ++ "=0) THEN '0' ELSE '1' END;"))
    IO.pure(Bool,String.eq(Tx.trim_nl(kept),"1"))
def current_refusals(+db: String, +session: String, refusals: List<&2,Refusal>) -> IO(List<&2,Route>):
  match refusals:
    case Nil{}: IO.pure(List<&2,Route>,Nil{})
    case +head <> +rest: do IO<List<&2,Route>>:
      +tail : List<&2,Route> <- current_refusals(db,session,rest)
      epoch_kept : Bool <- refusal_current(db,session,refusal_epoch(head))
      task_kept : Bool <- refusal_assigned(db,session,refusal_assignment(head))
      IO.pure(List<&2,Route>,Bool.pick(List<&2,Route>,Bool.and(epoch_kept,task_kept),Con{refusal_route(head),tail},tail))

# The operator route list and the per-session refusal lineage are plain files beside
# the database, like the profile sidecars: no schema, no daemon, no environment lookup.
def route_list_sql(+db: String) -> String:
  "SELECT " ++ C.q(db ++ ".routes") ++ ";"

def route_refused_sql(+db: String, +session: String) -> String:
  "SELECT " ++ C.q(db ++ ".route-") ++ " || lower(hex(id)) FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def route_list_path(+db: String) -> IO(String):
  do IO<String>:
    listed : String <- IO.try(String,DB.Sql.query(db,route_list_sql(db)))
    IO.pure(String,Tx.trim_nl(listed))

def route_refused_path(+db: String, +session: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,route_refused_sql(db,session)))
    IO.pure(String,Tx.trim_nl(saved))

def session_route_sql(+db: String, +session: String) -> String:
  "SELECT harness FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def session_model_sql(+db: String, +session: String) -> String:
  "SELECT model FROM sessions WHERE id=" ++ C.q(session) ++ ";"

def select_recorded(db: String, session: String, id: String, refused_path: String, chosen: Maybe<&2,Route>, recorded: Result<&1,&1,U32 & String,Unit>) -> IO(Maybe<&2,Route>):
  match recorded:
    case Done{unit}: IO.pure(Maybe<&2,Route>,chosen)
    case Fail{(code,detail)}: do IO<Maybe<&2,Route>>:
      noted : Unit <- report_body(db,session,id,"route-record-failed","Route refusal lineage append failed at " ++ refused_path ++ ": " ++ U32.show(code) ++ ": " ++ detail ++ "; no route was selected.")
      IO.pure(Maybe<&2,Route>,None{})

# Select the first viable route in operator order and record the just-refused current
# pair beside it, so a later hop skips exactly the pairs this session refused. Only
# refusals from the current exhaustion episode count: a later non-exhausted terminal
# opens a new episode and old lines go inert. A missing list or lineage file reads as
# empty, so no route is selected without configuration. Reports and the guarded route
# application belong to the applying seam.
def select_route(+db: String, +session: String, id: String) -> IO(Maybe<&2,Route>):
  do IO<Maybe<&2,Route>>:
    list_path : String <- route_list_path(db)
    listed : String <- file_text(list_path)
    routes : List<&2,Route> <- IO.pure(List<&2,Route>,route_lines(Tx.split_lines(listed)))
    +refused_path : String <- route_refused_path(db,session)
    refused_text : String <- file_text(refused_path)
    refusals : List<&2,Refusal> <- IO.pure(List<&2,Refusal>,refusal_lines(Tx.split_lines(refused_text)))
    refused : List<&2,Route> <- current_refusals(db,session,refusals)
    +harness : String <- IO.try(String,DB.Sql.query(db,session_route_sql(db,session)))
    +model : String <- IO.try(String,DB.Sql.query(db,session_model_sql(db,session)))
    chosen : Maybe<&2,Route> <- IO.pure(Maybe<&2,Route>,choose_route(routes,refused,Tx.trim_nl(harness),Tx.trim_nl(model)))
    marker : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(max(rowid),0) FROM turns WHERE worker=" ++ C.q(session) ++ ";"))
    assignment : String <- IO.try(String,DB.Sql.query(db,"SELECT coalesce(max(seq),0) FROM messages WHERE recipient=" ++ C.q(session) ++ ";"))
    recorded : Result<&1,&1,U32 & String,Unit> <- Text.Text.append(refused_path,Tx.trim_nl(marker) ++ " " ++ Tx.trim_nl(assignment) ++ " " ++ Tx.trim_nl(harness) ++ " " ++ Tx.trim_nl(model) ++ "\n")
    select_recorded(db,session,id,refused_path,chosen,recorded)

# True only on the actual all-accounts-refused outcome: the terminal states
# provider-reported usage exhaustion and this attempt recorded the exhausted report.
# History and lineage append IO failures write different reports, so they return false
# here and never cause a cross-route switch.
def exhausted_reported(db: String, id: String) -> IO(Bool):
  do IO<Bool>:
    found : String <- IO.try(String,DB.Sql.query(db,"SELECT EXISTS(SELECT 1 FROM messages WHERE id=" ++ C.q(id ++ ":profile-exhausted") ++ ");"))
    IO.pure(Bool,String.eq(found,"1\n"))

def route_trigger(+db: String, id: String, +event: String) -> IO(Bool):
  do IO<Bool>:
    +cause : String <- exhaustion_cause(db,event)
    reported : Bool <- Bool.pick(IO(Bool),String.is_empty(cause),IO.pure(Bool,False{}),exhausted_reported(db,id))
    IO.pure(Bool,reported)

# The applying seam reports the chosen route with the original provider cause, or the
# lack of any route with actionable recovery: the task stays retained with its owed
# input, so resuming the session or configuring a route continues it.
def route_chosen_body(harness: String, model: String, cmd: String, cause: String) -> String:
  "cross-harness route selected: harness=" ++ harness ++ "; model=" ++ model ++ "; command=" ++ cmd ++ "; original cause: " ++ cause

def route_unavailable_body(harness: String, cause: String) -> String:
  "cross-harness routes unavailable: harness=" ++ harness ++ " refused every operator-listed route after all its accounts reported usage exhaustion; original cause: " ++ cause ++ "; the task stays retained with its owed input; resume the session or configure a route to continue."

def report_route_chosen(db: String, session: String, id: String, +route: Route, cause: String) -> IO(Unit):
  report_body(db,session,id,"route-chosen",route_chosen_body(route_harness(route),route_model(route),route_cmd(route),cause))

def report_route_unavailable(db: String, session: String, id: String, harness: String, cause: String) -> IO(Unit):
  report_body(db,session,id,"route-unavailable",route_unavailable_body(harness,cause))

# A cross-harness route change drops only the incompatible native binding; the same
# harness keeps its conversation. Old attempt, event, request and history rows stay.
def clear_when(clear: Bool, +db: String, +session: String) -> IO(Unit):
  match clear:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      cleared : String <- IO.try(String,DB.Sql.query(db,"UPDATE sessions SET native='' WHERE id=" ++ C.q(session) ++ ";"))
      IO.pure(Unit,Unit{})

def clear_incompatible_native(db: String, session: String, old_harness: String, new_harness: String) -> IO(Unit):
  clear_when(String.eq(old_harness,new_harness),db,session)
