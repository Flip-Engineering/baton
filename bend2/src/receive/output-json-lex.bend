# CLAIM: a complete octet input is tokenized losslessly into ordered punctuation, string,
# number and literal tokens, with the host octet contract validated over the whole input
# before any grammar decision and the complete original bytes retained on every disposition.
# Scope: tokenization only. Multiple top-level tokens and unmatched brackets remain
# structural parser obligations, so lexical success is not whole-frame JSON acceptance, and
# no object, array or duplicate-key representation is decided here.
# Structure follows the reviewed number and string modules: pure helpers first, then one
# self-recursive scan loop whose only match subjects are its own parameters, with failures
# carried as loop phases rather than as calls back into the loop. No helper calls the loop.
# Quoted tokens go through the reviewed slice helper, whose prevalidated-octet precondition
# this module satisfies by validating the whole input before any grammar decision.
# Language forms grounded by reading the pinned Base and the reviewed number and string
# modules: Bool.pick with a first type argument, element-with-list cons, U32.is_lt and
# U32.is_eq, definitions before their callers, computed values bound to helper parameters
# before being matched, and a plus binder on any value used more than once.
# UNCOMPILED and UNTESTED.

import Base
import output-json-slice.bend as K
import output-json-number.bend as N
import output-json-string.bend as S

type LexTok is Data:
  Punctuation{code: U32}
  StrTok{units: List<U32>, original: List<U32>}
  NumTok{original: List<U32>}
  LitTok{name: String, original: List<U32>}

type LexPhase is Data:
  Done{}
  Emit{token: LexTok, rest: List<U32>}
  PendingString{token: List<U32>, rest: List<U32>}
  PendingNumber{atom: List<U32>, rest: List<U32>}
  Bad{reason: String}
  Unsupported{reason: String}
  Fault{value: U32}

type LexResult is Data:
  LexTokens{tokens: List<LexTok>, original: List<U32>}
  LexRefused{reason: String}
  LexUnsupported{reason: String}
  LexHostFault{value: U32}

type HostScan is Data:
  HostClean{}
  HostFault{value: U32}

type LexSplit is Data:
  Split{atom: List<U32>, rest: List<U32>}

