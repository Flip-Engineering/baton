import Base
import ./commands.bend as C
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../host/files.bend as F
import ../git/text.bend as Tx
import ../json/canonical.bend as J

# Baton2-owned log policy, rotation, storage inspection and cleanup.
#
# A native harness writes one JSON frame per line to the public log named by the
# caller. Level `default` keeps every frame except the cumulative snapshot
# frames the provider resends while a message or a tool call is still running:
# the OMP `message_update` delta and `tool_execution_update` partial result. The
# completed message and the final tool result arrive in their own frames, so the
# default keeps the identifiers, the terminal frames and the report evidence
# while removing the repeated serialization.
#
# Level `diagnostic` keeps every frame verbatim for targeted debugging. Level
# `quiet` keeps terminal frames alone for long unattended runs. A frame whose
# type this classification does not name is kept at every level, so an unknown
# provider event is never lost to a policy.
#
# Rotation keeps each public log under the session's byte budget. At the budget
# the live log takes the first numbered segment, the numbered segments shift
# upward, and the segment above the session's retention count is removed; the
# new live log opens with a note naming the policy that produced it.
#
# The retained native conversation store, the retained attempt directory, the
# SQLite records and every harness history outside this registry are separate
# owners. Rotation and cleanup write only the files the registry names.

def default_level() -> String:
  "default"

# 32 MiB. A measured OMP seat wrote 47 KB per retained frame and one live seat
# reached 773 MB in one log; this budget keeps the recent frames of the current
# turn and the terminal frames that carry the report.
def default_budget() -> String:
  "33554432"

def default_segments() -> String:
  "2"

def schema() -> String:
  "CREATE TABLE IF NOT EXISTS log_policies (session TEXT PRIMARY KEY NOT NULL,level TEXT NOT NULL CHECK(level IN ('quiet','default','diagnostic')),budget_bytes INTEGER NOT NULL CHECK(budget_bytes BETWEEN 65536 AND 4294967295),keep_segments INTEGER NOT NULL CHECK(keep_segments BETWEEN 1 AND 4));"
  ++ "CREATE TABLE IF NOT EXISTS log_files (session TEXT NOT NULL,log TEXT NOT NULL,PRIMARY KEY(session,log));"

type Policy is Data:
  Policy{level: String, budget: U32, segments: U32, pending: Bool}

def fallback_level(+value: String) -> String:
  Bool.pick(String,String.is_empty(value),default_level(),value)

def fallback_number(+value: String, fallback: String) -> String:
  Bool.pick(String,String.is_empty(value),fallback,value)

def number_of(value: Maybe<&2,U32>, fallback: U32) -> U32:
  match value:
    case None{}: fallback
    case Some{found}: found

def policy_fields(fields: List<String>) -> Policy:
  match fields:
    case level <> budget <> segments <> pending <> rest:
      Policy{fallback_level(level),number_of(U32.read(fallback_number(budget,default_budget())),33554432),number_of(U32.read(fallback_number(segments,default_segments())),2),Bool.not(String.eq(pending,"0"))}
    case other: Policy{default_level(),33554432,2,True{}}

def policy_row(row: String) -> Policy:
  policy_fields(Tx.split_tabs(row))

def policy_sql(+session: String) -> String:
  "SELECT coalesce((SELECT level FROM log_policies WHERE session=" ++ C.q(session) ++ "),''),coalesce((SELECT budget_bytes FROM log_policies WHERE session=" ++ C.q(session) ++ "),''),coalesce((SELECT keep_segments FROM log_policies WHERE session=" ++ C.q(session) ++ "),''),(SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL);"

# The effective policy: a session without a stored row runs the defaults.
def policy(db: String, session: String) -> IO(Policy):
  do IO<Policy>:
    row : String <- IO.try(String,DB.Sql.query(db,schema() ++ policy_sql(session)))
    IO.pure(Policy,policy_row(Tx.trim_nl(row)))

def known(+session: String) -> String:
  "EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ")"

def level_admitted(+level: String) -> String:
  "coalesce(nullif(" ++ C.q(level) ++ ",'')," ++ C.q(default_level()) ++ ") IN ('quiet','default','diagnostic')"

def budget_admitted(+budget: String) -> String:
  "(nullif(" ++ C.q(budget) ++ ",'') IS NULL OR (" ++ C.q(budget) ++ " NOT GLOB '*[^0-9]*' AND CAST(" ++ C.q(budget) ++ " AS INTEGER) BETWEEN 65536 AND 4294967295))"

def segments_admitted(+segments: String) -> String:
  "(nullif(" ++ C.q(segments) ++ ",'') IS NULL OR (" ++ C.q(segments) ++ " NOT GLOB '*[^0-9]*' AND CAST(" ++ C.q(segments) ++ " AS INTEGER) BETWEEN 1 AND 4))"

