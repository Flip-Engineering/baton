# compiler776_list_literal_beside_case: literal list head beside a list case.
#
# Exact source path: bend2/test/compiler/fixtures/compiler776_list_literal_beside_case.bend
# Complete source is this file.
#
# A list match with the literal head pattern "--wake-message" adjacent to the
# general list case +a <> tail, then the empty fallback. The continuation
# finish(rest, bias) is open and is emitted from each case; under the
# candidate the duplicated continuation must collapse to a shared arm with
# bias captured, while the baseline duplicates it per case and emits no arm
# for it.
#
# Derived, not measured: IO.print appends a newline. With no argv, args is
# [], the fallback returns 10 + 3 = 13, stdout "13\n", exit 0. With argv
# ["--wake-message"], the literal case calls finish([], 10), which returns
# 14, stdout "14\n". With argv ["other"], the general case calls
# finish([], 10), stdout "14\n". With argv ["--wake-message","x"], finish
# returns 15, stdout "15\n". Total for any List<String>.
import Base

def finish(xs: List<String>, bias: U32) -> U32:
  match xs:
    case []:
      U32.add(bias, 4)
    case +x <> _:
      U32.add(bias, 5)

def dispatch(args: List<String>, bias: U32) -> U32:
  match args:
    case "--wake-message" <> rest:
      finish(rest, bias)
    case +a <> tail:
      finish(tail, bias)
    case _:
      U32.add(bias, 3)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(U32.show(dispatch(args, 10)))
