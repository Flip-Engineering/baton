# CLAIM: the fixed engine table, automatic engine selection and the fixed
# discovery plan of the native semantic context feature
# (docs/bend2/semantic-context-spec.md, "Native surfaces" and "Request
# contract").
#
# The module composes three things and performs no provider work:
#  - the fixed engine table: which projections each engine serves and which
#    effects the selected projections require;
#  - automatic selection: subject kind, source suffix and requested projections
#    resolve exactly one engine, name the candidates of an ambiguous request, or
#    name the unsupported scope. Several candidate backends are never executed
#    speculatively;
#  - the fixed discovery plan: the deployment's admitted provider executables
#    and the argv that context-engines probes, with the observed outcome
#    composed into one engine entry's availability.
#
# Provider owners supply probe outcomes (observed version, absolute executable
# path and digest) and the engine provider identity. Lifecycle runs the probes.
# This module never spawns a process, never names a target path and never
# starts a debuggee.
#
# Approved references: exact 8a26bc3e7f9d5355b72f1291d95620b218b5c8e2, root
# authorization 39, synthesis guidance semantic-synthesis-coverage-39-native.

import Base

# --- string lists carried inside Data values ---------------------------------
# A Data constructor's field must itself be Data, and List is a Type, so a
# string list inside a result is carried by a self-referential constructor
# chain, as json/canonical.bend carries its tree.
type SS is Data:
  SSNil{}
  SSCons{head: String, rest: SS}

def ss_empty() -> SS:
  SSNil{}

def ss_one(a: String) -> SS:
  SSCons{a, SSNil{}}

def ss_two(a: String, b: String) -> SS:
  SSCons{a, SSCons{b, SSNil{}}}

def ss_three(a: String, b: String, c: String) -> SS:
  SSCons{a, SSCons{b, SSCons{c, SSNil{}}}}

def ss_member(xs: SS, +want: String) -> Bool:
  match xs:
    case SSNil{}: False{}
    case SSCons{h, r}: Bool.or(String.eq(h, want), ss_member(r, want))

def ss_to_list(xs: SS) -> List<String>:
  match xs:
    case SSNil{}: Nil{}
    case SSCons{h, r}: h <> ss_to_list(r)

def ss_of_list(xs: List<String>) -> SS:
  match xs:
    case Nil{}: SSNil{}
    case h <> t: SSCons{h, ss_of_list(t)}

# --- engine names ------------------------------------------------------------
def e_typescript() -> String:
  "typescript"

def e_clangd() -> String:
  "clangd"

def e_clang_analyzer() -> String:
  "clang-analyzer"

def e_cdp() -> String:
  "cdp"

def e_sqlite() -> String:
  "sqlite-schema"

def e_postgres() -> String:
  "postgres-schema"

def e_datamodel() -> String:
  "data-model"

def e_environment() -> String:
  "environment"

def e_dataset() -> String:
  "json-dataset"

def e_query_control() -> String:
  "query-control"

# --- the declared projection table -------------------------------------------
def ts_projections() -> SS:
  ss_of_list(["definition", "type", "references", "calls", "callers",
              "dependencies", "diagnostics", "flow", "exceptions",
              "databaseAccesses"])

def clangd_projections() -> SS:
  ss_of_list(["definition", "type", "references", "calls", "callers",
              "dependencies", "diagnostics"])

def analyzer_projections() -> SS:
  ss_of_list(["definition", "type", "calls", "callers", "diagnostics", "flow",
              "exceptions", "authorization", "databaseAccesses",
              "predicateQueries", "guardPaths", "inputPaths", "declaration"])

def cdp_projections() -> SS:
  ss_of_list(["state", "frames", "scopes", "values", "exception", "threads"])

def sqlite_projections() -> SS:
  ss_of_list(["entities", "columns", "relationships", "constraints",
              "codeAccesses", "columnOrigins"])

def postgres_projections() -> SS:
  ss_of_list(["entities", "columns", "relationships", "constraints",
              "codeAccesses"])

def datamodel_projections() -> SS:
  ss_of_list(["validation", "serialization", "codeAccesses", "migrations",
              "constraints"])

def environment_projections() -> SS:
  ss_of_list(["dependencies", "toolchain", "build", "configuration",
              "services"])

def dataset_projections() -> SS:
  ss_of_list(["structure", "value", "relationships"])

def query_control_projections() -> SS:
  ss_one("state")

