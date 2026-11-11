# CLAIM: every state in the model names a party Baton wakes to decide it, so a state that waits
# on a party the runtime does not wake makes the law below false and cannot be represented beside
# it; the parked seat of 2026-09-23 is exactly such a state.
# Status: proposed addition (revision 10, 2026-09-23), shape set by the operator: at every turn
# end Baton wakes the seat's orchestrator with the turn's report, and the orchestrator decides
# whether to nudge the seat on. Not part of the approved 16.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-no-park.evidence.md.
import Base

# The party a state waits on. `Runtime{}` means the work is resumed with no other actor,
# `Orchestrator{}` the seat's parent seat or the root, which Baton wakes at turn end with the
# turn's report, and `Unwoken{}` any party the runtime does not wake.
type Party is Data:
  Runtime{}
  Orchestrator{}
  Unwoken{}

# The work states. A state may wait, but only on a party Baton wakes to decide it.
type State is Data:
  Working{turn: Nat}
  AwaitingOrchestrator{turn: Nat}
  Complete{}

def waiter_of(s: State) -> Party:
  match s:
    case Working{+turn}: Runtime{}
    case AwaitingOrchestrator{+turn}: Orchestrator{}
    case Complete{}: Runtime{}

# Whether Baton wakes this party. Total over the party type, and false only for `Unwoken{}`.
def woken(p: Party) -> Bool:
  match p:
    case Runtime{}: True{}
    case Orchestrator{}: True{}
    case Unwoken{}: False{}

# The law: every state's waiter is a party Baton wakes to decide it.
law waiter_is_woken:
  for s: State
  {woken(waiter_of(s)) == True{} : Bool}

def waiter_is_woken(s):
  match s:
    case Working{+turn}: {==}
    case AwaitingOrchestrator{+turn}: {==}
    case Complete{}: {==}
