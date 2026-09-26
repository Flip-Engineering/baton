# Shared types of the Git operations module. The coordinator imports this file
# for the outcome shapes of create-worktree, land and worktree-status.

import Base

# How a spawned process ended: a real exit code or the signal that killed it.
type Status is Data:
  SExit{code: U32}
  SSignal{num: U32}

# One host process run: either it reached a status, or it never started.
type RunRes is Data:
  RRun{status: Status, out: String}
  RSpawn{detail: String}

# One git command run: the command ran and answered an exit code, or the git
# executable itself was unusable.
type GitOut is Data:
  GRun{code: U32, out: String}
  GBroken{detail: String}

# One failing test on one check run. The four fields are the failure identity
# of AGENTS.md: file, test, failure type and the stable semantic code when the
# check tool supplies one ("-": none). Fields travel hex-encoded so any name
# can carry spaces.
type Ident is Data:
  Id{file: String, test: String, kind: String, code: String}

# The check a landing runs: cmd is an argv template whose element exactly
# "@FILE@" is replaced by one selected file per run; files are the selected
# check files, relative to the repository root.
type Check is Data:
  Chk{cmd: +List<String>, files: +List<String>}

# The answer of create-worktree: commit names the resolved base commit the new
# worktree starts from.
type WorktreeCreated is Data:
  WCreated{branch: String, path: String, commit: String}

# The observed state of one worktree, for worker reports.
type WtStatus is Data:
  Wt{branch: String, commit: String, dirty: Bool}

# Refusals of the Git operations. One constructor per cause; Cmd carries the
# operation name and the git output that named the failure.
type GitFail is Data:
  FBranchExists{branch: String}
  FPathExists{path: String}
  FUnknownBase{base: String}
  FTargetBusy{branch: String}
  FCmd{op: String, detail: String}

# The answer of land. LLanded names the actual target commit after the
# advance. LAlready answers a retry whose worker commit the target already
# contains. LConflict names the unmerged paths and keeps the prepared worktree
# at dir for the requester. LBlocked names the failure identities that are new
# on the candidate or the selected files no run could judge.
type LandOutcome is Data:
  LLanded{target: String, commit: String}
  LAlready{commit: String}
  LConflict{files: String, dir: String}
  LBlocked{reason: String}

def str_cat2(a: String, b: String) -> String:
  a ++ b

def str_cat3(a: String, b: String, c: String) -> String:
  a ++ b ++ c

# A human-readable line for a refusal, for messages and logs.
def fail_text(f: GitFail) -> String:
  match f:
    case FBranchExists{branch}: str_cat2("branch exists: ", branch)
    case FPathExists{path}: str_cat2("path exists: ", path)
    case FUnknownBase{base}: str_cat2("unknown base: ", base)
    case FTargetBusy{branch}: str_cat2("target busy: ", branch)
    case FCmd{op, detail}: str_cat3(op, ": ", detail)
