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
# already. A refused or conflicted attempt keeps them for the requester, and a
# later attempt names its own path without touching them.

import Base
import ../host/text.bend as Text
import ./landing.bend as Lg
import ./association.bend as A
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
    Con{"push", Con{"--porcelain", Con{Tx.str_cat("--receive-pack=", publish_receiver()), Con{T.str_cat3("--force-with-lease=refs/heads/", target, Tx.str_cat(":", basis)), Con{destination, Con{publish_refspec(oid, target), Nil{}}}}}}},
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
    case Con{+h, rest}:
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

def obs_refuse(code: U32, record: PubRecord, +post: String, +target: String, +oid: String) -> T.LandOutcome:
  Bool.pick(T.LandOutcome, U32.is_eq(code, 0),
    Bool.pick(T.LandOutcome, Tx.str_eq(post, "verified-object"),
      T.LBlocked{"the publication of " ++ oid ++ " onto " ++ target ++ " reached the post-state " ++ post ++ " but holder verification and custody do not exist yet; the observation stays pending and must not be treated as a completion"},
      T.LBlocked{"the publication of " ++ oid ++ " onto " ++ target ++ " is not qualified (post-state " ++ post ++ "); inspect the observation before any retry"}),
    T.LBlocked{"the publication of " ++ oid ++ " onto " ++ target ++ " did not complete; inspect the observation before any retry"})

# No completion mapper exists. Every observation refuses and keeps its evidence,
# including the disposition (applied or already) for the caller that will later own
# the post-state and holder qualification.
def obs_refusal(+obs: PubObservation) -> T.LandOutcome:
  match obs:
    case ObsAttempted{code, out, record, destination, target, oid, basis, post, reread}: obs_refuse(code, record, post, target, oid)
    case ObsNotAttempted{reason, destination, target, oid, basis}: T.LBlocked{reason}
    case ObsBroken{detail, destination, target, oid, basis}: T.LBlocked{detail}

def obs_reread(code: U32, out: String, record: PubRecord, +destination: String, +target: String, +oid: String, +basis: String, rcode: U32, rout: String, +ref: String) -> PubObservation:
  Bool.pick(PubObservation, U32.is_eq(rcode, 0),
    Bool.pick(PubObservation, Tx.str_eq(Tx.trim_nl(rout), oid),
      ObsAttempted{code, out, record, destination, target, oid, basis, "verified-object", RereadRead{rcode, rout, ref}},
      ObsAttempted{code, out, record, destination, target, oid, basis, "mismatch-ref", RereadRead{rcode, rout, ref}}),
    ObsAttempted{code, out, record, destination, target, oid, basis, "unreadable-ref", RereadRead{rcode, rout, ref}})

def obs_reread_broken(code: U32, out: String, record: PubRecord, +destination: String, +target: String, +oid: String, +basis: String, +detail: String, +ref: String) -> PubObservation:
  ObsAttempted{code, out, record, destination, target, oid, basis, "unreadable-ref", RereadBroken{detail}}

def verify_ref_pick(+obs: PubObservation, r: T.GitOut, +ref: String) -> PubObservation:
  match obs:
    case ObsAttempted{+code, +out, +record, +destination, +target, +oid, +basis, post, reread}:
      match r:
        case T.GRun{rcode, rout}: obs_reread(code, out, record, destination, target, oid, basis, rcode, rout, ref)
        case T.GBroken{detail}: obs_reread_broken(code, out, record, destination, target, oid, basis, detail, ref)
    case other: other

def verify_ref(+obs: PubObservation, +repo: String, +target: String, +ref: String) -> IO(PubObservation):
  +r2 = repo
  do IO<PubObservation>:
    reread : T.GitOut <- Git.runGit(r2, Con{"rev-parse", Con{Tx.str_cat("refs/heads/", target), Nil{}}})
    IO.pure(PubObservation, verify_ref_pick(obs, reread, ref))

def verify_observation(+obs: PubObservation, +repo: String) -> IO(PubObservation):
  match obs:
    case ObsAttempted{code, out, record, destination, +target, oid, basis, post, reread}:
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
  ScanState{block: HolderBlock, matched: Maybe<&2, String>, seen: U32, bad: U32, blocks: U32}

type HolderDiscovery is Data:
  DiscoverRead{request: HolderRequest, code: U32, out: String}
  DiscoverBroken{request: HolderRequest, detail: String}

type HolderVerdict is Data:
  VerdictFound{request: HolderRequest, path: String}
  VerdictNone{request: HolderRequest}
  VerdictUnreadable{request: HolderRequest, code: U32, out: String}
  VerdictBroken{request: HolderRequest, detail: String}
  VerdictAmbiguous{request: HolderRequest, detail: String}

# The returned boundary: the retained observation with the derived interpretation, so a
# caller keeps the raw result and the request identity alongside the verdict.
type HolderObservation is Data:
  HolderObserved{request: HolderRequest, code: U32, out: String, verdict: HolderVerdict}
  HolderObservedBroken{request: HolderRequest, detail: String, verdict: HolderVerdict}

def prefix_drop(line: String, prefix: String) -> Maybe<&2, String>:
  match line prefix:
    case SNil{} SNil{}: Some{SNil{}}
    case SNil{} SCon{pc, pr}: None{}
    case SCon{lc, lr} SNil{}: Some{SCon{lc, lr}}
    case SCon{lc, lr} SCon{pc, pr}:
      Bool.pick(Maybe<&2, String>, Char.is_eq(lc, pc), prefix_drop(lr, pr), None{})

def holder_path_of(+line: String) -> Maybe<&2, String>:
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

def holder_branch_value(found: Maybe<&2, String>) -> Bool:
  match found:
    case Some{value}: Bool.not(String.is_empty(value))
    case None{}: False{}

def holder_valid_branch(+line: String) -> Bool:
  holder_branch_value(prefix_drop(line, "branch refs/heads/"))
def holder_close(acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, +matched, +seen, +bad, +blocks}:
      match block:
        case InBlock{path, has_state, branches}:
          Bool.pick(HolderScan, has_state,
            ScanState{NoBlock{}, matched, seen, bad, U32.add(blocks, 1)},
            ScanState{NoBlock{}, matched, seen, U32.add(bad, 1), blocks})
        case NoBlock{}: ScanState{NoBlock{}, matched, seen, bad, blocks}

def holder_open_fresh_path(block: HolderBlock, matched: Maybe<&2, String>, seen: U32, bad: U32, blocks: U32, path: Maybe<&2, String>) -> HolderScan:
  match path:
    case Some{+value}:
      Bool.pick(HolderScan, holder_path_ok(value),
        ScanState{InBlock{value, False{}, 0}, matched, seen, bad, blocks},
        ScanState{NoBlock{}, matched, seen, U32.add(bad, 1), blocks})
    case None{}: ScanState{NoBlock{}, matched, seen, U32.add(bad, 1), blocks}

def holder_open_fresh(+path: Maybe<&2, String>, +acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, matched, seen, bad, blocks}:
      holder_open_fresh_path(block, matched, seen, bad, blocks, path)

def holder_open(+path: Maybe<&2, String>, +acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{+block, matched, seen, bad, blocks}:
      match block:
        case InBlock{openpath, has_state, branches}:
          ScanState{block, matched, seen, U32.add(bad, 1), blocks}
        case NoBlock{}: holder_open_fresh(path, acc, request)

def holder_in_block(+acc: HolderScan, +request: String) -> Bool:
  match acc:
    case ScanState{block, matched, seen, bad, blocks}:
      match block:
        case InBlock{path, has_state, branches}: True{}
        case NoBlock{}: False{}

def holder_state_seen(+acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, +matched, +seen, +bad, +blocks}:
      match block:
        case InBlock{path, has_state, branches}: ScanState{InBlock{path, True{}, branches}, matched, seen, bad, blocks}
        case NoBlock{}: ScanState{NoBlock{}, matched, seen, U32.add(bad, 1), blocks}

def holder_match_first(+path: String, has_state: Bool, branches: U32, +acc: HolderScan, matched: Maybe<&2, String>) -> HolderScan:
  match acc:
    case ScanState{block, prior, +seen, +bad, +blocks}:
      match prior:
        case Some{value}: ScanState{InBlock{path, has_state, U32.add(branches, 1)}, Some{value}, U32.add(seen, 1), bad, blocks}
        case None{}: ScanState{InBlock{path, has_state, U32.add(branches, 1)}, Some{path}, U32.add(seen, 1), bad, blocks}

def holder_match_seen(+line: String, +target: String, +acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, +matched, +seen, +bad, +blocks}:
      match block:
        case InBlock{+path, +has_state, +branches}:
          Bool.pick(HolderScan, U32.is_lt(0, branches),
            ScanState{InBlock{path, has_state, branches}, matched, seen, U32.add(bad, 1), blocks},
            holder_match_first(path, has_state, branches, acc, matched))
        case NoBlock{}: ScanState{NoBlock{}, matched, U32.add(seen, 1), U32.add(bad, 1), blocks}

def holder_branch_ok(+acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, +matched, +seen, +bad, +blocks}:
      match block:
        case InBlock{+path, +has_state, +branches}:
          Bool.pick(HolderScan, U32.is_lt(0, branches),
            ScanState{InBlock{path, has_state, branches}, matched, seen, U32.add(bad, 1), blocks},
            ScanState{InBlock{path, has_state, U32.add(branches, 1)}, matched, seen, bad, blocks})
        case NoBlock{}: ScanState{NoBlock{}, matched, seen, U32.add(bad, 1), blocks}

def holder_verdict_of(matched: Maybe<&2, String>, seen: U32, +request: HolderRequest) -> HolderVerdict:
  match matched:
    case Some{value}: VerdictFound{request, value}
    case None{}: Bool.pick(HolderVerdict, U32.is_eq(seen, 0), VerdictNone{request}, VerdictAmbiguous{request, "the target branch has no valid block"})

def holder_verdict(+acc: HolderScan, +request: HolderRequest) -> HolderVerdict:
  match acc:
    case ScanState{block, matched, +seen, bad, blocks}:
      Bool.pick(HolderVerdict, U32.is_lt(0, bad), VerdictAmbiguous{request, "the worktree listing is unsupported, incomplete or malformed"},
        Bool.pick(HolderVerdict, U32.is_lt(1, seen), VerdictAmbiguous{request, "the target branch is named more than once"},
          Bool.pick(HolderVerdict, U32.is_eq(blocks, 0), VerdictAmbiguous{request, "the worktree listing carries no complete block"},
            holder_verdict_of(matched, seen, request))))

def holder_bad(+acc: HolderScan, +request: String) -> HolderScan:
  match acc:
    case ScanState{block, matched, seen, bad, blocks}: ScanState{block, matched, seen, U32.add(bad, 1), blocks}

def holder_ok_state(+acc: HolderScan, +request: String) -> HolderScan:
  Bool.pick(HolderScan, holder_in_block(acc, request), holder_state_seen(acc, request), holder_bad(acc, request))

def holder_ok_branch(+acc: HolderScan, +request: String) -> HolderScan:
  Bool.pick(HolderScan, holder_in_block(acc, request), acc, holder_bad(acc, request))

def holder_line_step(+line: String, +branch: String, +target: String, +acc: HolderScan, +request: String) -> HolderScan:
  Bool.pick(HolderScan, Tx.starts_with(line, "worktree "),
    holder_open(holder_path_of(line), acc, request),
    Bool.pick(HolderScan, holder_required_state(line),
      holder_ok_state(acc, request),
      Bool.pick(HolderScan, Tx.str_eq(line, branch),
        holder_match_seen(line, target, acc, request),
        Bool.pick(HolderScan, holder_valid_branch(line),
          holder_branch_ok(acc, request),
          Bool.pick(HolderScan, holder_modifier(line),
            holder_ok_branch(acc, request),
            holder_bad(acc, request))))))

def holder_step(lines: List<String>, +branch: String, +target: String, +acc: HolderScan, +request: String) -> HolderScan:
  match lines:
    case Nil{}: holder_close(acc, request)
    case Con{+h, +rest}:
      Bool.pick(HolderScan, String.is_empty(h),
        holder_step(rest, branch, target, holder_close(acc, request), request),
        holder_step(rest, branch, target, holder_line_step(h, branch, target, acc, request), request))
def holder_request_target(request: HolderRequest) -> String:
  match request:
    case HolderRequest{destination, target, argv}: target

def holder_request_argv(request: HolderRequest) -> String:
  match request:
    case HolderRequest{destination, target, argv}: argv

def holder_scan(lines: List<String>, +request: HolderRequest) -> HolderVerdict:
  +target = holder_request_target(request)
  holder_verdict(holder_step(lines, holder_branch_line(target), target, ScanState{NoBlock{}, None{}, 0, 0, 0}, holder_request_argv(request)), request)

def holder_discover(request: HolderRequest, g: T.GitOut) -> HolderDiscovery:
  match g:
    case T.GRun{code, out}: DiscoverRead{request, code, out}
    case T.GBroken{detail}: DiscoverBroken{request, detail}

# The target is taken from the retained request, and a broken command stays broken
# instead of being rendered as a status that was never observed.
def holder_verdict_of_discovery(discovery: HolderDiscovery) -> HolderVerdict:
  match discovery:
    case DiscoverRead{+request, +code, +out}:
      Bool.pick(HolderVerdict, U32.is_eq(code, 0),
        holder_scan(Tx.split_lines(out), request),
        VerdictUnreadable{request, code, out})
    case DiscoverBroken{request, detail}: VerdictBroken{request, detail}

# The boundary a caller retains: the observation and its interpretation together.
def holder_read(+discovery: HolderDiscovery) -> HolderObservation:
  match discovery:
    case DiscoverRead{request, code, out}: HolderObserved{request, code, out, holder_verdict_of_discovery(discovery)}
    case DiscoverBroken{request, detail}: HolderObservedBroken{request, detail, holder_verdict_of_discovery(discovery)}

def reread_of(g: T.GitOut, +ref: String) -> RereadObs:
  match g:
    case T.GRun{code, out}: RereadRead{code, out, ref}
    case T.GBroken{detail}: RereadBroken{detail}

def holder_state(+path: String) -> IO(HolderState):
  +p2 = path
  do IO<HolderState>:
    head : T.GitOut <- Git.runGit(p2, ["rev-parse", "HEAD"])
    index : T.GitOut <- Git.runGit(p2, ["diff", "--cached", "--name-status"])
    status : T.GitOut <- Git.runGit(p2, ["status", "--porcelain"])
    IO.pure(HolderState, HolderRead{p2, reread_of(head, p2), reread_of(index, p2), reread_of(status, p2)})

def holder_path_same(+expected: String, +found: String) -> Bool:
  Tx.str_eq(expected, found)

type LAdv is Data:
  AdvLanded{}
  AdvMoved{}
  AdvHeld{path: String}
  AdvHolderChanged{path: String}
  AdvUnassociated{step: String}
  AdvIntentRefused{step: String}
  AdvRefused{}
  AdvBroken{detail: String}

# The fast-forward now advances through the same holder-aware path the checked landing uses,
# so both reach one effect. Only a landed answer reports LLanded; a moved target, a held
# worktree, a changed holder, a refused update and a broken read each keep their own answer.
def ff_stage5_adv_answer(+a: LAdv, target: String, cand: String) -> FFLD:
  match a:
    case AdvLanded{}: FFDone{T.LLanded{target, cand}}
    case AdvMoved{}: FFDone{T.LBlocked{"target moved during landing; retry"}}
    case AdvHeld{path}: FFDone{T.LBlocked{Tx.str_cat("the target is held by a worktree: ", path)}}
    case AdvHolderChanged{path}: FFDone{T.LBlocked{Tx.str_cat("the holder changed: ", path)}}
    case AdvUnassociated{step}: FFDone{T.LBlocked{Tx.str_cat("the association was refused at ", step)}}
    case AdvIntentRefused{step}: FFDone{T.LBlocked{Tx.str_cat("the intent was refused at ", step)}}
    case AdvRefused{}: FFDone{T.LBlocked{"git update-ref failed; inspect the target and retry"}}
    case AdvBroken{detail}: FFDone{T.LBlocked{detail}}

# One read of the qualification, kept as performed or explicitly not performed.
type LdRead is Data:
  ReadSkipped{}
  ReadObserved{observation: T.GitOut}

# The reads the held qualification actually performed, beside the advance decision it made.
type MutationMode is Data:
  MutationUnknown{}
  MutationUnheld{}
  MutationHeld{path: String}

type LdQualified is Data:
  QualDecided{mode: MutationMode, target_ref: LdRead, head_ref: LdRead}

# The association the attempt read before any mutation: the request the attempt built, the
# normalized values the association module returned from it, and the six read positions with the
# observation each one produced or as skipped. A refusal keeps the earlier performed reads and its
# own refusing observation, and the positions it never reached stay skipped.
type AssociationEvidence is Data:
  AssociationMissing{}
  AssociationObserved{step: String, request: A.AssociationRequest, candidate_oid: String, basis_oid: String, target_head: String, holder_common: String, destination_common: String, reads: A.AssocReads}
  AssociationRefused{request: A.AssociationRequest, step: String, observation: T.GitOut, reads: A.AssocReads}

# The whole outcome the intent producer returned, or an explicit statement that no publication was
# attempted. Keeping the outcome itself keeps its own tag, pending value, path and payload.
type IntentPublication is Data:
  IntentUnpublished{}
  IntentPublished{outcome: Pb.IntentPublish}

# The whole outcome the intent preparation returned, or an explicit statement that qualification was
# not reached.
type IntentPreparation is Data:
  IntentUnprepared{}
  IntentQualified{raw: String, path: String}
  IntentQualificationRefused{raw: String, path: String, pending: String, reason: String}
  IntentQualificationFailed{step: String, error: T.HostError}

# The three raw results a held route's holder observation produced. An unheld route performs none of
# them and says so, rather than performing repository reads and discarding them.
type IntentHolderReads is Data:
  IntentHolderUnperformed{}
  IntentHolderRead{head: T.GitOut, index: T.GitOut, status: T.GitOut}
  IntentHolderUnready{step: String, reason: String, raw: String}
  IntentHolderPending{request: It.IntentInput, raw: String, pending: String}
  IntentHolderFailed{step: String, request: It.IntentInput, error: T.HostError}

# The intent evidence: the request the attempt fixed, the path that request was expected to name, the
# publication outcome, the preparation outcome and the holder reads. The expected path is an operand,
# not an observation, and the older two-field form remains for landing-era evidence.
type IntentEvidence is Data:
  IntentMissing{}
  IntentObserved{path: String, raw: String}
  IntentBound{request: It.IntentInput, expected_path: String, publication: IntentPublication,
              preparation: IntentPreparation, holder: IntentHolderReads}

# The reservation the attempt's path was created under: the parent directory and the name the
# reserve call used. Retaining both lets admission evaluate the path the name implies and compare
# it with the path the evidence carries, instead of trusting that path alone.
type ReservationIdentity is Data:
  ReservationMissing{}
  ReservationObserved{parent: String, name: String}

type LdAdvObs is Data:
  LdAdvNoCapture{advance: LAdv, mode: MutationMode, association: AssociationEvidence, intent: IntentEvidence}
  LdAdvCaptured{advance: LAdv, capture: T.CapturedRaw, mode: MutationMode, association: AssociationEvidence, intent: IntentEvidence}
  LdAdvQualified{advance: LAdv, capture: T.CapturedRaw, qualification: LdQualified, association: AssociationEvidence, intent: IntentEvidence}

# The public shared boundary. The canonical common directory is read once here, the target
# claim is taken around the holder selection and the selected advance, and the release runs for
# every returned advance outcome with its own Result preserved beside the advance observation.
# A release failure is therefore visible to both adapters and can never read as a landing.

# Receipt admission: the published record was freshly created, durable, and reads back byte for byte.
# The complete attempt evidence. Every operand the attempt fixed at admission is carried here, so a
# later step cannot re-resolve or substitute one for receipt convenience.
type IdentityEvidence is Data:
  IdentityMissing{}
  IdentityObserved{common: String, observed: T.GitOut, target: String}

# The fixed operands the intent request named, and the two producer outcomes, written whole so the
# record carries the tags, paths, pending values and payloads the producers returned.
def intent_request_fields(request: It.IntentInput, rest: List<String>) -> List<String>:
  match request:
    case It.IntentRequested{attempt, common, target, destination, candidate, basis, intent_path, holder, retry}:
      Con{"intent-request", Con{attempt, Con{common, Con{target, Con{destination, Con{candidate, Con{basis, Con{intent_path, Con{holder, Con{retry, rest}}}}}}}}}}

def host_error_fields(error: T.HostError, rest: List<String>) -> List<String>:
  match error:
    case T.HostError{code, detail}: Con{"host-error", Con{U32.show(code), Con{detail, rest}}}

def publish_fields(outcome: Pb.IntentPublish, rest: List<String>) -> List<String>:
  match outcome:
    case Pb.IntentBytesPublished{request, raw, path, content}:
      Con{"published", Con{raw, Con{path, Con{content, intent_request_fields(request, rest)}}}}
    case Pb.PublishRefused{request, step, name, raw}:
      Con{"publish-refused", Con{step, Con{name, Con{raw, intent_request_fields(request, rest)}}}}
    case Pb.PublishExistingPending{request, raw, path}:
      Con{"publish-existing-pending", Con{raw, Con{path, intent_request_fields(request, rest)}}}
    case Pb.PublishContentMismatch{request, raw, expected, found}:
      Con{"publish-content-mismatch", Con{raw, Con{expected, Con{found, intent_request_fields(request, rest)}}}}
    case Pb.PublishReadbackFailed{request, publication, path, error}:
      Con{"publish-readback-failed", Con{publication, Con{path, host_error_fields(error, intent_request_fields(request, rest))}}}
    case Pb.PublishHostFailed{step, request, error}:
      Con{"publish-host-failed", Con{step, host_error_fields(error, intent_request_fields(request, rest))}}

def observation_fields(observation: T.GitOut, rest: List<String>) -> List<String>:
  match observation:
    case T.GRun{code, out}: Con{"run", Con{U32.show(code), Con{out, rest}}}
    case T.GBroken{detail}: Con{"broken", Con{detail, rest}}

def prepared_fields(outcome: It.IntentPrepared, rest: List<String>) -> List<String>:
  match outcome:
    case It.IntentObserved{request, raw, qualified_path, head, index, status}:
      Con{"intent-observed", Con{raw, Con{qualified_path, observation_fields(head, observation_fields(index, observation_fields(status, intent_request_fields(request, rest))))}}}
    case It.IntentUnready{step, reason, raw}:
      Con{"intent-unready", Con{step, Con{reason, Con{raw, rest}}}}
    case It.IntentPending{request, raw, pending}:
      Con{"intent-pending", Con{raw, Con{pending, intent_request_fields(request, rest)}}}
    case It.IntentHostFailed{step, request, error}:
      Con{"intent-host-failed", Con{step, host_error_fields(error, intent_request_fields(request, rest))}}

def reservation_name(reservation: ReservationIdentity) -> String:
  match reservation:
    case ReservationObserved{parent, name}: name
    case ReservationMissing{}: ""

def reservation_parent(reservation: ReservationIdentity) -> String:
  match reservation:
    case ReservationObserved{parent, name}: parent
    case ReservationMissing{}: ""

def reservation_fields(reservation: ReservationIdentity, rest: List<String>) -> List<String>:
  match reservation:
    case ReservationMissing{}: Con{"reservation-missing", rest}
    case ReservationObserved{parent, name}: Con{"reservation-observed", Con{parent, Con{name, rest}}}

type AttemptEvidence is Data:
  AttemptEvidence{reserved: String, repo: String, target: String, candidate: String, basis: String,
                  guard: String, artifact: String, decision: LAdv, capture: T.CapturedRaw,
                  qualification: LdQualified, release: T.ReleaseRaw, identity: IdentityEvidence,
                  association: AssociationEvidence, intent: IntentEvidence,
                  reservation: ReservationIdentity}

# One stage of an attestation: never performed, a host failure with its own code and detail, or the
# raw bytes the host answered.
type StageResult is Data:
  StageUnperformed{}
  StageFailed{code: U32, detail: String}
  StageSucceeded{raw: String}

# The retained attestation: every fixed operand, the decision, the immutable facts and each stage's
# actual result, so a refusal carries everything observed before it.
type Attestation is Data:
  Attestation{reserved: String, evidence: AttemptEvidence, publication: StageResult, qualification: StageResult, readback: StageResult}

def stage_of_failure(error: U32 & String) -> StageResult:
  match error:
    case (code, detail): StageFailed{code, detail}

def attest_stage(host: Result<&1, &1, U32 & String, String>) -> StageResult:
  match host:
    case Fail{error}: stage_of_failure(error)
    case Done{raw}: StageSucceeded{raw}

def stage_succeeded(stage: StageResult) -> Bool:
  match stage:
    case StageSucceeded{raw}: True{}
    case StageFailed{code, detail}: False{}
    case StageUnperformed{}: False{}

def stage_raw(stage: StageResult) -> String:
  match stage:
    case StageSucceeded{raw}: raw
    case StageFailed{code, detail}: ""
    case StageUnperformed{}: ""

def stage_detail(stage: StageResult) -> String:
  match stage:
    case StageFailed{code, detail}: detail
    case StageSucceeded{raw}: ""
    case StageUnperformed{}: "unperformed"

# The record bytes, encoded as an argv list so arbitrary tabs, newlines and content stay unambiguous,
# with the numeric codes rendered by U32.show.
def release_fields(release: T.ReleaseRaw, rest: List<String>) -> List<String>:
  match release:
    case T.ReleaseUnperformed{}: Con{"unperformed", rest}
    case T.ReleaseFailed{code, detail}: Con{"release-failed", Con{U32.show(code), Con{detail, rest}}}
    case T.ReleaseDone{}: Con{"released", rest}

def mode_fields(mode: MutationMode, rest: List<String>) -> List<String>:
  match mode:
    case MutationUnknown{}: Con{"mode-unknown", rest}
    case MutationUnheld{}: Con{"mode-unheld", rest}
    case MutationHeld{path}: Con{"mode-held", Con{path, rest}}

def read_fields(read: LdRead, rest: List<String>) -> List<String>:
  match read:
    case ReadSkipped{}: Con{"skipped", rest}
    case ReadObserved{observation}: observation_fields(observation, rest)

def qualification_fields(qualification: LdQualified, rest: List<String>) -> List<String>:
  match qualification:
    case QualDecided{mode, target_ref, head_ref}: read_fields(target_ref, read_fields(head_ref, mode_fields(mode, rest)))

def capture_fields(capture: T.CapturedRaw, rest: List<String>) -> List<String>:
  match capture:
    case T.CapturedAbsent{}: Con{"absent", rest}
    case T.CapturedFailed{code, detail}: Con{"capture-failed", Con{U32.show(code), Con{detail, rest}}}
    case T.CapturedDone{framing, diagnostics}: Con{"capture-done", Con{framing, Con{diagnostics, rest}}}

def identity_fields(identity: IdentityEvidence, rest: List<String>) -> List<String>:
  match identity:
    case IdentityMissing{}: Con{"identity-missing", rest}
    case IdentityObserved{common, +observed, target}: Con{"identity-observed", Con{common, Con{target, observation_fields(observed, rest)}}}

# The request the attempt built is written with the association, so the record names the attempt,
# the target, the destination, the candidate, the basis and the holder the reads used.
# Each of the six read positions is written with the observation it produced, or as skipped.
def association_read_fields(read: A.AssocRead, rest: List<String>) -> List<String>:
  match read:
    case A.AssocReadPerformed{observation}: Con{"performed", observation_fields(observation, rest)}
    case A.AssocReadSkipped{}: Con{"skipped", rest}

def reads_fields(+reads: A.AssocReads, rest: List<String>) -> List<String>:
  Con{"reads", association_read_fields(A.reads_candidate_of(reads),
    association_read_fields(A.reads_basis_of(reads),
      association_read_fields(A.reads_target_of(reads),
        association_read_fields(A.reads_ancestor_of(reads),
          association_read_fields(A.reads_holder_of(reads),
            association_read_fields(A.reads_destination_of(reads), rest))))))}

def request_fields(request: A.AssociationRequest, rest: List<String>) -> List<String>:
  match request:
    case A.AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}:
      Con{"request", Con{attempt, Con{common, Con{target, Con{destination, Con{candidate, Con{basis, Con{holder, Con{retry, rest}}}}}}}}}

def association_fields(association: AssociationEvidence, rest: List<String>) -> List<String>:
  match association:
    case AssociationMissing{}: Con{"association-missing", rest}
    case AssociationRefused{request, step, observation, reads}:
      Con{"association-refused", Con{step, observation_fields(observation, request_fields(request, reads_fields(reads, rest)))}}
    case AssociationObserved{step, request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}:
      Con{"association-observed", Con{step, Con{candidate_oid, Con{basis_oid, Con{target_head, Con{holder_common, Con{destination_common, request_fields(request, reads_fields(reads, rest))}}}}}}}

def intent_publication_fields(publication: IntentPublication, rest: List<String>) -> List<String>:
  match publication:
    case IntentUnpublished{}: Con{"publication-unperformed", rest}
    case IntentPublished{outcome}: Con{"publication-outcome", publish_fields(outcome, rest)}

def intent_preparation_fields(preparation: IntentPreparation, rest: List<String>) -> List<String>:
  match preparation:
    case IntentUnprepared{}: Con{"preparation-unperformed", rest}
    case IntentQualified{raw, path}: Con{"preparation-qualified", Con{raw, Con{path, rest}}}
    case IntentQualificationRefused{raw, path, pending, reason}: Con{"preparation-refused", Con{raw, Con{path, Con{pending, Con{reason, rest}}}}}
    case IntentQualificationFailed{step, error}: Con{"preparation-failed", Con{step, host_error_fields(error, rest)}}

def intent_holder_fields(holder: IntentHolderReads, rest: List<String>) -> List<String>:
  match holder:
    case IntentHolderUnperformed{}: Con{"holder-unperformed", rest}
    case IntentHolderRead{head, index, status}: Con{"holder-read", observation_fields(head, observation_fields(index, observation_fields(status, rest)))}
    case IntentHolderUnready{step, reason, raw}: Con{"holder-unready", Con{step, Con{reason, Con{raw, rest}}}}
    case IntentHolderPending{request, raw, pending}: Con{"holder-pending", Con{raw, Con{pending, intent_request_fields(request, rest)}}}
    case IntentHolderFailed{step, request, error}: Con{"holder-failed", Con{step, host_error_fields(error, intent_request_fields(request, rest))}}

