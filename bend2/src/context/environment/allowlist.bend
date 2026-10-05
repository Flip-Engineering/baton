# The structural value allowlist of automatic environment context.
#
# The specification enumerates the fact kinds that carry values. A field's
# Spec names the shape an admitted value must have. A value outside that shape
# produces a refusal with a fixed condition. Fields of free-form project
# content carry SpecNone and admit no value at all.
#
# The enumerated kinds are the boundary. A dependency version is admitted only
# when it matches the version grammar, a compiler option only when it names a
# value in that option's set, a process environment key only when it matches
# the key-name grammar. The functions below never read the coordinator or
# harness environment, and they return no byte a caller did not hand them as a
# candidate value.
#
# Reference: docs/bend2/semantic-context-spec.md, Environment and general
# projections.

import Base
import ../../git/text.bend as Tx
import ../../json/canonical.bend as J

# The value-carrying kind of a fact field.
type ValueKind is Data:
  KVersion{}
  KRange{}
  KKey{}
  KPath{}
  KBool{}
  KNumber{}
  KPresence{}

# A list of admitted names, used by the per-field option sets.
type Names is Data:
  NameNil{}
  NameCons{head: String, tail: Names}

# A JSON scalar class. A container is not a scalar.
type Scalar is Data:
  ScStr{text: String}
  ScNum{text: String}
  ScBool{value: Bool}

# The decision over one candidate value.
type Admission is Data:
  Admit{}
  Reject{condition: String}

# What a fact field admits: one scalar of a kind, a list of that kind, one
# name from an explicit set, a list of names from that set, or no value.
type Spec is Data:
  SpecScalar{kind: ValueKind}
  SpecList{kind: ValueKind}
  SpecEnum{allowed: Names}
  SpecEnumList{allowed: Names}
  SpecNone{condition: String}

# --- character classes -------------------------------------------------------

