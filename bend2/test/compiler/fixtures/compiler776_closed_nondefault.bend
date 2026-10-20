# compiler776_closed_nondefault: closed non-default control.
#
# Exact source path: bend2/test/compiler/fixtures/compiler776_closed_nondefault.bend
# Complete source is this file.
#
# A list match with a two-character literal, a one-token fallback, and a
# default. The fallback row is a non-default specific pattern (+a <> Nil{}),
# its body 7 is closed, and the flattener duplicates that row at both
# character columns of "ab". The restored def-or-closed gate admits the
# closed copies, so emit_arm_shared emits one arm_<seq> returning 7 and both
# duplicated fallback branches call it. Without sharing, both branches inline
# 7 and no arm_<seq> call for 7 appears. The default body 0 may have its own
# one-site shared arm.
#
# Derived, not measured: with no argv, args is [], the literal and one-token
# fallback do not match, the default returns 0, and IO.print writes "0";
# exit 0. With argv ["x"], the fallback returns 7 and IO.print writes "7".
# With argv ["ab"], the literal returns 1. Total for any List<String>.
import Base

def tag(args: List<String>) -> U32:
  match args:
    case "ab" <> Nil{}:
      1
    case +a <> Nil{}:
      7
    case other:
      0

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(U32.show(tag(args)))
