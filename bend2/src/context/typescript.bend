# CLAIM: the TypeScript semantic provider's native-side composition. This module answers what the
# typescript engine admits, what its projections mean, how its provider process is launched and
# framed, and how its source-bound facts join to the catalog and model providers. It performs no
# provider work: the language service runs in the staged Node adapter, and this module decides
# admission before that process exists and composes its recorded outputs afterward.
#
# Scope boundaries. Common request canonicalization and decoding belong to the codec module;
# common snapshot, ref, engine and sanitized provider-launch composition belong to the context
# core module; the SQLite and PostgreSQL catalog planners belong to the models module. This module
# owns only what is specific to the typescript engine: its selector and option admission, its
# captured-input roles, its provider-local revalidation, its launch-independent provider identity,
# and its joins to the catalog and models providers. The capture, applicability and join shapes
# here are the typescript engine's recorded inputs, not a second canonical representation; core
# composes the canonical snapshot, ref and engine values from them, and this module consumes the
# codec's canonical request text.
#
# Reference: docs/bend2/semantic-context-spec.md; bend 2.0.25.

import Base
import ../json/canonical.bend as J
import ../git/text.bend as Tx

# --- Subjects -------------------------------------------------------------------------------

# Zero-based line and zero-based UTF-16 column, as the request contract states them.
type Subject is Data:
  SPosition{path: String, line: U32, column: U32}
  SSymbol{path: String, name: String, container: String}
  SDiagnostic{path: String, line: U32, column: U32, code: String}

# The empty container string means the request carried no container.
def subject_kind(+s: Subject) -> String:
  match s:
    case SPosition{path, line, column}: "position"
    case SSymbol{path, name, container}: "symbol"
    case SDiagnostic{path, line, column, code}: "diagnostic"

def subject_path(+s: Subject) -> String:
  match s:
    case SPosition{+path, line, column}: path
    case SSymbol{+path, name, container}: path
    case SDiagnostic{+path, line, column, code}: path

# A source selector is closed: the fields it needs are present and nonempty. Numeric fields are
# already validated as U32 tokens by the codec, so only textual emptiness is checked here.
def subject_complete(s: Subject) -> Bool:
  match s:
    case SPosition{path, line, column}: Tx.non_empty(path)
    case SSymbol{path, name, container}:
      Bool.pick(Bool, Tx.non_empty(path), Tx.non_empty(name), False{})
    case SDiagnostic{path, line, column, code}:
      Bool.pick(Bool, Tx.non_empty(path), Tx.non_empty(code), False{})

# --- Projections ----------------------------------------------------------------------------

# One bit per admitted projection. A request names projections as strings, so an unknown name
# has no bit and is refused rather than approximated.
def bit_name_database_accesses() -> String:
  "databaseAccesses"

def bitval_unknown() -> U32:
  0

