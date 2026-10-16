# Decode an installed module declaration that the package resolver has already
# tied to the selected manifest and verified source bytes. The decoder preserves
# declaration fields and refuses missing contract members.
import Base
import ../json/canonical.bend as J
import ./request.bend as Req
import ./engines.bend as Eng
import ./engines-decl.bend as Decl

type DeclarationDecode is Data:
  DeclarationDecoded{declaration: Decl.Decl, inventory: Decl.Inv}
  DeclarationRefused{field: String}

def member_value(found: Maybe<&2, J.Json>) -> J.Json:
  match found:
    case None{}: J.Jnil{}
    case Some{+value}: value

def member(+object: J.Json, +key: String) -> J.Json:
  match object:
    case J.Jobj{+members}: member_value(Req.member_lookup(key, members))
    case other: J.Jnil{}

def object_members(+object: J.Json) -> J.Json:
  match object:
    case J.Jobj{+members}: members
    case other: J.Jnil{}

def text_field(+object: J.Json, +key: String) -> String:
  Req.text_of(member(object, key))

def array_tail(+items: J.Json) -> J.Json:
  match items:
    case J.Jarr{head, +tail}: tail
    case other: J.Jnil{}

def is_array(+value: J.Json) -> Bool:
  match value:
    case J.Jarr{head, tail}: True{}
    case other: False{}

def string_array_valid(+items: J.Json) -> Bool:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: True{}
    case J.Jarr{+head, +tail}:
      Bool.and(Req.is_jstr(head), string_array_valid(tail))
    case J.Jnil{}: True{}
    case other: False{}

def artifact_rows_valid(+items: J.Json) -> Bool:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: True{}
    case J.Jarr{+head, +tail}:
      Bool.and(Req.is_jobj(head),
      Bool.and(Bool.not(String.is_empty(text_field(head, "packagePath"))),
      Bool.and(Bool.not(String.is_empty(text_field(head, "sha256"))),
      Bool.and(Bool.not(String.is_empty(text_field(head, "role"))), artifact_rows_valid(tail)))))
    case J.Jnil{}: True{}
    case other: False{}

def execution_valid(+token: String) -> Bool:
  Bool.or(String.eq(token, "pure"),
  Bool.or(String.eq(token, "direct"),
  Bool.or(String.eq(token, "managed"), String.eq(token, "runtime"))))

def strings_tail(+items: J.Json) -> List<String>:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: Nil{}
    case J.Jarr{+head, +tail}: Req.text_of(head) <> strings_tail(tail)
    case other: Nil{}

def strings(+items: J.Json) -> Eng.SS:
  Eng.ss_of_list(strings_tail(items))

def artifacts_tail(+items: J.Json) -> Decl.Arts:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: Decl.ArtsNil{}
    case J.Jarr{+head, +tail}:
      Decl.ArtsCons{Decl.Art{text_field(head, "packagePath"),
        text_field(head, "sha256"), text_field(head, "role")}, artifacts_tail(tail)}
    case other: Decl.ArtsNil{}

def refs_tail(+items: J.Json) -> Decl.ModRefs:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: Decl.ModRefsNil{}
    case J.Jarr{+head, +tail}:
      Decl.ModRefsCons{Decl.ModRef{text_field(head, "moduleId"),
        text_field(head, "declarationDigest"), text_field(head, "operation")}, refs_tail(tail)}
    case other: Decl.ModRefsNil{}

def execution(+token: String) -> Decl.Exec:
  Bool.pick(Decl.Exec, String.eq(token, "pure"), Decl.ExPure{},
  Bool.pick(Decl.Exec, String.eq(token, "direct"), Decl.ExDirect{},
  Bool.pick(Decl.Exec, String.eq(token, "managed"), Decl.ExManaged{}, Decl.ExRuntime{})))

def operation(+value: J.Json) -> Decl.Op:
  Decl.Op{text_field(value, "operation"), text_field(value, "implements"),
    text_field(value, "subjectSchema"), text_field(value, "optionsSchema"),
    strings(member(value, "projections")), strings(member(value, "effects")),
    execution(text_field(value, "execution")), text_field(value, "resultSchema"),
    text_field(value, "referenceSchema"), text_field(value, "eventSchema"),
    text_field(value, "lifetimeProfile"), refs_tail(member(value, "dependencies"))}

