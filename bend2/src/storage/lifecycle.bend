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

def join_path(+root: String, +name: String) -> String:
  Bool.pick(String, String.ends_with(root, "/"), root ++ name, root ++ "/" ++ name)

def roots_for(+session: String, state: S.State) -> List<&2,RootSpec>:
  +workspace = S.workspace_of(state, session)
  Bool.pick(List<&2,RootSpec>, String.is_empty(workspace), Nil{},
    Con{RootSpec{T.Scratch{}, workspace ++ "/.scratch", ""},
      Con{RootSpec{T.BuildOutput{}, workspace ++ "/.build", ""},
        Con{RootSpec{T.GitObject{}, workspace ++ "/.git/objects", workspace}, Nil{}}}})

def root_path_of(spec: RootSpec) -> String:
  match spec:
    case RootSpec{cls, path, source}: path

def root_source_of(spec: RootSpec) -> String:
  match spec:
    case RootSpec{cls, path, source}: source

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

def candidate_choice(+cls: T.StorageClass, +path: String, +identity: String, +bytes: Nat, +facts: T.Facts, +choice: S.OwnerChoice) -> IO(Maybe<T.Candidate>):
  match choice:
    case S.OwnerChoice{owner, fact}:
      proof : String = "owner:" ++ owner
      candidate : T.Candidate = T.Candidate{path, cls, owner, proof, bytes, identity, facts}
      IO.pure(Maybe<T.Candidate>, Some{candidate})

def candidate_total(+spec: RootSpec, +state: S.State, +child: O.Child, +observed: O.Observation, +path: String, total: Maybe<Nat>) -> IO(Maybe<T.Candidate>):
  match total:
    case None{}: IO.pure(Maybe<T.Candidate>, None{})
    case Some{+bytes}:
      do IO<Maybe<T.Candidate>>:
        facts : T.Facts <- S.facts_for(child_class(spec, child), root_source_of(spec), path, state)
        answer : Maybe<T.Candidate> <- candidate_choice(child_class(spec, child), path, O.observation_identity(observed), bytes, facts, S.owner_choice(state, path))
        IO.pure(Maybe<T.Candidate>, answer)

def candidate_observed(+spec: RootSpec, +state: S.State, +child: O.Child, +observed: O.Observation) -> IO(Maybe<T.Candidate>):
  match observed:
    case O.Found{+path, kind, device, inode, bytes}:
      do IO<Maybe<T.Candidate>>:
        total : Maybe<Nat> <- Bool.pick(IO(Maybe<Nat>), String.eq(kind, "file"), IO.pure(Maybe<Nat>, Some{bytes}), O.measure(path))
        answer : Maybe<T.Candidate> <- candidate_total(spec, state, child, observed, path, total)
        IO.pure(Maybe<T.Candidate>, answer)
    case other: IO.pure(Maybe<T.Candidate>, None{})

def candidate_of(+spec: RootSpec, state: S.State, +child: O.Child) -> IO(Maybe<T.Candidate>):
  match child:
    case O.Child{kind, name}:
      +path = join_path(root_path_of(spec), name)
      do IO<Maybe<T.Candidate>>:
        observed : O.Observation <- O.observe(path)
        answer : Maybe<T.Candidate> <- candidate_observed(spec, state, child, observed)
        IO.pure(Maybe<T.Candidate>, answer)

def candidate_list(candidate: Maybe<T.Candidate>) -> List<T.Candidate>:
  match candidate:
    case None{}: Nil{}
    case Some{value}: Con{value, Nil{}}

def children_candidates(+spec: RootSpec, +state: S.State, children: List<&2,O.Child>, acc: List<T.Candidate>) -> IO(List<T.Candidate>):
  match children:
    case Nil{}: IO.pure(List<T.Candidate>, List.reverse(&1, T.Candidate, acc))
    case Con{head, tail}:
      do IO<List<T.Candidate>>:
        candidate : Maybe<T.Candidate> <- candidate_of(spec, state, head)
        next : List<T.Candidate> <- children_candidates(spec, state, tail, List.append(&1, T.Candidate, acc, candidate_list(candidate)))
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

