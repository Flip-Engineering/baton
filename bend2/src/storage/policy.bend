# Storage classification, preservation and preview data for issue #912.
#
# The caller declares the storage class from its layout table. This module
# validates that declaration against observed facts, derives the first
# preservation reason, and renders the preview and receipt data the product
# surface exposes. Timestamps are absent from every input.
# Preservation order is fixed so a receipt reason is reproducible: database
# path, owner, transient owner-execution gate, lease, process, runtime input,
# dirty worktree, unpublished commits, live ref, pending attempt, class. The
# first present or unknown fact wins.

import Base
import ./types.bend as T
import ../git/text.bend as Tx
import ../json/canonical.bend as J

def class_name(+c: T.StorageClass) -> String:
  match c:
    case T.Scratch{}: "scratch"
    case T.BuildOutput{}: "build-output"
    case T.Export{}: "export"
    case T.Checkout{}: "checkout"
    case T.SharedImmutable{}: "shared-immutable"
    case T.GitObject{}: "git-object"
    case T.LogEvidence{}: "log-evidence"
    case T.StagingSource{}: "staging-source"
    case T.StagingSourceReleased{}: "staging-source-released"
    case T.Unclassified{}: "unclassified"

# The layout table's marker names. An unrecognised marker is Unclassified and
# therefore preserved.
def classify(+marker: String) -> T.StorageClass:
  Bool.pick(T.StorageClass, String.eq(marker, "scratch"), T.Scratch{},
  Bool.pick(T.StorageClass, String.eq(marker, "build-output"), T.BuildOutput{},
  Bool.pick(T.StorageClass, String.eq(marker, "export"), T.Export{},
  Bool.pick(T.StorageClass, String.eq(marker, "checkout"), T.Checkout{},
  Bool.pick(T.StorageClass, String.eq(marker, "shared-immutable"), T.SharedImmutable{},
  Bool.pick(T.StorageClass, String.eq(marker, "git-object"), T.GitObject{},
  Bool.pick(T.StorageClass, String.eq(marker, "log-evidence"), T.LogEvidence{},
  Bool.pick(T.StorageClass, String.eq(marker, "staging-source"), T.StagingSource{},
  Bool.pick(T.StorageClass, String.eq(marker, "staging-source-released"), T.StagingSourceReleased{},
    T.Unclassified{})))))))))

def owner_reason_of(+expected: String, +owner: T.Owner) -> String:
  match owner:
    case T.OwnerMatches{identity}: Bool.pick(String, String.eq(expected, identity), "", "owner-mismatch")
    case T.OwnerDiffers{identity}: "owner-mismatch"
    case T.OwnerMissing{}: "owner-missing"
    case T.OwnerUnknown{}: "owner-unknown"

def owner_reason(+expected: String, +owner: T.Owner) -> String:
  Bool.pick(String, String.is_empty(expected), "owner-missing", owner_reason_of(expected, owner))

def presence_reason(+fact: T.Presence, +live: String, +unknown: String) -> String:
  match fact:
    case T.Present{detail}: live
    case T.Absent{}: ""
    case T.Unknown{}: unknown

def first_reason(reasons: List<String>) -> String:
  match reasons:
    case Nil{}: ""
    case Con{+head, tail}:
      Bool.pick(String, String.is_empty(head), first_reason(tail), head)

def transient_class(+c: T.StorageClass) -> Bool:
  T.is_transient(c)

def class_reason(+c: T.StorageClass) -> String:
  match c:
    case T.Unclassified{}: "unclassified"
    case T.Scratch{}: ""
    case T.BuildOutput{}: ""
    case T.Export{}: ""
    case T.Checkout{}: ""
    case T.SharedImmutable{}: ""
    case T.GitObject{}: "git-object-report-only"
    case T.LogEvidence{}: ""
    case T.StagingSource{}: "staging-source-release-required"
    case T.StagingSourceReleased{}: ""

# A transient candidate is admitted only after its owning session has no
# non-exited execution. Unknown execution evidence preserves the candidate,
# and the fact is ignored for classes outside the transient set.
def execution_reason(+cls: T.StorageClass, +execution: T.Presence) -> String:
  Bool.pick(String, transient_class(cls), presence_reason(execution, "execution-live", "execution-unknown"), "")

# The staging-source-released class records the operator's explicit ownership
# release decision. The staging-source class remains report-only until that
# decision is recorded.
def ownership_reason(+cls: T.StorageClass, +expected: String, +owner: T.Owner) -> String:
  match cls:
    case T.StagingSourceReleased{}: ""
    case T.StagingSource{}: "staging-source-release-required"
    case other: owner_reason(expected, owner)

