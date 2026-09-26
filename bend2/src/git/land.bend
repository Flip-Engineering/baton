# land: one squashed landing of a committed worker tip onto a target branch.
# The candidate is prepared in a scratch worktree detached at the target tip,
# so the worker's own commits and worktree stay untouched. Each selected
# check file runs on the candidate and on a detached tree at the target tip;
# a candidate failure blocks unless the target run shows the same failure
# identity (file, test, failure type, code) as AGENTS.md requires. A run with
# no verdict blocks. The target advances through update-ref with the observed
# tip as the old value, so the branch moves only while it still matches the
# prepared basis. A target that moved meanwhile rebases the candidate once
# and lands on the check result it already has; a rebase conflict returns the
# paths and keeps the candidate worktree for the requester. A landing whose
# worker commit the target already contains answers LAlready without
# preparing anything.
#
# Check contract: check is the path of a shell script, run as
#   /bin/sh <check> <selected-file>
# inside the checked tree, one run per selected file per tree. A passing run
# exits 0. A failing run names each failure on one output line as four
# hex-encoded fields separated by single spaces: file, test, failure type,
# and the stable semantic code ("-" when the tool supplies none). Hex
# encoding lets any name travel through the space-separated line, so an exact
# line match after validation is an exact identity match. Any other output
# line makes the run unjudged, and an unjudged run blocks the landing.
#
# Both scratch worktrees (the candidate and the target tree named by
# appending "-target") are retained for inspection; cleanup is explicit.

import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git

# How one selected check file behaved on one tree: pass, fail with the hex
# identity block its output carried, or no verdict.
# The fast-forward landing below is the coordinator's current entry point;
# land_checked is the gated landing described in target-architecture.md.


type FFLD is Data:
  FFDone{outcome: T.LandOutcome}
  FFNext{workerCommit: String, targetBefore: String}

def ff_answer(r: FFLD) -> IO(T.LandOutcome):
  match r:
    case FFDone{outcome}: IO.pure(T.LandOutcome, outcome)
    case FFNext{wc, tb}: IO.pure(T.LandOutcome, T.LBlocked{"unreachable stage"})

# Stage 1: resolve the worker branch to a commit.
def ff_stage1_ok(ok: Bool, out: String) -> FFLD:
  match ok:
    case True{}: FFNext{Tx.trim_nl(out), ""}
    case False{}: FFDone{T.LBlocked{"worker branch not found"}}

def ff_stage1_pick(r: T.GitOut) -> FFLD:
  match r:
    case T.GRun{code, out}: ff_stage1_ok(U32.is_eq(code, 0), out)
    case T.GBroken{detail}: FFDone{T.LBlocked{detail}}

def ff_stage1(repo: String, workerBranch: String) -> IO(FFLD):
  +wb = workerBranch
  +rp = repo
  do IO<FFLD>:
    r : T.GitOut <- Git.runGit(rp, Con{"rev-parse", Con{"--verify", Con{"--quiet", Con{Tx.str_cat("refs/heads/", wb), Nil{}}}}})
    IO.pure(FFLD, ff_stage1_pick(r))

# Stage 2: check if the target already contains the worker commit.
def ff_stage2_ancestor(ok: Bool, wc: String) -> FFLD:
  match ok:
    case True{}: FFDone{T.LAlready{wc}}
    case False{}: FFNext{wc, ""}

def ff_stage2_pick(r: T.GitOut, wc: String) -> FFLD:
  match r:
    case T.GRun{code, out}: ff_stage2_ancestor(U32.is_eq(code, 0), wc)
    case T.GBroken{detail}: FFDone{T.LBlocked{detail}}

def ff_stage2(wc: String, repo: String, target: String) -> IO(FFLD):
  +wc2 = wc
  +rp = repo
  +tg = target
  do IO<FFLD>:
    r : T.GitOut <- Git.runGit(rp, Con{"merge-base", Con{"--is-ancestor", Con{wc2, Con{tg, Nil{}}}}})
    IO.pure(FFLD, ff_stage2_pick(r, wc2))

def ff_go2(r: FFLD, repo: String, target: String) -> IO(FFLD):
  match r:
    case FFDone{outcome}: IO.pure(FFLD, FFDone{outcome})
    case FFNext{wc, tb}: ff_stage2(wc, repo, target)

# Stage 3: record the current target HEAD.
def ff_stage3_ok(ok: Bool, out: String, wc: String) -> FFLD:
  match ok:
    case True{}: FFNext{wc, Tx.trim_nl(out)}
    case False{}: FFDone{T.LBlocked{"target branch not found"}}

