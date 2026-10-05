# Executable corpus for bend2/src/receive/output-position.bend.
# CLAIM: every named case asserts a complete typed result through explicit equality over the
# constructor and its exact digit lists, so disposition, original input, resulting digits and
# interval endpoints are each checked independently, and a control group asserts the
# comparators by requiring inequality when exactly one field differs.
# Expectations are written independently of the implementation and state every expected digit.
# Several cases build a position value directly, which the module deliberately re-validates, so
# those cases exercise the refusal of a value that was never checked.
# Language forms: definitions before their callers, nested matches over the pinned result
# constructors with positional binders, Bool.pick with a first type argument, and a computed
# value bound to a parameter before it is matched. UNCOMPILED and UNTESTED.

import Base
import ../src/receive/output-position.bend as P

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

def same_pos(left: P.Pos, right: P.Pos) -> Bool:
  match left:
    case P.PosDigits{a_digits}:
      match right:
        case P.PosDigits{b_digits}: same_units(a_digits, b_digits)

def same_order(left: P.PosOrder, right: P.PosOrder) -> Bool:
  match left:
    case P.PosLess{}:
      match right:
        case P.PosLess{}: True{}
        case P.PosEqual{}: False{}
        case P.PosGreater{}: False{}
    case P.PosEqual{}:
      match right:
        case P.PosLess{}: False{}
        case P.PosEqual{}: True{}
        case P.PosGreater{}: False{}
    case P.PosGreater{}:
      match right:
        case P.PosLess{}: False{}
        case P.PosEqual{}: False{}
        case P.PosGreater{}: True{}

def same_result(left: P.PosResult, right: P.PosResult) -> Bool:
  match left:
    case P.PosAccepted{a_value}:
      match right:
        case P.PosAccepted{b_value}: same_pos(a_value, b_value)
        case P.PosRefused{_r, _o}: False{}
    case P.PosRefused{a_reason, a_original}:
      match right:
        case P.PosAccepted{_v}: False{}
        case P.PosRefused{b_reason, b_original}:
          Bool.and(String.eq(a_reason, b_reason), same_units(a_original, b_original))

def same_sum(left: P.PosSum, right: P.PosSum) -> Bool:
  match left:
    case P.PosAdded{a_value, a_left, a_right}:
      match right:
        case P.PosAdded{b_value, b_left, b_right}:
          Bool.and(same_pos(a_value, b_value),
            Bool.and(same_pos(a_left, b_left), same_pos(a_right, b_right)))
        case P.PosSumRefused{_r, _l, _rr}: False{}
    case P.PosSumRefused{a_reason, a_left, a_right}:
      match right:
        case P.PosAdded{_v, _l, _r}: False{}
        case P.PosSumRefused{b_reason, b_left, b_right}:
          Bool.and(String.eq(a_reason, b_reason),
            Bool.and(same_pos(a_left, b_left), same_pos(a_right, b_right)))

def same_span(left: P.PosSpan, right: P.PosSpan) -> Bool:
  match left:
    case P.SpanOrdered{a_low, a_high}:
      match right:
        case P.SpanOrdered{b_low, b_high}:
          Bool.and(same_pos(a_low, b_low), same_pos(a_high, b_high))
        case P.SpanRefused{_r, _l, _h}: False{}
    case P.SpanRefused{a_reason, a_low, a_high}:
      match right:
        case P.SpanOrdered{_l, _h}: False{}
        case P.SpanRefused{b_reason, b_low, b_high}:
          Bool.and(String.eq(a_reason, b_reason),
            Bool.and(same_pos(a_low, b_low), same_pos(a_high, b_high)))

def pos(digits: List<U32>) -> P.Pos:
  P.PosDigits{digits}

def accepted(digits: List<U32>) -> P.PosResult:
  P.PosAccepted{pos(digits)}

def refused(reason: String, original: List<U32>) -> P.PosResult:
  P.PosRefused{reason, original}

def ordered(low: List<U32>, high: List<U32>) -> P.PosSpan:
  P.SpanOrdered{pos(low), pos(high)}

def span_refused(reason: String, low: List<U32>, high: List<U32>) -> P.PosSpan:
  P.SpanRefused{reason, pos(low), pos(high)}

def added(left: List<U32>, right: List<U32>, digits: List<U32>) -> P.PosSum:
  P.PosAdded{pos(digits), pos(left), pos(right)}

def sum_refused(reason: String, left: List<U32>, right: List<U32>) -> P.PosSum:
  P.PosSumRefused{reason, pos(left), pos(right)}

