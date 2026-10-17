import Base
import ../../examples/laws-no-ledger.bend as M

# New failing test, shared failure, no observed change verdict, empty selection.
def main() -> List<Bool>:
  [M.breaks(M.Failed{}, M.Absent{}),
   M.breaks(M.Failed{}, M.Failed{}),
   M.breaks(M.Absent{}, M.Passed{}),
   M.landing_blocks(0n, [])]