def projections_of(+engine: String) -> SS:
  Bool.pick(SS, String.eq(engine, e_typescript()), ts_projections(),
  Bool.pick(SS, String.eq(engine, e_clangd()), clangd_projections(),
  Bool.pick(SS, String.eq(engine, e_clang_analyzer()), analyzer_projections(),
  Bool.pick(SS, String.eq(engine, e_cdp()), cdp_projections(),
  Bool.pick(SS, String.eq(engine, e_sqlite()), sqlite_projections(),
  Bool.pick(SS, String.eq(engine, e_postgres()), postgres_projections(),
  Bool.pick(SS, String.eq(engine, e_datamodel()), datamodel_projections(),
  Bool.pick(SS, String.eq(engine, e_environment()), environment_projections(),
  Bool.pick(SS, String.eq(engine, e_dataset()), dataset_projections(),
  Bool.pick(SS, String.eq(engine, e_query_control()), query_control_projections(),
  SSNil{}))))))))))

# The first requested projection the engine does not serve, empty when every
# projection is served.
def unsupported_of(+engine: String, projections: SS) -> SS:
  match projections:
    case SSNil{}: SSNil{}
    case SSCons{+h, r}:
      Bool.pick(SS, ss_member(projections_of(engine), h), unsupported_of(engine, r), ss_one(h))

# The declarations an engine is declared to serve, as one chain.
def serves(+engine: String, projections: SS) -> Bool:
  match projections:
    case SSNil{}: True{}
    case SSCons{h, r}: Bool.and(ss_member(projections_of(engine), h), serves(engine, r))

def unsupported_reason(+engine: String, unsupported: SS) -> String:
  match unsupported:
    case SSNil{}: String.append("every requested projection is served by ", engine)
    case SSCons{h, r}: String.append(String.append(String.append("projection is not served by ", engine), ": "), h)

# --- the declared effect table -----------------------------------------------
# Effects follow the selected operation, not the engine or a projection name
# alone. A JSON Schema validation runs in the bundled Ajv provider and needs no
# target effect; a Zod model load imports target code and requires
# executeTarget; a catalog-only capture reads fixed catalogs with no grant;
# a selected target statement or the native C planner requires planTargetSql;
# a migration replay executes captured scripts and requires replayMigrations
# whatever projection was requested; a request-local tools override requires
# executeTarget before its probe runs.
def op_source_analysis() -> String:
  "sourceAnalysis"

def op_code_access_join() -> String:
  "codeAccessJoin"

def op_sql_plan() -> String:
  "sqlPlan"

def op_catalog_capture() -> String:
  "catalogCapture"

def op_migration_replay() -> String:
  "migrationReplay"

def op_schema_validation() -> String:
  "schemaValidation"

def op_model_load() -> String:
  "modelLoad"

def op_tools_probe() -> String:
  "toolsProbe"

def op_environment_read() -> String:
  "environmentRead"

def op_dataset_read() -> String:
  "datasetRead"

def op_runtime_launch() -> String:
  "runtimeLaunch"

def op_runtime_observe() -> String:
  "runtimeObserve"

def op_runtime_pause() -> String:
  "runtimePause"

def op_runtime_resume() -> String:
  "runtimeResume"

def op_runtime_release() -> String:
  "runtimeRelease"

def op_runtime_evaluate() -> String:
  "runtimeEvaluate"

def op_query_control_recover() -> String:
  "queryControlRecover"

def op_query_control_release() -> String:
  "queryControlRelease"

# An operation outside this closed set is refused by closed request
# validation; this composition requires no effect for it.
def required_effects(+operation: String) -> SS:
  Bool.pick(SS, String.eq(operation, op_code_access_join()), ss_one("planTargetSql"),
  Bool.pick(SS, String.eq(operation, op_sql_plan()), ss_one("planTargetSql"),
  Bool.pick(SS, String.eq(operation, op_migration_replay()), ss_one("replayMigrations"),
  Bool.pick(SS, String.eq(operation, op_model_load()), ss_one("executeTarget"),
  Bool.pick(SS, String.eq(operation, op_tools_probe()), ss_one("executeTarget"),
  Bool.pick(SS, String.eq(operation, op_runtime_evaluate()), ss_two("controlRuntime", "evaluateRuntime"),
  Bool.pick(SS, String.eq(operation, op_runtime_launch()), ss_one("controlRuntime"),
  Bool.pick(SS, String.eq(operation, op_runtime_pause()), ss_one("controlRuntime"),
  Bool.pick(SS, String.eq(operation, op_runtime_resume()), ss_one("controlRuntime"),
  Bool.pick(SS, String.eq(operation, op_runtime_release()), ss_one("controlRuntime"),
  Bool.pick(SS, String.eq(operation, op_query_control_release()), ss_one("controlRuntime"),
  ss_empty())))))))))))

