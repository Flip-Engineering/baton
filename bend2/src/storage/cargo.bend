# Cargo output release for #1049. Service owners supply current consumer and
# deployment/rollback evidence from their existing authorities. Unknown
# evidence preserves the output. Native Cargo locks exclude active writers.
# Current operations and runtime/rollback selections establish continued use.
# A cwd-only process leaves Cargo release eligibility unchanged. Source dirt,
# publication and missing historical owners add no Cargo eligibility condition.

import Base
import ./types.bend as T
import ./observe.bend as O
import ./policy.bend as P
import ./apply.bend as A
import ../host/storage.bend as H
import ../host/files.bend as F
import ../host/sqlite.bend as DB
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
      +active : String = presence_reason(consumer, "cargo-consumer-present", "cargo-consumer-unknown")
      +selected : String = presence_reason(selection, "cargo-runtime-selected", "cargo-selection-unknown")
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

# Both evidence readers run after classification and before the native lock
# acquisition. The apply pipeline holds the storage-cleanup session lock and
# the exclusive per-root cleanup lease across this operation.
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

def preview_entry(+path: String, owner: String, output: Output,
                  bytes: Nat, decided: T.Decision) -> T.Preview:
  +identity : String = output_identity(output)
  +entry : T.Entry = T.Entry{path, T.BuildOutput{}, owner, "cargo-output", bytes, identity, decided}
  T.Preview{path, "", identity, True{}, P.entry_plan_line(entry), Con{entry, Nil{}}}

def preview_measured(measured: Maybe<Nat>, +path: String, +owner: String, +output: Output,
                     active: T.Presence, selected: T.Presence) -> T.Preview:
  match measured:
    case None{}: preview_entry(path, owner, output, 0n, T.Keep{"cargo-measurement-unreadable"})
    case Some{bytes}: preview_entry(path, owner, output, bytes, decision(output, active, selected))

def preview(+path: String, +owner: String,
            consumer: @+candidate: String -> IO(T.Presence),
            selection: @+candidate: String -> IO(T.Presence)) -> IO(T.Preview):
  do IO<T.Preview>:
    +output : Output <- observe(path)
    measured : Maybe<Nat> <- O.measure(path)
    active : T.Presence <- consumer(path)
    selected : T.Presence <- selection(path)
    IO.pure(T.Preview, preview_measured(measured, path, owner, output, active, selected))

def receipt_decided(+path: String, associated: String, owner: String, +output: Output,
                    bytes: Nat, +plan_decision: T.Decision) -> IO(T.Receipt):
  do IO<T.Receipt>:
    identity : String = output_identity(output)
    +entry : T.Entry = T.Entry{path, T.BuildOutput{}, owner, "cargo-output", bytes, identity, plan_decision}
    collection : Collection <- collect_decided(plan_decision, output, path, associated)
    +outcome : T.Outcome = collection_outcome(collection)
    row : T.Removal = A.removal(entry, outcome)
    IO.pure(T.Receipt, T.Receipt{P.entry_plan_line(entry), path, "", Con{row, Nil{}}, A.reclaimed_of(outcome), A.outcome_keeps_complete(outcome)})

def receipt_measured(measured: Maybe<Nat>, +path: String, +associated: String, +owner: String,
                     +output: Output, active: T.Presence, selected: T.Presence) -> IO(T.Receipt):
  match measured:
    case None{}: receipt_decided(path, associated, owner, output, 0n, T.Keep{"cargo-measurement-unreadable"})
    case Some{bytes}: receipt_decided(path, associated, owner, output, bytes, decision(output, active, selected))

def receipt(+path: String, +associated: String, +owner: String,
            consumer: @+candidate: String -> IO(T.Presence),
            selection: @+candidate: String -> IO(T.Presence)) -> IO(T.Receipt):
  do IO<T.Receipt>:
    +output : Output <- observe(path)
    measured : Maybe<Nat> <- O.measure(path)
    active : T.Presence <- consumer(path)
    selected : T.Presence <- selection(path)
    receipt_measured(measured, path, associated, owner, output, active, selected)

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

def baton_link_kind(directory: String, name: String, path: String,
                    unknown: Bool, symlink: Bool, next: Bool -> IO(T.Presence)) -> IO(T.Presence):
  match symlink:
    case False{}: next(True{})
    case True{}: do IO<T.Presence>:
      +link : String = directory ++ "/" ++ name
      target : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(link)
      selection_resolved(target, path, link, next, unknown)

