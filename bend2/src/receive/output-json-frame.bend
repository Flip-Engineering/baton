# CLAIM: one complete frame of octets is parsed into a structural value that keeps object
# members in original order, including repeated and differently escaped keys, keeps array
# order, keeps every scalar distinct, and retains the whole original input on every
# disposition. Object members are held as one flat list in which keys and values alternate,
# so the value type refers only to itself. The list is even in length and every key is a
# string by construction: a key is appended only by the key step and a value only by the
# value step, and the corpus asserts both invariants on the finished values.
# Scope: structure only. This module makes no duplicate member policy decision, performs no
# SQLite comparison and converts no numeric lexeme to a machine number.
# Structure: pure helpers first, then one self-recursive step whose match subjects are its own
# parameters, then the entry. No helper calls step, so there is no cycle, and no match is
# taken on a computed call.
# The lexer already validates the host octet contract over the whole input and reports a
# first element at or above 256 before any grammar decision, so host faults and token
# refusals reach this module as final results and are translated with the whole input
# retained. Opacity is preserved: a refusal or unsupported outcome is never turned into a
# value.
# Language forms grounded on the pinned Base and the reviewed receive modules: sibling
# imports written as ./name.bend, Bool.pick with a first type argument, element-with-list
# cons with plus markers on reused binders, U32.is_eq, String.eq, definitions before their
# callers, and constructor patterns in positional form.
# UNCOMPILED and UNTESTED.

import Base
import ./output-json-lex.bend as L

type FrameVal is Data:
  FNull{}
  FBool{value: Bool}
  FNum{original: List<U32>}
  FStr{units: List<U32>, original: List<U32>}
  FArr{items: List<FrameVal>}
  FObj{members: List<FrameVal>}

type Container is Data:
  CArr{items: List<FrameVal>, started: Bool}
  CObj{members: List<FrameVal>, started: Bool}

type Pending is Data:
  PValue{}
  PKey{}
  PColon{}
  PAfterElem{}
  PDone{value: FrameVal}
  PFailed{reason: String}

type FrameResult is Data:
  FrameOk{value: FrameVal, original: List<U32>}
  FrameRefused{reason: String, original: List<U32>}
  FrameUnsupported{reason: String, original: List<U32>}
  FrameHostFault{value: U32, original: List<U32>}

def rev_vals(xs: List<FrameVal>, acc: List<FrameVal>) -> List<FrameVal>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_vals(t, h <> acc)

def is_code(+tok: L.LexTok, +code: U32) -> Bool:
  match tok:
    case L.Punctuation{c}: U32.is_eq(c, code)
    case L.StrTok{_u, _o}: False{}
    case L.NumTok{_o}: False{}
    case L.LitTok{_n, _o}: False{}

# The lexer emits only the three literal names, so any other name is not reachable here.
def lit_value(+name: String) -> FrameVal:
  Bool.pick(FrameVal, String.eq(name, "true"), FBool{True{}},
    Bool.pick(FrameVal, String.eq(name, "false"), FBool{False{}}, FNull{}))

# Appending a value or a key marks the container as started, so a closing byte is no longer
# accepted where only a further element may appear.
def absorb_value(+stack: List<Container>, +value: FrameVal) -> List<Container>:
  match stack:
    case Nil{}: Nil{}
    case CArr{items, _started} <> t: CArr{value <> items, True{}} <> t
    case CObj{members, _started} <> t: CObj{value <> members, True{}} <> t

def with_key(+stack: List<Container>, +key: FrameVal) -> List<Container>:
  match stack:
    case Nil{}: Nil{}
    case CArr{items, _started} <> t: CArr{key <> items, True{}} <> t
    case CObj{members, _started} <> t: CObj{key <> members, True{}} <> t

def pop_stack(+stack: List<Container>) -> List<Container>:
  match stack:
    case Nil{}: Nil{}
    case _h <> t: t

def close_val(+stack: List<Container>) -> FrameVal:
  match stack:
    case Nil{}: FNull{}
    case CArr{items, _started} <> _t: FArr{rev_vals(items, Nil{})}
    case CObj{members, _started} <> _t: FObj{rev_vals(members, Nil{})}

def close_stack(+stack: List<Container>) -> List<Container>:
  absorb_value(pop_stack(stack), close_val(stack))

def completed_pending(+stack: List<Container>, +value: FrameVal) -> Pending:
  match stack:
    case Nil{}: PDone{value}
    case _h <> _t: PAfterElem{}

def value_pending(+stack: List<Container>, +value: FrameVal) -> Pending:
  completed_pending(absorb_value(stack, value), value)

def close_pending(+stack: List<Container>) -> Pending:
  completed_pending(close_stack(stack), close_val(stack))

