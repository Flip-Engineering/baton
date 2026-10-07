# CLAIM: Base has no File.rename operation at the pin. This negative control is
# expected to fail checking and is recorded in lang-cap-durability.evidence.md.

import Base

def main() -> IO(Unit):
  do IO<Unit>:
    renamed : Unit <- File.rename("from", "to")
    return Unit{}