def operations_tail(+items: J.Json) -> Decl.Ops:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: Decl.OpsNil{}
    case J.Jarr{+head, +tail}: Decl.OpsCons{operation(head), operations_tail(tail)}
    case other: Decl.OpsNil{}

def rule_value(+value: J.Json) -> Decl.Rule:
  Bool.pick(Decl.Rule, String.eq(text_field(value, "kind"), "path"),
    Decl.RPath{text_field(value, "value")},
  Bool.pick(Decl.Rule, String.eq(text_field(value, "kind"), "manifest"),
    Decl.RManifest{text_field(value, "value")},
  Bool.pick(Decl.Rule, String.eq(text_field(value, "kind"), "subject"),
    Decl.RSubject{text_field(value, "value")},
  Bool.pick(Decl.Rule, String.eq(text_field(value, "kind"), "pathSuffix"),
    Decl.RPathSuffix{text_field(value, "value")},
  Bool.pick(Decl.Rule, String.eq(text_field(value, "kind"), "pathSuffixAny"),
    Decl.RPathSuffixAny{strings(member(value, "values"))},
    Decl.RProjection{text_field(value, "value")})))))

def rules_tail(+items: J.Json) -> Decl.Rules:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: Decl.RulesNil{}
    case J.Jarr{+head, +tail}:
      Decl.RulesCons{rule_value(head), rules_tail(tail)}
    case other: Decl.RulesNil{}

def decl_artifact(+entry: J.Json, +artifacts: Decl.Arts) -> Decl.Art:
  Decl.Art{text_field(entry, "artifact"),
    Decl.artifact_digest(artifacts, text_field(entry, "artifact")), "entry"}

def entry_value(+entry: J.Json, +artifacts: Decl.Arts) -> Decl.Entry:
  Decl.EProcess{decl_artifact(entry, artifacts), strings(member(entry, "argv"))}

def declaration_value(+value: J.Json) -> Decl.Decl:
  Decl.Decl{"1", text_field(value, "moduleId"), text_field(value, "revision"),
    text_field(value, "protocolVersion"), text_field(value, "packageIdentity"),
    entry_value(member(value, "entry"), artifacts_tail(member(value, "artifactIdentities"))),
    artifacts_tail(member(value, "dependencies")), operations_tail(member(value, "operations")),
    rules_tail(member(value, "applicability"))}

def operation_field_schema_valid(+head: J.Json) -> Bool:
  Bool.and(Req.is_jobj(head),
  Bool.and(String.eq(Req.text_of(member(head, "schema")), "baton2-native-operation-v1"),
  Bool.and(is_array(member(head, "projections")), string_array_valid(member(head, "projections")))))

def operation_field_execution_valid(+head: J.Json) -> Bool:
  Bool.and(is_array(member(head, "effects")),
  Bool.and(string_array_valid(member(head, "effects")),
  Bool.and(execution_valid(text_field(head, "execution")),
  Bool.and(is_array(member(head, "dependencies")),
  Bool.and(Bool.not(String.is_empty(text_field(head, "subjectSchema"))),
  Bool.and(Bool.not(String.is_empty(text_field(head, "optionsSchema"))),
  Bool.and(Bool.not(String.is_empty(text_field(head, "referenceSchema"))),
  Bool.and(Bool.not(String.is_empty(text_field(head, "resultSchema"))),
  Bool.not(String.is_empty(text_field(head, "eventSchema")))))))))))

def operation_field_valid(+head: J.Json) -> Bool:
  Bool.and(operation_field_schema_valid(head), operation_field_execution_valid(head))

def operation_fields_rest(+items: J.Json) -> Bool:
  match items:
    case J.Jnil{}: True{}
    case J.Jarr{J.Jnil{}, J.Jnil{}}: True{}
    case J.Jarr{+head, +tail}:
      Bool.and(operation_field_valid(head), operation_fields_rest(tail))
    case other: False{}

