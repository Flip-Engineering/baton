# CLAIM: a complete octet input is tokenized losslessly into ordered punctuation, string,
# number and literal tokens, with the host octet contract validated over the whole input
# before any grammar decision and the complete original bytes retained on every disposition.
# Scope: tokenization only. Multiple top-level tokens and unmatched brackets remain
# structural parser obligations, so lexical success is not whole-frame JSON acceptance, and
# no object, array or duplicate-key representation is decided here.
# Structure: helpers and typed outcomes first, then next_token, then one self-recursive scan
# loop that binds the next_token result in a parameter before matching it, then the entry,
# which runs the full-input host pass before grammar scanning. No helper is mutually
# recursive with another; each is defined before every caller.
# Repeated input is passed through the reviewed slice helper, whose prevalidated-octet
# precondition this module satisfies by validating the whole input first.
# Language forms grounded by reading the pinned Base and the reviewed number and string
# modules: Bool.pick with a first type argument, element-with-list cons, String.eq,
# U32.is_lt and U32.is_eq, definitions before their callers, computed values bound to helper
# parameters before being matched, and a plus binder on any value used more than once.
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

type LexOutcome is Data:
  End{}
  TokenAndRest{token: LexTok, rest: List<U32>}
  LexRefuse{reason: String}
  LexUnsupported{reason: String}
  LexFault{value: U32}

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
# the first element at or above 256 is reported even when a grammar failure would come first.
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

def string_ok(result: S.StrResult, token: List<U32>, rest: List<U32>) -> LexOutcome:
  match result:
    case S.StrAccepted{units, original: _source}:
      TokenAndRest{StrTok{units, token}, rest}
    case S.StrRefused{reason}: LexRefuse{reason}
    case S.StrUnsupported{reason}: LexUnsupported{reason}
    case S.StrHostFault{value}: LexFault{value}

def string_of(result: K.SliceResult) -> LexOutcome:
  match result:
    case K.Closed{token, rest}: string_ok(S.decode_string(token), token, rest)
    case K.MissingClose{_scanned}: LexRefuse{"unterminated_string"}
    case K.MissingOpen{_original}: LexRefuse{"expected_open_quote"}

def string_outcome(octets: List<U32>) -> LexOutcome:
  string_of(K.slice(octets))

def number_ok(result: N.NumResult, atom: List<U32>, rest: List<U32>) -> LexOutcome:
  match result:
    case N.NumAccepted{minus: _sign, integer: _int, fraction: _frac, exponent: _exp,
                       original: _source}:
      TokenAndRest{NumTok{atom}, rest}
    case N.NumRefused{reason}: LexRefuse{reason}
    case N.NumHostFault{value}: LexFault{value}

def number_of(split: LexSplit) -> LexOutcome:
  match split:
    case Split{atom, rest}: number_ok(N.decode_number(atom), atom, rest)

def number_outcome(octets: List<U32>) -> LexOutcome:
  number_of(split_atom(octets, Nil{}))

def literal_words(atom: List<U32>, rest: List<U32>) -> LexOutcome:
  Bool.pick(LexOutcome, same_units(atom, [116, 114, 117, 101]),
    TokenAndRest{LitTok{"true", atom}, rest},
    Bool.pick(LexOutcome, same_units(atom, [102, 97, 108, 115, 101]),
      TokenAndRest{LitTok{"false", atom}, rest},
      Bool.pick(LexOutcome, same_units(atom, [110, 117, 108, 108]),
        TokenAndRest{LitTok{"null", atom}, rest}, LexRefuse{"unrecognized_atom"})))

def literal_of(split: LexSplit) -> LexOutcome:
  match split:
    case Split{atom, rest}: literal_words(atom, rest)

def literal_outcome(octets: List<U32>) -> LexOutcome:
  literal_of(split_atom(octets, Nil{}))

def next_token(octets: List<U32>) -> LexOutcome:
  match octets:
    case Nil{}: End{}
    case +h <> +t:
      Bool.pick(LexOutcome, is_space(h), next_token(t),
        Bool.pick(LexOutcome, is_punct(h), TokenAndRest{Punctuation{h}, t},
          Bool.pick(LexOutcome, U32.is_eq(h, 34), string_outcome(octets),
            Bool.pick(LexOutcome, is_number_start(h), number_outcome(octets),
              literal_outcome(octets)))))

def outcome_of(outcome: LexOutcome, original: List<U32>, acc: List<LexTok>) -> LexResult:
  match outcome:
    case End{}: LexTokens{rev_tokens(acc, Nil{}), original}
    case TokenAndRest{token, rest: next_rest}:
      scan_go(next_rest, token <> acc, original)
    case LexRefuse{reason}: LexRefused{reason}
    case LexUnsupported{reason}: LexUnsupported{reason}
    case LexFault{value}: LexHostFault{value}

def scan_go(rest: List<U32>, acc: List<LexTok>, original: List<U32>) -> LexResult:
  outcome_of(next_token(rest), original, acc)

def host_of(scan: HostScan, octets: List<U32>) -> LexResult:
  match scan:
    case HostClean{}: scan_go(octets, Nil{}, octets)
    case HostFault{value}: LexHostFault{value}

def lex(octets: List<U32>) -> LexResult:
  host_of(host_go(octets), octets)