def intent_fields(intent: IntentEvidence, rest: List<String>) -> List<String>:
  match intent:
    case IntentMissing{}: Con{"intent-missing", rest}
    case IntentObserved{path, raw}: Con{"intent-observed", Con{path, Con{raw, rest}}}
    case IntentBound{request, expected_path, publication, preparation, holder}:
      Con{"intent-bound", Con{expected_path, intent_publication_fields(publication, intent_preparation_fields(preparation, intent_holder_fields(holder, intent_request_fields(request, rest))))}}

def decision_fields(decision: LAdv, rest: List<String>) -> List<String>:
  match decision:
    case AdvLanded{}: Con{"decision-landed", rest}
    case AdvMoved{}: Con{"decision-moved", rest}
    case AdvHeld{path}: Con{"decision-held", Con{path, rest}}
    case AdvHolderChanged{path}: Con{"decision-holder-changed", Con{path, rest}}
    case AdvUnassociated{step}: Con{"decision-unassociated", Con{step, rest}}
    case AdvIntentRefused{step}: Con{"decision-intent-refused", Con{step, rest}}
    case AdvRefused{}: Con{"decision-refused", rest}
    case AdvBroken{detail}: Con{"decision-broken", Con{detail, rest}}

def attempt_fields(evidence: AttemptEvidence) -> List<String>:
  match evidence:
    case AttemptEvidence{reserved, repo, target, candidate, basis, guard, artifact, decision, capture, qualification, release, identity, association, intent, reservation}:
      Con{"attempt", Con{reserved, Con{repo, Con{target, Con{candidate, Con{basis, Con{guard, Con{artifact,
        capture_fields(capture, qualification_fields(qualification, release_fields(release,
          identity_fields(identity, association_fields(association, intent_fields(intent, reservation_fields(reservation, decision_fields(decision, Nil{}))))))))}}}}}}}}
def attempt_record(evidence: AttemptEvidence) -> String:
  Tx.enc_argv(attempt_fields(evidence))

type Admission is Data:
  AdmissionRefused{attestation: Attestation, reason: String}
  AdmissionAdmitted{attestation: Attestation}

type SharedLanding is Data:
  SharedCommonUnreadable{observation: T.GitOut}
  SharedClaimFailed{error: T.HostError}
  SharedGuardBusy{target: String}
  SharedStepFailed{step: String, error: T.HostError, released: T.ReleaseRaw}
  SharedStepRecordFailed{step: String, record: String, released: T.ReleaseRaw}
  SharedAdvanced{attestation: Attestation}

# Every step failure releases the acquired descriptor and keeps its own stage, its complete
# error or raw record, and the actual release Result.
def shared_error(error: U32 & String) -> T.HostError:
  match error:
    case (code, detail): T.HostError{code, detail}

def shared_step_failed(step: String, error: U32 & String, handle: U32) -> IO(SharedLanding):
  +s = step
  +e = shared_error(error)
  +h = handle
  do IO<SharedLanding>:
    released : Result<&1, &1, U32 & String, Unit> <- Rec.Receipt.release(h)
    IO.pure(SharedLanding, SharedStepFailed{s, e, T.release_raw_of(released)})

def shared_attempts_parent(common: String) -> String:
  +c = common
  Tx.str_cat(c, "/baton2-attempts")

def shared_parent_path(directory: String, name: String) -> String:
  +d = directory
  +n = name
  Tx.str_cat(d, Tx.str_cat("/", n))

def shared_record_failed(step: String, record: String, handle: U32) -> IO(SharedLanding):
  +s = step
  +r = record
  +h = handle
  do IO<SharedLanding>:
    released : Result<&1, &1, U32 & String, Unit> <- Rec.Receipt.release(h)
    IO.pure(SharedLanding, SharedStepRecordFailed{s, r, T.release_raw_of(released)})

type LdAdvCtx is Data:
  LdAdvContext{claim: U32, guard: String, artifact: String, attempt: String, common: String, reserved: String}
def ladvctx_claim(context: LdAdvCtx) -> U32:
  match context:
    case LdAdvContext{claim, guard, artifact, attempt, common, reserved}: claim

def ladvctx_guard(context: LdAdvCtx) -> String:
  match context:
    case LdAdvContext{claim, guard, artifact, attempt, common, reserved}: guard

def ladvctx_artifact(context: LdAdvCtx) -> String:
  match context:
    case LdAdvContext{claim, guard, artifact, attempt, common, reserved}: artifact

# The reserved attempt's own name, as the reservation recorded it.
def ladvctx_attempt(context: LdAdvCtx) -> String:
  match context:
    case LdAdvContext{claim, guard, artifact, attempt, common, reserved}: attempt

# The canonical common directory the claim answered.
def ladvctx_common(context: LdAdvCtx) -> String:
  match context:
    case LdAdvContext{claim, guard, artifact, attempt, common, reserved}: common

# The resolved reserved path the attempt was created at, kept beside its name so the intent file is
# named from the path the reservation actually produced.
def ladvctx_reserved(context: LdAdvCtx) -> String:
  match context:
    case LdAdvContext{claim, guard, artifact, attempt, common, reserved}: reserved

# The target commit lookup used by the existing unheld compare-and-swap path.
def ld_tip_argv(target: String) -> List<String>:
  ["rev-parse", "--verify", Tx.str_cat(target, "^{commit}")]

def ld_adv_wrap(advance: LAdv, mode: MutationMode) -> LdAdvObs:
  +a = advance
  +m = mode
  LdAdvNoCapture{a, m, AssociationMissing{}, IntentMissing{}}

# The worktree that holds the target: its path, none, or the reason the report
# cannot be trusted to name exactly one.
type LdHold is Data:
  HoldNone{}
  HoldPath{path: String}
  HoldBlocked{detail: String}

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

# The path one worktree-list line names: the line with its label match off,
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

def ld_update_argv(target: String, cand: String, basis: String) -> List<String>:
  ["update-ref", Tx.str_cat("refs/heads/", target), cand, basis]

def ld_adv_runres(rr: T.RunRes) -> T.GitOut:
  match rr:
    case T.RRun{T.SExit{code}, out}: T.GRun{code, out}
    case T.RRun{T.SSignal{num}, out}: T.GBroken{"the mutation signalled"}
    case T.RSpawn{detail}: T.GBroken{detail}

def ld_adv_framed(framing: String) -> T.GitOut:
  ld_adv_runres(Tx.run_res(Done{framing}))

def ld_adv_status(+capture: T.CapturedRaw) -> T.GitOut:
  match capture:
    case T.CapturedAbsent{}: T.GBroken{"the mutation was not performed"}
    case T.CapturedFailed{code, detail}: T.GBroken{detail}
    case T.CapturedDone{framing, diagnostics}: ld_adv_framed(framing)

def ld_adv_with(advance: LAdv, +capture: T.CapturedRaw, mode: MutationMode) -> LdAdvObs:
  +a = advance
  +c = capture
  +m = mode
  LdAdvCaptured{a, c, m, AssociationMissing{}, IntentMissing{}}

# The exact local target branch commit used to validate a held worktree.
def ld_target_ref_argv(target: String) -> List<String>:
  ["rev-parse", "--verify", Tx.str_cat(ld_hold_ref(target), "^{commit}")]

# The update-ref argv: the target ref, the candidate and the basis it advanced
# from, so the branch moves only while it still reads as that basis.
def ld_adv_cas(g: T.GitOut) -> LAdv:
  match g:
    case T.GRun{code, out}: Bool.pick(LAdv, U32.is_eq(code, 0), AdvLanded{}, AdvRefused{})
    case T.GBroken{detail}: AdvBroken{detail}

def ld_adv_capture(obs: LdAdvObs) -> T.CapturedRaw:
  match obs:
    case LdAdvNoCapture{advance, mode, association, intent}: T.CapturedAbsent{}
    case LdAdvCaptured{advance, capture, mode, association, intent}: capture
    case LdAdvQualified{advance, capture, qualification, association, intent}: capture

def ld_adv_qualification(obs: LdAdvObs) -> LdQualified:
  match obs:
    case LdAdvNoCapture{advance, mode, association, intent}: QualDecided{mode, ReadSkipped{}, ReadSkipped{}}
    case LdAdvCaptured{advance, capture, mode, association, intent}: QualDecided{mode, ReadSkipped{}, ReadSkipped{}}
    case LdAdvQualified{advance, capture, qualification, association, intent}: qualification

def ld_admitted(admission: Admission) -> Bool:
  match admission:
    case AdmissionAdmitted{attestation}: True{}
    case AdmissionRefused{attestation, reason}: False{}

def ld_admission(admission: Admission) -> String:
  match admission:
    case AdmissionAdmitted{attestation}: "admitted"
    case AdmissionRefused{attestation, reason}: reason

def ld_adv_qualified_with(advance: LAdv, +capture: T.CapturedRaw, qualification: LdQualified) -> LdAdvObs:
  LdAdvQualified{advance, capture, qualification, AssociationMissing{}, IntentMissing{}}

# A refused mutation still records the target read it performed; HEAD was never reached.
def ld_adv_read(observation: T.GitOut) -> LdRead:
  ReadObserved{observation}

def ld_adv_cas_compared(cand: String, +capture: T.CapturedRaw, after: T.GitOut, tip: String) -> IO(LdAdvObs):
  +c2 = cand
  +cp = capture
  +obs = after
  +seen = tip
  Bool.pick(IO(LdAdvObs), Tx.str_eq(seen, c2),
    IO.pure(LdAdvObs, ld_adv_qualified_with(AdvLanded{}, cp, QualDecided{MutationUnheld{}, ld_adv_read(obs), ReadSkipped{}})),
    IO.pure(LdAdvObs, ld_adv_qualified_with(AdvMoved{}, cp, QualDecided{MutationUnheld{}, ld_adv_read(obs), ReadSkipped{}})))
def ld_adv_cas_readback(target: String, cand: String, +capture: T.CapturedRaw, +after: T.GitOut) -> IO(LdAdvObs):
  match after:
    case T.GRun{code, out}:
      +c0 = code
      Bool.pick(IO(LdAdvObs), U32.is_eq(c0, 0),
        ld_adv_cas_compared(cand, capture, after, Tx.trim_nl(out)),
        IO.pure(LdAdvObs, ld_adv_qualified_with(AdvBroken{"the target could not be read back after the advance"}, capture, QualDecided{MutationUnheld{}, ld_adv_read(after), ReadSkipped{}})))
    case T.GBroken{detail}: IO.pure(LdAdvObs, ld_adv_qualified_with(AdvBroken{detail}, capture, QualDecided{MutationUnheld{}, ld_adv_read(after), ReadSkipped{}}))

# The unheld advance is not landed on exit zero alone: while the target claim is still held the
# target ref is read back and required to be the candidate. A moved target answers AdvMoved with
# the capture retained; an unreadable readback answers AdvBroken with it.
def ld_adv_cas_qualified(target: String, cand: String, +capture: T.CapturedRaw, +status: T.GitOut, repo: String) -> IO(LdAdvObs):
  match status:
    case T.GRun{code, out}:
      Bool.pick(IO(LdAdvObs), U32.is_eq(code, 0),
        do IO<LdAdvObs>:
            after : T.GitOut <- Git.runGit(repo, ld_target_ref_argv(target))
            ld_adv_cas_readback(target, cand, capture, after),
        IO.pure(LdAdvObs, ld_adv_with(ld_adv_cas(status), capture, MutationUnheld{})))
    case T.GBroken{detail}: IO.pure(LdAdvObs, ld_adv_with(ld_adv_cas(status), capture, MutationUnheld{}))

# The compare-and-swap where no worktree holds the target.
def ld_adv_cas_reuse(target: String, cand: String, repo: String, +capture: T.CapturedRaw) -> IO(LdAdvObs):
  ld_adv_cas_qualified(target, cand, capture, ld_adv_status(capture), repo)

def ld_adv_cas_capture(target: String, cand: String, repo: String, host: Result<&1,&1,U32 & String,String & String>) -> IO(LdAdvObs):
  ld_adv_cas_reuse(target, cand, repo, T.captured_raw_of(host))

def ld_adv_cas_run(repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx) -> IO(LdAdvObs):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  +cx = ctx
  do IO<LdAdvObs>:
    captured : Result<&1,&1,U32 & String,String & String> <- Git.Process.capture_holding(Tx.enc_argv(Con{"git", ld_update_argv(t2, c2, b2)}), r2, ladvctx_claim(cx), ladvctx_guard(cx), ladvctx_artifact(cx))
    ld_adv_cas_capture(t2, c2, r2, captured)
# The attached branch name of a worktree, or a nonzero result when detached.
def ld_head_argv() -> List<String>:
  ["symbolic-ref", "--quiet", "HEAD"]

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

def ld_adv_wt_refused_decided(advance: LAdv, +path: String, +read: T.GitOut, +capture: T.CapturedRaw) -> IO(LdAdvObs):
  IO.pure(LdAdvObs, ld_adv_qualified_with(advance, capture, QualDecided{MutationHeld{path}, ld_adv_read(read), ReadSkipped{}}))

def ld_adv_wt_refused(path: String, repo: String, target: String, basis: String, +capture: T.CapturedRaw) -> IO(LdAdvObs):
  +p2 = path
  +r2 = repo
  +t2 = target
  +b2 = basis
  do IO<LdAdvObs>:
    +g : T.GitOut <- Git.runGit(r2, ld_target_ref_argv(t2))
    ld_adv_wt_refused_decided(ld_adv_refused_pick(g, p2, b2), p2, g, capture)

# The target read decides movement and failure; only a successful matching tip goes on to HEAD.
def ld_adv_wt_head_decided(+path: String, +target: String, +capture: T.CapturedRaw, +tip: T.GitOut, +head: T.GitOut) -> IO(LdAdvObs):
  match head:
    case T.GBroken{detail}:
      IO.pure(LdAdvObs, ld_adv_qualified_with(AdvBroken{detail}, capture, QualDecided{MutationHeld{path}, ld_adv_read(tip), ld_adv_read(head)}))
    case T.GRun{code, out}:
      Bool.pick(IO(LdAdvObs), U32.is_eq(code, 0),
        Bool.pick(IO(LdAdvObs), Tx.str_eq(Tx.trim_nl(out), ld_hold_ref(target)),
          IO.pure(LdAdvObs, ld_adv_qualified_with(AdvLanded{}, capture, QualDecided{MutationHeld{path}, ld_adv_read(tip), ld_adv_read(head)})),
          IO.pure(LdAdvObs, ld_adv_qualified_with(AdvHolderChanged{path}, capture, QualDecided{MutationHeld{path}, ld_adv_read(tip), ld_adv_read(head)}))),
        IO.pure(LdAdvObs, ld_adv_qualified_with(AdvBroken{out}, capture, QualDecided{MutationHeld{path}, ld_adv_read(tip), ld_adv_read(head)})))

def ld_adv_wt_head_read(path: String, repo: String, target: String, +capture: T.CapturedRaw, +tip: T.GitOut) -> IO(LdAdvObs):
  +p2 = path
  do IO<LdAdvObs>:
    +head : T.GitOut <- Git.runGit(p2, ld_head_argv())
    ld_adv_wt_head_decided(p2, target, capture, tip, head)

def ld_adv_wt_target_decided(+path: String, repo: String, +target: String, +cand: String, +capture: T.CapturedRaw, +tip: T.GitOut) -> IO(LdAdvObs):
  match tip:
    case T.GBroken{detail}:
      IO.pure(LdAdvObs, ld_adv_qualified_with(AdvBroken{detail}, capture, QualDecided{MutationHeld{path}, ld_adv_read(tip), ReadSkipped{}}))
    case T.GRun{code, out}:
      Bool.pick(IO(LdAdvObs), U32.is_eq(code, 0),
        Bool.pick(IO(LdAdvObs), Tx.str_eq(Tx.trim_nl(out), cand),
          ld_adv_wt_head_read(path, repo, target, capture, tip),
          IO.pure(LdAdvObs, ld_adv_qualified_with(AdvMoved{}, capture, QualDecided{MutationHeld{path}, ld_adv_read(tip), ReadSkipped{}}))),
        IO.pure(LdAdvObs, ld_adv_qualified_with(AdvBroken{out}, capture, QualDecided{MutationHeld{path}, ld_adv_read(tip), ReadSkipped{}})))

def ld_adv_wt_target_read(path: String, repo: String, target: String, cand: String, +capture: T.CapturedRaw) -> IO(LdAdvObs):
  +p2 = path
  +r2 = repo
  +t2 = target
  +c2 = cand
  do IO<LdAdvObs>:
    +tip : T.GitOut <- Git.runGit(r2, ld_target_ref_argv(t2))
    ld_adv_wt_target_decided(p2, r2, t2, c2, capture, tip)

# The symbolic HEAD read decides holder change and failure; the target read is carried through.
def ld_adv_wt_pick(g: T.GitOut, path: String, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx, +capture: T.CapturedRaw) -> IO(LdAdvObs):
  match g:
    case T.GRun{code, out}:
      +p2 = path
      +r2 = repo
      +t2 = target
      +c2 = cand
      +b2 = basis
      Bool.pick(IO(LdAdvObs), U32.is_eq(code, 0),
        ld_adv_wt_target_read(p2, r2, t2, c2, capture),
        ld_adv_wt_refused(p2, r2, t2, b2, capture))
    case T.GBroken{detail}: IO.pure(LdAdvObs, ld_adv_with(AdvBroken{detail}, capture, MutationHeld{path}))
def ld_adv_wt_reuse(path: String, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx, +capture: T.CapturedRaw) -> IO(LdAdvObs):
  ld_adv_wt_pick(ld_adv_status(capture), path, repo, target, cand, basis, ctx, capture)

def ld_adv_wt_capture(path: String, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx, host: Result<&1,&1,U32 & String,String & String>) -> IO(LdAdvObs):
  ld_adv_wt_reuse(path, repo, target, cand, basis, ctx, T.captured_raw_of(host))

# Git provides no atomic CLI operation that pins symbolic HEAD across the final identity check
# and the merge, so a switch in that interval can still direct the merge to another branch. The
# target claim coordinates participating landings; it does not lock an independent Git process.
def ld_adv_wt_head_same(same: Bool, +path: String, repo: String, target: String, cand: String, basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match same:
    case False{}: IO.pure(LdAdvObs, ld_adv_wrap(AdvHolderChanged{path}, MutationHeld{path}))
    case True{}:
      +p2 = path
      +r2 = repo
      +t2 = target
      +c2 = cand
      +b2 = basis
      do IO<LdAdvObs>:
        captured : Result<&1,&1,U32 & String,String & String> <- Git.Process.capture_holding(Tx.enc_argv(Con{"git", Con{"merge", Con{"--ff-only", Con{c2, Nil{}}}}}), p2, ladvctx_claim(ctx), ladvctx_guard(ctx), ladvctx_artifact(ctx))
        ld_adv_wt_capture(p2, r2, t2, c2, b2, ctx, captured)
def ld_adv_wt_head_pick(g: T.GitOut, path: String, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx) -> IO(LdAdvObs):
  match g:
    case T.GRun{code, out}:
      +t2 = target
      +status_ok = U32.is_eq(code, 0)
      +same = Bool.pick(Bool, status_ok, Tx.str_eq(Tx.trim_nl(out), ld_hold_ref(t2)), False{})
      ld_adv_wt_head_same(same, path, repo, t2, cand, basis, ctx)
    case T.GBroken{detail}: IO.pure(LdAdvObs, ld_adv_wrap(AdvBroken{detail}, MutationHeld{path}))
def ld_adv_wt_target_same(same: Bool, path: String, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx) -> IO(LdAdvObs):
  match same:
    case False{}: IO.pure(LdAdvObs, ld_adv_wrap(AdvMoved{}, MutationHeld{path}))
    case True{}:
      +p2 = path
      +r2 = repo
      +t2 = target
      +c2 = cand
      +b2 = basis
      do IO<LdAdvObs>:
        holder : T.GitOut <- Git.runGit(p2, ld_head_argv())
        ld_adv_wt_head_pick(holder, p2, r2, t2, c2, b2, ctx)
def ld_adv_wt_target_pick(g: T.GitOut, path: String, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx) -> IO(LdAdvObs):
  match g:
    case T.GRun{code, out}:
      +b2 = basis
      +status_ok = U32.is_eq(code, 0)
      +same = Bool.pick(Bool, status_ok, Tx.str_eq(Tx.trim_nl(out), b2), False{})
      ld_adv_wt_target_same(same, path, repo, target, cand, b2, ctx)
    case T.GBroken{detail}: IO.pure(LdAdvObs, ld_adv_wrap(AdvBroken{detail}, MutationHeld{path}))
def ld_adv_wt(path: String, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx) -> IO(LdAdvObs):
  +p2 = path
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  +cx = ctx
  do IO<LdAdvObs>:
    target_tip : T.GitOut <- Git.runGit(r2, ld_target_ref_argv(t2))
    ld_adv_wt_target_pick(target_tip, p2, r2, t2, c2, b2, cx)
# The association read the attempt performs before its mutation, from the operands it already
# fixed: the reserved attempt's own name, the canonical common the claim answered, the
# destination repository used for the target read, and the immutable candidate and basis. The
# holder is the selected read location, which is why the request is built at the selection and
# not from the caller. The association module never reads the retry field, so the shared path
# records it empty rather than claiming a retry that did not happen.
def ld_assoc_request(+ctx: LdAdvCtx, holder: String, repo: String, target: String, cand: String, basis: String) -> A.AssociationRequest:
  A.AssociationRequested{ladvctx_attempt(ctx), ladvctx_common(ctx), target, repo, cand, basis, holder, ""}

def association_attempt(request: A.AssociationRequest) -> String:
  match request:
    case A.AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}: attempt

# The returned association is compared, before any mutation, with the operands this attempt fixed
# and with the read location the route selected: the returned candidate and basis must be the fixed
# ones, the returned target head must be the basis the target ref was checked against, the request
# must name the reserved attempt, the target, the destination repository, the candidate, the basis
# and the selected holder, and both observed commons must be the canonical common the claim answered.
type AssociationCheck is Data:
  AssociationAgreed{}
  AssociationDisagreed{step: String}

def ld_assoc_check(request: A.AssociationRequest, candidate_oid: String, basis_oid: String, target_head: String, holder_common: String, destination_common: String, sel_holder: String, sel_repo: String, sel_target: String, +sel_cand: String, +sel_basis: String, sel_attempt: String, +sel_common: String) -> AssociationCheck:
  match request:
    case A.AssociationRequested{attempt, common, target, destination, candidate, basis, holder, retry}:
      Bool.pick(AssociationCheck, Tx.str_eq(candidate_oid, sel_cand),
        Bool.pick(AssociationCheck, Tx.str_eq(basis_oid, sel_basis),
          Bool.pick(AssociationCheck, Tx.str_eq(target_head, sel_basis),
            Bool.pick(AssociationCheck, Tx.str_eq(candidate, sel_cand),
              Bool.pick(AssociationCheck, Tx.str_eq(basis, sel_basis),
                Bool.pick(AssociationCheck, Tx.str_eq(target, sel_target),
                  Bool.pick(AssociationCheck, Tx.str_eq(destination, sel_repo),
                    Bool.pick(AssociationCheck, Tx.str_eq(holder, sel_holder),
                      Bool.pick(AssociationCheck, Tx.str_eq(attempt, sel_attempt),
                        Bool.pick(AssociationCheck, Tx.str_eq(common, sel_common),
                          Bool.pick(AssociationCheck, Tx.str_eq(holder_common, sel_common),
                            Bool.pick(AssociationCheck, Tx.str_eq(destination_common, sel_common),
                              AssociationAgreed{}, AssociationDisagreed{"destination-common"}),
                            AssociationDisagreed{"holder-common"}),
                          AssociationDisagreed{"common"}),
                        AssociationDisagreed{"attempt"}),
                      AssociationDisagreed{"holder"}),
                    AssociationDisagreed{"destination"}),
                  AssociationDisagreed{"target"}),
                AssociationDisagreed{"basis"}),
              AssociationDisagreed{"candidate"}),
            AssociationDisagreed{"target-head"}),
          AssociationDisagreed{"returned-basis"}),
        AssociationDisagreed{"returned-candidate"})

def association_agreed(check: AssociationCheck) -> Bool:
  match check:
    case AssociationAgreed{}: True{}
    case AssociationDisagreed{step}: False{}

# A route the association could have been read for. An unknown mode asserts no route, so the
# association predicate refuses it rather than passing on an empty holder comparison.
def mode_selected(mode: MutationMode) -> Bool:
  match mode:
    case MutationHeld{path}: True{}
    case MutationUnheld{}: True{}
    case MutationUnknown{}: False{}

# The step a retained association records when the comparison accepted it. A mismatch keeps the
# step that disagreed, so a record cannot pass as agreed on its other fields alone.
def association_step_accepted(step: String) -> Bool:
  Tx.str_eq(step, "associate")

# The reservation the path was created under: a named reservation in the attempt directory of the
# canonical common, and a reserved path that is exactly that directory joined with that name. The
# expected path is evaluated from the retained parent and name, which is a comparison and not a new
# observation.
def reservation_bound(reserved: String, reservation: ReservationIdentity, common: String) -> Bool:
  match reservation:
    case ReservationObserved{+parent, +name}:
      Bool.pick(Bool, Tx.non_empty(name),
        Bool.pick(Bool, Tx.str_eq(parent, shared_attempts_parent(common)),
          Tx.str_eq(reserved, shared_parent_path(parent, name)),
          False{}),
        False{})
    case ReservationMissing{}: False{}

def mode_holder(mode: MutationMode, repo: String) -> String:
  match mode:
    case MutationHeld{path}: path
    case MutationUnheld{}: repo
    case MutationUnknown{}: ""

def ld_adv_association(obs: LdAdvObs) -> AssociationEvidence:
  match obs:
    case LdAdvNoCapture{advance, mode, association, intent}: association
    case LdAdvCaptured{advance, capture, mode, association, intent}: association
    case LdAdvQualified{advance, capture, qualification, association, intent}: association

def ld_adv_intent(obs: LdAdvObs) -> IntentEvidence:
  match obs:
    case LdAdvNoCapture{advance, mode, association, intent}: intent
    case LdAdvCaptured{advance, capture, mode, association, intent}: intent
    case LdAdvQualified{advance, capture, qualification, association, intent}: intent

def ld_adv_keep_intent(obs: LdAdvObs, evidence: IntentEvidence) -> LdAdvObs:
  match obs:
    case LdAdvNoCapture{advance, mode, association, intent}: LdAdvNoCapture{advance, mode, association, evidence}
    case LdAdvCaptured{advance, capture, mode, association, intent}: LdAdvCaptured{advance, capture, mode, association, evidence}
    case LdAdvQualified{advance, capture, qualification, association, intent}: LdAdvQualified{advance, capture, qualification, association, evidence}

def ld_adv_keep_association(obs: LdAdvObs, evidence: AssociationEvidence) -> LdAdvObs:
  match obs:
    case LdAdvNoCapture{advance, mode, association, intent}: LdAdvNoCapture{advance, mode, evidence, intent}
    case LdAdvCaptured{advance, capture, mode, association, intent}: LdAdvCaptured{advance, capture, mode, evidence, intent}
    case LdAdvQualified{advance, capture, qualification, association, intent}: LdAdvQualified{advance, capture, qualification, evidence, intent}

# A refused association stops the attempt before the mutation: the selected mode is retained,
# no capture was taken, and both post-mutation reads were not performed.
def ld_adv_unassociated(request: A.AssociationRequest, +step: String, +observation: T.GitOut, reads: A.AssocReads, mode: MutationMode) -> LdAdvObs:
  LdAdvNoCapture{AdvUnassociated{step}, mode, AssociationRefused{request, step, observation, reads}, IntentMissing{}}

# A returned association that disagrees with the fixed operands or the selected route stops the
# attempt before the mutation, retaining the returned values and naming the disagreeing step.
def ld_adv_mismatched(step: String, request: A.AssociationRequest, candidate_oid: String, basis_oid: String, target_head: String, holder_common: String, destination_common: String, reads: A.AssocReads, mode: MutationMode) -> LdAdvObs:
  +s = step
  +rq = request
  LdAdvNoCapture{AdvUnassociated{s}, mode, AssociationObserved{s, rq, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}, IntentMissing{}}

# The comparison the caller made is matched here as a parameter. A disagreement stops the attempt
# with the returned association retained; an agreement continues into the selected mutation, and
# the association rides on that mutation's own observation.
def observation_succeeded(observation: T.GitOut) -> Bool:
  match observation:
    case T.GRun{code, out}: U32.is_eq(code, 0)
    case T.GBroken{detail}: False{}

def observation_value(observation: T.GitOut) -> String:
  match observation:
    case T.GRun{code, out}: Tx.trim_nl(out)
    case T.GBroken{detail}: ""

# The intent path the attempt's own reservation implies. It is an operand for comparison, never a host
# result.
def intent_expected_path(reserved: String) -> String:
  shared_parent_path(reserved, "intent")

# The request must name the attempt's reservation and every fixed operand, and the path the producer
# admitted must be that path.
def intent_request_bound(+request: It.IntentInput, reserved: String, name: String, common: String, repo: String, target: String, candidate: String, basis: String, holder: String) -> Bool:
  Bool.pick(Bool, Tx.str_eq(It.requested_attempt(request), name),
    Bool.pick(Bool, Tx.str_eq(It.requested_common(request), common),
      Bool.pick(Bool, Tx.str_eq(It.requested_target(request), target),
        Bool.pick(Bool, Tx.str_eq(It.requested_destination(request), repo),
          Bool.pick(Bool, Tx.str_eq(It.requested_candidate(request), candidate),
            Bool.pick(Bool, Tx.str_eq(It.requested_basis(request), basis),
              Bool.pick(Bool, Tx.str_eq(It.requested_holder(request), holder),
                Tx.str_eq(It.requested_path(request), intent_expected_path(reserved)),
                False{}), False{}), False{}), False{}), False{}), False{}), False{})

# The publication is admitted only when it is the producer's own successful publication of this very
# attempt's intent: the same request, the expected path, a record the producer wrote, and the exact
# content read back for the fixed candidate, basis and target. The outcome constructor is reached both
# for a fresh publication and for an accepted existing one, so this must not demand a fresh-only record.
# The producer admits exactly two records for a path it published: the fresh publication and the
# accepted existing one, both with pending zero. A nonzero error, a malformed record, a trailing
# separator or another path is refused here, and an existing record that still reports pending is not
# an admission either.
def intent_publication_record(raw: String, path: String, expected_path: String) -> Bool:
  +r = raw
  +p = path
  +want = expected_path
  Bool.pick(Bool, Tx.str_eq(p, want),
    Bool.pick(Bool, Tx.str_eq(r, Pb.production_record("published", want, "0")),
      True{},
      Tx.str_eq(r, Pb.production_record("existing", want, "0"))),
    False{})

