import Base

type State is Data:
  Pending{}
  Finished{}
  Cancelled{}
  ExternalFailed{}

type WorkEvent is Data:
  Tick{}
  Completion{}
  Cancellation{}
  ExternalFailure{}

# This illustrates the additional transition obligation. WorkEvent authenticity is external.
def step(state: State, event: WorkEvent) -> State:
  match event:
    case Tick{}: state
    case Completion{}: Finished{}
    case Cancellation{}: Cancelled{}
    case ExternalFailure{}: ExternalFailed{}

law tick_preserves_state:
  for state: State
  {step(state, Tick{}) == state : State}

def tick_preserves_state(state):
  match state:
    case Pending{}: {==}
    case Finished{}: {==}
    case Cancelled{}: {==}
    case ExternalFailed{}: {==}

def main() -> State:
  step(Pending{}, Tick{})
