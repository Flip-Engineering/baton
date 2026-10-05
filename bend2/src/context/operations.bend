# CLAIM: the selected operation for a validated request is a pure function of the
# request's subject kind, its projections and its declared options. The module also
# exposes the request fields context-core consumes: the subject kind, the entity
# subject's declared database engine, the source path, the runtime and
# query-control intents, and the requested projection list as text.
#
# Effect subsets stay with context-core: `Eng.required_effects(operation)` is the
# one mapping from an operation to the effects it needs, and `Eng.missing_effects`
# is its admission answer. This module produces the operation name only. The
# runtime and query-control intent rows mirror the operation names core publishes
# in `Eng.runtime_operation` and `Eng.query_control_operation`; core owns that
# mapping and this function delegates to it once the modules are composed.
#
# Serves: docs/bend2/semantic-context-spec.md, effects and operation selection.
# Fixture: bend2/src/context/operations.bend with operations.expected.txt.
import Base
import ../json/canonical.bend as J
import ./request.bend as Req
import ./contracts.bend as Context

# Call sites reach these as `<alias>.request_operation` when this module is
# imported as `<alias>`; the lane's schema name for the function is
# `Context.request_operation`. The declarations are unqualified because a dotted
# declared name is not verified callable from its own module, and these functions
# call each other.

# ---------------------------------------------------------------------------
# Object member access over the request tree.

def obj_members(+j: J.Json) -> J.Json:
  match j:
    case J.Jobj{+members}: members
    case J.Jnull{}: J.Jnil{}
    case J.Jtrue{}: J.Jnil{}
    case J.Jfalse{}: J.Jnil{}
    case J.Jint{+value}: J.Jnil{}
    case J.Jstr{+value}: J.Jnil{}
    case J.Jarr{+head, +tail}: J.Jnil{}
    case J.Jnil{}: J.Jnil{}

def or_nil(m: Maybe<&2, J.Json>) -> J.Json:
  match m:
    case None{}: J.Jnil{}
    case Some{value}: value

def text_or_empty(m: Maybe<&2, J.Json>) -> String:
  match m:
    case None{}: SNil{}
    case Some{value}: Req.text_of(value)

def member_text(members: J.Json, key: String) -> String:
  text_or_empty(Req.member_lookup(key, members))

def request_members(+req: J.Json) -> J.Json:
  obj_members(req)

def subject_value(+req: J.Json) -> J.Json:
  or_nil(Req.member_lookup("subject", request_members(req)))

def subject_members(+req: J.Json) -> J.Json:
  obj_members(subject_value(req))

def subject_field(req: J.Json, key: String) -> String:
  member_text(subject_members(req), key)

def select_value(+req: J.Json) -> J.Json:
  or_nil(Req.member_lookup("select", request_members(req)))

def options_members(+req: J.Json) -> J.Json:
  obj_members(or_nil(Req.member_lookup("options", request_members(req))))

# ---------------------------------------------------------------------------
# The request fields context-core consumes.

def request_subject_kind(+req: J.Json) -> String:
  subject_field(req, "kind")

def source_path(+req: J.Json) -> String:
  subject_field(req, "path")

def runtime_intent(+req: J.Json) -> String:
  subject_field(req, "intent")

def query_control_intent(+req: J.Json) -> String:
  subject_field(req, "intent")

def entity_database_engine(+req: J.Json) -> String:
  database_engine(Req.member_lookup("database", subject_members(req)))

def database_engine(m: Maybe<&2, J.Json>) -> String:
  match m:
    case None{}: SNil{}
    case Some{value}: member_text(obj_members(value), "engine")

def request_projections(+req: J.Json) -> String:
  join_projections(select_value(req), True{}, SNil{})

