# CLAIM: exact checked decimal position arithmetic over the canonical unsigned domain zero
# through 9223372036854775807, carried as decimal digits with no whole-position integer or
# floating conversion, and with no unchecked length counter.
# Construction. A value holds its digits most significant first, each in zero through nine,
# with no leading zero except the single zero, and never above the domain maximum. The
# constructor is reachable from this module, so a client can build a value that was never
# validated; every checked public operation re-validates its inputs and refuses rather than
# trusting them, and no client-created value is treated as validated authority.
# Orientations, one per helper. rev_units reverses a digit list. add_low and finish_low take
# both operands least significant first, and they keep their accumulated result most
# significant first: each new low-order total is consed onto the front of the accumulator, so
# the last one consed, which is the most significant digit, ends up at the head. finish_carry
# prepends a final carry the same way. added reverses each operand once into the input order
# and reverses nothing afterwards, so the canonical most-significant-first result is produced
# exactly once.
# Length is bounded structurally: bounded_19 walks at most nineteen digits with a counter
# bounded by the domain, and nothing counts an unbounded list. Nineteen is the domain bound,
# not a resource cutoff.
# Scope. This module grants no source access, source correlation, all-writer seal or cursor
# authority. Adjacency is endpoint equality between a validated ordered interval and a
# validated position, and it is not permission to correlate different sources.
# Language forms grounded on the reviewed number, string and frame modules and the pinned
# Base: element-with-list cons, Bool.pick with a first type argument, U32.is_eq and U32.is_lt,
# definitions before their callers, positional constructor patterns, and a plus binder on any
# binding used more than once. Every function is declared before the functions that call it,
# none is mutually recursive with another, and no match subject is a computed call.
# UNCOMPILED and UNTESTED.

import Base

type Pos is Data:
  PosDigits{digits: List<U32>}

type PosResult is Data:
  PosAccepted{value: Pos}
  PosRefused{reason: String, original: List<U32>}

type PosOrder is Data:
  PosLess{}
  PosEqual{}
  PosGreater{}

type PosCompare is Data:
  PosCompared{order: PosOrder, left: Pos, right: Pos}
  PosCompareRefused{reason: String, left: Pos, right: Pos}

type PosEquality is Data:
  PositionsEqual{}
  PositionsUnequal{}
  EqualityRefused{reason: String, left: Pos, right: Pos}

type PosSum is Data:
  PosAdded{value: Pos, left: Pos, right: Pos}
  PosSumRefused{reason: String, left: Pos, right: Pos}

type PosSpan is Data:
  SpanOrdered{low: Pos, high: Pos}
  SpanRefused{reason: String, low: Pos, high: Pos}

type PosAdjacency is Data:
  Adjacent{}
  NotAdjacent{}
  AdjacencyRefused{reason: String, span: PosSpan, next: Pos}

