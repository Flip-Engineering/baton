# The Git operations test entry. Builds a throwaway repository under
# .scratch/bend2-git-test and exercises create-worktree and worktree-status
# through the real native effect. Run from the repository root:
#   bend bend2/tests/git.bend -o .scratch/git-test.c
#   clang -O1 -pthread .scratch/git-test.c -lm -o .scratch/git-test
#   ./.scratch/git-test

import Base
import ../src/git/process.bend as Git
import ../src/git/types.bend as T
import ../src/git/text.bend as Tx
import ../src/git/create-worktree.bend as CW
import ../src/git/status.bend as WS

def fail_text(f: T.GitFail) -> String:
  match f:
    case T.FBranchExists{branch}: Tx.str_cat("branch exists: ", branch)
    case T.FPathExists{path}: Tx.str_cat("path exists: ", path)
    case T.FUnknownBase{base}: Tx.str_cat("unknown base: ", base)
    case T.FTargetBusy{branch}: Tx.str_cat("target busy: ", branch)
    case T.FCmd{op, detail}: Tx.join(" ", Con{op, Con{":", Con{detail, Nil{}}}})

def created_commit(m: T.WorktreeCreated) -> String:
  match m:
    case T.WCreated{branch, path, commit}: commit

def eq_or(ok: Bool, why: String) -> String:
  Bool.pick(String, ok, "", why)

def chk_create_ok(repo: String, wt: String, base: String) -> IO(String):
  +b2 = base
  IO.bind(Result<&1, &1, T.GitFail, T.WorktreeCreated>, String,
    CW.createWorktree(repo, "baton/w1", wt, b2),
    r => IO.pure(String, eq_or(Tx.str_eq(CW.created_commit(CW.create_of(r)), b2), "create: base commit mismatch")))

def chk_branch_exists(repo: String, wt: String, base: String) -> IO(String):
  +w2 = wt
  IO.bind(Result<&1, &1, T.GitFail, T.WorktreeCreated>, String,
    CW.createWorktree(repo, "baton/w1", w2, base),
    r => IO.pure(String, CW.is_branch_exists_fail(r)))

def chk_path_exists(repo: String, wt: String, base: String) -> IO(String):
  IO.bind(Result<&1, &1, T.GitFail, T.WorktreeCreated>, String,
    CW.createWorktree(repo, "baton/w2", wt, base),
    r => IO.pure(String, CW.is_path_exists_fail(r)))

def chk_unknown_base(repo: String, wt3: String, base: String) -> IO(String):
  IO.bind(Result<&1, &1, T.GitFail, T.WorktreeCreated>, String,
    CW.createWorktree(repo, "baton/w3", wt3, "mystery-ref"),
    r => IO.pure(String, CW.is_unknown_base_fail(r)))

def chk_status_clean(wt: String, base: String) -> IO(String):
  IO.bind(Result<&1, &1, T.GitFail, T.WtStatus>, String,
    WS.worktreeStatus(wt),
    r => IO.pure(String, WS.status_clean_fail(r, base)))

def chk_status_dirty(wt: String, base: String) -> IO(String):
  +w2 = wt
  IO.bind(String, String,
    IO.bind(T.RunRes, String,
      Git.runFull(Con{"/usr/bin/touch", Con{Tx.str_cat(w2, "/dirt.txt"), Nil{}}}, "."),
      t => IO.pure(String, "")),
    t => IO.bind(Result<&1, &1, T.GitFail, T.WtStatus>, String,
      WS.worktreeStatus(w2),
      r => IO.pure(String, WS.status_dirty_fail(r, base))))

def code_of(r: T.GitOut) -> String:
  match r:
    case T.GRun{code, out}: U32.show(code)
    case T.GBroken{detail}: detail

