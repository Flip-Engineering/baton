# Current durable evidence for storage cleanup.
#
# The coordinator database supplies session workspaces, execution directories
# and registered log paths. Git supplies worktree dirtiness and reachability of
# loose objects. The host supplies live cwd, open descriptors and path identity.
# Unknown evidence preserves the candidate.

import Base
import ./types.bend as T
import ./observe.bend as O
import ../host/sqlite.bend as DB
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

type State is Data:
  State{sessions: List<&2,SessionRow>, executions: List<&2,ExecutionRow>, logs: List<&2,LogRow>, pending: List<&2,PendingRow>, databases: List<&2,String>, valid: Bool}

type OwnerChoice is Data:
  OwnerChoice{owner: String, fact: T.Owner}

type DatabaseRows is Data:
  DatabaseRows{rows: List<&2,String>, invalid: Bool}

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
def database_lines_walk(rows: List<String>, acc: List<&2,String>, invalid: Bool) -> DatabaseRows:
  match rows:
    case Nil{}: DatabaseRows{List.reverse(&2, String, acc), invalid}
    case Con{head, tail}:
      match head:
        case "~invalid": database_lines_walk(tail, acc, True{})
        case "~missing": database_lines_walk(tail, acc, True{})
        case "": database_lines_walk(tail, acc, invalid)
        case other: database_lines_walk(tail, Con{decode_field(other), acc}, invalid)

def database_entries_finish(db: String, +result: DatabaseRows) -> DatabaseRows:
  match result:
    case DatabaseRows{rows, invalid}: DatabaseRows{Con{db, rows}, invalid}

def database_entries(+db: String, +text: String) -> DatabaseRows:
  database_entries_finish(db, database_lines_walk(Tx.split_lines(text), Nil{}, False{}))

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

def valid_of(state: State) -> Bool:
  match state:
    case State{sessions, executions, logs, pending, databases, valid}: valid

def state_from_database(sessions: List<&2,SessionRow>, executions: List<&2,ExecutionRow>, logs: List<&2,LogRow>, pending: List<&2,PendingRow>, rows_valid: Bool, +result: DatabaseRows) -> State:
  match result:
    case DatabaseRows{databases, database_invalid}:
      +valid = Bool.and(rows_valid, Bool.not(database_invalid))
      State{sessions, executions, logs, pending, databases, valid}

def load(+db: String) -> IO(State):
  do IO<State>:
    sessions_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN id='' THEN '~' ELSE hex(id) END,CASE WHEN workspace='' THEN '~' ELSE hex(workspace) END,CASE WHEN branch='' THEN '~' ELSE hex(branch) END,CASE WHEN base='' THEN '~' ELSE hex(base) END FROM sessions ORDER BY id;"))
    executions_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN session='' THEN '~' ELSE hex(session) END,CASE WHEN id='' THEN '~' ELSE hex(id) END,CASE WHEN directory='' THEN '~' ELSE hex(directory) END,CASE WHEN phase='' THEN '~' ELSE hex(phase) END,CASE WHEN status='' THEN '~' ELSE hex(status) END FROM executions ORDER BY session;"))
    logs_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN session='' THEN '~' ELSE hex(session) END,CASE WHEN log='' THEN '~' ELSE hex(log) END FROM log_files ORDER BY session,log;"))
    pending_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN recipient='' THEN '~' ELSE hex(recipient) END,count(*) FROM messages WHERE receipt IS NULL GROUP BY recipient ORDER BY recipient;"))
    +sessions : List<&2,SessionRow> = sessions_walk(Tx.split_lines(sessions_text), Nil{})
    +executions : List<&2,ExecutionRow> = executions_walk(Tx.split_lines(executions_text), Nil{})
    +logs : List<&2,LogRow> = logs_walk(Tx.split_lines(logs_text), Nil{})
    +pending : List<&2,PendingRow> = pending_walk(Tx.split_lines(pending_text), Nil{})
    database_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN endpoint='' THEN '' WHEN json_valid(endpoint)=0 THEN '~invalid' ELSE CASE WHEN json_type(endpoint)!='array' THEN '~invalid' WHEN json_extract(endpoint,'$[1]') IS NULL OR json_type(endpoint,'$[1]')!='text' OR json_extract(endpoint,'$[1]')='' THEN '~missing' ELSE hex(json_extract(endpoint,'$[1]')) END END FROM sessions ORDER BY id;"))
    rows_valid_text : String <- IO.try(String, DB.Sql.read(db, "SELECT CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE id='') OR EXISTS(SELECT 1 FROM executions WHERE session='' OR id='') OR EXISTS(SELECT 1 FROM log_files WHERE session='' OR log='') OR EXISTS(SELECT 1 FROM messages WHERE receipt IS NULL AND recipient='') THEN '0' ELSE '1' END;"))
    rows_valid : Bool = String.eq(Tx.trim_nl(rows_valid_text), "1")
    IO.pure(State, state_from_database(sessions, executions, logs, pending, rows_valid, database_entries(db, database_text)))

def path_under(+path: String, +parent: String) -> Bool:
  Bool.pick(Bool, String.is_empty(parent), False{},
    Bool.or(String.eq(path, parent), String.starts_with(path, parent ++ "/")))

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
          next = owner_append(path_under(path, directory), session, acc)
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