def ff_stage3_pick(r: T.GitOut, wc: String) -> FFLD:
  match r:
    case T.GRun{code, out}: ff_stage3_ok(U32.is_eq(code, 0), out, wc)
    case T.GBroken{detail}: FFDone{T.LBlocked{detail}}

def ff_stage3(wc: String, repo: String, target: String) -> IO(FFLD):
  +wc2 = wc
  +rp = repo
  +tg = target
  do IO<FFLD>:
    r : T.GitOut <- Git.runGit(rp, Con{"rev-parse", Con{"--verify", Con{"--quiet", Con{Tx.str_cat("refs/heads/", tg), Nil{}}}}})
    IO.pure(FFLD, ff_stage3_pick(r, wc2))

def ff_go3(r: FFLD, repo: String, target: String) -> IO(FFLD):
  match r:
    case FFDone{outcome}: IO.pure(FFLD, FFDone{outcome})
    case FFNext{wc, tb}: ff_stage3(wc, repo, target)

# Stage 4: verify the target is an ancestor of the worker (fast-forward).
def ff_stage4_ff(ok: Bool, wc: String, tb: String) -> FFLD:
  match ok:
    case True{}: FFNext{wc, tb}
    case False{}: FFDone{T.LBlocked{"not a fast-forward; rebase the worker branch onto the target"}}

def ff_stage4_pick(r: T.GitOut, wc: String, tb: String) -> FFLD:
  match r:
    case T.GRun{code, out}: ff_stage4_ff(U32.is_eq(code, 0), wc, tb)
    case T.GBroken{detail}: FFDone{T.LBlocked{detail}}

def ff_stage4(wc: String, tb: String, repo: String, target: String) -> IO(FFLD):
  +wc2 = wc
  +tb2 = tb
  +rp = repo
  +tg = target
  do IO<FFLD>:
    r : T.GitOut <- Git.runGit(rp, Con{"merge-base", Con{"--is-ancestor", Con{tg, Con{wc2, Nil{}}}}})
    IO.pure(FFLD, ff_stage4_pick(r, wc2, tb2))

def ff_go4(r: FFLD, repo: String, target: String) -> IO(FFLD):
  match r:
    case FFDone{outcome}: IO.pure(FFLD, FFDone{outcome})
    case FFNext{wc, tb}: ff_stage4(wc, tb, repo, target)

# Stage 5: CAS update-ref to advance the target branch.
def ff_stage5_ok(ok: Bool, wc: String, target: String) -> FFLD:
  match ok:
    case True{}: FFDone{T.LLanded{target, wc}}
    case False{}: FFDone{T.LBlocked{"target moved during landing; retry"}}

def ff_stage5_pick(r: T.GitOut, wc: String, target: String) -> FFLD:
  match r:
    case T.GRun{code, out}: ff_stage5_ok(U32.is_eq(code, 0), wc, target)
    case T.GBroken{detail}: FFDone{T.LBlocked{detail}}

def ff_stage5(wc: String, tb: String, repo: String, target: String) -> IO(FFLD):
  +wc2 = wc
  +tb2 = tb
  +rp = repo
  +tg = target
  do IO<FFLD>:
    r : T.GitOut <- Git.runGit(rp, Con{"update-ref", Con{Tx.str_cat("refs/heads/", tg), Con{wc2, Con{tb2, Nil{}}}}})
    IO.pure(FFLD, ff_stage5_pick(r, wc2, tg))

def ff_go5(r: FFLD, repo: String, target: String) -> IO(FFLD):
  match r:
    case FFDone{outcome}: IO.pure(FFLD, FFDone{outcome})
    case FFNext{wc, tb}: ff_stage5(wc, tb, repo, target)

def land_fast_forward(repo: String, workerBranch: String, target: String) -> IO(T.LandOutcome):
  +rp = repo
  +tg = target
  do IO<T.LandOutcome>:
    r1 : FFLD <- ff_stage1(rp, workerBranch)
    r2 : FFLD <- ff_go2(r1, rp, tg)
    r3 : FFLD <- ff_go3(r2, rp, tg)
    r4 : FFLD <- ff_go4(r3, rp, tg)
    r5 : FFLD <- ff_go5(r4, rp, tg)
    ff_answer(r5)