def join_projections(j: J.Json, first: Bool, +acc: String) -> String:
  match j:
    case J.Jarr{+head, +tail}:
      join_projections(tail, False{}, acc ++ Bool.pick(String, first, SNil{}, ",") ++ Req.text_of(head))
    case J.Jnil{}: acc
    case J.Jnull{}: acc
    case J.Jtrue{}: acc
    case J.Jfalse{}: acc
    case J.Jint{+value}: acc
    case J.Jstr{+value}: acc
    case J.Jobj{+members}: acc

def selected_name(j: J.Json, +name: String) -> Bool:
  match j:
    case J.Jarr{+head, +tail}:
      Bool.pick(Bool, String.eq(Req.text_of(head), name), True{}, selected_name(tail, name))
    case J.Jnil{}: False{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jstr{+value}: False{}
    case J.Jobj{+members}: False{}

def projection_selected(req: J.Json, +name: String) -> Bool:
  selected_name(select_value(req), name)

# ---------------------------------------------------------------------------
# The selected operation.

def tools_requested(+req: J.Json) -> Bool:
  Req.present_of(Req.member_lookup("tools", options_members(req)))

def runtime_operation_text(intent: String) -> String:
  match intent:
    case "launch": "runtimeLaunch"
    case "observe": "runtimeObserve"
    case "pause": "runtimePause"
    case "resume-step": "runtimeResume"
    case "evaluate": "runtimeEvaluate"
    case "release": "runtimeRelease"
    case other: SNil{}

def control_operation_text(intent: String) -> String:
  match intent:
    case "recover": "queryControlRecover"
    case "release": "queryControlRelease"
    case other: SNil{}

def source_operation(+req: J.Json) -> String:
  Bool.pick(String, projection_selected(req, "databaseAccesses"), "codeAccessJoin", "sourceAnalysis")

def entity_operation(+req: J.Json) -> String:
  Bool.pick(String, projection_selected(req, "codeAccesses"), "codeAccessJoin", "catalogCapture")

def subject_operation(kind: String, req: J.Json) -> String:
  match kind:
    case "runtime": runtime_operation_text(runtime_intent(req))
    case "query-control": control_operation_text(query_control_intent(req))
    case "model": "modelLoad"
    case "schema": "schemaValidation"
    case "dataset": "datasetRead"
    case "program": "environmentRead"
    case "migration": "migrationReplay"
    case "entity": entity_operation(req)
    case "position": source_operation(req)
    case "symbol": source_operation(req)
    case "diagnostic": source_operation(req)
    case other: SNil{}

# A request-local tool override is a target execution and selects its own probe
# operation before any subject-derived selection.
def request_operation(+req: J.Json) -> String:
  Bool.pick(String, tools_requested(req), "toolsProbe", subject_operation(request_subject_kind(req), req))

law operations_law_a_local_tool_override_selects_its_probe:
  {request_operation(J.Jobj{J.Jpair{"options", J.Jobj{J.Jpair{"tools", J.Jobj{J.Jnil{}}, J.Jnil{}}}, J.Jnil{}}}) == "toolsProbe" : String}

def operations_law_a_local_tool_override_selects_its_probe():
  {==}

law operations_law_a_model_subject_loads_the_target_module:
  {request_operation(J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"model"}, J.Jnil{}}}, J.Jnil{}}}) == "modelLoad" : String}

def operations_law_a_model_subject_loads_the_target_module():
  {==}

law operations_law_a_schema_subject_needs_no_target_execution:
  {request_operation(J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"schema"}, J.Jnil{}}}, J.Jnil{}}}) == "schemaValidation" : String}

def operations_law_a_schema_subject_needs_no_target_execution():
  {==}

law operations_law_an_entity_catalog_read_is_not_a_plan:
  {request_operation(J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"entity"}, J.Jnil{}}}, J.Jnil{}}}) == "catalogCapture" : String}

def operations_law_an_entity_catalog_read_is_not_a_plan():
  {==}

