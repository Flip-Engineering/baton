# Safe cleanup apply for a storage preview.
#
# The caller supplies a refresh function that reads current durable evidence
# for one entry. Apply derives the preservation decision again, then revalidates
# the host identity before unlinking. A path that changed, a decision that now
# preserves the path, and an unreadable path are receipt rows; they are never
# removed. Running the same plan again reports already-absent rows and succeeds.

import Base
import ./types.bend as T
import ./policy.bend as P
import ./observe.bend as O
import ./state.bend as S

type Progress is Type:
  Progress{rows: List<T.Removal>, reclaimed: Nat, complete: Bool}

type Refresh is Data:
  Refresh{db: String, source: String, root: String, root_identity: String}

def outcome_keeps_complete(+o: T.Outcome) -> Bool:
  match o:
    case T.Removed{bytes}: True{}
    case T.AlreadyAbsent{}: True{}
    case T.Kept{}: True{}
    case T.Changed{detail}: False{}
    case T.Refused{detail}: False{}

def reclaimed_of(+o: T.Outcome) -> Nat:
  match o:
    case T.Removed{bytes}: bytes
    case T.AlreadyAbsent{}: 0n
    case T.Kept{}: 0n
    case T.Changed{detail}: 0n
    case T.Refused{detail}: 0n

def removal_outcome(+result: O.RemoveResult) -> T.Outcome:
  match result:
    case O.RemoveRemoved{bytes}: T.Removed{bytes}
    case O.RemoveAbsent{}: T.AlreadyAbsent{}
    case O.RemoveChanged{}: T.Changed{"host identity changed"}
    case O.RemoveRefused{detail}: T.Refused{detail}

def removal(+entry: T.Entry, +outcome: T.Outcome) -> T.Removal:
  match entry:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}:
      +reason = P.decision_reason(decision)
      T.Removal{path, cls, owner_proof, reason, bytes, outcome}

def removal_outcome_of(+row: T.Removal) -> T.Outcome:
  match row:
    case T.Removal{path, cls, owner_proof, reason, bytes, outcome}: outcome

def fresh_entry(+entry: T.Entry, +facts: T.Facts) -> T.Entry:
  match entry:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}:
      +next = P.decide(cls, owner, facts)
      T.Entry{path, cls, owner, owner_proof, bytes, identity, next}

def refresh_root(+refresh: Refresh) -> String:
  match refresh:
    case Refresh{db, source, root, root_identity}: root

def refresh_identity(+refresh: Refresh) -> String:
  match refresh:
    case Refresh{db, source, root, root_identity}: root_identity

def observed_found(+entry: T.Entry, +observed: O.Observation, +refresh: Refresh) -> IO(T.Removal):
  match entry:
    case T.Entry{e_path, e_cls, e_owner, e_owner_proof, e_bytes, e_identity, e_decision}:
      Bool.pick(IO(T.Removal), String.eq(O.observation_identity(observed), e_identity),
        do IO<T.Removal>:
          removed : O.RemoveResult <- O.remove(e_path, e_identity, refresh_root(refresh), refresh_identity(refresh))
          IO.pure(T.Removal, removal(entry, removal_outcome(removed))),
        IO.pure(T.Removal, removal(entry, T.Changed{"host identity changed"})))

def observed_apply(+entry: T.Entry, +observed: O.Observation, +refresh: Refresh) -> IO(T.Removal):
  match observed:
    case O.Missing{path}:
      IO.pure(T.Removal, removal(entry, T.AlreadyAbsent{}))
    case O.Unreadable{path, detail}:
      IO.pure(T.Removal, removal(entry, T.Refused{detail}))
    case O.Found{path, kind, device, inode, size}:
      observed_found(entry, observed, refresh)

def apply_remove(+entry: T.Entry, +refresh: Refresh) -> IO(T.Removal):
  match entry:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}:
      do IO<T.Removal>:
        observed : O.Observation <- O.observe(path)
        answer : T.Removal <- observed_apply(entry, observed, refresh)
        IO.pure(T.Removal, answer)

def fresh_decision(+entry: T.Entry, +decision: T.Decision, +refresh: Refresh) -> IO(T.Removal):
  match decision:
    case T.Keep{reason}:
      IO.pure(T.Removal, removal(entry, T.Changed{"fresh evidence preserves: " ++ reason}))
    case T.Remove{reason}:
      apply_remove(entry, refresh)

def fresh_apply(+entry: T.Entry, +facts: T.Facts, +refresh: Refresh) -> IO(T.Removal):
  +rechecked = fresh_entry(entry, facts)
  fresh_decision(entry, P.entry_decision(rechecked), refresh)

