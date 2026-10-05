# Executable corpus for bend2/src/receive/output-json-number.bend.
# CLAIM: every named case asserts a complete typed expected result through explicit
# equality over the constructor and its list fields, and a second group asserts the
# comparator itself by requiring inequality when exactly one field, reason or fault value
# differs, so a missing field comparison fails its own named case.
# Language forms grounded by reading the pinned Base: String.eq for strings, Bool.and for
# conjunctions, a computed value bound to a helper parameter before it is matched, and
# definitions before their callers.
# The comparator compares all five accepted fields through one Bool.and chain with no
# nested conditional level, which removes the ambiguous parenthesis form the review cited.
# Fixture preparation only: UNCOMPILED and UNTESTED, executed by the future compiled
# artifact on an admitted runner, never locally.
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
        case +hb <> tb: Bool.pick(Bool, U32.is_eq(h, hb), same_octets(t, tb), False{})

def same_result(a: N.NumResult, b: N.NumResult) -> Bool:
  match a:
    case N.NumAccepted{minus, integer, fraction, exponent, original}:
      match b:
        case N.NumAccepted{bm, bi, bf, be, bo}:
          Bool.and(same_bool(minus, bm),
            Bool.and(same_octets(integer, bi),
              Bool.and(same_octets(fraction, bf),
                Bool.and(same_octets(exponent, be), same_octets(original, bo)))))
        case _: False{}
    case N.NumRefused{reason}:
      match b:
        case N.NumRefused{br}: String.eq(reason, br)
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
    ([45, 49, 50, 46, 48, 51, 48, 69, 45, 48, 48, 52],
      accepted(True{}, [49, 50], [48, 51, 48], [45, 48, 48, 52],
        [45, 49, 50, 46, 48, 51, 48, 69, 45, 48, 48, 52]), "complete-negative-fraction-exponent"),
    ([49, 101, 48, 48, 48, 53], accepted(False{}, [49], Nil{}, [48, 48, 48, 53],
      [49, 101, 48, 48, 48, 53]), "leading-exponent-zeros"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51],
      accepted(False{}, [57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51],
        Nil{}, Nil{}, [57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51]),
      "above-two-to-the-fifty-third"),
    ([49, 101, 52, 50, 57, 52, 57, 54, 55, 50, 57, 54],
      accepted(False{}, [49], Nil{}, [52, 50, 57, 52, 57, 54, 55, 50, 57, 54],
        [49, 101, 52, 50, 57, 52, 57, 54, 55, 50, 57, 54]), "exponent-beyond-u32"),
    ([49, 101, 53, 120], refused("trailing_data"), "exponent-then-suffix"),
    ([32, 49], refused("expected_digit"), "leading-whitespace"),
    ([49, 32], refused("trailing_data"), "trailing-whitespace"),
    ([255], refused("expected_digit"), "byte-255-is-a-valid-octet"),
    ([120, 256], fault(256), "host-octet-256-after-plain-prefix"),
    ([120, 255], refused("expected_digit"), "byte-255-after-plain-prefix-is-not-a-fault"),
    ([49, 46, 256], fault(256), "host-octet-after-incomplete-fraction-prefix"),
    ([256, 257], fault(256), "first-competing-host-fault"),
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

def unequal_pairs() -> List<N.NumResult & N.NumResult & String>:
  [
    (accepted(True{}, [49], Nil{}, Nil{}, [45, 49]), accepted(False{}, [49], Nil{}, Nil{}, [45, 49]),
      "comparator-minus"),
    (accepted(False{}, [49], Nil{}, Nil{}, [49]), accepted(False{}, [50], Nil{}, Nil{}, [49]),
      "comparator-integer"),
    (accepted(False{}, [49], [48], Nil{}, [49, 46, 48]), accepted(False{}, [49], [49], Nil{}, [49, 46, 48]),
      "comparator-fraction"),
    (accepted(False{}, [49], Nil{}, [48], [49, 101, 48]), accepted(False{}, [49], Nil{}, [49], [49, 101, 48]),
      "comparator-exponent"),
    (accepted(False{}, [49], Nil{}, Nil{}, [49]), accepted(False{}, [49], Nil{}, Nil{}, [49, 48]),
      "comparator-original"),
    (refused("leading_zero"), refused("trailing_data"), "comparator-refusal-reason"),
    (fault(256), fault(255), "comparator-host-fault-value"),
    (refused("leading_zero"), fault(256), "comparator-disposition"),
  ]

def judge(actual: N.NumResult, expected: N.NumResult, name: String) -> IO(Unit):
  +verdict = same_result(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def check(case: List<U32> & N.NumResult & String) -> IO(Unit):
  (octets, expected, name) = case
  judge(N.decode_number(octets), expected, name)

def check_pair(pair: N.NumResult & N.NumResult & String) -> IO(Unit):
  (left, right, name) = pair
  judge_unequal(left, right, name)

def judge_unequal(left: N.NumResult, right: N.NumResult, name: String) -> IO(Unit):
  +verdict = same_result(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def run(rows: List<List<U32> & N.NumResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def run_pairs(rows: List<N.NumResult & N.NumResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_pair(h)
        run_pairs(t)

def main() -> IO(Unit):
  do IO<Unit>:
    all : Unit <- run(cases())
    pairs : Unit <- run_pairs(unequal_pairs())
    IO.pure(Unit, Unit{})
