# CLAIM: the scalar half of B2-JSON decoding at the pin: a parser over Base's String that
# reads null, true, false, non-negative integers and escaped strings, returns the value with
# the unconsumed input or the position that refused, and round-trips every scalar fixture of
# the encoder corpus through the encoder byte for byte.
# Status: prototype work item B2-JSON (LANG-CAP-06), decoder slice (scalars). Container
# decoding, streamed input and \u escapes are owed; the evidence file records why containers
# cannot use the natural continuation-passing structure at this pin.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: b2-json-decode.evidence.md.
#
# The checker's rules shape this program as they shaped the encoder: one definition per loop
# (mutual recursion is refused), every recursion passes a tail of the input, computed
# conditions branch through Bool.pick, matches are exhaustive, values are affine.
import Base
import ./b2-json-canonical.bend as Enc

# The parser's answer: the value with the input from the first unconsumed character, or the
# character position that refused (counted from zero).
type Parsed is Data:
  POk{value: Enc.Json, rest: String}
  PBad{at: U32}
  PTrail{}

def ch(code: U32) -> Char:
  Char.from_u32(code)

def one(c: Char) -> String:
  SCon{c, SNil{}}

def cp(c: Char) -> U32:
  Char.to_u32(c)

def head_of(s: String) -> Char:
  match s:
    case SNil{}: ch(0)
    case SCon{+head, +tail}: head

def tail_of(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+head, +tail}: tail

def append_char(c: Char, s: String) -> String:
  match s:
    case SNil{}: SCon{c, SNil{}}
    case SCon{+head, +tail}: SCon{head, append_char(c, tail)}

def is_space(+code: U32) -> Bool:
  Bool.or(Bool.or(U32.is_eq(code, 32), U32.is_eq(code, 10)),
    Bool.or(U32.is_eq(code, 9), U32.is_eq(code, 13)))

def is_digit(+code: U32) -> Bool:
  Bool.and(U32.is_ge(code, 48), U32.is_le(code, 57))

def is_quote(+code: U32) -> Bool:
  U32.is_eq(code, 34)

def is_backslash(+code: U32) -> Bool:
  U32.is_eq(code, 92)

def is_plain_escape(+code: U32) -> Bool:
  Bool.or(U32.is_eq(code, 34), Bool.or(U32.is_eq(code, 92), U32.is_eq(code, 47)))

def is_unknown_escape(+code: U32) -> Bool:
  U32.is_eq(code, 65535)

# The decoded code point of one escape letter: 65535 when the letter is not one this slice
# admits. A chain of comparisons, one helper per comparison.
def esc_plain(+code: U32, hit: Bool) -> U32:
  match hit:
    case True{}: code
    case False{}: 65535

def esc_r(+code: U32, hit: Bool) -> U32:
  match hit:
    case True{}: 13
    case False{}: esc_plain(code, is_plain_escape(code))

def esc_t(+code: U32, hit: Bool) -> U32:
  match hit:
    case True{}: 9
    case False{}: esc_r(code, U32.is_eq(code, 114))

def esc_n(+code: U32, hit: Bool) -> U32:
  match hit:
    case True{}: 10
    case False{}: esc_t(code, U32.is_eq(code, 116))

def escape_value(+code: U32) -> U32:
  esc_n(code, U32.is_eq(code, 110))

# The expected literal suffixes as strings of code points.
def expected_ull() -> String:
  SCon{ch(117), SCon{ch(108), SCon{ch(108), SNil{}}}}

def expected_rue() -> String:
  SCon{ch(114), SCon{ch(117), SCon{ch(101), SNil{}}}}

def expected_alse() -> String:
  SCon{ch(97), SCon{ch(108), SCon{ch(115), SCon{ch(101), SNil{}}}}}

# The selectors below never call the loops that use them: they take an already-written
# recursive call as a value, which is what keeps each loop's self-call direct (mutual
# recursion is refused) while its conditions come from acyclic helpers.
def expect_end(want: String, value: Enc.Json, at: U32, done: Bool) -> Parsed:
  match done:
    case True{}: POk{value, SNil{}}
    case False{}: PBad{at}

