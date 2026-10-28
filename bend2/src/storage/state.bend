# Current durable evidence for storage cleanup.
#
# The coordinator database supplies session workspaces, execution directories
# and registered log paths. Git supplies worktree dirtiness and reachability of
# loose objects. The host supplies live cwd, open descriptors and path identity.
# Unknown evidence preserves the candidate.

import Base
import ./types.bend as T
import ./observe.bend as O
import ../host/files.bend as F
import ../host/storage.bend as H
import ../host/sqlite.bend as DB
import ../host/session-lock.bend as Lock
import ../git/process.bend as Git
import ../git/status.bend as WS
import ../git/types.bend as G
import ../git/text.bend as Tx

type SessionRow is Data:
  SessionRow{id: String, workspace: String, branch: String, base: String}

type ExecutionRow is Data:
  ExecutionRow{session: String, id: String, directory: String, phase: String, status: String}

type LogRow is Data:
  LogRow{session: String, log: String}

type PendingRow is Data:
  PendingRow{session: String, count: U32}

type DatabaseLine is Data:
  DatabaseLine{path: String, bad: Bool}

type DatabaseRows is Data:
  DatabaseRows{rows: List<&2,String>, invalid: Bool}

type State is Data:
  State{sessions: List<&2,SessionRow>, executions: List<&2,ExecutionRow>, logs: List<&2,LogRow>, pending: List<&2,PendingRow>, databases: List<&2,String>, retained: List<&2,String>, valid: Bool}

type OwnerChoice is Data:
  OwnerChoice{owner: String, fact: T.Owner}

def u32_or(value: Maybe<&2, U32>, +fallback: U32) -> U32:
  match value:
    case None{}: fallback
    case Some{found}: found

def decode_field(+text: String) -> String:
  Bool.pick(String, String.eq(text, "~"), "", Tx.hex_decode(text))

def session_fields(fields: List<String>) -> SessionRow:
  match fields:
    case id <> workspace <> branch <> base <> Nil{}:
      SessionRow{decode_field(id), decode_field(workspace), decode_field(branch), decode_field(base)}
    case other: SessionRow{"", "", "", ""}

def session_row(line: String) -> SessionRow:
  session_fields(Tx.split_tabs(line))

def execution_fields(fields: List<String>) -> ExecutionRow:
  match fields:
    case session <> id <> directory <> phase <> status <> Nil{}:
      ExecutionRow{decode_field(session), decode_field(id), decode_field(directory), decode_field(phase), decode_field(status)}
    case other: ExecutionRow{"", "", "", "", ""}

def execution_row(line: String) -> ExecutionRow:
  execution_fields(Tx.split_tabs(line))

def log_fields(fields: List<String>) -> LogRow:
  match fields:
    case session <> log <> Nil{}: LogRow{decode_field(session), decode_field(log)}
    case other: LogRow{"", ""}

def log_row(line: String) -> LogRow:
  log_fields(Tx.split_tabs(line))

def pending_count_fields(session: String, value: Maybe<&2,U32>) -> PendingRow:
  match value:
    case None{}: PendingRow{"", 0}
    case Some{count}: PendingRow{session, count}

def pending_fields(fields: List<String>) -> PendingRow:
  match fields:
    case session <> count <> Nil{}:
      pending_count_fields(decode_field(session), U32.read(count))
    case other: PendingRow{"", 0}

def pending_row(line: String) -> PendingRow:
  pending_fields(Tx.split_tabs(line))

def sessions_walk(rows: List<String>, acc: List<&2,SessionRow>) -> List<&2,SessionRow>:
  match rows:
    case Nil{}: List.reverse(&2, SessionRow, acc)
    case Con{head, tail}: sessions_walk(tail, Con{session_row(head), acc})

def executions_walk(rows: List<String>, acc: List<&2,ExecutionRow>) -> List<&2,ExecutionRow>:
  match rows:
    case Nil{}: List.reverse(&2, ExecutionRow, acc)
    case Con{head, tail}: executions_walk(tail, Con{execution_row(head), acc})

def logs_walk(rows: List<String>, acc: List<&2,LogRow>) -> List<&2,LogRow>:
  match rows:
    case Nil{}: List.reverse(&2, LogRow, acc)
    case Con{head, tail}: logs_walk(tail, Con{log_row(head), acc})

def pending_walk(rows: List<String>, acc: List<&2,PendingRow>) -> List<&2,PendingRow>:
  match rows:
    case Nil{}: List.reverse(&2, PendingRow, acc)
    case Con{head, tail}: pending_walk(tail, Con{pending_row(head), acc})

# Session endpoints record the coordinator argv as a JSON array. Element two
# is the database path the session was launched with. An empty endpoint is a
# session with no recorded launch; a non-empty endpoint that is not an array
# with a text second element makes the database evidence incomplete.
def database_value(+text: String) -> DatabaseLine:
  match text:
    case "": DatabaseLine{"", False{}}
    case "~invalid": DatabaseLine{"", True{}}
    case "~missing": DatabaseLine{"", True{}}
    case other: DatabaseLine{Tx.hex_decode(other), False{}}

def database_values_walk(rows: List<String>, acc: List<&2,DatabaseLine>) -> List<&2,DatabaseLine>:
  match rows:
    case Nil{}: List.reverse(&2, DatabaseLine, acc)
    case Con{head, tail}:
      +value = database_value(head)
      database_values_walk(tail, Con{value, acc})

