# Storage lifecycle integration for issue #912.
#
# Configured roots name the storage class they hold:
#
#   BATON_STORAGE_ROOTS
#     scratch=/path/to/scratch
#     build-output=/path/to/build
#     checkout=/path/to/worktrees
#     shared-immutable=/path/to/assets
#     git-object=/path/to/repo/.git/objects|/path/to/repo
#     log-evidence=/path/to/logs
#
# One entry per line, class=path, optional |source for a Git repository. An
# empty configuration performs no cleanup and leaves every existing path where
# it is. The process reads the roots the operator configured; it does not
# assume a homelab path or migrate existing files.
#
# Discovery reads immediate children, classifies each from its root, and asks
# the durable state and host for current evidence. Apply holds the storage
# cleanup lock, re-reads that evidence for each admitted entry, and revalidates
# the observed identity before unlinking.

import Base
import ./types.bend as T
import ./policy.bend as P
import ./apply.bend as A
import ./observe.bend as O
import ./state.bend as S
import ./cargo.bend as Cargo
import ../host/session-lock.bend as Lock
import ../json/canonical.bend as J
import ../git/text.bend as Tx

type RootSpec is Data:
  RootSpec{class: T.StorageClass, path: String, source: String}

type RootPreview is Type:
  RootPreview{root: String, mount: String, identity: String, preview: T.Preview}

def split_pipe(+text: String) -> List<&2,String>:
  String.split(text, Char.from_u32(124))

def source_of(parts: List<&2,String>) -> String:
  match parts:
    case Nil{}: ""
    case Con{head, tail}:
      match tail:
        case Nil{}: ""
        case Con{source, rest}: source

def first_part(parts: List<&2,String>) -> String:
  match parts:
    case Nil{}: ""
    case Con{head, tail}: head

def normalize_root(+path: String) -> String:
  +length = String.length(path)
  Bool.pick(String, Bool.and(Nat.is_gt(length, 1n), String.ends_with(path, "/")), String.take(path, Nat.sub(length, 1n)), path)

def root_fields(fields: List<&2,String>) -> RootSpec:
  match fields:
    case marker <> rest:
      +path = String.join(rest, "=")
      +parts = split_pipe(path)
      +root_path = normalize_root(first_part(parts))
      +source = source_of(parts)
      +cls = P.classify(marker)
      RootSpec{cls, root_path, source}
    case other: RootSpec{T.Unclassified{}, "", ""}

def root_spec(+line: String) -> RootSpec:
  root_fields(String.split(line, Char.from_u32(61)))

def root_path_of(+spec: RootSpec) -> String:
  match spec:
    case RootSpec{cls, path, source}: path

def root_source_of(+spec: RootSpec) -> String:
  match spec:
    case RootSpec{cls, path, source}: source

def roots_add_line(+line: String, acc: List<&2,RootSpec>, empty: Bool, comment: Bool) -> List<&2,RootSpec>:
  match empty:
    case True{}: acc
    case False{}:
      match comment:
        case True{}: acc
        case False{}: Con{root_spec(line), acc}

def roots_walk(lines: List<String>, acc: List<&2,RootSpec>) -> List<&2,RootSpec>:
  match lines:
    case Nil{}: List.reverse(&2, RootSpec, acc)
    case Con{+head, tail}:
      next = roots_add_line(head, acc, String.is_empty(head), String.starts_with(head, "#"))
      roots_walk(tail, next)

def parse_roots(+text: String) -> List<&2,RootSpec>:
  roots_walk(Tx.split_lines(text), Nil{})

