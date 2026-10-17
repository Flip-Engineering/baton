import Base
import ../../examples/laws-no-ceiling.bend as M

def admits_size(size: Nat) -> Bool:
  match size:
    case 0n: True{}
    case 1n+s: False{}

def via_authority(+size: Nat) -> M.Decision:
  M.decide(size, 0n, admits_size(size), True{})

def via_resource(+size: Nat) -> M.Decision:
  M.decide(size, 0n, True{}, admits_size(size))

def main() -> List<M.Decision>:
  [via_authority(0n), via_authority(1n), via_resource(1n)]
