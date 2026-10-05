# Executable corpus for bend2/src/receive/output-json-slice.bend.
# CLAIM: every named case asserts a complete typed slicer result through explicit equality
# over the constructor and its exact octet lists; a second group asserts reconstruction,
# token ++ suffix equals the original, on independently written literals; a third group
# asserts the comparator by requiring inequality when exactly one of token, remainder or
# disposition differs.
# Expectations are written independently of the implementation. Both lists are written out as
# literals rather than sorted, filtered, deduplicated or converted.
# Language forms: definitions before their callers, nested matches over the pinned result
# constructors with positional binders, Bool.pick with a first type argument, and a computed
# value bound to a parameter before it is matched. UNCOMPILED and UNTESTED.

import Base
import ../src/receive/output-json-slice.bend as K

def rev_units(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_units(t, h <> acc)

def append_go(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: append_go(t, h <> acc)

def concat(left: List<U32>, right: List<U32>) -> List<U32>:
  append_go(rev_units(left, Nil{}), right)

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

def same_slice(left: K.SliceResult, right: K.SliceResult) -> Bool:
  match left:
    case K.Closed{a_token, a_rest}:
      match right:
        case K.Closed{b_token, b_rest}:
          Bool.and(same_units(a_token, b_token), same_units(a_rest, b_rest))
        case K.MissingClose{_b}: False{}
        case K.MissingOpen{_b}: False{}
    case K.MissingClose{a_scanned}:
      match right:
        case K.Closed{_b, _c}: False{}
        case K.MissingClose{b_scanned}: same_units(a_scanned, b_scanned)
        case K.MissingOpen{_b}: False{}
    case K.MissingOpen{a_original}:
      match right:
        case K.Closed{_b, _c}: False{}
        case K.MissingClose{_b}: False{}
        case K.MissingOpen{b_original}: same_units(a_original, b_original)

def cases() -> List<List<U32> & K.SliceResult & String>:
  [
    ([], K.MissingOpen{[]}, "empty-input"),
    ([97], K.MissingOpen{[97]}, "nonquote-initial-input"),
    ([34, 34], K.Closed{[34, 34], []}, "empty-quoted-token"),
    ([34, 97, 34, 44], K.Closed{[34, 97, 34], [44]}, "ordinary-token-then-punctuation"),
    ([34, 92, 34, 97, 34], K.Closed{[34, 92, 34, 97, 34], []}, "escaped-quote-before-real-close"),
    ([34, 92, 92, 34], K.Closed{[34, 92, 92, 34], []}, "escaped-backslash-before-close"),
    ([34, 92, 92, 92, 34], K.MissingClose{[34, 92, 92, 92, 34]}, "odd-consecutive-backslashes"),
    ([34, 92, 92, 92, 92, 34], K.Closed{[34, 92, 92, 92, 92, 34], []},
      "even-consecutive-backslashes"),
    ([34, 123, 125, 91, 93, 44, 34], K.Closed{[34, 123, 125, 91, 93, 44, 34], []},
      "structural-characters-inside-string"),
    ([34, 97, 92, 34], K.MissingClose{[34, 97, 92, 34]}, "trailing-escaped-quote-without-close"),
    ([34, 97, 92], K.MissingClose{[34, 97, 92]}, "eof-after-backslash"),
    ([34, 92, 120, 34, 34, 44], K.Closed{[34, 92, 120, 34], [34, 44]},
      "malformed-escape-with-located-boundary"),
    ([34, 97, 34, 34, 98, 34], K.Closed{[34, 97, 34], [34, 98, 34]},
      "exact-suffix-preservation-with-later-quoted-text"),
  ]

def recon_pairs() -> List<List<U32> & List<U32> & String>:
  [
    ([34, 97, 34, 44], [34, 97, 34, 44], "reconstruction-punctuation-suffix"),
    ([34, 97, 34, 34, 98, 34], [34, 97, 34, 34, 98, 34], "reconstruction-later-quoted-text"),
    ([34, 92, 34, 97, 34, 125], [34, 92, 34, 97, 34, 125], "reconstruction-escaped-quote"),
    ([34, 92, 120, 34, 34, 44], [34, 92, 120, 34, 34, 44], "reconstruction-malformed-escape"),
  ]

def unequal_pairs() -> List<K.SliceResult & K.SliceResult & String>:
  [
    (K.Closed{[34, 97, 34], []}, K.Closed{[34, 98, 34], []}, "comparator-token"),
    (K.Closed{[34, 97, 34], [44]}, K.Closed{[34, 97, 34], [93]}, "comparator-remainder"),
    (K.Closed{[34, 97, 34], []}, K.MissingClose{[34, 97, 34]}, "comparator-disposition"),
    (K.MissingOpen{[97]}, K.MissingOpen{[98]}, "comparator-missing-open-original"),
    (K.MissingClose{[34, 97]}, K.MissingClose{[34, 98]}, "comparator-missing-close-scanned"),
  ]

def judge(actual: K.SliceResult, expected: K.SliceResult, name: String) -> IO(Unit):
  +verdict = same_slice(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_equal(left: List<U32>, right: List<U32>, name: String) -> IO(Unit):
  +verdict = same_units(left, right)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_unequal(left: K.SliceResult, right: K.SliceResult, name: String) -> IO(Unit):
  +verdict = same_slice(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def check(case: List<U32> & K.SliceResult & String) -> IO(Unit):
  (octets, expected, name) = case
  judge(K.slice(octets), expected, name)

def judge_recon(result: K.SliceResult, original: List<U32>, name: String) -> IO(Unit):
  match result:
    case K.Closed{token, rest}: judge_equal(concat(token, rest), original, name)
    case K.MissingClose{_scanned}: IO.die(Unit, 1, name)
    case K.MissingOpen{_original}: IO.die(Unit, 1, name)

def check_recon(case: List<U32> & List<U32> & String) -> IO(Unit):
  (octets, original, name) = case
  judge_recon(K.slice(octets), original, name)

def check_pair(pair: K.SliceResult & K.SliceResult & String) -> IO(Unit):
  (left, right, name) = pair
  judge_unequal(left, right, name)

def run(rows: List<List<U32> & K.SliceResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def run_recon(rows: List<List<U32> & List<U32> & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_recon(h)
        run_recon(t)

def run_pairs(rows: List<K.SliceResult & K.SliceResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_pair(h)
        run_pairs(t)

def main() -> IO(Unit):
  do IO<Unit>:
    all : Unit <- run(cases())
    recons : Unit <- run_recon(recon_pairs())
    pairs : Unit <- run_pairs(unequal_pairs())
    IO.pure(Unit, Unit{})
