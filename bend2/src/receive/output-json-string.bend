# CLAIM: a complete quoted JSON string token over validated octets is lexed losslessly in
# pure Bend2, returning an explicit decoded unit representation plus the untouched original
# octets, with raw UTF-8 validated by continuation count, overlong form, raw surrogate
# encoding and the U+10FFFF bound, and with escaped UTF-16 code units retained verbatim
# including an isolated surrogate escape.
# Representation, stated precisely: decoded units are UTF-16 code units. A raw valid scalar
# above U+FFFF becomes a surrogate pair; a \u escape contributes exactly the one code unit
# it spells. The two input representations are not conflated: a raw UTF-8 encoding of
# D800..DFFF is malformed under this valid-UTF-8 policy, while the same value written as a
# unicode escape is retained.
# This is a proposed lexical representation. It is NOT SQLite extraction parity and it
# decides no comparison, duplicate-key or string policy.
# Arithmetic grounded by reading bend2/src/json/canonical.bend utf8_wide, which uses
# U32.shrn and U32.and; div and mod are no longer used.
# Scope: one string token octet slice supplied by a future structural parser.
# Fixture: bend2/test/output-json-string.bend.
# UNCOMPILED and UNTESTED. StrUnsupported remains declared for a later valid-but-unsupported
# input class; under the present policy no input yields it, which I state rather than hide.

import Base

type StrState is Data:
  StrStart{}
  StrBody{units: List<U32>}
  StrPending{units: List<U32>, scalar: U32, remaining: U32, minimum: U32}
  StrClosed{units: List<U32>}
  StrEscape{units: List<U32>}
  StrUnicode{units: List<U32>, hex: List<U32>}
  StrBad{reason: String}

type StrResult is Data:
  StrAccepted{units: List<U32>, original: List<U32>}
  StrRefused{reason: String}
  StrUnsupported{reason: String}
  StrHostFault{value: U32}

type StrScan is Data:
  StrStep{state: StrState}
  StrScanFault{value: U32}

