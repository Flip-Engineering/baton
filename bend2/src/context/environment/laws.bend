# Operative laws of the environment context module. Each law is stated over
# the function that implements it and proved beside its claim, so a compile of
# this module refuses a law the implementation does not satisfy.
#
# These laws bind the structural allowlist, the Node manifest/lock/tree
# producers, the TypeScript configuration chain, the C compile-command reducer
# and the JSON Compose topology reader. Host truth (real child processes, real
# files) is exercised by the environment test entry, not by these laws.
#
# Reference: docs/bend2/semantic-context-spec.md, Laws and acceptance; the
# environment tool-override fixture writes a harmless marker before emitting a
# version, so admission ordering is host-tested.

import Base
import ../../json/canonical.bend as J
import ../../host/process.bend as P
import ./allowlist.bend as A
import ./tools.bend as T
import ./tsconfig.bend as TS
import ./facts.bend as F

# --- the version grammar -----------------------------------------------------

law version_token_accepts_three_parts:
  {A.version_token("1.2.3") == True{} : Bool}

def version_token_accepts_three_parts():
  {==}

law version_token_accepts_v_prefix:
  {A.version_token("v5.9.3") == True{} : Bool}

def version_token_accepts_v_prefix():
  {==}

law version_token_accepts_prerelease_and_build:
  {A.version_token("20.1.8-beta.1+build.5") == True{} : Bool}

def version_token_accepts_prerelease_and_build():
  {==}

law version_token_accepts_two_parts:
  {A.version_token("1.2") == True{} : Bool}

def version_token_accepts_two_parts():
  {==}

law version_token_refuses_a_trailing_dot:
  {A.version_token("1.2.") == False{} : Bool}

def version_token_refuses_a_trailing_dot():
  {==}

law version_token_refuses_a_leading_dot:
  {A.version_token(".1") == False{} : Bool}

def version_token_refuses_a_leading_dot():
  {==}

law version_token_refuses_an_empty_component:
  {A.version_token("1..2") == False{} : Bool}

def version_token_refuses_an_empty_component():
  {==}

law version_token_refuses_a_tag:
  {A.version_token("latest") == False{} : Bool}

def version_token_refuses_a_tag():
  {==}

law version_token_refuses_a_credential_url:
  {A.version_token("postgres://user:pw@host/db") == False{} : Bool}

def version_token_refuses_a_credential_url():
  {==}

# --- the declared range grammar ---------------------------------------------

law range_token_accepts_caret:
  {A.range_token("^1.2.3") == True{} : Bool}

def range_token_accepts_caret():
  {==}

law range_token_accepts_a_comparator_set:
  {A.range_token(">=1.0.0 <2.0.0") == True{} : Bool}

def range_token_accepts_a_comparator_set():
  {==}

law range_token_accepts_a_union:
  {A.range_token("^1.2.3 || ~2.0.0") == True{} : Bool}

def range_token_accepts_a_union():
  {==}

law range_token_accepts_a_tag:
  {A.range_token("latest") == True{} : Bool}

def range_token_accepts_a_tag():
  {==}

law range_token_refuses_a_local_path_spec:
  {A.range_token("file:../private") == False{} : Bool}

def range_token_refuses_a_local_path_spec():
  {==}

law range_token_refuses_a_leading_union:
  {A.range_token("|| ^1.2.3") == False{} : Bool}

def range_token_refuses_a_leading_union():
  {==}

law range_token_refuses_a_trailing_union:
  {A.range_token("^1.2.3 ||") == False{} : Bool}

def range_token_refuses_a_trailing_union():
  {==}

law range_token_refuses_a_repeated_union:
  {A.range_token("^1.2.3 || || ^2.0.0") == False{} : Bool}

def range_token_refuses_a_repeated_union():
  {==}

law range_token_refuses_a_bare_operator:
  {A.range_token(">=") == False{} : Bool}

