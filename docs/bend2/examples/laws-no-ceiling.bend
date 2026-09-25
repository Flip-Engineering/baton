# CLAIM: the runtime's decision on requested work is a function of authority and of the resource
# state observed now, and it is the same for every size, count, spend and elapsed time. A work
# item is admitted, or waits while an observed resource is short, or is refused for lack of
# authority. No magnitude and no clock can turn waiting or admitted work into a refusal, whether
# the bound is a bare constant or one derived from a physical resource.
# Status: proposed revision of M-10 (revision 12a, 2026-09-25), from the operator rulings of
# 2026-09-13, 2026-09-20 and 2026-09-21 (#258, #541, #583). Not part of the approved set.
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
