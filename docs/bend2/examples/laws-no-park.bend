# CLAIM: the runtime's turn loop is total over its state type, and no state in the
# model has an exit another party must take; adding a state whose exit is a claim,
# nudge, guide, resume decision or review makes the law below false, so the parked
# state cannot be represented beside the law.
# Status: proposed addition (revision 10, 2026-09-23). Not part of the approved 16.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-no-park.evidence.md.
import Base

# Who takes the step out of a state: the runtime itself, or another party. The
# model keeps them distinct values, which is what lets a law forbid the second.
type Exit is Data:
  Runtime{}
  External{}

# The turn loop's states. Every constructor is a state the runtime reaches and
# leaves by itself. The real park (Baton 89661c1f) is a state whose exit is
# External; it has no constructor here.
type State is Data:
  Working{turn: Nat}
  Complete{}

def exit_of(s: State) -> Exit:
  match s:
    case Working{+turn}: Runtime{}
    case Complete{}: Runtime{}

# The law: every state's exit is the runtime's own.
law runtime_takes_every_exit:
  for s: State
  {exit_of(s) == Runtime{} : Exit}

def runtime_takes_every_exit(s):
  match s:
    case Working{+turn}: {==}
    case Complete{}: {==}