def env_text(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: value
    case Fail{error}: ""

def configured_roots() -> IO(List<&2,RootSpec>):
  do IO<List<&2,RootSpec>>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON_STORAGE_ROOTS")
    IO.pure(List<&2,RootSpec>, parse_roots(env_text(result)))

def exclusive_add_line(+line: String, acc: List<&2,String>, empty: Bool, comment: Bool) -> List<&2,String>:
  match empty:
    case True{}: acc
    case False{}:
      match comment:
        case True{}: acc
        case False{}: Con{normalize_root(line), acc}

def exclusive_walk(lines: List<String>, acc: List<&2,String>) -> List<&2,String>:
  match lines:
    case Nil{}: List.reverse(&2, String, acc)
    case Con{+head, tail}:
      next = exclusive_add_line(head, acc, String.is_empty(head), String.starts_with(head, "#"))
      exclusive_walk(tail, next)

def parse_exclusive(+text: String) -> List<&2,String>:
  exclusive_walk(Tx.split_lines(text), Nil{})

def configured_exclusive() -> IO(List<&2,String>):
  do IO<List<&2,String>>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON_STORAGE_EXCLUSIVE_ROOTS")
    IO.pure(List<&2,String>, parse_exclusive(env_text(result)))

def exclusive_member(+path: String, rows: List<&2,String>) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{head, tail}: Bool.or(String.eq(path, head), exclusive_member(path, tail))

# The first configured root the operator has not declared exclusive to storage
# cleanup. Apply refuses while this answer names a root.
def unproven_roots(specs: List<&2,RootSpec>, +exclusive: List<&2,String>, +acc: String) -> String:
  match specs:
    case Nil{}: acc
    case Con{head, tail}:
      +path = root_path_of(head)
      Bool.pick(String, exclusive_member(path, exclusive), unproven_roots(tail, exclusive, acc),
        Bool.pick(String, String.is_empty(acc), path, acc))

# Storage cleanup is admitted for roots whose class is either managed by the
# cooperative writer lease (log evidence) or whose transient owner has settled.
# Absolute configuration is required because the recorded paths are canonical.
def covered_class(+cls: T.StorageClass) -> Bool:
  match cls:
    case T.LogEvidence{}: True{}
    case T.Scratch{}: True{}
    case T.BuildOutput{}: True{}
    case T.Export{}: True{}
    case T.Checkout{}: True{}
    case T.StagingSource{}: True{}
    case other: False{}

def covered_root(+spec: RootSpec) -> Bool:
  match spec:
    case RootSpec{cls, path, source}:
      Bool.and(covered_class(cls), String.starts_with(path, "/"))


def workspace_rows_under(rows: List<&2,S.SessionRow>, +root: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{head, tail}:
      match head:
        case S.SessionRow{id, workspace, branch, base}: Bool.or(S.path_under(workspace, root), workspace_rows_under(tail, root))

def log_rows_under(rows: List<&2,S.LogRow>, +root: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{head, tail}:
      match head:
        case S.LogRow{session, log}: Bool.or(S.path_under(log, root), log_rows_under(tail, root))

def execution_rows_under(rows: List<&2,S.ExecutionRow>, +root: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{head, tail}:
      match head:
        case S.ExecutionRow{session, id, directory, phase, status}: Bool.or(S.path_under(directory, root), execution_rows_under(tail, root))

def retained_rows_under(rows: List<&2,String>, +root: String) -> Bool:
  match rows:
    case Nil{}: False{}
    case Con{+head, tail}: Bool.or(S.path_under(head, root), retained_rows_under(tail, root))

def staging_referenced(+spec: RootSpec, +state: S.State) -> Bool:
  match spec:
    case RootSpec{cls, path, source}:
      match state:
        case S.State{sessions, executions, logs, pending, databases, retained, valid}:
          +transient = Bool.and(P.transient_class(cls),
            Bool.or(workspace_rows_under(sessions, path), execution_rows_under(executions, path)))
          Bool.and(covered_root(spec),
            Bool.or(transient,
              Bool.or(log_rows_under(logs, path),
                Bool.or(execution_rows_under(executions, path), retained_rows_under(retained, path)))))

# A covered root is admitted only when the database still references a
# registered log, a retained generation (log or base), or an execution
# directory under it. The class marker and an absolute path alone do not admit
# an arbitrary root.
def referenced_root(+spec: RootSpec, +state: S.State) -> Bool:
  match spec:
    case RootSpec{cls, path, source}:
      match cls:
        case T.StagingSource{}:
          # An ownership-ending staging root is admitted by the operator's
          # declaration together with the authenticated repository that must
          # contain each candidate commit. No session record exists for it.
          Bool.and(covered_root(spec), Bool.not(String.is_empty(source)))
        case other: staging_referenced(spec, state)

def uncovered_roots_state(specs: List<&2,RootSpec>, +state: S.State, +acc: String) -> String:
  match specs:
    case Nil{}: acc
    case Con{+head, tail}:
      +path : String = root_path_of(head)
      Bool.pick(String, referenced_root(head, state), uncovered_roots_state(tail, state, acc),
        Bool.pick(String, String.is_empty(acc), path, acc))

def canonical_equal(root: String, result: Result<&1,&1,U32 & String,String>) -> Bool:
  match result:
    case Done{value}: String.eq(value, root)
    case Fail{error}: False{}

def canonical_root_equal(+root: String) -> IO(Bool):
  do IO<Bool>:
    result : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(root)
    IO.pure(Bool, canonical_equal(root, result))

def canonical_roots_check(specs: List<&2,RootSpec>, +bad: String) -> IO(String):
  match specs:
    case Nil{}: IO.pure(String, bad)
    case Con{head, tail}:
      do IO<String>:
        +root : String = root_path_of(head)
        ok : Bool <- canonical_root_equal(root)
        +next : String = Bool.pick(String, Bool.and(String.is_empty(bad), Bool.not(ok)), root, bad)
        answer : String <- canonical_roots_check(tail, next)
        IO.pure(String, answer)

def better_root(+candidate: String, +current: String) -> String:
  Bool.pick(String, String.is_empty(current), candidate,
    Bool.pick(String, String.is_empty(candidate), current,
      Bool.pick(String, Nat.is_gt(String.length(candidate), String.length(current)), candidate, current)))

# The most specific covered configured root containing PATH. Writer output
# paths are canonical absolute paths produced by Control.output and the
# canonical database directory, so the comparison uses the configured root
# spelling apply scans.
def root_for_output(specs: List<&2,RootSpec>, +path: String, +current: String) -> String:
  match specs:
    case Nil{}: current
    case Con{+head, tail}:
      +root : String = root_path_of(head)
      +inside : Bool = Bool.and(covered_root(head), S.path_under(path, root))
      +next : String = Bool.pick(String, inside, better_root(root, current), current)
      root_for_output(tail, path, next)

def writer_paths(+log: String, +directory: String) -> List<&2,String>:
  Bool.pick(List<&2,String>, String.is_empty(log),
    Bool.pick(List<&2,String>, String.is_empty(directory), Nil{}, Con{directory, Nil{}}),
    Bool.pick(List<&2,String>, Bool.or(String.is_empty(directory), String.eq(log, directory)),
      Con{log, Nil{}}, Con{log, Con{directory, Nil{}}}))

def join_path(+root: String, +name: String) -> String:
  Bool.pick(String, String.ends_with(root, "/"), root ++ name, root ++ "/" ++ name)

def child_class(+spec: RootSpec, +child: O.Child) -> T.StorageClass:
  match spec:
    case RootSpec{cls, path, source}:
      match cls:
        case T.GitObject{}:
          match child:
            case O.Child{kind, name}:
              Bool.pick(T.StorageClass, Bool.and(String.eq(kind, "dir"), Bool.not(String.is_empty(S.loose_prefix(name)))), T.GitObject{}, T.Unclassified{})
        case other: cls

def candidate_path(+candidate: T.Candidate) -> String:
  match candidate:
    case T.Candidate{path, cls, owner, owner_proof, bytes, identity, facts}: path

def candidate_member(+path: String, candidates: List<T.Candidate>) -> Bool:
  match candidates:
    case Nil{}: False{}
    case Con{head, tail}:
      Bool.or(String.eq(path, candidate_path(head)), candidate_member(path, tail))

def add_candidate(+candidate: T.Candidate, candidates: List<T.Candidate>) -> List<T.Candidate>:
  Con{candidate, candidates}

def candidate_choice(+session: String, +cls: T.StorageClass, +path: String, +identity: String, +bytes: Nat, +facts: T.Facts, +choice: S.OwnerChoice) -> IO(Maybe<T.Candidate>):
  match choice:
    case S.OwnerChoice{owner, fact}:
      +selected = Bool.or(String.is_empty(session), String.eq(owner, session))
      Bool.pick(IO(Maybe<T.Candidate>), selected,
        do IO<Maybe<T.Candidate>>:
          proof : String = "owner:" ++ owner
          candidate : T.Candidate = T.Candidate{path, cls, owner, proof, bytes, identity, facts}
          IO.pure(Maybe<T.Candidate>, Some{candidate}),
        IO.pure(Maybe<T.Candidate>, None{}))

def candidate_total(+session: String, +spec: RootSpec, +state: S.State, +child: O.Child, +observed: O.Observation, +path: String, total: Maybe<Nat>) -> IO(Maybe<T.Candidate>):
  match total:
    case None{}: IO.pure(Maybe<T.Candidate>, None{})
    case Some{+bytes}:
      do IO<Maybe<T.Candidate>>:
        facts : T.Facts <- S.facts_for(child_class(spec, child), root_source_of(spec), path, state)
        answer : Maybe<T.Candidate> <- candidate_choice(session, child_class(spec, child), path, O.observation_identity(observed), bytes, facts, S.owner_choice(state, path))
        IO.pure(Maybe<T.Candidate>, answer)

def candidate_observed(+session: String, +spec: RootSpec, +state: S.State, +child: O.Child, +observed: O.Observation) -> IO(Maybe<T.Candidate>):
  match observed:
    case O.Found{+path, kind, device, inode, bytes}:
      do IO<Maybe<T.Candidate>>:
        total : Maybe<Nat> <- Bool.pick(IO(Maybe<Nat>), String.eq(kind, "file"), IO.pure(Maybe<Nat>, Some{bytes}), O.measure(path))
        answer : Maybe<T.Candidate> <- candidate_total(session, spec, state, child, observed, path, total)
        IO.pure(Maybe<T.Candidate>, answer)
    case other: IO.pure(Maybe<T.Candidate>, None{})

def lease_file_name() -> String:
  ".baton-writer-lease"

def candidate_of(+session: String, +spec: RootSpec, state: S.State, +child: O.Child) -> IO(Maybe<T.Candidate>):
  match child:
    case O.Child{kind, name}:
      Bool.pick(IO(Maybe<T.Candidate>), String.eq(name, lease_file_name()),
        IO.pure(Maybe<T.Candidate>, None{}),
        do IO<Maybe<T.Candidate>>:
          +path : String = join_path(root_path_of(spec), name)
          observed : O.Observation <- O.observe(path)
          answer : Maybe<T.Candidate> <- candidate_observed(session, spec, state, child, observed)
          IO.pure(Maybe<T.Candidate>, answer))

def candidate_list(candidate: Maybe<T.Candidate>) -> List<T.Candidate>:
  match candidate:
    case None{}: Nil{}
    case Some{value}: Con{value, Nil{}}

def children_candidates(+session: String, +spec: RootSpec, +state: S.State, children: List<&2,O.Child>, acc: List<T.Candidate>) -> IO(List<T.Candidate>):
  match children:
    case Nil{}: IO.pure(List<T.Candidate>, List.reverse(&1, T.Candidate, acc))
    case Con{head, tail}:
      do IO<List<T.Candidate>>:
        candidate : Maybe<T.Candidate> <- candidate_of(session, spec, state, head)
        next : List<T.Candidate> <- children_candidates(session, spec, state, tail, List.append(&1, T.Candidate, acc, candidate_list(candidate)))
        IO.pure(List<T.Candidate>, next)

def mount_of(+observed: O.Observation) -> String:
  match observed:
    case O.Found{path, kind, device, inode, bytes}: "device:" ++ device
    case other: ""

def preview_valid(+spec: RootSpec, +observed: O.Observation, valid: Bool, candidates: List<T.Candidate>) -> IO(RootPreview):
  do IO<RootPreview>:
    +root : String = root_path_of(spec)
    +mount : String = mount_of(observed)
    +identity : String = O.observation_identity(observed)
    planned : T.Preview = P.preview(root, mount, identity, valid, candidates)
    IO.pure(RootPreview, RootPreview{root, mount, identity, planned})

def preview_scan(+session: String, +spec: RootSpec, +state: S.State, +observed: O.Observation, scan: O.Scan) -> IO(RootPreview):
  match scan:
    case O.Scan{ok, items}:
      Bool.pick(IO(RootPreview), ok,
        do IO<RootPreview>:
          candidates : List<T.Candidate> <- children_candidates(session, spec, state, items, Nil{})
          current : RootPreview <- preview_valid(spec, observed, True{}, candidates)
          IO.pure(RootPreview, current),
        preview_valid(spec, observed, False{}, Nil{}))

def preview_root_generic(+session: String, +spec: RootSpec, +state: S.State) -> IO(RootPreview):
  do IO<RootPreview>:
    observed : O.Observation <- O.observe(root_path_of(spec))
    scan : O.Scan <- O.children(root_path_of(spec))
    current : RootPreview <- preview_scan(session, spec, state, observed, scan)
    IO.pure(RootPreview, current)

# Cargo consumers use canonical operation/workspace paths. Missing historical
# owners do not add a provenance requirement to generated output collection.
def cargo_reference_result(result: Result<&1,&1,U32 & String,String>, +path: String,
                           detail: String, unknown: Bool, next: Bool -> IO(T.Presence)) -> IO(T.Presence):
  match result:
    case Fail{error}: next(True{})
    case Done{+resolved}:
      Bool.pick(IO(T.Presence), Bool.or(S.path_under(path, resolved), S.path_under(resolved, path)),
        IO.pure(T.Presence, T.Present{detail}), next(unknown))

def cargo_pending_sessions(rows: List<&2,S.SessionRow>, +pending: List<&2,S.PendingRow>,
                           +path: String, +unknown: Bool) -> IO(T.Presence):
  match rows:
    case Nil{}: IO.pure(T.Presence, Bool.pick(T.Presence, unknown, T.Unknown{}, T.Absent{}))
    case S.SessionRow{+id, workspace, branch, base} <> +rest:
      Bool.pick(IO(T.Presence), U32.is_eq(S.pending_count(pending, id), 0),
        cargo_pending_sessions(rest, pending, path, unknown),
        do IO<T.Presence>:
          resolved : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(workspace)
          cargo_reference_result(resolved, path, "pending:" ++ id, unknown,
            next_unknown => cargo_pending_sessions(rest, pending, path, next_unknown)))

def cargo_executions(rows: List<&2,S.ExecutionRow>, +sessions: List<&2,S.SessionRow>,
                     +pending: List<&2,S.PendingRow>, +path: String, +unknown: Bool) -> IO(T.Presence):
  match rows:
    case Nil{}: cargo_pending_sessions(sessions, pending, path, unknown)
    case S.ExecutionRow{session, id, directory, phase, status} <> +rest:
      Bool.pick(IO(T.Presence), String.eq(phase, "exited"),
        cargo_executions(rest, sessions, pending, path, unknown),
        do IO<T.Presence>:
          resolved : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(directory)
          cargo_reference_result(resolved, path, "execution:" ++ id, unknown,
            next_unknown => cargo_executions(rest, sessions, pending, path, next_unknown)))

def cargo_consumer_operations(state: S.State, path: String) -> IO(T.Presence):
  match state:
    case S.State{sessions, executions, logs, pending, databases, retained, valid}:
      cargo_executions(executions, sessions, pending, path, False{})

def cargo_consumer_database(state: S.State, +path: String, database: T.Presence) -> IO(T.Presence):
  match database:
    case T.Absent{}: cargo_consumer_operations(state, path)
    case present: IO.pure(T.Presence, present)

def cargo_consumer_canonical(+state: S.State, canonical: Result<&1,&1,U32 & String,String>) -> IO(T.Presence):
  match canonical:
    case Fail{error}: IO.pure(T.Presence, T.Unknown{})
    case Done{+path}: do IO<T.Presence>:
      database : T.Presence <- S.database_fact(state, path)
      cargo_consumer_database(state, path, database)

def cargo_consumer_valid(+state: S.State, path: String, valid: Bool) -> IO(T.Presence):
  match valid:
    case False{}: IO.pure(T.Presence, T.Unknown{})
    case True{}: do IO<T.Presence>:
      canonical : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(path)
      cargo_consumer_canonical(state, canonical)

def cargo_state_consumer(+state: S.State, +path: String) -> IO(T.Presence):
  cargo_consumer_valid(state, path, S.valid_of(state))

def cargo_consumer(+db: String, +path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    state : S.State <- S.load(db)
    cargo_state_consumer(state, path)

# The root's recorded source names the producing service's selection
# authority. A `selection:` source names an ACP service selection record
# (schema acp.fframes-service-selection/v1) whose registered runtime, config
# and manifest paths stay retained. A directory source names an installed
# command directory whose symlinks resolve the runtime and rollback
# selections. A root without a recorded source keeps an unknown service and
# its output stays.
def root_selection(+db: String, +spec: RootSpec, +candidate: String) -> IO(T.Presence):
  match spec:
    case RootSpec{T.BuildOutput{}, +path, +source}:
      Bool.pick(IO(T.Presence), String.is_empty(source),
        Cargo.unknown_selection(candidate),
        Bool.pick(IO(T.Presence), String.starts_with(source, "selection:"),
          Cargo.acp_selection(db, String.drop(source, 10n), candidate),
          Cargo.baton_selection(source, candidate)))
    case other: Cargo.unknown_selection(candidate)

# Service producers use the same release path with their current selection
# reader. The apply pipeline holds the storage-cleanup session lock and the
# exclusive per-root cleanup lease across the collection.
def cargo_release(+db: String, +path: String, +associated: String,
                  selection: @+candidate: String -> IO(T.Presence)) -> IO(Cargo.Collection):
  Cargo.collect(path, associated, candidate => cargo_consumer(db, candidate), selection)

def preview_root_cargo(+db: String, +session: String, +spec: RootSpec, +state: S.State, output: Cargo.Output) -> IO(RootPreview):
  match output:
    case Cargo.Cargo{identity, origin}:
      do IO<RootPreview>:
        planned : T.Preview <- Cargo.preview(root_path_of(spec), session,
          candidate => cargo_state_consumer(state, candidate), candidate => root_selection(db, spec, candidate))
        +observed : O.Observation <- O.observe(root_path_of(spec))
        IO.pure(RootPreview, RootPreview{root_path_of(spec), mount_of(observed), O.observation_identity(observed), planned})
    case other: preview_root_generic(session, spec, state)

def preview_root(+db: String, +session: String, +spec: RootSpec, +state: S.State) -> IO(RootPreview):
  match spec:
    case RootSpec{T.BuildOutput{}, +path, +source}: do IO<RootPreview>:
      output : Cargo.Output <- Cargo.observe(path)
      preview_root_cargo(db, session, spec, state, output)
    case other: preview_root_generic(session, spec, state)

def preview_roots(+db: String, +session: String, specs: List<&2,RootSpec>, +state: S.State, acc: List<RootPreview>) -> IO(List<RootPreview>):
  match specs:
    case Nil{}: IO.pure(List<RootPreview>, List.reverse(&1, RootPreview, acc))
    case Con{head, tail}:
      do IO<List<RootPreview>>:
        current : RootPreview <- preview_root(db, session, head, state)
        deeper : List<RootPreview> <- preview_roots(db, session, tail, state, Con{current, acc})
        IO.pure(List<RootPreview>, deeper)

def entry_class(+entry: T.Entry) -> T.StorageClass:
  match entry:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}: cls

def entry_path(+entry: T.Entry) -> String:
  match entry:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}: path

def refresh_entry(+db: String, +spec: RootSpec, +entry: T.Entry) -> IO(T.Facts):
  do IO<T.Facts>:
    state : S.State <- S.load(db)
    cls : T.StorageClass = entry_class(entry)
    path : String = entry_path(entry)
    facts : T.Facts <- S.facts_for(cls, root_source_of(spec), path, state)
    IO.pure(T.Facts, facts)

def apply_preview(+db: String, +spec: RootSpec, preview: RootPreview) -> IO(T.Receipt):
  match preview:
    case RootPreview{root, mount, identity, planned}:
      A.apply(planned, A.Refresh{db, root_source_of(spec), root, identity})

def apply_root_generic(+session: String, +db: String, +spec: RootSpec) -> IO(T.Receipt):
  do IO<T.Receipt>:
    state : S.State <- S.load(db)
    preview : RootPreview <- preview_root(db, session, spec, state)
    receipt : T.Receipt <- apply_preview(db, spec, preview)
    IO.pure(T.Receipt, receipt)

def apply_root_cargo(+session: String, +db: String, +spec: RootSpec, output: Cargo.Output) -> IO(T.Receipt):
  match output:
    case Cargo.Cargo{identity, origin}:
      Cargo.receipt(root_path_of(spec), "", session, candidate => cargo_consumer(db, candidate),
        candidate => root_selection(db, spec, candidate))
    case other: apply_root_generic(session, db, spec)

def apply_root(+session: String, +db: String, +spec: RootSpec) -> IO(T.Receipt):
  match spec:
    case RootSpec{T.BuildOutput{}, +path, +source}: do IO<T.Receipt>:
      output : Cargo.Output <- Cargo.observe(path)
      apply_root_cargo(session, db, spec, output)
    case other: apply_root_generic(session, db, spec)

def apply_roots(+session: String, +db: String, specs: List<&2,RootSpec>, acc: List<T.Receipt>) -> IO(List<T.Receipt>):
  match specs:
    case Nil{}: IO.pure(List<T.Receipt>, List.reverse(&1, T.Receipt, acc))
    case Con{head, tail}:
      do IO<List<T.Receipt>>:
        receipt : T.Receipt <- apply_root(session, db, head)
        deeper : List<T.Receipt> <- apply_roots(session, db, tail, Con{receipt, acc})
        IO.pure(List<T.Receipt>, deeper)

def root_preview_json(item: RootPreview) -> String:
  match item:
    case RootPreview{root, mount, identity, planned}:
      "{\"root\":" ++ J.string_literal(root) ++ ",\"mount\":" ++ J.string_literal(mount) ++ ",\"identity\":" ++ J.string_literal(identity) ++ ",\"preview\":" ++ P.preview_json(planned) ++ "}"

def root_preview_append_choice(empty: Bool, +acc: String, head: RootPreview) -> String:
  match empty:
    case True{}: root_preview_json(head)
    case False{}: acc ++ "," ++ root_preview_json(head)

def root_preview_append(+acc: String, head: RootPreview) -> String:
  root_preview_append_choice(String.is_empty(acc), acc, head)

def root_preview_items(items: List<RootPreview>, +acc: String) -> String:
  match items:
    case Nil{}: acc
    case Con{head, tail}:
      +next = root_preview_append(acc, head)
      root_preview_items(tail, next)

def previews_json(items: List<RootPreview>) -> String:
  "{\"roots\":[" ++ root_preview_items(items, "") ++ "]}"

def preview_json(+db: String, +session: String) -> IO(String):
  do IO<String>:
    specs : List<&2,RootSpec> <- configured_roots()
    +state : S.State <- S.load(db)
    previews : List<RootPreview> <- preview_roots(db, session, specs, state, Nil{})
    IO.pure(String, previews_json(previews))

def run_preview(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    state : S.State <- S.load(db)
    Bool.pick(IO(Unit), S.session_known(state, session),
      do IO<Unit>:
        text : String <- preview_json(db, session)
        IO.write(text),
      IO.die(Unit, 2, "unknown session: " ++ session))


def root_overlap(+spec: RootSpec, rest: List<&2,RootSpec>) -> Bool:
  match rest:
    case Nil{}: False{}
    case Con{+head, tail}:
      Bool.or(S.path_under(root_path_of(spec), root_path_of(head)),
        Bool.or(S.path_under(root_path_of(head), root_path_of(spec)), root_overlap(spec, tail)))

def roots_overlap(specs: List<&2,RootSpec>) -> Bool:
  match specs:
    case Nil{}: False{}
    case Con{head, tail}: root_overlap(head, tail)

# Cooperative writer lease API. Baton-owned writers take the shared lease and
# hold it for the duration of their writes.
def acquire_writer_lease(+root: String) -> IO(Maybe<U32>):
  do IO<Maybe<U32>>:
    handle : Maybe<U32> <- O.acquire_writer_lease(root)
    IO.pure(Maybe<U32>, handle)

def acquire_cleanup_lease(+root: String) -> IO(Maybe<U32>):
  do IO<Maybe<U32>>:
    handle : Maybe<U32> <- O.acquire_cleanup_lease(root)
    IO.pure(Maybe<U32>, handle)

def release_lease(handle: U32) -> IO(Unit):
  do IO<Unit>:
    released : Unit <- O.release_lease(handle)
    IO.pure(Unit, released)

def roots_empty(specs: List<&2,RootSpec>) -> Bool:
  match specs:
    case Nil{}: True{}
    case Con{head, tail}: False{}

def release_leases(handles: List<&2,U32>) -> IO(Unit):
  match handles:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{head, tail}:
      do IO<Unit>:
        first : Unit <- release_lease(head)
        rest : Unit <- release_leases(tail)
        IO.pure(Unit, rest)

type WriterStep is Data:
  WriterStep{failed: String, held: List<&2,U32>}

def writer_step(handle: Maybe<U32>, held: List<&2,U32>, +failed: String, +root: String) -> WriterStep:
  match handle:
    case None{}: WriterStep{Bool.pick(String, String.is_empty(failed), root, failed), held}
    case Some{value}: WriterStep{failed, Con{value, held}}

def writer_step_failed(+step: WriterStep) -> String:
  match step:
    case WriterStep{failed, held}: failed

def writer_step_held(+step: WriterStep) -> List<&2,U32>:
  match step:
    case WriterStep{failed, held}: held

def finish_writer_leases(held: List<&2,U32>, failed: String, ok: Bool) -> IO(Result<&1,&1,U32 & String,List<&2,U32>>):
  match ok:
    case True{}: IO.pure(Result<&1,&1,U32 & String,List<&2,U32>>, Done{held})
    case False{}:
      do IO<Result<&1,&1,U32 & String,List<&2,U32>>>:
        released : Unit <- release_leases(held)
        IO.pure(Result<&1,&1,U32 & String,List<&2,U32>>, Fail{(3, "storage writer lease unavailable or held for root " ++ failed)})

# A managed writer holds a shared lease on every covered root that contains its
# output log or attempt directory. A path under no covered root contributes no
# lease. One unavailable root releases the leases already held.
def acquire_writer_paths(paths: List<&2,String>, +specs: List<&2,RootSpec>, +held: List<&2,U32>, +failed: String) -> IO(Result<&1,&1,U32 & String,List<&2,U32>>):
  match paths:
    case Nil{}: finish_writer_leases(held, failed, String.is_empty(failed))
    case Con{path, +tail}:
      do IO<Result<&1,&1,U32 & String,List<&2,U32>>>:
        +root : String = root_for_output(specs, path, "")
        answer : Result<&1,&1,U32 & String,List<&2,U32>> <- Bool.pick(IO(Result<&1,&1,U32 & String,List<&2,U32>>), String.is_empty(root),
          acquire_writer_paths(tail, specs, held, failed),
          do IO<Result<&1,&1,U32 & String,List<&2,U32>>>:
            handle : Maybe<U32> <- acquire_writer_lease(root)
            +step : WriterStep <- IO.pure(WriterStep, writer_step(handle, held, failed, root))
            acquire_writer_paths(tail, specs, writer_step_held(step), writer_step_failed(step)))
        IO.pure(Result<&1,&1,U32 & String,List<&2,U32>>, answer)

def with_writer_result(-A: Type, leases: Result<&1,&1,U32 & String,List<&2,U32>>, refused: U32 & String -> IO(A), next: Unit -> IO(A)) -> IO(A):
  match leases:
    case Fail{error}: refused(error)
    case Done{handles}:
      do IO<A>:
        answer : A <- next(Unit{})
        released : Unit <- release_leases(handles)
        IO.pure(A, answer)

# Hold shared writer leases for the output log and attempt directory across the
# caller's native spawn and retained output lifetime. The writer refuses without
# spawning when a covered root is unavailable.
def with_writer_leases(-A: Type, +log: String, +directory: String, refused: U32 & String -> IO(A), next: Unit -> IO(A)) -> IO(A):
  do IO<A>:
    specs : List<&2,RootSpec> <- configured_roots()
    +paths : List<&2,String> = writer_paths(log, directory)
    leases : Result<&1,&1,U32 & String,List<&2,U32>> <- acquire_writer_paths(paths, specs, Nil{}, "")
    with_writer_result(A, leases, refused, next)

type LeaseStep is Data:
  LeaseStep{missing: String, held: List<&2,U32>}

def lease_step(handle: Maybe<U32>, held: List<&2,U32>, +missing: String, +root: String) -> LeaseStep:
  match handle:
    case None{}:
      +next : String = Bool.pick(String, String.is_empty(missing), root, missing)
      LeaseStep{next, held}
    case Some{value}: LeaseStep{missing, Con{value, held}}

def step_missing(+step: LeaseStep) -> String:
  match step:
    case LeaseStep{missing, held}: missing

def step_held(+step: LeaseStep) -> List<&2,U32>:
  match step:
    case LeaseStep{missing, held}: held

def finish_lease_failure(held: List<&2,U32>, +root: String) -> IO(Result<&1,&1,U32 & String,List<&2,U32>>):
  do IO<Result<&1,&1,U32 & String,List<&2,U32>>>:
    released : Unit <- release_leases(held)
    IO.pure(Result<&1,&1,U32 & String,List<&2,U32>>, Fail{(3, "storage apply refused: cooperative root writer lease unavailable or held for root " ++ root)})

# Every configured root acquires its exclusive cleanup lease before any
# removal. One unavailable root releases the leases already acquired and
# refuses the apply with that root's path.
def finish_leases(held: List<&2,U32>, missing: String, ok: Bool) -> IO(Result<&1,&1,U32 & String,List<&2,U32>>):
  match ok:
    case True{}: IO.pure(Result<&1,&1,U32 & String,List<&2,U32>>, Done{held})
    case False{}: finish_lease_failure(held, missing)

def acquire_cleanup_leases(specs: List<&2,RootSpec>, held: List<&2,U32>, +missing: String) -> IO(Result<&1,&1,U32 & String,List<&2,U32>>):
  match specs:
    case Nil{}: finish_leases(held, missing, String.is_empty(missing))
    case Con{head, tail}:
      do IO<Result<&1,&1,U32 & String,List<&2,U32>>>:
        +root : String = root_path_of(head)
        handle : Maybe<U32> <- acquire_cleanup_lease(root)
        +step : LeaseStep <- IO.pure(LeaseStep, lease_step(handle, held, missing, root))
        answer : Result<&1,&1,U32 & String,List<&2,U32>> <- acquire_cleanup_leases(tail, step_held(step), step_missing(step))
        IO.pure(Result<&1,&1,U32 & String,List<&2,U32>>, answer)

def apply_leases(+session: String, +db: String, +specs: List<&2,RootSpec>, leases: Result<&1,&1,U32 & String,List<&2,U32>>) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  match leases:
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{error})
    case Done{handles}:
      do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
        receipts : List<T.Receipt> <- apply_roots(session, db, specs, Nil{})
        released : Unit <- release_leases(handles)
        IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Done{receipts})

def apply_locked(+session: String, +db: String, +specs: List<&2,RootSpec>, lock: Maybe<U32>) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  match lock:
    case None{}: IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(4, "storage cleanup busy")})
    case Some{handle}:
      do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
        leases : Result<&1,&1,U32 & String,List<&2,U32>> <- acquire_cleanup_leases(specs, Nil{}, "")
        answer : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_leases(session, db, specs, leases)
        released : Unit <- IO.try(Unit, Lock.SessionLock.release(handle))
        IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, answer)

