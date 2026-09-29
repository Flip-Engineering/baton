# The land test entry. Builds a throwaway repository under
# .scratch/bend2-land-test whose root checkout is detached, so the target
# branch is never held while a landing advances it, and exercises land
# through the real native effect. Run from the repository root:
#   sh bend2/scripts/build-native.sh bend2/tests/land.bend .scratch/bend2/land-test
#   ./.scratch/bend2/land-test

import Base
import ../src/git/process.bend as Git
import ../src/git/types.bend as T
import ../src/git/text.bend as Tx
import ../src/git/create-worktree.bend as CW
import ../src/git/land.bend as LD

def repo() -> String:
  ".scratch/bend2-land-test"

def eq_or(ok: Bool, why: String) -> String:
  Bool.pick(String, ok, "", why)

def out_of(r: T.GitOut) -> String:
  match r:
    case T.GRun{code, out}: out
    case T.GBroken{detail}: detail

def res_out(r: T.RunRes) -> String:
  match r:
    case T.RRun{status, out}: out
    case T.RSpawn{detail}: detail

# One git command list run in order; the first failure ends the sequence.
def git_seq(cmds: List<List<String>>, dir: String) -> IO(T.RunRes):
  match cmds:
    case Nil{}: IO.pure(T.RunRes, T.RRun{T.SExit{0}, SNil{}})
    case Con{c, rest}:
      +d2 = dir
      IO.bind(T.RunRes, T.RunRes,
        Git.runFull(Con{"git", Con{"-C", Con{d2, c}}}, "."),
        _r => git_seq(rest, d2))

def head_of(r: String) -> IO(String):
  +r2 = r
  do IO<String>:
    g : T.GitOut <- Git.runGit(r2, ["rev-parse", "main"])
    IO.pure(String, Tx.trim_nl(out_of(g)))

def blob_of(r: String, path: String) -> IO(String):
  +r2 = r
  +p2 = Tx.str_cat("main:", path)
  do IO<String>:
    g : T.GitOut <- Git.runGit(r2, ["show", p2])
    IO.pure(String, Tx.trim_nl(out_of(g)))

def parent_of(r: String) -> IO(String):
  +r2 = r
  do IO<String>:
    g : T.GitOut <- Git.runGit(r2, ["rev-parse", "main^"])
    IO.pure(String, Tx.trim_nl(out_of(g)))

# One worker worktree with one change committed; answers the worker tip.
def head_of_branch(r: String, branch: String) -> IO(String):
  +r2 = r
  +b2 = branch
  do IO<String>:
    g : T.GitOut <- Git.runGit(r2, ["rev-parse", "--verify", b2])
    IO.pure(String, Tx.trim_nl(out_of(g)))

def author(r: String, wt: String, branch: String, base: String, script: String) -> IO(String):
  +r2 = r
  +w2 = wt
  +br2 = branch
  +b2 = base
  +sc2 = script
  do IO<String>:
    made : Result<&1, &1, T.GitFail, T.WorktreeCreated> <- CW.createWorktree(r2, br2, w2, b2)
    s1 : T.RunRes <- Git.runFull(["/bin/sh", "-c", sc2], w2)
    s2 : T.RunRes <- Git.runFull(["git", "-C", w2, "add", "-A"], ".")
    s3 : T.RunRes <- Git.runFull(["git", "-C", w2, "commit", "-q", "-m", "worker change", "-m", "worker body line"], ".")
    g : T.GitOut <- Git.runGit(w2, ["rev-parse", "HEAD"])
    IO.pure(String, Tx.trim_nl(out_of(g)))
def land_ok(r: String, target: String, worker: String, files: List<String>, script: String, scratch: String) -> IO(Result<&1, &1, T.GitFail, T.LandOutcome>):
  +r2 = r
  +t2 = target
  +w2 = worker
  +sc2 = script
  +st2 = scratch
  LD.land_checked(r2, t2, w2, sc2, files, st2)

def is_landed(r: Result<&1, &1, T.GitFail, T.LandOutcome>, want: String) -> String:
  match r:
    case Done{T.LLanded{target, commit}}: eq_or(Tx.str_eq(commit, want), "land: landed commit mismatch")
    case Done{T.LAlready{commit}}: "land: already where landing expected"
    case Done{T.LConflict{files, dir}}: Tx.str_cat("land: conflict where landing expected: ", files)
    case Done{T.LBlocked{reason}}: Tx.str_cat("land: blocked where landing expected: ", reason)
    case Fail{fail}: Tx.str_cat("land refused: ", Tx.trim_nl(T.fail_text(fail)))

