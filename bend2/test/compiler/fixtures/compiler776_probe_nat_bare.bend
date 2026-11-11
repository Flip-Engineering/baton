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
      1
    case 4n:
      2
    case 8n:
      3
    case _:
      bias

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    IO.print(U32.show(pick(U32.to_nat(U32.from_nat(String.length(first(args)))), 10)))
