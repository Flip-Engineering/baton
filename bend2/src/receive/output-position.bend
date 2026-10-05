# CLAIM: exact checked decimal position arithmetic over the canonical unsigned domain zero
# through 9223372036854775807, carried as decimal digits with no whole-position integer or
# floating conversion.
# Construction. A position value holds its digits most significant first, each digit in zero
# through nine, with no leading zero except the single zero, and never above the domain
# maximum. The constructor is reachable from this module, so a client can build a value that
# was never validated; every public operation re-validates its inputs and refuses rather than
# trusting them, and nothing here treats a client-created value as validated authority.
# Scope. This module grants no source access, source correlation, all-writer seal or cursor
# authority. Adjacency is endpoint equality between an interval and a position, and it is not
# permission to correlate different sources.
# Language forms grounded on the reviewed number, string and frame modules and the pinned
# Base: element-with-list cons, Bool.pick with a first type argument, U32.is_eq and U32.is_lt,
# definitions before their callers, positional and named constructor patterns, and a plus
# binder on any binding used more than once. Every function is declared before its callers and
# none is mutually recursive with another; no match subject is a computed call.
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

type PosSum is Data:
  PosAdded{value: Pos, left: Pos, right: Pos}
  PosSumRefused{reason: String, left: Pos, right: Pos}

type PosSpan is Data:
  SpanOrdered{low: Pos, high: Pos}
  SpanRefused{reason: String, low: Pos, high: Pos}