def outcome_json(o: T.LandOutcome) -> String:
  match o:
    case T.LLanded{target, commit}: "{\"status\":\"landed\",\"target\":\"" ++ target ++ "\",\"commit\":\"" ++ commit ++ "\"}"
    case T.LAlready{commit}: "{\"status\":\"already\",\"commit\":\"" ++ commit ++ "\"}"
    case T.LConflict{files, dir}: "{\"status\":\"conflict\",\"files\":\"" ++ files ++ "\",\"dir\":\"" ++ dir ++ "\"}"
    case T.LBlocked{reason}: "{\"status\":\"blocked\",\"reason\":\"" ++ reason ++ "\"}"

type Verdict is Data:
  VPass{}
  VFail{hex: String}
  VNone{why: String}

# One selected file paired with its verdict.
type FV is Data:
  FV{file: String, v: Verdict}

# One selected file with its candidate and target verdicts.
type PV is Data:
  PV{file: String, cv: Verdict, tv: Verdict}

# The landing pipeline state: finished, refused, or carrying the values the
# next stage needs. LdRe reports a candidate rebased onto a moved target; the
# pipeline advances it once more and refuses if the target moves again.
type Ld is Data:
  LdDone{made: T.LandOutcome}
  LdFail{fail: T.GitFail}
  LdWk{worker: String}
  LdTip{worker: String, tip: String}
  LdCand{tip: String, cand: String}
  LdRe{cand: String, basis: String}

def ld_unreach() -> IO(Ld):
  IO.pure(Ld, LdFail{T.FCmd{"land", "unreachable stage"}})

# The check argv for one selected file.
def check_argv(script: String, file: String) -> List<String>:
  +s2 = script
  Con{"/bin/sh", Con{s2, Con{file, Nil{}}}}

# One output line as a failure identity: exactly four hex-encoded fields.
def hex_digit_ok(c: Char) -> Bool:
  +code = Char.to_u32(c)
  +lo1 = U32.is_lt(47, code)
  +hi1 = U32.is_lt(code, 58)
  +is_dg = Bool.pick(Bool, lo1, hi1, False{})
  +lo2 = U32.is_lt(96, code)
  +hi2 = U32.is_lt(code, 103)
  +is_lo = Bool.pick(Bool, lo2, hi2, False{})
  +lo3 = U32.is_lt(64, code)
  +hi3 = U32.is_lt(code, 71)
  +is_up = Bool.pick(Bool, lo3, hi3, False{})
  +dg_or_lo = Bool.pick(Bool, is_dg, True{}, is_lo)
  Bool.pick(Bool, dg_or_lo, True{}, is_up)

def hex_ok_go(s: String, ok: Bool) -> Bool:
  match s:
    case SNil{}: ok
    case SCon{c, rest}:
      +o2 = Bool.pick(Bool, ok, hex_digit_ok(c), False{})
      hex_ok_go(rest, o2)

def hex_ok(s: String) -> Bool:
  +s2 = s
  +ne = Tx.non_empty(s2)
  hex_ok_go(s2, ne)

def count_go(fs: List<String>, n: U32) -> U32:
  match fs:
    case Nil{}: n
    case Con{h, rest}:
      +n2 = U32.add(n, 1)
      count_go(rest, n2)

def all_hex_go(fs: List<String>, ok: Bool) -> Bool:
  match fs:
    case Nil{}: ok
    case Con{h, rest}:
      +o2 = Bool.pick(Bool, ok, hex_ok(h), False{})
      all_hex_go(rest, o2)

def fields_ok(n: U32, hexok: Bool) -> Bool:
  +n4 = Bool.pick(Bool, U32.is_eq(n, 4), hexok, False{})
  n4

def line_ok(line: String) -> Bool:
  +l2 = line
  fields_ok(count_go(Tx.split_spaces(l2), 0), all_hex_go(Tx.split_spaces(l2), True{}))

def block_ok_go(lines: List<String>, ok: Bool) -> Bool:
  match lines:
    case Nil{}: ok
    case Con{line, rest}:
      +l2 = line
      +o2 = Bool.pick(Bool, ok, line_ok(l2), False{})
      block_ok_go(rest, o2)

def block_ok(block: String) -> Bool:
  block_ok_go(Tx.split_lines(block), True{})

def block_has_go(lines: List<String>, want: String) -> Bool:
  match lines:
    case Nil{}: False{}
    case Con{h, rest}:
      +w2 = want
      +hit = Tx.str_eq(h, w2)
      Bool.pick(Bool, hit, True{}, block_has_go(rest, w2))

