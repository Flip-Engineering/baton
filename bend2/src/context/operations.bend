# CLAIM: the operations a validated request selects are a pure function of the
# subject kind, its projections and its declared options, and a request-local tool
# override adds its own operation without replacing the subject's.
#
# The intent-to-operation table is not here: context-core owns it in
# `Eng.runtime_operation` and `Eng.query_control_operation`, and the closed
# operation vocabulary and every required-effect subset live in
# `Eng.required_effects(operation)` and `Eng.operation_known`. This module answers
# only what the request itself selects, so the caller composes:
#
#   subject operation = request_operation(req), or core's mapping of
#                       request_intent(req) when that answer is empty
#   extra operation   = override_operation(req)
#   required          = union(required_effects(each selected operation))
#
# An empty subject operation is not a refusal by itself; the codec's
# `dispatch_admission` refuses an empty composed operation explicitly.
#
# Serves: docs/bend2/semantic-context-spec.md, effects and operation selection.
# Fixture: the operations entry prints one line per sample request.
import Base
import ../json/canonical.bend as J
import ./request.bend as Req
import ./contracts.bend as Context

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
    case J.Jpair{key, value, rest}: J.Jnil{}
    case J.Jnil{}: J.Jnil{}

def or_nil(m: Maybe<&2, J.Json>) -> J.Json:
  match m:
    case None{}: J.Jnil{}
    case Some{value}: value

def text_or_empty(m: Maybe<&2, J.Json>) -> String:
  match m:
    case None{}: SNil{}
    case Some{value}: Req.text_of(value)

def member_text(+members: J.Json, key: String) -> String:
  text_or_empty(Req.member_lookup(key, members))

def request_members(+req: J.Json) -> J.Json:
  obj_members(req)

def subject_value(+req: J.Json) -> J.Json:
  or_nil(Req.member_lookup("subject", request_members(req)))

def subject_members(+req: J.Json) -> J.Json:
  obj_members(subject_value(req))

def subject_field(+req: J.Json, key: String) -> String:
  member_text(subject_members(req), key)

def select_value(+req: J.Json) -> J.Json:
  or_nil(Req.member_lookup("select", request_members(req)))

def options_members(+req: J.Json) -> J.Json:
  obj_members(or_nil(Req.member_lookup("options", request_members(req))))

# ---------------------------------------------------------------------------
# The request fields context-core consumes.

def request_subject_kind(+req: J.Json) -> String:
  subject_field(req, "kind")

def request_intent(+req: J.Json) -> String:
  subject_field(req, "intent")

def source_path(+req: J.Json) -> String:
  subject_field(req, "path")

def entity_database_engine(+req: J.Json) -> String:
  database_engine(Req.member_lookup("database", subject_members(req)))

def database_engine(m: Maybe<&2, J.Json>) -> String:
  match m:
    case None{}: SNil{}
    case Some{value}: member_text(obj_members(value), "engine")

def request_projections(+req: J.Json) -> String:
  join_projections(select_value(req), True{}, SNil{})

def join_projections(+j: J.Json, first: Bool, +acc: String) -> String:
  match j:
    case J.Jarr{+head, +tail}:
      join_projections(tail, False{}, acc ++ Bool.pick(String, first, SNil{}, ",") ++ Req.text_of(head))
    case J.Jpair{key, value, rest}: acc
    case J.Jnil{}: acc
    case J.Jnull{}: acc
    case J.Jtrue{}: acc
    case J.Jfalse{}: acc
    case J.Jint{+value}: acc
    case J.Jstr{+value}: acc
    case J.Jobj{+members}: acc