def rev_units(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_units(t, h <> acc)

def rev_tokens(xs: List<LexTok>, acc: List<LexTok>) -> List<LexTok>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_tokens(t, h <> acc)

def same_units(left: List<U32>, right: List<U32>) -> Bool:
  match left:
    case Nil{}:
      match right:
        case Nil{}: True{}
        case _r <> _rt: False{}
    case lh <> lt:
      match right:
        case Nil{}: False{}
        case rh <> rt: Bool.pick(Bool, U32.is_eq(lh, rh), same_units(lt, rt), False{})

def is_space(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(code, 32), True{},
    Bool.pick(Bool, U32.is_eq(code, 9), True{},
      Bool.pick(Bool, U32.is_eq(code, 10), True{}, U32.is_eq(code, 13))))

def is_punct(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(code, 123), True{},
    Bool.pick(Bool, U32.is_eq(code, 125), True{},
      Bool.pick(Bool, U32.is_eq(code, 91), True{},
        Bool.pick(Bool, U32.is_eq(code, 93), True{},
          Bool.pick(Bool, U32.is_eq(code, 58), True{}, U32.is_eq(code, 44))))))

def is_digit(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_lt(code, 48), False{}, U32.is_lt(code, 58))

def is_number_start(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(code, 45), True{}, is_digit(code))

# The host octet contract is validated over the entire input before any grammar decision, so
# the first element at or above 256 is reported even when a grammar failure, a closed token
# or a malformed prefix would come first.
def host_go(octets: List<U32>) -> HostScan:
  match octets:
    case Nil{}: HostClean{}
    case +h <> +t: Bool.pick(HostScan, U32.is_lt(h, 256), host_go(t), HostFault{h})

# One atom is the longest run up to whitespace, one of the six punctuation bytes, or the end.
def split_atom(xs: List<U32>, acc: List<U32>) -> LexSplit:
  match xs:
    case Nil{}: Split{rev_units(acc, Nil{}), Nil{}}
    case +h <> +t:
      Bool.pick(LexSplit, is_space(h), Split{rev_units(acc, Nil{}), h <> t},
        Bool.pick(LexSplit, is_punct(h), Split{rev_units(acc, Nil{}), h <> t},
          split_atom(t, h <> acc)))

def skip_spaces(rest: List<U32>) -> List<U32>:
  match rest:
    case Nil{}: Nil{}
    case +h <> +t: Bool.pick(List<U32>, is_space(h), skip_spaces(t), rest)

def slice_phase(result: K.SliceResult) -> LexPhase:
  match result:
    case K.Closed{token, rest}: PendingString{token, rest}
    case K.MissingClose{_scanned}: Bad{"unterminated_string"}
    case K.MissingOpen{_original}: Bad{"expected_open_quote"}

def string_phase(result: S.StrResult, token: List<U32>, rest: List<U32>) -> LexPhase:
  match result:
    case S.StrAccepted{units, original: _source}: Emit{StrTok{units, token}, rest}
    case S.StrRefused{reason}: Bad{reason}
    case S.StrUnsupported{reason}: Unsupported{reason}
    case S.StrHostFault{value}: Fault{value}

def number_phase(result: N.NumResult, atom: List<U32>, rest: List<U32>) -> LexPhase:
  match result:
    case N.NumAccepted{minus: _sign, integer: _int, fraction: _frac, exponent: _exp,
                       original: _source}:
      Emit{NumTok{atom}, rest}
    case N.NumRefused{reason}: Bad{reason}
    case N.NumHostFault{value}: Fault{value}

def literal_phase(atom: List<U32>, rest: List<U32>) -> LexPhase:
  Bool.pick(LexPhase, same_units(atom, [116, 114, 117, 101]),
    Emit{LitTok{"true", atom}, rest},
    Bool.pick(LexPhase, same_units(atom, [102, 97, 108, 115, 101]),
      Emit{LitTok{"false", atom}, rest},
      Bool.pick(LexPhase, same_units(atom, [110, 117, 108, 108]),
        Emit{LitTok{"null", atom}, rest}, Bad{"unrecognized_atom"})))

def number_pending(split: LexSplit) -> LexPhase:
  match split:
    case Split{atom, rest}: PendingNumber{atom, rest}

def literal_pending(split: LexSplit) -> LexPhase:
  match split:
    case Split{atom, rest}: literal_phase(atom, rest)

# The phase after the leading whitespace of the remaining input. Whitespace is skipped, one
# punctuation byte is emitted with its code, a quoted token and a number atom and a literal
# atom are carried forward as pending phases, and any other byte is refused.
def phase_after(rest: List<U32>) -> LexPhase:
  match rest:
    case Nil{}: Done{}
    case +h <> +t:
      Bool.pick(LexPhase, is_punct(h), Emit{Punctuation{h}, t},
        Bool.pick(LexPhase, U32.is_eq(h, 34), slice_phase(K.slice(rest)),
          Bool.pick(LexPhase, is_number_start(h), number_pending(split_atom(rest, Nil{})),
            literal_pending(split_atom(rest, Nil{})))))

def next_phase(rest: List<U32>) -> LexPhase:
  phase_after(skip_spaces(rest))

# One self-recursive loop. Every match subject is a parameter, every helper it calls is pure,
# and each recursive call is in this function's own body.
def scan_go(rest: List<U32>, acc: List<LexTok>, original: List<U32>,
            phase: LexPhase) -> LexResult:
  match phase:
    case Done{}: LexTokens{rev_tokens(acc, Nil{}), original}
    case Emit{token, rest: next_rest}:
      scan_go(next_rest, token <> acc, original, next_phase(next_rest))
    case PendingString{token, rest: next_rest}:
      scan_go(next_rest, acc, original, string_phase(S.decode_string(token), token, next_rest))
    case PendingNumber{atom, rest: next_rest}:
      scan_go(next_rest, acc, original, number_phase(N.decode_number(atom), atom, next_rest))
    case Bad{reason}: LexRefused{reason}
    case Unsupported{reason}: LexUnsupported{reason}
    case Fault{value}: LexHostFault{value}

def scan_of(scan: HostScan, octets: List<U32>) -> LexResult:
  match scan:
    case HostClean{}: scan_go(octets, Nil{}, octets, next_phase(octets))
    case HostFault{value}: LexHostFault{value}

def lex(octets: List<U32>) -> LexResult:
  scan_of(host_go(octets), octets)
