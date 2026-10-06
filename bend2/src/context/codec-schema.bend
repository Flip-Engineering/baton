# CLAIM: the shared schema vocabulary is closed tagged declaration data and this
# module validates it natively. Every form the validator accepts is a constructor
# below, so an unsupported form cannot be built and no executable validator or
# provider code has a place to hide. A declaration refuses before any value is
# visited when a local reference does not resolve or when a recursive reference does
# not consume an object member or an array element. Every record is closed, so an
# undeclared field refuses. Values are visited whole, with no truncation, and a
# validation or allocation failure keeps its own condition.
#
# The json-value profile keeps a number token and text as distinct kinds, so 1e400 is
# a number token while "1e400" is text, and it never converts through U32 or a host
# number. A duplicate decoded object key refuses in that profile. The u32 profile is
# the request profile and is not widened here.
#
# Ownership: the declaration and its identity are package-supplied. This module
# authenticates nothing, and a canonical text plus a digest is not an identity.
# Serves: docs/bend2/semantic-context-spec.md, the closed schema vocabulary.
import Base
import ./codec.bend as Codec
import ./contracts.bend as Context

# --- the closed vocabulary -------------------------------------------------

type SchemaForm is Data:
  SfRecord{fields: List<SchemaField>}
  SfUnion{cases: List<SchemaCase>}
  SfArray{item: SchemaForm}
  SfEnum{literals: NameList}
  SfOptional{inner: SchemaForm}
  SfDict{keys: SchemaKeys, value: SchemaForm}
  SfRef{name: String}
  SfScalar{kind: SchemaScalar}
  SfJson{}

type SchemaField is Data:
  SfRequired{name: String, form: SchemaForm}
  SfOptionalField{name: String, form: SchemaForm}

type SchemaCase is Data:
  SchemaCase{tag: String, form: SchemaForm}

# A dictionary declares its key policy and its value schema. Arbitrary keys are
# admitted only at a position that says so, so an authority record stays closed.
type SchemaKeys is Data:
  SkDeclared{names: NameList}
  SkAnyScalarText{}

type SchemaScalar is Data:
  SsText{}
  SsU32Token{}
  SsNumberToken{}
  SsBool{}
  SsNull{}

type SchemaDef is Data:
  SchemaDef{name: String, form: SchemaForm}

type SchemaVerdict is Data:
  SvOk{}
  SvRefused{condition: String}

# The name list this module builds. It is its own type so that building a list is an
# explicit constructor application.
type NameList is Data:
  NlNil{}
  NlCons{head: String, tail: NameList}

# --- name list and member helpers -----------------------------------------

def name_member(names: NameList, name: String) -> Bool:
  match names:
    case NlNil{}: False{}
    case NlCons{+head, +tail}: Bool.pick(Bool, String.eq(head, name), True{}, name_member(tail, name))

def name_appended(left: NameList, right: NameList) -> NameList:
  match left:
    case NlNil{}: right
    case NlCons{+head, +tail}: NlCons{head, name_appended(tail, right)}

def def_body(defs: List<SchemaDef>, name: String) -> Maybe<&2, SchemaForm>:
  match defs:
    case Nil{}: None{}
    case head <> tail:
      match head:
        case SchemaDef{bound, form}: Bool.pick(Maybe<&2, SchemaForm>, String.eq(bound, name), Some{form}, def_body(tail, name))

def member_seen(key: String, members: Codec.RawValue) -> Bool:
  match members:
    case Codec.Rpair{+name, +value, +tail}: Bool.pick(Bool, String.eq(name, key), True{}, member_seen(key, tail))
    case other: False{}

# A decoded object key that appears twice refuses, for the schema members and for the
# json-value profile alike.
def keys_unique(+members: Codec.RawValue) -> Bool:
  match members:
    case Codec.Rpair{+key, +value, +tail}: Bool.pick(Bool, member_seen(key, tail), False{}, keys_unique(tail))
    case Codec.Rnil{}: True{}
    case other: False{}

