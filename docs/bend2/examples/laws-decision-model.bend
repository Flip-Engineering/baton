# CLAIM: this pure decision model dispatches a landing only to the remote the
# deployment declares, and refuses with the undeclared code when it declares none.
# The declaration is the only input, so no other value can become a target.
# The quantified obligations are in ../laws.bend.
# Scope: the decision only. The dispatch, the publish and their outcome are host
# effects and are not modelled here; see ../laws-trace.md.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-check.evidence.md.
import Base

type Declaration is Data:
  Declared{remote: Nat}
  Undeclared{}

type Outcome is Data:
  Publish{remote: Nat}
  Refuse{code: Nat}

# The code a real landing raises when the deployment declares no shared remote
# (integrate_publish_undeclared, #558). Modelled as an opaque constant.
def undeclared_code() -> Nat:
  1n

def decide(d: Declaration) -> Outcome:
  match d:
    case Declared{+remote}: Publish{remote}
    case Undeclared{}: Refuse{undeclared_code()}

# The target a publishing outcome carries; zero when the outcome refuses. A real
# refusal carries no target at all, so the derived zero is a model marker only.
def target_of(o: Outcome) -> Nat:
  match o:
    case Publish{+remote}: remote
    case Refuse{_}: 0n

def code_of(o: Outcome) -> Nat:
  match o:
    case Publish{_}: 0n
    case Refuse{+code}: code
