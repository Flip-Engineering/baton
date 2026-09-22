import Base
import ./main.bend as Pub
import ./LAWS.bend as Laws

def Laws.destinations_match(expected, resolved):
  match expected resolved:
    case Pub.Shared{} Pub.Shared{}:
      {==}
    case Pub.Shared{} Pub.Intermediate{}:
      {==}
    case Pub.Intermediate{} Pub.Shared{}:
      {==}
    case Pub.Intermediate{} Pub.Intermediate{}:
      {==}
