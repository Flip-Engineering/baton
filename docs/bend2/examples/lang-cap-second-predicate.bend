# CLAIM: a type does not force every reader through one function. Two defs
# both taking and returning Custody check and run; the second one builds
# Custody{0} directly. Sharing a return type is a naming choice; one
# derivation is an architectural decision the type system does not enforce.
#
# Evidence: lang-cap-second-predicate.evidence.md.

import Base

type Custody is Data:
  Custody{gen: U32}

def holder_view(c: Custody) -> Custody:
  c

def second_view(c: Custody) -> Custody:
  Custody{0}

def show(c: Custody) -> String:
  match c:
    case Custody{gen}:
      "Custody{" ++ U32.show(gen) ++ "}"

def main() -> IO(Unit):
  do IO<Unit>:
    a : Custody = holder_view(Custody{7})
    b : Custody = second_view(a)
    IO.print("holder_view then second_view answers " ++ show(b))
