# CLAIM: a complete JSON number token is lexed losslessly in pure Bend2 over explicit
# validated octets, preserving the original token and returning its lexical parts as
# octet lists without any arithmetic or floating conversion, so negative zero, arbitrarily
# long lexemes and exponent spelling survive.
# Scope: one number token byte slice supplied by a future structural parser. This is not a
# full JSON parser and it decides no duplicate-key or arithmetic policy.
# Serves: LANG-CAP-06 (B2-JSON), decoder slice.
# Fixture: bend2/test/output-json-number.bend, executed by the future compiled artifact.
# Pin: bend 2.0.25, bendlang/bend@a49524265bdfa5753a4bf38e25f0574a705dd868.
# Syntax follows bend2/src/json/uint-decoder.bend, read before writing.
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

type NumScan is Data:
  NumStep{state: NumState}
  NumHostFault{value: U32}

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

# Every rejection names its reason, so an incomplete part, a leading zero and trailing
# garbage stay distinguishable. Fraction and exponent octets are appended in order, so no
# later reversal is needed and the original spelling is preserved exactly.
def step(state: NumState, code: U32) -> NumState:
  match state:
    case NumStart{}:
      Bool.pick(NumState, is_minus(code), NumMinus{},
        Bool.pick(NumState, is_digit(code),
          Bool.pick(NumState, U32.is_eq(code, 48), NumZero{Nil{}}, NumInteger{[code]}),
          bad("expected_digit")))
    case NumMinus{}:
      Bool.pick(NumState, is_digit(code),
        Bool.pick(NumState, U32.is_eq(code, 48), NumZero{Nil{}}, NumInteger{[code]}),
        bad("expected_digit"))
    case NumZero{integer}:
      Bool.pick(NumState, is_digit(code), bad("leading_zero"),
        Bool.pick(NumState, is_dot(code), NumPoint{integer},
          Bool.pick(NumState, is_exp(code), NumExpMark{integer, Nil{}}, bad("trailing_data"))))
    case NumInteger{integer}:
      Bool.pick(NumState, is_digit(code), NumInteger{integer <> [code]},
        Bool.pick(NumState, is_dot(code), NumPoint{integer},
          Bool.pick(NumState, is_exp(code), NumExpMark{integer, Nil{}}, bad("trailing_data"))))
    case NumPoint{integer}:
      Bool.pick(NumState, is_digit(code), NumFraction{integer, [code]},
        bad("expected_fraction_digit"))
    case NumFraction{integer, fraction}:
      Bool.pick(NumState, is_digit(code), NumFraction{integer, fraction <> [code]},
        Bool.pick(NumState, is_exp(code), NumExpMark{integer, fraction}, bad("trailing_data")))
    case NumExpMark{integer, fraction}:
      Bool.pick(NumState, is_plus(code), NumExpSign{integer, fraction, False{}},
        Bool.pick(NumState, is_minus(code), NumExpSign{integer, fraction, True{}},
          Bool.pick(NumState, is_digit(code), NumExponent{integer, fraction, False{}, [code]},
            bad("expected_exponent_digit"))))
    case NumExpSign{integer, fraction, exp_minus}:
      Bool.pick(NumState, is_digit(code), NumExponent{integer, fraction, exp_minus, [code]},
        bad("expected_exponent_digit"))
    case NumExponent{integer, fraction, exp_minus, exponent}:
      Bool.pick(NumState, is_digit(code),
        NumExponent{integer, fraction, exp_minus, exponent <> [code]}, bad("trailing_data"))
    case NumBad{reason}: NumBad{reason}

# Octets outside 0..255 are an invalid host input, distinct from a malformed token.
def feed_go(octets: List<U32>, state: NumState) -> NumScan:
  match octets:
    case Nil{}: NumStep{state}
    case h <> t:
      Bool.pick(NumScan, U32.is_lt(h, 256), feed_go(t, step(state, h)), NumHostFault{h})

def accepted(state: NumState, minus: Bool, original: List<U32>) -> NumResult:
  match state:
    case NumZero{integer}: NumAccepted{minus, integer, Nil{}, Nil{}, original}
    case NumInteger{integer}: NumAccepted{minus, integer, Nil{}, Nil{}, original}
    case NumFraction{integer, fraction}: NumAccepted{minus, integer, fraction, Nil{}, original}
    case NumExponent{integer, fraction, exp_minus, exponent}:
      NumAccepted{minus, integer, fraction,
        Bool.pick(List<U32>, exp_minus, [45] <> exponent, exponent), original}
    case _: NumRefused{"incomplete_token"}

# The exponent sign is reported in the exponent octets exactly as written; an explicit
# plus is not an error and is not carried, because the original slice already preserves it.
def finish_go(state: NumState, minus: Bool, original: List<U32>) -> NumResult:
  match state:
    case NumBad{reason}: NumRefused{reason}
    case NumStart{}: NumRefused{"expected_digit"}
    case NumMinus{}: NumRefused{"expected_digit"}
    case NumPoint{integer}: NumRefused{"expected_fraction_digit"}
    case NumExpMark{integer, fraction}: NumRefused{"expected_exponent_digit"}
    case NumExpSign{integer, fraction, exp_minus}: NumRefused{"expected_exponent_digit"}
    case _: accepted(state, minus, original)

def leading_minus(octets: List<U32>) -> Bool:
  match octets:
    case Nil{}: False{}
    case h <> t: is_minus(h)

# Entry: a complete token byte slice, exactly what a future structural parser carves out.
# The original slice is returned unmodified, so an accepted token round-trips byte for byte.
def decode_number(octets: List<U32>) -> NumResult:
  match feed_go(octets, Bool.pick(NumState, leading_minus(octets), NumMinus{}, NumStart{})):
    case NumStep{state}: finish_go(state, leading_minus(octets), octets)
    case NumHostFault{value}: NumRefused{"invalid_octet"}
