# CLAIM: a complete octet input is tokenized losslessly into ordered punctuation, string,
# number and literal tokens, with the host octet contract validated over the whole input
# before any grammar decision and the complete original input retained on every disposition:
# token results, refusals, unsupported outcomes and host faults alike.
# Scope: tokenization only. Multiple top-level tokens and unmatched brackets remain
# structural parser obligations, so lexical success is not whole-frame JSON acceptance, and
# no object, array or duplicate-key representation is decided here. A refusal reported by a
# token decoder describes that token, not the frame.
# Structure: pure helpers first, then next_token, then one self-recursive scan loop whose
# first parameter is the lexer outcome. The loop matches that parameter, so there is no
# computed scrutinee, and the only call into the loop from outside is the entry dispatcher,
# which is declared after it. No cycle exists between helpers.
# Quoted tokens go through the reviewed slice helper, whose prevalidated-octet precondition
# this module satisfies by validating the whole input before any grammar decision.
# Language forms grounded by reading the pinned Base, bend2/src/json/laws.bend and the
# reviewed number and string modules: sibling imports written as ./name.bend, Bool.pick with
# a first type argument, element-with-list cons with plus markers on reused binders, U32.is_lt
# and U32.is_eq, String.eq and Bool.and, definitions before their callers, and computed
# values bound to helper parameters before being matched.
# UNCOMPILED and UNTESTED.

import Base
import ./output-json-slice.bend as K
import ./output-json-number.bend as N
import ./output-json-string.bend as S

type LexTok is Data:
  Punctuation{code: U32}
  StrTok{units: List<U32>, original: List<U32>}
  NumTok{original: List<U32>}
  LitTok{name: String, original: List<U32>}

# Internal lexer outcomes. The unsupported constructor is deliberately named apart from the
# final LexResult constructor of the same meaning, so the two namespaces do not collide.
type LexOutcome is Data:
  End{}
  TokenAndRest{token: LexTok, next_rest: List<U32>}
  LexStepRefused{reason: String}
  LexStepUnsupported{reason: String}
  LexStepFault{value: U32}

# Final results. Every variant carries the whole entry input as original.
type LexResult is Data:
  LexTokens{tokens: List<LexTok>, original: List<U32>}
  LexRefused{reason: String, original: List<U32>}
  LexUnsupported{reason: String, original: List<U32>}
  LexHostFault{value: U32, original: List<U32>}

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
    case +h <> t: Bool.pick(HostScan, U32.is_lt(h, 256), host_go(t), HostFault{h})

# One atom is the longest run up to whitespace, one of the six punctuation bytes, or the end.
def split_atom(xs: List<U32>, +acc: List<U32>) -> LexSplit:
  match xs:
    case Nil{}: Split{rev_units(acc, Nil{}), Nil{}}
    case +h <> +t:
      Bool.pick(LexSplit, is_space(h), Split{rev_units(acc, Nil{}), h <> t},
        Bool.pick(LexSplit, is_punct(h), Split{rev_units(acc, Nil{}), h <> t},
          split_atom(t, h <> acc)))

# The string decoder returns the token it was given as its own original field, so the token
# octets are never used twice: the caller passes them once and the accepted token carries
# them forward from the decoder result.
def string_of(result: S.StrResult, rest: List<U32>) -> LexOutcome:
  match result:
    case S.StrAccepted{units, source}: TokenAndRest{StrTok{units, source}, rest}
    case S.StrRefused{reason}: LexStepRefused{reason}
    case S.StrUnsupported{reason}: LexStepUnsupported{reason}
    case S.StrHostFault{value}: LexStepFault{value}

def slice_of(result: K.SliceResult) -> LexOutcome:
  match result:
    case K.Closed{token, rest}: string_of(S.decode_string(token), rest)
    case K.MissingClose{_scanned}: LexStepRefused{"unterminated_string"}
    case K.MissingOpen{_original}: LexStepRefused{"expected_open_quote"}

def string_token(octets: List<U32>) -> LexOutcome:
  slice_of(K.slice(octets))

# The number decoder likewise returns the token it was given as its own original field, so
# the raw lexeme is carried forward without a second use of the atom.
def number_of(result: N.NumResult, rest: List<U32>) -> LexOutcome:
  match result:
    case N.NumAccepted{_sign, _integer, _fraction, _exponent, source}:
      TokenAndRest{NumTok{source}, rest}
    case N.NumRefused{reason}: LexStepRefused{reason}
    case N.NumHostFault{value}: LexStepFault{value}

def number_split(split: LexSplit) -> LexOutcome:
  match split:
    case Split{atom, rest}: number_of(N.decode_number(atom), rest)

def number_token(octets: List<U32>) -> LexOutcome:
  number_split(split_atom(octets, Nil{}))

# Literals are matched against the exact atom spelling, so a longer word such as truex is
# refused rather than accepted as true.
def literal_words(+atom: List<U32>, +rest: List<U32>) -> LexOutcome:
  Bool.pick(LexOutcome, same_units(atom, [116, 114, 117, 101]),
    TokenAndRest{LitTok{"true", atom}, rest},
    Bool.pick(LexOutcome, same_units(atom, [102, 97, 108, 115, 101]),
      TokenAndRest{LitTok{"false", atom}, rest},
      Bool.pick(LexOutcome, same_units(atom, [110, 117, 108, 108]),
        TokenAndRest{LitTok{"null", atom}, rest}, LexStepRefused{"unrecognized_atom"})))

def literal_split(split: LexSplit) -> LexOutcome:
  match split:
    case Split{atom, rest}: literal_words(atom, rest)

def literal_token(octets: List<U32>) -> LexOutcome:
  literal_split(split_atom(octets, Nil{}))

# Whitespace is skipped explicitly. The remaining input is rebuilt as h <> t at each token
# path because the matched binders are marked for reuse.
def next_token(octets: List<U32>) -> LexOutcome:
  match octets:
    case Nil{}: End{}
    case +h <> +t:
      Bool.pick(LexOutcome, is_space(h), next_token(t),
        Bool.pick(LexOutcome, is_punct(h), TokenAndRest{Punctuation{h}, t},
          Bool.pick(LexOutcome, U32.is_eq(h, 34), string_token(h <> t),
            Bool.pick(LexOutcome, is_number_start(h), number_token(h <> t),
              literal_token(h <> t)))))

# One self-recursive loop. It matches its outcome parameter, recurses in its own body, and
# translates internal outcomes into final results that carry the whole entry input.
def scan_go(outcome: LexOutcome, +acc: List<LexTok>, +original: List<U32>) -> LexResult:
  match outcome:
    case End{}: LexTokens{rev_tokens(acc, Nil{}), original}
    case TokenAndRest{token, next_rest}:
      scan_go(next_token(next_rest), token <> acc, original)
    case LexStepRefused{reason}: LexRefused{reason, original}
    case LexStepUnsupported{reason}: LexUnsupported{reason, original}
    case LexStepFault{value}: LexHostFault{value, original}

def host_of(scan: HostScan, +octets: List<U32>) -> LexResult:
  match scan:
    case HostClean{}: scan_go(next_token(octets), Nil{}, octets)
    case HostFault{value}: LexHostFault{value, octets}

def lex(+octets: List<U32>) -> LexResult:
  host_of(host_go(octets), octets)
