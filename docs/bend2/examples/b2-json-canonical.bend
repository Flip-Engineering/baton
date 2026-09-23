# CLAIM: the canonical JSON encoder's first slice at the pin: a JSON value model, the
# canonical text rules (sorted member keys, no whitespace, minimal escapes, integers only)
# and the UTF-8 byte representation of every string, with parity against the JavaScript
# adapter's canonical encoding on a fixed corpus.
# Status: prototype work item B2-JSON (LANG-CAP-06), encoder slice. The decoder slice and
# streamed input with continuation are owed; ../laws-trace.md is not affected.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: b2-json-canonical.evidence.md.
import Base

type Member is Data:
  Member{key: String, value: Json}

type Json is Data:
  Jnull{}
  Jtrue{}
  Jfalse{}
  Jint{value: U32}
  Jstr{value: String}
  Jarr{items: List<Json>}
  Jobj{members: List<Member>}

# Byte classes the canonical rules need, built from code points so no literal escaping is
# assumed of the compiler.
def ch(code: U32) -> Char:
  Char.from_u32(code)

def one(c: Char) -> String:
  SCon{c, SNil{}}

def cat(a: String, b: String) -> String:
  String.append(a, b)

def cp(c: Char) -> U32:
  Char.to_u32(c)

def quote() -> Char:
  ch(34n)

def backslash() -> Char:
  ch(92n)

def newline() -> Char:
  ch(10n)

def digit_char(d: U32) -> Char:
  ch(U32.add(48n, d))

# Minimal escaping, as JSON.stringify spells it: the two structural characters, the five
# short control escapes, and \u00xx for the remaining control characters.
def escape_char(c: Char) -> String:
  match cp(c):
    case 34n: cat(one(backslash()), one(quote()))
    case 92n: cat(one(backslash()), one(backslash()))
    case 8n: cat(one(backslash()), one(ch(98n)))
    case 9n: cat(one(backslash()), one(ch(116n)))
    case 10n: cat(one(backslash()), one(ch(110n)))
    case 12n: cat(one(backslash()), one(ch(102n)))
    case 13n: cat(one(backslash()), one(ch(114n)))
    case other: match U32.is_lt(other, 32n):
      case True{}: unicode_escape(other)
      case False{}: one(c)

def hex_digit(n: U32) -> Char:
  match U32.is_lt(n, 10n):
    case True{}: digit_char(n)
    case False{}: ch(U32.add(87n, n))

def unicode_escape(code: U32) -> String:
  SCon{ch(92n), SCon{ch(117n), SCon{ch(48n), SCon{ch(48n), SCon{hex_digit(U32.and(U32.shrn(code, 4n), 15n)), SCon{hex_digit(U32.and(code, 15n)), SNil{}}}}}}}

def escape(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+head, +tail}: cat(escape_char(head), escape(tail))

# Decimal digits, no leading zeros and no sign (this slice admits non-negative integers only).
def digits_go(n: U32, acc: String) -> String:
  match U32.is_zero(n):
    case True{}: acc
    case False{}:
      let d = U32.rem(n, 10n)
      let rest = U32.div(n, 10n)
      digits_go(rest, SCon{digit_char(d), acc})

def digits(n: U32) -> String:
  match U32.is_zero(n):
    case True{}: one(digit_char(0n))
    case False{}: digits_go(n, SNil{})

def string_literal(s: String) -> String:
  cat(one(quote()), cat(escape(s), one(quote())))

# Member order: lexicographic by key bytes. The JavaScript adapter sorts by UTF-16 code
# units, which agrees with code-point order for every scalar below U+10000; the corpus
# stays below it and the divergence for astral characters is named in the evidence file.
def Member.le(a: Member, b: Member) -> Bool:
  match String.cmp(a.key, b.key):
    case LT{}: True{}
    case EQ{}: True{}
    case GT{}: False{}

def insert_member(m: Member, sorted: List<Member>) -> List<Member>:
  match sorted:
    case Nil{}: [m]
    case h <> t: match Member.le(m, h):
      case True{}: m <> (h <> t)
      case False{}: h <> insert_member(m, t)

def sort_members(xs: List<Member>) -> List<Member>:
  match xs:
    case Nil{}: Nil{}
    case h <> t: insert_member(h, sort_members(t))

def encode(j: Json) -> String:
  match j:
    case Jnull{}: "null"
    case Jtrue{}: "true"
    case Jfalse{}: "false"
    case Jint{+value}: digits(value)
    case Jstr{+value}: string_literal(value)
    case Jarr{+items}: encode_array(items)
    case Jobj{+members}: encode_object(sort_members(members))

def encode_member(m: Member) -> String:
  cat(string_literal(m.key), cat(one(ch(58n)), encode(m.value)))

def encode_members(xs: List<Member>) -> String:
  match xs:
    case Nil{}: SNil{}
    case [h]: encode_member(h)
    case h <> t: cat(encode_member(h), cat(one(ch(44n)), encode_members(t)))

def encode_object(xs: List<Member>) -> String:
  cat(one(ch(123n)), cat(encode_members(xs), one(ch(125n))))

def encode_items(xs: List<Json>) -> String:
  match xs:
    case Nil{}: SNil{}
    case [h]: encode(h)
    case h <> t: cat(encode(h), cat(one(ch(44n)), encode_items(t)))

def encode_array(xs: List<Json>) -> String:
  cat(one(ch(91n)), cat(encode_items(xs), one(ch(93n))))

# The UTF-8 byte representation: one to four bytes per code point.
def utf8_char(c: Char) -> List<U32>:
  match cp(c):
    case small: match U32.is_lt(small, 128n):
      case True{}: [small]
      case False{}: match U32.is_lt(small, 2048n):
        case True{}: [U32.or(192n, U32.shrn(small, 6n)), U32.or(128n, U32.and(small, 63n))]
        case False{}: [U32.or(224n, U32.shrn(small, 12n)), U32.or(128n, U32.and(U32.shrn(small, 6n), 63n)), U32.or(128n, U32.and(small, 63n))]

def utf8(s: String) -> List<U32>:
  match s:
    case SNil{}: Nil{}
    case SCon{+head, +tail}: utf8_char(head) <> utf8(tail)

def utf8_hex(xs: List<U32>) -> String:
  match xs:
    case Nil{}: SNil{}
    case h <> t: cat(hex_byte(h), utf8_hex(t))

def hex_byte(b: U32) -> String:
  SCon{hex_digit(U32.shrn(b, 4n)), SCon{hex_digit(U32.and(b, 15n)), SNil{}}}

# The corpus: primitives, nesting, key order that differs from sorted order, the escapes,
# an empty container pair and a non-ASCII string.
def corpus() -> List<Json>:
  [
    Jnull{},
    Jtrue{},
    Jint{0n},
    Jint{4096n},
    Jstr{"a\"b\\c"},
    Jstr{"line\n tab\t end"},
    Jarr{[Jint{1n}, Jnull{}, Jstr{"x"}]},
    Jarr{[]},
    Jobj{[Member{"b", Jint{2n}}, Member{"a", Jint{1n}}, Member{"c", Jarr{[]}}]},
    Jobj{[]},
    Jstr{"caf\u{e9}"},
    Jobj{[Member{"nested", Jobj{[Member{"z", Jstr{"\u{3bb}"}}]}}]}
  ]

def print_corpus(xs: List<Json>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit{})
    case h <> t: IO.bind(IO.print(encode(h)), ~(_: Unit) => print_corpus(t))

def main() -> IO(Unit):
  print_corpus(corpus())