def rev_go(xs: List<U32>, acc: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: acc
    case h <> t: rev_go(t, h <> acc)

def n_go(xs: List<U32>, n: U32) -> U32:
  match xs:
    case Nil{}: n
    case _h <> t: n_go(t, U32.add(n, 1))

def byte_at(+xs: List<U32>, +index: U32) -> U32:
  match xs:
    case Nil{}: 0
    case h <> t: Bool.pick(U32, U32.is_eq(index, 0), h, byte_at(t, U32.sub(index, 1)))

def is_hex(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_lt(code, 48), False{},
    Bool.pick(Bool, U32.is_lt(code, 58), True{},
      Bool.pick(Bool, U32.is_lt(code, 65), False{},
        Bool.pick(Bool, U32.is_lt(code, 71), True{},
          Bool.pick(Bool, U32.is_lt(code, 97), False{}, U32.is_lt(code, 103))))))

def hex_of(+code: U32) -> U32:
  Bool.pick(U32, U32.is_lt(code, 58), U32.sub(code, 48),
    Bool.pick(U32, U32.is_lt(code, 71), U32.sub(code, 55), U32.sub(code, 87)))

def is_cont(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_lt(code, 128), False{}, U32.is_lt(code, 192))

# Lead payload, required continuation count and the minimum scalar that count implies. The
# count follows the UTF-8 grammar, not an input limit.
def lead(+code: U32, +units: List<U32>) -> StrState:
  Bool.pick(StrState, U32.is_lt(code, 194), StrBad{"invalid_utf8_lead"},
    Bool.pick(StrState, U32.is_lt(code, 224), StrPending{units, U32.sub(code, 192), 1, 128},
      Bool.pick(StrState, U32.is_lt(code, 240), StrPending{units, U32.sub(code, 224), 2, 2048},
        Bool.pick(StrState, U32.is_lt(code, 245), StrPending{units, U32.sub(code, 240), 3, 65536},
          StrBad{"above_u10ffff"}))))

# Each continuation contributes six payload bits; completion happens only when the lead's
# required count reaches zero.
def counted(+units: List<U32>, +scalar: U32, +remaining: U32, +minimum: U32) -> StrState:
  Bool.pick(StrState, U32.is_eq(remaining, 0), finished(units, scalar, minimum),
    StrPending{units, scalar, remaining, minimum})

def cont(+units: List<U32>, +scalar: U32, +remaining: U32, +minimum: U32, +code: U32) -> StrState:
  Bool.pick(StrState, is_cont(code),
    counted(units, U32.add(U32.mul(scalar, 64), U32.sub(code, 128)), U32.sub(remaining, 1), minimum),
    StrBad{"invalid_utf8_continuation"})

def with_unit(+units: List<U32>, +scalar: U32) -> StrState:
  StrBody{scalar <> units}

def pair(+units: List<U32>, +scalar: U32) -> StrState:
  +shifted = U32.sub(scalar, 65536)
  +high = U32.add(55296, U32.shrn(shifted, 10n))
  +low = U32.add(56320, U32.and(shifted, 63))
  StrBody{low <> (high <> units)}

# The surrogate range is rejected before any BMP acceptance, so a raw encoded surrogate is
# malformed rather than silently accepted or reported as unsupported.
def finished(+units: List<U32>, +scalar: U32, +minimum: U32) -> StrState:
  Bool.pick(StrState, U32.is_lt(scalar, minimum), StrBad{"overlong_utf8"},
    Bool.pick(StrState, U32.is_lt(scalar, 1114112),
      Bool.pick(StrState, Bool.and(U32.is_lt(55295, scalar), U32.is_lt(scalar, 57344)),
        StrBad{"raw_surrogate_encoding"},
        Bool.pick(StrState, U32.is_lt(scalar, 65536), with_unit(units, scalar), pair(units, scalar))),
      StrBad{"above_u10ffff"}))

def simple_escape(+code: U32, +units: List<U32>) -> StrState:
  Bool.pick(StrState, U32.is_eq(code, 34), with_unit(units, 34),
    Bool.pick(StrState, U32.is_eq(code, 92), with_unit(units, 92),
      Bool.pick(StrState, U32.is_eq(code, 47), with_unit(units, 47),
        Bool.pick(StrState, U32.is_eq(code, 98), with_unit(units, 8),
          Bool.pick(StrState, U32.is_eq(code, 102), with_unit(units, 12),
            Bool.pick(StrState, U32.is_eq(code, 110), with_unit(units, 10),
              Bool.pick(StrState, U32.is_eq(code, 114), with_unit(units, 13),
                Bool.pick(StrState, U32.is_eq(code, 116), with_unit(units, 9),
                  StrBad{"invalid_escape"}))))))))

# In the body, quote and backslash are examined only while no multi-byte sequence is open.
# An open sequence is a separate state, so a quote or backslash arriving as a continuation
# is rejected as an invalid continuation instead of silently discarding the lead.
def body_step(+units: List<U32>, +code: U32) -> StrState:
  Bool.pick(StrState, U32.is_eq(code, 34), StrClosed{units},
    Bool.pick(StrState, U32.is_eq(code, 92), StrEscape{units},
      Bool.pick(StrState, U32.is_lt(code, 32), StrBad{"raw_control"},
        Bool.pick(StrState, U32.is_lt(code, 128), with_unit(units, code), lead(code, units)))))

def unicode_step(+units: List<U32>, +hex: List<U32>, +code: U32) -> StrState:
  Bool.pick(StrState, is_hex(code), hex_add(units, hex, hex_of(code)), StrBad{"invalid_unicode_hex"})

# Exactly four hex digits per unicode escape, accumulated as a fixed four-digit value.
def hex_add(+units: List<U32>, +hex: List<U32>, +value: U32) -> StrState:
  match n_go(hex, 0):
    case 3: StrBody{unicode_unit(hex, value) <> units}
    case _: StrUnicode{units, hex <> [value]}

def unicode_unit(+hex: List<U32>, +value: U32) -> U32:
  U32.add(U32.mul(byte_at(hex, 0), 4096),
    U32.add(U32.mul(byte_at(hex, 1), 256), U32.add(U32.mul(byte_at(hex, 2), 16), value)))

def step(state: StrState, +code: U32) -> StrState:
  match state:
    case StrStart{}:
      Bool.pick(StrState, U32.is_eq(code, 34), StrBody{Nil{}}, StrBad{"expected_open_quote"})
    case StrBody{units}: body_step(units, code)
    case StrPending{units, scalar, remaining, minimum}: cont(units, scalar, remaining, minimum, code)
    case StrClosed{units}: StrBad{"trailing_data"}
    case StrEscape{units}:
      Bool.pick(StrState, U32.is_eq(code, 117), StrUnicode{units, Nil{}}, simple_escape(code, units))
    case StrUnicode{units, hex}: unicode_step(units, hex, code)
    case StrBad{reason}: StrBad{reason}

def feed_go(octets: List<U32>, state: StrState) -> StrScan:
  match octets:
    case Nil{}: StrStep{state}
    case +h <> t:
      Bool.pick(StrScan, U32.is_lt(h, 256), feed_go(t, step(state, h)), StrScanFault{h})

def finish_go(state: StrState, original: List<U32>) -> StrResult:
  match state:
    case StrBad{reason}: StrRefused{reason}
    case StrClosed{units}: StrAccepted{rev_go(units, Nil{}), original}
    case StrStart{}: StrRefused{"empty_token"}
    case StrPending{units, scalar, remaining, minimum}: StrRefused{"incomplete_utf8_sequence"}
    case StrEscape{units}: StrRefused{"incomplete_escape"}
    case StrUnicode{units, hex}: StrRefused{"incomplete_unicode_escape"}
    case StrBody{units}: StrRefused{"unterminated_string"}

# Entry. A host octet at or above 256 is its own fault, and an accepted token returns the
# untouched original slice.
def decode_string(+octets: List<U32>) -> StrResult:
  match feed_go(octets, StrStart{}):
    case StrScanFault{value}: StrHostFault{value}
    case StrStep{state}: finish_go(state, octets)