def is_already(r: Result<&1, &1, T.GitFail, T.LandOutcome>, want: String) -> String:
  match r:
    case Done{T.LAlready{commit}}: eq_or(Tx.str_eq(commit, want), "land: already commit mismatch")
    case Done{T.LLanded{target, commit}}: "land: landed where already expected"
    case Done{T.LConflict{files, dir}}: "land: conflict where already expected"
    case Done{T.LBlocked{reason}}: "land: blocked where already expected"
    case Fail{fail}: Tx.str_cat("land refused: ", Tx.trim_nl(T.fail_text(fail)))

def is_blocked(r: Result<&1, &1, T.GitFail, T.LandOutcome>) -> String:
  match r:
    case Done{T.LBlocked{reason}}: ""
    case Done{T.LLanded{target, commit}}: "land: landed where blocked expected"
    case Done{T.LAlready{commit}}: "land: already where blocked expected"
    case Done{T.LConflict{files, dir}}: "land: conflict where blocked expected"
    case Fail{fail}: Tx.str_cat("land refused: ", Tx.trim_nl(T.fail_text(fail)))

def is_conflict_file(r: Result<&1, &1, T.GitFail, T.LandOutcome>, want: String) -> String:
  match r:
    case Done{T.LConflict{files, dir}}:
      +fs2 = files
      eq_or(Tx.str_eq(fs2, want), Tx.str_cat("land: conflict paths mismatch: ", fs2))
    case Done{T.LLanded{target, commit}}: "land: landed where conflict expected"
    case Done{T.LAlready{commit}}: "land: already where conflict expected"
    case Done{T.LBlocked{reason}}: Tx.str_cat("land: blocked where conflict expected: ", reason)
    case Fail{fail}: Tx.str_cat("land refused: ", Tx.trim_nl(T.fail_text(fail)))

def is_busy_fail(r: Result<&1, &1, T.GitFail, T.LandOutcome>) -> String:
  match r:
    case Fail{T.FTargetBusy{branch}}: ""
    case Done{T.LLanded{target, commit}}: "land: landed where busy expected"
    case Done{made}: "land: outcome where busy expected"
    case Fail{fail}: Tx.str_cat("land: other refusal where busy expected: ", Tx.trim_nl(T.fail_text(fail)))

def is_unknown_base(r: Result<&1, &1, T.GitFail, T.LandOutcome>) -> String:
  match r:
    case Fail{T.FUnknownBase{base}}: ""
    case Done{made}: "land: outcome where unknown-base expected"
    case Fail{fail}: Tx.str_cat("land: other refusal where unknown-base expected: ", Tx.trim_nl(T.fail_text(fail)))

def nf_script() -> String:
  "printf '%s\\n' 'test \"$1\" = app.txt || exit 0' 'grep -q two \"$1\" || exit 0' 'echo 6170702e747874 61707020776f726b73 617373657274 2d' 'exit 1' > check-newfail.sh"

def always_script() -> String:
  "printf '%s\\n' 'test \"$1\" = app.txt || exit 0' 'echo 6170702e747874 61707020776f726b73 617373657274 2d' 'exit 1' > check-always.sh"

def noident_script() -> String:
  "printf '%s\\n' 'echo sh: cannot open the check' 'exit 1' > check-noident.sh"

def move_script(r: String, name: String, branch: String) -> String:
  Tx.str_cat("printf '%s\\n' 'git -C ", Tx.str_cat(r, Tx.str_cat(" branch -f main ", Tx.str_cat(branch, Tx.str_cat("' 'exit 0' > ", name)))))


# A: the clean landing puts the worker tree on the target.
def setup_finish(r: String, base: String) -> IO(String):
  +r2 = r
  +b2 = base
  do IO<String>:
    _a1 : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-ahead"), "ahead", b2, "printf 'other\\n' > other.txt")
    _a2 : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-ahead2"), "ahead2", b2, "printf 'nine\\n' > app.txt")
    IO.pure(String, b2)

