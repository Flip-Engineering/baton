# Operative laws of the dataset document traversal. Each law is stated over the
# function that implements it and proved beside its claim, so a compile of this
# module refuses a law the implementation does not satisfy.
#
# Reference: RFC 6901 sections 3 and 4; docs/bend2/semantic-context-spec.md,
# Environment and general projections (dataset subject).

import Base
import ../../json/canonical.bend as J
import ./value.bend as V
import ./pointer.bend as P

# --- fixtures ----------------------------------------------------------------

def object_a() -> V.Doc:
  V.VObj{V.VMember{"a", V.VNum{"1"}, V.VEnd{}}}

def object_empty_key() -> V.Doc:
  V.VObj{V.VMember{"", V.VNum{"2"}, V.VEnd{}}}

def object_tilde_slash() -> V.Doc:
  V.VObj{V.VMember{"~/", V.VNum{"3"}, V.VEnd{}}}

def object_slash_tilde() -> V.Doc:
  V.VObj{V.VMember{"/~", V.VNum{"4"}, V.VEnd{}}}

def array_three() -> V.Doc:
  V.VArr{V.VCell{V.VNum{"0"}, V.VCell{V.VNum{"1"}, V.VCell{V.VNum{"2"}, V.VEnd{}}}}}

def null_doc() -> V.Doc:
  V.VNull{}

def empty_array_doc() -> V.Doc:
  V.VArr{V.VEnd{}}

def empty_object_doc() -> V.VObj:
  V.VObj{V.VEnd{}}

# --- pointer resolution ------------------------------------------------------

law empty_pointer_selects_the_document_root:
  {P.resolve(object_a(), "") == P.FOk{object_a(), ""} : P.Found}

def empty_pointer_selects_the_document_root():
  {==}

law member_token_selects_the_member:
  {P.resolve(object_a(), "/a") == P.FOk{V.VNum{"1"}, "/a"} : P.Found}

def member_token_selects_the_member():
  {==}

law empty_token_selects_the_empty_key:
  {P.resolve(object_empty_key(), "/") == P.FOk{V.VNum{"2"}, "/"} : P.Found}

def empty_token_selects_the_empty_key():
  {==}

law tilde_zero_tilde_one_decodes_to_tilde_slash:
  {P.resolve(object_tilde_slash(), "/~0~1") == P.FOk{V.VNum{"3"}, "/~0~1"} : P.Found}

def tilde_zero_tilde_one_decodes_to_tilde_slash():
  {==}

law tilde_one_tilde_zero_decodes_to_slash_tilde:
  {P.resolve(object_slash_tilde(), "/~1~0") == P.FOk{V.VNum{"4"}, "/~1~0"} : P.Found}

def tilde_one_tilde_zero_decodes_to_slash_tilde():
  {==}

law unknown_escape_is_refused:
  {P.resolve(object_a(), "/~2") == P.FBad{"not-rfc6901-pointer"} : P.Found}

def unknown_escape_is_refused():
  {==}

law trailing_tilde_is_refused:
  {P.resolve(object_a(), "/a~") == P.FBad{"not-rfc6901-pointer"} : P.Found}

def trailing_tilde_is_refused():
  {==}

law pointer_without_leading_slash_is_refused:
  {P.resolve(object_a(), "a") == P.FBad{"not-rfc6901-pointer"} : P.Found}

def pointer_without_leading_slash_is_refused():
  {==}

law absent_member_is_a_missing_pointer:
  {P.resolve(object_a(), "/b") == P.FMissing{"/b"} : P.Found}

def absent_member_is_a_missing_pointer():
  {==}

law first_index_selects_the_first_cell:
  {P.resolve(array_three(), "/0") == P.FOk{V.VNum{"0"}, "/0"} : P.Found}

def first_index_selects_the_first_cell():
  {==}

law last_index_selects_the_last_cell:
  {P.resolve(array_three(), "/2") == P.FOk{V.VNum{"2"}, "/2"} : P.Found}

def last_index_selects_the_last_cell():
  {==}

law index_past_the_end_selects_nothing:
  {P.resolve(array_three(), "/3") == P.FMissing{"/3"} : P.Found}

def index_past_the_end_selects_nothing():
  {==}

law leading_zero_index_selects_nothing:
  {P.resolve(array_three(), "/01") == P.FMissing{"/01"} : P.Found}

def leading_zero_index_selects_nothing():
  {==}

law negative_index_selects_nothing:
  {P.resolve(array_three(), "/-1") == P.FMissing{"/-1"} : P.Found}

def negative_index_selects_nothing():
  {==}

law non_digit_index_selects_nothing:
  {P.resolve(array_three(), "/x") == P.FMissing{"/x"} : P.Found}

def non_digit_index_selects_nothing():
  {==}

law unrepresentable_index_selects_nothing:
  {P.resolve(array_three(), "/99999999999999999999") == P.FMissing{"/99999999999999999999"} : P.Found}

def unrepresentable_index_selects_nothing():
  {==}

law a_member_token_on_an_array_selects_nothing:
  {P.resolve(array_three(), "/0/a") == P.FMissing{"/0/a"} : P.Found}

def a_member_token_on_an_array_selects_nothing():
  {==}

# --- structure ---------------------------------------------------------------

law structure_counts_every_node:
  {P.nodes_count(P.struct_go(P.WorkCons{"", object_a(), P.WorkNil{}}, P.NodesNil{})) == 2 : U32}

def structure_counts_every_node():
  {==}

law structure_of_the_root_lists_the_member_pointer:
  {P.structure(object_a(), "") == P.StOk{P.NodesCons{"", "object", V.PtrCons{"/a", V.PtrNil{}},
     P.NodesCons{"/a", "number", V.PtrNil{}, P.NodesNil{}}}, 2} : P.Structure}

