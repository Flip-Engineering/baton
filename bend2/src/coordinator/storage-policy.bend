import Base
import ../git/text.bend as Tx
import ../json/canonical.bend as J

# Durable storage classification and cleanup decision.
#
# Every path the coordinator creates belongs to one durable class. Cleanup
# reads the class and the preservation facts recorded for the item. An item
# leaves when its class permits removal and every preservation fact is clear.

def scratch_build() -> String:
  "scratch-build"

def checkout_worktree() -> String:
  "checkout-worktree"

def shared_immutable() -> String:
  "shared-immutable"

def git_objects() -> String:
  "git-objects"

def logs_evidence() -> String:
  "logs-evidence"

def durable_state() -> String:
  "durable-state"

def unknown_class() -> String:
  "unknown"

def contains(+s: String, +needle: String) -> Bool:
  match s:
    case SNil{}: String.is_empty(needle)
    case SCon{c, rest}: Bool.or(Tx.starts_with(s, needle), contains(rest, needle))

# The class of one absolute or project-relative path. Markers name the
# owning lifecycle: build scratch under .scratch, linked checkouts under
# worktrees, Git object storage under .git/objects or an objects cache,
# shared immutable assets under assets or shared, the project database and
# its attempt directories as durable state, and registered logs and stderr
# evidence as logs-evidence. A path with no marker is unknown and cleanup
# preserves it.
def class_of_path(+path: String) -> String:
  Bool.pick(String, contains(path, "/.git/objects"), git_objects(),
  Bool.pick(String, contains(path, "/objects/"), git_objects(),
  Bool.pick(String, contains(path, ".attempt-"), durable_state(),
  Bool.pick(String, contains(path, ".db"), durable_state(),
  Bool.pick(String, contains(path, ".jsonl"), logs_evidence(),
  Bool.pick(String, contains(path, ".log"), logs_evidence(),
  Bool.pick(String, contains(path, ".stderr"), logs_evidence(),
  Bool.pick(String, Tx.starts_with(path, ".scratch/"), scratch_build(),
  Bool.pick(String, contains(path, "/.scratch/"), scratch_build(),
  Bool.pick(String, contains(path, "/worktrees/"), checkout_worktree(),
  Bool.pick(String, contains(path, "/checkouts/"), checkout_worktree(),
  Bool.pick(String, contains(path, "/assets/"), shared_immutable(),
  Bool.pick(String, contains(path, "/shared/"), shared_immutable(),
  unknown_class())))))))))))))

# Only derived build output and settled log evidence may leave through
# storage cleanup. Checkouts, shared assets, Git objects and durable state
# leave through their own owners: landing and worktree removal, asset
# publication, Git maintenance and database administration.
def class_deletable(+class: String) -> Bool:
  Bool.or(String.eq(class, scratch_build()), String.eq(class, logs_evidence()))

# The root that holds one class on one host kind. The project argument is
# the configured canonical root recorded for the project. On the homelab
# host that root sits on the NVMe array under the runner tree. On a Mac
# host that root is project-local on the project volume. Current project
# paths stay valid on both hosts: the root is the recorded project
# directory joined with the class directory, so an existing .scratch
# layout remains the scratch root and active payload stays in place.
def root_for(+class: String, +host: String, +project: String) -> String:
  Bool.pick(String, String.eq(class, scratch_build()), project ++ "/.scratch",
  Bool.pick(String, String.eq(class, checkout_worktree()), project ++ "/worktrees",
  Bool.pick(String, String.eq(class, git_objects()), project ++ "/.git/objects",
  Bool.pick(String, String.eq(class, shared_immutable()), project ++ "/assets",
  Bool.pick(String, String.eq(class, logs_evidence()), project ++ "/.scratch/bend2/logs",
  project ++ "/.scratch/bend2")))))

# Bounded retention per class, in bytes. The bound orders preview output
# and names the point where settled items become cleanup candidates.
# Dispatch, admission and turn execution read no retention bound.
def retention_bytes(+class: String) -> U32:
  Bool.pick(U32, String.eq(class, scratch_build()), 0,
  Bool.pick(U32, String.eq(class, logs_evidence()), 268435456,
  Bool.pick(U32, String.eq(class, checkout_worktree()), 0,
  Bool.pick(U32, String.eq(class, shared_immutable()), 0,
  Bool.pick(U32, String.eq(class, git_objects()), 0,
  Bool.pick(U32, String.eq(class, durable_state()), 0, 0))))))