def cases() -> List<List<U32> & P.PosResult & String>:
  [
    ([48], accepted([0]), "zero"),
    ([49], accepted([1]), "one"),
    ([57], accepted([9]), "nine"),
    ([49, 48], accepted([1, 0]), "ten"),
    ([57, 57], accepted([9, 9]), "ninety-nine"),
    ([49, 48, 48], accepted([1, 0, 0]), "one-hundred"),
    ([52, 50, 57, 52, 57, 54, 55, 50, 57, 53], accepted([4, 2, 9, 4, 9, 6, 7, 2, 9, 5]),
      "u32-maximum-as-position"),
    ([52, 50, 57, 52, 57, 54, 55, 50, 57, 54], accepted([4, 2, 9, 4, 9, 6, 7, 2, 9, 6]),
      "one-past-u32-maximum-as-position"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 50],
      accepted([9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 2]),
      "two-to-the-fifty-third-minimum"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51],
      accepted([9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 3]),
      "two-to-the-fifty-third-plus-one"),
    ([57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 55],
      accepted([9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7]),
      "domain-maximum-accepted"),
    ([57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 56],
      refused("above_domain_maximum",
        [57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 56]),
      "domain-maximum-plus-one-refused"),
    ([], refused("empty_position", []), "empty-refused"),
    ([45, 49], refused("not_a_decimal_digit", [45, 49]), "negative-sign-refused"),
    ([43, 49], refused("not_a_decimal_digit", [43, 49]), "positive-sign-refused"),
    ([32, 49], refused("not_a_decimal_digit", [32, 49]), "leading-space-refused"),
    ([49, 32], refused("not_a_decimal_digit", [49, 32]), "trailing-space-refused"),
    ([48, 49], refused("leading_zero", [48, 49]), "leading-zero-refused"),
    ([48, 48], refused("leading_zero", [48, 48]), "double-zero-refused"),
    ([49, 50, 56], accepted([1, 2, 8]), "one-hundred-twenty-eight"),
    ([50, 53, 256], refused("not_an_octet", [50, 53, 256]), "non-octet-refused"),
    ([49, 50, 163], refused("not_a_decimal_digit", [49, 50, 163]), "non-ascii-digit-refused"),
  ]

def sum_rows() -> List<List<U32> & List<U32> & P.PosSum & String>:
  [
    ([48], [48], added([48], [48], [0]), "zero-plus-zero"),
    ([57, 57], [49], added([57, 57], [49], [1, 0, 0]), "carry-across-two-nines"),
    ([49, 48], [57], added([49, 48], [57], [1, 0, 9]), "carry-from-units"),
    ([52, 50, 57, 52, 57, 54, 55, 50, 57, 53], [49],
      added([52, 50, 57, 52, 57, 54, 55, 50, 57, 53], [49], [4, 2, 9, 4, 9, 6, 7, 2, 9, 6]),
      "u32-maximum-plus-one"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 50], [49],
      added([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 50], [49],
        [9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 3]),
      "two-to-the-fifty-third-minimum-plus-one"),
    ([57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 55], [48],
      added([57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 55], [48],
        [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7]),
      "domain-maximum-plus-zero"),
    ([57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 55], [49],
      sum_refused("sum_above_domain_maximum",
        [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7], [1]),
      "sum-above-domain-maximum-refused"),
    ([48, 49], [49], sum_refused("left_position_invalid", [0, 1], [1]),
      "invalid-left-value-refused"),
    ([49], [49, 48], sum_refused("right_position_invalid", [1], [1, 0]),
      "invalid-right-value-refused"),
  ]

def order_rows() -> List<List<U32> & List<U32> & P.PosOrder & String>:
  [
    ([49, 48], [57], P.PosGreater{}, "ten-greater-than-nine-different-lengths"),
    ([57], [49, 48], P.PosLess{}, "nine-less-than-ten-different-lengths"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 50],
      [57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51], P.PosLess{},
      "less-by-final-digit"),
    ([49, 48, 48], [49, 48, 48], P.PosEqual{}, "equal-same-digits"),
    ([49, 48, 48], [49, 48, 49], P.PosLess{}, "less-by-last-digit"),
    ([49, 57, 57], [50, 48, 48], P.PosLess{}, "less-by-first-digit"),
  ]

def span_rows() -> List<List<U32> & List<U32> & P.PosSpan & String>:
  [
    ([49], [49, 48], ordered([1], [1, 0]), "ordered-unit-to-ten"),
    ([49], [49], ordered([1], [1]), "single-endpoint-span"),
    ([49, 48], [49], span_refused("endpoints_reversed", [1, 0], [1]), "reversed-refused"),
    ([48, 49], [57], span_refused("low_position_invalid", [0, 1], [9]),
      "invalid-low-endpoint-refused"),
  ]

