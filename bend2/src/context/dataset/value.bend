# The dataset document value: the internal representation the dataset
# traversal reads.
#
# A document value is not a request. Request admission and canonical request
# text belong to the codec, whose closed numeric profile admits unsigned
# decimal U32 tokens in declared fields. A dataset document carries the JSON
# its author wrote, so a number keeps its exact token text: "-1.5", "1e3",
# "9007199254740993" and "1e400" are representable and none is converted
# through U32 or a host float.
#
# The representation keeps the JSON distinctions the traversal reports: null,
# an empty array and an empty object are three different values.
#
# `doc_of_json` converts the codec's canonical tree, whose numeric domain is
# U32, and supports the shared-subset fixtures. Reconstruction supplies
# token-preserving nodes through the VNum constructor directly.

import Base
import ../../json/canonical.bend as J

# One document value. Array cells and object members are separate chains, so an
# array element and an object member are never confused.
type Doc is Data:
  VNull{}
  VBool{value: Bool}
  VNum{text: String}
  VStr{value: String}
  VArr{items: Doc}
  VObj{members: Doc}
  VCell{value: Doc, rest: Doc}
  VMember{key: String, value: Doc, rest: Doc}
  VEnd{}

# A chain of pointer strings, for the child pointers of `structure`.
type Ptrs is Data:
  PtrNil{}
  PtrCons{head: String, tail: Ptrs}

# The scalar view of a record's key.
type KeyView is Data:
  KeyMissing{}
  KeyNonScalar{kind: String}
  KeyScalar{kind: String, text: String}

# --- JSON number tokens ------------------------------------------------------

# The scanner states: 0 before the integer part, 1 inside it, 10 after a single
# zero, 2 after the fraction dot, 4 inside the fraction, 3 after the exponent
# marker, 5 after its sign, 6 inside the exponent digits, 9 refused.
def num_next(+state: U32, +c: Char) -> U32:
  +code = Char.to_u32(c)
  +digit = Char.is_digit(c)
  +dot = U32.is_eq(code, 46)
  +mark = Bool.or(U32.is_eq(code, 101), U32.is_eq(code, 69))
  +sign = Bool.or(U32.is_eq(code, 43), U32.is_eq(code, 45))
  Bool.pick(U32, U32.is_eq(state, 0),
    Bool.pick(U32, digit, Bool.pick(U32, U32.is_eq(code, 48), 10, 1), 9),
  Bool.pick(U32, U32.is_eq(state, 1),
    Bool.pick(U32, digit, 1, Bool.pick(U32, dot, 2, Bool.pick(U32, mark, 3, 9))),
  Bool.pick(U32, U32.is_eq(state, 10),
    Bool.pick(U32, dot, 2, Bool.pick(U32, mark, 3, 9)),
  Bool.pick(U32, U32.is_eq(state, 2),
    Bool.pick(U32, digit, 4, 9),
  Bool.pick(U32, U32.is_eq(state, 4),
    Bool.pick(U32, digit, 4, Bool.pick(U32, mark, 3, 9)),
  Bool.pick(U32, U32.is_eq(state, 3),
    Bool.pick(U32, sign, 5, Bool.pick(U32, digit, 6, 9)),
  Bool.pick(U32, U32.is_eq(state, 5),
    Bool.pick(U32, digit, 6, 9),
  Bool.pick(U32, U32.is_eq(state, 6),
    Bool.pick(U32, digit, 6, 9), 9))))))))

def num_scan(s: String, state: U32) -> U32:
  match s:
    case SNil{}: state
    case SCon{c, rest}: num_scan(rest, num_next(state, c))

def num_accept(+state: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(state, 1), True{},
  Bool.pick(Bool, U32.is_eq(state, 4), True{},
  Bool.pick(Bool, U32.is_eq(state, 6), True{}, U32.is_eq(state, 10))))

# The body after an optional minus sign; a minus with nothing after it is
# refused by the empty body's start state.
def body_of(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+c, +rest}:
      Bool.pick(String, U32.is_eq(Char.to_u32(c), 45), rest, SCon{c, rest})