# The runtime intent of a request names the operation its subject selects. An
# ordinary non-evaluating observation controls no target.
def runtime_operation(+intent: String) -> String:
  Bool.pick(String, String.eq(intent, "launch"), op_runtime_launch(),
  Bool.pick(String, String.eq(intent, "observe"), op_runtime_observe(),
  Bool.pick(String, String.eq(intent, "pause"), op_runtime_pause(),
  Bool.pick(String, String.eq(intent, "resume-step"), op_runtime_resume(),
  Bool.pick(String, String.eq(intent, "release"), op_runtime_release(),
  Bool.pick(String, String.eq(intent, "evaluate"), op_runtime_evaluate(),
  ""))))))

# The query-control intent names its operation: recovery reads retained state
# and needs no grant, release signals the owned process.
def query_control_operation(+intent: String) -> String:
  Bool.pick(String, String.eq(intent, "release"), op_query_control_release(),
  Bool.pick(String, String.eq(intent, "recover"), op_query_control_recover(), ""))

# The set an engine can require, for its context-engines entry.
def effects_of(+engine: String) -> SS:
  Bool.pick(SS, String.eq(engine, e_typescript()), ss_one("planTargetSql"),
  Bool.pick(SS, String.eq(engine, e_clang_analyzer()), ss_one("planTargetSql"),
  Bool.pick(SS, String.eq(engine, e_cdp()), ss_two("controlRuntime", "evaluateRuntime"),
  Bool.pick(SS, String.eq(engine, e_query_control()), ss_one("controlRuntime"),
  Bool.pick(SS, String.eq(engine, e_datamodel()), ss_two("replayMigrations", "executeTarget"),
  Bool.pick(SS, String.eq(engine, e_sqlite()), ss_one("planTargetSql"),
  Bool.pick(SS, String.eq(engine, e_postgres()), ss_one("planTargetSql"),
  Bool.pick(SS, String.eq(engine, e_environment()), ss_one("executeTarget"),
  ss_empty()))))))))

# The first required effect the caller did not grant. Admission refuses on
# Missing before any provider or target effect.
type Effects is Data:
  FxGranted{}
  FxMissing{effect: String}

def missing_effects(required: SS, +granted: SS) -> Effects:
  match required:
    case SSNil{}: FxGranted{}
    case SSCons{+h, r}:
      Bool.pick(Effects, ss_member(granted, h), missing_effects(r, granted), FxMissing{h})

# --- automatic engine selection ----------------------------------------------
type EngineChoice is Data:
  EOne{engine: String}
  EMany{candidates: SS}
  ENone{reason: String}

def ts_suffix(+path: String) -> Bool:
  Bool.or(String.ends_with(path, ".ts"),
  Bool.or(String.ends_with(path, ".tsx"),
  Bool.or(String.ends_with(path, ".mts"),
  Bool.or(String.ends_with(path, ".cts"),
  Bool.or(String.ends_with(path, ".js"),
  Bool.or(String.ends_with(path, ".jsx"),
  Bool.or(String.ends_with(path, ".mjs"),
         String.ends_with(path, ".cjs"))))))))

# The C family. A header is read as C because the supported analysis profile is
# the C profile and the request carries no other language declaration.
def c_suffix(+path: String) -> Bool:
  Bool.or(String.ends_with(path, ".c"), String.ends_with(path, ".h"))

def cpp_suffix(+path: String) -> Bool:
  Bool.or(String.ends_with(path, ".cc"),
  Bool.or(String.ends_with(path, ".cpp"),
  Bool.or(String.ends_with(path, ".cxx"),
  Bool.or(String.ends_with(path, ".hh"),
  Bool.or(String.ends_with(path, ".hpp"),
         String.ends_with(path, ".hxx"))))))

# A projection the C analyzer profile answers and the ordinary language service
# does not. The `analysis` option value `cfg` selects a C analysis operation; it
# is an option, not a projection, and appears in no selection list.
def analysis_projection(+p: String) -> Bool:
  Bool.or(String.eq(p, "authorization"),
  Bool.or(String.eq(p, "flow"),
  Bool.or(String.eq(p, "databaseAccesses"),
  Bool.or(String.eq(p, "predicateQueries"),
  Bool.or(String.eq(p, "guardPaths"),
  Bool.or(String.eq(p, "inputPaths"),
         String.eq(p, "declaration")))))))