def preserve_reason(+cls: T.StorageClass, +owner: String, +facts: T.Facts) -> String:
  match facts:
    case T.Facts{o, execution, database, lease, process, dirty, unpublished, runtime_input, ref, pending_attempt}:
      first_reason([
        presence_reason(database, "database-path", "database-path-unknown"),
        ownership_reason(cls, owner, o),
        execution_reason(cls, execution),
        presence_reason(lease, "lease-live", "lease-unknown"),
        presence_reason(process, "process-live", "process-unknown"),
        presence_reason(runtime_input, "runtime-input-live", "runtime-input-unknown"),
        presence_reason(dirty, "worktree-dirty", "worktree-unknown"),
        presence_reason(unpublished, "unpublished-commits", "publication-unknown"),
        presence_reason(ref, "ref-live", "ref-unknown"),
        presence_reason(pending_attempt, "pending-attempt", "attempt-unknown"),
        class_reason(cls)
      ])

def remove_reason(+c: T.StorageClass) -> String:
  match c:
    case T.Scratch{}: "scratch-settled"
    case T.BuildOutput{}: "build-inputs-settled"
    case T.Export{}: "export-settled"
    case T.Checkout{}: "checkout-clean-published"
    case T.SharedImmutable{}: "shared-reference-absent"
    case T.GitObject{}: "git-object-report-only"
    case T.LogEvidence{}: "evidence-settled"
    case T.StagingSource{}: "staging-source-release-required"
    case T.StagingSourceReleased{}: "staging-source-released"
    case T.Unclassified{}: "unclassified"

def decide(+cls: T.StorageClass, +owner: String, +facts: T.Facts) -> T.Decision:
  +reason = preserve_reason(cls, owner, facts)
  Bool.pick(T.Decision, String.is_empty(reason), T.Remove{remove_reason(cls)}, T.Keep{reason})

def candidate_path(+c: T.Candidate) -> String:
  match c:
    case T.Candidate{path, cls, owner, owner_proof, bytes, identity, facts}: path

def entry_of_candidate(+c: T.Candidate) -> T.Entry:
  match c:
    case T.Candidate{path, cls, owner, owner_proof, bytes, identity, facts}:
      +decision = decide(cls, owner, facts)
      T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}

def entries_of_candidates(xs: List<T.Candidate>) -> List<T.Entry>:
  match xs:
    case Nil{}: Nil{}
    case Con{head, tail}: Con{entry_of_candidate(head), entries_of_candidates(tail)}

def entry_bytes(+e: T.Entry) -> Nat:
  match e:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}: bytes

def entry_decision(+e: T.Entry) -> T.Decision:
  match e:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}: decision

def decision_is_remove(decision: T.Decision) -> Bool:
  match decision:
    case T.Remove{reason}: True{}
    case T.Keep{reason}: False{}

def planned_bytes(entries: List<T.Entry>, +acc: Nat) -> Nat:
  match entries:
    case Nil{}: acc
    case Con{+head, tail}:
      +next = Bool.pick(Nat, decision_is_remove(entry_decision(head)), Nat.add(acc, entry_bytes(head)), acc)
      planned_bytes(tail, next)

def preserved_bytes(entries: List<T.Entry>, +acc: Nat) -> Nat:
  match entries:
    case Nil{}: acc
    case Con{+head, tail}:
      +next = Bool.pick(Nat, decision_is_remove(entry_decision(head)), acc, Nat.add(acc, entry_bytes(head)))
      preserved_bytes(tail, next)

def decision_name(+d: T.Decision) -> String:
  match d:
    case T.Keep{reason}: "keep"
    case T.Remove{reason}: "remove"

def decision_reason(+d: T.Decision) -> String:
  match d:
    case T.Keep{reason}: reason
    case T.Remove{reason}: reason

def entry_plan_line(+e: T.Entry) -> String:
  match e:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}:
      Tx.join("\t", [path, class_name(cls), decision_name(decision), decision_reason(decision), identity, Nat.show(bytes), owner, owner_proof])

def plan_lines(entries: List<T.Entry>, acc: List<String>) -> List<String>:
  match entries:
    case Nil{}: List.reverse(&1, String, acc)
    case Con{head, tail}: plan_lines(tail, Con{entry_plan_line(head), acc})

def plan_text(entries: List<T.Entry>) -> String:
  Tx.join("\n", plan_lines(entries, Nil{}))

# The product preview API. Candidates arrive from the caller's layout and
# durable evidence; this function never reads the host and never consults a
# clock.
def build(candidates: List<T.Candidate>, entries_acc: List<T.Entry>, lines_acc: List<String>) -> List<T.Entry> & List<String>:
  match candidates:
    case Nil{}: (List.reverse(&1, T.Entry, entries_acc), List.reverse(&1, String, lines_acc))
    case Con{+head, tail}:
      +entry = entry_of_candidate(head)
      build(tail, Con{entry, entries_acc}, Con{entry_plan_line(entry), lines_acc})

def preview_built(+root: String, +mount: String, +root_identity: String, valid: Bool, pair: List<T.Entry> & List<String>) -> T.Preview:
  (entries, lines) = pair
  +plan = Tx.join("\n", lines)
  T.Preview{root, mount, root_identity, valid, plan, entries}

