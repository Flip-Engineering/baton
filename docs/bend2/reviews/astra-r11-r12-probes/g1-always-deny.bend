import Base

type Act is Data:
  Landing{}
  Admission{}
  Recruit{}
  Check{}
  TurnEnd{}
  Refusal{}

# The observed Boolean abstracts the domain decision for each act.
def decide(act: Act, observed_allowed: Bool, notes: Nat) -> Bool:
  False{}

law annotation_independence:
  for act: Act
  for observed_allowed: Bool
  for notes: Nat
  {decide(act, observed_allowed, notes) == decide(act, observed_allowed, 0n) : Bool}

def annotation_independence(act, observed_allowed, notes):
  match notes:
    case 0n: {==}
    case 1n+n:
      match observed_allowed:
        case True{}: {==}
        case False{}: {==}

def main() -> Bool:
  decide(Admission{}, True{}, 1n)