def setup(r: String) -> IO(String):
  +r2 = r
  do IO<String>:
    _rm : T.RunRes <- Git.runFull(["/bin/rm", "-rf", r2], ".")
    _init : T.RunRes <- Git.runFull(["git", "init", "-q", "-b", "main", r2], ".")
    _cfg : T.RunRes <- git_seq([
      ["config", "user.email", "baton@test"],
      ["config", "user.name", "baton test"],
      ["commit", "-q", "--allow-empty", "-m", "seed"]
    ], r2)
    _f0 : T.RunRes <- Git.runFull(["/bin/sh", "-c", "printf 'build/\\n' > .gitignore"], r2)
    _f1 : T.RunRes <- Git.runFull(["/bin/sh", "-c", "printf 'one\\n' > app.txt"], r2)
    _f2 : T.RunRes <- Git.runFull(["/bin/sh", "-c", "printf 'exit 0\\n' > check-pass.sh"], r2)
    _f3 : T.RunRes <- Git.runFull(["/bin/sh", "-c", nf_script()], r2)
    _f4 : T.RunRes <- Git.runFull(["/bin/sh", "-c", always_script()], r2)
    _f5 : T.RunRes <- Git.runFull(["/bin/sh", "-c", move_script(r2, "check-move.sh", "ahead")], r2)
    _f6 : T.RunRes <- Git.runFull(["/bin/sh", "-c", move_script(r2, "check-move2.sh", "ahead2")], r2)
    _f7 : T.RunRes <- Git.runFull(["/bin/sh", "-c", noident_script()], r2)
    _end : T.RunRes <- git_seq([
      ["add", "-A"],
      ["commit", "-q", "-m", "landing fixtures"],
      ["checkout", "-q", "--detach"]
    ], r2)
    g0 : T.GitOut <- Git.runGit(r2, ["rev-parse", "HEAD"])
    base : String <- IO.pure(String, Tx.trim_nl(out_of(g0)))
    setup_finish(r2, base)
# C: a failure the target does not show blocks, and the target stays put.
def finish_go(nonempty: Bool, all: String) -> IO(Unit):
  match nonempty:
    case True{}: IO.die(Unit, 1, Tx.str_cat("FAILURES:\n", all))
    case False{}: IO.print("land checks: all green")

def finish(all: String) -> IO(Unit):
  +a2 = all
  finish_go(Tx.non_empty(a2), a2)

# K: a worker commit that force-added a path this repository's own rules exclude
# lands without it, and the candidate message names the drop.
def cat_ok(g: T.GitOut) -> Bool:
  match g:
    case T.GRun{code, out}: U32.is_eq(code, 0)
    case T.GBroken{detail}: False{}

def path_in(r: String, commit: String, path: String) -> IO(Bool):
  +r2 = r
  +c2 = commit
  do IO<Bool>:
    g : T.GitOut <- Git.runGit(r2, ["cat-file", "-e", T.str_cat3(c2, ":", path)])
    IO.pure(Bool, cat_ok(g))

def msg_of(r: String, commit: String) -> IO(String):
  +r2 = r
  +c2 = commit
  do IO<String>:
    g : T.GitOut <- Git.runGit(r2, ["log", "-1", "--format=%B", c2])
    IO.pure(String, Tx.trim_nl(out_of(g)))

def drop_line() -> String:
  "dropped (ignored by this repository): build/out.bin"

# L: the landed target pushed to the declared remote reaches it, and a push the
# remote refuses is reported rather than read as a published landing.
def remote_init(remote: String) -> IO(T.RunRes):
  +rm = remote
  Git.runFull(["git", "init", "-q", "--bare", rm], ".")

def remote_add(r: String, remote: String) -> IO(T.RunRes):
  +r2 = r
  +rm = remote
  Git.runFull(["git", "-C", r2, "remote", "add", "lt-remote", rm], ".")

def remote_ahead(r: String, tip: String) -> IO(T.RunRes):
  +r2 = r
  +t2 = tip
  Git.runFull(["git", "-C", r2, "push", "-q", "--force", "lt-remote", Tx.str_cat(t2, ":refs/heads/main")], ".")

def remote_tip(remote: String, branch: String) -> IO(String):
  +rm = remote
  +b2 = branch
  do IO<String>:
    g : T.GitOut <- Git.runGit(rm, ["rev-parse", "--verify", b2])
    IO.pure(String, Tx.trim_nl(out_of(g)))