def block_has(block: String, want: String) -> Bool:
  block_has_go(Tx.split_lines(block), want)

def exit_fail_ok(ok: Bool, block: String, file: String) -> FV:
  match ok:
    case True{}: FV{file, VFail{block}}
    case False{}: FV{file, VNone{"check output is not failure identities"}}

def exit_fail(block: String, file: String) -> FV:
  +b2 = block
  exit_fail_ok(block_ok(b2), b2, file)

def exit_verdict(ok: Bool, out: String, file: String) -> FV:
  match ok:
    case True{}: FV{file, VPass{}}
    case False{}: exit_fail(Tx.join("\n", Tx.split_lines(out)), file)

def run_verdict(r: T.RunRes, file: String) -> FV:
  match r:
    case T.RRun{T.SExit{code}, out}: exit_verdict(U32.is_eq(code, 0), out, file)
    case T.RRun{T.SSignal{num}, out}: FV{file, VNone{"check killed by signal"}}
    case T.RSpawn{detail}: FV{file, VNone{detail}}

def run_check(dir: String, script: String, file: String) -> IO(FV):
  +d2 = dir
  +s2 = script
  +f2 = file
  do IO<FV>:
    r : T.RunRes <- Git.runFull(check_argv(s2, f2), d2)
    IO.pure(FV, run_verdict(r, f2))

# The list with the element prepended only when the flag holds.
def append_when(keep: Bool, f: String, acc: List<String>) -> List<String>:
  match keep:
    case True{}: Con{f, acc}
    case False{}: acc

# The candidate failure lines its target run does not show.
def new_lines_go(cand: List<String>, targ: String, acc: List<String>) -> List<String>:
  match cand:
    case Nil{}: List.reverse(&1, String, acc)
    case Con{h, rest}:
      +h2 = h
      +t2 = targ
      new_lines_go(rest, t2, append_when(Bool.not(block_has(t2, h2)), h2, acc))

# The line naming one unjudged run; it never matches a hex identity line, so
# an unjudged run always blocks.
def unjudged_line(side: String, why: String) -> String:
  Tx.str_cat("?unjudged ", T.str_cat3(side, ": ", why))

def pair_targ(hex: String, tv: Verdict, file: String, acc: List<String>) -> List<String>:
  match tv:
    case VPass{}: Con{Tx.str_cat("?uncovered: ", hex), acc}
    case VFail{thex}: new_lines_go(Tx.split_lines(hex), thex, acc)
    case VNone{why}: Con{unjudged_line("target", T.str_cat3(file, ": ", why)), acc}

def pair_cv(cv: Verdict, tv: Verdict, file: String, acc: List<String>) -> List<String>:
  match cv:
    case VPass{}: acc
    case VFail{hex}: pair_targ(hex, tv, file, acc)
    case VNone{why}: Con{unjudged_line("candidate", T.str_cat3(file, ": ", why)), acc}

def pair_news(pv: PV, acc: List<String>) -> List<String>:
  match pv:
    case PV{file, cv, tv}: pair_cv(cv, tv, file, acc)

def pairs_news_go(pvs: List<PV>, acc: List<String>) -> List<String>:
  match pvs:
    case Nil{}: List.reverse(&1, String, acc)
    case Con{pv, rest}: pairs_news_go(rest, pair_news(pv, acc))

def fv_verdict(fv: FV) -> Verdict:
  match fv:
    case FV{file, v}: v

# Per selected file: one check run on the candidate, then one on the target.
def run_pair_go(script: String, files: List<String>, candTree: String, targTree: String, acc: List<PV>) -> IO(List<PV>):
  match files:
    case Nil{}: IO.pure(List<PV>, List.reverse(&1, PV, acc))
    case Con{f, rest}:
      +s2 = script
      +ct2 = candTree
      +tt2 = targTree
      +f2 = f
      do IO<List<PV>>:
        cfv : FV <- run_check(ct2, s2, f2)
        tfv : FV <- run_check(tt2, s2, f2)
        run_pair_go(s2, rest, ct2, tt2, Con{PV{f2, fv_verdict(cfv), fv_verdict(tfv)}, acc})

def pairs_news(pvs: List<PV>) -> List<String>:
  pairs_news_go(pvs, Nil{})

def run_pairs(script: String, files: List<String>, candTree: String, targTree: String) -> IO(List<PV>):
  +s2 = script
  +ct2 = candTree
  +tt2 = targTree
  run_pair_go(s2, files, ct2, tt2, Nil{})

