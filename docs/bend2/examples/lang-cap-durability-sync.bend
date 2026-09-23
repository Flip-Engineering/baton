# CLAIM: Base has no File.sync operation at the pin. This negative control is
# expected to fail checking and is recorded in lang-cap-durability.evidence.md.

import Base

def main() -> IO(Unit):
  do IO<Unit>:
    file : File <- IO.try(File, File.open("docs/bend2/examples/lang-cap-durability-output.tmp", "w"))
    synced : Unit <- File.sync(file)
    return Unit{}
