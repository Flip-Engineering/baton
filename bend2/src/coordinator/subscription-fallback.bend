# Subscription profiles bind each account's credential directory into its launch
# environment. DATABASE.profiles lists "<harness> <label> <store>" in fallback
# order. The store is the rest of the line. Each session records selections in a
# separate file beside the database.
import Base
import ../coordinator/commands.bend as C
import ../json/canonical.bend as J
import ../git/text.bend as Tx

type Profile is Data:
  Pr{harness: String, label: String, store: String}

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
def profile_fields(+harness: String, +label: String, +store: String) -> Maybe<Profile>:
  Bool.pick(Maybe<Profile>,Bool.and(Bool.not(String.is_empty(harness)),Bool.and(Bool.not(String.is_empty(label)),Bool.not(String.is_empty(store)))),Some{Pr{harness,label,store}},None{})

def profile_of(fields: List<String>) -> Maybe<Profile>:
  match fields:
    case harness <> label <> rest: profile_fields(harness,label,Tx.join(" ",rest))
    case other: None{}

# The walk is one recursive function and the parse beside it is nonrecursive.
def profile_lines(lines: List<String>) -> List<Profile>:
  match lines:
    case Nil{}: Nil{}
    case line <> rest: profile_line(profile_of(split_parts(String.split(Tx.trim_nl(line),Char.from_u32(32)))),rest)

def profile_line(parsed: Maybe<Profile>, rest: List<String>) -> List<Profile>:
  match parsed:
    case Some{profile}: Con{profile,profile_lines(rest)}
    case None{}: profile_lines(rest)

def profiles_for(profiles: List<Profile>, +harness: String) -> List<Profile>:
  match profiles:
    case Nil{}: Nil{}
    case +profile <> +rest: Bool.pick(List<Profile>,String.eq(profile.harness,harness),Con{profile,profiles_for(rest,harness)},profiles_for(rest,harness))

def first_profile(profiles: List<Profile>, harness: String) -> Maybe<Profile>:
  first_selected(profiles_for(profiles,harness))

def first_selected(profiles: List<Profile>) -> Maybe<Profile>:
  match profiles:
    case Nil{}: None{}
    case +profile <> rest: Some{profile}

# The credential-store variable each harness reads. A harness without one gets no
# binding, so an unknown harness adds nothing to the spawn environment.
def store_variable(+harness: String) -> Maybe<String>:
  Bool.pick(Maybe<String>,String.eq(harness,"codex"),Some{"CODEX_HOME"},Bool.pick(Maybe<String>,Bool.or(String.eq(harness,"claude-code"),String.eq(harness,"claude")),Some{"CLAUDE_CONFIG_DIR"},None{}))

# One element per binding. The host encodes each argv element separately, so a store
# path with spaces stays a single argument and needs no shell quoting.
def store_binding(harness: String, store: String) -> List<String>:
  binding_for(store_variable(harness),store)

def binding_for(variable: Maybe<String>, store: String) -> List<String>:
  match variable:
    case None{}: Nil{}
    case Some{variable}: Con{variable ++ "=" ++ store, Nil{}}

# The profile after the one that refused, in operator order, or none when the
# operator listed no further profile for that harness. Order is the file's own order;
# no history and no observation reorders or suppresses a listed profile.
def next_after(profiles: List<Profile>, +harness: String, +current: String, seen: Bool) -> Maybe<Profile>:
  match profiles:
    case Nil{}: None{}
    case +profile <> +rest:
      match seen:
        case True{}: Bool.pick(Maybe<Profile>,String.eq(profile.harness,harness),Some{profile},next_after(rest,harness,current,True{}))
        case False{}: Bool.pick(Maybe<Profile>,Bool.and(String.eq(profile.harness,harness),String.eq(profile.label,current)),next_after(rest,harness,current,True{}),next_after(rest,harness,current,False{}))

def next_profile(profiles: List<Profile>, harness: String, current: String) -> Maybe<Profile>:
  next_after(profiles,harness,current,False{})

# A handoff with no profile record yet selects the head of the operator's list.
def started_or_next(+profiles: List<Profile>, +harness: String, +current: String) -> Maybe<Profile>:
  Bool.pick(Maybe<Profile>,String.is_empty(current),first_profile(profiles,harness),next_profile(profiles,harness,current))

# The per-session record is append-only: the last non-empty line is the profile in
# use, so advancing it needs no rewrite and no lock. Its fields are the label and the
# rest of the line as the store.
def record_of(line: String) -> Maybe<Profile>:
  record_parts(split_parts(String.split(Tx.trim_nl(line),Char.from_u32(32))))

def record_parts(fields: List<String>) -> Maybe<Profile>:
  match fields:
    case label <> rest: record_fields(label,Tx.join(" ",rest))
    case other: None{}

