# Parses the host evidence records used by the storage policy.
#
# StorageHost returns text so the C half constructs no Bend values. This
# module owns the record shapes and the presence rules. A host failure becomes
# Unreadable or Unknown, and the policy preserves the candidate.

import Base
import ./types.bend as T
import ../host/storage.bend as H
import ../git/text.bend as Tx

type Observation is Data:
  Missing{path: String}
  Found{path: String, kind: String, device: String, inode: String, bytes: Nat}
  Unreadable{path: String, detail: String}

type Child is Data:
  Child{kind: String, name: String}

type Scan is Data:
  Scan{ok: Bool, items: List<&2,Child>}

type RemoveResult is Data:
  RemoveRemoved{bytes: Nat}
  RemoveAbsent{}
  RemoveChanged{}
  RemoveRefused{detail: String}

def u32_or(value: Maybe<&2, U32>, +fallback: U32) -> U32:
  match value:
    case None{}: fallback
    case Some{found}: found

def parse_u32(+text: String) -> U32:
  u32_or(U32.read(text), 0)

def nat_or(value: Maybe<&2, Nat>, +fallback: Nat) -> Nat:
  match value:
    case None{}: fallback
    case Some{found}: found

def parse_nat(+text: String) -> Nat:
  nat_or(Nat.read(text), 0n)

def fail_detail(error: U32 & String) -> String:
  (code, detail) = error
  U32.show(code) ++ ": " ++ detail

def observation_fields(+path: String, fields: List<String>) -> Observation:
  match fields:
    case +kind <> device <> inode <> bytes <> rest:
      +size = parse_nat(bytes)
      Bool.pick(Observation, String.eq(kind, "missing"), Missing{path}, Found{path, kind, device, inode, size})
    case other: Unreadable{path, "host observation record"}

def observation_of(+path: String, +raw: String) -> Observation:
  observation_fields(path, Tx.split_tabs(raw))

def observation_result(+path: String, result: Result<&1,&1,U32 & String,String>) -> Observation:
  match result:
    case Fail{error}: Unreadable{path, fail_detail(error)}
    case Done{value}: observation_of(path, value)

def observe(+path: String) -> IO(Observation):
  do IO<Observation>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.observe(path)
    IO.pure(Observation, observation_result(path, result))

def observation_identity(+o: Observation) -> String:
  match o:
    case Missing{path}: "missing:0:0"
    case Found{path, kind, device, inode, bytes}: kind ++ ":" ++ device ++ ":" ++ inode
    case Unreadable{path, detail}: "unreadable"

def observation_bytes(+o: Observation) -> Nat:
  match o:
    case Missing{path}: 0n
    case Found{path, kind, device, inode, bytes}: bytes
    case Unreadable{path, detail}: 0n

def observation_is_found(+o: Observation) -> Bool:
  match o:
    case Found{path, kind, device, inode, bytes}: True{}
    case Missing{path}: False{}
    case Unreadable{path, detail}: False{}

def measure_fields(fields: List<String>) -> Maybe<Nat>:
  match fields:
    case bytes <> nodes <> other <> Nil{}: Some{parse_nat(bytes)}
    case other: None{}

def measure_result(result: Result<&1,&1,U32 & String,String>) -> Maybe<Nat>:
  match result:
    case Fail{error}: None{}
    case Done{value}: measure_fields(Tx.split_tabs(value))

# Recursive bytes for a directory, or the file size. A measurement failure is
# unknown; the caller does not preview that candidate.
def measure(+path: String) -> IO(Maybe<Nat>):
  do IO<Maybe<Nat>>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.measure(path)
    IO.pure(Maybe<Nat>, measure_result(result))

def child_fields(fields: List<String>) -> Child:
  match fields:
    case kind <> name <> Nil{}: Child{kind, name}
    case other: Child{"other", ""}

def child_name(child: Child) -> String:
  match child:
    case Child{kind, name}: name

def child_of(record: String) -> Child:
  child_fields(Tx.split_tabs(record))