def baton_link_named(directory: String, kind: String, name: String,
                     path: String, unknown: Bool, named: Bool, next: Bool -> IO(T.Presence)) -> IO(T.Presence):
  match named:
    case False{}: next(unknown)
    case True{}: baton_link_kind(directory, name, path, unknown, String.eq(kind, "symlink"), next)

def baton_links(+directory: String, entries: List<&2,O.Child>, +path: String, unknown: Bool) -> IO(T.Presence):
  match entries:
    case Nil{}: IO.pure(T.Presence, Bool.pick(T.Presence, unknown, T.Unknown{}, T.Absent{}))
    case O.Child{kind, +name} <> rest:
      baton_link_named(directory, kind, name, path, unknown, baton_command(name),
        next_unknown => baton_links(directory, rest, path, next_unknown))

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

# The ACP FFrames artifact service registers the current deployment in a
# selection record (schema acp.fframes-service-selection/v1): a JSON object
# whose runtime, config and manifest text fields name the retained paths.
# The running service's own process evidence holds active producer custody;
# this reader answers only whether the record retains the candidate. Any
# invalid, truncated, unreadable or unresolvable evidence is unknown, which
# preserves the allocation.
def sql_quote(+text: String) -> String:
  "'" ++ String.join(String.split(text, Char.from_u32(39)), "''") ++ "'"

# One chunk read answers whether more text follows, the accumulated text so
# far, and the next position. The recursion stays inside record_read so no
# forward definition is needed.
type RecordStep is Data:
  RsMore{next: String, acc: String}
  RsDone{acc: String}
  RsFailed{}

def record_pair_step(+acc: String, pair: String & String) -> RecordStep:
  match pair:
    case (text, next):
      Bool.pick(RecordStep, String.is_empty(text), RsDone{acc}, RsMore{next, acc ++ text})

def record_step(+acc: String, chunk: Result<&1,&1,U32 & String,String & String>) -> RecordStep:
  match chunk:
    case Fail{error}: RsFailed{}
    case Done{+pair}: record_pair_step(acc, pair)

def record_advance(step: RecordStep) -> Bool:
  match step:
    case RsMore{next, acc}: True{}
    case other: False{}

def record_position(step: RecordStep) -> String:
  match step:
    case RsMore{next, acc}: next
    case other: ""

def record_gathered(step: RecordStep) -> String:
  match step:
    case RsMore{next, acc}: acc
    case RsDone{acc}: acc
    case RsFailed{}: ""

def record_value(step: RecordStep) -> Maybe<String>:
  match step:
    case RsDone{acc}: Some{acc}
    case other: None{}

def record_read(+record: String, +position: String, +acc: String) -> IO(Maybe<String>):
  do IO<Maybe<String>>:
    chunk : Result<&1,&1,U32 & String,String & String> <- F.Files.text_chunk(record, position)
    +step : RecordStep = record_step(acc, chunk)
    Bool.pick(IO<Maybe<String>>, record_advance(step),
      record_read(record, record_position(step), record_gathered(step)),
      IO.pure(Maybe<String>, record_value(step)))

def record_text(+record: String) -> IO(Maybe<String>):
  record_read(record, "0", "")

# The maintained JSON reader is SQLite's json functions over the record text,
# the same pattern the coordinator uses for stored JSON. The record must be a
# valid object of schema acp.fframes-service-selection/v1 with text runtime,
# config and manifest fields.
def selection_sql(+text: String) -> String:
  "WITH record(value) AS (VALUES(" ++ sql_quote(text) ++ ")) SELECT json_valid(value),"
  ++ " CASE WHEN json_valid(value) THEN coalesce(json_type(value),'') ELSE '' END,"
  ++ " CASE WHEN json_valid(value) THEN coalesce(json_type(value,'$.schema'),'') ELSE '' END,"
  ++ " CASE WHEN json_valid(value) THEN coalesce(hex(json_extract(value,'$.schema')),'') ELSE '' END,"
  ++ " CASE WHEN json_valid(value) THEN coalesce(json_type(value,'$.runtime'),'') ELSE '' END,"
  ++ " CASE WHEN json_valid(value) THEN coalesce(hex(json_extract(value,'$.runtime')),'') ELSE '' END,"
  ++ " CASE WHEN json_valid(value) THEN coalesce(json_type(value,'$.config'),'') ELSE '' END,"
  ++ " CASE WHEN json_valid(value) THEN coalesce(hex(json_extract(value,'$.config')),'') ELSE '' END,"
  ++ " CASE WHEN json_valid(value) THEN coalesce(json_type(value,'$.manifest'),'') ELSE '' END,"
  ++ " CASE WHEN json_valid(value) THEN coalesce(hex(json_extract(value,'$.manifest')),'') ELSE '' END;"

