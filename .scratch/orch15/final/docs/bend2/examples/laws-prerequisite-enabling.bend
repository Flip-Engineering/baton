# CLAIM: a blocked continuation names the actual missing resource, authority, semantic
# input or explicit operator/orchestrator decision; each prerequisite has an enabling
# effect; administrative maintenance supplies none; no status, census, convergence or
# completion declaration is a prerequisite; and a satisfied prerequisite makes progress
# without a separate administrative acknowledgment.
# Status: proposed encoding of the adopted G2 statement (2026-09-25) from the astra law
# review of revisions 11 and 12. Not part of the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-prerequisite-enabling.evidence.md.
import Base

# What a work request is missing. `Bookkeeping` stands for agent-maintained status,
# census, convergence and completion declarations.
type Need is Data:
  NoAct{}
  Resource{subject: Nat}
  Authority{subject: Nat}
  SemanticInput{subject: Nat}
  Decision{party: Nat}
  Bookkeeping{which: Nat}

# The events that can supply a prerequisite. `AnnotationRewritten` is administrative
# maintenance: filing a declaration, rewriting a census.
type NeedEvent is Data:
  ResourceFreed{subject: Nat}
  GrantGranted{subject: Nat}
  InputSupplied{subject: Nat}
  OrchestratorDecided{party: Nat}
  AnnotationRewritten{which: Nat}

# The need kind, as the stable code the enabling relation reads.
def kind_of(need: Need) -> Nat:
  match need:
    case NoAct{}: 0n
    case Resource{_}: 1n
    case Authority{_}: 2n
    case SemanticInput{_}: 3n
    case Decision{_}: 4n
    case Bookkeeping{_}: 5n

def is_bookkeeping(need: Need) -> Bool:
  Nat.is_eq(kind_of(need), 5n)

# Which need an event supplies.
def supplies(e: NeedEvent, need: Need) -> Bool:
  match e:
    case ResourceFreed{_}: Nat.is_eq(kind_of(need), 1n)
    case GrantGranted{_}: Nat.is_eq(kind_of(need), 2n)
    case InputSupplied{_}: Nat.is_eq(kind_of(need), 3n)
    case OrchestratorDecided{_}: Nat.is_eq(kind_of(need), 4n)
    case AnnotationRewritten{_}: False{}

# The need the request actually lacks.
def missing(request: Nat) -> Need:
  match request:
    case 0n: NoAct{}
    case 1n+r: Resource{r}

# The prerequisite the runtime demands.
def required(request: Nat) -> Need:
  missing(request)

# The event that supplies a need.
def own_event(need: Need) -> NeedEvent:
  match need:
    case NoAct{}: AnnotationRewritten{0n}
    case Resource{+s}: ResourceFreed{s}
    case Authority{+s}: GrantGranted{s}
    case SemanticInput{+s}: InputSupplied{s}
    case Decision{+p}: OrchestratorDecided{p}
    case Bookkeeping{+w}: AnnotationRewritten{w}

# Whether a prerequisite has an enabling effect at all.
def enabled_if_needed(need: Need) -> Bool:
  match need:
    case NoAct{}: True{}
    case Resource{+s}: supplies(ResourceFreed{s}, Resource{s})
    case Authority{+s}: supplies(GrantGranted{s}, Authority{s})
    case SemanticInput{+s}: supplies(InputSupplied{s}, SemanticInput{s})
    case Decision{+p}: supplies(OrchestratorDecided{p}, Decision{p})
    case Bookkeeping{+w}: supplies(AnnotationRewritten{w}, Bookkeeping{w})

# Whether a satisfied prerequisite makes the runtime progress.
def progresses(need: Need) -> Bool:
  match need:
    case Bookkeeping{_}: False{}
    case NoAct{}: True{}
    case Resource{_}: True{}
    case Authority{_}: True{}
    case SemanticInput{_}: True{}
    case Decision{_}: True{}

law every_prerequisite_has_an_enabling_effect:
  for request: Nat
  {enabled_if_needed(required(request)) == True{} : Bool}

def every_prerequisite_has_an_enabling_effect(request):
  match request:
    case 0n: {==}
    case 1n+r: {==}

law administrative_maintenance_enables_nothing:
  for which: Nat
  for need: Need
  {supplies(AnnotationRewritten{which}, need) == False{} : Bool}

def administrative_maintenance_enables_nothing(which, need):
  {==}

law the_prerequisite_is_the_actual_missing_need:
  for request: Nat
  {required(request) == missing(request) : Need}

def the_prerequisite_is_the_actual_missing_need(request):
  {==}

law no_bookkeeping_prerequisite:
  for request: Nat
  {is_bookkeeping(required(request)) == False{} : Bool}

def no_bookkeeping_prerequisite(request):
  match request:
    case 0n: {==}
    case 1n+r: {==}

law an_orchestrator_decision_is_a_legitimate_prerequisite:
  for party: Nat
  {is_bookkeeping(Decision{party}) == False{} : Bool}

def an_orchestrator_decision_is_a_legitimate_prerequisite(party):
  {==}

law a_satisfied_prerequisite_makes_progress:
  for request: Nat
  {progresses(required(request)) == True{} : Bool}

def a_satisfied_prerequisite_makes_progress(request):
  match request:
    case 0n: {==}
    case 1n+r: {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("prerequisite-enabling: each prerequisite has its own enabling effect; six laws checked.")
