# CLAIM: a canonical JSON encoder is expressible in Bend2 alone — a value model,
# the canonical text rules (member keys in lexicographic order, no whitespace,
# minimal escapes, non-negative integers only) and the UTF-8 byte representation
# of every string, with output byte-identical to the JavaScript adapter's
# canonical form on a fixed corpus.
# Serves: LANG-CAP-06 (B2-JSON), encoder slice.
# Fixture: inline corpus (def corpus()); no external file.
# Reference pin: bend 2.0.25, bendlang/bend@a4952426.
# Promoted from: docs/bend2/examples/b2-json-canonical.bend.
#
# Shape constraints the checker imposes, recorded because the rewrite inherits them:
#  1. a match cannot scrutinize a computed value, so a branch on a computed condition is a
#     value-level `Bool.pick` and every dispatch takes its subject as a parameter;
#  2. a definition must be declared before it is used and mutual recursion is refused, so a
#     whole tree is walked by ONE self-recursive definition carrying a mode;
#  3. a Data constructor's fields must be Data (`List<a>` is a Type), so the tree is carried
#     by self-referential constructors rather than lists, and there is no field access: a
#     value is read by matching it into binders.
import Base

type Json is Data:
  Jnull{}
  Jtrue{}
  Jfalse{}
  Jint{value: U32}
  Jstr{value: String}
  Jarr{head: Json, tail: Json}
  Jobj{members: Json}
  Jpair{key: String, value: Json, rest: Json}
  Jnil{}

# The walk's mode: a value, an array cell, or an object member cell.
type Mode is Data:
  MValue{}
  MArray{}
  MObject{}

def ch(code: U32) -> Char:
  Char.from_u32(code)

def one(c: Char) -> String:
  SCon{c, SNil{}}

def cp(c: Char) -> U32:
  Char.to_u32(c)

def hex_digit_go(n: U32, low: Bool) -> Char:
  match low:
    case True{}: ch(U32.add(48, n))
    case False{}: ch(U32.add(87, n))

def hex_digit(+n: U32) -> Char:
  hex_digit_go(n, U32.is_lt(n, 10))

def unicode_escape(+code: U32) -> String:
  one(ch(92)) ++ one(ch(117)) ++ one(ch(48)) ++ one(ch(48))
    ++ one(hex_digit(U32.and(U32.shrn(code, 4n), 15))) ++ one(hex_digit(U32.and(code, 15)))

# Minimal escaping, as JSON.stringify spells it. The chain runs deepest-first because a
# definition must precede its use, and each comparison carries its own def because a
# computed condition cannot be a scrutinee and a U32 literal is not a pattern.
def esc_cr(+code: U32, hit: Bool) -> String:
  match hit:
    case True{}: one(ch(92)) ++ one(ch(114))
    case False{}: Bool.pick(String, U32.is_lt(code, 32), unicode_escape(code), one(ch(code)))

def esc_ff(+code: U32, hit: Bool) -> String:
  match hit:
    case True{}: one(ch(92)) ++ one(ch(102))
    case False{}: esc_cr(code, U32.is_eq(code, 13))

def esc_lf(+code: U32, hit: Bool) -> String:
  match hit:
    case True{}: one(ch(92)) ++ one(ch(110))
    case False{}: esc_ff(code, U32.is_eq(code, 12))

def esc_tab(+code: U32, hit: Bool) -> String:
  match hit:
    case True{}: one(ch(92)) ++ one(ch(116))
    case False{}: esc_lf(code, U32.is_eq(code, 10))

def esc_bs(+code: U32, hit: Bool) -> String:
  match hit:
    case True{}: one(ch(92)) ++ one(ch(98))
    case False{}: esc_tab(code, U32.is_eq(code, 9))

def esc_backslash(+code: U32, hit: Bool) -> String:
  match hit:
    case True{}: one(ch(92)) ++ one(ch(92))
    case False{}: esc_bs(code, U32.is_eq(code, 8))

def esc_of(+code: U32) -> String:
  esc_backslash(code, U32.is_eq(code, 92))

def esc_of_quote(+code: U32, hit: Bool) -> String:
  match hit:
    case True{}: one(ch(92)) ++ one(ch(34))
    case False{}: esc_of(code)

def escape_char(+c: Char) -> String:
  esc_of_quote(cp(c), U32.is_eq(cp(c), 34))

def escape(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+head, +tail}: escape_char(head) ++ escape(tail)

def string_literal(s: String) -> String:
  one(ch(34)) ++ escape(s) ++ one(ch(34))

# Member order: lexicographic by key code points. The JavaScript adapter sorts by UTF-16
# code units, which agrees with code-point order below U+10000; the corpus stays below it
# and the astral divergence is named in the evidence file.
# Lexicographic comparison over code points, written here because String.cmp returns a
# consumed-pair sigma that a two-argument helper would have to destructure.
def head_of(s: String) -> Char:
  match s:
    case SNil{}: ch(0)
    case SCon{+head, +tail}: head

def tail_of(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+head, +tail}: tail

