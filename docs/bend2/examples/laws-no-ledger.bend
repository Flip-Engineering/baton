# CLAIM: a landing gate's decision for one selected invocation is the adopted comparison policy
# over the two judged runs. A failure with the change blocks when it has no matching failure
# identity on the target; a target that is absent or unjudged supplies no matching failure; an
# unjudged change cannot authorize landing. A stored record (an expected-failure allowance, a
# convergence declaration, a count or census pin, a status declaration) is a parameter the gate
# must not read. This file is the model; ../laws.bend states the laws and laws-proof.bend
# discharges them.
# Status: proposed revision 11 (2026-09-25), re-encoded from the operator's adopted statements in
# ../reviews/astra-law-review-r11-r12.md. The operator adopted the comparison policy on
# 2026-09-25; the entry remains a proposed addition to the approved set.
# Reference: ../reference/README.md, bend 2.0.25, a4952426.
# Evidence: laws-no-ledger.evidence.md.
import Base

# The identity of a failure: the file, the test, the failure kind and the specified stable
# semantic code. Variable paths and timings stay in diagnostics and carry no identity.
type Identity is Data:
  Identity{file: Nat, test: Nat, kind: Nat, code: Nat}

# One invocation's outcome in one run. `Absent{}` means the invocation does not exist in that
# run's tree: an invocation new with the change is absent on the target. `Unjudged{}` means the
# run produced no verdict for it.
type Outcome is Data:
  Passed{}
  Failed{failure: Identity}
  Absent{}
  Unjudged{}

# One selected invocation, observed twice: with the change and on the target.
type Observed is Data:
  Observed{change: Outcome, target: Outcome}

def same_identity(a: Identity, b: Identity) -> Bool:
  match a b:
    case Identity{+af, +at, +ak, +ac} Identity{+bf, +bt, +bk, +bc}:
      Bool.and(Nat.is_eq(af, bf),
        Bool.and(Nat.is_eq(at, bt),
          Bool.and(Nat.is_eq(ak, bk), Nat.is_eq(ac, bc))))

# Whether the target outcome supplies a matching failure identity for `f`. A passed, absent or
# unjudged target contributes no matching failure.
def matches(f: Identity, target: Outcome) -> Bool:
  match target:
    case Failed{+g}: same_identity(f, g)
    case Passed{}: False{}
    case Absent{}: False{}
    case Unjudged{}: False{}

# The adopted comparison policy for one selected invocation: whether the landing must block
# because of it. A change that passed or is absent contributes no failure.
def blocks(change: Outcome, target: Outcome) -> Bool:
  match change:
    case Failed{+f}: Bool.not(matches(f, target))
    case Passed{}: False{}
    case Absent{}: False{}
    case Unjudged{}: True{}

# The gate's decision for one selected invocation. `ledger` stands for any stored value a gate
# could be handed: a manifest entry, a pinned count, a converged flag, a status declaration.
def gate(ledger: Nat, change: Outcome, target: Outcome) -> Bool:
  blocks(change, target)


def change_of(o: Observed) -> Outcome:
  match o:
    case Observed{+change, _}: change

def target_of(o: Observed) -> Outcome:
  match o:
    case Observed{_, +target}: target

def gate_observed(ledger: Nat, +o: Observed) -> Bool:
  gate(ledger, change_of(o), target_of(o))

def blocks_observed(+o: Observed) -> Bool:
  blocks(change_of(o), target_of(o))

# The landing decision over every selected invocation.
def landing_blocks(+ledger: Nat, runs: List<Observed>) -> Bool:
  match runs:
    case Nil{}: False{}
    case h <> t: Bool.or(gate_observed(ledger, h), landing_blocks(ledger, t))

def any_blocks(runs: List<Observed>) -> Bool:
  match runs:
    case Nil{}: False{}
    case h <> t: Bool.or(blocks_observed(h), any_blocks(t))

# One decision per selected invocation, so the landing accounts for every invocation it selected.
def report(+ledger: Nat, runs: List<Observed>) -> List<Bool>:
  match runs:
    case Nil{}: Nil{}
    case h <> t: gate_observed(ledger, h) <> report(ledger, t)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("no-ledger: the gate reads only observations; the laws are checked in laws-proof.bend.")
