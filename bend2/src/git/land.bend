# land: advance the target branch to include a worker's committed tip. The
# answer names the target commit after the advance, or the reason it was
# refused: the worker commit is already contained, the merge is not a
# fast-forward, or the target moved during the update.

import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git

type LD is Data:
  LDDone{outcome: T.LandOutcome}
  LDNext{workerCommit: String, targetBefore: String}

def ld_answer(r: LD) -> IO(T.LandOutcome):
  match r:
    case LDDone{outcome}: IO.pure(T.LandOutcome, outcome)
    case LDNext{wc, tb}: IO.pure(T.LandOutcome, T.LBlocked{"unreachable stage"})

# Stage 1: resolve the worker branch to a commit.
def ld_stage1_ok(ok: Bool, out: String) -> LD:
  match ok:
    case True{}: LDNext{Tx.trim_nl(out), ""}
    case False{}: LDDone{T.LBlocked{"worker branch not found"}}

def ld_stage1_pick(r: T.GitOut) -> LD:
  match r:
    case T.GRun{code, out}: ld_stage1_ok(U32.is_eq(code, 0), out)
    case T.GBroken{detail}: LDDone{T.LBlocked{detail}}

def ld_stage1(repo: String, workerBranch: String) -> IO(LD):
  +wb = workerBranch
  +rp = repo
  do IO<LD>:
    r : T.GitOut <- Git.runGit(rp, Con{"rev-parse", Con{"--verify", Con{"--quiet", Con{Tx.str_cat("refs/heads/", wb), Nil{}}}}})
    IO.pure(LD, ld_stage1_pick(r))

# Stage 2: check if the target already contains the worker commit.
def ld_stage2_ancestor(ok: Bool, wc: String) -> LD:
  match ok:
    case True{}: LDDone{T.LAlready{wc}}
    case False{}: LDNext{wc, ""}

def ld_stage2_pick(r: T.GitOut, wc: String) -> LD:
  match r:
    case T.GRun{code, out}: ld_stage2_ancestor(U32.is_eq(code, 0), wc)
    case T.GBroken{detail}: LDDone{T.LBlocked{detail}}

def ld_stage2(wc: String, repo: String, target: String) -> IO(LD):
  +wc2 = wc
  +rp = repo
  +tg = target
  do IO<LD>:
    r : T.GitOut <- Git.runGit(rp, Con{"merge-base", Con{"--is-ancestor", Con{wc2, Con{tg, Nil{}}}}})
    IO.pure(LD, ld_stage2_pick(r, wc2))

def ld_go2(r: LD, repo: String, target: String) -> IO(LD):
  match r:
    case LDDone{outcome}: IO.pure(LD, LDDone{outcome})
    case LDNext{wc, tb}: ld_stage2(wc, repo, target)

# Stage 3: record the current target HEAD.
def ld_stage3_ok(ok: Bool, out: String, wc: String) -> LD:
  match ok:
    case True{}: LDNext{wc, Tx.trim_nl(out)}
    case False{}: LDDone{T.LBlocked{"target branch not found"}}

def ld_stage3_pick(r: T.GitOut, wc: String) -> LD:
  match r:
    case T.GRun{code, out}: ld_stage3_ok(U32.is_eq(code, 0), out, wc)
    case T.GBroken{detail}: LDDone{T.LBlocked{detail}}

def ld_stage3(wc: String, repo: String, target: String) -> IO(LD):
  +wc2 = wc
  +rp = repo
  +tg = target
  do IO<LD>:
    r : T.GitOut <- Git.runGit(rp, Con{"rev-parse", Con{"--verify", Con{"--quiet", Con{Tx.str_cat("refs/heads/", tg), Nil{}}}}})
    IO.pure(LD, ld_stage3_pick(r, wc2))

def ld_go3(r: LD, repo: String, target: String) -> IO(LD):
  match r:
    case LDDone{outcome}: IO.pure(LD, LDDone{outcome})
    case LDNext{wc, tb}: ld_stage3(wc, repo, target)

