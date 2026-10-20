# compiler776_capture_default: captured default arm.
#
# Exact source path: bend2/test/compiler/fixtures/compiler776_capture_default.bend
# Complete source is this file.
#
# A string match with a two-character literal and a default arm whose body
# returns base, a parameter bound outside the match. The flattener duplicates
# that default at both character columns. With the capture-aware shared arm
# path, emit_arm_shared emits one arm_<seq> helper whose parameter list
# includes the captured base word beyond the match's own arguments, and both
# character-site calls pass base. Without sharing, the two branches inline the
# base return and no arm_<seq> call for it appears.
#
# Derived, not measured: with no argv, first([]) is "zz", base is
# String.length("zz") = 2, the default returns 2, and IO.print writes "2";
# exit 0. With argv ["ab"], the literal returns 1; any other first argument
# returns its length. Total for any List<String>.
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
