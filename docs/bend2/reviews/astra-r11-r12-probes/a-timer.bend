import Base
import ../../examples/laws-no-ceiling.bend as M

def timer_callback(elapsed: Nat, previous: M.Decision) -> M.Decision:
  match elapsed:
    case 0n: previous
    case 1n+e: M.Refused{}

def main() -> List<M.Decision>:
  [M.decide(0n, 1n, True{}, False{}),
   timer_callback(1n, M.decide(0n, 1n, True{}, False{}))]
