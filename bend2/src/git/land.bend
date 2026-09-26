# land: prepare a merge candidate from a committed worker tip, run the
# selected checks against the agreed failure identity, and advance the target
# branch only while it still points at the commit the candidate was prepared
# from.
#
# Semantics:
# - A retry whose worker commit the target already contains answers
#   LAlready with the target tip and runs nothing.
# - The candidate is a merge --no-ff of the worker tip into the target tip,
#   prepared in a detached worktree at dir. A conflict answers LConflict with
#   the unmerged paths and keeps the worktree for the requester.
# - The gate runs the check once per selected file on the candidate and once
#   per selected file on a detached worktree at the target tip; a failure
#   identity present on both sides is shared and passes, an identity the
#   target does not have is new and blocks, and a selected file with no
#   verdict (killed check, malformed report, lost spawn) blocks as unjudged.
# - The advance is a CAS: update-ref moves the target only from the commit
#   the verdict was produced against. When the target moved meanwhile, the
#   candidate is re-prepared on the new tip; a clean rebase reuses the existing
#   verdict and a conflicting rebase returns to the requester.
# - Omissions of the first slice, named so callers can plan around them: the
#   check runs with no timeout, and a red run that reports no parseable
#   identity blocks rather than passes.

import Base
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git
import ./create-worktree.bend as CW

# Parsed check output for one file: the failure identities reported and
# whether any BATON-FAIL line was malformed.
type Parsed is Data:
  P{idents: +List<T.Ident>, lost: Bool}

# One selected file's gate result on one side.
type FV is Data:
  FVGreen{}
  FVRed{idents: +List<T.Ident>}
  FVLost{why: String}

# A file paired with its verdict on one side.
type FVR is Data:
  FR{file: String, fv: FV}

# The pipeline state: finished with an outcome, refused, or still stepping
# with the target tip, the candidate commit and the target-check worktree.
type LR is Data:
  LRDone{outcome: T.LandOutcome}
  LRFail{fail: T.GitFail}
  LRNext{tip: String, candidate: String, tdir: String}

type GRes is Data:
  GRes{bad: +List<String>, lost: +List<String>}

def parse_acc_empty() -> Parsed:
  P{Nil{}, False{}}

def parse_tok(ok: Bool, f: String, t: String, k: String, cd: String, acc: Parsed) -> Parsed:
  match ok:
    case True{}:
      match acc:
        case P{idents, lost}: P{Con{T.Id{f, t, k, cd}, idents}, lost}
    case False{}: parse_acc_empty()

def parse_f5(tok: String, f: String, t: String, k: String, rest: List<String>, acc: Parsed) -> Parsed:
  match rest:
    case Nil{}: parse_acc_empty()
    case Con{cd, Nil{}}: parse_tok(Tx.str_eq(tok, "BATON-FAIL"), f, t, k, cd, acc)
    case Con{cd, more}: parse_acc_empty()

def parse_f4(tok: String, f: String, t: String, rest: List<String>, acc: Parsed) -> Parsed:
  match rest:
    case Nil{}: parse_acc_empty()
    case Con{k, r4}: parse_f5(tok, f, t, k, r4, acc)

def parse_f3(tok: String, f: String, rest: List<String>, acc: Parsed) -> Parsed:
  match rest:
    case Nil{}: parse_acc_empty()
    case Con{t, r3}: parse_f4(tok, f, t, r3, acc)

def parse_f2(tok: String, rest: List<String>, acc: Parsed) -> Parsed:
  match rest:
    case Nil{}: parse_acc_empty()
    case Con{f, r2}: parse_f3(tok, f, r2, acc)

def parse_fields(fs: List<String>, acc: Parsed) -> Parsed:
  match fs:
    case Nil{}: parse_acc_empty()
    case Con{tok, rest}: parse_f2(tok, rest, acc)

def parse_line_bf(bf: Bool, line: String, acc: Parsed) -> Parsed:
  match bf:
    case True{}: parse_fields(Tx.split_spaces(line), acc)
    case False{}: acc

def parse_line(line: String, acc: Parsed) -> Parsed:
  +l2 = line
  parse_line_bf(Tx.starts_with(l2, "BATON-FAIL "), l2, acc)

def parse_go(ls: List<String>, acc: Parsed) -> Parsed:
  match ls:
    case Nil{}: acc
    case Con{line, rest}: parse_go(rest, parse_line(line, acc))

# One BATON-FAIL line per failing test:
#   BATON-FAIL <hex file> <hex test> <hex kind> <hex code>
# Fields are hex-encoded UTF-8, space separated. Other lines are ignored; a
# BATON-FAIL line without exactly the four hex fields marks the run malformed.
# Exit 0 with no identities is green; a red run without any parseable
# identity is a lost verdict.
def parse_out(out: String) -> Parsed:
  parse_go(Tx.split_lines(out), parse_acc_empty())

