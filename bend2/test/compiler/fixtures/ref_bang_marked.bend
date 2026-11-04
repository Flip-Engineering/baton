# The same call with the bang marker: emit_jump takes the offload task path.
# ref_bang_plain.bend is identical except for deep(5n).
import Base

def deep(+n: Nat) -> U32:
  match n:
    case 0n:
      0
    case 1n+p:
      U32.add(1, deep(p))

def main() -> IO(Unit):
  IO.print(U32.show(deep!(5n)))
