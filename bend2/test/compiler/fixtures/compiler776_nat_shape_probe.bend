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
