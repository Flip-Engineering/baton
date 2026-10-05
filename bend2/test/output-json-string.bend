# Executable corpus for bend2/src/receive/output-json-string.bend.
# CLAIM: every named case asserts a complete typed expected result, comparing disposition,
# decoded UTF-16 code units and the untouched original octets, so a wrong disposition or
# unit cannot pass; a mismatch calls IO.die with the case name.
# Fixture preparation only: UNCOMPILED and UNTESTED, executed by the future compiled
# artifact on an admitted runner, never locally.
# The decoded representation is UTF-16 code units. A raw UTF-8 encoding of D800..DFFF is
# malformed under the declared policy, while the same value as a unicode escape is retained.
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
        case S.StrRefused{br}: String.eq(reason, br)
        case _: False{}
    case S.StrUnsupported{reason}:
      match b:
        case S.StrUnsupported{br}: String.eq(reason, br)
        case _: False{}
    case S.StrHostFault{value}:
      match b:
        case S.StrHostFault{bv}: U32.is_eq(value, bv)
        case _: False{}

def ok(units: List<U32>, original: List<U32>) -> S.StrResult:
  S.StrAccepted{units, original}

def refused(reason: String) -> S.StrResult:
  S.StrRefused{reason}

def fault(value: U32) -> S.StrResult:
  S.StrHostFault{value}

