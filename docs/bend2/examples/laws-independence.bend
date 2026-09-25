# CLAIM: for the same validated semantic request, authenticated authority, observed resources and
# external events, changing administrative annotations about work cannot change the runtime's
# selected checks, derived decision inputs, admission, refusal identity, required prerequisites,
# management permissions or continuation transitions. An administrative annotation is a record
# the agent maintains about its own work with no corresponding semantic effect: an
# expected-failure allowance, a convergence declaration, an incidental code census, an
# expected-red or expected-green status, a completion declaration. The runtime derives its
# decision inputs from the specified sources, never from those records. The same laws fix the
# positive behavior each domain must keep, so an implementation that satisfies independence by
# refusing everything fails them. This file is the model; ../laws.bend states the laws and
# laws-proof.bend discharges them.
# Status: adopted by the operator 2026-09-25 (G1 of the astra review), re-encoded from
# ../reviews/astra-law-review-r11-r12.md. G1 is a proposed application property, not part of the
# approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-independence.evidence.md.
import Base

# The records an agent maintains about its own work. Each field is a count of declarations with
# no corresponding semantic effect.
type Annotation is Data:
  Annotation{allowances: Nat, converged: Nat, census: Nat, status: Nat}

# The validated semantic request: the authenticated authority the caller holds and the resource
# state observed now.
type Request is Data:
  Request{authority: Bool, resources: Bool}

# The decision on the request.
type Admission is Data:
  Admitted{}
  Waiting{}
  Refused{}

# The checks the runtime selects.
type Check is Data:
  Build{}
  Gates{}
  Coverage{}

# The prerequisite the runtime requires before the work proceeds.
type Prereq is Data:
  NoAct{}
  Resource{}
  Authority{}
  Input{}

# The work states and the events that move them.
type WorkState is Data:
  Ready{}
  Running{}
  Stopped{}

type WorkEvent is Data:
  Tick{}
  TurnEnd{}
  Stop{}

# The empty annotation: every count zero.
def no_annotations() -> Annotation:
  Annotation{0n, 0n, 0n, 0n}

def authority_of(r: Request) -> Bool:
  match r:
    case Request{+authority, _}: authority

def resources_of(r: Request) -> Bool:
  match r:
    case Request{_, +resources}: resources

def member(+x: Nat, xs: +List<Nat>) -> Bool:
  match xs:
    case Nil{}: False{}
    case h <> t: Bool.or(Nat.is_eq(x, h), member(x, t))

# The specification's admission: valid authority with available resources admits, valid authority
# with short resources waits, and invalid authority refuses.
def expected(authority: Bool, resources: Bool) -> Admission:
  match authority:
    case False{}: Refused{}
    case True{}:
      match resources:
        case True{}: Admitted{}
        case False{}: Waiting{}

# The runtime's admission. `annotations` is a parameter every decision must ignore.
def admit(annotations: Annotation, +r: Request) -> Admission:
  expected(authority_of(r), resources_of(r))

# The refusal identity of an admission: zero when the work is admitted or waiting, the refusal's
# own code when it is refused.
def refusal_when(admission: Admission) -> Nat:
  match admission:
    case Admitted{}: 0n
    case Waiting{}: 0n
    case Refused{}: 1n

def refusal_identity(annotations: Annotation, r: Request) -> Nat:
  refusal_when(admit(annotations, r))

# The checks the runtime selects for the request.
def checks_when(authority: Bool) -> List<Check>:
  match authority:
    case False{}: Nil{}
    case True{}: [Build{}, Gates{}, Coverage{}]

def selected_checks(annotations: Annotation, r: Request) -> List<Check>:
  checks_when(authority_of(r))

# The prerequisite the runtime derives for the request.
def prerequisite_when(authority: Bool, resources: Bool) -> Prereq:
  match authority:
    case False{}: Authority{}
    case True{}:
      match resources:
        case True{}: NoAct{}
        case False{}: Resource{}

def prerequisites(annotations: Annotation, +r: Request) -> Prereq:
  prerequisite_when(authority_of(r), resources_of(r))

# The runtime's management permission over a target seat, derived from the relationship it holds.
def manages(annotations: Annotation, leads: +List<Nat>, target: Nat) -> Bool:
  member(target, leads)

# The continuation transition for a work state and an event.
def step(annotations: Annotation, state: WorkState, event: WorkEvent) -> WorkState:
  match event:
    case Tick{}: state
    case TurnEnd{}: state
    case Stop{}: Stopped{}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("independence: every decision is the same for every administrative annotation; the laws are checked in laws-proof.bend.")