def range_token_refuses_a_bare_operator():
  {==}

# --- key names, paths, enums, numbers ---------------------------------------

law key_name_accepts_an_environment_key:
  {A.key_name("DATABASE_URL") == True{} : Bool}

def key_name_accepts_an_environment_key():
  {==}

law key_name_refuses_a_key_with_a_value:
  {A.key_name("DATABASE_URL=postgres://u:p@h/db") == False{} : Bool}

def key_name_refuses_a_key_with_a_value():
  {==}

law key_name_refuses_a_leading_digit:
  {A.key_name("1TOKEN") == False{} : Bool}

def key_name_refuses_a_leading_digit():
  {==}

law number_token_accepts_a_decimal:
  {A.number_token("8080") == True{} : Bool}

def number_token_accepts_a_decimal():
  {==}

law number_token_refuses_a_fraction:
  {A.number_token("1.5") == False{} : Bool}

def number_token_refuses_a_fraction():
  {==}

law number_token_refuses_a_sign:
  {A.number_token("-1") == False{} : Bool}

def number_token_refuses_a_sign():
  {==}

law number_token_refuses_exponent_notation:
  {A.number_token("1e3") == False{} : Bool}

def number_token_refuses_exponent_notation():
  {==}

law path_field_accepts_an_absolute_path:
  {A.path_field("/work/application/src") == True{} : Bool}

def path_field_accepts_an_absolute_path():
  {==}

law path_field_accepts_a_path_with_a_space:
  {A.path_field("/work/my application/src") == True{} : Bool}

def path_field_accepts_a_path_with_a_space():
  {==}

law path_field_refuses_a_control_character:
  {A.path_field("src\nhandler.ts") == False{} : Bool}

def path_field_refuses_a_control_character():
  {==}

# --- the decision over a kind ------------------------------------------------

law version_kind_admits_a_version:
  {A.admit_str(A.KVersion{}, "1.2.3") == A.Admit{} : A.Admission}

def version_kind_admits_a_version():
  {==}

law version_kind_refuses_a_neutral_named_token:
  {A.admit_str(A.KVersion{}, "ANALYTICS_TICKET") == A.Reject{"not-a-version-token"} : A.Admission}

def version_kind_refuses_a_neutral_named_token():
  {==}

law version_kind_refuses_a_credential_uri:
  {A.admit_str(A.KVersion{}, "postgres://user:pw@host/db") == A.Reject{"not-a-version-token"} : A.Admission}

def version_kind_refuses_a_credential_uri():
  {==}

law key_kind_admits_a_key_name:
  {A.admit_str(A.KKey{}, "DATABASE_URL") == A.Admit{} : A.Admission}

def key_kind_admits_a_key_name():
  {==}

law key_kind_refuses_a_value:
  {A.admit_str(A.KKey{}, "postgres://user:pw@host/db") == A.Reject{"not-a-key-name"} : A.Admission}

def key_kind_refuses_a_value():
  {==}

law string_is_never_a_boolean_option:
  {A.admit_str(A.KBool{}, "true") == A.Reject{"string-not-admitted-for-kind"} : A.Admission}

def string_is_never_a_boolean_option():
  {==}

law number_kind_admits_a_decimal_token:
  {A.admit_num(A.KNumber{}, "8080") == A.Admit{} : A.Admission}

def number_kind_admits_a_decimal_token():
  {==}

law number_kind_refuses_exponent_notation:
  {A.admit_num(A.KNumber{}, "1e3") == A.Reject{"not-a-decimal-number"} : A.Admission}

def number_kind_refuses_exponent_notation():
  {==}

law version_kind_refuses_a_number:
  {A.admit_num(A.KVersion{}, "1") == A.Reject{"number-not-admitted-for-kind"} : A.Admission}

def version_kind_refuses_a_number():
  {==}

law boolean_kind_admits_a_boolean:
  {A.admit_bool(A.KBool{}, True{}) == A.Admit{} : A.Admission}

