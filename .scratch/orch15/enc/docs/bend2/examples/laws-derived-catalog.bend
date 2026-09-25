# CLAIM: for one candidate route and every value of a hand-kept table, the model's served
# decision is the specification's: the route is served when the harness provides it and the
# operator has not excluded it. The extension below states the discovery, policy and reporting
# obligations the operator adopted on 2026-09-25: the served route list equals the expected list
# over the complete observed catalog, discovery is the observation, the exclusion input is the
# authenticated operator policy, and a failed observation is reported as unobserved rather than
# as an empty catalog. Scope at this level: observing the harness and the credential file is a
# host effect, and catalog authenticity is a stated assumption.
# Status: proposed addition (revision 12b, 2026-09-25), from the operator ruling of 2026-09-24
# ("why do you hardcode things like this when they need to be derived from the relevant
# harness?", #440, #549) and the adopted statement. Not part of the approved set.
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

# --- Revision 12b adopted identity, discovery and policy provenance (2026-09-25) ---

# One discovered entry: its stable route identity and the observation of the harness and
# credential state for it, plus whether a programmer-maintained table names it.
type Entry is Data:
  Entry{id: Nat, provided: Bool, listed: Bool, excluded: Bool}

# The discovery outcome: an observed catalog, or a failed observation with its reason.
type Discovery is Data:
  Observed{entries: +List<Entry>}
  Failed{reason: Nat}

# The authenticated operator's route policy for one route.
type Policy is Data:
  Policy{excluded: Bool}

# The reported catalog: whether an observation happened, and the routes it serves.
type Catalog is Data:
  Catalog{observed: Bool, routes: +List<Bool>}

def served_list(entries: +List<Entry>) -> +List<Bool>:
  match entries:
    case []: []
    case h <> t:
      match h:
        case Entry{+id, +provided, +listed, +excluded}: served(provided, listed, excluded) <> served_list(t)

def expected_list(entries: +List<Entry>) -> +List<Bool>:
  match entries:
    case []: []
    case h <> t:
      match h:
        case Entry{+id, +provided, +listed, +excluded}: expected(provided, excluded) <> expected_list(t)

def discovered(entries: +List<Entry>) -> +List<Entry>:
  entries

def policy_of(policy: Policy) -> Bool:
  match policy:
    case Policy{+excluded}: excluded

def exclusion_from(record: Nat, policy: Policy) -> Bool:
  policy_of(policy)

def report(d: Discovery) -> Catalog:
  match d:
    case Observed{+entries}: Catalog{True{}, served_list(entries)}
    case Failed{_}: Catalog{False{}, []}

law served_matches_expected:
  for provided: Bool
  for listed: Bool
  for excluded: Bool
  {expected(provided, excluded) == served(provided, listed, excluded) : Bool}

def served_matches_expected(provided, listed, excluded):
  match provided:
    case True{}:
      match excluded:
        case True{}: {==}
        case False{}: {==}
    case False{}: {==}

law the_served_list_is_the_expected_list:
  for +entries: +List<Entry>
  {expected_list(entries) == served_list(entries) : +List<Bool>}

def the_served_list_is_the_expected_list(entries):
  match entries:
    case []: {==}
    case h <> t:
      match h:
        case Entry{+id, +provided, +listed, +excluded}:
          %served_matches_expected(provided, listed, excluded) : {expected(provided, excluded) <> expected_list(t) == _ <> served_list(t) : +List<Bool>}
          %the_served_list_is_the_expected_list(t) : {expected(provided, excluded) <> expected_list(t) == expected(provided, excluded) <> _ : +List<Bool>}
          {==}

law discovery_is_the_complete_observation:
  for +entries: +List<Entry>
  {discovered(entries) == entries : +List<Entry>}

def discovery_is_the_complete_observation(entries):
  {==}

law the_exclusion_is_the_authenticated_policy:
  for record: Nat
  for policy: Policy
  {exclusion_from(record, policy) == policy_of(policy) : Bool}

def the_exclusion_is_the_authenticated_policy(record, policy):
  {==}

law a_failed_discovery_is_reported_not_an_empty_catalog:
  for reason: Nat
  {report(Failed{reason}) == Catalog{False{}, []} : Catalog}

def a_failed_discovery_is_reported_not_an_empty_catalog(reason):
  {==}
