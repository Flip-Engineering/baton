# Shared string-set operations and operation/effect vocabulary for native context
# request admission. Provider declarations and catalog selection live in
# engines-decl.bend, engines-select.bend and native-catalog.bend.

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

# Qualified discovery of a deployment-admitted provider executable: no request
# supplied it, so it needs no target-execution grant. A request-local tools
# override is a different operation and does require executeTarget before its
# probe runs, even when it names the same path as a deployment executable. The
# label is the one Environment proposed; core owns the vocabulary and there is
# one definition per contract.
def op_deployment_tool_probe() -> String:
  "deploymentToolProbe"

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

# The closed operation set. A caller consults this before required_effects, so
# an operation outside the set is refused by closed validation and never
# reaches the effect composition; the empty fallthrough of required_effects
# cannot authorize an operation that this predicate does not admit.
def operation_known(+operation: String) -> Bool:
  Bool.or(String.eq(operation, op_source_analysis()),
  Bool.or(String.eq(operation, op_code_access_join()),
  Bool.or(String.eq(operation, op_sql_plan()),
  Bool.or(String.eq(operation, op_catalog_capture()),
  Bool.or(String.eq(operation, op_migration_replay()),
  Bool.or(String.eq(operation, op_schema_validation()),
  Bool.or(String.eq(operation, op_model_load()),
  Bool.or(String.eq(operation, op_deployment_tool_probe()),
  Bool.or(String.eq(operation, op_tools_probe()),
  Bool.or(String.eq(operation, op_environment_read()),
  Bool.or(String.eq(operation, op_dataset_read()),
  Bool.or(String.eq(operation, op_runtime_launch()),
  Bool.or(String.eq(operation, op_runtime_observe()),
  Bool.or(String.eq(operation, op_runtime_pause()),
  Bool.or(String.eq(operation, op_runtime_resume()),
  Bool.or(String.eq(operation, op_runtime_release()),
  Bool.or(String.eq(operation, op_runtime_evaluate()),
  Bool.or(String.eq(operation, op_query_control_recover()),
         String.eq(operation, op_query_control_release())))))))))))))))))))

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

# The first required effect the caller did not grant. Admission refuses on
# Missing before any provider or target effect.
type Effects is Data:
  FxGranted{}
  FxMissing{effect: String}

def missing_effects(+required: SS, +granted: SS) -> Effects:
  match required:
    case SSNil{}: FxGranted{}
    case SSCons{+h, r}:
      Bool.pick(Effects, ss_member(granted, h), missing_effects(r, granted), FxMissing{h})

# --- the admission composition ------------------------------------------------
# A request can select more than one operation: a request-local tools override
# sits beside the subject's own SQL, model or runtime work, and a tools override
# cannot replace the effects that work still needs. The caller therefore passes
# every selected operation, and this composition unions their required effects
# before it consults the grant.
def union_append(xs: SS, +add: SS) -> SS:
  match xs:
    case SSNil{}: add
    case SSCons{h, r}: SSCons{h, union_append(r, add)}

def union_add(required: SS, +acc: SS) -> SS:
  match required:
    case SSNil{}: acc
    case SSCons{+h, r}:
      union_add(r, Bool.pick(SS, ss_member(acc, h), acc, union_append(acc, ss_one(h))))

def effects_union(operations: SS) -> SS:
  match operations:
    case SSNil{}: SSNil{}
    case SSCons{h, r}: union_add(required_effects(h), effects_union(r))

type OpsKnown is Data:
  OkAllKnown{}
  OkUnknown{operation: String}

def ss_nonempty(xs: SS) -> Bool:
  match xs:
    case SSNil{}: False{}
    case SSCons{h, r}: True{}

# Exhaustion after every member was validated answers OkAllKnown; the empty
# selection is decided by admit_operations before this walk, so an empty chain
# here means the last member was known.
def operations_known(operations: SS) -> OpsKnown:
  match operations:
    case SSNil{}: OkAllKnown{}
    case SSCons{+h, r}: Bool.pick(OpsKnown, operation_known(h), operations_known(r), OkUnknown{h})

type Admission is Data:
  AdAdmit{effects: SS}
  AdNoOperation{}
  AdUnknownOperation{operation: String}
  AdMissingEffect{effect: String}

def admit_effects(m: Effects, union: SS) -> Admission:
  match m:
    case FxGranted{}: AdAdmit{union}
    case FxMissing{effect}: AdMissingEffect{effect}

def admit_after_known(k: OpsKnown, +operations: SS, +granted: SS) -> Admission:
  match k:
    case OkAllKnown{}: admit_effects(missing_effects(effects_union(operations), granted), effects_union(operations))
    case OkUnknown{operation}: AdUnknownOperation{operation}

# The caller-level refusal: an empty selection and an operation outside the
# closed set are both refused before any effect composition, and a union whose
# grant is incomplete names the first effect it lacks. An admit carries the
# union as its evidence of what was authorized.
def admit_operations(+operations: SS, +granted: SS) -> Admission:
  Bool.pick(Admission, ss_nonempty(operations), admit_after_known(operations_known(operations), operations, granted), AdNoOperation{})
