import Base
import ./storage-policy.bend as Policy

law class_scratch_under_dot_scratch:
  {Policy.class_is("/repo/.scratch/bend2/build/out.o", Policy.scratch_build()) == True{} : Bool}

def class_scratch_under_dot_scratch():
  {==}

law class_worktree_checkout:
  {Policy.class_is("/mnt/nvme4tb/baton/worktrees/w1/src/main.bend", Policy.checkout_worktree()) == True{} : Bool}

def class_worktree_checkout():
  {==}

law class_git_objects_preserved:
  {Policy.class_is("/repo/.git/objects/ab/cdef", Policy.git_objects()) == True{} : Bool}

def class_git_objects_preserved():
  {==}

law class_database_durable:
  {Policy.class_is("/repo/.scratch/bend2/state.db", Policy.durable_state()) == True{} : Bool}

def class_database_durable():
  {==}

law class_log_evidence:
  {Policy.class_is("/repo/.scratch/bend2/turn.jsonl", Policy.logs_evidence()) == True{} : Bool}

def class_log_evidence():
  {==}

law class_unknown_path:
  {Policy.class_is("/repo/README.md", Policy.unknown_class()) == True{} : Bool}

def class_unknown_path():
  {==}

law decide_preserves_active_lease:
  {Policy.reason_is(Policy.decide(Policy.scratch_build(), True{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, True{}, 10), "active-lease") == True{} : Bool}

def decide_preserves_active_lease():
  {==}

law decide_preserves_dirty_work:
  {Policy.reason_is(Policy.decide(Policy.logs_evidence(), False{}, False{}, True{}, False{}, False{}, False{}, False{}, False{}, False{}, True{}, 10), "dirty-work") == True{} : Bool}

def decide_preserves_dirty_work():
  {==}

law decide_preserves_unmerged_ref:
  {Policy.reason_is(Policy.decide(Policy.logs_evidence(), False{}, False{}, False{}, False{}, False{}, True{}, False{}, False{}, False{}, True{}, 10), "unmerged-ref") == True{} : Bool}

def decide_preserves_unmerged_ref():
  {==}

law decide_preserves_pending_data:
  {Policy.reason_is(Policy.decide(Policy.logs_evidence(), False{}, False{}, False{}, False{}, False{}, False{}, True{}, False{}, False{}, True{}, 10), "pending-data") == True{} : Bool}

def decide_preserves_pending_data():
  {==}

law decide_preserves_symlink:
  {Policy.reason_is(Policy.decide(Policy.scratch_build(), False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, True{}, True{}, 10), "symlink-path") == True{} : Bool}

def decide_preserves_symlink():
  {==}

law decide_preserves_shared_class:
  {Policy.decision_eligible(Policy.decide(Policy.shared_immutable(), False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, True{}, 10)) == False{} : Bool}

def decide_preserves_shared_class():
  {==}

law decide_allows_settled_scratch:
  {Policy.decision_eligible(Policy.decide(Policy.scratch_build(), False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, True{}, 10)) == True{} : Bool}

def decide_allows_settled_scratch():
  {==}

law decide_allows_settled_logs:
  {Policy.decision_eligible(Policy.decide(Policy.logs_evidence(), False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, True{}, 10)) == True{} : Bool}

def decide_allows_settled_logs():
  {==}

law decide_keeps_empty_item:
  {Policy.reason_is(Policy.decide(Policy.scratch_build(), False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, False{}, True{}, 0), "no-bytes") == True{} : Bool}

def decide_keeps_empty_item():
  {==}
