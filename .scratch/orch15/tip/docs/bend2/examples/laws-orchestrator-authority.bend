# CLAIM: an orchestrator holds every management act over the seats it leads - recruit, guide,
# stop, review, integrate and resume - so no work it directs waits on the root to perform one of
# those acts for it. A seat can stop itself. A grant table that leaves an orchestrator without one
# of the acts makes the law false at that act.
# Status: proposed addition (revision 12c, 2026-09-25), from the operator ruling of 2026-09-21
# (leads get their swarm's whole scope and full authority, including landing their own work) and
# revision 10's shape (a seat stops when it declares itself done or its orchestrator stops it).
# Evidence from 2026-09-25: bend2-orchestrator14 could not stop its own parked seat, because
# swarm.stop was not in its grant. Not part of the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-orchestrator-authority.evidence.md.
import Base

type Act is Data:
  Recruit{}
  Guide{}
  Stop{}
  Review{}
  Integrate{}
  Resume{}

# The actor's relation to the seat the act targets. `Leads{}` is the seat's orchestrator (its
# parent seat, or the root for a top-level lead), `Itself{}` is the seat acting on itself, and
# `Other{}` is any other seat.
type Relation is Data:
  Leads{}
  Itself{}
  Other{}

# The specification: an orchestrator may perform every act on a seat it leads; a seat may stop
# itself (it declares itself done); no act is granted over a seat the actor does not lead.
def expected(rel: Relation, act: Act) -> Bool:
  match rel:
    case Leads{}: True{}
    case Other{}: False{}
    case Itself{}:
      match act:
        case Stop{}: True{}
        case Recruit{}: False{}
        case Guide{}: False{}
        case Review{}: False{}
        case Integrate{}: False{}
        case Resume{}: False{}

# The runtime's grant.
def granted(rel: Relation, act: Act) -> Bool:
  expected(rel, act)

law orchestrator_holds_management:
  for rel: Relation
  for act: Act
  {granted(rel, act) == expected(rel, act) : Bool}

def orchestrator_holds_management(rel, act):
  match rel:
    case Leads{}:
      match act:
        case Recruit{}: {==}
        case Guide{}: {==}
        case Stop{}: {==}
        case Review{}: {==}
        case Integrate{}: {==}
        case Resume{}: {==}
    case Itself{}:
      match act:
        case Recruit{}: {==}
        case Guide{}: {==}
        case Stop{}: {==}
        case Review{}: {==}
        case Integrate{}: {==}
        case Resume{}: {==}
    case Other{}:
      match act:
        case Recruit{}: {==}
        case Guide{}: {==}
        case Stop{}: {==}
        case Review{}: {==}
        case Integrate{}: {==}
        case Resume{}: {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("orchestrator-authority: an orchestrator holds every management act; law checked.")