def selection_field_text(+kind: String, +hex: String) -> Bool:
  Bool.and(String.eq(kind, "text"), Bool.not(String.is_empty(hex)))

def selection_valid(valid: String, root_kind: String, schema_kind: String, schema_hex: String,
                    runtime_kind: String, runtime_hex: String, config_kind: String, config_hex: String,
                    manifest_kind: String, manifest_hex: String) -> Bool:
  Bool.and(String.eq(valid, "1"),
    Bool.and(String.eq(root_kind, "object"),
      Bool.and(String.eq(schema_kind, "text"),
        Bool.and(String.eq(Tx.hex_decode(schema_hex), "acp.fframes-service-selection/v1"),
          Bool.and(selection_field_text(runtime_kind, runtime_hex),
            Bool.and(selection_field_text(config_kind, config_hex),
              selection_field_text(manifest_kind, manifest_hex)))))))

def canonical_overlap_pair(left: Result<&1,&1,U32 & String,String>, right: Result<&1,&1,U32 & String,String>) -> Maybe<Bool>:
  match left:
    case Fail{error}: None{}
    case Done{+a}:
      match right:
        case Fail{error}: None{}
        case Done{+b}: Some{Bool.or(path_contains(a, b), path_contains(b, a))}

def canonical_overlap(+path: String, +named: String) -> IO(Maybe<Bool>):
  do IO<Maybe<Bool>>:
    left : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(path)
    right : Result<&1,&1,U32 & String,String> <- Lock.SessionLock.canonical(named)
    IO.pure(Maybe<Bool>, canonical_overlap_pair(left, right))

type SelectionVerdict is Data:
  SvSelected{}
  SvReleased{}
  SvUnknown{}

def verdict_unknown(acc: SelectionVerdict) -> SelectionVerdict:
  match acc:
    case SvSelected{}: SvSelected{}
    case other: SvUnknown{}

def merge_verdict(acc: SelectionVerdict, next: Maybe<Bool>) -> SelectionVerdict:
  match next:
    case Some{hit}: Bool.pick(SelectionVerdict, hit, SvSelected{}, acc)
    case None{}: verdict_unknown(acc)

def selection_presence(+path: String, verdict: SelectionVerdict) -> IO(T.Presence):
  match verdict:
    case SvSelected{}: IO.pure(T.Presence, T.Present{"acp-selection"})
    case SvReleased{}: IO.pure(T.Presence, T.Absent{})
    case SvUnknown{}: unknown_selection(path)

def acp_selection_compare(+path: String, runtime_hex: String, config_hex: String, manifest_hex: String) -> IO(T.Presence):
  do IO<T.Presence>:
    runtime : Maybe<Bool> <- canonical_overlap(path, Tx.hex_decode(runtime_hex))
    config : Maybe<Bool> <- canonical_overlap(path, Tx.hex_decode(config_hex))
    manifest : Maybe<Bool> <- canonical_overlap(path, Tx.hex_decode(manifest_hex))
    +verdict : SelectionVerdict = merge_verdict(merge_verdict(merge_verdict(SvReleased{}, runtime), config), manifest)
    selection_presence(path, verdict)

def acp_selection_fields(+db: String, +path: String, fields: List<String>) -> IO(T.Presence):
  match fields:
    case valid <> root_kind <> schema_kind <> schema_hex <> runtime_kind <> runtime_hex <> config_kind <> config_hex <> manifest_kind <> manifest_hex <> Nil{}:
      Bool.pick(IO<T.Presence>, selection_valid(valid, root_kind, schema_kind, schema_hex,
        runtime_kind, runtime_hex, config_kind, config_hex, manifest_kind, manifest_hex),
        acp_selection_compare(path, runtime_hex, config_hex, manifest_hex),
        unknown_selection(path))
    case other: unknown_selection(path)

def acp_selection_row(+db: String, +path: String, row_result: Result<&1,&1,U32 & String,String>) -> IO(T.Presence):
  match row_result:
    case Fail{error}: unknown_selection(path)
    case Done{row}: acp_selection_fields(db, path, Tx.split_tabs(Tx.trim_nl(row)))

def acp_selection_text(+db: String, +path: String, text: Maybe<String>) -> IO(T.Presence):
  match text:
    case None{}: unknown_selection(path)
    case Some{value}: do IO<T.Presence>:
      row_result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db, selection_sql(value))
      acp_selection_row(db, path, row_result)

def acp_selection(+db: String, +record: String, +path: String) -> IO(T.Presence):
  do IO<T.Presence>:
    text : Maybe<String> <- record_text(record)
    acp_selection_text(db, path, text)
