import Base
import ../../examples/laws-no-ledger.bend as M

# A checked-in member-count assertion is executed by the test.
def stored_pin() -> Nat:
  1n

def same(a: Nat, b: Nat) -> Bool:
  match a:
    case 0n:
      match b:
        case 0n: True{}
        case 1n+p: False{}
    case 1n+p:
      match b:
        case 0n: False{}
        case 1n+q: same(p, q)

def assertion_outcome(equal: Bool) -> M.Outcome:
  match equal:
    case True{}: M.Passed{}
    case False{}: M.Failed{}

def census_test(member_count: Nat) -> M.Outcome:
  assertion_outcome(same(member_count, stored_pin()))

def gate_from_counts(change_count: Nat, target_count: Nat) -> Bool:
  M.gate(0n, census_test(change_count), census_test(target_count))

def main() -> Bool:
  gate_from_counts(2n, 1n)