def adjacent_rows() -> List<List<U32> & List<U32> & List<U32> & Bool & String>:
  [
    ([49], [49, 48], [49, 48], True{}, "exact-adjacency"),
    ([49], [49, 48], [49, 49], False{}, "nonadjacent-next"),
    ([49], [49, 48], [57], False{}, "nonadjacent-shorter"),
    ([57, 57], [49, 48, 48], [49, 48, 48], True{}, "exact-adjacency-across-carry"),
  ]

def unequal_pairs() -> List<P.PosResult & P.PosResult & String>:
  [
    (accepted([1]), refused("empty_position", []), "comparator-disposition"),
    (refused("empty_position", []), refused("empty_position", [48]), "comparator-original"),
    (refused("empty_position", []), refused("leading_zero", []), "comparator-reason"),
    (accepted([1]), accepted([2]), "comparator-digits"),
    (accepted([9]), accepted([9, 0]), "comparator-digit-length"),
  ]

def judge(actual: P.PosResult, expected: P.PosResult, name: String) -> IO(Unit):
  +verdict = same_result(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_sum(actual: P.PosSum, expected: P.PosSum, name: String) -> IO(Unit):
  +verdict = same_sum(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_order(actual: P.PosOrder, expected: P.PosOrder, name: String) -> IO(Unit):
  +verdict = same_order(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_span(actual: P.PosSpan, expected: P.PosSpan, name: String) -> IO(Unit):
  +verdict = same_span(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_bool(actual: Bool, expected: Bool, name: String) -> IO(Unit):
  +verdict = Bool.pick(Bool, actual, expected, Bool.pick(Bool, expected, False{}, True{}))
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_unequal(left: P.PosResult, right: P.PosResult, name: String) -> IO(Unit):
  +verdict = same_result(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def check(case: List<U32> & P.PosResult & String) -> IO(Unit):
  (octets, expected, name) = case
  judge(P.parse_pos(octets), expected, name)

def check_sum(row: List<U32> & List<U32> & P.PosSum & String) -> IO(Unit):
  (left, right, expected, name) = row
  judge_sum(P.add_pos(pos(left), pos(right)), expected, name)

def order_of(result: P.PosCompare, expected: P.PosOrder, name: String) -> IO(Unit):
  match result:
    case P.PosCompared{order, left: _left, right: _right}: judge_order(order, expected, name)
    case P.PosCompareRefused{_reason, _l, _r}: IO.die(Unit, 1, name)

def check_order(row: List<U32> & List<U32> & P.PosOrder & String) -> IO(Unit):
  (left, right, expected, name) = row
  order_of(P.compare_pos(pos(left), pos(right)), expected, name)

def check_span(row: List<U32> & List<U32> & P.PosSpan & String) -> IO(Unit):
  (low, high, expected, name) = row
  judge_span(P.span_pos(pos(low), pos(high)), expected, name)

def check_adjacent(row: List<U32> & List<U32> & List<U32> & Bool & String) -> IO(Unit):
  (low, high, next, expected, name) = row
  judge_bool(P.span_adjacent(ordered(low, high), pos(next)), expected, name)

def check_pair(pair: P.PosResult & P.PosResult & String) -> IO(Unit):
  (left, right, name) = pair
  judge_unequal(left, right, name)

def run(rows: List<List<U32> & P.PosResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def run_sums(rows: List<List<U32> & List<U32> & P.PosSum & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_sum(h)
        run_sums(t)

def run_orders(rows: List<List<U32> & List<U32> & P.PosOrder & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_order(h)
        run_orders(t)

def run_spans(rows: List<List<U32> & List<U32> & P.PosSpan & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_span(h)
        run_spans(t)

def run_adjacent(rows: List<List<U32> & List<U32> & List<U32> & Bool & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_adjacent(h)
        run_adjacent(t)

def run_pairs(rows: List<P.PosResult & P.PosResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_pair(h)
        run_pairs(t)

def main() -> IO(Unit):
  do IO<Unit>:
    all : Unit <- run(cases())
    sums : Unit <- run_sums(sum_rows())
    orders : Unit <- run_orders(order_rows())
    spans : Unit <- run_spans(span_rows())
    adjacent : Unit <- run_adjacent(adjacent_rows())
    pairs : Unit <- run_pairs(unequal_pairs())
    IO.pure(Unit, Unit{})