def preview_scan(+spec: RootSpec, +state: S.State, +observed: O.Observation, scan: O.Scan) -> IO(RootPreview):
  match scan:
    case O.Scan{ok, items}:
      Bool.pick(IO(RootPreview), ok,
        do IO<RootPreview>:
          candidates : List<T.Candidate> <- children_candidates(spec, state, items, Nil{})
          current : RootPreview <- preview_valid(spec, observed, True{}, candidates)
          IO.pure(RootPreview, current),
        preview_valid(spec, observed, False{}, Nil{}))

def preview_root(+spec: RootSpec, +state: S.State) -> IO(RootPreview):
  do IO<RootPreview>:
    observed : O.Observation <- O.observe(root_path_of(spec))
    scan : O.Scan <- O.children(root_path_of(spec))
    current : RootPreview <- preview_scan(spec, state, observed, scan)
    IO.pure(RootPreview, current)

def preview_roots(specs: List<&2,RootSpec>, +state: S.State, acc: List<RootPreview>) -> IO(List<RootPreview>):
  match specs:
    case Nil{}: IO.pure(List<RootPreview>, List.reverse(&1, RootPreview, acc))
    case Con{head, tail}:
      do IO<List<RootPreview>>:
        current : RootPreview <- preview_root(head, state)
        deeper : List<RootPreview> <- preview_roots(tail, state, Con{current, acc})
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

def apply_root(+db: String, +spec: RootSpec) -> IO(T.Receipt):
  do IO<T.Receipt>:
    state : S.State <- S.load(db)
    preview : RootPreview <- preview_root(spec, state)
    receipt : T.Receipt <- apply_preview(db, spec, preview)
    IO.pure(T.Receipt, receipt)

def apply_roots(+db: String, specs: List<&2,RootSpec>, acc: List<T.Receipt>) -> IO(List<T.Receipt>):
  match specs:
    case Nil{}: IO.pure(List<T.Receipt>, List.reverse(&1, T.Receipt, acc))
    case Con{head, tail}:
      do IO<List<T.Receipt>>:
        receipt : T.Receipt <- apply_root(db, head)
        deeper : List<T.Receipt> <- apply_roots(db, tail, Con{receipt, acc})
        IO.pure(List<T.Receipt>, deeper)

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

def run_preview(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,List<RootPreview>>):
  do IO<Result<&1,&1,U32 & String,List<RootPreview>>>:
    +state : S.State <- S.load(db)
    +specs : List<&2,RootSpec> = roots_for(session, state)
    overlap : Bool = roots_overlap(specs)
    answer : Result<&1,&1,U32 & String,List<RootPreview>> <- Bool.pick(IO(Result<&1,&1,U32 & String,List<RootPreview>>), overlap,
      IO.pure(Result<&1,&1,U32 & String,List<RootPreview>>, Fail{(3, "storage roots overlap")}),
      do IO<Result<&1,&1,U32 & String,List<RootPreview>>>:
        previews : List<RootPreview> <- preview_roots(specs, state, Nil{})
        IO.pure(Result<&1,&1,U32 & String,List<RootPreview>>, Done{previews}))
    IO.pure(Result<&1,&1,U32 & String,List<RootPreview>>, answer)

def locked_apply(+db: String, specs: List<&2,RootSpec>, lock: Maybe<U32>) -> IO(List<T.Receipt>):
  match lock:
    case None{}:
      IO.pure(List<T.Receipt>, Nil{})
    case Some{handle}:
      do IO<List<T.Receipt>>:
        receipts : List<T.Receipt> <- apply_roots(db, specs, Nil{})
        released : Unit <- IO.try(Unit, Lock.SessionLock.release(handle))
        IO.pure(List<T.Receipt>, receipts)