# One git command list run in order; the first failure ends the sequence.
def git_seq(cmds: List<List<String>>, repo_cmd: String, repo_seq: String) -> IO(T.RunRes):
  match cmds:
    case Nil{}: IO.pure(T.RunRes, T.RRun{T.SExit{0}, SNil{}})
    case Con{c, rest}:
      +rc = repo_cmd
      +rs = repo_seq
      IO.bind(T.RunRes, T.RunRes,
        Git.runFull(Con{"git", Con{"-C", Con{rc, c}}}, "."),
        _r => git_seq(rest, rc, rs))

def out_of(r: T.GitOut) -> String:
  match r:
    case T.GRun{code, out}: out
    case T.GBroken{detail}: detail

def setup(repo: String) -> IO(String):
  +r0 = repo
  IO.bind(T.RunRes, String,
    IO.bind(T.RunRes, T.RunRes,
      IO.bind(T.RunRes, T.RunRes,
        Git.runFull(Con{"/bin/rm", Con{"-rf", Con{r0, Nil{}}}}, "."),
        _rm => Git.runFull(Con{"git", Con{"init", Con{"-q", Con{"-b", Con{"main", Con{r0, Nil{}}}}}}}, ".")),
      _init => git_seq([
        ["config", "user.email", "baton@test"],
        ["config", "user.name", "baton test"],
        ["commit", "-q", "--allow-empty", "-m", "seed"]
      ], r0, r0)),
    _g => IO.bind(T.GitOut, String,
      Git.runGit(r0, Con{"rev-parse", Con{"HEAD", Nil{}}}),
      g => IO.pure(String, Tx.trim_nl(out_of(g)))))

def finish_go(nonempty: Bool, all: String) -> IO(Unit):
  match nonempty:
    case True{}: IO.die(Unit, 1, Tx.str_cat("FAILURES:\n", all))
    case False{}: IO.print("git-lane checks: all green")

def finish(all: String) -> IO(Unit):
  +a2 = all
  finish_go(Tx.non_empty(a2), a2)

def run_all6(b: String, acc: String) -> IO(Unit):
  +a6 = acc
  IO.bind(String, Unit, chk_status_dirty(".scratch/bend2-git-test/.scratch/bend2-git-wt", b),
    f6 => finish(Tx.str_cat(a6, f6)))

def run_all5(b: String, acc: String) -> IO(Unit):
  +a5 = acc
  +b2 = b
  IO.bind(String, Unit, chk_status_clean(".scratch/bend2-git-test/.scratch/bend2-git-wt", b2),
    f5 => run_all6(b2, Tx.str_cat(a5, f5)))

def run_all4(b: String, acc: String) -> IO(Unit):
  +a4 = acc
  +b2 = b
  IO.bind(String, Unit, chk_unknown_base(".scratch/bend2-git-test", ".scratch/bend2-git-wt3", b2),
    f4 => run_all5(b2, Tx.str_cat(a4, f4)))

def run_all3(b: String, acc: String) -> IO(Unit):
  +a3 = acc
  +b2 = b
  IO.bind(String, Unit, chk_path_exists(".scratch/bend2-git-test", ".scratch/bend2-git-wt", b2),
    f3 => run_all4(b2, Tx.str_cat(a3, f3)))

def run_all2(b: String, acc: String) -> IO(Unit):
  +a2 = acc
  +b2 = b
  IO.bind(String, Unit, chk_branch_exists(".scratch/bend2-git-test", ".scratch/bend2-git-wt", b2),
    f2 => run_all3(b2, Tx.str_cat(a2, f2)))

def run_all(base: String) -> IO(Unit):
  +b = base
  IO.bind(Unit, Unit, IO.print(Tx.str_cat("base=", b)),
    _p => IO.bind(String, Unit, chk_create_ok(".scratch/bend2-git-test", ".scratch/bend2-git-wt", b),
      f1 => run_all2(b, Tx.str_cat("", f1))))

def main() -> IO(Unit):
  IO.bind(String, Unit, setup(".scratch/bend2-git-test"), base0 => run_all(Tx.trim_nl(base0)))