def admitted(level: String, budget: String, segments: String) -> String:
  "(" ++ level_admitted(level) ++ " AND " ++ budget_admitted(budget) ++ " AND " ++ segments_admitted(segments) ++ ")"

def read_sql(+session: String) -> String:
  "SELECT json_object('session'," ++ C.q(session) ++ ",'level',coalesce((SELECT level FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ C.q(default_level()) ++ "),'budgetBytes',coalesce((SELECT budget_bytes FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ default_budget() ++ "),'keepSegments',coalesce((SELECT keep_segments FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ default_segments() ++ "),'registeredLogs',(SELECT count(*) FROM log_files WHERE session=" ++ C.q(session) ++ ")) WHERE " ++ known(session) ++ ";"

def read(db: String, session: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,schema() ++ read_sql(session)))
    IO.pure(String,Tx.trim_nl(saved))

# An omitted budget or retention count keeps the stored value, or the default
# when the session has no row yet.
def write_sql(+session: String, +level: String, +budget: String, +segments: String) -> String:
  "INSERT INTO log_policies(session,level,budget_bytes,keep_segments) SELECT " ++ C.q(session)
  ++ ",coalesce(nullif(" ++ C.q(level) ++ ",''),(SELECT level FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ C.q(default_level()) ++ ")"
  ++ ",CAST(coalesce(nullif(" ++ C.q(budget) ++ ",''),(SELECT budget_bytes FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ default_budget() ++ ") AS INTEGER)"
  ++ ",CAST(coalesce(nullif(" ++ C.q(segments) ++ ",''),(SELECT keep_segments FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ default_segments() ++ ") AS INTEGER)"
  ++ " WHERE " ++ known(session) ++ " AND " ++ admitted(level,budget,segments)
  ++ " ON CONFLICT(session) DO UPDATE SET level=excluded.level,budget_bytes=excluded.budget_bytes,keep_segments=excluded.keep_segments;"
  ++ "SELECT json_object('error','unknown-session','session'," ++ C.q(session) ++ ",'next','Read session ID; recruit or attach the session before setting its log policy.') WHERE NOT " ++ known(session) ++ ";"
  ++ "SELECT json_object('error','invalid-log-setting','session'," ++ C.q(session) ++ ",'level'," ++ C.q(level) ++ ",'budgetBytes'," ++ C.q(budget) ++ ",'keepSegments'," ++ C.q(segments) ++ ",'condition','A level is quiet, default or diagnostic; a budget is 65536 bytes or more; a retention count is between 1 and 4.','next','Read logs SESSION for the stored policy and retry with admitted values.') WHERE " ++ known(session) ++ " AND NOT " ++ admitted(level,budget,segments) ++ ";"
  ++ "SELECT json_object('session',session,'level',level,'budgetBytes',budget_bytes,'keepSegments',keep_segments,'registeredLogs',(SELECT count(*) FROM log_files WHERE session=log_policies.session)) FROM log_policies WHERE session=" ++ C.q(session) ++ " AND " ++ admitted(level,budget,segments) ++ ";"

def write(db: String, session: String, level: String, budget: String, segments: String) -> IO(String):
  do IO<String>:
    saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ schema() ++ write_sql(session,level,budget,segments) ++ "COMMIT;"))
    IO.pure(String,Tx.trim_nl(saved))

# `logs SESSION` reads the effective policy; every longer form stores one.
def apply(+db: String, +session: String, +level: String, budget: String, segments: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(level),read(db,session),write(db,session,level,budget,segments))

# The terminal frames and the unclassified frames are the ones a quiet session
# keeps; every other classified frame is a running view of work in progress.
def terminal_kind(+kind: String) -> Bool:
  Bool.or(String.eq(kind,"agent_end"),Bool.or(String.eq(kind,"result"),String.eq(kind,"turn_end")))