def intent_publication_bound(publication: IntentPublication, expected_path: String, reserved: String, name: String, common: String, repo: String, +target: String, +candidate: String, +basis: String, holder: String) -> Bool:
  match publication:
    case IntentPublished{outcome}:
      match outcome:
        case Pb.IntentBytesPublished{request, raw, path, content}:
          Bool.pick(Bool, intent_publication_record(raw, path, expected_path),
            Bool.pick(Bool, Tx.str_eq(content, Lg.intent_content(candidate, basis, target)),
              intent_request_bound(request, reserved, name, common, repo, target, candidate, basis, holder),
              False{}),
            False{})
        case Pb.PublishRefused{request, step, name, raw}: False{}
        case Pb.PublishExistingPending{request, raw, path}: False{}
        case Pb.PublishContentMismatch{request, raw, expected, found}: False{}
        case Pb.PublishReadbackFailed{request, publication, path, error}: False{}
        case Pb.PublishHostFailed{step, request, error}: False{}
    case IntentUnpublished{}: False{}

# The qualification must be the receipt's own admitted verdict for the expected path. It carries no
# holder reads: those are a separate, later observation of the selected route.
# The retained qualification is admitted only when its own record re-derives an admitted verdict for the
# expected path. The record is data, so the verdict is recomputed from it rather than trusted.
def qualification_admitted(raw: String, expected_path: String) -> Bool:
  It.verdict_admitted(It.receipt_verdict(raw, expected_path))

def intent_preparation_bound(preparation: IntentPreparation, +expected_path: String) -> Bool:
  match preparation:
    case IntentQualified{raw, path}:
      Bool.pick(Bool, Tx.str_eq(path, expected_path), qualification_admitted(raw, expected_path), False{})
    case IntentQualificationRefused{raw, path, pending, reason}: False{}
    case IntentQualificationFailed{step, error}: False{}
    case IntentUnprepared{}: False{}

# A held route must have performed all three holder reads successfully; an unheld route performs none of
# them and says so. An unknown route asserts nothing.
# A held route's three reads must be the selected worktree's own: the head must answer the basis the
# target ref was checked against, and the cached index and the worktree must be clean. A failed read
# keeps its own codes in the record and refuses here.
def intent_holder_bound(reads: IntentHolderReads, mode: MutationMode, basis: String) -> Bool:
  match mode:
    case MutationHeld{path}:
      match reads:
        case IntentHolderRead{+head, +index, +status}:
          Bool.pick(Bool, observation_succeeded(head),
            Bool.pick(Bool, Tx.str_eq(observation_value(head), basis),
              Bool.pick(Bool, observation_succeeded(index),
                Bool.pick(Bool, Tx.str_eq(observation_value(index), ""),
                  Bool.pick(Bool, observation_succeeded(status), Tx.str_eq(observation_value(status), ""), False{}),
                  False{}),
                False{}),
              False{}),
            False{})
        case IntentHolderUnperformed{}: False{}
        case IntentHolderUnready{step, reason, raw}: False{}
        case IntentHolderPending{request, raw, pending}: False{}
        case IntentHolderFailed{step, request, error}: False{}
    case MutationUnheld{}:
      match reads:
        case IntentHolderUnperformed{}: True{}
        case IntentHolderRead{head, index, status}: False{}
        case IntentHolderUnready{step, reason, raw}: False{}
        case IntentHolderPending{request, raw, pending}: False{}
        case IntentHolderFailed{step, request, error}: False{}
    case MutationUnknown{}: False{}


def intent_bound(intent: IntentEvidence, +reserved: String, +name: String, +common: String, +repo: String, +target: String, +candidate: String, +basis: String, +holder: String, mode: MutationMode) -> Bool:
  match intent:
    case IntentBound{request, +expected_path, publication, preparation, holder_reads}:
      Bool.pick(Bool, Tx.str_eq(expected_path, intent_expected_path(reserved)),
        Bool.pick(Bool, intent_request_bound(request, reserved, name, common, repo, target, candidate, basis, holder),
          Bool.pick(Bool, intent_publication_bound(publication, expected_path, reserved, name, common, repo, target, candidate, basis, holder),
            Bool.pick(Bool, intent_preparation_bound(preparation, expected_path),
              intent_holder_bound(holder_reads, mode, basis),
              False{}),
            False{}),
          False{}),
        False{})
    case IntentObserved{path, raw}: False{}
    case IntentMissing{}: False{}

# The intent file the attempt publishes under its own reservation: the resolved reserved directory and
# one fixed name, so the path the producer admits is the path the request named.
def shared_intent_path(+ctx: LdAdvCtx) -> String:
  Tx.str_cat(ladvctx_reserved(ctx), "/intent")

def shared_intent_input(+ctx: LdAdvCtx, holder: String, repo: String, target: String, cand: String, basis: String) -> It.IntentInput:
  It.IntentRequested{ladvctx_attempt(ctx), ladvctx_common(ctx), target, repo, cand, basis, shared_intent_path(ctx), holder, ""}

# The selected route is matched explicitly at each effect, so an unknown route never selects a
# mutation and a held observer never runs on an unheld input.

# A route the caller states as unknown keeps the publication and qualification it was given and runs no
# holder read and no mutation; the association is the operand the caller passed, as it is for every entry
# point here.
# A stage the attempt could not reach is stated as unperformed, and the stage it did reach keeps its own
# record, error or performed reads. The attempt stops before the mutation and keeps the selected route.
def ld_adv_intent_stopped(intent: It.IntentInput, expected_path: String, step: String, mode: MutationMode, ev: AssociationEvidence, published: IntentPublication, preparation: IntentPreparation, holder_reads: IntentHolderReads) -> LdAdvObs:
  +s = step
  LdAdvNoCapture{AdvIntentRefused{s}, mode, ev, IntentBound{intent, expected_path, published, preparation, holder_reads}}

# The pre-mutation comparison against this attempt's own fixed facts and the selected route.
def ld_adv_intent_accepted(intent: It.IntentInput, expected_path: String, publication: IntentPublication, preparation: IntentPreparation, holder_reads: IntentHolderReads, +reserved: String, name: String, common: String, +repo: String, target: String, +candidate: String, basis: String, +holder: String, +mode: MutationMode) -> Bool:
  +bound = IntentBound{intent, expected_path, publication, preparation, holder_reads}
  intent_bound(bound, reserved, name, common, repo, target, candidate, basis, holder, mode)

# The two mutations, one for each selected route, so the applied path names the effect it runs.
def ld_adv_held_mutation(bound: IntentEvidence, path: String, +assoc: AssociationEvidence, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  do IO<LdAdvObs>:
    obs : LdAdvObs <- ld_adv_wt(path, repo, target, cand, basis, ctx)
    IO.pure(LdAdvObs, ld_adv_keep_intent(ld_adv_keep_association(obs, assoc), bound))

def ld_adv_unheld_mutation(bound: IntentEvidence, +assoc: AssociationEvidence, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  do IO<LdAdvObs>:
    obs : LdAdvObs <- ld_adv_cas_run(repo, target, cand, basis, ctx)
    IO.pure(LdAdvObs, ld_adv_keep_intent(ld_adv_keep_association(obs, assoc), bound))

def ld_adv_intent_applied(+intent: It.IntentInput, +expected_path: String, +admitted_path: String, +published: Pb.IntentPublish, +raw: String, +holder_reads: IntentHolderReads, +ev: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match mode:
    case MutationHeld{path}: ld_adv_held_mutation(IntentBound{intent, expected_path, IntentPublished{published}, IntentQualified{raw, admitted_path}, holder_reads}, path, ev, repo, target, cand, basis, ctx)
    case MutationUnheld{}: ld_adv_unheld_mutation(IntentBound{intent, expected_path, IntentPublished{published}, IntentQualified{raw, admitted_path}, holder_reads}, ev, repo, target, cand, basis, ctx)
    case MutationUnknown{}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "route-unknown", mode, ev, IntentPublished{published}, IntentQualified{raw, admitted_path}, holder_reads))

# The comparison is decided by the caller and matched here as a parameter, so a disagreement stops with
# the retained evidence and runs no capture and no mutation.
def ld_adv_intent_decided(check: Bool, intent: It.IntentInput, expected_path: String, admitted: String, admitted_path: String, published: Pb.IntentPublish, holder_reads: IntentHolderReads, +ev: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match check:
    case True{}: ld_adv_intent_applied(intent, expected_path, admitted_path, published, admitted, holder_reads, ev, mode, repo, target, cand, basis, ctx)
    case False{}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "intent-mismatch", mode, ev, IntentPublished{published}, IntentQualified{admitted, admitted_path}, holder_reads))

# The holder helper's own returned request, record and qualified path continue; the outer operands are
# expectations, not observations. A producer fallback other than an observation keeps its own step,
# record, request and error in the holder field, beside the qualification the verdict admitted. The
# current Intent.observe_holder in intent.bend returns IntentObserved with three GitOut values on every
# path, so the unready, pending and host-failed arms below are total-handler retention for a producer
# that returned them; no law in this module claims they arise from observe_holder.
def ld_adv_intent_observed(observed: It.IntentPrepared, +intent: It.IntentInput, +expected_path: String, +admitted: String, +admitted_path: String, +published: Pb.IntentPublish, +holder: String, +assoc: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match observed:
    case It.IntentObserved{+request, raw: +record, +qualified_path, head, index, status}:
      +reads = IntentHolderRead{head, index, status}
      ld_adv_intent_decided(ld_adv_intent_accepted(request, expected_path, IntentPublished{published}, IntentQualified{record, qualified_path}, reads, ladvctx_reserved(ctx), ladvctx_attempt(ctx), ladvctx_common(ctx), repo, target, cand, basis, holder, mode), request, expected_path, record, qualified_path, published, reads, assoc, mode, repo, target, cand, basis, ctx)
    case It.IntentUnready{step, reason, raw: record}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "holder-unready", mode, assoc, IntentPublished{published}, IntentQualified{admitted, admitted_path}, IntentHolderUnready{step, reason, record}))
    case It.IntentPending{request, raw: record, pending}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "holder-pending", mode, assoc, IntentPublished{published}, IntentQualified{admitted, admitted_path}, IntentHolderPending{request, record, pending}))
    case It.IntentHostFailed{step, request, error}:
      match error:
        case T.HostError{code, detail}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "holder-host-failed", mode, assoc, IntentPublished{published}, IntentQualified{admitted, admitted_path}, IntentHolderFailed{step, request, T.HostError{code, detail}}))

# The holder observation runs only on the selected held route, over the admitted record and path the
# verdict returned rather than the expected operand.
def ld_adv_intent_observed_from(+intent: It.IntentInput, +expected_path: String, +admitted: String, +admitted_path: String, +published: Pb.IntentPublish, +holder: String, +assoc: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  do IO<LdAdvObs>:
    observed : It.IntentPrepared <- It.Intent.observe_holder(intent, admitted, admitted_path)
    ld_adv_intent_observed(observed, intent, expected_path, admitted, admitted_path, published, holder, assoc, mode, repo, target, cand, basis, ctx)

def ld_adv_intent_held(+intent: It.IntentInput, +expected_path: String, +admitted: String, +admitted_path: String, +published: Pb.IntentPublish, +holder: String, +assoc: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match mode:
    case MutationHeld{path}: ld_adv_intent_observed_from(intent, expected_path, admitted, admitted_path, published, holder, assoc, mode, repo, target, cand, basis, ctx)
    case MutationUnheld{}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "route-unknown", mode, assoc, IntentPublished{published}, IntentQualified{admitted, admitted_path}, IntentHolderUnperformed{}))
    case MutationUnknown{}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "route-unknown", mode, assoc, IntentPublished{published}, IntentQualified{admitted, admitted_path}, IntentHolderUnperformed{}))

def ld_adv_intent_unheld(+intent: It.IntentInput, +expected_path: String, +admitted: String, +admitted_path: String, +published: Pb.IntentPublish, +assoc: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx, +holder: String) -> IO(LdAdvObs):
  +reads = IntentHolderUnperformed{}
  ld_adv_intent_decided(ld_adv_intent_accepted(intent, expected_path, IntentPublished{published}, IntentQualified{admitted, admitted_path}, reads, ladvctx_reserved(ctx), ladvctx_attempt(ctx), ladvctx_common(ctx), repo, target, cand, basis, holder, mode), intent, expected_path, admitted, admitted_path, published, reads, assoc, mode, repo, target, cand, basis, ctx)

# The decision the selected route makes over the admitted record and path the verdict returned.
def ld_adv_intent_admitted(+intent: It.IntentInput, +expected_path: String, +admitted: String, +admitted_path: String, +published: Pb.IntentPublish, +assoc: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx, +holder: String) -> IO(LdAdvObs):
  match mode:
    case MutationHeld{path}: ld_adv_intent_held(intent, expected_path, admitted, admitted_path, published, holder, assoc, mode, repo, target, cand, basis, ctx)
    case MutationUnheld{}: ld_adv_intent_unheld(intent, expected_path, admitted, admitted_path, published, assoc, mode, repo, target, cand, basis, ctx, holder)
    case MutationUnknown{}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "route-unknown", mode, assoc, IntentPublished{published}, IntentQualified{admitted, admitted_path}, IntentHolderUnperformed{}))

def ld_adv_intent_verdict(+intent: It.IntentInput, +expected_path: String, +published: Pb.IntentPublish, raw: String, +verdict: It.ReceiptVerdict, +assoc: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx, +holder: String) -> IO(LdAdvObs):
  match verdict:
    case It.VerdictAdmitted{raw: admitted_raw, path: admitted_path}: ld_adv_intent_admitted(intent, expected_path, admitted_raw, admitted_path, published, assoc, mode, repo, target, cand, basis, ctx, holder)
    case It.VerdictPending{raw: pending_raw, path: pending_path, pending}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "qualification-pending", mode, assoc, IntentPublished{published}, IntentQualificationRefused{pending_raw, pending_path, pending, ""}, IntentHolderUnperformed{}))
    case It.VerdictRefused{raw: refused_raw, reason}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "qualification-refused", mode, assoc, IntentPublished{published}, IntentQualificationRefused{refused_raw, expected_path, "", reason}, IntentHolderUnperformed{}))

def ld_adv_intent_qualified(host: Result<&1, &1, U32 & String, String>, +intent: It.IntentInput, +expected_path: String, +published: Pb.IntentPublish, +assoc: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx, +holder: String) -> IO(LdAdvObs):
  match host:
    case Fail{error}:
      match error:
        case (code, detail): IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "qualification-host-failed", mode, assoc, IntentPublished{published}, IntentQualificationFailed{"qualify", T.HostError{code, detail}}, IntentHolderUnperformed{}))
    case Done{+raw}: ld_adv_intent_verdict(intent, expected_path, published, raw, It.receipt_verdict(raw, expected_path), assoc, mode, repo, target, cand, basis, ctx, holder)

def ld_adv_intent_published(+published: Pb.IntentPublish, +intent: It.IntentInput, +expected_path: String, +assoc: AssociationEvidence, +mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx, +holder: String) -> IO(LdAdvObs):
  match published:
    case Pb.IntentBytesPublished{request, raw, path, content}:
      do IO<LdAdvObs>:
        qualified : Result<&1, &1, U32 & String, String> <- Rec.Receipt.qualify(path)
        ld_adv_intent_qualified(qualified, intent, expected_path, published, assoc, mode, repo, target, cand, basis, ctx, holder)
    case Pb.PublishRefused{request, step, name, raw}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "publication-refused", mode, assoc, IntentPublished{published}, IntentUnprepared{}, IntentHolderUnperformed{}))
    case Pb.PublishExistingPending{request, raw, path}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "publication-existing-pending", mode, assoc, IntentPublished{published}, IntentUnprepared{}, IntentHolderUnperformed{}))
    case Pb.PublishContentMismatch{request, raw, expected, found}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "publication-content-mismatch", mode, assoc, IntentPublished{published}, IntentUnprepared{}, IntentHolderUnperformed{}))
    case Pb.PublishReadbackFailed{request, publication, path, error}:
      match error:
        case T.HostError{code, detail}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "publication-readback-failed", mode, assoc, IntentPublished{published}, IntentUnprepared{}, IntentHolderUnperformed{}))
    case Pb.PublishHostFailed{step, request, error}:
      match error:
        case T.HostError{code, detail}: IO.pure(LdAdvObs, ld_adv_intent_stopped(intent, expected_path, "publication-host-failed", mode, assoc, IntentPublished{published}, IntentUnprepared{}, IntentHolderUnperformed{}))

def ld_adv_intent_begin(+ctx: LdAdvCtx, mode: MutationMode, +repo: String, +target: String, +cand: String, +basis: String, +ev: AssociationEvidence) -> IO(LdAdvObs):
  +cx = ctx
  +m = mode
  +holder = mode_holder(m, repo)
  +intent = shared_intent_input(cx, holder, repo, target, cand, basis)
  +content = Lg.intent_content(cand, basis, target)
  +expected = shared_intent_path(cx)
  do IO<LdAdvObs>:
    published : Pb.IntentPublish <- Pb.Intent.publish_intent(intent, ladvctx_reserved(cx), "intent", content)
    ld_adv_intent_published(published, intent, expected, ev, m, repo, target, cand, basis, cx, holder)

