import Base
import ./empty-runner.bend as R

law impossible_outcome:
  for o: R.Outcome
  {True{} == False{} : Bool}

def impossible_outcome(o):
  match o:
