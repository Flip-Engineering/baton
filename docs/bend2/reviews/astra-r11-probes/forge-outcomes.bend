import Base
import ../../examples/laws-no-ledger.bend as M

# A checked-in expected-failure entry supplies the target outcome.
def stored_record() -> Nat:
  1n

def target_from_record(record: Nat, actual: M.Outcome) -> M.Outcome:
  match record:
    case 0n: actual
    case 1n+p: M.Failed{}

def gate_from_record(+record: Nat, change: M.Outcome, actual_target: M.Outcome) -> Bool:
  M.landing_blocks(record, [M.Observed{change, target_from_record(record, actual_target)}])

def main() -> List<Bool>:
  [gate_from_record(0n, M.Failed{}, M.Passed{}),
   gate_from_record(stored_record(), M.Failed{}, M.Passed{})]
