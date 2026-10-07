# CLAIM: the shared schema vocabulary is closed tagged declaration data and this
# module validates it natively. Every form the validator accepts is a constructor
# below, so an unsupported form cannot be built and no executable validator or
# provider code has a place to hide.
#
# `schema_admit_value` is the one checked public entry. It runs the declaration
# preflight first: the definition environment is the whole definition list, every
# local reference must resolve against it, no definition may reach itself without
# consuming an object member or an array element, and no definition name, record field
# name, union tag or enum literal may be declared twice. The preflight covers every
# definition in the list and the root form, so an ambiguous or unresolvable definition
# refuses even when nothing reaches it. `schema_walk` is the internal walker and only
# the checked entry reaches it.
#
# Each record is closed, so an undeclared field refuses. A tagged union carries one
# object member per level, so a recursive union that nests through its cases consumes a
# member on each cycle and admits a finite value. The raw decoder's canonical empty
# array is the sentinel cell, and both the array position and the json profile admit
# it. Values are walked whole. The json-value profile keeps an exact number token and
# text as distinct kinds, so 1e400 is a number token while "1e400" is text, and a
# duplicate decoded key refuses there.
#
# Ownership: the declaration and its identity are package-supplied. This module
# authenticates nothing, and a canonical text plus a digest is not an identity.
# Serves: docs/bend2/semantic-context-spec.md, the closed schema vocabulary.
import Base
import ./codec.bend as Codec
import ./contracts.bend as Context

# --- the closed vocabulary -------------------------------------------------
# Every declaration reference resolves to a type defined above it. Record fields
# and union cases are constructors of the form itself, and a field list and a
# case list are cons spines of forms, so no declaration names a type defined
# below it.

# The name list this module builds, so that building one is an explicit constructor.
type NameList is Data:
  NlNil{}
  NlCons{head: String, tail: NameList}

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

type SchemaForm is Data:
  SfRecord{fields: SchemaForm}
  SfUnion{cases: SchemaForm}
  SfArray{item: SchemaForm}
  SfEnum{literals: NameList}
  SfOptional{inner: SchemaForm}
  SfDict{keys: SchemaKeys, value: SchemaForm}
  SfRef{name: String}
  SfScalar{kind: SchemaScalar}
  SfJson{}
  SfRequired{name: String, form: SchemaForm}
  SfOptionalField{name: String, form: SchemaForm}
  SchemaCase{tag: String, form: SchemaForm}
  SfFieldsNil{}
  SfFieldsCons{head: SchemaForm, tail: SchemaForm}
  SfCasesNil{}
  SfCasesCons{head: SchemaForm, tail: SchemaForm}

type SchemaDef is Data:
  SchemaDef{name: String, form: SchemaForm}

# The definition environment is a cons spine of definitions.
type SchemaDefs is Data:
  DefsNil{}
  DefsCons{head: SchemaDef, tail: SchemaDefs}

type SchemaVerdict is Data:
  SvOk{}
  SvRefused{condition: String}

# --- name list and object member helpers -----------------------------------

def name_member(+names: NameList, +name: String) -> Bool:
  match names:
    case NlNil{}: False{}
    case NlCons{+head, +tail}: Bool.pick(Bool, String.eq(head, name), True{}, name_member(tail, name))

def name_appended(left: NameList, +right: NameList) -> NameList:
  match left:
    case NlNil{}: right
    case NlCons{+head, +tail}: NlCons{head, name_appended(tail, right)}

# The frontier readers below each scrutinize the pending list in their own
# definition, so the reachability walk never matches a parameter twice.
def name_list_empty(+pending: NameList) -> Bool:
  match pending:
    case NlNil{}: True{}
    case NlCons{head, tail}: False{}

def pending_head(+pending: NameList) -> String:
  match pending:
    case NlNil{}: ""
    case NlCons{head, tail}: head

def pending_tail(+pending: NameList) -> NameList:
  match pending:
    case NlNil{}: NlNil{}
    case NlCons{head, tail}: tail

def names_unique(names: NameList) -> Bool:
  match names:
    case NlNil{}: True{}
    case NlCons{+head, +tail}: Bool.pick(Bool, name_member(tail, head), False{}, names_unique(tail))

def member_seen(+key: String, +members: Codec.RawValue) -> Bool:
  match members:
    case Codec.Rpair{+name, +value, +tail}: Bool.pick(Bool, String.eq(name, key), True{}, member_seen(key, tail))
    case other: False{}

# A decoded object key that appears twice refuses, for schema members and for the
# json-value profile alike.
def keys_unique(+members: Codec.RawValue) -> Bool:
  match members:
    case Codec.Rpair{+key, +value, +tail}: Bool.pick(Bool, member_seen(key, tail), False{}, keys_unique(tail))
    case Codec.Rnil{}: True{}
    case other: False{}

def members_declared(+names: NameList, +members: Codec.RawValue) -> Bool:
  match members:
    case Codec.Rpair{+key, +value, +tail}: Bool.pick(Bool, name_member(names, key), members_declared(names, tail), False{})
    case Codec.Rnil{}: True{}
    case other: False{}

# Every required field of a field spine is declared by the member spine. The
# record preflight runs this over the whole member spine, so the field loop
# only ever meets members for declared fields and only skips optional ones.
def fields_covered(fields: SchemaForm, +members: Codec.RawValue) -> Bool:
  match fields:
    case SfFieldsNil{}: True{}
    case SfFieldsCons{head, tail}:
      match head:
        case SfRequired{name, form}: Bool.pick(Bool, member_seen(name, members), fields_covered(tail, members), False{})
        case SfOptionalField{name, form}: fields_covered(tail, members)
        case other: fields_covered(tail, members)
    case other: False{}

def field_names(fields: SchemaForm) -> NameList:
  match fields:
    case SfFieldsNil{}: NlNil{}
    case SfFieldsCons{head, tail}:
      match head:
        case SfRequired{name, form}: NlCons{name, field_names(tail)}
        case SfOptionalField{name, form}: NlCons{name, field_names(tail)}
        case other: field_names(tail)
    case other: NlNil{}

def case_tags(cases: SchemaForm) -> NameList:
  match cases:
    case SfCasesNil{}: NlNil{}
    case SfCasesCons{head, tail}:
      match head:
        case SchemaCase{tag, form}: NlCons{tag, case_tags(tail)}
        case other: case_tags(tail)
    case other: NlNil{}

def def_names(+defs: SchemaDefs) -> NameList:
  match defs:
    case DefsNil{}: NlNil{}
    case DefsCons{head, tail}:
      match head:
        case SchemaDef{name, form}: NlCons{name, def_names(tail)}

def def_body(+defs: SchemaDefs, +name: String) -> Maybe<&2, SchemaForm>:
  match defs:
    case DefsNil{}: None{}
    case DefsCons{head, tail}:
      match head:
        case SchemaDef{bound, form}: Bool.pick(Maybe<&2, SchemaForm>, String.eq(bound, name), Some{form}, def_body(tail, name))

# --- the declaration preflight ---------------------------------------------

def form_refs(form: SchemaForm) -> NameList:
  match form:
    case SfRef{name}: NlCons{name, NlNil{}}
    case SfRecord{fields}: form_refs(fields)
    case SfUnion{cases}: form_refs(cases)
    case SfArray{+item}: form_refs(item)
    case SfEnum{+literals}: NlNil{}
    case SfOptional{+inner}: form_refs(inner)
    case SfDict{+keys, +value}: form_refs(value)
    case SfScalar{+kind}: NlNil{}
    case SfJson{}: NlNil{}
    case SfRequired{name, form}: form_refs(form)
    case SfOptionalField{name, form}: form_refs(form)
    case SchemaCase{tag, form}: form_refs(form)
    case SfFieldsNil{}: NlNil{}
    case SfFieldsCons{head, tail}: name_appended(form_refs(head), form_refs(tail))
    case SfCasesNil{}: NlNil{}
    case SfCasesCons{head, tail}: name_appended(form_refs(head), form_refs(tail))

# A definition list binds a name when some entry declares it.
def def_known(+defs: SchemaDefs, +name: String) -> Bool:
  match defs:
    case DefsNil{}: False{}
    case DefsCons{head, tail}:
      match head:
        case SchemaDef{bound, form}: Bool.pick(Bool, String.eq(bound, name), True{}, def_known(tail, name))

# The reference environment is the whole definition list, so a definition may name one
# that is written after it.
def refs_resolve(+defs: SchemaDefs, +names: NameList) -> Bool:
  match names:
    case NlNil{}: True{}
    case NlCons{+head, +tail}: Bool.pick(Bool, def_known(defs, head), refs_resolve(defs, tail), False{})

