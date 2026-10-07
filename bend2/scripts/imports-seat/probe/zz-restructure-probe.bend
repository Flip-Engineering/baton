# Verification probe, not committed: compares the restructured value walks in
# codec-wire.bend against the formulation they replaced, over a corpus that covers
# every constructor and every mode, including the fall-through arms.
#
# The replaced formulation is kept here verbatim and marked @unsafe because its
# parameter order fails the termination check, which is the reason it was
# restructured.
import Base
import ./codec.bend as Codec
import ./codec-wire.bend as Wire
import ./contracts.bend as Context
import ../json/canonical.bend as J

@unsafe
def old_text(+mode: String, +v: Codec.RawValue) -> String:
  match mode:
    case "value":
      match v:
        case Codec.Rnull{}: "null"
        case Codec.Rtrue{}: "true"
        case Codec.Rfalse{}: "false"
        case Codec.Rstr{+text}: J.json_text(J.Jstr{text})
        case Codec.Rnum{+token}: token
        case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}: "[]"
        case Codec.Rarr{+head, +tail}: "[" ++ old_text("value", head) ++ old_text("items", tail)
        case Codec.Robj{Codec.Rnil{}}: "{}"
        case Codec.Robj{Codec.Rpair{+key, +value, +rest}}: "{" ++ J.json_text(J.Jstr{key}) ++ ":" ++ old_text("value", value) ++ old_text("members", rest)
        case Codec.Robj{+members}: "{}"
        case other: "null"
    case "items":
      match v:
        case Codec.Rnil{}: "]"
        case Codec.Rarr{+head, +tail}: "," ++ old_text("value", head) ++ old_text("items", tail)
        case other: "]"
    case "members":
      match v:
        case Codec.Rnil{}: "}"
        case Codec.Rpair{+key, +value, +rest}: "," ++ J.json_text(J.Jstr{key}) ++ ":" ++ old_text("value", value) ++ old_text("members", rest)
        case other: "}"
    case other: ""

@unsafe
def old_ok(+mode: String, +v: Codec.RawValue) -> Bool:
  match mode:
    case "value":
      match v:
        case Codec.Rnull{}: True{}
        case Codec.Rtrue{}: True{}
        case Codec.Rfalse{}: True{}
        case Codec.Rstr{+text}: True{}
        case Codec.Rnum{+token}: Context.strict_number_token_ok(token)
        case Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}: True{}
        case Codec.Rarr{+head, +tail}: Bool.pick(Bool, old_ok("value", head), old_ok("items", tail), False{})
        case Codec.Robj{Codec.Rnil{}}: True{}
        case Codec.Robj{Codec.Rpair{+key, +value, +rest}}: Bool.pick(Bool, Codec.raw_member_present(key, rest), False{}, Bool.pick(Bool, old_ok("value", value), old_ok("members", rest), False{}))
        case Codec.Robj{+members}: False{}
        case other: False{}
    case "items":
      match v:
        case Codec.Rnil{}: True{}
        case Codec.Rarr{+head, +tail}: Bool.pick(Bool, old_ok("value", head), old_ok("items", tail), False{})
        case other: False{}
    case "members":
      match v:
        case Codec.Rnil{}: True{}
        case Codec.Rpair{+key, +value, +rest}: Bool.pick(Bool, Codec.raw_member_present(key, rest), False{}, Bool.pick(Bool, old_ok("value", value), old_ok("members", rest), False{}))
        case other: False{}
    case other: False{}

def text_agrees(+v: Codec.RawValue) -> Bool:
  Bool.and(String.eq(old_text("value", v), Wire.wire_value_text(v, "value")),
  Bool.and(String.eq(old_text("items", v), Wire.wire_value_text(v, "items")),
  Bool.and(String.eq(old_text("members", v), Wire.wire_value_text(v, "members")),
           String.eq(old_text("", v), Wire.wire_value_text(v, "")))))