# The branch line a worktree report carries when it holds the target.
def ld_busy_branch(target: String) -> String:
  Tx.str_cat("branch refs/heads/", target)

def ld_busy_any(lines: List<String>, want: String) -> Bool:
  match lines:
    case Nil{}: False{}
    case Con{h, rest}:
      +w2 = want
      +hit = Tx.str_eq(h, w2)
      Bool.pick(Bool, hit, True{}, ld_busy_any(rest, w2))

def ld_update_ok(ok: Bool, out: String, target: String, cand: String) -> Ld:
  match ok:
    case True{}: LdDone{T.LLanded{target, cand}}
    case False{}: LdFail{T.FCmd{"land", out}}

def ld_update_pick(g: T.GitOut, target: String, cand: String) -> Ld:
  match g:
    case T.GRun{code, out}: ld_update_ok(U32.is_eq(code, 0), Tx.trim_nl(out), target, cand)
    case T.GBroken{detail}: LdFail{T.FCmd{"land", detail}}

def ld_conflict_of(has: Bool, paths: String, scratch: String, why: String) -> Ld:
  match has:
    case True{}: LdDone{T.LConflict{paths, scratch}}
    case False{}: LdFail{T.FCmd{"land", why}}

def ld_unmerged_pick_go(paths: String, scratch: String, why: String) -> Ld:
  +p2 = paths
  ld_conflict_of(Tx.non_empty(p2), p2, scratch, why)

def ld_unmerged_pick(g: T.GitOut, scratch: String, why: String) -> Ld:
  match g:
    case T.GRun{code, out}: ld_unmerged_pick_go(Tx.join("\n", Tx.split_lines(out)), scratch, why)
    case T.GBroken{detail}: LdFail{T.FCmd{"land", detail}}

def ld_unmerged(scratch: String, why: String) -> IO(Ld):
  +sc = scratch
  +w2 = why
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(sc, ["diff", "--name-only", "--diff-filter=U"])
    IO.pure(Ld, ld_unmerged_pick(g, sc, w2))

def ld_adv_next(last: Bool, cand: String, basis: String) -> IO(Ld):
  match last:
    case True{}: IO.pure(Ld, LdFail{T.FCmd{"land", Tx.str_cat("target moved again: ", basis)}})
    case False{}: IO.pure(Ld, LdRe{cand, basis})

def ld_adv_head_ok(ok: Bool, cand: String, basis: String, last: Bool) -> IO(Ld):
  match ok:
    case True{}: ld_adv_next(last, cand, basis)
    case False{}: IO.pure(Ld, LdFail{T.FCmd{"land", "no candidate commit after rebase"}})

def ld_adv_head_pick(g: T.GitOut, basis: String, scratch: String, last: Bool) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_adv_head_ok(U32.is_eq(code, 0), Tx.trim_nl(out), basis, last)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_adv_head(basis: String, scratch: String, last: Bool) -> IO(Ld):
  +b2 = basis
  +s2 = scratch
  +l2 = last
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(s2, ["rev-parse", "HEAD"])
    ld_adv_head_pick(g, b2, s2, l2)

def ld_adv_rb_ok(ok: Bool, out: String, basis: String, cur: String, scratch: String, last: Bool) -> IO(Ld):
  match ok:
    case True{}: ld_adv_head(cur, scratch, last)
    case False{}: ld_unmerged(scratch, out)

def ld_adv_rb_pick(g: T.GitOut, basis: String, cur: String, scratch: String, last: Bool) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_adv_rb_ok(U32.is_eq(code, 0), Tx.trim_nl(out), basis, cur, scratch, last)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_adv_rebase(basis: String, cur: String, scratch: String, last: Bool) -> IO(Ld):
  +b2 = basis
  +c2 = cur
  +s2 = scratch
  +l2 = last
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(s2, ["rebase", "--onto", c2, b2])
    ld_adv_rb_pick(g, b2, c2, s2, l2)

def ld_adv_update(repo: String, target: String, cand: String, basis: String) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["update-ref", Tx.str_cat("refs/heads/", t2), c2, b2])
    IO.pure(Ld, ld_update_pick(g, t2, c2))

def ld_adv_same(same: Bool, cur: String, repo: String, target: String, cand: String, basis: String, scratch: String, last: Bool) -> IO(Ld):
  match same:
    case True{}: ld_adv_update(repo, target, cand, basis)
    case False{}: ld_adv_rebase(basis, cur, scratch, last)