def rev_units(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_units(t, h <> acc)

def len_units(xs: List<U32>) -> U32:
  match xs:
    case Nil{}: 0
    case _h <> t: U32.add(len_units(t), 1)

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

def listed(rest: List<U32>) -> Bool:
  match rest:
    case Nil{}: False{}
    case _h <> _t: True{}

def has_leading_zero(digits: List<U32>) -> Bool:
  match digits:
    case Nil{}: False{}
    case +h <> t: Bool.pick(Bool, U32.is_eq(h, 0), listed(t), False{})

def max_digits() -> List<U32>:
  [9, 2, 2, 3, 3, 7, 2, 0, 3, 6, 8, 5, 4, 7, 7, 5, 8, 0, 7]

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
  +here = len_units(digits)
  +limit = len_units(max_digits())
  Bool.pick(Bool, U32.is_lt(limit, here), True{},
    Bool.pick(Bool, U32.is_lt(here, limit), False{},
      order_is_greater(cmp_digits(digits, max_digits()))))

def digits_ok(+digits: List<U32>) -> Bool:
  +here = len_units(digits)
  Bool.pick(Bool, U32.is_eq(here, 0), False{},
    Bool.pick(Bool, has_leading_zero(digits), False{},
      Bool.pick(Bool, all_digit_values(digits), Bool.pick(Bool, over_max(digits), False{}, True{}),
        False{})))

def pos_ok(+pos: Pos) -> Bool:
  match pos:
    case PosDigits{digits}: digits_ok(digits)

def digits_of(+pos: Pos) -> List<U32>:
  match pos:
    case PosDigits{digits}: digits

def parsed_digits(+digits: List<U32>, +original: List<U32>) -> PosResult:
  Bool.pick(PosResult, U32.is_eq(len_units(digits), 0), PosRefused{"empty_position", original},
    Bool.pick(PosResult, has_leading_zero(digits), PosRefused{"leading_zero", original},
      Bool.pick(PosResult, over_max(digits), PosRefused{"above_domain_maximum", original},
        PosAccepted{PosDigits{digits}})))

def parse_pos(+octets: List<U32>) -> PosResult:
  Bool.pick(PosResult, all_octets(octets),
    Bool.pick(PosResult, all_digit_octets(octets), parsed_digits(to_digits(octets), octets),
      PosRefused{"not_a_decimal_digit", octets}),
    PosRefused{"not_an_octet", octets})

def compared(+ld: List<U32>, +rd: List<U32>, +left: Pos, +right: Pos) -> PosCompare:
  PosCompared{cmp_digits(ld, rd), left, right}

def compare_pos(+left: Pos, +right: Pos) -> PosCompare:
  Bool.pick(PosCompare, pos_ok(left),
    Bool.pick(PosCompare, pos_ok(right), compared(digits_of(left), digits_of(right), left, right),
      PosCompareRefused{"right_position_invalid", left, right}),
    PosCompareRefused{"left_position_invalid", left, right})

def matched(+result: PosCompare) -> Bool:
  match result:
    case PosCompared{order, left: _left, right: _right}: order_is_equal(order)
    case PosCompareRefused{_reason, _l, _r}: False{}

def equal_pos(+left: Pos, +right: Pos) -> Bool:
  matched(compare_pos(left, right))

def sum_digit(+total: U32) -> U32:
  Bool.pick(U32, U32.is_lt(total, 10), total, U32.sub(total, 10))

def sum_carry(+total: U32) -> U32:
  Bool.pick(U32, U32.is_lt(total, 10), 0, 1)

def finish_sum(+carry: U32, acc: List<U32>) -> List<U32>:
  Bool.pick(List<U32>, U32.is_eq(carry, 0), acc, 1 <> acc)

def add_pairs(+left: List<U32>, +right: List<U32>, +carry: U32, acc: List<U32>) -> List<U32>:
  match left:
    case Nil{}: finish_sum(carry, acc)
    case +lh <> +lt:
      match right:
        case Nil{}: finish_sum(carry, acc)
        case +rh <> +rt:
          +total = U32.add(U32.add(lh, rh), carry)
          add_pairs(lt, rt, sum_carry(total), sum_digit(total) <> acc)

def wider(+left: List<U32>, +right: List<U32>) -> U32:
  +la = len_units(left)
  +lb = len_units(right)
  Bool.pick(U32, U32.is_lt(la, lb), lb, la)

def zeros_go(+count: U32, acc: List<U32>) -> List<U32>:
  Bool.pick(List<U32>, U32.is_eq(count, 0), acc, zeros_go(U32.sub(count, 1), 0 <> acc))

def pad_tail(+xs: List<U32>, +budget: U32, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: zeros_go(budget, acc)
    case +h <> t: pad_tail(t, U32.sub(budget, 1), h <> acc)

def added(+ld: List<U32>, +rd: List<U32>, +left: Pos, +right: Pos) -> PosSum:
  +wide = wider(ld, rd)
  +low = pad_tail(rev_units(ld, Nil{}), wide, Nil{})
  +high = pad_tail(rev_units(rd, Nil{}), wide, Nil{})
  +digits = rev_units(add_pairs(low, high, 0, Nil{}), Nil{})
  Bool.pick(PosSum, digits_ok(digits), PosAdded{PosDigits{digits}, left, right},
    PosSumRefused{"sum_above_domain_maximum", left, right})

def add_pos(+left: Pos, +right: Pos) -> PosSum:
  Bool.pick(PosSum, pos_ok(left),
    Bool.pick(PosSum, pos_ok(right), added(digits_of(left), digits_of(right), left, right),
      PosSumRefused{"right_position_invalid", left, right}),
    PosSumRefused{"left_position_invalid", left, right})

def spanned(+order: PosCompare, +low: Pos, +high: Pos) -> PosSpan:
  match order:
    case PosCompared{order: found, left: _l, right: _r}:
      Bool.pick(PosSpan, order_is_greater(found), SpanRefused{"endpoints_reversed", low, high},
        SpanOrdered{low, high})
    case PosCompareRefused{reason, _l, _r}: SpanRefused{reason, low, high}

def span_pos(+low: Pos, +high: Pos) -> PosSpan:
  Bool.pick(PosSpan, pos_ok(low),
    Bool.pick(PosSpan, pos_ok(high), spanned(compare_pos(low, high), low, high),
      SpanRefused{"high_position_invalid", low, high}),
    SpanRefused{"low_position_invalid", low, high})

def touching(+span: PosSpan, +next: Pos) -> Bool:
  match span:
    case SpanOrdered{low: _low, high}: equal_pos(high, next)
    case SpanRefused{_reason, _l, _h}: False{}

def span_adjacent(+span: PosSpan, +next: Pos) -> Bool:
  touching(span, next)

def max_pos() -> Pos:
  PosDigits{max_digits()}