# The refs a form reaches without consuming an object member or an array element. A
# record field, an array element, a dictionary value and a union case each consume a
# member, so a cycle through any of them is guarded. A cycle through an optional form
# alone consumes nothing.
def immediate_refs(form: SchemaForm) -> NameList:
  match form:
    case SfRef{name}: NlCons{name, NlNil{}}
    case SfUnion{+cases}: NlNil{}
    case SfOptional{+inner}: immediate_refs(inner)
    case SfRecord{+fields}: NlNil{}
    case SfArray{+item}: NlNil{}
    case SfDict{+keys, +value}: NlNil{}
    case SfEnum{+literals}: NlNil{}
    case SfScalar{+kind}: NlNil{}
    case SfJson{}: NlNil{}
    case SfRequired{name, form}: immediate_refs(form)
    case SfOptionalField{name, form}: immediate_refs(form)
    case SchemaCase{tag, form}: immediate_refs(form)
    case SfFieldsNil{}: NlNil{}
    case SfFieldsCons{head, tail}: name_appended(immediate_refs(head), immediate_refs(tail))
    case SfCasesNil{}: NlNil{}
    case SfCasesCons{head, tail}: name_appended(immediate_refs(head), immediate_refs(tail))

# The body bound to a name, or the empty json form when no entry binds it. An
# unbound name then contributes no outgoing refs, which skips it as a missing
# entry does.
def def_body_or(+defs: SchemaDefs, +name: String) -> SchemaForm:
  match defs:
    case DefsNil{}: SfJson{}
    case DefsCons{head, tail}:
      match head:
        case SchemaDef{bound, form}: Bool.pick(SchemaForm, String.eq(bound, name), form, def_body_or(tail, name))

# A name bound by some definition in the spine. The tail keeps the same name,
# so a miss continues looking for that same reference identity.
def scan_found(+defs: SchemaDefs, +name: String) -> Bool:
  match defs:
    case DefsNil{}: False{}
    case DefsCons{head, tail}:
      match head:
        case SchemaDef{bound, form}: Bool.pick(Bool, String.eq(bound, name), True{}, scan_found(tail, name))

# A fuel spine with two cells per definition for the reachability walk below.
# The walk burns one cell per reference descent, while sibling branches reuse
# the same remaining cells and definition scans cost nothing. A reachable
# target is then found along a simple path within twice a definition count of
# expansions, and an exhausted spine reports the target unreachable.
def defs_fuel(+defs: SchemaDefs) -> SchemaDefs:
  match defs:
    case DefsNil{}: DefsNil{}
    case DefsCons{+head, +tail}: DefsCons{head, DefsCons{head, defs_fuel(tail)}}

# Reachability over the definition graph in one self-recursive walk. A form is
# explored directly: a reference that names the target decides at once, any
# other reference descends into the bound body on one fuel cell, and an unbound
# reference substitutes the empty json form, which carries no refs. Containers
# split into independent sibling branches that reuse the same fuel, while
# structural wrappers pass it through unchanged. Guarded containers and leaves
# carry no unguarded refs. Fuel runs out on exhausted paths. Matches follow
# parameter order (fuel, then form), and every self-call passes unchanged
# values until one argument shrinks.
def refs_reach(+fuel: SchemaDefs, +form: SchemaForm, +defs: SchemaDefs, +target: String) -> Bool:
  match fuel:
    case DefsNil{}: False{}
    case DefsCons{reach_head, reach_tail}:
      match form:
        case SfRef{name}:
          Bool.pick(Bool, String.eq(name, target), True{},
            refs_reach(reach_tail, def_body_or(defs, name), defs, target))
        case SfFieldsCons{head, tail}:
          Bool.pick(Bool, refs_reach(fuel, head, defs, target), True{},
            refs_reach(fuel, tail, defs, target))
        case SfCasesCons{head, tail}:
          Bool.pick(Bool, refs_reach(fuel, head, defs, target), True{},
            refs_reach(fuel, tail, defs, target))
        case SfRequired{name, fform}:
          refs_reach(fuel, fform, defs, target)
        case SfOptionalField{name, fform}:
          refs_reach(fuel, fform, defs, target)
        case SchemaCase{tag, fform}:
          refs_reach(fuel, fform, defs, target)
        case SfOptional{inner}:
          refs_reach(fuel, inner, defs, target)
        case other: False{}

def cycle_step(+defs: SchemaDefs, found: Maybe<&2, SchemaForm>, +name: String) -> Bool:
  match found:
    case None{}: False{}
    case Some{form}: refs_reach(defs_fuel(defs), form, defs, name)

def unguarded_cycle(+defs: SchemaDefs, +name: String) -> Bool:
  cycle_step(defs, def_body(defs, name), name)

def defs_checked(+all: SchemaDefs, +rest: SchemaDefs) -> Bool:
  match rest:
    case DefsNil{}: True{}
    case DefsCons{head, tail}:
      match head:
        case SchemaDef{name, form}:
          Bool.pick(Bool, refs_resolve(all, form_refs(form)),
            Bool.pick(Bool, unguarded_cycle(all, name), False{}, defs_checked(all, tail)), False{})

# --- ambiguity over the declaration ----------------------------------------

# A case spine is nested-ambiguous when some suffix repeats a tag. The spine
# is shared so the tail serves both the tag check and the recursive walk.
def cases_nested_ambiguous(+cases: SchemaForm) -> Bool:
  match cases:
    case SfCasesNil{}: False{}
    case SfCasesCons{head, tail}: Bool.pick(Bool, names_unique(case_tags(tail)), cases_nested_ambiguous(tail), True{})
    case other: False{}

# A union is ambiguous on a repeated top tag or a repeated nested tag.
def union_cases_ambiguous(+cases: SchemaForm) -> Bool:
  Bool.pick(Bool, names_unique(case_tags(cases)), cases_nested_ambiguous(cases), True{})

def form_ambiguous(form: SchemaForm) -> Bool:
  match form:
    case SfRecord{+fields}: Bool.pick(Bool, names_unique(field_names(fields)), form_ambiguous(fields), True{})
    case SfUnion{+cases}: union_cases_ambiguous(cases)
    case SfArray{+item}: form_ambiguous(item)
    case SfEnum{+literals}: Bool.pick(Bool, names_unique(literals), False{}, True{})
    case SfOptional{+inner}: form_ambiguous(inner)
    case SfDict{+keys, +value}: form_ambiguous(value)
    case SfRef{name}: False{}
    case SfScalar{+kind}: False{}
    case SfJson{}: False{}
    case SfRequired{name, form}: form_ambiguous(form)
    case SfOptionalField{name, form}: form_ambiguous(form)
    case SchemaCase{tag, form}: form_ambiguous(form)
    case SfFieldsNil{}: False{}
    case SfFieldsCons{head, tail}: Bool.pick(Bool, form_ambiguous(head), True{}, form_ambiguous(tail))
    case SfCasesNil{}: False{}
    case SfCasesCons{head, tail}: Bool.pick(Bool, form_ambiguous(head), True{}, form_ambiguous(tail))

def defs_nested_ambiguous(+defs: SchemaDefs) -> Bool:
  match defs:
    case DefsNil{}: False{}
    case DefsCons{head, tail}:
      match head:
        case SchemaDef{name, form}: Bool.pick(Bool, form_ambiguous(form), True{}, defs_nested_ambiguous(tail))

def defs_ambiguous(+defs: SchemaDefs) -> Bool:
  Bool.pick(Bool, names_unique(def_names(defs)), defs_nested_ambiguous(defs), True{})

def refs_step(+defs: SchemaDefs, +form: SchemaForm, defs_ok: Bool) -> SchemaVerdict:
  Bool.pick(SchemaVerdict, defs_ok, Bool.pick(SchemaVerdict, refs_resolve(defs, form_refs(form)), SvOk{}, SvRefused{"declarationRefused"}), SvRefused{"declarationRefused"})

def ambiguity_step(+defs: SchemaDefs, +form: SchemaForm, ambiguous: Bool) -> SchemaVerdict:
  Bool.pick(SchemaVerdict, ambiguous, SvRefused{"ambiguousDeclaration"}, refs_step(defs, form, defs_checked(defs, defs)))

# The declaration preflight. It runs before any value is visited and it covers the root
# form and every definition in the list, so an ambiguous or unresolvable definition
# refuses even when no value would reach it.
def schema_preflight(+defs: SchemaDefs, +form: SchemaForm) -> SchemaVerdict:
  ambiguity_step(defs, form, Bool.pick(Bool, defs_ambiguous(defs), True{}, form_ambiguous(form)))

def schema_declaration_ok(+defs: SchemaDefs) -> SchemaVerdict:
  Bool.pick(SchemaVerdict, defs_ambiguous(defs), SvRefused{"ambiguousDeclaration"},
    Bool.pick(SchemaVerdict, defs_checked(defs, defs), SvOk{}, SvRefused{"declarationRefused"}))

# --- the value walk --------------------------------------------------------