def database_lines_walk(rows: List<&2,DatabaseLine>, acc: List<&2,String>, invalid: Bool) -> DatabaseRows:
  match rows:
    case Nil{}: DatabaseRows{List.reverse(&2, String, acc), invalid}
    case Con{head, tail}:
      match head:
        case DatabaseLine{path, bad}:
          match bad:
            case True{}: database_lines_walk(tail, acc, True{})
            case False{}: database_lines_walk(tail, Con{path, acc}, invalid)

def database_entries_decided(+db: String, pair: DatabaseRows) -> DatabaseRows:
  match pair:
    case DatabaseRows{rows, invalid}: DatabaseRows{Con{db, rows}, invalid}

def database_entries(+db: String, +text: String) -> DatabaseRows:
  +values : List<&2,DatabaseLine> = database_values_walk(Tx.split_lines(text), Nil{})
  +pair : DatabaseRows = database_lines_walk(values, Nil{}, False{})
  database_entries_decided(db, pair)

def sessions_ok(rows: List<&2,SessionRow>) -> Bool:
  match rows:
    case Nil{}: True{}
    case Con{head, tail}:
      match head:
        case SessionRow{id, workspace, branch, base}: Bool.and(Bool.not(String.is_empty(id)), sessions_ok(tail))

def executions_ok(rows: List<&2,ExecutionRow>) -> Bool:
  match rows:
    case Nil{}: True{}
    case Con{head, tail}:
      match head:
        case ExecutionRow{session, id, directory, phase, status}: Bool.and(Bool.not(String.is_empty(session)), Bool.and(Bool.not(String.is_empty(id)), executions_ok(tail)))

def logs_ok(rows: List<&2,LogRow>) -> Bool:
  match rows:
    case Nil{}: True{}
    case Con{head, tail}:
      match head:
        case LogRow{session, log}: Bool.and(Bool.not(String.is_empty(session)), Bool.and(Bool.not(String.is_empty(log)), logs_ok(tail)))

def pending_ok(rows: List<&2,PendingRow>) -> Bool:
  match rows:
    case Nil{}: True{}
    case Con{head, tail}:
      match head:
        case PendingRow{session, count}: Bool.and(Bool.not(String.is_empty(session)), pending_ok(tail))

def retained_fields(fields: List<String>) -> List<&2,String>:
  match fields:
    case log <> base <> Nil{}:
      Con{decode_field(log), Con{decode_field(base), Nil{}}}
    case other: Con{"", Nil{}}

def retained_row(line: String) -> List<&2,String>:
  retained_fields(Tx.split_tabs(line))

def log_path_walk(rows: List<String>, acc: List<&2,String>) -> List<&2,String>:
  match rows:
    case Nil{}: List.reverse(&2, String, acc)
    case Con{head, tail}: log_path_walk(tail, Con{decode_field(head), acc})

def retained_walk(rows: List<String>, acc: List<&2,String>) -> List<&2,String>:
  match rows:
    case Nil{}: List.reverse(&2, String, acc)
    case Con{head, tail}:
      retained_walk(tail, List.append(&2, String, acc, retained_row(head)))

def retained_ok(rows: List<&2,String>) -> Bool:
  match rows:
    case Nil{}: True{}
    case Con{head, tail}: Bool.and(Bool.not(String.is_empty(head)), retained_ok(tail))

def valid_of(state: State) -> Bool:
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}: valid

def loaded_state_with_database(+sessions: List<&2,SessionRow>, +executions: List<&2,ExecutionRow>, +logs: List<&2,LogRow>, +pending: List<&2,PendingRow>, +databases: List<&2,String>, +retained: List<&2,String>, database_invalid: Bool) -> State:
  valid : Bool = Bool.and(Bool.not(database_invalid), Bool.and(sessions_ok(sessions), Bool.and(executions_ok(executions), Bool.and(logs_ok(logs), Bool.and(pending_ok(pending), retained_ok(retained))))))
  State{sessions, executions, logs, pending, databases, retained, valid}

def loaded_state(+sessions: List<&2,SessionRow>, +executions: List<&2,ExecutionRow>, +logs: List<&2,LogRow>, +pending: List<&2,PendingRow>, +database_pair: DatabaseRows, +retained: List<&2,String>) -> State:
  match database_pair:
    case DatabaseRows{databases, database_invalid}:
      loaded_state_with_database(sessions, executions, logs, pending, databases, retained, database_invalid)

