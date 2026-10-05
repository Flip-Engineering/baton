# Executable corpus for bend2/src/receive/output-json-number.bend.
# CLAIM: each named invariant below has an independent expected classification, and the
# accepted cases round-trip their original octets byte for byte; a failure names its
# invariant. Fixture preparation only: UNCOMPILED and UNTESTED, executed by the future
# compiled artifact on an admitted runner, never locally.
# Corpus follows the executable pattern of bend2/src/json/uint-decoder.bend, whose
# fixtures()/main() pair is the repository's own shape for pure decoder corpora.
# UNVERIFIED: the import path form below is the one line I could not ground in a read;
# every canonical, ASCII, sign, fraction, exponent, huge-integer, invalid-octet and
# equality case is otherwise spelled out.

import Base

# The module is imported by its source path; if the repository spells this differently the
# repair is confined to this line.
import receive.output-json-number as N

def digits(xs: List<U32>) -> List<U32>:
  match xs:
    case Nil{}: Nil{}
    case h <> t: U32.cons(h, digits(t))

# Byte equality of the original slice, which every accepted token must satisfy.
def same_octets(a: List<U32>, b: List<U32>) -> Bool:
  match a:
    case Nil{}:
      match b:
        case Nil{}: True{}
        case _: False{}
    case h <> t:
      match b:
        case Nil{}: False{}
        case hb <> tb: Bool.pick(Bool, U32.is_eq(h, hb), same_octets(t, tb), False{})

def text(xs: List<U32>) -> String:
  match xs:
    case Nil{}: "[]"
    case h <> t: U32.show(h) ++ ";" ++ text(t)

def label(octets: List<U32>) -> String:
  match octets:
    case Nil{}: "empty"
    case _: text(octets)

def outcome(octets: List<U32>) -> String:
  match N.decode_number(octets):
    case N.NumAccepted{minus, integer, fraction, exponent, original}:
      Bool.pick(String, same_octets(original, octets),
        "accepted:" ++ label(octets) ++ ":minus:" ++ Bool.show(minus) ++
        ":integer:" ++ text(integer) ++ ":fraction:" ++ text(fraction) ++
        ":exponent:" ++ text(exponent),
        "FAILED:round_trip:" ++ label(octets))
    case N.NumRefused{reason}: "refused:" ++ label(octets) ++ ":" ++ reason
    case _: "FAILED:unreachable:" ++ label(octets)

# 48 zero, 49 one, 45 minus, 43 plus, 46 point, 101 e, 69 E, 32 space, 256 host-invalid.
def corpus() -> List<List<U32>>:
  [
    [48],                          # accepted, zero
    [45, 48],                      # accepted, negative zero preserved
    [49],                          # accepted
    [49, 46, 48],                  # accepted, 1.0 fraction retained
    [49, 101, 48],                 # accepted, 1e0
    [49, 69, 43, 48],              # accepted, 1E+0 explicit plus in the original slice
    [45, 49],                      # accepted, -1
    [48, 46, 48, 48, 49],          # accepted, fractional form
    digits([57, 48, 48, 55, 49, 57, 57, 50, 53, 52, 55, 52, 48, 57, 57, 50]),  # beyond 2^53
    [49, 101, 52, 50, 57, 52, 57, 54, 55, 50, 57, 54],  # exponent beyond U32, digits kept
    [48, 48],                      # refused, leading zero
    [43, 49],                      # refused, explicit plus token
    [46, 49],                      # refused, leading point
    [49, 46],                      # refused, empty fraction
    [49, 101],                     # refused, empty exponent
    [49, 101, 43],                 # refused, exponent sign with no digit
    [49, 32],                      # refused, ASCII suffix
    [],                            # refused, empty token
    [50, 53, 54],                  # refused, host-invalid octet 256
  ]

def run(rows: List<List<U32>>) -> IO(Unit):
  match rows:
    case Nil{}: IO.pure(Unit, Unit{})
    case h <> t:
      do IO<Unit>:
        printed : Unit <- IO.print(outcome(h))
        run(t)

def main() -> IO(Unit):
  run(corpus())
