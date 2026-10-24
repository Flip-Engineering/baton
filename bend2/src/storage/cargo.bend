# Cargo output release for #1049. Service owners supply current consumer and
# deployment/rollback evidence from their existing authorities. Unknown
# evidence preserves the output. Native Cargo locks exclude active writers.

import Base
import ./types.bend as T
import ./observe.bend as O
import ./policy.bend as P
import ./apply.bend as A
import ../host/storage.bend as H
import ../host/session-lock.bend as Lock
import ../git/text.bend as Tx

type Output is Data:
  Cargo{identity: String, origin: String}
  Unclassified{}
  Unreadable{detail: String}

type Collection is Data:
  Kept{reason: String}
  Applied{result: O.RemoveResult}

def output_fields(fields: List<String>) -> Output:
  match fields:
    case "cargo" <> identity <> origin <> Nil{}: Cargo{identity, origin}
    case "unclassified" <> Nil{}: Unclassified{}
    case other: Unreadable{"invalid Cargo output observation"}

def output_result(result: Result<&1,&1,U32 & String,String>) -> Output:
  match result:
    case Fail{error}: Unreadable{O.fail_detail(error)}
    case Done{text}: output_fields(Tx.split_tabs(text))

def observe(+path: String) -> IO(Output):
  do IO<Output>:
    result : Result<&1,&1,U32 & String,String> <- H.StorageHost.cargo_probe(path)
    IO.pure(Output, output_result(result))

def presence_reason(presence: T.Presence, present: String, unknown: String) -> String:
  match presence:
    case T.Present{detail}: present ++ ": " ++ detail
    case T.Unknown{}: unknown
    case T.Absent{}: ""

def decision(output: Output, consumer: T.Presence, selection: T.Presence) -> T.Decision:
  match output:
    case Unclassified{}: T.Keep{"unclassified-cargo-output"}
    case Unreadable{detail}: T.Keep{"cargo-output-unreadable: " ++ detail}
    case Cargo{identity, origin}:
      +active = presence_reason(consumer, "cargo-consumer-present", "cargo-consumer-unknown")
      +selected = presence_reason(selection, "cargo-runtime-selected", "cargo-selection-unknown")
      Bool.pick(T.Decision, Bool.not(String.is_empty(active)), T.Keep{active},
        Bool.pick(T.Decision, Bool.not(String.is_empty(selected)), T.Keep{selected}, T.Remove{"cargo-output-released"}))

def collect_output(output: Output, path: String, associated: String) -> IO(Collection):
  match output:
    case Cargo{identity, origin}: do IO<Collection>:
      result : Result<&1,&1,U32 & String,String> <- H.StorageHost.cargo_remove(path, identity, associated)
      IO.pure(Collection, Applied{O.removal_result(result)})
    case other: IO.pure(Collection, Kept{"cargo-output-unresolved"})

def collect_decided(decision: T.Decision, output: Output, path: String, associated: String) -> IO(Collection):
  match decision:
    case T.Keep{reason}: IO.pure(Collection, Kept{reason})
    case T.Remove{reason}: collect_output(output, path, associated)

# The caller retains its existing producer ownership boundary through this
# operation. Both readers run after classification and before native locking.
def collect(+path: String, +associated: String,
            consumer: @+candidate: String -> IO(T.Presence),
            selection: @+candidate: String -> IO(T.Presence)) -> IO(Collection):
  do IO<Collection>:
    +output : Output <- observe(path)
    active : T.Presence <- consumer(path)
    selected : T.Presence <- selection(path)
    collect_decided(decision(output, active, selected), output, path, associated)

def unknown_selection(path: String) -> IO(T.Presence):
  IO.pure(T.Presence, T.Unknown{})

def collection_outcome(collection: Collection) -> T.Outcome:
  match collection:
    case Kept{reason}: T.Kept{}
    case Applied{result}: A.removal_outcome(result)

def output_identity(output: Output) -> String:
  match output:
    case Cargo{identity, origin}: identity
    case other: "unresolved"

def measured_decision(measured: Maybe<Nat>, decided: T.Decision) -> T.Decision:
  match measured:
    case None{}: T.Keep{"cargo-measurement-unreadable"}
    case Some{bytes}: decided

