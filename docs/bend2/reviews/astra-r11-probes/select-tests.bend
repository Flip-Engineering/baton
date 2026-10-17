import Base
import ../../examples/laws-no-ledger.bend as M

# A checked-in converged flag omits the failing test from the selected list.
def stored_record() -> Nat:
  1n

def selected(record: Nat, runs: List<M.Observed>) -> List<M.Observed>:
  match record:
    case 0n: runs
    case 1n+p: []

def gate_from_record(+record: Nat, runs: List<M.Observed>) -> Bool:
  M.landing_blocks(record, selected(record, runs))

def main() -> List<Bool>:
  [gate_from_record(0n, [M.Observed{M.Failed{}, M.Passed{}}]),
   gate_from_record(stored_record(), [M.Observed{M.Failed{}, M.Passed{}}])]