# A text value admits only the text kind, so a number token never admits as text.
def kind_is_text(kind: SchemaScalar) -> SchemaVerdict:
  match kind:
    case SsText{}: SvOk{}
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

def scalar_admit(kind: SchemaScalar, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Rstr{text}: kind_is_text(kind)
    case Codec.Rnum{+token}: number_admit(kind, token)
    case Codec.Rtrue{}: kind_is_bool(kind)
    case Codec.Rfalse{}: kind_is_bool(kind)
    case Codec.Rnull{}: kind_is_null(kind)
    case other: SvRefused{"wrongKind"}

def enum_admit(+literals: NameList, value: Codec.RawValue) -> SchemaVerdict:
  match value:
    case Codec.Rstr{text}: Bool.pick(SchemaVerdict, name_member(literals, text), SvOk{}, SvRefused{"enumLiteral"})
    case other: SvRefused{"wrongKind"}

# A case list binds a tag when some entry declares it.
def case_known(cases: SchemaForm, +tag: String) -> Bool:
  match cases:
    case SfCasesNil{}: False{}
    case SfCasesCons{head, tail}:
      match head:
        case SchemaCase{bound, form}: Bool.pick(Bool, String.eq(bound, tag), True{}, case_known(tail, tag))
        case other: case_known(tail, tag)
    case other: False{}

# The form bound to a tag, or the fallback when no entry binds it. A missed tag
# refuses before the fallback is read, so the fallback never admits a value.
def case_form_or(cases: SchemaForm, +tag: String, +fallback: SchemaForm) -> SchemaForm:
  match cases:
    case SfCasesNil{}: fallback
    case SfCasesCons{head, tail}:
      match head:
        case SchemaCase{bound, form}: Bool.pick(SchemaForm, String.eq(bound, tag), form, case_form_or(tail, tag, fallback))
        case other: case_form_or(tail, tag, fallback)
    case other: fallback

# The member bound to a name, or the fallback when no member binds it. A missed
# member refuses or admits empty before the fallback is read, so the fallback
# never admits a value.
def schema_member_or(+members: Codec.RawValue, +name: String, fallback: Codec.RawValue) -> Codec.RawValue:
  match members:
    case Codec.Rnil{}: fallback
    case Codec.Rpair{+key, +value, +tail}: Bool.pick(Codec.RawValue, String.eq(key, name), value, schema_member_or(tail, name, fallback))
    case other: fallback

# The first refusal wins; an admitted first step defers to the rest.
def verdict_first(inner: SchemaVerdict, rest: SchemaVerdict) -> SchemaVerdict:
  match inner:
    case SvRefused{condition}: SvRefused{condition}
    case SvOk{}: rest

# A refused rest wins; an admitted rest admits a present member value and an
# absent optional member, and refuses a missing required member.
def field_combine(rest: SchemaVerdict, required: Bool, present: Bool, +value: SchemaVerdict) -> SchemaVerdict:
  match rest:
    case SvRefused{condition}: SvRefused{condition}
    case SvOk{}: Bool.pick(SchemaVerdict, present, value, Bool.pick(SchemaVerdict, required, SvRefused{"missingField"}, SvOk{}))

# A value is an object.
def input_is_obj(input: Codec.RawValue) -> Bool:
  match input:
    case Codec.Robj{seen}: True{}
    case other: False{}

# The members of an object value, or the fallback for another value.
def input_obj_members_or(input: Codec.RawValue, fallback: Codec.RawValue) -> Codec.RawValue:
  match input:
    case Codec.Robj{seen}: seen
    case other: fallback

# A value is null.
def input_is_null(input: Codec.RawValue) -> Bool:
  match input:
    case Codec.Rnull{}: True{}
    case other: False{}

# A member spine is empty.
def input_is_nil(input: Codec.RawValue) -> Bool:
  match input:
    case Codec.Rnil{}: True{}
    case other: False{}

# A value is an array cell.
def input_is_arr(input: Codec.RawValue) -> Bool:
  match input:
    case Codec.Rarr{head, tail}: True{}
    case other: False{}

# The head of an array cell, or the fallback for another value.
def array_head_or(input: Codec.RawValue, fallback: Codec.RawValue) -> Codec.RawValue:
  match input:
    case Codec.Rarr{head, tail}: head
    case other: fallback

# The tail of an array cell, or the fallback for another value.
def array_tail_or(input: Codec.RawValue, fallback: Codec.RawValue) -> Codec.RawValue:
  match input:
    case Codec.Rarr{head, tail}: tail
    case other: fallback

# A value is the canonical empty array cell: an array of two empty spines.
def input_is_empty_array(+input: Codec.RawValue) -> Bool:
  Bool.pick(Bool, input_is_arr(input),
    Bool.pick(Bool, input_is_nil(array_head_or(input, Codec.Rnil{})), input_is_nil(array_tail_or(input, Codec.Rnil{})), False{}),
    False{})

# An object member spine carries exactly one member.
def members_singleton(+members: Codec.RawValue) -> Bool:
  match members:
    case Codec.Rpair{+key, +value, Codec.Rnil{}}: True{}
    case other: False{}

# The tag of a member spine, or empty text for another spine.
def members_tag(members: Codec.RawValue) -> String:
  match members:
    case Codec.Rpair{tag, payload, tail}: tag
    case other: SNil{}

# The payload of a member spine, or null for another spine.
def members_payload(members: Codec.RawValue) -> Codec.RawValue:
  match members:
    case Codec.Rpair{tag, payload, tail}: payload
    case other: Codec.Rnull{}

# A field entry is required; other entries take the fallback.
def field_required_or(field: SchemaForm, fallback: Bool) -> Bool:
  match field:
    case SfRequired{name, form}: True{}
    case SfOptionalField{name, form}: False{}
    case other: fallback

# The name of a field entry, or the fallback for another entry.
def field_name_or(field: SchemaForm, fallback: String) -> String:
  match field:
    case SfRequired{name, form}: name
    case SfOptionalField{name, form}: name
    case other: fallback

# The inner form of a field entry, or the fallback for another entry.
def field_form_or(field: SchemaForm, fallback: SchemaForm) -> SchemaForm:
  match field:
    case SfRequired{name, form}: form
    case SfOptionalField{name, form}: form
    case other: fallback

# Members reordered into field-declaration order, keeping present members.
# Duplicates are refused before sorting, so each name is looked up once.
def build_sorted(+fields: SchemaForm, +members: Codec.RawValue) -> Codec.RawValue:
  match fields:
    case SfFieldsNil{}: Codec.Rnil{}
    case SfFieldsCons{head, tail}:
      match head:
        case SfRequired{name, form}: Bool.pick(Codec.RawValue, member_seen(name, members), Codec.Rpair{name, schema_member_or(members, name, Codec.Rnil{}), build_sorted(tail, members)}, build_sorted(tail, members))
        case SfOptionalField{name, form}: Bool.pick(Codec.RawValue, member_seen(name, members), Codec.Rpair{name, schema_member_or(members, name, Codec.Rnil{}), build_sorted(tail, members)}, build_sorted(tail, members))
        case other: build_sorted(tail, members)
    case other: Codec.Rnil{}

def dict_keys_ok(keys: SchemaKeys, members: Codec.RawValue) -> Bool:
  match keys:
    case SkAnyScalarText{}: True{}
    case SkDeclared{+names}: members_declared(names, members)

# A json member value is a leaf. Composite member values admit through the
# modal walk below, which traverses nested objects and arrays directly.
def json_leaf_ok(+value: Codec.RawValue) -> Bool:
  match value:
    case Codec.Rstr{text}: True{}
    case Codec.Rnum{token}: True{}
    case Codec.Rtrue{}: True{}
    case Codec.Rfalse{}: True{}
    case Codec.Rnull{}: True{}
    case other: False{}

# An object member spine admits when every member value admits. The modal walk
# below handles member values, so this spine check stays flat.
def json_member_admit(+members: Codec.RawValue) -> SchemaVerdict:
  match members:
    case Codec.Rnil{}: SvOk{}
    case Codec.Rpair{+key, +value, +tail}:
      Bool.pick(SchemaVerdict, json_leaf_ok(value),
        json_member_admit(tail),
        SvRefused{"wrongKind"})
    case other: SvRefused{"wrongKind"}

# An object admits when its keys are unique and its members admit. The modal
# walk checks keys itself and traverses members directly; this helper keeps the
# duplicate-key mutation anchor.
def json_robj_helper(+members: Codec.RawValue) -> SchemaVerdict:
  Bool.pick(SchemaVerdict, keys_unique(members), json_member_admit(members), SvRefused{"duplicateKey"})

# One self-recursive walk over a value and a mode, so it needs no forward
# reference. The mode names the position: a value admits a json value whole,
# members admits an object member spine, and items admits an array tail. An
# object admits when its keys are unique and its member spine admits in members
# mode, so nested objects and arrays traverse to their leaves. Every self-call
# passes a subterm of the matched value and a mode literal.
def json_walk(value: Codec.RawValue, +mode: String) -> SchemaVerdict:
  match value:
    case Codec.Rnull{}: Bool.pick(SchemaVerdict, String.eq(mode, "value"), SvOk{}, SvRefused{"wrongKind"})
    case Codec.Rtrue{}: Bool.pick(SchemaVerdict, String.eq(mode, "value"), SvOk{}, SvRefused{"wrongKind"})
    case Codec.Rfalse{}: Bool.pick(SchemaVerdict, String.eq(mode, "value"), SvOk{}, SvRefused{"wrongKind"})
    case Codec.Rstr{text}: Bool.pick(SchemaVerdict, String.eq(mode, "value"), SvOk{}, SvRefused{"wrongKind"})
    case Codec.Rnum{token}: Bool.pick(SchemaVerdict, String.eq(mode, "value"), SvOk{}, SvRefused{"wrongKind"})
    case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}: SvOk{}
    case Codec.Rarr{+head, +tail}: Bool.pick(SchemaVerdict, String.eq(mode, "value"), verdict_first(json_walk(head, "value"), json_walk(tail, "items")), Bool.pick(SchemaVerdict, String.eq(mode, "items"), verdict_first(json_walk(head, "value"), json_walk(tail, "items")), SvRefused{"wrongKind"}))
    case Codec.Robj{+members}: Bool.pick(SchemaVerdict, String.eq(mode, "value"), Bool.pick(SchemaVerdict, keys_unique(members), json_walk(members, "members"), SvRefused{"duplicateKey"}), SvRefused{"wrongKind"})
    case Codec.Rnil{}: Bool.pick(SchemaVerdict, String.eq(mode, "value"), SvRefused{"wrongKind"}, SvOk{})
    case Codec.Rpair{key, val, tail}: Bool.pick(SchemaVerdict, String.eq(mode, "members"), verdict_first(json_walk(val, "value"), json_walk(tail, "members")), SvRefused{"wrongKind"})
    case other: SvRefused{"wrongKind"}

