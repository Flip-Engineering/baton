# CLAIM: the runtime derives the actor's relationship and scope from authenticated current
# authority, and enforces that scope at dispatch and at the effect. A valid orchestrator
# delegation carries every management act needed for its delegated work scope - recruit, guide,
# stop, review, integrate and resume - so no act its scope covers waits on another seat to
# perform it. Revoked or stale authority derives no scope. A seat's own seat is in its derived
# scope, so self actions remain a valid source of authority. No act is dispatched or performed
# outside the derived scope, and no second check can deny an act the derived scope admits. This
# file is the model; ../laws.bend states the laws and laws-proof.bend discharges them.
# Status: proposed addition (revision 12c, 2026-09-25), re-encoded from the operator's adopted
# statements in ../reviews/astra-law-review-r11-r12.md. The operator ruling behind it is
# 2026-09-21 (leads get their swarm's whole scope and full authority, including landing their own
# work), with revision 10's shape (a seat stops when it declares itself done or its orchestrator
# stops it). Evidence from 2026-09-25: bend2-orchestrator14 could not stop its own parked seat,
# because swarm.stop was not in its grant. Not part of the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-orchestrator-authority.evidence.md.
import Base

# The management acts the delegation must cover.
type Act is Data:
  Recruit{}
  Guide{}
  Stop{}
  Review{}
  Integrate{}
  Resume{}

# The authenticated delegation the runtime derives from: the actor, the seats the actor leads,
# whether the authority was revoked, and whether this is still its current generation. Revocation
# and currency are the two facts the runtime checks at the time of effect; the identity and
# generation values behind them are host inputs.
type Delegation is Data:
  Delegation{actor: Nat, leads: +List<Nat>, revoked: Bool, current: Bool}

# The derived decision for one act: performed, or denied.
type Effect is Data:
  Performed{}
  Denied{}

def revoked_of(d: Delegation) -> Bool:
  match d:
    case Delegation{_, _, +revoked, _}: revoked

def current_of(d: Delegation) -> Bool:
  match d:
    case Delegation{_, _, _, +current}: current

def leads_of(d: Delegation) -> +List<Nat>:
  match d:
    case Delegation{_, +leads, _, _}: leads

def member(+x: Nat, xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}: False{}
    case h <> t: Bool.or(Nat.is_eq(x, h), member(x, t))

# The scope the runtime derives from the delegation. A revoked or stale delegation derives no
# seats at all.
def scope_when(d: Delegation, revoked: Bool, current: Bool) -> +List<Nat>:
  match revoked:
    case True{}: []
    case False{}:
      match current:
        case True{}: leads_of(d)
        case False{}: []

def derive(+d: Delegation) -> +List<Nat>:
  scope_when(d, revoked_of(d), current_of(d))

# Dispatch: the single authority decision the runtime enforces before an act.
def dispatch(d: Delegation, act: Act, target: Nat) -> Bool:
  member(target, derive(d))

# The management decision the delegation carries for one target. Every management act gets this
# same decision, so no act of the scope waits on another seat to perform it.
def management(d: Delegation, target: Nat) -> Bool:
  member(target, derive(d))

# The effect, derived from the same dispatch decision.
def performed_when(allowed: Bool) -> Effect:
  match allowed:
    case True{}: Performed{}
    case False{}: Denied{}

def effect(d: Delegation, act: Act, target: Nat) -> Effect:
  performed_when(dispatch(d, act, target))

# A delegation whose authority was revoked.
def revoked(d: Delegation) -> Delegation:
  match d:
    case Delegation{+actor, +leads, _, +current}: Delegation{actor, leads, True{}, current}

# A delegation whose generation is no longer current.
def stale(d: Delegation) -> Delegation:
  match d:
    case Delegation{+actor, +leads, +revoked, _}: Delegation{actor, leads, revoked, False{}}

# A seat's own delegation: it leads itself, is current and not revoked.
def self_delegation(+seat: Nat) -> Delegation:
  Delegation{seat, [seat], False{}, True{}}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("orchestrator-authority: the scope and every management act are derived from current authority; the laws are checked in laws-proof.bend.")
