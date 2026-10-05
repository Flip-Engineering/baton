# Executable corpus for bend2/src/receive/output-json-number.bend.
# CLAIM: every named case below asserts a complete expected value, not a printed echo: the
# accepted cases fix sign, integer, fraction, exponent and the original octets, and the
# refused and host-fault cases fix the named reason or the failing octet. A mismatch calls
# IO.die with the case name.
# Fixture preparation only: UNCOMPILED and UNTESTED; executed by the future compiled
# artifact on an admitted runner, never locally.
# Corpus follows bend2/src/json/uint-decoder.bend fixtures()/main(), and the import form
# below follows the adjacent test imports in bend2/test.
# UNCOMPILED and UNTESTED.

import Base
import ../src/receive/output-json-number.bend as N

def digits(xs: List<U32>) -> String:
  match xs:
    case Nil{}: "-"
    case h <> t: U32.show(h) ++ "," ++ digits(t)

def text(xs: List<U32>) -> String:
  match xs:
    case Nil{}: "[]"
    case h <> t: U32.show(h) ++ ";" ++ text(t)

def rendered(result: N.NumResult) -> String:
  match result:
    case N.NumAccepted{minus, integer, fraction, exponent, original}:
      "accepted:" ++ Bool.show(minus) ++ ":" ++ digits(integer) ++ ":" ++
      digits(fraction) ++ ":" ++ digits(exponent) ++ ":" ++ text(original)
    case N.NumRefused{reason}: "refused:" ++ reason
    case N.NumHostFault{value}: "host-fault:" ++ U32.show(value)
    case _: "unreachable"

def check(octets: List<U32>, expected: String, name: String) -> IO(Unit):
  match maybe_die(rendered(N.decode_number(octets)), expected, name):
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.pure(Unit, Unit{})

def maybe_die(actual: String, expected: String, name: String) -> Bool:
  Bool.pick(Bool, String.is_eq(actual, expected), True{},
    Bool.pick(Bool, True{}, die_now(actual, expected, name), False{}))

def die_now(actual: String, expected: String, name: String) -> Bool:
  IO.die(Unit, 1, name ++ ":" ++ expected ++ "!=" ++ actual)

# 45 minus, 43 plus, 46 point, 48 zero, 49 one, 50 two, 51 three, 53 five, 54 six, 56 eight,
# 57 nine, 101 e, 69 E, 120 x, 0 NUL.
def cases() -> List<Pair<List<U32>, String>>:
  [
    ([48], "accepted:false:48:-:-:48"),
    ([45, 48], "accepted:true:48:-:-:45;48"),
    ([49], "accepted:false:49:-:-:49"),
    ([49, 46, 48], "accepted:false:49:48:-:49;46;48"),
    ([48, 46, 48, 48, 49], "accepted:false:48:48;48;49:-:48;46;48;48;49"),
    ([49, 101, 48], "accepted:false:49:-:48:49;101;48"),
    ([49, 69, 43, 48], "accepted:false:49:-:48:49;69;43;48"),
    ([45, 49], "accepted:true:49:-:-:45;49"),
    ([49, 101, 45, 50], "accepted:false:49:-:45;50:49;101;45;50"),
    ([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 51],
      "accepted:false:57;48;48;55;49;57;57;50;53;52;55;52;48;57;57;51:-:-:57;48;48;55;49;57;57;50;53;52;55;52;48;57;57;51"),
    ([49, 101, 52, 50, 57, 52, 57, 54, 55, 50, 57, 54],
      "accepted:false:49:-:52;50;57;52;57;54;55;50;57;54:49;101;52;50;57;52;57;54;55;50;57;54"),
    ([48, 48], "refused:leading_zero"),
    ([45, 48, 48], "refused:leading_zero"),
    ([43, 49], "refused:expected_digit"),
    ([46, 49], "refused:expected_digit"),
    ([49, 46], "refused:expected_fraction_digit"),
    ([49, 46, 101, 50], "refused:expected_fraction_digit"),
    ([49, 101], "refused:expected_exponent_digit"),
    ([49, 101, 43], "refused:expected_exponent_digit"),
    ([49, 101, 45], "refused:expected_exponent_digit"),
    ([49, 46, 48, 120], "refused:trailing_data"),
    ([49, 120], "refused:trailing_data"),
    ([49, 0], "refused:trailing_data"),
    ([], "refused:expected_digit"),
    ([256], "host-fault:256"),
    ([49, 256], "host-fault:256"),
  ]

def run(rows: List<Pair<List<U32>, String>>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        (octets, expected) = h
        done : IO(Unit) <- check(octets, expected, rendered(N.decode_number(octets)))
        run(t)

def main() -> IO(Unit):
  run(cases())
