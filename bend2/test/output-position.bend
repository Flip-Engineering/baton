# Executable corpus for bend2/src/receive/output-position.bend.
# CLAIM: every named case asserts a complete typed result through explicit equality over the
# constructor and its exact fields, so disposition, reason, original input, resulting digits,
# order, both compare operands, both interval endpoints and the tested next position are each
# checked independently, and the control groups assert each comparator by requiring inequality
# when exactly one field differs.
# Representation. Octet rows feed parse_pos and state the octets as they arrive; digit rows
# state decimal digits in zero through nine and build values directly, which the module
# deliberately re-validates, so rows that intend a valid value never carry ASCII octets and
# rows that intend an invalid value state an invalid digit list explicitly.
# Expectations are written independently of the implementation and state every expected digit,
# including cases the implementation is expected to refuse.
# Language forms: definitions before their callers, positional constructor patterns,
# Bool.pick with a first type argument, and a plus binder on any binding used more than once.
# UNCOMPILED and UNTESTED.

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

def same_compare(left: P.PosCompare, right: P.PosCompare) -> Bool:
  match left:
    case P.PosCompared{a_order, a_left, a_right}:
      match right:
        case P.PosCompared{b_order, b_left, b_right}:
          Bool.and(same_order(a_order, b_order),
            Bool.and(same_pos(a_left, b_left), same_pos(a_right, b_right)))
        case P.PosCompareRefused{_r, _l, _rr}: False{}
    case P.PosCompareRefused{a_reason, a_left, a_right}:
      match right:
        case P.PosCompared{_o, _l, _r}: False{}
        case P.PosCompareRefused{b_reason, b_left, b_right}:
          Bool.and(String.eq(a_reason, b_reason),
            Bool.and(same_pos(a_left, b_left), same_pos(a_right, b_right)))

def same_equality(left: P.PosEquality, right: P.PosEquality) -> Bool:
  match left:
    case P.PositionsEqual{}:
      match right:
        case P.PositionsEqual{}: True{}
        case P.PositionsUnequal{}: False{}
        case P.EqualityRefused{_r, _l, _rr}: False{}
    case P.PositionsUnequal{}:
      match right:
        case P.PositionsEqual{}: False{}
        case P.PositionsUnequal{}: True{}
        case P.EqualityRefused{_r, _l, _rr}: False{}
    case P.EqualityRefused{a_reason, a_left, a_right}:
      match right:
        case P.PositionsEqual{}: False{}
        case P.PositionsUnequal{}: False{}
        case P.EqualityRefused{b_reason, b_left, b_right}:
          Bool.and(String.eq(a_reason, b_reason),
            Bool.and(same_pos(a_left, b_left), same_pos(a_right, b_right)))

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

def same_adjacency(left: P.PosAdjacency, right: P.PosAdjacency) -> Bool:
  match left:
    case P.Adjacent{}:
      match right:
        case P.Adjacent{}: True{}
        case P.NotAdjacent{}: False{}
        case P.AdjacencyRefused{_r, _s, _n}: False{}
    case P.NotAdjacent{}:
      match right:
        case P.Adjacent{}: False{}
        case P.NotAdjacent{}: True{}
        case P.AdjacencyRefused{_r, _s, _n}: False{}
    case P.AdjacencyRefused{a_reason, a_span, a_next}:
      match right:
        case P.Adjacent{}: False{}
        case P.NotAdjacent{}: False{}
        case P.AdjacencyRefused{b_reason, b_span, b_next}:
          Bool.and(String.eq(a_reason, b_reason),
            Bool.and(same_span(a_span, b_span), same_pos(a_next, b_next)))

def pos(digits: List<U32>) -> P.Pos:
  P.PosDigits{digits}

def accepted(digits: List<U32>) -> P.PosResult:
  P.PosAccepted{pos(digits)}

def refused(reason: String, original: List<U32>) -> P.PosResult:
  P.PosRefused{reason, original}

def compared(order: P.PosOrder, left: List<U32>, right: List<U32>) -> P.PosCompare:
  P.PosCompared{order, pos(left), pos(right)}

def compare_refused(reason: String, left: List<U32>, right: List<U32>) -> P.PosCompare:
  P.PosCompareRefused{reason, pos(left), pos(right)}

def equality(refusal: String, left: List<U32>, right: List<U32>) -> P.PosEquality:
  P.EqualityRefused{refusal, pos(left), pos(right)}