def ld_adv_held_compared(check: AssociationCheck, +request: A.AssociationRequest, candidate_oid: String, basis_oid: String, target_head: String, holder_common: String, destination_common: String, reads: A.AssocReads, +path: String, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match check:
    case AssociationDisagreed{step}: IO.pure(LdAdvObs, ld_adv_mismatched(step, request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads, MutationHeld{path}))
    case AssociationAgreed{}:
      +ev = AssociationObserved{"associate", request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}
      ld_adv_intent_begin(ctx, MutationHeld{path}, repo, target, cand, basis, ev)

def ld_adv_unheld_compared(check: AssociationCheck, +request: A.AssociationRequest, candidate_oid: String, basis_oid: String, target_head: String, holder_common: String, destination_common: String, reads: A.AssocReads, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match check:
    case AssociationDisagreed{step}: IO.pure(LdAdvObs, ld_adv_mismatched(step, request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads, MutationUnheld{}))
    case AssociationAgreed{}:
      +ev = AssociationObserved{"associate", request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}
      ld_adv_intent_begin(ctx, MutationUnheld{}, repo, target, cand, basis, ev)

def ld_adv_held_decided(decision: A.Association, +path: String, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match decision:
    case A.AssociationRefused{request, step, observation, reads}: IO.pure(LdAdvObs, ld_adv_unassociated(request, step, observation, reads, MutationHeld{path}))
    case A.AssociationHeld{+request, +candidate_oid, +basis_oid, +target_head, +holder_common, +destination_common, +reads}:
      ld_adv_held_compared(ld_assoc_check(request, candidate_oid, basis_oid, target_head, holder_common, destination_common, path, repo, target, cand, basis, ladvctx_attempt(ctx), ladvctx_common(ctx)), request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads, path, repo, target, cand, basis, ctx)

def ld_adv_unheld_decided(decision: A.Association, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match decision:
    case A.AssociationRefused{request, step, observation, reads}: IO.pure(LdAdvObs, ld_adv_unassociated(request, step, observation, reads, MutationUnheld{}))
    case A.AssociationHeld{+request, +candidate_oid, +basis_oid, +target_head, +holder_common, +destination_common, +reads}:
      ld_adv_unheld_compared(ld_assoc_check(request, candidate_oid, basis_oid, target_head, holder_common, destination_common, repo, repo, target, cand, basis, ladvctx_attempt(ctx), ladvctx_common(ctx)), request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads, repo, target, cand, basis, ctx)

# The association runs once, for the route the holder selection already made, and rides on that
# route's own observation: an unheld target reads its objects and commons from the destination
# repository itself, and a held target reads from the selected worktree. A blocked selection
# runs neither the association nor the mutation.
def ld_adv_associated(hold: LdHold, +repo: String, +target: String, +cand: String, +basis: String, +ctx: LdAdvCtx) -> IO(LdAdvObs):
  match hold:
    case HoldBlocked{detail}: IO.pure(LdAdvObs, ld_adv_wrap(AdvBroken{detail}, MutationUnknown{}))
    case HoldNone{}:
      do IO<LdAdvObs>:
        decision : A.Association <- A.Association.decide(ld_assoc_request(ctx, repo, repo, target, cand, basis))
        ld_adv_unheld_decided(decision, repo, target, cand, basis, ctx)
    case HoldPath{path}:
      +p2 = path
      do IO<LdAdvObs>:
        decision : A.Association <- A.Association.decide(ld_assoc_request(ctx, p2, repo, target, cand, basis))
        ld_adv_held_decided(decision, p2, repo, target, cand, basis, ctx)

def ld_adv_same(same: Bool, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx) -> IO(LdAdvObs):
  match same:
    case False{}: IO.pure(LdAdvObs, ld_adv_wrap(AdvMoved{}, MutationUnknown{}))
    case True{}:
      +r2 = repo
      +t2 = target
      do IO<LdAdvObs>:
        gl : T.GitOut <- Git.runGit(r2, ["worktree", "list", "--porcelain"])
        ld_adv_associated(ld_hold_read(gl, t2), r2, t2, cand, basis, ctx)
# The holder is read only for a target that still reads as the basis, so a
# moved target answers the movement before any worktree is touched.
def ld_adv_pick(g: T.GitOut, repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx) -> IO(LdAdvObs):
  match g:
    case T.GRun{code, out}:
      +b2 = basis
      Bool.pick(IO(LdAdvObs), U32.is_eq(code, 0),
        ld_adv_same(Tx.str_eq(Tx.trim_nl(out), b2), repo, target, cand, b2, ctx),
        IO.pure(LdAdvObs, ld_adv_wrap(AdvBroken{"the target commit could not be read before publication"}, MutationUnknown{})))
    case T.GBroken{detail}: IO.pure(LdAdvObs, ld_adv_wrap(AdvBroken{detail}, MutationUnknown{}))
def ld_adv_run(repo: String, target: String, cand: String, basis: String, ctx: LdAdvCtx) -> IO(LdAdvObs):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  +cx = ctx
  do IO<LdAdvObs>:
    g : T.GitOut <- Git.runGit(r2, ld_tip_argv(t2))
    ld_adv_pick(g, r2, t2, c2, b2, cx)
# Admission runs the advance for the reserved directory and releases, carrying the guard and
# the reserved path forward for the capture sites.

# The complete attempt evidence is published once, after the release, and admitted only when the
# record was freshly created, is durable, and reads back byte for byte.
# The producer contract, mirrored from receipt.c's receipt_record: a successful record is the tag, the
# expected path, a zero errno, an empty phase, a zero pending and an empty detail.
def receipt_published(raw: String, expected: String) -> Bool:
  Tx.str_eq(raw, Pb.production_record("published", expected, "0"))

def receipt_qualified(raw: String, expected: String) -> Bool:
  Tx.str_eq(raw, Pb.production_record("qualified", expected, "0"))

def landing_record_path(reserved: String) -> String:
  Tx.str_cat(reserved, "/landing-record")

def stage_publishes(stage: StageResult, expected: String) -> Bool:
  match stage:
    case StageSucceeded{raw}: receipt_published(raw, expected)
    case StageFailed{code, detail}: False{}
    case StageUnperformed{}: False{}

def stage_qualifies(stage: StageResult, expected: String) -> Bool:
  match stage:
    case StageSucceeded{raw}: receipt_qualified(raw, expected)
    case StageFailed{code, detail}: False{}
    case StageUnperformed{}: False{}

def ld_attest_readback_seen(reserved: String, evidence: AttemptEvidence, publication: StageResult, qualification: StageResult, seen: Result<&1, &1, U32 & String, String>) -> IO(Attestation):
  IO.pure(Attestation, Attestation{reserved, evidence, publication, qualification, attest_stage(seen)})

def ld_attest_readback(+reserved: String, evidence: AttemptEvidence, publication: StageResult, qualification: StageResult) -> IO(Attestation):
  +p = landing_record_path(reserved)
  do IO<Attestation>:
    seen : Result<&1, &1, U32 & String, String> <- Text.Text.read(p)
    ld_attest_readback_seen(reserved, evidence, publication, qualification, seen)

def ld_attest_qualification_seen(+reserved: String, +evidence: AttemptEvidence, +publication: StageResult, +qualification: StageResult) -> IO(Attestation):
  Bool.pick(IO(Attestation), stage_qualifies(qualification, landing_record_path(reserved)),
    ld_attest_readback(reserved, evidence, publication, qualification),
    IO.pure(Attestation, Attestation{reserved, evidence, publication, qualification, StageUnperformed{}}))

def ld_attest_qualification(+reserved: String, evidence: AttemptEvidence, publication: StageResult) -> IO(Attestation):
  +p = landing_record_path(reserved)
  do IO<Attestation>:
    qualified : Result<&1, &1, U32 & String, String> <- Rec.Receipt.qualify(p)
    ld_attest_qualification_seen(reserved, evidence, publication, attest_stage(qualified))
def ld_attest_publication_seen(+reserved: String, +evidence: AttemptEvidence, +publication: StageResult) -> IO(Attestation):
  Bool.pick(IO(Attestation), stage_publishes(publication, landing_record_path(reserved)),
    ld_attest_qualification(reserved, evidence, publication),
    IO.pure(Attestation, Attestation{reserved, evidence, publication, StageUnperformed{}, StageUnperformed{}}))

def ld_attest(+reserved: String, +evidence: AttemptEvidence) -> IO(Attestation):
  do IO<Attestation>:
    published : Result<&1, &1, U32 & String, String> <- Rec.Receipt.publish(reserved, "landing-record", attempt_record(evidence))
    ld_attest_publication_seen(reserved, evidence, attest_stage(published))

# Admission is a decision over the whole attestation, not a bare token: the immutable identity,
# association and intent evidence must be present and observed, the capture must be real, the release
# must have succeeded, and all three stages must carry the exact expected bytes.

def evidence_reserved(evidence: AttemptEvidence) -> String:
  match evidence:
    case AttemptEvidence{reserved, repo, target, candidate, basis, guard, artifact, decision, capture, qualification, release, identity, association, intent, reservation}: reserved

def evidence_target(evidence: AttemptEvidence) -> String:
  match evidence:
    case AttemptEvidence{reserved, repo, target, candidate, basis, guard, artifact, decision, capture, qualification, release, identity, association, intent, reservation}: target

def evidence_candidate(evidence: AttemptEvidence) -> String:
  match evidence:
    case AttemptEvidence{reserved, repo, target, candidate, basis, guard, artifact, decision, capture, qualification, release, identity, association, intent, reservation}: candidate

def evidence_release(evidence: AttemptEvidence) -> T.ReleaseRaw:
  match evidence:
    case AttemptEvidence{reserved, repo, target, candidate, basis, guard, artifact, decision, capture, qualification, release, identity, association, intent, reservation}: release

def evidence_identity(evidence: AttemptEvidence) -> IdentityEvidence:
  match evidence:
    case AttemptEvidence{reserved, repo, target, candidate, basis, guard, artifact, decision, capture, qualification, release, identity, association, intent, reservation}: identity

def evidence_decision(evidence: AttemptEvidence) -> LAdv:
  match evidence:
    case AttemptEvidence{reserved, repo, target, candidate, basis, guard, artifact, decision, capture, qualification, release, identity, association, intent, reservation}: decision

def attestation_evidence(attestation: Attestation) -> AttemptEvidence:
  match attestation:
    case Attestation{reserved, evidence, publication, qualification, readback}: evidence

def reserved_matches(expect: String, evidence: AttemptEvidence) -> Bool:
  match evidence:
    case AttemptEvidence{reserved, repo, target, candidate, basis, guard, artifact, decision, capture, qualification, release, identity, association, intent, reservation}:
      Tx.str_eq(reserved, expect)

def attestation_bound(attestation: Attestation, target: String, candidate: String) -> Bool:
  match attestation:
    case Attestation{reserved, +evidence, publication, qualification, readback}:
      Bool.pick(Bool, reserved_matches(reserved, evidence),
        Bool.pick(Bool, Tx.str_eq(evidence_target(evidence), target),
          Tx.str_eq(evidence_candidate(evidence), candidate), False{}),
        False{})

def readback_matches(readback: StageResult, evidence: AttemptEvidence) -> Bool:
  match readback:
    case StageSucceeded{raw}: Tx.str_eq(raw, attempt_record(evidence))
    case StageFailed{code, detail}: False{}
    case StageUnperformed{}: False{}

def capture_observed(capture: T.CapturedRaw) -> Bool:
  match capture:
    case T.CapturedAbsent{}: False{}
    case T.CapturedFailed{code, detail}: True{}
    case T.CapturedDone{framing, diagnostics}: True{}

def identity_observed(identity: IdentityEvidence) -> Bool:
  match identity:
    case IdentityMissing{}: False{}
    case IdentityObserved{common, observed, target}: True{}

def association_observed(association: AssociationEvidence) -> Bool:
  match association:
    case AssociationMissing{}: False{}
    case AssociationRefused{request, step, observation, reads}: False{}
    case AssociationObserved{step, request, candidate_oid, basis_oid, target_head, holder_common, destination_common, reads}: True{}

def intent_observed(intent: IntentEvidence) -> Bool:
  match intent:
    case IntentMissing{}: False{}
    case IntentObserved{path, raw}: True{}
    case IntentBound{request, expected_path, publication, preparation, holder}: True{}

def decision_landed(decision: LAdv) -> Bool:
  match decision:
    case AdvLanded{}: True{}
    case AdvMoved{}: False{}
    case AdvHeld{path}: False{}
    case AdvHolderChanged{path}: False{}
    case AdvUnassociated{step}: False{}
    case AdvIntentRefused{step}: False{}
    case AdvRefused{}: False{}
    case AdvBroken{detail}: False{}

def mutation_succeeded(framing: String) -> Bool:
  observation_succeeded(ld_adv_framed(framing))

def capture_landed(capture: T.CapturedRaw) -> Bool:
  match capture:
    case T.CapturedDone{framing, diagnostics}: mutation_succeeded(framing)
    case T.CapturedAbsent{}: False{}
    case T.CapturedFailed{code, detail}: False{}
def read_observed(read: LdRead) -> Bool:
  match read:
    case ReadObserved{observation}: observation_succeeded(observation)
    case ReadSkipped{}: False{}

def read_value(read: LdRead) -> String:
  match read:
    case ReadObserved{observation}: observation_value(observation)
    case ReadSkipped{}: ""

def read_absent(read: LdRead) -> Bool:
  match read:
    case ReadSkipped{}: True{}
    case ReadObserved{observation}: False{}

def mode_head_ok(mode: MutationMode, +head_ref: LdRead, target: String) -> Bool:
  match mode:
    case MutationUnheld{}: read_absent(head_ref)
    case MutationHeld{path}: Bool.pick(Bool, read_observed(head_ref), Tx.str_eq(read_value(head_ref), ld_hold_ref(target)), False{})
    case MutationUnknown{}: False{}

def qualification_landed(mode: MutationMode, +target_ref: LdRead, head_ref: LdRead, candidate: String, target: String) -> Bool:
  Bool.pick(Bool, read_observed(target_ref),
    Bool.pick(Bool, Tx.str_eq(read_value(target_ref), candidate), mode_head_ok(mode, head_ref, target), False{}),
    False{})

def qualification_landed_of(qualification: LdQualified, candidate: String, target: String) -> Bool:
  match qualification:
    case QualDecided{mode, target_ref, head_ref}: qualification_landed(mode, target_ref, head_ref, candidate, target)
def identity_bound(identity: IdentityEvidence, expect: String) -> Bool:
  match identity:
    case IdentityObserved{common, +observed, target}:
      Bool.pick(Bool, Tx.str_eq(target, expect), Bool.pick(Bool, observation_succeeded(observed), Tx.str_eq(observation_value(observed), common), False{}), False{})
    case IdentityMissing{}: False{}

# The held association is admitted only when its resolved candidate and basis are the attempt's
# own immutable operands, its two common directories agree with each other, and that common is
# the canonical common the claim answered. The holder path and the reservation are bound by the
# route that selected them and by the reserved attempt the request carried.
def association_read_ok(read: A.AssocRead) -> Bool:
  match read:
    case A.AssocReadPerformed{observation}: observation_succeeded(observation)
    case A.AssocReadSkipped{}: False{}

# The target read is the one position the chain may find absent: exit one is a performed read whose
# bytes are retained, so an absent target is not confused with a read that never ran.
# The ancestor read follows the target's own contract: code zero is a present target whose
# ancestor was checked, code one is an absent target whose ancestor was not, and any other code or
# a broken read fails the contract rather than being read as absence.
def association_ancestor_bound(target: A.AssocRead, +ancestor: A.AssocRead) -> Bool:
  match target:
    case A.AssocReadPerformed{observation}:
      match observation:
        case T.GRun{+code, out}: Bool.pick(Bool, U32.is_eq(code, 0), association_read_ok(ancestor), Bool.pick(Bool, U32.is_eq(code, 1), A.read_skipped(ancestor), False{}))
        case T.GBroken{detail}: False{}
    case A.AssocReadSkipped{}: False{}

def association_target_read_ok(read: A.AssocRead) -> Bool:
  match read:
    case A.AssocReadPerformed{observation}:
      match observation:
        case T.GRun{+code, out}: Bool.pick(Bool, U32.is_eq(code, 0), True{}, Bool.pick(Bool, U32.is_eq(code, 1), True{}, False{}))
        case T.GBroken{detail}: False{}
    case A.AssocReadSkipped{}: False{}

# A performed read must answer the value the decision reported. A skipped position answers nothing
# and is refused here, so no fabricated observation is ever compared or retained.
def read_answers(read: A.AssocRead, expect: String) -> Bool:
  match read:
    case A.AssocReadPerformed{observation}: Tx.str_eq(A.oid_of(observation), expect)
    case A.AssocReadSkipped{}: False{}

# The values the decision reported must be the values the reads it retained actually answered, read
# position by position, and a present target must have a performed successful ancestor read while an
# absent target must not.
def association_reads_bound(reads: A.AssocReads, candidate_oid: String, basis_oid: String, target_head: String, holder_common: String, destination_common: String) -> Bool:
  +seen = reads
  +cand_oid = candidate_oid
  +base_oid = basis_oid
  Bool.pick(Bool, association_read_ok(A.reads_candidate_of(seen)),
    Bool.pick(Bool, association_read_ok(A.reads_basis_of(seen)),
      Bool.pick(Bool, association_read_ok(A.reads_holder_of(seen)),
        Bool.pick(Bool, association_read_ok(A.reads_destination_of(seen)),
          Bool.pick(Bool, association_target_read_ok(A.reads_target_of(seen)),
            Bool.pick(Bool, association_ancestor_bound(A.reads_target_of(seen), A.reads_ancestor_of(seen)),
              Bool.pick(Bool, read_answers(A.reads_candidate_of(seen), cand_oid),
                Bool.pick(Bool, read_answers(A.reads_basis_of(seen), base_oid),
                  Bool.pick(Bool, A.oid_ok(cand_oid),
                    Bool.pick(Bool, A.oid_ok(base_oid),
                      Bool.pick(Bool, read_answers(A.reads_target_of(seen), target_head),
                        Bool.pick(Bool, read_answers(A.reads_holder_of(seen), holder_common),
                          read_answers(A.reads_destination_of(seen), destination_common),
                          False{}), False{}), False{}), False{}), False{}), False{}), False{}), False{}), False{}), False{}), False{}), False{})

def qualification_mode(qualification: LdQualified) -> MutationMode:
  match qualification:
    case QualDecided{mode, target_ref, head_ref}: mode

def identity_common(identity: IdentityEvidence) -> String:
  match identity:
    case IdentityObserved{common, +observed, target}: common
    case IdentityMissing{}: ""

# The retained association is admitted only when its step is the accepted one, when the selected
# route is a real one, when the request it kept agrees with the attempt's fixed operands, that
# route, the destination repository and the canonical common, when the values the association
# returned agree with that same request, and when the requested attempt is the name of the
# reservation the evidence retained independently of its path.
def association_bound(association: AssociationEvidence, +candidate: String, +basis: String, +common: String, +repo: String, +target: String, +qualification: LdQualified, +reserved: String, +reservation: ReservationIdentity) -> Bool:
  match association:
    case AssociationObserved{step, +request, +candidate_oid, +basis_oid, +target_head, +holder_common, +destination_common, +reads}:
      Bool.pick(Bool, association_step_accepted(step),
        Bool.pick(Bool, mode_selected(qualification_mode(qualification)),
          Bool.pick(Bool, reservation_bound(reserved, reservation, common),
            Bool.pick(Bool, association_reads_bound(reads, candidate_oid, basis_oid, target_head, holder_common, destination_common),
              association_agreed(ld_assoc_check(request, candidate_oid, basis_oid, target_head, holder_common, destination_common, mode_holder(qualification_mode(qualification), repo), repo, target, candidate, basis, reservation_name(reservation), common)),
              False{}),
            False{}),
          False{}),
        False{})
    case AssociationMissing{}: False{}
    case AssociationRefused{request, step, observation, reads}: False{}

# The artifact destination the capture wrote to. The chain derives it from the reservation as
# shared_parent_path(reserved, "stderr") and hands the same value to the capture, so admission compares the
# stored derivation against the reservation the evidence carries.
#
# The guard is the result Receipt.guard_path returned for this common and target. The claim path carries
# that result into shared_reserved_continue's context and into the evidence, so the stored guard is the
# supplied result; admission states no second host read for it.
# The guard the producer names for this canonical common and target, from the pure rule Tx.expected_guard_path
# spells after receipt.c. A naming the rule refuses leaves the guard unbound.
def guard_bound(guard: String, common: String, target: String) -> Bool:
  Tx.guard_matches(Tx.expected_guard_path(common, target), guard)

def artifact_bound(artifact: String, +reserved: String) -> Bool:
  Tx.str_eq(artifact, shared_parent_path(reserved, "stderr"))

def evidence_complete(evidence: AttemptEvidence) -> Bool:
  match evidence:
    case AttemptEvidence{+reserved, +repo, +target, +candidate, +basis, +guard, +artifact, decision, capture, +qualification, release, +identity, association, intent, +reservation}:
      Bool.pick(Bool, decision_landed(decision),
        Bool.pick(Bool, capture_landed(capture),
          Bool.pick(Bool, qualification_landed_of(qualification, candidate, target),
            Bool.pick(Bool, T.release_done(release),
              Bool.pick(Bool, identity_bound(identity, target),
                Bool.pick(Bool, association_bound(association, candidate, basis, identity_common(identity), repo, target, qualification, reserved, reservation),
                  Bool.pick(Bool, intent_bound(intent, reserved, reservation_name(reservation), identity_common(identity), repo, target, candidate, basis, mode_holder(qualification_mode(qualification), repo), qualification_mode(qualification)), Bool.pick(Bool, artifact_bound(artifact, reserved), Bool.pick(Bool, guard_bound(guard, identity_common(identity), target), True{}, False{}), False{}), False{}),
                  False{}),
                False{}),
              False{}),
            False{}),
          False{}),
        False{})

def admission_stages(+attestation: Attestation) -> Admission:
  match attestation:
    case Attestation{reserved, evidence, publication, qualification, readback}:
      Bool.pick(Admission, stage_publishes(publication, landing_record_path(reserved)),
        Bool.pick(Admission, stage_qualifies(qualification, landing_record_path(reserved)),
          Bool.pick(Admission, readback_matches(readback, evidence),
            Bool.pick(Admission, evidence_complete(evidence),
              AdmissionAdmitted{attestation},
              AdmissionRefused{attestation, "the attempt evidence is incomplete"}),
            AdmissionRefused{attestation, "the attempt record does not read back as published"}),
          AdmissionRefused{attestation, "the attempt record is not durable"}),
        AdmissionRefused{attestation, "the attempt record was not published"})

def admission_reserved(+attestation: Attestation, +reserved: String, +evidence: AttemptEvidence) -> Admission:
  Bool.pick(Admission, reserved_matches(reserved, evidence),
    admission_stages(attestation),
    AdmissionRefused{attestation, "the receipt does not name this attempt"})

def admission_of(+attestation: Attestation) -> Admission:
  match attestation:
    case Attestation{reserved, evidence, publication, qualification, readback}:
      admission_reserved(attestation, reserved, evidence)
def ld_attest_admit(+evidence: AttemptEvidence) -> IO(SharedLanding):
  do IO<SharedLanding>:
    attestation : Attestation <- ld_attest(evidence_reserved(evidence), evidence)
    IO.pure(SharedLanding, SharedAdvanced{attestation})

# Read the exact target ref after the held fast-forward and require its tip to
# remain the source candidate before checking which branch the holder has now.
def ld_adv_of(obs: LdAdvObs) -> LAdv:
  match obs:
    case LdAdvNoCapture{advance, mode, association, intent}: advance
    case LdAdvCaptured{advance, capture, mode, association, intent}: advance
    case LdAdvQualified{advance, capture, qualification, association, intent}: advance

def shared_reserved_attested(repo: String, +target: String, cand: String, basis: String, +guard: String, +common: String, +common_observed: T.GitOut, +reserved: String, +reservation: ReservationIdentity, +obs: LdAdvObs, released: Result<&1, &1, U32 & String, Unit>) -> IO(SharedLanding):
  +rel = T.release_raw_of(released)
  ld_attest_admit(AttemptEvidence{reserved, repo, target, cand, basis, guard, shared_parent_path(reserved, "stderr"), ld_adv_of(obs), ld_adv_capture(obs), ld_adv_qualification(obs), rel, IdentityObserved{common, common_observed, target}, ld_adv_association(obs), ld_adv_intent(obs), reservation})

# The landing path and the shared path name the same attempt directory: the landing chain derives it as
# attempt_directory_for(common, attempt), and the shared reservation is that same common, the attempts parent
# and the attempt name. Stating the agreement is what binds the two paths' artifact destinations.
law the_landing_attempt_directory_is_the_shared_reservation_path:
  for common: String
  for attempt: String
  {Lg.attempt_directory_for(common, attempt) == shared_parent_path(shared_attempts_parent(common), attempt) : String}

def the_landing_attempt_directory_is_the_shared_reservation_path(common,attempt):
  {==}

# The artifact destination the landing chain hands the guarded capture is the same destination the shared
# evidence carries: both are the reservation's stderr path.
law the_landing_artifact_is_the_shared_reservation_derived_artifact:
  for common: String
  for attempt: String
  {Lg.attempt_artifact_for(common, attempt) == shared_parent_path(shared_parent_path(shared_attempts_parent(common), attempt), "stderr") : String}

def the_landing_artifact_is_the_shared_reservation_derived_artifact(common,attempt):
  {==}

# A host capture that failed carries its own code and detail into the captured observation and the broken
# advance, with the mode and the empty association and intent slots spelled literally.
law a_failed_capture_reports_its_own_code_and_detail:
  {ld_adv_cas_capture("tgt", "0123456789abcdef0123456789abcdef01234567", "/repo", Fail{(13, "capture failed")}) == IO.pure(LdAdvObs, LdAdvCaptured{AdvBroken{"capture failed"}, T.CapturedFailed{13, "capture failed"}, MutationUnheld{}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_failed_capture_reports_its_own_code_and_detail():
  {==}

# A successful host capture still runs the real target read: the equation states the Git call, binds its
# return to the existing read-back handler, and leaves that handler's own outcomes to the laws above.
law a_successful_capture_runs_the_target_read_and_continues_to_the_read_back:
  {ld_adv_cas_capture("tgt", "0123456789abcdef0123456789abcdef01234567", "/repo", Done{("exit 0\nrest", "diagnostics")}) == (do IO<LdAdvObs>:
    after : T.GitOut <- Git.runGit("/repo", ld_target_ref_argv("tgt"))
    ld_adv_cas_readback("tgt", "0123456789abcdef0123456789abcdef01234567", T.CapturedDone{"exit 0\nrest", "diagnostics"}, after)) : IO(LdAdvObs)}

def a_successful_capture_runs_the_target_read_and_continues_to_the_read_back():
  {==}

law a_successful_unheld_capture_reads_back_the_advanced_candidate:
  {ld_adv_cas_readback("tgt", "0123456789abcdef0123456789abcdef01234567", T.CapturedDone{"exit 0\nrest", "diagnostics"}, T.GRun{0, Tx.str_cat("0123456789abcdef0123456789abcdef01234567", "\n")}) == IO.pure(LdAdvObs, LdAdvQualified{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, QualDecided{MutationUnheld{}, ReadObserved{T.GRun{0, Tx.str_cat("0123456789abcdef0123456789abcdef01234567", "\n")}}, ReadSkipped{}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_successful_unheld_capture_reads_back_the_advanced_candidate():
  {==}

law a_unheld_capture_whose_target_moved_reports_moved:
  {ld_adv_cas_readback("tgt", "0123456789abcdef0123456789abcdef01234567", T.CapturedDone{"exit 0\nrest", "diagnostics"}, T.GRun{0, "other\n"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvMoved{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, QualDecided{MutationUnheld{}, ReadObserved{T.GRun{0, "other\n"}}, ReadSkipped{}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_unheld_capture_whose_target_moved_reports_moved():
  {==}

law an_unheld_capture_whose_read_back_fails_is_broken:
  {ld_adv_cas_readback("tgt", "0123456789abcdef0123456789abcdef01234567", T.CapturedDone{"exit 0\nrest", "diagnostics"}, T.GRun{7, "readback failed\n"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvBroken{"the target could not be read back after the advance"}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, QualDecided{MutationUnheld{}, ReadObserved{T.GRun{7, "readback failed\n"}}, ReadSkipped{}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def an_unheld_capture_whose_read_back_fails_is_broken():
  {==}

# The unheld capture call: the context's claim, guard and reservation-derived artifact are exactly the
# operands capture_holding receives, together with the update-ref argv and the repository as its cwd, and
# the returned host result is consumed once by the capture continuation.
law the_unheld_capture_receives_the_reservation_derived_guard_and_artifact:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for handle: U32
  for guard: String
  for attempt: String
  for common: String
  for reserved: String
  {ld_adv_cas_run(repo, target, cand, basis, LdAdvContext{handle, guard, shared_parent_path(reserved, "stderr"), attempt, common, reserved}) == (do IO<LdAdvObs>:
    captured : Result<&1,&1,U32 & String,String & String> <- Git.Process.capture_holding(Tx.enc_argv(Con{"git", ld_update_argv(target, cand, basis)}), repo, handle, guard, shared_parent_path(reserved, "stderr"))
    ld_adv_cas_capture(target, cand, repo, captured)) : IO(LdAdvObs)}

def the_unheld_capture_receives_the_reservation_derived_guard_and_artifact(repo,target,cand,basis,handle,guard,attempt,common,reserved):
  {==}

# The held capture call on the admitted head arm: the same context operands reach capture_holding, with the
# fast-forward argv and the selected worktree as its cwd, and the returned result is consumed once.
law the_held_capture_receives_the_reservation_derived_guard_and_artifact:
  for path: String
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for handle: U32
  for guard: String
  for attempt: String
  for common: String
  for reserved: String
  {ld_adv_wt_head_same(True{}, path, repo, target, cand, basis, LdAdvContext{handle, guard, shared_parent_path(reserved, "stderr"), attempt, common, reserved}) == (do IO<LdAdvObs>:
    captured : Result<&1,&1,U32 & String,String & String> <- Git.Process.capture_holding(Tx.enc_argv(Con{"git", Con{"merge", Con{"--ff-only", Con{cand, Nil{}}}}}), path, handle, guard, shared_parent_path(reserved, "stderr"))
    ld_adv_wt_capture(path, repo, target, cand, basis, LdAdvContext{handle, guard, shared_parent_path(reserved, "stderr"), attempt, common, reserved}, captured)) : IO(LdAdvObs)}

def the_held_capture_receives_the_reservation_derived_guard_and_artifact(path,repo,target,cand,basis,handle,guard,attempt,common,reserved):
  {==}

# The reserved continuation receives an existing claim handle and performs no claim of its own: the
# one-claim property belongs to the entry path that produced the handle. It hands the capture the context
# whose guard is that claim's guard and whose artifact is the reservation's stderr path, then releases the
# claim, then attests the observation it ran. The mutation, the release and the attestation are the real
# calls, in that order, and ld_adv_run may refuse before any mutation, so this equation does not assert
# that every invocation mutates.
def shared_reserved_continue(handle: U32, repo: String, target: String, cand: String, basis: String, guard: String, common: String, common_observed: T.GitOut, reserved: String, attempt_name: String, attempt_parent: String) -> IO(SharedLanding):
  +h = handle
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  +gd = guard
  +cm = common
  +cobs = common_observed
  +rv = reserved
  +an = attempt_name
  +ap = attempt_parent
  +cx = LdAdvContext{h, gd, shared_parent_path(rv, "stderr"), an, cm, rv}
  +idn = ReservationObserved{ap, an}
  do IO<SharedLanding>:
    o : LdAdvObs <- ld_adv_run(rp, tg, c, b, cx)
    released : Result<&1, &1, U32 & String, Unit> <- Rec.Receipt.release(h)
    shared_reserved_attested(rp, tg, c, b, gd, cm, cobs, rv, idn, o, released)

law the_reserved_continuation_runs_the_selected_route_and_releases_before_attesting:
  for handle: U32
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for guard: String
  for common: String
  for common_observed: T.GitOut
  for reserved: String
  for attempt_name: String
  for attempt_parent: String
  {shared_reserved_continue(handle, repo, target, cand, basis, guard, common, common_observed, reserved, attempt_name, attempt_parent) == (do IO<SharedLanding>:
    o : LdAdvObs <- ld_adv_run(repo, target, cand, basis, LdAdvContext{handle, guard, shared_parent_path(reserved, "stderr"), attempt_name, common, reserved})
    released : Result<&1, &1, U32 & String, Unit> <- Rec.Receipt.release(handle)
    shared_reserved_attested(repo, target, cand, basis, guard, common, common_observed, reserved, ReservationObserved{attempt_parent, attempt_name}, o, released)) : IO(SharedLanding)}

def the_reserved_continuation_runs_the_selected_route_and_releases_before_attesting(handle,repo,target,cand,basis,guard,common,common_observed,reserved,attempt_name,attempt_parent):
  {==}

# The next attempt name after a collision. The continuation is a suffix on the name, so the name keeps
# growing and no counter can wrap.
def shared_attempt_next_name(name: String) -> String:
  +n = name
  Tx.str_cat(n, "-")
# One self-recursive reservation body: the returned Result, the exact created/existing records and
# the retry branching. The retry's next read is inlined below, so this def is whole and no def is
# used before it is defined; only nonrecursive helpers produce final outcomes.
def shared_reserve_observed(+handle: U32, +repo: String, +target: String, +cand: String, +basis: String, +guard: String, +common: String, +common_observed: T.GitOut, +parent: String, +name: String, observed: Result<&1, &1, U32 & String, String>) -> IO(SharedLanding):
  match observed:
    case Fail{error}: shared_step_failed("reserve", error, handle)
    case Done{+record}:
      +created_ok = Tx.str_eq(record, Pb.production_record("created", shared_parent_path(parent, name), "0"))
      +existing_ok = Tx.str_eq(record, Pb.production_record("existing", shared_parent_path(parent, name), "0"))
      Bool.pick(IO(SharedLanding), created_ok,
        shared_reserved_continue(handle, repo, target, cand, basis, guard, common, common_observed, shared_parent_path(parent, name), name, parent),
        Bool.pick(IO(SharedLanding), existing_ok,
          do IO<SharedLanding>:
              retry : Result<&1, &1, U32 & String, String> <- Rec.Receipt.reserve_attempt(parent, shared_attempt_next_name(name))
              shared_reserve_observed(handle, repo, target, cand, basis, guard, common, common_observed, parent, shared_attempt_next_name(name), retry),
          shared_record_failed("reserve", record, handle)))

# The reservation's first read: the attempt name is bound here and the answer is classified by
# shared_reserve_observed, which owns the created/existing records and the retry.
def shared_reserve_loop(handle: U32, repo: String, target: String, cand: String, basis: String, guard: String, common: String, common_observed: T.GitOut, parent: String, base: String) -> IO(SharedLanding):
  +h = handle
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  +gd = guard
  +cm = common
  +cobs = common_observed
  +pa = parent
  +bs = base
  +name = bs
  do IO<SharedLanding>:
    observed : Result<&1, &1, U32 & String, String> <- Rec.Receipt.reserve_attempt(pa, name)
    shared_reserve_observed(h, rp, tg, c, b, gd, cm, cobs, pa, name, observed)

def shared_parent_present(handle: U32, repo: String, target: String, cand: String, basis: String, guard: String, +common: String, +common_observed: T.GitOut, parent: String, base: String, record: String) -> IO(SharedLanding):
  +h = handle
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  +gd = guard
  +cm = common
  +obs = common_observed
  +pa = parent
  +bs = base
  +r = record
  Bool.pick(IO(SharedLanding), Tx.str_eq(r, Pb.production_record("present", pa, "0")),
    shared_reserve_loop(h, rp, tg, c, b, gd, cm, obs, pa, bs),
    shared_record_failed("ensure", r, h))
def shared_parent_classified(handle: U32, repo: String, target: String, cand: String, basis: String, guard: String, +common: String, +common_observed: T.GitOut, parent: String, base: String, record: String) -> IO(SharedLanding):
  +h = handle
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  +gd = guard
  +cm = common
  +obs = common_observed
  +pa = parent
  +bs = base
  +r = record
  Bool.pick(IO(SharedLanding), Tx.str_eq(r, Pb.production_record("created", pa, "0")),
    shared_reserve_loop(h, rp, tg, c, b, gd, cm, obs, pa, bs),
    shared_parent_present(h, rp, tg, c, b, gd, cm, obs, pa, bs, r))
def shared_parent_ensured(+handle: U32, repo: String, target: String, cand: String, basis: String, guard: String, common: String, common_observed: T.GitOut, parent: String, base: String, observed: Result<&1, &1, U32 & String, String>) -> IO(SharedLanding):
  match observed:
    case Fail{error}: shared_step_failed("ensure", error, handle)
    case Done{+record}: shared_parent_classified(handle, repo, target, cand, basis, guard, common, common_observed, parent, base, record)

def shared_token_named(+handle: U32, repo: String, target: String, +cand: String, +basis: String, +common: String, common_observed: T.GitOut, guard: String, observed: Result<&1, &1, U32 & String, String>) -> IO(SharedLanding):
  match observed:
    case Fail{error}: shared_step_failed("token", error, handle)
    case Done{token}:
      +parent = shared_attempts_parent(common)
      +base = Tx.str_cat(token, Tx.str_cat("-", Tx.str_cat(cand, Tx.str_cat("-", basis))))
      do IO<SharedLanding>:
        ensured : Result<&1, &1, U32 & String, String> <- Rec.Receipt.ensure(parent)
        shared_parent_ensured(handle, repo, target, cand, basis, guard, common, common_observed, parent, base, ensured)

# The guard is the path Rec.Receipt.guard_path returned for this common and target. That call reports
# naming data, and holding is established by the live claim and by the capture check. Rec.Receipt.claim
# computes the same naming algorithm internally and answers with a handle. The claim path carries the
# returned path into shared_reserved_continue's context, into the capture call and into the evidence, and a
# guard-path failure stops the chain with SharedStepFailed{"guard", ...} before any evidence exists. The
# artifact destination is checked against the reservation at admission; binding the guard string itself
# needs the naming algorithm, which receipt.c holds behind Receipt.guard_path.
def shared_guard_named(+handle: U32, repo: String, +target: String, cand: String, basis: String, common: String, common_observed: T.GitOut, observed: Result<&1, &1, U32 & String, String>) -> IO(SharedLanding):
  match observed:
    case Fail{error}: shared_step_failed("guard", error, handle)
    case Done{guard}:
      do IO<SharedLanding>:
        token : Result<&1, &1, U32 & String, String> <- Rec.Receipt.attempt_token(target)
        shared_token_named(handle, repo, target, cand, basis, common, common_observed, guard, token)

def shared_guarded(handle: U32, repo: String, target: String, cand: String, basis: String, common: String, common_observed: T.GitOut) -> IO(SharedLanding):
  +h = handle
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  +cm = common
  do IO<SharedLanding>:
    observed : Result<&1, &1, U32 & String, String> <- Rec.Receipt.guard_path(cm, tg)
    shared_guard_named(h, rp, tg, c, b, cm, common_observed, observed)

def shared_claim_decided(repo: String, +target: String, cand: String, basis: String, common: String, common_observed: T.GitOut, claim_outcome: Result<&1, &1, U32 & String, Maybe<U32>>) -> IO(SharedLanding):
  match claim_outcome:
    case Fail{error}: IO.pure(SharedLanding, SharedClaimFailed{shared_error(error)})
    case Done{held}:
      match held:
        case None{}: IO.pure(SharedLanding, SharedGuardBusy{target})
        case Some{handle}: shared_guarded(handle, repo, target, cand, basis, common, common_observed)

def shared_claimed(repo: String, target: String, cand: String, basis: String, common: String, common_observed: T.GitOut) -> IO(SharedLanding):
  +rp = repo
  +tg = target
  +c = cand
  +b = basis
  +cm = common
  do IO<SharedLanding>:
    claimed : Result<&1, &1, U32 & String, Maybe<U32>> <- Rec.Receipt.claim(cm, tg)
    shared_claim_decided(rp, tg, c, b, cm, common_observed, claimed)

def shared_common_read(repo: String, target: String, cand: String, basis: String, +observed: T.GitOut) -> IO(SharedLanding):
  match observed:
    case T.GRun{code, out}:
      +c0 = code
      Bool.pick(IO(SharedLanding), U32.is_eq(c0, 0),
        shared_claimed(repo, target, cand, basis, Tx.trim_nl(out), observed),
        IO.pure(SharedLanding, SharedCommonUnreadable{observed}))
    case T.GBroken{detail}: IO.pure(SharedLanding, SharedCommonUnreadable{observed})

def shared_landing_run(+repo: String, +target: String, +cand: String, +basis: String) -> IO(SharedLanding):
  do IO<SharedLanding>:
    observed : T.GitOut <- Git.runGit(repo, Con{"rev-parse", Con{"--path-format=absolute", Con{"--git-common-dir", Nil{}}}})
    shared_common_read(repo, target, cand, basis, observed)

def ff_stage5_advanced(+attestation: Attestation, +target: String, +cand: String) -> FFLD:
  +ev = attestation_evidence(attestation)
  Bool.pick(FFLD, T.release_done(evidence_release(ev)),
    Bool.pick(FFLD, ld_admitted(admission_of(attestation)),
      ff_stage5_adv_answer(evidence_decision(ev), target, cand),
      FFDone{T.LBlocked{Tx.str_cat("the attempt record was not admitted: ", ld_admission(admission_of(attestation)))}}),
    Bool.pick(FFLD, T.release_unperformed(evidence_release(ev)),
      FFDone{T.LBlocked{"the advance ran but its release was not performed"}},
      FFDone{T.LBlocked{Tx.str_cat("the advance ran but its release failed: ", T.release_detail(evidence_release(ev)))}}))
def ff_stage5_shared_answer(shared: SharedLanding, +target: String, +cand: String) -> FFLD:
  match shared:
    case SharedCommonUnreadable{observation}: FFDone{T.LBlocked{"the common directory could not be read for the landing claim"}}
    case SharedClaimFailed{error}: FFDone{T.LBlocked{Tx.str_cat("the landing claim failed: ", T.host_detail(error))}}
    case SharedGuardBusy{target}: FFDone{T.LBlocked{"another landing holds the target"}}
    case SharedStepFailed{step, error, released}: FFDone{T.LBlocked{Tx.str_cat(Tx.str_cat(step, " failed: "), T.host_detail(error))}}
    case SharedStepRecordFailed{step, record, released}: FFDone{T.LBlocked{Tx.str_cat(Tx.str_cat(step, " refused: "), record)}}
    case SharedAdvanced{+attestation}:
      Bool.pick(FFLD, attestation_bound(attestation, target, cand),
        ff_stage5_advanced(attestation, target, cand),
        FFDone{T.LBlocked{"the retained attempt does not name this target and candidate"}})
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

def block_ok(+block: String) -> Bool:
  block_ok_go(Tx.split_lines(block), Tx.non_empty(block))

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

def exit_fail(+block: String, +file: String) -> FV:
  exit_fail_ok(block_ok(block), block, file)

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

# How the target branch advanced, or why it did not.
def ld_adv_update(repo: String, target: String, cand: String, basis: String) -> IO(Ld):
  +r2 = repo
  +t2 = target
  +c2 = cand
  +b2 = basis
  do IO<Ld>:
    g : T.GitOut <- Git.runGit(r2, ld_update_argv(t2, c2, b2))
    IO.pure(Ld, ld_update_pick(g, t2, c2))

def ld_adv_holder_changed_text(target: String, path: String) -> String:
  "the worktree at " ++ path ++ " changed away from target branch " ++ target ++ " during landing; inspect the target and worktree before retrying"

def ld_adv_held_text(target: String, path: String) -> String:
  "the target branch " ++ target ++ " is checked out at " ++ path ++ "; the fast-forward into that worktree was refused (git's own message is in the coordinator log); commit or stash that worktree's changes, or repair the worktree, and "

# ---------------------------------------------------------------------------

def ld_adv_answer(+a: LAdv, target: String, cand: String) -> Ld:
  match a:
    case AdvLanded{}: LdDone{T.LLanded{target, cand}}
    case AdvMoved{}: LdDone{T.LBlocked{"target moved during checked landing; rerun land-checked to prepare and check against the current target"}}
    case AdvHeld{path}: LdDone{T.LBlocked{ld_adv_held_text(target, path) ++ "rerun land-checked to prepare and check against the current target"}}
    case AdvHolderChanged{path}: LdDone{T.LBlocked{ld_adv_holder_changed_text(target, path)}}
    case AdvUnassociated{step}: LdDone{T.LBlocked{Tx.str_cat("the association was refused at ", step)}}
    case AdvIntentRefused{step}: LdDone{T.LBlocked{Tx.str_cat("the intent was refused at ", step)}}
    case AdvRefused{}: LdFail{T.FCmd{"land", "git update-ref failed; inspect the target and rerun land-checked to prepare and check a new candidate"}}
    case AdvBroken{detail}: LdFail{T.FCmd{"land", detail}}

# Advance the checked candidate from its checked basis. A changed target
# returns an explicit retry result; the next invocation prepares both trees.

def ld_advance_advanced(+attestation: Attestation, +target: String, +cand: String) -> Ld:
  +ev = attestation_evidence(attestation)
  Bool.pick(Ld, T.release_done(evidence_release(ev)),
    Bool.pick(Ld, ld_admitted(admission_of(attestation)),
      ld_adv_answer(evidence_decision(ev), target, cand),
      LdFail{T.FCmd{"land", Tx.str_cat("the attempt record was not admitted: ", ld_admission(admission_of(attestation)))}}),
    Bool.pick(Ld, T.release_unperformed(evidence_release(ev)),
      LdFail{T.FCmd{"land", "the advance ran but its release was not performed"}},
      LdFail{T.FCmd{"land", Tx.str_cat("the advance ran but its release failed: ", T.release_detail(evidence_release(ev)))}}))
def ld_advance_shared_answer(shared: SharedLanding, +target: String, +cand: String) -> Ld:
  match shared:
    case SharedCommonUnreadable{observation}: LdFail{T.FCmd{"land", "the common directory could not be read for the landing claim"}}
    case SharedClaimFailed{error}: LdFail{T.FCmd{"land", T.host_detail(error)}}
    case SharedGuardBusy{target}: LdFail{T.FCmd{"land", "another landing holds the target; rerun land-checked to prepare and check against the current target"}}
    case SharedStepFailed{step, error, released}: LdFail{T.FCmd{"land", T.host_detail(error)}}
    case SharedStepRecordFailed{step, record, released}: LdFail{T.FCmd{"land", record}}
    case SharedAdvanced{+attestation}:
      Bool.pick(Ld, attestation_bound(attestation, target, cand),
        ld_advance_advanced(attestation, target, cand),
        LdFail{T.FCmd{"land", "the retained attempt does not name this target and candidate"}})
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
# The checked advance the judged gate reaches once no run is unjudged. It runs the same shared claim, guard,
# attempt and association entry the checked landing uses, with the checked candidate and the target tip as the
# basis, and answers from the shared outcome. This is the entry the unjudged-run gate calls, so both public
# paths reach the shared admission.
def ld_advance(repo: String, target: String, cand: String, tip: String) -> IO(Ld):
  +rp = repo
  +tg = target
  +c2 = cand
  +b2 = tip
  do IO<Ld>:
    shared : SharedLanding <- shared_landing_run(rp, tg, c2, b2)
    IO.pure(Ld, ld_advance_shared_answer(shared, tg, c2))

# The same entry, stated as the effect equation: the shared call runs first and its outcome is what the answer
# is read from.
law the_judged_advance_runs_the_shared_entry_for_its_operands:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  {ld_advance(repo, target, cand, basis) == (do IO<Ld>:
    shared : SharedLanding <- shared_landing_run(repo, target, cand, basis)
    IO.pure(Ld, ld_advance_shared_answer(shared, target, cand))) : IO(Ld)}

def the_judged_advance_runs_the_shared_entry_for_its_operands(repo,target,cand,basis):
  {==}

def ld_judged_news(news: List<String>, repo: String, target: String, scratch: String, tip: String, cand: String) -> IO(Ld):
  match news:
    case Nil{}: ld_advance(repo, target, cand, tip)
    case Con{h, rest}: IO.pure(Ld, LdDone{T.LBlocked{Tx.str_cat("new failures: ", Tx.join("; ", Con{h, rest}))}})

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
    case Nil{}: IO.pure(Unit, Unit{})
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

# The attempt scratch path for one worker and timestamp. It names a fresh path and removes nothing: a
# previous attempt's trees stay until their own terminal result licenses cleanup, so an uncertain or
# still-active attempt is never deleted by a later one.
def open_scratch(repo: String, worker: String, ts: String) -> IO(String):
  +r2 = repo
  +w2 = worker
  +p2 = scratch_prefix(r2, w2)
  IO.pure(String, Tx.str_cat(p2, ts))

# Opening an attempt scratch names a path and runs no removal, so a previous attempt's trees survive a
# later attempt's start. Cleanup stays with the settle path, which drops only its own attempt's paths
# after a terminal landed or already result.
law the_attempt_scratch_names_a_path_without_removing_anything:
  for repo: String
  for worker: String
  for ts: String
  {open_scratch(repo, worker, ts) == IO.pure(String, Tx.str_cat(scratch_prefix(repo, worker), ts)) : IO(String)}

def the_attempt_scratch_names_a_path_without_removing_anything(repo,worker,ts):
  {==}

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
# trees it prepared; a refused or conflicted answer keeps them for the requester,
# and a later attempt's start removes nothing.
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

def tip_match(named: Bool, +subject: String) -> String:
  match named:
    case True{}: subject
    case False{}: ""

def tip_named(more: List<String>, subject: String, ref: String) -> String:
  match more:
    case Nil{}: ""
    case name <> tail: tip_match(Tx.str_eq(name, ref), subject)

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

# Coherent fixtures. The held baseline is complete: identity, association, intent, mode, both
# qualification reads, a successful mutation framing, a done release and matching receipt stages.
def fixture_held_qualification(+candidate: String, +target: String) -> LdQualified:
  QualDecided{MutationHeld{"/holder"}, ReadObserved{T.GRun{0, Tx.str_cat(candidate, "\n")}}, ReadObserved{T.GRun{0, Tx.str_cat(ld_hold_ref(target), "\n")}}}

def fixture_unheld_qualification(+candidate: String) -> LdQualified:
  QualDecided{MutationUnheld{}, ReadObserved{T.GRun{0, Tx.str_cat(candidate, "\n")}}, ReadSkipped{}}

# A request and an observation the admission laws use. The held route reads from the worktree the
# held qualification names; the unheld route reads from the destination repository itself, which is
# the repository the fixture evidence carries.
# The reservations the admission fixtures use: the reservation the evidence retains independently
# of its path, under the attempt directory of the canonical common, and the path that directory
# joined with the name produces. An association request names the same attempt.
def fixture_reservation() -> ReservationIdentity:
  ReservationObserved{shared_attempts_parent("/common"), "attempt-1"}

# The six read positions of a coherent association fixture. The candidate, basis, target and both
# commons answer with a terminal newline, which the normalized values drop. The split variant gives
# the two commons different raw spellings that normalize to the same value, so swapping the holder
# and destination sources cannot satisfy the expectations that use it.
def fixture_reads_of(+candidate: String, +basis: String, +common: String) -> A.AssocReads:
  A.AssocReads{A.AssocReadPerformed{T.GRun{0, Tx.str_cat(candidate, "\n")}},
    A.AssocReadPerformed{T.GRun{0, Tx.str_cat(basis, "\n")}},
    A.AssocReadPerformed{T.GRun{0, Tx.str_cat(basis, "\n")}},
    A.AssocReadPerformed{T.GRun{0, ""}},
    A.AssocReadPerformed{T.GRun{0, Tx.str_cat(common, "\n")}},
    A.AssocReadPerformed{T.GRun{0, Tx.str_cat(common, "\n")}}}

def fixture_split_reads_of(+candidate: String, +basis: String, +common: String) -> A.AssocReads:
  A.AssocReads{A.AssocReadPerformed{T.GRun{0, Tx.str_cat(candidate, "\n")}},
    A.AssocReadPerformed{T.GRun{0, Tx.str_cat(basis, "\n")}},
    A.AssocReadPerformed{T.GRun{0, Tx.str_cat(basis, "\n")}},
    A.AssocReadPerformed{T.GRun{0, ""}},
    A.AssocReadPerformed{T.GRun{0, Tx.str_cat(common, "\n")}},
    A.AssocReadPerformed{T.GRun{0, common}}}

# The supported object-name profile, as the production association module reads it: two distinct
# forty-character lowercase hexadecimal names for the candidate and the basis.
def fixture_oid_candidate() -> String:
  Tx.str_cat("0123456789abcdef0123456789abcdef01234567", "")

def fixture_oid_basis() -> String:
  Tx.str_cat("89abcdef0123456789abcdef0123456789abcdef", "")

def fixture_reads() -> A.AssocReads:
  fixture_reads_of(fixture_oid_candidate(), fixture_oid_basis(), "/common")

def fixture_reserved() -> String:
  shared_parent_path(shared_attempts_parent("/common"), "attempt-1")

# The same reservation written wrongly: an extra component inside the path, a sibling directory
# whose name continues the parent's, a missing separator, and the whole relationship under another
# common directory.
def fixture_middle_reserved() -> String:
  shared_parent_path(shared_parent_path(shared_attempts_parent("/common"), "middle"), "attempt-1")

def fixture_sibling_reserved() -> String:
  shared_parent_path(Tx.str_cat(shared_attempts_parent("/common"), "-other"), "attempt-1")

def fixture_unseparated_reserved() -> String:
  Tx.str_cat(shared_attempts_parent("/common"), "attempt-1")

def fixture_other_common_reserved() -> String:
  shared_parent_path(shared_attempts_parent("/other"), "attempt-1")

# A second coherent reservation: the same parent, another name, and the path that pair produces.
def fixture_second_reservation() -> ReservationIdentity:
  ReservationObserved{shared_attempts_parent("/common"), "attempt-2"}

def fixture_second_reserved() -> String:
  shared_parent_path(shared_attempts_parent("/common"), "attempt-2")

def fixture_assoc_request_named(+candidate: String, +basis: String, +target: String, +holder: String, +common: String, +attempt: String) -> A.AssociationRequest:
  A.AssociationRequested{attempt, common, target, "/repo", candidate, basis, holder, ""}

def fixture_assoc_request(+candidate: String, +basis: String, +target: String, +holder: String, +common: String) -> A.AssociationRequest:
  fixture_assoc_request_named(candidate, basis, target, holder, common, "attempt-1")

def fixture_held_association_named(+common: String, +candidate: String, +basis: String, +target: String, +attempt: String) -> AssociationEvidence:
  AssociationObserved{"associate", fixture_assoc_request_named(candidate, basis, target, "/holder", common, attempt), candidate, basis, basis, common, common, fixture_reads_of(candidate, basis, common)}

def fixture_held_association(+common: String, +candidate: String, +basis: String, +target: String) -> AssociationEvidence:
  fixture_held_association_named(common, candidate, basis, target, "attempt-1")

def fixture_unheld_association(+common: String, +candidate: String, +basis: String, +target: String) -> AssociationEvidence:
  AssociationObserved{"associate", fixture_assoc_request_named(candidate, basis, target, "/repo", common, "attempt-1"), candidate, basis, basis, common, common, fixture_reads_of(candidate, basis, common)}

# An association the pre-mutation comparison accepts, for the route it names.
def fixture_matching_held(+ctx: LdAdvCtx) -> A.Association:
  A.AssociationHeld{ld_assoc_request(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), ladvctx_common(ctx), ladvctx_common(ctx), fixture_reads_of(fixture_oid_candidate(), fixture_oid_basis(), ladvctx_common(ctx))}

def fixture_matching_unheld(+ctx: LdAdvCtx) -> A.Association:
  A.AssociationHeld{ld_assoc_request(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), ladvctx_common(ctx), ladvctx_common(ctx), fixture_reads_of(fixture_oid_candidate(), fixture_oid_basis(), ladvctx_common(ctx))}

# The association evidence the continuation laws feed the intent flow: the same shape the route laws
# assert, kept once so each refusal law differs only in the publication or holder outcome it names.
def fixture_matching_held_evidence(+ctx: LdAdvCtx) -> AssociationEvidence:
  AssociationObserved{"associate", ld_assoc_request(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), ladvctx_common(ctx), ladvctx_common(ctx), fixture_reads_of(fixture_oid_candidate(), fixture_oid_basis(), ladvctx_common(ctx))}

def fixture_matching_unheld_evidence(+ctx: LdAdvCtx) -> AssociationEvidence:
  AssociationObserved{"associate", ld_assoc_request(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), ladvctx_common(ctx), ladvctx_common(ctx), fixture_reads_of(fixture_oid_candidate(), fixture_oid_basis(), ladvctx_common(ctx))}

# The guard path the pure rule names for a common and a literal target, for fixtures whose targets carry no
# character the encoder rewrites. A fixture states the expected naming; the capture observes its own.
def fixture_guard_of(common: String, target: String) -> String:
  Tx.str_cat(common, Tx.str_cat("/baton2-landing/", Tx.str_cat(target, ".lock")))

def fixture_evidence_of(+reserved: String, +common: String, +target: String, +candidate: String, +basis: String, capture: T.CapturedRaw, qualification: LdQualified, identity: IdentityEvidence, association: AssociationEvidence, intent: IntentEvidence) -> AttemptEvidence:
  AttemptEvidence{reserved, "/repo", target, candidate, basis, fixture_guard_of(common, target), shared_parent_path(reserved, "stderr"), AdvLanded{}, capture, qualification, T.ReleaseDone{}, identity, association, intent, ReservationObserved{shared_attempts_parent(common), "attempt-1"}}

def fixture_intent_request(+reserved: String, +repo: String, +target: String, +candidate: String, +basis: String, holder: String, name: String, common: String) -> It.IntentInput:
  It.IntentRequested{name, common, target, repo, candidate, basis, intent_expected_path(reserved), holder, ""}
def fixture_bound_intent(+request: It.IntentInput, +reserved: String, +target: String, +candidate: String, +basis: String, holder: IntentHolderReads) -> IntentEvidence:
  +expected = intent_expected_path(reserved)
  IntentBound{request, expected, IntentPublished{Pb.IntentBytesPublished{request, Pb.production_record("published", expected, "0"), expected, Lg.intent_content(candidate, basis, target)}}, IntentQualified{Pb.production_record("qualified", expected, "0"), expected}, holder}
def fixture_held_intent(+reserved: String, +common: String, +target: String, +candidate: String, +basis: String, +repo: String, name: String, +holder: String) -> IntentEvidence:
  fixture_bound_intent(fixture_intent_request(reserved, repo, target, candidate, basis, holder, name, common), reserved, target, candidate, basis, IntentHolderRead{T.GRun{0, Tx.str_cat(basis, "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})
def fixture_unheld_intent(+reserved: String, +common: String, +target: String, +candidate: String, +basis: String, +repo: String, name: String) -> IntentEvidence:
  fixture_bound_intent(fixture_intent_request(reserved, repo, target, candidate, basis, repo, name, common), reserved, target, candidate, basis, IntentHolderUnperformed{})

# The evidence builder the isolation laws share: the request, the reservation, the publication, the
# preparation and the holder reads, so a law can change one of them and leave the rest as they are.
def fixture_intent_evidence(request: It.IntentInput, reserved: String, publication: IntentPublication, preparation: IntentPreparation, holder: IntentHolderReads) -> IntentEvidence:
  IntentBound{request, intent_expected_path(reserved), publication, preparation, holder}

# The positive every negative below departs from: a complete held record whose holder reads the selected worktree cleanly and answers the basis.
law a_complete_held_intent_is_bound:
  {intent_bound(fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == True{} : Bool}

def a_complete_held_intent_is_bound():
  {==}

# Only the head read changes: it fails, so the holder observation did not complete.
law a_failed_head_holder_read_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved()), Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt")}}, IntentQualified{Pb.production_record("qualified", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{128, "fatal: not a git repository"}, T.GRun{0, ""}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_failed_head_holder_read_is_not_bound():
  {==}



# Only the head value changes: it answers the candidate rather than the basis.
law a_wrong_head_holder_read_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved()), Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt")}}, IntentQualified{Pb.production_record("qualified", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_wrong_head_holder_read_is_not_bound():
  {==}

# Only the index read changes: it reports a staged change.
law a_dirty_index_holder_read_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved()), Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt")}}, IntentQualified{Pb.production_record("qualified", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, "M\tfile"}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_dirty_index_holder_read_is_not_bound():
  {==}

# Only the status read changes: it reports an untracked file.
law a_dirty_status_holder_read_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved()), Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt")}}, IntentQualified{Pb.production_record("qualified", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, "?? file"}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_dirty_status_holder_read_is_not_bound():
  {==}

# Only the request target changes; the reservation, publication, preparation and holder reads stay as the positive has them.
law a_request_for_another_target_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "other", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved()), Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt")}}, IntentQualified{Pb.production_record("qualified", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_request_for_another_target_is_not_bound():
  {==}

# Only the publication changes: its path and its record name another path.
law a_publication_written_for_another_path_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", "/elsewhere", "0"), "/elsewhere", Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt")}}, IntentQualified{Pb.production_record("qualified", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_publication_written_for_another_path_is_not_bound():
  {==}

# Only the publication record changes: it names another path while the publication path is the expected one.
law a_publication_record_for_another_path_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", "/elsewhere", "0"), intent_expected_path(fixture_reserved()), Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt")}}, IntentQualified{Pb.production_record("qualified", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_publication_record_for_another_path_is_not_bound():
  {==}

# Only the published content changes: it is derived from the basis and the candidate the other way round.
law a_publication_for_another_content_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved()), Lg.intent_content(fixture_oid_basis(), fixture_oid_candidate(), "tgt")}}, IntentQualified{Pb.production_record("qualified", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_publication_for_another_content_is_not_bound():
  {==}

# Only the qualification record changes: the request, publication and reservation stay as the positive has them.
law a_qualification_record_for_another_path_is_not_bound:
  {intent_bound(fixture_intent_evidence(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), IntentPublished{Pb.IntentBytesPublished{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), Pb.production_record("published", intent_expected_path(fixture_reserved()), "0"), intent_expected_path(fixture_reserved()), Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt")}}, IntentQualified{Pb.production_record("qualified", "/elsewhere", "0"), intent_expected_path(fixture_reserved())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_qualification_record_for_another_path_is_not_bound():
  {==}

law the_unready_holder_evidence_serializes_its_step_and_reason_before_a_suffix:
  {intent_holder_fields(IntentHolderUnready{"holder", "the worktree is unready", "record bytes"}, Con{"tail", Nil{}}) == Con{"holder-unready", Con{"holder", Con{"the worktree is unready", Con{"record bytes", Con{"tail", Nil{}}}}}} : List<String>}

def the_unready_holder_evidence_serializes_its_step_and_reason_before_a_suffix():
  {==}

law the_observed_holder_evidence_serializes_its_three_reads_before_a_suffix:
  {intent_holder_fields(IntentHolderRead{T.GRun{0, "abc\n"}, T.GRun{0, ""}, T.GRun{0, ""}}, Con{"tail", Nil{}}) == Con{"holder-read", Con{"run", Con{"0", Con{"abc\n", Con{"run", Con{"0", Con{"", Con{"run", Con{"0", Con{"", Con{"tail", Nil{}}}}}}}}}}}} : List<String>}

def the_observed_holder_evidence_serializes_its_three_reads_before_a_suffix():
  {==}

law the_pending_holder_evidence_serializes_its_record_and_pending_reason_before_a_suffix:
  {intent_holder_fields(IntentHolderPending{fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), "record bytes", "the record waits"}, Con{"tail", Nil{}}) == Con{"holder-pending", Con{"record bytes", Con{"the record waits", Con{"intent-request", Con{"attempt-1", Con{"/common", Con{"tgt", Con{"/repo", Con{fixture_oid_candidate(), Con{fixture_oid_basis(), Con{intent_expected_path(fixture_reserved()), Con{"/holder", Con{"", Con{"tail", Nil{}}}}}}}}}}}}}}} : List<String>}

def the_pending_holder_evidence_serializes_its_record_and_pending_reason_before_a_suffix():
  {==}

law the_failed_holder_evidence_serializes_its_step_and_host_error_before_a_suffix:
  {intent_holder_fields(IntentHolderFailed{"holder", fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), T.HostError{8, "i/o error"}}, Con{"tail", Nil{}}) == Con{"holder-failed", Con{"holder", Con{"host-error", Con{"8", Con{"i/o error", Con{"intent-request", Con{"attempt-1", Con{"/common", Con{"tgt", Con{"/repo", Con{fixture_oid_candidate(), Con{fixture_oid_basis(), Con{intent_expected_path(fixture_reserved()), Con{"/holder", Con{"", Con{"tail", Nil{}}}}}}}}}}}}}}}}} : List<String>}

def the_failed_holder_evidence_serializes_its_step_and_host_error_before_a_suffix():
  {==}

# The fixed context the consuming equations use. Its reserved path and common carry no separator, so the
# receipt parser decides a record for this attempt, and every operand below belongs to this context.
def fixture_consume_ctx() -> LdAdvCtx:
  LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}

# The publication a coherent held attempt produced, used as the retained outcome of the stages after it.
def fixture_intent_published(+ctx: LdAdvCtx, +repo: String, +target: String, +cand: String, +basis: String, +holder: String) -> Pb.IntentPublish:
  +request = shared_intent_input(ctx, holder, repo, target, cand, basis)
  Pb.IntentBytesPublished{request, Pb.production_record("published", shared_intent_path(ctx), "0"), shared_intent_path(ctx), Lg.intent_content(cand, basis, target)}

law a_successful_held_qualification_continues_through_the_holder_observation:
  {ld_adv_intent_qualified(Done{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0")}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/holder") == (do IO<LdAdvObs>:
    observed : It.IntentPrepared <- It.Intent.observe_holder(shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()))
    ld_adv_intent_observed(observed, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx())) : IO(LdAdvObs)}

def a_successful_held_qualification_continues_through_the_holder_observation():
  {==}

law a_malformed_qualification_stops_the_held_route_before_the_holder:
  {ld_adv_intent_qualified(Done{"not a receipt record"}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/holder") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"qualification-refused"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualificationRefused{"not a receipt record", shared_intent_path(fixture_consume_ctx()), "", "record does not match the qualified production shape"}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_malformed_qualification_stops_the_held_route_before_the_holder():
  {==}

law a_qualification_host_failure_stops_the_held_route_before_the_holder:
  {ld_adv_intent_qualified(Fail{8 & "i/o error"}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/holder") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"qualification-host-failed"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualificationFailed{"qualify", T.HostError{8, "i/o error"}}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_qualification_host_failure_stops_the_held_route_before_the_holder():
  {==}

law a_pending_qualification_stops_the_held_route_before_the_holder:
  {ld_adv_intent_verdict(shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "record bytes", It.VerdictPending{"pending bytes", shared_intent_path(fixture_consume_ctx()), "the record waits"}, fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/holder") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"qualification-pending"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualificationRefused{"pending bytes", shared_intent_path(fixture_consume_ctx()), "the record waits", ""}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_pending_qualification_stops_the_held_route_before_the_holder():
  {==}

law a_content_mismatch_stops_the_held_route_with_qualification_unperformed:
  {ld_adv_intent_published(Pb.PublishContentMismatch{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "record bytes", "expected bytes", "found bytes"}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/holder") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"publication-content-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{Pb.PublishContentMismatch{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "record bytes", "expected bytes", "found bytes"}}, IntentUnprepared{}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_content_mismatch_stops_the_held_route_with_qualification_unperformed():
  {==}

law a_readback_failure_stops_the_held_route_with_qualification_unperformed:
  {ld_adv_intent_published(Pb.PublishReadbackFailed{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publication", shared_intent_path(fixture_consume_ctx()), T.HostError{1, "no such file"}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/holder") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"publication-readback-failed"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{Pb.PublishReadbackFailed{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publication", shared_intent_path(fixture_consume_ctx()), T.HostError{1, "no such file"}}}, IntentUnprepared{}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_readback_failure_stops_the_held_route_with_qualification_unperformed():
  {==}

law a_publication_host_failure_stops_the_held_route_with_qualification_unperformed:
  {ld_adv_intent_published(Pb.PublishHostFailed{"readback", shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), T.HostError{5, "i/o error"}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/holder") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"publication-host-failed"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{Pb.PublishHostFailed{"readback", shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), T.HostError{5, "i/o error"}}}, IntentUnprepared{}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_publication_host_failure_stops_the_held_route_with_qualification_unperformed():
  {==}

law an_unknown_route_stops_the_held_handler_without_a_holder_read:
  {ld_adv_intent_held(shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationUnknown{}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"route-unknown"}, MutationUnknown{}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def an_unknown_route_stops_the_held_handler_without_a_holder_read():
  {==}

law a_failed_head_read_from_the_holder_helper_refuses_the_held_advance:
  {ld_adv_intent_observed(It.IntentObserved{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), T.GRun{128, "fatal: not a git repository"}, T.GRun{0, ""}, T.GRun{0, ""}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{128, "fatal: not a git repository"}, T.GRun{0, ""}, T.GRun{0, ""}}}}) : IO(LdAdvObs)}

def a_failed_head_read_from_the_holder_helper_refuses_the_held_advance():
  {==}



law a_failed_head_read_refuses_the_held_advance_with_the_performed_reads:
  {ld_adv_intent_decided(intent_bound(IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{128, "fatal: not a git repository"}, T.GRun{0, ""}, T.GRun{0, ""}}}, ladvctx_reserved(fixture_consume_ctx()), ladvctx_attempt(fixture_consume_ctx()), ladvctx_common(fixture_consume_ctx()), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}), shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), IntentHolderRead{T.GRun{128, "fatal: not a git repository"}, T.GRun{0, ""}, T.GRun{0, ""}}, fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{128, "fatal: not a git repository"}, T.GRun{0, ""}, T.GRun{0, ""}}}}) : IO(LdAdvObs)}

def a_failed_head_read_refuses_the_held_advance_with_the_performed_reads():
  {==}

law a_failed_index_holder_read_through_the_comparison_refuses_the_held_advance:
  {ld_adv_intent_decided(intent_bound(IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{128, "fatal: bad index"}, T.GRun{0, ""}}}, ladvctx_reserved(fixture_consume_ctx()), ladvctx_attempt(fixture_consume_ctx()), ladvctx_common(fixture_consume_ctx()), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}), shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{128, "fatal: bad index"}, T.GRun{0, ""}}, fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{128, "fatal: bad index"}, T.GRun{0, ""}}}}) : IO(LdAdvObs)}

def a_failed_index_holder_read_through_the_comparison_refuses_the_held_advance():
  {==}

law a_failed_index_holder_read_from_the_holder_helper_refuses_the_held_advance:
  {ld_adv_intent_observed(It.IntentObserved{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{128, "fatal: bad index"}, T.GRun{0, ""}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{128, "fatal: bad index"}, T.GRun{0, ""}}}}) : IO(LdAdvObs)}

def a_failed_index_holder_read_from_the_holder_helper_refuses_the_held_advance():
  {==}



law a_failed_status_holder_read_through_the_comparison_refuses_the_held_advance:
  {ld_adv_intent_decided(intent_bound(IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{128, "fatal: bad status"}}}, ladvctx_reserved(fixture_consume_ctx()), ladvctx_attempt(fixture_consume_ctx()), ladvctx_common(fixture_consume_ctx()), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}), shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{128, "fatal: bad status"}}, fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{128, "fatal: bad status"}}}}) : IO(LdAdvObs)}

def a_failed_status_holder_read_through_the_comparison_refuses_the_held_advance():
  {==}

law a_failed_status_holder_read_from_the_holder_helper_refuses_the_held_advance:
  {ld_adv_intent_observed(It.IntentObserved{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{128, "fatal: bad status"}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{128, "fatal: bad status"}}}}) : IO(LdAdvObs)}

def a_failed_status_holder_read_from_the_holder_helper_refuses_the_held_advance():
  {==}



law a_dirty_index_holder_read_through_the_comparison_refuses_the_held_advance:
  {ld_adv_intent_decided(intent_bound(IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, "M\tfile"}, T.GRun{0, ""}}}, ladvctx_reserved(fixture_consume_ctx()), ladvctx_attempt(fixture_consume_ctx()), ladvctx_common(fixture_consume_ctx()), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}), shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, "M\tfile"}, T.GRun{0, ""}}, fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, "M\tfile"}, T.GRun{0, ""}}}}) : IO(LdAdvObs)}

