# CLAIM: a complete quoted JSON string token over validated octets is lexed losslessly in
# pure Bend2, returning an explicit decoded unit representation plus the untouched original
# octets, with raw UTF-8 validated for continuation counts, overlong forms, surrogate
# encodings and values above U+10FFFF, and with escaped UTF-16 code units retained verbatim
# including an isolated surrogate escape.
# Representation, stated precisely: decoded units are UTF-16 code units. A raw valid scalar
# above U+FFFF becomes a surrogate pair; a \u escape contributes exactly the one code unit
# it spells, so a lone surrogate escape survives lexically. No case, Unicode or escape
# normalisation occurs, and an escaped NUL is preserved.
# This is a proposed lexical representation. It is NOT SQLite extraction parity and it
# decides no comparison, duplicate-key or string policy.
# Scope: one string token octet slice supplied by a future structural parser.
# Serves: LANG-CAP-06 (B2-JSON), decoder slice.
# Fixture: bend2/test/output-json-string.bend.
# Syntax follows bend2/src/json/uint-decoder.bend and canonical.bend, read before writing:
# element-with-list cons is `code <> list`, and there are no nested cons patterns.
# UNVERIFIED calls, stated rather than hidden: U32.div and U32.mod are used for the
# surrogate split and could not be grounded in a read; the multi-byte pending order is
# carried as a list I append to and read positionally, which I could not compile to check.
# UNCOMPILED and UNTESTED.

import Base

type StrState is Data:
  StrStart{}
  StrBody{units: List<U32>, pending: List<U32>}
  StrClosed{units: List<U32>}
  StrEscape{units: List<U32>}
  StrUnicode{units: List<U32>, hex: List<U32>}
  StrBad{reason: String}
  StrUnsupported{reason: String}

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

def byte_at(xs: List<U32>, index: U32) -> U32:
  match xs:
    case Nil{}: 0
    case h <> t: Bool.pick(U32, U32.is_eq(index, 0), h, byte_at(t, U32.sub(index, 1)))

def is_hex(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_lt(code, 48), False{},
    Bool.pick(Bool, U32.is_lt(code, 58), True{},
      Bool.pick(Bool, U32.is_lt(code, 65), False{},
        Bool.pick(Bool, U32.is_lt(code, 71), True{},
          Bool.pick(Bool, U32.is_lt(code, 97), False{}, U32.is_lt(code, 103))))))

def hex_of(code: U32) -> U32:
  Bool.pick(U32, U32.is_lt(code, 58), U32.sub(code, 48),
    Bool.pick(U32, U32.is_lt(code, 71), U32.sub(code, 55), U32.sub(code, 87)))

def is_cont(+code: U32) -> Bool:
  Bool.pick(Bool, U32.is_lt(code, 128), False{}, U32.is_lt(code, 192))

def low_of(+scalar: U32) -> U32:
  U32.add(56320, U32.mod(U32.sub(scalar, 65536), 1024))

def high_of(+scalar: U32) -> U32:
  U32.add(55296, U32.div(U32.sub(scalar, 65536), 1024))

# A completed raw sequence: an overlong form and anything above U+10FFFF are malformed, a
# raw encoded surrogate is unsupported-valid rather than malformed, and a scalar at or
# above U+10000 becomes a surrogate pair so the units stay lossless.
def complete_raw(scalar: U32, minimum: U32, units: List<U32>) -> StrState:
  Bool.pick(StrState, U32.is_lt(scalar, minimum), StrBad{"overlong_utf8"},
    Bool.pick(StrState, U32.is_lt(scalar, 65536), StrBody{scalar <> units, Nil{}},
      Bool.pick(StrState, U32.is_lt(scalar, 1114112),
        Bool.pick(StrState, Bool.and(U32.is_lt(55295, scalar), U32.is_lt(scalar, 57344)),
          StrUnsupported{"raw_surrogate_encoding"},
          StrBody{low_of(scalar) <> (high_of(scalar) <> units), Nil{}}),
        StrBad{"above_u10ffff"})))

def no_bytes(xs: List<U32>) -> Bool:
  match xs:
    case Nil{}: True{}
    case _h <> _t: False{}

def units_with(+units: List<U32>, +code: U32) -> List<U32>:
  code <> units

def simple_escape(+code: U32, +units: List<U32>) -> StrState:
  Bool.pick(StrState, U32.is_eq(code, 34), StrBody{units_with(units, 34), Nil{}},
    Bool.pick(StrState, U32.is_eq(code, 92), StrBody{units_with(units, 92), Nil{}},
      Bool.pick(StrState, U32.is_eq(code, 47), StrBody{units_with(units, 47), Nil{}},
        Bool.pick(StrState, U32.is_eq(code, 98), StrBody{units_with(units, 8), Nil{}},
          Bool.pick(StrState, U32.is_eq(code, 102), StrBody{units_with(units, 12), Nil{}},
            Bool.pick(StrState, U32.is_eq(code, 110), StrBody{units_with(units, 10), Nil{}},
              Bool.pick(StrState, U32.is_eq(code, 114), StrBody{units_with(units, 13), Nil{}},
                Bool.pick(StrState, U32.is_eq(code, 116), StrBody{units_with(units, 9), Nil{}},
                  StrBad{"invalid_escape"}))))))))

