# CLAIM: an exported affine constructor is forgeable from an importing module.
# The Lease module exposes acquire/release and an affine Lease type; this
# importer never calls acquire, builds L.Lease{999} directly, and passes it to
# L.release, which answers "released 999". Naming a type Lease establishes no
# provenance and no unique producer.
#
# Evidence: lang-cap-forge.evidence.md.

import Base
import ./lang-cap-lease.bend as L

def main() -> IO(Unit):
  do IO<Unit>:
    forged : L.Lease = L.Lease{999}
    out : String = L.release(forged)
    IO.print("forged lease in, release says: " ++ out)