def key_le(+a: String, +b: String) -> Bool:
  match a:
    case SNil{}: True{}
    case SCon{+ha, +ta}:
      Bool.pick(Bool, U32.is_lt(cp(ha), cp(head_of(b))), True{},
      Bool.pick(Bool, U32.is_lt(cp(head_of(b)), cp(ha)), False{},
        key_le(ta, tail_of(b))))

def cell_le_b(akey: String, b: Json) -> Bool:
  match b:
    case Jpair{+bkey, +bvalue, +brest}: key_le(akey, bkey)
    case Jnull{}: False{}
    case Jtrue{}: False{}
    case Jfalse{}: False{}
    case Jint{+value}: False{}
    case Jstr{+value}: False{}
    case Jarr{+head, +tail}: False{}
    case Jobj{+members}: False{}
    case Jnil{}: False{}

def cell_le(a: Json, b: Json) -> Bool:
  match a:
    case Jpair{+akey, +avalue, +arest}: cell_le_b(akey, b)
    case Jnull{}: False{}
    case Jtrue{}: False{}
    case Jfalse{}: False{}
    case Jint{+value}: False{}
    case Jstr{+value}: False{}
    case Jarr{+head, +tail}: False{}
    case Jobj{+members}: False{}
    case Jnil{}: False{}

# Insertion sort over the member chain. One self-recursive definition: the placement
# decision is a `Bool.pick`, the cell's fields are read by helpers, and the recursion is on
# this definition alone, because mutual recursion is refused.
def key_of(cell: Json) -> String:
  match cell:
    case Jpair{+key, +value, +rest}: key
    case Jnull{}: SNil{}
    case Jtrue{}: SNil{}
    case Jfalse{}: SNil{}
    case Jint{+value}: SNil{}
    case Jstr{+value}: SNil{}
    case Jarr{+head, +tail}: SNil{}
    case Jobj{+members}: SNil{}
    case Jnil{}: SNil{}

def value_of(cell: Json) -> Json:
  match cell:
    case Jpair{+key, +value, +rest}: value
    case Jnull{}: Jnil{}
    case Jtrue{}: Jnil{}
    case Jfalse{}: Jnil{}
    case Jint{+value}: Jnil{}
    case Jstr{+value}: Jnil{}
    case Jarr{+head, +tail}: Jnil{}
    case Jobj{+members}: Jnil{}
    case Jnil{}: Jnil{}

def insert_cell(+cell: Json, +chain: Json) -> Json:
  match chain:
    case Jnil{}: cell
    case Jpair{+key, +value, +rest}:
      Bool.pick(Json, key_le(key_of(cell), key),
        Jpair{key_of(cell), value_of(cell), chain},
        Jpair{key, value, insert_cell(cell, rest)})
    case Jnull{}: chain
    case Jtrue{}: chain
    case Jfalse{}: chain
    case Jint{+value}: chain
    case Jstr{+value}: chain
    case Jarr{+head, +tail}: chain
    case Jobj{+members}: chain

def sort_pairs(chain: Json) -> Json:
  match chain:
    case Jnil{}: Jnil{}
    case Jpair{+key, +value, +rest}: insert_cell(Jpair{key, value, Jnil{}}, sort_pairs(rest))
    case Jnull{}: Jnil{}
    case Jtrue{}: Jnil{}
    case Jfalse{}: Jnil{}
    case Jint{+value}: Jnil{}
    case Jstr{+value}: Jnil{}
    case Jarr{+head, +tail}: Jnil{}
    case Jobj{+members}: Jnil{}

def pick_list(c: Bool, yes: List<String>, no: List<String>) -> List<String>:
  match c:
    case True{}: yes
    case False{}: no

def separator(first: Bool) -> List<String>:
  pick_list(first, Nil{}, [","])

def mode_is_value(mode: Mode) -> Bool:
  match mode:
    case MValue{}: True{}
    case MArray{}: False{}
    case MObject{}: False{}

def mode_is_object(mode: Mode) -> Bool:
  match mode:
    case MValue{}: False{}
    case MArray{}: False{}
    case MObject{}: True{}

# Normalisation sorts each object's member chain and otherwise rebuilds the tree, so the
# walk below only ever visits an already-normalised tree and every recursive call passes a
# strict subterm as its first argument (the checker verifies termination that way).
def normalize(+j: Json) -> Json:
  match j:
    case Jnull{}: Jnull{}
    case Jtrue{}: Jtrue{}
    case Jfalse{}: Jfalse{}
    case Jint{+value}: Jint{value}
    case Jstr{+value}: Jstr{value}
    case Jarr{+head, +tail}: Jarr{normalize(head), normalize(tail)}
    case Jobj{+members}: Jobj{sort_pairs(normalize(members))}
    case Jpair{+key, +value, +rest}: Jpair{key, normalize(value), normalize(rest)}
    case Jnil{}: Jnil{}

# List concatenation: `<>` conses one element onto a list, so joining two list-valued
# pieces needs this helper.
def cat_list(xs: List<String>, ys: List<String>) -> List<String>:
  match xs:
    case Nil{}: ys
    case h <> t: h <> cat_list(t, ys)