def preview(+root: String, +mount: String, +root_identity: String, valid: Bool, candidates: List<T.Candidate>) -> T.Preview:
  preview_built(root, mount, root_identity, valid, build(candidates, Nil{}, Nil{}))

def decision_json(+d: T.Decision) -> String:
  "{\"decision\":" ++ J.string_literal(decision_name(d)) ++ ",\"reason\":" ++ J.string_literal(decision_reason(d)) ++ "}"

def entry_json(+e: T.Entry) -> String:
  match e:
    case T.Entry{path, cls, owner, owner_proof, bytes, identity, decision}:
      "{\"path\":" ++ J.string_literal(path)
      ++ ",\"class\":" ++ J.string_literal(class_name(cls))
      ++ ",\"owner\":" ++ J.string_literal(owner)
      ++ ",\"ownerProof\":" ++ J.string_literal(owner_proof)
      ++ ",\"bytes\":" ++ Nat.show(bytes)
      ++ ",\"identity\":" ++ J.string_literal(identity)
      ++ ",\"decision\":" ++ J.string_literal(decision_name(decision))
      ++ ",\"reason\":" ++ J.string_literal(decision_reason(decision)) ++ "}"

def entry_append(+acc: String, +head: T.Entry) -> String:
  Bool.pick(String, String.is_empty(acc), entry_json(head), acc ++ "," ++ entry_json(head))

def entry_items(entries: List<T.Entry>, acc: String) -> String:
  match entries:
    case Nil{}: acc
    case Con{head, tail}: entry_items(tail, entry_append(acc, head))

def preview_body(entries: List<T.Entry>, +planned: Nat, +preserved: Nat, +rendered: String) -> String:
  match entries:
    case Nil{}:
      "\"plannedBytes\":" ++ Nat.show(planned) ++ ",\"preservedBytes\":" ++ Nat.show(preserved) ++ ",\"entries\":[" ++ rendered ++ "]"
    case Con{+head, tail}:
      +remove = decision_is_remove(entry_decision(head))
      +next_planned = Bool.pick(Nat, remove, Nat.add(planned, entry_bytes(head)), planned)
      +next_preserved = Bool.pick(Nat, remove, preserved, Nat.add(preserved, entry_bytes(head)))
      preview_body(tail, next_planned, next_preserved, entry_append(rendered, head))

def preview_json(p: T.Preview) -> String:
  match p:
    case T.Preview{+root, +mount, +root_identity, valid, plan, entries}:
      "{\"root\":" ++ J.string_literal(root)
      ++ ",\"mount\":" ++ J.string_literal(mount)
      ++ ",\"rootIdentity\":" ++ J.string_literal(root_identity)
      ++ ",\"valid\":" ++ Bool.pick(String, valid, "true", "false")
      ++ ",\"plan\":" ++ J.string_literal(plan)
      ++ "," ++ preview_body(entries, 0n, 0n, "") ++ "}"

def outcome_name(+o: T.Outcome) -> String:
  match o:
    case T.Removed{bytes}: "removed"
    case T.AlreadyAbsent{}: "already-absent"
    case T.Kept{}: "kept"
    case T.Changed{detail}: "changed"
    case T.Refused{detail}: "refused"

def outcome_detail(+o: T.Outcome) -> String:
  match o:
    case T.Removed{bytes}: ""
    case T.AlreadyAbsent{}: ""
    case T.Kept{}: ""
    case T.Changed{detail}: detail
    case T.Refused{detail}: detail

def removal_json(+r: T.Removal) -> String:
  match r:
    case T.Removal{path, cls, owner_proof, reason, bytes, outcome}:
      "{\"path\":" ++ J.string_literal(path)
      ++ ",\"class\":" ++ J.string_literal(class_name(cls))
      ++ ",\"ownerProof\":" ++ J.string_literal(owner_proof)
      ++ ",\"reason\":" ++ J.string_literal(reason)
      ++ ",\"bytes\":" ++ Nat.show(bytes)
      ++ ",\"outcome\":" ++ J.string_literal(outcome_name(outcome))
      ++ ",\"detail\":" ++ J.string_literal(outcome_detail(outcome)) ++ "}"

def removal_append(+acc: String, +head: T.Removal) -> String:
  Bool.pick(String, String.is_empty(acc), removal_json(head), acc ++ "," ++ removal_json(head))

def removal_items(rows: List<T.Removal>, acc: String) -> String:
  match rows:
    case Nil{}: acc
    case Con{head, tail}: removal_items(tail, removal_append(acc, head))

def receipt_json(r: T.Receipt) -> String:
  match r:
    case T.Receipt{plan, root, mount, entries, reclaimed, complete}:
      "{\"plan\":" ++ J.string_literal(plan)
      ++ ",\"root\":" ++ J.string_literal(root)
      ++ ",\"mount\":" ++ J.string_literal(mount)
      ++ ",\"complete\":" ++ Bool.pick(String, complete, "true", "false")
      ++ ",\"reclaimedBytes\":" ++ Nat.show(reclaimed)
      ++ ",\"entries\":[" ++ removal_items(entries, "") ++ "]}"