def text_or_empty(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: value
    case Fail{error}: ""

def load(+db: String) -> IO(State):
  do IO<State>:
    sessions_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN id='' THEN '~' ELSE hex(id) END,CASE WHEN workspace='' THEN '~' ELSE hex(workspace) END,CASE WHEN branch='' THEN '~' ELSE hex(branch) END,CASE WHEN base='' THEN '~' ELSE hex(base) END FROM sessions ORDER BY id;"))
    executions_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN session='' THEN '~' ELSE hex(session) END,CASE WHEN id='' THEN '~' ELSE hex(id) END,CASE WHEN directory='' THEN '~' ELSE hex(directory) END,CASE WHEN phase='' THEN '~' ELSE hex(phase) END,CASE WHEN status='' THEN '~' ELSE hex(status) END FROM executions ORDER BY session;"))
    logs_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN session='' THEN '~' ELSE hex(session) END,CASE WHEN log='' THEN '~' ELSE hex(log) END FROM log_files ORDER BY session,log;"))
    pending_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN recipient='' THEN '~' ELSE hex(recipient) END,count(*) FROM messages WHERE NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=messages.id AND r.recipient=messages.recipient) GROUP BY recipient ORDER BY recipient;"))
    +sessions : List<&2,SessionRow> = sessions_walk(Tx.split_lines(sessions_text), Nil{})
    +executions : List<&2,ExecutionRow> = executions_walk(Tx.split_lines(executions_text), Nil{})
    +logs : List<&2,LogRow> = logs_walk(Tx.split_lines(logs_text), Nil{})
    +pending : List<&2,PendingRow> = pending_walk(Tx.split_lines(pending_text), Nil{})
    database_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN endpoint='' THEN '' WHEN json_valid(endpoint)=0 THEN '~invalid' ELSE CASE WHEN json_type(endpoint)!='array' THEN '~invalid' WHEN json_extract(endpoint,'$[1]') IS NULL OR json_type(endpoint,'$[1]')!='text' OR json_extract(endpoint,'$[1]')='' THEN '~missing' ELSE hex(json_extract(endpoint,'$[1]')) END END FROM sessions WHERE endpoint IS NULL OR length(endpoint)>0 ORDER BY id;"))
    +database_pair : DatabaseRows = database_entries(db, database_text)
    retained_result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db, "SELECT CASE WHEN g.log='' THEN '~' ELSE hex(g.log) END,CASE WHEN g.base='' THEN '~' ELSE hex(g.base) END FROM log_generations g JOIN executions e ON e.session=g.session AND e.id=g.attempt WHERE e.phase<>'exited' ORDER BY g.log;")
    +retained_text : String = text_or_empty(retained_result)
    +retained_generations : List<&2,String> = retained_walk(Tx.split_lines(retained_text), Nil{})
    fallback_result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db, "SELECT CASE WHEN l.log='' THEN '~' ELSE hex(l.log) END FROM log_files l WHERE EXISTS(SELECT 1 FROM executions e WHERE e.session=l.session AND e.phase<>'exited') ORDER BY l.log;")
    +fallback_text : String = text_or_empty(fallback_result)
    +retained_files : List<&2,String> = log_path_walk(Tx.split_lines(fallback_text), Nil{})
    +retained : List<&2,String> = List.append(&2, String, retained_generations, retained_files)
    IO.pure(State, loaded_state(sessions, executions, logs, pending, database_pair, retained))

def path_under(+path: String, +parent: String) -> Bool:
  Bool.pick(Bool, String.is_empty(parent), False{},
    Bool.or(String.eq(path, parent), String.starts_with(path, parent ++ "/")))

# DSH patches are retained beside their native custody directory. Storage
# derives their owner and active lease from the same execution row.
def execution_path(+path: String, +directory: String) -> Bool:
  Bool.or(path_under(path,directory),path_under(path,directory ++ ".dsh"))

def member(+value: String, values: List<String>) -> Bool:
  match values:
    case Nil{}: False{}
    case Con{head, tail}: Bool.or(String.eq(value, head), member(value, tail))

def add_owner(+value: String, values: List<String>) -> List<String>:
  Con{value, values}

def owner_append(matched: Bool, +session: String, acc: List<String>) -> List<String>:
  match matched:
    case True{}: Con{session, acc}
    case False{}: acc

def execution_owners(rows: List<&2,ExecutionRow>, +path: String, acc: List<String>) -> List<String>:
  match rows:
    case Nil{}: acc
    case Con{head, tail}:
      match head:
        case ExecutionRow{session, +id, directory, phase, status}:
          next = owner_append(execution_path(path, directory), session, acc)
          execution_owners(tail, path, next)

def workspace_owners(rows: List<&2,SessionRow>, +path: String, acc: List<String>) -> List<String>:
  match rows:
    case Nil{}: acc
    case Con{head, tail}:
      match head:
        case SessionRow{id, workspace, branch, base}:
          next = owner_append(path_under(path, workspace), id, acc)
          workspace_owners(tail, path, next)

def log_owners(rows: List<&2,LogRow>, +path: String, acc: List<String>) -> List<String>:
  match rows:
    case Nil{}: acc
    case Con{head, tail}:
      match head:
        case LogRow{session, log}:
          next = owner_append(String.eq(path, log), session, acc)
          log_owners(tail, path, next)

def owners_equal(+value: String, rows: List<String>) -> Bool:
  match rows:
    case Nil{}: True{}
    case Con{head, tail}: Bool.and(String.eq(value, head), owners_equal(value, tail))

# Several evidence sources naming the same owner still identify that owner;
# only distinct named owners make the owner unknown.
def owner_choice_lists(owners: List<String>) -> OwnerChoice:
  match owners:
    case Nil{}: OwnerChoice{"", T.OwnerMissing{}}
    case Con{+only, tail}:
      Bool.pick(OwnerChoice, owners_equal(only, tail),
        OwnerChoice{only, T.OwnerMatches{only}},
        OwnerChoice{"", T.OwnerUnknown{}})
