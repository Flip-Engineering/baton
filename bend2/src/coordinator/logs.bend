import Base
import ./commands.bend as C
import ./log-schema.bend as Schema
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../host/files.bend as F
import ../git/text.bend as Tx
import ../host/session-lock.bend as Lock
import ../json/canonical.bend as J

# Baton2-owned log classification, storage inspection and cleanup.
#
# Level `default` drops repeated cumulative snapshots while retaining completed
# messages, final tool results, terminal frames and report evidence. Level
# `diagnostic` retains every frame. Level `quiet` retains terminal and
# unclassified frames. Unknown provider events remain visible at every level.
# The registry records public log paths; native conversations and harness
# histories have separate owners.

def default_level() -> String:
  "default"

def number_of(value: Maybe<&2,U32>, fallback: U32) -> U32:
  match value:
    case None{}: fallback
    case Some{found}: found

def schema() -> String:
  Schema.tables()

type Policy is Data:
  Policy{level: String, db: String, session: String}

def fallback_level(+value: String) -> String:
  Bool.pick(String,String.is_empty(value),default_level(),value)

def policy_fields(db: String, session: String, fields: List<String>) -> Policy:
  match fields:
    case level <> rest: Policy{fallback_level(level),db,session}
    case other: Policy{default_level(),db,session}

def policy_row(db: String, session: String, row: String) -> Policy:
  policy_fields(db,session,Tx.split_tabs(row))

def pending_sql(+session: String) -> String:
  "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL;"

def pending_count(db: String, session: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,DB.Sql.query(db,pending_sql(session)))
    IO.pure(String,Tx.trim_nl(found))

def policy_sql(+session: String) -> String:
  "SELECT coalesce((SELECT level FROM log_policies WHERE session=" ++ C.q(session) ++ "),'');"

def policy(+db: String, +session: String) -> IO(Policy):
  do IO<Policy>:
    ensured : Unit <- Schema.ensure(db)
    row : String <- IO.try(String,DB.Sql.query(db,schema() ++ policy_sql(session)))
    IO.pure(Policy,policy_row(db,session,Tx.trim_nl(row)))

def known(+session: String) -> String:
  "EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ")"

def level_admitted(+level: String) -> String:
  "coalesce(nullif(" ++ C.q(level) ++ ",'')," ++ C.q(default_level()) ++ ") IN ('quiet','default','diagnostic')"

def read_sql(+session: String) -> String:
  "SELECT json_object('session'," ++ C.q(session) ++ ",'level',coalesce((SELECT level FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ C.q(default_level()) ++ "),'registeredLogs',(SELECT count(*) FROM log_files WHERE session=" ++ C.q(session) ++ ")) WHERE " ++ known(session) ++ ";"

def read(+db: String, session: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Schema.ensure(db)
    saved : String <- IO.try(String,DB.Sql.query(db,schema() ++ read_sql(session)))
    IO.pure(String,Tx.trim_nl(saved))

def write_sql(+session: String, +level: String) -> String:
  "INSERT INTO log_policies(session,level) SELECT " ++ C.q(session)
  ++ ",coalesce(nullif(" ++ C.q(level) ++ ",''),(SELECT level FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ C.q(default_level()) ++ ")"
  ++ " WHERE " ++ known(session) ++ " AND " ++ level_admitted(level)
  ++ " ON CONFLICT(session) DO UPDATE SET level=excluded.level;"
  ++ "SELECT json_object('error','unknown-session','session'," ++ C.q(session) ++ ",'next','Read session ID; recruit or attach the session before setting its log level.') WHERE NOT " ++ known(session) ++ ";"
  ++ "SELECT json_object('error','invalid-log-setting','session'," ++ C.q(session) ++ ",'level'," ++ C.q(level) ++ ",'condition','A level is quiet, default or diagnostic.','next','Read logs SESSION for the stored level and retry with an admitted value.') WHERE " ++ known(session) ++ " AND NOT " ++ level_admitted(level) ++ ";"
  ++ "SELECT json_object('session',session,'level',level,'registeredLogs',(SELECT count(*) FROM log_files WHERE session=log_policies.session)) FROM log_policies WHERE session=" ++ C.q(session) ++ " AND " ++ level_admitted(level) ++ ";"

def write(+db: String, session: String, level: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Schema.ensure(db)
    saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ schema() ++ write_sql(session,level) ++ "COMMIT;"))
    IO.pure(String,Tx.trim_nl(saved))

def apply(+db: String, +session: String, +level: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(level),read(db,session),write(db,session,level))

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
  Bool.or(String.eq(kind,"tool_execution_update"),Bool.or(String.eq(kind,"message_start"),String.eq(kind,"message_update")))

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

def step_message_end(end: Bool, +kind: String, +id: String, +line: String, +held: String) -> List<String> & String:
  match end:
    case True{}: (Con{line,Nil{}}, held_drop(held_drop(held,"message_start",id),"message_update",id))
    case False{}: (Con{line,Nil{}}, held)

def step_tool_end(end: Bool, +kind: String, +id: String, +line: String, +held: String) -> List<String> & String:
  match end:
    case True{}: (List.append(&1,String,held_lines(held,"tool_execution_update",id),Con{line,Nil{}}), held_drop(held,"tool_execution_update",id))
    case False{}: step_message_end(String.eq(kind,"message_end"),kind,id,line,held)

# A message_update carries the running view of a message the provider resends;
# the newest one is held like any other prefix frame, so an assistant stream
# that dies before its message_end still leaves the text it had produced.
def step_snapshot(snapshot: Bool, +kind: String, +id: String, +line: String, held: String) -> List<String> & String:
  match snapshot:
    case True{}: (Nil{}, held_put(held,"message_update",id,line))
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
    case Policy{+level,db,session}: step_choose_step(String.eq(level,"diagnostic"),level,kind,id,line,held)

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

def segment(+log: String, index: String) -> String:
  log ++ "." ++ index

def items_join(+items: String, +item: String) -> String:
  Bool.pick(String,String.is_empty(item),items,Bool.pick(String,String.is_empty(items),item,items ++ "," ++ item))

# The numbered segments beside one log come from the directory that holds it:
# every entry named <log>.<number>. Reports use the exact suffix returned by
# the directory scan.
def segment_indices(log: String) -> IO(List<String>):
  do IO<List<String>>:
    found : String <- IO.try(String,F.Files.segments(log))
    IO.pure(List<String>,Tx.split_lines(found))

def append_result(+log: String, written: Result<&1,&1,U32 & String,Unit>) -> Result<&1,&1,U32 & String,Unit>:
  match written:
    case Fail{(code,text)}: Fail{(code,"Log " ++ log ++ ": " ++ text)}
    case Done{unit}: Done{Unit{}}

