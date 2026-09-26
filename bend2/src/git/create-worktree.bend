# create-worktree: one worker branch and worktree from an explicit base. The
# answer names the branch, the worktree path and the resolved base commit, so
# the coordinator can record what the worker starts from. Refusals name the
# cause: the branch or the path already exists, the base is unknown, or a git
# command failed while creating the worktree.

import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git

# The create-worktree pipeline state: done, refused, or resolved base in hand.
type CW is Data:
  CWDone{made: T.WorktreeCreated}
  CWFail{fail: T.GitFail}
  CWNext{baseCommit: String}

def cw_answer(r: CW) -> IO(Result<&1, &1, T.GitFail, T.WorktreeCreated>):
  match r:
    case CWDone{made}: IO.pure(Result<&1, &1, T.GitFail, T.WorktreeCreated>, Done{made})
    case CWFail{fail}: IO.pure(Result<&1, &1, T.GitFail, T.WorktreeCreated>, Fail{fail})
    case CWNext{bc}: IO.pure(Result<&1, &1, T.GitFail, T.WorktreeCreated>, Fail{T.FCmd{"create-worktree", "unreachable stage"}})

def cw_stage4_ok(ok: Bool, out: String, bc2: String, br2: String, p2: String) -> CW:
  match ok:
    case True{}: CWDone{T.WCreated{br2, p2, bc2}}
    case False{}: CWFail{T.FCmd{"create-worktree", Tx.trim_nl(out)}}

def cw_stage4_pick(r: T.GitOut, bc: String, branch: String, path: String) -> CW:
  match r:
    case T.GRun{code, out}: cw_stage4_ok(U32.is_eq(code, 0), out, bc, branch, path)
    case T.GBroken{detail}: CWFail{T.FCmd{"create-worktree", detail}}

def cw_stage4(bc: String, repo: String, branch: String, path: String) -> IO(CW):
  +br2 = branch
  +p2 = path
  +bc2 = bc
  do IO<CW>:
    r : T.GitOut <- Git.runGit(repo, Con{"worktree", Con{"add", Con{"-b", Con{br2, Con{p2, Con{bc2, Nil{}}}}}}})
    IO.pure(CW, cw_stage4_pick(r, bc2, br2, p2))

def cw_go4(r: CW, repo: String, branch: String, path: String) -> IO(CW):
  match r:
    case CWDone{made}: IO.pure(CW, CWDone{made})
    case CWFail{fail}: IO.pure(CW, CWFail{fail})
    case CWNext{bc}: cw_stage4(bc, repo, branch, path)

def cw_stage3_ok(ok: Bool, bc: String, path: String) -> CW:
  match ok:
    case True{}: CWFail{T.FPathExists{path}}
    case False{}: CWNext{bc}

def cw_stage3_pick(r: T.RunRes, bc: String, path: String) -> CW:
  match r:
    case T.RRun{T.SExit{code}, out}: cw_stage3_ok(U32.is_eq(code, 0), bc, path)
    case T.RRun{T.SSignal{num}, out}: CWNext{bc}
    case T.RSpawn{detail}: CWFail{T.FCmd{"create-worktree", detail}}

def cw_stage3(bc: String, repo: String, branch: String, path: String) -> IO(CW):
  +p2 = path
  do IO<CW>:
    r : T.RunRes <- Git.runFull(["/bin/ls","-d","--",p2],repo)
    IO.pure(CW, cw_stage3_pick(r, bc, p2))

def cw_go3(r: CW, repo: String, branch: String, path: String) -> IO(CW):
  match r:
    case CWDone{made}: IO.pure(CW, CWDone{made})
    case CWFail{fail}: IO.pure(CW, CWFail{fail})
    case CWNext{bc}: cw_stage3(bc, repo, branch, path)

def cw_stage2_ok(ok: Bool, out: String, bc: String, branch: String) -> CW:
  match ok:
    case True{}: CWFail{T.FBranchExists{branch}}
    case False{}: CWNext{bc}

