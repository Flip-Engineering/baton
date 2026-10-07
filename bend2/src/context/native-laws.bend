# Operative laws for the native selected-provider boundary.
import Base
import ./native.bend as Native
import ./engines-select.bend as Sel
import ./engines.bend as Eng
import ./engines-decl.bend as Decl
import ./native-request.bend as NativeRequest
import ./native-declaration.bend as NativeDeclaration
import ./native-runtime-laws.bend as NativeRuntimeLaws
import ./native-declaration-laws.bend as NativeDeclarationLaws
import ./native-project-policy-laws.bend as NativeProjectPolicyLaws
import ./service.bend as ContextService
import ./engines.bend as Eng
import ../json/canonical.bend as J
import ../host/process.bend as Process
import ../git/types.bend as G

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
    case NativeRequest.RequestDecoded{canonical, +operands, operation_chain, cwd, source_path}:
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

def declaration_operation_object() -> J.Json:
  NativeDeclarationLaws.obj(NativeDeclarationLaws.obj_pair("schema", J.Jstr{"baton2-native-operation-v1"},
  NativeDeclarationLaws.obj_pair("operation", J.Jstr{"sourceAnalysis"},
  NativeDeclarationLaws.obj_pair("implements", J.Jstr{"sourceAnalysis"},
  NativeDeclarationLaws.obj_pair("subjectSchema", J.Jstr{"sub"},
  NativeDeclarationLaws.obj_pair("optionsSchema", J.Jstr{"opt"},
  NativeDeclarationLaws.obj_pair("projections", J.Jarr{J.Jstr{"definition"}, J.Jnil{}},
  NativeDeclarationLaws.obj_pair("effects", NativeDeclarationLaws.empty_array(),
  NativeDeclarationLaws.obj_pair("execution", J.Jstr{"managed"},
  NativeDeclarationLaws.obj_pair("resultSchema", J.Jstr{"res"},
  NativeDeclarationLaws.obj_pair("referenceSchema", J.Jstr{"ref"},
  NativeDeclarationLaws.obj_pair("eventSchema", J.Jstr{"evt"},
  NativeDeclarationLaws.obj_pair("lifetimeProfile", J.Jstr{""},
  NativeDeclarationLaws.obj_pair("dependencies", NativeDeclarationLaws.empty_array(), J.Jnil{}))))))))))))))

def declaration_artifact_object() -> J.Json:
  NativeDeclarationLaws.obj(NativeDeclarationLaws.obj_pair("packagePath", J.Jstr{"native-provider.mjs"},
  NativeDeclarationLaws.obj_pair("sha256", J.Jstr{"aa"},
  NativeDeclarationLaws.obj_pair("role", J.Jstr{"provider"}, J.Jnil{}))))

def declaration_object_with_applicability(+applicability: J.Json) -> J.Json:
  NativeDeclarationLaws.obj(NativeDeclarationLaws.obj_pair("schema", J.Jstr{"baton2-native-module-declaration-v1"},
  NativeDeclarationLaws.obj_pair("moduleId", J.Jstr{"m1"},
  NativeDeclarationLaws.obj_pair("revision", J.Jstr{"r1"},
  NativeDeclarationLaws.obj_pair("protocolVersion", J.Jstr{"2"},
  NativeDeclarationLaws.obj_pair("packageIdentity", J.Jstr{"pkg-m1"},
  NativeDeclarationLaws.obj_pair("entry", NativeDeclarationLaws.obj(NativeDeclarationLaws.obj_pair("artifact", J.Jstr{"native-provider.mjs"},
    NativeDeclarationLaws.obj_pair("argv", J.Jarr{J.Jstr{"--experimental-strip-types"}, J.Jnil{}}, J.Jnil{}))),
  NativeDeclarationLaws.obj_pair("artifactIdentities", J.Jarr{declaration_artifact_object(), J.Jnil{}},
  NativeDeclarationLaws.obj_pair("dependencies", NativeDeclarationLaws.empty_array(),
  NativeDeclarationLaws.obj_pair("schemaIdentities", J.Jarr{J.Jstr{"sub"}, J.Jarr{J.Jstr{"opt"}, J.Jarr{J.Jstr{"res"}, J.Jarr{J.Jstr{"ref"}, J.Jarr{J.Jstr{"evt"}, J.Jnil{}}}}}},
  NativeDeclarationLaws.obj_pair("applicability", applicability,
  NativeDeclarationLaws.obj_pair("operations", J.Jarr{declaration_operation_object(), J.Jnil{}}, J.Jnil{}))))))))))))

def declaration_object() -> J.Json:
  declaration_object_with_applicability(NativeDeclarationLaws.empty_array())

def bend_suffix_rule() -> J.Json:
  NativeDeclarationLaws.obj(NativeDeclarationLaws.obj_pair("kind", J.Jstr{"pathSuffix"},
    NativeDeclarationLaws.obj_pair("value", J.Jstr{".bend"}, J.Jnil{})))