# A leaf form admits a leaf value. Composite values refuse here; the main walk
# admits them. Scalar and enum checks reuse the shared kind checks.
def leaf_admit(+form: SchemaForm, +value: Codec.RawValue) -> SchemaVerdict:
  match form:
    case SfScalar{kind}:
      match value:
        case Codec.Rstr{text}: kind_is_text(kind)
        case Codec.Rnum{+token}: number_admit(kind, token)
        case Codec.Rtrue{}: kind_is_bool(kind)
        case Codec.Rfalse{}: kind_is_bool(kind)
        case Codec.Rnull{}: kind_is_null(kind)
        case other: SvRefused{"wrongKind"}
    case SfEnum{+literals}:
      match value:
        case Codec.Rstr{text}: Bool.pick(SchemaVerdict, name_member(literals, text), SvOk{}, SvRefused{"enumLiteral"})
        case other: SvRefused{"wrongKind"}
    case other: SvRefused{"wrongKind"}

# A record spine admits an object member spine in order. The head field meets
# the head member: equal names admit the value and advance both spines, and a
# name mismatch refuses. An empty member spine admits exactly when no required
# field remains, which the covered check decides.
# Nested value admission: the general walk for values inside fields, array
# elements and dict members. Substitution inlines bound references before any
# walk, so a reference here is unbound and refused. Records sort members into
# field order before the fused fields loop; arrays, dicts and unions loop
# through fused value matches. A union miss rebuilds the member spine from
# its binders and continues with the remaining cases.
def nest_admit(+form: SchemaForm, +value: Codec.RawValue) -> SchemaVerdict:
  match form:
    case SfScalar{kind}:
      scalar_admit(kind, value)
    case SfEnum{literals}:
      enum_admit(literals, value)
    case SfJson{}:
      json_walk(value, "value")
    case SfRequired{name, fform}:
      nest_admit(fform, value)
    case SfOptionalField{name, fform}:
      nest_admit(fform, value)
    case SchemaCase{tag, fform}:
      nest_admit(fform, value)
    case SfOptional{inner}:
      Bool.pick(SchemaVerdict, input_is_null(value), SvOk{}, nest_admit(inner, value))
    case SfRef{+name}:
      SvRefused{"unknownReference"}
    case SfRecord{+fields}:
      match value:
        case Codec.Robj{+members}:
          Bool.pick(SchemaVerdict, keys_unique(members),
            Bool.pick(SchemaVerdict, members_declared(field_names(fields), members),
              Bool.pick(SchemaVerdict, fields_covered(fields, members),
                nest_admit(fields, build_sorted(fields, members)),
                SvRefused{"missingField"}),
              SvRefused{"undeclaredField"}),
            SvRefused{"duplicateKey"})
        case Codec.Rnil{}:
          Bool.pick(SchemaVerdict, fields_covered(fields, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
        case other: SvRefused{"wrongKind"}
    case SfFieldsCons{head, tail}:
      match head:
        case SfRequired{name, fform}:
          match value:
            case Codec.Rnil{}:
              Bool.pick(SchemaVerdict, fields_covered(tail, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
            case Codec.Rpair{k, v, t}:
              Bool.pick(SchemaVerdict, String.eq(name, k),
                verdict_first(nest_admit(fform, v), nest_admit(tail, t)),
                SvRefused{"missingField"})
            case other: SvRefused{"wrongKind"}
        case SfOptionalField{name, fform}:
          match value:
            case Codec.Rnil{}:
              Bool.pick(SchemaVerdict, fields_covered(tail, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
            case Codec.Rpair{k, v, t}:
              Bool.pick(SchemaVerdict, String.eq(name, k),
                verdict_first(nest_admit(fform, v), nest_admit(tail, t)),
                nest_admit(tail, value))
            case other: SvRefused{"wrongKind"}
        case other:
          match value:
            case Codec.Rpair{k, v, t}: SvRefused{"declarationRefused"}
            case Codec.Rnil{}:
              Bool.pick(SchemaVerdict, fields_covered(tail, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
            case other: SvRefused{"wrongKind"}
    case SfFieldsNil{}:
      match value:
        case Codec.Rnil{}: SvOk{}
        case Codec.Rpair{k, v, t}: SvRefused{"undeclaredField"}
        case other: SvRefused{"wrongKind"}
    case SfUnion{cases}:
      match value:
        case Codec.Robj{+members}:
          Bool.pick(SchemaVerdict, members_singleton(members),
            nest_admit(cases, members),
            SvRefused{"wrongKind"})
        case other: SvRefused{"wrongKind"}
    case SfCasesCons{SchemaCase{bound, f}, ctail}:
      match value:
        case Codec.Rpair{tag, payload, tail}:
          Bool.pick(SchemaVerdict, String.eq(tag, bound),
            nest_admit(f, payload),
            nest_admit(ctail, Codec.Rpair{tag, payload, tail}))
        case other: SvRefused{"wrongKind"}
    case SfCasesCons{other, ctail}:
      SvRefused{"declarationRefused"}
    case SfCasesNil{}:
      match value:
        case Codec.Rpair{tag, payload, tail}: SvRefused{"unknownTag"}
        case other: SvRefused{"wrongKind"}
    case SfArray{item}:
      match value:
        case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}: SvOk{}
        case Codec.Rarr{+h, +t}:
          verdict_first(nest_admit(item, h), nest_admit(form, t))
        case Codec.Rnil{}: SvOk{}
        case other: SvRefused{"wrongKind"}
    case SfDict{keys, vform}:
      match value:
        case Codec.Rnil{}: SvOk{}
        case Codec.Robj{+members}:
          Bool.pick(SchemaVerdict, keys_unique(members),
            Bool.pick(SchemaVerdict, dict_keys_ok(keys, members),
              nest_admit(form, members),
              SvRefused{"dictKeyRefused"}),
            SvRefused{"duplicateKey"})
        case Codec.Rpair{+key, +found, +tail}:
          verdict_first(nest_admit(vform, found),
            nest_admit(form, tail))
        case other: SvRefused{"wrongKind"}

# A sorted member spine admits against the field spine in order. A present
# member admits its value and both spines advance; an absent optional field
# skips its field. A required field with no member refuses.
def sorted_loop(+defs: SchemaDefs, +fields: SchemaForm, +sorted: Codec.RawValue) -> SchemaVerdict:
  match fields:
    case SfFieldsCons{SfRequired{name, fform}, ftail}:
      match sorted:
        case Codec.Rnil{}:
          Bool.pick(SchemaVerdict, fields_covered(ftail, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
        case Codec.Rpair{k, v, t}:
          Bool.pick(SchemaVerdict, String.eq(name, k),
            verdict_first(nest_admit(fform, v), sorted_loop(defs, ftail, t)),
            SvRefused{"missingField"})
        case other: SvRefused{"wrongKind"}
    case SfFieldsCons{SfOptionalField{name, fform}, ftail}:
      match sorted:
        case Codec.Rnil{}:
          Bool.pick(SchemaVerdict, fields_covered(ftail, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
        case Codec.Rpair{k, v, t}:
          Bool.pick(SchemaVerdict, String.eq(name, k),
            verdict_first(nest_admit(fform, v), sorted_loop(defs, ftail, t)),
            sorted_loop(defs, ftail, sorted))
        case other: SvRefused{"wrongKind"}
    case SfFieldsNil{}:
      match sorted:
        case Codec.Rnil{}: SvOk{}
        case Codec.Rpair{k, v, t}: SvRefused{"undeclaredField"}
        case other: SvRefused{"wrongKind"}
    case other:
      match sorted:
        case Codec.Rnil{}:
          Bool.pick(SchemaVerdict, fields_covered(fields, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
        case Codec.Rpair{k, v, t}: SvRefused{"declarationRefused"}
        case other: SvRefused{"wrongKind"}

# A record spine admits an object member spine in field-declaration order. The
# members sort first, so declaration order never refuses a closed object.
def fields_admit(defs: SchemaDefs, +fields: SchemaForm, +members: Codec.RawValue) -> SchemaVerdict:
  match members:
    case Codec.Rnil{}:
      Bool.pick(SchemaVerdict, fields_covered(fields, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
    case Codec.Rpair{k, v, t}:
      Bool.pick(SchemaVerdict, fields_covered(fields, members),
        sorted_loop(defs, fields, build_sorted(fields, members)),
        SvRefused{"missingField"})
    case other: SvRefused{"wrongKind"}

# A record value admits through the member checks and the field spine. The
# declared check stays outside the field walk, so dropping it admits more.
def record_enter_helper(+defs: SchemaDefs, +fields: SchemaForm, +input: Codec.RawValue) -> SchemaVerdict:
  match input:
    case Codec.Robj{+members}:
      Bool.pick(SchemaVerdict, keys_unique(members),
        Bool.pick(SchemaVerdict, members_declared(field_names(fields), members), fields_admit(defs, fields, members), SvRefused{"undeclaredField"}),
        SvRefused{"duplicateKey"})
    case Codec.Rnil{}:
      Bool.pick(SchemaVerdict, fields_covered(fields, Codec.Rnil{}), SvOk{}, SvRefused{"missingField"})
    case other: SvRefused{"wrongKind"}

# An array tail admits element by element: the previous head admits, then the
# rest continues with its own head. The rest shrinks on every self-call, so the
# previous head rides past the shrink.
def array_tail_admit(+defs: SchemaDefs, +item: SchemaForm, +rest: Codec.RawValue, +prev: Codec.RawValue) -> SchemaVerdict:
  match rest:
    case Codec.Rnil{}: nest_admit(item, prev)
    case Codec.Rarr{+h, +t}: verdict_first(nest_admit(item, prev), array_tail_admit(defs, item, t, h))
    case other: SvRefused{"wrongKind"}

# An array head admits and the tail continues through the tail loop on the
# same item form.
def array_head_admit(+defs: SchemaDefs, +item: SchemaForm, +head: Codec.RawValue, +tail: Codec.RawValue) -> SchemaVerdict:
  match tail:
    case Codec.Rnil{}: nest_admit(item, head)
    case Codec.Rarr{+h, +t}: verdict_first(nest_admit(item, head), array_tail_admit(defs, item, t, h))
    case other: SvRefused{"wrongKind"}

# An array value admits on the empty sentinel or through the head loop.
def array_enter_helper(+defs: SchemaDefs, +item: SchemaForm, +input: Codec.RawValue) -> SchemaVerdict:
  match input:
    case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}: SvOk{}
    case Codec.Rarr{+head, +tail}: array_head_admit(defs, item, head, tail)
    case other: SvRefused{"wrongKind"}

# A dictionary member spine admits when every member value admits the value
# form. Declared keys are checked by the caller.
def dict_member_admit(+value: SchemaForm, +members: Codec.RawValue) -> SchemaVerdict:
  match members:
    case Codec.Rnil{}: SvOk{}
    case Codec.Rpair{+key, +found, +tail}:
      verdict_first(nest_admit(value, found), dict_member_admit(value, tail))
    case other: SvRefused{"wrongKind"}

def json_admit(value: Codec.RawValue) -> SchemaVerdict:
  json_walk(value, "value")

# Append two definition spines. The left spine rebuilds cell by cell, so each
# input node below contributes fresh fuel cells.
def fuel_append(+left: SchemaDefs, +right: SchemaDefs) -> SchemaDefs:
  match left:
    case DefsNil{}: right
    case DefsCons{+head, +tail}: DefsCons{head, fuel_append(tail, right)}

# Substitution fuel from the input value: one definition-spine copy per input
# node. A guarded cycle revisits definitions only through value-consuming
# constructors, so each input node funds at most a definition count of
# inlinings along any substitution path.
def input_fuel(+input: Codec.RawValue, +defs: SchemaDefs) -> SchemaDefs:
  match input:
    case Codec.Rnil{}: DefsNil{}
    case Codec.Rpair{key, val, tail}: fuel_append(defs, fuel_append(input_fuel(val, defs), input_fuel(tail, defs)))
    case Codec.Rarr{head, tail}: fuel_append(defs, fuel_append(input_fuel(head, defs), input_fuel(tail, defs)))
    case Codec.Robj{members}: fuel_append(defs, input_fuel(members, defs))
    case Codec.Rstr{text}: defs
    case Codec.Rnum{token}: defs
    case Codec.Rtrue{}: defs
    case Codec.Rfalse{}: defs
    case Codec.Rnull{}: defs
    case other: DefsNil{}

# Reference substitution. A bound reference inlines the bound body, so the value
# walk never descends into a looked-up definition; the definition scan finds
# the body and reports whether the name is bound. An unbound name stays as a
# reference and the walk refuses it. The fuel burns one cell per inlined body
# and comes from the input value: unguarded cycles are refused by the preflight
# first, and a guarded cycle revisits definitions only through value-consuming
# constructors, so the fuel covers every substitution path. Exhausted fuel
# leaves the form in place; any reference left behind is unbound and refused
# by the walk.
def subst_form(+fuel: SchemaDefs, +form: SchemaForm, +defs: SchemaDefs) -> SchemaForm:
  match fuel:
    case DefsNil{}: form
    case DefsCons{subst_head, subst_tail}:
      match form:
        case SfRef{name}:
          Bool.pick(SchemaForm, scan_found(defs, name),
            subst_form(subst_tail, def_body_or(defs, name), defs),
            SfRef{name})
        case SfRecord{fields}: SfRecord{subst_form(fuel, fields, defs)}
        case SfFieldsCons{head, tail}: SfFieldsCons{subst_form(fuel, head, defs), subst_form(fuel, tail, defs)}
        case SfFieldsNil{}: SfFieldsNil{}
        case SfUnion{cases}: SfUnion{subst_form(fuel, cases, defs)}
        case SfCasesCons{head, tail}: SfCasesCons{subst_form(fuel, head, defs), subst_form(fuel, tail, defs)}
        case SfCasesNil{}: SfCasesNil{}
        case SfDict{keys, value}: SfDict{keys, subst_form(fuel, value, defs)}
        case SfOptional{inner}: SfOptional{subst_form(fuel, inner, defs)}
        case SfArray{item}: SfArray{subst_form(fuel, item, defs)}
        case SfEnum{literals}: SfEnum{literals}
        case SfScalar{kind}: SfScalar{kind}
        case SfJson{}: SfJson{}
        case SfRequired{name, fform}: SfRequired{name, subst_form(fuel, fform, defs)}
        case SfOptionalField{name, fform}: SfOptionalField{name, subst_form(fuel, fform, defs)}
        case SchemaCase{tag, fform}: SchemaCase{tag, subst_form(fuel, fform, defs)}

# The internal walker. Only `schema_admit_value` reaches it on a checked declaration.
# One self-recursive walk over a declaration form and a value, so it needs no
# forward reference. The form is matched first and the value second, after the
# raw-value-first pattern of the wire reader. Substitution inlines bound
# references before the walk, so the genuinely descending arguments are the
# form and value subterms, the saved context, and the twin spine the union
# entry saved. A bare field or case form admits what its inner form admits. A
# reference that reaches the walk is unbound and refused.
def schema_walk(+form: SchemaForm, +defs: SchemaDefs, +input: Codec.RawValue, +ctxd: SchemaDefs, +twin: Codec.RawValue) -> SchemaVerdict:
  match form:
    case SfArray{item}:
      Bool.pick(SchemaVerdict, input_is_nil(input), SvOk{}, array_enter_helper(defs, item, input))
    case SfFieldsNil{}:
      match input:
        case Codec.Rpair{k, v, t}: SvRefused{"undeclaredField"}
        case Codec.Rnil{}: SvOk{}
        case other: SvRefused{"wrongKind"}
    case SfRecord{+fields}:
      record_enter_helper(defs, fields, input)
    case SfUnion{cases}:
      match input:
        case Codec.Robj{+members}:
          Bool.pick(SchemaVerdict, members_singleton(members),
            schema_walk(cases, defs, members, ctxd, members),
            SvRefused{"wrongKind"})
        case other: SvRefused{"wrongKind"}
    case SfCasesCons{SchemaCase{bound, f}, ctail}:
      match input:
        case Codec.Rpair{tag, payload, tail}:
          Bool.pick(SchemaVerdict, String.eq(tag, bound),
            schema_walk(f, defs, payload, ctxd, twin),
            schema_walk(ctail, defs, twin, ctxd, twin))
        case other: SvRefused{"wrongKind"}
    case SfCasesCons{other, ctail}:
      SvRefused{"declarationRefused"}
    case SfCasesNil{}:
      match input:
        case Codec.Rpair{tag, payload, tail}: SvRefused{"unknownTag"}
        case other: SvRefused{"wrongKind"}
    case SfDict{keys, value}:
      match input:
        case Codec.Robj{+members}:
          Bool.pick(SchemaVerdict, keys_unique(members),
            Bool.pick(SchemaVerdict, dict_keys_ok(keys, members),
              dict_member_admit(value, members),
              SvRefused{"dictKeyRefused"}),
            SvRefused{"duplicateKey"})
        case Codec.Rnil{}: SvOk{}
        case other: SvRefused{"wrongKind"}
    case SfRef{+name}:
      SvRefused{"unknownReference"}
    case SfOptional{inner}:
      Bool.pick(SchemaVerdict, input_is_null(input), SvOk{}, schema_walk(inner, defs, input, ctxd, twin))
    case SfEnum{literals}:
      enum_admit(literals, input)
    case SfScalar{kind}:
      scalar_admit(kind, input)
    case SfJson{}:
      json_walk(input, "value")
    case SfRequired{name, fform}:
      schema_walk(fform, defs, input, ctxd, twin)
    case SfOptionalField{name, fform}:
      schema_walk(fform, defs, input, ctxd, twin)
    case SchemaCase{tag, fform}:
      schema_walk(fform, defs, input, ctxd, twin)
    case other: SvRefused{"wrongKind"}

# The checked public entry: the declaration preflight runs first, over the definitions
# and over the root form, then bound references substitute with fuel from the input
# value, and only then is the value walked.
def admit_step(+defs: SchemaDefs, +form: SchemaForm, +input: Codec.RawValue, verdict: SchemaVerdict) -> SchemaVerdict:
  match verdict:
    case SvRefused{condition}: SvRefused{condition}
    case SvOk{}: schema_walk(subst_form(input_fuel(input, defs), form, defs), defs, input, defs, Codec.Rnil{})

def schema_admit_value(+defs: SchemaDefs, +form: SchemaForm, +input: Codec.RawValue) -> SchemaVerdict:
  admit_step(defs, form, input, schema_preflight(defs, form))

# --- laws ------------------------------------------------------------------

law schema_law_a_closed_record_admits_a_declared_field:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_closed_record_admits_a_declared_field():
  {==}

law schema_law_a_closed_record_refuses_an_undeclared_field:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rpair{"other", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvRefused{"undeclaredField"} : SchemaVerdict}

def schema_law_a_closed_record_refuses_an_undeclared_field():
  {==}

law schema_law_a_missing_required_field_refuses:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rnil{}}) == SvRefused{"missingField"} : SchemaVerdict}

def schema_law_a_missing_required_field_refuses():
  {==}

law schema_law_an_absent_optional_field_admits:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfOptionalField{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rnil{}}) == SvOk{} : SchemaVerdict}

def schema_law_an_absent_optional_field_admits():
  {==}

law schema_law_a_duplicate_decoded_member_refuses:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rnil{}}}}) == SvRefused{"duplicateKey"} : SchemaVerdict}

def schema_law_a_duplicate_decoded_member_refuses():
  {==}

law schema_law_an_enum_accepts_a_declared_literal:
  {schema_admit_value(DefsNil{}, SfEnum{NlCons{"a", NlCons{"b", NlNil{}}}}, Codec.Rstr{"b"}) == SvOk{} : SchemaVerdict}

def schema_law_an_enum_accepts_a_declared_literal():
  {==}

law schema_law_an_enum_refuses_another_literal:
  {schema_admit_value(DefsNil{}, SfEnum{NlCons{"a", NlCons{"b", NlNil{}}}}, Codec.Rstr{"c"}) == SvRefused{"enumLiteral"} : SchemaVerdict}

def schema_law_an_enum_refuses_another_literal():
  {==}

law schema_law_an_enum_with_a_repeated_literal_is_ambiguous:
  {schema_preflight(DefsNil{}, SfEnum{NlCons{"a", NlCons{"a", NlNil{}}}}) == SvRefused{"ambiguousDeclaration"} : SchemaVerdict}

def schema_law_an_enum_with_a_repeated_literal_is_ambiguous():
  {==}

law schema_law_the_number_profile_keeps_a_token_distinct_from_text:
  {schema_admit_value(DefsNil{}, SfScalar{SsNumberToken{}}, Codec.Rstr{"1e400"}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_the_number_profile_keeps_a_token_distinct_from_text():
  {==}

law schema_law_the_number_profile_admits_an_exact_token:
  {schema_admit_value(DefsNil{}, SfScalar{SsNumberToken{}}, Codec.Rnum{"1e400"}) == SvOk{} : SchemaVerdict}

def schema_law_the_number_profile_admits_an_exact_token():
  {==}

law schema_law_the_u32_profile_refuses_a_wider_token:
  {schema_admit_value(DefsNil{}, SfScalar{SsU32Token{}}, Codec.Rnum{"4294967296"}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_the_u32_profile_refuses_a_wider_token():
  {==}

law schema_law_an_array_is_visited_to_its_last_element:
  {schema_admit_value(DefsNil{}, SfArray{SfScalar{SsText{}}}, Codec.Rarr{Codec.Rstr{"a"}, Codec.Rarr{Codec.Rstr{"b"}, Codec.Rarr{Codec.Rnum{"1"}, Codec.Rnil{}}}}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_an_array_is_visited_to_its_last_element():
  {==}

law schema_law_the_canonical_empty_array_admits_an_array_position:
  {schema_admit_value(DefsNil{}, SfArray{SfScalar{SsText{}}}, Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}) == SvOk{} : SchemaVerdict}

def schema_law_the_canonical_empty_array_admits_an_array_position():
  {==}

law schema_law_the_canonical_empty_array_admits_the_json_profile:
  {json_admit(Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}) == SvOk{} : SchemaVerdict}

def schema_law_the_canonical_empty_array_admits_the_json_profile():
  {==}

law schema_law_a_json_object_refuses_a_duplicate_member:
  {json_admit(Codec.Robj{Codec.Rpair{"k", Codec.Rstr{"a"}, Codec.Rpair{"k", Codec.Rstr{"b"}, Codec.Rnil{}}}}) == SvRefused{"duplicateKey"} : SchemaVerdict}

def schema_law_a_json_object_refuses_a_duplicate_member():
  {==}

law schema_law_a_dictionary_without_a_declared_key_refuses:
  {schema_admit_value(DefsNil{}, SfDict{SkDeclared{NlCons{"k", NlNil{}}}, SfScalar{SsText{}}}, Codec.Robj{Codec.Rpair{"other", Codec.Rstr{"a"}, Codec.Rnil{}}}) == SvRefused{"dictKeyRefused"} : SchemaVerdict}

def schema_law_a_dictionary_without_a_declared_key_refuses():
  {==}

law schema_law_an_unguarded_cycle_refuses:
  {schema_preflight(DefsCons{SchemaDef{"row", SfRef{"row"}}, DefsNil{}}, SfRef{"row"}) == SvRefused{"declarationRefused"} : SchemaVerdict}

def schema_law_an_unguarded_cycle_refuses():
  {==}

law schema_law_a_cycle_through_an_array_is_guarded:
  {schema_preflight(DefsCons{SchemaDef{"row", SfArray{SfRef{"row"}}}, DefsNil{}}, SfRef{"row"}) == SvOk{} : SchemaVerdict}

def schema_law_a_cycle_through_an_array_is_guarded():
  {==}

law schema_law_a_cycle_through_a_dictionary_is_guarded:
  {schema_preflight(DefsCons{SchemaDef{"row", SfDict{SkAnyScalarText{}, SfRef{"row"}}}, DefsNil{}}, SfRef{"row"}) == SvOk{} : SchemaVerdict}

def schema_law_a_cycle_through_a_dictionary_is_guarded():
  {==}

law schema_law_an_unknown_reference_refuses:
  {schema_preflight(DefsCons{SchemaDef{"row", SfRef{"missing"}}, DefsNil{}}, SfRef{"row"}) == SvRefused{"declarationRefused"} : SchemaVerdict}

def schema_law_an_unknown_reference_refuses():
  {==}

# A definition may name one written after it, and the environment is the whole list.
law schema_law_a_forward_reference_resolves_and_admits:
  {schema_admit_value(DefsCons{SchemaDef{"a", SfScalar{SsText{}}}, DefsCons{SchemaDef{"b", SfRef{"a"}}, DefsNil{}}}, SfRef{"b"}, Codec.Rstr{"x"}) == SvOk{} : SchemaVerdict}

def schema_law_a_forward_reference_resolves_and_admits():
  {==}

law schema_law_a_backward_reference_resolves_and_admits:
  {schema_admit_value(DefsCons{SchemaDef{"b", SfRef{"a"}}, DefsCons{SchemaDef{"a", SfScalar{SsText{}}}, DefsNil{}}}, SfRef{"b"}, Codec.Rstr{"x"}) == SvOk{} : SchemaVerdict}

def schema_law_a_backward_reference_resolves_and_admits():
  {==}

# A reference in a position no value walk reaches still refuses at the preflight.
law schema_law_a_missing_reference_in_an_optional_position_refuses:
  {schema_preflight(DefsNil{}, SfOptional{SfRef{"missing"}}) == SvRefused{"declarationRefused"} : SchemaVerdict}

def schema_law_a_missing_reference_in_an_optional_position_refuses():
  {==}

law schema_law_a_missing_reference_in_an_unused_dictionary_refuses:
  {schema_preflight(DefsNil{}, SfDict{SkAnyScalarText{}, SfRef{"missing"}}) == SvRefused{"declarationRefused"} : SchemaVerdict}

def schema_law_a_missing_reference_in_an_unused_dictionary_refuses():
  {==}

law schema_law_a_repeated_definition_name_is_ambiguous:
  {schema_preflight(DefsCons{SchemaDef{"a", SfScalar{SsText{}}}, DefsCons{SchemaDef{"a", SfScalar{SsText{}}}, DefsNil{}}}, SfRef{"a"}) == SvRefused{"ambiguousDeclaration"} : SchemaVerdict}

def schema_law_a_repeated_definition_name_is_ambiguous():
  {==}

law schema_law_a_repeated_record_field_name_is_ambiguous:
  {schema_preflight(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"n", SfScalar{SsText{}}}, SfFieldsCons{SfRequired{"n", SfScalar{SsText{}}}, SfFieldsNil{}}}}) == SvRefused{"ambiguousDeclaration"} : SchemaVerdict}

def schema_law_a_repeated_record_field_name_is_ambiguous():
  {==}

law schema_law_a_repeated_union_tag_is_ambiguous:
  {schema_preflight(DefsNil{}, SfUnion{SfCasesCons{SchemaCase{"t", SfScalar{SsText{}}}, SfCasesCons{SchemaCase{"t", SfScalar{SsText{}}}, SfCasesNil{}}}}) == SvRefused{"ambiguousDeclaration"} : SchemaVerdict}

def schema_law_a_repeated_union_tag_is_ambiguous():
  {==}

# The preflight covers the definitions, not only the root form, so an ambiguous
# definition refuses even when the root form never reaches it.
law schema_law_an_ambiguous_definition_refuses_through_a_named_reference:
  {schema_preflight(DefsCons{SchemaDef{"a", SfUnion{SfCasesCons{SchemaCase{"t", SfScalar{SsText{}}}, SfCasesCons{SchemaCase{"t", SfScalar{SsText{}}}, SfCasesNil{}}}}}, DefsNil{}}, SfRef{"a"}) == SvRefused{"ambiguousDeclaration"} : SchemaVerdict}

def schema_law_an_ambiguous_definition_refuses_through_a_named_reference():
  {==}

law schema_law_an_unreachable_ambiguous_definition_still_refuses:
  {schema_preflight(DefsCons{SchemaDef{"a", SfScalar{SsText{}}}, DefsCons{SchemaDef{"b", SfRecord{SfFieldsCons{SfRequired{"n", SfScalar{SsText{}}}, SfFieldsCons{SfRequired{"n", SfScalar{SsText{}}}, SfFieldsNil{}}}}}, DefsNil{}}}, SfRef{"a"}) == SvRefused{"ambiguousDeclaration"} : SchemaVerdict}

def schema_law_an_unreachable_ambiguous_definition_still_refuses():
  {==}

# A tagged union carries one object member per level, so a recursive union admits a
# finite value: the child case nests and the leaf case ends the value.
law schema_law_a_recursive_tagged_union_admits_a_finite_value:
  {schema_admit_value(DefsCons{SchemaDef{"node", SfUnion{SfCasesCons{SchemaCase{"leaf", SfScalar{SsNull{}}}, SfCasesCons{SchemaCase{"child", SfRef{"node"}}, SfCasesNil{}}}}}, DefsNil{}}, SfRef{"node"}, Codec.Robj{Codec.Rpair{"child", Codec.Robj{Codec.Rpair{"leaf", Codec.Rnull{}, Codec.Rnil{}}}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_recursive_tagged_union_admits_a_finite_value():
  {==}

law schema_law_a_local_reference_resolves_and_admits:
  {schema_admit_value(DefsCons{SchemaDef{"row", SfScalar{SsText{}}}, DefsNil{}}, SfRef{"row"}, Codec.Rstr{"x"}) == SvOk{} : SchemaVerdict}

def schema_law_a_local_reference_resolves_and_admits():
  {==}

law schema_law_a_union_member_admits_its_case:
  {schema_admit_value(DefsNil{}, SfUnion{SfCasesCons{SchemaCase{"text", SfScalar{SsText{}}}, SfCasesNil{}}}, Codec.Robj{Codec.Rpair{"text", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_union_member_admits_its_case():
  {==}

law schema_law_a_union_member_refuses_an_unknown_tag:
  {schema_admit_value(DefsNil{}, SfUnion{SfCasesCons{SchemaCase{"text", SfScalar{SsText{}}}, SfCasesNil{}}}, Codec.Robj{Codec.Rpair{"other", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvRefused{"unknownTag"} : SchemaVerdict}

def schema_law_a_union_member_refuses_an_unknown_tag():
  {==}

# A duplicate-heavy branching frontier still finds a later cycle: sibling
# branches reuse fuel instead of burning one cell per queued name.
law schema_law_a_duplicate_branching_frontier_still_finds_its_cycle:
  {schema_preflight(DefsCons{SchemaDef{"a", SfFieldsCons{SfRequired{"x", SfRef{"b"}}, SfFieldsCons{SfRequired{"y", SfRef{"b"}}, SfFieldsCons{SfRequired{"z", SfRef{"b"}}, SfFieldsCons{SfRequired{"w", SfRef{"a"}}, SfFieldsNil{}}}}}}, DefsCons{SchemaDef{"b", SfScalar{SsText{}}}, DefsNil{}}}, SfRef{"a"}) == SvRefused{"declarationRefused"} : SchemaVerdict}

def schema_law_a_duplicate_branching_frontier_still_finds_its_cycle():
  {==}

# Proof control: duplicates alone are not a cycle, so the same shape without
# the back edge admits the preflight.
law schema_law_duplicates_without_a_back_edge_admit_the_preflight:
  {schema_preflight(DefsCons{SchemaDef{"a", SfFieldsCons{SfRequired{"x", SfRef{"b"}}, SfFieldsCons{SfRequired{"y", SfRef{"b"}}, SfFieldsCons{SfRequired{"z", SfRef{"b"}}, SfFieldsNil{}}}}}, DefsCons{SchemaDef{"b", SfScalar{SsText{}}}, DefsNil{}}}, SfRef{"a"}) == SvOk{} : SchemaVerdict}

def schema_law_duplicates_without_a_back_edge_admit_the_preflight():
  {==}

# A reference skips a nonmatching first entry and resolves on a later one.
law schema_law_a_reference_skips_a_nonmatching_entry:
  {schema_admit_value(DefsCons{SchemaDef{"x", SfScalar{SsNumberToken{}}}, DefsCons{SchemaDef{"y", SfScalar{SsText{}}}, DefsNil{}}}, SfRef{"y"}, Codec.Rstr{"v"}) == SvOk{} : SchemaVerdict}

def schema_law_a_reference_skips_a_nonmatching_entry():
  {==}

# Proof control: resolving to the first entry keeps its own kind.
law schema_law_a_reference_to_the_first_entry_keeps_its_kind:
  {schema_admit_value(DefsCons{SchemaDef{"x", SfScalar{SsNumberToken{}}}, DefsCons{SchemaDef{"y", SfScalar{SsText{}}}, DefsNil{}}}, SfRef{"x"}, Codec.Rstr{"v"}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_a_reference_to_the_first_entry_keeps_its_kind():
  {==}

# A chained reference resolves forward through a later definition.
law schema_law_a_chained_forward_reference_resolves:
  {schema_admit_value(DefsCons{SchemaDef{"early", SfScalar{SsNumberToken{}}}, DefsCons{SchemaDef{"later", SfScalar{SsText{}}}, DefsCons{SchemaDef{"user", SfRef{"later"}}, DefsNil{}}}}, SfRef{"user"}, Codec.Rstr{"v"}) == SvOk{} : SchemaVerdict}

def schema_law_a_chained_forward_reference_resolves():
  {==}

# A union case body resolves its reference inside the nested case search.
law schema_law_a_nested_union_case_reference_resolves:
  {schema_admit_value(DefsCons{SchemaDef{"m", SfScalar{SsNumberToken{}}}, DefsCons{SchemaDef{"z", SfScalar{SsText{}}}, DefsNil{}}}, SfUnion{SfCasesCons{SchemaCase{"t", SfRef{"z"}}, SfCasesNil{}}}, Codec.Robj{Codec.Rpair{"t", Codec.Rstr{"v"}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_nested_union_case_reference_resolves():
  {==}

# A guarded recursive union admits a chain deeper than twice the definition count.
law schema_law_a_deep_guarded_union_chain_admits:
  {schema_admit_value(DefsCons{SchemaDef{"node", SfUnion{SfCasesCons{SchemaCase{"c", SfRef{"node"}}, SfCasesCons{SchemaCase{"z", SfScalar{SsText{}}}, SfCasesNil{}}}}}, DefsNil{}}, SfRef{"node"}, Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"z", Codec.Rstr{"x"}, Codec.Rnil{}}}, Codec.Rnil{}}}, Codec.Rnil{}}}, Codec.Rnil{}}}, Codec.Rnil{}}}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_deep_guarded_union_chain_admits():
  {==}

# Proof control: the same deep chain with a number leaf refuses on the kind.
law schema_law_a_deep_guarded_union_chain_refuses_a_wrong_leaf:
  {schema_admit_value(DefsCons{SchemaDef{"node", SfUnion{SfCasesCons{SchemaCase{"c", SfRef{"node"}}, SfCasesCons{SchemaCase{"z", SfScalar{SsText{}}}, SfCasesNil{}}}}}, DefsNil{}}, SfRef{"node"}, Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"z", Codec.Rnum{"1"}, Codec.Rnil{}}}, Codec.Rnil{}}}, Codec.Rnil{}}}, Codec.Rnil{}}}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_a_deep_guarded_union_chain_refuses_a_wrong_leaf():
  {==}

# Proof control: the same deep chain with an undeclared tag refuses on the tag.
law schema_law_a_deep_guarded_union_chain_refuses_an_unknown_tag:
  {schema_admit_value(DefsCons{SchemaDef{"node", SfUnion{SfCasesCons{SchemaCase{"c", SfRef{"node"}}, SfCasesCons{SchemaCase{"z", SfScalar{SsText{}}}, SfCasesNil{}}}}}, DefsNil{}}, SfRef{"node"}, Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"c", Codec.Robj{Codec.Rpair{"q", Codec.Rstr{"x"}, Codec.Rnil{}}}, Codec.Rnil{}}}, Codec.Rnil{}}}) == SvRefused{"unknownTag"} : SchemaVerdict}

def schema_law_a_deep_guarded_union_chain_refuses_an_unknown_tag():
  {==}

# A nested json object traverses to its leaves.
law schema_law_a_nested_json_object_admits:
  {json_admit(Codec.Robj{Codec.Rpair{"a", Codec.Robj{Codec.Rpair{"b", Codec.Rnum{"1"}, Codec.Rnil{}}}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_nested_json_object_admits():
  {==}

# A nested json array traverses to its leaves.
law schema_law_a_nested_json_array_admits:
  {json_admit(Codec.Robj{Codec.Rpair{"a", Codec.Rarr{Codec.Rnum{"1"}, Codec.Rnil{}}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_nested_json_array_admits():
  {==}

# Proof control: a duplicate key inside a nested object still refuses.
law schema_law_a_nested_json_duplicate_key_refuses:
  {json_admit(Codec.Robj{Codec.Rpair{"a", Codec.Robj{Codec.Rpair{"k", Codec.Rstr{"x"}, Codec.Rpair{"k", Codec.Rstr{"y"}, Codec.Rnil{}}}}, Codec.Rnil{}}}) == SvRefused{"duplicateKey"} : SchemaVerdict}

def schema_law_a_nested_json_duplicate_key_refuses():
  {==}

# Proof control: a member spine is not a json value.
law schema_law_a_bare_member_spine_is_not_a_json_value:
  {json_admit(Codec.Rpair{"k", Codec.Rstr{"v"}, Codec.Rnil{}}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_a_bare_member_spine_is_not_a_json_value():
  {==}

# Reordered required fields admit by name.
law schema_law_reordered_required_fields_admit:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"a", SfScalar{SsText{}}}, SfFieldsCons{SfRequired{"b", SfScalar{SsText{}}}, SfFieldsNil{}}}}, Codec.Robj{Codec.Rpair{"b", Codec.Rstr{"y"}, Codec.Rpair{"a", Codec.Rstr{"x"}, Codec.Rnil{}}}}) == SvOk{} : SchemaVerdict}

def schema_law_reordered_required_fields_admit():
  {==}

# Proof control: a reordered duplicate still refuses.
law schema_law_a_reordered_duplicate_key_refuses:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"a", SfScalar{SsText{}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rpair{"a", Codec.Rstr{"x"}, Codec.Rpair{"a", Codec.Rstr{"y"}, Codec.Rnil{}}}}) == SvRefused{"duplicateKey"} : SchemaVerdict}

def schema_law_a_reordered_duplicate_key_refuses():
  {==}

# A trailing optional field may be absent after a required one.
law schema_law_a_trailing_optional_field_may_be_absent:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"a", SfScalar{SsText{}}}, SfFieldsCons{SfOptionalField{"b", SfScalar{SsText{}}}, SfFieldsNil{}}}}, Codec.Robj{Codec.Rpair{"a", Codec.Rstr{"x"}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_trailing_optional_field_may_be_absent():
  {==}

# Proof control: a missing required field refuses when a later one is present.
law schema_law_a_missing_first_required_field_refuses:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"a", SfScalar{SsText{}}}, SfFieldsCons{SfRequired{"b", SfScalar{SsText{}}}, SfFieldsNil{}}}}, Codec.Robj{Codec.Rpair{"b", Codec.Rstr{"y"}, Codec.Rnil{}}}) == SvRefused{"missingField"} : SchemaVerdict}

def schema_law_a_missing_first_required_field_refuses():
  {==}

# A record nested inside a record admits through the nested walk.
law schema_law_a_nested_record_value_admits:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"child", SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rpair{"child", Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rnil{}}}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_nested_record_value_admits():
  {==}