def members_declared(names: NameList, members: Codec.RawValue) -> Bool:
  match members:
    case Codec.Rpair{+key, +value, +tail}: Bool.pick(Bool, name_member(names, key), members_declared(names, tail), False{})
    case Codec.Rnil{}: True{}
    case other: False{}

def field_names(fields: List<SchemaField>) -> NameList:
  match fields:
    case Nil{}: NlNil{}
    case head <> tail:
      match head:
        case SfRequired{name, form}: NlCons{name, field_names(tail)}
        case SfOptionalField{name, form}: NlCons{name, field_names(tail)}

# --- the declaration check -------------------------------------------------

def form_refs(form: SchemaForm) -> NameList:
  match form:
    case SfRef{name}: NlCons{name, NlNil{}}
    case SfRecord{+fields}: field_refs(fields)
    case SfUnion{+cases}: case_refs(cases)
    case SfArray{+item}: form_refs(item)
    case SfEnum{+literals}: NlNil{}
    case SfOptional{+inner}: form_refs(inner)
    case SfDict{+keys, +value}: form_refs(value)
    case SfScalar{+kind}: NlNil{}
    case SfJson{}: NlNil{}

def field_refs(fields: List<SchemaField>) -> NameList:
  match fields:
    case Nil{}: NlNil{}
    case head <> tail:
      match head:
        case SfRequired{name, form}: name_appended(form_refs(form), field_refs(tail))
        case SfOptionalField{name, form}: name_appended(form_refs(form), field_refs(tail))

def case_refs(cases: List<SchemaCase>) -> NameList:
  match cases:
    case Nil{}: NlNil{}
    case head <> tail:
      match head:
        case SchemaCase{tag, form}: name_appended(form_refs(form), case_refs(tail))

def refs_resolve(defs: List<SchemaDef>, names: NameList) -> Bool:
  match names:
    case NlNil{}: True{}
    case NlCons{+head, +tail}:
      match def_body(defs, head):
        case None{}: False{}
        case Some{form}: refs_resolve(defs, tail)

# The refs a form reaches without consuming an object member or an array element. A
# cycle that stays inside this relation never consumes a member, so it is unguarded.
def immediate_refs(form: SchemaForm) -> NameList:
  match form:
    case SfRef{name}: NlCons{name, NlNil{}}
    case SfUnion{+cases}: immediate_case_refs(cases)
    case SfOptional{+inner}: immediate_refs(inner)
    case SfRecord{+fields}: NlNil{}
    case SfArray{+item}: NlNil{}
    case SfDict{+keys, +value}: NlNil{}
    case SfEnum{+literals}: NlNil{}
    case SfScalar{+kind}: NlNil{}
    case SfJson{}: NlNil{}

def immediate_case_refs(cases: List<SchemaCase>) -> NameList:
  match cases:
    case Nil{}: NlNil{}
    case head <> tail:
      match head:
        case SchemaCase{tag, form}: name_appended(immediate_refs(form), immediate_case_refs(tail))

def reaches_go(defs: List<SchemaDef>, pending: NameList, seen: NameList, target: String) -> Bool:
  match pending:
    case NlNil{}: False{}
    case NlCons{+head, +tail}:
      Bool.pick(Bool, String.eq(head, target), True{},
        Bool.pick(Bool, name_member(seen, head), reaches_go(defs, tail, seen, target),
          reach_step(defs, def_body(defs, head), head, tail, seen, target)))

def reach_step(defs: List<SchemaDef>, found: Maybe<&2, SchemaForm>, name: String, tail: NameList, seen: NameList, target: String) -> Bool:
  match found:
    case None{}: reaches_go(defs, tail, seen, target)
    case Some{form}: reaches_go(defs, name_appended(immediate_refs(form), tail), NlCons{name, seen}, target)

def unguarded_cycle(defs: List<SchemaDef>, name: String) -> Bool:
  match def_body(defs, name):
    case None{}: False{}
    case Some{form}: reaches_go(defs, immediate_refs(form), NlCons{name, NlNil{}}, name)

def defs_checked(defs: List<SchemaDef>) -> Bool:
  match defs:
    case Nil{}: True{}
    case head <> tail:
      match head:
        case SchemaDef{name, form}:
          Bool.pick(Bool, refs_resolve(defs, form_refs(form)),
            Bool.pick(Bool, unguarded_cycle(defs, name), False{}, defs_checked(tail)), False{})