def preview(+path: String, +owner: String,
            consumer: @+candidate: String -> IO(T.Presence),
            selection: @+candidate: String -> IO(T.Presence)) -> IO(T.Preview):
  do IO<T.Preview>:
    +output : Output <- observe(path)
    +measured : Maybe<Nat> <- O.measure(path)
    active : T.Presence <- consumer(path)
    selected : T.Presence <- selection(path)
    decided : T.Decision = measured_decision(measured, decision(output, active, selected))
    +entry : T.Entry = T.Entry{path, T.BuildOutput{}, owner, "cargo-output", O.nat_or(measured, 0n), output_identity(output), decided}
    IO.pure(T.Preview, T.Preview{path, "", output_identity(output), True{}, P.entry_plan_line(entry), Con{entry, Nil{}}})

def receipt(+path: String, +associated: String, +owner: String,
            consumer: @+candidate: String -> IO(T.Presence),
            selection: @+candidate: String -> IO(T.Presence)) -> IO(T.Receipt):
  do IO<T.Receipt>:
    +output : Output <- observe(path)
    +measured : Maybe<Nat> <- O.measure(path)
    active : T.Presence <- consumer(path)
    selected : T.Presence <- selection(path)
    +decided : T.Decision = decision(output, active, selected)
    +plan_decision : T.Decision = measured_decision(measured, decided)
    bytes : Nat = O.nat_or(measured, 0n)
    +entry : T.Entry = T.Entry{path, T.BuildOutput{}, owner, "cargo-output", bytes, output_identity(output), plan_decision}
    collection : Collection <- collect_decided(plan_decision, output, path, associated)
    +outcome : T.Outcome = collection_outcome(collection)
    row : T.Removal = A.removal(entry, outcome)
    IO.pure(T.Receipt, T.Receipt{P.entry_plan_line(entry), path, "", Con{row, Nil{}}, A.reclaimed_of(outcome), A.outcome_keeps_complete(outcome)})

def path_contains(+root: String, +path: String) -> Bool:
  Bool.or(String.eq(root, path), String.starts_with(path, root ++ "/"))

def baton_command(+name: String) -> Bool:
  Bool.or(String.eq(name, "baton"), Bool.or(String.eq(name, "baton2"),
    Bool.or(String.starts_with(name, "baton.pre-"), String.starts_with(name, "baton2.pre-"))))

def selection_resolved(result: Result<&1,&1,U32 & String,String>, +path: String,
                       +link: String, next: Bool -> IO(T.Presence), unknown: Bool) -> IO(T.Presence):
  match result:
    case Fail{error}: next(True{})
    case Done{target}:
      Bool.pick(IO(T.Presence), path_contains(path, target), IO.pure(T.Presence, T.Present{link}), next(unknown))

def baton_link_kind(+directory: String, name: String, rest: List<&2,O.Child>, +path: String,
                    unknown: Bool, symlink: Bool) -> IO(T.Presence):
  match symlink:
    case False{}: baton_links(directory, rest, path, True{})
    case True{}: do IO<T.Presence>:
      +link : String = directory ++ "/" ++ name
      target : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(link)
      selection_resolved(target, path, link,
        next_unknown => baton_links(directory, rest, path, next_unknown), unknown)

def baton_link_named(+directory: String, kind: String, name: String, rest: List<&2,O.Child>,
                     +path: String, unknown: Bool, named: Bool) -> IO(T.Presence):
  match named:
    case False{}: baton_links(directory, rest, path, unknown)
    case True{}: baton_link_kind(directory, name, rest, path, unknown, String.eq(kind, "symlink"))

def baton_links(+directory: String, entries: List<&2,O.Child>, +path: String, unknown: Bool) -> IO(T.Presence):
  match entries:
    case Nil{}: IO.pure(T.Presence, Bool.pick(T.Presence, unknown, T.Unknown{}, T.Absent{}))
    case O.Child{kind, +name} <> rest:
      baton_link_named(directory, kind, name, rest, path, unknown, baton_command(name))

def baton_scanned(scan: O.Scan, +directory: String, +path: String) -> IO(T.Presence):
  match scan:
    case O.Scan{False{}, entries}: unknown_selection(path)
    case O.Scan{True{}, Nil{}}: unknown_selection(path)
    case O.Scan{True{}, entries}: baton_links(directory, entries, path, False{})

def baton_selection_result(+directory: String, path: String,
                           canonical: Result<&1,&1,U32 & String,String>) -> IO(T.Presence):
  match canonical:
    case Fail{error}: unknown_selection(path)
    case Done{resolved}: do IO<T.Presence>:
      scan : O.Scan <- O.children(directory)
      baton_scanned(scan, directory, resolved)

# Baton's installed command symlinks select the current and rollback releases.
# The owning service supplies this directory from its recorded installation.
# Other services supply their own reader; an unknown reader keeps the target.
def baton_selection(+directory: String, +path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    canonical : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(path)
    baton_selection_result(directory, path, canonical)