# M: a check run whose output is not failure identities leaves the run
# unjudged, which blocks the landing and names the line that made it unjudged.
def is_cause_of(res: Result<&1,&1,T.GitFail,T.LandOutcome>, want: String) -> String:
  match res:
    case Done{T.LBlocked{+reason}}: eq_or(Tx.starts_with(reason, want), Tx.str_cat("land: the block does not name its cause: ", Tx.trim_nl(reason)))
    case Done{made}: "land: outcome where a blocked landing expected"
    case Fail{fail}: Tx.str_cat("land: refusal where a blocked landing expected: ", Tx.trim_nl(T.fail_text(fail)))

def is_unjudged_cause(res: Result<&1,&1,T.GitFail,T.LandOutcome>) -> String:
  is_cause_of(res, "new failures: ?unjudged candidate: nid.txt: check output is not failure identities: sh: cannot open the check")

def land_m_ok(res: Result<&1,&1,T.GitFail,T.LandOutcome>, msg: String, acc: String) -> IO(Unit):
  +m2 = msg
  +a2 = acc
  do IO<Unit>:
    f1 : String <- IO.pure(String, eq_or(Bool.not(Tx.str_eq(m2, "land baton/wm")), "land M: the target advanced on an unjudged landing"))
    f2 : String <- IO.pure(String, is_unjudged_cause(res))
    finish(Tx.str_cat(a2, Tx.str_cat(f1, f2)))

def land_m_judge(res: Result<&1,&1,T.GitFail,T.LandOutcome>, r: String, acc: String) -> IO(Unit):
  +r2 = r
  do IO<Unit>:
    head : String <- head_of(r2)
    msg : String <- msg_of(r2, head)
    land_m_ok(res, msg, acc)

def land_m(r: String, acc: String) -> IO(Unit):
  +r2 = r
  +a2 = acc
  do IO<Unit>:
    head0 : String <- head_of(r2)
    tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wm"), "baton/wm", head0, "printf 'noident\\n' > nid.txt")
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"nid.txt", Nil{}}, "check-noident.sh", Tx.str_cat(r2, "/.scratch/lt-lm"))
    land_m_judge(res, r2, a2)

def land_l_ok(res: Result<&1, &1, T.GitFail, T.LandOutcome>, +r: String, tip: String, +acc: String) -> IO(Unit):
  match res:
    case Done{T.LLanded{target, commit}}:
      +r2 = r
      +t2 = tip
      +a2 = acc
      +c2 = commit
      do IO<Unit>:
        _i : T.RunRes <- remote_init(Tx.str_cat(r2, "/.scratch/lt-remote.git"))
        _a : T.RunRes <- remote_add(r2, Tx.str_cat(r2, "/.scratch/lt-remote.git"))
        g1 : T.GitOut <- LD.push_git(r2, "main", "lt-remote")
        got : String <- remote_tip(Tx.str_cat(r2, "/.scratch/lt-remote.git"), "main")
        _h : T.RunRes <- remote_ahead(r2, t2)
        g2 : T.GitOut <- LD.push_git(r2, "main", "lt-remote")
        f1 : String <- IO.pure(String, eq_or(cat_ok(g1), "land L: the publish push failed"))
        f2 : String <- IO.pure(String, eq_or(Tx.str_eq(got, c2), "land L: the remote target is not the landed commit"))
        f3 : String <- IO.pure(String, eq_or(Bool.not(cat_ok(g2)), "land L: a refused push read as published"))
        land_m(r, Tx.str_cat(a2, Tx.str_cat(f1, Tx.str_cat(f2, f3))))
    case Done{made}: land_m(r, Tx.str_cat(acc, "land L: landing did not land"))
    case Fail{fail}: land_m(r, Tx.str_cat(acc, Tx.str_cat("land L refused: ", Tx.trim_nl(T.fail_text(fail)))))


def land_l_run(tip: String, r: String, acc: String) -> IO(Unit):
  +t2 = tip
  +r2 = r
  +a2 = acc
  do IO<Unit>:
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", t2, Con{"pub.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-ll"))
    land_l_ok(res, r2, t2, a2)

def land_l(r: String, acc: String) -> IO(Unit):
  +r2 = r
  +a2 = acc
  do IO<Unit>:
    head0 : String <- head_of(r2)
    tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wl"), "baton/wl", head0, "printf 'pub\\n' > pub.txt")
    land_l_run(tip, r2, a2)

