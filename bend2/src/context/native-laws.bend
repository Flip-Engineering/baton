# Operative laws for the native selected-provider boundary.
import Base
import ./native.bend as Native
import ./engines-select.bend as Sel
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./native-request.bend as NativeRequest
import ./native-declaration.bend as NativeDeclaration
import ./engines.bend as Eng
import ../json/canonical.bend as J

def fixture_invocation() -> Sel.Invocation:
  Sel.Invocation{"2", "query-1", "owner-1",
    Sel.MBind{"bend2", "rev-1", "decl-sha", "2", "sourceAnalysis",
      Decl.ArtsNil{}, Eng.SSNil{}}, "{}", Sel.StepsNil{}, Sel.CapNil{},
    "worker", "incarnation-1"}

def source_request() -> J.Json:
  J.Jobj{J.Jpair{"version", J.Jint{1},
    J.Jpair{"subject", J.Jobj{J.Jpair{"kind", J.Jstr{"symbol"},
      J.Jpair{"path", J.Jstr{"src/main.bend"},
      J.Jpair{"name", J.Jstr{"main"}, J.Jnil{}}}}},
    J.Jpair{"select", J.Jarr{J.Jstr{"definition"}, J.Jnil{}},
    J.Jpair{"cwd", J.Jstr{"/repo"}, J.Jnil{}}}}}}

def source_request_decodes_to_selection_operands(decoded: NativeRequest.RequestDecode) -> Bool:
  match decoded:
    case NativeRequest.RequestDecoded{canonical, operands, operation_chain, cwd, source_path}:
      Bool.and(String.eq(Sel.req_subject(operands), "symbol"),
      Bool.and(Eng.ss_member(Sel.req_projections(operands), "definition"),
      Bool.and(String.eq(Sel.req_common(operands), "sourceAnalysis"),
      Bool.and(String.eq(cwd, "/repo"), String.eq(source_path, "src/main.bend")))))
    case NativeRequest.RequestDecodeRefused{condition}: False{}

law native_request_adapter_derives_selection_from_the_validated_request:
  {source_request_decodes_to_selection_operands(NativeRequest.request_validation(source_request())) == True{} : Bool}

def native_request_adapter_derives_selection_from_the_validated_request():
  {==}

law native_request_adapter_refuses_unknown_request_members:
  {NativeRequest.request_validation(J.Jobj{J.Jpair{"unexpected", J.Jnull{}, J.Jnil{}}}) == NativeRequest.RequestDecodeRefused{"unknownRequestField"} : NativeRequest.RequestDecode}

def native_request_adapter_refuses_unknown_request_members():
  {==}