def apply_canonical(+db: String, +session: String, +specs: List<&2,RootSpec>) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
    +bad : String <- canonical_roots_check(specs, "")
    Bool.pick(IO(Result<&1,&1,U32 & String,List<T.Receipt>>), String.is_empty(bad),
      do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
        lock : Maybe<U32> <- IO.try(Maybe<U32>, Lock.SessionLock.try_acquire(db, "storage-cleanup"))
        result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_locked(session, db, specs, lock)
        IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, result),
      IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(3, "storage apply refused: configured root is not a canonical directory: " ++ bad)}))

def apply_covered(+db: String, +session: String, +specs: List<&2,RootSpec>) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
    state : S.State <- S.load(db)
    +uncovered : String = uncovered_roots_state(specs, state, "")
    Bool.pick(IO(Result<&1,&1,U32 & String,List<T.Receipt>>), String.is_empty(uncovered),
      apply_canonical(db, session, specs),
      IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(3, "storage apply refused: no participating writer covers root " ++ uncovered)}))

def apply_session_roots(+db: String, +session: String, +specs: List<&2,RootSpec>) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
    Bool.pick(IO(Result<&1,&1,U32 & String,List<T.Receipt>>), roots_empty(specs),
      IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Done{Nil{}}),
      Bool.pick(IO(Result<&1,&1,U32 & String,List<T.Receipt>>), roots_overlap(specs),
        IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(3, "storage apply refused: configured storage roots overlap")}),
        apply_covered(db, session, specs)))

