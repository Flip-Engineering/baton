# CLAIM: for fixed supplied outcomes and a fixed supplied selection, the model gate equals the
# specification `breaks` for every explicit record argument, and the landing is the OR of those
# comparisons. Provenance, completeness, test policy and the application composition remain open.
# The extension below states the comparison the operator adopted on 2026-09-25: a judged landing
# blocks when a failure with the change has no matching failure identity on the target, target
# absence and an unjudged target supply no matching failure, an unjudged change cannot authorize
# landing, and every selected invocation is accounted for. That comparison has the same model-level
# scope: the observation values and the failure key are supplied.
# Status: proposed addition (revision 11, 2026-09-25), from the operator's ban on bookkeeping
# ledgers in place of function (AGENTS.md, #579, #580) and the adopted comparison. Not part of the
# approved set.
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
  breaks(change, target)

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
  match runs:
    case []: {==}
    case h <> t:
      match h:
        case Observed{+change, +target}:
          match change:
            case Passed{}: landing_blocks_iff_breaks(record, t)
            case Absent{}: landing_blocks_iff_breaks(record, t)
            case Failed{}:
              match target:
                case Failed{}: landing_blocks_iff_breaks(record, t)
                case Passed{}: {==}
                case Absent{}: {==}

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print("no-ledger: the gate reads only observations; both laws checked.")

type FailureKind is Data:
  Assertion{}
  Hang{}
  Leak{}
  Crash{}

type FailureId is Data:
  FailureId{file: Nat, test: Nat, kind: FailureKind, code: Nat}

type Verdict is Data:
  Cleared{}
  Broke{id: FailureId}
  NotRun{}
  NoVerdict{}

type Invocation is Data:
  Invocation{change: Verdict, target: Verdict}

def kind_eq(a: FailureKind, b: FailureKind) -> Bool:
  match a:
    case Assertion{}:
      match b:
        case Assertion{}: True{}
        case Hang{}: False{}
        case Leak{}: False{}
        case Crash{}: False{}
    case Hang{}:
      match b:
        case Assertion{}: False{}
        case Hang{}: True{}
        case Leak{}: False{}
        case Crash{}: False{}
    case Leak{}:
      match b:
        case Assertion{}: False{}
        case Hang{}: False{}
        case Leak{}: True{}
        case Crash{}: False{}
    case Crash{}:
      match b:
        case Assertion{}: False{}
        case Hang{}: False{}
        case Leak{}: False{}
        case Crash{}: True{}

def id_eq(a: FailureId, b: FailureId) -> Bool:
  match a:
    case FailureId{+af, +at, +ak, +ac}:
      match b:
        case FailureId{+bf, +bt, +bk, +bc}:
          Bool.and(Nat.is_eq(af, bf), Bool.and(Nat.is_eq(at, bt), Bool.and(Nat.is_eq(ac, bc), kind_eq(ak, bk))))

def not_bool(b: Bool) -> Bool:
  match b:
    case True{}: False{}
    case False{}: True{}

law nat_self_match:
  for n: Nat
  {True{} == Nat.is_eq(n, n) : Bool}

def nat_self_match(n):
  match n:
    case 0n: {==}
    case 1n+p:
      %nat_self_match(p) : {True{} == _ : Bool}
      {==}

law kind_self_match:
  for k: FailureKind
  {True{} == kind_eq(k, k) : Bool}

def kind_self_match(k):
  match k:
    case Assertion{}: {==}
    case Hang{}: {==}
    case Leak{}: {==}
    case Crash{}: {==}

law id_self_match:
  for id: FailureId
  {True{} == id_eq(id, id) : Bool}

def id_self_match(id):
  match id:
    case FailureId{+f, +t, +k, +c}:
      %nat_self_match(f) : {True{} == Bool.and(_, Bool.and(Nat.is_eq(t, t), Bool.and(Nat.is_eq(c, c), kind_eq(k, k)))) : Bool}
      %nat_self_match(t) : {True{} == Bool.and(_, Bool.and(Nat.is_eq(c, c), kind_eq(k, k))) : Bool}
      %nat_self_match(c) : {True{} == Bool.and(_, kind_eq(k, k)) : Bool}
      %kind_self_match(k) : {True{} == _ : Bool}
      {==}

law a_different_failure_kind_is_a_different_identity:
  for k: FailureKind
  {id_eq(FailureId{0n, 0n, Assertion{}, 0n}, FailureId{0n, 0n, k, 0n}) == kind_eq(Assertion{}, k) : Bool}

def a_different_failure_kind_is_a_different_identity(k):
  {==}

law a_different_file_is_a_different_identity:
  for n: Nat
  {id_eq(FailureId{0n, 0n, Assertion{}, 0n}, FailureId{1n+n, 0n, Assertion{}, 0n}) == False{} : Bool}

def a_different_file_is_a_different_identity(n):
  {==}

law a_different_code_is_a_different_identity:
  for n: Nat
  {id_eq(FailureId{0n, 0n, Assertion{}, 0n}, FailureId{0n, 0n, Assertion{}, 1n+n}) == False{} : Bool}