def expected_bend_suffix_declaration() -> Decl.Decl:
  Decl.Decl{"1", "m1", "r1", "2", "pkg-m1",
    Decl.EProcess{Decl.Art{"native-provider.mjs", "aa", "entry"}, Eng.ss_one("--experimental-strip-types")},
    Decl.ArtsNil{},
    Decl.OpsCons{Decl.Op{"sourceAnalysis", "sourceAnalysis", "sub", "opt",
      Eng.ss_one("definition"), Eng.ss_empty(), Decl.ExManaged{}, "res", "ref", "evt", "", Decl.ModRefsNil{}},
      Decl.OpsNil{}},
    Decl.RulesCons{Decl.RPathSuffix{".bend"}, Decl.RulesNil{}}}

law installed_declaration_adapter_decodes_generic_path_suffix_rule:
  {NativeDeclaration.decode(declaration_object_with_applicability(
      J.Jarr{bend_suffix_rule(), J.Jnil{}}), "d1") == NativeDeclaration.DeclarationDecoded{
    expected_bend_suffix_declaration(), Decl.Inv{Decl.ArtsCons{Decl.Art{"native-provider.mjs", "aa", "provider"}, Decl.ArtsNil{}},
      Eng.ss_of_list(["sub", "opt", "res", "ref", "evt"]),
      Decl.DigsCons{Decl.Dg{"m1", "d1"}, Decl.DigsNil{}}}} : NativeDeclaration.DeclarationDecode}

def installed_declaration_adapter_decodes_generic_path_suffix_rule():
  {==}

law installed_declaration_adapter_refuses_an_empty_path_suffix:
  {NativeDeclaration.decode(declaration_object_with_applicability(
      J.Jarr{
        NativeDeclarationLaws.obj(
          NativeDeclarationLaws.obj_pair("kind", J.Jstr{"pathSuffix"},
            NativeDeclarationLaws.obj_pair("value", J.Jstr{""}, J.Jnil{}))),
        J.Jnil{}}), "d1") ==
      NativeDeclaration.DeclarationRefused{"nativeModuleDeclaration"} : NativeDeclaration.DeclarationDecode}

def installed_declaration_adapter_refuses_an_empty_path_suffix():
  {==}

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

def native_primary_binding() -> Sel.MBind:
  Sel.MBind{"primary", "r1", "d1", "2", "sourceAnalysis", Decl.ArtsNil{}, Eng.SSNil{}}

def native_dependency_binding() -> Sel.MBind:
  Sel.MBind{"dependency", "r2", "d2", "2", "definition", Decl.ArtsNil{}, Eng.SSNil{}}

def native_step_plan() -> Sel.Plan:
  Sel.Plan{native_primary_binding(), "sourceAnalysis",
    Sel.StepsCons{Sel.Step{native_primary_binding(), "sourceAnalysis", Eng.SSNil{},
      Decl.ExManaged{}, Sel.StepRefsNil{}, "result-v1"},
      Sel.StepsCons{Sel.Step{native_dependency_binding(), "sourceAnalysis", Eng.SSNil{},
        Decl.ExManaged{}, Sel.StepRefsNil{}, "result-v1"}, Sel.StepsNil{}}},
    Eng.SSNil{}, Sel.CapNil{}, True{},
    Sel.ProjectPolicyMissing{"query-1", "/work", "/work/.baton/context.json"}}

law native_invocation_uses_the_named_dependency_step_binding:
  {Native.invocation_for_step(native_step_plan(), "dependency", "d2", "definition",
    "query-1", "owner-1", "{}", "", "") == Native.NativeStepFrame{
      Native.invocation_frame(Sel.Invocation{"2", "query-1", "owner-1",
        native_dependency_binding(), "{}",
        Sel.StepsCons{Sel.Step{native_primary_binding(), "sourceAnalysis", Eng.SSNil{},
          Decl.ExManaged{}, Sel.StepRefsNil{}, "result-v1"},
          Sel.StepsCons{Sel.Step{native_dependency_binding(), "sourceAnalysis", Eng.SSNil{},
            Decl.ExManaged{}, Sel.StepRefsNil{}, "result-v1"}, Sel.StepsNil{}}},
        Sel.CapNil{}, "", ""})} : Native.StepInvocationFrame}

def native_invocation_uses_the_named_dependency_step_binding():
  {==}

law native_invocation_refuses_a_step_absent_from_the_frozen_plan:
  {Native.invocation_for_step(native_step_plan(), "foreign", "d9", "definition",
    "query-1", "owner-1", "{}", "", "") ==
      Native.NativeStepRefused{"foreign", "d9", "definition"} : Native.StepInvocationFrame}

def native_invocation_refuses_a_step_absent_from_the_frozen_plan():
  {==}

law native_installed_provider_path_uses_the_executable_install_prefix:
  {Native.installed_provider_path("/opt/baton2/bin/baton2") == "/opt/baton2/bin/../libexec/baton2/context-provider.mjs" : String}

