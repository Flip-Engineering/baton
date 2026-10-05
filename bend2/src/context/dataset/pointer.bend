# RFC 6901 JSON Pointer resolution and structure over one document value.
#
# A pointer is the exact text the request supplied: the empty string selects the
# document root, and every other pointer begins with '/'. The escape sequences
# ~1 (a '/' in a key) and ~0 (a '~' in a key) decode to the key text. A '~'
# followed by anything else makes the pointer invalid, and no invalid pointer
# reaches a document read.
#
# Resolution reports the value it reached and that value's pointer, a missing
# pointer for a token that selects nothing, and a condition for a pointer whose
# syntax is not RFC 6901. Nothing here converts a number: a selected value
# carries the tokens the document held.
#
# Reference: RFC 6901 sections 3 and 4.

import Base
import ../../git/text.bend as Tx
import ./value.bend as V

# The result of resolving one pointer.
type Found is Data:
  FOk{doc: V.Doc, pointer: String}
  FMissing{pointer: String}
  FBad{condition: String}

# One step of resolution.
type Desc is Data:
  DescFound{doc: V.Doc}
  DescMissing{}

# One node of the structure projection.
type Nodes is Data:
  NodesNil{}
  NodesCons{pointer: String, kind: String, children: V.Ptrs, rest: Nodes}

# One queued node of the structure walk.
type Work is Data:
  WorkNil{}
  WorkCons{pointer: String, doc: V.Doc, rest: Work}

# The result of the structure projection over a selected value.
type Structure is Data:
  StOk{nodes: Nodes, count: U32}
  StMissing{pointer: String}
  StBad{condition: String}

# --- pointer text ------------------------------------------------------------

def is_slash(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 47)

def is_tilde(c: Char) -> Bool:
  U32.is_eq(Char.to_u32(c), 126)

def tilde_text() -> String:
  SCon{Char.from_u32(126), SNil{}}

def slash_text() -> String:
  SCon{Char.from_u32(47), SNil{}}

# The escaped spelling of a member key inside a pointer: '~' as ~0, '/' as ~1.
def ptr_escape(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+c, rest}:
      +tilde = Bool.pick(String, is_tilde(c), tilde_text() ++ SCon{Char.from_u32(48), SNil{}}, SNil{})
      +slash = Bool.pick(String, is_slash(c), tilde_text() ++ SCon{Char.from_u32(49), SNil{}}, SNil{})
      +plain = SCon{c, SNil{}}
      Bool.pick(String, is_tilde(c), tilde, Bool.pick(String, is_slash(c), slash, plain)) ++ ptr_escape(rest)

# The decoded key text of one pointer token. The walk carries whether the
# previous character was a '~', so every escape code is decoded exactly once.
def ptr_decode_go(s: String, +escape: Bool) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+c, +rest}:
      +code = Char.to_u32(c)
      +is_zero = U32.is_eq(code, 48)
      +is_one = U32.is_eq(code, 49)
      +tilde = is_tilde(c)
      +escaping = Bool.and(escape, is_zero)
      +slashed = Bool.and(escape, is_one)
      +next_escape = Bool.and(Bool.not(escape), tilde)
      +decoded = Bool.pick(String, escaping, tilde_text(),
                   Bool.pick(String, slashed, slash_text(),
                     Bool.pick(String, next_escape, SNil{}, SCon{c, SNil{}})))
      decoded ++ ptr_decode_go(rest, next_escape)

def ptr_decode(s: String) -> String:
  ptr_decode_go(s, False{})

# A token is valid when every '~' begins ~0 or ~1 and no '/' appears.
def token_ok(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+c, rest}:
      Bool.pick(Bool, is_slash(c), False{}, Bool.pick(Bool, is_tilde(c), esc_ok(rest), token_ok(rest)))