def ld_adv_tip_pick(g: T.GitOut, repo: String, target: String, cand: String, basis: String, scratch: String, last: Bool) -> IO(Ld):
  match g:
    case T.GRun{code, out}:
      +b2 = basis
      +o2 = Tx.trim_nl(out)
      ld_adv_same(Tx.str_eq(o2, b2), o2, repo, target, cand, b2, scratch, last)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_adv_tip(repo: String, target: String, cand: String, basis: String, scratch: String, last: Bool) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  +s2 = scratch
  +l2 = last
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["rev-parse", "--verify", Tx.str_cat(t2, "^{commit}")])
    ld_adv_tip_pick(g, r2, t2, c2, b2, s2, l2)

def ld_adv_busy_go(busy: Bool, repo: String, target: String, cand: String, basis: String, scratch: String, last: Bool) -> IO(Ld):
  match busy:
    case True{}: IO.pure(Ld, LdFail{T.FTargetBusy{target}})
    case False{}: ld_adv_tip(repo, target, cand, basis, scratch, last)

def ld_adv_busy(g: T.GitOut, repo: String, target: String, cand: String, basis: String, scratch: String, last: Bool) -> IO(Ld):
  match g:
    case T.GRun{code, out}:
      +t3 = target
      ld_adv_busy_go(ld_busy_any(Tx.split_lines(out), ld_busy_branch(t3)), repo, t3, cand, basis, scratch, last)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

# One advance attempt: refuse a target held by a worktree, update the branch
# only while it still matches the basis, and rebase the candidate onto a
# moved target. `last` refuses a second move; the pipeline routes LdRe back
# here once with `last` set.
def ld_advance(repo: String, target: String, cand: String, basis: String, scratch: String, last: Bool) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  +s2 = scratch
  +l2 = last
  do IO<Ld>:
    gl : T.GitOut <- Git.runGit(r2, ["worktree", "list", "--porcelain"])
    ld_adv_busy(gl, r2, t2, c2, b2, s2, l2)

def ld_advance1(repo: String, target: String, cand: String, basis: String, scratch: String) -> IO(Ld):
  ld_advance(repo, target, cand, basis, scratch, False{})

def ld_advance2(repo: String, target: String, cand: String, basis: String, scratch: String) -> IO(Ld):
  ld_advance(repo, target, cand, basis, scratch, True{})

# Stage 1 resolves the worker commit.
def ld_resolved_ok(ok: Bool, repo: String, target: String, worker: String) -> IO(Ld):
  match ok:
    case True{}: IO.pure(Ld, LdWk{worker})
    case False{}: IO.pure(Ld, LdFail{T.FUnknownBase{worker}})

def ld_resolved_pick(g: T.GitOut, repo: String, target: String, worker: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_resolved_ok(U32.is_eq(code, 0), repo, target, worker)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_stage1(repo: String, target: String, worker: String) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +w2 = worker
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["rev-parse", "--verify", "--quiet", Tx.str_cat(w2, "^{commit}")])
    ld_resolved_pick(g, r2, t2, w2)

# Stage 2 resolves the target tip the candidate is prepared on.
def ld_tip_ok(ok: Bool, tip: String, worker: String) -> Ld:
  match ok:
    case True{}: LdTip{worker, tip}
    case False{}: LdFail{T.FCmd{"land", "unknown target"}}

def ld_tip_of(g: T.GitOut, worker: String) -> Ld:
  match g:
    case T.GRun{code, out}: ld_tip_ok(U32.is_eq(code, 0), Tx.trim_nl(out), worker)
    case T.GBroken{detail}: LdFail{T.FCmd{"land", detail}}

def ld_stage2(repo: String, target: String, worker: String) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +w2 = worker
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["rev-parse", "--verify", Tx.str_cat(t2, "^{commit}")])
    IO.pure(Ld, ld_tip_of(g, w2))

# Stage 3 creates the candidate worktree, detached at the target tip.
def ld_wt_ok(ok: Bool, out: String, worker: String, tip: String) -> Ld:
  match ok:
    case True{}: LdTip{worker, tip}
    case False{}: LdFail{T.FCmd{"land", out}}

def ld_wt_pick(g: T.GitOut, worker: String, tip: String) -> Ld:
  match g:
    case T.GRun{code, out}: ld_wt_ok(U32.is_eq(code, 0), Tx.trim_nl(out), worker, tip)
    case T.GBroken{detail}: LdFail{T.FCmd{"land", detail}}