def structure_of_the_root_lists_the_member_pointer():
  {==}

law structure_escapes_a_member_key:
  {P.structure(object_tilde_slash(), "") == P.StOk{P.NodesCons{"", "object", V.PtrCons{"/~0~1", V.PtrNil{}},
     P.NodesCons{"/~0~1", "number", V.PtrNil{}, P.NodesNil{}}}, 2} : P.Structure}

def structure_escapes_a_member_key():
  {==}

law structure_of_a_missing_pointer_reports_it:
  {P.structure(object_a(), "/b") == P.StMissing{"/b"} : P.Structure}

def structure_of_a_missing_pointer_reports_it():
  {==}

law structure_of_a_scalar_has_no_children:
  {P.structure(object_a(), "/a") == P.StOk{P.NodesCons{"/a", "number", V.PtrNil{}, P.NodesNil{}}, 1} : P.Structure}

def structure_of_a_scalar_has_no_children():
  {==}

# --- document values ---------------------------------------------------------

law null_is_its_own_kind:
  {V.doc_kind(null_doc()) == "null" : String}

def null_is_its_own_kind():
  {==}

law an_empty_array_is_an_array:
  {V.doc_kind(empty_array_doc()) == "array" : String}

def an_empty_array_is_an_array():
  {==}

law an_empty_object_is_an_object:
  {V.doc_kind(empty_object_doc()) == "object" : String}

def an_empty_object_is_an_object():
  {==}

law an_empty_array_writes_its_brackets:
  {V.doc_text_sorted(empty_array_doc()) == "[]" : String}

def an_empty_array_writes_its_brackets():
  {==}

law an_empty_object_writes_its_braces:
  {V.doc_text_sorted(empty_object_doc()) == "{}" : String}

def an_empty_object_writes_its_braces():
  {==}

law a_null_array_element_is_kept:
  {V.doc_text_sorted(V.VArr{V.VCell{V.VNull{}, V.VEnd{}}}) == "[null]" : String}

def a_null_array_element_is_kept():
  {==}

law an_object_sorts_its_members_by_key:
  {V.doc_text_sorted(V.VObj{V.VMember{"b", V.VNum{"2"}, V.VMember{"a", V.VNum{"1"}, V.VEnd{}}}}) == "{\"a\":1,\"b\":2}" : String}

def an_object_sorts_its_members_by_key():
  {==}

law a_string_value_is_quoted:
  {V.doc_text_sorted(V.VStr{"x"}) == "\"x\"" : String}

def a_string_value_is_quoted():
  {==}

# --- number tokens -----------------------------------------------------------

law a_signed_fraction_token_is_admitted:
  {V.json_number_token("-1.5") == True{} : Bool}

def a_signed_fraction_token_is_admitted():
  {==}

law an_exponent_token_is_admitted:
  {V.json_number_token("1e3") == True{} : Bool}

def an_exponent_token_is_admitted():
  {==}

law a_signed_exponent_token_is_admitted:
  {V.json_number_token("6.02E+23") == True{} : Bool}

def a_signed_exponent_token_is_admitted():
  {==}

law a_large_integer_token_is_admitted:
  {V.json_number_token("9007199254740993") == True{} : Bool}

def a_large_integer_token_is_admitted():
  {==}

law a_very_large_exponent_token_is_admitted:
  {V.json_number_token("1e400") == True{} : Bool}

def a_very_large_exponent_token_is_admitted():
  {==}

law zero_is_admitted:
  {V.json_number_token("0") == True{} : Bool}

def zero_is_admitted():
  {==}

law a_leading_zero_token_is_refused:
  {V.json_number_token("01") == False{} : Bool}

def a_leading_zero_token_is_refused():
  {==}

law a_trailing_dot_token_is_refused:
  {V.json_number_token("1.") == False{} : Bool}

def a_trailing_dot_token_is_refused():
  {==}

law a_leading_dot_token_is_refused:
  {V.json_number_token(".5") == False{} : Bool}

def a_leading_dot_token_is_refused():
  {==}

law an_empty_exponent_is_refused:
  {V.json_number_token("1e") == False{} : Bool}

def an_empty_exponent_is_refused():
  {==}

law a_lone_sign_is_refused:
  {V.json_number_token("-") == False{} : Bool}

def a_lone_sign_is_refused():
  {==}

law a_validated_token_builds_the_number_node:
  {V.number_node("1e3") == V.NumOk{V.VNum{"1e3"}} : V.NumResult}

def a_validated_token_builds_the_number_node():
  {==}

law an_unvalidated_token_builds_no_number_node:
  {V.number_node("+1") == V.NumBad{"not-a-json-number-token"} : V.NumResult}

def an_unvalidated_token_builds_no_number_node():
  {==}

# --- key equality ------------------------------------------------------------

law equal_number_tokens_are_equal_keys:
  {V.key_equal(V.KeyScalar{"number", "1e3"}, V.KeyScalar{"number", "1e3"}) == True{} : Bool}

def equal_number_tokens_are_equal_keys():
  {==}

law differently_spelled_numbers_are_not_equal_keys:
  {V.key_equal(V.KeyScalar{"number", "1.0"}, V.KeyScalar{"number", "1"}) == False{} : Bool}

def differently_spelled_numbers_are_not_equal_keys():
  {==}

law a_key_of_another_kind_is_not_equal:
  {V.key_equal(V.KeyScalar{"number", "1"}, V.KeyScalar{"string", "1"}) == False{} : Bool}

def a_key_of_another_kind_is_not_equal():
  {==}

law a_container_has_no_scalar_key_view:
  {V.key_present(V.key_view(V.VArr{V.VEnd{}})) == False{} : Bool}

def a_container_has_no_scalar_key_view():
  {==}