def any_analysis(xs: SS) -> Bool:
  match xs:
    case SSNil{}: False{}
    case SSCons{h, r}: Bool.or(analysis_projection(h), any_analysis(r))

def source_projection(+p: String) -> Bool:
  Bool.or(ss_member(ts_projections(), p),
  Bool.or(ss_member(clangd_projections(), p), ss_member(analyzer_projections(), p)))

def any_source_projection(xs: SS) -> Bool:
  match xs:
    case SSNil{}: False{}
    case SSCons{h, r}: Bool.or(source_projection(h), any_source_projection(r))

def served_choice(+engine: String, +projections: SS) -> EngineChoice:
  Bool.pick(EngineChoice, serves(engine, projections), EOne{engine}, ENone{unsupported_reason(engine, unsupported_of(engine, projections))})

def ts_source(+projections: SS) -> EngineChoice:
  served_choice(e_typescript(), projections)

# The C profile: any analysis projection selects the one analyzer engine, which
# also answers the ordinary language-service projections over the same source
# identities. Otherwise the ordinary language service answers.
def c_source(+projections: SS) -> EngineChoice:
  Bool.pick(EngineChoice, any_analysis(projections), served_choice(e_clang_analyzer(), projections), served_choice(e_clangd(), projections))

# C++ analysis is outside the initial supported set; ordinary C++ language
# service projections answer.
def cpp_source(+projections: SS) -> EngineChoice:
  Bool.pick(EngineChoice, any_analysis(projections),
    ENone{"C++ analysis projections are outside the initial supported set"},
    served_choice(e_clangd(), projections))

def source_choice(+path: String, +projections: SS) -> EngineChoice:
  Bool.pick(EngineChoice, ts_suffix(path), ts_source(projections),
  Bool.pick(EngineChoice, c_suffix(path), c_source(projections),
  Bool.pick(EngineChoice, cpp_suffix(path), cpp_source(projections),
  Bool.pick(EngineChoice, any_source_projection(projections),
    EMany{ss_two(e_typescript(), e_clangd())},
    ENone{"unrecognized source suffix"}))))

def source_kind(+kind: String) -> Bool:
  Bool.or(String.eq(kind, "position"),
  Bool.or(String.eq(kind, "symbol"), String.eq(kind, "diagnostic")))

def entity_choice(+declared: String) -> EngineChoice:
  Bool.pick(EngineChoice, String.eq(declared, e_sqlite()), EOne{e_sqlite()},
  Bool.pick(EngineChoice, String.eq(declared, e_postgres()), EOne{e_postgres()},
    ENone{"entity subject requires a database engine"}))

# A ref subject resolves from its retained entry, so `declared` carries the
# stored selector's engine and no suffix or projection decides it.
def ref_choice(+declared: String) -> EngineChoice:
  Bool.pick(EngineChoice, String.eq(declared, ""), ENone{"ref subject requires the stored selector engine"}, EOne{declared})

# Automatic selection. `declared` names the subject's own declared sub-engine
# where the subject carries one: the entity subject's database engine, or the
# retained entry's engine for a ref subject. It is empty otherwise.
def auto(+kind: String, +path: String, +declared: String, +projections: SS) -> EngineChoice:
  Bool.pick(EngineChoice, source_kind(kind), source_choice(path, projections),
  Bool.pick(EngineChoice, String.eq(kind, "entity"), entity_choice(declared),
  Bool.pick(EngineChoice, String.eq(kind, "ref"), ref_choice(declared),
  Bool.pick(EngineChoice, String.eq(kind, "model"), EOne{e_datamodel()},
  Bool.pick(EngineChoice, String.eq(kind, "schema"), EOne{e_datamodel()},
  Bool.pick(EngineChoice, String.eq(kind, "security"), EOne{e_clang_analyzer()},
  Bool.pick(EngineChoice, String.eq(kind, "migration"), EOne{e_datamodel()},
  Bool.pick(EngineChoice, String.eq(kind, "program"), EOne{e_environment()},
  Bool.pick(EngineChoice, String.eq(kind, "dataset"), EOne{e_dataset()},
  Bool.pick(EngineChoice, String.eq(kind, "runtime"), EOne{e_cdp()},
  Bool.pick(EngineChoice, String.eq(kind, "query-control"), EOne{e_query_control()},
    ENone{"unsupported subject kind"})))))))))))

# --- resolution against the observed catalog ---------------------------------
type Availability is Data:
  AvAvailable{}
  AvUnavailable{reason: String}
  AvExcluded{reason: String}

