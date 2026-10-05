# Runtime fixtures of the dataset document traversal: pointer resolution,
# RFC 6901 escapes, array indices, number tokens and the value distinctions.
# Each case returns an empty string when it passes; the program exits 1 when any
# case fails.
#
# Remote run:
#
#   BEND_NO_TELEMETRY=1 "$BEND" bend2/tests/context-environment/dataset-fixtures.bend -o .scratch/bend2/dataset-fixtures.c
#   clang -O1 .scratch/bend2/dataset-fixtures.c -lm -o .scratch/bend2/dataset-fixtures
#   .scratch/bend2/dataset-fixtures
#
# Expected: "dataset fixtures: all green", exit 0.

import Base
import ../../git/text.bend as Tx
import ../../src/context/dataset/value.bend as V
import ../../src/context/dataset/pointer.bend as P

type Fails is Data:
  FailsNil{}
  FailsCons{text: String, rest: Fails}

def case_text(name: String, ok: Bool, got: String, want: String) -> String:
  Bool.pick(String, ok, SNil{},
    name ++ ": got [" ++ got ++ "] want [" ++ want ++ "]")

def text_is(name: String, got: String, want: String) -> String:
  case_text(name, String.eq(got, want), got, want)

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

def nested_null_and_empty() -> V.Doc:
  V.VObj{V.VMember{"n", V.VNull{}, V.VMember{"a", V.VArr{V.VEnd{}}, V.VMember{"o", V.VObj{V.VEnd{}}, V.VEnd{}}}}}

# --- resolution --------------------------------------------------------------

def case_root() -> String:
  text_is("root", P.found_text(P.resolve(object_a(), SNil{})), "ok::{\"a\":1}")

def case_member() -> String:
  text_is("member", P.found_text(P.resolve(object_a(), "/a")), "ok:/a:1")

def case_empty_member() -> String:
  text_is("empty member", P.found_text(P.resolve(object_empty_key(), "/")), "ok:/:2")

def case_repeated_escapes() -> String:
  text_is("tilde slash", P.found_text(P.resolve(object_tilde_slash(), "/~0~1")), "ok:/~0~1:3")

def case_repeated_escapes_reversed() -> String:
  text_is("slash tilde", P.found_text(P.resolve(object_slash_tilde(), "/~1~0")), "ok:/~1~0:4")

def case_malformed_escape() -> String:
  text_is("malformed escape", P.found_text(P.resolve(object_a(), "/~2")), "bad:not-rfc6901-pointer")

def case_trailing_tilde() -> String:
  text_is("trailing tilde", P.found_text(P.resolve(object_a(), "/a~")), "bad:not-rfc6901-pointer")

def case_missing_member() -> String:
  text_is("missing member", P.found_text(P.resolve(object_a(), "/b")), "missing:/b")

def case_index_zero() -> String:
  text_is("index zero", P.found_text(P.resolve(array_three(), "/0")), "ok:/0:0")

def case_index_two() -> String:
  text_is("index two", P.found_text(P.resolve(array_three(), "/2")), "ok:/2:2")

def case_index_ten_out_of_range() -> String:
  text_is("index ten", P.found_text(P.resolve(array_three(), "/10")), "missing:/10")

def case_index_leading_zero() -> String:
  text_is("leading zero", P.found_text(P.resolve(array_three(), "/01")), "missing:/01")

def case_index_negative() -> String:
  text_is("negative index", P.found_text(P.resolve(array_three(), "/-1")), "missing:/-1")

def case_index_nondigit() -> String:
  text_is("non-digit index", P.found_text(P.resolve(array_three(), "/x")), "missing:/x")

def case_index_overflow() -> String:
  text_is("overflow index", P.found_text(P.resolve(array_three(), "/99999999999999999999")), "missing:/99999999999999999999")

def case_nested_null_and_containers() -> String:
  text_is("nested containers", V.doc_text_sorted(nested_null_and_empty()), "{\"a\":[],\"n\":null,\"o\":{}}")

# --- number tokens and key equality ------------------------------------------

def case_signed_fraction() -> String:
  text_is("signed fraction", V.doc_text(V.VNum{"-1.5"}), "-1.5")

def case_exponent() -> String:
  text_is("exponent", V.doc_text(V.VNum{"1e3"}), "1e3")

def case_large_integer() -> String:
  text_is("large integer", V.doc_text(V.VNum{"9007199254740993"}), "9007199254740993")

def case_large_exponent() -> String:
  text_is("large exponent", V.doc_text(V.VNum{"1e400"}), "1e400")

def case_number_admitted() -> String:
  case_text("number admitted", V.json_number_token("-1.5"), "false", "true")

def case_number_refused() -> String:
  case_text("number refused", V.json_number_token("01"), "true", "false")

def case_equal_tokens() -> String:
  case_text("equal tokens", V.key_equal(V.KeyScalar{"number", "1e3"}, V.KeyScalar{"number", "1e3"}), "false", "true")

def case_different_tokens() -> String:
  case_text("different tokens", V.key_equal(V.KeyScalar{"number", "1.0"}, V.KeyScalar{"number", "1"}), "true", "false")

def fails() -> Fails:
  FailsCons{case_root(),
  FailsCons{case_member(),
  FailsCons{case_empty_member(),
  FailsCons{case_repeated_escapes(),
  FailsCons{case_repeated_escapes_reversed(),
  FailsCons{case_malformed_escape(),
  FailsCons{case_trailing_tilde(),
  FailsCons{case_missing_member(),
  FailsCons{case_index_zero(),
  FailsCons{case_index_two(),
  FailsCons{case_index_ten_out_of_range(),
  FailsCons{case_index_leading_zero(),
  FailsCons{case_index_negative(),
  FailsCons{case_index_nondigit(),
  FailsCons{case_index_overflow(),
  FailsCons{case_nested_null_and_containers(),
  FailsCons{case_signed_fraction(),
  FailsCons{case_exponent(),
  FailsCons{case_large_integer(),
  FailsCons{case_large_exponent(),
  FailsCons{case_number_admitted(),
  FailsCons{case_number_refused(),
  FailsCons{case_equal_tokens(),
  FailsCons{case_different_tokens(),
  FailsNil{}}}}}}}}}}}}}}}}}}}}}}}}

def report(rest: Fails, taken: Fails) -> Fails:
  match rest:
    case FailsNil{}: taken
    case FailsCons{+text, +tail}:
      Bool.pick(Fails, String.is_empty(text), report(tail, taken), report(tail, FailsCons{text, taken}))

def count(fs: Fails, n: U32) -> U32:
  match fs:
    case FailsNil{}: n
    case FailsCons{+text, +rest}: count(rest, U32.inc(n))

def join(fs: Fails) -> String:
  match fs:
    case FailsNil{}: SNil{}
    case FailsCons{+text, +rest}: text ++ SCon{Char.from_u32(10), SNil{}} ++ join(rest)

def main() -> IO(Unit):
  do IO<Unit>:
    +bad = report(fails(), FailsNil{})
    +n = count(bad, 0)
    Bool.pick(IO(Unit), U32.is_zero(n),
      IO.print("dataset fixtures: all green"),
      IO.die(Unit, 1, "dataset fixtures: " ++ U32.show(n) ++ " failures\n" ++ join(bad)))