def declaration_object() -> J.Json:
  J.Jobj{J.Jpair{"schema", J.Jstr{"baton2-native-module-declaration-v1"},
  J.Jpair{"moduleId", J.Jstr{"m1"},
  J.Jpair{"revision", J.Jstr{"r1"},
  J.Jpair{"protocolVersion", J.Jstr{"2"},
  J.Jpair{"packageIdentity", J.Jstr{"pkg-m1"},
  J.Jpair{"entry", J.Jobj{J.Jpair{"artifact", J.Jstr{"native-provider.mjs"},
    J.Jpair{"argv", J.Jarr{J.Jstr{"--experimental-strip-types"}, J.Jnil{}}, J.Jnil{}}}},
  J.Jpair{"artifactIdentities", J.Jarr{J.Jobj{J.Jpair{"packagePath", J.Jstr{"native-provider.mjs"},
    J.Jpair{"sha256", J.Jstr{"aa"}, J.Jpair{"role", J.Jstr{"provider"}, J.Jnil{}}}}, J.Jnil{}},
  J.Jpair{"dependencies", J.Jarr{J.Jnil{}, J.Jnil{}},
  J.Jpair{"schemaIdentities", J.Jarr{J.Jstr{"sub"}, J.Jarr{J.Jstr{"opt"}, J.Jarr{J.Jstr{"res"}, J.Jarr{J.Jstr{"ref"}, J.Jarr{J.Jstr{"evt"}, J.Jnil{}}}}}},
  J.Jpair{"applicability", J.Jarr{J.Jnil{}, J.Jnil{}},
  J.Jpair{"operations", J.Jarr{J.Jobj{J.Jpair{"schema", J.Jstr{"baton2-native-operation-v1"},
    J.Jpair{"operation", J.Jstr{"sourceAnalysis"},
    J.Jpair{"implements", J.Jstr{"sourceAnalysis"},
    J.Jpair{"subjectSchema", J.Jstr{"sub"}, J.Jpair{"optionsSchema", J.Jstr{"opt"},
    J.Jpair{"projections", J.Jarr{J.Jstr{"definition"}, J.Jnil{}},
    J.Jpair{"effects", J.Jarr{J.Jnil{}, J.Jnil{}},
    J.Jpair{"execution", J.Jstr{"managed"}, J.Jpair{"resultSchema", J.Jstr{"res"},
    J.Jpair{"referenceSchema", J.Jstr{"ref"}, J.Jpair{"eventSchema", J.Jstr{"evt"},
    J.Jpair{"lifetimeProfile", J.Jstr{""}, J.Jpair{"dependencies", J.Jarr{J.Jnil{}, J.Jnil{}}, J.Jnil{}}}}}}}}}}}}}, J.Jnil{}}, J.Jnil{}}}}}}}}}}

def expected_declaration() -> Decl.Decl:
  Decl.Decl{"1", "m1", "r1", "2", "pkg-m1",
    Decl.EProcess{Decl.Art{"native-provider.mjs", "aa", "entry"}, Eng.ss_one("--experimental-strip-types")},
    Decl.ArtsNil{},
    Decl.OpsCons{Decl.Op{"sourceAnalysis", "sourceAnalysis", "sub", "opt",
      Eng.ss_one("definition"), Eng.ss_empty(), Decl.ExManaged{}, "res", "ref", "evt", "", Decl.ModRefsNil{}},
      Decl.OpsNil{}}, Decl.RulesNil{}}

law installed_declaration_adapter_preserves_typed_module_contract_fields:
  {NativeDeclaration.decode(declaration_object(), "d1") == NativeDeclaration.DeclarationDecoded{
    expected_declaration(), Decl.Inv{Decl.ArtsCons{Decl.Art{"native-provider.mjs", "aa", "provider"}, Decl.ArtsNil{}},
      Eng.ss_of_list(["sub", "opt", "res", "ref", "evt"]),
      Decl.DigsCons{Decl.Dg{"m1", "d1"}, Decl.DigsNil{}}}} : NativeDeclaration.DeclarationDecode}

def installed_declaration_adapter_preserves_typed_module_contract_fields():
  {==}

law installed_declaration_adapter_refuses_missing_generic_schema_contract:
  {NativeDeclaration.decode(J.Jobj{J.Jnil{}}, "d1") == NativeDeclaration.DeclarationRefused{"nativeModuleDeclaration"} : NativeDeclaration.DeclarationDecode}

def installed_declaration_adapter_refuses_missing_generic_schema_contract():
  {==}

law native_invocation_frame_preserves_typed_v2_values:
  {Native.invocation_frame(fixture_invocation()) == Native.NativeFrameReady{
    "{\"version\":2,\"query\":\"query-1\",\"owner\":\"owner-1\",\"moduleBinding\":{\"artifactIdentities\":[],\"declarationDigest\":\"decl-sha\",\"id\":\"bend2\",\"operation\":\"sourceAnalysis\",\"protocolVersion\":\"2\",\"revision\":\"rev-1\",\"schemaIdentities\":[]},\"request\":{},\"inputIdentities\":[],\"operationPlan\":[],\"role\":\"worker\",\"incarnation\":\"incarnation-1\"}"} : Native.InvocationFrame}

def native_invocation_frame_preserves_typed_v2_values():
  {==}

law native_invocation_frame_refuses_another_protocol_version:
  {Native.invocation_frame(Sel.Invocation{"1", "q", "o",
    Sel.MBind{"bend2", "r", "d", "2", "sourceAnalysis", Decl.ArtsNil{}, Eng.SSNil{}},
    "{}", Sel.StepsNil{}, Sel.CapNil{}, "", ""}) ==
    Native.NativeFrameRefused{"invocationVersion"} : Native.InvocationFrame}

def native_invocation_frame_refuses_another_protocol_version():
  {==}

law native_installed_provider_path_uses_the_executable_install_prefix:
  {Native.installed_provider_path("/opt/baton2/bin/baton2") == "/opt/baton2/bin/../libexec/baton2/context-provider.mjs" : String}

def native_installed_provider_path_uses_the_executable_install_prefix():
  {==}

law native_engines_refuses_without_admission:
  for +db: String
  {Native.engines(db) == Native.unavailable("context-engines") : IO(Unit)}

def native_engines_refuses_without_admission(db):
  {==}

law native_query_file_refuses_without_admission:
  for +db: String
  for +owner: String
  for +query: String
  for +path: String
  {Native.query_file(db, owner, query, path) == Native.unavailable("context-query-file") : IO(Unit)}

def native_query_file_refuses_without_admission(db,owner,query,path):
  {==}

law native_result_refuses_without_admission:
  for +db: String
  for +query: String
  {Native.result(db, query) == Native.unavailable("context-result") : IO(Unit)}

def native_result_refuses_without_admission(db,query):
  {==}