type Decision is Data:
  Decision{reason: String, eligible: Bool}

# The cleanup decision for one item. Preservation facts come first, in the
# order a reader audits them: an active owner lease, a live process, dirty
# work, unpublished commits, an active runtime input, an unmerged ref,
# pending task or attempt data, shared content, and a symlinked path. The
# decision takes no timestamp and no age threshold.
def decide(+class: String, lease: Bool, process: Bool, dirty: Bool, unpublished: Bool, runtime_input: Bool, unmerged: Bool, pending: Bool, shared: Bool, symlink: Bool, settled: Bool, bytes: U32) -> Decision:
  Bool.pick(Decision, Bool.not(class_deletable(class)), Decision{"class-preserved", False{}},
  Bool.pick(Decision, lease, Decision{"active-lease", False{}},
  Bool.pick(Decision, process, Decision{"active-process", False{}},
  Bool.pick(Decision, dirty, Decision{"dirty-work", False{}},
  Bool.pick(Decision, unpublished, Decision{"unpublished-work", False{}},
  Bool.pick(Decision, runtime_input, Decision{"active-runtime-input", False{}},
  Bool.pick(Decision, unmerged, Decision{"unmerged-ref", False{}},
  Bool.pick(Decision, pending, Decision{"pending-data", False{}},
  Bool.pick(Decision, shared, Decision{"shared-content", False{}},
  Bool.pick(Decision, symlink, Decision{"symlink-path", False{}},
  Bool.pick(Decision, Bool.not(settled), Decision{"not-settled", False{}},
  Bool.pick(Decision, U32.is_lt(0, bytes), Decision{"eligible", True{}}, Decision{"no-bytes", False{}}))))))))))))

def decision_reason(decision: Decision) -> String:
  match decision:
    case Decision{reason, eligible}: reason

def decision_eligible(decision: Decision) -> Bool:
  match decision:
    case Decision{reason, eligible}: eligible

def class_is(+path: String, +class: String) -> Bool:
  String.eq(class_of_path(path), class)

def reason_is(decision: Decision, +reason: String) -> Bool:
  String.eq(decision_reason(decision), reason)

def class_json(+class: String, +host: String, +project: String) -> String:
  "{\"class\":" ++ J.string_literal(class)
  ++ ",\"root\":" ++ J.string_literal(root_for(class, host, project))
  ++ ",\"deletable\":" ++ Bool.pick(String, class_deletable(class), "true", "false")
  ++ ",\"retentionBytes\":" ++ U32.show(retention_bytes(class)) ++ "}"

def classes_json(+host: String, +project: String) -> String:
  "["
  ++ class_json(scratch_build(), host, project) ++ ","
  ++ class_json(checkout_worktree(), host, project) ++ ","
  ++ class_json(shared_immutable(), host, project) ++ ","
  ++ class_json(git_objects(), host, project) ++ ","
  ++ class_json(logs_evidence(), host, project) ++ ","
  ++ class_json(durable_state(), host, project) ++ ","
  ++ class_json(unknown_class(), host, project)
  ++ "]"

def policy_json(+host: String, +project: String) -> String:
  "{\"host\":" ++ J.string_literal(host)
  ++ ",\"project\":" ++ J.string_literal(project)
  ++ ",\"ageOnlyDeletion\":false"
  ++ ",\"classes\":" ++ classes_json(host, project) ++ "}"

def item_json(+path: String, +class: String, decision: Decision, bytes: U32) -> String:
  match decision:
    case Decision{reason, eligible}:
      "{\"path\":" ++ J.string_literal(path)
      ++ ",\"class\":" ++ J.string_literal(class)
      ++ ",\"bytes\":" ++ U32.show(bytes)
      ++ ",\"wouldRemove\":" ++ Bool.pick(String, eligible, "true", "false")
      ++ ",\"reason\":" ++ J.string_literal(reason) ++ "}"

# One cleanup receipt. Preview and apply share the shape. An apply that
# finds an item already absent records removed false with reason
# already-absent, so a repeated apply returns the same receipt fields.
def receipt_json(+mode: String, +session: String, +items: String, +removed: String) -> String:
  "{\"mode\":" ++ J.string_literal(mode)
  ++ ",\"session\":" ++ J.string_literal(session)
  ++ ",\"items\":[" ++ items ++ "]"
  ++ ",\"removed\":[" ++ removed ++ "]"
  ++ ",\"ageOnlyDeletion\":false}"