def selected_name(+j: J.Json, +name: String) -> Bool:
  match j:
    case J.Jarr{+head, +tail}:
      Bool.pick(Bool, String.eq(Req.text_of(head), name), True{}, selected_name(tail, name))
    case J.Jpair{key, value, rest}: False{}
    case J.Jnil{}: False{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{+value}: False{}
    case J.Jstr{+value}: False{}
    case J.Jobj{+members}: False{}

def projection_selected(+req: J.Json, +name: String) -> Bool:
  selected_name(select_value(req), name)

# ---------------------------------------------------------------------------
# The selected operations.

def source_operation(+req: J.Json) -> String:
  Bool.pick(String, projection_selected(req, "databaseAccesses"), "codeAccessJoin", "sourceAnalysis")

def entity_operation(+req: J.Json) -> String:
  Bool.pick(String, projection_selected(req, "codeAccesses"), "codeAccessJoin", "catalogCapture")

# The operation the subject and its projections select. A runtime or
# query-control subject answers the empty string here on purpose: core maps its
# intent. `ref` also answers empty, because core's retained-ref admission decides
# the expansion.
def subject_operation(+kind: String, +req: J.Json) -> String:
  match kind:
    case "model": "modelLoad"
    case "security": "sourceAnalysis"
    case "schema": "schemaValidation"
    case "dataset": "datasetRead"
    case "program": "environmentRead"
    case "migration": "migrationReplay"
    case "entity": entity_operation(req)
    case "position": source_operation(req)
    case "symbol": source_operation(req)
    case "diagnostic": source_operation(req)
    case other: SNil{}

def request_operation(+req: J.Json) -> String:
  subject_operation(request_subject_kind(req), req)

# A model request that also selects codeAccesses needs the source join as well as
# the module load, so both obligations apply. Every other subject contributes no
# second operation.
def subject_secondary(+req: J.Json) -> String:
  secondary_of(request_subject_kind(req), req)

def secondary_of(+kind: String, +req: J.Json) -> String:
  Bool.pick(String, String.eq(kind, "model"),
    Bool.pick(String, projection_selected(req, "codeAccesses"), "codeAccessJoin", SNil{}), SNil{})

# A request-local tools override is target execution and is its own operation. It
# adds to the subject's obligation; it never replaces it, because the requested
# work still executes.
def request_override_operation(+req: J.Json) -> String:
  Bool.pick(String, tool_override(req), "toolsProbe", SNil{})

def tool_override(+req: J.Json) -> Bool:
  Req.present_of(Req.member_lookup("tools", options_members(req)))

# ---------------------------------------------------------------------------
# Sample construction. The helpers keep the canonical constructor arities in one
# place: an array cell is `Jarr{element, rest}` ending in `Jnil`, and an object is
# a `Jpair` chain ending in `Jnil`.

def arr1(a: J.Json) -> J.Json:
  J.Jarr{a, J.Jnil{}}

def arr2(a: J.Json, b: J.Json) -> J.Json:
  J.Jarr{a, J.Jarr{b, J.Jnil{}}}

def obj1(k1: String, v1: J.Json) -> J.Json:
  J.Jobj{J.Jpair{k1, v1, J.Jnil{}}}

def obj2(k1: String, v1: J.Json, k2: String, v2: J.Json) -> J.Json:
  J.Jobj{J.Jpair{k1, v1, J.Jpair{k2, v2, J.Jnil{}}}}

def obj3(k1: String, v1: J.Json, k2: String, v2: J.Json, k3: String, v3: J.Json) -> J.Json:
  J.Jobj{J.Jpair{k1, v1, J.Jpair{k2, v2, J.Jpair{k3, v3, J.Jnil{}}}}}

def kind_only(kind: String) -> J.Json:
  obj1("kind", J.Jstr{kind})

def subject_with_select(subject: J.Json, select: J.Json) -> J.Json:
  obj2("subject", subject, "select", select)

def empty_object() -> J.Json:
  J.Jobj{J.Jnil{}}

def sample_requests() -> List<J.Json>:
  [
    subject_with_select(obj2("kind", J.Jstr{"symbol"}, "path", J.Jstr{"src/a.ts"}), arr2(J.Jstr{"definition"}, J.Jstr{"calls"})),
    subject_with_select(obj2("kind", J.Jstr{"entity"}, "database", obj1("engine", J.Jstr{"postgres-schema"})), arr1(J.Jstr{"codeAccesses"})),
    subject_with_select(kind_only("schema"), arr1(J.Jstr{"structure"})),
    subject_with_select(kind_only("model"), arr1(J.Jstr{"validation"})),
    subject_with_select(kind_only("runtime"), arr1(J.Jstr{"state"})),
    obj2("subject", kind_only("program"), "select", arr1(J.Jstr{"dependencies"}))
  ]

def override_requests() -> List<J.Json>:
  [
    obj3("subject", kind_only("program"), "select", arr1(J.Jstr{"dependencies"}), "options", obj1("tools", empty_object())),
    subject_with_select(kind_only("schema"), arr1(J.Jstr{"structure"}))
  ]

def render(+req: J.Json) -> String:
  request_operation(req) ++ "|" ++ request_override_operation(req) ++ "|" ++ request_projections(req) ++ "|" ++ entity_database_engine(req)

def print_requests(reqs: List<J.Json>) -> IO(Unit):
  match reqs:
    case Nil{}: IO.pure(Unit, Unit{})
    case +head <> rest:
      do IO<Unit>:
        line : Unit <- IO.print(render(head))
        print_requests(rest)

law operations_law_a_model_subject_loads_the_target_module:
  {request_operation(obj1("subject", kind_only("model"))) == "modelLoad" : String}

def operations_law_a_model_subject_loads_the_target_module():
  {==}

law operations_law_a_schema_subject_needs_no_target_execution:
  {request_operation(obj1("subject", kind_only("schema"))) == "schemaValidation" : String}

def operations_law_a_schema_subject_needs_no_target_execution():
  {==}

law operations_law_an_entity_catalog_read_is_not_a_plan:
  {request_operation(obj1("subject", kind_only("entity"))) == "catalogCapture" : String}

def operations_law_an_entity_catalog_read_is_not_a_plan():
  {==}

law operations_law_a_source_sql_selection_is_a_join:
  {request_operation(subject_with_select(kind_only("symbol"), arr1(J.Jstr{"databaseAccesses"}))) == "codeAccessJoin" : String}

def operations_law_a_source_sql_selection_is_a_join():
  {==}

law operations_law_an_ordinary_source_selection_is_analysis:
  {request_operation(subject_with_select(kind_only("symbol"), arr1(J.Jstr{"definition"}))) == "sourceAnalysis" : String}

def operations_law_an_ordinary_source_selection_is_analysis():
  {==}

law operations_law_a_runtime_subject_leaves_its_intent_to_core:
  {request_operation(subject_with_select(kind_only("runtime"), arr1(J.Jstr{"state"}))) == "" : String}

def operations_law_a_runtime_subject_leaves_its_intent_to_core():
  {==}

law operations_law_a_runtime_subject_reports_its_intent:
  {request_intent(subject_with_select(obj2("kind", J.Jstr{"runtime"}, "intent", J.Jstr{"observe"}), arr1(J.Jstr{"state"}))) == "observe" : String}

def operations_law_a_runtime_subject_reports_its_intent():
  {==}

law operations_law_a_ref_subject_leaves_expansion_to_core:
  {request_operation(subject_with_select(kind_only("ref"), arr1(J.Jstr{"definition"}))) == "" : String}

def operations_law_a_ref_subject_leaves_expansion_to_core():
  {==}

law operations_law_a_tool_override_adds_its_own_operation:
  {request_override_operation(obj3("subject", kind_only("program"), "select", arr1(J.Jstr{"dependencies"}), "options", obj1("tools", empty_object()))) == "toolsProbe" : String}

def operations_law_a_tool_override_adds_its_own_operation():
  {==}

law operations_law_an_absent_tool_override_adds_no_operation:
  {request_override_operation(subject_with_select(kind_only("schema"), arr1(J.Jstr{"structure"}))) == "" : String}

def operations_law_an_absent_tool_override_adds_no_operation():
  {==}

law operations_law_a_tool_override_keeps_the_subject_operation:
  {request_operation(obj3("subject", kind_only("program"), "select", arr1(J.Jstr{"dependencies"}), "options", obj1("tools", empty_object()))) == "environmentRead" : String}

def operations_law_a_tool_override_keeps_the_subject_operation():
  {==}

law operations_law_a_model_code_access_needs_the_module_load:
  {request_operation(obj2("subject", kind_only("model"), "select", arr1(J.Jstr{"codeAccesses"}))) == "modelLoad" : String}

def operations_law_a_model_code_access_needs_the_module_load():
  {==}

law operations_law_a_model_code_access_also_needs_the_join:
  {subject_secondary(obj2("subject", kind_only("model"), "select", arr1(J.Jstr{"codeAccesses"}))) == "codeAccessJoin" : String}

def operations_law_a_model_code_access_also_needs_the_join():
  {==}

law operations_law_a_model_without_code_access_needs_only_the_load:
  {subject_secondary(obj2("subject", kind_only("model"), "select", arr1(J.Jstr{"validation"}))) == "" : String}

def operations_law_a_model_without_code_access_needs_only_the_load():
  {==}

law operations_law_a_security_subject_is_source_analysis:
  {request_operation(obj2("subject", kind_only("security"), "select", arr1(J.Jstr{"declaration"}))) == "sourceAnalysis" : String}

def operations_law_a_security_subject_is_source_analysis():
  {==}

law operations_law_an_entity_declares_its_database_engine:
  {entity_database_engine(obj1("subject", obj2("kind", J.Jstr{"entity"}, "database", obj1("engine", J.Jstr{"sqlite-schema"})))) == "sqlite-schema" : String}

def operations_law_an_entity_declares_its_database_engine():
  {==}

law operations_law_an_absent_database_engine_is_empty:
  {entity_database_engine(obj1("subject", kind_only("entity"))) == "" : String}

def operations_law_an_absent_database_engine_is_empty():
  {==}

law operations_law_projections_join_in_request_order:
  {request_projections(subject_with_select(kind_only("symbol"), arr2(J.Jstr{"definition"}, J.Jstr{"calls"}))) == "definition,calls" : String}

def operations_law_projections_join_in_request_order():
  {==}

def main() -> IO(Unit):
  do IO<Unit>:
    a : Unit <- IO.print("subject")
    b : Unit <- print_requests(sample_requests())
    c : Unit <- IO.print("override")
    print_requests(override_requests())
