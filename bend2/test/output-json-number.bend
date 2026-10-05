# Executable corpus for bend2/src/receive/output-json-number.bend.
# CLAIM: every named case below asserts a complete typed expected result through explicit
# equality over the constructor and its list fields, so a wrong refusal cannot pass; a
# mismatch calls IO.die with the case name.
# Fixture preparation only: UNCOMPILED and UNTESTED, executed by the future compiled
# artifact on an admitted runner, never locally.
# Imports follow the adjacent test imports in bend2/test. Constructor patterns are
# positional, the product form is the repository's, and the comparison of booleans is a
# local match because Bool.eq has no supporting use in the repository.
# UNCOMPILED and UNTESTED.

import Base
import ../src/receive/output-json-number.bend as N

def same_bool(a: Bool, b: Bool) -> Bool:
  match a:
    case True{}:
      match b:
        case True{}: True{}
        case False{}: False{}
    case False{}:
      match b:
        case True{}: False{}
        case False{}: True{}

def same_octets(a: List<U32>, b: List<U32>) -> Bool:
  match a:
    case Nil{}:
      match b:
        case Nil{}: True{}
        case _h <> _t: False{}
    case h <> t:
      match b:
        case Nil{}: False{}
        case hb <> tb: Bool.pick(Bool, U32.is_eq(h, hb), same_octets(t, tb), False{})

def same_result(a: N.NumResult, b: N.NumResult) -> Bool:
  match a:
    case N.NumAccepted{minus, integer, fraction, exponent, original}:
      match b:
        case N.NumAccepted{bm, bi, bf, be, bo}:
          Bool.pick(Bool, same_bool(minus, bm),
            Bool.pick(Bool, same_octets(integer, bi),
              Bool.pick(Bool, same_octets(fraction, bf),
                Bool.pick(Bool, same_octets(exponent, be), same_octets(original, bo), False{})),
              False{}),
            False{})
        case _: False{}
    case N.NumRefused{reason}:
      match b:
        case N.NumRefused{br}: String.is_eq(reason, br)
        case _: False{}
    case N.NumHostFault{value}:
      match b:
        case N.NumHostFault{bv}: U32.is_eq(value, bv)
        case _: False{}

def accepted(minus: Bool, integer: List<U32>, fraction: List<U32>, exponent: List<U32>,
             original: List<U32>) -> N.NumResult:
  N.NumAccepted{minus, integer, fraction, exponent, original}

def refused(reason: String) -> N.NumResult:
  N.NumRefused{reason}

def fault(value: U32) -> N.NumResult:
  N.NumHostFault{value}

# Each case is octets, the complete expected result, and an independent stable name.
def cases() -> List<List<U32> & N.NumResult & String>:
  [
    ([48], accepted(False{}, [48], Nil{}, Nil{}, [48]), "zero"),
    ([45, 48], accepted(True{}, [48], Nil{}, Nil{}, [45, 48]), "negative-zero"),
    ([49], accepted(False{}, [49], Nil{}, Nil{}, [49]), "one"),
    ([49, 46, 48], accepted(False{}, [49], [48], Nil{}, [49, 46, 48]), "one-point-zero"),
    ([48, 46, 48, 48, 49], accepted(False{}, [48], [48, 48, 49], Nil{}, [48, 46, 48, 48, 49]),
      "zero-point-zero-zero-one"),
    ([49, 101, 48], accepted(False{}, [49], Nil{}, [48], [49, 101, 48]), "one-e-zero"),
    ([49, 69, 43, 48], accepted(False{}, [49], Nil{}, [48], [49, 69, 43, 48]), "one-E-plus-zero"),
    ([45, 49], accepted(True{}, [49], Nil{}, Nil{}, [45, 49]), "negative-one"),
    ([49, 101, 45, 50], accepted(False{}, [49], Nil{}, [45, 50], [49, 101, 45, 50]),
      "negative-exponent"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51],
      accepted(False{}, [57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51],
        Nil{}, Nil{}, [57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51]),
      "above-two-to-the-fifty-third"),
    ([49, 101, 52, 50, 57, 52, 57, 54, 55, 50, 57, 54],
      accepted(False{}, [49], Nil{}, [52, 50, 57, 52, 57, 54, 55, 50, 57, 54],
        [49, 101, 52, 50, 57, 52, 57, 54, 55, 50, 57, 54]), "exponent-beyond-u32"),
    ([45], refused("expected_digit"), "lone-minus"),
    ([48, 48], refused("leading_zero"), "leading-zero"),
    ([45, 48, 48], refused("leading_zero"), "negative-leading-zero"),
    ([43, 49], refused("expected_digit"), "explicit-plus-token"),
    ([46, 49], refused("expected_digit"), "leading-point"),
    ([49, 46], refused("expected_fraction_digit"), "empty-fraction"),
    ([49, 46, 101, 50], refused("expected_fraction_digit"), "fraction-before-exponent"),
    ([49, 101], refused("expected_exponent_digit"), "empty-exponent"),
    ([49, 101, 43], refused("expected_exponent_digit"), "exponent-plus-no-digit"),
    ([49, 101, 45], refused("expected_exponent_digit"), "exponent-minus-no-digit"),
    ([49, 46, 48, 120], refused("trailing_data"), "ascii-suffix-after-fraction"),
    ([49, 120], refused("trailing_data"), "ascii-suffix"),
    ([49, 0], refused("trailing_data"), "embedded-nul"),
    ([], refused("expected_digit"), "empty-token"),
    ([256], fault(256), "host-octet-256"),
    ([49, 256], fault(256), "host-octet-after-digit"),
  ]

def check(case: List<U32> & N.NumResult & String) -> IO(Unit):
  (octets, expected, name) = case
  match same_result(N.decode_number(octets), expected):
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def run(rows: List<List<U32> & N.NumResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def main() -> IO(Unit):
  run(cases())