def operation_fields_valid(+items: J.Json) -> Bool:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: False{}
    case J.Jarr{+head, +tail}: Bool.and(operation_field_valid(head), operation_fields_rest(tail))
    case other: False{}

def applicability_rule_value_valid(+rule: J.Json) -> Bool:
  Bool.pick(Bool, String.eq(text_field(rule, "kind"), "pathSuffixAny"),
    Bool.and(is_array(member(rule, "values")), string_array_valid(member(rule, "values"))),
    Bool.not(String.is_empty(text_field(rule, "value"))))

def applicability_rule_kind_valid(+rule: J.Json) -> Bool:
  Bool.or(String.eq(text_field(rule, "kind"), "path"),
  Bool.or(String.eq(text_field(rule, "kind"), "pathSuffix"),
  Bool.or(String.eq(text_field(rule, "kind"), "pathSuffixAny"),
  Bool.or(String.eq(text_field(rule, "kind"), "manifest"),
  Bool.or(String.eq(text_field(rule, "kind"), "subject"),
          String.eq(text_field(rule, "kind"), "projection"))))))

def applicability_rule_valid(+rule: J.Json) -> Bool:
  Bool.and(Req.is_jobj(rule),
  Bool.and(Req.keys_allowed(Req.words_from(["kind", "value", "values"]), object_members(rule)),
  Bool.and(applicability_rule_value_valid(rule),
           applicability_rule_kind_valid(rule))))

def applicability_rules_rest(+items: J.Json) -> Bool:
  match items:
    case J.Jnil{}: True{}
    case J.Jarr{J.Jnil{}, J.Jnil{}}: True{}
    case J.Jarr{+head, +tail}:
      Bool.and(applicability_rule_valid(head), applicability_rules_rest(tail))
    case other: False{}

def applicability_rules_valid(+items: J.Json) -> Bool:
  match items:
    case J.Jarr{J.Jnil{}, J.Jnil{}}: True{}
    case J.Jarr{+head, +tail}:
      Bool.and(applicability_rule_valid(head), applicability_rules_rest(tail))
    case other: False{}

def declaration_fields_valid(+value: J.Json) -> Bool:
  Bool.and(String.eq(Req.text_of(member(value, "schema")), "baton2-native-module-declaration-v1"),
  Bool.and(Bool.not(String.is_empty(text_field(value, "moduleId"))),
  Bool.and(Bool.not(String.is_empty(text_field(value, "revision"))),
  Bool.and(Bool.not(String.is_empty(text_field(value, "packageIdentity"))),
  Bool.and(String.eq(text_field(value, "protocolVersion"), "2"),
  Bool.and(is_array(member(value, "artifactIdentities")),
  Bool.and(artifact_rows_valid(member(value, "artifactIdentities")),
  Bool.and(is_array(member(value, "dependencies")),
  Bool.and(artifact_rows_valid(member(value, "dependencies")),
  Bool.and(is_array(member(value, "schemaIdentities")),
  Bool.and(is_array(member(value, "operations")),
  Bool.and(operation_fields_valid(member(value, "operations")),
  Bool.and(applicability_rules_valid(member(value, "applicability")),
  Bool.and(Bool.not(String.is_empty(text_field(member(value, "entry"), "artifact"))),
  Bool.and(is_array(member(member(value, "entry"), "argv")),
    string_array_valid(member(member(value, "entry"), "argv")))))))))))))))))

def decode(+value: J.Json, +verified_digest: String) -> DeclarationDecode:
  Bool.pick(DeclarationDecode,
    Bool.and(declaration_fields_valid(value), Bool.not(String.is_empty(verified_digest))),
    DeclarationDecoded{declaration_value(value),
      Decl.Inv{artifacts_tail(member(value, "artifactIdentities")),
        strings(member(value, "schemaIdentities")),
        Decl.DigsCons{Decl.Dg{text_field(value, "moduleId"), verified_digest}, Decl.DigsNil{}}}},
    DeclarationRefused{"nativeModuleDeclaration"})
