# CLAIM: the set of routes Baton serves is a function of what the harness and credential state
# observably provide, less the routes the operator excludes. A hand-kept table of routes cannot
# add a route the harness does not provide, and cannot hide one it does.
# Status: proposed addition (revision 12b, 2026-09-25), from the operator ruling of 2026-09-24
# ("why do you hardcode things like this when they need to be derived from the relevant
# harness?", #440, #549). Not part of the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-derived-catalog.evidence.md.
import Base

# One candidate route, as the runtime sees it. `provided` is whether the harness observably
# provides it now (its model cache lists the model, its credential file resolves). `listed` is
# whether a hand-kept table names it. `excluded` is whether the operator excluded it.
type Candidate is Data:
  Candidate{provided: Bool, listed: Bool, excluded: Bool}

def not_bool(b: Bool) -> Bool:
  match b:
    case True{}: False{}
    case False{}: True{}

# The specification: a route is served when the harness provides it and the operator has not
# excluded it.
def expected(provided: Bool, excluded: Bool) -> Bool:
  match provided:
    case False{}: False{}
    case True{}: not_bool(excluded)

# The runtime's catalog decision for one candidate.
def served(provided: Bool, listed: Bool, excluded: Bool) -> Bool:
  expected(provided, excluded)

# The law: for every value of the hand-kept table, the served decision is the specification's.
law served_follows_observation:
  for provided: Bool
  for listed: Bool
  for excluded: Bool
  {served(provided, listed, excluded) == expected(provided, excluded) : Bool}

def served_follows_observation(provided, listed, excluded):
  match provided:
    case True{}:
      match listed:
        case True{}:
          match excluded:
            case True{}: {==}
            case False{}: {==}
        case False{}:
          match excluded:
            case True{}: {==}
            case False{}: {==}
    case False{}:
      match listed:
        case True{}:
          match excluded:
            case True{}: {==}
            case False{}: {==}
        case False{}:
          match excluded:
            case True{}: {==}
            case False{}: {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("derived-catalog: served routes follow observation; law checked.")