# K: one commit retains its complete message. Several commits use the tip
# subject and every branch subject in the body. Both name the branch and drops.
def land_k_check(res: Result<&1, &1, T.GitFail, T.LandOutcome>, r: String, expected: String) -> IO(String):
  match res:
    case Done{T.LLanded{target, commit}}:
      +r2 = r
      +c2 = commit
      do IO<String>:
        obj : Bool <- path_in(r2, c2, "build/out.bin")
        feat : Bool <- path_in(r2, c2, "feat5.txt")
        msg : String <- msg_of(r2, c2)
        f1 : String <- IO.pure(String, eq_or(Bool.not(obj), "land K: ignored build output landed"))
        f2 : String <- IO.pure(String, eq_or(feat, "land K: worker change missing from the landing"))
        f3 : String <- IO.pure(String, eq_or(Tx.str_eq(msg, expected), "land K: candidate message differs from the branch history"))
        IO.pure(String, f1 ++ f2 ++ f3)
    case Done{made}: IO.pure(String, "land K: landing did not land")
    case Fail{fail}: IO.pure(String, "land K refused: " ++ Tx.trim_nl(T.fail_text(fail)))

def land_j(r: String, acc: String) -> IO(Unit):
  +r2 = r
  +a2 = acc
  do IO<Unit>:
    head0 : String <- head_of(r2)
    _tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wj"), "baton/wj", head0, "mkdir -p build; printf 'obj\\n' > build/out.bin; git add -f build/out.bin; printf 'feat5\\n' > feat5.txt")
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", "baton/wj", Con{"feat5.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-lj"))
    single : String <- land_k_check(res, r2, "worker change\n\nworker body line\n\nlanded from baton/wj\n" ++ drop_line())
    head1 : String <- head_of(r2)
    _multi : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wk"), "baton/wk", head1, "mkdir -p build; printf 'obj\\n' > build/out.bin; git add -f build/out.bin; printf 'feat6\\n' > feat5.txt")
    _correction : T.RunRes <- git_seq([
      ["commit", "-q", "--allow-empty", "-m", "Correct the wording", "-m", "Correction detail"]
    ], Tx.str_cat(r2, "/.scratch/lt-wk"))
    multi : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", "baton/wk", Con{"feat5.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-lk"))
    multiple : String <- land_k_check(multi, r2, "Correct the wording\n\nworker change\nCorrect the wording\n\nlanded from baton/wk\n" ++ drop_line())
    land_l(r2, a2 ++ single ++ multiple)

def land_i(r: String, acc: String) -> IO(Unit):
  +r2 = r
  +a2 = acc
  do IO<Unit>:
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", "mystery0d8a2c4e", Con{"feat.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-li"))
    f1 : String <- IO.pure(String, is_unknown_base(res))
    land_j(r2, Tx.str_cat(a2, f1))

def land_h(r: String, acc: String) -> IO(Unit):
  +r2 = r
  +a2 = acc
  do IO<Unit>:
    _add : T.RunRes <- Git.runFull(["git", "-C", r2, "worktree", "add", Tx.str_cat(r2, "/.scratch/lt-busy"), "main"], ".")
    head : String <- head_of(r2)
    tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wh"), "baton/wh", head, "printf 'feat4\\n' > feat4.txt")
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"feat4.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-lh"))
    f1 : String <- IO.pure(String, is_busy_fail(res))
    _rm : T.RunRes <- Git.runFull(["git", "-C", r2, "worktree", "remove", Tx.str_cat(r2, "/.scratch/lt-busy")], ".")
    land_i(r2, Tx.str_cat(a2, f1))