def bool_same(+a: Bool, +b: Bool) -> Bool:
  Bool.pick(Bool, a, b, Bool.not(b))

def ok_agrees(+v: Codec.RawValue) -> Bool:
  Bool.and(bool_same(old_ok("value", v), Wire.wire_value_ok(v, "value")),
  Bool.and(bool_same(old_ok("items", v), Wire.wire_value_ok(v, "items")),
  Bool.and(bool_same(old_ok("members", v), Wire.wire_value_ok(v, "members")),
           bool_same(old_ok("", v), Wire.wire_value_ok(v, "")))))

def c_null() -> Codec.RawValue: Codec.Rnull{}
def c_true() -> Codec.RawValue: Codec.Rtrue{}
def c_false() -> Codec.RawValue: Codec.Rfalse{}
def c_str() -> Codec.RawValue: Codec.Rstr{"a"}
def c_str_empty() -> Codec.RawValue: Codec.Rstr{""}
def c_token() -> Codec.RawValue: Codec.Rnum{"1e400"}
def c_bad_token() -> Codec.RawValue: Codec.Rnum{"x"}
def c_nil() -> Codec.RawValue: Codec.Rnil{}
def c_bare_pair() -> Codec.RawValue: Codec.Rpair{"k", Codec.Rstr{"v"}, Codec.Rnil{}}
def c_empty_arr() -> Codec.RawValue: Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}}
def c_obj_empty() -> Codec.RawValue: Codec.Robj{Codec.Rnil{}}
def c_arr_nested() -> Codec.RawValue:
  Codec.Rarr{Codec.Rstr{"a"}, Codec.Rarr{Codec.Rnull{}, Codec.Rnil{}}}
def c_obj_pair() -> Codec.RawValue:
  Codec.Robj{Codec.Rpair{"k", Codec.Rnum{"1"}, Codec.Rnil{}}}
def c_obj_deep() -> Codec.RawValue:
  Codec.Robj{Codec.Rpair{"k", Codec.Rarr{Codec.Rnil{}, Codec.Rnil{}},
    Codec.Rpair{"j", Codec.Robj{Codec.Rnil{}}, Codec.Rnil{}}}}
def c_obj_arr_member() -> Codec.RawValue:
  Codec.Robj{Codec.Rarr{Codec.Rnull{}, Codec.Rnil{}}}
def c_arr_pair_member() -> Codec.RawValue:
  Codec.Rarr{Codec.Rpair{"k", Codec.Rnull{}, Codec.Rnil{}}, Codec.Rnil{}}
def c_obj_dup_key() -> Codec.RawValue:
  Codec.Robj{Codec.Rpair{"k", Codec.Rstr{""},
    Codec.Rpair{"k", Codec.Rstr{"b"}, Codec.Rnil{}}}}

law zz_probe_text_null: {text_agrees(c_null()) == True{} : Bool}
def zz_probe_text_null():
  {==}
law zz_probe_text_true: {text_agrees(c_true()) == True{} : Bool}
def zz_probe_text_true():
  {==}
law zz_probe_text_false: {text_agrees(c_false()) == True{} : Bool}
def zz_probe_text_false():
  {==}
law zz_probe_text_str: {text_agrees(c_str()) == True{} : Bool}
def zz_probe_text_str():
  {==}
law zz_probe_text_str_empty: {text_agrees(c_str_empty()) == True{} : Bool}
def zz_probe_text_str_empty():
  {==}
law zz_probe_text_token: {text_agrees(c_token()) == True{} : Bool}
def zz_probe_text_token():
  {==}
law zz_probe_text_bad_token: {text_agrees(c_bad_token()) == True{} : Bool}
def zz_probe_text_bad_token():
  {==}
law zz_probe_text_nil: {text_agrees(c_nil()) == True{} : Bool}
def zz_probe_text_nil():
  {==}
law zz_probe_text_bare_pair: {text_agrees(c_bare_pair()) == True{} : Bool}
def zz_probe_text_bare_pair():
  {==}
