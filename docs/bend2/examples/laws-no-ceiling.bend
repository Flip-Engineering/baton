# CLAIM: the runtime's decision on requested work is derived from the authority the caller holds
# and from the resource state observed now. It is the same for every magnitude and every elapsed
# time. Work is admitted when its measured resources are available, retained pending while they
# are short, and refused only without valid authority. Administrative magnitude or elapsed-time
# bounds cannot reject, truncate, discard or terminalize that work. Every terminal transition is
# bound to an actual event: a tick preserves the work disposition, completion terminates,
# cancellation terminates, and a provider failure carries its observed cause. This file is the
# model; ../laws.bend states the laws and laws-proof.bend discharges them.
# Status: proposed revision of M-10 (revision 12a, 2026-09-25), re-encoded from the operator's
# adopted statements in ../reviews/astra-law-review-r11-r12.md. The operator rulings behind it are
# #258 (no budget hard stops), 2026-09-20 (no derivation check on a max limit), #541 (no caller
# deadline, queue timeout or wait ceiling on an intent) and #583 (the 90 s run-stop deadline).
# The removal of M-10's physical-bound exception is a new policy decision, not part of the
# approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-no-ceiling.evidence.md.
import Base

# The authority the caller holds, derived from its authenticated grant at the time of effect.
type Authority is Data:
  Valid{}
  Invalid{}

# The resource state observed now: whether the resources the work measures are available.
type Resources is Data:
  Available{}
  Short{}

# One request for work. `magnitude` stands for any magnitude of the work (bytes, nodes, items,
# tokens, spend) and `elapsed` for the time it has waited or run; neither is an input to the
# decision.
type Request is Data:
  Request{authority: Authority, resources: Resources, magnitude: Nat, elapsed: Nat}

# The decision on requested work.
type Admission is Data:
  Admitted{}
  Pending{}
  Refused{}

# The specification: valid authority with available resources admits, valid authority with short
# resources retains the work pending, and invalid authority refuses.
def expected(authority: Authority, resources: Resources) -> Admission:
  match authority:
    case Valid{}:
      match resources:
        case Available{}: Admitted{}
        case Short{}: Pending{}
    case Invalid{}: Refused{}

def authority_of(r: Request) -> Authority:
  match r:
    case Request{+authority, _, _, _}: authority

def resources_of(r: Request) -> Resources:
  match r:
    case Request{_, +resources, _, _}: resources

# The same request with the magnitude and the elapsed time cleared, every other input kept.
def cleared(r: Request) -> Request:
  match r:
    case Request{+authority, +resources, _, _}: Request{authority, resources, 0n, 0n}

# The runtime's decision. It derives its inputs from the request's authority and from the
# resource state observed now.
def admit(+r: Request) -> Admission:
  expected(authority_of(r), resources_of(r))

# The work states. A pending state carries its owner, the data it owes and its continuation, so a
# pending decision never loses the work it retains.
type Work is Data:
  Working{owner: Nat, owed: Nat, continuation: Nat}
  Completed{}
  Cancelled{}
  Failed{cause: Nat}

# The events a work state can receive. A tick is a scheduler or telemetry event with no work
# content. A provider failure carries the cause the provider or host observably reported.
type WorkEvent is Data:
  Tick{}
  Completion{}
  Cancellation{}
  ProviderFailure{cause: Nat}

def step(state: Work, event: WorkEvent) -> Work:
  match event:
    case Tick{}: state
    case Completion{}: Completed{}
    case Cancellation{}: Cancelled{}
    case ProviderFailure{+cause}: Failed{cause}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("no-ceiling: the decision is derived from authority and measured resources; the laws are checked in laws-proof.bend.")