def apply_locked(+db: String, specs: List<&2,RootSpec>, lock: Maybe<U32>) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  match lock:
    case None{}: IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(4, "storage cleanup busy")})
    case Some{handle}:
      do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
        receipts : List<T.Receipt> <- apply_roots(db, specs, Nil{})
        released : Unit <- IO.try(Unit, Lock.SessionLock.release(handle))
        IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Done{receipts})

def run_apply(+db: String, +session: String) -> IO(Result<&1,&1,U32 & String,List<T.Receipt>>):
  do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
    +state : S.State <- S.load(db)
    +specs : List<&2,RootSpec> = roots_for(session, state)
    overlap : Bool = roots_overlap(specs)
    answer : Result<&1,&1,U32 & String,List<T.Receipt>> <- Bool.pick(IO(Result<&1,&1,U32 & String,List<T.Receipt>>), overlap,
      IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, Fail{(3, "storage roots overlap")}),
      do IO<Result<&1,&1,U32 & String,List<T.Receipt>>>:
        lock : Maybe<U32> <- IO.try(Maybe<U32>, Lock.SessionLock.try_acquire(db, "storage-cleanup"))
        result : Result<&1,&1,U32 & String,List<T.Receipt>> <- apply_locked(db, specs, lock)
        IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, result))
    IO.pure(Result<&1,&1,U32 & String,List<T.Receipt>>, answer)

def root_preview_json(item: RootPreview) -> String:
  match item:
    case RootPreview{root, mount, identity, planned}:
      "{\"root\":" ++ J.string_literal(root) ++ ",\"mount\":" ++ J.string_literal(mount) ++ ",\"identity\":" ++ J.string_literal(identity) ++ ",\"preview\":" ++ P.preview_json(planned) ++ "}"

def root_preview_items(items: List<RootPreview>, +acc: String) -> String:
  match items:
    case Nil{}: acc
    case Con{head, tail}:
      +piece = root_preview_json(head)
      +next = Bool.pick(String, String.is_empty(acc), piece, acc ++ "," ++ piece)
      root_preview_items(tail, next)

def receipt_json_list(items: List<T.Receipt>, +acc: String) -> String:
  match items:
    case Nil{}: acc
    case Con{head, tail}:
      +piece = P.receipt_json(head)
      +next = Bool.pick(String, String.is_empty(acc), piece, acc ++ "," ++ piece)
      receipt_json_list(tail, next)

def previews_json(items: List<RootPreview>) -> String:
  "{\"roots\":[" ++ root_preview_items(items, "") ++ "]}"

def receipts_json(items: List<T.Receipt>) -> String:
  "{\"receipts\":[" ++ receipt_json_list(items, "") ++ "]}"

def preview_result(result: Result<&1,&1,U32 & String,List<RootPreview>>) -> IO(Unit):
  match result:
    case Done{previews}: IO.write(previews_json(previews))
    case Fail{error}:
      (code, detail) = error
      IO.die(Unit, code, detail)

def apply_result(result: Result<&1,&1,U32 & String,List<T.Receipt>>) -> IO(Unit):
  match result:
    case Done{receipts}: IO.write(receipts_json(receipts))
    case Fail{error}:
      (code, detail) = error
      IO.die(Unit, code, detail)

def policy_json(+db: String) -> String:
  "{\"database\":" ++ J.string_literal(db)
  ++ ",\"classes\":[\"scratch\",\"build-output\",\"checkout\",\"shared-immutable\",\"git-object\",\"log-evidence\"]"
  ++ ",\"roots\":\"session-workspace\""
  ++ ",\"preserved\":[\"checkout\",\"shared-immutable\",\"git-object\",\"log-evidence\"]"
  ++ ",\"ageRule\":false}"

def run_policy(+db: String) -> IO(Unit):
  IO.write(policy_json(db))

def run_preview_command(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,List<RootPreview>> <- run_preview(db, session)
    answer : Unit <- preview_result(result)
    IO.pure(Unit, answer)

def run_apply_command(+db: String, +session: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,List<T.Receipt>> <- run_apply(db, session)
    answer : Unit <- apply_result(result)
    IO.pure(Unit, answer)