def entry_class(+entry: T.Entry) -> T.StorageClass:
  match entry:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}: cls

def entry_path(+entry: T.Entry) -> String:
  match entry:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}: path

def refresh_facts(refresh: Refresh, +entry: T.Entry) -> IO(T.Facts):
  match refresh:
    case Refresh{db, source, root, root_identity}:
      do IO<T.Facts>:
        state : S.State <- S.load(db)
        facts : T.Facts <- S.facts_for(entry_class(entry), source, entry_path(entry), state)
        IO.pure(T.Facts, facts)

def apply_observed_admitted(+entry: T.Entry, +refresh: Refresh, +observed: O.Observation) -> IO(T.Removal):
  match observed:
    case O.Missing{path}: IO.pure(T.Removal, removal(entry, T.AlreadyAbsent{}))
    case O.Unreadable{path, detail}: IO.pure(T.Removal, removal(entry, T.Refused{detail}))
    case O.Found{path, kind, device, inode, bytes}:
      do IO<T.Removal>:
        facts : T.Facts <- refresh_facts(refresh, entry)
        answer : T.Removal <- fresh_apply(entry, facts, refresh)
        IO.pure(T.Removal, answer)

def apply_admitted(+entry: T.Entry, +refresh: Refresh) -> IO(T.Removal):
  do IO<T.Removal>:
    observed : O.Observation <- O.observe(entry_path(entry))
    apply_observed_admitted(entry, refresh, observed)

def path_under(+path: String, +parent: String) -> Bool:
  Bool.pick(Bool, String.is_empty(parent), False{}, Bool.or(String.eq(path, parent), String.starts_with(path, parent ++ "/")))

def apply_with_decision(+entry: T.Entry, +decision: T.Decision, +refresh: Refresh, +root: String) -> IO(T.Removal):
  match decision:
    case T.Keep{reason}:
      IO.pure(T.Removal, removal(entry, T.Kept{}))
    case T.Remove{reason}:
      Bool.pick(IO(T.Removal), path_under(entry_path(entry), root),
        apply_admitted(entry, refresh),
        IO.pure(T.Removal, removal(entry, T.Refused{"outside approved root"})))

def apply_entry(+entry: T.Entry, +refresh: Refresh, +root: String) -> IO(T.Removal):
  match entry:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}:
      apply_with_decision(entry, decision, refresh, root)

def apply_walk(entries: List<T.Entry>, +refresh: Refresh, acc: List<T.Removal>, reclaimed: Nat, complete: Bool, +root: String) -> IO(Progress):
  match entries:
    case Nil{}:
      IO.pure(Progress, Progress{List.reverse(&1, T.Removal, acc), reclaimed, complete})
    case Con{head, tail}:
      do IO<Progress>:
        +row : T.Removal <- apply_entry(head, refresh, root)
        +outcome : T.Outcome = removal_outcome_of(row)
        deeper : Progress <- apply_walk(tail, refresh, Con{row, acc}, Nat.add(reclaimed, reclaimed_of(outcome)), Bool.and(complete, outcome_keeps_complete(outcome)), root)
        IO.pure(Progress, deeper)

def receipt_of(+root: String, +mount: String, +plan: String, progress: Progress) -> IO(T.Receipt):
  match progress:
    case Progress{rows, reclaimed, complete}:
      IO.pure(T.Receipt, T.Receipt{plan, root, mount, rows, reclaimed, complete})

# The product apply API. REFRESH runs for every candidate that the preview
# admitted, immediately before the host identity check and unlink. The caller
# holds its cleanup lock across the call.
def refused_receipt(+root: String, +mount: String, +plan: String) -> T.Receipt:
  T.Receipt{plan, root, mount, Con{T.Removal{root, T.Unclassified{}, "", "preview-invalid-or-root-changed", 0n, T.Refused{"preview invalid or approved root changed"}}, Nil{}}, 0n, False{}}

def apply(preview: T.Preview, +refresh: Refresh) -> IO(T.Receipt):
  match preview:
    case T.Preview{+root, +mount, +root_identity, +valid, +plan, entries}:
      do IO<T.Receipt>:
        observed : O.Observation <- O.observe(root)
        ready : Bool = Bool.and(valid, String.eq(O.observation_identity(observed), root_identity))
        answer : T.Receipt <- Bool.pick(IO(T.Receipt), ready,
          do IO<T.Receipt>:
            progress : Progress <- apply_walk(entries, refresh, Nil{}, 0n, True{}, root)
            receipt : T.Receipt <- receipt_of(root, mount, plan, progress)
            IO.pure(T.Receipt, receipt),
          IO.pure(T.Receipt, refused_receipt(root, mount, plan)))
        IO.pure(T.Receipt, answer)