def added(left: List<U32>, right: List<U32>, digits: List<U32>) -> P.PosSum:
  P.PosAdded{pos(digits), pos(left), pos(right)}

def sum_refused(reason: String, left: List<U32>, right: List<U32>) -> P.PosSum:
  P.PosSumRefused{reason, pos(left), pos(right)}

def ordered(low: List<U32>, high: List<U32>) -> P.PosSpan:
  P.SpanOrdered{pos(low), pos(high)}

def span_refused(reason: String, low: List<U32>, high: List<U32>) -> P.PosSpan:
  P.SpanRefused{reason, pos(low), pos(high)}

def adjacency_refused(refusal: String, low: List<U32>, high: List<U32>, next: List<U32>) -> P.PosAdjacency:
  P.AdjacencyRefused{refusal, ordered(low, high), pos(next)}

def cases() -> List<List<U32> & P.PosResult & String>:
  [
    ([48], accepted([0]), "octets-zero"),
    ([49], accepted([1]), "octets-one"),
    ([57], accepted([9]), "octets-nine"),
    ([49, 48], accepted([1, 0]), "octets-ten"),
    ([57, 57], accepted([9, 9]), "octets-ninety-nine"),
    ([49, 48, 48], accepted([1, 0, 0]), "octets-one-hundred"),
    ([52, 50, 57, 52, 57, 54, 55, 50, 57, 53], accepted([4, 2, 9, 4, 9, 6, 7, 2, 9, 5]),
      "octets-u32-maximum"),
    ([52, 50, 57, 52, 57, 54, 55, 50, 57, 54], accepted([4, 2, 9, 4, 9, 6, 7, 2, 9, 6]),
      "octets-one-past-u32-maximum"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 50],
      accepted([9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 2]),
      "octets-two-to-the-fifty-third-minimum"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51],
      accepted([9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 3]),
      "octets-two-to-the-fifty-third-plus-one"),
    ([57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 55],
      accepted([9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7]),
      "octets-domain-maximum-accepted"),
    ([57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 56],
      refused("above_domain_maximum",
        [57, 50, 50, 51, 51, 55, 50, 48, 51, 54, 56, 53, 52, 55, 55, 53, 56, 48, 56]),
      "octets-domain-maximum-plus-one-refused"),
    ([49, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48],
      refused("above_domain_maximum",
        [49, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48]),
      "octets-twenty-digits-refused"),
    ([], refused("empty_position", []), "octets-empty-refused"),
    ([45, 49], refused("not_a_decimal_digit", [45, 49]), "octets-negative-sign-refused"),
    ([43, 49], refused("not_a_decimal_digit", [43, 49]), "octets-positive-sign-refused"),
    ([32, 49], refused("not_a_decimal_digit", [32, 49]), "octets-leading-space-refused"),
    ([49, 32], refused("not_a_decimal_digit", [49, 32]), "octets-trailing-space-refused"),
    ([48, 49], refused("leading_zero", [48, 49]), "octets-leading-zero-refused"),
    ([50, 53, 256], refused("not_an_octet", [50, 53, 256]), "octets-non-octet-refused"),
    ([49, 50, 163], refused("not_a_decimal_digit", [49, 50, 163]),
      "octets-non-ascii-digit-refused"),
  ]

