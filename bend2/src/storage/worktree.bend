# Git-managed removal of released linked worktrees for issue #1049.
#
# A released staging candidate that is a registered linked worktree of its own
# project store is removed with `git worktree remove <exact-path>` without
# `--force`, so Git settles the worktree administration and keeps the branch.
# Any refusal (locked, dirty, unregistered, unreadable administration) keeps
# the tree; the receipt names Git's answer. Standalone trees keep the existing
# raw unlink path. Checkout-class worktrees keep their existing behavior
# because that class carries no remote-retention proof.

import Base
import ./observe.bend as O
import ../git/process.bend as Git
import ../git/types.bend as G
import ../git/text.bend as Tx

# The removal method for one admitted candidate path.
type RemovalMethod is Data:
  LinkedWorktree{}
  StandaloneTree{}
  Unusable{detail: String}

def nonempty(+text: String) -> Bool:
  Bool.not(String.is_empty(text))

def worktree_lines(lines: List<String>, +wanted: String) -> Bool:
  match lines:
    case Nil{}: False{}
    case Con{+head, tail}:
      Bool.or(String.eq(head, "worktree " ++ wanted), worktree_lines(tail, wanted))

# The candidate is a registered worktree exactly when its toplevel names the
# candidate itself and the worktree list carries that exact line. A subdir of
# a worktree, a renamed path and a broken administration all answer false.
def worktree_registered(+worklist: String, +toplevel: String, +candidate: String) -> Bool:
  Bool.and(nonempty(toplevel),
    Bool.and(nonempty(candidate),
      Bool.and(String.eq(toplevel, candidate),
        worktree_lines(Tx.split_lines(worklist), toplevel))))

def git_text(+result: G.GitOut) -> Maybe<String>:
  match result:
    case G.GRun{code, out}: Bool.pick(Maybe<String>, U32.is_eq(code, 0), Some{Tx.trim_nl(out)}, None{})
    case G.GBroken{detail}: None{}

def git_ok(+result: G.GitOut) -> Bool:
  match result:
    case G.GRun{code, out}: U32.is_eq(code, 0)
    case G.GBroken{detail}: False{}

def list_registers(+result: G.GitOut, +path: String) -> Bool:
  match result:
    case G.GRun{code, out}:
      Bool.and(U32.is_eq(code, 0), worktree_lines(Tx.split_lines(out), path))
    case G.GBroken{detail}: False{}

def toplevel_names(toplevel: Maybe<String>, +path: String) -> Bool:
  match toplevel:
    case None{}: False{}
    case Some{+value}: Bool.and(nonempty(value), String.eq(value, path))

def dirs_differ(gitdir: Maybe<String>, commondir: Maybe<String>) -> Bool:
  match gitdir:
    case None{}: False{}
    case Some{+dir}:
      match commondir:
        case None{}: False{}
        case Some{+common}: Bool.and(nonempty(dir), Bool.and(nonempty(common), Bool.not(String.eq(dir, common))))

def method_of(+toplevel_ok: Bool, +registered: Bool, +linked: Bool) -> RemovalMethod:
  Bool.pick(RemovalMethod, toplevel_ok,
    Bool.pick(RemovalMethod, registered,
      Bool.pick(RemovalMethod, linked, LinkedWorktree{}, StandaloneTree{}),
      Unusable{"worktree registration changed"}),
    Unusable{"worktree identity changed"})

# Every worktree-list read for the removal decision runs in the candidate's
# own store, the same store that admitted it. A foreign store that does not
# register the path cannot supply removal authority for it.
def classify(+path: String) -> IO(RemovalMethod):
  do IO<RemovalMethod>:
    toplevel_git : G.GitOut <- Git.runGit(path, ["rev-parse", "--show-toplevel"])
    list_git : G.GitOut <- Git.runGit(path, ["worktree", "list", "--porcelain"])
    gitdir_git : G.GitOut <- Git.runGit(path, ["rev-parse", "--git-dir"])
    commondir_git : G.GitOut <- Git.runGit(path, ["rev-parse", "--git-common-dir"])
    +method : RemovalMethod = method_of(toplevel_names(git_text(toplevel_git), path),
      list_registers(list_git, path), dirs_differ(git_text(gitdir_git), git_text(commondir_git)))
    IO.pure(RemovalMethod, method)