def ld_stage3(repo: String, worker: String, tip: String, scratch: String) -> IO(Ld):
  +r2 = repo
  +w2 = worker
  +t2 = tip
  +s2 = scratch
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["worktree", "add", "--detach", s2, t2])
    IO.pure(Ld, ld_wt_pick(g, w2, t2))

# Stage 4 stages the worker's tree on the target tip; a conflict leaves the
# unmerged paths in the scratch worktree for the requester.
def ld_squash_ok(ok: Bool, out: String, worker: String, tip: String, scratch: String) -> IO(Ld):
  match ok:
    case True{}: IO.pure(Ld, LdTip{worker, tip})
    case False{}: ld_unmerged(scratch, out)

def ld_squash_pick(g: T.GitOut, worker: String, tip: String, scratch: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_squash_ok(U32.is_eq(code, 0), Tx.trim_nl(out), worker, tip, scratch)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_stage4(scratch: String, worker: String, tip: String) -> IO(Ld):
  +sc = scratch
  +w2 = worker
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(sc, ["merge", "--squash", w2])
    ld_squash_pick(g, w2, tip, sc)

# Stage 5 commits the candidate and reads its commit.
def ld_cand_of(ok: Bool, cand: String, tip: String) -> Ld:
  match ok:
    case True{}: LdCand{tip, cand}
    case False{}: LdFail{T.FCmd{"land", "no candidate commit"}}

def ld_cand_pick(g: T.GitOut, tip: String) -> Ld:
  match g:
    case T.GRun{code, out}: ld_cand_of(U32.is_eq(code, 0), Tx.trim_nl(out), tip)
    case T.GBroken{detail}: LdFail{T.FCmd{"land", detail}}

def ld_cand_read(tip: String, scratch: String) -> IO(Ld):
  +t2 = tip
  +sc = scratch
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(sc, ["rev-parse", "HEAD"])
    IO.pure(Ld, ld_cand_pick(g, t2))

def line_nothing(line: String) -> Bool:
  Tx.starts_with(line, "nothing to commit")

def nothing_go(lines: List<String>) -> Bool:
  match lines:
    case Nil{}: False{}
    case Con{h, rest}:
      Bool.pick(Bool, line_nothing(h), True{}, nothing_go(rest))

def ld_commit_fail_go(nothing: Bool, out: String, worker: String, tip: String) -> IO(Ld):
  match nothing:
    case True{}: IO.pure(Ld, LdDone{T.LAlready{worker}})
    case False{}: IO.pure(Ld, LdFail{T.FCmd{"land", out}})

def ld_commit_fail(out: String, worker: String, tip: String) -> IO(Ld):
  +o2 = out
  ld_commit_fail_go(nothing_go(Tx.split_lines(o2)), o2, worker, tip)

def ld_commit_ok(ok: Bool, out: String, scratch: String, worker: String, tip: String) -> IO(Ld):
  match ok:
    case True{}: ld_cand_read(tip, scratch)
    case False{}: ld_commit_fail(out, worker, tip)

def ld_commit_next(g: T.GitOut, scratch: String, worker: String, tip: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_commit_ok(U32.is_eq(code, 0), Tx.trim_nl(out), scratch, worker, tip)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_stage5(scratch: String, worker: String, tip: String) -> IO(Ld):
  +sc = scratch
  +w2 = worker
  +t2 = tip
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(sc, ["commit", "-q", "-m", Tx.str_cat("land ", w2)])
    ld_commit_next(g, sc, w2, t2)

# The gate: every unjudged run and every candidate failure line the target
# run does not show blocks; otherwise the advance starts.
def ld_judged_news(news: List<String>, repo: String, target: String, scratch: String, tip: String, cand: String) -> IO(Ld):
  match news:
    case Nil{}: ld_advance1(repo, target, cand, tip, scratch)
    case Con{h, rest}: IO.pure(Ld, LdDone{T.LBlocked{Tx.str_cat("new failures: ", Tx.join("; ", news))}})

def ld_judged(pvs: List<PV>, repo: String, target: String, scratch: String, tip: String, cand: String) -> IO(Ld):
  ld_judged_news(pairs_news(pvs), repo, target, scratch, tip, cand)

def ld_tree_runs(ok: Bool, repo: String, target: String, script: String, files: List<String>, scratch: String, tip: String, cand: String, tw: String) -> IO(Ld):
  match ok:
    case True{}:
      +s2 = scratch
      do IO<Ld>:
        pvs : List<PV> <- run_pairs(script, files, s2, tw)
        ld_judged(pvs, repo, target, s2, tip, cand)
    case False{}: IO.pure(Ld, LdFail{T.FCmd{"land", "target worktree failed"}})

def ld_tree_ok(g: T.GitOut, repo: String, target: String, script: String, files: List<String>, scratch: String, tip: String, cand: String, tw: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_tree_runs(U32.is_eq(code, 0), repo, target, script, files, scratch, tip, cand, tw)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

# Stage 6 prepares a detached tree at the target tip beside the candidate and
# runs the selected checks on both trees.
def ld_stage6(repo: String, target: String, script: String, files: List<String>, scratch: String, tip: String, cand: String) -> IO(Ld):
  +r2 = repo
  +sc = scratch
  +t2 = tip
  +tw = Tx.str_cat(sc, "-target")
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["worktree", "add", "--detach", tw, t2])
    ld_tree_ok(g, r2, target, script, files, sc, t2, cand, tw)

def ld_answer(r: Ld) -> IO(Result<&1, &1, T.GitFail, T.LandOutcome>):
  match r:
    case LdDone{made}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Done{made})
    case LdFail{fail}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{fail})
    case LdWk{worker}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})
    case LdTip{worker, tip}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})
    case LdCand{tip, cand}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})
    case LdRe{cand, basis}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})

