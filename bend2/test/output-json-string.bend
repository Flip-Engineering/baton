# Executable corpus for bend2/src/receive/output-json-string.bend.
# CLAIM: every named case asserts a complete typed expected result, comparing disposition,
# the decoded UTF-16 code units and the untouched original octets, so a wrong refusal or a
# wrong unit cannot pass; a mismatch calls IO.die with the case name.
# Fixture preparation only: UNCOMPILED and UNTESTED, executed by the future compiled
# artifact on an admitted runner, never locally.
# The decoded representation is UTF-16 code units: a raw scalar above U+FFFF becomes a
# surrogate pair, and a \u escape contributes the one code unit it spells. This is a
# proposed lexical representation, not SQLite parity.
# UNCOMPILED and UNTESTED.

import Base
import ../src/receive/output-json-string.bend as S

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

def same_result(a: S.StrResult, b: S.StrResult) -> Bool:
  match a:
    case S.StrAccepted{units, original}:
      match b:
        case S.StrAccepted{bu, bo}:
          Bool.pick(Bool, same_octets(units, bu), same_octets(original, bo), False{})
        case _: False{}
    case S.StrRefused{reason}:
      match b:
        case S.StrRefused{br}: String.is_eq(reason, br)
        case _: False{}
    case S.StrUnsupported{reason}:
      match b:
        case S.StrUnsupported{br}: String.is_eq(reason, br)
        case _: False{}
    case S.StrHostFault{value}:
      match b:
        case S.StrHostFault{bv}: U32.is_eq(value, bv)
        case _: False{}

def ok(units: List<U32>, original: List<U32>) -> S.StrResult:
  S.StrAccepted{units, original}

def refused(reason: String) -> S.StrResult:
  S.StrRefused{reason}

def unsupported(reason: String) -> S.StrResult:
  S.StrUnsupported{reason}

def fault(value: U32) -> S.StrResult:
  S.StrHostFault{value}

# 34 quote, 92 backslash, 47 slash, 98 b, 102 f, 110 n, 114 r, 116 t, 117 u, 48 zero.
def cases() -> List<List<U32> & S.StrResult & String>:
  [
    ([34, 34], ok(Nil{}, [34, 34]), "empty-string"),
    ([34, 97, 34], ok([97], [34, 97, 34]), "ordinary-ascii"),
    ([34, 92, 98, 34], ok([8], [34, 92, 98, 34]), "escape-backspace"),
    ([34, 92, 102, 34], ok([12], [34, 92, 102, 34]), "escape-formfeed"),
    ([34, 92, 110, 34], ok([10], [34, 92, 110, 34]), "escape-newline"),
    ([34, 92, 114, 34], ok([13], [34, 92, 114, 34]), "escape-carriage-return"),
    ([34, 92, 116, 34], ok([9], [34, 92, 116, 34]), "escape-tab"),
    ([34, 92, 34, 34], ok([34], [34, 92, 34, 34]), "escaped-quote"),
    ([34, 92, 92, 34], ok([92], [34, 92, 92, 34]), "escaped-backslash"),
    ([34, 92, 47, 34], ok([47], [34, 92, 47, 34]), "escaped-slash"),
    ([34, 92, 117, 48, 48, 65, 97, 34], ok([169], [34, 92, 117, 48, 48, 65, 97, 34]),
      "unicode-bmp-lower-hex"),
    ([34, 92, 117, 48, 48, 97, 65, 34], ok([169], [34, 92, 117, 48, 48, 97, 65, 34]),
      "unicode-bmp-upper-hex"),
    ([34, 92, 117, 48, 48, 48, 48, 34], ok([0], [34, 92, 117, 48, 48, 48, 48, 34]),
      "escaped-nul"),
    ([34, 92, 117, 100, 56, 48, 48, 34], ok([55296], [34, 92, 117, 100, 56, 48, 48, 34]),
      "lone-high-surrogate-escape"),
    ([34, 92, 117, 100, 99, 48, 48, 34], ok([56320], [34, 92, 117, 100, 99, 48, 48, 34]),
      "lone-low-surrogate-escape"),
    ([34, 92, 117, 100, 56, 51, 100, 92, 117, 100, 101, 48, 48, 34],
      ok([55357, 56832], [34, 92, 117, 100, 56, 51, 100, 92, 117, 100, 101, 48, 48, 34]),
      "paired-surrogate-escapes"),
    ([34, 194, 169, 34], ok([169], [34, 194, 169, 34]), "raw-two-byte-utf8"),
    ([34, 226, 130, 172, 34], ok([8364], [34, 226, 130, 172, 34]), "raw-three-byte-utf8"),
    ([34, 240, 159, 152, 128, 34], ok([55357, 56832], [34, 240, 159, 152, 128, 34]),
      "raw-four-byte-utf8-becomes-surrogate-pair"),
    ([34, 9, 34], refused("raw_control"), "raw-tab-refused"),
    ([34, 0, 34], refused("raw_control"), "raw-nul-refused"),
    ([34, 92, 120, 34], refused("invalid_escape"), "malformed-escape"),
    ([34, 92, 117, 48, 48, 34], refused("incomplete_unicode_escape"), "short-unicode-escape"),
    ([34, 92, 117, 122, 48, 48, 48, 34], refused("invalid_unicode_hex"), "bad-unicode-hex"),
    ([34, 97], refused("unterminated_string"), "incomplete-quote"),
    ([34, 92], refused("incomplete_escape"), "incomplete-escape"),
    ([34, 194], refused("unterminated_string"), "incomplete-two-byte"),
    ([34, 226, 130], refused("unterminated_string"), "incomplete-three-byte"),
    ([34, 128, 34], refused("invalid_utf8_lead"), "lone-continuation"),
    ([34, 192, 175, 34], refused("invalid_utf8_lead"), "overlong-two-byte-lead"),
    ([34, 224, 128, 175, 34], refused("overlong_utf8"), "overlong-three-byte"),
    ([34, 237, 160, 128, 34], unsupported("raw_surrogate_encoding"), "raw-encoded-surrogate"),
    ([34, 244, 144, 128, 128, 34], refused("above_u10ffff"), "above-u10ffff"),
    ([34, 97, 34, 97], refused("trailing_data"), "trailing-bytes"),
    ([34, 97, 34, 256], fault(256), "host-octet-256"),
    ([97, 34], refused("expected_open_quote"), "missing-open-quote"),
  ]

def check(case: List<U32> & S.StrResult & String) -> IO(Unit):
  (octets, expected, name) = case
  match same_result(S.decode_string(octets), expected):
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def run(rows: List<List<U32> & S.StrResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def main() -> IO(Unit):
  run(cases())