# G: a moved target requires a fresh attempt, whose merge exposes the conflict.
def land_g(r: String, acc: String) -> IO(Unit):
  +r2 = r
  +a2 = acc
  +scratch = Tx.str_cat(r2, "/.scratch/lt-lg")
  +retry_scratch = Tx.str_cat(r2, "/.scratch/lt-lg-retry")
  do IO<Unit>:
    +head0 : String <- head_of(r2)
    +ahead2 : String <- head_of_branch(r2, "ahead2")
    +tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wg"), "baton/wg", head0, "printf 'ten\\n' > app.txt")
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"app.txt", Nil{}}, "check-move2.sh", scratch)
    head : String <- head_of(r2)
    candidate_basis : String <- head_of_branch(scratch, "HEAD^")
    checked_basis : String <- head_of_branch(Tx.str_cat(scratch, "-target"), "HEAD")
    worker : String <- head_of_branch(r2, "baton/wg")
    f1 : String <- IO.pure(String, is_cause_of(res, "target moved during checked landing; rerun land-checked"))
    f2 : String <- IO.pure(String, eq_or(Tx.str_eq(head, ahead2), "land G: main is not the moved tip"))
    f3 : String <- IO.pure(String, eq_or(Tx.str_eq(candidate_basis, head0), "land G: blocked candidate basis was not retained"))
    f4 : String <- IO.pure(String, eq_or(Tx.str_eq(checked_basis, head0), "land G: checked target tree was not retained"))
    f5 : String <- IO.pure(String, eq_or(Tx.str_eq(worker, tip), "land G: blocked attempt changed the worker tip"))
    retry : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"app.txt", Nil{}}, "check-pass.sh", retry_scratch)
    after : String <- head_of(r2)
    unmerged : T.GitOut <- Git.runGit(retry_scratch, ["diff", "--name-only", "--diff-filter=U"])
    worker_after : String <- head_of_branch(r2, "baton/wg")
    f6 : String <- IO.pure(String, is_conflict_file(retry, "app.txt"))
    f7 : String <- IO.pure(String, eq_or(Tx.str_eq(after, ahead2), "land G: conflict advanced the moved target"))
    f8 : String <- IO.pure(String, eq_or(Tx.str_eq(Tx.trim_nl(out_of(unmerged)), "app.txt"), "land G: conflict evidence was not retained"))
    f9 : String <- IO.pure(String, eq_or(Tx.str_eq(worker_after, tip), "land G: retry changed the worker tip"))
    land_h(r2, a2 ++ f1 ++ f2 ++ f3 ++ f4 ++ f5 ++ f6 ++ f7 ++ f8 ++ f9)

# F: a moved target preserves the checked trees; a fresh attempt lands on it.
def land_f(r: String, acc: String) -> IO(Unit):
  +r2 = r
  +a2 = acc
  +scratch = Tx.str_cat(r2, "/.scratch/lt-lf")
  do IO<Unit>:
    +head0 : String <- head_of(r2)
    +ahead : String <- head_of_branch(r2, "ahead")
    +tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wf"), "baton/wf", head0, "printf 'feat2\\n' > feat2.txt")
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"feat2.txt", Nil{}}, "check-move.sh", scratch)
    moved : String <- head_of(r2)
    candidate_basis : String <- head_of_branch(scratch, "HEAD^")
    checked_basis : String <- head_of_branch(Tx.str_cat(scratch, "-target"), "HEAD")
    worker : String <- head_of_branch(r2, "baton/wf")
    blocked : String <- IO.pure(String, is_cause_of(res, "target moved during checked landing; rerun land-checked"))
    kept_target : String <- IO.pure(String, eq_or(Tx.str_eq(moved, ahead), "land F: blocked attempt changed the moved target"))
    kept_candidate : String <- IO.pure(String, eq_or(Tx.str_eq(candidate_basis, head0), "land F: blocked candidate basis was not retained"))
    kept_basis : String <- IO.pure(String, eq_or(Tx.str_eq(checked_basis, head0), "land F: checked target tree was not retained"))
    kept_worker : String <- IO.pure(String, eq_or(Tx.str_eq(worker, tip), "land F: blocked attempt changed the worker tip"))
    retry : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"feat2.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-lf-retry"))
    +head : String <- head_of(r2)
    par : String <- parent_of(r2)
    ob : String <- blob_of(r2, "other.txt")
    fb : String <- blob_of(r2, "feat2.txt")
    worker_after : String <- head_of_branch(r2, "baton/wf")
    f1 : String <- IO.pure(String, is_landed(retry, head))
    f2 : String <- IO.pure(String, eq_or(Tx.str_eq(par, ahead), "land F: target parent is not the moved tip"))
    f3 : String <- IO.pure(String, eq_or(Tx.str_eq(ob, "other"), "land F: other.txt missing after move"))
    f4 : String <- IO.pure(String, eq_or(Tx.str_eq(fb, "feat2"), "land F: feat2.txt missing after move"))
    f5 : String <- IO.pure(String, eq_or(Tx.str_eq(worker_after, tip), "land F: retry changed the worker tip"))
    land_g(r2, a2 ++ blocked ++ kept_target ++ kept_candidate ++ kept_basis ++ kept_worker ++ f1 ++ f2 ++ f3 ++ f4 ++ f5)