def is_digit(c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.pick(Bool, U32.is_lt(47, code), U32.is_lt(code, 58), False{})

def is_lower(c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.pick(Bool, U32.is_lt(96, code), U32.is_lt(code, 123), False{})

def is_upper(c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.pick(Bool, U32.is_lt(64, code), U32.is_lt(code, 91), False{})

def is_alpha(+c: Char) -> Bool:
  Bool.pick(Bool, is_upper(c), True{}, is_lower(c))

def is_underscore(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 95)

def is_dot(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 46)

def is_dash(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 45)

def is_plus(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 43)

def is_caret(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 94)

def is_tilde(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 126)

def is_equalsign(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 61)

def is_gt(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 62)

def is_lt(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 60)

def is_alnum(+c: Char) -> Bool:
  Bool.pick(Bool, is_digit(c), True{}, Bool.pick(Bool, is_lower(c), True{}, is_upper(c)))

# A character of a version suffix: alphanumeric, dot, or dash. The plus sign
# separates the build suffix and ends a suffix run.
def is_loose(+c: Char) -> Bool:
  Bool.pick(Bool, is_alnum(c), True{}, Bool.pick(Bool, is_dot(c), True{}, is_dash(c)))

# A character of an explicit path field. NUL, CR and LF are excluded; spaces
# and non-ASCII code points are admitted, because real project paths contain
# them.
def is_path_char(c: Char) -> Bool:
  +code = Char.to_u32(c)
  Bool.pick(Bool, U32.is_zero(code), False{},
    Bool.pick(Bool, U32.is_eq(code, 10), False{}, Bool.pick(Bool, U32.is_eq(code, 13), False{}, True{})))

def all_digits(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{c, rest}:
      Bool.pick(Bool, is_digit(c), all_digits(rest), False{})

def all_loose(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{c, rest}:
      Bool.pick(Bool, is_loose(c), all_loose(rest), False{})

def all_path_chars(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{c, rest}:
      Bool.pick(Bool, is_path_char(c), all_path_chars(rest), False{})

def all_key_tail(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+c, rest}:
      Bool.pick(Bool, Bool.or(is_alnum(c), is_underscore(c)), all_key_tail(rest), False{})

# --- version and range grammars ---------------------------------------------

# The numeric part: one or more digit runs separated by single dots. A dot may
# not lead, trail or repeat.
def ver_nums_go(s: String, +prev_dot: Bool, +seen: Bool) -> Bool:
  match s:
    case SNil{}: Bool.and(seen, Bool.not(prev_dot))
    case SCon{+c, +rest}:
      +digit = is_digit(c)
      +dot = is_dot(c)
      Bool.pick(Bool, digit, ver_nums_go(rest, False{}, True{}),
        Bool.pick(Bool, dot, Bool.pick(Bool, prev_dot, False{}, ver_nums_go(rest, True{}, seen)), False{}))

def version_numeric(s: String) -> Bool:
  ver_nums_go(s, True{}, False{})

# A suffix run: nonempty, all loose characters.
def suffix_ok(+s: String) -> Bool:
  Bool.pick(Bool, Tx.non_empty(s), all_loose(s), False{})

# The leading loose run of a suffix and the remainder after it.
def loose_lead(s: String, +acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{+c, +rest}:
      +take = is_loose(c)
      +grown = acc ++ SCon{c, SNil{}}
      Bool.pick(String, take, loose_lead(rest, grown), acc)

def loose_tail(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+c, +rest}:
      Bool.pick(String, is_loose(c), loose_tail(rest), SCon{c, rest})

# After the prerelease run: nothing, or one '+' followed by a build run.
def after_build(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+c, +rest}:
      Bool.pick(Bool, is_plus(c), suffix_ok(rest), False{})

# A dash suffix: a nonempty prerelease run, then the optional build run.
def after_dash(+s: String) -> Bool:
  Bool.pick(Bool, Tx.non_empty(loose_lead(s, SNil{})), after_build(loose_tail(s)), False{})

# The separator that follows the numeric part.
type SepMode is Data:
  SepNone{}
  SepDash{}
  SepPlus{}
  SepOther{}

def sep_mode(c: Char) -> SepMode:
  +code = Char.to_u32(c)
  Bool.pick(SepMode, U32.is_eq(code, 45), SepDash{},
    Bool.pick(SepMode, U32.is_eq(code, 43), SepPlus{}, SepOther{}))

def version_rest_go(m: SepMode, rest: String) -> Bool:
  match m:
    case SepNone{}: True{}
    case SepDash{}: after_dash(rest)
    case SepPlus{}: suffix_ok(rest)
    case SepOther{}: False{}

# The character following the numeric part decides the rest of the token.
def version_rest(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+c, rest}:
      version_rest_go(sep_mode(c), rest)

# The leading numeric run of a version body.
def ver_lead_go(s: String, +acc: String) -> String:
  match s:
    case SNil{}: acc
    case SCon{+c, rest}:
      +take = Bool.or(is_digit(c), is_dot(c))
      +grown = acc ++ SCon{c, SNil{}}
      Bool.pick(String, take, ver_lead_go(rest, grown), acc)

# The remainder after that run, where the suffix grammar applies.
def ver_suffix_go(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+c, +rest}:
      Bool.pick(String, Bool.or(is_digit(c), is_dot(c)), ver_suffix_go(rest), SCon{c, rest})

# An exact version token: optional v, numeric part, optional -prerelease and
# +build suffixes. A package version, a tool version and a version field
# admit exactly this shape.
def version_token(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+c, +rest}:
      +code = Char.to_u32(c)
      +vw = Bool.or(U32.is_eq(code, 118), U32.is_eq(code, 86))
      +body = Bool.pick(String, vw, rest, SCon{c, rest})
      Bool.and(version_numeric(ver_lead_go(body, SNil{})), version_rest(ver_suffix_go(body)))

# After a one-character comparator, an optional '=' forms the two-character
# form (>= and <=).
def op_eq_tail(rest: String) -> String:
  match rest:
    case SNil{}: rest
    case SCon{+d, +more}:
      Bool.pick(String, U32.is_eq(Char.to_u32(d), 61), more, SCon{d, more})

# The remainder of a comparator part after its operator.
def op_tail(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+c, +rest}:
      +one = Bool.or(Bool.or(is_caret(c), is_tilde(c)), is_equalsign(c))
      +two = Bool.or(is_gt(c), is_lt(c))
      Bool.pick(String, one, rest,
        Bool.pick(String, two, op_eq_tail(rest), SNil{}))

def range_part(+s: String) -> Bool:
  Bool.pick(Bool, String.eq(s, "*"), True{},
  Bool.pick(Bool, String.eq(s, "latest"), True{},
  Bool.pick(Bool, String.eq(s, "x"), True{},
  Bool.pick(Bool, String.eq(s, "X"), True{},
  Bool.pick(Bool, String.eq(s, "||"), True{},
    Bool.pick(Bool, String.eq(op_tail(s), s), version_token(s), version_token(op_tail(s))))))))

# Words is the Data-chain form of a string list. String is Data, so a WordCons
# cell may be read on more than one branch of a decision.
type Words is Data:
  WordNil{}
  WordCons{head: String, tail: Words}

def words_of(ps: List<String>) -> Words:
  match ps:
    case Nil{}: WordNil{}
    case h <> t: WordCons{h, words_of(t)}

def words_keep(+h: String, +rest: Words) -> Words:
  Bool.pick(Words, String.is_empty(h), rest, WordCons{h, rest})

def words_drop_empty(ps: List<String>) -> Words:
  match ps:
    case Nil{}: WordNil{}
    case h <> t:
      words_keep(h, words_drop_empty(t))

# A declared dependency range: whitespace-separated comparators with optional
# single union separators. At least one comparator is required, and a union
# separator may not lead, trail or repeat.
def parts_go(ps: Words, +last: Bool, +count: U32) -> Bool:
  match ps:
    case WordNil{}: Bool.and(last, U32.is_gt(count, 0))
    case WordCons{+h, +t}:
      +bar = String.eq(h, "||")
      +after_bar = parts_go(t, False{}, count)
      +normal = Bool.pick(Bool, range_part(h), parts_go(t, True{}, U32.inc(count)), False{})
      Bool.pick(Bool, bar, Bool.pick(Bool, last, after_bar, False{}), normal)

def range_token(+s: String) -> Bool:
  Bool.and(Tx.non_empty(s), parts_go(words_drop_empty(Tx.split_spaces(s)), False{}, 0))

# --- the remaining value shapes ---------------------------------------------

def key_name(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+c, rest}:
      Bool.and(Bool.or(is_alpha(c), is_underscore(c)), all_key_tail(rest))

def path_field(+s: String) -> Bool:
  Bool.and(Tx.non_empty(s), all_path_chars(s))

def number_token(+s: String) -> Bool:
  Bool.and(Tx.non_empty(s), all_digits(s))

# One selector per value kind. The index names the kind so that a decision
# over several kinds is a chain of Bool.pick calls.
def kind_is(k: ValueKind, which: U32) -> Bool:
  match k:
    case KVersion{}: U32.is_eq(0, which)
    case KRange{}: U32.is_eq(1, which)
    case KKey{}: U32.is_eq(2, which)
    case KPath{}: U32.is_eq(3, which)
    case KBool{}: U32.is_eq(4, which)
    case KNumber{}: U32.is_eq(5, which)
    case KPresence{}: U32.is_eq(6, which)

def admit_version(+text: String) -> Admission:
  Bool.pick(Admission, version_token(text), Admit{}, Reject{"not-a-version-token"})

def admit_range(+text: String) -> Admission:
  Bool.pick(Admission, range_token(text), Admit{}, Reject{"not-a-dependency-range"})

def admit_key(+text: String) -> Admission:
  Bool.pick(Admission, key_name(text), Admit{}, Reject{"not-a-key-name"})

def admit_path(+text: String) -> Admission:
  Bool.pick(Admission, path_field(text), Admit{}, Reject{"not-a-path-field"})

def admit_str(+kind: ValueKind, +text: String) -> Admission:
  Bool.pick(Admission, kind_is(kind, 0), admit_version(text),
  Bool.pick(Admission, kind_is(kind, 1), admit_range(text),
  Bool.pick(Admission, kind_is(kind, 2), admit_key(text),
  Bool.pick(Admission, kind_is(kind, 3), admit_path(text),
    Reject{"string-not-admitted-for-kind"}))))

def admit_num(+kind: ValueKind, +text: String) -> Admission:
  Bool.pick(Admission, kind_is(kind, 5),
    Bool.pick(Admission, number_token(text), Admit{}, Reject{"not-a-decimal-number"}),
    Bool.pick(Admission, kind_is(kind, 1), admit_range(text), Reject{"number-not-admitted-for-kind"}))

def admit_bool(+kind: ValueKind, value: Bool) -> Admission:
  Bool.pick(Admission, Bool.or(kind_is(kind, 4), kind_is(kind, 6)), Admit{},
    Reject{"boolean-not-admitted-for-kind"})

def admit_scalar(kind: ValueKind, s: Scalar) -> Admission:
  match s:
    case ScStr{text}: admit_str(kind, text)
    case ScNum{text}: admit_num(kind, text)
    case ScBool{value}: admit_bool(kind, value)

def admit_scalar_node(kind: ValueKind, j: J.Json) -> Admission:
  match j:
    case J.Jstr{value}: admit_scalar(kind, ScStr{value})
    case J.Jint{value}: admit_scalar(kind, ScNum{U32.show(value)})
    case J.Jtrue{}: admit_scalar(kind, ScBool{True{}})
    case J.Jfalse{}: admit_scalar(kind, ScBool{False{}})
    case J.Jnull{}: Reject{"null-is-not-an-admitted-value"}
    case J.Jarr{head, tail}: Reject{"container-is-not-a-scalar"}
    case J.Jobj{members}: Reject{"container-is-not-a-scalar"}
    case J.Jpair{key, value, rest}: Reject{"container-is-not-a-scalar"}
    case J.Jnil{}: Reject{"missing-value"}

def is_admit(a: Admission) -> Bool:
  match a:
    case Admit{}: True{}
    case Reject{condition}: False{}

def condition_of(a: Admission) -> String:
  match a:
    case Admit{}: ""
    case Reject{condition}: condition

def is_missing_admission(a: Admission) -> Bool:
  match a:
    case Reject{condition}: String.eq(condition, "missing-value")
    case Admit{}: False{}

# Every element of an array must be admitted by the element kind. The canonical
# tree represents the empty array as a cell whose head is Jnil, so that cell
# ends the walk.
def admit_elements(+kind: ValueKind, j: J.Json) -> Admission:
  match j:
    case J.Jarr{head, tail}:
      +first = admit_scalar_node(kind, head)
      Bool.pick(Admission, is_missing_admission(first), Admit{},
        Bool.pick(Admission, is_admit(first), admit_elements(kind, tail), first))
    case J.Jnil{}: Admit{}
    case J.Jstr{value}: Reject{"expected-list"}
    case J.Jint{value}: Reject{"expected-list"}
    case J.Jtrue{}: Reject{"expected-list"}
    case J.Jfalse{}: Reject{"expected-list"}
    case J.Jnull{}: Reject{"expected-list"}
    case J.Jobj{members}: Reject{"expected-list"}
    case J.Jpair{key, value, rest}: Reject{"expected-list"}

def admit_list_node(+kind: ValueKind, j: J.Json) -> Admission:
  match j:
    case J.Jarr{head, tail}: admit_elements(kind, j)
    case J.Jnil{}: Reject{"expected-list"}
    case J.Jstr{value}: Reject{"expected-list"}
    case J.Jint{value}: Reject{"expected-list"}
    case J.Jtrue{}: Reject{"expected-list"}
    case J.Jfalse{}: Reject{"expected-list"}
    case J.Jnull{}: Reject{"expected-list"}
    case J.Jobj{members}: Reject{"expected-list"}
    case J.Jpair{key, value, rest}: Reject{"expected-list"}

# Membership in an explicit option set.
def names_has(names: Names, +key: String) -> Bool:
  match names:
    case NameNil{}: False{}
    case NameCons{+h, +t}:
      Bool.pick(Bool, String.eq(h, key), True{}, names_has(t, key))

def admit_enum_node(allowed: Names, j: J.Json) -> Admission:
  match j:
    case J.Jstr{value}: Bool.pick(Admission, names_has(allowed, value), Admit{}, Reject{"not-an-allowed-option-value"})
    case J.Jint{value}: Reject{"enum-value-must-be-a-string"}
    case J.Jtrue{}: Reject{"enum-value-must-be-a-string"}
    case J.Jfalse{}: Reject{"enum-value-must-be-a-string"}
    case J.Jnull{}: Reject{"null-is-not-an-admitted-value"}
    case J.Jarr{head, tail}: Reject{"container-is-not-a-scalar"}
    case J.Jobj{members}: Reject{"container-is-not-a-scalar"}
    case J.Jpair{key, value, rest}: Reject{"container-is-not-a-scalar"}
    case J.Jnil{}: Reject{"missing-value"}

def admit_enum_elements(+allowed: Names, j: J.Json) -> Admission:
  match j:
    case J.Jarr{head, tail}:
      +first = admit_enum_node(allowed, head)
      Bool.pick(Admission, is_admit(first), admit_enum_elements(allowed, tail), first)
    case J.Jnil{}: Admit{}
    case J.Jstr{value}: Reject{"expected-list"}
    case J.Jint{value}: Reject{"expected-list"}
    case J.Jtrue{}: Reject{"expected-list"}
    case J.Jfalse{}: Reject{"expected-list"}
    case J.Jnull{}: Reject{"expected-list"}
    case J.Jobj{members}: Reject{"expected-list"}
    case J.Jpair{key, value, rest}: Reject{"expected-list"}

def admit_enum_list_node(allowed: Names, j: J.Json) -> Admission:
  match j:
    case J.Jarr{head, tail}: admit_enum_elements(allowed, j)
    case J.Jnil{}: Reject{"expected-list"}
    case J.Jstr{value}: Reject{"expected-list"}
    case J.Jint{value}: Reject{"expected-list"}
    case J.Jtrue{}: Reject{"expected-list"}
    case J.Jfalse{}: Reject{"expected-list"}
    case J.Jnull{}: Reject{"expected-list"}
    case J.Jobj{members}: Reject{"expected-list"}
    case J.Jpair{key, value, rest}: Reject{"expected-list"}

# The single entry: does this fact field admit this JSON value?
def admit_value(spec: Spec, j: J.Json) -> Admission:
  match spec:
    case SpecNone{condition}: Reject{condition}
    case SpecScalar{kind}: admit_scalar_node(kind, j)
    case SpecList{kind}: admit_list_node(kind, j)
    case SpecEnum{allowed}: admit_enum_node(allowed, j)
    case SpecEnumList{allowed}: admit_enum_list_node(allowed, j)
