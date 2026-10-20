# compiler776_capture_default: captured default arm.
#
# Exact source path: bend2/test/compiler/fixtures/compiler776_capture_default.bend
# Complete source is this file.
#
# A string match with a two-character literal and a default arm whose body
# returns base, a parameter bound outside the match. The flattener duplicates
# that default at every nested match level the literal flattens into (the top
# String match, the SCon tail chain, and the final SNil check). With the
# capture-aware shared arm path, emit_arm_shared emits exactly one arm_<seq>
# helper for the base default body whose parameter list carries the captured
# base word ahead of the match arguments, with two or more call sites each
# passing base. Without sharing, the base return is inline in those branches
# and no arm_<seq> call for it appears.
#
# Derived, not measured: IO.print appends a newline. With no argv, first([])
# is "zz", base is String.length("zz") = 2, the default returns 2, and
# IO.print writes "2\n"; exit 0. With argv ["ab"], the literal returns 1 and
# IO.print writes "1\n". Any other first argument returns its length and
# writes it with a newline. Total for any List<String>.
import Base

def first(xs: List<String>) -> String:
  match xs:
    case []:
      "zz"
    case +s <> _:
      s

def pick(s: String, base: U32) -> U32:
  match s:
    case "ab":
      1
    case _:
      base

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    s = first(args)
    IO.print(U32.show(pick(s, U32.from_nat(String.length(s)))))