def owner_choice(+state: State, +path: String) -> OwnerChoice:
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}:
      owner_choice_lists(execution_owners(executions, path, workspace_owners(sessions, path, log_owners(logs, path, Nil{}))))

def active_execution(rows: List<&2,ExecutionRow>, +path: String) -> String:
  match rows:
    case Nil{}: ""
    case Con{head, tail}:
      match head:
        case ExecutionRow{session, +id, directory, phase, status}:
          Bool.pick(String, Bool.and(execution_path(path, directory), Bool.not(String.eq(phase, "exited"))),
            Bool.pick(String, String.is_empty(id), "execution", "execution:" ++ id),
            active_execution(tail, path))

# The first non-exited execution recorded for OWNER, independent of any path.
# This is the owner-completion gate for transient storage classes: a session
# with a running or queued attempt has not settled its scratch, build, export
# or checkout tree.
def owner_execution(rows: List<&2,ExecutionRow>, +owner: String) -> String:
  match rows:
    case Nil{}: ""
    case Con{head, tail}:
      match head:
        case ExecutionRow{session, +id, directory, phase, status}:
          Bool.pick(String, Bool.and(String.eq(session, owner), Bool.not(String.eq(phase, "exited"))),
            Bool.pick(String, String.is_empty(id), "execution", "execution:" ++ id),
            owner_execution(tail, owner))

def retained_log_under(rows: List<&2,String>, +path: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{+head, tail}: Bool.or(path_under(head, path), retained_log_under(tail, path))

# A candidate that is, or contains, a retained log recorded for a non-exited
# execution stays. This preserves the database-referenced active log even when
# the writer lease was not observed (for example a foreign or crashed writer).
def lease_fact(+state: State, +path: String) -> T.Presence:
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}:
      +active = active_execution(executions, path)
      Bool.pick(T.Presence, String.is_empty(active),
        Bool.pick(T.Presence, retained_log_under(retained, path), T.Present{"retained-log"}, T.Absent{}),
        T.Present{active})

def pending_count(rows: List<&2,PendingRow>, +owner: String) -> U32:
  match rows:
    case Nil{}: 0
    case Con{head, tail}:
      match head:
        case PendingRow{session, count}: Bool.pick(U32, String.eq(session, owner), count, pending_count(tail, owner))

def pending_fact(+state: State, +owner: String) -> T.Presence:
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}:
      +count = pending_count(pending, owner)
      Bool.pick(T.Presence, U32.is_eq(count, 0), T.Absent{}, T.Present{U32.show(count)})

# The execution fact for the transient completion gate. Non-transient classes
# ignore it. A missing owner is unknown, so the candidate is preserved.
def execution_fact(+cls: T.StorageClass, +state: State, +owner: String) -> T.Presence:
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}:
      +active = owner_execution(executions, owner)
      Bool.pick(T.Presence, Bool.not(T.is_transient(cls)), T.Absent{},
        Bool.pick(T.Presence, String.is_empty(owner), T.Unknown{},
          Bool.pick(T.Presence, String.is_empty(active), T.Absent{}, T.Present{active})))

# The explicit completion trigger used by `storage-collect SESSION`. It names
# the first unsettled condition for the session: a non-exited execution or
# pending input. An empty answer means the session has settled.
def session_settled_reason(+state: State, +session: String) -> String:
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}:
      +active = owner_execution(executions, session)
      +waiting = pending_count(pending, session)
      Bool.pick(String, Bool.not(String.is_empty(active)), active,
        Bool.pick(String, U32.is_eq(waiting, 0), "", "pending-input:" ++ U32.show(waiting)))