def expect_go(tail: String, value: Enc.Json, at: U32, heads_eq: Bool, recurse: Parsed) -> Parsed:
  match heads_eq:
    case True{}: recurse
    case False{}: PBad{at}

def rs_esc(tail: String, head: Char, acc: String, at: U32, unknown: Bool, recurse: Parsed) -> Parsed:
  match unknown:
    case True{}: PBad{at}
    case False{}: recurse

def rs_back(backslash: Bool, to_esc: Parsed, plain: Parsed) -> Parsed:
  match backslash:
    case True{}: to_esc
    case False{}: plain

def rs_plain(tail: String, head: Char, acc: String, at: U32, quote: Bool, backslash: Bool, to_esc: Parsed, plain: Parsed) -> Parsed:
  match quote:
    case True{}: POk{Enc.Jstr{acc}, tail}
    case False{}: rs_back(backslash, to_esc, plain)

# A literal suffix: every character must match before the value is admitted. The input is
# destructured by the match, so the self-call's first argument is the bound tail.
def expect(+s: String, +want: String, +value: Enc.Json, +at: U32) -> Parsed:
  match s:
    case SNil{}: expect_end(want, value, at, String.is_empty(want))
    case SCon{+head, +tail}:
      Bool.pick(Parsed, String.is_empty(want),
        POk{value, s},
        expect_go(tail, value, at, U32.is_eq(cp(head), cp(head_of(want))),
          expect(tail, tail_of(want), value, U32.add(at, 1))))

# Integers: a digit run, non-negative, no sign and no fraction in this slice.
def read_int(+s: String, +acc: U32) -> Parsed:
  match s:
    case SNil{}: POk{Enc.Jint{acc}, s}
    case SCon{+head, +tail}:
      Bool.pick(Parsed, is_digit(cp(head)),
        read_int(tail, U32.add(U32.mul(acc, 10), U32.sub(cp(head), 48))),
        POk{Enc.Jint{acc}, s})

# Strings: one loop carrying an `esc` flag; the escape branch is a value this definition
# returns. \u is refused here and named as owed.
def read_str(+s: String, +acc: String, +at: U32, esc: Bool) -> Parsed:
  match s:
    case SNil{}: PBad{at}
    case SCon{+head, +tail}:
      Bool.pick(Parsed, esc,
        rs_esc(tail, head, acc, at, is_unknown_escape(escape_value(cp(head))),
          read_str(tail, append_char(ch(escape_value(cp(head))), acc), U32.add(at, 2), False{})),
        rs_plain(tail, head, acc, at, is_quote(cp(head)), is_backslash(cp(head)),
          read_str(tail, acc, U32.add(at, 1), True{}),
          read_str(tail, append_char(head, acc), U32.add(at, 1), False{})))

# The value dispatch: a chain of comparisons in reverse order, because a definition must
# precede its use and a computed condition cannot be a match subject.
def v_digit(+head: Char, s: String, at: U32, hit: Bool) -> Parsed:
  match hit:
    case True{}: read_int(s, U32.sub(cp(head), 48))
    case False{}: PBad{at}

def v_false(+head: Char, s: String, at: U32, hit: Bool) -> Parsed:
  match hit:
    case True{}: expect(s, expected_alse(), Enc.Jfalse{}, U32.add(at, 1))
    case False{}: v_digit(head, s, at, is_digit(cp(head)))

def v_true(+head: Char, s: String, at: U32, hit: Bool) -> Parsed:
  match hit:
    case True{}: expect(s, expected_rue(), Enc.Jtrue{}, U32.add(at, 1))
    case False{}: v_false(head, s, at, U32.is_eq(cp(head), 102))

def v_null(+head: Char, s: String, at: U32, hit: Bool) -> Parsed:
  match hit:
    case True{}: expect(s, expected_ull(), Enc.Jnull{}, U32.add(at, 1))
    case False{}: v_true(head, s, at, U32.is_eq(cp(head), 116))