def boolean_kind_admits_a_boolean():
  {==}

law presence_kind_admits_a_boolean:
  {A.admit_bool(A.KPresence{}, False{}) == A.Admit{} : A.Admission}

def presence_kind_admits_a_boolean():
  {==}

law number_kind_refuses_a_boolean:
  {A.admit_bool(A.KNumber{}, True{}) == A.Reject{"boolean-not-admitted-for-kind"} : A.Admission}

def number_kind_refuses_a_boolean():
  {==}

# --- the decision over a JSON value -----------------------------------------

law freeform_field_admits_no_value:
  {A.admit_value(A.SpecNone{"no-automatic-value-field"}, J.Jstr{"anything"}) == A.Reject{"no-automatic-value-field"} : A.Admission}

def freeform_field_admits_no_value():
  {==}

law scalar_field_admits_its_matching_string:
  {A.admit_value(A.SpecScalar{A.KVersion{}}, J.Jstr{"1.2.3"}) == A.Admit{} : A.Admission}

def scalar_field_admits_its_matching_string():
  {==}

law scalar_field_refuses_a_container:
  {A.admit_value(A.SpecScalar{A.KPath{}}, J.Jobj{J.Jpair{"a", J.Jint{1}, J.Jnil{}}}) == A.Reject{"container-is-not-a-scalar"} : A.Admission}

def scalar_field_refuses_a_container():
  {==}

law scalar_field_refuses_a_missing_value:
  {A.admit_value(A.SpecScalar{A.KPath{}}, J.Jnil{}) == A.Reject{"missing-value"} : A.Admission}

def scalar_field_refuses_a_missing_value():
  {==}

law list_field_admits_every_matching_element:
  {A.admit_value(A.SpecList{A.KPath{}}, J.Jarr{J.Jstr{"/sdk"}, J.Jarr{J.Jstr{"/src"}, J.Jnil{}}}) == A.Admit{} : A.Admission}

def list_field_admits_every_matching_element():
  {==}

law list_field_refuses_a_mismatched_element:
  {A.admit_value(A.SpecList{A.KPath{}}, J.Jarr{J.Jstr{"/sdk"}, J.Jarr{J.Jint{7}, J.Jnil{}}}) == A.Reject{"number-not-admitted-for-kind"} : A.Admission}

def list_field_refuses_a_mismatched_element():
  {==}

law list_field_refuses_a_scalar:
  {A.admit_value(A.SpecList{A.KPath{}}, J.Jstr{"/sdk"}) == A.Reject{"expected-list"} : A.Admission}

def list_field_refuses_a_scalar():
  {==}

law an_empty_list_is_admitted:
  {A.admit_value(A.SpecList{A.KPath{}}, J.Jarr{J.Jnil{}, J.Jnil{}}) == A.Admit{} : A.Admission}

def an_empty_list_is_admitted():
  {==}

# --- per-field option sets ---------------------------------------------------

law enum_field_admits_a_listed_option:
  {A.admit_value(A.SpecEnum{A.NameCons{"es2022", A.NameCons{"esnext", A.NameNil{}}}}, J.Jstr{"es2022"}) == A.Admit{} : A.Admission}

def enum_field_admits_a_listed_option():
  {==}

law enum_field_refuses_an_unlisted_option:
  {A.admit_value(A.SpecEnum{A.NameCons{"es2022", A.NameCons{"esnext", A.NameNil{}}}}, J.Jstr{"bogus"}) == A.Reject{"not-an-allowed-option-value"} : A.Admission}

def enum_field_refuses_an_unlisted_option():
  {==}

law enum_field_refuses_a_number:
  {A.admit_value(A.SpecEnum{A.NameCons{"es2022", A.NameNil{}}}, J.Jint{2022}) == A.Reject{"enum-value-must-be-a-string"} : A.Admission}

def enum_field_refuses_a_number():
  {==}

