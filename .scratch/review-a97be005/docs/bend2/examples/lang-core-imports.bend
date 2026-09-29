# CLAIM: a module is a file imported by relative path under a file-local
# alias; a law left open in one file is proven in another file as def M.name;
# a package import (`import 0x<hash>/main.bend as P`) names content the Hub
# serves at check time, so a checked-in local module is the form that works
# offline (vendoring).
#
# Evidence: lang-core-imports.evidence.md (exact commands and observed output,
# including the Hub fetch attempt and the missing-file refusal).

import Base
import ./lang-core-imports-lib.bend as L

# The proof of the library's open law ships beside the importer, as the
# guide's LAWS.bend / PROOF.bend split does inside one project: base case by
# reflexivity, step case by the induction hypothesis and a rewrite.
def L.plus_zero(x):
  match x:
    case 0n:
      {==}
    case 1n+p:
      %L.plus_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("L.square(7) = " ++ U32.show(L.square(7)))
