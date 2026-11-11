# compiler776_nat_open_default: Nat default row shared with its captures.
#
# Exact source path: bend2/test/compiler/fixtures/compiler776_nat_open_default.bend
# Complete source is this file.
#
# A Nat match with literal cases 0n, 4n and 8n and a default whose body is
# U32.add(bias, 4), where bias is a parameter outside the match. The open
# default refuses the Nat table, so emit_nats keeps one row per Succ level.
# Before the default-row marker, those rows inline the default body at every
# level. With the marker, exactly one arm_<seq> helper carries bias and every
# duplicated default site calls it. The baseline release inlines the default
# at every row and emits no arm_<seq> for it.
#
# Derived, not measured: IO.print appends a newline. The first argument's
# length selects n. With no argv, first([]) is "", n is 0, pick returns
# 10 + 1 = 11, stdout "11\n", exit 0. With argv ["a"], n is 1, the default
# returns 14, stdout "14\n". With argv ["aaaa"], n is 4, stdout "12\n".
# With argv ["aaaaaaaa"], n is 8, stdout "13\n". With argv ["aaaaaaaaaa"],
# n is 10, the default returns 14, stdout "14\n". Total for any List<String>.
import Base

def first(xs: List<String>) -> String:
  match xs:
    case []:
      ""
    case +s <> _:
      s

def pick(n: Nat, bias: U32) -> U32:
  match n:
    case 0n:
      U32.add(bias, 1)
    case 4n:
      U32.add(bias, 2)
    case 8n:
      U32.add(bias, 3)
    case _:
      U32.add(bias, 4)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(U32.show(pick(U32.to_nat(U32.from_nat(String.length(first(args)))), 10)))
