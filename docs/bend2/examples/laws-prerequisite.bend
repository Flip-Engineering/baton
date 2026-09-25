# CLAIM: for a valid authorized work request with its required semantic inputs, the runtime
# imposes no agent-maintained status, census, convergence or completion declaration as a
# prerequisite for admission or continued execution. The prerequisite is derived from the work's
# semantic state, so the declarations an agent maintains never enter it and an administrative
# record is never the enabler. A blocked continuation names the actual missing resource, the
# missing authority, the missing semantic input, or the explicit operator or orchestrator
# decision that enables it, and it waits on a party the runtime wakes (revision 10). When the
# prerequisite is satisfied the runtime admits the work with no separate administrative
# acknowledgment. This file is the model; ../laws.bend states the laws and laws-proof.bend
# discharges them.
# Status: adopted by the operator 2026-09-25 (G2 in its refined form), re-encoded from
# ../reviews/astra-law-review-r11-r12.md. The refinement admits waits on semantic input and on a
# woken orchestrator decision, consistent with revision 10. G2 is a proposed application
# property, not part of the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-prerequisite.evidence.md.
import Base
import ./laws-no-park.bend as NoPark

# The work's semantic state, derived from the request and the host.
type Semantic is Data:
  Ready{}
  NeedsResource{}
  NeedsAuthority{}
  NeedsInput{}
  NeedsOrchestrator{}

# The state the runtime sees. `maintained` counts the administrative declarations the agent
# keeps about this work; no prerequisite may be derived from it.
type State is Data:
  State{semantic: Semantic, maintained: Nat}

# The prerequisite a blocked continuation names. `Administrative{}` is the forbidden case: a
# declaration with no corresponding semantic effect.
type Enabler is Data:
  Nothing{}
  Resource{}
  Authority{}
  SemanticInput{}
  OrchestratorDecision{}
  Administrative{record: Nat}

# The progress decision: admitted, or blocked on the named enabler.
type Progress is Data:
  Admitted{}
  Blocked{enabler: Enabler}

def semantic_of(s: State) -> Semantic:
  match s:
    case State{+semantic, _}: semantic

# The prerequisite the specification derives from the semantic state. An administrative
# declaration is not in this codomain.
def expected_enabler(semantic: Semantic) -> Enabler:
  match semantic:
    case Ready{}: Nothing{}
    case NeedsResource{}: Resource{}
    case NeedsAuthority{}: Authority{}
    case NeedsInput{}: SemanticInput{}
    case NeedsOrchestrator{}: OrchestratorDecision{}

# The runtime's prerequisite. It is derived from the semantic state and from nothing else.
def enabler_of(s: State) -> Enabler:
  expected_enabler(semantic_of(s))

# Whether an enabler names an actual enabling effect. `Administrative{}` does not.
def legitimate(e: Enabler) -> Bool:
  match e:
    case Administrative{+record}: False{}
    case Nothing{}: True{}
    case Resource{}: True{}
    case Authority{}: True{}
    case SemanticInput{}: True{}
    case OrchestratorDecision{}: True{}

# Whether the enabler's effect is now in place. No administrative declaration ever satisfies it,
# whatever label it carries.
def satisfied(e: Enabler, ready: Bool) -> Bool:
  match e:
    case Administrative{+record}: False{}
    case Nothing{}: True{}
    case Resource{}: ready
    case Authority{}: ready
    case SemanticInput{}: ready
    case OrchestratorDecision{}: ready

# The party the runtime wakes when the work is blocked on this enabler.
def waiter(e: Enabler) -> NoPark.Party:
  match e:
    case OrchestratorDecision{}: NoPark.Orchestrator{}
    case Administrative{+record}: NoPark.Unwoken{}
    case Nothing{}: NoPark.Runtime{}
    case Resource{}: NoPark.Runtime{}
    case Authority{}: NoPark.Runtime{}
    case SemanticInput{}: NoPark.Runtime{}

def progress_when(+e: Enabler, +ready: Bool, satisfied_now: Bool) -> Progress:
  match satisfied_now:
    case True{}: Admitted{}
    case False{}: Blocked{e}

# The runtime's progress decision, derived from the same prerequisite.
def progress(+s: State, +ready: Bool) -> Progress:
  progress_when(enabler_of(s), ready, satisfied(enabler_of(s), ready))

def admitted(p: Progress) -> Bool:
  match p:
    case Admitted{}: True{}
    case Blocked{+enabler}: False{}

def blocked_enabler(p: Progress) -> Enabler:
  match p:
    case Admitted{}: Nothing{}
    case Blocked{+enabler}: enabler

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("prerequisite: every blocked continuation names an actual enabler and a woken party; the laws are checked in laws-proof.bend.")