law zz_probe_text_empty_arr: {text_agrees(c_empty_arr()) == True{} : Bool}
def zz_probe_text_empty_arr():
  {==}
law zz_probe_text_obj_empty: {text_agrees(c_obj_empty()) == True{} : Bool}
def zz_probe_text_obj_empty():
  {==}
law zz_probe_text_arr_nested: {text_agrees(c_arr_nested()) == True{} : Bool}
def zz_probe_text_arr_nested():
  {==}
law zz_probe_text_obj_pair: {text_agrees(c_obj_pair()) == True{} : Bool}
def zz_probe_text_obj_pair():
  {==}
law zz_probe_text_obj_deep: {text_agrees(c_obj_deep()) == True{} : Bool}
def zz_probe_text_obj_deep():
  {==}
law zz_probe_text_obj_arr_member: {text_agrees(c_obj_arr_member()) == True{} : Bool}
def zz_probe_text_obj_arr_member():
  {==}
law zz_probe_text_arr_pair_member: {text_agrees(c_arr_pair_member()) == True{} : Bool}
def zz_probe_text_arr_pair_member():
  {==}
law zz_probe_text_obj_dup_key: {text_agrees(c_obj_dup_key()) == True{} : Bool}
def zz_probe_text_obj_dup_key():
  {==}

law zz_probe_ok_null: {ok_agrees(c_null()) == True{} : Bool}
def zz_probe_ok_null():
  {==}
law zz_probe_ok_true: {ok_agrees(c_true()) == True{} : Bool}
def zz_probe_ok_true():
  {==}
law zz_probe_ok_false: {ok_agrees(c_false()) == True{} : Bool}
def zz_probe_ok_false():
  {==}
law zz_probe_ok_str: {ok_agrees(c_str()) == True{} : Bool}
def zz_probe_ok_str():
  {==}
law zz_probe_ok_str_empty: {ok_agrees(c_str_empty()) == True{} : Bool}
def zz_probe_ok_str_empty():
  {==}
law zz_probe_ok_token: {ok_agrees(c_token()) == True{} : Bool}
def zz_probe_ok_token():
  {==}
law zz_probe_ok_bad_token: {ok_agrees(c_bad_token()) == True{} : Bool}
def zz_probe_ok_bad_token():
  {==}
law zz_probe_ok_nil: {ok_agrees(c_nil()) == True{} : Bool}
def zz_probe_ok_nil():
  {==}
law zz_probe_ok_bare_pair: {ok_agrees(c_bare_pair()) == True{} : Bool}
def zz_probe_ok_bare_pair():
  {==}
law zz_probe_ok_empty_arr: {ok_agrees(c_empty_arr()) == True{} : Bool}
def zz_probe_ok_empty_arr():
  {==}
law zz_probe_ok_obj_empty: {ok_agrees(c_obj_empty()) == True{} : Bool}
def zz_probe_ok_obj_empty():
  {==}
law zz_probe_ok_arr_nested: {ok_agrees(c_arr_nested()) == True{} : Bool}
def zz_probe_ok_arr_nested():
  {==}
law zz_probe_ok_obj_pair: {ok_agrees(c_obj_pair()) == True{} : Bool}
def zz_probe_ok_obj_pair():
  {==}
law zz_probe_ok_obj_deep: {ok_agrees(c_obj_deep()) == True{} : Bool}
def zz_probe_ok_obj_deep():
  {==}
law zz_probe_ok_obj_arr_member: {ok_agrees(c_obj_arr_member()) == True{} : Bool}
def zz_probe_ok_obj_arr_member():
  {==}
law zz_probe_ok_arr_pair_member: {ok_agrees(c_arr_pair_member()) == True{} : Bool}
def zz_probe_ok_arr_pair_member():
  {==}
law zz_probe_ok_obj_dup_key: {ok_agrees(c_obj_dup_key()) == True{} : Bool}
def zz_probe_ok_obj_dup_key():
  {==}
