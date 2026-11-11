import Base

type Need is Data:
  NoAct{}
  Resource{}
  Authority{}
  Bookkeeping{}

def allowed(need: Need) -> Bool:
  match need:
    case NoAct{}: True{}
    case Resource{}: True{}
    case Authority{}: True{}
    case Bookkeeping{}: False{}

def required(record: Nat) -> Need:
  NoAct{}

law no_administrative_precondition:
  for record: Nat
  {allowed(required(record)) == True{} : Bool}

def no_administrative_precondition(record):
  {==}

def main() -> Need:
  required(1n)
