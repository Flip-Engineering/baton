# CLAIM: for every size and every elapsed time the model decision is the specification's: it is
# authority and the observed resource state, and no magnitude and no clock turn waiting or admitted
# work into a refusal. The extension below states the admission inputs and the transitions the
# operator adopted on 2026-09-25: the decision's inputs derive from the authenticated authority and
# the measured resource, a completion, a cancellation and an external failure name their own
# disposition, a tick and an attempt timeout preserve the work disposition and the pending request.
# Scope at this level: the queue, the scheduler, the clock, the measurement and every host effect
# are supplied or absent; the runtime's own limits are not imported.
# Status: proposed revision of M-10 (revision 12a, 2026-09-25), from the operator rulings of
# 2026-09-13, 2026-09-20 and 2026-09-21 (#258, #541, #583) and the adopted statement. Not part of
# the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-no-ceiling.evidence.md.
import Base

type Decision is Data:
  Admitted{}
  Waiting{}
  Refused{}

# The specification. `authorized` is whether the caller holds the authority the work needs;
# `available` is whether the resource the work uses is available now, as observed.
def expected(authorized: Bool, available: Bool) -> Decision:
  match authorized:
    case False{}: Refused{}
    case True{}:
      match available:
        case True{}: Admitted{}
        case False{}: Waiting{}

# The runtime's decision. `size` stands for any magnitude of the work (bytes, nodes, items,
# tokens, spend) and `elapsed` for the time the work has waited or run.
def decide(size: Nat, elapsed: Nat, authorized: Bool, available: Bool) -> Decision:
  expected(authorized, available)

# The law: for every size and every elapsed time, the decision is the specification's.
law decision_ignores_magnitude_and_clock:
  for size: Nat
  for elapsed: Nat
  for authorized: Bool
  for available: Bool
  {decide(size, elapsed, authorized, available) == expected(authorized, available) : Decision}

# The proof splits size and elapsed at zero and one-or-more, and every authority and resource
# case, so a decision that reads either magnitude fails on a named case.
def decision_ignores_magnitude_and_clock(size, elapsed, authorized, available):
  match size:
    case 0n:
      match elapsed:
        case 0n:
          match authorized:
            case True{}:
              match available:
                case True{}: {==}
                case False{}: {==}
            case False{}:
              match available:
                case True{}: {==}
                case False{}: {==}
        case 1n+e:
          match authorized:
            case True{}:
              match available:
                case True{}: {==}
                case False{}: {==}
            case False{}:
              match available:
                case True{}: {==}
                case False{}: {==}
    case 1n+s:
      match elapsed:
        case 0n:
          match authorized:
            case True{}:
              match available:
                case True{}: {==}
                case False{}: {==}
            case False{}:
              match available:
                case True{}: {==}
                case False{}: {==}
        case 1n+e:
          match authorized:
            case True{}:
              match available:
                case True{}: {==}
                case False{}: {==}
            case False{}:
              match available:
                case True{}: {==}
                case False{}: {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("no-ceiling: the decision ignores magnitude and clock; law checked.")

def authorized_from(grant: Bool) -> Bool:
  grant

def available_from(measured: Bool) -> Bool:
  measured

def admitted(grant: Bool, measured: Bool, size: Nat, elapsed: Nat) -> Decision:
  decide(size, elapsed, authorized_from(grant), available_from(measured))

law admission_inputs_derive_from_authority_and_measurement:
  for grant: Bool
  for measured: Bool
  for size: Nat
  for elapsed: Nat
  {admitted(grant, measured, size, elapsed) == decide(0n, 0n, grant, measured) : Decision}

def admission_inputs_derive_from_authority_and_measurement(grant, measured, size, elapsed):
  {==}

type Disposition is Data:
  Pending{}
  Running{}
  Completed{}
  Cancelled{}
  Failed{id: Nat}

type Request is Data:
  Request{owner: Nat, owed: Nat, continuation: +List<Nat>}

type Work is Data:
  Work{disposition: Disposition, telemetry: Nat, retry: Nat, request: Request}

type WorkEvent is Data:
  Tick{}
  Completion{}
  Cancellation{}
  ExternalFailure{id: Nat}
  AttemptTimeout{}

def named_disposition(e: WorkEvent, current: Disposition) -> Disposition:
  match e:
    case Tick{}: current
    case Completion{}: Completed{}
    case Cancellation{}: Cancelled{}
    case ExternalFailure{+id}: Failed{id}
    case AttemptTimeout{}: current

def step(w: Work, e: WorkEvent) -> Work:
  match w:
    case Work{+disposition, +telemetry, +retry, +request}:
      Work{named_disposition(e, disposition), telemetry, retry, request}

def disposition_of(w: Work) -> Disposition:
  match w:
    case Work{+disposition, +telemetry, +retry, +request}: disposition

def request_of(w: Work) -> Request:
  match w:
    case Work{+disposition, +telemetry, +retry, +request}: request

law a_work_event_sets_the_disposition_it_names:
  for w: Work
  for e: WorkEvent
  {disposition_of(step(w, e)) == named_disposition(e, disposition_of(w)) : Disposition}

def a_work_event_sets_the_disposition_it_names(w, e):
  match w:
    case Work{+disposition, +telemetry, +retry, +request}:
      match e:
        case Tick{}: {==}
        case Completion{}: {==}
        case Cancellation{}: {==}
        case ExternalFailure{+id}: {==}
        case AttemptTimeout{}: {==}

law a_tick_preserves_the_work_disposition:
  for w: Work
  {disposition_of(step(w, Tick{})) == disposition_of(w) : Disposition}

def a_tick_preserves_the_work_disposition(w):
  match w:
    case Work{+disposition, +telemetry, +retry, +request}: {==}

law an_attempt_timeout_preserves_the_work_disposition:
  for w: Work
  {disposition_of(step(w, AttemptTimeout{})) == disposition_of(w) : Disposition}

def an_attempt_timeout_preserves_the_work_disposition(w):
  match w:
    case Work{+disposition, +telemetry, +retry, +request}: {==}

law pending_work_keeps_its_request_across_a_tick:
  for w: Work
  {request_of(step(w, Tick{})) == request_of(w) : Request}

def pending_work_keeps_its_request_across_a_tick(w):
  match w:
    case Work{+disposition, +telemetry, +retry, +request}: {==}

law pending_work_keeps_its_request_across_an_attempt_timeout:
  for w: Work
  {request_of(step(w, AttemptTimeout{})) == request_of(w) : Request}

def pending_work_keeps_its_request_across_an_attempt_timeout(w):
  match w:
    case Work{+disposition, +telemetry, +retry, +request}: {==}
