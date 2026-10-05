# CLAIM: a complete JSON number token is lexed losslessly in pure Bend2 over explicit
# validated octets, preserving the original token and returning its lexical digits as
# octet lists without any arithmetic or floating conversion.
# Scope: one number token byte slice supplied by a future structural parser; not a full
# JSON parser, and it decides no duplicate-key or arithmetic policy.
# Normalisation stated honestly: the parts carry digits only; an exponent minus is carried
# as a leading 45, an explicit exponent plus is not, and both the plus and the original case
# of e or E survive only in the returned original slice.
# Language forms grounded by reading the pinned Base: Bool.pick takes exactly type,
# condition, true, false; a computed value is bound to a helper parameter before it is
# matched, per the restriction canonical.bend records; declarations appear before use and
# there is no mutual recursion; a matched state that is reused carries the plus binder.
# Serves: LANG-CAP-06 (B2-JSON), decoder slice.
# Fixture: bend2/test/output-json-number.bend.
# UNCOMPILED and UNTESTED.

import Base

type NumState is Data:
  NumStart{}
  NumMinus{}
  NumZero{integer: List<U32>}
  NumInteger{integer: List<U32>}
  NumPoint{integer: List<U32>}
  NumFraction{integer: List<U32>, fraction: List<U32>}
  NumExpMark{integer: List<U32>, fraction: List<U32>}
  NumExpSign{integer: List<U32>, fraction: List<U32>, exp_minus: Bool}
  NumExponent{integer: List<U32>, fraction: List<U32>, exp_minus: Bool, exponent: List<U32>}
  NumBad{reason: String}

type NumResult is Data:
  NumAccepted{minus: Bool, integer: List<U32>, fraction: List<U32>, exponent: List<U32>, original: List<U32>}
  NumRefused{reason: String}
  NumHostFault{value: U32}

type NumScan is Data:
  NumStep{state: NumState}
  NumScanFault{value: U32}

def is_digit(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_lt(code, 48), False{}, U32.is_lt(code, 58))

def is_exp(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(code, 101), True{}, U32.is_eq(code, 69))

def is_dot(+code: U32) -> Bool:
  U32.is_eq(code, 46)

def is_plus(+code: U32) -> Bool:
  U32.is_eq(code, 43)

def is_minus(+code: U32) -> Bool:
  U32.is_eq(code, 45)

def bad(reason: String) -> NumState:
  NumBad{reason}

def reverse_go(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: reverse_go(t, h <> acc)

# Digit accumulation uses element-with-list cons, so digits arrive reversed and normalise
# once at the end. A zero keeps its own digit, so 0, -0 and 0.001 retain [48].
def step(state: NumState, +code: U32) -> NumState:
  match state:
    case NumStart{}:
      Bool.pick(NumState, is_minus(code), NumMinus{},
        Bool.pick(NumState, is_digit(code),
          Bool.pick(NumState, U32.is_eq(code, 48), NumZero{[48]}, NumInteger{[code]}),
          bad("expected_digit")))
    case NumMinus{}:
      Bool.pick(NumState, is_digit(code),
        Bool.pick(NumState, U32.is_eq(code, 48), NumZero{[48]}, NumInteger{[code]}),
        bad("expected_digit"))
    case NumZero{+integer}:
      Bool.pick(NumState, is_digit(code), bad("leading_zero"),
        Bool.pick(NumState, is_dot(code), NumPoint{integer},
          Bool.pick(NumState, is_exp(code), NumExpMark{integer, Nil{}}, bad("trailing_data"))))
    case NumInteger{+integer}:
      Bool.pick(NumState, is_digit(code), NumInteger{code <> integer},
        Bool.pick(NumState, is_dot(code), NumPoint{integer},
          Bool.pick(NumState, is_exp(code), NumExpMark{integer, Nil{}}, bad("trailing_data"))))
    case NumPoint{integer}:
      Bool.pick(NumState, is_digit(code), NumFraction{integer, [code]},
        bad("expected_fraction_digit"))
    case NumFraction{+integer, +fraction}:
      Bool.pick(NumState, is_digit(code), NumFraction{integer, code <> fraction},
        Bool.pick(NumState, is_exp(code), NumExpMark{integer, fraction}, bad("trailing_data")))
    case NumExpMark{+integer, +fraction}:
      Bool.pick(NumState, is_plus(code), NumExpSign{integer, fraction, False{}},
        Bool.pick(NumState, is_minus(code), NumExpSign{integer, fraction, True{}},
          Bool.pick(NumState, is_digit(code), NumExponent{integer, fraction, False{}, [code]},
            bad("expected_exponent_digit"))))
    case NumExpSign{+integer, +fraction, exp_minus}:
      Bool.pick(NumState, is_digit(code), NumExponent{integer, fraction, exp_minus, [code]},
        bad("expected_exponent_digit"))
    case NumExponent{+integer, +fraction, exp_minus, +exponent}:
      Bool.pick(NumState, is_digit(code),
        NumExponent{integer, fraction, exp_minus, code <> exponent}, bad("trailing_data"))
    case +NumBad{reason}: NumBad{reason}

def feed_go(octets: List<U32>, state: NumState) -> NumScan:
  match octets:
    case Nil{}: NumStep{state}
    case +h <> t:
      Bool.pick(NumScan, U32.is_lt(h, 256), feed_go(t, step(state, h)), NumScanFault{h})

def accepted(state: NumState, minus: Bool, original: List<U32>) -> NumResult:
  match state:
    case NumZero{integer}: NumAccepted{minus, reverse_go(integer, Nil{}), Nil{}, Nil{}, original}
    case NumInteger{integer}: NumAccepted{minus, reverse_go(integer, Nil{}), Nil{}, Nil{}, original}
    case NumFraction{integer, fraction}:
      NumAccepted{minus, reverse_go(integer, Nil{}), reverse_go(fraction, Nil{}), Nil{}, original}
    case NumExponent{integer, fraction, +exp_minus, +exponent}:
      NumAccepted{minus, reverse_go(integer, Nil{}), reverse_go(fraction, Nil{}),
        Bool.pick(List<U32>, exp_minus, 45 <> reverse_go(exponent, Nil{}),
          reverse_go(exponent, Nil{})), original}
    case +other: NumRefused{"incomplete_token"}

# The remaining state is bound and passed once rather than reused from the match.
def finish_go(state: NumState, minus: Bool, original: List<U32>) -> NumResult:
  match state:
    case NumBad{reason}: NumRefused{reason}
    case NumStart{}: NumRefused{"expected_digit"}
    case NumMinus{}: NumRefused{"expected_digit"}
    case NumPoint{integer}: NumRefused{"expected_fraction_digit"}
    case NumExpMark{integer, fraction}: NumRefused{"expected_exponent_digit"}
    case NumExpSign{integer, fraction, exp_minus}: NumRefused{"expected_exponent_digit"}
    case +other: accepted(other, minus, original)

def leading_minus(octets: List<U32>) -> Bool:
  match octets:
    case Nil{}: False{}
    case +h <> t: is_minus(h)

# The computed scan is bound to a parameter before it is matched, per the restriction that
# canonical.bend records; the entry never matches a computed scrutinee directly.
def entry(scan: NumScan, octets: List<U32>) -> NumResult:
  match scan:
    case NumStep{state}: finish_go(state, leading_minus(octets), octets)
    case NumScanFault{value}: NumHostFault{value}

def decode_number(+octets: List<U32>) -> NumResult:
  entry(feed_go(octets, NumStart{}), octets)
