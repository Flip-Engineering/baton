# land: one squashed landing of a committed worker tip onto a target branch.
# The candidate is prepared in a scratch worktree detached at the target tip,
# so the worker's own commits and worktree stay untouched. Each selected
# check file runs on the candidate and on a detached tree at the target tip;
# a candidate failure blocks unless the target run shows the same failure
# identity (file, test, failure type, code) as AGENTS.md requires. A run with
# no verdict blocks. The target advances through update-ref with the observed
# tip as the old value, so the branch moves only while it still matches the
# prepared basis. A target that moved meanwhile returns a retry instruction
# and keeps the checked candidate worktree for the requester. A landing whose
# worker commit the target already contains answers LAlready without
# preparing anything. LAlready names the worker commit on the fast-forward and
# the checked path alike.
#
# One branch commit retains its full message. Several branch commits use the
# tip subject and list every subject since the merge-base with the target.
# The body names the worker branch and any added path the landing dropped.
#
# Publication is the last step: push_git pushes the landed target to the
# remote the deployment declares and answers the push's own exit and output,
# so a refused or non-fast-forward push is named as a failure and never read
# as a published landing.
#
# Check contract: check is the path of a shell script, run as
#   /bin/sh <check> <selected-file>
# inside the checked tree, one run per selected file per tree. A passing run
# exits 0. A failing run names each failure on one stdout line as four
# hex-encoded fields separated by single spaces: file, test, failure type,
# and the stable semantic code ("-" when the tool supplies none). Hex
# encoding lets any name travel through the space-separated line, so an exact
# line match after validation is an exact identity match. Any other output
# line on stdout makes the run unjudged, and an unjudged run blocks the landing
# and names the line that made it unjudged. Stderr goes to the coordinator's log.
#
# The scratch worktrees one attempt prepares, the candidate and the target tree
# named by appending "-target", are removed when the landing answers landed or
# already. A refused or conflicted attempt keeps them for the requester, and
# that worker's next attempt drops them.

import Base
import ./landing.bend as Lg
import ./intent.bend as It
import ../host/receipt.bend as Rec
import ./intent-publish.bend as Pb
import ./types.bend as T
import ./text.bend as Tx
import ./process.bend as Git
import ./debris.bend as Deb

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
# --- the selected publication and holder observation: prepared, NOT wired -------
#
# Helper source for #674. No live caller references any of this and no completion
# mapper is offered: the post-state qualification and the holder verification that
# the Root contract requires are not implemented, so these helpers can only refuse
# while keeping every raw fact for the receipt and custody caller. The helpers are
# activated only with the guard claim, the receipt intent, the completed-failure
# record, the uncertainty reconciliation and the protected sweep.
#
# A record is FLAG TAB REFSPEC TAB SUMMARY. The expected field therefore carries
# both separators, so refs/heads/main cannot match refs/heads/main-other, and the
# field must be the whole refspec this attempt pushed. Every attempt carries its
# immutable identity - destination, target, object and the expected-basis lease -
# and every reread keeps its own raw status and output.
def publish_receiver() -> String:
  "git -c receive.denyCurrentBranch=updateInstead -c receive.denyNonFastForwards=true -c core.hooksPath=/dev/null receive-pack"

def publish_refspec(+oid: String, +target: String) -> String:
  T.str_cat3(oid, ":refs/heads/", target)

def publish_field(+oid: String, +target: String) -> String:
  T.str_cat3("\t", publish_refspec(oid, target), "\t")

def publish_destination_ok(+path: String) -> Bool:
  Tx.starts_with(path, "/")

