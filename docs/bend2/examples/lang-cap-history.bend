# CLAIM: a pure fold returning a fixed-shape result does not prove history is
# preserved. add_review takes the review history and the new review and
# answers [r], discarding its history argument; it checks and runs. The list
# type pins the shape of the answer, and nothing in the type relates the
# answer to the input. lang-cap-history-law.bend states the preservation law
# that rejects this implementation.
#
# Evidence: lang-cap-history.evidence.md.

import Base

def add_review(history: List<U32>, r: U32) -> List<U32>:
  [r]

def show(xs: List<U32>) -> String:
  match xs:
    case Nil{}:
      ""
    case h <> t:
      match t:
        case Nil{}:
          U32.show(h)
        case _:
          U32.show(h) ++ "," ++ show(t)

def main() -> IO(Unit):
  do IO<Unit>:
    out : List<U32> = add_review([1, 2], 3)
    IO.print("add_review([1,2], 3) answers [" ++ show(out) ++ "]")
