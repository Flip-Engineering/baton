import Base
import ../../examples/laws-derived-catalog.bend as M

def stored_allowlist() -> Bool:
  False{}

def main() -> List<Bool>:
  [M.served(True{}, False{}, False{}),
   M.served(True{}, False{}, M.not_bool(stored_allowlist()))]
