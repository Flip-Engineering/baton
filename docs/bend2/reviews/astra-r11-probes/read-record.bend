# CLAIM: a landing gate's decision is a function of two observed runs only - the change's and the
# target's - and it blocks exactly when a test fails with the change and does not fail on the
# target. A stored record (an expected-failure list, a converged declaration, a count or census
# pin) is a parameter the law quantifies over, so a gate whose decision depends on that record
# makes the law false.
# Status: proposed addition (revision 11, 2026-09-25), from the operator's ban on bookkeeping
# ledgers in place of function (AGENTS.md, #579, #580). Not part of the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-no-ledger.evidence.md.
import Base

# The observed outcome of one test in one run. `Absent{}` means the test does not exist in that
# run's tree: a test that is new with the change is absent on the target.
type Outcome is Data:
  Passed{}
  Failed{}
  Absent{}

# One test observed twice: with the change, and on the target.
type Observed is Data:
  Observed{change: Outcome, target: Outcome}

# The specification: the change breaks this test when it fails with the change and does not fail
# on the target.
def breaks(change: Outcome, target: Outcome) -> Bool:
  match change:
    case Passed{}: False{}
    case Absent{}: False{}
    case Failed{}:
      match target:
        case Failed{}: False{}
        case Passed{}: True{}
        case Absent{}: True{}

def breaks_observed(o: Observed) -> Bool:
  match o:
    case Observed{+change, +target}: breaks(change, target)

# The gate's decision for one test. `record` stands for any stored value a gate could be handed:
# a manifest entry, a pinned count, a converged flag. The gate reads only the observations.
def gate(record: Nat, change: Outcome, target: Outcome) -> Bool:
  match record:
    case 0n: breaks(change, target)
    case 1n+p: breaks(change, target)

def gate_observed(record: Nat, o: Observed) -> Bool:
  match o:
    case Observed{+change, +target}: gate(record, change, target)

def either(a: Bool, b: Bool) -> Bool:
  match a:
    case True{}: True{}
    case False{}: b

# The landing decision over every selected test.
def landing_blocks(+record: Nat, runs: List<Observed>) -> Bool:
  match runs:
    case []: False{}
    case h <> t: either(gate_observed(record, h), landing_blocks(record, t))

def any_breaks(runs: List<Observed>) -> Bool:
  match runs:
    case []: False{}
    case h <> t: either(breaks_observed(h), any_breaks(t))

# The law, per test: for every stored record and every pair of observations, the gate's decision
# is the specification's.
law gate_reads_only_observations:
  for record: Nat
  for change: Outcome
  for target: Outcome
  {gate(record, change, target) == breaks(change, target) : Bool}

# The proof splits every case, so a gate that reads the record fails on a named case.
def gate_reads_only_observations(record, change, target):
  match record:
    case 0n:
      match change:
        case Passed{}:
          match target:
            case Passed{}: {==}
            case Failed{}: {==}
            case Absent{}: {==}
        case Failed{}:
          match target:
            case Passed{}: {==}
            case Failed{}: {==}
            case Absent{}: {==}
        case Absent{}:
          match target:
            case Passed{}: {==}
            case Failed{}: {==}
            case Absent{}: {==}
    case 1n+p:
      match change:
        case Passed{}:
          match target:
            case Passed{}: {==}
            case Failed{}: {==}
            case Absent{}: {==}
        case Failed{}:
          match target:
            case Passed{}: {==}
            case Failed{}: {==}
            case Absent{}: {==}
        case Absent{}:
          match target:
            case Passed{}: {==}
            case Failed{}: {==}
            case Absent{}: {==}

# The law, per landing: for every stored record and every observed run, the landing blocks
# exactly when some test breaks.
law landing_blocks_iff_breaks:
  for +record: Nat
  for runs: List<Observed>
  {landing_blocks(record, runs) == any_breaks(runs) : Bool}

def landing_blocks_iff_breaks(record, runs):
  match record:
    case 0n:
      match runs:
        case []: {==}
        case h <> t:
          match h:
            case Observed{+change, +target}:
              match change:
                case Passed{}: landing_blocks_iff_breaks(0n, t)
                case Absent{}: landing_blocks_iff_breaks(0n, t)
                case Failed{}:
                  match target:
                    case Failed{}: landing_blocks_iff_breaks(0n, t)
                    case Passed{}: {==}
                    case Absent{}: {==}
    case 1n+p:
      match runs:
        case []: {==}
        case h <> t:
          match h:
            case Observed{+change, +target}:
              match change:
                case Passed{}: landing_blocks_iff_breaks(1n+p, t)
                case Absent{}: landing_blocks_iff_breaks(1n+p, t)
                case Failed{}:
                  match target:
                    case Failed{}: landing_blocks_iff_breaks(1n+p, t)
                    case Passed{}: {==}
                    case Absent{}: {==}

def main() -> Bool:
  landing_blocks(1n, [Observed{Failed{}, Passed{}}])