def idents_ne(ids: +List<T.Ident>) -> Bool:
  match ids:
    case Nil{}: False{}
    case Con{h, t}: True{}

def fv_exit_green(has: Bool, idents: +List<T.Ident>) -> FV:
  Bool.pick(FV, has, FVLost{"identities reported on a green run"}, FVGreen{})

def fv_exit_pick(file: String, ok: Bool, has: Bool, idents: +List<T.Ident>) -> FV:
  +i2 = idents
  Bool.pick(FV, ok, fv_exit_green(has, i2), FVRed{i2})

def fv_exit_lost(file: String, ok: Bool, has: Bool, lost: Bool, idents: +List<T.Ident>) -> FV:
  match lost:
    case True{}: FVLost{"malformed check output"}
    case False{}:
      fv_exit_pick(file, ok, has, idents)

def fv_exit_ok(file: String, ok: Bool, out: String, parsed: Parsed) -> FV:
  match parsed:
    case P{idents, lost}:
      +i2 = idents
      fv_exit_lost(file, ok, idents_ne(i2), lost, i2)

def mk_fv(file: String, r: T.RunRes) -> FV:
  match r:
    case T.RRun{T.SExit{code}, out}:
      +o2 = out
      fv_exit_ok(file, U32.is_eq(code, 0), o2, parse_out(o2))
    case T.RRun{T.SSignal{num}, out}: FVLost{"check killed by signal"}
    case T.RSpawn{detail}: FVLost{"check did not start"}

def subst_one(el: String, file: String) -> String:
  +e2 = el
  Bool.pick(String, Tx.str_eq(e2, "@FILE@"), file, e2)

def subst_go(cmd: List<String>, file: String, acc: List<String>) -> List<String>:
  match cmd:
    case Nil{}: acc
    case Con{h, t}:
      +f2 = file
      subst_go(t, f2, Tx.prepend(subst_one(h, f2), acc))

def subst(cmd: List<String>, file: String) -> List<String>:
  subst_go(cmd, file, Nil{})

# The selected files run once per file on one side; results arrive in
# reverse file order, which the comparison does not depend on.
def gate_acc(r: T.RunRes, file: String, acc: List<FVR>) -> List<FVR>:
  +f2 = file
  Con{FR{f2, mk_fv(f2, r)}, acc}

def gate_run(files: List<String>, dir: String, cmd: List<String>, acc: List<FVR>) -> IO(List<FVR>):
  match files:
    case Nil{}: IO.pure(List<FVR>, acc)
    case Con{f, rest}:
      +c2 = cmd
      IO.bind(T.RunRes, List<FVR>,
        gate_run1(Tx.subst(c2, f2), dir, acc),
        r => gate_acc(r, f, acc))

def ident_eq(a: T.Ident, b: T.Ident) -> Bool:
  match a b:
    case T.Id{af, at, ak, ac} T.Id{bf, bt, bk, bc}:
      Bool.pick(Bool, Tx.str_eq(af, bf),
        Bool.pick(Bool, Tx.str_eq(at, bt),
          Bool.pick(Bool, Tx.str_eq(ak, bk), Tx.str_eq(ac, bc), False{}), False{}), False{})

def ident_in(x: T.Ident, ids: +List<T.Ident>) -> Bool:
  match ids:
    case Nil{}: False{}
    case Con{h, t}:
      +e = ident_eq(x, h)
      Bool.pick(Bool, e, True{}, ident_in(x, t))

def keep_new(shared: Bool, x: T.Ident, acc: +List<T.Ident>) -> +List<T.Ident>:
  Bool.pick(+List<T.Ident>, shared, acc, Con{x, acc})

def new_idents(ids: +List<T.Ident>, tgt: +List<T.Ident>, acc: +List<T.Ident>) -> +List<T.Ident>:
  match ids:
    case Nil{}: acc
    case Con{h, t}:
      +h2 = h
      +a2 = acc
      new_idents(t, tgt, keep_new(ident_in(h2, tgt), h2, a2))

def fv_idents(fv: FV) -> +List<T.Ident>:
  match fv:
    case FVRed{idents}: idents
    case FVGreen{}: Nil{}
    case FVLost{why}: Nil{}

def fv_is_lost(fv: FV) -> Bool:
  match fv:
    case FVLost{why}: True{}
    case FVGreen{}: False{}
    case FVRed{idents}: False{}

def fv_lost_why(fv: FV) -> String:
  match fv:
    case FVLost{why}: why
    case FVGreen{}: ""
    case FVRed{idents}: ""

def assoc_idents(file: String, fvs: List<FVR>) -> +List<T.Ident>:
  match fvs:
    case Nil{}: Nil{}
    case Con{fr, rest}:
      match fr:
        case FR{file2, fv}:
          +e = Tx.str_eq(file, file2)
          assoc_pick(e, fv, rest)

