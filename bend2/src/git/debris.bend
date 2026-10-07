# debris: the added paths a repository's own ignore rules exclude, removed from
# a staged tree before the tree is committed.
#
# A worker worktree can hold build output the repository excludes while the
# worktree's own copy of the ignore rules does not: the branch's .gitignore can
# predate the rule, and a worker can force-add a path. A caller judges its
# staged additions against the repository's own rules, read at the repository
# root with --no-index so the checked-out copy cannot decide, and removes every
# match from the index before the tree is written; the caller names the paths
# dropped. The checked landing is that caller and judges the scratch checkout's
# own index; INDEX names a private index file for a caller whose staged tree is
# not the worktree's own index.
#
# A judgement that cannot be made fails the caller: a drop that cannot say what
# it excluded is not a drop. The added set is read with -z, so a name holding a
# space travels as itself. The rules answer one path per line, and git quotes a
# name holding a quote or a control byte; such a name does not match the path
# the index holds, and the rm that follows fails the caller rather than passing
# the drop silently.

import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git

# One debris pass: the paths it dropped as one display line, or the reason it
# could not be made.
type Debris is Data:
  DFine{paths: String}
  DFail{detail: String}

# The git argv for one index: the worktree's own index when INDEX is empty, a
# private index file otherwise, so a snapshot can stage without touching the
# worktree's index.
def debris_argv(+: String, +: String, +: List<String>) -> List<String>:
  match index:
    case SNil{}: Con{"git", Con{"-C", Con{dir, args}}}
    case SCon{c, rest}: Con{"/usr/bin/env", Con{"GIT_INDEX_FILE=" ++ index, Con{"git", Con{"-C", Con{dir, args}}}}}

def debris_run(+: String, dir: String, args: List<String>) -> IO(T.GitOut):
  +i2 = index
  +d2 = dir
  do IO<T.GitOut>:
    r : T.RunRes <- Git.runFull(debris_argv(i2, d2, args), ".")
    IO.pure(T.GitOut, Git.git_out(r))

def debris_nul_list(s: String) -> List<String>:
  +s2 = s
  Tx.split_nul(s2)

def debris_line_list(s: String) -> List<String>:
  +s2 = s
  Tx.split_lines(s2)

def debris_note_of(s: String) -> String:
  +s2 = s
  Tx.join(" ", debris_line_list(s2))

# One rm --cached for the whole dropped set; the worktree files stay.
def debris_rm_pick(ok: Bool, +: String, judged: String) -> IO(Debris):
  match ok:
    case True{}: IO.pure(Debris, DFine{debris_note_of(judged)})
    case False{}: IO.pure(Debris, DFail{Tx.cmd_failed("git rm --cached")})

def debris_rm_ok(g: T.GitOut, judged: String) -> IO(Debris):
  match g:
    case T.GRun{code, out}: debris_rm_pick(U32.is_eq(code, 0), out, judged)
    case T.GBroken{detail}: IO.pure(Debris, DFail{detail})

def debris_drop(+: String, dir: String, +: List<String>, judged: String) -> IO(Debris):
  +i2 = index
  +d2 = dir
  +j2 = judged
  do IO<Debris>:
    g : T.GitOut <- debris_run(i2, d2, Con{"rm", Con{"--cached", Con{"-q", Con{"-r", Con{"--", ps}}}}})
    r : Debris <- debris_rm_ok(g, j2)
    IO.pure(Debris, r)

# A judgement that names no path is either "nothing is excluded" (exit 1) or a
# failure of check-ignore itself.
def debris_none(none: Bool, out: String) -> IO(Debris):
  match none:
    case True{}: IO.pure(Debris, DFine{""})
    case False{}: IO.pure(Debris, DFail{Tx.cmd_failed("git check-ignore --no-index")})

def debris_judged_pick(some: Bool, none: Bool, out: String, index: String, dir: String) -> IO(Debris):
  match some:
    case True{}:
      +o2 = out
      do IO<Debris>:
        ps : List<String> <- IO.pure(List<String>, debris_line_list(o2))
        r : Debris <- debris_drop(index, dir, ps, o2)
        IO.pure(Debris, r)
    case False{}: debris_none(none, out)

def debris_judged(g: T.GitOut, index: String, dir: String) -> IO(Debris):
  match g:
    case T.GRun{code, out}:
      +c = code
      debris_judged_pick(U32.is_eq(c, 0), U32.is_eq(c, 1), out, index, dir)
    case T.GBroken{detail}: IO.pure(Debris, DFail{detail})

def debris_judge(repo: String, index: String, dir: String, ps: List<String>) -> IO(Debris):
  match ps:
    case Nil{}: IO.pure(Debris, DFine{""})
    case Con{h, rest}:
      +r2 = repo
      +i2 = index
      +d2 = dir
      do IO<Debris>:
        g : T.GitOut <- debris_run("", r2, Con{"-c", Con{"core.quotePath=false", Con{"check-ignore", Con{"--no-index", Con{"--", ps}}}}})
        r : Debris <- debris_judged(g, i2, d2)
        IO.pure(Debris, r)

def debris_added_ok(ok: Bool, out: String, repo: String, index: String, dir: String) -> IO(Debris):
  match ok:
    case True{}:
      do IO<Debris>:
        ps : List<String> <- IO.pure(List<String>, debris_nul_list(out))
        r : Debris <- debris_judge(repo, index, dir, ps)
        IO.pure(Debris, r)
    case False{}: IO.pure(Debris, DFail{Tx.cmd_failed("git diff --cached")})

def debris_added_pick(g: T.GitOut, repo: String, index: String, dir: String) -> IO(Debris):
  match g:
    case T.GRun{code, out}: debris_added_ok(U32.is_eq(code, 0), out, repo, index, dir)
    case T.GBroken{detail}: IO.pure(Debris, DFail{detail})

# The added paths of DIR's index the repository's own rules exclude are removed
# from that index; the answer names them. INDEX empty means DIR's own index.
def drop_added_ignored(repo: String, index: String, dir: String) -> IO(Debris):
  +r2 = repo
  +i2 = index
  +d2 = dir
  do IO<Debris>:
    g : T.GitOut <- debris_run(i2, d2, ["diff", "--cached", "--name-only", "--diff-filter=A", "-z"])
    r : Debris <- debris_added_pick(g, r2, i2, d2)
    IO.pure(Debris, r)

# The dropped paths as a line a caller can name them on, empty when none fell.
def debris_note(+: String) -> String:
  match paths:
    case SNil{}: ""
    case SCon{c, rest}: "\ndropped (ignored by this repository): " ++ paths