def owner_choice_lists(owners: List<String>) -> OwnerChoice:
  match owners:
    case Nil{}: OwnerChoice{"", T.OwnerMissing{}}
    case Con{+only, Nil{}}:
      fact : T.Owner = T.OwnerMatches{only}
      OwnerChoice{only, fact}
    case other: OwnerChoice{"", T.OwnerUnknown{}}
def owner_choice(+state: State, +path: String) -> OwnerChoice:
  match state:
    case State{sessions, executions, logs, pending, databases, valid}:
      owner_choice_lists(execution_owners(executions, path, workspace_owners(sessions, path, log_owners(logs, path, Nil{}))))

def active_execution(rows: List<&2,ExecutionRow>, +path: String) -> String:
  match rows:
    case Nil{}: ""
    case Con{head, tail}:
      match head:
        case ExecutionRow{session, +id, directory, phase, status}:
          Bool.pick(String, Bool.and(path_under(path, directory), Bool.not(String.eq(phase, "exited"))),
            Bool.pick(String, String.is_empty(id), "execution", "execution:" ++ id),
            active_execution(tail, path))

def lease_fact(+state: State, +path: String) -> T.Presence:
  match state:
    case State{sessions, executions, logs, pending, databases, valid}:
      +active = active_execution(executions, path)
      Bool.pick(T.Presence, String.is_empty(active), T.Absent{}, T.Present{active})

def pending_count(rows: List<&2,PendingRow>, +owner: String) -> U32:
  match rows:
    case Nil{}: 0
    case Con{head, tail}:
      match head:
        case PendingRow{session, count}: Bool.pick(U32, String.eq(session, owner), count, pending_count(tail, owner))

def pending_fact(+state: State, +owner: String) -> T.Presence:
  match state:
    case State{sessions, executions, logs, pending, databases, valid}:
      +count = pending_count(pending, owner)
      Bool.pick(T.Presence, U32.is_eq(count, 0), T.Absent{}, T.Present{U32.show(count)})

def database_path_hit(rows: List<&2,String>, +path: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{head, tail}: Bool.or(path_under(head, path), database_path_hit(tail, path))

# A candidate that is an active coordinator database path, or an ancestor of
# one, is preserved. The comparison uses recorded path strings, so an owner
# that holds a database descriptor after the directory entry is unlinked is
# still protected. Invalid or incomplete endpoint evidence answers Unknown.
def database_fact(+state: State, +path: String) -> T.Presence:
  match state:
    case State{sessions, executions, logs, pending, databases, valid}:
      Bool.pick(T.Presence, valid,
        Bool.pick(T.Presence, String.is_empty(path), T.Unknown{},
          Bool.pick(T.Presence, database_path_hit(databases, path), T.Present{"database-path"}, T.Absent{})),
        T.Unknown{})

def session_match(rows: List<&2,SessionRow>, +session: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{head, tail}:
      match head:
        case SessionRow{id, workspace, branch, base}: Bool.or(String.eq(id, session), session_match(tail, session))

def session_known(+state: State, +session: String) -> Bool:
  match state:
    case State{sessions, executions, logs, pending, databases, valid}: session_match(sessions, session)

def dirty_result(status: Result<&1, &1, G.GitFail, G.WtStatus>) -> T.Presence:
  match status:
    case Done{G.Wt{branch, commit, dirty}}:
      Bool.pick(T.Presence, dirty, T.Present{"worktree"}, T.Absent{})
    case Done{made}: T.Unknown{}
    case Fail{fail}: T.Unknown{}

def dirty_fact(+cls: T.StorageClass, +path: String) -> IO(T.Presence):
  match cls:
    case T.Checkout{}:
      do IO<T.Presence>:
        status : Result<&1, &1, G.GitFail, G.WtStatus> <- WS.worktreeStatus(path)
        IO.pure(T.Presence, dirty_result(status))
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

def unpublished_fact(+cls: T.StorageClass, +path: String, +state: State, +owner: String) -> IO(T.Presence):
  match cls:
    case T.Checkout{}:
      match state:
        case State{sessions, executions, logs, pending, databases, valid}:
          +base = session_base(sessions, owner)
          unpublished_command(base, path)
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
        unpublished : T.Presence <- unpublished_fact(cls, path, state, owner)
        ref : T.Presence <- ref_fact(cls, source, path)
        +database : T.Presence = database_fact(state, path)
        lease : T.Presence = lease_fact(state, path)
        pending_input : T.Presence = pending_fact(state, owner)
        IO.pure(T.Facts, T.Facts{fact, database, lease, process, dirty, unpublished, runtime, ref, pending_input})

def invalid_facts() -> T.Facts:
  T.Facts{T.OwnerUnknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}, T.Unknown{}}

def facts_valid(valid: Bool, +cls: T.StorageClass, +source: String, +path: String, +state: State) -> IO(T.Facts):
  match valid:
    case False{}: IO.pure(T.Facts, invalid_facts())
    case True{}: facts_choice(cls, source, path, state, owner_choice(state, path))

def facts_for(+cls: T.StorageClass, +source: String, +path: String, +state: State) -> IO(T.Facts):
  match state:
    case State{sessions, executions, logs, pending, databases, valid}:
      facts_valid(valid, cls, source, path, state)