def a_different_code_is_a_different_identity(n):
  {==}

def invocation_breaks(change: Verdict, target: Verdict) -> Bool:
  match change:
    case Cleared{}: False{}
    case NotRun{}: False{}
    case NoVerdict{}: True{}
    case Broke{+c}:
      match target:
        case Cleared{}: True{}
        case NotRun{}: True{}
        case NoVerdict{}: True{}
        case Broke{+t}: not_bool(id_eq(c, t))

def breaks_invocation(i: Invocation) -> Bool:
  match i:
    case Invocation{+change, +target}: invocation_breaks(change, target)

def any_invocation_breaks(invocations: List<Invocation>) -> Bool:
  match invocations:
    case []: False{}
    case h <> t: either(breaks_invocation(h), any_invocation_breaks(t))

def judged_landing(record: Nat, invocations: List<Invocation>) -> Bool:
  match invocations:
    case []: False{}
    case h <> t: either(breaks_invocation(h), judged_landing(record, t))

def selected(record: Nat, invocations: List<Invocation>) -> List<Invocation>:
  invocations

def accounted(invocations: List<Invocation>) -> List<Invocation>:
  match invocations:
    case []: []
    case h <> t: h <> accounted(t)

def target_verdict(record: Nat, observed: Verdict) -> Verdict:
  observed

def count(invocations: List<Invocation>) -> Nat:
  match invocations:
    case []: 0n
    case h <> t: (1n+count(t) : Nat)

law passing_change_does_not_block:
  for target: Verdict
  {invocation_breaks(Cleared{}, target) == False{} : Bool}

def passing_change_does_not_block(target):
  {==}

law unjudged_change_cannot_authorize_landing:
  for target: Verdict
  {invocation_breaks(NoVerdict{}, target) == True{} : Bool}

def unjudged_change_cannot_authorize_landing(target):
  {==}

law target_absence_contributes_no_matching_failure:
  for id: FailureId
  {invocation_breaks(Broke{id}, NotRun{}) == True{} : Bool}

def target_absence_contributes_no_matching_failure(id):
  {==}

law unjudged_target_supplies_no_matching_failure:
  for id: FailureId
  {invocation_breaks(Broke{id}, NoVerdict{}) == True{} : Bool}

def unjudged_target_supplies_no_matching_failure(id):
  {==}

law a_matching_failure_identity_does_not_block:
  for id: FailureId
  {invocation_breaks(Broke{id}, Broke{id}) == False{} : Bool}

def a_matching_failure_identity_does_not_block(id):
  %id_self_match(id) : {not_bool(_) == False{} : Bool}
  {==}

law judged_landing_blocks_iff_a_selected_invocation_breaks:
  for record: Nat
  for invocations: List<Invocation>
  {judged_landing(record, selected(record, invocations)) == any_invocation_breaks(invocations) : Bool}

def judged_landing_blocks_iff_a_selected_invocation_breaks(record, invocations):
  match invocations:
    case []: {==}
    case h <> t:
      match h:
        case Invocation{+change, +target}:
          match change:
            case Cleared{}: judged_landing_blocks_iff_a_selected_invocation_breaks(record, t)
            case NotRun{}: judged_landing_blocks_iff_a_selected_invocation_breaks(record, t)
            case NoVerdict{}: {==}
            case Broke{+c}:
              match target:
                case Cleared{}: {==}
                case NotRun{}: {==}
                case NoVerdict{}: {==}
                case Broke{+t2}:
                  Equal.cong(Bool, Bool, b => either(not_bool(id_eq(c, t2)), b), judged_landing(record, t), any_invocation_breaks(t), judged_landing_blocks_iff_a_selected_invocation_breaks(record, t))

# The law: a different failure identity on the target matches nothing, so it blocks.
law a_different_failure_kind_blocks:
  for k: FailureKind
  {invocation_breaks(Broke{FailureId{0n, 0n, Assertion{}, 0n}}, Broke{FailureId{0n, 0n, k, 0n}}) == not_bool(kind_eq(Assertion{}, k)) : Bool}

def a_different_failure_kind_blocks(k):
  {==}

law selection_is_the_changes_selected_set:
  for record: Nat
  for invocations: List<Invocation>
  {selected(record, invocations) == invocations : List<Invocation>}

def selection_is_the_changes_selected_set(record, invocations):
  {==}

law every_selected_invocation_is_accounted:
  for invocations: List<Invocation>
  {count(accounted(invocations)) == count(invocations) : Nat}

def every_selected_invocation_is_accounted(invocations):
  match invocations:
    case []: {==}
    case h <> t:
      %every_selected_invocation_is_accounted(t) : {1n+count(accounted(t)) == 1n+_ : Nat}
      {==}

law target_verdict_is_the_observed_run:
  for record: Nat
  for observed: Verdict
  {target_verdict(record, observed) == observed : Verdict}

def target_verdict_is_the_observed_run(record, observed):
  {==}
