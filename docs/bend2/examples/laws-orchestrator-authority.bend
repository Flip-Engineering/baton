# CLAIM: for every relation and every act the model's grant is the specification's: an orchestrator
# holds every management act over the seats it leads, a seat can stop itself, and no act is granted
# over a seat the actor does not lead. The extension below states the scope derivation and the
# dispatch boundary the operator adopted on 2026-09-25: the relation is derived from the
# authenticated current delegation, the caller's claimed relation does not change the dispatch
# decision, the effect-time check uses the same relation, no second check denies a lawful grant, a
# current delegation holds every management act, and a seat stops itself under its own scope. Scope
# at this level: the authenticated delegation is a model value, and the runtime that issues and
# revokes it, the resource instance and generation M-8 requires, and the full management-action
# universe are not modelled.
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

# --- Revision 12c adopted scope derivation and dispatch boundary (2026-09-25) ---

# The scope an authenticated delegation names.
type Scope is Data:
  Delegated{}
  Own{}
  Bare{}

# The authenticated delegation the runtime holds for an actor: its granted scope and
# whether that grant is current.
type Grant is Data:
  Grant{scope: Scope, current: Bool}

# The relation the runtime derives from the authenticated delegation.
def relation_of(grant: Grant) -> Relation:
  match grant:
    case Grant{Delegated{}, False{}}: Other{}
    case Grant{Delegated{}, True{}}: Leads{}
    case Grant{Own{}, False{}}: Other{}
    case Grant{Own{}, True{}}: Itself{}
    case Grant{Bare{}, False{}}: Other{}
    case Grant{Bare{}, True{}}: Other{}

# The dispatch check: the runtime uses the relation derived from the authenticated
# delegation. The caller's claimed relation is an input the check discards.
def dispatch(grant: Grant, claimed: Relation, act: Act) -> Bool:
  granted(relation_of(grant), act)

# The effect-time recheck under the current authority.
def effect(grant: Grant, act: Act) -> Bool:
  granted(relation_of(grant), act)

# A second check cannot deny an act its lawful grant admitted.
def allow(authorized: Bool, additional_permission: Bool) -> Bool:
  authorized

law a_stale_grant_confers_no_authority:
  for scope: Scope
  for act: Act
  {dispatch(Grant{scope, False{}}, Other{}, act) == False{} : Bool}

def a_stale_grant_confers_no_authority(scope, act):
  match scope:
    case Delegated{}: {==}
    case Own{}: {==}
    case Bare{}: {==}

law the_caller_cannot_supply_the_relation:
  for grant: Grant
  for claimed: Relation
  for act: Act
  {dispatch(grant, claimed, act) == dispatch(grant, Other{}, act) : Bool}

def the_caller_cannot_supply_the_relation(grant, claimed, act):
  {==}

law the_effect_rechecks_the_current_authority:
  for grant: Grant
  for act: Act
  {effect(grant, act) == dispatch(grant, Other{}, act) : Bool}

def the_effect_rechecks_the_current_authority(grant, act):
  {==}

law no_second_permission_after_a_lawful_grant:
  for authorized: Bool
  for additional: Bool
  {allow(authorized, additional) == authorized : Bool}

def no_second_permission_after_a_lawful_grant(authorized, additional):
  {==}

law a_current_delegation_holds_every_management_act:
  for act: Act
  {dispatch(Grant{Delegated{}, True{}}, Other{}, act) == expected(Leads{}, act) : Bool}

def a_current_delegation_holds_every_management_act(act):
  {==}

law a_seat_stops_itself_under_its_own_scope:
  {dispatch(Grant{Own{}, True{}}, Other{}, Stop{}) == True{} : Bool}

def a_seat_stops_itself_under_its_own_scope():
  {==}
