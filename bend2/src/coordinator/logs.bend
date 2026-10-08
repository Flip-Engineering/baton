import Base
import ./commands.bend as C
import ./log-schema.bend as Schema
import ../host/sqlite.bend as DB
import ../host/text.bend as T
import ../host/files.bend as F
import ../git/text.bend as Tx
import ../host/session-lock.bend as Lock
import ../json/canonical.bend as J

# Baton2-owned log level policy, registered log inspection and attempt cleanup.
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
# The retained native conversation store, the retained attempt directory, the
# SQLite records and every harness history outside this registry are separate
# owners. Explicit cleanup writes only attempt files allowed by the registry.

def default_level() -> String:
  "default"

def schema() -> String:
  Schema.tables()

type Policy is Data:
  Policy{level: String}

def fallback_level(+value: String) -> String:
  Bool.pick(String,String.is_empty(value),default_level(),value)

def number_of(value: Maybe<&2,U32>, fallback: U32) -> U32:
  match value:
    case None{}: fallback
    case Some{found}: found

def policy_fields(fields: List<String>) -> Policy:
  match fields:
    case level <> rest: Policy{fallback_level(level)}
    case other: Policy{default_level()}

def policy_row(row: String) -> Policy:
  policy_fields(Tx.split_tabs(row))

def pending_sql(+session: String) -> String:
  "SELECT count(*) FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL;"

# Unacknowledged input protects evidence from explicit attempt cleanup.
def pending_count(db: String, session: String) -> IO(String):
  do IO<String>:
    found : String <- IO.try(String,DB.Sql.query(db,pending_sql(session)))
    IO.pure(String,Tx.trim_nl(found))

def policy_sql(+session: String) -> String:
  "SELECT coalesce((SELECT level FROM log_policies WHERE session=" ++ C.q(session) ++ "),'');"

# The effective policy: a session without a stored row runs the defaults.
def policy(+db: String, +session: String) -> IO(Policy):
  do IO<Policy>:
    ensured : Unit <- Schema.ensure(db)
    row : String <- IO.try(String,DB.Sql.query(db,schema() ++ policy_sql(session)))
    IO.pure(Policy,policy_row(Tx.trim_nl(row)))

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
  ++ "SELECT json_object('error','unknown-session','session'," ++ C.q(session) ++ ",'next','Read session ID; recruit or attach the session before setting its log policy.') WHERE NOT " ++ known(session) ++ ";"
  ++ "SELECT json_object('error','invalid-log-setting','session'," ++ C.q(session) ++ ",'level'," ++ C.q(level) ++ ",'condition','A level is quiet, default or diagnostic.','next','Read logs SESSION for the stored level and use quiet, default or diagnostic.') WHERE " ++ known(session) ++ " AND NOT " ++ level_admitted(level) ++ ";"
  ++ "SELECT json_object('session',session,'level',level,'registeredLogs',(SELECT count(*) FROM log_files WHERE session=log_policies.session)) FROM log_policies WHERE session=" ++ C.q(session) ++ " AND " ++ level_admitted(level) ++ ";"

