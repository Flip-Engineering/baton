# Library half of the imports example. A module is a file; every def here is
# named L.x by whoever imports this file with
# `import ./lang-core-imports-lib.bend as L`.
#
# The law at the bottom is left OPEN on purpose: an importer proves it as
# `def L.plus_zero`, so a proof can ship separately from its claim. Checked
# alone, the open law is a TODO and bend refuses the file; checked through the
# importer, it is proven.

import Base

def square(+x: U32) -> U32:
  (x * x : U32)

# LAW: for every natural x, x plus zero equals x
law plus_zero:
  for x: Nat
  {Nat.add(x, 0n) == x : Nat}