# 34 quote, 92 backslash, 117 u, 97 a, 98 b, 65 A, 57 nine.
def cases() -> List<List<U32> & S.StrResult & String>:
  [
    ([34, 34], ok(Nil{}, [34, 34]), "empty-string"),
    ([34, 97, 34], ok([97], [34, 97, 34]), "ordinary-ascii"),
    ([34, 92, 98, 34], ok([8], [34, 92, 98, 34]), "escape-backspace"),
    ([34, 92, 102, 34], ok([12], [34, 92, 102, 34]), "escape-formfeed"),
    ([34, 92, 114, 34], ok([13], [34, 92, 114, 34]), "escape-carriage-return"),
    ([34, 92, 116, 34], ok([9], [34, 92, 116, 34]), "escape-tab"),
    ([34, 92, 110, 34], ok([10], [34, 92, 110, 34]), "escape-newline"),
    ([34, 92, 34, 34], ok([34], [34, 92, 34, 34]), "escaped-quote"),
    ([34, 92, 92, 34], ok([92], [34, 92, 92, 34]), "escaped-backslash"),
    ([34, 92, 47, 34], ok([47], [34, 92, 47, 34]), "escaped-slash"),
    ([34, 92, 117, 48, 48, 65, 57, 34], ok([169], [34, 92, 117, 48, 48, 65, 57, 34]),
      "unicode-bmp-upper-hex-a9"),
    ([34, 92, 117, 48, 48, 97, 57, 34], ok([169], [34, 92, 117, 48, 48, 97, 57, 34]),
      "unicode-bmp-lower-hex-a9"),
    ([34, 92, 117, 48, 48, 48, 48, 34], ok([0], [34, 92, 117, 48, 48, 48, 48, 34]),
      "escaped-nul"),
    ([34, 92, 117, 100, 56, 48, 48, 34], ok([55296], [34, 92, 117, 100, 56, 48, 48, 34]),
      "lone-high-surrogate-escape-retained"),
    ([34, 92, 117, 100, 99, 48, 48, 34], ok([56320], [34, 92, 117, 100, 99, 48, 48, 34]),
      "lone-low-surrogate-escape-retained"),
    ([34, 92, 117, 100, 56, 51, 100, 92, 117, 100, 101, 48, 48, 34],
      ok([55357, 56832], [34, 92, 117, 100, 56, 51, 100, 92, 117, 100, 101, 48, 48, 34]),
      "paired-surrogate-escapes"),
    ([34, 194, 169, 34], ok([169], [34, 194, 169, 34]), "raw-two-byte-max-a9"),
    ([34, 194, 128, 34], ok([128], [34, 194, 128, 34]), "raw-two-byte-min"),
    ([34, 223, 191, 34], ok([2047], [34, 223, 191, 34]), "raw-two-byte-max"),
    ([34, 224, 160, 128, 34], ok([2048], [34, 224, 160, 128, 34]), "raw-three-byte-min"),
    ([34, 239, 191, 191, 34], ok([65535], [34, 239, 191, 191, 34]), "raw-three-byte-max"),
    ([34, 226, 130, 172, 34], ok([8364], [34, 226, 130, 172, 34]), "raw-three-byte-euro"),
    ([34, 240, 144, 128, 128, 34], ok([55296, 56320], [34, 240, 144, 128, 128, 34]),
      "raw-four-byte-min-pair"),
    ([34, 244, 143, 191, 191, 34], ok([56319, 57343], [34, 244, 143, 191, 191, 34]),
      "raw-four-byte-max-u10ffff"),
    ([34, 240, 159, 152, 128, 34], ok([55357, 56832], [34, 240, 159, 152, 128, 34]),
      "raw-four-byte-pair"),
    ([34, 237, 159, 191, 34], ok([55295], [34, 237, 159, 191, 34]), "below-surrogate-range"),
    ([34, 238, 128, 128, 34], ok([57344], [34, 238, 128, 128, 34]), "above-surrogate-range"),
    ([34, 237, 160, 128, 34], refused("raw_surrogate_encoding"), "raw-surrogate-d800-refused"),
    ([34, 237, 191, 191, 34], refused("raw_surrogate_encoding"), "raw-surrogate-dfff-refused"),
    ([34, 244, 144, 128, 128, 34], refused("above_u10ffff"), "above-u10ffff"),
    ([34, 97, 92, 110, 98, 92, 117, 48, 48, 65, 57, 34],
      ok([97, 10, 98, 169], [34, 97, 92, 110, 98, 92, 117, 48, 48, 65, 57, 34]),
      "mixed-literal-and-escaped-order"),
    ([34, 9, 34], refused("raw_control"), "raw-tab-refused"),
    ([34, 0, 34], refused("raw_control"), "raw-nul-refused"),
    ([34, 92, 120, 34], refused("invalid_escape"), "malformed-escape"),
    ([34, 92, 117, 48, 48, 34, 65, 34], refused("invalid_unicode_hex"), "quote-in-hex-position"),
    ([34, 92, 117, 48, 48], refused("incomplete_unicode_escape"), "eof-after-two-hex-digits"),
    ([34, 92, 117, 122, 48, 48, 48, 34], refused("invalid_unicode_hex"), "bad-unicode-hex"),
    ([34, 194, 34], refused("invalid_utf8_continuation"), "pending-lead-then-quote"),
    ([34, 194, 92, 110, 34], refused("invalid_utf8_continuation"), "pending-lead-then-backslash"),
    ([34, 240, 159, 152, 34], refused("invalid_utf8_continuation"), "truncated-four-byte-by-quote"),
    ([34, 226, 130], refused("incomplete_utf8_sequence"), "incomplete-three-byte"),
    ([34, 240, 159, 152], refused("incomplete_utf8_sequence"), "incomplete-four-byte"),
    ([34, 128, 34], refused("invalid_utf8_lead"), "lone-continuation"),
    ([34, 192, 175, 34], refused("invalid_utf8_lead"), "overlong-two-byte-lead"),
    ([34, 224, 128, 175, 34], refused("overlong_utf8"), "overlong-three-byte"),
    ([34, 97], refused("unterminated_string"), "incomplete-quote"),
    ([34, 92], refused("incomplete_escape"), "incomplete-escape"),
    ([34, 97, 34, 97], refused("trailing_data"), "trailing-bytes"),
    ([34, 97, 34, 256], fault(256), "host-octet-256"),
    ([97, 34], refused("expected_open_quote"), "missing-open-quote"),
    ([97, 256], fault(256), "host-fault-after-plain-octet"),
    ([34, 92, 120, 256], fault(256), "host-fault-after-malformed-escape-prefix"),
    ([34, 194, 34, 256], fault(256), "host-fault-after-unfinished-lead"),
    ([34, 255, 256], fault(256), "host-fault-after-invalid-lead"),
    ([34, 255, 300, 256], fault(300), "first-competing-host-fault"),
    ([], refused("empty_token"), "empty-input"),
    ([34], refused("unterminated_string"), "quote-only"),
    ([34, 97, 34, 32], refused("trailing_data"), "closed-token-then-whitespace"),
    ([34, 97, 34, 34, 98, 34], refused("trailing_data"), "closed-token-then-second-token"),
    ([34, 92, 117, 52], refused("incomplete_unicode_escape"), "eof-after-one-hex-digit"),
    ([34, 92, 117, 52, 49, 50], refused("incomplete_unicode_escape"), "eof-after-three-hex-digits"),
    ([34, 92, 117, 48, 48, 52, 49, 66, 34], ok([65, 66], [34, 92, 117, 48, 48, 52, 49, 66, 34]),
      "hex-looking-character-after-completed-escape"),
    ([34, 240, 128, 128, 128, 34], refused("overlong_utf8"), "four-byte-overlong"),
    ([34, 31, 34], refused("raw_control"), "raw-31-rejected"),
    ([34, 32, 34], ok([32], [34, 32, 34]), "raw-32-accepted"),
    ([34, 97, 240, 159, 152, 128, 92, 110, 34],
      ok([97, 55357, 56832, 10], [34, 97, 240, 159, 152, 128, 92, 110, 34]),
      "supplementary-pair-between-ordinary-and-escaped-units"),
  ]