def database_path_hit(rows: List<&2,String>, +path: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{head, tail}: Bool.or(path_under(head, path), database_path_hit(tail, path))

def database_canonical_decided(result: Result<&1,&1,U32 & String,String>, +canonical_path: String, unknown: Bool, next: Bool -> IO(T.Presence)) -> IO(T.Presence):
  match result:
    case Fail{error}: next(True{})
    case Done{+value}:
      Bool.pick(IO(T.Presence), Bool.or(path_under(value, canonical_path), path_under(canonical_path, value)),
        IO.pure(T.Presence, T.Present{"database-path"}), next(unknown))

def database_paths_resolved(rows: List<&2,String>, +raw_path: String, +canonical_path: String, unknown: Bool) -> IO(T.Presence):
  match rows:
    case Nil{}: IO.pure(T.Presence, Bool.pick(T.Presence, unknown, T.Unknown{}, T.Absent{}))
    case Con{head, tail}:
      do IO<T.Presence>:
        resolved : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(head)
        database_canonical_decided(resolved, canonical_path, unknown,
          next_unknown => database_paths_resolved(tail, raw_path, canonical_path, next_unknown))

def database_candidate_step(result: Result<&1,&1,U32 & String,String>, +databases: List<&2,String>, +path: String) -> IO(T.Presence):
  match result:
    case Fail{error}:
      IO.pure(T.Presence, Bool.pick(T.Presence, database_path_hit(databases, path), T.Present{"database-path"}, T.Unknown{}))
    case Done{+canonical_path}:
      Bool.pick(IO(T.Presence), Bool.or(database_path_hit(databases, path), database_path_hit(databases, canonical_path)),
        IO.pure(T.Presence, T.Present{"database-path"}),
        database_paths_resolved(databases, path, canonical_path, False{}))

def database_fact_valid(databases: List<&2,String>, +path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    canonical : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(path)
    database_candidate_step(canonical, databases, path)

# A candidate that is an active coordinator database path, or an ancestor of
# one, is preserved. Recorded endpoints and candidates are resolved through the
# coordinator's canonical-path host call before comparison. If a recorded
# endpoint no longer resolves, its original spelling still protects a lexical
# match; otherwise that unresolved endpoint makes the result Unknown.
def database_fact(+state: State, +path: String) -> IO(T.Presence):
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}:
      Bool.pick(IO(T.Presence), Bool.and(valid, Bool.not(String.is_empty(path))),
        database_fact_valid(databases, path),
        IO.pure(T.Presence, T.Unknown{}))

def session_match(rows: List<&2,SessionRow>, +session: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{head, tail}:
      match head:
        case SessionRow{id, workspace, branch, base}: Bool.or(String.eq(id, session), session_match(tail, session))

def session_known(+state: State, +session: String) -> Bool:
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}: session_match(sessions, session)

def dirty_result(status: Result<&1, &1, G.GitFail, G.WtStatus>) -> T.Presence:
  match status:
    case Done{G.Wt{branch, commit, dirty}}:
      Bool.pick(T.Presence, dirty, T.Present{"worktree"}, T.Absent{})
    case Done{made}: T.Unknown{}
    case Fail{fail}: T.Unknown{}

# A staging candidate is dirty when tracked, untracked or ignored local files
# exist. Ignored files such as .env are unknown local user data and must not be
# removed with the tree, so the status includes them.
def staging_status(result: G.GitOut) -> T.Presence:
  match result:
    case G.GRun{code, out}:
      Bool.pick(T.Presence, Bool.not(U32.is_eq(code, 0)), T.Unknown{},
        Bool.pick(T.Presence, String.is_empty(Tx.trim_nl(out)), T.Absent{}, T.Present{"worktree"}))
    case G.GBroken{detail}: T.Unknown{}

def dirty_fact(+cls: T.StorageClass, +path: String) -> IO(T.Presence):
  match cls:
    case T.Checkout{}:
      do IO<T.Presence>:
        status : Result<&1, &1, G.GitFail, G.WtStatus> <- WS.worktreeStatus(path)
        IO.pure(T.Presence, dirty_result(status))
    case T.StagingSource{}:
      do IO<T.Presence>:
        status : G.GitOut <- Git.runGit(path, ["status", "--porcelain", "--ignored", "--untracked-files=all"])
        IO.pure(T.Presence, staging_status(status))
    case T.StagingSourceReleased{}:
      do IO<T.Presence>:
        status : G.GitOut <- Git.runGit(path, ["status", "--porcelain", "--ignored", "--untracked-files=all"])
        IO.pure(T.Presence, staging_status(status))
    case other:
      IO.pure(T.Presence, T.Absent{})

def session_base(rows: List<&2,SessionRow>, +owner: String) -> String:
  match rows:
    case Nil{}: ""
    case Con{head, tail}:
      match head:
        case SessionRow{id, workspace, branch, base}:
          Bool.pick(String, String.eq(id, owner), base, session_base(tail, owner))

def git_text(+result: G.GitOut) -> Maybe<String>:
  match result:
    case G.GRun{code, out}: Bool.pick(Maybe<String>, U32.is_eq(code, 0), Some{Tx.trim_nl(out)}, None{})
    case G.GBroken{detail}: None{}

def count_commits(+text: String) -> U32:
  u32_or(U32.read(text), 0)

def unpublished_result(+base: String, current: Maybe<String>, count: Maybe<String>) -> T.Presence:
  match current:
    case None{}: T.Unknown{}
    case Some{value}:
      match count:
        case None{}: T.Unknown{}
        case Some{+commits}:
          Bool.pick(T.Presence, String.is_empty(base), T.Unknown{},
            Bool.pick(T.Presence, U32.is_lt(0, count_commits(commits)), T.Present{commits}, T.Absent{}))

def unpublished_command(+base: String, +path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    current_git : G.GitOut <- Git.runGit(path, ["rev-parse", "--abbrev-ref", "HEAD"])
    count_git : G.GitOut <- Git.runGit(path, ["rev-list", "--count", base ++ "..HEAD"])
    IO.pure(T.Presence, unpublished_result(base, git_text(current_git), git_text(count_git)))

def staging_text(result: G.RunRes) -> Maybe<String>:
  match result:
    case G.RRun{G.SExit{code}, out}: Bool.pick(Maybe<String>, U32.is_eq(code, 0), Some{out}, None{})
    case G.RRun{G.SSignal{num}, out}: None{}
    case G.RSpawn{detail}: None{}

def first_tab_field(fields: List<&2,String>) -> String:
  match fields:
    case Nil{}: ""
    case Con{head, tail}: head

def field_lines(lines: List<String>) -> List<&2,String>:
  match lines:
    case Nil{}: Nil{}
    case Con{+head, tail}:
      Con{first_tab_field(String.split(head, Char.from_u32(9))), field_lines(tail)}

def staging_unreachable_evidence(unreachable: Maybe<String>) -> T.Presence:
  match unreachable:
    case None{}: T.Unknown{}
    case Some{local_text}:
      Bool.pick(T.Presence, String.is_empty(Tx.trim_nl(local_text)),
        T.Absent{}, T.Present{"unpublished-object"})

def contains_value(values: List<&2,String>, +value: String) -> Bool:
  match values:
    case Nil{}: False{}
    case Con{head, tail}: Bool.or(String.eq(head, value), contains_value(tail, value))

def ancestor_answer(result: G.GitOut) -> Maybe<Bool>:
  match result:
    case G.GRun{code, out}:
      Bool.pick(Maybe<Bool>, U32.is_eq(code, 0), Some{True{}},
        Bool.pick(Maybe<Bool>, U32.is_eq(code, 1), Some{False{}}, None{}))
    case G.GBroken{detail}: None{}

def staging_ref_ancestor(+path: String, +local: String, tips: List<&2,String>) -> IO(Maybe<Bool>):
  match tips:
    case Nil{}: IO.pure(Maybe<Bool>, Some{False{}})
    case Con{head, tail}:
      do IO<Maybe<Bool>>:
        check : G.GitOut <- Git.runGit(path, ["merge-base", "--is-ancestor", local, head])
        match ancestor_answer(check):
          case Some{True{}}: IO.pure(Maybe<Bool>, Some{True{}})
          case Some{False{}}: staging_ref_ancestor(path, local, tail)
          case None{}: IO.pure(Maybe<Bool>, None{})

def published_local_refs(+path: String, values: List<&2,String>, tips: List<&2,String>) -> IO(Maybe<Bool>):
  match values:
    case Nil{}: IO.pure(Maybe<Bool>, Some{True{}})
    case Con{head, tail}:
      Bool.pick(IO(Maybe<Bool>), contains_value(tips, head), published_local_refs(path, tail, tips),
        do IO<Maybe<Bool>>:
          ancestor : Maybe<Bool> <- staging_ref_ancestor(path, head, tips)
          match ancestor:
            case Some{True{}}: published_local_refs(path, tail, tips)
            case Some{False{}}: IO.pure(Maybe<Bool>, Some{False{}})
            case None{}: IO.pure(Maybe<Bool>, None{}))

def single_worktree(+worklist: String, +toplevel: String) -> Bool:
  +prefix = "worktree " ++ toplevel ++ "\n"
  Bool.and(String.starts_with(worklist, prefix),
    Bool.not(String.contains(String.drop(worklist, String.length(prefix)), "\nworktree ")))

def staging_worktree_evidence(toplevel: String, gitdir: String, commondir: String, worklist: String) -> T.Presence:
  Bool.pick(T.Presence,
    Bool.or(Bool.not(String.eq(Tx.trim_nl(gitdir), Tx.trim_nl(commondir))),
      Bool.not(single_worktree(worklist, toplevel))),
    T.Present{"worktree-dependency"}, T.Absent{})

def staging_publication_after_worktree(worktree: T.Presence, unreachable: Maybe<String>) -> T.Presence:
  match worktree:
    case T.Absent{}: staging_unreachable_evidence(unreachable)
    case other: other

def staging_publication_evidence(toplevel: String, gitdir: String, commondir: String, worklist: String,
                                 unreachable: Maybe<String>) -> T.Presence:
  staging_publication_after_worktree(staging_worktree_evidence(toplevel, gitdir, commondir, worklist),
    unreachable)

def staging_remote_evidence(+path: String, remote_text: String, refs: String, +head: String, toplevel: String,
                            gitdir: String, commondir: String, worklist: String,
                            unreachable: Maybe<String>) -> IO(T.Presence):
  +commits : List<&2,String> = field_lines(Tx.split_lines(remote_text))
  +local : List<&2,String> = Con{Tx.trim_nl(head), field_lines(Tx.split_lines(refs))}
  Bool.pick(IO(T.Presence), String.is_empty(head),
    IO.pure(T.Presence, T.Unknown{}),
    do IO<T.Presence>:
      published : Maybe<Bool> <- published_local_refs(path, local, commits)
      match published:
        case None{}: IO.pure(T.Presence, T.Unknown{})
        case Some{False{}}: IO.pure(T.Presence, T.Present{"unpublished-object"})
        case Some{True{}}:
          IO.pure(T.Presence, staging_publication_evidence(Tx.trim_nl(toplevel), gitdir, commondir,
            worklist, unreachable)))

# A released staging source is a checkout whose ownership release is recorded
# in its root class. Removal requires the candidate origin to be the
# authenticated repository, every local ref object in every namespace and HEAD
# to be published by that remote, no objects
# unreachable from local refs (including reflog-only objects), and every
# worktree registration to point at the candidate itself. Any command failure
# preserves the candidate.
def staging_evidence(+path: String, +source_url: String, +candidate_url: String, remote_text: String,
                     refs: String, head: String, toplevel: String, gitdir: String,
                     commondir: String, worklist: String, unreachable: Maybe<String>) -> IO(T.Presence):
  Bool.pick(IO(T.Presence), Bool.or(String.is_empty(source_url), String.is_empty(candidate_url)),
    IO.pure(T.Presence, T.Unknown{}),
    Bool.pick(IO(T.Presence), Bool.not(String.eq(source_url, candidate_url)),
      IO.pure(T.Presence, T.Present{"remote-identity-mismatch"}),
      staging_remote_evidence(path, remote_text, refs, head, toplevel, gitdir, commondir, worklist,
        unreachable)))

def staging_finish_rest(+path: String, remote_text: String, unreachable: Maybe<String>, source_url: Maybe<String>,
                        candidate_url: Maybe<String>,
                        head: Maybe<String>, toplevel: Maybe<String>, gitdir: Maybe<String>,
                        commondir: Maybe<String>, refs: Maybe<String>, worklist: Maybe<String>) -> IO(T.Presence):
  match source_url:
    case None{}: IO.pure(T.Presence, T.Unknown{})
    case Some{source_value}:
      match candidate_url:
        case None{}: IO.pure(T.Presence, T.Unknown{})
        case Some{candidate_value}:
          match head:
            case None{}: IO.pure(T.Presence, T.Unknown{})
            case Some{head_value}:
              match toplevel:
                case None{}: IO.pure(T.Presence, T.Unknown{})
                case Some{toplevel_value}:
                  match gitdir:
                    case None{}: IO.pure(T.Presence, T.Unknown{})
                    case Some{gitdir_value}:
                      match commondir:
                        case None{}: IO.pure(T.Presence, T.Unknown{})
                        case Some{commondir_value}:
                          match refs:
                            case None{}: IO.pure(T.Presence, T.Unknown{})
                            case Some{refs_value}:
                              match worklist:
                                case None{}: IO.pure(T.Presence, T.Unknown{})
                                case Some{worklist_value}:
                                  staging_evidence(path, source_value, candidate_value, remote_text,
                                    refs_value, head_value, toplevel_value, gitdir_value, commondir_value,
                                    worklist_value, unreachable)

def staging_finish(+path: String, listed: Maybe<String>, unreachable: Maybe<String>, source_url: Maybe<String>,
                   candidate_url: Maybe<String>,
                   head: Maybe<String>, toplevel: Maybe<String>, gitdir: Maybe<String>,
                   commondir: Maybe<String>, refs: Maybe<String>, worklist: Maybe<String>) -> IO(T.Presence):
  match listed:
    case None{}: IO.pure(T.Presence, T.Unknown{})
    case Some{remote_text}:
      staging_finish_rest(path, remote_text, unreachable, source_url, candidate_url,
        head, toplevel, gitdir, commondir, refs, worklist)

# The host walks the candidate and every descendant without following symlinks.
# Foreign-owned entries preserve the whole candidate because process evidence
# for that uid may be unreadable.
def uid_boundary_result(+result: Result<&1,&1,U32 & String,String>) -> T.Presence:
  match result:
    case Fail{error}: T.Unknown{}
    case Done{value}:
      Bool.pick(T.Presence, String.eq(Tx.trim_nl(value), "own"), T.Absent{},
        Bool.pick(T.Presence, String.starts_with(value, "foreign:"), T.Present{"cross-uid-descendant"}, T.Unknown{}))

def staging_same_uid(+path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    boundary : Result<&1,&1,U32 & String,String> <- H.StorageHost.uid_boundary(path)
    IO.pure(T.Presence, uid_boundary_result(boundary))

def staging_unpublished(+source: String, +path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    cross : T.Presence <- staging_same_uid(path)
    staging_gate(source, path, cross)

def staging_gate(+source: String, +path: String, cross: T.Presence) -> IO(T.Presence):
  match cross:
    case T.Absent{}: staging_reads(source, path)
    case other: IO.pure(T.Presence, other)

def staging_reads(+source: String, +path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    source_url_git : G.GitOut <- Git.runGit(source, ["config", "--get", "remote.origin.url"])
    candidate_url_git : G.GitOut <- Git.runGit(path, ["config", "--get", "remote.origin.url"])
    head_git : G.GitOut <- Git.runGit(path, ["rev-parse", "HEAD"])
    toplevel_git : G.GitOut <- Git.runGit(path, ["rev-parse", "--show-toplevel"])
    gitdir_git : G.GitOut <- Git.runGit(path, ["rev-parse", "--git-dir"])
    commondir_git : G.GitOut <- Git.runGit(path, ["rev-parse", "--git-common-dir"])
    refs_git : G.GitOut <- Git.runGit(path, ["for-each-ref", "--format=%(objectname)"])
    worklist_git : G.GitOut <- Git.runGit(path, ["worktree", "list", "--porcelain"])
    listed_git : G.RunRes <- Git.runFull(["/usr/bin/env", "git", "-C", source, "ls-remote", "origin"], ".")
    unreachable_git : G.RunRes <- Git.runFull(["/usr/bin/env", "git", "-C", path, "fsck",
      "--no-progress", "--no-reflogs", "--unreachable"], ".")
    staging_finish(path, staging_text(listed_git), staging_text(unreachable_git),
      git_text(source_url_git), git_text(candidate_url_git), git_text(head_git),
      git_text(toplevel_git), git_text(gitdir_git), git_text(commondir_git),
      git_text(refs_git), git_text(worklist_git))

def unpublished_fact(+cls: T.StorageClass, +source: String, +path: String, +state: State, +owner: String) -> IO(T.Presence):
  match cls:
    case T.Checkout{}:
      match state:
        case State{sessions, executions, logs, pending, databases, retained, valid}:
          +base = session_base(sessions, owner)
          unpublished_command(base, path)
    case T.StagingSource{}:
      IO.pure(T.Presence, T.Present{"staging-source-release-required"})
    case T.StagingSourceReleased{}:
      staging_unpublished(source, path)
    case other:
      IO.pure(T.Presence, T.Absent{})

def is_hex_char(+c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.or(Bool.and(U32.is_ge(code, 48), U32.is_le(code, 57)),
    Bool.or(Bool.and(U32.is_ge(code, 97), U32.is_le(code, 102)),
            Bool.and(U32.is_ge(code, 65), U32.is_le(code, 70))))

def is_hex(+text: String) -> Bool:
  match text:
    case SNil{}: False{}
    case SCon{head, tail}: Bool.and(is_hex_char(head), is_hex(tail))

def last_string(values: List<&2,String>, +acc: String) -> String:
  match values:
    case Nil{}: acc
    case Con{head, tail}: last_string(tail, head)

def base_name(+path: String) -> String:
  parts = String.split(path, Char.from_u32(47))
  last_string(parts, "")

def loose_prefix(+path: String) -> String:
  +name = base_name(path)
  +prefix = String.take(name, 2n)
  Bool.pick(String, Bool.and(Nat.is_ge(String.length(name), 2n), is_hex(prefix)), prefix, "")

def first_of(values: List<String>) -> String:
  match values:
    case Nil{}: ""
    case Con{+head, tail}: head

def line_prefix(+line: String) -> String:
  first_of(Tx.split_spaces(line))

def reachable_walk(lines: List<String>, +prefix: String) -> Bool:
  match lines:
    case Nil{}: False{}
    case Con{head, tail}:
      Bool.pick(Bool, String.starts_with(line_prefix(head), prefix), True{}, reachable_walk(tail, prefix))

def ref_reachable(+prefix: String, reachable: Maybe<String>) -> T.Presence:
  match reachable:
    case None{}: T.Unknown{}
    case Some{text}: Bool.pick(T.Presence, reachable_walk(Tx.split_lines(text), prefix), T.Present{prefix}, T.Absent{})

def ref_result(+cls: T.StorageClass, +source: String, +path: String, reachable: Maybe<String>) -> T.Presence:
  match cls:
    case T.GitObject{}:
      +prefix = loose_prefix(path)
      Bool.pick(T.Presence, Bool.or(String.is_empty(source), String.is_empty(prefix)), T.Unknown{},
        ref_reachable(prefix, reachable))
    case T.SharedImmutable{}:
      T.Unknown{}
    case other:
      T.Absent{}

def run_text(+result: G.RunRes) -> Maybe<String>:
  match result:
    case G.RRun{G.SExit{code}, out}: Bool.pick(Maybe<String>, U32.is_eq(code, 0), Some{out}, None{})
    case G.RRun{G.SSignal{num}, out}: None{}
    case G.RSpawn{detail}: None{}

def ref_fact(+cls: T.StorageClass, +source: String, +path: String) -> IO(T.Presence):
  match cls:
    case T.GitObject{}:
      +prefix = loose_prefix(path)
      Bool.pick(IO(T.Presence), Bool.or(String.is_empty(source), String.is_empty(prefix)), IO.pure(T.Presence, T.Unknown{}),
        do IO<T.Presence>:
          listed : G.RunRes <- Git.runFull(["/usr/bin/env", "git", "-C", source, "rev-list", "--objects", "--all"], ".")
          IO.pure(T.Presence, ref_result(cls, source, path, run_text(listed))))
    case other:
      IO.pure(T.Presence, ref_result(cls, source, path, None{}))

def facts_choice(+cls: T.StorageClass, +source: String, +path: String, +state: State, +choice: OwnerChoice) -> IO(T.Facts):
  match choice:
    case OwnerChoice{owner, fact}:
      do IO<T.Facts>:
        process : T.Presence <- O.process_presence(path)
        runtime : T.Presence <- O.runtime_presence(path)
        dirty : T.Presence <- dirty_fact(cls, path)
        unpublished : T.Presence <- unpublished_fact(cls, source, path, state, owner)
        ref : T.Presence <- ref_fact(cls, source, path)
        database : T.Presence <- database_fact(state, path)
        lease : T.Presence = lease_fact(state, path)
        execution : T.Presence = execution_fact(cls, state, owner)
        pending_input : T.Presence = pending_fact(state, owner)
        IO.pure(T.Facts, T.Facts{fact, execution, database, lease, process, dirty, unpublished, runtime, ref, pending_input})

def invalid_facts() -> T.Facts:
  T.Facts{T.OwnerUnknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}}

def facts_valid(valid: Bool, +cls: T.StorageClass, +source: String, +path: String, +state: State) -> IO(T.Facts):
  match valid:
    case False{}: IO.pure(T.Facts, invalid_facts())
    case True{}: facts_choice(cls, source, path, state, owner_choice(state, path))

def facts_for(+cls: T.StorageClass, +source: String, +path: String, +state: State) -> IO(T.Facts):
  match state:
    case State{sessions, executions, logs, pending, databases, retained, valid}:
      facts_valid(valid, cls, source, path, state)
