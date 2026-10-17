# CLAIM: `!` marks a parallel call for the GPU. The native build of a program with a marked call
# emits a `.gpu` companion beside the binary, which `file` reports as a Metal GPU executable; the
# marked call and the same call under `--gpu off` print the same value; and a binary run without
# its companion compiles the GPU program again.
#
# Evidence: lang-host-gpu.evidence.md (exact commands and observed output).

import Base

# pow2(d) is a balanced tree of 2^d leaves, each one addition; `pow2!(d)` hands the whole tree to
# the GPU, `pow2(d)` runs it on the CPU's cores.
def pow2(+d: Nat) -> U32:
  match d:
    case 0n:
      1
    case 1n+p:
      a b = pow2(p) pow2(p)
      U32.add(a, b)

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    IO.print("pow2!(20) = " ++ U32.show(pow2!(20n)))