def ld_go1(r: Ld, repo: String, target: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker}: ld_stage2(repo, target, worker)
    case LdTip{worker, tip}: ld_unreach()
    case LdCand{tip, cand}: ld_unreach()
    case LdRe{cand, basis}: ld_unreach()

def ld_go2(r: Ld, repo: String, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker}: ld_unreach()
    case LdTip{worker, tip}: ld_stage3(repo, worker, tip, scratch)
    case LdCand{tip, cand}: ld_unreach()
    case LdRe{cand, basis}: ld_unreach()

def ld_go3(r: Ld, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker}: ld_unreach()
    case LdTip{worker, tip}: ld_stage4(scratch, worker, tip)
    case LdCand{tip, cand}: ld_unreach()
    case LdRe{cand, basis}: ld_unreach()

def ld_go4(r: Ld, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker}: ld_unreach()
    case LdTip{worker, tip}: ld_stage5(scratch, worker, tip)
    case LdCand{tip, cand}: ld_unreach()
    case LdRe{cand, basis}: ld_unreach()

def ld_go5(r: Ld, repo: String, target: String, script: String, files: List<String>, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker}: ld_unreach()
    case LdTip{worker, tip}: ld_unreach()
    case LdCand{tip, cand}: ld_stage6(repo, target, script, files, scratch, tip, cand)
    case LdRe{cand, basis}: ld_unreach()

# The stage-6 outcome is already final or carries LdRe for the second advance.
def ld_go6(r: Ld, repo: String, target: String, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker}: ld_unreach()
    case LdTip{worker, tip}: ld_unreach()
    case LdCand{tip, cand}: ld_unreach()
    case LdRe{cand, basis}: ld_advance2(repo, target, cand, basis, scratch)

# land prepares the candidate, judges it against the target and advances the
# target branch. The scratch path must not exist; both scratch worktrees stay
# on disk for inspection. An LConflict keeps the prepared tree with its
# unmerged paths; a retry after a repair answers from the same call shape.
def land_checked(repo: String, target: String, worker: String, script: String, files: List<String>, scratch: String) -> IO(Result<&1, &1, T.GitFail, T.LandOutcome>):
  +r2 = repo
  +t2 = target
  +w2 = worker
  +k2 = script
  +s2 = scratch
  do IO<Result<&1, &1, T.GitFail, T.LandOutcome>>:
    a : Ld <- ld_stage1(r2, t2, w2)
    b : Ld <- ld_go1(a, r2, t2)
    c : Ld <- ld_go2(b, r2, s2)
    d : Ld <- ld_go3(c, s2)
    e : Ld <- ld_go4(d, s2)
    f : Ld <- ld_go5(e, r2, t2, k2, files, s2)
    g : Ld <- ld_go6(f, r2, t2, s2)
    ld_answer(g)

# The coordinator's current entry point: the fast-forward landing.
def land(repo: String, workerBranch: String, target: String) -> IO(T.LandOutcome):
  land_fast_forward(repo, workerBranch, target)