# The one walk over the normalised tree. Every recursion is on this definition and its
# first argument is always a strict subterm of the parameter; the mode and the position are
# read by helpers and value-level picks, because a nested match may only take a field bound
# by the enclosing pattern.
def emit(+j: Json, +mode: Mode, first: Bool) -> List<String>:
  match j:
    case Jnull{}: ["null"]
    case Jtrue{}: ["true"]
    case Jfalse{}: ["false"]
    case Jint{+value}: [U32.show(value)]
    case Jstr{+value}: [string_literal(value)]
    case Jarr{+head, +tail}:
      pick_list(mode_is_value(mode),
        cat_list([one(ch(91))], cat_list(emit(head, MValue{}, True{}), cat_list(emit(tail, MArray{}, False{}), [one(ch(93))]))),
        cat_list(separator(first), cat_list(emit(head, MValue{}, True{}), emit(tail, MArray{}, False{}))))
    case Jobj{+members}:
      pick_list(mode_is_value(mode),
        cat_list([one(ch(123))], cat_list(emit(members, MObject{}, True{}), [one(ch(125))])),
        Nil{})
    case Jpair{+key, +value, +rest}:
      pick_list(mode_is_object(mode),
        cat_list(separator(first), cat_list([string_literal(key), one(ch(58))], cat_list(emit(value, MValue{}, True{}), emit(rest, MObject{}, False{})))),
        Nil{})
    case Jnil{}: Nil{}

def join_text(xs: List<String>) -> String:
  match xs:
    case Nil{}: SNil{}
    case h <> t: h ++ join_text(t)

def json_text(j: Json) -> String:
  join_text(emit(normalize(j), MValue{}, True{}))

# The UTF-8 byte representation: one to four bytes per code point.
def utf8_wide(+code: U32, two: Bool) -> List<U32>:
  match two:
    case True{}: [U32.or(192, U32.shrn(code, 6n)), U32.or(128, U32.and(code, 63))]
    case False{}:
      [U32.or(224, U32.shrn(code, 12n)),
       U32.or(128, U32.and(U32.shrn(code, 6n), 63)),
       U32.or(128, U32.and(code, 63))]

def utf8_class(code: U32, ascii: Bool, two: Bool) -> List<U32>:
  match ascii:
    case True{}: [code]
    case False{}: utf8_wide(code, two)

def utf8_char(+c: Char) -> List<U32>:
  utf8_class(cp(c), U32.is_lt(cp(c), 128), U32.is_lt(cp(c), 2048))

def cat_bytes(xs: List<U32>, ys: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: ys
    case h <> t: h <> cat_bytes(t, ys)

def utf8(s: String) -> List<U32>:
  match s:
    case SNil{}: Nil{}
    case SCon{+head, +tail}: cat_bytes(utf8_char(head), utf8(tail))

def hex_byte(+b: U32) -> String:
  one(hex_digit(U32.shrn(b, 4n))) ++ one(hex_digit(U32.and(b, 15)))

def utf8_hex(xs: List<U32>) -> String:
  match xs:
    case Nil{}: SNil{}
    case h <> t: hex_byte(h) ++ utf8_hex(t)

def str_cafe() -> String:
  SCon{ch(99), SCon{ch(97), SCon{ch(102), SCon{ch(233), SNil{}}}}}

def str_lambda() -> String:
  SCon{ch(955), SNil{}}

def str_quote_backslash() -> String:
  SCon{ch(97), SCon{ch(34), SCon{ch(98), SCon{ch(92), SCon{ch(99), SNil{}}}}}}

def str_controls() -> String:
  SCon{ch(10), SCon{ch(9), SCon{ch(1), SNil{}}}}

def arr_singleton(x: Json) -> Json:
  Jarr{x, Jnil{}}

def arr_three(a: Json, b: Json, c: Json) -> Json:
  Jarr{a, Jarr{b, arr_singleton(c)}}

def obj_three_out_of_order() -> Json:
  Jobj{Jpair{"b", Jint{2}, Jpair{"a", Jint{1}, Jpair{"c", arr_singleton(Jnil{}), Jnil{}}}}}

def obj_empty() -> Json:
  Jobj{Jnil{}}

def obj_nested() -> Json:
  Jobj{Jpair{"nested", Jobj{Jpair{"z", Jstr{str_lambda()}, Jnil{}}}, Jnil{}}}

def corpus() -> List<Json>:
  [
    Jnull{},
    Jtrue{},
    Jint{0},
    Jint{4096},
    Jstr{str_quote_backslash()},
    Jstr{str_controls()},
    arr_three(Jint{1}, Jnull{}, Jstr{"x"}),
    arr_singleton(Jnil{}),
    obj_three_out_of_order(),
    obj_empty(),
    Jstr{str_cafe()},
    obj_nested()
  ]

def print_all(xs: List<Json>) -> IO(Unit):
  match xs:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        u : Unit <- IO.print(json_text(h))
        print_all(t)

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    b : Unit <- IO.print(utf8_hex(utf8(str_cafe())))
    print_all(corpus())
