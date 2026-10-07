# Operative laws for the native declaration JSON adapter.
import Base
import ../json/canonical.bend as J
import ./native-declaration.bend as NativeDecl

def obj_pair(+name: String, +value: J.Json, +rest: J.Json) -> J.Json:
  J.Jpair{name, value, rest}

def obj(+members: J.Json) -> J.Json:
  J.Jobj{members}

def empty_array() -> J.Json:
  J.Jarr{J.Jnil{}, J.Jnil{}}

def operation_fixture() -> J.Json:
  obj(obj_pair("schema", J.Jstr{"baton2-native-operation-v1"},
  obj_pair("operation", J.Jstr{"sourceAnalysis"},
  obj_pair("implements", J.Jstr{"sourceAnalysis"},
  obj_pair("subjectSchema", J.Jstr{"subject-v1"},
  obj_pair("optionsSchema", J.Jstr{"options-v1"},
  obj_pair("referenceSchema", J.Jstr{"reference-v1"},
  obj_pair("resultSchema", J.Jstr{"result-v1"},
  obj_pair("eventSchema", J.Jstr{"event-v1"},
  obj_pair("projections", empty_array(),
  obj_pair("effects", empty_array(),
  obj_pair("dependencies", empty_array(),
  obj_pair("execution", J.Jstr{"managed"}, J.Jnil{})))))))))))))

def operation_list() -> J.Json:
  J.Jarr{operation_fixture(), J.Jnil{}}

def operation_list_well_formed() -> Bool:
  NativeDecl.operation_fields_valid(operation_list())

def empty_operation_list_refused() -> Bool:
  Bool.not(NativeDecl.operation_fields_valid(empty_array()))

law native_declaration_operation_with_json_array_terminator_is_accepted:
  {operation_list_well_formed() == True{} : Bool}

def native_declaration_operation_with_json_array_terminator_is_accepted():
  operation_list_well_formed()

law native_declaration_empty_operation_array_is_refused:
  {empty_operation_list_refused() == True{} : Bool}

def native_declaration_empty_operation_array_is_refused():
  empty_operation_list_refused()