def a_dirty_index_holder_read_through_the_comparison_refuses_the_held_advance():
  {==}

law a_dirty_index_holder_read_from_the_holder_helper_refuses_the_held_advance:
  {ld_adv_intent_observed(It.IntentObserved{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, "M\tfile"}, T.GRun{0, ""}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, "M\tfile"}, T.GRun{0, ""}}}}) : IO(LdAdvObs)}

def a_dirty_index_holder_read_from_the_holder_helper_refuses_the_held_advance():
  {==}



law a_dirty_status_holder_read_through_the_comparison_refuses_the_held_advance:
  {ld_adv_intent_decided(intent_bound(IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, "?? file"}}}, ladvctx_reserved(fixture_consume_ctx()), ladvctx_attempt(fixture_consume_ctx()), ladvctx_common(fixture_consume_ctx()), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}), shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, "?? file"}}, fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, "?? file"}}}}) : IO(LdAdvObs)}

def a_dirty_status_holder_read_through_the_comparison_refuses_the_held_advance():
  {==}

law a_dirty_status_holder_read_from_the_holder_helper_refuses_the_held_advance:
  {ld_adv_intent_observed(It.IntentObserved{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, "?? file"}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, "?? file"}}}}) : IO(LdAdvObs)}

def a_dirty_status_holder_read_from_the_holder_helper_refuses_the_held_advance():
  {==}



law a_wrong_head_holder_read_through_the_comparison_refuses_the_held_advance:
  {ld_adv_intent_decided(intent_bound(IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}}, ladvctx_reserved(fixture_consume_ctx()), ladvctx_attempt(fixture_consume_ctx()), ladvctx_common(fixture_consume_ctx()), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}), shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}, fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}}}) : IO(LdAdvObs)}