def rev_units(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_units(t, h <> acc)

def listed(rest: List<U32>) -> Bool:
  match rest:
    case Nil{}: False{}
    case _h <> _t: True{}

def is_octet(+code: U32) -> Bool:
  U32.is_lt(code, 256)

def is_digit_octet(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_lt(code, 48), False{}, U32.is_lt(code, 58))

def all_octets(xs: List<U32>) -> Bool:
  match xs:
    case Nil{}: True{}
    case +h <> t: Bool.pick(Bool, is_octet(h), all_octets(t), False{})

def all_digit_octets(xs: List<U32>) -> Bool:
  match xs:
    case Nil{}: True{}
    case +h <> t: Bool.pick(Bool, is_digit_octet(h), all_digit_octets(t), False{})

def all_digit_values(xs: List<U32>) -> Bool:
  match xs:
    case Nil{}: True{}
    case +h <> t: Bool.pick(Bool, U32.is_lt(h, 10), all_digit_values(t), False{})

def to_digits(xs: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: Nil{}
    case +h <> t: U32.sub(h, 48) <> to_digits(t)

def has_leading_zero(digits: List<U32>) -> Bool:
  match digits:
    case Nil{}: False{}
    case +h <> t: Bool.pick(Bool, U32.is_eq(h, 0), listed(t), False{})

def max_digits() -> List<U32>:
  [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7]

# A bounded walk: at most nineteen digits may remain. The counter is bounded by the domain,
# and it is the only counter in this module.
def bounded_19(+xs: List<U32>, +budget: U32) -> Bool:
  match xs:
    case Nil{}: True{}
    case _h <> t:
      Bool.pick(Bool, U32.is_eq(budget, 0), False{}, bounded_19(t, U32.sub(budget, 1)))

def shorter_than(+digits: List<U32>, +ceiling: List<U32>) -> Bool:
  match digits:
    case Nil{}: listed(ceiling)
    case _h <> t:
      match ceiling:
        case Nil{}: False{}
        case _c <> ct: shorter_than(t, ct)

def cmp_digits(+left: List<U32>, +right: List<U32>) -> PosOrder:
  match left:
    case Nil{}:
      match right:
        case Nil{}: PosEqual{}
        case _r <> _rt: PosLess{}
    case +lh <> +lt:
      match right:
        case Nil{}: PosGreater{}
        case +rh <> +rt:
          Bool.pick(PosOrder, U32.is_eq(lh, rh), cmp_digits(lt, rt),
            Bool.pick(PosOrder, U32.is_lt(lh, rh), PosLess{}, PosGreater{}))

def cmp_values(+left: List<U32>, +right: List<U32>) -> PosOrder:
  Bool.pick(PosOrder, shorter_than(left, right), PosLess{},
    Bool.pick(PosOrder, shorter_than(right, left), PosGreater{}, cmp_digits(left, right)))

def order_is_greater(+order: PosOrder) -> Bool:
  match order:
    case PosLess{}: False{}
    case PosEqual{}: False{}
    case PosGreater{}: True{}

def order_is_equal(+order: PosOrder) -> Bool:
  match order:
    case PosLess{}: False{}
    case PosEqual{}: True{}
    case PosGreater{}: False{}

def over_max(+digits: List<U32>) -> Bool:
  Bool.pick(Bool, bounded_19(digits, 19),
    Bool.pick(Bool, shorter_than(digits, max_digits()), False{},
      Bool.pick(Bool, shorter_than(max_digits(), digits), True{},
        order_is_greater(cmp_digits(digits, max_digits())))),
    True{})

def digits_ok(+digits: List<U32>) -> Bool:
  Bool.pick(Bool, listed(digits),
    Bool.pick(Bool, has_leading_zero(digits), False{},
      Bool.pick(Bool, all_digit_values(digits),
        Bool.pick(Bool, over_max(digits), False{}, True{}), False{})),
    False{})

def pos_ok(+pos: Pos) -> Bool:
  match pos:
    case PosDigits{digits}: digits_ok(digits)

def digits_of(+pos: Pos) -> List<U32>:
  match pos:
    case PosDigits{digits}: digits

def parsed_digits(+digits: List<U32>, +original: List<U32>) -> PosResult:
  Bool.pick(PosResult, listed(digits),
    Bool.pick(PosResult, has_leading_zero(digits), PosRefused{"leading_zero", original},
      Bool.pick(PosResult, over_max(digits), PosRefused{"above_domain_maximum", original},
        PosAccepted{PosDigits{digits}})),
    PosRefused{"empty_position", original})

def parse_pos(+octets: List<U32>) -> PosResult:
  Bool.pick(PosResult, all_octets(octets),
    Bool.pick(PosResult, all_digit_octets(octets), parsed_digits(to_digits(octets), octets),
      PosRefused{"not_a_decimal_digit", octets}),
    PosRefused{"not_an_octet", octets})

def compared(+ld: List<U32>, +rd: List<U32>, +left: Pos, +right: Pos) -> PosCompare:
  PosCompared{cmp_values(ld, rd), left, right}

def compare_pos(+left: Pos, +right: Pos) -> PosCompare:
  Bool.pick(PosCompare, pos_ok(left),
    Bool.pick(PosCompare, pos_ok(right), compared(digits_of(left), digits_of(right), left, right),
      PosCompareRefused{"right_position_invalid", left, right}),
    PosCompareRefused{"left_position_invalid", left, right})

def equality_of(+result: PosCompare, +left: Pos, +right: Pos) -> PosEquality:
  match result:
    case PosCompared{order, _left, _right}:
      Bool.pick(PosEquality, order_is_equal(order), PositionsEqual{}, PositionsUnequal{})
    case PosCompareRefused{reason, _l, _r}: EqualityRefused{reason, left, right}

def equal_checked(+left: Pos, +right: Pos) -> PosEquality:
  equality_of(compare_pos(left, right), left, right)

def passed(+outcome: PosEquality) -> Bool:
  match outcome:
    case PositionsEqual{}: True{}
    case PositionsUnequal{}: False{}
    case EqualityRefused{_reason, _l, _r}: False{}

def sum_digit(+total: U32) -> U32:
  Bool.pick(U32, U32.is_lt(total, 10), total, U32.sub(total, 10))

def sum_carry(+total: U32) -> U32:
  Bool.pick(U32, U32.is_lt(total, 10), 0, 1)

def finish_carry(+carry: U32, +acc: List<U32>) -> List<U32>:
  Bool.pick(List<U32>, U32.is_eq(carry, 0), acc, 1 <> acc)

# The remaining high digits of whichever operand is longer, all least significant first, are
# carried through with the running carry, each result consed onto the most-significant-first
# accumulator.
def finish_low(+rest: List<U32>, +carry: U32, +acc: List<U32>) -> List<U32>:
  match rest:
    case Nil{}: finish_carry(carry, acc)
    case +h <> t:
      +total = U32.add(h, carry)
      finish_low(t, sum_carry(total), sum_digit(total) <> acc)

def add_low(+left: List<U32>, +right: List<U32>, +carry: U32, +acc: List<U32>) -> List<U32>:
  match left:
    case Nil{}: finish_low(right, carry, acc)
    case +lh <> lt:
      match right:
        case Nil{}:
          +tail = U32.add(lh, carry)
          finish_low(lt, sum_carry(tail), sum_digit(tail) <> acc)
        case +rh <> rt:
          +total = U32.add(U32.add(lh, rh), carry)
          add_low(lt, rt, sum_carry(total), sum_digit(total) <> acc)

def added(+ld: List<U32>, +rd: List<U32>, +left: Pos, +right: Pos) -> PosSum:
  +total = add_low(rev_units(ld, Nil{}), rev_units(rd, Nil{}), 0, Nil{})
  Bool.pick(PosSum, digits_ok(total), PosAdded{PosDigits{total}, left, right},
    PosSumRefused{"sum_above_domain_maximum", left, right})

def add_pos(+left: Pos, +right: Pos) -> PosSum:
  Bool.pick(PosSum, pos_ok(left),
    Bool.pick(PosSum, pos_ok(right), added(digits_of(left), digits_of(right), left, right),
      PosSumRefused{"right_position_invalid", left, right}),
    PosSumRefused{"left_position_invalid", left, right})

def spanned(+order: PosCompare, +low: Pos, +high: Pos) -> PosSpan:
  match order:
    case PosCompared{found, _left, _right}:
      Bool.pick(PosSpan, order_is_greater(found), SpanRefused{"endpoints_reversed", low, high},
        SpanOrdered{low, high})
    case PosCompareRefused{reason, _l, _r}: SpanRefused{reason, low, high}

def span_pos(+low: Pos, +high: Pos) -> PosSpan:
  Bool.pick(PosSpan, pos_ok(low),
    Bool.pick(PosSpan, pos_ok(high), spanned(compare_pos(low, high), low, high),
      SpanRefused{"high_position_invalid", low, high}),
    SpanRefused{"low_position_invalid", low, high})

def endpoint_equality(+span: PosSpan, +next: Pos, +high: Pos) -> PosAdjacency:
  Bool.pick(PosAdjacency, passed(equal_checked(high, next)), Adjacent{}, NotAdjacent{})

def ordered_pair(+span: PosSpan, +next: Pos, +low: Pos, +high: Pos) -> PosAdjacency:
  Bool.pick(PosAdjacency, order_is_greater(cmp_values(digits_of(low), digits_of(high))),
    AdjacencyRefused{"endpoints_reversed", span, next}, endpoint_equality(span, next, high))

def checked_span(+span: PosSpan, +next: Pos, +next_ok: Bool) -> PosAdjacency:
  match span:
    case SpanOrdered{+low, +high}:
      Bool.pick(PosAdjacency, pos_ok(low),
        Bool.pick(PosAdjacency, pos_ok(high),
          Bool.pick(PosAdjacency, next_ok, ordered_pair(span, next, low, high),
            AdjacencyRefused{"next_position_invalid", span, next}),
          AdjacencyRefused{"high_position_invalid", span, next}),
        AdjacencyRefused{"low_position_invalid", span, next})
    case SpanRefused{reason, _l, _h}: AdjacencyRefused{reason, span, next}

def adjacent_checked(+span: PosSpan, +next: Pos) -> PosAdjacency:
  checked_span(span, next, pos_ok(next))