law operations_law_a_source_sql_selection_is_a_join:
  {request_operation(J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"}, J.Jnil{}}}, J.Jpair{"select", J.Jarr{J.Jstr{"databaseAccesses"}, J.Jnil{}}, J.Jnil{}}}) == "codeAccessJoin" : String}

def operations_law_a_source_sql_selection_is_a_join():
  {==}

law operations_law_an_ordinary_source_selection_is_analysis:
  {request_operation(J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"}, J.Jnil{}}}, J.Jpair{"select", J.Jarr{J.Jstr{"definition"}, J.Jnil{}}, J.Jnil{}}}) == "sourceAnalysis" : String}

def operations_law_an_ordinary_source_selection_is_analysis():
  {==}

law operations_law_runtime_observation_maps_to_its_operation:
  {runtime_operation_text("observe") == "runtimeObserve" : String}

def operations_law_runtime_observation_maps_to_its_operation():
  {==}

law operations_law_an_unknown_intent_selects_no_operation:
  {runtime_operation_text("breakpoint") == "" : String}

def operations_law_an_unknown_intent_selects_no_operation():
  {==}

law operations_law_query_control_recovery_maps_to_its_operation:
  {control_operation_text("recover") == "queryControlRecover" : String}

def operations_law_query_control_recovery_maps_to_its_operation():
  {==}

law operations_law_an_entity_declares_its_database_engine:
  {entity_database_engine(J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"entity"}, J.Jpair{"database", J.Jobj{J.Jpair{"engine", J.Jstr{"sqlite-schema"}, J.Jnil{}}}, J.Jnil{}}}, J.Jnil{}}}) == "sqlite-schema" : String}

def operations_law_an_entity_declares_its_database_engine():
  {==}

law operations_law_an_absent_database_engine_is_empty:
  {entity_database_engine(J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"entity"}, J.Jnil{}}}, J.Jnil{}}}) == "" : String}

def operations_law_an_absent_database_engine_is_empty():
  {==}

def print_operations(reqs: List<J.Json>) -> IO(Unit):
  match reqs:
    case Nil{}: IO.pure(Unit, Unit{})
    case head <> rest:
      do IO<Unit>:
        line : Unit <- IO.print(request_operation(head) ++ " " ++ request_projections(head) ++ " " ++ entity_database_engine(head))
        print_operations(rest)

def sample_requests() -> List<J.Json]:
  [J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"}, J.Jpair{"path", J.Jstr{"src/a.ts"}, J.Jnil{}}}, J.Jpair{"select", J.Jarr{J.Jstr{"definition"}, J.Jpair{J.Jstr{"calls"}, J.Jnil{}}}, J.Jnil{}}},
   J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"entity"}, J.Jpair{"database", J.Jobj{J.Jpair{"engine", J.Jstr{"postgres-schema"}, J.Jnil{}}}, J.Jnil{}}}, J.Jpair{"select", J.Jarr{J.Jstr{"codeAccesses"}, J.Jnil{}}, J.Jnil{}}},
   J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"runtime"}, J.Jpair{"intent", J.Jstr{"observe"}, J.Jnil{}}}, J.Jpair{"select", J.Jarr{J.Jstr{"state"}, J.Jnil{}}, J.Jnil{}}},
   J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"query-control"}, J.Jpair{"intent", J.Jstr{"release"}, J.Jnil{}}}, J.Jpair{"select", J.Jarr{J.Jstr{"state"}, J.Jnil{}}, J.Jnil{}}},
   J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"model"}, J.Jnil{}}}, J.Jpair{"select", J.Jarr{J.Jstr{"validation"}, J.Jnil{}}, J.Jnil{}}},
   J.Jobj{J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"schema"}, J.Jnil{}}}, J.Jpair{"select", J.Jarr{J.Jstr{"structure"}, J.Jnil{}}, J.Jpair{"options", J.Jobj{J.Jpair{"tools", J.Jobj{J.Jnil{}}, J.Jnil{}}}, J.Jnil{}}}, J.Jnil{}}]

def main() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print("operations")
    print_operations(sample_requests())