# Raw byte handling. The pending list holds the bytes of the sequence as written, in order.
def raw_open(+code: U32, +units: List<U32>) -> StrState:
  Bool.pick(StrState, U32.is_lt(code, 32), StrBad{"raw_control"},
    Bool.pick(StrState, U32.is_lt(code, 128), StrBody{units_with(units, code), Nil{}},
      Bool.pick(StrState, U32.is_lt(code, 194), StrBad{"invalid_utf8_lead"},
        Bool.pick(StrState, U32.is_lt(code, 224), StrBody{units, [code]},
          Bool.pick(StrState, U32.is_lt(code, 240), StrBody{units, [code]},
            Bool.pick(StrState, U32.is_lt(code, 245), StrBody{units, [code]},
              StrBad{"above_u10ffff"}))))))

def raw_continue(pending: List<U32>, code: U32, units: List<U32>) -> StrState:
  Bool.pick(StrState, Bool.not(is_cont(code)), StrBad{"invalid_utf8_continuation"},
    raw_join(pending <> [code], code, units))

# A 2-byte sequence completes at 2 pending bytes, 3 at 3, 4 at 4. The scalar is assembled
# from the lead and each continuation's low six bits.
def raw_join(pending: List<U32>, code: U32, units: List<U32>) -> StrState:
  match n_go(pending, 0):
    case 2: complete_raw(two_of(pending), 128, units)
    case 3: complete_raw(three_of(pending), 2048, units)
    case 4: complete_raw(four_of(pending), 65536, units)
    case _: StrBody{units, pending}

def two_of(pending: List<U32>) -> U32:
  U32.add(128, U32.add(U32.mul(64, U32.sub(byte_at(pending, 0), 192)), U32.sub(byte_at(pending, 1), 128)))

def three_of(pending: List<U32>) -> U32:
  U32.add(1024, U32.add(U32.mul(4096, U32.sub(byte_at(pending, 0), 224)),
    U32.add(U32.mul(64, U32.sub(byte_at(pending, 1), 128)), U32.sub(byte_at(pending, 2), 128))))

def four_of(pending: List<U32>) -> U32:
  U32.add(65536, U32.add(U32.mul(262144, U32.sub(byte_at(pending, 0), 240)),
    U32.add(U32.mul(4096, U32.sub(byte_at(pending, 1), 128)),
      U32.add(U32.mul(64, U32.sub(byte_at(pending, 2), 128)), U32.sub(byte_at(pending, 3), 128)))))

def body_step(units: List<U32>, pending: List<U32>, code: U32) -> StrState:
  Bool.pick(StrState, U32.is_eq(code, 34), StrClosed{units},
    Bool.pick(StrState, U32.is_eq(code, 92), StrEscape{units},
      Bool.pick(StrState, no_bytes(pending), raw_open(code, units), raw_continue(pending, code, units))))

def unicode_step(units: List<U32>, hex: List<U32>, code: U32) -> StrState:
  Bool.pick(StrState, is_hex(code), hex_add(units, hex, hex_of(code)), StrBad{"invalid_unicode_hex"})

# Exactly four hex digits per unicode escape. The fourth closes the escape and contributes
# one code unit, computed as 4096*d0 + 256*d1 + 16*d2 + d3, so an isolated surrogate escape
# is retained as that code unit rather than rejected.
def hex_add(units: List<U32>, hex: List<U32>, value: U32) -> StrState:
  match n_go(hex, 0):
    case 3: StrBody{unicode_unit(hex, value) <> units, Nil{}}
    case _: StrUnicode{units, hex <> [value]}

def unicode_unit(hex: List<U32>, value: U32) -> U32:
  U32.add(U32.mul(byte_at(hex, 0), 4096),
    U32.add(U32.mul(byte_at(hex, 1), 256), U32.add(U32.mul(byte_at(hex, 2), 16), value)))

def step(state: StrState, code: U32) -> StrState:
  match state:
    case StrStart{}:
      Bool.pick(StrState, U32.is_eq(code, 34), StrBody{Nil{}, Nil{}}, StrBad{"expected_open_quote"})
    case StrBody{units, pending}: body_step(units, pending, code)
    case StrClosed{units}: StrBad{"trailing_data"}
    case StrEscape{units}: Bool.pick(StrState, U32.is_eq(code, 117), StrUnicode{units, Nil{}}, simple_escape(code, units))
    case StrUnicode{units, hex}: unicode_step(units, hex, code)
    case StrBad{reason}: StrBad{reason}
    case StrUnsupported{reason}: StrUnsupported{reason}

def feed_go(octets: List<U32>, state: StrState) -> StrScan:
  match octets:
    case Nil{}: StrStep{state}
    case +h <> t:
      Bool.pick(StrScan, U32.is_lt(h, 256), feed_go(t, step(state, h)), StrScanFault{h})

def finish_go(state: StrState, original: List<U32>) -> StrResult:
  match state:
    case StrBad{reason}: StrRefused{reason}
    case StrUnsupported{reason}: StrUnsupported{reason}
    case StrClosed{units}: StrAccepted{rev_go(units, Nil{}), original}
    case StrStart{}: StrRefused{"empty_token"}
    case StrEscape{units}: StrRefused{"incomplete_escape"}
    case StrUnicode{units, hex}: StrRefused{"incomplete_unicode_escape"}
    case StrBody{units, pending}: StrRefused{"unterminated_string"}

# Entry. A host octet at or above 256 is its own fault, and an accepted token returns the
# untouched original slice.
def decode_string(+octets: List<U32>) -> StrResult:
  match feed_go(octets, StrStart{}):
    case StrScanFault{value}: StrHostFault{value}
    case StrStep{state}: finish_go(state, octets)