def apply_session(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
    specs : List<&2,RootSpec> <- configured_roots()
    result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_session_roots(db, session, specs)
    IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, result)

def receipt_append_choice(empty: Bool, +acc: String, head: T.Receipt) -> String:
  match empty:
    case True{}: P.receipt_json(head)
    case False{}: acc ++ "," ++ P.receipt_json(head)

def receipt_append(+acc: String, head: T.Receipt) -> String:
  receipt_append_choice(String.is_empty(acc), acc, head)

def receipt_json_list(items: List<T.Receipt>, +acc: String) -> String:
  match items:
    case Nil{}: acc
    case Con{head, tail}:
      +next = receipt_append(acc, head)
      receipt_json_list(tail, next)

def receipts_json(items: List<T.Receipt>) -> String:
  "{\"receipts\":[" ++ receipt_json_list(items, "") ++ "]}"

def run_apply_result(result: Result<&1,&1,U32 & String,List<T.Receipt>>) -> IO(Unit):
  match result:
    case Done{receipts}: IO.write(receipts_json(receipts))
    case Fail{error}:
      (code, detail) = error
      IO.die(Unit, code, detail)

def run_apply_known(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_session(db, session)
    run_apply_result(result)

def run_apply(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    state : S.State <- S.load(db)
    Bool.pick(IO(Unit), S.session_known(state, session),
      run_apply_known(db, session),
      IO.die(Unit, 2, "unknown session: " ++ session))

# Triggered collection. A settled session has no non-exited execution and no
# pending input; an unknown or unsettled session collects nothing. An apply
# that a trigger cannot complete (busy lease, overlapping or uncovered roots)
# contributes no receipt, so the trigger never changes the event that asked
# for it.
def collect_receipts(result: Result<&1,&1,U32 & String,List<T.Receipt>>) -> List<T.Receipt>:
  match result:
    case Done{receipts}: receipts
    case Fail{error}: Nil{}

# Triggered and deployment collection scans only the classes whose entries the
# policy can remove: scratch, build output, export and log evidence. Checkout
# roots stay for an explicit operator preview/apply, and the preserve-only
# shared-immutable, git-object and unclassified classes never participate.
def collectable_root(+spec: RootSpec) -> Bool:
  match spec:
    case RootSpec{cls, path, source}:
      match cls:
        case T.Scratch{}: True{}
        case T.BuildOutput{}: True{}
        case T.Export{}: True{}
        case T.LogEvidence{}: True{}
        case T.StagingSource{}: True{}
        case other: False{}

def collectable_roots(specs: List<&2,RootSpec>, +acc: List<&2,RootSpec>) -> List<&2,RootSpec>:
  match specs:
    case Nil{}: List.reverse(&2, RootSpec, acc)
    case Con{+head, tail}:
      +next = Bool.pick(List<&2,RootSpec>, collectable_root(head), Con{head, acc}, acc)
      collectable_roots(tail, next)

def collect_settled_roots(+db: String, +session: String, +specs: List<&2,RootSpec>) -> IO(List<T.Receipt>):
  do IO<List<T.Receipt>>:
    state : S.State <- S.load(db)
    +known : Bool = S.session_known(state, session)
    settled_state : S.State <- S.load(db)
    +reason : String = S.session_settled_reason(settled_state, session)
    Bool.pick(IO(List<T.Receipt>), Bool.and(known, String.is_empty(reason)),
      do IO<List<T.Receipt>>:
        result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_session_roots(db, session, collectable_roots(specs, Nil{}))
        IO.pure(List<T.Receipt>, collect_receipts(result)),
      IO.pure(List<T.Receipt>, Nil{}))

def collect_settled(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    specs : List<&2,RootSpec> <- configured_roots()
    _receipts : List<T.Receipt> <- collect_settled_roots(db, session, specs)
    IO.pure(Unit, Unit{})

def collect_skipped_json(session: String, reason: String) -> String:
  "{\"session\":" ++ J.string_literal(session) ++ ",\"skipped\":" ++ J.string_literal(reason) ++ ",\"receipts\":[]}"

def collect_refused_json(session: String, code: U32, detail: String) -> String:
  "{\"session\":" ++ J.string_literal(session) ++ ",\"refused\":" ++ J.string_literal(U32.show(code) ++ ": " ++ detail) ++ ",\"receipts\":[]}"

def run_collect_result(session: String, result: Result<&1,&1,U32 & String,List<T.Receipt>>) -> IO(Unit):
  match result:
    case Done{receipts}: IO.write(receipts_json(receipts))
    case Fail{(+code, +detail)}:
      IO.die(Unit, code, collect_refused_json(session, code, detail))

# Explicit collection for deployment and qualification: the same settled gate,
# with a typed skip for an unsettled session and a typed refusal for an apply
# that cannot run.
def run_collect(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    state : S.State <- S.load(db)
    Bool.pick(IO(Unit), S.session_known(state, session),
      do IO<Unit>:
        settled_state : S.State <- S.load(db)
        +reason : String = S.session_settled_reason(settled_state, session)
        Bool.pick(IO(Unit), String.is_empty(reason),
          do IO<Unit>:
            specs : List<&2,RootSpec> <- configured_roots()
            result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_session_roots(db, session, collectable_roots(specs, Nil{}))
            run_collect_result(session, result),
          IO.write(collect_skipped_json(session, reason))),
      IO.die(Unit, 2, "unknown session: " ++ session))

# Scheduled collection for the qualified storage helper: every registered
# session runs the same settled gate and collectable-root selection as
# run_collect. Each session contributes one JSON object; a skip or refusal is
# reported per session and never stops the sweep.
def collect_outcome_json(+session: String, result: Result<&1,&1,U32 & String,List<T.Receipt>>) -> String:
  match result:
    case Done{receipts}: receipts_json(receipts)
    case Fail{(+code, +detail)}: collect_refused_json(session, code, detail)

def sweep_row(+db: String, +session: String) -> IO(String):
  do IO<String>:
    state : S.State <- S.load(db)
    Bool.pick(IO(String), S.session_known(state, session),
      do IO<String>:
        settled_state : S.State <- S.load(db)
        +reason : String = S.session_settled_reason(settled_state, session)
        Bool.pick(IO(String), String.is_empty(reason),
          do IO<String>:
            specs : List<&2,RootSpec> <- configured_roots()
            result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_session_roots(db, session, collectable_roots(specs, Nil{}))
            IO.pure(String, "{\"session\":" ++ J.string_literal(session) ++ ",\"result\":" ++ collect_outcome_json(session, result) ++ "}"),
          IO.pure(String, "{\"session\":" ++ J.string_literal(session) ++ ",\"result\":" ++ collect_skipped_json(session, reason) ++ "}")),
      IO.pure(String, "{\"session\":" ++ J.string_literal(session) ++ ",\"result\":" ++ collect_refused_json(session, 2, "unknown session: " ++ session) ++ "}"))

def sweep_append(empty: Bool, +acc: String, +head: String) -> String:
  Bool.pick(String, empty, head, acc ++ "," ++ head)

def sweep_join(sessions: List<&2,S.SessionRow>, +db: String, +acc: String, empty: Bool) -> IO(String):
  match sessions:
    case Nil{}: IO.pure(String, "{\"results\":[" ++ acc ++ "]}")
    case S.SessionRow{+id, workspace, branch, base} <> +rest:
      do IO<String>:
        row : String <- sweep_row(db, id)
        +next : String = sweep_append(empty, acc, row)
        sweep_join(rest, db, next, False{})

def sweep_state(state: S.State, +db: String) -> IO(String):
  match state:
    case S.State{sessions, executions, logs, pending, databases, retained, valid}:
      sweep_join(sessions, db, "", True{})

def run_sweep(+db: String) -> IO(Unit):
  do IO<Unit>:
    state : S.State <- S.load(db)
    rows : String <- sweep_state(state, db)
    IO.write(rows)

def bool_json(+value: Bool) -> String:
  Bool.pick(String, value, "true", "false")

def policy_root_json(+spec: RootSpec, +exclusive: List<&2,String>, +state: S.State) -> String:
  match spec:
    case RootSpec{cls, path, source}:
      "{\"root\":" ++ J.string_literal(path)
      ++ ",\"class\":" ++ J.string_literal(P.class_name(cls))
      ++ ",\"source\":" ++ J.string_literal(source)
      ++ ",\"exclusive\":" ++ bool_json(exclusive_member(path, exclusive))
      ++ ",\"covered\":" ++ bool_json(referenced_root(spec, state)) ++ "}"

def policy_root_items(specs: List<&2,RootSpec>, +exclusive: List<&2,String>, +state: S.State, +acc: String) -> String:
  match specs:
    case Nil{}: acc
    case Con{head, tail}:
      +item = policy_root_json(head, exclusive, state)
      +next = Bool.pick(String, String.is_empty(acc), item, acc ++ "," ++ item)
      policy_root_items(tail, exclusive, state, next)

def policy_json(+specs: List<&2,RootSpec>, +exclusive: List<&2,String>, +state: S.State) -> String:
  +unproven : String = unproven_roots(specs, exclusive, "")
  +uncovered : String = uncovered_roots_state(specs, state, "")
  +apply_state : String = Bool.pick(String, roots_empty(specs), "ready",
    Bool.pick(String, String.is_empty(uncovered), "lease-gated", "refused"))
  "{\"ageOnlyDeletion\":false,\"apply\":" ++ J.string_literal(apply_state)
  ++ ",\"unprovenRoot\":" ++ J.string_literal(unproven)
  ++ ",\"uncoveredRoot\":" ++ J.string_literal(uncovered)
  ++ ",\"roots\":[" ++ policy_root_items(specs, exclusive, state, "") ++ "]}"

def run_policy(+db: String) -> IO(Unit):
  do IO<Unit>:
    specs : List<&2,RootSpec> <- configured_roots()
    exclusive : List<&2,String> <- configured_exclusive()
    state : S.State <- S.load(db)
    IO.write(policy_json(specs, exclusive, state))
