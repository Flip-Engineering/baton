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

# A capture outcome kept as data: the affine host Result is consumed once and every
# code and byte is preserved, with host failure and observed success kept distinct.
type CapturedRaw is Data:
  CapturedFailed{code: U32, detail: String}
  CapturedDone{framing: String, diagnostics: String}

def captured_raw_of(host: Result<&1, &1, U32 & String, String & String>) -> CapturedRaw:
  match host:
    case Fail{error}:
      match error:
        case (code, detail): CapturedFailed{code, detail}
    case Done{framing}:
      match framing:
        case (frame, details): CapturedDone{frame, details}

# A release outcome kept as data: only the release's own success and failure, with
# absence handled by the enclosing observation.
type ReleaseRaw is Data:
  ReleaseUnperformed{}
  ReleaseFailed{code: U32, detail: String}
  ReleaseDone{}

def release_raw_of(host: Result<&1, &1, U32 & String, Unit>) -> ReleaseRaw:
  match host:
    case Fail{error}:
      match error:
        case (code, detail): ReleaseFailed{code, detail}
    case Done{unit}: ReleaseDone{}

# The failure payload of a host Result: the code the host answered and the detail
# it wrote. A Data record, because a bare product is a Type and cannot be stored.
type HostError is Data:
  HostError{code: U32, detail: String}

def HostError.code(error: HostError) -> U32:
  match error:
    case HostError{code, detail}: code

def HostError.detail(error: HostError) -> String:
  match error:
    case HostError{code, detail}: detail

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
# contains and names that worker commit. LConflict names the unmerged paths
# and keeps the prepared worktree at dir for the requester. LBlocked names
# the failure identities that are new on the candidate or the selected files
# no run could judge.
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

# The conversions, stated for every payload rather than for one sample.
law a_capture_success_keeps_both_raw_strings:
  for framing: String
  for diagnostics: String
  {captured_raw_of(Done{(framing, diagnostics)}) == CapturedDone{framing, diagnostics} : CapturedRaw}

def a_capture_success_keeps_both_raw_strings(framing,diagnostics):
  {==}

law a_capture_failure_keeps_its_code_and_detail:
  for code: U32
  for detail: String
  {captured_raw_of(Fail{(code, detail)}) == CapturedFailed{code, detail} : CapturedRaw}

def a_capture_failure_keeps_its_code_and_detail(code,detail):
  {==}

law a_release_failure_keeps_its_code_and_detail:
  for code: U32
  for detail: String
  {release_raw_of(Fail{(code, detail)}) == ReleaseFailed{code, detail} : ReleaseRaw}

def a_release_failure_keeps_its_code_and_detail(code,detail):
  {==}

law a_release_success_is_its_own_success:
  {release_raw_of(Done{Unit{}}) == ReleaseDone{} : ReleaseRaw}

def a_release_success_is_its_own_success():
  {==}