def children_walk(records: List<String>, acc: List<&2,Child>, ok: Bool) -> Scan:
  match records:
    case Nil{}: Scan{ok, List.reverse(&2, Child, acc)}
    case Con{head, tail}:
      +child = child_of(head)
      +next_ok = Bool.and(ok, Bool.not(String.is_empty(child_name(child))))
      children_walk(tail, Con{child, acc}, next_ok)

def children_done(empty: Bool, +value: String) -> Scan:
  match empty:
    case True{}: Scan{True{}, Nil{}}
    case False{}: children_walk(Tx.split_nul(value), Nil{}, True{})

def children_result(result: Result<&1,&1,U32 & String,String>) -> Scan:
  match result:
    case Fail{error}: Scan{False{}, Nil{}}
    case Done{+value}: children_done(String.is_empty(value), value)

def children(path: String) -> IO(Scan):
  do IO<Scan>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.entries(path)
    IO.pure(Scan, children_result(result))

def presence_result(result: Result<&1,&1,U32 & String,String>) -> T.Presence:
  match result:
    case Fail{error}: T.Unknown{}
    case Done{+value}:
      Bool.pick(T.Presence, String.eq(value, "absent"), T.Absent{},
        Bool.pick(T.Presence, String.starts_with(value, "present:"), T.Present{String.drop(value, 8n)},
          Bool.pick(T.Presence, String.starts_with(value, "unknown:"), T.Unknown{}, T.Unknown{})))

def process_presence(+path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.process_refs(path)
    IO.pure(T.Presence, presence_result(result))

def runtime_presence(+path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.runtime_refs(path)
    IO.pure(T.Presence, presence_result(result))

def first_of(values: List<String>) -> String:
  match values:
    case Nil{}: ""
    case Con{head, tail}: head

def detail_text(values: List<String>) -> String:
  Tx.join("\t", values)

def remove_kind(+kind: String, rest: List<String>) -> RemoveResult:
  match kind:
    case "removed": RemoveRemoved{parse_nat(first_of(rest))}
    case "already-absent": RemoveAbsent{}
    case "changed": RemoveChanged{}
    case "refused": RemoveRefused{detail_text(rest)}
    case other: RemoveRefused{"unknown removal answer"}

def remove_fields(fields: List<String>) -> RemoveResult:
  match fields:
    case +kind <> rest: remove_kind(kind, rest)
    case other: RemoveRefused{"empty removal answer"}

def remove_result(+raw: String) -> RemoveResult:
  remove_fields(Tx.split_tabs(raw))

def removal_result(result: Result<&1,&1,U32 & String,String>) -> RemoveResult:
  match result:
    case Fail{error}: RemoveRefused{fail_detail(error)}
    case Done{value}: remove_result(value)

def remove(+path: String, +identity: String, +root: String, +root_identity: String) -> IO(RemoveResult):
  do IO<RemoveResult>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.remove(path, identity, root, root_identity)
    IO.pure(RemoveResult, removal_result(result))

# Cooperative root lease API. Baton-owned writers hold a shared lease on
# `.baton-writer-lease` for the duration of a write; cleanup holds an exclusive
# lease before removal. The host answers `none` for contention and every error,
# so the caller treats a missing handle as a refusal.
def lease_handle(+text: String) -> Maybe<U32>:
  +prefix : String = "handle:"
  Bool.pick(Maybe<U32>, String.starts_with(text, prefix),
    Some{parse_u32(String.drop(text, 7n))}, None{})

def lease_maybe(result: Result<&1,&1,U32 & String,String>) -> Maybe<U32>:
  match result:
    case Fail{error}: None{}
    case Done{value}: lease_handle(value)

def acquire_writer_lease(+root: String) -> IO(Maybe<U32>):
  do IO<Maybe<U32>>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.writer_try_acquire(root)
    IO.pure(Maybe<U32>, lease_maybe(result))

def acquire_cleanup_lease(+root: String) -> IO(Maybe<U32>):
  do IO<Maybe<U32>>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.cleanup_try_acquire(root)
    IO.pure(Maybe<U32>, lease_maybe(result))

def release_lease(handle: U32) -> IO(Unit):
  do IO<Unit>:
    released : Unit <- IO.try(Unit, H.StorageHost.lease_release(handle))
    IO.pure(Unit, released)