def publish_argv(+destination: String, +target: String, +oid: String, +basis: String) -> List<String>:
  Bool.pick(List<String>, publish_destination_ok(destination),
    Con{"push", Con{"--porcelain", Con{Tx.str_cat("--receive-pack=", publish_receiver()), Con{T.str_cat3("--force-with-lease=refs/heads/", target, Tx.str_cat(":", basis)), Con{destination, Con{publish_refspec(oid, target), Nil{}}}}}},
    Nil{})

def pub_flag_like(+line: String) -> Bool:
  Bool.pick(Bool, Tx.starts_with(line, " \t"), True{},
    Bool.pick(Bool, Tx.starts_with(line, "=\t"), True{},
      Bool.pick(Bool, Tx.starts_with(line, "!\t"), True{},
        Bool.pick(Bool, Tx.starts_with(line, "+\t"), True{}, Tx.starts_with(line, "*\t")))))

def pub_record_matches(+line: String, +want: String) -> Bool:
  Bool.pick(Bool, Tx.starts_with(line, Tx.str_cat(" ", want)), True{},
    Bool.pick(Bool, Tx.starts_with(line, Tx.str_cat("=", want)), True{},
      Bool.pick(Bool, Tx.starts_with(line, Tx.str_cat("!", want)), True{},
        Bool.pick(Bool, Tx.starts_with(line, Tx.str_cat("+", want)), True{},
          Tx.starts_with(line, Tx.str_cat("*", want))))))

def pub_hit(+line: String, +want: String, +which: U32) -> Bool:
  Bool.pick(Bool, U32.is_eq(which, 0), pub_flag_like(line), pub_record_matches(line, want))

def pub_count(lines: List<String>, +want: String, +which: U32) -> U32:
  match lines:
    case Nil{}: 0
    case Con{h, rest}:
      +tail = pub_count(rest, want, which)
      Bool.pick(U32, pub_hit(h, want, which), U32.add(tail, 1), tail)

def pub_first(lines: List<String>, +want: String, +which: U32) -> String:
  match lines:
    case Nil{}: ""
    case Con{h, rest}:
      Bool.pick(String, pub_hit(h, want, which), h, pub_first(rest, want, which))

def pub_flag_of(+line: String) -> String:
  Bool.pick(String, Tx.starts_with(line, "="), "already",
    Bool.pick(String, Tx.starts_with(line, "!"), "refused",
      Bool.pick(String, Tx.starts_with(line, " "), "applied",
        Bool.pick(String, Tx.starts_with(line, "+"), "forced", "unclassified"))))

type PubRecord is Data:
  RecordMatched{cls: String, line: String}
  RecordAmbiguous{count: U32, sample: String}
  RecordAbsent{}

type RereadObs is Data:
  RereadRead{code: U32, out: String, ref: String}
  RereadBroken{detail: String}

type PubObservation is Data:
  ObsAttempted{code: U32, out: String, record: PubRecord, destination: String, target: String, oid: String, basis: String, post: String, reread: RereadObs}
  ObsNotAttempted{reason: String, destination: String, target: String, oid: String, basis: String}
  ObsBroken{detail: String, destination: String, target: String, oid: String, basis: String}

def pub_record(out: String, +want: String) -> PubRecord:
  +lines = Tx.split_lines(out)
  +relevant = pub_count(lines, want, 1)
  +flagged = pub_count(lines, want, 0)
  Bool.pick(PubRecord, U32.is_eq(relevant, 1),
    Bool.pick(PubRecord, U32.is_eq(flagged, 1),
      RecordMatched{pub_flag_of(pub_first(lines, want, 1)), pub_first(lines, want, 1)},
      RecordAmbiguous{flagged, pub_first(lines, want, 0)}),
    Bool.pick(PubRecord, U32.is_eq(relevant, 0),
      Bool.pick(PubRecord, U32.is_eq(flagged, 0), RecordAbsent{}, RecordAmbiguous{flagged, pub_first(lines, want, 0)}),
      RecordAmbiguous{relevant, pub_first(lines, want, 1)}))

def pub_obs(r: T.GitOut, +want: String, +destination: String, +target: String, +oid: String, +basis: String) -> PubObservation:
  match r:
    case T.GRun{code, out}: ObsAttempted{code, out, pub_record(out, want), destination, target, oid, basis, "unverified", RereadBroken{"not read"}}
    case T.GBroken{detail}: ObsBroken{detail, destination, target, oid, basis}

def record_class(record: PubRecord) -> String:
  match record:
    case RecordMatched{cls, line}: cls
    case RecordAmbiguous{count, sample}: "ambiguous"
    case RecordAbsent{}: "unclassified"

def obs_class_pick(code: U32, record: PubRecord) -> String:
  Bool.pick(String, U32.is_eq(code, 0), record_class(record), "failed")

def obs_class(+obs: PubObservation) -> String:
  match obs:
    case ObsAttempted{code, out, record, destination, target, oid, basis, post, reread}: obs_class_pick(code, record)
    case ObsNotAttempted{reason, destination, target, oid, basis}: "not-attempted"
    case ObsBroken{detail, destination, target, oid, basis}: "broken"

# No completion mapper exists. Every observation refuses and keeps its evidence,
# including the disposition (applied or already) for the caller that will later own
# the post-state and holder qualification.
def obs_refusal(+obs: PubObservation) -> T.LandOutcome:
  match obs:
    case ObsAttempted{code, out, record, destination, target, oid, basis, post, reread}: obs_refuse(code, record, post, target, oid)
    case ObsNotAttempted{reason, destination, target, oid, basis}: T.LBlocked{reason}
    case ObsBroken{detail, destination, target, oid, basis}: T.LBlocked{detail}

def obs_refuse(code: U32, record: PubRecord, +post: String, +target: String, +oid: String) -> T.LandOutcome:
  Bool.pick(T.LandOutcome, U32.is_eq(code, 0),
    Bool.pick(T.LandOutcome, Tx.str_eq(post, "verified-object"),
      T.LBlocked{"the publication of " ++ oid ++ " onto " ++ target ++ " reached the post-state " ++ post ++ " but holder verification and custody do not exist yet; the observation stays pending and must not be treated as a completion"},
      T.LBlocked{"the publication of " ++ oid ++ " onto " ++ target ++ " is not qualified (post-state " ++ post ++ "); inspect the observation before any retry"}),
    T.LBlocked{"the publication of " ++ oid ++ " onto " ++ target ++ " did not complete; inspect the observation before any retry"})

def verify_ref_pick(+obs: PubObservation, r: T.GitOut, +ref: String) -> PubObservation:
  match obs:
    case ObsAttempted{code, out, record, destination, target, oid, basis, post, reread}:
      match r:
        case T.GRun{rcode, rout}: obs_reread(code, out, record, destination, target, oid, basis, rcode, rout, ref)
        case T.GBroken{detail}: obs_reread_broken(code, out, record, destination, target, oid, basis, detail, ref)
    case other: other

def obs_reread(code: U32, out: String, record: PubRecord, +destination: String, +target: String, +oid: String, +basis: String, rcode: U32, rout: String, +ref: String) -> PubObservation:
  Bool.pick(PubObservation, U32.is_eq(rcode, 0),
    Bool.pick(PubObservation, Tx.str_eq(Tx.trim_nl(rout), oid),
      ObsAttempted{code, out, record, destination, target, oid, basis, "verified-object", RereadRead{rcode, rout, ref}},
      ObsAttempted{code, out, record, destination, target, oid, basis, "mismatch-ref", RereadRead{rcode, rout, ref}}),
    ObsAttempted{code, out, record, destination, target, oid, basis, "unreadable-ref", RereadRead{rcode, rout, ref}})

def obs_reread_broken(code: U32, out: String, record: PubRecord, +destination: String, +target: String, +oid: String, +basis: String, +detail: String, +ref: String) -> PubObservation:
  ObsAttempted{code, out, record, destination, target, oid, basis, "unreadable-ref", RereadBroken{detail}}

def verify_ref(+obs: PubObservation, +repo: String, +target: String, +ref: String) -> IO(PubObservation):
  +r2 = repo
  do IO<PubObservation>:
    reread : T.GitOut <- Git.runGit(r2, Con{"rev-parse", Con{Tx.str_cat("refs/heads/", target), Nil{}}})
    IO.pure(PubObservation, verify_ref_pick(obs, reread, ref))

def verify_observation(+obs: PubObservation, +repo: String) -> IO(PubObservation):
  match obs:
    case ObsAttempted{code, out, record, destination, target, oid, basis, post, reread}:
      Bool.pick(IO(PubObservation), U32.is_eq(code, 0),
        verify_ref(obs, repo, target, Tx.str_cat("refs/heads/", target)),
        IO.pure(PubObservation, obs))
    case other: IO.pure(PubObservation, other)

def publish_run(+destination: String, +target: String, +oid: String, +basis: String, +want: String) -> IO(PubObservation):
  do IO<PubObservation>:
    pushed : T.GitOut <- Git.runGit(destination, publish_argv(destination, target, oid, basis))
    observation : PubObservation <- IO.pure(PubObservation, pub_obs(pushed, want, destination, target, oid, basis))
    verify_observation(observation, destination)

def publish_observe(+destination: String, +target: String, +oid: String, +basis: String) -> IO(PubObservation):
  +d2 = destination
  +t2 = target
  +o2 = oid
  +b2 = basis
  +want = publish_field(o2, t2)
  Bool.pick(IO(PubObservation), publish_destination_ok(d2),
    publish_run(d2, t2, o2, b2, want),
    IO.pure(PubObservation, ObsNotAttempted{"the publication destination is not an absolute canonical repository path", d2, t2, o2, b2}))

# --- holder discovery and state: prepared, NOT wired ---------------------------
#
# Supported record grammar, stated: the listing is a sequence of blocks separated by
# blank lines. A block is one "worktree <path>" line followed by at least one state
# line, one of "HEAD <oid>", "detached" or "bare", and AT MOST ONE
# "branch refs/heads/<name>" line. Implemented exactly and no further: a modifier line
# ("locked", "locked <reason>" or "prunable <reason>") requires an open block and never
# completes one, and the accumulator does not count modifiers, so no multiplicity rule is
# claimed for them. The supported transport is the line-separated porcelain form. NUL
# separation and text quoting are distinct unimplemented encoding choices: the
# `worktree list --porcelain -z` form would avoid text quoting, and the documentation
# consulted for this pin is current reference material, not a pinned executable contract. Completion criteria: every block
# carries a valid unquoted non-empty absolute path and at least one state line, every
# line belongs to the grammar, and at most one block names the target branch. Under
# those criteria the parsed observation may be read: exactly one qualified target match
# answers HolderFound with the path retained from that match, zero matches answer
# HolderNone. This is a source candidate over a parsed observation, not a qualified Git
# discovery: the guard-time holder association
# (holder_reobserve_under_guard(guard: U32, expected: HolderRequest) -> IO(HolderAssociation))
# and the exact supported transport remain unimplemented, so no answer here is
# evidence of what a live landing holds.
# Anything else - an unreadable or failing listing, an unsupported line, an unfinished
# block, a quoted or relative path, a second target match - is ambiguous or unreadable
# and never found or none. Every answer carries the immutable request identity and the
# full raw result; the verdict is derived from the observation, never rendered text.
type HolderBlock is Data:
  InBlock{path: String, has_state: Bool, branches: U32}
  NoBlock{}

# The holder's read state: the canonical path the caller supplied, with the raw
# result of every HEAD, index and tracked-status observation it made there.
type HolderState is Data:
  HolderRead{path: String, head: RereadObs, index: RereadObs, status: RereadObs}

# The immutable discovery request: the destination the listing is about, the target
# it is interpreted for, and the exact command used, so a retained observation
# cannot be reinterpreted for another target.
type HolderRequest is Data:
  HolderRequest{destination: String, target: String, argv: String}

# The accumulator keeps the block being read and the selected match separately, so a
# later worktree cannot replace the target path that was already matched.
type HolderScan is Data:
  ScanState{block: HolderBlock, match: Maybe<String>, seen: U32, bad: U32, blocks: U32}

type HolderDiscovery is Data:
  DiscoverRead{request: HolderRequest, code: U32, out: String}
  DiscoverBroken{request: HolderRequest, detail: String}

# The returned boundary: the retained observation with the derived interpretation, so a
# caller keeps the raw result and the request identity alongside the verdict.
type HolderObservation is Data:
  HolderObserved{request: HolderRequest, code: U32, out: String, verdict: HolderVerdict}
  HolderObservedBroken{request: HolderRequest, detail: String, verdict: HolderVerdict}

type HolderVerdict is Data:
  VerdictFound{request: HolderRequest, path: String}
  VerdictNone{request: HolderRequest}
  VerdictUnreadable{request: HolderRequest, code: U32, out: String}
  VerdictBroken{request: HolderRequest, detail: String}
  VerdictAmbiguous{request: HolderRequest, detail: String}

def prefix_drop(line: String, prefix: String) -> Maybe<String>:
  match prefix:
    case SNil{}: Some{line}
    case SCon{head, rest}:
      match line:
        case SNil{}: None{}
        case SCon{got, gotrest}:
          Bool.pick(Maybe<String>, Char.is_eq(head, got), prefix_drop(gotrest, rest), None{})

def holder_path_of(+line: String) -> Maybe<String>:
  prefix_drop(line, "worktree ")

def holder_path_ok(+path: String) -> Bool:
  Bool.pick(Bool, Tx.starts_with(path, "\""), False{},
    Bool.pick(Bool, Tx.starts_with(path, "/"), Bool.not(String.is_empty(path)), False{}))

def holder_branch_line(+target: String) -> String:
  T.str_cat3("branch ", "refs/heads/", target)

# A required state line carries the worktree's own HEAD, detachment or bare state,
# with an object named; locked and prunable are modifiers and never complete a block.
def holder_required_state(+line: String) -> Bool:
  Bool.pick(Bool, Tx.starts_with(line, "HEAD "),
    Bool.pick(Bool, Tx.str_eq(line, "HEAD "), False{}, True{}),
    Bool.pick(Bool, Tx.str_eq(line, "detached"), True{}, Tx.str_eq(line, "bare")))

# The label alone or the label plus its reason boundary; never an arbitrary lockedXYZ.
def holder_modifier(+line: String) -> Bool:
  Bool.pick(Bool, Tx.str_eq(line, "locked"), True{},
    Bool.pick(Bool, Tx.starts_with(line, "locked "), True{}, Tx.starts_with(line, "prunable ")))

def holder_valid_branch(+line: String) -> Bool:
  match prefix_drop(line, "branch refs/heads/"):
    case Some{value}: Bool.not(String.is_empty(value))
    case None{}: False{}

def holder_close(acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, match, seen, bad, blocks}:
      match block:
        case InBlock{path, has_state, branches}:
          Bool.pick(HolderScan, has_state,
            ScanState{NoBlock{}, match, seen, bad, U32.add(blocks, 1)},
            ScanState{NoBlock{}, match, seen, U32.add(bad, 1), blocks})
        case NoBlock{}: ScanState{NoBlock{}, match, seen, bad, blocks}

def holder_open(+path: Maybe<String>, +acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, match, seen, bad, blocks}:
      match block:
        case InBlock{openpath, has_state, branches}:
          ScanState{block, match, seen, U32.add(bad, 1), blocks}
        case NoBlock{}: holder_open_fresh(path, acc, request)

def holder_open_fresh(+path: Maybe<String>, +acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, match, seen, bad, blocks}:
      match path:
        case Some{value}:
          Bool.pick(HolderScan, holder_path_ok(value),
            ScanState{InBlock{value, False{}, 0}, match, seen, bad, blocks},
            ScanState{NoBlock{}, match, seen, U32.add(bad, 1), blocks})
        case None{}: ScanState{NoBlock{}, match, seen, U32.add(bad, 1), blocks}

def holder_in_block(+acc: HolderScan, +request: String) -> Bool:
  match acc:
    case ScanState{block, match, seen, bad, blocks}:
      match block:
        case InBlock{path, has_state, branches}: True{}
        case NoBlock{}: False{}

def holder_state_seen(+acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, match, seen, bad, blocks}:
      match block:
        case InBlock{path, has_state, branches}: ScanState{InBlock{path, True{}, branches}, match, seen, bad, blocks}
        case NoBlock{}: ScanState{NoBlock{}, match, seen, U32.add(bad, 1), blocks}

def holder_match_seen(+line: String, +target: String, +acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, match, seen, bad, blocks}:
      match block:
        case InBlock{path, has_state, branches}:
          Bool.pick(HolderScan, U32.is_lt(0, branches),
            ScanState{InBlock{path, has_state, branches}, match, seen, U32.add(bad, 1), blocks},
            holder_match_first(path, has_state, branches, acc, match))
        case NoBlock{}: ScanState{NoBlock{}, match, U32.add(seen, 1), U32.add(bad, 1), blocks}

def holder_match_first(+path: String, has_state: Bool, branches: U32, +acc: HolderScan, match: Maybe<String>) -> HolderScan:
  match acc:
    case ScanState{block, prior, seen, bad, blocks}:
      match prior:
        case Some{value}: ScanState{InBlock{path, has_state, U32.add(branches, 1)}, Some{value}, U32.add(seen, 1), bad, blocks}
        case None{}: ScanState{InBlock{path, has_state, U32.add(branches, 1)}, Some{path}, U32.add(seen, 1), bad, blocks}

def holder_branch_ok(+acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, match, seen, bad, blocks}:
      match block:
        case InBlock{path, has_state, branches}:
          Bool.pick(HolderScan, U32.is_lt(0, branches),
            ScanState{InBlock{path, has_state, branches}, match, seen, U32.add(bad, 1), blocks},
            ScanState{InBlock{path, has_state, U32.add(branches, 1)}, match, seen, bad, blocks})
        case NoBlock{}: ScanState{NoBlock{}, match, seen, U32.add(bad, 1), blocks}

def holder_verdict(+acc: HolderScan, +request: HolderRequest) -> HolderVerdict:
  match acc:
    case ScanState{block, match, seen, bad, blocks}:
      Bool.pick(HolderVerdict, U32.is_lt(0, bad), VerdictAmbiguous{request, "the worktree listing is unsupported, incomplete or malformed"},
        Bool.pick(HolderVerdict, U32.is_lt(1, seen), VerdictAmbiguous{request, "the target branch is named more than once"},
          Bool.pick(HolderVerdict, U32.is_eq(blocks, 0), VerdictAmbiguous{request, "the worktree listing carries no complete block"},
            holder_verdict_of(match, seen, request))))

def holder_verdict_of(match: Maybe<String>, seen: U32, +request: HolderRequest) -> HolderVerdict:
  match match:
    case Some{value}: VerdictFound{request, value}
    case None{}: Bool.pick(HolderVerdict, U32.is_eq(seen, 0), VerdictNone{request}, VerdictAmbiguous{request, "the target branch has no valid block"})

def holder_step(lines: List<String>, +branch: String, +target: String, +acc: HolderScan, +request: String) -> HolderScan:
  match lines:
    case Nil{}: holder_close(acc, request)
    case Con{h, rest}:
      Bool.pick(HolderScan, String.is_empty(h),
        holder_step(rest, branch, target, holder_close(acc, request), request),
        holder_line_step(h, rest, branch, target, acc, request))

def holder_line_step(+line: String, rest: List<String>, +branch: String, +target: String, +acc: HolderScan, +request: String) -> HolderScan:
  Bool.pick(HolderScan, Tx.starts_with(line, "worktree "),
    holder_step(rest, branch, target, holder_open(holder_path_of(line), acc, request), request),
    Bool.pick(HolderScan, holder_required_state(line),
      holder_step(rest, branch, target, holder_ok_state(acc, request), request),
      Bool.pick(HolderScan, Tx.str_eq(line, branch),
        holder_step(rest, branch, target, holder_match_seen(line, target, acc, request), request),
        Bool.pick(HolderScan, holder_valid_branch(line),
          holder_step(rest, branch, target, holder_branch_ok(acc, request), request),
          Bool.pick(HolderScan, holder_modifier(line),
            holder_step(rest, branch, target, holder_ok_branch(acc, request), request),
            holder_step(rest, branch, target, holder_bad(acc, request), request))))))

def holder_ok_state(+acc: HolderScan, +request: String) -> HolderScan:
  Bool.pick(HolderScan, holder_in_block(acc, request), holder_state_seen(acc, request), holder_bad(acc, request))

def holder_ok_branch(+acc: HolderScan, +request: String) -> HolderScan:
  Bool.pick(HolderScan, holder_in_block(acc, request), acc, holder_bad(acc, request))

def holder_bad(+acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, match, seen, bad, blocks}: ScanState{block, match, seen, U32.add(bad, 1), blocks}

def holder_scan(lines: List<String>, +request: HolderRequest) -> HolderVerdict:
  +target = holder_request_target(request)
  holder_verdict(holder_step(lines, holder_branch_line(target), target, ScanState{NoBlock{}, None{}, 0, 0, 0}, holder_request_argv(request)), request)

def holder_request_target(request: HolderRequest) -> String:
  match request:
    case HolderRequest{destination, target, argv}: target

def holder_request_argv(request: HolderRequest) -> String:
  match request:
    case HolderRequest{destination, target, argv}: argv

def holder_discover(request: HolderRequest, g: T.GitOut) -> HolderDiscovery:
  match g:
    case T.GRun{code, out}: DiscoverRead{request, code, out}
    case T.GBroken{detail}: DiscoverBroken{request, detail}

# The target is taken from the retained request, and a broken command stays broken
# instead of being rendered as a status that was never observed.
def holder_verdict_of_discovery(discovery: HolderDiscovery) -> HolderVerdict:
  match discovery:
    case DiscoverRead{request, code, out}:
      Bool.pick(HolderVerdict, U32.is_eq(code, 0),
        holder_scan(Tx.split_lines(out), request),
        VerdictUnreadable{request, code, out})
    case DiscoverBroken{request, detail}: VerdictBroken{request, detail}

# The boundary a caller retains: the observation and its interpretation together.
def holder_read(discovery: HolderDiscovery) -> HolderObservation:
  match discovery:
    case DiscoverRead{request, code, out}: HolderObserved{request, code, out, holder_verdict_of_discovery(discovery)}
    case DiscoverBroken{request, detail}: HolderObservedBroken{request, detail, holder_verdict_of_discovery(discovery)}

def holder_state(+path: String) -> IO(HolderState):
  +p2 = path
  do IO<HolderState>:
    head : T.GitOut <- Git.runGit(p2, ["rev-parse", "HEAD"])
    index : T.GitOut <- Git.runGit(p2, ["diff", "--cached", "--name-status"])
    status : T.GitOut <- Git.runGit(p2, ["status", "--porcelain"])
    IO.pure(HolderState, HolderRead{p2, reread_of(head, p2), reread_of(index, p2), reread_of(status, p2)})

def reread_of(g: T.GitOut, +ref: String) -> RereadObs:
  match g:
    case T.GRun{code, out}: RereadRead{code, out, ref}
    case T.GBroken{detail}: RereadBroken{detail}

def holder_path_same(+expected: String, +found: String) -> Bool:
  Tx.str_eq(expected, found)

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

# The guarded fast-forward mutation. The compare-and-swap operands are the ones this chain
# already carries: wc is the candidate and tb is the old target read by stage 3. The guard
# path comes from Receipt.guard_path, the attempt scratch and artifact are derived, and the
# chain retains the capture pair and the release result. Only a completed capture with a
# zero exit and a completed release reports LLanded; a refusal, a mismatch, a capture that
# did not complete, or a release failure reports LBlocked and names the artifact that holds
# the raw evidence, so a post-state or release failure can never read as an ordinary landing.
def ff_stage5_landed(target: String, candidate: String) -> IO(FFLD):
  +tg = target
  +cand = candidate
  IO.pure(FFLD, FFDone{T.LLanded{tg, cand}})

def ff_stage5_blocked(detail: String) -> IO(FFLD):
  +d = detail
  IO.pure(FFLD, FFDone{T.LBlocked{d}})

def ff_stage5_captured(target: String, candidate: String, artifact: String, repo: String, observed: Result<&1,&1,U32 & String,String & String>) -> IO(FFLD):
  +tg = target
  +cand = candidate
  +art = artifact
  +rp = repo
  match observed:
    case Fail{error}:
      match error:
        case (code, detail): ff_stage5_blocked(Tx.str_cat("capture failed; stderr at ", Tx.str_cat(art, Tx.str_cat("; ", detail))))
    case Done{pair}:
      match pair:
        case (framing, diagnostics): ff_stage5_framing(tg, cand, art, rp, framing, diagnostics)

def ff_stage5_framing(target: String, candidate: String, artifact: String, repo: String, framing: String, diagnostics: String) -> IO(FFLD):
  +tg = target
  +cand = candidate
  +art = artifact
  +rp = repo
  +framed = framing
  +diag = diagnostics
  +held = Tx.str_cat("stderr bytes ", Tx.str_cat(diag, Tx.str_cat("; artifact ", art)))
  match Tx.run_res(Done{framed}):
    case T.RSpawn{detail}: ff_stage5_blocked(Tx.str_cat("mutation could not be spawned: ", detail))
    case T.RRun{status, out}:
      +observed = Tx.str_cat("stdout bytes ", Tx.str_cat(out, Tx.str_cat("; ", held)))
      ff_stage5_status(tg, cand, rp, art, observed, status)

def ff_stage5_status(target: String, candidate: String, repo: String, artifact: String, evidence: String, status: T.Status) -> IO(FFLD):
  +tg = target
  +cand = candidate
  +rp = repo
  +art = artifact
  +ev = evidence
  match status:
    case T.SSignal{num}: ff_stage5_blocked(Tx.str_cat("mutation signalled; ", ev))
    case T.SExit{code}:
      match U32.is_eq(code, 0):
        case True{}: ff_stage5_postread(tg, cand, rp, art, ev)
        case False{}: ff_stage5_blocked(Tx.str_cat("mutation exited nonzero; ", ev))
def ff_stage5_postread(target: String, candidate: String, repo: String, artifact: String, evidence: String) -> IO(FFLD):
  +tg = target
  +cand = candidate
  +rp = repo
  +art = artifact
  +ev = evidence
  do IO<FFLD>:
    observed : T.GitOut <- Git.runGit(rp, Con{"rev-parse", Con{"--verify", Con{"--end-of-options", Con{Tx.str_cat("refs/heads/", tg), Nil{}}}}})
    ff_stage5_postread_seen(tg, cand, art, ev, observed)

def ff_stage5_postread_seen(target: String, candidate: String, artifact: String, evidence: String, observed: T.GitOut) -> IO(FFLD):
  +tg = target
  +cand = candidate
  +art = artifact
  +ev = evidence
  match observed:
    case T.GBroken{detail}: ff_stage5_blocked(Tx.str_cat("post-state unreadable: ", detail))
    case T.GRun{code, head}:
      match U32.is_eq(code, 0):
        case False{}: ff_stage5_blocked(Tx.str_cat("post-state read failed; ", ev))
        case True{}: ff_stage5_postread_compared(tg, cand, art, ev, Tx.trim_nl(head))

def ff_stage5_postread_compared(target: String, candidate: String, artifact: String, evidence: String, head: String) -> IO(FFLD):
  +tg = target
  +cand = candidate
  +art = artifact
  +ev = evidence
  +seen = head
  match Tx.str_eq(seen, cand):
    case True{}: ff_stage5_landed(tg, cand)
    case False{}: ff_stage5_blocked(Tx.str_cat("post-state is not the candidate; ", ev))

def ff_stage5_outcome(target: String, candidate: String, artifact: String, repo: String, outcome: Lg.Landing) -> IO(FFLD):
  +tg = target
  +cand = candidate
  +art = artifact
  +rp = repo
  +out = outcome
  match out:
    case Lg.LandingHeld{request, candidate, basis, published, mutation, released}:
      match released:
        case Fail{error}:
          match error:
            case (code, detail): ff_stage5_blocked(Tx.str_cat("release failed: ", Tx.str_cat(detail, Tx.str_cat("; artifact ", art))))
        case Done{unit}: ff_stage5_captured(tg, cand, art, rp, mutation)
    case Lg.LandingClaimFailed{error}:
      match error:
        case (code, detail): ff_stage5_blocked(Tx.str_cat("claim failed: ", detail))
    case Lg.LandingGuardBusy{target}: ff_stage5_blocked("guard busy")
    case Lg.LandingAssociationRefused{step, observation, released}: ff_stage5_blocked(Tx.str_cat("association refused at ", step))
    case Lg.LandingOldValueMismatch{expected, found, released}: ff_stage5_blocked("old target moved during landing; retry")
    case Lg.LandingPublishRefused{outcome, released}: ff_stage5_blocked("intent publication refused")

def ff_stage5_guarded_now(candidate: String, old: String, repo: String, target: String, common: String, guard: String) -> IO(FFLD):
  +cand = candidate
  +tb = old
  +rp = repo
  +tg = target
  +cm = common
  +gd = guard
  do IO<FFLD>:
    token : Result<U32 & String, String> <- Rec.Receipt.attempt_token(tg)
    ff_stage5_named(cand, tb, rp, tg, cm, gd, token)

def ff_stage5_named(candidate: String, old: String, repo: String, target: String, common: String, guard: String, observed: Result<U32 & String, String>) -> IO(FFLD):
  +cand = candidate
  +tb = old
  +rp = repo
  +tg = target
  +cm = common
  +gd = guard
  match observed:
    case Fail{error}: ff_stage5_blocked("cannot name the attempt token for this target")
    case Done{token}:
      +tk = token
      +name = Tx.str_cat(tk, Tx.str_cat("-", Tx.str_cat(cand, Tx.str_cat("-", tb))))
      +scratch = Lg.attempt_directory_for(cm, name)
      +art = Lg.attempt_artifact_for(cm, name)
      +intent = It.IntentRequested{name, cm, tg, rp, cand, tb, Pb.intent_path(scratch, "intent"), rp, tb}
      +request = Lg.LandingRequested{intent, "intent", tb, "", gd, art, scratch, rp}
      do IO<FFLD>:
        outcome : Lg.Landing <- Lg.Landing.run(request)
        ff_stage5_outcome(tg, cand, art, rp, outcome)
def ff_stage5_guarded(wc: String, tb: String, repo: String, target: String) -> IO(FFLD):
  +cand = wc
  +old = tb
  +rp = repo
  +tg = target
  do IO<FFLD>:
    common_g : T.GitOut <- Git.runGit(rp, Con{"rev-parse", Con{"--path-format=absolute", Con{"--git-common-dir", Nil{}}}})
    ff_stage5_common(cand, old, rp, tg, common_g)

def ff_stage5_common(cand: String, old: String, repo: String, target: String, observed: T.GitOut) -> IO(FFLD):
  +candidate = cand
  +tb = old
  +rp = repo
  +tg = target
  match observed:
    case T.GBroken{detail}: ff_stage5_blocked(detail)
    case T.GRun{code, out}:
      match U32.is_eq(code, 0):
        case False{}: ff_stage5_blocked("cannot read the common directory for the landing guard")
        case True{}: ff_stage5_guardpath(candidate, tb, rp, tg, Tx.trim_nl(out))

def ff_stage5_guardpath(cand: String, old: String, repo: String, target: String, common: String) -> IO(FFLD):
  +candidate = cand
  +tb = old
  +rp = repo
  +tg = target
  +cm = common
  do IO<FFLD>:
    guard_g : Result<U32 & String, String> <- Rec.Receipt.guard_path(cm, tg)
    ff_stage5_guard_observed(candidate, tb, rp, tg, cm, guard_g)

def ff_stage5_guard_observed(cand: String, old: String, repo: String, target: String, common: String, observed: Result<U32 & String, String>) -> IO(FFLD):
  +candidate = cand
  +tb = old
  +rp = repo
  +tg = target
  +cm = common
  match observed:
    case Fail{error}: ff_stage5_blocked("cannot name the landing guard")
    case Done{guard}: ff_stage5_guarded_now(candidate, tb, rp, tg, cm, guard)


# The fast-forward now advances through the same holder-aware path the checked landing uses,
# so both reach one effect. Only a landed answer reports LLanded; a moved target, a held
# worktree, a changed holder, a refused update and a broken read each keep their own answer.
def ff_stage5_adv_answer(a: LAdv, target: String, cand: String) -> FFLD:
  match a:
    case AdvLanded{}: FFDone{T.LLanded{target, cand}}
    case AdvMoved{}: FFDone{T.LBlocked{"target moved during landing; retry"}}
    case AdvHeld{path}: FFDone{T.LBlocked{Tx.str_cat("the target is held by a worktree: ", path)}}
    case AdvHolderChanged{path}: FFDone{T.LBlocked{Tx.str_cat("the holder changed: ", path)}}
    case AdvRefused{}: FFDone{T.LBlocked{"git update-ref failed; inspect the target and retry"}}
    case AdvBroken{detail}: FFDone{T.LBlocked{detail}}

def ff_stage5_shared(wc: String, tb: String, repo: String, target: String) -> IO(FFLD):
  +cand = wc
  +basis = tb
  +rp = repo
  +tg = target
  do IO<FFLD>:
    shared : SharedLanding <- shared_landing_run(rp, tg, cand, basis)
    IO.pure(FFLD, ff_stage5_shared_answer(shared, tg, cand))

def ff_go5(r: FFLD, repo: String, target: String) -> IO(FFLD):
  match r:
    case FFDone{outcome}: IO.pure(FFLD, FFDone{outcome})
    case FFNext{wc, tb}: ff_stage5_shared(wc, tb, repo, target)

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

# The reviewed-source entry: the caller has already resolved an immutable commit
# and the pipeline starts after branch resolution, so no branch name is read
# here. Stages 2 to 5, their outcome type and the CAS target update are the same
# ones the branch entry uses.
def land_fast_forward_at(repo: String, +workerCommit: String, target: String) -> IO(T.LandOutcome):
  +rp = repo
  +tg = target
  +wc = workerCommit
  do IO<T.LandOutcome>:
    r2 : FFLD <- ff_go2(FFNext{wc, ""}, rp, tg)
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
# next stage needs; sha is the worker commit stage 1 resolved.
type Ld is Data:
  LdDone{made: T.LandOutcome}
  LdFail{fail: T.GitFail}
  LdWk{worker: String, sha: String}
  LdTip{worker: String, sha: String, tip: String}
  LdCand{tip: String, cand: String}

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

# The first line of a run's output that is not a failure identity, so an
# unjudged verdict carries its cause: the offending line, or the fact that the
# check printed nothing.
def first_bad_go(lines: List<String>, acc: String) -> String:
  match lines:
    case Nil{}: acc
    case Con{line, rest}:
      +l2 = line
      +a2 = acc
      Bool.pick(String, String.is_empty(a2), Bool.pick(String, line_ok(l2), first_bad_go(rest, a2), l2), a2)

def first_bad(block: String) -> String:
  first_bad_go(Tx.split_lines(block), "")

def unjudged_why(block: String) -> String:
  +b2 = block
  Bool.pick(String, String.is_empty(b2), "the check printed nothing", Tx.str_cat("check output is not failure identities: ", first_bad(b2)))

def block_ok_go(lines: List<String>, ok: Bool) -> Bool:
  match lines:
    case Nil{}: ok
    case Con{line, rest}:
      +l2 = line
      +o2 = Bool.pick(Bool, ok, line_ok(l2), False{})
      block_ok_go(rest, o2)

def block_ok(block: String) -> Bool:
  +b2 = block
  block_ok_go(Tx.split_lines(b2), Tx.non_empty(b2))

def block_has_go(lines: List<String>, want: String) -> Bool:
  match lines:
    case Nil{}: False{}
    case Con{h, rest}:
      +w2 = want
      +hit = Tx.str_eq(h, w2)
      Bool.pick(Bool, hit, True{}, block_has_go(rest, w2))

def block_has(block: String, want: String) -> Bool:
  block_has_go(Tx.split_lines(block), want)

def exit_fail_ok(ok: Bool, +block: String, file: String) -> FV:
  match ok:
    case True{}: FV{file, VFail{block}}
    case False{}: FV{file, VNone{unjudged_why(block)}}

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
    case False{}: LdFail{T.FCmd{"land", "git update-ref failed; inspect the target and rerun land-checked to prepare and check a new candidate"}}

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

def ld_update_argv(target: String, cand: String, basis: String) -> List<String>:
  ["update-ref", Tx.str_cat("refs/heads/", target), cand, basis]

# How the target branch advanced, or why it did not.
def ld_adv_update(repo: String, target: String, cand: String, basis: String) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ld_update_argv(t2, c2, b2))
    IO.pure(Ld, ld_update_pick(g, t2, c2))

