# CLAIM: bend 2.0.25 checks, runs and builds a typed IO program on this host.
#
# Evidence: ../examples/toolchain-sanity.evidence.md (exact commands and observed output).

import Base

# A reusable parameter (`+x`) lets the body use x twice; plain `x` is affine and may
# be consumed at most once.
def twice(+x: U32) -> U32:
  (x + x : U32)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("toolchain sanity: twice(21) = " ++ U32.show(twice(21)))