def a_wrong_head_holder_read_through_the_comparison_refuses_the_held_advance():
  {==}

law a_wrong_head_holder_read_from_the_holder_helper_refuses_the_held_advance:
  {ld_adv_intent_observed(It.IntentObserved{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}}}) : IO(LdAdvObs)}

def a_wrong_head_holder_read_from_the_holder_helper_refuses_the_held_advance():
  {==}



law a_pending_record_stops_the_held_route_through_the_parser:
  {ld_adv_intent_qualified(Done{Tx.str_cat("qualified\t", Tx.str_cat(shared_intent_path(fixture_consume_ctx()), "\t0\t\t1\t"))}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/holder") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"qualification-pending"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(fixture_consume_ctx()), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualificationRefused{Tx.str_cat("qualified\t", Tx.str_cat(shared_intent_path(fixture_consume_ctx()), "\t0\t\t1\t")), shared_intent_path(fixture_consume_ctx()), "1", ""}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_pending_record_stops_the_held_route_through_the_parser():
  {==}

law a_complete_held_observation_continues_into_the_selected_mutation:
  {ld_adv_intent_observed(It.IntentObserved{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}, shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder"), "/holder", fixture_matching_held_evidence(fixture_consume_ctx()), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == (do IO<LdAdvObs>:
    obs : LdAdvObs <- ld_adv_wt("/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx())
    IO.pure(LdAdvObs, ld_adv_keep_intent(ld_adv_keep_association(obs, fixture_matching_held_evidence(fixture_consume_ctx())), IntentBound{shared_intent_input(fixture_consume_ctx(), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}}))) : IO(LdAdvObs)}

def a_complete_held_observation_continues_into_the_selected_mutation():
  {==}

law a_complete_unheld_preparation_continues_into_the_selected_mutation:
  {ld_adv_intent_unheld(shared_intent_input(fixture_consume_ctx(), "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/r"), fixture_matching_unheld_evidence(fixture_consume_ctx()), MutationUnheld{}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx(), "/r") == (do IO<LdAdvObs>:
    obs : LdAdvObs <- ld_adv_cas_run("/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx())
    IO.pure(LdAdvObs, ld_adv_keep_intent(ld_adv_keep_association(obs, fixture_matching_unheld_evidence(fixture_consume_ctx())), IntentBound{shared_intent_input(fixture_consume_ctx(), "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/r")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderUnperformed{}}))) : IO(LdAdvObs)}

def a_complete_unheld_preparation_continues_into_the_selected_mutation():
  {==}

law the_artifact_destination_derived_from_the_reservation_is_bound:
  {artifact_bound(shared_parent_path(fixture_reserved(), "stderr"), fixture_reserved()) == True{} : Bool}

def the_artifact_destination_derived_from_the_reservation_is_bound():
  {==}

law an_artifact_under_another_reservation_is_not_bound:
  {artifact_bound(shared_parent_path(fixture_middle_reserved(), "stderr"), fixture_reserved()) == False{} : Bool}

def an_artifact_under_another_reservation_is_not_bound():
  {==}

law an_artifact_without_the_reservation_prefix_is_not_bound:
  {artifact_bound("stderr", fixture_reserved()) == False{} : Bool}

def an_artifact_without_the_reservation_prefix_is_not_bound():
  {==}


def fixture_unheld_evidence(+reserved: String, +common: String, +target: String, +candidate: String, +basis: String) -> AttemptEvidence:
  fixture_evidence_of(reserved, common, target, candidate, basis, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_unheld_qualification(candidate), IdentityObserved{common, T.GRun{0, common}, target}, fixture_unheld_association(common, candidate, basis, target), fixture_unheld_intent(reserved, common, target, candidate, basis, "/repo", "attempt-1"))

# The producer-shaped intent evidence: the request the attempt fixed, the path that request names, the
# publication the producer wrote at that path with the content it derives, the qualification record the
# producer admits for that path, and the holder reads the held route performed or the explicit statement
# that an unheld route performed none. Rebuilding the three evidence fixtures on this shape is what
# makes admission reconsider them.


def fixture_intent_of(request: It.IntentInput, reserved: String, publication: IntentPublication, preparation: IntentPreparation, holder: IntentHolderReads) -> IntentEvidence:
  IntentBound{request, intent_expected_path(reserved), publication, preparation, holder}


def fixture_held_intent_bound(+reserved: String, +common: String, holder: IntentHolderReads) -> IntentEvidence:
  fixture_bound_intent(fixture_intent_request(reserved, "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", common), reserved, "tgt", fixture_oid_candidate(), fixture_oid_basis(), holder)



def fixture_release_evidence(+reserved: String, +common: String, +target: String, +candidate: String, +basis: String, release: T.ReleaseRaw) -> AttemptEvidence:
  AttemptEvidence{reserved, "/repo", target, candidate, basis, fixture_guard_of(common, target), shared_parent_path(reserved, "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(candidate, target), release, IdentityObserved{common, T.GRun{0, common}, target}, fixture_held_association(common, candidate, basis, target), fixture_held_intent(reserved, common, target, candidate, basis, "/repo", "attempt-1", "/holder"), ReservationObserved{shared_attempts_parent(common), "attempt-1"}}

def fixture_stages(+reserved: String, evidence: AttemptEvidence, publication: StageResult, qualification: StageResult, readback: StageResult) -> Attestation:
  Attestation{reserved, evidence, publication, qualification, readback}

def fixture_attestation_of(+reserved: String, +evidence: AttemptEvidence) -> Attestation:
  fixture_stages(reserved, evidence, StageSucceeded{Pb.production_record("published", landing_record_path(reserved), "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path(reserved), "0")}, StageSucceeded{attempt_record(evidence)})

# The producer-shaped intent evidence is admitted for its own reservation and mode, and refuses when one
# fact changes: the holder reads an unheld route would not perform, and a returned qualification for
# another path.
law a_producer_shaped_held_intent_is_admitted:
  {intent_bound(fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == True{} : Bool}

def a_producer_shaped_held_intent_is_admitted():
  {==}

law a_producer_shaped_unheld_intent_is_admitted:
  {intent_bound(fixture_unheld_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1"), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", MutationUnheld{}) == True{} : Bool}

def a_producer_shaped_unheld_intent_is_admitted():
  {==}

law a_held_intent_without_holder_reads_is_not_admitted:
  {intent_bound(fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderUnperformed{}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", MutationHeld{"/holder"}) == False{} : Bool}

def a_held_intent_without_holder_reads_is_not_admitted():
  {==}

law an_unheld_intent_with_holder_reads_is_not_admitted:
  {intent_bound(fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}}), fixture_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", MutationUnheld{}) == False{} : Bool}

def an_unheld_intent_with_holder_reads_is_not_admitted():
  {==}

law an_intent_qualified_for_another_path_is_not_admitted:
  {intent_bound(fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderUnperformed{}), fixture_second_reserved(), "attempt-1", "/common", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", MutationUnheld{}) == False{} : Bool}

def an_intent_qualified_for_another_path_is_not_admitted():
  {==}

law an_attempt_whose_artifact_is_another_reservation_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), AttemptEvidence{fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/common", "tgt"), shared_parent_path(fixture_middle_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), fixture_reservation()}))) == False{} : Bool}

def an_attempt_whose_artifact_is_another_reservation_is_not_admitted():
  {==}
law the_no_capture_observation_keeps_the_retained_intent_when_the_association_is_replaced:
  {ld_adv_keep_association(LdAdvNoCapture{AdvLanded{}, MutationHeld{"/holder"}, fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt")) == LdAdvNoCapture{AdvLanded{}, MutationHeld{"/holder"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})} : LdAdvObs}

def the_no_capture_observation_keeps_the_retained_intent_when_the_association_is_replaced():
  {==}

law the_no_capture_observation_keeps_the_retained_association_when_the_intent_is_replaced:
  {ld_adv_keep_intent(LdAdvNoCapture{AdvLanded{}, MutationHeld{"/holder"}, fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})}, IntentObserved{"/p2/intent", "replacement intent bytes"}) == LdAdvNoCapture{AdvLanded{}, MutationHeld{"/holder"}, fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), IntentObserved{"/p2/intent", "replacement intent bytes"}} : LdAdvObs}

def the_no_capture_observation_keeps_the_retained_association_when_the_intent_is_replaced():
  {==}

law the_captured_observation_keeps_the_retained_intent_when_the_association_is_replaced:
  {ld_adv_keep_association(LdAdvCaptured{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, MutationHeld{"/holder"}, fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt")) == LdAdvCaptured{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, MutationHeld{"/holder"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})} : LdAdvObs}

def the_captured_observation_keeps_the_retained_intent_when_the_association_is_replaced():
  {==}

law the_captured_observation_keeps_the_retained_association_when_the_intent_is_replaced:
  {ld_adv_keep_intent(LdAdvCaptured{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, MutationHeld{"/holder"}, fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})}, IntentObserved{"/p2/intent", "replacement intent bytes"}) == LdAdvCaptured{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, MutationHeld{"/holder"}, fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), IntentObserved{"/p2/intent", "replacement intent bytes"}} : LdAdvObs}

def the_captured_observation_keeps_the_retained_association_when_the_intent_is_replaced():
  {==}

law the_qualified_observation_keeps_the_retained_intent_when_the_association_is_replaced:
  {ld_adv_keep_association(LdAdvQualified{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt")) == LdAdvQualified{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})} : LdAdvObs}

def the_qualified_observation_keeps_the_retained_intent_when_the_association_is_replaced():
  {==}

law the_qualified_observation_keeps_the_retained_association_when_the_intent_is_replaced:
  {ld_adv_keep_intent(LdAdvQualified{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_bound_intent(fixture_intent_request(fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/holder", "attempt-1", "/common"), fixture_reserved(), "tgt", fixture_oid_candidate(), fixture_oid_basis(), IntentHolderRead{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}, T.GRun{0, ""}, T.GRun{0, ""}})}, IntentObserved{"/p2/intent", "replacement intent bytes"}) == LdAdvQualified{AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), IntentObserved{"/p2/intent", "replacement intent bytes"}} : LdAdvObs}

def the_qualified_observation_keeps_the_retained_association_when_the_intent_is_replaced():
  {==}

law the_plain_target_is_named_unchanged:
  {Tx.expected_guard_path("/common", "tgt") == Some{"/common/baton2-landing/tgt.lock"} : Maybe<String>}

def the_plain_target_is_named_unchanged():
  {==}

law a_slash_target_is_encoded_percent_two_f:
  {Tx.expected_guard_path("/common", "release/v1") == Some{"/common/baton2-landing/release%2fv1.lock"} : Maybe<String>}

def a_slash_target_is_encoded_percent_two_f():
  {==}

law a_percent_target_encodes_the_percent_sign:
  {Tx.expected_guard_path("/common", "50%") == Some{"/common/baton2-landing/50%25.lock"} : Maybe<String>}

def a_percent_target_encodes_the_percent_sign():
  {==}

law a_space_target_is_encoded_percent_two_zero:
  {Tx.expected_guard_path("/common", "a b") == Some{"/common/baton2-landing/a%20b.lock"} : Maybe<String>}

def a_space_target_is_encoded_percent_two_zero():
  {==}

law a_two_byte_character_is_encoded_byte_by_byte:
  {Tx.expected_guard_path("/common", Tx.one_char(Char.from_u32(233))) == Some{"/common/baton2-landing/%c3%a9.lock"} : Maybe<String>}

def a_two_byte_character_is_encoded_byte_by_byte():
  {==}

law an_empty_target_is_not_named:
  {Tx.expected_guard_path("/common", "") == None{} : Maybe<String>}

def an_empty_target_is_not_named():
  {==}

law a_nul_in_the_target_is_not_named:
  {Tx.expected_guard_path("/common", Tx.one_char(Char.from_u32(0))) == None{} : Maybe<String>}

def a_nul_in_the_target_is_not_named():
  {==}

law a_guard_named_for_its_own_common_and_target_is_bound:
  {guard_bound("/common/baton2-landing/tgt.lock", "/common", "tgt") == True{} : Bool}

def a_guard_named_for_its_own_common_and_target_is_bound():
  {==}

law a_guard_named_for_another_target_is_not_bound:
  {guard_bound("/common/baton2-landing/other.lock", "/common", "tgt") == False{} : Bool}

def a_guard_named_for_another_target_is_not_bound():
  {==}

law a_guard_named_for_another_common_is_not_bound:
  {guard_bound("/other/baton2-landing/tgt.lock", "/common", "tgt") == False{} : Bool}

def a_guard_named_for_another_common_is_not_bound():
  {==}

law a_plain_name_is_named_in_order:
  {Tx.expected_guard_path("/common", "main") == Some{"/common/baton2-landing/main.lock"} : Maybe<String>}

def a_plain_name_is_named_in_order():
  {==}

law a_mixed_name_keeps_its_order:
  {Tx.expected_guard_path("/common", "a/b%c") == Some{"/common/baton2-landing/a%2fb%25c.lock"} : Maybe<String>}

def a_mixed_name_keeps_its_order():
  {==}

law the_punctuation_characters_stay_literal:
  {Tx.expected_guard_path("/common", "a-b.c_d") == Some{"/common/baton2-landing/a-b.c_d.lock"} : Maybe<String>}

def the_punctuation_characters_stay_literal():
  {==}

law the_character_above_the_punctuation_is_encoded:
  {Tx.expected_guard_path("/common", Tx.str_cat(Tx.one_char(Char.from_u32(47)), Tx.one_char(Char.from_u32(58)))) == Some{"/common/baton2-landing/%2f%3a.lock"} : Maybe<String>}

def the_character_above_the_punctuation_is_encoded():
  {==}

law adjacent_two_byte_characters_are_encoded_in_order:
  {Tx.expected_guard_path("/common", Tx.str_cat(Tx.one_char(Char.from_u32(233)), Tx.one_char(Char.from_u32(232)))) == Some{"/common/baton2-landing/%c3%a9%c3%a8.lock"} : Maybe<String>}

def adjacent_two_byte_characters_are_encoded_in_order():
  {==}

law a_three_byte_character_is_encoded_byte_by_byte:
  {Tx.expected_guard_path("/common", Tx.one_char(Char.from_u32(8364))) == Some{"/common/baton2-landing/%e2%82%ac.lock"} : Maybe<String>}

def a_three_byte_character_is_encoded_byte_by_byte():
  {==}

law a_four_byte_character_is_encoded_byte_by_byte:
  {Tx.expected_guard_path("/common", Tx.one_char(Char.from_u32(128512))) == Some{"/common/baton2-landing/%f0%9f%98%80.lock"} : Maybe<String>}

def a_four_byte_character_is_encoded_byte_by_byte():
  {==}

law a_nul_in_the_common_is_not_named:
  {Tx.expected_guard_path(Tx.one_char(Char.from_u32(0)), "tgt") == None{} : Maybe<String>}

def a_nul_in_the_common_is_not_named():
  {==}

def fixture_held_evidence(+reserved: String, +common: String, +target: String, +candidate: String, +basis: String) -> AttemptEvidence:
  fixture_evidence_of(reserved, common, target, candidate, basis, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(candidate, target), IdentityObserved{common, T.GRun{0, common}, target}, fixture_held_association(common, candidate, basis, target), fixture_held_intent(reserved, common, target, candidate, basis, "/repo", "attempt-1", "/holder"))

law an_attempt_whose_guard_names_another_target_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), AttemptEvidence{fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/common", "other"), shared_parent_path(fixture_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), fixture_reservation()}))) == False{} : Bool}

def an_attempt_whose_guard_names_another_target_is_not_admitted():
  {==}

law an_attempt_whose_guard_names_another_common_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), AttemptEvidence{fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/other", "tgt"), shared_parent_path(fixture_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), fixture_reservation()}))) == False{} : Bool}

def an_attempt_whose_guard_names_another_common_is_not_admitted():
  {==}

def fixture_held_obs(+candidate: String, +target: String) -> LdAdvObs:
  ld_adv_qualified_with(AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(candidate, target))

# Internally coherent fixtures: one held attempt whose identity, association, intent, mode,
# observations, reservation and receipt path all agree, so a law can vary exactly one fact.
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

law a_prefix_is_dropped_to_its_suffix:
  {prefix_drop("worktree /tmp/w", "worktree ") == Some{"/tmp/w"} : Maybe<&2, String>}

def a_prefix_is_dropped_to_its_suffix():
  {==}

law a_prefix_that_ends_the_line_leaves_it_empty:
  {prefix_drop("worktree ", "worktree ") == Some{""} : Maybe<&2, String>}

def a_prefix_that_ends_the_line_leaves_it_empty():
  {==}

law a_mismatched_prefix_is_not_dropped:
  {prefix_drop("branch refs/heads/x", "worktree ") == None{} : Maybe<&2, String>}

def a_mismatched_prefix_is_not_dropped():
  {==}

law an_empty_prefix_leaves_the_whole_line:
  {prefix_drop("worktree /tmp/w", "") == Some{"worktree /tmp/w"} : Maybe<&2, String>}

def an_empty_prefix_leaves_the_whole_line():
  {==}

law an_unperformed_release_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_release_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.ReleaseUnperformed{}))}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the advance ran but its release was not performed"}} : FFLD}

def an_unperformed_release_refuses_the_fast_forward():
  {==}

law a_failed_release_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_release_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.ReleaseFailed{13, "release failed"}))}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{Tx.str_cat("the advance ran but its release failed: ", "release failed")}} : FFLD}

def a_failed_release_refuses_the_fast_forward():
  {==}

law an_unperformed_release_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_release_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.ReleaseUnperformed{}))}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the advance ran but its release was not performed"}} : Ld}

def an_unperformed_release_refuses_the_advance():
  {==}

law a_failed_release_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_release_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.ReleaseFailed{13, "release failed"}))}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", Tx.str_cat("the advance ran but its release failed: ", "release failed")}} : Ld}

def a_failed_release_refuses_the_advance():
  {==}

# The qualification decisions, stated over supplied observations. The capture and the earlier
# reads are carried through every one of them.
law an_unreadable_target_read_is_failure_evidence:
  {ld_adv_wt_target_decided("/p", "/r", "tgt", fixture_oid_candidate(), T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GBroken{"target unreadable"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvBroken{"target unreadable"}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GBroken{"target unreadable"}}, ReadSkipped{}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def an_unreadable_target_read_is_failure_evidence():
  {==}

law a_successful_unequal_target_read_is_movement:
  {ld_adv_wt_target_decided("/p", "/r", "tgt", fixture_oid_candidate(), T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GRun{0, "other\n"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvMoved{}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GRun{0, "other\n"}}, ReadSkipped{}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_successful_unequal_target_read_is_movement():
  {==}

law a_successful_matching_holder_read_lands:
  {ld_adv_wt_head_decided("/p", "tgt", T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GRun{0, "tip\n"}, T.GRun{0, Tx.str_cat(ld_hold_ref("tgt"), "\n")}) == IO.pure(LdAdvObs, LdAdvQualified{AdvLanded{}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GRun{0, "tip\n"}}, ReadObserved{T.GRun{0, Tx.str_cat(ld_hold_ref("tgt"), "\n")}}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_successful_matching_holder_read_lands():
  {==}

law a_successful_holder_mismatch_is_holder_change:
  {ld_adv_wt_head_decided("/p", "tgt", T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GRun{0, "tip\n"}, T.GRun{0, "refs/heads/other\n"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvHolderChanged{"/p"}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GRun{0, "tip\n"}}, ReadObserved{T.GRun{0, "refs/heads/other\n"}}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_successful_holder_mismatch_is_holder_change():
  {==}

law an_unreadable_holder_read_is_failure_evidence:
  {ld_adv_wt_head_decided("/p", "tgt", T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GRun{0, "tip\n"}, T.GBroken{"head unreadable"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvBroken{"head unreadable"}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GRun{0, "tip\n"}}, ReadObserved{T.GBroken{"head unreadable"}}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def an_unreadable_holder_read_is_failure_evidence():
  {==}

law a_refused_mutation_retains_its_target_read:
  {ld_adv_wt_refused_decided(AdvRefused{}, "/p", T.GRun{0, "tip\n"}, T.CapturedDone{"framing bytes", "diagnostics bytes"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvRefused{}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GRun{0, "tip\n"}}, ReadSkipped{}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_refused_mutation_retains_its_target_read():
  {==}

law a_nonzero_target_read_is_failure_evidence:
  {ld_adv_wt_target_decided("/p", "/r", "tgt", fixture_oid_candidate(), T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GRun{128, "fatal: not a valid ref\n"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvBroken{"fatal: not a valid ref\n"}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GRun{128, "fatal: not a valid ref\n"}}, ReadSkipped{}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_nonzero_target_read_is_failure_evidence():
  {==}

law a_nonzero_holder_read_is_failure_evidence:
  {ld_adv_wt_head_decided("/p", "tgt", T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GRun{0, "tip\n"}, T.GRun{128, "fatal: cannot resolve HEAD\n"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvBroken{"fatal: cannot resolve HEAD\n"}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GRun{0, "tip\n"}}, ReadObserved{T.GRun{128, "fatal: cannot resolve HEAD\n"}}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_nonzero_holder_read_is_failure_evidence():
  {==}

law a_matching_target_read_continues_to_the_holder_read:
  {ld_adv_wt_target_decided("/p", "/r", "tgt", fixture_oid_candidate(), T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}) == (do IO<LdAdvObs>:
    head : T.GitOut <- Git.runGit("/p", ld_head_argv())
    ld_adv_wt_head_decided("/p", "tgt", T.CapturedDone{"framing bytes", "diagnostics bytes"}, T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}, head)) : IO(LdAdvObs)}

def a_matching_target_read_continues_to_the_holder_read():
  {==}

law a_refused_pick_and_decision_retain_the_read:
  {ld_adv_wt_refused_decided(ld_adv_refused_pick(T.GRun{0, "tip\n"}, "/p", "tip"), "/p", T.GRun{0, "tip\n"}, T.CapturedDone{"framing bytes", "diagnostics bytes"}) == IO.pure(LdAdvObs, LdAdvQualified{AdvHeld{"/p"}, T.CapturedDone{"framing bytes", "diagnostics bytes"}, QualDecided{MutationHeld{"/p"}, ReadObserved{T.GRun{0, "tip\n"}}, ReadSkipped{}}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_refused_pick_and_decision_retain_the_read():
  {==}

# Receipt admission gates the landed answer. A missing admission refuses even a landed advance with a
# successful release, and a complete admitted record reaches the existing landed answer.
law a_missing_admission_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageFailed{13, "i/o error"}, StageUnperformed{}, StageUnperformed{})}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the attempt record was not admitted: the attempt record was not published"}} : FFLD}

def a_missing_admission_refuses_the_fast_forward():
  {==}

law a_missing_admission_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{"other bytes"})}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the attempt record was not admitted: the attempt record does not read back as published"}} : Ld}

def a_missing_admission_refuses_the_advance():
  {==}

law an_admitted_landed_advance_answers_landed:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "tgt", fixture_oid_candidate()) == FFDone{T.LLanded{"tgt", fixture_oid_candidate()}} : FFLD}

def an_admitted_landed_advance_answers_landed():
  {==}

law an_admitted_landed_advance_answers_the_landed_commit:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "tgt", fixture_oid_candidate()) == LdDone{T.LLanded{"tgt", fixture_oid_candidate()}} : Ld}

def an_admitted_landed_advance_answers_the_landed_commit():
  {==}

# The receipt contract, derived from receipt.c: a success record is tag, path, zero errno, empty
# phase, zero pending and empty detail. Each law consumes the validator with a supplied record.
law a_published_success_record_is_admitted:
  {receipt_published("published\t/r/landing-record\t0\t\t0\t", "/r/landing-record") == True{} : Bool}

def a_published_success_record_is_admitted():
  {==}

law a_qualified_success_record_is_admitted:
  {receipt_qualified("qualified\t/r/landing-record\t0\t\t0\t", "/r/landing-record") == True{} : Bool}

def a_qualified_success_record_is_admitted():
  {==}

law an_empty_pending_record_is_refused:
  {receipt_published(Pb.production_record("published", "/r/landing-record", ""), "/r/landing-record") == False{} : Bool}

def an_empty_pending_record_is_refused():
  {==}

law a_pending_one_record_is_refused:
  {receipt_published(Pb.production_record("published", "/r/landing-record", "1"), "/r/landing-record") == False{} : Bool}

def a_pending_one_record_is_refused():
  {==}

law a_wrong_path_record_is_refused:
  {receipt_published(Pb.production_record("published", "/other/landing-record", "0"), "/r/landing-record") == False{} : Bool}

def a_wrong_path_record_is_refused():
  {==}

law a_wrong_tag_record_is_refused:
  {receipt_published(Pb.production_record("created", "/r/landing-record", "0"), "/r/landing-record") == False{} : Bool}

def a_wrong_tag_record_is_refused():
  {==}

law a_truncated_record_is_refused:
  {receipt_published("published\t/r/landing-record\t0\t\t", "/r/landing-record") == False{} : Bool}

def a_truncated_record_is_refused():
  {==}

law a_nonzero_errno_record_is_refused:
  {receipt_qualified("qualified\t/r/landing-record\t13\t\t0\t", "/r/landing-record") == False{} : Bool}

def a_nonzero_errno_record_is_refused():
  {==}

law a_nonempty_phase_record_is_refused:
  {receipt_qualified("qualified\t/r/landing-record\t0\tpub\t0\t", "/r/landing-record") == False{} : Bool}

def a_nonempty_phase_record_is_refused():
  {==}

law a_nonempty_detail_record_is_refused:
  {receipt_qualified("qualified\t/r/landing-record\t0\t\t0\tdetail", "/r/landing-record") == False{} : Bool}

def a_nonempty_detail_record_is_refused():
  {==}

law a_trailing_byte_record_is_refused:
  {receipt_published("published\t/r/landing-record\t0\t\t0\t" ++ "x", "/r/landing-record") == False{} : Bool}

def a_trailing_byte_record_is_refused():
  {==}

# An admission is a decision over the whole attestation. A complete attempt is admitted; an incomplete
# one is refused for the reason its own evidence gives.
law a_complete_attempt_is_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis())))) == True{} : Bool}

def a_complete_attempt_is_admitted():
  {==}

law an_absent_capture_is_refused:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedAbsent{}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"))))) == False{} : Bool}

def an_absent_capture_is_refused():
  {==}

law a_missing_identity_is_refused:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityMissing{}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"))))) == False{} : Bool}

def a_missing_identity_is_refused():
  {==}

law a_missing_association_is_refused:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, AssociationMissing{}, fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"))))) == False{} : Bool}

def a_missing_association_is_refused():
  {==}

law a_missing_intent_is_refused:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), IntentMissing{})))) == False{} : Bool}

def a_missing_intent_is_refused():
  {==}

law a_failed_publication_is_refused:
  {ld_admitted(admission_of(fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageFailed{13, "i/o error"}, StageUnperformed{}, StageUnperformed{}))) == False{} : Bool}

def a_failed_publication_is_refused():
  {==}

law an_unperformed_qualification_is_refused:
  {ld_admitted(admission_of(fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageUnperformed{}, StageUnperformed{}))) == False{} : Bool}

def an_unperformed_qualification_is_refused():
  {==}

law a_mismatched_readback_is_refused:
  {ld_admitted(admission_of(fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{"other bytes"}))) == False{} : Bool}

def a_mismatched_readback_is_refused():
  {==}

law a_rejected_attempt_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedAbsent{}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder")))}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the attempt record was not admitted: the attempt evidence is incomplete"}} : FFLD}

def a_rejected_attempt_refuses_the_fast_forward():
  {==}

law a_rejected_attempt_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedAbsent{}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder")))}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the attempt record was not admitted: the attempt evidence is incomplete"}} : Ld}

def a_rejected_attempt_refuses_the_advance():
  {==}

# The mode and capture laws, each consuming a production helper. The framing strings are the ones the
# Tx.run_res contract parses: "exit 0\n..." succeeds, "exit 7\n" is a failed exit, "signal 9\n" is a
# signalled run, and unparseable text is malformed.
law a_held_preflight_refusal_keeps_its_selected_mode:
  {ld_adv_qualification(ld_adv_wrap(AdvBroken{"head unreadable"}, MutationHeld{"/holder"})) == QualDecided{MutationHeld{"/holder"}, ReadSkipped{}, ReadSkipped{}} : LdQualified}

def a_held_preflight_refusal_keeps_its_selected_mode():
  {==}

law an_unheld_capture_failure_keeps_its_selected_mode:
  {ld_adv_qualification(ld_adv_with(AdvBroken{"the target could not be read"}, T.CapturedFailed{13, "i/o error"}, MutationUnheld{})) == QualDecided{MutationUnheld{}, ReadSkipped{}, ReadSkipped{}} : LdQualified}

def an_unheld_capture_failure_keeps_its_selected_mode():
  {==}