def body_ok(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{c, rest}:
      Bool.pick(Bool, U32.is_eq(Char.to_u32(c), 45), Bool.not(String.is_empty(rest)), True{})

# An exact JSON number token: an optional minus, an integer part, an optional
# fraction and an optional exponent.
def json_number_token(+s: String) -> Bool:
  Bool.and(body_ok(s), num_accept(num_scan(body_of(s), 0)))

# A token-preserving number node. Reconstruction builds every number through
# this entry, so an unvalidated token never reaches a value or its text.
type NumResult is Data:
  NumOk{doc: Doc}
  NumBad{condition: String}

def number_node(text: String) -> NumResult:
  Bool.pick(NumResult, json_number_token(text), NumOk{VNum{text}}, NumBad{"not-a-json-number-token"})

# --- kind and scalar view ----------------------------------------------------

def doc_kind(doc: Doc) -> String:
  match doc:
    case VNull{}: "null"
    case VBool{value}: "boolean"
    case VNum{text}: "number"
    case VStr{value}: "string"
    case VArr{items}: "array"
    case VObj{members}: "object"
    case VCell{value, rest}: "cell"
    case VMember{key, value, rest}: "member"
    case VEnd{}: "end"

# The scalar view of a value used as a join key. Equality here is exact: two
# numbers are equal when their tokens are equal, so a signed, fractional,
# exponent or large token compares as written.
def key_view(doc: Doc) -> KeyView:
  match doc:
    case VNull{}: KeyScalar{"null", "null"}
    case VBool{value}: KeyScalar{"boolean", Bool.pick(String, value, "true", "false")}
    case VNum{text}: KeyScalar{"number", text}
    case VStr{value}: KeyScalar{"string", value}
    case VArr{items}: KeyNonScalar{"array"}
    case VObj{members}: KeyNonScalar{"object"}
    case VCell{value, rest}: KeyNonScalar{"cell"}
    case VMember{key, value, rest}: KeyNonScalar{"member"}
    case VEnd{}: KeyNonScalar{"end"}

def key_kind_of(kv: KeyView) -> String:
  match kv:
    case KeyMissing{}: "missing"
    case KeyNonScalar{kind}: kind
    case KeyScalar{kind, text}: kind

def key_text_of(kv: KeyView) -> String:
  match kv:
    case KeyMissing{}: SNil{}
    case KeyNonScalar{kind}: SNil{}
    case KeyScalar{kind, text}: text

def key_present(kv: KeyView) -> Bool:
  match kv:
    case KeyScalar{kind, text}: True{}
    case KeyMissing{}: False{}
    case KeyNonScalar{kind}: False{}

# Exact equality of two present scalar keys.
def key_equal(a: KeyView, b: KeyView) -> Bool:
  match a:
    case KeyScalar{kind, text}:
      match b:
        case KeyScalar{bkind, btext}: Bool.and(String.eq(kind, bkind), String.eq(text, btext))
        case KeyMissing{}: False{}
        case KeyNonScalar{bkind}: False{}
    case KeyMissing{}: False{}
    case KeyNonScalar{kind}: False{}

# --- conversion from the codec's canonical tree -----------------------------

# The walk mode: one value, one array cell, or one object member.
type JMode is Data:
  JmValue{}
  JmCell{}
  JmMember{}

def jm_is_cell(m: JMode) -> Bool:
  match m:
    case JmCell{}: True{}
    case JmValue{}: False{}
    case JmMember{}: False{}

def jnode_is_end(j: J.Json) -> Bool:
  match j:
    case J.Jnil{}: True{}
    case J.Jnull{}: False{}
    case J.Jtrue{}: False{}
    case J.Jfalse{}: False{}
    case J.Jint{value}: False{}
    case J.Jstr{value}: False{}
    case J.Jarr{head, tail}: False{}
    case J.Jobj{members}: False{}
    case J.Jpair{key, value, rest}: False{}

# One walk over the codec's canonical tree, carrying its mode. The canonical
# array cell whose head is Jnil is the empty array, and the cell chain ends at
# Jnil, so both terminate here.
def doc_walk(j: J.Json, +mode: JMode) -> Doc:
  match j:
    case J.Jnull{}: VNull{}
    case J.Jtrue{}: VBool{True{}}
    case J.Jfalse{}: VBool{False{}}
    case J.Jint{value}: VNum{U32.show(value)}
    case J.Jstr{value}: VStr{value}
    case J.Jarr{+head, tail}:
      +ends = jnode_is_end(head)
      +chain : Doc = VCell{doc_walk(head, JmValue{}), doc_walk(tail, JmCell{})}
      Bool.pick(Doc, ends,
        Bool.pick(Doc, jm_is_cell(mode), VEnd{}, VArr{VEnd{}}),
        Bool.pick(Doc, jm_is_cell(mode), chain, VArr{chain}))
    case J.Jpair{key, value, rest}: VMember{key, doc_walk(value, JmValue{}), doc_walk(rest, JmMember{})}
    case J.Jobj{members}: VObj{doc_walk(members, JmMember{})}
    case J.Jnil{}: VEnd{}

def doc_of_json(j: J.Json) -> Doc:
  doc_walk(j, JmValue{})

# --- canonical document text -------------------------------------------------

def sep_of(+first: Bool) -> String:
  Bool.pick(String, first, SNil{}, ",")

def member_key(cell: Doc) -> String:
  match cell:
    case VMember{+key, +value, +rest}: key
    case VNull{}: SNil{}
    case VBool{value}: SNil{}
    case VNum{text}: SNil{}
    case VStr{value}: SNil{}
    case VArr{items}: SNil{}
    case VObj{members}: SNil{}
    case VCell{value, rest}: SNil{}
    case VEnd{}: SNil{}

def prepend_cell(+cell: Doc, tail: Doc) -> Doc:
  match cell:
    case VMember{key, value, rest}: VMember{key, value, tail}
    case VNull{}: tail
    case VBool{value}: tail
    case VNum{text}: tail
    case VStr{value}: tail
    case VArr{items}: tail
    case VObj{members}: tail
    case VCell{value, rest}: tail
    case VEnd{}: tail

def insert_member(+cell: Doc, +chain: Doc) -> Doc:
  match chain:
    case VEnd{}: cell
    case VMember{+key, +value, +rest}:
      Bool.pick(Doc, J.key_le(member_key(cell), key),
        prepend_cell(cell, chain),
        VMember{key, value, insert_member(cell, rest)})
    case VNull{}: chain
    case VBool{value}: chain
    case VNum{text}: chain
    case VStr{value}: chain
    case VArr{items}: chain
    case VObj{members}: chain
    case VCell{value, rest}: chain

def sort_members(members: Doc) -> Doc:
  match members:
    case VEnd{}: VEnd{}
    case VMember{key, value, rest}: insert_member(VMember{key, value, VEnd{}}, sort_members(rest))
    case VNull{}: VEnd{}
    case VBool{value}: VEnd{}
    case VNum{text}: VEnd{}
    case VStr{value}: VEnd{}
    case VArr{items}: VEnd{}
    case VObj{members}: VEnd{}
    case VCell{value, rest}: VEnd{}

# Rebuild the tree with each object's members in lexicographic key order. The
# walk normalizes values; the member chains are then sorted without further
# normalization.
def doc_norm(doc: Doc) -> Doc:
  match doc:
    case VNull{}: VNull{}
    case VBool{value}: VBool{value}
    case VNum{text}: VNum{text}
    case VStr{value}: VStr{value}
    case VArr{items}: VArr{doc_norm(items)}
    case VObj{members}: VObj{sort_members(doc_norm(members))}
    case VCell{value, rest}: VCell{doc_norm(value), doc_norm(rest)}
    case VMember{key, value, rest}: VMember{key, doc_norm(value), doc_norm(rest)}
    case VEnd{}: VEnd{}

# One walk writes the document text: members in the order the tree holds them,
# each number as its exact token, and a separator before every element after
# the first of its container.
def doc_emit(doc: Doc, +first: Bool) -> String:
  match doc:
    case VNull{}: "null"
    case VBool{value}: Bool.pick(String, value, "true", "false")
    case VNum{text}: text
    case VStr{value}: J.string_literal(value)
    case VArr{items}: "[" ++ doc_emit(items, True{}) ++ "]"
    case VObj{members}: "{" ++ doc_emit(members, True{}) ++ "}"
    case VCell{value, rest}: sep_of(first) ++ doc_emit(value, True{}) ++ doc_emit(rest, False{})
    case VMember{key, value, rest}: sep_of(first) ++ J.string_literal(key) ++ ":" ++ doc_emit(value, True{}) ++ doc_emit(rest, False{})
    case VEnd{}: SNil{}

def doc_text(doc: Doc) -> String:
  doc_emit(doc, True{})

def doc_text_sorted(doc: Doc) -> String:
  doc_emit(doc_norm(doc), True{})