def native_installed_provider_path_uses_the_executable_install_prefix():
  {==}

law native_owner_workspace_sql_is_scoped_to_the_recorded_session:
  {Native.owner_workspace_sql("owner-1") == "SELECT workspace FROM sessions WHERE id='owner-1';" : String}

def native_owner_workspace_sql_is_scoped_to_the_recorded_session():
  {==}

law native_owner_workspace_parser_accepts_one_recorded_path:
  {Native.owner_workspace_lines(["/work/project"]) == Native.OwnerWorkspaceReady{"/work/project"} : Native.OwnerWorkspace}

def native_owner_workspace_parser_accepts_one_recorded_path():
  {==}

law native_owner_workspace_parser_refuses_surplus_session_fields:
  {Native.owner_workspace_fields(["/work/project", "other"]) == Native.OwnerWorkspaceRefused{"sessionWorkspaceShape"} : Native.OwnerWorkspace}

def native_owner_workspace_parser_refuses_surplus_session_fields():
  {==}

law native_request_cwd_must_resolve_to_the_owner_worktree_root:
  {Native.request_worktree_matches("/work/project", G.GRun{0, "/work/project\n"}) == True{} : Bool}

def native_request_cwd_must_resolve_to_the_owner_worktree_root():
  {==}

law native_request_cwd_refuses_a_different_worktree_root:
  {Native.request_worktree_matches("/work/project", G.GRun{0, "/other/project\n"}) == False{} : Bool}

def native_request_cwd_refuses_a_different_worktree_root():
  {==}

law native_inventory_invocation_uses_the_installed_wrapper:
  {Native.inventory_argv("/opt/node/bin/node", "/opt/baton2/bin/baton2") ==
    Process.argv(["/opt/node/bin/node", "--experimental-strip-types",
      "/opt/baton2/bin/../libexec/baton2/context-provider.mjs", "--inventory"]) : String}

def native_inventory_invocation_uses_the_installed_wrapper():
  {==}

law native_project_policy_invocation_uses_the_core_provider_entry:
  {Native.project_policy_argv("/opt/node/bin/node", "/opt/baton2/bin/baton2") ==
    Process.argv(["/opt/node/bin/node", "--experimental-strip-types",
      "/opt/baton2/bin/../libexec/baton2/context-provider.mjs", "--project-policy"]) : String}

def native_project_policy_invocation_uses_the_core_provider_entry():
  {==}

law native_project_policy_request_binds_only_owner_and_worktree:
  {Native.project_policy_request("owner-1", "/work/project") ==
    "{\"owner\":\"owner-1\",\"worktree\":\"/work/project\"}" : String}

def native_project_policy_request_binds_only_owner_and_worktree():
  {==}

def boundary_observation(status: String, owner: String, worktree: String,
                         query: String, path_key: String, path: String) -> J.Json:
  J.Jobj{NativeDeclarationLaws.obj_pair("status", J.Jstr{status},
  NativeDeclarationLaws.obj_pair("owner", J.Jstr{owner},
  NativeDeclarationLaws.obj_pair("worktree", J.Jstr{worktree},
  NativeDeclarationLaws.obj_pair("query", J.Jstr{query},
  NativeDeclarationLaws.obj_pair(path_key, J.Jstr{path}, J.Jnil{}))))) }

law native_source_identity_requires_the_bound_owner_and_worktree:
  {Native.query_source_json("owner-1", "/work/project",
    Native.ProjectPolicyJsonReady{boundary_observation("examined", "owner-1",
      "/work/project", "", "identity", "/work/project/src/main.bend")}) ==
    Native.BoundaryPathReady{"/work/project/src/main.bend"} : Native.BoundaryPath}

def native_source_identity_requires_the_bound_owner_and_worktree():
  {==}

law native_source_identity_refuses_a_foreign_owner:
  {Native.query_source_json("owner-1", "/work/project",
    Native.ProjectPolicyJsonReady{boundary_observation("examined", "owner-2",
      "/work/project", "", "identity", "/work/project/src/main.bend")}) ==
    Native.BoundaryPathRefused{"querySourceObservationMismatch"} : Native.BoundaryPath}

def native_source_identity_refuses_a_foreign_owner():
  {==}

law native_result_returns_the_retained_query_envelope:
  {Native.result_retained("query-1",
    ContextService.RetainedFound{"complete", "{\"version\":1,\"query\":\"query-1\"}"}) ==
    IO.write("{\"version\":1,\"query\":\"query-1\"}\n") : IO(Unit)}

def native_result_returns_the_retained_query_envelope():
  {==}

law native_result_refuses_an_absent_query:
  {Native.result_retained("query-absent", ContextService.RetainedAbsent{"query-absent"}) ==
    IO.die(Unit, 3, "contextResultAbsent:query-absent") : IO(Unit)}

def native_result_refuses_an_absent_query():
  {==}
