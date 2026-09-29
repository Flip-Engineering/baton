import Base
import ./g1.bend as G

def fact_from_note(note: Nat) -> Bool:
  match note:
    case 0n: True{}
    case 1n+n: False{}

def main() -> List<Bool>:
  [G.decide(G.Admission{}, fact_from_note(0n), 0n),
   G.decide(G.Admission{}, fact_from_note(1n), 1n)]
