# The Lease module of the capability probes. The API reads like a private mint:
# acquire returns a Lease, release is the intended consumer, and the type is
# affine (no `is Data`), so one Lease value is used at most once. Nothing marks
# the constructor private: a type's constructors export with the module, so an
# importer can build Lease{u} directly. lang-cap-forge.bend and
# lang-cap-drop.bend show what follows.

import Base

type Lease is Type:
  Lease{u: U32}

def acquire(u: U32) -> Lease:
  Lease{u}

def release(l: Lease) -> String:
  match l:
    case Lease{u}:
      "released " ++ U32.show(u)
