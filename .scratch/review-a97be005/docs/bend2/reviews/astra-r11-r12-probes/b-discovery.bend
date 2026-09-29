import Base
import ../../examples/laws-derived-catalog.bend as M

def include(served: Bool, id: Nat, rest: List<Nat>) -> List<Nat>:
  match served:
    case True{}: id <> rest
    case False{}: rest

# Every discovered candidate is genuinely provided and not excluded.
def catalog(discovered: List<Nat>) -> List<Nat>:
  match discovered:
    case []: []
    case h <> t: include(M.served(True{}, False{}, False{}), h, catalog(t))

def stored_candidates() -> List<Nat>:
  [0n]

def main() -> List<List<Nat>>:
  [catalog([0n, 1n]), catalog(stored_candidates())]
