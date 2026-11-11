# CLAIM: Base has no File.stat operation at the pin. This negative control is
# expected to fail checking and is recorded in lang-cap-durability.evidence.md.

import Base

def main() -> IO(Unit):
  do IO<Unit>:
    metadata : Unit <- File.stat("docs/bend2/examples/lang-cap-durability-output.tmp")
    return Unit{}
