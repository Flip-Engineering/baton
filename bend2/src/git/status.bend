# worktree-status: the observed state of one worktree, for worker reports.
# The answer names the checked-out branch, the commit it is at, and whether
# the worktree carries uncommitted or untracked changes.

import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git

# The status pipeline state: done, refused, or branch and commit in hand.
type WS is Data:
  WSDone{made: T.WtStatus}
  WSFail{fail: T.GitFail}
  WSNext{branch: String, commit: String}

def ws_answer(r: WS) -> IO(Result<&1, &1, T.GitFail, T.WtStatus>):
  match r:
    case WSDone{made}: IO.pure(Result<&1, &1, T.GitFail, T.WtStatus>, Done{made})
    case WSFail{fail}: IO.pure(Result<&1, &1, T.GitFail, T.WtStatus>, Fail{fail})
    case WSNext{branch, commit}: IO.pure(Result<&1, &1, T.GitFail, T.WtStatus>, Fail{T.FCmd{"worktree-status", "unreachable stage"}})

def ws_stage3_ok(ok: Bool, out: String, branch: String, commit: String) -> WS:
  match ok:
    case True{}: WSDone{T.Wt{branch, commit, Tx.non_empty(out)}}
    case False{}: WSFail{T.FCmd{"worktree-status", Tx.trim_nl(out)}}

def ws_stage3_pick(r: T.GitOut, branch: String, commit: String) -> WS:
  match r:
    case T.GRun{code, out}: ws_stage3_ok(U32.is_eq(code, 0), out, branch, commit)
    case T.GBroken{detail}: WSFail{T.FCmd{"worktree-status", detail}}

def ws_stage3(branch: String, commit: String, path: String) -> IO(WS):
  +p2 = path
  do IO<WS>:
    r : T.GitOut <- Git.runGit(p2, Con{"status", Con{"--porcelain", Nil{}}})
    IO.pure(WS, ws_stage3_pick(r, branch, commit))

def ws_go3(r: WS, path: String) -> IO(WS):
  match r:
    case WSDone{made}: IO.pure(WS, WSDone{made})
    case WSFail{fail}: IO.pure(WS, WSFail{fail})
    case WSNext{branch, commit}: ws_stage3(branch, commit, path)

def ws_stage2_ok(ok: Bool, out: String, branch: String) -> WS:
  match ok:
    case True{}: WSNext{branch, Tx.trim_nl(out)}
    case False{}: WSFail{T.FCmd{"worktree-status", Tx.trim_nl(out)}}

def ws_stage2_pick(r: T.GitOut, branch: String, path: String) -> WS:
  match r:
    case T.GRun{code, out}: ws_stage2_ok(U32.is_eq(code, 0), out, branch)
    case T.GBroken{detail}: WSFail{T.FCmd{"worktree-status", detail}}

def ws_stage2(branch: String, path: String) -> IO(WS):
  +p2 = path
  do IO<WS>:
    r : T.GitOut <- Git.runGit(p2, Con{"rev-parse", Con{"HEAD", Nil{}}})
    IO.pure(WS, ws_stage2_pick(r, branch, p2))

def ws_go2(r: WS, path: String) -> IO(WS):
  match r:
    case WSDone{made}: IO.pure(WS, WSDone{made})
    case WSFail{fail}: IO.pure(WS, WSFail{fail})
    case WSNext{branch, commit}: ws_stage2(branch, path)

def ws_stage1_ok(ok: Bool, out: String) -> WS:
  match ok:
    case True{}: WSNext{Tx.trim_nl(out), SNil{}}
    case False{}: WSFail{T.FCmd{"worktree-status", Tx.trim_nl(out)}}

def ws_stage1_pick(r: T.GitOut, path: String) -> WS:
  match r:
    case T.GRun{code, out}: ws_stage1_ok(U32.is_eq(code, 0), out)
    case T.GBroken{detail}: WSFail{T.FCmd{"worktree-status", detail}}

def ws_stage1(path: String) -> IO(WS):
  +p2 = path
  do IO<WS>:
    r : T.GitOut <- Git.runGit(p2, Con{"rev-parse", Con{"--abbrev-ref", Con{"HEAD", Nil{}}}})
    IO.pure(WS, ws_stage1_pick(r, p2))

def worktreeStatus(path: String) -> IO(Result<&1, &1, T.GitFail, T.WtStatus>):
  +p2 = path
  do IO<Result<&1, &1, T.GitFail, T.WtStatus>>:
    r1 : WS <- ws_stage1(p2)
    r2 : WS <- ws_go2(r1, p2)
    r3 : WS <- ws_go3(r2, p2)
    ws_answer(r3)

def status_clean_fail(r: Result<&1, &1, T.GitFail, T.WtStatus>, base: String) -> String:
  match r:
    case Done{T.Wt{branch, commit, dirty}}:
      Bool.pick(String, Tx.str_eq(commit, base), Bool.pick(String, Bool.not(dirty), "", "status: worktree unexpectedly dirty"), "status: commit mismatch")
    case Done{made}: "status: bad"
    case Fail{fail}: Tx.str_cat("status refused: ", Tx.trim_nl(T.fail_text(fail)))

def status_dirty_fail(r: Result<&1, &1, T.GitFail, T.WtStatus>, base: String) -> String:
  match r:
    case Done{T.Wt{branch, commit, dirty}}:
      Bool.pick(String, dirty, "", "status: dirty flag missing after touch")
    case Done{made}: "status: bad"
    case Fail{fail}: Tx.str_cat("status refused: ", Tx.trim_nl(T.fail_text(fail)))