# The declaration check runs before any value is visited, so an unsupported form, an
# unknown reference or an unguarded cycle refuses before provider invocation.
def schema_declaration_ok(defs: List<SchemaDef>) -> SchemaVerdict:
  Bool.pick(SchemaVerdict, defs_checked(defs), SvOk{}, SvRefused{"declarationRefused"})

# --- the value walk --------------------------------------------------------

def scalar_admit(kind: SchemaScalar, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Rstr{+text}:
      match kind:
        case SsText{}: SvOk{}
        case other: SvRefused{"wrongKind"}
    case Codec.Rnum{+token}: number_admit(kind, token)
    case Codec.Rtrue{}: kind_is_bool(kind)
    case Codec.Rfalse{}: kind_is_bool(kind)
    case Codec.Rnull{}: kind_is_null(kind)
    case other: SvRefused{"wrongKind"}

def number_admit(kind: SchemaScalar, token: String) -> SchemaVerdict:
  match kind:
    case SsU32Token{}: Bool.pick(SchemaVerdict, Context.u32_token_ok(token), SvOk{}, SvRefused{"wrongKind"})
    case SsNumberToken{}: Bool.pick(SchemaVerdict, Context.strict_number_token_ok(token), SvOk{}, SvRefused{"wrongKind"})
    case other: SvRefused{"wrongKind"}

def kind_is_bool(kind: SchemaScalar) -> SchemaVerdict:
  match kind:
    case SsBool{}: SvOk{}
    case other: SvRefused{"wrongKind"}

def kind_is_null(kind: SchemaScalar) -> SchemaVerdict:
  match kind:
    case SsNull{}: SvOk{}
    case other: SvRefused{"wrongKind"}

def enum_admit(literals: NameList, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Rstr{+text}: Bool.pick(SchemaVerdict, name_member(literals, text), SvOk{}, SvRefused{"enumLiteral"})
    case other: SvRefused{"wrongKind"}

def record_admit(defs: List<SchemaDef>, fields: List<SchemaField>, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Robj{+members}:
      Bool.pick(SchemaVerdict, keys_unique(members),
        Bool.pick(SchemaVerdict, members_declared(field_names(fields), members), fields_admit(defs, fields, members), SvRefused{"undeclaredField"}),
        SvRefused{"duplicateKey"})
    case other: SvRefused{"wrongKind"}

def fields_admit(defs: List<SchemaDef>, fields: List<SchemaField>, members: Codec.RawValue) -> SchemaVerdict:
  match fields:
    case Nil{}: SvOk{}
    case head <> tail:
      match head:
        case SfRequired{name, form}: field_step(defs, form, Codec.raw_member(name, members), fields_admit(defs, tail, members), True{})
        case SfOptionalField{name, form}: field_step(defs, form, Codec.raw_member(name, members), fields_admit(defs, tail, members), False{})

def field_step(defs: List<SchemaDef>, form: SchemaForm, found: Maybe<&2, Codec.RawValue>, rest: SchemaVerdict, required: Bool) -> SchemaVerdict:
  match rest:
    case SvRefused{condition}: SvRefused{condition}
    case SvOk{}:
      Bool.pick(SchemaVerdict, required, field_value_admit(defs, form, found), optional_value_admit(defs, form, found))

def field_value_admit(defs: List<SchemaDef>, form: SchemaForm, found: Maybe<&2, Codec.RawValue>) -> SchemaVerdict:
  match found:
    case None{}: SvRefused{"missingField"}
    case Some{value}: schema_admit(defs, form, value)

def optional_value_admit(defs: List<SchemaDef>, form: SchemaForm, found: Maybe<&2, Codec.RawValue>) -> SchemaVerdict:
  match found:
    case None{}: SvOk{}
    case Some{value}: schema_admit(defs, form, value)

def union_admit(defs: List<SchemaDef>, cases: List<SchemaCase>, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Robj{+members}:
      match members:
        case Codec.Rpair{+tag, +payload, +tail}: union_case_admit(defs, cases, tag, tail, payload)
        case other: SvRefused{"wrongKind"}
    case other: SvRefused{"wrongKind"}

def union_case_admit(defs: List<SchemaDef>, cases: List<SchemaCase>, tag: String, tail: Codec.RawValue, payload: Codec.RawValue) -> SchemaVerdict:
  match tail:
    case Codec.Rnil{}:
      match case_form(cases, tag):
        case None{}: SvRefused{"unknownTag"}
        case Some{form}: schema_admit(defs, form, payload)
    case other: SvRefused{"wrongKind"}

def case_form(cases: List<SchemaCase>, tag: String) -> Maybe<&2, SchemaForm>:
  match cases:
    case Nil{}: None{}
    case head <> tail:
      match head:
        case SchemaCase{bound, form}: Bool.pick(Maybe<&2, SchemaForm>, String.eq(bound, tag), Some{form}, case_form(tail, tag))

def optional_admit(defs: List<SchemaDef>, inner: SchemaForm, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Rnull{}: SvOk{}
    case other: schema_admit(defs, inner, value)

def array_admit(defs: List<SchemaDef>, item: SchemaForm, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Rarr{+head, +tail}: array_head_admit(defs, item, head, tail)
    case other: SvRefused{"wrongKind"}

def array_head_admit(defs: List<SchemaDef>, item: SchemaForm, head: Codec.RawValue, tail: Codec.RawValue) -> SchemaVerdict:
  match schema_admit(defs, item, head):
    case SvRefused{condition}: SvRefused{condition}
    case SvOk{}: array_items_admit(defs, item, tail)

def array_items_admit(defs: List<SchemaDef>, item: SchemaForm, rest: Codec.RawValue) -> SchemaVerdict:
  match rest:
    case Codec.Rnil{}: SvOk{}
    case Codec.Rarr{+head, +tail}: array_head_admit(defs, item, head, tail)
    case other: SvRefused{"wrongKind"}

def dict_admit(defs: List<SchemaDef>, keys: SchemaKeys, form: SchemaForm, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Robj{+members}:
      Bool.pick(SchemaVerdict, keys_unique(members),
        Bool.pick(SchemaVerdict, dict_keys_ok(keys, members), dict_values_admit(defs, form, members), SvRefused{"dictKeyRefused"}),
        SvRefused{"duplicateKey"})
    case other: SvRefused{"wrongKind"}

def dict_keys_ok(keys: SchemaKeys, members: Codec.RawValue) -> Bool:
  match keys:
    case SkAnyScalarText{}: True{}
    case SkDeclared{+names}: members_declared(names, members)

def dict_values_admit(defs: List<SchemaDef>, form: SchemaForm, members: Codec.RawValue) -> SchemaVerdict:
  match members:
    case Codec.Rnil{}: SvOk{}
    case Codec.Rpair{+key, +item, +tail}: dict_pair_admit(defs, form, item, tail)
    case other: SvRefused{"wrongKind"}

def dict_pair_admit(defs: List<SchemaDef>, form: SchemaForm, item: Codec.RawValue, tail: Codec.RawValue) -> SchemaVerdict:
  match schema_admit(defs, form, item):
    case SvRefused{condition}: SvRefused{condition}
    case SvOk{}: dict_values_admit(defs, form, tail)

def json_admit(value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Rnull{}: SvOk{}
    case Codec.Rtrue{}: SvOk{}
    case Codec.Rfalse{}: SvOk{}
    case Codec.Rstr{+text}: SvOk{}
    case Codec.Rnum{+token}: SvOk{}
    case Codec.Rarr{+head, +tail}: json_array_admit(head, tail)
    case Codec.Robj{+members}: json_object_admit(members)
    case other: SvRefused{"wrongKind"}

def json_object_admit(members: Codec.RawValue) -> SchemaVerdict:
  Bool.pick(SchemaVerdict, keys_unique(members), json_member_admit(members), SvRefused{"duplicateKey"})

def json_member_admit(members: Codec.RawValue) -> SchemaVerdict:
  match members:
    case Codec.Rnil{}: SvOk{}
    case Codec.Rpair{+key, +value, +tail}: json_pair_admit(value, tail)
    case other: SvRefused{"wrongKind"}

def json_pair_admit(value: Codec.RawValue, tail: Codec.RawValue) -> SchemaVerdict:
  match json_admit(value):
    case SvRefused{condition}: SvRefused{condition}
    case SvOk{}: json_member_admit(tail)

def json_array_admit(head: Codec.RawValue, tail: Codec.RawValue) -> SchemaVerdict:
  match json_admit(head):
    case SvRefused{condition}: SvRefused{condition}
    case SvOk{}: json_array_items(tail)

def json_array_items(rest: Codec.RawValue) -> SchemaVerdict:
  match rest:
    case Codec.Rnil{}: SvOk{}
    case Codec.Rarr{+head, +tail}: json_array_admit(head, tail)
    case other: SvRefused{"wrongKind"}

def schema_admit(defs: List<SchemaDef>, form: SchemaForm, input: Codec.RawValue) -> SchemaVerdict:
  match form:
    case SfRecord{+fields}: record_admit(defs, fields, input)
    case SfUnion{+cases}: union_admit(defs, cases, input)
    case SfArray{+item}: array_admit(defs, item, input)
    case SfEnum{+literals}: enum_admit(literals, input)
    case SfOptional{+inner}: optional_admit(defs, inner, input)
    case SfDict{+keys, +value}: dict_admit(defs, keys, value, input)
    case SfRef{name}: ref_admit(defs, name, input)
    case SfScalar{+kind}: scalar_admit(kind, input)
    case SfJson{}: json_admit(input)

def ref_admit(defs: List<SchemaDef>, name: String, value: Codec.RawValue) -> SchemaVerdict:
  match def_body(defs, name):
    case None{}: SvRefused{"unknownReference"}
    case Some{form}: schema_admit(defs, form, value)

# --- laws ------------------------------------------------------------------

law schema_law_a_closed_record_admits_a_declared_field:
  {record_admit(Nil{}, [SfRequired{"name", SfScalar{SsText{}}}], Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_closed_record_admits_a_declared_field():
  {==}

law schema_law_a_closed_record_refuses_an_undeclared_field:
  {record_admit(Nil{}, [SfRequired{"name", SfScalar{SsText{}}}], Codec.Robj{Codec.Rpair{"other", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvRefused{"undeclaredField"} : SchemaVerdict}

def schema_law_a_closed_record_refuses_an_undeclared_field():
  {==}

law schema_law_a_missing_required_field_refuses:
  {record_admit(Nil{}, [SfRequired{"name", SfScalar{SsText{}}}], Codec.Robj{Codec.Rnil{}}) == SvRefused{"missingField"} : SchemaVerdict}

def schema_law_a_missing_required_field_refuses():
  {==}

law schema_law_an_absent_optional_field_admits:
  {record_admit(Nil{}, [SfOptionalField{"name", SfScalar{SsText{}}}], Codec.Robj{Codec.Rnil{}}) == SvOk{} : SchemaVerdict}

def schema_law_an_absent_optional_field_admits():
  {==}

law schema_law_a_duplicate_decoded_member_refuses:
  {record_admit(Nil{}, [SfRequired{"name", SfScalar{SsText{}}}], Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rnil{}}}}) == SvRefused{"duplicateKey"} : SchemaVerdict}

def schema_law_a_duplicate_decoded_member_refuses():
  {==}

law schema_law_an_enum_accepts_a_declared_literal:
  {enum_admit(NlCons{"a", NlCons{"b", NlNil{}}}, Codec.Rstr{"b"}) == SvOk{} : SchemaVerdict}

def schema_law_an_enum_accepts_a_declared_literal():
  {==}

law schema_law_an_enum_refuses_another_literal:
  {enum_admit(NlCons{"a", NlCons{"b", NlNil{}}}, Codec.Rstr{"c"}) == SvRefused{"enumLiteral"} : SchemaVerdict}

def schema_law_an_enum_refuses_another_literal():
  {==}

law schema_law_the_number_profile_keeps_a_token_distinct_from_text:
  {schema_admit(Nil{}, SfScalar{SsNumberToken{}}, Codec.Rstr{"1e400"}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_the_number_profile_keeps_a_token_distinct_from_text():
  {==}

law schema_law_the_number_profile_admits_an_exact_token:
  {schema_admit(Nil{}, SfScalar{SsNumberToken{}}, Codec.Rnum{"1e400"}) == SvOk{} : SchemaVerdict}

def schema_law_the_number_profile_admits_an_exact_token():
  {==}

law schema_law_the_u32_profile_refuses_a_wider_token:
  {schema_admit(Nil{}, SfScalar{SsU32Token{}}, Codec.Rnum{"4294967296"}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_the_u32_profile_refuses_a_wider_token():
  {==}

law schema_law_an_array_is_visited_to_its_last_element:
  {schema_admit(Nil{}, SfArray{SfScalar{SsText{}}}, Codec.Rarr{Codec.Rstr{"a"}, Codec.Rarr{Codec.Rstr{"b"}, Codec.Rarr{Codec.Rnum{"1"}, Codec.Rnil{}}}}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_an_array_is_visited_to_its_last_element():
  {==}

law schema_law_a_json_object_refuses_a_duplicate_member:
  {json_admit(Codec.Robj{Codec.Rpair{"k", Codec.Rstr{"a"}, Codec.Rpair{"k", Codec.Rstr{"b"}, Codec.Rnil{}}}}) == SvRefused{"duplicateKey"} : SchemaVerdict}

def schema_law_a_json_object_refuses_a_duplicate_member():
  {==}

law schema_law_a_dictionary_without_a_declared_key_refuses:
  {dict_admit(Nil{}, SkDeclared{NlCons{"k", NlNil{}}}, SfScalar{SsText{}}, Codec.Robj{Codec.Rpair{"other", Codec.Rstr{"a"}, Codec.Rnil{}}}) == SvRefused{"dictKeyRefused"} : SchemaVerdict}

def schema_law_a_dictionary_without_a_declared_key_refuses():
  {==}

law schema_law_an_unguarded_cycle_refuses:
  {schema_declaration_ok([SchemaDef{"row", SfRef{"row"}}]) == SvRefused{"declarationRefused"} : SchemaVerdict}

def schema_law_an_unguarded_cycle_refuses():
  {==}

law schema_law_a_cycle_through_an_array_is_guarded:
  {schema_declaration_ok([SchemaDef{"row", SfArray{SfRef{"row"}}}]) == SvOk{} : SchemaVerdict}

def schema_law_a_cycle_through_an_array_is_guarded():
  {==}

law schema_law_a_cycle_through_a_dictionary_is_guarded:
  {schema_declaration_ok([SchemaDef{"row", SfDict{SkAnyScalarText{}, SfRef{"row"}}}]) == SvOk{} : SchemaVerdict}

def schema_law_a_cycle_through_a_dictionary_is_guarded():
  {==}

law schema_law_an_unknown_reference_refuses:
  {schema_declaration_ok([SchemaDef{"row", SfRef{"missing"}}]) == SvRefused{"declarationRefused"} : SchemaVerdict}

def schema_law_an_unknown_reference_refuses():
  {==}

law schema_law_a_local_reference_resolves_and_admits:
  {schema_admit([SchemaDef{"row", SfScalar{SsText{}}}], SfRef{"row"}, Codec.Rstr{"x"}) == SvOk{} : SchemaVerdict}

def schema_law_a_local_reference_resolves_and_admits():
  {==}

law schema_law_a_union_member_admits_its_case:
  {union_admit(Nil{}, [SchemaCase{"text", SfScalar{SsText{}}}], Codec.Robj{Codec.Rpair{"text", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_union_member_admits_its_case():
  {==}

law schema_law_a_union_member_refuses_an_unknown_tag:
  {union_admit(Nil{}, [SchemaCase{"text", SfScalar{SsText{}}}], Codec.Robj{Codec.Rpair{"other", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvRefused{"unknownTag"} : SchemaVerdict}

def schema_law_a_union_member_refuses_an_unknown_tag():
  {==}
