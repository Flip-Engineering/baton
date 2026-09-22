# A finite controller model, not the Baton2 Git adapter.
# Effects are the destinations that the model actually dispatches to.
import Base

type Destination is Data:
  Shared{}
  Intermediate{}

def prepare(expected: Destination, resolved: Destination) -> List<Destination>:
  match expected resolved:
    case Shared{} Shared{}:
      [Shared{}]
    case Shared{} Intermediate{}:
      [Intermediate{}]
    case Intermediate{} Shared{}:
      []
    case Intermediate{} Intermediate{}:
      [Intermediate{}]