law an_unheld_success_needs_the_exact_candidate_and_a_skipped_head:
  {qualification_landed_of(QualDecided{MutationUnheld{}, ReadObserved{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, ReadSkipped{}}, fixture_oid_candidate(), "tgt") == True{} : Bool}

def an_unheld_success_needs_the_exact_candidate_and_a_skipped_head():
  {==}

law a_held_success_needs_the_candidate_and_the_symbolic_target_head:
  {qualification_landed_of(QualDecided{MutationHeld{"/holder"}, ReadObserved{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, ReadObserved{T.GRun{0, "refs/heads/tgt\n"}}}, fixture_oid_candidate(), "tgt") == True{} : Bool}

def a_held_success_needs_the_candidate_and_the_symbolic_target_head():
  {==}

law a_held_attempt_without_a_head_read_is_not_landed:
  {qualification_landed_of(QualDecided{MutationHeld{"/holder"}, ReadObserved{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, ReadSkipped{}}, fixture_oid_candidate(), "tgt") == False{} : Bool}

def a_held_attempt_without_a_head_read_is_not_landed():
  {==}

law a_wrong_candidate_read_is_not_landed:
  {qualification_landed_of(QualDecided{MutationUnheld{}, ReadObserved{T.GRun{0, "other\n"}}, ReadSkipped{}}, fixture_oid_candidate(), "tgt") == False{} : Bool}

def a_wrong_candidate_read_is_not_landed():
  {==}

law a_wrong_symbolic_head_is_not_landed:
  {qualification_landed_of(QualDecided{MutationHeld{"/holder"}, ReadObserved{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, ReadObserved{T.GRun{0, "refs/heads/other\n"}}}, fixture_oid_candidate(), "tgt") == False{} : Bool}

def a_wrong_symbolic_head_is_not_landed():
  {==}

law an_unknown_mode_is_not_landed:
  {qualification_landed_of(QualDecided{MutationUnknown{}, ReadObserved{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, ReadObserved{T.GRun{0, "refs/heads/tgt\n"}}}, fixture_oid_candidate(), "tgt") == False{} : Bool}

def an_unknown_mode_is_not_landed():
  {==}

law a_successful_mutation_framing_is_landed_evidence:
  {capture_landed(T.CapturedDone{"exit 0\nrest", "diagnostics bytes"}) == True{} : Bool}

def a_successful_mutation_framing_is_landed_evidence():
  {==}

law a_nonzero_mutation_framing_is_not_landed_evidence:
  {capture_landed(T.CapturedDone{"exit 7\n", "diagnostics bytes"}) == False{} : Bool}

def a_nonzero_mutation_framing_is_not_landed_evidence():
  {==}

law a_signalled_mutation_framing_is_not_landed_evidence:
  {capture_landed(T.CapturedDone{"signal 9\n", "diagnostics bytes"}) == False{} : Bool}

def a_signalled_mutation_framing_is_not_landed_evidence():
  {==}

law a_malformed_mutation_framing_is_not_landed_evidence:
  {capture_landed(T.CapturedDone{"not a run result", "diagnostics bytes"}) == False{} : Bool}

def a_malformed_mutation_framing_is_not_landed_evidence():
  {==}
law a_held_refusal_retains_the_selected_path:
  {ld_adv_wt_head_same(False{}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), LdAdvContext{1, "g", "/art", "attempt", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt")}) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvHolderChanged{"/holder"}, MutationHeld{"/holder"}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_held_refusal_retains_the_selected_path():
  {==}
law an_unheld_capture_failure_retains_code_detail_and_mode:
  {ld_adv_cas_capture("tgt", fixture_oid_candidate(), "/r", Fail{(13, "i/o error")}) == IO.pure(LdAdvObs, ld_adv_with(ld_adv_cas(T.GBroken{"i/o error"}), T.CapturedFailed{13, "i/o error"}, MutationUnheld{})) : IO(LdAdvObs)}

def an_unheld_capture_failure_retains_code_detail_and_mode():
  {==}

law a_complete_unheld_attempt_is_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), fixture_unheld_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis())))) == True{} : Bool}

def a_complete_unheld_attempt_is_admitted():
  {==}
law a_failed_capture_is_refused:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedFailed{13, "i/o error"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"))))) == False{} : Bool}

def a_failed_capture_is_refused():
  {==}
law an_unheld_landed_advance_answers_landed:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_unheld_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "tgt", fixture_oid_candidate()) == FFDone{T.LLanded{"tgt", fixture_oid_candidate()}} : FFLD}

def an_unheld_landed_advance_answers_landed():
  {==}

law an_unheld_landed_advance_answers_the_landed_commit:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_unheld_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "tgt", fixture_oid_candidate()) == LdDone{T.LLanded{"tgt", fixture_oid_candidate()}} : Ld}

def an_unheld_landed_advance_answers_the_landed_commit():
  {==}

law a_mismatched_caller_target_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "other", fixture_oid_candidate()) == FFDone{T.LBlocked{"the retained attempt does not name this target and candidate"}} : FFLD}

def a_mismatched_caller_target_refuses_the_fast_forward():
  {==}
law a_mismatched_caller_target_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "other", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the retained attempt does not name this target and candidate"}} : Ld}

def a_mismatched_caller_target_refuses_the_advance():
  {==}
law a_mismatched_caller_candidate_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "tgt", "other") == FFDone{T.LBlocked{"the retained attempt does not name this target and candidate"}} : FFLD}

def a_mismatched_caller_candidate_refuses_the_fast_forward():
  {==}
law a_mismatched_caller_candidate_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "tgt", "other") == LdFail{T.FCmd{"land", "the retained attempt does not name this target and candidate"}} : Ld}

def a_mismatched_caller_candidate_refuses_the_advance():
  {==}
law a_reservation_that_differs_from_the_evidence_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of("wrong", fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the retained attempt does not name this target and candidate"}} : FFLD}

def a_reservation_that_differs_from_the_evidence_refuses_the_fast_forward():
  {==}
law a_reservation_that_differs_from_the_evidence_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of("wrong", fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the retained attempt does not name this target and candidate"}} : Ld}

def a_reservation_that_differs_from_the_evidence_refuses_the_advance():
  {==}
law a_malformed_publication_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{"garbage"}, StageSucceeded{Pb.production_record("qualified", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{attempt_record(fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))})}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the attempt record was not admitted: the attempt record was not published"}} : FFLD}

def a_malformed_publication_refuses_the_fast_forward():
  {==}
law a_malformed_publication_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{"garbage"}, StageSucceeded{Pb.production_record("qualified", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{attempt_record(fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))})}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the attempt record was not admitted: the attempt record was not published"}} : Ld}

def a_malformed_publication_refuses_the_advance():
  {==}
law a_wrong_path_publication_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", "/wrong/landing-record", "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{attempt_record(fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))})}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the attempt record was not admitted: the attempt record was not published"}} : FFLD}

def a_wrong_path_publication_refuses_the_fast_forward():
  {==}
law a_wrong_path_publication_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", "/wrong/landing-record", "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{attempt_record(fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))})}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the attempt record was not admitted: the attempt record was not published"}} : Ld}

def a_wrong_path_publication_refuses_the_advance():
  {==}
law a_malformed_qualification_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{"garbage"}, StageSucceeded{attempt_record(fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))})}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the attempt record was not admitted: the attempt record is not durable"}} : FFLD}

def a_malformed_qualification_refuses_the_fast_forward():
  {==}
law a_malformed_qualification_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{"garbage"}, StageSucceeded{attempt_record(fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))})}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the attempt record was not admitted: the attempt record is not durable"}} : Ld}

def a_malformed_qualification_refuses_the_advance():
  {==}
law a_wrong_path_qualification_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{Pb.production_record("qualified", "/wrong/landing-record", "0")}, StageSucceeded{attempt_record(fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))})}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the attempt record was not admitted: the attempt record is not durable"}} : FFLD}

def a_wrong_path_qualification_refuses_the_fast_forward():
  {==}
law a_wrong_path_qualification_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{Pb.production_record("qualified", "/wrong/landing-record", "0")}, StageSucceeded{attempt_record(fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()))})}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the attempt record was not admitted: the attempt record is not durable"}} : Ld}

def a_wrong_path_qualification_refuses_the_advance():
  {==}
law a_mismatched_readback_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{"other bytes"})}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the attempt record was not admitted: the attempt record does not read back as published"}} : FFLD}

def a_mismatched_readback_refuses_the_fast_forward():
  {==}
law a_mismatched_readback_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_stages(fixture_reserved(), fixture_held_evidence(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis()), StageSucceeded{Pb.production_record("published", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path(fixture_reserved()), "0")}, StageSucceeded{"other bytes"})}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the attempt record was not admitted: the attempt record does not read back as published"}} : Ld}

def a_mismatched_readback_refuses_the_advance():
  {==}