# Stage 4: verify the target is an ancestor of the worker (fast-forward).
def ld_stage4_ff(ok: Bool, wc: String, tb: String) -> LD:
  match ok:
    case True{}: LDNext{wc, tb}
    case False{}: LDDone{T.LBlocked{"not a fast-forward; rebase the worker branch onto the target"}}

def ld_stage4_pick(r: T.GitOut, wc: String, tb: String) -> LD:
  match r:
    case T.GRun{code, out}: ld_stage4_ff(U32.is_eq(code, 0), wc, tb)
    case T.GBroken{detail}: LDDone{T.LBlocked{detail}}

def ld_stage4(wc: String, tb: String, repo: String, target: String) -> IO(LD):
  +wc2 = wc
  +tb2 = tb
  +rp = repo
  +tg = target
  do IO<LD>:
    r : T.GitOut <- Git.runGit(rp, Con{"merge-base", Con{"--is-ancestor", Con{tg, Con{wc2, Nil{}}}}})
    IO.pure(LD, ld_stage4_pick(r, wc2, tb2))

def ld_go4(r: LD, repo: String, target: String) -> IO(LD):
  match r:
    case LDDone{outcome}: IO.pure(LD, LDDone{outcome})
    case LDNext{wc, tb}: ld_stage4(wc, tb, repo, target)

# Stage 5: CAS update-ref to advance the target branch.
def ld_stage5_ok(ok: Bool, wc: String, target: String) -> LD:
  match ok:
    case True{}: LDDone{T.LLanded{target, wc}}
    case False{}: LDDone{T.LBlocked{"target moved during landing; retry"}}

def ld_stage5_pick(r: T.GitOut, wc: String, target: String) -> LD:
  match r:
    case T.GRun{code, out}: ld_stage5_ok(U32.is_eq(code, 0), wc, target)
    case T.GBroken{detail}: LDDone{T.LBlocked{detail}}

def ld_stage5(wc: String, tb: String, repo: String, target: String) -> IO(LD):
  +wc2 = wc
  +tb2 = tb
  +rp = repo
  +tg = target
  do IO<LD>:
    r : T.GitOut <- Git.runGit(rp, Con{"update-ref", Con{Tx.str_cat("refs/heads/", tg), Con{wc2, Con{tb2, Nil{}}}}})
    IO.pure(LD, ld_stage5_pick(r, wc2, tg))

def ld_go5(r: LD, repo: String, target: String) -> IO(LD):
  match r:
    case LDDone{outcome}: IO.pure(LD, LDDone{outcome})
    case LDNext{wc, tb}: ld_stage5(wc, tb, repo, target)

def land(repo: String, workerBranch: String, target: String) -> IO(T.LandOutcome):
  +rp = repo
  +tg = target
  do IO<T.LandOutcome>:
    r1 : LD <- ld_stage1(rp, workerBranch)
    r2 : LD <- ld_go2(r1, rp, tg)
    r3 : LD <- ld_go3(r2, rp, tg)
    r4 : LD <- ld_go4(r3, rp, tg)
    r5 : LD <- ld_go5(r4, rp, tg)
    ld_answer(r5)

def outcome_json(o: T.LandOutcome) -> String:
  match o:
    case T.LLanded{target, commit}: "{\"status\":\"landed\",\"target\":\"" ++ target ++ "\",\"commit\":\"" ++ commit ++ "\"}"
    case T.LAlready{commit}: "{\"status\":\"already\",\"commit\":\"" ++ commit ++ "\"}"
    case T.LConflict{files, dir}: "{\"status\":\"conflict\",\"files\":\"" ++ files ++ "\",\"dir\":\"" ++ dir ++ "\"}"
    case T.LBlocked{reason}: "{\"status\":\"blocked\",\"reason\":\"" ++ reason ++ "\"}"
