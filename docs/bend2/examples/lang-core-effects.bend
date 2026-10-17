# CLAIM: a foreign effect is a def of type IO(R) whose body names two host
# imports; the C side must supply a run function registered under the def
# name's CID (io_eff, need 0), the JS side must supply a function named after
# the def, and the same program then runs interpreted (JS host), as a native
# executable (C host) and as emitted JavaScript under Node.
#
# Evidence: lang-core-effects.evidence.md (exact commands and observed output).

import Base

# Host function name: the def name, lowercased, dots to underscores.
# C registration id: the def name uppercased, dots to underscores.
def Core.double(n: U32) -> IO(U32):
  import "./lang-core-effects.c"
  import "./lang-core-effects.js"

def main() -> IO(Unit):
  do IO<Unit>:
    d : U32 <- Core.double(21)
    IO.print("Core.double(21) = " ++ U32.show(d))