def cw_stage2_pick(r: T.GitOut, bc: String, branch: String) -> CW:
  match r:
    case T.GRun{code, out}: cw_stage2_ok(U32.is_eq(code, 0), out, bc, branch)
    case T.GBroken{detail}: CWFail{T.FCmd{"create-worktree", detail}}

def cw_stage2(bc: String, repo: String, branch: String, path: String) -> IO(CW):
  +br2 = branch
  do IO<CW>:
    r : T.GitOut <- Git.runGit(repo, Con{"rev-parse", Con{"--verify", Con{"--quiet", Con{Tx.str_cat("refs/heads/", br2), Nil{}}}}})
    IO.pure(CW, cw_stage2_pick(r, bc, br2))

def cw_go2(r: CW, repo: String, branch: String, path: String) -> IO(CW):
  match r:
    case CWDone{made}: IO.pure(CW, CWDone{made})
    case CWFail{fail}: IO.pure(CW, CWFail{fail})
    case CWNext{bc}: cw_stage2(bc, repo, branch, path)

def cw_stage1_ok(ok: Bool, out: String, base: String) -> CW:
  match ok:
    case True{}: CWNext{Tx.trim_nl(out)}
    case False{}: CWFail{T.FUnknownBase{base}}

def cw_stage1_pick(r: T.GitOut, base: String) -> CW:
  match r:
    case T.GRun{code, out}: cw_stage1_ok(U32.is_eq(code, 0), out, base)
    case T.GBroken{detail}: CWFail{T.FCmd{"create-worktree", detail}}

def cw_stage1(repo: String, branch: String, path: String, base: String) -> IO(CW):
  +b2 = base
  do IO<CW>:
    r : T.GitOut <- Git.runGit(repo, Con{"rev-parse", Con{"--verify", Con{"--quiet", Con{Tx.str_cat(b2, "^{commit}"), Nil{}}}}})
    IO.pure(CW, cw_stage1_pick(r, b2))

def createWorktree(repo: String, branch: String, path: String, base: String) -> IO(Result<&1, &1, T.GitFail, T.WorktreeCreated>):
  +repo2 = repo
  +br2 = branch
  +p2 = path
  +b2 = base
  do IO<Result<&1, &1, T.GitFail, T.WorktreeCreated>>:
    r1 : CW <- cw_stage1(repo2, br2, p2, b2)
    r2 : CW <- cw_go2(r1, repo2, br2, p2)
    r3 : CW <- cw_go3(r2, repo2, br2, p2)
    r4 : CW <- cw_go4(r3, repo2, br2, p2)
    cw_answer(r4)

def is_branch_exists_fail(r: Result<&1, &1, T.GitFail, T.WorktreeCreated>) -> String:
  match r:
    case Fail{T.FBranchExists{branch}}: ""
    case Fail{fail}: Tx.str_cat("expected branch-exists, got: ", Tx.trim_nl(T.fail_text(fail)))
    case Done{made}: "expected branch-exists refusal, create succeeded"

def is_path_exists_fail(r: Result<&1, &1, T.GitFail, T.WorktreeCreated>) -> String:
  match r:
    case Fail{T.FPathExists{path}}: ""
    case Fail{fail}: Tx.str_cat("expected path-exists, got: ", Tx.trim_nl(T.fail_text(fail)))
    case Done{made}: "expected path-exists refusal, create succeeded"

def is_unknown_base_fail(r: Result<&1, &1, T.GitFail, T.WorktreeCreated>) -> String:
  match r:
    case Fail{T.FUnknownBase{base}}: ""
    case Fail{fail}: Tx.str_cat("expected unknown-base, got: ", Tx.trim_nl(T.fail_text(fail)))
    case Done{made}: "expected unknown-base refusal, create succeeded"

def created_commit(m: T.WorktreeCreated) -> String:
  match m:
    case T.WCreated{branch, path, commit}: commit

# Unwrap a create answer for callers that handle refusals elsewhere.
def create_of(r: Result<&1, &1, T.GitFail, T.WorktreeCreated>) -> T.WorktreeCreated:
  match r:
    case Done{value}: value
    case Fail{fail}: T.WCreated{SNil{}, SNil{}, SNil{}}