def refused_detail(+code: U32, +out: String) -> String:
  Bool.pick(String, String.is_empty(Tx.trim_nl(out)),
    "git worktree remove exited " ++ U32.show(code),
    "git worktree remove exited " ++ U32.show(code) ++ ": " ++ Tx.trim_nl(out))

def absent_or_changed(+observed: O.Observation, +bytes: Nat) -> O.RemoveResult:
  match observed:
    case O.Missing{path}: O.RemoveRemoved{bytes}
    case O.Unreadable{path, detail}: O.RemoveRefused{detail}
    case other: O.RemoveRefused{"worktree still present"}

def remove_exited(+code: U32, +out: String, +bytes: Nat, +path: String) -> IO(O.RemoveResult):
  Bool.pick(IO(O.RemoveResult), U32.is_eq(code, 0),
    do IO<O.RemoveResult>:
      observed : O.Observation <- O.observe(path)
      IO.pure(O.RemoveResult, absent_or_changed(observed, bytes)),
    IO.pure(O.RemoveResult, O.RemoveRefused{refused_detail(code, out)}))

def remove_status(+status: G.Status, +out: String, +bytes: Nat, +path: String) -> IO(O.RemoveResult):
  match status:
    case G.SExit{code}: remove_exited(code, out, bytes, path)
    case G.SSignal{num}: IO.pure(O.RemoveResult, O.RemoveRefused{"git worktree remove killed"})

def remove_verified(result: G.RunRes, +bytes: Nat, +path: String) -> IO(O.RemoveResult):
  match result:
    case G.RRun{status, out}: remove_status(status, out, bytes, path)
    case G.RSpawn{detail}: IO.pure(O.RemoveResult, O.RemoveRefused{detail})

def remove_after_measure(measured: Maybe<Nat>, +path: String) -> IO(O.RemoveResult):
  match measured:
    case None{}: IO.pure(O.RemoveResult, O.RemoveRefused{"worktree size unreadable"})
    case Some{+bytes}:
      do IO<O.RemoveResult>:
        result : G.RunRes <- Git.runFull(["git", "-C", path, "worktree", "remove", path], ".")
        answer : O.RemoveResult <- remove_verified(result, bytes, path)
        IO.pure(O.RemoveResult, answer)

# Remove one admitted linked worktree through Git. The caller revalidated the
# candidate identity first. A successful removal keeps the branch; only the
# registered working tree and its administration are gone.
def remove_linked(+path: String) -> IO(O.RemoveResult):
  do IO<O.RemoveResult>:
    measured : Maybe<Nat> <- O.measure(path)
    answer : O.RemoveResult <- remove_after_measure(measured, path)
    IO.pure(O.RemoveResult, answer)

def remove_raw(+path: String, +identity: String, +root: String, +root_identity: String) -> IO(O.RemoveResult):
  O.remove(path, identity, root, root_identity)

def remove_by_method(+method: RemovalMethod, +path: String, +identity: String, +root: String, +root_identity: String) -> IO(O.RemoveResult):
  match method:
    case LinkedWorktree{}: remove_linked(path)
    case StandaloneTree{}: remove_raw(path, identity, root, root_identity)
    case Unusable{detail}: IO.pure(O.RemoveResult, O.RemoveRefused{detail})

# The admitted-path removal for a staging-source-released candidate. Linked
# worktrees leave through Git; standalone trees keep the raw unlink; anything
# the worktree reads cannot establish keeps the tree with the reason.
def remove_admitted(+path: String, +identity: String, +root: String, +root_identity: String) -> IO(O.RemoveResult):
  do IO<O.RemoveResult>:
    method : RemovalMethod <- classify(path)
    answer : O.RemoveResult <- remove_by_method(method, path, identity, root, root_identity)
    IO.pure(O.RemoveResult, answer)
