# Storage policy types for the Bend2 storage-class and safe-cleanup core.
#
# Issue #912 defines the durable storage classes, ownership-safe cleanup and
# receipt data. This module names those values. Host effects observe paths and
# process references; classification, preservation and receipt decisions stay
# in Bend2.
#
# The preservation facts are evidence values. A path enters cleanup only when
# every fact is known to be absent. Unknown evidence preserves the path. No
# field carries an age or timestamp, so a clock value cannot authorize removal.

import Base

# The durable classes of a project's stored data. Scratch, build output, export
# trees and checkouts are transient: they hold work that cleanup may reclaim
# once the owning session has settled. Shared assets and Git objects are
# content-addressed and reusable; log evidence retains coordinator output.
type StorageClass is Data:
  Scratch{}
  BuildOutput{}
  Export{}
  Checkout{}
  SharedImmutable{}
  GitObject{}
  LogEvidence{}
  Unclassified{}

def is_transient(+c: StorageClass) -> Bool:
  match c:
    case Scratch{}: True{}
    case BuildOutput{}: True{}
    case Export{}: True{}
    case Checkout{}: True{}
    case other: False{}

# One observed preservation fact. Present carries the evidence detail a receipt
# can replay, for example the live lease holder or the process identity.
type Presence is Data:
  Present{detail: String}
  Absent{}
  Unknown{}

# The recorded owner of a candidate compared with the owner identity supplied
# to the policy. OwnerMatches proceeds; every other constructor preserves.
type Owner is Data:
  OwnerMatches{identity: String}
  OwnerDiffers{identity: String}
  OwnerMissing{}
  OwnerUnknown{}

# The evidence a preview and an apply re-check for one candidate. Callers fill
# facts from their durable source and from the host primitives. The database
# fact protects an active coordinator database path and every ancestor of it;
# it is independent of the path owner because a coordinator database must
# survive any cleanup run. The execution fact names a non-exited execution of
# the owning session; the policy consults it for transient classes only.
type Facts is Data:
  Facts{
    owner: Owner,
    execution: Presence,
    database: Presence,
    lease: Presence,
    process: Presence,
    dirty: Presence,
    unpublished: Presence,
    runtime_input: Presence,
    ref: Presence,
    pending_attempt: Presence
  }

# One path proposed for cleanup. Identity is the host observation
# `<kind>:<device>:<inode>` the apply step revalidates before removal. Bytes is
# the measured size, which for a directory is the sum of its regular files.
type Candidate is Data:
  Candidate{
    path: String,
    class: StorageClass,
    owner: String,
    owner_proof: String,
    bytes: Nat,
    identity: String,
    facts: Facts
  }

# The policy answer. Reason names the first preservation fact that stopped the
# candidate, or the settled class rule that admitted it.
type Decision is Data:
  Keep{reason: String}
  Remove{reason: String}

# One previewed path with the decision derived from its facts.
type Entry is Data:
  Entry{
    path: String,
    class: StorageClass,
    owner: String,
    owner_proof: String,
    bytes: Nat,
    identity: String,
    decision: Decision
  }

# The cleanup preview. Plan is the canonical text of every entry; apply carries
# it into the receipt so a replay can compare the exact plan it ran. Mount
# identifies the caller-selected storage root when the caller supplies one.
type Preview is Type:
  Preview{
    root: String,
    mount: String,
    root_identity: String,
    valid: Bool,
    plan: String,
    entries: List<Entry>
  }

# The apply result for one path. Kept means the first preview preserved it;
# Changed means fresh evidence or the host identity no longer matches the plan.
type Outcome is Data:
  Removed{bytes: Nat}
  AlreadyAbsent{}
  Kept{}
  Changed{detail: String}
  Refused{detail: String}

# One receipt row. Bytes is the measured preview size; reclaimed counts only a
# Removed outcome.
type Removal is Data:
  Removal{
    path: String,
    class: StorageClass,
    owner_proof: String,
    reason: String,
    bytes: Nat,
    outcome: Outcome
  }

# The applied receipt. Complete is false when any row changed or was refused.
type Receipt is Type:
  Receipt{
    plan: String,
    root: String,
    mount: String,
    entries: List<Removal>,
    reclaimed_bytes: Nat,
    complete: Bool
  }