def esc_ok(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{d, more}:
      +code = Char.to_u32(d)
      +valid = Bool.or(U32.is_eq(code, 48), U32.is_eq(code, 49))
      Bool.pick(Bool, valid, token_ok(more), False{})

def has_slash(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{c, rest}: Bool.pick(Bool, is_slash(c), True{}, has_slash(rest))

def before_slash(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{+c, rest}:
      Bool.pick(String, is_slash(c), SNil{}, SCon{c, SNil{}} ++ before_slash(rest))

def after_slash(s: String) -> String:
  match s:
    case SNil{}: SNil{}
    case SCon{c, rest}: Bool.pick(String, is_slash(c), rest, after_slash(rest))

# The text after a pointer's leading slash: a slash-separated token list. A
# trailing slash adds one empty token, which is a key of length zero.
def tokens_ok(s: String) -> Bool:
  +more = has_slash(s)
  +rest = after_slash(s)
  Bool.and(token_ok(before_slash(s)), Bool.pick(Bool, more, tokens_ok(rest), True{}))

# The syntax of a whole pointer: the empty string, or one that begins with '/'
# and whose tokens are valid.
def pointer_ok(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{+c, rest}:
      Bool.pick(Bool, is_slash(c), tokens_ok(rest), False{})

# --- array index tokens ------------------------------------------------------

# The index token of RFC 6901: the single digit "0", or a digit 1-9 followed by
# any digits. A leading zero, a sign and a non-digit are all invalid.
def all_digit_chars(s: String) -> Bool:
  match s:
    case SNil{}: True{}
    case SCon{c, rest}:
      Bool.pick(Bool, Char.is_digit(c), all_digit_chars(rest), False{})

def index_token(s: String) -> Bool:
  match s:
    case SNil{}: False{}
    case SCon{+c, rest}:
      +code = Char.to_u32(c)
      +is_zero = U32.is_eq(code, 48)
      +is_nonzero = Bool.pick(Bool, U32.is_lt(48, code), U32.is_lt(code, 58), False{})
      Bool.pick(Bool, is_zero, String.is_empty(rest), Bool.and(is_nonzero, all_digit_chars(rest)))

# --- resolution --------------------------------------------------------------

def member_lookup(members: V.Doc, +key: String) -> Desc:
  match members:
    case V.VEnd{}: DescMissing{}
    case V.VMember{+k, +value, +rest}:
      Bool.pick(Desc, String.eq(k, key), DescFound{value}, member_lookup(rest, key))
    case V.VNull{}: DescMissing{}
    case V.VBool{value}: DescMissing{}
    case V.VNum{text}: DescMissing{}
    case V.VStr{value}: DescMissing{}
    case V.VArr{items}: DescMissing{}
    case V.VObj{members2}: DescMissing{}
    case V.VCell{value, rest}: DescMissing{}

def index_walk(cells: V.Doc, i: U32) -> Desc:
  match cells:
    case V.VEnd{}: DescMissing{}
    case V.VCell{value, rest}:
      Bool.pick(Desc, U32.is_zero(i), DescFound{value}, index_walk(rest, U32.sub(i, 1)))
    case V.VNull{}: DescMissing{}
    case V.VBool{value}: DescMissing{}
    case V.VNum{text}: DescMissing{}
    case V.VStr{value}: DescMissing{}
    case V.VArr{items}: DescMissing{}
    case V.VObj{members}: DescMissing{}
    case V.VMember{key, value, rest}: DescMissing{}

# An array index selects a cell only when the token has the RFC 6901 index
# form and its value is representable. An unrepresentable token selects
# nothing; the walk stops at the end of the cell chain for any larger index.
def index_of(items: V.Doc, +token: String) -> Desc:
  match U32.read(token):
    case None{}: DescMissing{}
    case Some{n}: Bool.pick(Desc, index_token(token), index_walk(items, n), DescMissing{})

# One token selects one member of an object or one element of an array. Any
# other value has no members, so the token selects nothing.
def descend(doc: V.Doc, token: String) -> Desc:
  match doc:
    case V.VObj{members}: member_lookup(members, token)
    case V.VArr{items}: index_of(items, token)
    case V.VNull{}: DescMissing{}
    case V.VBool{value}: DescMissing{}
    case V.VNum{text}: DescMissing{}
    case V.VStr{value}: DescMissing{}
    case V.VCell{value, rest}: DescMissing{}
    case V.VMember{key, value, rest}: DescMissing{}
    case V.VEnd{}: DescMissing{}

def ptr_walk(path: String, doc: V.Doc, at: String) -> Found:
  +tok = before_slash(path)
  +more = has_slash(path)
  +rest = after_slash(path)
  +key = ptr_decode(tok)
  +child = descend(doc, key)
  match child:
    case DescFound{d}:
      +at2 = at ++ slash_text() ++ tok
      Bool.pick(Found, more, ptr_walk(rest, d, at2), FOk{d, at2})
    case DescMissing{}: FMissing{at ++ slash_text() ++ tok}

# Resolve one pointer into one document value. The pointer's syntax is checked
# before any token reaches the document, so an invalid escape cannot decode.
def resolve(doc: V.Doc, pointer: String) -> Found:
  match pointer:
    case SNil{}: FOk{doc, SNil{}}
    case SCon{+c, rest}:
      Bool.pick(Found, Bool.and(is_slash(c), pointer_ok(pointer)),
        ptr_walk(rest, doc, SNil{}),
        FBad{"not-rfc6901-pointer"})

# --- structure ---------------------------------------------------------------

def member_kids(members: V.Doc, pointer: String, acc: Work) -> Work:
  match members:
    case V.VEnd{}: acc
    case V.VMember{+k, +value, +rest}:
      member_kids(rest, pointer, WorkCons{pointer ++ slash_text() ++ ptr_escape(k), value, acc})
    case V.VNull{}: acc
    case V.VBool{value}: acc
    case V.VNum{text}: acc
    case V.VStr{value}: acc
    case V.VArr{items}: acc
    case V.VObj{members2}: acc
    case V.VCell{value, rest}: acc

def cell_kids(cells: V.Doc, index: U32, pointer: String, acc: Work) -> Work:
  match cells:
    case V.VEnd{}: acc
    case V.VCell{+value, +rest}:
      cell_kids(rest, U32.inc(index), pointer, WorkCons{pointer ++ slash_text() ++ U32.show(index), value, acc})
    case V.VNull{}: acc
    case V.VBool{value}: acc
    case V.VNum{text}: acc
    case V.VStr{value}: acc
    case V.VArr{items}: acc
    case V.VObj{members}: acc
    case V.VMember{key, value, rest}: acc

def kids_of(pointer: String, doc: V.Doc) -> Work:
  match doc:
    case V.VObj{members}: member_kids(members, pointer, WorkNil{})
    case V.VArr{items}: cell_kids(items, 0, pointer, WorkNil{})
    case V.VNull{}: WorkNil{}
    case V.VBool{value}: WorkNil{}
    case V.VNum{text}: WorkNil{}
    case V.VStr{value}: WorkNil{}
    case V.VCell{value, rest}: WorkNil{}
    case V.VMember{key, value, rest}: WorkNil{}
    case V.VEnd{}: WorkNil{}

def work_ptrs(work: Work, acc: V.Ptrs) -> V.Ptrs:
  match work:
    case WorkNil{}: acc
    case WorkCons{+pointer, +doc, +rest}: work_ptrs(rest, V.PtrCons{pointer, acc})

def ptrs_reverse(ps: V.Ptrs, acc: V.Ptrs) -> V.Ptrs:
  match ps:
    case V.PtrNil{}: acc
    case V.PtrCons{+head, +tail}: ptrs_reverse(tail, V.PtrCons{head, acc})

def work_append(kids: Work, rest: Work) -> Work:
  match kids:
    case WorkNil{}: rest
    case WorkCons{+pointer, +doc, +tail}: WorkCons{pointer, doc, work_append(tail, rest)}

def nodes_reverse(nodes: Nodes, acc: Nodes) -> Nodes:
  match nodes:
    case NodesNil{}: acc
    case NodesCons{+pointer, +kind, +children, +rest}: nodes_reverse(rest, NodesCons{pointer, kind, children, acc})

def nodes_count(nodes: Nodes) -> U32:
  match nodes:
    case NodesNil{}: 0
    case NodesCons{+pointer, +kind, +children, +rest}: U32.inc(nodes_count(rest))

def struct_go(work: Work, acc: Nodes) -> Nodes:
  match work:
    case WorkNil{}: acc
    case WorkCons{+pointer, +doc, +rest}:
      +kids = kids_of(pointer, doc)
      struct_go(work_append(kids, rest),
        NodesCons{pointer, V.doc_kind(doc), ptrs_reverse(work_ptrs(kids, V.PtrNil{}), V.PtrNil{}), acc})

# The structure projection over the value one pointer selects: every node of
# that value with its type name and its immediate child pointers.
def structure(doc: V.Doc, pointer: String) -> Structure:
  match resolve(doc, pointer):
    case FOk{+d, +at}:
      +nodes = struct_go(WorkCons{at, d, WorkNil{}}, NodesNil{})
      StOk{nodes_reverse(nodes, NodesNil{}), nodes_count(nodes)}
    case FMissing{at}: StMissing{at}
    case FBad{condition}: StBad{condition}