type EngineEntry is Data:
  Engine{engine: String, provider: String, version: String, executable: String,
         projections: SS, effects: SS, availability: Availability, limits: SS}

type EngineResolved is Data:
  RSelected{engine: String, provider: String, version: String, executable: String}
  RUnavailable{engine: String, reason: String}
  RExcluded{engine: String, reason: String}
  RCandidates{candidates: SS}
  RNone{reason: String}

def entry_engine(e: EngineEntry) -> String:
  match e:
    case Engine{engine, provider, version, executable, projections, effects, availability, limits}: engine

def entry_resolved(e: EngineEntry) -> EngineResolved:
  match e:
    case Engine{engine, provider, version, executable, projections, effects, availability, limits}:
      match availability:
        case AvAvailable{}: RSelected{engine, provider, version, executable}
        case AvUnavailable{reason}: RUnavailable{engine, reason}
        case AvExcluded{reason}: RExcluded{engine, reason}

def resolve_find(+engine: String, catalog: List<EngineEntry>) -> EngineResolved:
  match catalog:
    case Nil{}: RNone{String.append("engine is outside the deployment provider selection: ", engine)}
    case +h <> t:
      Bool.pick(EngineResolved, String.eq(entry_engine(h), engine), entry_resolved(h), resolve_find(engine, t))

def resolve(choice: EngineChoice, catalog: List<EngineEntry>) -> EngineResolved:
  match choice:
    case EOne{engine}: resolve_find(engine, catalog)
    case EMany{candidates}: RCandidates{candidates}
    case ENone{reason}: RNone{reason}

# --- the fixed discovery plan ------------------------------------------------
type Deployment is Data:
  Dep{node: String, tsProvider: String, psql: String}

type ProbeSpec is Data:
  Probe{engine: String, operation: String, executable: String, argv: SS}

type ProbeOutcome is Data:
  POk{version: String, executable: String, sha256: String}
  PFailed{reason: String}
  PExcluded{reason: String}

# The probe form of one engine is pinned only where its owner published a
# callable discovery entry. The TypeScript adapter publishes the
# provider-engines request on standard input with argv `-`; node and psql are
# probed with their conventional version flag. Every other engine stays
# unpinned here: no invented argv can establish that a provider answers, and an
# unpinned engine reports unavailable with that reason until its owner pins the
# callable form and its staged path.
def unpinned_operation() -> String:
  "unpinned"

def probe_plan(dep: Deployment) -> List<ProbeSpec>:
  match dep:
    case Dep{+node, tsProvider, psql}:
      [ Probe{e_typescript(), "providerEngines", node, ss_two(tsProvider, "-")},
        Probe{e_clangd(), unpinned_operation(), "", SSNil{}},
        Probe{e_clang_analyzer(), unpinned_operation(), "", SSNil{}},
        Probe{e_cdp(), "version", node, ss_one("--version")},
        Probe{e_sqlite(), unpinned_operation(), "", SSNil{}},
        Probe{e_postgres(), "version", psql, ss_one("--version")},
        Probe{e_datamodel(), unpinned_operation(), "", SSNil{}},
        Probe{e_environment(), unpinned_operation(), "", SSNil{}},
        Probe{e_dataset(), unpinned_operation(), "", SSNil{}} ]

# A successful probe whose observed version differs from the declared version
# is unavailable with the observed mismatch named. A failed probe remains
# visible with its reason.
def availability_observed(outcome: ProbeOutcome, +expected: String) -> Availability:
  match outcome:
    case POk{+version, executable, sha256}:
      Bool.pick(Availability, String.eq(version, expected), AvAvailable{},
        AvUnavailable{String.append(String.append(String.append("observed provider version ", version), " differs from the declared version "), expected)})
    case PFailed{reason}: AvUnavailable{reason}
    case PExcluded{reason}: AvExcluded{reason}

# An engine whose discovery form is not pinned cannot report availability; it
# reports the missing prerequisite rather than an absent executable.
def probe_availability(+operation: String, outcome: ProbeOutcome, +expected: String) -> Availability:
  Bool.pick(Availability, String.eq(operation, unpinned_operation()), AvUnavailable{"the provider probe form is not pinned"}, availability_observed(outcome, expected))

def entry_of(spec: ProbeSpec, outcome: ProbeOutcome, +provider: String, +expected: String, +projections: SS, +limits: SS) -> EngineEntry:
  match spec:
    case Probe{+engine, operation, executable, argv}:
      Engine{engine, provider, expected, executable, projections, effects_of(engine), probe_availability(operation, outcome, expected), limits}
