# CLAIM: for the same validated semantic request, authenticated authority, observed
# resources and external events, changing administrative annotations about work cannot
# change the runtime's derived plan - its selected checks, admission, refusal, management
# permission, required prerequisites or continuation - and the plan derives those inputs
# from the specified sources. An always-refusing plan is rejected by the positive law.
# Status: proposed encoding of the adopted G1 statement (2026-09-25) from the astra law
# review of revisions 11 and 12. Not part of the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-annotation-independence.evidence.md.
import Base

# One work act the runtime decides on.
type Act is Data:
  Landing{}
  Admission{}
  Recruit{}
  Check{}
  TurnEnd{}

# The administrative annotations about work: expected-failure allowances, convergence
# declarations, incidental code censuses and status declarations with no semantic effect.
type Annotation is Data:
  Annotation{expected_failures: Nat, converged: Nat, census: Nat, status: Nat}

# The validated request, the authenticated authority and the observed resources: the
# decision inputs the runtime derives from their specified sources.
type Observed is Data:
  Observed{request: Nat, authorized: Bool, available: Bool}

# What the runtime derives for one act.
type Plan is Data:
  Plan{checks: +List<Nat>, admits: Bool, refuses: Bool, permits: Bool, needs: +List<Nat>, continues: Bool}

# The administrative allowance the runtime reads. The correct runtime reads none: an
# annotation cannot admit or refuse work on its own, so the plan is the same for every
# annotation.
def annotation_allows(annotation: Annotation) -> Bool:
  True{}

# The prerequisites the request actually lacks.
def needs_of(request: Nat) -> +List<Nat>:
  match request:
    case 0n: []
    case 1n+r: [r]

# The decision inputs of one observation, each derived from its specified source.
def request_of(observed: Observed) -> Nat:
  match observed:
    case Observed{+request, +authorized, +available}: request

def authorized_of(observed: Observed) -> Bool:
  match observed:
    case Observed{+request, +authorized, +available}: authorized

def available_of(observed: Observed) -> Bool:
  match observed:
    case Observed{+request, +authorized, +available}: available

def derive(act: Act, +observed: Observed, annotation: Annotation) -> Plan:
  match act:
    case Landing{}: Plan{[request_of(observed)], Bool.and(authorized_of(observed), annotation_allows(annotation)), Bool.not(authorized_of(observed)), authorized_of(observed), needs_of(request_of(observed)), available_of(observed)}
    case Admission{}: Plan{[request_of(observed)], Bool.and(authorized_of(observed), annotation_allows(annotation)), Bool.not(authorized_of(observed)), authorized_of(observed), needs_of(request_of(observed)), available_of(observed)}
    case Recruit{}: Plan{[request_of(observed)], Bool.and(authorized_of(observed), annotation_allows(annotation)), Bool.not(authorized_of(observed)), authorized_of(observed), needs_of(request_of(observed)), available_of(observed)}
    case Check{}: Plan{[request_of(observed)], Bool.and(authorized_of(observed), annotation_allows(annotation)), Bool.not(authorized_of(observed)), authorized_of(observed), needs_of(request_of(observed)), available_of(observed)}
    case TurnEnd{}: Plan{[request_of(observed)], True{}, False{}, True{}, needs_of(request_of(observed)), True{}}

def plan_admits(p: Plan) -> Bool:
  match p:
    case Plan{+checks, +admits, +refuses, +permits, +needs, +continues}: admits

# The observation the runtime reads. It is the specified observation itself.
def observed_from(annotation: Annotation, observed: Observed) -> Observed:
  observed

def decide(act: Act, +annotation: Annotation, observed: Observed) -> Plan:
  derive(act, observed_from(annotation, observed), annotation)

# The law: for the same observation, the plan is the same for every annotation.
law annotations_do_not_change_the_plan:
  for act: Act
  for observed: Observed
  for annotation: Annotation
  {derive(act, observed, annotation) == decide(act, Annotation{0n, 0n, 0n, 0n}, observed) : Plan}

def annotations_do_not_change_the_plan(act, observed, annotation):
  match act:
    case Landing{}: {==}
    case Admission{}: {==}
    case Recruit{}: {==}
    case Check{}: {==}
    case TurnEnd{}: {==}

# The positive behavior law each domain keeps: an authorized request whose resource is
# available is admitted. An always-refusing runtime fails this.
law an_authorized_available_request_is_admitted:
  for act: Act
  for annotation: Annotation
  {plan_admits(derive(act, Observed{0n, True{}, True{}}, annotation)) == True{} : Bool}

def an_authorized_available_request_is_admitted(act, annotation):
  match act:
    case Landing{}: {==}
    case Admission{}: {==}
    case Recruit{}: {==}
    case Check{}: {==}
    case TurnEnd{}: {==}

# The provenance law: the observation is not computed from the annotation.
law the_observation_is_not_derived_from_the_annotation:
  for annotation: Annotation
  for observed: Observed
  {observed_from(annotation, observed) == observed : Observed}

def the_observation_is_not_derived_from_the_annotation(annotation, observed):
  {==}

# The composition law: the decision reads the specified source.
law the_decision_reads_the_specified_source:
  for act: Act
  for annotation: Annotation
  for observed: Observed
  {decide(act, annotation, observed) == derive(act, observed, annotation) : Plan}

def the_decision_reads_the_specified_source(act, annotation, observed):
  {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("annotation-independence: the plan ignores every annotation; four laws checked.")
