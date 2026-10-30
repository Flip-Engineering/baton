import Base

def build(n: Nat, acc: List<U32>) -> List<U32>:
  match n:
    case 0n:
      acc
    case 1n+p:
      build(p, 7 <> acc)

law long_lists_compare:
  {build(200000n, []) == build(200000n, []) : List<U32>}

def long_lists_compare():
  {==}

def main() -> U32:
  0