def sum_rows() -> List<List<U32> & List<U32> & P.PosSum & String>:
  [
    ([0], [0], added([0], [0], [0]), "digits-zero-plus-zero"),
    ([9], [1], added([9], [1], [1, 0]), "digits-nine-plus-one"),
    ([9, 9], [1], added([9, 9], [1], [1, 0, 0]), "digits-ninety-nine-plus-one"),
    ([1, 0], [9], added([1, 0], [9], [1, 9]), "digits-ten-plus-nine"),
    ([9], [1, 0], added([9], [1, 0], [1, 9]), "digits-nine-plus-ten"),
    ([1], [9, 9], added([1], [9, 9], [1, 0, 0]), "digits-one-plus-ninety-nine"),
    ([1, 2, 3, 4, 5], [6], added([1, 2, 3, 4, 5], [6], [1, 2, 3, 5, 1]),
      "digits-long-left-plus-short-right"),
    ([6], [1, 2, 3, 4, 5], added([6], [1, 2, 3, 4, 5], [1, 2, 3, 5, 1]),
      "digits-short-left-plus-long-right"),
    ([4, 2, 9, 4, 9, 6, 7, 2, 9, 5], [1],
      added([4, 2, 9, 4, 9, 6, 7, 2, 9, 5], [1], [4, 2, 9, 4, 9, 6, 7, 2, 9, 6]),
      "digits-u32-maximum-plus-one"),
    ([9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 2], [1],
      added([9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 2], [1],
        [9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 3]),
      "digits-two-to-the-fifty-third-minimum-plus-one"),
    ([1, 2, 3], [4, 5, 6], added([1, 2, 3], [4, 5, 6], [5, 7, 9]), "digits-one-two-three-plus-four-five-six"),
    ([9, 9, 9], [1], added([9, 9, 9], [1], [1, 0, 0, 0]), "digits-unequal-lengths-with-carry"),
    ([9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7], [0],
      added([9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7], [0],
        [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7]),
      "digits-domain-maximum-plus-zero"),
    ([0], [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7],
      added([0], [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7],
        [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7]),
      "digits-zero-plus-domain-maximum"),
    ([9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7], [1],
      sum_refused("sum_above_domain_maximum",
        [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7], [1]),
      "digits-domain-maximum-plus-one-refused"),
    ([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [1],
      sum_refused("left_position_invalid",
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [1]),
      "digits-twenty-digit-left-refused"),
    ([1], [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      sum_refused("right_position_invalid", [1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      "digits-twenty-digit-right-refused"),
    ([0, 1], [1], sum_refused("left_position_invalid", [0, 1], [1]),
      "digits-leading-zero-left-refused"),
    ([1], [1, 0, 10], sum_refused("right_position_invalid", [1], [1, 0, 10]),
      "digits-non-decimal-right-refused"),
    ([], [1], sum_refused("left_position_invalid", [], [1]),
      "digits-empty-left-refused"),
  ]

def order_rows() -> List<P.Pos & P.Pos & P.PosCompare & String>:
  [
    (pos([9]), pos([1, 0]), compared(P.PosLess{}, [9], [1, 0]), "digits-nine-before-ten"),
    (pos([1, 0]), pos([9]), compared(P.PosGreater{}, [1, 0], [9]), "digits-ten-after-nine"),
    (pos([9, 9]), pos([1, 0, 0]), compared(P.PosLess{}, [9, 9], [1, 0, 0]),
      "digits-ninety-nine-before-one-hundred"),
    (pos([1, 0, 0]), pos([9, 9]), compared(P.PosGreater{}, [1, 0, 0], [9, 9]),
      "digits-one-hundred-after-ninety-nine"),
    (pos([9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 2]),
      pos([9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 3]),
      compared(P.PosLess{}, [9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 2],
        [9, 0, 0, 7, 1, 9, 9, 2, 5, 4, 7, 4, 0, 9, 9, 3]),
      "digits-less-by-final-digit"),
    (pos([5, 0]), pos([5, 0]), compared(P.PosEqual{}, [5, 0], [5, 0]), "digits-equal"),
    (pos([0, 1]), pos([1]), compare_refused("left_position_invalid", [0, 1], [1]),
      "compare-leading-zero-left-refused"),
    (pos([1]), pos([1, 10]), compare_refused("right_position_invalid", [1], [1, 10]),
      "compare-non-decimal-right-refused"),
  ]

def span_rows() -> List<P.Pos & P.Pos & P.PosSpan & String>:
  [
    (pos([1]), pos([1, 0]), ordered([1], [1, 0]), "digits-ordered-unit-to-ten"),
    (pos([1]), pos([1]), ordered([1], [1]), "digits-single-endpoint-span"),
    (pos([1, 0]), pos([1]), span_refused("endpoints_reversed", [1, 0], [1]),
      "digits-reversed-refused"),
    (pos([0, 1]), pos([9]), span_refused("low_position_invalid", [0, 1], [9]),
      "digits-invalid-low-refused"),
    (pos([1]), pos([1, 10]), span_refused("high_position_invalid", [1], [1, 10]),
      "digits-invalid-high-refused"),
  ]

def adjacency_rows() -> List<P.PosSpan & P.Pos & P.PosAdjacency & String>:
  [
    (ordered([1], [1, 0]), pos([1, 0]), P.Adjacent{}, "digits-exact-adjacency"),
    (ordered([1], [1, 0]), pos([1, 1]), P.NotAdjacent{}, "digits-valid-nonadjacent"),
    (ordered([9, 9], [1, 0, 0]), pos([1, 0, 0]), P.Adjacent{}, "digits-adjacency-across-carry"),
    (ordered([9], [1]), pos([1]), adjacency_refused("endpoints_reversed", [9], [1], [1]),
      "digits-forged-reversed-span-refused"),
    (ordered([0, 1], [9]), pos([9]), adjacency_refused("low_position_invalid", [0, 1], [9], [9]),
      "digits-forged-invalid-low-refused"),
    (ordered([1], [2]), pos([1, 10]), adjacency_refused("next_position_invalid", [1], [2], [1, 10]),
      "digits-invalid-next-refused"),
    (ordered([1], [1, 10]), pos([1]),
      P.AdjacencyRefused{"high_position_invalid", ordered([1], [1, 10]), pos([1])},
      "synthetic-forged-invalid-high-refused"),
    (span_refused("endpoints_reversed", [9], [1]), pos([1]),
      P.AdjacencyRefused{"endpoints_reversed", span_refused("endpoints_reversed", [9], [1]),
        pos([1])},
      "synthetic-span-refusal-propagated"),
  ]

def equality_rows() -> List<P.Pos & P.Pos & P.PosEquality & String>:
  [
    (pos([1, 0]), pos([1, 0]), P.PositionsEqual{}, "digits-equal-positions"),
    (pos([1, 0]), pos([1, 1]), P.PositionsUnequal{}, "digits-unequal-positions"),
    (pos([0, 1]), pos([1]), equality("left_position_invalid", [0, 1], [1]),
      "digits-invalid-left-refused"),
    (pos([1]), pos([1, 10]), equality("right_position_invalid", [1], [1, 10]),
      "digits-invalid-right-refused"),
  ]

def unequal_results() -> List<P.PosResult & P.PosResult & String>:
  [
    (accepted([1]), refused("empty_position", []), "comparator-result-disposition"),
    (refused("empty_position", []), refused("empty_position", [48]), "comparator-result-original"),
    (refused("empty_position", []), refused("leading_zero", []), "comparator-result-reason"),
    (accepted([1]), accepted([2]), "comparator-result-digits"),
    (accepted([9]), accepted([9, 0]), "comparator-result-digit-length"),
  ]

def unequal_compares() -> List<P.PosCompare & P.PosCompare & String>:
  [
    (compared(P.PosLess{}, [1], [2]), compared(P.PosGreater{}, [1], [2]),
      "comparator-compare-order"),
    (compared(P.PosLess{}, [1], [2]), compared(P.PosLess{}, [1], [3]),
      "comparator-compare-right-operand"),
    (compared(P.PosLess{}, [1], [2]), compared(P.PosLess{}, [3], [2]),
      "comparator-compare-left-operand"),
    (compared(P.PosLess{}, [1], [2]), compare_refused("left_position_invalid", [1], [2]),
      "comparator-compare-disposition"),
    (compare_refused("left_position_invalid", [1], [2]),
      compare_refused("right_position_invalid", [1], [2]), "comparator-compare-reason"),
    (compare_refused("left_position_invalid", [1], [2]),
      compare_refused("left_position_invalid", [0, 1], [2]), "comparator-compare-refused-operand"),
    (compare_refused("right_position_invalid", [1], [2]),
      compare_refused("right_position_invalid", [1], [10]),
      "synthetic-compare-refused-right-operand"),
  ]

def unequal_sums() -> List<P.PosSum & P.PosSum & String>:
  [
    (added([1], [2], [3]), added([1], [2], [4]), "comparator-sum-result"),
    (added([1], [2], [3]), added([1], [9], [3]), "comparator-sum-right-operand"),
    (added([1], [2], [3]), added([9], [2], [3]), "comparator-sum-left-operand"),
    (added([1], [2], [3]), sum_refused("sum_above_domain_maximum", [1], [2]),
      "comparator-sum-disposition"),
    (sum_refused("left_position_invalid", [1], [2]),
      sum_refused("right_position_invalid", [1], [2]), "comparator-sum-reason"),
    (sum_refused("left_position_invalid", [1], [2]),
      sum_refused("left_position_invalid", [0, 1], [2]), "comparator-sum-refused-operand"),
    (sum_refused("right_position_invalid", [1], [2]),
      sum_refused("right_position_invalid", [1], [10]),
      "synthetic-sum-refused-right-operand"),
  ]

def unequal_spans() -> List<P.PosSpan & P.PosSpan & String>:
  [
    (ordered([1], [2]), ordered([1], [3]), "comparator-span-high-endpoint"),
    (ordered([1], [2]), ordered([4], [2]), "comparator-span-low-endpoint"),
    (ordered([1], [2]), span_refused("endpoints_reversed", [1], [2]),
      "comparator-span-disposition"),
    (span_refused("endpoints_reversed", [1], [2]), span_refused("low_position_invalid", [1], [2]),
      "comparator-span-reason"),
    (span_refused("low_position_invalid", [1], [2]),
      span_refused("low_position_invalid", [0, 1], [2]), "comparator-span-refused-endpoint"),
    (span_refused("high_position_invalid", [1], [2]),
      span_refused("high_position_invalid", [1], [10]),
      "synthetic-span-refused-high-endpoint"),
  ]

def unequal_equalities() -> List<P.PosEquality & P.PosEquality & String>:
  [
    (P.PositionsEqual{}, P.PositionsUnequal{}, "comparator-equality-disposition"),
    (equality("left_position_invalid", [1], [2]), equality("right_position_invalid", [1], [2]),
      "comparator-equality-reason"),
    (equality("left_position_invalid", [1], [2]), equality("left_position_invalid", [0, 1], [2]),
      "comparator-equality-refused-operand"),
    (equality("right_position_invalid", [1], [2]), equality("right_position_invalid", [1], [10]),
      "synthetic-equality-refused-right-operand"),
    (P.PositionsEqual{}, equality("left_position_invalid", [1], [2]),
      "synthetic-equality-refused-versus-success"),
  ]

def unequal_adjacencies() -> List<P.PosAdjacency & P.PosAdjacency & String>:
  [
    (P.Adjacent{}, P.NotAdjacent{}, "comparator-adjacency-disposition"),
    (adjacency_refused("endpoints_reversed", [1], [2], [2]),
      adjacency_refused("low_position_invalid", [1], [2], [2]), "comparator-adjacency-reason"),
    (adjacency_refused("endpoints_reversed", [1], [2], [2]),
      adjacency_refused("endpoints_reversed", [1], [2], [3]),
      "comparator-adjacency-next-position"),
    (adjacency_refused("endpoints_reversed", [1], [2], [2]),
      adjacency_refused("endpoints_reversed", [1], [3], [2]), "comparator-adjacency-span"),
    (P.Adjacent{}, adjacency_refused("endpoints_reversed", [1], [2], [2]),
      "synthetic-adjacency-refused-versus-success"),
  ]

def judge(actual: P.PosResult, expected: P.PosResult, name: String) -> IO(Unit):
  +verdict = same_result(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_compare(actual: P.PosCompare, expected: P.PosCompare, name: String) -> IO(Unit):
  +verdict = same_compare(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_sum(actual: P.PosSum, expected: P.PosSum, name: String) -> IO(Unit):
  +verdict = same_sum(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_span(actual: P.PosSpan, expected: P.PosSpan, name: String) -> IO(Unit):
  +verdict = same_span(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_equality(actual: P.PosEquality, expected: P.PosEquality, name: String) -> IO(Unit):
  +verdict = same_equality(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def judge_adjacency(actual: P.PosAdjacency, expected: P.PosAdjacency, name: String) -> IO(Unit):
  +verdict = same_adjacency(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def unequal_result(left: P.PosResult, right: P.PosResult, name: String) -> IO(Unit):
  +verdict = same_result(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def unequal_result_pair(pair: P.PosResult & P.PosResult & String) -> IO(Unit):
  (left, right, name) = pair
  unequal_result(left, right, name)

def unequal_compare(left: P.PosCompare, right: P.PosCompare, name: String) -> IO(Unit):
  +verdict = same_compare(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def unequal_compare_pair(pair: P.PosCompare & P.PosCompare & String) -> IO(Unit):
  (left, right, name) = pair
  unequal_compare(left, right, name)

def unequal_sum(left: P.PosSum, right: P.PosSum, name: String) -> IO(Unit):
  +verdict = same_sum(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def unequal_sum_pair(pair: P.PosSum & P.PosSum & String) -> IO(Unit):
  (left, right, name) = pair
  unequal_sum(left, right, name)

def unequal_span(left: P.PosSpan, right: P.PosSpan, name: String) -> IO(Unit):
  +verdict = same_span(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def unequal_span_pair(pair: P.PosSpan & P.PosSpan & String) -> IO(Unit):
  (left, right, name) = pair
  unequal_span(left, right, name)

def unequal_equality(left: P.PosEquality, right: P.PosEquality, name: String) -> IO(Unit):
  +verdict = same_equality(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def unequal_equality_pair(pair: P.PosEquality & P.PosEquality & String) -> IO(Unit):
  (left, right, name) = pair
  unequal_equality(left, right, name)

def unequal_adjacency(left: P.PosAdjacency, right: P.PosAdjacency, name: String) -> IO(Unit):
  +verdict = same_adjacency(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def unequal_adjacency_pair(pair: P.PosAdjacency & P.PosAdjacency & String) -> IO(Unit):
  (left, right, name) = pair
  unequal_adjacency(left, right, name)

def check(case: List<U32> & P.PosResult & String) -> IO(Unit):
  (octets, expected, name) = case
  judge(P.parse_pos(octets), expected, name)

def check_sum(row: List<U32> & List<U32> & P.PosSum & String) -> IO(Unit):
  (left, right, expected, name) = row
  judge_sum(P.add_pos(pos(left), pos(right)), expected, name)

def check_order(row: P.Pos & P.Pos & P.PosCompare & String) -> IO(Unit):
  (left, right, expected, name) = row
  judge_compare(P.compare_pos(left, right), expected, name)

def check_span(row: P.Pos & P.Pos & P.PosSpan & String) -> IO(Unit):
  (left, right, expected, name) = row
  judge_span(P.span_pos(left, right), expected, name)

def check_adjacency(row: P.PosSpan & P.Pos & P.PosAdjacency & String) -> IO(Unit):
  (span, next, expected, name) = row
  judge_adjacency(P.adjacent_checked(span, next), expected, name)

def check_equality(row: P.Pos & P.Pos & P.PosEquality & String) -> IO(Unit):
  (left, right, expected, name) = row
  judge_equality(P.equal_checked(left, right), expected, name)

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

def run_orders(rows: List<P.Pos & P.Pos & P.PosCompare & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_order(h)
        run_orders(t)

def run_spans(rows: List<P.Pos & P.Pos & P.PosSpan & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_span(h)
        run_spans(t)

def run_adjacencies(rows: List<P.PosSpan & P.Pos & P.PosAdjacency & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_adjacency(h)
        run_adjacencies(t)

def run_equalities(rows: List<P.Pos & P.Pos & P.PosEquality & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_equality(h)
        run_equalities(t)

def run_result_pairs(rows: List<P.PosResult & P.PosResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- unequal_result_pair(h)
        run_result_pairs(t)

def run_compare_pairs(rows: List<P.PosCompare & P.PosCompare & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- unequal_compare_pair(h)
        run_compare_pairs(t)

def run_sum_pairs(rows: List<P.PosSum & P.PosSum & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- unequal_sum_pair(h)
        run_sum_pairs(t)

def run_span_pairs(rows: List<P.PosSpan & P.PosSpan & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- unequal_span_pair(h)
        run_span_pairs(t)

def run_equality_pairs(rows: List<P.PosEquality & P.PosEquality & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- unequal_equality_pair(h)
        run_equality_pairs(t)

def run_adjacency_pairs(rows: List<P.PosAdjacency & P.PosAdjacency & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- unequal_adjacency_pair(h)
        run_adjacency_pairs(t)

def main() -> IO(Unit):
  do IO<Unit>:
    all : Unit <- run(cases())
    sums : Unit <- run_sums(sum_rows())
    orders : Unit <- run_orders(order_rows())
    spans : Unit <- run_spans(span_rows())
    adjacencies : Unit <- run_adjacencies(adjacency_rows())
    equalities : Unit <- run_equalities(equality_rows())
    results : Unit <- run_result_pairs(unequal_results())
    compares : Unit <- run_compare_pairs(unequal_compares())
    sum_pairs : Unit <- run_sum_pairs(unequal_sums())
    span_pairs : Unit <- run_span_pairs(unequal_spans())
    equality_pairs : Unit <- run_equality_pairs(unequal_equalities())
    adjacency_pairs : Unit <- run_adjacency_pairs(unequal_adjacencies())
    IO.pure(Unit, Unit{})