law enum_list_field_admits_listed_elements:
  {A.admit_value(A.SpecEnumList{A.NameCons{"dom", A.NameCons{"es2022", A.NameNil{}}}}, J.Jarr{J.Jstr{"es2022"}, J.Jarr{J.Jstr{"dom"}, J.Jnil{}}}) == A.Admit{} : A.Admission}

def enum_list_field_admits_listed_elements():
  {==}

law enum_list_field_refuses_an_unlisted_element:
  {A.admit_value(A.SpecEnumList{A.NameCons{"dom", A.NameCons{"es2022", A.NameNil{}}}}, J.Jarr{J.Jstr{"es2022"}, J.Jarr{J.Jstr{"webworker"}, J.Jnil{}}}) == A.Reject{"not-an-allowed-option-value"} : A.Admission}

def enum_list_field_refuses_an_unlisted_element():
  {==}

# --- the tool-probe plan -----------------------------------------------------

law request_override_refuses_without_the_grant:
  {T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", False{}}) == T.PRefused{"request-local-tool-override-requires-executeTarget"} : T.ProbePlan}

def request_override_refuses_without_the_grant():
  {==}

law request_override_naming_the_deployment_path_refuses_without_the_grant:
  {T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", False{}}) == T.PRefused{"request-local-tool-override-requires-executeTarget"} : T.ProbePlan}

def request_override_naming_the_deployment_path_refuses_without_the_grant():
  {==}

law request_override_with_the_grant_plans_the_version_probe:
  {T.plan_probe(T.RequestOverride{"node", "/opt/providers/node", True{}}) == T.PReady{P.argv(["/opt/providers/node", "--version"]), "/opt/providers/node", "toolsProbe", True{}} : T.ProbePlan}

def request_override_with_the_grant_plans_the_version_probe():
  {==}

law deployment_tool_plans_the_version_probe:
  {T.plan_probe(T.DeploymentTool{"node", "/opt/providers/node"}) == T.PReady{P.argv(["/opt/providers/node", "--version"]), "/opt/providers/node", "toolsProbe", False{}} : T.ProbePlan}

def deployment_tool_plans_the_version_probe():
  {==}

law probe_env_names_are_the_constructed_set:
  {T.probe_env_names() == A.NameCons{"PATH", A.NameCons{"HOME", A.NameCons{"TMPDIR", A.NameCons{"LC_ALL", A.NameNil{}}}}} : A.Names}

def probe_env_names_are_the_constructed_set():
  {==}

law marker_path_names_the_fixture_marker:
  {T.marker_path("/tmp/ctx", "node") == "/tmp/ctx/node.marker" : String}

def marker_path_names_the_fixture_marker():
  {==}

law version_text_reads_a_v_prefixed_token:
  {T.version_text("node v25.8.0\n") == "v25.8.0" : String}

def version_text_reads_a_v_prefixed_token():
  {==}

law version_text_reads_a_named_version:
  {T.version_text("bend 2.0.25\n") == "2.0.25" : String}

def version_text_reads_a_named_version():
  {==}

law version_text_reads_a_version_after_a_word:
  {T.version_text("Homebrew clang version 20.1.8") == "20.1.8" : String}

def version_text_reads_a_version_after_a_word():
  {==}

law version_text_refuses_output_without_a_version:
  {T.version_text("no version here") == "" : String}

def version_text_refuses_output_without_a_version():
  {==}

law tool_fact_carries_the_probe_result:
  {T.tool_fact("node", "/opt/providers/node", "v25.8.0\n") == T.ToolResolved{"node", "/opt/providers/node", "v25.8.0"} : T.ToolFact}

def tool_fact_carries_the_probe_result():
  {==}

law tool_fact_without_a_version_is_unavailable:
  {T.tool_fact("node", "/opt/providers/node", "no version here") == T.ToolUnavailable{"node", "/opt/providers/node", "no-version-token-in-probe-output"} : T.ToolFact}

def tool_fact_without_a_version_is_unavailable():
  {==}

# --- the TypeScript option table ---------------------------------------------

law target_option_is_an_explicit_value_set:
  {TS.option_spec("target") == A.SpecEnum{TS.target_values()} : A.Spec}

def target_option_is_an_explicit_value_set():
  {==}

law target_option_admits_a_listed_value:
  {TS.option_admission("target", J.Jstr{"es2022"}) == A.Admit{} : A.Admission}

def target_option_admits_a_listed_value():
  {==}

law target_option_refuses_an_unlisted_value:
  {TS.option_admission("target", J.Jstr{"bogus"}) == A.Reject{"not-an-allowed-option-value"} : A.Admission}

def target_option_refuses_an_unlisted_value():
  {==}

law strict_option_is_a_boolean:
  {TS.option_spec("strict") == A.SpecScalar{A.KBool{}} : A.Spec}

def strict_option_is_a_boolean():
  {==}

law paths_option_is_a_path_list:
  {TS.option_spec("paths") == A.SpecList{A.KPath{}} : A.Spec}

def paths_option_is_a_path_list():
  {==}

law defines_is_not_a_recognized_option:
  {TS.option_spec("defines") == A.SpecNone{"unrecognized-compiler-option"} : A.Spec}

def defines_is_not_a_recognized_option():
  {==}

law maximal_option_count_is_a_number:
  {TS.option_spec("maxNodeModuleJsDepth") == A.SpecScalar{A.KNumber{}} : A.Spec}

def maximal_option_count_is_a_number():
  {==}

law extends_string_form_yields_one_specifier:
  {TS.extends_specifiers(J.Jobj{J.Jpair{"extends", J.Jstr{"./base.json"}, J.Jnil{}}}) == A.WordCons{"./base.json", A.WordNil{}} : A.Words}

def extends_string_form_yields_one_specifier():
  {==}

law extends_array_form_keeps_written_order:
  {TS.extends_specifiers(J.Jobj{J.Jpair{"extends", J.Jarr{J.Jstr{"a.json"}, J.Jarr{J.Jstr{"b.json"}, J.Jnil{}}}, J.Jnil{}}}) == A.WordCons{"a.json", A.WordCons{"b.json", A.WordNil{}}} : A.Words}

def extends_array_form_keeps_written_order():
  {==}

law absent_extends_yields_no_specifier:
  {TS.extends_specifiers(J.Jobj{J.Jpair{"strict", J.Jtrue{}, J.Jnil{}}}) == A.WordNil{} : A.Words}

def absent_extends_yields_no_specifier():
  {==}

law child_definition_makes_the_child_entry_effective:
  {TS.effective_value(TS.CfgCons{J.Jobj{J.Jpair{"compilerOptions", J.Jobj{J.Jpair{"target", J.Jstr{"es2019"}, J.Jnil{}}}, J.Jnil{}}, "/w/base.json", TS.CfgCons{J.Jobj{J.Jpair{"compilerOptions", J.Jobj{J.Jpair{"target", J.Jstr{"es2022"}, J.Jnil{}}}, J.Jnil{}}, "/w/tsconfig.json", TS.CfgNil{}}}, "target") == J.Jstr{"es2022"} : J.Json}

def child_definition_makes_the_child_entry_effective():
  {==}

law base_definition_is_effective_when_the_child_does_not_set_it:
  {TS.effective_value(TS.CfgCons{J.Jobj{J.Jpair{"compilerOptions", J.Jobj{J.Jpair{"target", J.Jstr{"es2019"}, J.Jnil{}}}, J.Jnil{}}, "/w/base.json", TS.CfgCons{J.Jobj{J.Jnil{}, "/w/tsconfig.json", TS.CfgNil{}}}, "target") == J.Jstr{"es2019"} : J.Json}

def base_definition_is_effective_when_the_child_does_not_set_it():
  {==}

law absent_option_has_no_effective_value:
  {TS.effective_value(TS.CfgCons{J.Jobj{J.Jnil{}, "/w/tsconfig.json", TS.CfgNil{}}, "target") == J.Jnil{} : J.Json}

def absent_option_has_no_effective_value():
  {==}

law chain_paths_lists_every_file_in_order:
  {TS.chain_paths(TS.CfgCons{J.Jobj{J.Jnil{}, "/w/base.json", TS.CfgCons{J.Jobj{J.Jnil{}, "/w/tsconfig.json", TS.CfgNil{}}}, A.WordNil{}) == A.WordCons{"/w/base.json", A.WordCons{"/w/tsconfig.json", A.WordNil{}}} : A.Words}

def chain_paths_lists_every_file_in_order():
  {==}

law an_absolute_base_path_is_relative_or_absolute:
  {TS.relative_specifier("/w/base.json") == True{} : Bool}

def an_absolute_base_path_is_relative_or_absolute():
  {==}

law a_bare_package_specifier_is_not_a_relative_specifier:
  {TS.relative_specifier("@tsconfig/base") == False{} : Bool}

def a_bare_package_specifier_is_not_a_relative_specifier():
  {==}

# --- the result field table --------------------------------------------------

law a_port_number_is_the_number_kind:
  {F.field_spec("service.port.published") == A.SpecScalar{A.KNumber{}} : A.Spec}

def a_port_number_is_the_number_kind():
  {==}

law a_tool_version_is_the_version_kind:
  {F.field_spec("tool.version") == A.SpecScalar{A.KVersion{}} : A.Spec}

def a_tool_version_is_the_version_kind():
  {==}

law a_declared_range_is_the_range_kind:
  {F.field_spec("dependency.declared.range") == A.SpecScalar{A.KRange{}} : A.Spec}

def a_declared_range_is_the_range_kind():
  {==}

law a_dotenv_key_is_the_key_kind:
  {F.field_spec("dotenv.key") == A.SpecScalar{A.KKey{}} : A.Spec}

def a_dotenv_key_is_the_key_kind():
  {==}

law a_command_carries_no_value:
  {F.field_spec("command") == A.SpecNone{"no-automatic-value-field"} : A.Spec}

def a_command_carries_no_value():
  {==}

law a_credential_field_carries_no_value:
  {F.field_admission("credential", J.Jstr{"postgres://user:pw@host/db"}) == A.Reject{"no-automatic-value-field"} : A.Admission}

def a_credential_field_carries_no_value():
  {==}

law a_command_value_is_refused:
  {F.field_admission("command", J.Jstr{"curl http://example.invalid"}) == A.Reject{"no-automatic-value-field"} : A.Admission}

def a_command_value_is_refused():
  {==}

law a_tool_version_value_is_admitted:
  {F.field_admission("tool.version", J.Jstr{"v25.8.0"}) == A.Admit{} : A.Admission}

def a_tool_version_value_is_admitted():
  {==}

law a_port_number_value_is_admitted:
  {F.field_admission("service.port.published", J.Jint{8080}) == A.Admit{} : A.Admission}

def a_port_number_value_is_admitted():
  {==}

law a_declared_range_value_is_admitted:
  {F.field_admission("dependency.declared.range", J.Jstr{"^1.2.3"}) == A.Admit{} : A.Admission}

def a_declared_range_value_is_admitted():
  {==}

law a_listed_condition_is_admitted:
  {F.field_admission("service.dependency.condition", J.Jstr{"service_healthy"}) == A.Admit{} : A.Admission}

def a_listed_condition_is_admitted():
  {==}

law an_unlisted_condition_is_refused:
  {F.field_admission("service.dependency.condition", J.Jstr{"bogus"}) == A.Reject{"not-an-allowed-option-value"} : A.Admission}

def an_unlisted_condition_is_refused():
  {==}