def write(+db: String, session: String, level: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Schema.ensure(db)
    saved : String <- IO.try(String,DB.Sql.query(db,"BEGIN IMMEDIATE;" ++ schema() ++ write_sql(session,level) ++ "COMMIT;"))
    IO.pure(String,Tx.trim_nl(saved))

# `logs SESSION` reads the effective level; `logs SESSION LEVEL` stores one.
def apply(+db: String, +session: String, +level: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(level),read(db,session),write(db,session,level))

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
    case Policy{+level}: step_choose_step(String.eq(level,"diagnostic"),level,kind,id,line,held)

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

def items_join(+items: String, +item: String) -> String:
  Bool.pick(String,String.is_empty(item),items,Bool.pick(String,String.is_empty(items),item,items ++ "," ++ item))

def write_one(+log: String, line: String, first: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match first:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,Unit>,Fail{error})
    case Done{unit}: do IO<Result<&1,&1,U32 & String,Unit>>:
      +size : U32 <- IO.try(U32,F.Files.size(log))
      written : Result<&1,&1,U32 & String,Unit> <- append_text(log,line,size)
      IO.pure(Result<&1,&1,U32 & String,Unit>,written)

# Writes the lines a frame contributes, in order, and keeps the first failure.
def write_each(+log: String, lines: List<String>, first: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  match lines:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,Unit>,first)
    case Con{head, tail}: do IO<Result<&1,&1,U32 & String,Unit>>:
      written : Result<&1,&1,U32 & String,Unit> <- write_one(log,head,first)
      rest : Result<&1,&1,U32 & String,Unit> <- write_each(log,tail,written)
      IO.pure(Result<&1,&1,U32 & String,Unit>,rest)

# A nonempty frame batch is appended in order to the registered public log.
def write_batch(+log: String, lines: List<String>, first: Result<&1,&1,U32 & String,Unit>) -> IO(Result<&1,&1,U32 & String,Unit>):
  write_each(log,lines,first)

# A log that already failed this turn writes nothing further, so one unwritable
# or full file is reported once and no frame is retried into it.
def write_lines(log: String, lines: List<String>, stopped: Bool) -> IO(Result<&1,&1,U32 & String,Unit>):
  match stopped:
    case True{}: IO.pure(Result<&1,&1,U32 & String,Unit>,Done{Unit{}})
    case False{}: write_batch(log,lines,Done{Unit{}})

# The public log a turn writes is named once, so storage inspection and cleanup
# find every file this policy covers.
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

def log_rows_sql() -> String:
  "SELECT lf.session,lf.log,coalesce((SELECT level FROM log_policies WHERE session=lf.session)," ++ C.q(default_level()) ++ "),(SELECT count(*) FROM messages WHERE recipient=lf.session AND receipt IS NULL) FROM log_files lf ORDER BY lf.session,lf.log;"

def log_json(session: String, +log: String, level: String, pending: String, size: U32, stderr: U32, checkpoint: U32) -> String:
  "{\"session\":" ++ J.string_literal(session)
  ++ ",\"path\":" ++ J.string_literal(log)
  ++ ",\"level\":" ++ J.string_literal(level)
  ++ ",\"pendingInput\":" ++ pending
  ++ ",\"bytes\":" ++ U32.show(size)
  ++ ",\"stderrBytes\":" ++ U32.show(stderr)
  ++ ",\"pendingBytes\":" ++ U32.show(checkpoint)
  ++ ",\"pendingPath\":" ++ J.string_literal(log ++ ".pending") ++ "}"

def log_fields(fields: List<String>) -> IO(String):
  match fields:
    case session <> +log <> level <> +pending <> rest: do IO<String>:
      size : U32 <- IO.try(U32,F.Files.size(log))
      stderr : U32 <- IO.try(U32,F.Files.size(log ++ ".stderr"))
      checkpoint : U32 <- IO.try(U32,F.Files.size(log ++ ".pending"))
      IO.pure(String,log_json(session,log,level,pending,size,stderr,checkpoint))
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
  "SELECT e.session,e.id,e.mode,e.phase,e.status,e.directory,(SELECT count(*) FROM messages WHERE recipient=e.session AND receipt IS NULL),coalesce((SELECT level FROM log_policies WHERE session=e.session),'default'),CASE WHEN EXISTS(SELECT 1 FROM turns t JOIN messages m ON m.id=t.id AND m.sender=t.worker AND m.kind='report' WHERE t.id=e.id AND t.worker=e.session AND e.status='exit 0') OR EXISTS(SELECT 1 FROM session_stops ss JOIN messages m ON m.id=ss.report_id AND m.kind='report' AND m.sender=e.session WHERE ss.session=e.session AND ss.attempt=e.id AND ss.outcome='stopped') THEN 1 ELSE 0 END,CASE WHEN e.directory=" ++ C.q(db ++ ".attempt-") ++ " || lower(hex(e.id)) THEN 1 ELSE 0 END FROM executions e WHERE (" ++ C.q(session) ++ "='' OR e.session=" ++ C.q(session) ++ ") AND e.directory<>'' ORDER BY e.session,e.directory;"

type AttemptDecision is Data:
  AttemptDecision{reason: String, eligible: Bool}

def attempt_decision_eligible(decision: AttemptDecision) -> Bool:
  match decision:
    case AttemptDecision{reason,eligible}: eligible

def attempt_decision(phase: String, status: String, released: String, acknowledged: String, reported: String, pending: String, level: String, path: String, bytes: U32) -> AttemptDecision:
  Bool.pick(AttemptDecision,Bool.not(String.eq(pending,"0")),AttemptDecision{"pending-input",False{}},
    Bool.pick(AttemptDecision,String.eq(level,"diagnostic"),AttemptDecision{"diagnostic-policy",False{}},
      Bool.pick(AttemptDecision,String.eq(path,"0"),AttemptDecision{"attempt-path-unverified",False{}},
        Bool.pick(AttemptDecision,Bool.not(String.eq(phase,"exited")),AttemptDecision{"native-not-exited",False{}},
          Bool.pick(AttemptDecision,String.eq(released,"0"),AttemptDecision{"native-not-released",False{}},
            Bool.pick(AttemptDecision,String.eq(acknowledged,"0"),AttemptDecision{"native-not-acknowledged",False{}},
              Bool.pick(AttemptDecision,Bool.not(String.eq(status,"exit 0")),AttemptDecision{"native-turn-failed",False{}},
                Bool.pick(AttemptDecision,String.eq(reported,"0"),AttemptDecision{"observation-unreported",False{}},
                  Bool.pick(AttemptDecision,U32.is_lt(0,bytes),AttemptDecision{"eligible",True{}},AttemptDecision{"no-diagnostic-files",False{}})))))))))

def attempt_json_fields(session: String, attempt: String, mode: String, phase: String, status: String, +directory: String, +stdout: U32, +stderr: U32, +observer: U32, +keeper: U32, released: U32, acknowledged: U32, reported: String, pending: String, decision: AttemptDecision) -> String:
  match decision:
    case AttemptDecision{reason,eligible}:
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
      ++ ",\"acknowledged\":" ++ Bool.pick(String,U32.is_lt(0,acknowledged),"true","false")
      ++ ",\"reported\":" ++ Bool.pick(String,String.eq(reported,"1"),"true","false")
      ++ ",\"pendingInput\":" ++ pending
      ++ ",\"cleanupEligible\":" ++ Bool.pick(String,eligible,"true","false")
      ++ ",\"cleanupReason\":" ++ J.string_literal(reason) ++ "}"

def attempt_json(session: String, attempt: String, mode: String, +phase: String, +status: String, +directory: String, +stdout: U32, +stderr: U32, +observer: U32, +keeper: U32, +released: U32, +acknowledged: U32, +reported: String, +pending: String, level: String, path: String) -> String:
  attempt_json_fields(session,attempt,mode,phase,status,directory,stdout,stderr,observer,keeper,released,acknowledged,reported,pending,attempt_decision(phase,status,Bool.pick(String,U32.is_lt(0,released),"1","0"),Bool.pick(String,U32.is_lt(0,acknowledged),"1","0"),reported,pending,level,path,U32.add(stdout,U32.add(stderr,U32.add(observer,keeper)))) )

def attempt_fields(fields: List<String>) -> IO(String):
  match fields:
    case session <> attempt <> mode <> phase <> status <> +directory <> pending <> level <> reported <> path <> rest: do IO<String>:
      stdout : U32 <- IO.try(U32,F.Files.size(directory ++ "/stdout"))
      stderr : U32 <- IO.try(U32,F.Files.size(directory ++ "/native.stderr"))
      observer : U32 <- IO.try(U32,F.Files.size(directory ++ "/observer.log"))
      keeper : U32 <- IO.try(U32,F.Files.size(directory ++ "/keeper.log"))
      released_file : String <- IO.try(String,F.Files.regular(directory ++ "/released"))
      acknowledged_file : String <- IO.try(String,F.Files.regular(directory ++ "/acknowledged"))
      released : U32 = number_of(U32.read(Bool.pick(String,String.eq(released_file,"1"),"1","0")),0)
      acknowledged : U32 = number_of(U32.read(Bool.pick(String,String.eq(acknowledged_file,"1"),"1","0")),0)
      IO.pure(String,attempt_json(session,attempt,mode,phase,status,directory,stdout,stderr,observer,keeper,released,acknowledged,reported,pending,level,path))
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
  ++ ",\"defaults\":{\"level\":" ++ J.string_literal(default_level()) ++ "}"
  ++ ",\"logs\":[" ++ logs ++ "]"
  ++ ",\"attempts\":[" ++ attempts ++ "]}"

# Inspects registered artifact paths and cleanup candidates. The policy schema
# is initialized or migrated before the read.
def storage(+db: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Schema.ensure(db)
    log_text : String <- IO.try(String,DB.Sql.query(db,schema() ++ log_rows_sql()))
    logs : String <- log_items(Tx.split_lines(log_text),"")
    attempt_text : String <- IO.try(String,DB.Sql.query(db,attempt_rows_sql(db,"")))
    attempts : String <- attempt_items(Tx.split_lines(attempt_text),"")
    database : U32 <- IO.try(U32,F.Files.size(db))
    root : U32 <- IO.try(U32,F.Files.size(db ++ ".root.log"))
    IO.pure(String,storage_json(db,database,root,logs,attempts))

def clean_json(session: String, attempt_files: String) -> String:
  "{\"session\":" ++ J.string_literal(session) ++ ",\"removed\":[],\"attemptFiles\":[" ++ attempt_files ++ "]}"

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
    observer : String <- attempt_cleanup_file(db,directory,"observer.log")
    keeper : String <- attempt_cleanup_file(db,directory,"keeper.log")
    IO.pure(String,items_join(stdout,items_join(stderr,items_join(observer,keeper))))

def attempt_cleanup_fields(db: String, fields: List<String>) -> IO(String):
  match fields:
    case session <> attempt <> mode <> phase <> status <> +directory <> pending <> level <> reported <> path <> rest: do IO<String>:
      released_file : String <- IO.try(String,F.Files.regular(directory ++ "/released"))
      acknowledged_file : String <- IO.try(String,F.Files.regular(directory ++ "/acknowledged"))
      stdout : U32 <- IO.try(U32,F.Files.size(directory ++ "/stdout"))
      stderr : U32 <- IO.try(U32,F.Files.size(directory ++ "/native.stderr"))
      observer : U32 <- IO.try(U32,F.Files.size(directory ++ "/observer.log"))
      keeper : U32 <- IO.try(U32,F.Files.size(directory ++ "/keeper.log"))
      released : String = Bool.pick(String,String.eq(released_file,"1"),"1","0")
      acknowledged : String = Bool.pick(String,String.eq(acknowledged_file,"1"),"1","0")
      bytes : U32 = U32.add(stdout,U32.add(stderr,U32.add(observer,keeper)))
      eligible : Bool = attempt_decision_eligible(attempt_decision(phase,status,released,acknowledged,reported,pending,level,path,bytes))
      files : String <- Bool.pick(IO(String),eligible,attempt_cleanup_files(db,directory),IO.pure(String,""))
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
    attempt_removed : String <- clean_attempts(db,session)
    IO.pure(String,clean_json(session,attempt_removed))

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

# Explicit cleanup removes only registered attempt diagnostics that satisfy the
# existing terminal, release, acknowledgement, report and pending-input rules.
def clean(+db: String, +session: String) -> IO(String):
  do IO<String>:
    ensured : Unit <- Schema.ensure(db)
    +present : String <- IO.try(String,DB.Sql.query(db,schema() ++ "SELECT count(*) FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    answer : String <- Bool.pick(IO(String),String.eq(Tx.trim_nl(present),"1"),clean_started(db,session),IO.pure(String,unknown_session(session)))
    IO.pure(String,answer)