def land_e(r: String, base: String, acc: String) -> IO(Unit):
  +r2 = r
  +b2 = base
  +a2 = acc
  do IO<Unit>:
    tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-we"), "baton/we", b2, "printf 'three\\n' > app.txt")
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"app.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-le"))
    f1 : String <- IO.pure(String, is_conflict_file(res, "app.txt"))
    land_f(r2, Tx.str_cat(a2, f1))

def land_d(r: String, base: String, acc: String) -> IO(Unit):
  +r2 = r
  +b2 = base
  +a2 = acc
  do IO<Unit>:
    tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wd"), "baton/wd", b2, "printf 'two\\n' > app.txt")
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"app.txt", Nil{}}, "check-always.sh", Tx.str_cat(r2, "/.scratch/lt-ld"))
    head : String <- head_of(r2)
    blob : String <- blob_of(r2, "app.txt")
    f1 : String <- IO.pure(String, is_landed(res, head))
    f2 : String <- IO.pure(String, eq_or(Tx.str_eq(blob, "two"), "land D: app.txt wrong after landing"))
    land_e(r2, b2, Tx.str_cat(a2, Tx.str_cat(f1, f2)))

# E: a worker change conflicting with the target returns the path.
def land_c(r: String, base: String, tipA: String, headA: String, acc: String) -> IO(Unit):
  +r2 = r
  +b2 = base
  +h2 = headA
  +a2 = acc
  do IO<Unit>:
    tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wc"), "baton/wc", b2, "printf 'two\\n' > app.txt")
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", tip, Con{"app.txt", Nil{}}, "check-newfail.sh", Tx.str_cat(r2, "/.scratch/lt-lc"))
    head : String <- head_of(r2)
    f1 : String <- IO.pure(String, is_blocked(res))
    f2 : String <- IO.pure(String, eq_or(Tx.str_eq(head, h2), "land C: main moved on a blocked landing"))
    land_d(r2, b2, Tx.str_cat(a2, Tx.str_cat(f1, f2)))

# D: the same failure on the target too lets the landing through.
def land_b(r: String, base: String, tipA: String, headA: String, acc: String) -> IO(Unit):
  +r2 = r
  +b2 = base
  +t2 = tipA
  +h2 = headA
  +a2 = acc
  do IO<Unit>:
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", t2, Con{"feat.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-lb"))
    f1 : String <- IO.pure(String, is_already(res, t2))
    land_c(r2, b2, t2, h2, Tx.str_cat(a2, f1))

def land_a_j2(res: Result<&1, &1, T.GitFail, T.LandOutcome>, head: String, blob: String, tip: String, r: String, base: String, acc: String) -> IO(Unit):
  +h2 = head
  +t3 = tip
  +a3 = acc
  +f1 = is_landed(res, h2)
  +f2 = eq_or(Tx.str_eq(blob, "feat"), "land A: feat.txt wrong after landing")
  land_b(r, base, t3, h2, Tx.str_cat(a3, Tx.str_cat(f1, f2)))

def land_a_judge(tip: String, r: String, base: String, acc: String) -> IO(Unit):
  +r2 = r
  +b2 = base
  +t2 = tip
  +a2 = acc
  do IO<Unit>:
    res : Result<&1, &1, T.GitFail, T.LandOutcome> <- land_ok(r2, "main", t2, Con{"feat.txt", Nil{}}, "check-pass.sh", Tx.str_cat(r2, "/.scratch/lt-la"))
    head : String <- head_of(r2)
    blob : String <- blob_of(r2, "feat.txt")
    land_a_j2(res, head, blob, t2, r2, b2, a2)

def land_a(r: String, base: String, acc: String) -> IO(Unit):
  +r2 = r
  +b2 = base
  +a2 = acc
  do IO<Unit>:
    tip : String <- author(r2, Tx.str_cat(r2, "/.scratch/lt-wa"), "baton/wa", b2, "printf 'feat\\n' > feat.txt")
    land_a_judge(tip, r2, b2, a2)

# B: landing the landed worker again answers LAlready.
def run_all(r: String) -> IO(Unit):
  +r2 = r
  do IO<Unit>:
    base : String <- setup(r2)
    land_a(r2, Tx.trim_nl(base), "")

def main() -> IO(Unit):
  do IO<Unit>:
    p : T.RunRes <- Git.runFull(["/bin/pwd"], ".")
    root : String <- IO.pure(String, Tx.trim_nl(res_out(p)))
    abs : String <- IO.pure(String, Tx.str_cat(root, Tx.str_cat("/", repo())))
    run_all(abs)
