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

def report(+ok: Bool, +label: String) -> IO(Unit):
  match ok:
    case True{}: IO.print("ok " ++ label)
    case False{}: IO.die(Unit, 1, "MISMATCH " ++ label)

def main() -> IO(Unit):
  do IO<Unit>:
    _r1 : Unit <- report(text_agrees(c_null()), "text-null")
    _r2 : Unit <- report(ok_agrees(c_null()), "ok-null")
    _r3 : Unit <- report(text_agrees(c_true()), "text-true")
    _r4 : Unit <- report(ok_agrees(c_true()), "ok-true")
    _r5 : Unit <- report(text_agrees(c_false()), "text-false")
    _r6 : Unit <- report(ok_agrees(c_false()), "ok-false")
    _r7 : Unit <- report(text_agrees(c_str()), "text-str")
    _r8 : Unit <- report(ok_agrees(c_str()), "ok-str")
    _r9 : Unit <- report(text_agrees(c_str_empty()), "text-str-empty")
    _r10 : Unit <- report(ok_agrees(c_str_empty()), "ok-str-empty")
    _r11 : Unit <- report(text_agrees(c_token()), "text-token")
    _r12 : Unit <- report(ok_agrees(c_token()), "ok-token")
    _r13 : Unit <- report(text_agrees(c_bad_token()), "text-bad-token")
    _r14 : Unit <- report(ok_agrees(c_bad_token()), "ok-bad-token")
    _r15 : Unit <- report(text_agrees(c_nil()), "text-nil")
    _r16 : Unit <- report(ok_agrees(c_nil()), "ok-nil")
    _r17 : Unit <- report(text_agrees(c_bare_pair()), "text-bare-pair")
    _r18 : Unit <- report(ok_agrees(c_bare_pair()), "ok-bare-pair")
    _r19 : Unit <- report(text_agrees(c_empty_arr()), "text-empty-arr")
    _r20 : Unit <- report(ok_agrees(c_empty_arr()), "ok-empty-arr")
    _r21 : Unit <- report(text_agrees(c_obj_empty()), "text-obj-empty")
    _r22 : Unit <- report(ok_agrees(c_obj_empty()), "ok-obj-empty")
    _r23 : Unit <- report(text_agrees(c_arr_nested()), "text-arr-nested")
    _r24 : Unit <- report(ok_agrees(c_arr_nested()), "ok-arr-nested")
    _r25 : Unit <- report(text_agrees(c_obj_pair()), "text-obj-pair")
    _r26 : Unit <- report(ok_agrees(c_obj_pair()), "ok-obj-pair")
    _r27 : Unit <- report(text_agrees(c_obj_deep()), "text-obj-deep")
    _r28 : Unit <- report(ok_agrees(c_obj_deep()), "ok-obj-deep")
    _r29 : Unit <- report(text_agrees(c_obj_arr_member()), "text-obj-arr-member")
    _r30 : Unit <- report(ok_agrees(c_obj_arr_member()), "ok-obj-arr-member")
    _r31 : Unit <- report(text_agrees(c_arr_pair_member()), "text-arr-pair-member")
    _r32 : Unit <- report(ok_agrees(c_arr_pair_member()), "ok-arr-pair-member")
    _r33 : Unit <- report(text_agrees(c_obj_dup_key()), "text-obj-dup-key")
    _r34 : Unit <- report(ok_agrees(c_obj_dup_key()), "ok-obj-dup-key")
    _last : Unit <- IO.print("probe: all comparisons agree")
    IO.pure(Unit, Unit{})