law incomplete_evidence_with_success_looking_stages_refuses_the_fast_forward:
  {ff_stage5_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedAbsent{}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder")))}, "tgt", fixture_oid_candidate()) == FFDone{T.LBlocked{"the attempt record was not admitted: the attempt evidence is incomplete"}} : FFLD}

def incomplete_evidence_with_success_looking_stages_refuses_the_fast_forward():
  {==}
law incomplete_evidence_with_success_looking_stages_refuses_the_advance:
  {ld_advance_shared_answer(SharedAdvanced{fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedAbsent{}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder")))}, "tgt", fixture_oid_candidate()) == LdFail{T.FCmd{"land", "the attempt record was not admitted: the attempt evidence is incomplete"}} : Ld}

def incomplete_evidence_with_success_looking_stages_refuses_the_advance():
  {==}

law a_failed_publication_stops_the_chain_with_two_unperformed_stages:
  for reserved: String
  for evidence: AttemptEvidence
  for code: U32
  for detail: String
  {ld_attest_publication_seen(reserved, evidence, attest_stage(Fail{(code, detail)})) == IO.pure(Attestation, Attestation{reserved, evidence, StageFailed{code, detail}, StageUnperformed{}, StageUnperformed{}}) : IO(Attestation)}

def a_failed_publication_stops_the_chain_with_two_unperformed_stages(reserved,evidence,code,detail):
  {==}
law a_malformed_publication_record_stops_the_chain:
  for reserved: String
  for evidence: AttemptEvidence
  for raw: String
  {ld_attest_publication_seen(reserved, evidence, attest_stage(Done{Tx.str_cat("wrong", raw)})) == IO.pure(Attestation, Attestation{reserved, evidence, StageSucceeded{Tx.str_cat("wrong", raw)}, StageUnperformed{}, StageUnperformed{}}) : IO(Attestation)}

def a_malformed_publication_record_stops_the_chain(reserved,evidence,raw):
  {==}
law a_wrong_path_publication_record_stops_the_chain:
  for evidence: AttemptEvidence
  {ld_attest_publication_seen("r", evidence, attest_stage(Done{Pb.production_record("published", "/other/landing-record", "0")})) == IO.pure(Attestation, Attestation{"r", evidence, StageSucceeded{Pb.production_record("published", "/other/landing-record", "0")}, StageUnperformed{}, StageUnperformed{}}) : IO(Attestation)}

def a_wrong_path_publication_record_stops_the_chain(evidence):
  {==}
law a_failed_qualification_stops_before_the_readback:
  for reserved: String
  for evidence: AttemptEvidence
  for code: U32
  for detail: String
  {ld_attest_qualification_seen(reserved, evidence, StageSucceeded{Pb.production_record("published", landing_record_path(reserved), "0")}, attest_stage(Fail{(code, detail)})) == IO.pure(Attestation, Attestation{reserved, evidence, StageSucceeded{Pb.production_record("published", landing_record_path(reserved), "0")}, StageFailed{code, detail}, StageUnperformed{}}) : IO(Attestation)}

def a_failed_qualification_stops_before_the_readback(reserved,evidence,code,detail):
  {==}
law a_malformed_qualification_record_stops_before_the_readback:
  for reserved: String
  for evidence: AttemptEvidence
  for raw: String
  {ld_attest_qualification_seen(reserved, evidence, StageSucceeded{Pb.production_record("published", landing_record_path(reserved), "0")}, attest_stage(Done{Tx.str_cat("wrong", raw)})) == IO.pure(Attestation, Attestation{reserved, evidence, StageSucceeded{Pb.production_record("published", landing_record_path(reserved), "0")}, StageSucceeded{Tx.str_cat("wrong", raw)}, StageUnperformed{}}) : IO(Attestation)}

def a_malformed_qualification_record_stops_before_the_readback(reserved,evidence,raw):
  {==}
law a_wrong_path_qualification_record_stops_before_the_readback:
  for evidence: AttemptEvidence
  {ld_attest_qualification_seen("r", evidence, StageSucceeded{Pb.production_record("published", landing_record_path("r"), "0")}, attest_stage(Done{Pb.production_record("qualified", "/other/landing-record", "0")})) == IO.pure(Attestation, Attestation{"r", evidence, StageSucceeded{Pb.production_record("published", landing_record_path("r"), "0")}, StageSucceeded{Pb.production_record("qualified", "/other/landing-record", "0")}, StageUnperformed{}}) : IO(Attestation)}

def a_wrong_path_qualification_record_stops_before_the_readback(evidence):
  {==}
law a_failed_readback_is_retained_beside_the_unchanged_attestation:
  for reserved: String
  for evidence: AttemptEvidence
  for publication: StageResult
  for qualification: StageResult
  for code: U32
  for detail: String
  {ld_attest_readback_seen(reserved, evidence, publication, qualification, Fail{(code, detail)}) == IO.pure(Attestation, Attestation{reserved, evidence, publication, qualification, StageFailed{code, detail}}) : IO(Attestation)}

def a_failed_readback_is_retained_beside_the_unchanged_attestation(reserved,evidence,publication,qualification,code,detail):
  {==}
law a_successful_readback_is_retained_verbatim:
  for reserved: String
  for evidence: AttemptEvidence
  for publication: StageResult
  for qualification: StageResult
  for raw: String
  {ld_attest_readback_seen(reserved, evidence, publication, qualification, Done{raw}) == IO.pure(Attestation, Attestation{reserved, evidence, publication, qualification, StageSucceeded{raw}}) : IO(Attestation)}

def a_successful_readback_is_retained_verbatim(reserved,evidence,publication,qualification,raw):
  {==}
law the_attestation_publishes_the_attempt_record_once:
  for reserved: String
  for evidence: AttemptEvidence
  {ld_attest(reserved, evidence) == (do IO<Attestation>:
    published : Result<&1, &1, U32 & String, String> <- Rec.Receipt.publish(reserved, "landing-record", attempt_record(evidence))
    ld_attest_publication_seen(reserved, evidence, attest_stage(published))) : IO(Attestation)}

def the_attestation_publishes_the_attempt_record_once(reserved,evidence):
  {==}
law a_published_record_continues_to_the_real_qualification:
  for evidence: AttemptEvidence
  {ld_attest_publication_seen("r", evidence, StageSucceeded{Pb.production_record("published", landing_record_path("r"), "0")}) == (do IO<Attestation>:
    qualified : Result<&1, &1, U32 & String, String> <- Rec.Receipt.qualify(landing_record_path("r"))
    ld_attest_qualification_seen("r", evidence, StageSucceeded{Pb.production_record("published", landing_record_path("r"), "0")}, attest_stage(qualified))) : IO(Attestation)}

def a_published_record_continues_to_the_real_qualification(evidence):
  {==}
law a_qualified_record_continues_to_the_real_readback:
  for evidence: AttemptEvidence
  {ld_attest_qualification_seen("r", evidence, StageSucceeded{Pb.production_record("published", landing_record_path("r"), "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path("r"), "0")}) == (do IO<Attestation>:
    seen : Result<&1, &1, U32 & String, String> <- Text.Text.read(landing_record_path("r"))
    ld_attest_readback_seen("r", evidence, StageSucceeded{Pb.production_record("published", landing_record_path("r"), "0")}, StageSucceeded{Pb.production_record("qualified", landing_record_path("r"), "0")}, seen)) : IO(Attestation)}

def a_qualified_record_continues_to_the_real_readback(evidence):
  {==}

law the_common_read_threads_its_normalized_value_and_its_observation:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for code: U32
  for out: String
  {shared_common_read(repo, target, cand, basis, T.GRun{code, out}) == Bool.pick(IO(SharedLanding), U32.is_eq(code, 0), shared_claimed(repo, target, cand, basis, Tx.trim_nl(out), T.GRun{code, out}), IO.pure(SharedLanding, SharedCommonUnreadable{T.GRun{code, out}})) : IO(SharedLanding)}

def the_common_read_threads_its_normalized_value_and_its_observation(repo,target,cand,basis,code,out):
  {==}
law the_claim_continues_with_the_original_common_read:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for common: String
  for observed: T.GitOut
  {shared_claimed(repo, target, cand, basis, common, observed) == (do IO<SharedLanding>:
    claimed : Result<&1, &1, U32 & String, Maybe<U32>> <- Rec.Receipt.claim(common, target)
    shared_claim_decided(repo, target, cand, basis, common, observed, claimed)) : IO(SharedLanding)}

def the_claim_continues_with_the_original_common_read(repo,target,cand,basis,common,observed):
  {==}
law the_attempt_evidence_retains_its_identity_observation:
  for common: String
  for observed: T.GitOut
  for target: String
  {evidence_identity(fixture_evidence_of(fixture_reserved(), "/common", target, fixture_oid_candidate(), fixture_oid_basis(), T.CapturedDone{"exit 0\nrest", "diag"}, fixture_held_qualification(fixture_oid_candidate(), target), IdentityObserved{common, observed, target}, AssociationMissing{}, IntentMissing{})) == IdentityObserved{common, observed, target} : IdentityEvidence}

def the_attempt_evidence_retains_its_identity_observation(common,observed,target):
  {==}
law an_identity_with_a_matching_observation_is_bound:
  {identity_bound(IdentityObserved{"c", T.GRun{0, "c"}, "tgt"}, "tgt") == True{} : Bool}

def an_identity_with_a_matching_observation_is_bound():
  {==}
law an_identity_with_a_wrong_target_is_not_bound:
  {identity_bound(IdentityObserved{"c", T.GRun{0, "c"}, "other"}, "tgt") == False{} : Bool}

def an_identity_with_a_wrong_target_is_not_bound():
  {==}
law an_identity_whose_observation_differs_is_not_bound:
  {identity_bound(IdentityObserved{"c", T.GRun{0, "different"}, "tgt"}, "tgt") == False{} : Bool}

def an_identity_whose_observation_differs_is_not_bound():
  {==}
law an_identity_with_a_nonzero_read_is_not_bound:
  {identity_bound(IdentityObserved{"c", T.GRun{7, "c"}, "tgt"}, "tgt") == False{} : Bool}

def an_identity_with_a_nonzero_read_is_not_bound():
  {==}
law an_identity_with_a_broken_read_is_not_bound:
  {identity_bound(IdentityObserved{"c", T.GBroken{"unreadable"}, "tgt"}, "tgt") == False{} : Bool}

def an_identity_with_a_broken_read_is_not_bound():
  {==}

law the_attested_attempt_retains_the_identity_observation:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for guard: String
  for common: String
  for common_observed: T.GitOut
  for reserved: String
  for reservation: ReservationIdentity
  for obs: LdAdvObs
  {shared_reserved_attested(repo, target, cand, basis, guard, common, common_observed, reserved, reservation, obs, Done{Unit{}}) == (do IO<SharedLanding>:
    attestation : Attestation <- ld_attest(reserved, AttemptEvidence{reserved, repo, target, cand, basis, guard, shared_parent_path(reserved, "stderr"), ld_adv_of(obs), ld_adv_capture(obs), ld_adv_qualification(obs), T.ReleaseDone{}, IdentityObserved{common, common_observed, target}, ld_adv_association(obs), ld_adv_intent(obs), reservation})
    IO.pure(SharedLanding, SharedAdvanced{attestation})) : IO(SharedLanding)}

def the_attested_attempt_retains_the_identity_observation(repo,target,cand,basis,guard,common,common_observed,reserved,reservation,obs):
  {==}
law a_failed_release_still_retains_the_identity_observation:
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for guard: String
  for common: String
  for common_observed: T.GitOut
  for reserved: String
  for reservation: ReservationIdentity
  for obs: LdAdvObs
  for code: U32
  for detail: String
  {shared_reserved_attested(repo, target, cand, basis, guard, common, common_observed, reserved, reservation, obs, Fail{(code, detail)}) == (do IO<SharedLanding>:
    attestation : Attestation <- ld_attest(reserved, AttemptEvidence{reserved, repo, target, cand, basis, guard, shared_parent_path(reserved, "stderr"), ld_adv_of(obs), ld_adv_capture(obs), ld_adv_qualification(obs), T.ReleaseFailed{code, detail}, IdentityObserved{common, common_observed, target}, ld_adv_association(obs), ld_adv_intent(obs), reservation})
    IO.pure(SharedLanding, SharedAdvanced{attestation})) : IO(SharedLanding)}

def a_failed_release_still_retains_the_identity_observation(repo,target,cand,basis,guard,common,common_observed,reserved,reservation,obs,code,detail):
  {==}
law a_guard_path_failure_keeps_its_step_and_error:
  {shared_guard_named(1, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/common", T.GRun{0, "/common"}, Fail{7 & "guard path failed"}) == (do IO<SharedLanding>:
    released : Result<&1, &1, U32 & String, Unit> <- Rec.Receipt.release(1)
    IO.pure(SharedLanding, SharedStepFailed{"guard", T.HostError{7, "guard path failed"}, T.release_raw_of(released)})) : IO(SharedLanding)}

def a_guard_path_failure_keeps_its_step_and_error():
  {==}

law an_attempt_token_failure_keeps_its_step_and_error:
  {shared_token_named(1, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/common", T.GRun{0, "/common"}, "the-guard", Fail{9 & "token failed"}) == (do IO<SharedLanding>:
    released : Result<&1, &1, U32 & String, Unit> <- Rec.Receipt.release(1)
    IO.pure(SharedLanding, SharedStepFailed{"token", T.HostError{9, "token failed"}, T.release_raw_of(released)})) : IO(SharedLanding)}

def an_attempt_token_failure_keeps_its_step_and_error():
  {==}

law a_claim_failure_keeps_its_error:
  {shared_claim_decided("/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/common", T.GRun{0, "/common"}, Fail{3 & "claim failed"}) == IO.pure(SharedLanding, SharedClaimFailed{T.HostError{3, "claim failed"}}) : IO(SharedLanding)}

def a_claim_failure_keeps_its_error():
  {==}

law a_claim_that_finds_the_target_held_reports_the_busy_target:
  {shared_claim_decided("/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/common", T.GRun{0, "/common"}, Done{None{}}) == IO.pure(SharedLanding, SharedGuardBusy{"tgt"}) : IO(SharedLanding)}

def a_claim_that_finds_the_target_held_reports_the_busy_target():
  {==}

law the_guard_answer_continues_to_the_real_token_call:
  for handle: U32
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for common: String
  for common_observed: T.GitOut
  for guard: String
  {shared_guard_named(handle, repo, target, cand, basis, common, common_observed, Done{guard}) == (do IO<SharedLanding>:
    token : Result<&1, &1, U32 & String, String> <- Rec.Receipt.attempt_token(target)
    shared_token_named(handle, repo, target, cand, basis, common, common_observed, guard, token)) : IO(SharedLanding)}

def the_guard_answer_continues_to_the_real_token_call(handle,repo,target,cand,basis,common,common_observed,guard):
  {==}
law the_token_answer_continues_to_the_real_ensure_call:
  for handle: U32
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for common: String
  for common_observed: T.GitOut
  for guard: String
  for token: String
  {shared_token_named(handle, repo, target, cand, basis, common, common_observed, guard, Done{token}) == (do IO<SharedLanding>:
    ensured : Result<&1, &1, U32 & String, String> <- Rec.Receipt.ensure(shared_attempts_parent(common))
    shared_parent_ensured(handle, repo, target, cand, basis, guard, common, common_observed, shared_attempts_parent(common), Tx.str_cat(token, Tx.str_cat("-", Tx.str_cat(cand, Tx.str_cat("-", basis)))), ensured)) : IO(SharedLanding)}

def the_token_answer_continues_to_the_real_ensure_call(handle,repo,target,cand,basis,common,common_observed,guard,token):
  {==}
law a_created_parent_continues_to_the_reservation_loop:
  for handle: U32
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for guard: String
  for common: String
  for common_observed: T.GitOut
  for parent: String
  for base: String
  {shared_parent_classified(handle, repo, target, cand, basis, guard, common, common_observed, parent, base, Pb.production_record("created", parent, "0")) == shared_reserve_loop(handle, repo, target, cand, basis, guard, common, common_observed, parent, base) : IO(SharedLanding)}

def a_created_parent_continues_to_the_reservation_loop(handle,repo,target,cand,basis,guard,common,common_observed,parent,base):
  {==}
law a_present_record_continues_to_the_reservation_loop:
  for handle: U32
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for guard: String
  for common: String
  for common_observed: T.GitOut
  for parent: String
  for base: String
  {shared_parent_present(handle, repo, target, cand, basis, guard, common, common_observed, parent, base, Pb.production_record("present", parent, "0")) == shared_reserve_loop(handle, repo, target, cand, basis, guard, common, common_observed, parent, base) : IO(SharedLanding)}

def a_present_record_continues_to_the_reservation_loop(handle,repo,target,cand,basis,guard,common,common_observed,parent,base):
  {==}

law a_successful_common_read_retains_its_raw_bytes_and_normalizes_its_value:
  {shared_common_read("/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.GRun{0, "common/path\n"}) == shared_claimed("/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "common/path", T.GRun{0, "common/path\n"}) : IO(SharedLanding)}

def a_successful_common_read_retains_its_raw_bytes_and_normalizes_its_value():
  {==}
law an_identity_whose_observation_carries_the_newline_is_bound:
  {identity_bound(IdentityObserved{"common/path", T.GRun{0, "common/path\n"}, "tgt"}, "tgt") == True{} : Bool}

def an_identity_whose_observation_carries_the_newline_is_bound():
  {==}
law a_nonzero_common_read_keeps_its_observation_and_refuses:
  {shared_common_read("/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.GRun{7, "unreadable\n"}) == IO.pure(SharedLanding, SharedCommonUnreadable{T.GRun{7, "unreadable\n"}}) : IO(SharedLanding)}

def a_nonzero_common_read_keeps_its_observation_and_refuses():
  {==}
law a_broken_common_read_keeps_its_detail_and_refuses:
  {shared_common_read("/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.GBroken{"no such repository"}) == IO.pure(SharedLanding, SharedCommonUnreadable{T.GBroken{"no such repository"}}) : IO(SharedLanding)}

def a_broken_common_read_keeps_its_detail_and_refuses():
  {==}

law a_present_record_continues_through_the_present_handler:
  for handle: U32
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for guard: String
  for common: String
  for common_observed: T.GitOut
  for parent: String
  for base: String
  {shared_parent_classified(handle, repo, target, cand, basis, guard, common, common_observed, parent, base, Pb.production_record("present", parent, "0")) == shared_parent_present(handle, repo, target, cand, basis, guard, common, common_observed, parent, base, Pb.production_record("present", parent, "0")) : IO(SharedLanding)}

def a_present_record_continues_through_the_present_handler(handle,repo,target,cand,basis,guard,common,common_observed,parent,base):
  {==}
law a_created_reservation_continues_to_the_reserved_continue_call:
  for handle: U32
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for guard: String
  for common: String
  for common_observed: T.GitOut
  for parent: String
  for base: String
  {shared_reserve_observed(handle, repo, target, cand, basis, guard, common, common_observed, parent, base, Done{Pb.production_record("created", shared_parent_path(parent, base), "0")}) == shared_reserved_continue(handle, repo, target, cand, basis, guard, common, common_observed, shared_parent_path(parent, base), base, parent) : IO(SharedLanding)}

def a_created_reservation_continues_to_the_reserved_continue_call(handle,repo,target,cand,basis,guard,common,common_observed,parent,base):
  {==}

law an_existing_reservation_continues_to_the_next_reserve_attempt:
  for handle: U32
  for repo: String
  for target: String
  for cand: String
  for basis: String
  for guard: String
  for common: String
  for common_observed: T.GitOut
  for parent: String
  for base: String
  {shared_reserve_observed(handle, repo, target, cand, basis, guard, common, common_observed, parent, base, Done{Pb.production_record("existing", shared_parent_path(parent, base), "0")}) == (do IO<SharedLanding>:
    retry : Result<&1, &1, U32 & String, String> <- Rec.Receipt.reserve_attempt(parent, shared_attempt_next_name(base))
    shared_reserve_observed(handle, repo, target, cand, basis, guard, common, common_observed, parent, shared_attempt_next_name(base), retry)) : IO(SharedLanding)}

def an_existing_reservation_continues_to_the_next_reserve_attempt(handle,repo,target,cand,basis,guard,common,common_observed,parent,base):
  {==}
law a_blocked_selection_runs_no_association_and_no_mutation:
  for ctx: LdAdvCtx
  {ld_adv_associated(HoldBlocked{"the worktree listing could not be read"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvBroken{"the worktree listing could not be read"}, MutationUnknown{}, AssociationMissing{}, IntentMissing{}}) : IO(LdAdvObs)}

def a_blocked_selection_runs_no_association_and_no_mutation(ctx):
  {==}

law the_shared_association_request_carries_the_reserved_attempt_and_the_canonical_common:
  for ctx: LdAdvCtx
  {ld_assoc_request(ctx, "/holder", "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis()) == A.AssociationRequested{ladvctx_attempt(ctx), ladvctx_common(ctx), "tgt", "/repo", fixture_oid_candidate(), fixture_oid_basis(), "/holder", ""} : A.AssociationRequest}

def the_shared_association_request_carries_the_reserved_attempt_and_the_canonical_common(ctx):
  {==}

law an_observed_association_rides_on_the_selected_route_observation:
  for obs: LdAdvObs
  {ld_adv_association(ld_adv_keep_association(obs, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"))) == fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt") : AssociationEvidence}

def an_observed_association_rides_on_the_selected_route_observation(obs):
  {==}

law an_observed_association_rides_on_the_no_capture_observation:
  {ld_adv_keep_association(LdAdvNoCapture{AdvLanded{}, MutationUnheld{}, AssociationMissing{}, IntentMissing{}}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt")) == LdAdvNoCapture{AdvLanded{}, MutationUnheld{}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), IntentMissing{}} : LdAdvObs}

def an_observed_association_rides_on_the_no_capture_observation():
  {==}

law an_observed_association_rides_on_the_captured_observation:
  {ld_adv_keep_association(LdAdvCaptured{AdvLanded{}, T.CapturedDone{"exit 0\n", "diag"}, MutationHeld{"/holder"}, AssociationMissing{}, IntentMissing{}}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt")) == LdAdvCaptured{AdvLanded{}, T.CapturedDone{"exit 0\n", "diag"}, MutationHeld{"/holder"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), IntentMissing{}} : LdAdvObs}

def an_observed_association_rides_on_the_captured_observation():
  {==}

law an_observed_association_rides_on_the_qualified_observation:
  {ld_adv_keep_association(LdAdvQualified{AdvLanded{}, T.CapturedDone{"exit 0\n", "diag"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), AssociationMissing{}, IntentMissing{}}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt")) == LdAdvQualified{AdvLanded{}, T.CapturedDone{"exit 0\n", "diag"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), IntentMissing{}} : LdAdvObs}

def an_observed_association_rides_on_the_qualified_observation():
  {==}

law the_held_decision_handler_stops_on_a_refused_association:
  for ctx: LdAdvCtx
  {ld_adv_held_decided(A.AssociationRefused{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "holder-common", T.GBroken{"holder answers /other"}, fixture_reads()}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"holder-common"}, MutationHeld{"/holder"}, AssociationRefused{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "holder-common", T.GBroken{"holder answers /other"}, fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def the_held_decision_handler_stops_on_a_refused_association(ctx):
  {==}

law the_unheld_decision_handler_stops_on_a_refused_association:
  for ctx: LdAdvCtx
  {ld_adv_unheld_decided(A.AssociationRefused{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "common", T.GBroken{"holder answers /other"}, fixture_reads()}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"common"}, MutationUnheld{}, AssociationRefused{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "common", T.GBroken{"holder answers /other"}, fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def the_unheld_decision_handler_stops_on_a_refused_association(ctx):
  {==}

law a_matching_association_continues_the_held_route_into_its_mutation:
  for ctx: LdAdvCtx
  {ld_adv_held_decided(fixture_matching_held(ctx), "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == (do IO<LdAdvObs>:
    published : Pb.IntentPublish <- Pb.Intent.publish_intent(shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), ladvctx_reserved(ctx), "intent", Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt"))
    ld_adv_intent_published(published, shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), fixture_matching_held_evidence(ctx), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx, "/holder")) : IO(LdAdvObs)}

def a_matching_association_continues_the_held_route_into_its_mutation(ctx):
  {==}

law a_matching_association_continues_the_unheld_route_into_its_mutation:
  for ctx: LdAdvCtx
  {ld_adv_unheld_decided(fixture_matching_unheld(ctx), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == (do IO<LdAdvObs>:
    published : Pb.IntentPublish <- Pb.Intent.publish_intent(shared_intent_input(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), ladvctx_reserved(ctx), "intent", Lg.intent_content(fixture_oid_candidate(), fixture_oid_basis(), "tgt"))
    ld_adv_intent_published(published, shared_intent_input(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), fixture_matching_unheld_evidence(ctx), MutationUnheld{}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx, "/r")) : IO(LdAdvObs)}

def a_matching_association_continues_the_unheld_route_into_its_mutation(ctx):
  {==}

law a_refused_publication_stops_the_held_route_without_a_mutation:
  for ctx: LdAdvCtx
  {ld_adv_intent_published(Pb.PublishRefused{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publish", "intent", "refused bytes"}, shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), fixture_matching_held_evidence(ctx), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx, "/holder") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"publication-refused"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(ctx), IntentBound{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), IntentPublished{Pb.PublishRefused{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publish", "intent", "refused bytes"}}, IntentUnprepared{}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_refused_publication_stops_the_held_route_without_a_mutation(ctx):
  {==}

law a_pending_publication_stops_the_unheld_route_without_a_mutation:
  for ctx: LdAdvCtx
  {ld_adv_intent_published(Pb.PublishExistingPending{shared_intent_input(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "pending bytes", shared_intent_path(ctx)}, shared_intent_input(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), fixture_matching_unheld_evidence(ctx), MutationUnheld{}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx, "/r") == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"publication-existing-pending"}, MutationUnheld{}, fixture_matching_unheld_evidence(ctx), IntentBound{shared_intent_input(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), IntentPublished{Pb.PublishExistingPending{shared_intent_input(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "pending bytes", shared_intent_path(ctx)}}, IntentUnprepared{}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_pending_publication_stops_the_unheld_route_without_a_mutation(ctx):
  {==}

law an_unready_holder_stops_the_held_route_keeping_the_qualification:
  for ctx: LdAdvCtx
  {ld_adv_intent_observed(It.IntentUnready{"holder", "the worktree is unready", "record bytes"}, shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), "admitted bytes", shared_intent_path(ctx), Pb.PublishRefused{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publish", "intent", "refused bytes"}, "/holder", fixture_matching_held_evidence(ctx), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"holder-unready"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(ctx), IntentBound{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), IntentPublished{Pb.PublishRefused{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publish", "intent", "refused bytes"}}, IntentQualified{"admitted bytes", shared_intent_path(ctx)}, IntentHolderUnready{"holder", "the worktree is unready", "record bytes"}}}) : IO(LdAdvObs)}

def an_unready_holder_stops_the_held_route_keeping_the_qualification(ctx):
  {==}

law a_pending_holder_stops_the_held_route_keeping_the_qualification:
  for ctx: LdAdvCtx
  {ld_adv_intent_observed(It.IntentPending{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "record bytes", "the holder answers every read"}, shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), "admitted bytes", shared_intent_path(ctx), Pb.PublishRefused{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publish", "intent", "refused bytes"}, "/holder", fixture_matching_held_evidence(ctx), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"holder-pending"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(ctx), IntentBound{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), IntentPublished{Pb.PublishRefused{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publish", "intent", "refused bytes"}}, IntentQualified{"admitted bytes", shared_intent_path(ctx)}, IntentHolderPending{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "record bytes", "the holder answers every read"}}}) : IO(LdAdvObs)}

def a_pending_holder_stops_the_held_route_keeping_the_qualification(ctx):
  {==}

law a_failed_holder_read_stops_the_held_route_with_the_host_error:
  for ctx: LdAdvCtx
  {ld_adv_intent_observed(It.IntentHostFailed{"holder", shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), T.HostError{128, "fatal: not a git repository"}}, shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), "admitted bytes", shared_intent_path(ctx), Pb.PublishRefused{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publish", "intent", "refused bytes"}, "/holder", fixture_matching_held_evidence(ctx), MutationHeld{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"holder-host-failed"}, MutationHeld{"/holder"}, fixture_matching_held_evidence(ctx), IntentBound{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), shared_intent_path(ctx), IntentPublished{Pb.PublishRefused{shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "publish", "intent", "refused bytes"}}, IntentQualified{"admitted bytes", shared_intent_path(ctx)}, IntentHolderFailed{"holder", shared_intent_input(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), T.HostError{128, "fatal: not a git repository"}}}}) : IO(LdAdvObs)}

def a_failed_holder_read_stops_the_held_route_with_the_host_error(ctx):
  {==}

law a_decided_mismatch_stops_the_unheld_route_without_a_holder_read:
  {ld_adv_intent_decided(intent_bound(IntentBound{fixture_intent_request(shared_parent_path(shared_attempts_parent("/common"), "attempt-1"), "/r", "other", fixture_oid_candidate(), fixture_oid_basis(), "/r", "attempt-1", "/common"), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/r")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderUnperformed{}}, ladvctx_reserved(fixture_consume_ctx()), ladvctx_attempt(fixture_consume_ctx()), ladvctx_common(fixture_consume_ctx()), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/r", MutationUnheld{}), fixture_intent_request(shared_parent_path(shared_attempts_parent("/common"), "attempt-1"), "/r", "other", fixture_oid_candidate(), fixture_oid_basis(), "/r", "attempt-1", "/common"), shared_intent_path(fixture_consume_ctx()), Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx()), fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/r"), IntentHolderUnperformed{}, fixture_matching_unheld_evidence(fixture_consume_ctx()), MutationUnheld{}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_consume_ctx()) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvIntentRefused{"intent-mismatch"}, MutationUnheld{}, fixture_matching_unheld_evidence(fixture_consume_ctx()), IntentBound{fixture_intent_request(shared_parent_path(shared_attempts_parent("/common"), "attempt-1"), "/r", "other", fixture_oid_candidate(), fixture_oid_basis(), "/r", "attempt-1", "/common"), shared_intent_path(fixture_consume_ctx()), IntentPublished{fixture_intent_published(fixture_consume_ctx(), "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/r")}, IntentQualified{Pb.production_record("qualified", shared_intent_path(fixture_consume_ctx()), "0"), shared_intent_path(fixture_consume_ctx())}, IntentHolderUnperformed{}}}) : IO(LdAdvObs)}

def a_decided_mismatch_stops_the_unheld_route_without_a_holder_read():
  {==}


law a_mismatched_returned_candidate_stops_the_held_route_before_the_mutation:
  for ctx: LdAdvCtx
  {ld_adv_held_decided(A.AssociationHeld{ld_assoc_request(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "other", fixture_oid_basis(), fixture_oid_basis(), ladvctx_common(ctx), ladvctx_common(ctx), fixture_reads()}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"returned-candidate"}, MutationHeld{"/holder"}, AssociationObserved{"returned-candidate", ld_assoc_request(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "other", fixture_oid_basis(), fixture_oid_basis(), ladvctx_common(ctx), ladvctx_common(ctx), fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def a_mismatched_returned_candidate_stops_the_held_route_before_the_mutation(ctx):
  {==}

law a_mismatched_returned_head_stops_the_unheld_route_before_the_mutation:
  for ctx: LdAdvCtx
  {ld_adv_unheld_decided(A.AssociationHeld{ld_assoc_request(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), "other", ladvctx_common(ctx), ladvctx_common(ctx), fixture_reads()}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"target-head"}, MutationUnheld{}, AssociationObserved{"target-head", ld_assoc_request(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), "other", ladvctx_common(ctx), ladvctx_common(ctx), fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def a_mismatched_returned_head_stops_the_unheld_route_before_the_mutation(ctx):
  {==}

law the_held_route_reads_the_association_for_the_selected_path:
  for ctx: LdAdvCtx
  {ld_adv_associated(HoldPath{"/holder"}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == (do IO<LdAdvObs>:
    decision : A.Association <- A.Association.decide(ld_assoc_request(ctx, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()))
    ld_adv_held_decided(decision, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx)) : IO(LdAdvObs)}

def the_held_route_reads_the_association_for_the_selected_path(ctx):
  {==}

law the_unheld_route_reads_the_association_for_the_destination_repository:
  for ctx: LdAdvCtx
  {ld_adv_associated(HoldNone{}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx) == (do IO<LdAdvObs>:
    decision : A.Association <- A.Association.decide(ld_assoc_request(ctx, "/r", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()))
    ld_adv_unheld_decided(decision, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), ctx)) : IO(LdAdvObs)}

def the_unheld_route_reads_the_association_for_the_destination_repository(ctx):
  {==}

law a_refused_association_stops_the_attempt_before_the_mutation:
  {ld_adv_unassociated(ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "holder-common", T.GBroken{"holder answers /other for the requested /common"}, fixture_reads(), MutationHeld{"/holder"}) == LdAdvNoCapture{AdvUnassociated{"holder-common"}, MutationHeld{"/holder"}, AssociationRefused{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "holder-common", T.GBroken{"holder answers /other for the requested /common"}, fixture_reads()}, IntentMissing{}} : LdAdvObs}

def a_refused_association_stops_the_attempt_before_the_mutation():
  {==}

law a_refused_association_leaves_the_post_mutation_reads_unperformed:
  {ld_adv_qualification(ld_adv_unassociated(ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "holder-common", T.GBroken{"holder answers /other for the requested /common"}, fixture_reads(), MutationHeld{"/h"})) == QualDecided{MutationHeld{"/h"}, ReadSkipped{}, ReadSkipped{}} : LdQualified}

def a_refused_association_leaves_the_post_mutation_reads_unperformed():
  {==}

law a_refused_association_captures_nothing:
  {ld_adv_capture(ld_adv_unassociated(ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "holder-common", T.GBroken{"holder answers /other"}, fixture_reads(), MutationUnheld{})) == T.CapturedAbsent{} : T.CapturedRaw}

def a_refused_association_captures_nothing():
  {==}

law an_unassociated_decision_is_never_landed:
  {decision_landed(AdvUnassociated{"holder-common"}) == False{} : Bool}

def an_unassociated_decision_is_never_landed():
  {==}

law a_coherent_association_is_bound_to_the_attempt:
  {association_bound(fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == True{} : Bool}

def a_coherent_association_is_bound_to_the_attempt():
  {==}

law an_unheld_association_is_bound_for_the_destination_read_location:
  {association_bound(fixture_unheld_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_unheld_qualification(fixture_oid_candidate()), fixture_reserved(), fixture_reservation()) == True{} : Bool}

def an_unheld_association_is_bound_for_the_destination_read_location():
  {==}

law an_association_whose_request_common_is_not_the_claim_common_is_not_bound:
  {association_bound(fixture_held_association("/other", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_request_common_is_not_the_claim_common_is_not_bound():
  {==}

law an_association_whose_observed_common_is_not_the_claim_common_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/other", "/other", fixture_reads()}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_observed_common_is_not_the_claim_common_is_not_bound():
  {==}

law an_association_whose_returned_head_is_not_the_checked_basis_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), "other", "/common", "/common", fixture_reads()}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_returned_head_is_not_the_checked_basis_is_not_bound():
  {==}

law an_association_that_read_another_holder_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/other", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_that_read_another_holder_is_not_bound():
  {==}

law an_association_for_another_candidate_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), "other", fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_for_another_candidate_is_not_bound():
  {==}

law an_association_without_a_reserved_attempt_name_is_not_bound:
  {association_bound(AssociationObserved{"associate", A.AssociationRequested{"", "/common", "tgt", "/repo", fixture_oid_candidate(), fixture_oid_basis(), "/holder", ""}, fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_without_a_reserved_attempt_name_is_not_bound():
  {==}

law a_missing_association_is_never_bound:
  {association_bound(AssociationMissing{}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def a_missing_association_is_never_bound():
  {==}

law a_refused_association_is_never_bound:
  {association_bound(AssociationRefused{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "common", T.GBroken{"holder answers /other"}, fixture_reads()}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def a_refused_association_is_never_bound():
  {==}

law a_mismatched_requested_destination_stops_the_held_route_before_the_mutation:
  {ld_adv_held_decided(A.AssociationHeld{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/other", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"destination"}, MutationHeld{"/holder"}, AssociationObserved{"destination", ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/other", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def a_mismatched_requested_destination_stops_the_held_route_before_the_mutation():
  {==}

law a_mismatched_requested_holder_stops_the_held_route_before_the_mutation:
  {ld_adv_held_decided(A.AssociationHeld{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/other", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"holder"}, MutationHeld{"/holder"}, AssociationObserved{"holder", ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/other", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def a_mismatched_requested_holder_stops_the_held_route_before_the_mutation():
  {==}

law a_mismatched_requested_attempt_stops_the_unheld_route_before_the_mutation:
  {ld_adv_unheld_decided(A.AssociationHeld{A.AssociationRequested{"other", "/common", "tgt", "/r", fixture_oid_candidate(), fixture_oid_basis(), "/r", ""}, fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"attempt"}, MutationUnheld{}, AssociationObserved{"attempt", A.AssociationRequested{"other", "/common", "tgt", "/r", fixture_oid_candidate(), fixture_oid_basis(), "/r", ""}, fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def a_mismatched_requested_attempt_stops_the_unheld_route_before_the_mutation():
  {==}

law a_mismatched_requested_common_stops_the_held_route_before_the_mutation:
  {ld_adv_held_decided(A.AssociationHeld{A.AssociationRequested{"attempt-1", "/other", "tgt", "/r", fixture_oid_candidate(), fixture_oid_basis(), "/holder", ""}, fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"common"}, MutationHeld{"/holder"}, AssociationObserved{"common", A.AssociationRequested{"attempt-1", "/other", "tgt", "/r", fixture_oid_candidate(), fixture_oid_basis(), "/holder", ""}, fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def a_mismatched_requested_common_stops_the_held_route_before_the_mutation():
  {==}

law a_mismatched_returned_basis_stops_the_held_route_before_the_mutation:
  {ld_adv_held_decided(A.AssociationHeld{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), "other", fixture_oid_basis(), "/common", "/common", fixture_reads()}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis(), LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}) == IO.pure(LdAdvObs, LdAdvNoCapture{AdvUnassociated{"returned-basis"}, MutationHeld{"/holder"}, AssociationObserved{"returned-basis", ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), fixture_oid_candidate(), "other", fixture_oid_basis(), "/common", "/common", fixture_reads()}, IntentMissing{}}) : IO(LdAdvObs)}

def a_mismatched_returned_basis_stops_the_held_route_before_the_mutation():
  {==}

law a_reserved_path_that_is_the_joined_attempt_name_under_the_common_is_bound:
  {reservation_bound(fixture_reserved(), fixture_reservation(), "/common") == True{} : Bool}

def a_reserved_path_that_is_the_joined_attempt_name_under_the_common_is_bound():
  {==}

law a_reservation_without_a_name_is_not_bound:
  {reservation_bound(fixture_reserved(), ReservationObserved{shared_attempts_parent("/common"), ""}, "/common") == False{} : Bool}

def a_reservation_without_a_name_is_not_bound():
  {==}

law a_reservation_missing_its_record_is_not_bound:
  {reservation_bound(fixture_reserved(), ReservationMissing{}, "/common") == False{} : Bool}

def a_reservation_missing_its_record_is_not_bound():
  {==}

law an_association_step_that_is_not_the_accepted_one_is_not_bound:
  {association_bound(AssociationObserved{"returned-candidate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads()}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_step_that_is_not_the_accepted_one_is_not_bound():
  {==}

law an_association_with_an_unknown_route_is_not_bound:
  {association_bound(fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", QualDecided{MutationUnknown{}, ReadSkipped{}, ReadSkipped{}}, fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_with_an_unknown_route_is_not_bound():
  {==}

law an_association_whose_requested_attempt_is_another_name_is_not_bound:
  {association_bound(fixture_held_association_named("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt", "other"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_requested_attempt_is_another_name_is_not_bound():
  {==}

law an_association_whose_retained_reservation_name_differs_is_not_bound:
  {association_bound(fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), ReservationObserved{shared_attempts_parent("/common"), "other"}) == False{} : Bool}

def an_association_whose_retained_reservation_name_differs_is_not_bound():
  {==}

law an_association_whose_reserved_path_differs_is_not_bound:
  {association_bound(fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), "other", fixture_reservation()) == False{} : Bool}

def an_association_whose_reserved_path_differs_is_not_bound():
  {==}

law an_association_without_a_retained_reservation_is_not_bound:
  {association_bound(fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), "r", ReservationMissing{}) == False{} : Bool}

def an_association_without_a_retained_reservation_is_not_bound():
  {==}

law an_attempt_whose_requested_attempt_is_another_name_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), fixture_evidence_of(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association_named("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt", "other"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"))))) == False{} : Bool}

def an_attempt_whose_requested_attempt_is_another_name_is_not_admitted():
  {==}

law an_attempt_whose_retained_reservation_name_differs_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), AttemptEvidence{fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/common", "tgt"), shared_parent_path(fixture_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "other", "/holder"), ReservationObserved{shared_attempts_parent("/common"), "other"}}))) == False{} : Bool}

def an_attempt_whose_retained_reservation_name_differs_is_not_admitted():
  {==}

law an_attempt_whose_reserved_path_differs_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_middle_reserved(), AttemptEvidence{fixture_middle_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/common", "tgt"), shared_parent_path(fixture_middle_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_middle_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), fixture_reservation()}))) == False{} : Bool}

def an_attempt_whose_reserved_path_differs_is_not_admitted():
  {==}

law an_attempt_without_a_retained_reservation_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_reserved(), AttemptEvidence{fixture_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/common", "tgt"), shared_parent_path(fixture_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), ReservationMissing{}}))) == False{} : Bool}

def an_attempt_without_a_retained_reservation_is_not_admitted():
  {==}

law a_reserved_path_with_an_inserted_component_is_not_bound:
  {reservation_bound(fixture_middle_reserved(), fixture_reservation(), "/common") == False{} : Bool}

def a_reserved_path_with_an_inserted_component_is_not_bound():
  {==}

law a_reserved_path_under_a_sibling_directory_is_not_bound:
  {reservation_bound(fixture_sibling_reserved(), fixture_reservation(), "/common") == False{} : Bool}

def a_reserved_path_under_a_sibling_directory_is_not_bound():
  {==}

law a_reserved_path_without_the_separator_is_not_bound:
  {reservation_bound(fixture_unseparated_reserved(), fixture_reservation(), "/common") == False{} : Bool}

def a_reserved_path_without_the_separator_is_not_bound():
  {==}

law a_consistent_reservation_under_another_common_is_not_bound:
  {reservation_bound(fixture_other_common_reserved(), ReservationObserved{shared_attempts_parent("/other"), "attempt-1"}, "/common") == False{} : Bool}

def a_consistent_reservation_under_another_common_is_not_bound():
  {==}

law a_reserved_path_under_another_common_is_not_bound:
  {reservation_bound(fixture_other_common_reserved(), fixture_reservation(), "/common") == False{} : Bool}

def a_reserved_path_under_another_common_is_not_bound():
  {==}

law an_attempt_whose_reserved_path_has_an_inserted_component_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_middle_reserved(), AttemptEvidence{fixture_middle_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/common", "tgt"), shared_parent_path(fixture_middle_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_middle_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), fixture_reservation()}))) == False{} : Bool}

def an_attempt_whose_reserved_path_has_an_inserted_component_is_not_admitted():
  {==}

law an_attempt_whose_reservation_is_under_another_common_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_other_common_reserved(), AttemptEvidence{fixture_other_common_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/common", "tgt"), shared_parent_path(fixture_other_common_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_other_common_reserved(), "/other", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-1", "/holder"), ReservationObserved{shared_attempts_parent("/other"), "attempt-1"}}))) == False{} : Bool}

def an_attempt_whose_reservation_is_under_another_common_is_not_admitted():
  {==}

law an_association_whose_coherent_reservation_names_another_attempt_is_not_bound:
  {association_bound(fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_second_reserved(), fixture_second_reservation()) == False{} : Bool}

def an_association_whose_coherent_reservation_names_another_attempt_is_not_bound():
  {==}

law an_attempt_whose_coherent_reservation_names_another_attempt_is_not_admitted:
  {ld_admitted(admission_of(fixture_attestation_of(fixture_second_reserved(), AttemptEvidence{fixture_second_reserved(), "/repo", "tgt", fixture_oid_candidate(), fixture_oid_basis(), fixture_guard_of("/common", "tgt"), shared_parent_path(fixture_second_reserved(), "stderr"), AdvLanded{}, T.CapturedDone{"exit 0\nrest", "diagnostics"}, fixture_held_qualification(fixture_oid_candidate(), "tgt"), T.ReleaseDone{}, IdentityObserved{"/common", T.GRun{0, "/common"}, "tgt"}, fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_held_intent(fixture_second_reserved(), "/common", "tgt", fixture_oid_candidate(), fixture_oid_basis(), "/repo", "attempt-2", "/holder"), fixture_second_reservation()}))) == False{} : Bool}

def an_attempt_whose_coherent_reservation_names_another_attempt_is_not_admitted():
  {==}

law a_bound_association_keeps_the_reads_that_answer_its_values:
  {association_bound(fixture_held_association("/common", fixture_oid_candidate(), fixture_oid_basis(), "tgt"), fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == True{} : Bool}

def a_bound_association_keeps_the_reads_that_answer_its_values():
  {==}

law a_bound_association_may_answer_its_two_commons_with_different_raw_spellings:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_split_reads_of(fixture_oid_candidate(), fixture_oid_basis(), "/common")}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == True{} : Bool}

def a_bound_association_may_answer_its_two_commons_with_different_raw_spellings():
  {==}

law an_association_whose_candidate_read_answers_another_value_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads_of("other", fixture_oid_basis(), "/common")}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_candidate_read_answers_another_value_is_not_bound():
  {==}

law an_association_whose_target_read_was_skipped_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", A.AssocReads{A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}}, A.AssocReadSkipped{}, A.AssocReadSkipped{}, A.AssocReadPerformed{T.GRun{0, "/common\n"}}, A.AssocReadPerformed{T.GRun{0, "/common\n"}}}}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_target_read_was_skipped_is_not_bound():
  {==}

law an_association_whose_holder_read_is_skipped_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", A.AssocReads{A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}}, A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}}, A.AssocReadPerformed{T.GRun{0, ""}}, A.AssocReadSkipped{}, A.AssocReadSkipped{}}}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_holder_read_is_skipped_is_not_bound():
  {==}

law a_refused_shared_association_keeps_the_reads_it_reached:
  {ld_adv_association(ld_adv_unassociated(ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "holder-common", T.GBroken{"holder answers /other"}, fixture_reads(), MutationHeld{"/holder"})) == AssociationRefused{ld_assoc_request(LdAdvContext{1, "g", "/art", "attempt-1", "/common", shared_parent_path(shared_attempts_parent("/common"), "attempt-1")}, "/holder", "/r", "tgt", fixture_oid_candidate(), fixture_oid_basis()), "holder-common", T.GBroken{"holder answers /other"}, fixture_reads()} : AssociationEvidence}

def a_refused_shared_association_keeps_the_reads_it_reached():
  {==}

law the_six_read_positions_are_written_in_order_with_their_own_observations:
  {reads_fields(A.AssocReads{A.AssocReadPerformed{T.GRun{0, "aa\n"}}, A.AssocReadSkipped{}, A.AssocReadPerformed{T.GRun{1, ""}}, A.AssocReadPerformed{T.GRun{0, "cc\n"}}, A.AssocReadPerformed{T.GRun{0, "dd\n"}}, A.AssocReadSkipped{}}, Con{"suffix", Nil{}}) == Con{"reads", Con{"performed", Con{"run", Con{"0", Con{"aa\n", Con{"skipped", Con{"performed", Con{"run", Con{"1", Con{"", Con{"performed", Con{"run", Con{"0", Con{"cc\n", Con{"performed", Con{"run", Con{"0", Con{"dd\n", Con{"skipped", Con{"suffix", Nil{}}}}}}}}}}}}}}}}}}}}} : List<String>}

def the_six_read_positions_are_written_in_order_with_their_own_observations():
  {==}

law the_request_is_written_before_the_reads:
  {request_fields(A.AssociationRequested{"a1", "/cm", "tgt", "/repo", "c1", "b1", "/holder", "r1"}, Con{"zz", Nil{}}) == Con{"request", Con{"a1", Con{"/cm", Con{"tgt", Con{"/repo", Con{"c1", Con{"b1", Con{"/holder", Con{"r1", Con{"zz", Nil{}}}}}}}}}}} : List<String>}

def the_request_is_written_before_the_reads():
  {==}

law the_association_record_writes_its_reads_before_the_suffix:
  for request: A.AssociationRequest
  {association_fields(AssociationObserved{"associate", request, "c", "b", "b", "/common", "/common", A.AssocReads{A.AssocReadPerformed{T.GRun{0, "aa\n"}}, A.AssocReadSkipped{}, A.AssocReadSkipped{}, A.AssocReadSkipped{}, A.AssocReadSkipped{}, A.AssocReadPerformed{T.GRun{0, "ff\n"}}}}, Con{"suffix", Nil{}}) == Con{"association-observed", Con{"associate", Con{"c", Con{"b", Con{"b", Con{"/common", Con{"/common", request_fields(request, Con{"reads", Con{"performed", Con{"run", Con{"0", Con{"aa\n", Con{"skipped", Con{"skipped", Con{"skipped", Con{"skipped", Con{"performed", Con{"run", Con{"0", Con{"ff\n", Con{"suffix", Nil{}}}}}}}}}}}}}}})}}}}}}} : List<String>}

def the_association_record_writes_its_reads_before_the_suffix(request):
  {==}

law an_association_whose_normalized_candidate_is_not_a_supported_name_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request("cand", fixture_oid_basis(), "tgt", "/holder", "/common"), "cand", fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", fixture_reads_of("cand", fixture_oid_basis(), "/common")}, "cand", fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification("cand", "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_normalized_candidate_is_not_a_supported_name_is_not_bound():
  {==}

law an_association_whose_present_target_skipped_the_ancestor_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", A.AssocReads{A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}}, A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}}, A.AssocReadSkipped{}, A.AssocReadPerformed{T.GRun{0, "/common\n"}}, A.AssocReadPerformed{T.GRun{0, "/common\n"}}}}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_present_target_skipped_the_ancestor_is_not_bound():
  {==}

law an_association_whose_ancestor_read_failed_is_not_bound:
  {association_bound(AssociationObserved{"associate", fixture_assoc_request(fixture_oid_candidate(), fixture_oid_basis(), "tgt", "/holder", "/common"), fixture_oid_candidate(), fixture_oid_basis(), fixture_oid_basis(), "/common", "/common", A.AssocReads{A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_candidate(), "\n")}}, A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}}, A.AssocReadPerformed{T.GRun{0, Tx.str_cat(fixture_oid_basis(), "\n")}}, A.AssocReadPerformed{T.GRun{128, ""}}, A.AssocReadPerformed{T.GRun{0, "/common\n"}}, A.AssocReadPerformed{T.GRun{0, "/common\n"}}}}, fixture_oid_candidate(), fixture_oid_basis(), "/common", "/repo", "tgt", fixture_held_qualification(fixture_oid_candidate(), "tgt"), fixture_reserved(), fixture_reservation()) == False{} : Bool}

def an_association_whose_ancestor_read_failed_is_not_bound():
  {==}

law the_two_common_positions_are_written_with_their_own_spellings:
  {reads_fields(A.AssocReads{A.AssocReadSkipped{}, A.AssocReadSkipped{}, A.AssocReadSkipped{}, A.AssocReadSkipped{}, A.AssocReadPerformed{T.GRun{0, "/common\n"}}, A.AssocReadPerformed{T.GRun{0, "/common"}}}, Con{"suffix", Nil{}}) == Con{"reads", Con{"skipped", Con{"skipped", Con{"skipped", Con{"skipped", Con{"performed", Con{"run", Con{"0", Con{"/common\n", Con{"performed", Con{"run", Con{"0", Con{"/common", Con{"suffix", Nil{}}}}}}}}}}}}}}} : List<String>}

def the_two_common_positions_are_written_with_their_own_spellings():
  {==}

law the_producer_published_record_is_admitted_for_its_path:
  {intent_publication_record(Pb.production_record("published", "/p/intent", "0"), "/p/intent", "/p/intent") == True{} : Bool}

def the_producer_published_record_is_admitted_for_its_path():
  {==}

law the_producer_existing_record_is_admitted_for_its_path:
  {intent_publication_record(Pb.production_record("existing", "/p/intent", "0"), "/p/intent", "/p/intent") == True{} : Bool}

def the_producer_existing_record_is_admitted_for_its_path():
  {==}

law an_existing_record_that_still_reports_pending_is_not_admitted:
  {intent_publication_record(Pb.production_record("existing", "/p/intent", "1"), "/p/intent", "/p/intent") == False{} : Bool}

def an_existing_record_that_still_reports_pending_is_not_admitted():
  {==}

law a_record_for_another_path_is_not_admitted:
  {intent_publication_record(Pb.production_record("published", "/other/intent", "0"), "/other/intent", "/p/intent") == False{} : Bool}

def a_record_for_another_path_is_not_admitted():
  {==}

law a_malformed_qualification_record_is_not_admitted:
  {qualification_admitted("not a receipt record", "/p/intent") == False{} : Bool}

def a_malformed_qualification_record_is_not_admitted():
  {==}

law a_publication_refusal_keeps_its_own_outcome_in_the_record:
  {intent_publication_fields(IntentPublished{Pb.PublishRefused{It.IntentRequested{"a", "/c", "t", "/r", "cand", "base", "/p/intent", "/h", ""}, "name", "n", "raw"}}, Con{"suffix", Nil{}}) == Con{"publication-outcome", Con{"publish-refused", Con{"name", Con{"n", Con{"raw", Con{"intent-request", Con{"a", Con{"/c", Con{"t", Con{"/r", Con{"cand", Con{"base", Con{"/p/intent", Con{"/h", Con{"", Con{"suffix", Nil{}}}}}}}}}}}}}}}}} : List<String>}

def a_publication_refusal_keeps_its_own_outcome_in_the_record():
  {==}