def v_quote(+head: Char, s: String, at: U32, hit: Bool) -> Parsed:
  match hit:
    case True{}: read_str(s, SNil{}, U32.add(at, 1), False{})
    case False{}: v_null(head, s, at, U32.is_eq(cp(head), 110))

def parse_value(+head: Char, s: String, at: U32) -> Parsed:
  v_quote(head, s, at, is_quote(cp(head)))

# Whitespace: one self-recursive definition; the value it does not skip goes to the dispatch.
def skip_ws(s: String, +at: U32) -> Parsed:
  match s:
    case SNil{}: PBad{at}
    case SCon{+head, +tail}:
      Bool.pick(Parsed, is_space(cp(head)),
        skip_ws(tail, U32.add(at, 1)),
        parse_value(head, tail, at))

def parse_rest(value: Enc.Json, rest: String, empty: Bool) -> Parsed:
  match empty:
    case True{}: POk{value, rest}
    case False{}: PTrail{}

def parse_done(s: String, parsed: Parsed) -> Parsed:
  match parsed:
    case POk{+value, +rest}: parse_rest(value, rest, String.is_empty(rest))
    case PBad{+at}: PBad{at}
    case PTrail{}: PTrail{}

# Entry: skip whitespace, then read one scalar and require the input to end.
def parse(+s: String) -> Parsed:
  parse_done(s, skip_ws(s, 0))

# The round trip the program prints: decode a scalar text and re-encode it.
def tag_of(text: String, same: Bool) -> String:
  match same:
    case True{}: "round-trip ok: "
    case False{}: "round-trip FAIL: "

def round_done(+text: String, parsed: Parsed) -> IO(Unit):
  match parsed:
    case POk{+value, +rest}: IO.print(tag_of(text, String.eq(Enc.json_text(value), text)) ++ Enc.json_text(value))
    case PBad{+at}: IO.print("refused at position " ++ U32.show(at))
    case PTrail{}: IO.print("trailing input after a complete value")

def round_trip(+text: String) -> IO(Unit):
  round_done(text, parse(text))

def literal_null() -> String:
  SCon{ch(110), SCon{ch(117), SCon{ch(108), SCon{ch(108), SNil{}}}}}

def literal_true() -> String:
  SCon{ch(116), SCon{ch(114), SCon{ch(117), SCon{ch(101), SNil{}}}}}

def literal_zero() -> String:
  one(ch(48))

def literal_4096() -> String:
  SCon{ch(52), SCon{ch(48), SCon{ch(57), SCon{ch(54), SNil{}}}}}

def literal_quoted() -> String:
  SCon{ch(34), SCon{ch(97), SCon{ch(92), SCon{ch(34), SCon{ch(98), SCon{ch(92), SCon{ch(92), SCon{ch(99), SCon{ch(34), SNil{}}}}}}}}}}

def literal_bad() -> String:
  SCon{ch(110), SCon{ch(117), SCon{ch(108), SCon{ch(108), SCon{ch(33), SNil{}}}}}}

def literal_trailing() -> String:
  SCon{ch(49), SCon{ch(32), SNil{}}}

def literal_truncated() -> String:
  SCon{ch(110), SCon{ch(117), SCon{ch(108), SNil{}}}}

def literal_mismatch() -> String:
  SCon{ch(116), SCon{ch(114), SCon{ch(117), SCon{ch(120), SNil{}}}}}

def literal_uescape() -> String:
  SCon{ch(34), SCon{ch(92), SCon{ch(117), SCon{ch(48), SCon{ch(48), SCon{ch(52), SCon{ch(49), SCon{ch(34), SNil{}}}}}}}}}

def report_one(tag: String, text: String) -> IO(Unit):
  IO.print(tag)

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    a : Unit <- round_trip(literal_null())
    b : Unit <- round_trip(literal_true())
    c : Unit <- round_trip(literal_zero())
    d : Unit <- round_trip(literal_4096())
    e : Unit <- round_trip(literal_quoted())
    f : Unit <- round_trip(literal_bad())
    g : Unit <- round_trip(literal_trailing())
    h : Unit <- round_trip(literal_truncated())
    i : Unit <- round_trip(literal_mismatch())
    round_trip(literal_uescape())