def bitval_database_accesses(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 512
    case False{}: bitval_unknown()

def bitval_exceptions(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 256
    case False{}: bitval_database_accesses(name, Tx.str_eq(name, bit_name_database_accesses()))

def bitval_flow(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 128
    case False{}: bitval_exceptions(name, Tx.str_eq(name, "exceptions"))

def bitval_diagnostics(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 64
    case False{}: bitval_flow(name, Tx.str_eq(name, "flow"))

def bitval_dependencies(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 32
    case False{}: bitval_diagnostics(name, Tx.str_eq(name, "diagnostics"))

def bitval_callers(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 16
    case False{}: bitval_dependencies(name, Tx.str_eq(name, "dependencies"))

def bitval_calls(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 8
    case False{}: bitval_callers(name, Tx.str_eq(name, "callers"))

def bitval_references(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 4
    case False{}: bitval_calls(name, Tx.str_eq(name, "calls"))

def bitval_type(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 2
    case False{}: bitval_references(name, Tx.str_eq(name, "references"))

def bitval_definition(+name: String, hit: Bool) -> U32:
  match hit:
    case True{}: 1
    case False{}: bitval_type(name, Tx.str_eq(name, "type"))

def projection_bitval(+name: String) -> U32:
  bitval_definition(name, Tx.str_eq(name, "definition"))

def projection_known(name: String) -> Bool:
  U32.is_ne(projection_bitval(name), bitval_unknown())

def projection_name_go9(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "databaseAccesses"
    case False{}: "unknown"

def projection_name_go8(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "exceptions"
    case False{}: projection_name_go9(bit, U32.is_eq(bit, 512))

def projection_name_go7(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "flow"
    case False{}: projection_name_go8(bit, U32.is_eq(bit, 256))

def projection_name_go6(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "diagnostics"
    case False{}: projection_name_go7(bit, U32.is_eq(bit, 128))

def projection_name_go5(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "dependencies"
    case False{}: projection_name_go6(bit, U32.is_eq(bit, 64))

def projection_name_go4(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "callers"
    case False{}: projection_name_go5(bit, U32.is_eq(bit, 32))

def projection_name_go3(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "calls"
    case False{}: projection_name_go4(bit, U32.is_eq(bit, 16))

def projection_name_go2(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "references"
    case False{}: projection_name_go3(bit, U32.is_eq(bit, 8))

def projection_name_go1(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "type"
    case False{}: projection_name_go2(bit, U32.is_eq(bit, 4))

def projection_name_go0(+bit: U32, hit: Bool) -> String:
  match hit:
    case True{}: "definition"
    case False{}: projection_name_go1(bit, U32.is_eq(bit, 2))

def projection_name(+bit: U32) -> String:
  projection_name_go0(bit, U32.is_eq(bit, 1))

# Position and symbol subjects admit every source projection this engine computes.
def source_projection_mask() -> U32:
  1023

# A diagnostic subject admits its own diagnostic family plus the structural projections.
def diagnostic_projection_mask() -> U32:
  449

def subject_projection_mask(s: Subject) -> U32:
  match s:
    case SPosition{path, line, column}: source_projection_mask()
    case SSymbol{path, name, container}: source_projection_mask()
    case SDiagnostic{path, line, column, code}: diagnostic_projection_mask()

# --- Select validation ----------------------------------------------------------------------

# The outcome of checking a requested select set. The set is nonempty, entirely known and
# duplicate-free; a duplicate is a repeated projection, which the mask detects in one walk.
type SelectCheck is Data:
  SelectOk{mask: U32}
  SelectEmpty{}
  SelectUnknown{}
  SelectDuplicate{}

def select_state_unknown() -> U32:
  1

def select_state_duplicate() -> U32:
  2

def select_state_bit(acc: U32, bit: U32) -> U32:
  Bool.pick(U32, U32.is_zero(U32.and(acc, bit)), 0, select_state_duplicate())

def select_state_go(acc: U32, +bit: U32) -> U32:
  Bool.pick(U32, U32.is_zero(bit), select_state_unknown(), select_state_bit(acc, bit))

def select_state(acc: U32, name: String) -> U32:
  select_state_go(acc, projection_bitval(name))

def select_report_unknown(acc: U32) -> SelectCheck:
  SelectUnknown{}

def select_report_duplicate(acc: U32) -> SelectCheck:
  SelectDuplicate{}

def select_report_bad(+acc: U32, unknown: Bool) -> SelectCheck:
  Bool.pick(SelectCheck, unknown, select_report_unknown(acc), select_report_duplicate(acc))

def select_report_state(+acc: U32, +state: U32) -> SelectCheck:
  Bool.pick(SelectCheck,
    U32.is_zero(state),
    SelectOk{acc},
    select_report_bad(acc, U32.is_eq(state, select_state_unknown())))

# One walk accumulates the mask and the first bad state, so the recursion stays single.
def select_go(select: +List<String>, +acc: U32, state: U32) -> SelectCheck:
  match select:
    case Nil{}: select_report_state(acc, state)
    case Con{+name, +rest}:
      select_go(rest, U32.or(acc, projection_bitval(name)), U32.or(state, select_state(acc, name)))

def select_check(select: +List<String>) -> SelectCheck:
  match select:
    case Nil{}: SelectEmpty{}
    case Con{+h, +t}: select_go(Con{h, t}, 0, 0)

def select_check_text(check: SelectCheck) -> String:
  match check:
    case SelectOk{mask}: Tx.str_cat("ok:", U32.show(mask))
    case SelectEmpty{}: "empty"
    case SelectUnknown{}: "unknown"
    case SelectDuplicate{}: "duplicate"

# --- Options --------------------------------------------------------------------------------

# The typescript engine's admitted options. Empty strings mean an omitted option; the codec has
# already refused unknown members, so absence is represented here rather than by a second flag.
type Options is Data:
  Options{project: String, databaseEngine: String, databasePath: String, clientPath: String, clientLine: U32, clientColumn: U32}

def options_engine_ok(+engine: String) -> Bool:
  Bool.pick(Bool, Tx.str_eq(engine, "sqlite-schema"), True{}, Tx.str_eq(engine, "postgres-schema"))

# databaseAccesses needs both a database and the position of the expected client declaration.
def database_options_ok(o: Options) -> Bool:
  match o:
    case Options{project, databaseEngine, databasePath, clientPath, clientLine, clientColumn}:
      Bool.pick(Bool,
        Bool.pick(Bool, options_engine_ok(databaseEngine), Tx.non_empty(databasePath), False{}),
        Tx.non_empty(clientPath),
        False{})

# The refusal condition for an inadmissible request, or the empty string when it is admissible.
# Each condition is fixed text and names the rule that refused.
def database_condition_path(client_ok: Bool) -> String:
  Bool.pick(String, client_ok, "", "context-typescript-client-missing")

def database_condition_client(path_ok: Bool, client_ok: Bool) -> String:
  Bool.pick(String, path_ok, database_condition_path(client_ok), "context-database-path-missing")

def database_condition_engine(engine: String, path_ok: Bool, client_ok: Bool) -> String:
  Bool.pick(String, options_engine_ok(engine), database_condition_client(path_ok, client_ok), "context-database-engine-unsupported")

def database_condition(o: Options) -> String:
  match o:
    case Options{project, databaseEngine, databasePath, clientPath, clientLine, clientColumn}:
      database_condition_engine(databaseEngine, Tx.non_empty(databasePath), Tx.non_empty(clientPath))

def select_database_condition(+mask: U32, o: Options) -> String:
  Bool.pick(String, U32.is_zero(U32.and(mask, 512)), "", database_condition(o))

def select_mask_condition(+s: Subject, +mask: U32, o: Options) -> String:
  Bool.pick(String,
    U32.is_eq(U32.and(mask, subject_projection_mask(s)), mask),
    select_database_condition(mask, o),
    "context-projection-unsupported-for-subject")

def select_condition(+s: Subject, check: SelectCheck, o: Options) -> String:
  match check:
    case SelectEmpty{}: "context-select-empty"
    case SelectUnknown{}: "context-projection-unknown"
    case SelectDuplicate{}: "context-projection-duplicate"
    case SelectOk{mask}: select_mask_condition(s, mask, o)

def select_admitted(+s: Subject, check: SelectCheck, o: Options) -> Bool:
  Tx.str_eq(select_condition(s, check, o), "")

# --- Selected operation ---------------------------------------------------------------------

# The operation a request actually selects, named with core's private operation vocabulary. Core's
# effect constructor consumes this name together with the admitted subject; a projection name is
# not sufficient operation identity. A request that selects databaseAccesses performs the
# source-to-SQL planning join, so it selects `sqlPlan`; every other TypeScript projection is pure
# extraction from captured source, including the model-use resolution edges, so it selects
# `sourceAnalysis`. Core owns the operation-to-effect mapping.
def operation_of(+s: Subject, mask: U32) -> String:
  Bool.pick(String,
    U32.is_zero(U32.and(mask, 512)),
    "sourceAnalysis",
    operation_plan(s))

def operation_plan(+s: Subject) -> String:
  "sqlPlan"

# --- Constant-SQL and model joins to the catalog and models providers ------------------------

type Database is Data:
  DSqlite{path: String}
  DPostgres{connectionFile: String}

# Only a literal or a substitution-free template carries SQL the catalog parser may admit.
type SqlForm is Data:
  SLiteral{text: String}
  SDynamic{substitutions: U32}
  SNone{}

# How the checker resolved the callee against the admitted client declaration. A same-name
# shadowed function, an indirect call and a dynamic receiver each have their own case, so a join
# can never be produced from a spelling match.
type ClientMatch is Data:
  CMatched{}
  CShadowed{}
  CIndirect{}
  CDynamic{}
  CNotRequested{}

type SqlAsk is Data:
  SqlAskReady{database: Database, sqlText: String, sourceBinding: String, snapshotId: String}
  SqlAskUnavailable{reason: String}

def sql_ask_reason_ok(+form: SqlForm) -> String:
  match form:
    case SLiteral{text}: ""
    case SDynamic{substitutions}: "dynamicSql"
    case SNone{}: "noSqlLiteral"

def sql_ask_reason_match(+m: ClientMatch) -> String:
  match m:
    case CMatched{}: ""
    case CShadowed{}: "shadowedClient"
    case CIndirect{}: "indirectClient"
    case CDynamic{}: "dynamicReceiver"
    case CNotRequested{}: "clientNotRequested"

def sql_ask_reason(+m: ClientMatch, +form: SqlForm) -> String:
  Bool.pick(String,
    Tx.str_eq(sql_ask_reason_match(m), ""),
    sql_ask_reason_ok(form),
    sql_ask_reason_match(m))

def database_identity_ok(+db: Database) -> Bool:
  match db:
    case DSqlite{+path}: Tx.non_empty(path)
    case DPostgres{+connectionFile}: Tx.non_empty(connectionFile)

def sql_ask_identity_database(db_ok: Bool) -> String:
  Bool.pick(String, db_ok, "", "databaseIdentityMissing")

def sql_ask_identity_snapshot(snapshot_ok: Bool, db_ok: Bool) -> String:
  Bool.pick(String, snapshot_ok, sql_ask_identity_database(db_ok), "snapshotIdMissing")

def sql_ask_identity_binding(binding_ok: Bool, snapshot_ok: Bool, db_ok: Bool) -> String:
  Bool.pick(String, binding_ok, sql_ask_identity_snapshot(snapshot_ok, db_ok), "sourceBindingMissing")

def sql_ask_identity_reason(binding_ok: Bool, snapshot_ok: Bool, db_ok: Bool) -> String:
  sql_ask_identity_binding(binding_ok, snapshot_ok, db_ok)

# The full reason a join cannot be produced: the calibrated client match first, then the SQL form,
# then the three identities the join key needs. An empty source binding, snapshot or database
# identity refuses here rather than reaching a planner with an unbound key.
def sql_ask_reason_full(+m: ClientMatch, +form: SqlForm, +db: Database, +binding: String, +snapshot: String) -> String:
  Bool.pick(String,
    Tx.str_eq(sql_ask_reason(m, form), ""),
    sql_ask_identity_reason(Tx.non_empty(binding), Tx.non_empty(snapshot), database_identity_ok(db)),
    sql_ask_reason(m, form))

def sql_ask_unavailable(+reason: String) -> SqlAsk:
  SqlAskUnavailable{reason}

def sql_ask_literal(+db: Database, +text: String, +binding: String, +snapshot: String) -> SqlAsk:
  SqlAskReady{db, text, binding, snapshot}

def sql_ask_ready_text(+form: SqlForm, +db: Database, +binding: String, +snapshot: String) -> SqlAsk:
  match form:
    case SLiteral{+text}: sql_ask_literal(db, text, binding, snapshot)
    case SDynamic{substitutions}: sql_ask_unavailable("dynamicSql")
    case SNone{}: sql_ask_unavailable("noSqlLiteral")

def sql_ask_ready(+m: ClientMatch, +form: SqlForm, +db: Database, +binding: String, +snapshot: String, +reason: String) -> SqlAsk:
  Bool.pick(SqlAsk,
    Tx.str_eq(reason, ""),
    sql_ask_ready_text(form, db, binding, snapshot),
    sql_ask_unavailable(reason))

# The join request handed to the catalog provider. It exists only when the checker matched the
# admitted client declaration, the form is a literal or a substitution-free template, and the
# source binding, snapshot and database identities are all present and named. The shadowed,
# indirect, dynamic and unmatched cases each keep their own reason, so a text or spelling match,
# an unbound call site or an unnamed database can never produce an ask.
def sql_ask(+m: ClientMatch, +form: SqlForm, +db: Database, +binding: String, +snapshot: String) -> SqlAsk:
  sql_ask_ready(m, form, db, binding, snapshot, sql_ask_reason_full(m, form, db, binding, snapshot))

def sql_ask_text(+a: SqlAsk) -> String:
  match a:
    case SqlAskReady{database, sqlText, sourceBinding, snapshotId}:
      Tx.str_cat("ready:", Tx.str_cat(sqlText, Tx.str_cat("@", sourceBinding)))
    case SqlAskUnavailable{+reason}: Tx.str_cat("unavailable:", reason)

# The join key binds the snapshot and the source binding, so the same statement text from another
# snapshot or another call site can never join to these catalog operands.
def json_str_list(xs: List<String>) -> J.Json:
  match xs:
    case Nil{}: J.Jnil{}
    case Con{h, t}: J.Jarr{J.Jstr{h}, json_str_list(t)}

def join_key_ready(+snapshot: String, +binding: String) -> String:
  J.json_text(J.Jarr{
    json_str_list(Con{"snapshot", Con{snapshot, Nil{}}}),
    J.Jarr{json_str_list(Con{"binding", Con{binding, Nil{}}}), J.Jnil{}}})

def join_key(+a: SqlAsk) -> String:
  match a:
    case SqlAskReady{database, sqlText, sourceBinding, snapshotId}:
      join_key_ready(snapshotId, sourceBinding)
    case SqlAskUnavailable{reason}: ""

# A resolved model export and its module identity, under one snapshot. The key carries the
# resolved declaration identity and the snapshot, so a model selector is never satisfied by a
# file name, a bare export spelling or another snapshot's declaration.
type ModuleUse is Data:
  ModuleUse{snapshotId: String, modulePath: String, moduleSha: String, exportName: String, exportPath: String, exportSha: String, exportLine: U32, exportColumn: U32}

def module_use_json(+snapshotId: String, +modulePath: String, +moduleSha: String, +exportName: String, +exportPath: String, +exportSha: String, +line: String, +column: String) -> String:
  J.json_text(json_str_list(Con{"moduleUse", Con{snapshotId, Con{modulePath, Con{moduleSha, Con{exportName, Con{exportPath, Con{exportSha, Con{line, Con{column, Nil{}}}}}}}}}}))

def module_use_key(+u: ModuleUse) -> String:
  match u:
    case ModuleUse{+snapshotId, +modulePath, +moduleSha, +exportName, +exportPath, +exportSha, +exportLine, +exportColumn}:
      module_use_json(snapshotId, modulePath, moduleSha, exportName, exportPath, exportSha, U32.show(exportLine), U32.show(exportColumn))

def module_use_same(+a: ModuleUse, +b: ModuleUse) -> Bool:
  Tx.str_eq(module_use_key(a), module_use_key(b))

# --- Provider identity, launch and byte transport -------------------------------------------

# The provider is a library loaded by a Node process, so the executable provenance is the node
# path that ran, and the library path and digest name the exact analyzed package.
type Provider is Data:
  Provider{node: String, runtime: String, libraryPath: String, librarySha: String, version: String}

def provider_text(+p: Provider) -> String:
  match p:
    case Provider{+node, +runtime, +libraryPath, +librarySha, +version}:
      J.json_text(J.Jobj{
        J.Jpair{"node", J.Jstr{node}, J.Jpair{
          "libraryPath", J.Jstr{libraryPath}, J.Jpair{
            "librarySha", J.Jstr{librarySha}, J.Jpair{
              "runtime", J.Jstr{runtime}, J.Jpair{"version", J.Jstr{version}, J.Jnil{}}}}}}})