# Proof control: a wrong-typed leaf inside a nested record refuses.
law schema_law_a_nested_record_wrong_leaf_refuses:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"child", SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rpair{"child", Codec.Robj{Codec.Rpair{"name", Codec.Rnum{"1"}, Codec.Rnil{}}}, Codec.Rnil{}}}) == SvRefused{"wrongKind"} : SchemaVerdict}

def schema_law_a_nested_record_wrong_leaf_refuses():
  {==}

# Proof control: an empty nested record still reports its missing field.
law schema_law_a_nested_record_missing_leaf_refuses:
  {schema_admit_value(DefsNil{}, SfRecord{SfFieldsCons{SfRequired{"child", SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}}, SfFieldsNil{}}}, Codec.Robj{Codec.Rpair{"child", Codec.Robj{Codec.Rnil{}}, Codec.Rnil{}}}) == SvRefused{"missingField"} : SchemaVerdict}

def schema_law_a_nested_record_missing_leaf_refuses():
  {==}

# An array of records admits each element through the nested walk.
law schema_law_a_nested_array_of_records_admits:
  {schema_admit_value(DefsNil{}, SfArray{SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}}, Codec.Rarr{Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rnil{}}}, Codec.Rnil{}}) == SvOk{} : SchemaVerdict}

def schema_law_a_nested_array_of_records_admits():
  {==}

# A dictionary of records admits each member value through the nested walk.
law schema_law_a_nested_dict_of_records_admits:
  {schema_admit_value(DefsNil{}, SfDict{SkDeclared{NlCons{"k", NlNil{}}}, SfRecord{SfFieldsCons{SfRequired{"name", SfScalar{SsText{}}}, SfFieldsNil{}}}}, Codec.Robj{Codec.Rpair{"k", Codec.Robj{Codec.Rpair{"name", Codec.Rstr{"x"}, Codec.Rnil{}}}, Codec.Rnil{}}}) == SvOk{} : SchemaVerdict}

def schema_law_a_nested_dict_of_records_admits():
  {==}
