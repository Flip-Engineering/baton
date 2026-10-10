# Linked worktrees share a database-path pointer under their canonical Git
# common directory. Project session reads include retained reports and input.
# Resume delivers owed input or continues a failed turn; --lift-stop clears its current stop.
import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./delivery.bend as Delivery
import ./stop.bend as Stop
import ./turn.bend as Turn
import ../host/sqlite.bend as DB
import ../host/control.bend as Host
import ../host/files.bend as Files
import ../host/text.bend as Text
import ../git/process.bend as Git
import ../git/types.bend as G
import ../git/text.bend as Tx
import ../context/request.bend as Req

def field_decoded(decoded: Req.Scalar) -> IO(String):
  match decoded:
    case Req.ScalarText{value}: IO.pure(String,value)
    case other: IO.die(String,22,"Project field text could not be decoded: " ++ Req.scalar_reason(other))

def field(encoded: String) -> IO(String):
  field_decoded(Req.decode_scalar_utf8(Tx.hex_decode(Tx.trim_nl(encoded))))

def git_common_args() -> List<String>:
  ["rev-parse", "--path-format=absolute", "--git-common-dir"]

# The absolute common directory in git's answer, or "" when git failed.
def common_output(+out: String, zero: Bool) -> String:
  match zero:
    case True{}: out
    case False{}: ""

def common_of(resolved: G.GitOut) -> String:
  match resolved:
    case G.GRun{code, out}: common_output(Tx.trim_nl(out), U32.is_eq(code, 0))
    case G.GBroken{detail}: ""

def common_ok(common: String) -> Bool:
  Bool.not(String.is_empty(common))