def record_fields(+label: String, +store: String) -> Maybe<Profile>:
  Bool.pick(Maybe<Profile>,Bool.and(Bool.not(String.is_empty(label)),Bool.not(String.is_empty(store))),Some{Pr{"",label,store}},None{})

def last_line(lines: List<String>) -> String:
  match lines:
    case Nil{}: ""
    case +line <> rest:
      +last = last_line(rest)
      Bool.pick(String,String.is_empty(last),Tx.trim_nl(line),last)

def record_label(line: String) -> String:
  label_of(record_of(line))

def label_of(parsed: Maybe<Profile>) -> String:
  match parsed:
    case Some{+profile}: profile.label
    case None{}: ""

def record_store(line: String) -> String:
  store_of(record_of(line))

def store_of(parsed: Maybe<Profile>) -> String:
  match parsed:
    case Some{+profile}: profile.store
    case None{}: ""

def record_line(+profile: Profile) -> String:
  profile.label ++ " " ++ profile.store

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
def usage_text_sql(+event: String) -> String:
  "CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='agent_end' THEN coalesce(json_extract((SELECT " ++ C.last_assistant_sql(event) ++ "),'$.errorMessage'),'') WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='turn.failed' THEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.error.message'),'') WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='result' THEN coalesce(json_extract(" ++ C.q(event) ++ ",'$.result'),'') || ' ' || coalesce((SELECT group_concat(value,' ') FROM json_each(CASE WHEN json_type(" ++ C.q(event) ++ ",'$.errors')='array' THEN json_extract(" ++ C.q(event) ++ ",'$.errors') ELSE '[]' END)),'') ELSE '' END"

# A genuinely failed provider terminal only:
#   Codex  {"type":"turn.failed","error":{"message":"..."}}
#   Claude {"type":"result","is_error":true,...}          (a successful result that merely
#                                                          quotes limit words is never one)
#   OMP    {"type":"agent_end", ... {"stopReason":"error","errorMessage":"..."}}
def failed_terminal_sql(+event: String) -> String:
  "CASE WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='turn.failed' THEN 1 WHEN json_extract(" ++ C.q(event) ++ ",'$.type')='result' AND json_extract(" ++ C.q(event) ++ ",'$.is_error')=1 THEN 1 WHEN " ++ C.omp_terminal_error_sql(event) ++ "=1 THEN 1 ELSE 0 END"

# The provider's own subscription-limit wordings. Codex (protocol src/error.rs Display):
# "You’ve hit your usage limit[ for {limit_name}]", "Your workspace is out of credits.",
# "You hit your spend cap ..." and "Quota exceeded. Check your plan and billing details.".
# Claude (error reference): "You've hit your <session|weekly|Opus|Sonnet> limit",
# "spend limit reached" and "spend limit unavailable". An observed OMP-fronted
# subscription diagnostic reports the window instead: "You've reached your 5-hour usage
# limit. Your quota will reset when the current 5-hour window ends.", which the
# "reached your" fragment below covers. The "hit your" fragment omits the apostrophe so
# the curly and ASCII forms both match. Not matched: the upstream "limit reached" header
# flag, "rate limit exceeded", the context-window message, stream disconnection and
# timeouts.
def exhausted_marker_sql(+event: String) -> String:
  "CASE WHEN (instr(lower(" ++ usage_text_sql(event) ++ "),'hit your')>0 AND (instr(lower(" ++ usage_text_sql(event) ++ "),'limit')>0 OR instr(lower(" ++ usage_text_sql(event) ++ "),'budget')>0)) OR (instr(lower(" ++ usage_text_sql(event) ++ "),'reached your')>0 AND (instr(lower(" ++ usage_text_sql(event) ++ "),'limit')>0 OR instr(lower(" ++ usage_text_sql(event) ++ "),'quota')>0)) OR instr(lower(" ++ usage_text_sql(event) ++ "),'out of credits')>0 OR instr(lower(" ++ usage_text_sql(event) ++ "),'spend cap')>0 OR instr(lower(" ++ usage_text_sql(event) ++ "),'quota exceeded')>0 OR instr(lower(" ++ usage_text_sql(event) ++ "),'spend limit reached')>0 OR instr(lower(" ++ usage_text_sql(event) ++ "),'spend limit unavailable')>0 THEN 1 ELSE 0 END"

def exhausted_sql(+event: String) -> String:
  "CASE WHEN " ++ failed_terminal_sql(event) ++ "=1 AND " ++ exhausted_marker_sql(event) ++ "=1 THEN 1 ELSE 0 END"

def exhausted_reason_sql(+event: String) -> String:
  "CASE WHEN " ++ exhausted_sql(event) ++ "=1 THEN 'provider-reported usage exhaustion: ' || " ++ usage_text_sql(event) ++ " END"

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
