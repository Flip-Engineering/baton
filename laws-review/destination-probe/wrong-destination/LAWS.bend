import Base
import ./main.bend as Pub

# The expected destination comes from the admitted publication contract,
# independently of the mutable alias being resolved.
def same(a: Pub.Destination, b: Pub.Destination) -> Bool:
  match a b:
    case Pub.Shared{} Pub.Shared{}:
      True{}
    case Pub.Shared{} Pub.Intermediate{}:
      False{}
    case Pub.Intermediate{} Pub.Shared{}:
      False{}
    case Pub.Intermediate{} Pub.Intermediate{}:
      True{}

def all_match(+expected: Pub.Destination, effects: List<Pub.Destination>) -> Bool:
  match effects:
    case Nil{}:
      True{}
    case Con{destination, rest}:
      same(expected, destination) && all_match(expected, rest)

law destinations_match:
  for +expected: Pub.Destination
  for resolved: Pub.Destination
  {all_match(expected, Pub.prepare(expected, resolved)) == True{} : Bool}