def canonical_or_abs(+abs: String, result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{error}: abs
    case Done{value}: value

# Canonicalize git's absolute answer through the normal workspace resolver,
# keeping the answer itself when the resolver refuses it.
def canonicalize_common(+raw: String, keyed: Bool) -> IO(String):
  match keyed:
    case True{}:
      do IO<String>:
        found : Result<&1,&1,U32 & String,String> <- Host.Control.workspace(raw)
        IO.pure(String, canonical_or_abs(raw, found))
    case False{}: IO.pure(String, "")

# The project key: the canonical common directory when git named one, else
# the canonical path itself.
def key_of(canonical: String, common: String, keyed: Bool) -> String:
  match keyed:
    case True{}: common
    case False{}: canonical

# The cause a failed resolution keeps; an answered resolution keeps none.
def common_cause_output(out: String, empty: Bool) -> String:
  match empty:
    case True{}: "git rev-parse --git-common-dir answered empty"
    case False{}: ""

def common_cause_run(code: U32, +out: String, zero: Bool) -> String:
  match zero:
    case True{}: common_cause_output(out, String.is_empty(out))
    case False{}: "git rev-parse --git-common-dir exited without naming a common directory"

def common_cause(resolved: G.GitOut) -> String:
  match resolved:
    case G.GRun{+code, out}: common_cause_run(code, Tx.trim_nl(out), U32.is_eq(code, 0))
    case G.GBroken{detail}: "git rev-parse --git-common-dir failed: " ++ detail

def rule_of(keyed: Bool) -> String:
  Bool.pick(String, keyed, "common-dir", "path-prefix")

# One recorded workspace belongs to the project when its own canonical
# common directory matches the project key. A workspace git cannot resolve
# falls back to the checkout-prefix match against the canonical input path.
def prefix_member(+workspace: String, +canonical: String) -> Bool:
  Bool.or(String.eq(workspace, canonical), Tx.starts_with(workspace, canonical ++ "/"))

def keyed_member(workspace: String, key: String, canonical: String, common: String, ok: Bool) -> Bool:
  match ok:
    case True{}: String.eq(common, key)
    case False{}: prefix_member(workspace, canonical)

def member_decision(workspace: String, key: String, canonical: String, keyed: Bool, +common: String) -> Bool:
  match keyed:
    case True{}: keyed_member(workspace, key, canonical, common, common_ok(common))
    case False{}: prefix_member(workspace, canonical)

# The canonical common directory of one recorded workspace, or "" when git
# has no answer for it.
def workspace_common(directory: String) -> IO(String):
  do IO<String>:
    resolved : G.GitOut <- Git.runGit(directory, git_common_args())
    +raw : String <- IO.pure(String, common_of(resolved))
    canonicalize_common(raw, common_ok(raw))

def member_resolve(+workspace: String, key: String, canonical: String, keyed: Bool, empty: Bool) -> IO(Bool):
  match empty:
    case True{}: IO.pure(Bool, False{})
    case False{}:
      do IO<Bool>:
        +common : String <- workspace_common(workspace)
        IO.pure(Bool, member_decision(workspace, key, canonical, keyed, common))

def member_now(+workspace: String, key: String, canonical: String, keyed: Bool) -> IO(Bool):
  member_resolve(workspace, key, canonical, keyed, String.is_empty(workspace))

def cons_member(keep: Bool, workspace: String, tail: List<String>) -> List<String>:
  match keep:
    case True{}: Con{workspace, tail}
    case False{}: tail

def collect_members(workspaces: List<String>, +key: String, +canonical: String, +keyed: Bool) -> IO(List<String>):
  match workspaces:
    case Nil{}: IO.pure(List<String>, Nil{})
    case Con{encoded, rest}:
      do IO<List<String>>:
        +workspace : String <- field(encoded)
        keep : Bool <- member_now(workspace, key, canonical, keyed)
        tail : List<String> <- collect_members(rest, key, canonical, keyed)
        IO.pure(List<String>, cons_member(keep, workspace, tail))

def in_tail(workspaces: List<String>) -> String:
  match workspaces:
    case Nil{}: ""
    case Con{workspace, rest}: "," ++ C.q(workspace) ++ in_tail(rest)

def membership_condition(workspaces: List<String>) -> String:
  match workspaces:
    case Nil{}: "1=0"
    case Con{workspace, rest}: "s.workspace IN (" ++ C.q(workspace) ++ in_tail(rest) ++ ")"

def workspaces_sql() -> String:
  "SELECT hex(workspace) FROM sessions WHERE workspace<>'' GROUP BY workspace ORDER BY workspace;"

def pointer_path(key: String) -> String:
  key ++ "/baton2/database"

def project_key(+path: String) -> IO(String):
  do IO<String>:
    +canonical : String <- IO.try(String,Host.Control.workspace(path))
    +common : String <- workspace_common(canonical)
    IO.pure(String,key_of(canonical,common,common_ok(common)))

def pointer_written(written: File & Result<&1,&1,U32 & String,Unit>) -> IO(Unit):
  (file,result) = written
  do IO<Unit>:
    closed : Unit <- File.close(file)
    IO.try(Unit,IO.pure(Result<&1,&1,U32 & String,Unit>,result))

def register_pointer(+key: String, database: String) -> IO(String):
  do IO<String>:
    made : Unit <- IO.try(Unit,Files.Files.mkdir(key ++ "/baton2"))
    +pointer : String <- IO.try(String,Host.Control.output(pointer_path(key)))
    file : File <- IO.try(File,File.open(pointer,"w"))
    written : File & Result<&1,&1,U32 & String,Unit> <- File.write(file,database)
    closed : Unit <- pointer_written(written)
    IO.pure(String,pointer)

def pointer_missing(pointer: String, detail: String) -> String:
  "Project database pointer " ++ pointer ++ " could not be read: " ++ detail ++ ". Register a database with baton2 DATABASE project PATH."

def pointer_value(pointer: String, database: String, empty: Bool) -> IO(String):
  match empty:
    case True{}: IO.die(String,2,pointer_missing(pointer,"the file is empty"))
    case False{}: IO.pure(String,database)

def pointer_read(pointer: String, read: Result<&1,&1,U32 & String,String>) -> IO(String):
  match read:
    case Fail{(code,detail)}: IO.die(String,2,pointer_missing(pointer,U32.show(code) ++ ": " ++ detail))
    case Done{+database}: pointer_value(pointer,database,String.is_empty(database))

def database(path: String) -> IO(String):
  do IO<String>:
    key : String <- project_key(path)
    +pointer : String <- IO.pure(String,pointer_path(key))
    read : Result<&1,&1,U32 & String,String> <- Text.Text.read(pointer)
    pointer_read(pointer,read)

# --- answers ----------------------------------------------------------------

def git_answer(ok: Bool, +cause: String) -> String:
  match ok:
    case True{}: "json_object('ok',1,'cause'," ++ C.q(cause) ++ ")"
    case False{}: "json_object('ok',0,'cause'," ++ C.q(cause) ++ ")"

def project_object(input: String, canonical: String, +key: String, ok: Bool, cause: String, rule: String, database: String) -> String:
  "json_object('input'," ++ C.q(input) ++ ",'canonical'," ++ C.q(canonical) ++ ",'project'," ++ C.q(key) ++ ",'pointer'," ++ C.q(pointer_path(key)) ++ ",'database'," ++ C.q(database) ++ ",'rule'," ++ C.q(rule) ++ ",'git'," ++ git_answer(ok, cause) ++ ")"

def project_sql(input: String, canonical: String, key: String, ok: Bool, cause: String, rule: String, database: String) -> String:
  "SELECT " ++ project_object(input, canonical, key, ok, cause, rule,database) ++ ";"

def project_sessions_sql(input: String, canonical: String, key: String, ok: Bool, cause: String, rule: String, database: String, condition: String) -> String:
  "SELECT json_object('project'," ++ project_object(input, canonical, key, ok, cause, rule,database) ++ ",'sessions'," ++ C.players_json(condition) ++ ");"

# --- resume: continue the selected session through its registered receiver --

# Every refusal carries the rule and the next action.
def stopped_refusal() -> String:
  "Session is terminally stopped; queued input will not execute. Read its session and retained inbox; resume SESSION --lift-stop explicitly lifts the stop and continues the same conversation."

def missing_refusal(session: String) -> String:
  "No recorded session carries that identity. Recruit a new session; pass the project checkout as its workspace."

def no_input_refusal(session: String) -> String:
  "Session " ++ session ++ " has no unacknowledged input or failed turn to continue. Send input with message or dispatch-turn, then resume."

def endpoint_refusal(session: String) -> String:
  "Session " ++ session ++ " records no receiver endpoint and no native queue identity. Connect one with receiver SESSION HARNESS_CMD OUTPUT_LOG, or continue a direct turn with dispatch-turn."

def queueable(harness: String, native: String) -> Bool:
  Bool.and(String.eq(harness, "codex"), Bool.not(String.is_empty(native)))

# Read the current message receipt after delivery returns. Report fields name
# the session's latest retained report.
def resume_answer(db: String, +session: String, +oldest: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Fail{(code,detail)}: IO.die(Unit,code,detail)
    case Done{output}:
      do IO<Unit>:
        saved : String <- IO.try(String,DB.Sql.query(db,"SELECT json_object('session'," ++ C.q(session) ++ ",'message'," ++ C.q(oldest) ++ ",'delivery',json((SELECT " ++ C.delivery_row() ++ " FROM messages m JOIN sessions s ON s.id=m.recipient WHERE m.id=" ++ C.q(oldest) ++ ")),'latestReportId',(SELECT id FROM messages WHERE sender=" ++ C.q(session) ++ " AND kind='report' ORDER BY seq DESC LIMIT 1),'latestReport',(SELECT body FROM messages WHERE sender=" ++ C.q(session) ++ " AND kind='report' ORDER BY seq DESC LIMIT 1));"))
        IO.write(saved)

# Deliver the owed input through the session's recorded receiver endpoint.
def resume_deliver(+db: String, session: String, +oldest: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String, Store.commit(db, C.Delivery{oldest}))
    result : Result<&1,&1,U32 & String,String> <- Delivery.deliver(db, oldest, "1", Tx.trim_nl(saved))
    resume_answer(db, session, oldest, result)

# A Codex session without an endpoint still has the supported native queue.
def resume_queue(+db: String, session: String, +oldest: String) -> IO(Unit):
  do IO<Unit>:
    saved : String <- IO.try(String, Store.commit(db, C.Delivery{oldest}))
    result : Result<&1,&1,U32 & String,String> <- Delivery.codex_queue(db, oldest, "1", Tx.trim_nl(saved))
    resume_answer(db, session, oldest, result)

def resume_endpointless(db: String, session: String, oldest: String, queued: Bool) -> IO(Unit):
  match queued:
    case True{}: resume_queue(db, session, oldest)
    case False{}: IO.die(Unit, 2, endpoint_refusal(session))

def resume_launch(+db: String, +session: String, +oldest: String, endpoint: String, harness: String, native: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: resume_endpointless(db, session, oldest, queueable(harness, native))
    case False{}: resume_deliver(db, session, oldest)

def session_field_sql(session: String, column: String) -> String:
  "SELECT hex(coalesce((SELECT " ++ column ++ " FROM sessions WHERE id=" ++ C.q(session) ++ "),''));"

def resume_harness(+db: String, +session: String, oldest: String, +endpoint: String, harness: String) -> IO(Unit):
  do IO<Unit>:
    native : String <- IO.try(String,DB.Sql.query(db,session_field_sql(session,"native")))
    decoded : String <- field(native)
    resume_launch(db,session,oldest,endpoint,harness,decoded,String.is_empty(endpoint))

def resume_endpoint(+db: String, +session: String, oldest: String, endpoint: String) -> IO(Unit):
  do IO<Unit>:
    harness : String <- IO.try(String,DB.Sql.query(db,session_field_sql(session,"harness")))
    decoded : String <- field(harness)
    resume_harness(db,session,oldest,endpoint,decoded)

def resume_oldest(+db: String, +session: String, oldest: String, empty: Bool) -> IO(Unit):
  match empty:
    case True{}: IO.die(Unit,2,no_input_refusal(session))
    case False{}: do IO<Unit>:
      endpoint : String <- IO.try(String,DB.Sql.query(db,session_field_sql(session,"endpoint")))
      decoded : String <- field(endpoint)
      resume_endpoint(db,session,oldest,decoded)

# An explicit resume can continue an interrupted task whose input the actor
# already acknowledged. The failed turn stays in history, and this recovery
# message follows the recorded receiver into the same native conversation.
def resume_input_sql(+session: String) -> String:
  "BEGIN IMMEDIATE;INSERT OR IGNORE INTO messages(id,sender,recipient,kind,body) SELECT 'resume:' || lower(hex(e.id)),s.id,s.id,'recovery','Continue unfinished work from native attempt ' || e.id || ' in your recorded conversation and workspace.' || coalesce((SELECT ' The latest accepted task is ' || m.id || '.' FROM messages m WHERE m.recipient=s.id AND m.kind='task' AND m.receipt IS NOT NULL ORDER BY m.seq DESC LIMIT 1),'') || ' Review the current work before continuing. The original task receipt and failed turn remain recorded.' FROM executions e JOIN sessions s ON s.id=e.session WHERE s.id=" ++ C.q(session) ++ " AND e.phase='exited' AND " ++ C.blocked_cause_sql("s.id") ++ "='provider-failure' AND NOT EXISTS(SELECT 1 FROM messages WHERE recipient=s.id AND receipt IS NULL);"
  ++ "SELECT hex(coalesce((SELECT id FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL ORDER BY seq LIMIT 1),''));COMMIT;"

def resume_direct_or_input(+db: String, +session: String, direct: Maybe<String>) -> IO(Unit):
  match direct:
    case Some{answer}: IO.write(answer)
    case None{}: do IO<Unit>:
      oldest : String <- IO.try(String,Store.transact_sql(db,resume_input_sql(session)))
      +trimmed : String <- field(oldest)
      resume_oldest(db,session,trimmed,String.is_empty(trimmed))

def resume_stopped(+db: String, +session: String, stopped: Bool) -> IO(Unit):
  match stopped:
    case True{}: IO.die(Unit, 2, stopped_refusal())
    case False{}:
      do IO<Unit>:
        direct : Maybe<String> <- Turn.resume_pending(db,session)
        resume_direct_or_input(db,session,direct)

def resume_lift(db: String, session: String, lift_stop: Bool) -> IO(Unit):
  match lift_stop:
    case True{}: Stop.lift(db,session)
    case False{}: IO.pure(Unit,Unit{})

def resume_present(+db: String, +session: String, present: Bool, lift_stop: Bool) -> IO(Unit):
  match present:
    case True{}:
      do IO<Unit>:
        lifted : Unit <- resume_lift(db,session,lift_stop)
        stopped : String <- IO.try(String, DB.Sql.query(db, "SELECT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ");"))
        resume_stopped(db, session, String.eq(stopped, "1\n"))
    case False{}: IO.die(Unit, 2, missing_refusal(session))

# --- entries ----------------------------------------------------------------

# Register this database under the resolved project's pointer.
def describe(+db: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    +canonical : String <- IO.try(String, Host.Control.workspace(path))
    +resolved : G.GitOut <- Git.runGit(canonical, git_common_args())
    +raw : String <- IO.pure(String, common_of(resolved))
    +keyed : Bool <- IO.pure(Bool, common_ok(raw))
    +common : String <- canonicalize_common(raw, keyed)
    +key : String <- IO.pure(String,key_of(canonical,common,keyed))
    +database : String <- IO.try(String,Host.Control.output(db))
    saved : String <- IO.try(String,DB.Sql.query(db,project_sql(path,canonical,key,keyed,common_cause(resolved),rule_of(keyed),database)))
    pointer : String <- register_pointer(key,database)
    IO.write(saved)

# List the recorded sessions under that project with the players surface:
# pending input counts, last turns, latest reports and native identities.
def sessions(+db: String, +path: String) -> IO(Unit):
  do IO<Unit>:
    +canonical : String <- IO.try(String, Host.Control.workspace(path))
    +resolved : G.GitOut <- Git.runGit(canonical, git_common_args())
    +raw : String <- IO.pure(String, common_of(resolved))
    +keyed : Bool <- IO.pure(Bool, common_ok(raw))
    +common : String <- canonicalize_common(raw, keyed)
    +key : String <- IO.pure(String, key_of(canonical, common, keyed))
    database : String <- IO.try(String,Host.Control.output(db))
    +listed : String <- IO.try(String, DB.Sql.read(db, workspaces_sql()))
    members : List<String> <- collect_members(Tx.split_lines(listed), key, canonical, keyed)
    saved : String <- IO.try(String,DB.Sql.read(db,project_sessions_sql(path,canonical,key,keyed,common_cause(resolved),rule_of(keyed),database,membership_condition(members))))
    IO.write(saved)

# Continue through the recorded receiver and return the delivery with retained reports.
# An explicit lift waits for the current owner before clearing the stop.
def resume(+db: String, +session: String, lift_stop: Bool) -> IO(Unit):
  do IO<Unit>:
    ensured : Unit <- Store.ensure_before_begin(db)
    present : String <- IO.try(String, DB.Sql.query(db, "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=" ++ C.q(session) ++ ");"))
    resume_present(db, session, String.eq(present, "1\n"),lift_stop)
