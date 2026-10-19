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

def configured_roots() -> IO(List<&2,RootSpec>):
  do IO<List<&2,RootSpec>>:
    text : String <- IO.try(String, IO.get_env("BATON_STORAGE_ROOTS"))
    IO.pure(List<&2,RootSpec>, parse_roots(text))

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
    text : String <- IO.try(String, IO.get_env("BATON_STORAGE_EXCLUSIVE_ROOTS"))
    IO.pure(List<&2,String>, parse_exclusive(text))

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

def candidate_of(+session: String, +spec: RootSpec, state: S.State, +child: O.Child) -> IO(Maybe<T.Candidate>):
  match child:
    case O.Child{kind, name}:
      +path = join_path(root_path_of(spec), name)
      do IO<Maybe<T.Candidate>>:
        observed : O.Observation <- O.observe(path)
        answer : Maybe<T.Candidate> <- candidate_observed(session, spec, state, child, observed)
        IO.pure(Maybe<T.Candidate>, answer)

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

def preview_root(+session: String, +spec: RootSpec, +state: S.State) -> IO(RootPreview):
  do IO<RootPreview>:
    observed : O.Observation <- O.observe(root_path_of(spec))
    scan : O.Scan <- O.children(root_path_of(spec))
    current : RootPreview <- preview_scan(session, spec, state, observed, scan)
    IO.pure(RootPreview, current)

def preview_roots(+session: String, specs: List<&2,RootSpec>, +state: S.State, acc: List<RootPreview>) -> IO(List<RootPreview>):
  match specs:
    case Nil{}: IO.pure(List<RootPreview>, List.reverse(&1, RootPreview, acc))
    case Con{head, tail}:
      do IO<List<RootPreview>>:
        current : RootPreview <- preview_root(session, head, state)
        deeper : List<RootPreview> <- preview_roots(session, tail, state, Con{current, acc})
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

def apply_root(+session: String, +db: String, +spec: RootSpec) -> IO(T.Receipt):
  do IO<T.Receipt>:
    state : S.State <- S.load(db)
    preview : RootPreview <- preview_root(session, spec, state)
    receipt : T.Receipt <- apply_preview(db, spec, preview)
    IO.pure(T.Receipt, receipt)

def apply_roots(+session: String, +db: String, specs: List<&2,RootSpec>, acc: List<T.Receipt>) -> IO(List<T.Receipt>):
  match specs:
    case Nil{}: IO.pure(List<T.Receipt>, List.reverse(&1, T.Receipt, acc))
    case Con{head, tail}:
      do IO<List<T.Receipt>>:
        receipt : T.Receipt <- apply_root(session, db, head)
        deeper : List<T.Receipt> <- apply_roots(session, db, tail, Con{receipt, acc})
        IO.pure(List<T.Receipt>, deeper)

def run_preview(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    specs : List<&2,RootSpec> <- configured_roots()
    +state : S.State <- S.load(db)
    Bool.pick(IO(Unit), S.session_known(state, session),
      do IO<Unit>:
        previews : List<RootPreview> <- preview_roots(session, specs, state, Nil{})
        IO.write(previews_json(previews)),
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

def apply_locked(+session: String, +db: String, specs: List<&2,RootSpec>, lock: Maybe<U32>) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  match lock:
    case None{}: IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(4, "storage cleanup busy")})
    case Some{handle}:
      do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
        receipts : List<T.Receipt> <- apply_roots(session, db, specs, Nil{})
        released : Unit <- IO.try(Unit, Lock.SessionLock.release(handle))
        IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Done{receipts})

def apply_session(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
    +specs : List<&2,RootSpec> <- configured_roots()
    exclusive : List<&2,String> <- configured_exclusive()
    +unproven : String = unproven_roots(specs, exclusive, "")
    answer : Result<&1,&1,U32 & String,List<T.Receipt>> <- Bool.pick(IO(Result<&1,&1,U32 & String,List<T.Receipt>>), Bool.not(String.is_empty(unproven)),
      IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(3, "storage apply refused: no exclusive writer coordination for " ++ unproven)}),
      do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
        overlap : Bool = roots_overlap(specs)
        Bool.pick(IO(Result<&1,&1,U32 & String,List<T.Receipt>>), overlap,
          IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(3, "storage roots overlap")}),
          do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
            lock : Maybe<U32> <- IO.try(Maybe<U32>, Lock.SessionLock.try_acquire(db, "storage-cleanup"))
            result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_locked(session, db, specs, lock)
            IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, result)))
    IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, answer)

def run_apply_known(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    canonical : String <- IO.try(String, Lock.SessionLock.canonical(db))
    lock : Maybe<U32> <- IO.try(Maybe<U32>, Lock.SessionLock.try_acquire(canonical, session))
    match lock:
      case None{}: IO.die(Unit, 4, "storage cleanup busy: session lock held")
      case Some{handle}:
        do IO<Unit>:
          result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_session(db, session)
          released : Unit <- IO.try(Unit, Lock.SessionLock.release(handle))
          answer : Unit <- run_apply_result(result)
          IO.pure(Unit, answer)

def run_apply(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    state : S.State <- S.load(db)
    Bool.pick(IO(Unit), S.session_known(state, session),
      run_apply_known(db, session),
      IO.die(Unit, 2, "unknown session: " ++ session))

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

def previews_json(items: List<RootPreview>) -> String:
  "{\"roots\":[" ++ root_preview_items(items, "") ++ "]}"

def receipts_json(items: List<T.Receipt>) -> String:
  "{\"receipts\":[" ++ receipt_json_list(items, "") ++ "]}"

def run_apply_result(result: Result<&1,&1,U32 & String,List<T.Receipt>>) -> IO(Unit):
  match result:
    case Done{receipts}: IO.write(receipts_json(receipts))
    case Fail{error}:
      (code, detail) = error
      IO.die(Unit, code, detail)

def bool_json(+value: Bool) -> String:
  Bool.pick(String, value, "true", "false")

def policy_root_json(+spec: RootSpec, +exclusive: List<&2,String>) -> String:
  match spec:
    case RootSpec{cls, path, source}:
      "{\"root\":" ++ J.string_literal(path)
      ++ ",\"class\":" ++ J.string_literal(P.class_name(cls))
      ++ ",\"source\":" ++ J.string_literal(source)
      ++ ",\"exclusive\":" ++ bool_json(exclusive_member(path, exclusive)) ++ "}"

def policy_root_items(specs: List<&2,RootSpec>, +exclusive: List<&2,String>, +acc: String) -> String:
  match specs:
    case Nil{}: acc
    case Con{head, tail}:
      +item = policy_root_json(head, exclusive)
      +next = Bool.pick(String, String.is_empty(acc), item, acc ++ "," ++ item)
      policy_root_items(tail, exclusive, next)

def policy_json(+specs: List<&2,RootSpec>, +exclusive: List<&2,String>) -> String:
  +unproven : String = unproven_roots(specs, exclusive, "")
  "{\"ageOnlyDeletion\":false,\"apply\":" ++ J.string_literal(Bool.pick(String, String.is_empty(unproven), "ready", "refused"))
  ++ ",\"unprovenRoot\":" ++ J.string_literal(unproven)
  ++ ",\"roots\":[" ++ policy_root_items(specs, exclusive, "") ++ "]}"

def run_policy(+db: String) -> IO(Unit):
  do IO<Unit>:
    specs : List<&2,RootSpec> <- configured_roots()
    exclusive : List<&2,String> <- configured_exclusive()
    IO.write(policy_json(specs, exclusive))