def assoc_pick(e: Bool, fv: FV, rest: List<FVR>) -> +List<T.Ident>:
  Bool.pick(+List<T.Ident>, e, fv_idents(fv), assoc_idents(rest, Nil{}))

def bad_line(ids: +List<T.Ident>, acc: List<String>) -> List<String>:
  match ids:
    case Nil{}: acc
    case Con{i, rest}:
      match i:
        case T.Id{f, t, k, c}:
          +a2 = acc
          bad_line(rest, Tx.str_cat(a2, Tx.join(" ", Con{f, Con{t, Con{k, Con{c, Nil{}}}}})))

def gate_upd_green(acc: GRes) -> GRes:
  acc

def gate_upd_lost(file: String, why: String, acc: GRes) -> GRes:
  match acc:
    case GRes{bad, lost}: GRes{bad, Con{Tx.join(" ", Con{file, Con{": ", Con{why, Nil{}}}})}, lost}

def gate_upd_red(new: +List<T.Ident>, acc: GRes) -> GRes:
  match acc:
    case GRes{bad, lost}: GRes{bad_line(new, bad), lost}

def gate_upd(file: String, fv: FV, tgt: List<FVR>, acc: GRes) -> GRes:
  match fv:
    case FVGreen{}: gate_upd_green(acc)
    case FVLost{why}: gate_upd_lost(file, why, acc)
    case FVRed{idents}: gate_upd_red(new_idents(idents, assoc_idents(file, tgt), Nil{}), acc)

def gate_walk(cand: List<FVR>, acc: GRes, tgt: List<FVR>) -> LR:
  match cand:
    case Nil{}: gate_pick2(acc)
    case Con{fr, rest}:
      match fr:
        case FR{file, fv}: gate_walk(rest, gate_upd(file, fv, tgt, acc), tgt)

def gate_pick2(acc: GRes) -> LR:
  match acc:
    case GRes{bad, lost}:
      gate_pick(Tx.non_empty(bad), Tx.non_empty(lost), bad, lost)

def gate_pick(badne: Bool, lostne: Bool, bad: List<String>, lost: List<String>) -> LR:
  match badne:
    case True{}: LRDone{T.LBlocked{Tx.join("\n", bad)}}
    case False{}:
      match lostne:
        case True{}: LRDone{T.LBlocked{Tx.join("\n", lost)}}
        case False{}: LRNext{SNil{}, SNil{}, SNil{}}

def gate_res_pick(res: GRes, tip: String, candidate: String, tdir: String) -> LR:
  match res:
    case GRes{bad, lost}:
      gate_pick(Tx.non_empty(bad), Tx.non_empty(lost), bad, lost, tip, candidate, tdir)

def gate_result(cand: List<FVR>, tgt: List<FVR>, tip: String, candidate: String, tdir: String) -> LR:
  gate_res_pick(gate_walk(cand, tgt, Nil{}, Nil{}), tip, candidate, tdir)

def gate_tgt(reds: List<FVR>, tdir: String, cmd: List<String>, acc: List<FVR>) -> IO(List<FVR>):
  match reds:
    case Nil{}: IO.pure(List<FVR>, acc)
    case Con{fr, rest}:
      match fr:
        case FR{f2, fv2}:
          IO.bind(T.RunRes, List<FVR>,
            Git.runFull(Tx.subst(c2, f2), tdir),
            r => IO.pure(List<FVR>, Con{FR{f2, mk_fv(f2, r)}, acc}))
def files_of(check: T.Check) -> List<String>:
  match check:
    case T.Chk{cmd, files}: files

def cmd_of(check: T.Check) -> List<String>:
  match check:
    case T.Chk{cmd, files}: cmd

def land_gate(files: List<String>, cmd: List<String>, candDir: String, tdir: String, tip: String, candidate: String) -> IO(LR):
  +c2 = cmd
  +cd2 = candDir
  +td2 = tdir
  IO.bind(List<FVR>, LR,
    gate_run(files, cd2, c2, Nil{}),
    cand => IO.bind(List<FVR>, LR,
      gate_tgt(red_files(cand, Nil{}), td2, c2, Nil{}),
      tgt => IO.pure(LR, gate_result(cand, tgt, tip, candidate, td2))))

def land_go5(r: LR, repo: String, worker: String, target: String, dir: String, check: T.Check) -> IO(LR):
  match r:
    case LRDone{outcome}: IO.pure(LR, LRDone{outcome})
    case LRFail{fail}: IO.pure(LR, LRFail{fail})
    case LRNext{tip, candidate, tdir}: land_advance(tip, candidate, tdir, repo, worker, target, dir, check)
