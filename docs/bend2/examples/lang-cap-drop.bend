# CLAIM: an affine value can be dropped without its release path. leak takes a
# Lease and returns 42, never calling release; it checks and runs. Affinity
# gives at-most-once use of one value; cleanup is a property of the program,
# and the checker enforces only the use count.
#
# Evidence: lang-cap-drop.evidence.md (the negative control that reuses the
# same lease twice is refused with "consumed more than once").

import Base
import ./lang-cap-lease.bend as L

def leak(l: L.Lease) -> U32:
  42

def main() -> IO(Unit):
  do IO<Unit>:
    n : U32 = leak(L.Lease{7})
    IO.print("leak answers " ++ U32.show(n) ++ " and no release ran")