def pending_after_comma(+stack: List<Container>) -> Pending:
  match stack:
    case Nil{}: PFailed{"unexpected_comma"}
    case CArr{_items, _started} <> _t: PValue{}
    case CObj{_members, _started} <> _t: PKey{}

# A closing byte is accepted only where the innermost open container is still fresh, so a
# trailing comma cannot be closed away.
def close_here(+stack: List<Container>, +tok: L.LexTok) -> Bool:
  match stack:
    case Nil{}: False{}
    case CArr{_items, started} <> _t:
      Bool.pick(Bool, started, False{}, is_code(tok, 93))
    case CObj{_members, started} <> _t:
      Bool.pick(Bool, started, False{}, is_code(tok, 125))

# One self-recursive step. Its match subjects are its own parameters, and every recursive
# call is in its own body.
def step(tokens: List<L.LexTok>, +stack: List<Container>, pending: Pending,
         +original: List<U32>) -> FrameResult:
  match pending:
    case PDone{value}:
      match tokens:
        case Nil{}: FrameOk{value, original}
        case _h <> _t: FrameRefused{"trailing_data", original}
    case PFailed{reason}: FrameRefused{reason, original}
    case PValue{}:
      match tokens:
        case Nil{}: FrameRefused{"unexpected_end", original}
        case +h <> +t:
          match h:
            case L.StrTok{+units, +tok}:
              step(t, absorb_value(stack, FStr{units, tok}),
                value_pending(stack, FStr{units, tok}), original)
            case L.NumTok{+tok}:
              step(t, absorb_value(stack, FNum{tok}), value_pending(stack, FNum{tok}), original)
            case L.LitTok{+name, _tok}:
              step(t, absorb_value(stack, lit_value(name)),
                value_pending(stack, lit_value(name)), original)
            case L.Punctuation{+code}:
              Bool.pick(FrameResult, close_here(stack, h),
                step(t, close_stack(stack), close_pending(stack), original),
                Bool.pick(FrameResult, U32.is_eq(code, 123),
                  step(t, CObj{Nil{}, False{}} <> stack, PKey{}, original),
                  Bool.pick(FrameResult, U32.is_eq(code, 91),
                    step(t, CArr{Nil{}, False{}} <> stack, PValue{}, original),
                    FrameRefused{"expected_value", original})))
    case PKey{}:
      match tokens:
        case Nil{}: FrameRefused{"unexpected_end", original}
        case +h <> +t:
          match h:
            case L.Punctuation{_code}:
              Bool.pick(FrameResult, close_here(stack, h),
                step(t, close_stack(stack), close_pending(stack), original),
                FrameRefused{"expected_key", original})
            case L.StrTok{units, tok}:
              step(t, with_key(stack, FStr{units, tok}), PColon{}, original)
            case L.NumTok{_tok}: FrameRefused{"expected_key", original}
            case L.LitTok{_name, _tok}: FrameRefused{"expected_key", original}
    case PColon{}:
      match tokens:
        case Nil{}: FrameRefused{"unexpected_end", original}
        case +h <> +t:
          match h:
            case L.Punctuation{code}:
              Bool.pick(FrameResult, U32.is_eq(code, 58),
                step(t, stack, PValue{}, original),
                Bool.pick(FrameResult, close_here(stack, h),
                  step(t, close_stack(stack), close_pending(stack), original),
                  FrameRefused{"expected_colon", original}))
            case L.StrTok{_u, _o}: FrameRefused{"expected_colon", original}
            case L.NumTok{_o}: FrameRefused{"expected_colon", original}
            case L.LitTok{_n, _o}: FrameRefused{"expected_colon", original}
    case PAfterElem{}:
      match tokens:
        case Nil{}: FrameRefused{"unexpected_end", original}
        case +h <> +t:
          match h:
            case L.Punctuation{code}:
              Bool.pick(FrameResult, close_here(stack, h),
                step(t, close_stack(stack), close_pending(stack), original),
                Bool.pick(FrameResult, U32.is_eq(code, 44),
                  step(t, stack, pending_after_comma(stack), original),
                  FrameRefused{"expected_separator_or_close", original}))
            case L.StrTok{_u, _o}: FrameRefused{"expected_separator_or_close", original}
            case L.NumTok{_o}: FrameRefused{"expected_separator_or_close", original}
            case L.LitTok{_n, _o}: FrameRefused{"expected_separator_or_close", original}

def frame_of(result: L.LexResult, +octets: List<U32>) -> FrameResult:
  match result:
    case L.LexTokens{tokens, _original}: step(tokens, Nil{}, PValue{}, octets)
    case L.LexRefused{reason, _original}: FrameRefused{reason, octets}
    case L.LexUnsupported{reason, _original}: FrameUnsupported{reason, octets}
    case L.LexHostFault{value, _original}: FrameHostFault{value, octets}

def decode_frame(+octets: List<U32>) -> FrameResult:
  frame_of(L.lex(octets), octets)
