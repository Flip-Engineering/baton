import Base

def match_table(n: Nat) -> U32:
  match n:
    case 0n: 11
    case 1n: 22
    case 2n: 33
    case _: 44

def main() -> U32:
  match_table(4n)
