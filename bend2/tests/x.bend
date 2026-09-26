import Base

def caller(x: Nat) -> Nat:
  helper(x)

def helper(n: Nat) -> Nat:
  match n:
    case 0n: 0n
    case 1n+p: 1n+helper(p)