def first_failure(first: Result<&1,&1,U32 & String,Unit>, second: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match first:
    case Fail{error}: Fail{error}
    case Done{unit}: second

# A prefix frame carries a partial view of work that a later frame completes:
# the last `tool_execution_update` of a call is superseded by its
# `tool_execution_end`, and a `message_start` by its `message_end`. The turn
# holds the newest prefix frame of every open identity as one
# `<kind>\t<id>\t<line>` entry, with the entries joined by one newline, so a
# turn that ends first still writes the partial output it held and an
# interrupted call keeps its last observed state. A provider frame is one JSON
# line, so an entry carries no raw tab or newline of its own.
def tab() -> Char:
  Char.from_u32(9)

def first_field(fields: List<String>) -> String:
  match fields:
    case Nil{}: ""
    case Con{head, rest}: head

def second_field(fields: List<String>) -> String:
  match fields:
    case Nil{}: ""
    case Con{head, rest}: first_field(rest)

def after_tab(+s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{c, +rest}: Bool.pick(String,Char.is_eq(c,tab()),rest,after_tab(rest))

def entry_kind(entry: String) -> String:
  first_field(Tx.split_tabs(entry))

def entry_id(entry: String) -> String:
  second_field(Tx.split_tabs(entry))

def entry_line(entry: String) -> String:
  after_tab(after_tab(entry))

def entry_of(+kind: String, +id: String, +line: String) -> String:
  kind ++ "\t" ++ id ++ "\t" ++ line

def entry_matches(+entry: String, +kind: String, +id: String) -> Bool:
  Bool.and(String.eq(entry_kind(entry),kind),String.eq(entry_id(entry),id))

# The entries that stay when the ones this kind and identity name leave.
def keep_pair(matched: Bool, +entry: String, rest_result: List<String>) -> List<String>:
  match matched:
    case True{}: rest_result
    case False{}: Con{entry, rest_result}

def keep_walk(entries: List<String>, +kind: String, +id: String) -> List<String>:
  match entries:
    case Nil{}: Nil{}
    case Con{+entry, rest}: keep_pair(entry_matches(entry,kind,id),entry,keep_walk(rest,kind,id))

# The lines of the entries this kind and identity name.
def taken_pair(matched: Bool, +entry: String, rest_result: List<String>) -> List<String>:
  match matched:
    case True{}: Con{entry_line(entry), rest_result}
    case False{}: rest_result

def take_walk(entries: List<String>, +kind: String, +id: String) -> List<String>:
  match entries:
    case Nil{}: Nil{}
    case Con{+entry, rest}: taken_pair(entry_matches(entry,kind,id),entry,take_walk(rest,kind,id))

def all_walk(entries: List<String>) -> List<String>:
  match entries:
    case Nil{}: Nil{}
    case Con{entry, rest}: Con{entry_line(entry), all_walk(rest)}

def held_put(held: String, +kind: String, +id: String, +line: String) -> String:
  Tx.join("\n",Con{entry_of(kind,id,line), keep_walk(Tx.split_lines(held),kind,id)})

def held_drop(held: String, +kind: String, +id: String) -> String:
  Tx.join("\n",keep_walk(Tx.split_lines(held),kind,id))

def held_lines(held: String, +kind: String, +id: String) -> List<String>:
  take_walk(Tx.split_lines(held),kind,id)

def held_all(held: String) -> List<String>:
  all_walk(Tx.split_lines(held))

def prefix_kind(+kind: String) -> Bool:
  Bool.or(String.eq(kind,"tool_execution_update"),String.eq(kind,"message_start"))

def close_kind(+kind: String) -> Bool:
  Bool.or(String.eq(kind,"tool_execution_end"),String.eq(kind,"message_end"))

def frame_id_sql(+line: String) -> String:
  "WITH frame(value) AS (VALUES(" ++ C.q(line) ++ ")) SELECT coalesce(json_extract(value,'$.toolCallId'),json_extract(value,'$.messageId'),json_extract(value,'$.message.id'),'') FROM frame;"

def frame_id(db: String, line: String, omp: Bool) -> IO(String):
  match omp:
    case False{}: IO.pure(String,"")
    case True{}: do IO<String>:
      found : String <- IO.try(String,DB.Sql.query(db,frame_id_sql(line)))
      IO.pure(String,Tx.trim_nl(found))

# The identity is read only for a frame the policy holds or closes.
def frame_identity(db: String, line: String, +kind: String, +omp: Bool) -> IO(String):
  Bool.pick(IO(String),Bool.and(omp,Bool.or(prefix_kind(kind),close_kind(kind))),frame_id(db,line,omp),IO.pure(String,""))

def quiet_keep(keep: Bool, +line: String, held: String) -> List<String> & String:
  match keep:
    case True{}: (Con{line,Nil{}},held)
    case False{}: (Nil{},held)

def step_quiet(+kind: String, +line: String, held: String) -> List<String> & String:
  quiet_keep(Bool.or(terminal_kind(kind),String.is_empty(kind)),line,held)

def step_message_end(end: Bool, +kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  match end:
    case True{}: (Con{line,Nil{}}, held_drop(held,"message_start",id))
    case False{}: (Con{line,Nil{}}, held)

def step_tool_end(end: Bool, +kind: String, +id: String, +line: String, +held: String) -> List<String> & String:
  match end:
    case True{}: (List.append(&1,String,held_lines(held,"tool_execution_update",id),Con{line,Nil{}}), held_drop(held,"tool_execution_update",id))
    case False{}: step_message_end(String.eq(kind,"message_end"),kind,id,line,held)

def step_snapshot(snapshot: Bool, +kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  match snapshot:
    case True{}: (Nil{},held)
    case False{}: step_tool_end(String.eq(kind,"tool_execution_end"),kind,id,line,held)

def step_start(start: Bool, +kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  match start:
    case True{}: (Nil{}, held_put(held,"message_start",id,line))
    case False{}: step_snapshot(String.eq(kind,"message_update"),kind,id,line,held)

def step_update(update: Bool, +kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  match update:
    case True{}: (Nil{}, held_put(held,"tool_execution_update",id,line))
    case False{}: step_start(String.eq(kind,"message_start"),kind,id,line,held)

# The lines a frame contributes at the default level.
def step_default(+kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  step_update(String.eq(kind,"tool_execution_update"),kind,id,line,held)

def step_quiet_or_default(quiet: Bool, +kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  match quiet:
    case True{}: step_quiet(kind,line,held)
    case False{}: step_default(kind,id,line,held)

def step_choose_step(diagnostic: Bool, +level: String, +kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  match diagnostic:
    case True{}: (Con{line,Nil{}},held)
    case False{}: step_quiet_or_default(String.eq(level,"quiet"),kind,id,line,held)

# The lines one frame contributes to the live log and the prefix frames the turn
# still holds.
def frame_step(policy: Policy, +kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  match policy:
    case Policy{+level,budget,segments,pending}: step_choose_step(String.eq(level,"diagnostic"),level,kind,id,line,held)

def step_lines(step: List<String> & String) -> List<String>:
  (lines,held)=step
  lines

def step_held(step: List<String> & String) -> String:
  (lines,held)=step
  held

# Everything still held when the turn ends without the frame that supersedes it.
def flush(held: String) -> List<String>:
  held_all(held)

def entry_count(entries: List<String>) -> U32:
  match entries:
    case Nil{}: 0
    case Con{head, rest}: U32.add(1,entry_count(rest))

# A turn that ends on a read failure writes what it held and names the episode,
# so the partial output it kept is not lost with the process.
def interrupted(+held: String) -> List<String>:
  Bool.pick(List<String>,String.is_empty(held),Nil{},
    Con{"{\"type\":\"baton_log_interrupted\",\"held\":" ++ U32.show(entry_count(Tx.split_lines(held))) ++ "}",Nil{}})

def failed_now(previous: Bool, written: Result<&1,&1,U32 & String,Unit>) -> Bool:
  match written:
    case Fail{error}: True{}
    case Done{unit}: previous

def append_result(+log: String, +size: U32, written: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match written:
    case Fail{(code,text)}: Fail{(code,"Log " ++ log ++ " at " ++ U32.show(size) ++ " bytes: " ++ text)}
    case Done{unit}: Done{Unit{}}

def append_text(+log: String, +line: String, size: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    written : Result<&1,&1,U32 & String,Unit> <- T.Text.append(log,line ++ "\n")
    IO.pure(Result<&1,&1,U32 & String,Unit>,append_result(log,size,written))

def segment(+log: String, index: U32) -> String:
  log ++ "." ++ U32.show(index)

# The numbered segments that hold a file when the rotation runs. The note names
# them, so a rename whose source was already absent is visible rather than
# hidden by the rename's no-op answer.
def items_join(+items: String, +item: String) -> String:
  Bool.pick(String,String.is_empty(item),items,Bool.pick(String,String.is_empty(items),item,items ++ "," ++ item))

def segment_index(log: String, +index: U32, acc: String) -> IO(String):
  do IO<String>:
    size : U32 <- IO.try(U32,F.Files.size(segment(log,index)))
    IO.pure(String,items_join(acc,Bool.pick(String,U32.is_lt(0,size),U32.show(index),"")))

def present_segments(+log: String) -> IO(String):
  do IO<String>:
    first : String <- segment_index(log,1,"")
    second : String <- segment_index(log,2,first)
    third : String <- segment_index(log,3,second)
    fourth : String <- segment_index(log,4,third)
    IO.pure(String,fourth)

# The numbered segments shift away from the live log before the live log takes
# the first name. The retention count is bounded, so each admitted count names
# its own shift and no numeric recursion is needed.
def shift_one(log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

# A retention count of two moves the first segment to the second. The live log
# keeps its name here: `rotate_renamed` moves it once, after the shift.
def shift_two(+log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  F.Files.rename(segment(log,1),segment(log,2))

def shift_three_after(moved: Result<&1,&1,U32 & String,Unit>, +log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match moved:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: shift_two(log)

def shift_three(+log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    moved : Result<&1,&1,U32 & String,Unit> <- F.Files.rename(segment(log,2),segment(log,3))
    shift_three_after(moved,log)

def shift_four_after(moved: Result<&1,&1,U32 & String,Unit>, +log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match moved:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: shift_three(log)

def shift_four(+log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    moved : Result<&1,&1,U32 & String,Unit> <- F.Files.rename(segment(log,3),segment(log,4))
    shift_four_after(moved,log)

def shift_more(three: Bool, log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match three:
    case True{}: shift_four(log)
    case False{}: shift_three(log)

def shift_two_or_more(two: Bool, three: Bool, log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match two:
    case True{}: shift_two(log)
    case False{}: shift_more(three,log)

def shift_step(one: Bool, two: Bool, three: Bool, log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match one:
    case True{}: shift_one(log)
    case False{}: shift_two_or_more(two,three,log)

# A real rename error stops the chain: the remaining segments stay where they
# are and the failure reaches the frame that was rotating.
def shift(+count: U32, log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  shift_step(U32.is_eq(count,1),U32.is_eq(count,2),U32.is_eq(count,3),log)

# The oldest numbered segment leaves the count only when the session holds no
# unacknowledged input. The shift overwrites that segment whether or not the
# unlink ran, so an unresolved session rotates nothing: its frames are the
# evidence a reader may still need, and the live log records the skipped
# rotation and keeps growing until the input is answered.
def rotation_note(budget: U32, segments: U32, level: String, moved: String) -> String:
  "{\"type\":\"baton_log_rotation\",\"level\":" ++ J.string_literal(level) ++ ",\"budgetBytes\":" ++ U32.show(budget) ++ ",\"retainedSegments\":" ++ U32.show(segments) ++ ",\"moved\":[" ++ moved ++ "]}"

def rotation_skipped_note(budget: U32, segments: U32, level: String) -> String:
  "{\"type\":\"baton_log_rotation\",\"skipped\":\"pending-input\",\"level\":" ++ J.string_literal(level) ++ ",\"budgetBytes\":" ++ U32.show(budget) ++ ",\"retainedSegments\":" ++ U32.show(segments) ++ "}"

def rotate_renamed(renamed: Result<&1,&1,U32 & String,Unit>, +log: String, budget: U32, segments: U32, level: String, moved: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match renamed:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: T.Text.append(log,rotation_note(budget,segments,level,moved) ++ "\n")

def rotate_shifted(shifted: Result<&1,&1,U32 & String,Unit>, +log: String, budget: U32, segments: U32, level: String, moved: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match shifted:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: do IO<Result<&1,&1,U32 & String,Unit>>:
      renamed : Result<&1,&1,U32 & String,Unit> <- F.Files.rename(log,segment(log,1))
      rotate_renamed(renamed,log,budget,segments,level,moved)

def rotate_skipped(pending: Bool, +log: String, budget: U32, +segments: U32, level: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match pending:
    case True{}: T.Text.append(log,rotation_skipped_note(budget,segments,level) ++ "\n")
    case False{}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +moved : String <- present_segments(log)
      shifted : Result<&1,&1,U32 & String,Unit> <- shift(segments,log)
      rotate_shifted(shifted,log,budget,segments,level,moved)

# Rotation moves the live log and shifts the retained segments. The chain stops
# at the first failed step, so a partial rotation leaves the remaining segments
# where they are and reports the failure beside the frame it kept.
def rotate(+log: String, budget: U32, +segments: U32, level: String, pending: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  rotate_skipped(pending,log,budget,segments,level)

def rotate_over(log: String, +budget: U32, segments: U32, level: String, pending: Bool, size: U32) -> IO(Result<&1,&1,U32 & String,Unit>):
  Bool.pick(IO(Result<&1,&1,U32 & String,Unit>),U32.is_lt(size,budget),
    IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}}),
    rotate(log,budget,segments,level,pending))

def rotation_failed_note(error: U32 & String) -> String:
  (code,text)=error
  "{\"type\":\"baton_log_rotation\",\"failed\":true,\"error\":" ++ J.string_literal(U32.show(code) ++ ": " ++ text) ++ "}"

# A rotation that fails leaves the segments where they are. The failure is
# written beside the frames it could not rotate, and the frame is appended:
# only an append that fails itself stops the log for the rest of the turn.
def rotation_failed(failed: Result<&1,&1,U32 & String,Unit>, +log: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match failed:
    case Fail{error}: T.Text.append(log,rotation_failed_note(error) ++ "\n")
    case Done{unit}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})

# One retained frame. The size check runs before the append, so a log at its
# budget rotates instead of growing past it.
def append(policy: Policy, +log: String, line: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  match policy:
    case Policy{+level,+budget,+segments,+pending}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +size : U32 <- IO.try(U32,F.Files.size(log))
      rotated : Result<&1,&1,U32 & String,Unit> <- rotate_over(log,budget,segments,level,pending,size)
      noted : Result<&1,&1,U32 & String,Unit> <- rotation_failed(rotated,log)
      written : Result<&1,&1,U32 & String,Unit> <- append_text(log,line,size)
      IO.pure(Result<&1,&1,U32 & String,Unit>,written)

# One line, unless the turn already failed to write this log.
def write_one(+policy: Policy, +log: String, line: String, first: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match first:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: append(policy,log,line)

# Writes the lines a frame contributes, in order, and keeps the first failure.
def write_each(+policy: Policy, +log: String, lines: List<String>, first: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match lines:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,Unit>,first)
    case Con{head, tail}: do IO<Result<&1,&1,U32 & String,Unit>>:
      written : Result<&1,&1,U32 & String,Unit> <- write_one(policy,log,head,first)
      rest : Result<&1,&1,U32 & String,Unit> <- write_each(policy,log,tail,written)
      IO.pure(Result<&1,&1,U32 & String,Unit>,rest)

# A log that already failed this turn writes nothing further, so one unwritable
# or full file is reported once and no frame is retried into it.
def write_lines(policy: Policy, log: String, lines: List<String>, stopped: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stopped:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: write_each(policy,log,lines,Done{Unit{}})

# The public log a turn writes is named once, so storage inspection and cleanup
# find every file this policy covers.
def register_sql(session: String, log: String) -> String:
  "INSERT OR IGNORE INTO log_files(session,log) VALUES(" ++ C.q(session) ++ "," ++ C.q(log) ++ ");"

def register_if(empty: Bool, db: String, session: String, log: String) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      listed : String <- IO.try(String,DB.Sql.query(db,schema() ++ register_sql(session,log)))
      IO.pure(Unit,Unit{})

def register(db: String, session: String, +log: String) -> IO(Unit):
  register_if(String.is_empty(log),db,session,log)

def open(+db: String, +session: String, log: String) -> IO(Policy):
  do IO<Policy>:
    listed : Unit <- register(db,session,log)
    current : Policy <- policy(db,session)
    IO.pure(Policy,current)

def segment_json(log: String, +index: U32, keep: U32, +size: U32, pending: String) -> String:
  Bool.pick(String,U32.is_eq(size,0),"",
    "{\"path\":" ++ J.string_literal(segment(log,index)) ++ ",\"index\":" ++ U32.show(index) ++ ",\"bytes\":" ++ U32.show(size) ++ ",\"eligible\":" ++ Bool.pick(String,Bool.and(U32.is_lt(keep,index),String.eq(pending,"0")),"true","false") ++ "}")

# The rotated segments beside one log. Rotation never produces an index above
# the retention count, which is bounded, so the four admitted indices are
# probed in order and no numeric recursion is needed. A segment is eligible for
# explicit cleanup when the retention count no longer covers it and the session
# holds no unacknowledged input, which is the rule `logs-clean` applies.
def segment_at(+log: String, +index: U32, keep: U32, pending: String, items: String) -> IO(String):
  do IO<String>:
    size : U32 <- IO.try(U32,F.Files.size(segment(log,index)))
    IO.pure(String,items_join(items,segment_json(log,index,keep,size,pending)))

def segments_4(+log: String, +keep: U32, +pending: String) -> IO(String):
  do IO<String>:
    first : String <- segment_at(log,1,keep,pending,"")
    second : String <- segment_at(log,2,keep,pending,first)
    third : String <- segment_at(log,3,keep,pending,second)
    fourth : String <- segment_at(log,4,keep,pending,third)
    IO.pure(String,fourth)

def log_rows_sql() -> String:
  "SELECT lf.session,lf.log,coalesce((SELECT level FROM log_policies WHERE session=lf.session)," ++ C.q(default_level()) ++ "),coalesce((SELECT budget_bytes FROM log_policies WHERE session=lf.session)," ++ default_budget() ++ "),coalesce((SELECT keep_segments FROM log_policies WHERE session=lf.session)," ++ default_segments() ++ "),(SELECT count(*) FROM messages WHERE recipient=lf.session AND receipt IS NULL) FROM log_files lf ORDER BY lf.session,lf.log;"

def log_json(session: String, log: String, level: String, budget: String, keep: String, pending: String, size: U32, stderr: U32, rotated: String) -> String:
  "{\"session\":" ++ J.string_literal(session)
  ++ ",\"path\":" ++ J.string_literal(log)
  ++ ",\"level\":" ++ J.string_literal(level)
  ++ ",\"budgetBytes\":" ++ budget
  ++ ",\"keepSegments\":" ++ keep
  ++ ",\"pendingInput\":" ++ pending
  ++ ",\"bytes\":" ++ U32.show(size)
  ++ ",\"stderrBytes\":" ++ U32.show(stderr)
  ++ ",\"rotated\":[" ++ rotated ++ "]}"

def log_fields(fields: List<String>) -> IO(String):
  match fields:
    case session <> +log <> level <> budget <> +keep <> +pending <> rest: do IO<String>:
      size : U32 <- IO.try(U32,F.Files.size(log))
      stderr : U32 <- IO.try(U32,F.Files.size(log ++ ".stderr"))
      rotated : String <- segments_4(log,number_of(U32.read(keep),2),pending)
      IO.pure(String,log_json(session,log,level,budget,keep,pending,size,stderr,rotated))
    case other: IO.pure(String,"")

def log_item(row: String) -> IO(String):
  log_fields(Tx.split_tabs(row))

def log_items(rows: List<String>, acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      item : String <- log_item(head)
      deeper : String <- log_items(tail,items_join(acc,item))
      IO.pure(String,deeper)

# An attempt directory is retained evidence: storage inspection reports its
# files and markers, and no command removes it.
def attempt_rows_sql() -> String:
  "SELECT session,id,mode,phase,status,directory FROM executions WHERE directory<>'' ORDER BY session,directory;"

def attempt_json(session: String, attempt: String, mode: String, phase: String, status: String, +directory: String, +stdout: U32, +stderr: U32, +observer: U32, +keeper: U32, released: U32, acknowledged: U32) -> String:
  "{\"session\":" ++ J.string_literal(session)
  ++ ",\"attempt\":" ++ J.string_literal(attempt)
  ++ ",\"mode\":" ++ J.string_literal(mode)
  ++ ",\"phase\":" ++ J.string_literal(phase)
  ++ ",\"status\":" ++ J.string_literal(status)
  ++ ",\"directory\":" ++ J.string_literal(directory)
  ++ ",\"bytes\":" ++ U32.show(U32.add(stdout,U32.add(stderr,U32.add(observer,keeper))))
  ++ ",\"stdoutBytes\":" ++ U32.show(stdout)
  ++ ",\"stderrBytes\":" ++ U32.show(stderr)
  ++ ",\"observerBytes\":" ++ U32.show(observer)
  ++ ",\"keeperBytes\":" ++ U32.show(keeper)
  ++ ",\"released\":" ++ Bool.pick(String,U32.is_lt(0,released),"true","false")
  ++ ",\"acknowledged\":" ++ Bool.pick(String,U32.is_lt(0,acknowledged),"true","false") ++ "}"

def attempt_fields(fields: List<String>) -> IO(String):
  match fields:
    case session <> attempt <> mode <> phase <> status <> +directory <> rest: do IO<String>:
      stdout : U32 <- IO.try(U32,F.Files.size(directory ++ "/stdout"))
      stderr : U32 <- IO.try(U32,F.Files.size(directory ++ "/native.stderr"))
      observer : U32 <- IO.try(U32,F.Files.size(directory ++ "/observer.log"))
      keeper : U32 <- IO.try(U32,F.Files.size(directory ++ "/keeper.log"))
      released : U32 <- IO.try(U32,F.Files.size(directory ++ "/released"))
      acknowledged : U32 <- IO.try(U32,F.Files.size(directory ++ "/acknowledged"))
      IO.pure(String,attempt_json(session,attempt,mode,phase,status,directory,stdout,stderr,observer,keeper,released,acknowledged))
    case other: IO.pure(String,"")

def attempt_item(row: String) -> IO(String):
  attempt_fields(Tx.split_tabs(row))

def attempt_items(rows: List<String>, acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      item : String <- attempt_item(head)
      deeper : String <- attempt_items(tail,items_join(acc,item))
      IO.pure(String,deeper)

def storage_json(db: String, database: U32, root: U32, logs: String, attempts: String) -> String:
  "{\"database\":" ++ J.string_literal(db)
  ++ ",\"databaseBytes\":" ++ U32.show(database)
  ++ ",\"rootLogBytes\":" ++ U32.show(root)
  ++ ",\"defaults\":{\"level\":" ++ J.string_literal(default_level()) ++ ",\"budgetBytes\":" ++ default_budget() ++ ",\"keepSegments\":" ++ default_segments() ++ "}"
  ++ ",\"logs\":[" ++ logs ++ "]"
  ++ ",\"attempts\":[" ++ attempts ++ "]}"

# Read-only: the measured paths, and the same cleanup candidates `logs-clean`
# removes, with no write of its own.
def storage(+db: String) -> IO(String):
  do IO<String>:
    log_text : String <- IO.try(String,DB.Sql.query(db,schema() ++ log_rows_sql()))
    logs : String <- log_items(Tx.split_lines(log_text),"")
    attempt_text : String <- IO.try(String,DB.Sql.query(db,attempt_rows_sql()))
    attempts : String <- attempt_items(Tx.split_lines(attempt_text),"")
    database : U32 <- IO.try(U32,F.Files.size(db))
    root : U32 <- IO.try(U32,F.Files.size(db ++ ".root.log"))
    IO.pure(String,storage_json(db,database,root,logs,attempts))

def clean_item_json(log: String, +index: U32, size: U32, gone: Result<&1,&1,U32 & String,Unit>) -> String:
  match gone:
    case Fail{(code,text)}:
      "{\"path\":" ++ J.string_literal(segment(log,index)) ++ ",\"index\":" ++ U32.show(index) ++ ",\"bytes\":" ++ U32.show(size) ++ ",\"removed\":false,\"error\":" ++ J.string_literal(U32.show(code) ++ ": " ++ text) ++ "}"
    case Done{unit}:
      "{\"path\":" ++ J.string_literal(segment(log,index)) ++ ",\"index\":" ++ U32.show(index) ++ ",\"bytes\":" ++ U32.show(size) ++ ",\"removed\":true}"

# One candidate: an existing numbered segment the retention count no longer
# covers. The live log is never a candidate.
def clean_eligible(eligible: Bool, +log: String, keep: U32, +index: U32, size: U32) -> IO(String):
  match eligible:
    case False{}: IO.pure(String,"")
    case True{}: do IO<String>:
      gone : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(segment(log,index))
      IO.pure(String,clean_item_json(log,index,size,gone))

def clean_item(+log: String, +keep: U32, +index: U32, +size: U32) -> IO(String):
  clean_eligible(Bool.and(U32.is_lt(0,size),U32.is_lt(keep,index)),log,keep,index,size)

def clean_at(+log: String, +keep: U32, +index: U32, removed: String) -> IO(String):
  do IO<String>:
    size : U32 <- IO.try(U32,F.Files.size(segment(log,index)))
    item : String <- clean_item(log,keep,index,size)
    IO.pure(String,items_join(removed,item))

# The same four admitted indices, in the same order as the storage report.
def clean_segments_4(+log: String, +keep: U32) -> IO(String):
  do IO<String>:
    first : String <- clean_at(log,keep,1,"")
    second : String <- clean_at(log,keep,2,first)
    third : String <- clean_at(log,keep,3,second)
    fourth : String <- clean_at(log,keep,4,third)
    IO.pure(String,fourth)

def clean_fields(fields: List<String>) -> IO(String):
  match fields:
    case log <> keep <> rest: clean_segments_4(log,number_of(U32.read(keep),2))
    case other: IO.pure(String,"")

def clean_row(row: String) -> IO(String):
  clean_fields(Tx.split_tabs(row))

def clean_rows(rows: List<String>, acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      removed : String <- clean_row(head)
      deeper : String <- clean_rows(tail,items_join(acc,removed))
      IO.pure(String,deeper)

def clean_sql(+session: String) -> String:
  "SELECT lf.log,coalesce((SELECT keep_segments FROM log_policies WHERE session=lf.session)," ++ default_segments() ++ ") FROM log_files lf WHERE lf.session=" ++ C.q(session) ++ " ORDER BY lf.log;"

def clean_pending_sql(+session: String) -> String:
  "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL;"

def clean_json(session: String, removed: String) -> String:
  "{\"session\":" ++ J.string_literal(session) ++ ",\"removed\":[" ++ removed ++ "]}"

def clean_skipped(session: String, pending: String) -> String:
  "{\"session\":" ++ J.string_literal(session) ++ ",\"removed\":[],\"pendingInput\":" ++ pending ++ ",\"skipped\":\"pending-input\"}"

def unknown_session(session: String) -> String:
  "{\"error\":\"unknown-session\",\"session\":" ++ J.string_literal(session) ++ ",\"next\":\"Read session ID; recruit or attach the session before cleaning its logs.\"}"

# A refused log command names its rule on stderr with status 2, as the stored
# commands do.
def refused(+saved: String) -> Bool:
  Bool.or(Tx.starts_with(saved,"{\"error\":\"invalid-log-setting\""),Tx.starts_with(saved,"{\"error\":\"unknown-session\""))

def cleaned(db: String, +session: String) -> IO(String):
  do IO<String>:
    rows : String <- IO.try(String,DB.Sql.query(db,clean_sql(session)))
    removed : String <- clean_rows(Tx.split_lines(rows),"")
    IO.pure(String,clean_json(session,removed))

def clean_known(db: String, +session: String, +pending: String) -> IO(String):
  Bool.pick(IO(String),String.eq(pending,"0"),cleaned(db,session),IO.pure(String,clean_skipped(session,pending)))

# Explicit cleanup of the named session's rotated public-log segments. The live
# log, rotated stderr files, pending messages, attempt directories, native
# conversation stores and every other artifact stay untouched; logs-storage
# previews the same candidates under the same eligibility rule. A session with
# unacknowledged input keeps every segment and the answer names the count.
def clean(+db: String, +session: String) -> IO(String):
  do IO<String>:
    +present : String <- IO.try(String,DB.Sql.query(db,schema() ++ "SELECT count(*) FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +pending : String <- IO.try(String,DB.Sql.query(db,clean_pending_sql(session)))
    answer : String <- Bool.pick(IO(String),String.eq(Tx.trim_nl(present),"1"),clean_known(db,session,Tx.trim_nl(pending)),IO.pure(String,unknown_session(session)))
    IO.pure(String,answer)