def judge(actual: S.StrResult, expected: S.StrResult, name: String) -> IO(Unit):
  +verdict = same_result(actual, expected)
  match verdict:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 1, name)

def check(case: List<U32> & S.StrResult & String) -> IO(Unit):
  (octets, expected, name) = case
  judge(S.decode_string(octets), expected, name)

def unequal_pairs() -> List<S.StrResult & S.StrResult & String>:
  [
    (ok([97], [34, 97, 34]), ok([98], [34, 97, 34]), "comparator-units"),
    (ok([97], [34, 97, 34]), ok([97], [34, 98, 34]), "comparator-original-same-length"),
    (ok([97], [34, 97, 34]), ok([97], [34, 97, 97, 34]), "comparator-original-unequal-length"),
    (ok([97], [34, 97, 34]), refused("unterminated_string"), "comparator-disposition"),
    (refused("raw_control"), refused("trailing_data"), "comparator-refusal-reason"),
    (S.StrUnsupported{"raw_surrogate_encoding"}, S.StrUnsupported{"another_reason"},
      "comparator-unsupported-reason"),
    (fault(256), fault(255), "comparator-host-fault-value"),
  ]

def judge_unequal(left: S.StrResult, right: S.StrResult, name: String) -> IO(Unit):
  +verdict = same_result(left, right)
  match verdict:
    case True{}: IO.die(Unit, 1, name)
    case False{}: IO.pure(Unit, Unit{})

def check_pair(pair: S.StrResult & S.StrResult & String) -> IO(Unit):
  (left, right, name) = pair
  judge_unequal(left, right, name)

def run_pairs(rows: List<S.StrResult & S.StrResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check_pair(h)
        run_pairs(t)

def run(rows: List<List<U32> & S.StrResult & String>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        checked : Unit <- check(h)
        run(t)

def main() -> IO<Unit>:
  do IO<Unit>:
    all : Unit <- run(cases())
    pairs : Unit <- run_pairs(unequal_pairs())
    IO.pure(Unit, Unit{})