def ld_adv_same(same: Bool, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  match same:
    case False{}: IO.pure(LAdv, AdvMoved{})
    case True{}:
      +r2 = repo
      +t2 = target
      do IO<LAdv>:
        gl : T.GitOut <- Git.runGit(r2, ["worktree", "list", "--porcelain"])
        ld_adv_holder(ld_hold_read(gl, t2), r2, t2, cand, basis)


def ld_hold_ref(target: String) -> String:
  Tx.str_cat("refs/heads/", target)

# The branch line a worktree report carries when it holds the target.
def ld_hold_branch(target: String) -> String:
  Tx.str_cat("branch ", ld_hold_ref(target))
# The holder's block in a `git worktree list --porcelain` report: each block is
# one "worktree <path>" line and the state lines that follow it, and the block
# whose branch line names the target branch is the worktree that holds it. The
# path is taken from the line as Git writes it, so a path Git quoted is not a
# path this module can enter and the advance never runs in one.
type LdHoldScan is Data:
  HoldScan{cur: String, found: String, seen: U32}

# One branch line that names the target: the first one records the path of the
# block it appeared in, and any later one, or one that appeared before any
# block, makes the listing unusable.
def ld_hold_named(+cur: String, +found: String, +seen: U32) -> LdHoldScan:
  Bool.pick(LdHoldScan, String.is_empty(cur),
    HoldScan{cur, found, 2},
    Bool.pick(LdHoldScan, U32.is_eq(seen, 0),
      HoldScan{cur, cur, 1},
      HoldScan{cur, found, 2}))

def ld_hold_line(+line: String, acc: LdHoldScan, want: String) -> LdHoldScan:
  match acc:
    case HoldScan{+cur, +found, +seen}:
      Bool.pick(LdHoldScan, Tx.starts_with(line, "worktree "),
        HoldScan{wt_path(line), found, seen},
        Bool.pick(LdHoldScan, Tx.str_eq(line, want),
          ld_hold_named(cur, found, seen),
          HoldScan{cur, found, seen}))

def ld_hold_scan(lines: List<String>, acc: LdHoldScan, +want: String) -> LdHoldScan:
  match lines:
    case Nil{}: acc
    case Con{h, rest}: ld_hold_scan(rest, ld_hold_line(h, acc, want), want)

# The worktree that holds the target: its path, none, or the reason the report
# cannot be trusted to name exactly one.
type LdHold is Data:
  HoldNone{}
  HoldPath{path: String}
  HoldBlocked{detail: String}

# The holder one report names, or the reason it names no usable one.
def ld_hold_end(acc: LdHoldScan) -> LdHold:
  match acc:
    case HoldScan{cur, found, +seen}:
      Bool.pick(LdHold, U32.is_eq(seen, 0), HoldNone{},
        Bool.pick(LdHold, U32.is_eq(seen, 1), HoldPath{found},
          HoldBlocked{"the worktree listing names the target branch in more than one block, or outside a block"}))

def ld_hold_of(out: String, target: String) -> LdHold:
  ld_hold_end(ld_hold_scan(Tx.split_lines(out), HoldScan{"", "", 0}, ld_hold_branch(target)))

# The holder of a listing that ran: the report's holder, or the reason the
# listing itself cannot be read.
def ld_hold_read(g: T.GitOut, target: String) -> LdHold:
  match g:
    case T.GRun{code, out}:
      Bool.pick(LdHold, U32.is_eq(code, 0),
        ld_hold_of(out, target),
        HoldBlocked{"the worktree listing could not be read"})
    case T.GBroken{detail}: HoldBlocked{detail}

# The target commit lookup used by the existing unheld compare-and-swap path.
def ld_tip_argv(target: String) -> List<String>:
  ["rev-parse", "--verify", Tx.str_cat(target, "^{commit}")]

# The exact local target branch commit used to validate a held worktree.
def ld_target_ref_argv(target: String) -> List<String>:
  ["rev-parse", "--verify", Tx.str_cat(ld_hold_ref(target), "^{commit}")]

# The attached branch name of a worktree, or a nonzero result when detached.
def ld_head_argv() -> List<String>:
  ["symbolic-ref", "--quiet", "HEAD"]

# The update-ref argv: the target ref, the candidate and the basis it advanced
# from, so the branch moves only while it still reads as that basis.
type LAdv is Data:
  AdvLanded{}
  AdvMoved{}
  AdvHeld{path: String}
  AdvHolderChanged{path: String}
  AdvRefused{}
  AdvBroken{detail: String}

# The compare-and-swap where no worktree holds the target.
def ld_adv_cas(g: T.GitOut) -> LAdv:
  match g:
    case T.GRun{code, out}: Bool.pick(LAdv, U32.is_eq(code, 0), AdvLanded{}, AdvRefused{})
    case T.GBroken{detail}: AdvBroken{detail}

def ld_adv_cas_run(repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  do IO<LAdv>:
    g : T.GitOut <- Git.runGit(r2, ld_update_argv(t2, c2, b2))
    IO.pure(LAdv, ld_adv_cas(g))

# A refused fast-forward of a target that still reads as the basis is that
# worktree's own state: uncommitted changes in the way, or an unfinished
# operation. A target that no longer reads as the basis moved instead.
def ld_adv_refused_same(same: Bool, path: String) -> LAdv:
  match same:
    case True{}: AdvHeld{path}
    case False{}: AdvMoved{}

def ld_adv_refused_pick(g: T.GitOut, path: String, basis: String) -> LAdv:
  match g:
    case T.GRun{code, out}:
      Bool.pick(LAdv, U32.is_eq(code, 0),
        ld_adv_refused_same(Tx.str_eq(Tx.trim_nl(out), basis), path),
        AdvBroken{"the target commit could not be read after a refused fast-forward"})
    case T.GBroken{detail}: AdvBroken{detail}

def ld_adv_wt_refused(path: String, repo: String, target: String, basis: String) -> IO(LAdv):
  +p2 = path
  +r2 = repo
  +b2 = basis
  do IO<LAdv>:
    g : T.GitOut <- Git.runGit(r2, ld_target_ref_argv(target))
    IO.pure(LAdv, ld_adv_refused_pick(g, p2, b2))

# A successful held merge is observed at the local target ref and at the
# worktree's current symbolic HEAD before it can answer landed. The preflight
# checks both again after worktree discovery, so an already-visible branch
# change does not reuse a stale holder path. Git provides no atomic CLI
# operation that pins symbolic HEAD across the final identity check and merge.
# A switch in that interval can still direct Git's merge to another branch;
# post-operation reads refuse a landed answer if the holder or target changed,
# but they cannot roll back that concurrent side effect.
def ld_adv_wt_observed(target_matches: Bool, holder_matches: Bool, path: String) -> LAdv:
  match target_matches:
    case False{}: AdvMoved{}
    case True{}:
      match holder_matches:
        case True{}: AdvLanded{}
        case False{}: AdvHolderChanged{path}

def ld_adv_wt_observed_holder_pick(g: T.GitOut, path: String, target: String) -> IO(LAdv):
  match g:
    case T.GRun{code, out}:
      +status_ok = U32.is_eq(code, 0)
      +same = Bool.pick(Bool, status_ok,
        Tx.str_eq(Tx.trim_nl(out), ld_hold_ref(target)), False{})
      IO.pure(LAdv, ld_adv_wt_observed(True{}, same, path))
    case T.GBroken{detail}: IO.pure(LAdv, AdvBroken{detail})

def ld_adv_wt_observed_target_same(same: Bool, path: String, target: String) -> IO(LAdv):
  match same:
    case False{}: IO.pure(LAdv, AdvMoved{})
    case True{}:
      +p2 = path
      +t2 = target
      do IO<LAdv>:
        holder : T.GitOut <- Git.runGit(p2, ld_head_argv())
        ld_adv_wt_observed_holder_pick(holder, p2, t2)

def ld_adv_wt_observed_target_pick(g: T.GitOut, path: String, target: String, cand: String) -> IO(LAdv):
  match g:
    case T.GRun{code, out}:
      +status_ok = U32.is_eq(code, 0)
      +same = Bool.pick(Bool, status_ok, Tx.str_eq(Tx.trim_nl(out), cand), False{})
      ld_adv_wt_observed_target_same(same, path, target)
    case T.GBroken{detail}: IO.pure(LAdv, AdvBroken{detail})

# Read the exact target ref after the held fast-forward and require its tip to
# remain the source candidate before checking which branch the holder has now.
def ld_adv_wt_observe(path: String, repo: String, target: String, cand: String) -> IO(LAdv):
  +p2 = path
  +r2 = repo
  +t2 = target
  +c2 = cand
  do IO<LAdv>:
    target_tip : T.GitOut <- Git.runGit(r2, ld_target_ref_argv(t2))
    ld_adv_wt_observed_target_pick(target_tip, p2, t2, c2)

def ld_adv_wt_pick(g: T.GitOut, path: String, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  match g:
    case T.GRun{code, out}:
      +p2 = path
      +r2 = repo
      +t2 = target
      +c2 = cand
      +b2 = basis
      Bool.pick(IO(LAdv), U32.is_eq(code, 0),
        ld_adv_wt_observe(p2, r2, t2, c2),
        ld_adv_wt_refused(p2, r2, t2, b2))
    case T.GBroken{detail}: IO.pure(LAdv, AdvBroken{detail})

def ld_adv_wt_head_same(same: Bool, path: String, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  match same:
    case False{}: IO.pure(LAdv, AdvHolderChanged{path})
    case True{}:
      +p2 = path
      +r2 = repo
      +t2 = target
      +c2 = cand
      +b2 = basis
      do IO<LAdv>:
        merged : T.GitOut <- Git.runGit(p2, ["merge", "--ff-only", c2])
        ld_adv_wt_pick(merged, p2, r2, t2, c2, b2)

def ld_adv_wt_head_pick(g: T.GitOut, path: String, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  match g:
    case T.GRun{code, out}:
      +t2 = target
      +status_ok = U32.is_eq(code, 0)
      +same = Bool.pick(Bool, status_ok,
        Tx.str_eq(Tx.trim_nl(out), ld_hold_ref(t2)), False{})
      ld_adv_wt_head_same(same, path, repo, t2, cand, basis)
    case T.GBroken{detail}: IO.pure(LAdv, AdvBroken{detail})

def ld_adv_wt_target_same(same: Bool, path: String, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  match same:
    case False{}: IO.pure(LAdv, AdvMoved{})
    case True{}:
      +p2 = path
      +r2 = repo
      +t2 = target
      +c2 = cand
      +b2 = basis
      do IO<LAdv>:
        holder : T.GitOut <- Git.runGit(p2, ld_head_argv())
        ld_adv_wt_head_pick(holder, p2, r2, t2, c2, b2)

def ld_adv_wt_target_pick(g: T.GitOut, path: String, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  match g:
    case T.GRun{code, out}:
      +b2 = basis
      +status_ok = U32.is_eq(code, 0)
      +same = Bool.pick(Bool, status_ok, Tx.str_eq(Tx.trim_nl(out), b2), False{})
      ld_adv_wt_target_same(same, path, repo, target, cand, b2)
    case T.GBroken{detail}: IO.pure(LAdv, AdvBroken{detail})


def ld_adv_wt(path: String, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  +p2 = path
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  do IO<LAdv>:
    target_tip : T.GitOut <- Git.runGit(r2, ld_target_ref_argv(t2))
    ld_adv_wt_target_pick(target_tip, p2, r2, t2, c2, b2)
# The advance of a target no worktree holds, and of one a worktree holds.
def ld_adv_holder(hold: LdHold, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  match hold:
    case HoldNone{}: ld_adv_cas_run(repo, target, cand, basis)
    case HoldPath{path}: ld_adv_wt(path, repo, target, cand, basis)
    case HoldBlocked{detail}: IO.pure(LAdv, AdvBroken{detail})

def ld_adv_holder_changed_text(target: String, path: String) -> String:
  "the worktree at " ++ path ++ " changed away from target branch " ++ target ++ " during landing; inspect the target and worktree before retrying"

# The holder is read only for a target that still reads as the basis, so a
# moved target answers the movement before any worktree is touched.
def ld_adv_pick(g: T.GitOut, repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  match g:
    case T.GRun{code, out}:
      +b2 = basis
      Bool.pick(IO(LAdv), U32.is_eq(code, 0),
        ld_adv_same(Tx.str_eq(Tx.trim_nl(out), b2), repo, target, cand, b2),
        IO.pure(LAdv, AdvBroken{"the target commit could not be read before publication"}))
    case T.GBroken{detail}: IO.pure(LAdv, AdvBroken{detail})

# The advance: read the target tip, then move the branch only while it still
# reads as the basis the candidate was checked against. The tip read is what
# refuses a branch nobody holds that moved since the candidate was prepared,
# and what keeps the update-ref compare-and-swap honest.
def ld_adv_run(repo: String, target: String, cand: String, basis: String) -> IO(LAdv):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  do IO<LAdv>:
    g : T.GitOut <- Git.runGit(r2, ld_tip_argv(t2))
    ld_adv_pick(g, r2, t2, c2, b2)

# What a refused fast-forward of a held target answers. Git's own message for
# the refusal is in the coordinator log; the answer names the worktree and the
# operation that resolves it.
def ld_adv_held_text(target: String, path: String) -> String:
  "the target branch " ++ target ++ " is checked out at " ++ path ++ "; the fast-forward into that worktree was refused (git's own message is in the coordinator log); commit or stash that worktree's changes, or repair the worktree, and "

# ---------------------------------------------------------------------------

def ld_adv_answer(a: LAdv, target: String, cand: String) -> Ld:
  match a:
    case AdvLanded{}: LdDone{T.LLanded{target, cand}}
    case AdvMoved{}: LdDone{T.LBlocked{"target moved during checked landing; rerun land-checked to prepare and check against the current target"}}
    case AdvHeld{path}: LdDone{T.LBlocked{ld_adv_held_text(target, path) ++ "rerun land-checked to prepare and check against the current target"}}
    case AdvHolderChanged{path}: LdDone{T.LBlocked{ld_adv_holder_changed_text(target, path)}}
    case AdvRefused{}: LdFail{T.FCmd{"land", "git update-ref failed; inspect the target and rerun land-checked to prepare and check a new candidate"}}
    case AdvBroken{detail}: LdFail{T.FCmd{"land", detail}}

# Advance the checked candidate from its checked basis. A changed target
# returns an explicit retry result; the next invocation prepares both trees.

def ld_advance(repo: String, target: String, cand: String, basis: String) -> IO(Ld):
  +t2 = target
  +c2 = cand
  do IO<Ld>:
    shared : SharedLanding <- shared_landing_run(repo, t2, c2, basis)
    IO.pure(Ld, ld_advance_shared_answer(shared, t2, c2))

# Stage 1 resolves the worker commit; the pipeline carries the resolved sha
# so the LAlready answer names the worker commit.
def ld_resolved_ok(ok: Bool, out: String, worker: String) -> IO(Ld):
  match ok:
    case True{}: IO.pure(Ld, LdWk{worker, Tx.trim_nl(out)})
    case False{}: IO.pure(Ld, LdFail{T.FUnknownBase{worker}})

def ld_resolved_pick(g: T.GitOut, worker: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_resolved_ok(U32.is_eq(code, 0), out, worker)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_stage1(repo: String, target: String, worker: String) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +w2 = worker
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["rev-parse", "--verify", "--quiet", Tx.str_cat(w2, "^{commit}")])
    ld_resolved_pick(g, w2)

# Stage 2 resolves the target tip the candidate is prepared on.
def ld_tip_ok(ok: Bool, tip: String, worker: String, sha: String) -> Ld:
  match ok:
    case True{}: LdTip{worker, sha, tip}
    case False{}: LdFail{T.FCmd{"land", "unknown target"}}

def ld_tip_of(g: T.GitOut, worker: String, sha: String) -> Ld:
  match g:
    case T.GRun{code, out}: ld_tip_ok(U32.is_eq(code, 0), Tx.trim_nl(out), worker, sha)
    case T.GBroken{detail}: LdFail{T.FCmd{"land", detail}}

def ld_stage2(repo: String, target: String, worker: String, sha: String) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +w2 = worker
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["rev-parse", "--verify", Tx.str_cat(t2, "^{commit}")])
    IO.pure(Ld, ld_tip_of(g, w2, sha))

# Stage 3 creates the candidate worktree, detached at the target tip.
def ld_wt_ok(ok: Bool, out: String, worker: String, sha: String, tip: String) -> Ld:
  match ok:
    case True{}: LdTip{worker, sha, tip}
    case False{}: LdFail{T.FCmd{"land", Tx.cmd_failed("git worktree add --detach")}}

def ld_wt_pick(g: T.GitOut, worker: String, sha: String, tip: String) -> Ld:
  match g:
    case T.GRun{code, out}: ld_wt_ok(U32.is_eq(code, 0), Tx.trim_nl(out), worker, sha, tip)
    case T.GBroken{detail}: LdFail{T.FCmd{"land", detail}}

def ld_stage3(repo: String, worker: String, sha: String, tip: String, scratch: String) -> IO(Ld):
  +r2 = repo
  +w2 = worker
  +t2 = tip
  +s2 = scratch
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ["worktree", "add", "--detach", s2, t2])
    IO.pure(Ld, ld_wt_pick(g, w2, sha, t2))

# Stage 4 stages the worker's tree on the target tip; a conflict leaves the
# unmerged paths in the scratch worktree for the requester.
def ld_squash_ok(ok: Bool, out: String, worker: String, sha: String, tip: String, scratch: String) -> IO(Ld):
  match ok:
    case True{}: IO.pure(Ld, LdTip{worker, sha, tip})
    case False{}: ld_unmerged(scratch, Tx.cmd_failed("git merge --squash"))

def ld_squash_pick(g: T.GitOut, worker: String, sha: String, tip: String, scratch: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_squash_ok(U32.is_eq(code, 0), Tx.trim_nl(out), worker, sha, tip, scratch)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_stage4(scratch: String, worker: String, sha: String, tip: String) -> IO(Ld):
  +sc = scratch
  +w2 = worker
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(sc, ["merge", "--squash", w2])
    ld_squash_pick(g, w2, sha, tip, sc)

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

def ld_commit_fail_go(nothing: Bool, out: String, worker: String, sha: String, tip: String) -> IO(Ld):
  match nothing:
    case True{}: IO.pure(Ld, LdDone{T.LAlready{sha}})
    case False{}: IO.pure(Ld, LdFail{T.FCmd{"land", Tx.cmd_failed("git commit")}})

def ld_commit_fail(out: String, worker: String, sha: String, tip: String) -> IO(Ld):
  +o2 = out
  ld_commit_fail_go(nothing_go(Tx.split_lines(o2)), o2, worker, sha, tip)

def ld_commit_ok(ok: Bool, out: String, scratch: String, worker: String, sha: String, tip: String) -> IO(Ld):
  match ok:
    case True{}: ld_cand_read(tip, scratch)
    case False{}: ld_commit_fail(out, worker, sha, tip)

def ld_commit_next(g: T.GitOut, scratch: String, worker: String, sha: String, tip: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_commit_ok(U32.is_eq(code, 0), Tx.trim_nl(out), scratch, worker, sha, tip)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

# Stage 5 drops the added paths this repository's own ignore rules exclude,
# constructs the message from the worker history above the target merge-base,
# and commits with the worker branch and dropped paths named in the body.
def ld_message(workerMessage: String, worker: String, paths: String) -> String:
  Tx.trim_nl(workerMessage) ++ "\n\nlanded from " ++ worker ++ Deb.debris_note(paths)

def ld_commit_now(text: String, worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  +t2 = text
  +w2 = worker
  +p2 = paths
  +sc = scratch
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(sc, ["commit", "-q", "-m", ld_message(t2, w2, p2)])
    ld_commit_next(g, sc, w2, sha, tip)

def ld_msg_ok(ok: Bool, text: String, worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  match ok:
    case True{}: ld_commit_now(text, worker, sha, tip, scratch, paths)
    case False{}: IO.pure(Ld, LdFail{T.FCmd{"land", "the worker commit message could not be read"}})

def ld_msg_pick(g: T.GitOut, worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_msg_ok(U32.is_eq(code, 0), out, worker, sha, tip, scratch, paths)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_single_msg_read(worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  +w2 = worker
  +s2 = sha
  +sc = scratch
  +p2 = paths
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(sc, ["log", "-1", "--format=%B", s2])
    ld_msg_pick(g, w2, s2, tip, sc, p2)

# Git emits the tip first in topological order. The body lists oldest first.
def ld_subjects_tail(rest: List<String>, +subject: String, worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  match rest:
    case Nil{}: ld_single_msg_read(worker, sha, tip, scratch, paths)
    case Con{h, tail}: ld_commit_now(subject ++ "\n\n" ++ Tx.join("\n", List.reverse(&1, String, Con{subject, Con{h, tail}})), worker, sha, tip, scratch, paths)

def ld_subjects(lines: List<String>, worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  match lines:
    case Nil{}: IO.pure(Ld, LdFail{T.FCmd{"land", "the worker history above the target merge-base is empty"}})
    case Con{subject, rest}: ld_subjects_tail(rest, subject, worker, sha, tip, scratch, paths)

def ld_history_ok(ok: Bool, text: String, worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  match ok:
    case True{}: ld_subjects(Tx.split_lines(text), worker, sha, tip, scratch, paths)
    case False{}: IO.pure(Ld, LdFail{T.FCmd{"land", "the worker commit subjects could not be read: " ++ text}})

def ld_history_pick(g: T.GitOut, worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_history_ok(U32.is_eq(code, 0), out, worker, sha, tip, scratch, paths)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_history_base_ok(ok: Bool, base: String, +worker: String, +sha: String, +tip: String, +scratch: String, +paths: String) -> IO(Ld):
  match ok:
    case False{}: IO.pure(Ld, LdFail{T.FCmd{"land", "the worker and target merge-base could not be read: " ++ base}})
    case True{}: do IO<Ld>:
      g : T.GitOut <- Git.runGit(scratch, ["log", "--topo-order", "--format=%s", Tx.trim_nl(base) ++ ".." ++ sha])
      ld_history_pick(g, worker, sha, tip, scratch, paths)

def ld_history_base(g: T.GitOut, worker: String, sha: String, tip: String, scratch: String, paths: String) -> IO(Ld):
  match g:
    case T.GRun{code, out}: ld_history_base_ok(U32.is_eq(code, 0), out, worker, sha, tip, scratch, paths)
    case T.GBroken{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", detail}})

def ld_msg_read(+worker: String, +sha: String, +tip: String, +scratch: String, +paths: String) -> IO(Ld):
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(scratch, ["merge-base", sha, tip])
    ld_history_base(g, worker, sha, tip, scratch, paths)

def ld_debris_go(d: Deb.Debris, scratch: String, worker: String, sha: String, tip: String) -> IO(Ld):
  match d:
    case Deb.DFine{paths}: ld_msg_read(worker, sha, tip, scratch, paths)
    case Deb.DFail{detail}: IO.pure(Ld, LdFail{T.FCmd{"land", "debris judgment failed: " ++ detail}})

def ld_stage5(repo: String, scratch: String, worker: String, sha: String, tip: String) -> IO(Ld):
  +r2 = repo
  +sc = scratch
  do IO<Ld>:
    d : Deb.Debris <- Deb.drop_added_ignored(r2, "", sc)
    ld_debris_go(d, sc, worker, sha, tip)

# The gate: every unjudged run and every candidate failure line the target
# run does not show blocks; otherwise the advance starts.
def ld_judged_news(news: List<String>, repo: String, target: String, scratch: String, tip: String, cand: String) -> IO(Ld):
  match news:
    case Nil{}: ld_advance(repo, target, cand, tip)
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
    case LdWk{worker, sha}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})
    case LdTip{worker, sha, tip}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})
    case LdCand{tip, cand}: IO.pure(Result<&1, &1, T.GitFail, T.LandOutcome>, Fail{T.FCmd{"land", "unreachable stage"}})

def ld_go1(r: Ld, repo: String, target: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker, sha}: ld_stage2(repo, target, worker, sha)
    case LdTip{worker, sha, tip}: ld_unreach()
    case LdCand{tip, cand}: ld_unreach()

def ld_go2(r: Ld, repo: String, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker, sha}: ld_unreach()
    case LdTip{worker, sha, tip}: ld_stage3(repo, worker, sha, tip, scratch)
    case LdCand{tip, cand}: ld_unreach()

def ld_go3(r: Ld, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker, sha}: ld_unreach()
    case LdTip{worker, sha, tip}: ld_stage4(scratch, worker, sha, tip)
    case LdCand{tip, cand}: ld_unreach()

def ld_go4(r: Ld, repo: String, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker, sha}: ld_unreach()
    case LdTip{worker, sha, tip}: ld_stage5(repo, scratch, worker, sha, tip)
    case LdCand{tip, cand}: ld_unreach()

def ld_go5(r: Ld, repo: String, target: String, script: String, files: List<String>, scratch: String) -> IO(Ld):
  match r:
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker, sha}: ld_unreach()
    case LdTip{worker, sha, tip}: ld_unreach()
    case LdCand{tip, cand}: ld_stage6(repo, target, script, files, scratch, tip, cand)

# The scratch trees one attempt prepared live under the repository's scratch
# root, the candidate and its "-target" sibling. PREFIX is the part of their
# name that belongs to the worker rather than to the attempt.
def scratch_prefix(repo: String, worker: String) -> String:
  T.str_cat3(repo, "/.scratch/bend2-land-", Tx.str_cat(worker, "-"))

# The path one worktree-list line names: the line with its label matched off,
# or the empty string for a line that does not carry the label.
def wt_path_go(line: String, label: String) -> String:
  match line label:
    case SNil{} SNil{}: ""
    case SNil{} SCon{lc, lr}: ""
    case SCon{c, rest} SNil{}: line
    case SCon{c, rest} SCon{lc, lr}:
      Bool.pick(String, Char.is_eq(c, lc), wt_path_go(rest, lr), "")

def wt_path(line: String) -> String:
  wt_path_go(line, "worktree ")

def scratch_remove1(repo: String, dir: String) -> IO(Unit):
  +r2 = repo
  +d2 = dir
  do IO<Unit>:
    _g : T.GitOut <- Git.runGit(r2, ["worktree", "remove", "--force", d2])
    IO.pure(Unit, Unit{})

# The trees one attempt prepared: the candidate and its "-target" sibling.
# A landed or already-merged attempt removes exactly these two; any other
# answer keeps them.
def settle_paths(scratch: String) -> List<String>:
  +s2 = scratch
  Con{s2, Con{Tx.str_cat(s2, "-target"), Nil{}}}

def drop_list(repo: String, dirs: List<String>) -> IO(Unit):
  match dirs:
    case Nil{}:
      +r2 = repo
      do IO<Unit>:
        _p : T.GitOut <- Git.runGit(r2, ["worktree", "prune"])
        IO.pure(Unit, Unit{})
    case Con{d, rest}:
      +r2 = repo
      do IO<Unit>:
        _a : Unit <- scratch_remove1(r2, d)
        drop_list(r2, rest)

# One attempt's two trees, removed together.
def drop_scratch(repo: String, scratch: String) -> IO(Unit):
  +r2 = repo
  +s2 = scratch
  drop_list(r2, settle_paths(s2))

# One worktree-list line: a registered tree under the worker's prefix belongs
# to an earlier attempt the worker has now replaced.
def sweep_one(prefix: String, repo: String, line: String) -> IO(Unit):
  +p2 = prefix
  +r2 = repo
  +path = wt_path(line)
  Bool.pick(IO(Unit), Tx.starts_with(path, p2), scratch_remove1(r2, path), IO.pure(Unit, Unit{}))

def sweep_lines(prefix: String, repo: String, lines: List<String>) -> IO(Unit):
  match lines:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{h, rest}:
      +p2 = prefix
      +r2 = repo
      do IO<Unit>:
        _s : Unit <- sweep_one(p2, r2, h)
        sweep_lines(p2, r2, rest)

def sweep_out(g: T.GitOut, prefix: String, repo: String) -> IO(Unit):
  match g:
    case T.GRun{code, out}: sweep_lines(prefix, repo, Tx.split_lines(out))
    case T.GBroken{detail}: IO.pure(Unit, Unit{})

# The trees a refused or conflicted attempt of this worker kept: a landed
# attempt's are already gone, so every registered tree under PREFIX is one the
# worker's next attempt supersedes.
def sweep_scratch(repo: String, prefix: String) -> IO(Unit):
  +r2 = repo
  +p2 = prefix
  do IO<Unit>:
    gl : T.GitOut <- Git.runGit(r2, ["worktree", "list", "--porcelain"])
    sweep_out(gl, p2, r2)

# The scratch path one attempt prepares: the trees the worker's earlier attempt
# kept are dropped first, so a refused or conflicted attempt's trees live only
# until the worker tries again.
def open_scratch(repo: String, worker: String, ts: String) -> IO(String):
  +r2 = repo
  +w2 = worker
  +p2 = scratch_prefix(r2, w2)
  do IO<String>:
    _sweep : Unit <- sweep_scratch(r2, p2)
    IO.pure(String, Tx.str_cat(p2, ts))

# The landing's own trees settle with its answer: a landed or already-merged
# attempt needs them no longer, and a refused, conflicted or failed attempt
# keeps them.
def ld_settle(r: Ld, repo: String, scratch: String) -> IO(Ld):
  match r:
    case LdDone{T.LLanded{target, commit}}:
      +r2 = repo
      +s2 = scratch
      do IO<Ld>:
        _d : Unit <- drop_scratch(r2, s2)
        IO.pure(Ld, LdDone{T.LLanded{target, commit}})
    case LdDone{T.LAlready{commit}}:
      +r2 = repo
      +s2 = scratch
      do IO<Ld>:
        _d : Unit <- drop_scratch(r2, s2)
        IO.pure(Ld, LdDone{T.LAlready{commit}})
    case LdDone{made}: IO.pure(Ld, LdDone{made})
    case LdFail{fail}: IO.pure(Ld, LdFail{fail})
    case LdWk{worker, sha}: IO.pure(Ld, LdWk{worker, sha})
    case LdTip{worker, sha, tip}: IO.pure(Ld, LdTip{worker, sha, tip})
    case LdCand{tip, cand}: IO.pure(Ld, LdCand{tip, cand})

# land prepares the candidate, judges it against the target and advances the
# target branch. The scratch path must not exist. A landed answer removes the
# trees it prepared; a refused or conflicted answer keeps them for the
# requester until that worker's next attempt.
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
    e : Ld <- ld_go4(d, r2, s2)
    f : Ld <- ld_go5(e, r2, t2, k2, files, s2)
    settled : Ld <- ld_settle(f, r2, s2)
    ld_answer(settled)

# The coordinator's current entry point: the fast-forward landing.
def land(repo: String, workerBranch: String, target: String) -> IO(T.LandOutcome):
  land_fast_forward(repo, workerBranch, target)

# The push argv: the declared remote is the destination and the branch is the
# refspec. Nothing reads a default remote.
def push_argv(branch: String, remote: String) -> List<String>:
  Con{"push", Con{remote, Con{branch, Nil{}}}}

# The landed target pushed to the remote the deployment declares. The answer
# is the push's own exit and output: a non-zero code is the remote's refusal
# (a non-fast-forward is the common one) and the caller names it, never reads
# it as a landing.
def push_git(repo: String, branch: String, remote: String) -> IO(T.GitOut):
  +r2 = repo
  +b2 = branch
  +rm = remote
  do IO<T.GitOut>:
    g : T.GitOut <- Git.runGit(r2, push_argv(b2, rm))
    IO.pure(T.GitOut, g)

# The requested branch as the full ref the read names, so no other ref and no
# local ref is read.
def tip_ref(branch: String) -> String:
  "refs/heads/" ++ branch

# The remote-tip argv: the declared remote is the only source and the requested
# branch is the only refspec. Both follow the option terminator, so a declared
# remote that begins with a dash is read as the remote operand and not as an
# option. Nothing reads a default remote.
def ls_remote_argv(branch: String, remote: String) -> List<String>:
  Con{"ls-remote", Con{"--", Con{remote, Con{tip_ref(branch), Nil{}}}}}

def tip_match(named: Bool, +object: String) -> String:
  match named:
    case True{}: object
    case False{}: ""

def tip_named(more: List<String>, object: String, ref: String) -> String:
  match more:
    case Nil{}: ""
    case name <> tail: tip_match(Tx.str_eq(name, ref), object)

# The advertised object ID for the requested ref, or "" when the answer did not
# advertise it. Git writes one "<object>\t<ref>" line per advertised ref, and
# neither an object ID nor a ref name carries whitespace, so the fields of the
# whole answer split cleanly.
def tip_fields(fields: List<String>, ref: String) -> String:
  match fields:
    case Nil{}: ""
    case object <> more: tip_named(more, object, ref)

def tip_object(out: String, ref: String) -> String:
  tip_fields(Tx.split_tabs(Tx.trim_nl(out)), ref)

# The read: a read-only ls-remote of the declared remote for the one requested
# ref. It updates no local ref and pushes nothing.
def remote_tip_git(repo: String, branch: String, remote: String) -> IO(T.GitOut):
  +r2 = repo
  +b2 = branch
  +rm = remote
  do IO<T.GitOut>:
    g : T.GitOut <- Git.runGit(r2, ls_remote_argv(b2, rm))
    IO.pure(T.GitOut, g)

# --- helper laws: prepared, not operative caller coverage ----------------------
#
# Concrete, independently written discriminators over the real parser: no law
# quantifies an unconstrained string, because split_lines admits newlines inside the
# parts and a universal claim would not describe the constrained protocol. Every
# expected value is spelled from the record's literal parts, not from the helper under
# test. No live caller uses these helpers and no compile has been run.

law prepared_publication_reads_a_well_formed_applied_record:
  {pub_record(" \tabc123:refs/heads/main\told..new", publish_field("abc123", "main")) == RecordMatched{"applied", " \tabc123:refs/heads/main\told..new"} : PubRecord}

def prepared_publication_reads_a_well_formed_applied_record():
  {==}

law prepared_publication_reads_a_well_formed_already_record:
  {pub_record("=\tabc123:refs/heads/main\t[up to date]", publish_field("abc123", "main")) == RecordMatched{"already", "=\tabc123:refs/heads/main\t[up to date]"} : PubRecord}

def prepared_publication_reads_a_well_formed_already_record():
  {==}

law prepared_publication_refuses_a_prefix_collision:
  {pub_record(" \tabc123:refs/heads/main-longer\tcollision", publish_field("abc123", "main")) == RecordAmbiguous{1, " \tabc123:refs/heads/main-longer\tcollision"} : PubRecord}

def prepared_publication_refuses_a_prefix_collision():
  {==}

law prepared_publication_refuses_an_unrelated_record:
  {pub_record(" \tabc999:refs/heads/other\tunrelated", publish_field("abc123", "main")) == RecordAmbiguous{1, " \tabc999:refs/heads/other\tunrelated"} : PubRecord}

def prepared_publication_refuses_an_unrelated_record():
  {==}

law prepared_publication_refuses_a_newline_smuggled_record:
  {pub_record(" \tabc123:refs/heads/main\trow\n \tabc999:refs/heads/main\tother", publish_field("abc123", "main")) == RecordAmbiguous{2, " \tabc123:refs/heads/main\trow"} : PubRecord}

def prepared_publication_refuses_a_newline_smuggled_record():
  {==}

law prepared_publication_refuses_a_flag_line_without_its_fields:
  {pub_record("!abc123:refs/heads/main", publish_field("abc123", "main")) == RecordAbsent{} : PubRecord}

def prepared_publication_refuses_a_flag_line_without_its_fields():
  {==}

law prepared_holder_discovery_never_reads_a_failed_list_as_none:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{1, ""})) == VerdictUnreadable{HolderRequest{"/r", "main", "git worktree list --porcelain"}, 1, ""} : HolderVerdict}

def prepared_holder_discovery_never_reads_a_failed_list_as_none():
  {==}

law prepared_holder_discovery_reads_one_target_first:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree /a\nHEAD aa\nbranch refs/heads/main\n\nworktree /b\nHEAD bb\nbranch refs/heads/other\n"})) == VerdictFound{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "/a"} : HolderVerdict}

def prepared_holder_discovery_reads_one_target_first():
  {==}

law prepared_holder_discovery_reads_one_target_last:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree /a\nHEAD aa\nbranch refs/heads/other\n\nworktree /b\nHEAD bb\nbranch refs/heads/main\n"})) == VerdictFound{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "/b"} : HolderVerdict}

def prepared_holder_discovery_reads_one_target_last():
  {==}

law prepared_holder_discovery_reads_a_spaced_path_unchanged:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree /tmp/one with spaces\nHEAD aa\nbranch refs/heads/main\n"})) == VerdictFound{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "/tmp/one with spaces"} : HolderVerdict}

def prepared_holder_discovery_reads_a_spaced_path_unchanged():
  {==}

law prepared_holder_discovery_answers_none_among_valid_unrelated_blocks:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree /a\nHEAD aa\nbranch refs/heads/other\n\nworktree /b\ndetached\n"})) == VerdictNone{HolderRequest{"/r", "main", "git worktree list --porcelain"}} : HolderVerdict}

def prepared_holder_discovery_answers_none_among_valid_unrelated_blocks():
  {==}

law prepared_holder_discovery_rejects_a_duplicate_target:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree /a\nHEAD aa\nbranch refs/heads/main\n\nworktree /b\nHEAD bb\nbranch refs/heads/main\n"})) == VerdictAmbiguous{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "the target branch is named more than once"} : HolderVerdict}

def prepared_holder_discovery_rejects_a_duplicate_target():
  {==}

law prepared_holder_discovery_rejects_a_missing_record_separator:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree /a\nHEAD aa\nbranch refs/heads/main\nworktree /b\nHEAD bb\nbranch refs/heads/other\n"})) == VerdictAmbiguous{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "the worktree listing is unsupported, incomplete or malformed"} : HolderVerdict}

def prepared_holder_discovery_rejects_a_missing_record_separator():
  {==}

law prepared_holder_read_keeps_a_failed_read_typed:
  {holder_read(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{128, "fatal: not a git repository"})) == HolderObserved{HolderRequest{"/r", "main", "git worktree list --porcelain"}, 128, "fatal: not a git repository", VerdictUnreadable{HolderRequest{"/r", "main", "git worktree list --porcelain"}, 128, "fatal: not a git repository"}} : HolderObservation}

def prepared_holder_read_keeps_a_failed_read_typed():
  {==}

law prepared_holder_read_keeps_a_broken_command_typed:
  {holder_read(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GBroken{"git could not be executed"})) == HolderObservedBroken{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "git could not be executed", VerdictBroken{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "git could not be executed"}} : HolderObservation}

def prepared_holder_read_keeps_a_broken_command_typed():
  {==}

law prepared_holder_discovery_rejects_a_second_branch_in_one_block:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree /a\nHEAD aa\nbranch refs/heads/main\nbranch refs/heads/other\n"})) == VerdictAmbiguous{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "the worktree listing is unsupported, incomplete or malformed"} : HolderVerdict}

def prepared_holder_discovery_rejects_a_second_branch_in_one_block():
  {==}

law prepared_holder_discovery_rejects_an_unfinished_final_block:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree /a\nHEAD aa\nbranch refs/heads/main\nworktree /b\n"})) == VerdictAmbiguous{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "the worktree listing is unsupported, incomplete or malformed"} : HolderVerdict}

def prepared_holder_discovery_rejects_an_unfinished_final_block():
  {==}

law prepared_holder_discovery_rejects_a_listing_without_blocks:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "\n"})) == VerdictAmbiguous{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "the worktree listing carries no complete block"} : HolderVerdict}

def prepared_holder_discovery_rejects_a_listing_without_blocks():
  {==}

law prepared_holder_discovery_rejects_a_state_line_outside_any_block:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "HEAD aa\n"})) == VerdictAmbiguous{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "the worktree listing is unsupported, incomplete or malformed"} : HolderVerdict}

def prepared_holder_discovery_rejects_a_state_line_outside_any_block():
  {==}

law prepared_holder_discovery_rejects_a_quoted_or_relative_path:
  {holder_verdict_of_discovery(holder_discover(HolderRequest{"/r", "main", "git worktree list --porcelain"}, T.GRun{0, "worktree rel\nHEAD aa\nbranch refs/heads/main\n"})) == VerdictAmbiguous{HolderRequest{"/r", "main", "git worktree list --porcelain"}, "the worktree listing is unsupported, incomplete or malformed"} : HolderVerdict}

def prepared_holder_discovery_rejects_a_quoted_or_relative_path():
  {==}

# The public shared boundary. The canonical common directory is read once here, the target
# claim is taken around the holder selection and the selected advance, and the release runs for
# every returned advance outcome with its own Result preserved beside the advance observation.
# A release failure is therefore visible to both adapters and can never read as a landing.
type SharedLanding is Data:
  SharedClaimFailed{error: U32 & String}
  SharedGuardBusy{target: String}
  SharedAdvanced{advance: LAdv, released: Result<U32 & String, Unit>}

def shared_advance_under_claim(handle: U32, advance: LAdv) -> IO(SharedLanding):
  +h = handle
  +a = advance
  do IO<SharedLanding>:
    released : Result<U32 & String, Unit> <- Rec.Receipt.release(h)
    IO.pure(SharedLanding, SharedAdvanced{a, released})

def shared_ran_advance(handle: U32, repo: String, target: String, cand: String, basis: String) -> IO(SharedLanding):
  +h = handle
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  do IO<SharedLanding>:
    a : LAdv <- ld_adv_run(rp, tg, c, b)
    shared_advance_under_claim(h, a)

def shared_claim_decided(repo: String, target: String, cand: String, basis: String, claimed: Result<U32 & String, Maybe<U32>>) -> IO(SharedLanding):
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  match claimed:
    case Fail{error}: IO.pure(SharedLanding, SharedClaimFailed{error})
    case Done{held}:
      match held:
        case None{}: IO.pure(SharedLanding, SharedGuardBusy{tg})
        case Some{handle}: shared_ran_advance(handle, rp, tg, c, b)

def shared_claimed(repo: String, target: String, cand: String, basis: String, common: String) -> IO(SharedLanding):
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  +cm = common
  do IO<SharedLanding>:
    claimed : Result<U32 & String, Maybe<U32>> <- Rec.Receipt.claim(cm, tg)
    shared_claim_decided(rp, tg, c, b, claimed)

def shared_common_read(repo: String, target: String, cand: String, basis: String, observed: T.GitOut) -> IO(SharedLanding):
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  match observed:
    case T.GBroken{detail}: IO.pure(SharedLanding, SharedClaimFailed{(1, detail)})
    case T.GRun{code, out}:
      match U32.is_eq(code, 0):
        case False{}: IO.pure(SharedLanding, SharedClaimFailed{(code, "cannot read the common directory for the landing claim")})
        case True{}: shared_claimed(rp, tg, c, b, Tx.trim_nl(out))

def shared_landing_run(repo: String, target: String, cand: String, basis: String) -> IO(SharedLanding):
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  do IO<SharedLanding>:
    observed : T.GitOut <- Git.runGit(rp, Con{"rev-parse", Con{"--path-format=absolute", Con{"--git-common-dir", Nil{}}}})
    shared_common_read(rp, tg, c, b, observed)

# The fast-forward adapter. A release failure, a busy guard and a claim failure each answer
# blocked; only a landed advance with a completed release reports the landing.
def ff_stage5_shared_answer(shared: SharedLanding, target: String, cand: String) -> FFLD:
  +s = shared
  +tg = target
  +c = cand
  match s:
    case SharedClaimFailed{error}: FFDone{T.LBlocked{"the landing claim could not be taken"}}
    case SharedGuardBusy{target}: FFDone{T.LBlocked{"another landing holds the target"}}
    case SharedAdvanced{advance, released}:
      match released:
        case Fail{error}: FFDone{T.LBlocked{"the advance ran but its release failed; inspect the target and the guard"}}
        case Done{unit}: ff_stage5_adv_answer(advance, tg, c)

# The checked adapter uses the same combined outcome, so it also refuses to answer landed when
# the release failed.
def ld_advance_shared_answer(shared: SharedLanding, target: String, cand: String) -> Ld:
  +s = shared
  +tg = target
  +c = cand
  match s:
    case SharedClaimFailed{error}: LdFail{T.FCmd{"land", "the landing claim could not be taken"}}
    case SharedGuardBusy{target}: LdFail{T.FCmd{"land", "another landing holds the target; rerun land-checked to prepare and check against the current target"}}
    case SharedAdvanced{advance, released}:
      match released:
        case Fail{error}: LdFail{T.FCmd{"land", "the advance ran but its release failed; inspect the target and the guard"}}
        case Done{unit}: ld_adv_answer(advance, tg, c)