def append_text(+log: String, +line: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    written : Result<&1,&1,U32 & String,Unit> <- T.Text.append(log,line ++ "\n")
    IO.pure(Result<&1,&1,U32 & String,Unit>,append_result(log,written))

def write_one(+log: String, line: String, first: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match first:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: append_text(log,line)

def write_each(+log: String, lines: List<String>, first: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match lines:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,Unit>,first)
    case Con{head, tail}: do IO<Result<&1,&1,U32 & String,Unit>>:
      written : Result<&1,&1,U32 & String,Unit> <- write_one(log,head,first)
      rest : Result<&1,&1,U32 & String,Unit> <- write_each(log,tail,written)
      IO.pure(Result<&1,&1,U32 & String,Unit>,rest)

def write_lines(policy: Policy, log: String, lines: List<String>, stopped: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stopped:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: write_each(log,lines,Done{Unit{}})

def register_sql(session: String, log: String) -> String:
  "INSERT OR IGNORE INTO log_files(session,log) VALUES(" ++ C.q(session) ++ "," ++ C.q(log) ++ ");"

def register_if(empty: Bool, +db: String, session: String, log: String) -> IO(Unit):
  match empty:
    case True{}: IO.pure(Unit,Unit{})
    case False{}: do IO<Unit>:
      ensured : Unit <- Schema.ensure(db)
      listed : String <- IO.try(String,DB.Sql.query(db,schema() ++ register_sql(session,log)))
      IO.pure(Unit,Unit{})

def register(db: String, session: String, +log: String) -> IO(Unit):
  register_if(String.is_empty(log),db,session,log)

def open(+db: String, +session: String, log: String) -> IO(Policy):
  do IO<Policy>:
    listed : Unit <- register(db,session,log)
    current : Policy <- policy(db,session)
    IO.pure(Policy,current)

# Percent-encoded attempt generations. Letters, digits, dash and underscore
# pass through; every other codepoint becomes a percent hex escape, so a raw
# turn id with a slash, a dot, or a marker of its own still names one file
# beside the base log. Percent itself is escaped, so two identities never
# share a file. Wide codepoints use six hex digits.
def code_kept_range(+u: U32, +lo: U32, +hi: U32) -> Bool:
  Bool.and(Bool.or(U32.is_eq(u,lo),U32.is_lt(lo,u)),Bool.or(U32.is_eq(u,hi),U32.is_lt(u,hi)))

def code_kept(+code: U32) -> Bool:
  Bool.or(code_kept_range(code,48,57),Bool.or(code_kept_range(code,65,90),Bool.or(code_kept_range(code,97,122),Bool.or(U32.is_eq(code,45),U32.is_eq(code,95)))))

def code_byte_hex(+code: U32) -> String:
  J.one(J.hex_digit(U32.and(U32.shrn(code,4n),15))) ++ J.one(J.hex_digit(U32.and(code,15)))

def code_wide_hex(+code: U32) -> String:
  J.one(J.hex_digit(U32.and(U32.shrn(code,20n),15))) ++ J.one(J.hex_digit(U32.and(U32.shrn(code,16n),15))) ++ J.one(J.hex_digit(U32.and(U32.shrn(code,12n),15))) ++ J.one(J.hex_digit(U32.and(U32.shrn(code,8n),15))) ++ J.one(J.hex_digit(U32.and(U32.shrn(code,4n),15))) ++ J.one(J.hex_digit(U32.and(code,15)))

def code_escaped(+code: U32, +tail: String) -> String:
  "%" ++ Bool.pick(String,U32.is_lt(code,256),code_byte_hex(code),code_wide_hex(code)) ++ tail

def code_prepend(keep: Bool, +c: Char, +tail: String) -> String:
  Bool.pick(String,keep,SCon{c, tail},code_escaped(J.cp(c),tail))

def attempt_code_go(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{+c, +rest}: code_prepend(code_kept(J.cp(c)),c,attempt_code_go(rest))

def attempt_code(+attempt: String) -> String:
  attempt_code_go(attempt)

# A new attempt writes a fresh generation beside the session's base log instead
# of appending into the previous attempt's live file: a resumed receiver that
# reuses one fixed path keeps waking the same compressed bytes. The suffix is
# never a bare number, so the segment scan never enumerates a generation and
# An empty attempt
# keeps the base path, so a caller without an attempt identity behaves as
# before. The Turn owner adopts this by rebinding its log path once per turn;
# this module never rewrites the Turn's path on its own.
def attempt_log(+base: String, +attempt: String) -> String:
  Bool.pick(String,String.is_empty(attempt),base,base ++ ".attempt-" ++ attempt_code(attempt))

# The durable per-attempt lineage: one row per generation file the session
# registered, in registration order. The executions table keeps one live row
# per session and Stop.admit replaces it, so this registry is what still binds
# a superseded generation to its attempt after a later turn starts. Written by
# Logs.open_attempt alongside the log_files registration; read by storage and
# cleanup. A file belongs to one attempt.
def generations_schema() -> String:
  "CREATE TABLE IF NOT EXISTS log_generations(session TEXT NOT NULL,attempt TEXT NOT NULL,log TEXT NOT NULL,base TEXT NOT NULL,PRIMARY KEY(session,attempt));CREATE UNIQUE INDEX IF NOT EXISTS log_generations_log ON log_generations(log);"

def stderr_runs_schema() -> String:
  "CREATE TABLE IF NOT EXISTS log_stderr_runs(session TEXT NOT NULL,attempt TEXT NOT NULL,run INTEGER NOT NULL,generation TEXT NOT NULL,stderr TEXT NOT NULL,PRIMARY KEY(session,attempt,run),UNIQUE(stderr));"

def stderr_runs_migration() -> String:
  "BEGIN IMMEDIATE;ALTER TABLE log_stderr_runs RENAME TO log_stderr_runs_legacy;"
  ++ stderr_runs_schema()
  ++ "INSERT INTO log_stderr_runs(session,attempt,run,generation,stderr) SELECT session,attempt,run,generation,stderr FROM log_stderr_runs_legacy;"
  ++ "DROP TABLE log_stderr_runs_legacy;COMMIT;"

def migrate_stderr_runs_if(ready: Bool, +db: String) -> IO(Unit):
  match ready:
    case True{}: IO.pure(Unit,Unit{})
    case False{}:
      do IO<Unit>:
        migrated : String <- IO.try(String,DB.Sql.query(db,stderr_runs_migration()))
        IO.pure(Unit,Unit{})

def stderr_runs_ensure(+db: String) -> IO(Unit):
  do IO<Unit>:
    ready : String <- IO.try(String,DB.Sql.query(db,stderr_runs_schema() ++ "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='log_stderr_runs' AND instr(sql,'4294967295')=0;"))
    migrated : Unit <- migrate_stderr_runs_if(String.eq(Tx.trim_nl(ready),"1"),db)
    IO.pure(Unit,Unit{})

def stderr_run_sql(+session: String, +attempt: String, +generation: String) -> String:
  "BEGIN IMMEDIATE;" ++ stderr_runs_schema()
  ++ "INSERT INTO log_stderr_runs(session,attempt,run,generation,stderr) VALUES(" ++ C.q(session) ++ "," ++ C.q(attempt) ++ ",(SELECT coalesce(max(run),0)+1 FROM log_stderr_runs WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ ")," ++ C.q(generation) ++ "," ++ C.q(generation ++ ".stderr.run-") ++ " || (SELECT coalesce(max(run),0)+1 FROM log_stderr_runs WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ "));"
  ++ "SELECT stderr FROM log_stderr_runs WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ " ORDER BY run DESC LIMIT 1;COMMIT;"

def open_stderr_run(+db: String, +session: String, +attempt: String, +generation: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- stderr_runs_ensure(db)
    path : String <- IO.try(String,DB.Sql.query(db,stderr_run_sql(session,attempt,generation)))
    IO.pure(String,Tx.trim_nl(path))

def generations_register_sql(+session: String, +attempt: String, +log: String, +base: String) -> String:
  "INSERT OR IGNORE INTO log_generations(session,attempt,log,base) VALUES(" ++ C.q(session) ++ "," ++ C.q(attempt) ++ "," ++ C.q(log) ++ "," ++ C.q(base) ++ ");"

def generations_ensure(+db: String) -> IO(Unit):
  do IO<Unit>:
    ensured : String <- IO.try(String,DB.Sql.query(db,generations_schema() ++ "SELECT 1;"))
    IO.pure(Unit,Unit{})

def open_attempt_registered(empty: Bool, +db: String, +session: String, +base: String, +attempt: String) -> IO(Policy):
  match empty:
    case True{}: open(db,session,base)
    case False{}: do IO<Policy>:
      ensured : Unit <- generations_ensure(db)
      listed : Unit <- register(db,session,attempt_log(base,attempt))
      generated : String <- IO.try(String,DB.Sql.query(db,generations_register_sql(session,attempt,attempt_log(base,attempt),base)))
      current : Policy <- policy(db,session)
      IO.pure(Policy,current)

def open_attempt_named(empty: Bool, +db: String, +session: String, +base: String, +attempt: String) -> IO(Policy):
  match empty:
    case True{}: open(db,session,base)
    case False{}: open_attempt_registered(empty,db,session,base,attempt)

def open_attempt(+db: String, +session: String, +base: String, +attempt: String) -> IO(Policy):
  open_attempt_named(String.is_empty(attempt),db,session,base,attempt)

# The file name without its directories, so a marker in a parent directory
# never resolves as the generation identity.
def has_slash(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{c, +rest}: Bool.pick(Bool,U32.is_eq(J.cp(c),47),True{},has_slash(rest))

def base_name(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{c, +rest}: Bool.pick(String,has_slash(rest),base_name(rest),SCon{c, rest})

# The marker match starts at each position of the file name in turn.
def after_here(s: String, m: String) -> String:
  match s m:
    case SNil{} SNil{}: ""
    case SNil{} SCon{mc, mrest}: ""
    case SCon{c, rest} SNil{}: SCon{c, rest}
    case SCon{c, rest} SCon{mc, mrest}: Bool.pick(String,Char.is_eq(c,mc),after_here(rest,mrest),"")

def attempt_of_go(s: String) -> String:
  match s:
    case SNil{}: ""
    case SCon{c, +rest}:
      +later = attempt_of_go(rest)
      +here = after_here(SCon{c, rest},".attempt-")
      Bool.pick(String,String.is_empty(here),later,Bool.pick(String,String.is_empty(later),here,later))

# The attempt code a generation file name carries, or empty for the base log
# and for any other name. Scoped to the file name; the registry binds
# registered files to their attempt authority.
def attempt_of(+log: String) -> String:
  attempt_of_go(base_name(log))

def segment_json(log: String, +index: String, +size: U32) -> String:
  Bool.pick(String,U32.is_eq(size,0),"",
    "{\"path\":" ++ J.string_literal(segment(log,index)) ++ ",\"index\":" ++ index ++ ",\"bytes\":" ++ U32.show(size) ++ "}")

def segment_items(+log: String, indices: List<String>, acc: String) -> IO(String):
  match indices:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      size : U32 <- IO.try(U32,F.Files.size(segment(log,head)))
      deeper : String <- segment_items(log,tail,items_join(acc,segment_json(log,head,size)))
      IO.pure(String,deeper)

def listed_segments(+log: String) -> IO(String):
  do IO<String>:
    indices : List<String> <- segment_indices(log)
    segment_items(log,indices,"")

def log_rows_sql() -> String:
  "SELECT lf.session,lf.log,coalesce((SELECT level FROM log_policies WHERE session=lf.session)," ++ C.q(default_level()) ++ ") FROM log_files lf ORDER BY lf.session,lf.log;"

def log_json(session: String, +log: String, level: String, +size: U32, +legacy_stderr: U32, +stderr_full: U32, +stderr_meta: U32, +stderr_error: U32, +checkpoint: U32, segments: String) -> String:
  "{\"session\":" ++ J.string_literal(session)
  ++ ",\"path\":" ++ J.string_literal(log)
  ++ ",\"attempt\":" ++ J.string_literal(attempt_of(log))
  ++ ",\"level\":" ++ J.string_literal(level)
  ++ ",\"bytes\":" ++ U32.show(size)
  ++ ",\"legacyStderrBytes\":" ++ U32.show(legacy_stderr)
  ++ ",\"legacyStderrSpoolBytes\":" ++ U32.show(stderr_full)
  ++ ",\"legacyStderrMetadataBytes\":" ++ U32.show(stderr_meta)
  ++ ",\"legacyStderrProcessingErrorBytes\":" ++ U32.show(stderr_error)
  ++ ",\"pendingBytes\":" ++ U32.show(checkpoint)
  ++ ",\"pendingPath\":" ++ J.string_literal(log ++ ".pending")
  ++ ",\"legacySegments\":[" ++ segments ++ "]}"

def log_fields(fields: List<String>) -> IO(String):
  match fields:
    case session <> +log <> level <> rest: do IO<String>:
      size : U32 <- IO.try(U32,F.Files.size(log))
      legacy_stderr : U32 <- IO.try(U32,F.Files.size(log ++ ".stderr"))
      stderr_full : U32 <- IO.try(U32,F.Files.size(log ++ ".stderr.full"))
      stderr_meta : U32 <- IO.try(U32,F.Files.size(log ++ ".stderr.meta"))
      stderr_error : U32 <- IO.try(U32,F.Files.size(log ++ ".stderr.meta.processing-error"))
      checkpoint : U32 <- IO.try(U32,F.Files.size(log ++ ".pending"))
      segments : String <- listed_segments(log)
      IO.pure(String,log_json(session,log,level,size,legacy_stderr,stderr_full,stderr_meta,stderr_error,checkpoint,segments))
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

def attempt_rows_sql(+db: String, +session: String) -> String:
  "SELECT e.session,e.id,e.mode,e.phase,e.status,e.directory,(SELECT count(*) FROM messages WHERE recipient=e.session AND receipt IS NULL),coalesce((SELECT level FROM log_policies WHERE session=e.session),'default'),CASE WHEN EXISTS(SELECT 1 FROM turns t JOIN messages m ON m.id=t.id AND m.sender=t.worker AND m.kind='report' WHERE t.id=e.id AND t.worker=e.session AND e.status='exit 0') OR EXISTS(SELECT 1 FROM session_stops ss JOIN messages m ON m.id=ss.report_id AND m.kind='report' AND m.sender=e.session WHERE ss.session=e.session AND ss.attempt=e.id AND ss.outcome='stopped') THEN 1 ELSE 0 END,CASE WHEN e.directory=" ++ C.q(db ++ ".attempt-") ++ " || lower(hex(e.id)) THEN 1 ELSE 0 END,coalesce((SELECT json_extract(t.event,'$.type') FROM turns t WHERE t.id=e.id),''),coalesce((SELECT length(t.event) FROM turns t WHERE t.id=e.id),'0'),coalesce((SELECT CASE WHEN json_valid(t.event) AND json_type(t.event,'$.messages')='array' THEN json_array_length(t.event,'$.messages') END FROM turns t WHERE t.id=e.id),'0') FROM executions e WHERE (" ++ C.q(session) ++ "='' OR e.session=" ++ C.q(session) ++ ") AND e.directory<>'' ORDER BY e.session,e.directory;"

type AttemptDecision is Data:
  AttemptDecision{reason: String, eligible: Bool}

def attempt_decision_eligible(decision: AttemptDecision) -> Bool:
  match decision:
    case AttemptDecision{reason,eligible}: eligible

def attempt_decision(+stderr_health: String, phase: String, status: String, released: String, acknowledged: String, reported: String, pending: String, level: String, path: String, bytes: U32) -> AttemptDecision:
  Bool.pick(AttemptDecision,Bool.not(Bool.or(String.eq(stderr_health,"ok"),String.eq(stderr_health,"legacy"))),AttemptDecision{stderr_health,False{}},
  Bool.pick(AttemptDecision,Bool.not(String.eq(pending,"0")),AttemptDecision{"pending-input",False{}},
    Bool.pick(AttemptDecision,String.eq(level,"diagnostic"),AttemptDecision{"diagnostic-policy",False{}},
      Bool.pick(AttemptDecision,String.eq(path,"0"),AttemptDecision{"attempt-path-unverified",False{}},
        Bool.pick(AttemptDecision,Bool.not(String.eq(phase,"exited")),AttemptDecision{"native-not-exited",False{}},
          Bool.pick(AttemptDecision,String.eq(released,"0"),AttemptDecision{"native-not-released",False{}},
            Bool.pick(AttemptDecision,String.eq(acknowledged,"0"),AttemptDecision{"native-not-acknowledged",False{}},
              Bool.pick(AttemptDecision,Bool.not(String.eq(status,"exit 0")),AttemptDecision{"native-turn-failed",False{}},
                Bool.pick(AttemptDecision,String.eq(reported,"0"),AttemptDecision{"observation-unreported",False{}},
                  Bool.pick(AttemptDecision,U32.is_lt(0,bytes),AttemptDecision{"eligible",True{}},AttemptDecision{"no-diagnostic-files",False{}}))))))))))

def attempt_json_fields(session: String, attempt: String, mode: String, phase: String, status: String, +directory: String, +stdout: U32, +stderr: U32, +stderr_full: U32, +stderr_meta_bytes: U32, +stderr_error_bytes: U32, +stderr_meta: String, stderr_health: String, +observer: U32, +keeper: U32, released: U32, acknowledged: U32, reported: String, pending: String, terminal: String, event_chars: String, event_messages: String, decision: AttemptDecision) -> String:
  match decision:
    case AttemptDecision{reason,eligible}:
      "{\"session\":" ++ J.string_literal(session)
      ++ ",\"attempt\":" ++ J.string_literal(attempt)
      ++ ",\"mode\":" ++ J.string_literal(mode)
      ++ ",\"phase\":" ++ J.string_literal(phase)
      ++ ",\"status\":" ++ J.string_literal(status)
      ++ ",\"terminalType\":" ++ J.string_literal(terminal)
      ++ ",\"eventChars\":" ++ event_chars
      ++ ",\"eventCount\":" ++ event_messages
      ++ ",\"directory\":" ++ J.string_literal(directory)
      ++ ",\"bytes\":" ++ U32.show(U32.add(stdout,U32.add(stderr,U32.add(stderr_full,U32.add(stderr_meta_bytes,U32.add(stderr_error_bytes,U32.add(observer,keeper)))))))
      ++ ",\"stdoutBytes\":" ++ U32.show(stdout)
      ++ ",\"stderrBytes\":" ++ U32.show(stderr)
      ++ ",\"stderrSpoolBytes\":" ++ U32.show(stderr_full)
      ++ ",\"stderrMetadataBytes\":" ++ U32.show(stderr_meta_bytes)
      ++ ",\"stderrProcessingErrorBytes\":" ++ U32.show(stderr_error_bytes)
      ++ ",\"stderrRetention\":" ++ stderr_meta
      ++ ",\"stderrHealth\":" ++ J.string_literal(stderr_health)
      ++ ",\"observerBytes\":" ++ U32.show(observer)
      ++ ",\"keeperBytes\":" ++ U32.show(keeper)
      ++ ",\"released\":" ++ Bool.pick(String,U32.is_lt(0,released),"true","false")
      ++ ",\"acknowledged\":" ++ Bool.pick(String,U32.is_lt(0,acknowledged),"true","false")
      ++ ",\"reported\":" ++ Bool.pick(String,String.eq(reported,"1"),"true","false")
      ++ ",\"pendingInput\":" ++ pending
      ++ ",\"cleanupEligible\":" ++ Bool.pick(String,eligible,"true","false")
      ++ ",\"cleanupReason\":" ++ J.string_literal(reason) ++ "}"

def stderr_meta_json_read(db: String, text: Result<&1,&1,U32 & String,String>) -> IO(String):
  match text:
    case Fail{error}: IO.pure(String,"{}")
    case Done{+value}: do IO<String>:
      parsed : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(value) ++ ") THEN CASE WHEN json_type(" ++ C.q(value) ++ ")='object' THEN json(" ++ C.q(value) ++ ") ELSE '{}' END ELSE '{}' END;"))
      IO.pure(String,Tx.trim_nl(parsed))

def stderr_meta_json(+db: String, +directory: String) -> IO(String):
  do IO<String>:
    text : Result<&1,&1,U32 & String,String> <- T.Text.read(directory ++ "/stderr.meta")
    result : String <- stderr_meta_json_read(db,text)
    IO.pure(String,result)

def stderr_health(+db: String, +directory: String, +metadata: String) -> IO(String):
  do IO<String>:
    +full : String <- IO.try(String,F.Files.regular(directory ++ "/stderr.full"))
    +meta : String <- IO.try(String,F.Files.regular(directory ++ "/stderr.meta"))
    retained_error : String <- IO.try(String,F.Files.regular(directory ++ "/stderr-processing-error"))
    direct_error : String <- IO.try(String,F.Files.regular(directory ++ "/stderr.meta.processing-error"))
    Bool.pick(IO(String),Bool.or(String.eq(retained_error,"1"),String.eq(direct_error,"1")),IO.pure(String,"processing-error"),
    Bool.pick(IO(String),Bool.and(String.eq(full,"0"),String.eq(meta,"0")),IO.pure(String,"legacy"),
    Bool.pick(IO(String),String.eq(full,"0"),IO.pure(String,"spool-missing"),
    Bool.pick(IO(String),String.eq(meta,"0"),IO.pure(String,"metadata-missing"),do IO<String>:
      valid : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(metadata) ++ ") AND json_type(" ++ C.q(metadata) ++ ")='object' AND json_extract(" ++ C.q(metadata) ++ ",'$.schema')='baton2-stderr-v1' AND json_extract(" ++ C.q(metadata) ++ ",'$.status')='complete'  AND json_type(" ++ C.q(metadata) ++ ",'$.truncated') IN ('true','false') AND json_type(" ++ C.q(metadata) ++ ",'$.observedBytes')='integer' AND json_type(" ++ C.q(metadata) ++ ",'$.retainedBytes')='integer' AND json_type(" ++ C.q(metadata) ++ ",'$.spool')='text' THEN 'ok' ELSE 'metadata-invalid' END;"))
      IO.pure(String,Tx.trim_nl(valid))))))

def stderr_generation_health(+db: String, +stderr_path: String, +metadata: String) -> IO(String):
  do IO<String>:
    +full : String <- IO.try(String,F.Files.regular(stderr_path ++ ".full"))
    +meta : String <- IO.try(String,F.Files.regular(stderr_path ++ ".meta"))
    error : String <- IO.try(String,F.Files.regular(stderr_path ++ ".meta.processing-error"))
    Bool.pick(IO(String),String.eq(error,"1"),IO.pure(String,"processing-error"),
    Bool.pick(IO(String),Bool.and(String.eq(full,"0"),String.eq(meta,"0")),IO.pure(String,"legacy"),
    Bool.pick(IO(String),String.eq(full,"0"),IO.pure(String,"spool-missing"),
    Bool.pick(IO(String),String.eq(meta,"0"),IO.pure(String,"metadata-missing"),do IO<String>:
      valid : String <- IO.try(String,DB.Sql.query(db,"SELECT CASE WHEN json_valid(" ++ C.q(metadata) ++ ") AND json_type(" ++ C.q(metadata) ++ ")='object' AND json_extract(" ++ C.q(metadata) ++ ",'$.schema')='baton2-stderr-v1' AND json_extract(" ++ C.q(metadata) ++ ",'$.status')='complete'  AND json_type(" ++ C.q(metadata) ++ ",'$.truncated') IN ('true','false') AND json_type(" ++ C.q(metadata) ++ ",'$.observedBytes')='integer' AND json_type(" ++ C.q(metadata) ++ ",'$.retainedBytes')='integer' AND json_type(" ++ C.q(metadata) ++ ",'$.spool')='text' THEN 'ok' ELSE 'metadata-invalid' END;"))
      IO.pure(String,Tx.trim_nl(valid))))))

def stderr_generation(+db: String, +stderr_path: String) -> IO(String):
  do IO<String>:
    text : Result<&1,&1,U32 & String,String> <- T.Text.read(stderr_path ++ ".meta")
    metadata : String <- stderr_meta_json_read(db,text)
    stderr_generation_health(db,stderr_path,metadata)

def attempt_json(session: String, attempt: String, mode: String, +phase: String, +status: String, +directory: String, +stdout: U32, +stderr: U32, +stderr_full: U32, +stderr_meta_bytes: U32, +stderr_error_bytes: U32, +stderr_meta: String, +stderr_health: String, +observer: U32, +keeper: U32, +released: U32, +acknowledged: U32, +reported: String, +pending: String, +terminal: String, +event_chars: String, +event_messages: String, level: String, path: String) -> String:
  attempt_json_fields(session,attempt,mode,phase,status,directory,stdout,stderr,stderr_full,stderr_meta_bytes,stderr_error_bytes,stderr_meta,stderr_health,observer,keeper,released,acknowledged,reported,pending,terminal,event_chars,event_messages,attempt_decision(stderr_health,phase,status,Bool.pick(String,U32.is_lt(0,released),"1","0"),Bool.pick(String,U32.is_lt(0,acknowledged),"1","0"),reported,pending,level,path,U32.add(stdout,U32.add(stderr,U32.add(stderr_full,U32.add(stderr_meta_bytes,U32.add(stderr_error_bytes,U32.add(observer,keeper)))))) ))

def attempt_fields(+db: String, fields: List<String>) -> IO(String):
  match fields:
    case session <> attempt <> mode <> phase <> status <> +directory <> pending <> level <> reported <> path <> terminal <> event_chars <> event_messages <> rest: do IO<String>:
      stdout : U32 <- IO.try(U32,F.Files.size(directory ++ "/stdout"))
      stderr : U32 <- IO.try(U32,F.Files.size(directory ++ "/native.stderr"))
      stderr_full : U32 <- IO.try(U32,F.Files.size(directory ++ "/stderr.full"))
      stderr_meta_bytes : U32 <- IO.try(U32,F.Files.size(directory ++ "/stderr.meta"))
      stderr_error_bytes : U32 <- IO.try(U32,F.Files.size(directory ++ "/stderr-processing-error"))
      +stderr_meta : String <- stderr_meta_json(db,directory)
      health : String <- stderr_health(db,directory,stderr_meta)
      observer : U32 <- IO.try(U32,F.Files.size(directory ++ "/observer.log"))
      keeper : U32 <- IO.try(U32,F.Files.size(directory ++ "/keeper.log"))
      released_file : String <- IO.try(String,F.Files.regular(directory ++ "/released"))
      acknowledged_file : String <- IO.try(String,F.Files.regular(directory ++ "/acknowledged"))
      released : U32 = number_of(U32.read(Bool.pick(String,String.eq(released_file,"1"),"1","0")),0)
      acknowledged : U32 = number_of(U32.read(Bool.pick(String,String.eq(acknowledged_file,"1"),"1","0")),0)
      IO.pure(String,attempt_json(session,attempt,mode,phase,status,directory,stdout,stderr,stderr_full,stderr_meta_bytes,stderr_error_bytes,stderr_meta,health,observer,keeper,released,acknowledged,reported,pending,terminal,event_chars,event_messages,level,path))
    case other: IO.pure(String,"")

def attempt_item(+db: String, row: String) -> IO(String):
  attempt_fields(db,Tx.split_tabs(row))

def attempt_items(+db: String, rows: List<String>, acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      item : String <- attempt_item(db,head)
      deeper : String <- attempt_items(db,tail,items_join(acc,item))
      IO.pure(String,deeper)

def stderr_run_json(+db: String, fields: List<String>) -> IO(String):
  match fields:
    case session <> attempt <> run <> +generation <> +stderr_path <> rest: do IO<String>:
      +stderr : U32 <- IO.try(U32,F.Files.size(stderr_path))
      +spool : U32 <- IO.try(U32,F.Files.size(stderr_path ++ ".full"))
      +meta_bytes : U32 <- IO.try(U32,F.Files.size(stderr_path ++ ".meta"))
      +error_bytes : U32 <- IO.try(U32,F.Files.size(stderr_path ++ ".meta.processing-error"))
      text : Result<&1,&1,U32 & String,String> <- T.Text.read(stderr_path ++ ".meta")
      +metadata : String <- stderr_meta_json_read(db,text)
      +raw_health : String <- stderr_generation_health(db,stderr_path,metadata)
      health : String <- IO.pure(String,Bool.pick(String,String.eq(raw_health,"legacy"),"run-artifacts-absent",raw_health))
      IO.pure(String,"{\"session\":" ++ J.string_literal(session) ++ ",\"attempt\":" ++ J.string_literal(attempt) ++ ",\"run\":" ++ run ++ ",\"generation\":" ++ J.string_literal(generation) ++ ",\"stderr\":" ++ J.string_literal(stderr_path) ++ ",\"stderrBytes\":" ++ U32.show(stderr) ++ ",\"spoolBytes\":" ++ U32.show(spool) ++ ",\"metadataBytes\":" ++ U32.show(meta_bytes) ++ ",\"processingErrorBytes\":" ++ U32.show(error_bytes) ++ ",\"accountedBytes\":" ++ U32.show(U32.add(stderr,U32.add(spool,U32.add(meta_bytes,error_bytes)))) ++ ",\"health\":" ++ J.string_literal(health) ++ ",\"metadata\":" ++ metadata ++ "}")
    case other: IO.pure(String,"")

def stderr_run_items(+db: String, rows: List<String>, acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      item : String <- stderr_run_json(db,Tx.split_tabs(head))
      rest : String <- stderr_run_items(db,tail,items_join(acc,item))
      IO.pure(String,rest)

def stderr_run_rows_sql() -> String:
  "SELECT session,attempt,run,generation,stderr FROM log_stderr_runs ORDER BY session,attempt,run;"

def storage_json(db: String, database: U32, root: U32, logs: String, attempts: String, stderr_runs: String) -> String:
  "{\"database\":" ++ J.string_literal(db)
  ++ ",\"databaseBytes\":" ++ U32.show(database)
  ++ ",\"rootLogBytes\":" ++ U32.show(root)
  ++ ",\"defaults\":{\"level\":" ++ J.string_literal(default_level()) ++ "}"
  ++ ",\"logs\":[" ++ logs ++ "]"
  ++ ",\"attempts\":[" ++ attempts ++ "]"
  ++ ",\"stderrRuns\":[" ++ stderr_runs ++ "]}"

# Inspects registered artifact paths and cleanup candidates. The policy schema
# is initialized or migrated before the read.
def storage(+db: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Schema.ensure(db)
    log_text : String <- IO.try(String,DB.Sql.query(db,schema() ++ log_rows_sql()))
    logs : String <- log_items(Tx.split_lines(log_text),"")
    attempt_text : String <- IO.try(String,DB.Sql.query(db,attempt_rows_sql(db,"")))
    attempts : String <- attempt_items(db,Tx.split_lines(attempt_text),"")
    run_text : String <- IO.try(String,DB.Sql.query(db,stderr_runs_schema() ++ stderr_run_rows_sql()))
    stderr_runs : String <- stderr_run_items(db,Tx.split_lines(run_text),"")
    database : U32 <- IO.try(U32,F.Files.size(db))
    root : U32 <- IO.try(U32,F.Files.size(db ++ ".root.log"))
    IO.pure(String,storage_json(db,database,root,logs,attempts,stderr_runs))

def clean_pending_sql(+session: String) -> String:
  "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL;"

def clean_json(session: String, removed: String, attempt_files: String, attempt_logs: String) -> String:
  "{\"session\":" ++ J.string_literal(session) ++ ",\"removed\":[" ++ removed ++ "],\"attemptFiles\":[" ++ attempt_files ++ "],\"attemptLogs\":[" ++ attempt_logs ++ "]}"

# A finished attempt's generation file is the derived view of that attempt's
# output, so it leaves under the same decision that releases the attempt's
# retained diagnostics: exited, released, acknowledged, reported, exit 0, no
# pending input, no diagnostic policy. The base live log is never a candidate,
# and an unknown attempt identity keeps its file. An empty stale checkpoint
# sidecar leaves with its generation; a nonempty one stays visible in the
# storage report, and the native stderr sidecar stays in the retained-output
# lane.
def attempt_first(first: AttemptDecision, rest: AttemptDecision) -> AttemptDecision:
  match first:
    case AttemptDecision{+reason, eligible}: Bool.pick(AttemptDecision,String.eq(reason,"unknown-attempt"),rest,AttemptDecision{reason, eligible})

def attempt_log_matched(matched: Bool, +db: String, +phase: String, +status: String, +directory: String, +pending: String, +level: String, +reported: String, +path: String, live: U32) -> IO(AttemptDecision):
  match matched:
    case True{}: do IO<AttemptDecision>:
      released_file : String <- IO.try(String,F.Files.regular(directory ++ "/released"))
      acknowledged_file : String <- IO.try(String,F.Files.regular(directory ++ "/acknowledged"))
      released : String = Bool.pick(String,String.eq(released_file,"1"),"1","0")
      acknowledged : String = Bool.pick(String,String.eq(acknowledged_file,"1"),"1","0")
      metadata : String <- stderr_meta_json(db,directory)
      health : String <- stderr_health(db,directory,metadata)
      IO.pure(AttemptDecision,attempt_decision(health,phase,status,released,acknowledged,reported,pending,level,path,live))
    case False{}: IO.pure(AttemptDecision,AttemptDecision{"unknown-attempt",False{}})

def attempt_log_fields(+db: String, fields: List<String>, +attempt: String, live: U32) -> IO(AttemptDecision):
  match fields:
    case session <> +id <> mode <> phase <> status <> +directory <> pending <> level <> reported <> path <> rest:
      attempt_log_matched(Bool.or(String.eq(id,attempt),String.eq(attempt_code(id),attempt)),db,phase,status,directory,pending,level,reported,path,live)
    case other: IO.pure(AttemptDecision,AttemptDecision{"unknown-attempt",False{}})

def attempt_log_row(+db: String, row: String, +attempt: String, live: U32) -> IO(AttemptDecision):
  attempt_log_fields(db,Tx.split_tabs(row),attempt,live)

def attempt_log_rows(+db: String, rows: List<String>, +attempt: String, +live: U32) -> IO(AttemptDecision):
  match rows:
    case Nil{}: IO.pure(AttemptDecision,AttemptDecision{"unknown-attempt",False{}})
    case head <> tail: do IO<AttemptDecision>:
      decision : AttemptDecision <- attempt_log_row(db,head,attempt,live)
      rest : AttemptDecision <- attempt_log_rows(db,tail,attempt,live)
      IO.pure(AttemptDecision,attempt_first(decision,rest))

def clean_attempt_log_json(+log: String, +attempt: String, size: U32, gone: Result<&1,&1,U32 & String,Unit>) -> String:
  match gone:
    case Fail{(code,text)}:
      "{\"path\":" ++ J.string_literal(log) ++ ",\"attempt\":" ++ J.string_literal(attempt) ++ ",\"bytes\":" ++ U32.show(size) ++ ",\"removed\":false,\"error\":" ++ J.string_literal(U32.show(code) ++ ": " ++ text) ++ "}"
    case Done{unit}:
      "{\"path\":" ++ J.string_literal(log) ++ ",\"attempt\":" ++ J.string_literal(attempt) ++ ",\"bytes\":" ++ U32.show(size) ++ ",\"removed\":true}"

def clean_attempt_sidecar_remove(+log: String) -> IO(String):
  do IO<String>:
    gone : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(log ++ ".pending")
    IO.pure(String,clean_attempt_log_json(log ++ ".pending","",0,gone))

def clean_attempt_sidecar(+log: String) -> IO(String):
  do IO<String>:
    checkpoint : U32 <- IO.try(U32,F.Files.size(log ++ ".pending"))
    answer : String <- Bool.pick(IO(String),U32.is_lt(0,checkpoint),IO.pure(String,""),clean_attempt_sidecar_remove(log))
    IO.pure(String,answer)

def clean_attempt_log_removed(+log: String, +attempt: String, size: U32) -> IO(String):
  do IO<String>:
    gone : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(log)
    sidecar : String <- clean_attempt_sidecar(log)
    IO.pure(String,items_join(clean_attempt_log_json(log,attempt,size,gone),sidecar))

def clean_attempt_stderr(+log: String, +attempt: String) -> IO(String):
  do IO<String>:
    stderr : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(log ++ ".stderr")
    full : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(log ++ ".stderr.full")
    meta : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(log ++ ".stderr.meta")
    IO.pure(String,items_join(clean_attempt_log_json(log ++ ".stderr",attempt,0,stderr),items_join(clean_attempt_log_json(log ++ ".stderr.full",attempt,0,full),clean_attempt_log_json(log ++ ".stderr.meta",attempt,0,meta))))

def clean_attempt_log_eligible(eligible: Bool, +log: String, +attempt: String, size: U32) -> IO(String):
  match eligible:
    case False{}: IO.pure(String,"")
    case True{}: clean_attempt_log_removed(log,attempt,size)

def superseded_reported(+session: String, +attempt: String) -> String:
  "CASE WHEN EXISTS(SELECT 1 FROM turns t JOIN messages m ON m.id=t.id AND m.sender=t.worker AND m.kind=" ++ C.q("report") ++ " WHERE t.id=" ++ C.q(attempt) ++ " AND t.worker=" ++ C.q(session) ++ ") OR EXISTS(SELECT 1 FROM session_stops ss JOIN messages m ON m.id=ss.report_id AND m.kind=" ++ C.q("report") ++ " AND m.sender=" ++ C.q(session) ++ " WHERE ss.session=" ++ C.q(session) ++ " AND ss.attempt=" ++ C.q(attempt) ++ " AND ss.outcome=" ++ C.q("stopped") ++ ") THEN 1 ELSE 0 END"

def superseded_info_sql(+db: String, +session: String, +attempt: String) -> String:
  "SELECT (SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL),coalesce((SELECT level FROM log_policies WHERE session=" ++ C.q(session) ++ ")," ++ C.q("default") ++ ")," ++ superseded_reported(session,attempt) ++ "," ++ C.q(db) ++ " || " ++ C.q(".attempt-") ++ " || lower(hex(" ++ C.q(attempt) ++ "));"

# A superseded generation leaves under exit, report, and acknowledgement. The
# executions row is gone with its process status, so this decision does not
# restate it: supersession itself proves the session moved on, the report rows
# prove the outcome was delivered, and the markers prove custody released and
# acknowledged. The newest generation never reaches this decision.
def superseded_decision(pending: String, level: String, reported: String, released: String, acknowledged: String, bytes: U32) -> AttemptDecision:
  Bool.pick(AttemptDecision,Bool.not(String.eq(pending,"0")),AttemptDecision{"pending-input",False{}},
    Bool.pick(AttemptDecision,String.eq(level,"diagnostic"),AttemptDecision{"diagnostic-policy",False{}},
      Bool.pick(AttemptDecision,Bool.not(String.eq(reported,"1")),AttemptDecision{"observation-unreported",False{}},
        Bool.pick(AttemptDecision,String.eq(released,"0"),AttemptDecision{"native-not-released",False{}},
          Bool.pick(AttemptDecision,String.eq(acknowledged,"0"),AttemptDecision{"native-not-acknowledged",False{}},
            Bool.pick(AttemptDecision,U32.is_lt(0,bytes),AttemptDecision{"eligible",True{}},AttemptDecision{"no-diagnostic-files",False{}}))))))

def superseded_eligible(decision: AttemptDecision) -> Bool:
  match decision:
    case AttemptDecision{reason, eligible}: eligible

def clean_attempt_log_first(rows: List<String>) -> String:
  match rows:
    case head <> tail: head
    case other: ""

def clean_stderr_run_file(+db: String, +attempt: String, +stderr_path: String) -> IO(String):
  do IO<String>:
    health : String <- stderr_generation(db,stderr_path)
    Bool.pick(IO(String),String.eq(health,"legacy"),do IO<String>:
      stderr_size : U32 <- IO.try(U32,F.Files.size(stderr_path))
      stderr : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(stderr_path)
      IO.pure(String,clean_attempt_log_json(stderr_path,attempt,stderr_size,stderr)),
    Bool.pick(IO(String),String.eq(health,"ok"),do IO<String>:
      stderr_size : U32 <- IO.try(U32,F.Files.size(stderr_path))
      spool_size : U32 <- IO.try(U32,F.Files.size(stderr_path ++ ".full"))
      meta_size : U32 <- IO.try(U32,F.Files.size(stderr_path ++ ".meta"))
      stderr : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(stderr_path)
      spool : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(stderr_path ++ ".full")
      meta : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(stderr_path ++ ".meta")
      IO.pure(String,items_join(clean_attempt_log_json(stderr_path,attempt,stderr_size,stderr),items_join(clean_attempt_log_json(stderr_path ++ ".full",attempt,spool_size,spool),clean_attempt_log_json(stderr_path ++ ".meta",attempt,meta_size,meta)))),IO.pure(String,"")))

def clean_stderr_run_items(+db: String, +attempt: String, rows: List<String>, acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      cleaned : String <- clean_stderr_run_file(db,attempt,Tx.trim_nl(head))
      rest : String <- clean_stderr_run_items(db,attempt,tail,items_join(acc,cleaned))
      IO.pure(String,rest)

def clean_stderr_run_rows(+db: String, +session: String, +attempt: String) -> IO(String):
  do IO<String>:
    rows : String <- IO.try(String,DB.Sql.query(db,"SELECT stderr FROM log_stderr_runs WHERE session=" ++ C.q(session) ++ " AND attempt=" ++ C.q(attempt) ++ " ORDER BY run;"))
    cleaned : String <- clean_stderr_run_items(db,attempt,Tx.split_lines(rows),"")
    IO.pure(String,cleaned)

def clean_attempt_settled_fields(+db: String, +session: String, fields: List<String>, +log: String, +attempt: String, +size: U32) -> IO(String):
  match fields:
    case pending <> level <> reported <> +directory <> rest: do IO<String>:
      released_file : String <- IO.try(String,F.Files.regular(directory ++ "/released"))
      acknowledged_file : String <- IO.try(String,F.Files.regular(directory ++ "/acknowledged"))
      released : String = Bool.pick(String,String.eq(released_file,"1"),"1","0")
      acknowledged : String = Bool.pick(String,String.eq(acknowledged_file,"1"),"1","0")
      health : String <- stderr_generation(db,log ++ ".stderr")
      +decision : Bool <- IO.pure(Bool,superseded_eligible(superseded_decision(pending,level,reported,released,acknowledged,size)))
      answer : String <- clean_attempt_log_eligible(decision,log,attempt,size)
      legacy_capture_files : String <- Bool.pick(IO(String),Bool.and(decision,String.eq(health,"ok")),clean_attempt_stderr(log,attempt),IO.pure(String,""))
      run_files : String <- Bool.pick(IO(String),decision,clean_stderr_run_rows(db,session,attempt),IO.pure(String,""))
      IO.pure(String,items_join(answer,items_join(legacy_capture_files,run_files)))
    case other: IO.pure(String,"")

def clean_attempt_settled(+db: String, +session: String, info: String, +log: String, +attempt: String, size: U32) -> IO(String):
  clean_attempt_settled_fields(db,session,Tx.split_tabs(clean_attempt_log_first(Tx.split_lines(info))),log,attempt,size)

def clean_attempt_older(older: Bool, +db: String, +session: String, +log: String, +attempt: String, +size: U32) -> IO(String):
  match older:
    case False{}: IO.pure(String,"")
    case True{}: do IO<String>:
      info : String <- IO.try(String,DB.Sql.query(db,superseded_info_sql(db,session,attempt)))
      answer : String <- clean_attempt_settled(db,session,info,log,attempt,size)
      IO.pure(String,answer)

def clean_attempt_superseded(known: Bool, +older: Bool, +db: String, +session: String, +log: String, +attempt: String, +size: U32) -> IO(String):
  match known:
    case False{}: IO.pure(String,"")
    case True{}: clean_attempt_older(older,db,session,log,attempt,size)

def clean_attempt_reason(unknown: Bool, eligible: Bool, +log: String, +attempt: String, +size: U32, +db: String, +session: String, +newest: String, registered: Bool) -> IO(String):
  match unknown:
    case True{}: clean_attempt_superseded(registered,Bool.not(String.eq(newest,"1")),db,session,log,attempt,size)
    case False{}: clean_attempt_log_eligible(eligible,log,attempt,size)

def clean_attempt_log_decided(+log: String, +attempt: String, +size: U32, decision: AttemptDecision, +db: String, +session: String, +newest: String, registered: Bool) -> IO(String):
  match decision:
    case AttemptDecision{+why, eligible}: clean_attempt_reason(String.eq(why,"unknown-attempt"),eligible,log,attempt,size,db,session,newest,registered)

def clean_attempt_named(empty: Bool, +db: String, +session: String, +log: String, +attempt: String, +newest: String, registered: Bool) -> IO(String):
  match empty:
    case True{}: IO.pure(String,"")
    case False{}: do IO<String>:
      +live : U32 <- IO.try(U32,F.Files.size(log))
      rows : String <- IO.try(String,DB.Sql.query(db,attempt_rows_sql(db,session)))
      decision : AttemptDecision <- attempt_log_rows(db,Tx.split_lines(rows),attempt,live)
      answer : String <- clean_attempt_log_decided(log,attempt,live,decision,db,session,newest,registered)
      IO.pure(String,answer)

def clean_attempt_legacy(+db: String, +session: String, +log: String) -> IO(String):
  clean_attempt_named(String.is_empty(attempt_of(log)),db,session,log,attempt_of(log),"0",False{})

def clean_attempt_known(known: Bool, +db: String, +session: String, +log: String, +reg: String, +newest: String) -> IO(String):
  match known:
    case True{}: clean_attempt_named(False{},db,session,log,reg,newest,True{})
    case False{}: clean_attempt_legacy(db,session,log)

def clean_attempt_log(+db: String, +session: String, +log: String, +reg_attempt: String, +reg_newest: String) -> IO(String):
  clean_attempt_known(Bool.not(String.is_empty(reg_attempt)),db,session,log,reg_attempt,reg_newest)

# The registry names the attempt each generation file was opened for, and how
# many later generations the session registered. A file with no registry row
# keeps the legacy suffix fallback; the newest generation is never a removal
# candidate even when its live attempt row is already gone.
def clean_attempt_reg_sql(+db: String, +session: String, +log: String) -> String:
  "SELECT coalesce((SELECT g.attempt FROM log_generations g WHERE g.session=" ++ C.q(session) ++ " AND g.log=" ++ C.q(log) ++ ")," ++ C.q("") ++ "),(SELECT count(*) FROM log_generations g WHERE g.session=" ++ C.q(session) ++ " AND g.rowid>coalesce((SELECT g2.rowid FROM log_generations g2 WHERE g2.session=" ++ C.q(session) ++ " AND g2.log=" ++ C.q(log) ++ "),0));"

def clean_attempt_log_reg_fields(fields: List<String>, +db: String, +session: String, +log: String) -> IO(String):
  match fields:
    case attempt <> newer <> rest: clean_attempt_log(db,session,log,attempt,Bool.pick(String,String.eq(newer,"0"),"1","0"))
    case newer <> rest: clean_attempt_legacy(db,session,log)
    case other: IO.pure(String,"")

def clean_attempt_log_reg(info: String, +db: String, +session: String, +log: String) -> IO(String):
  clean_attempt_log_reg_fields(Tx.split_tabs(clean_attempt_log_first(Tx.split_lines(info))),db,session,log)

def clean_attempt_log_row(+db: String, +session: String, +log: String) -> IO(String):
  do IO<String>:
    reg : String <- IO.try(String,DB.Sql.query(db,clean_attempt_reg_sql(db,session,log)))
    answer : String <- clean_attempt_log_reg(reg,db,session,log)
    IO.pure(String,answer)

def clean_attempt_log_fields(+db: String, +session: String, fields: List<String>) -> IO(String):
  match fields:
    case +log <> rest: clean_attempt_log_row(db,session,log)
    case other: IO.pure(String,"")

def clean_attempt_log_rows(+db: String, +session: String, rows: List<String>, acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      item : String <- clean_attempt_log_fields(db,session,Tx.split_tabs(head))
      deeper : String <- clean_attempt_log_rows(db,session,tail,items_join(acc,item))
      IO.pure(String,deeper)

def clean_attempt_logs(+db: String, +session: String) -> IO(String):
  do IO<String>:
    rows : String <- IO.try(String,DB.Sql.query(db,clean_sql(session)))
    listed : String <- clean_attempt_log_rows(db,session,Tx.split_lines(rows),"")
    IO.pure(String,listed)

def attempt_cleanup_result(name: String, size: U32, result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{(code,text)}: "{\"file\":" ++ J.string_literal(name) ++ ",\"removed\":false,\"error\":" ++ J.string_literal(U32.show(code) ++ ": " ++ text) ++ "}"
    case Done{state}: "{\"file\":" ++ J.string_literal(name) ++ ",\"bytes\":" ++ U32.show(size) ++ ",\"removed\":" ++ Bool.pick(String,String.eq(state,"removed"),"true","false") ++ "}"

def attempt_cleanup_file(db: String, +directory: String, +name: String) -> IO(String):
  do IO<String>:
    size : U32 <- IO.try(U32,F.Files.size(directory ++ "/" ++ name))
    result : Result<&1,&1,U32 & String,String> <- F.Files.remove_attempt_file(db,directory,name)
    IO.pure(String,attempt_cleanup_result(name,size,result))

def attempt_cleanup_files(+db: String, +directory: String) -> IO(String):
  do IO<String>:
    stdout : String <- attempt_cleanup_file(db,directory,"stdout")
    stderr : String <- attempt_cleanup_file(db,directory,"native.stderr")
    stderr_full : String <- attempt_cleanup_file(db,directory,"stderr.full")
    stderr_meta : String <- attempt_cleanup_file(db,directory,"stderr.meta")
    stderr_error : String <- attempt_cleanup_file(db,directory,"stderr-processing-error")
    observer : String <- attempt_cleanup_file(db,directory,"observer.log")
    keeper : String <- attempt_cleanup_file(db,directory,"keeper.log")
    IO.pure(String,items_join(stdout,items_join(stderr,items_join(stderr_full,items_join(stderr_meta,items_join(stderr_error,items_join(observer,keeper)))))) )

def attempt_cleanup_fields(+db: String, fields: List<String>) -> IO(String):
  match fields:
    case session <> attempt <> mode <> phase <> status <> +directory <> pending <> level <> reported <> path <> rest: do IO<String>:
      released_file : String <- IO.try(String,F.Files.regular(directory ++ "/released"))
      acknowledged_file : String <- IO.try(String,F.Files.regular(directory ++ "/acknowledged"))
      stdout : U32 <- IO.try(U32,F.Files.size(directory ++ "/stdout"))
      stderr : U32 <- IO.try(U32,F.Files.size(directory ++ "/native.stderr"))
      stderr_full : U32 <- IO.try(U32,F.Files.size(directory ++ "/stderr.full"))
      stderr_meta : U32 <- IO.try(U32,F.Files.size(directory ++ "/stderr.meta"))
      metadata : String <- stderr_meta_json(db,directory)
      health : String <- stderr_health(db,directory,metadata)
      observer : U32 <- IO.try(U32,F.Files.size(directory ++ "/observer.log"))
      keeper : U32 <- IO.try(U32,F.Files.size(directory ++ "/keeper.log"))
      released : String = Bool.pick(String,String.eq(released_file,"1"),"1","0")
      acknowledged : String = Bool.pick(String,String.eq(acknowledged_file,"1"),"1","0")
      error_bytes : U32 <- IO.try(U32,F.Files.size(directory ++ "/stderr-processing-error"))
      bytes : U32 = U32.add(stdout,U32.add(stderr,U32.add(stderr_full,U32.add(stderr_meta,U32.add(error_bytes,U32.add(observer,keeper)))) ))
      eligible : Bool = attempt_decision_eligible(attempt_decision(health,phase,status,released,acknowledged,reported,pending,level,path,bytes))
      files : String <- Bool.pick(IO(String),eligible,do IO<String>:
        attempt_files : String <- attempt_cleanup_files(db,directory)
        stderr_runs : String <- clean_stderr_run_rows(db,session,attempt)
        IO.pure(String,items_join(attempt_files,stderr_runs)),IO.pure(String,""))
      IO.pure(String,files)
    case other: IO.pure(String,"")

def attempt_cleanup_row(db: String, row: String) -> IO(String):
  attempt_cleanup_fields(db,Tx.split_tabs(row))

def attempt_cleanup_rows(+db: String, rows: List<String>, acc: String) -> IO(String):
  match rows:
    case Nil{}: IO.pure(String,acc)
    case head <> tail: do IO<String>:
      item : String <- attempt_cleanup_row(db,head)
      deeper : String <- attempt_cleanup_rows(db,tail,items_join(acc,item))
      IO.pure(String,deeper)

def clean_attempts(+db: String, session: String) -> IO(String):
  do IO<String>:
    rows : String <- IO.try(String,DB.Sql.query(db,attempt_rows_sql(db,session)))
    removed : String <- attempt_cleanup_rows(db,Tx.split_lines(rows),"")
    IO.pure(String,removed)

def clean_skipped(session: String, pending: String) -> String:
  "{\"session\":" ++ J.string_literal(session) ++ ",\"removed\":[],\"attemptFiles\":[],\"pendingInput\":" ++ pending ++ ",\"skipped\":\"pending-input\"}"

def unknown_session(session: String) -> String:
  "{\"error\":\"unknown-session\",\"session\":" ++ J.string_literal(session) ++ ",\"next\":\"Read session ID; recruit or attach the session before cleaning its logs.\"}"

# A refused log command names its rule on stderr with status 2, as the stored
# commands do.
def refused(+saved: String) -> Bool:
  Bool.or(Tx.starts_with(saved,"{\"error\":\"invalid-log-setting\""),Tx.starts_with(saved,"{\"error\":\"unknown-session\""))

def cleaned(+db: String, +session: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- generations_ensure(db)
    attempt_removed : String <- clean_attempts(db,session)
    attempt_logs : String <- clean_attempt_logs(db,session)
    IO.pure(String,clean_json(session,"",attempt_removed,attempt_logs))

def clean_known(db: String, +session: String, +pending: String) -> IO(String):
  Bool.pick(IO(String),String.eq(pending,"0"),cleaned(db,session),IO.pure(String,clean_skipped(session,pending)))

def clean_busy(session: String) -> String:
  "{\"session\":" ++ J.string_literal(session) ++ ",\"removed\":[],\"skipped\":\"session-busy\"}"

# The decision and the unlink happen under the session's own lock, so a turn
# that starts while cleanup runs takes the log for itself first and a cleanup
# that loses the race removes nothing.
def clean_owned(+db: String, +session: String, lock: Maybe<U32>) -> IO(String):
  match lock:
    case None{}: IO.pure(String,clean_busy(session))
    case Some{handle}: do IO<String>:
      +fresh : String <- pending_count(db,session)
      answer : String <- clean_known(db,session,fresh)
      released : Unit <- IO.try(Unit,Lock.SessionLock.release(handle))
      IO.pure(String,answer)

def clean_started(+db: String, +session: String) -> IO(String):
  Lock.SessionLock.acquire_session(String,db,session, +database => lock => clean_owned(database,session,lock))

# Explicit cleanup removes eligible completed attempt artifacts for the named
# session. Public log files and historical numbered segments remain intact.
def clean(+db: String, +session: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Schema.ensure(db)
    +present : String <- IO.try(String,DB.Sql.query(db,schema() ++ "SELECT count(*) FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    answer : String <- Bool.pick(IO(String),String.eq(Tx.trim_nl(present),"1"),clean_started(db,session),IO.pure(String,unknown_session(session)))
    IO.pure(String,answer)
