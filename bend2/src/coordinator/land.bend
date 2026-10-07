# Coordinator landing: look up a player's branch from the database and land
# its committed tip onto a target branch with a fast-forward update-ref.

import Base
import ./commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../host/control.bend as Host
import ../git/process.bend as Git
import ../git/land.bend as GitLand
import ../git/types.bend as G
import ../git/text.bend as Tx
import ../json/canonical.bend as J

def require_player(found: Bool) -> IO(Unit):
  match found:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 2, "The player session is not registered.")

def require_branch_pick(empty: Bool, +: String) -> IO(String):
  match empty:
    case True{}: IO.die(String, 2, "The player has no recorded branch.")
    case False{}: IO.pure(String, branch)

def require_branch(+branch: String) -> IO(String):
  require_branch_pick(String.is_empty(branch), branch)

def line_tail(rest: String, +: String, newline: Bool) -> String:
  match newline:
    case True{}: Tx.str_rev(rest)
    case False{}: original

def line_reversed(s: String, original: String) -> String:
  match s:
    case SNil{}: original
    case SCon{c, rest}: line_tail(rest, original, Char.is_eq(c, Char.from_u32(10)))

def line(+s: String) -> String:
  line_reversed(Tx.str_rev(s), s)

def show_outcome(o: G.LandOutcome) -> IO(Unit):
  IO.print(GitLand.outcome_json(o))

def land_player(+db: String, +player: String, +repo: String, +target: String) -> IO(Unit):
  do IO<Unit>:
    player_row : String <- IO.try(String, Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    outcome : G.LandOutcome <- GitLand.land(repo, branch, target)
    show_outcome(outcome)

def show_checked_outcome(result: Result<&1,&1,G.GitFail,G.LandOutcome>) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit,1,G.fail_text(error))
    case Done{outcome}: show_outcome(outcome)

# One attempt's scratch path comes from the Git landing module, which drops the
# trees the player's earlier attempt kept before this attempt prepares its own.
def run_checked(+db: String, +player: String, +repo: String, +target: String, +check: String, +files: String, +branch: String) -> IO(Unit):
  do IO<Unit>:
    ts_raw : String <- IO.try(String, DB.Sql.query(db, "" ++ "SELECT hex(randomblob(8));"))
    ts : String <- IO.pure(String, line(ts_raw))
    scratch : String <- GitLand.open_scratch(repo, player, ts)
    result : Result<&1,&1,G.GitFail,G.LandOutcome> <- GitLand.land_checked(repo, target, branch, check, Tx.split_spaces(files), scratch)
    show_checked_outcome(result)

# The checked landing: the player's branch is squashed onto the target and
# the selected checks run on the candidate and on the target before the
# target advances. FILES is space-separated; CHECK runs as /bin/sh CHECK
# FILE inside each checked tree.
def land_checked_player(+db: String, +player: String, +repo: String, +target: String, +check: String, +files: String) -> IO(Unit):
  do IO<Unit>:
    player_row : String <- IO.try(String, Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    run_checked(db, player, repo, target, check, files, branch)

def push_ok(ok: Bool, +: String, +: String) -> IO(Unit):
  match ok:
    case True{}: IO.print("{\"status\":\"pushed\",\"branch\":" ++ J.string_literal(branch) ++ ",\"remote\":" ++ J.string_literal(remote) ++ "}")
    case False{}: IO.print("{\"status\":\"rejected\",\"reason\":" ++ J.string_literal(Tx.cmd_failed(Tx.str_cat("git push to ", remote))) ++ "}")

def push_pick(r: G.GitOut, branch: String, +: String) -> IO(Unit):
  match r:
    case G.GRun{code, out}: push_ok(U32.is_eq(code, 0), branch, remote)
    case G.GBroken{detail}: IO.die(Unit, 1, detail)

def push_branch(+repo: String, +branch: String, +remote: String) -> IO(Unit):
  do IO<Unit>:
    r : G.GitOut <- GitLand.push_git(repo, branch, remote)
    push_pick(r, branch, remote)

# The declared remote read's answer. The status names which outcome the read
# reached, and every answer names the declared repository, branch and remote.
def tip_json(+: String, tail: String, +: String, branch: String, +: String) -> IO(Unit):
  IO.print("{\"status\":" ++ J.string_literal(status) ++ ",\"repo\":" ++ J.string_literal(repo) ++ ",\"branch\":" ++ J.string_literal(branch) ++ ",\"remote\":" ++ J.string_literal(remote) ++ tail)

def tip_object_tail(subject: String) -> String:
  ",\"objectId\":" ++ J.string_literal(subject) ++ "}"

# A failed read names the command whose message is in the coordinator log and
# the status git exited with. Nothing here reads a local ref.
def tip_exit_tail(code: U32, remote: String) -> String:
  ",\"exit\":" ++ U32.show(code) ++ ",\"reason\":" ++ J.string_literal(Tx.cmd_failed(Tx.str_cat("git ls-remote ", remote))) ++ "}"

def tip_present(present: Bool, subject: String, +repo: String, +branch: String, +remote: String) -> IO(Unit):
  match present:
    case True{}: tip_json("advertised", tip_object_tail(subject), repo, branch, remote)
    case False{}: tip_json("absent", "}", repo, branch, remote)

def tip_zero(zero: Bool, code: U32, +subject: String, +repo: String, +branch: String, +remote: String) -> IO(Unit):
  match zero:
    case True{}: tip_present(Bool.not(String.is_empty(subject)), subject, repo, branch, remote)
    case False{}: tip_json("failed", tip_exit_tail(code, remote), repo, branch, remote)

def tip_run(+code: U32, subject: String, +repo: String, +branch: String, +remote: String) -> IO(Unit):
  tip_zero(U32.is_eq(code, 0), code, subject, repo, branch, remote)

def tip_pick(r: G.GitOut, +repo: String, +branch: String, +remote: String) -> IO(Unit):
  match r:
    case G.GRun{code, out}: tip_run(code, GitLand.tip_object(out, GitLand.tip_ref(branch)), repo, branch, remote)
    case G.GBroken{detail}: IO.die(Unit, 1, detail)

# The declared remote-tip read: report the object the named remote advertises
# for the named branch, the absence of that branch, or the read's own failure.
def remote_tip(+repo: String, +branch: String, +remote: String) -> IO(Unit):
  do IO<Unit>:
    r : G.GitOut <- GitLand.remote_tip_git(repo, branch, remote)
    tip_pick(r, repo, branch, remote)

# --- reviewed-source landing -------------------------------------------------
# A reviewed commit is selected once, before any scratch path or target effect,
# and only its immutable object ID reaches the existing landing pipeline. The
# selection result stays local to this module: the pipeline's GitFail vocabulary
# and its outcome type are unchanged, and a nonancestor source is refused here
# rather than relabelled as a command failure.

type Selected is Data:
  SelPicked{oid: String}
  SelRefused{reason: String}
  SelFailed{code: U32, detail: String}

# The selected source must resolve to a commit. A missing or non-commit selector
# refuses; an unusable git command is an operation failure with its own detail.
def sel_commit_pick(r: G.GitOut, +commit: String) -> Selected:
  match r:
    case G.GRun{+code, +out}:
      Bool.pick(Selected, U32.is_eq(code, 0),
        SelPicked{Tx.trim_nl(out)},
        Bool.pick(Selected, U32.is_eq(code, 1),
          SelRefused{"The selected source is not a commit in the recorded repository: " ++ commit},
          SelFailed{code, Tx.cmd_failed("git rev-parse --verify") ++ " (exit " ++ U32.show(code) ++ "): " ++ Tx.trim_nl(out)}))
    case G.GBroken{detail}: SelFailed{1, detail}

def sel_commit(repo: String, +commit: String) -> IO(Selected):
  +r2 = repo
  +c2 = commit
  do IO<Selected>:
    r : G.GitOut <- Git.runGit(r2, ["rev-parse", "--verify", "--quiet", "--end-of-options", Tx.str_cat(c2, "^{commit}")])
    IO.pure(Selected, sel_commit_pick(r, c2))

# SelPicked here carries the resolved recorded-branch tip.
def sel_branch_pick(r: G.GitOut, +branch: String) -> Selected:
  match r:
    case G.GRun{+code, +out}:
      Bool.pick(Selected, U32.is_eq(code, 0),
        SelPicked{Tx.trim_nl(out)},
        Bool.pick(Selected, U32.is_eq(code, 1),
          SelRefused{"The recorded branch is missing from the recorded repository: " ++ branch},
          SelFailed{code, Tx.cmd_failed("git rev-parse --verify") ++ " (exit " ++ U32.show(code) ++ "): " ++ Tx.trim_nl(out)}))
    case G.GBroken{detail}: SelFailed{1, detail}

def sel_branch(repo: String, +branch: String) -> IO(Selected):
  +r2 = repo
  +b2 = branch
  do IO<Selected>:
    r : G.GitOut <- Git.runGit(r2, ["rev-parse", "--verify", "--quiet", Tx.str_cat("refs/heads/", b2)])
    IO.pure(Selected, sel_branch_pick(r, b2))

# Ancestry is its own decision. Exit 0 is an ancestor, exit 1 is a real
# nonancestor refusal, and any other status or a broken command is an operation
# failure carrying that status and the command that produced it.
def sel_ancestor_pick(r: G.GitOut, +oid: String, +branchOid: String) -> Selected:
  match r:
    case G.GRun{+code, +out}:
      Bool.pick(Selected, U32.is_eq(code, 0),
        SelPicked{oid},
        Bool.pick(Selected, U32.is_eq(code, 1),
          SelRefused{"The selected source is not an ancestor of the recorded branch: " ++ oid ++ " against " ++ branchOid},
          SelFailed{code, Tx.cmd_failed("git merge-base --is-ancestor") ++ " (exit " ++ U32.show(code) ++ ")"}))
    case G.GBroken{detail}: SelFailed{1, detail}

def sel_ancestor(repo: String, +oid: String, +branchOid: String) -> IO(Selected):
  +r2 = repo
  +o2 = oid
  +b2 = branchOid
  do IO<Selected>:
    r : G.GitOut <- Git.runGit(r2, ["merge-base", "--is-ancestor", o2, b2])
    IO.pure(Selected, sel_ancestor_pick(r, o2, b2))

def sel_ancestor_after_branch(s: Selected, repo: String, +oid: String) -> IO(Selected):
  match s:
    case SelPicked{branchOid}: sel_ancestor(repo, oid, branchOid)
    case other: IO.pure(Selected, other)

def sel_branch_after_commit(s: Selected, +repo: String, +branch: String, +commit: String) -> IO(Selected):
  match s:
    case SelPicked{commitOid}:
      do IO<Selected>:
        b : Selected <- sel_branch(repo, branch)
        sel_ancestor_after_branch(b, repo, commitOid)
    case other: IO.pure(Selected, other)

def select_reviewed(+repo: String, +branch: String, +commit: String) -> IO(Selected):
  do IO<Selected>:
    c : Selected <- sel_commit(repo, commit)
    sel_branch_after_commit(c, repo, branch, commit)

# The refusal crosses as exit 2 with its specific reason; an operation failure
# crosses with its own non-zero status and detail.
def selected_or_die(s: Selected, +player: String) -> IO(String):
  match s:
    case SelPicked{oid}: IO.pure(String, oid)
    case SelRefused{reason}: IO.die(String, 2, reason)
    case SelFailed{code, detail}: IO.die(String, code, detail)

# The recorded workspace must belong to the landing repository. Two worktrees of
# one repository share a git common directory, so comparing that directory
# separates the recorded Player source from an unrelated repository that happens
# to carry a branch of the same name. An unrecorded workspace refuses, because
# absence does not establish the recorded source repository, and a recorded one
# that cannot be read refuses as well.
def assoc_same(w: String, r: String, +workspace: String, +repo: String) -> IO(Unit):
  Bool.pick(IO(Unit), String.eq(w, r),
    IO.pure(Unit, Unit{}),
    IO.die(Unit, 2, "The recorded workspace belongs to a different repository than " ++ repo ++ ": " ++ workspace))

# The host realpath canonicalizes the git-reported directory, so a symlinked
# spelling and its resolved spelling compare equal.
def assoc_real_pick(+: Result<&1,&1,U32 & String,String>, +workspace: String, +repo: String, +directory: String) -> IO(String):
  match resolved:
    case Done{value}: IO.pure(String, value)
    case Fail{error}: IO.die(String, 2, "The recorded workspace repository directory cannot be resolved for " ++ workspace ++ " against " ++ repo ++ ": " ++ directory)

def assoc_real(+directory: String, +workspace: String, +repo: String) -> IO(String):
  do IO<String>:
    resolved : Result<&1,&1,U32 & String,String> <- Host.Control.workspace(directory)
    assoc_real_pick(resolved, workspace, repo, directory)

def assoc_canonical(+workspace: String, +repo: String, wdir: String, rdir: String) -> IO(Unit):
  do IO<Unit>:
    w : String <- assoc_real(wdir, workspace, repo)
    r : String <- assoc_real(rdir, workspace, repo)
    assoc_same(w, r, workspace, repo)

def assoc_pair(+workspace: String, +repo: String, w: G.GitOut, r: G.GitOut) -> IO(Unit):
  match w:
    case G.GRun{wcode, wout}:
      match r:
        case G.GRun{rcode, rout}:
          Bool.pick(IO(Unit),
            Bool.and(U32.is_eq(wcode, 0), U32.is_eq(rcode, 0)),
            assoc_canonical(workspace, repo, Tx.trim_nl(wout), Tx.trim_nl(rout)),
            IO.die(Unit, 2, "The recorded workspace cannot be associated with " ++ repo ++ ": " ++ workspace))
        case G.GBroken{rdetail}: IO.die(Unit, 1, rdetail)
    case G.GBroken{wdetail}: IO.die(Unit, 1, wdetail)

# Absence of a recorded workspace does not establish a recorded source
# repository, so the reviewed entry refuses instead of falling back to the
# caller's repository argument.
def assoc_missing() -> IO(Unit):
  IO.die(Unit, 2, "The player has no recorded workspace, so the reviewed source repository cannot be established; inspect the session and record its workspace.")

def assoc_probe(+workspace: String, +repo: String) -> IO(Unit):
  do IO<Unit>:
    w : G.GitOut <- Git.runGit(workspace, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    r : G.GitOut <- Git.runGit(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    assoc_pair(workspace, repo, w, r)

def require_association(+db: String, +player: String, +repo: String) -> IO(Unit):
  do IO<Unit>:
    workspace_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT workspace FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    +workspace : String <- IO.pure(String, line(workspace_raw))
    Bool.pick(IO(Unit), String.is_empty(workspace), assoc_missing(), assoc_probe(workspace, repo))

# The recorded branch tip is the default source; the reviewed entry selects an
# exact commit from that same recorded branch and lands only that object.
def land_player_at(+db: String, +player: String, +repo: String, +target: String, +commit: String) -> IO(Unit):
  do IO<Unit>:
    player_row : String <- IO.try(String, Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    associated : Unit <- require_association(db, player, repo)
    picked : Selected <- select_reviewed(repo, branch, commit)
    oid : String <- selected_or_die(picked, player)
    outcome : G.LandOutcome <- GitLand.land_fast_forward_at(repo, oid, target)
    show_outcome(outcome)

def land_checked_player_at(+db: String, +player: String, +repo: String, +target: String, +check: String, +files: String, +commit: String) -> IO(Unit):
  do IO<Unit>:
    player_row : String <- IO.try(String, Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    associated : Unit <- require_association(db, player, repo)
    picked : Selected <- select_reviewed(repo, branch, commit)
    oid : String <- selected_or_die(picked, player)
    run_checked(db, player, repo, target, check, files, oid)

# --- operative laws ----------------------------------------------------------

# The three ancestry statuses stay three decisions: an ancestor is the selected
# object, exit 1 is a nonancestor refusal, and any other status is an operation
# failure that names its own code.
law reviewed_source_ancestry_keeps_three_decisions:
  for +oid: String
  for +branchOid: String
  for +code: U32
  {sel_ancestor_pick(G.GRun{code, ""}, oid, branchOid) == Bool.pick(Selected, U32.is_eq(code, 0), SelPicked{oid}, Bool.pick(Selected, U32.is_eq(code, 1), SelRefused{"The selected source is not an ancestor of the recorded branch: " ++ oid ++ " against " ++ branchOid}, SelFailed{code, Tx.cmd_failed("git merge-base --is-ancestor") ++ " (exit " ++ U32.show(code) ++ ")"})) : Selected}

def reviewed_source_ancestry_keeps_three_decisions(oid, branchOid, code):
  {==}

# A selector that does not resolve to a commit refuses before any effect, and a
# status other than the verify refusal is an operation failure with its detail.
law reviewed_source_selector_separates_absence_from_operation_failure:
  for +commit: String
  for +out: String
  for +code: U32
  {sel_commit_pick(G.GRun{code, out}, commit) == Bool.pick(Selected, U32.is_eq(code, 0), SelPicked{Tx.trim_nl(out)}, Bool.pick(Selected, U32.is_eq(code, 1), SelRefused{"The selected source is not a commit in the recorded repository: " ++ commit}, SelFailed{code, Tx.cmd_failed("git rev-parse --verify") ++ " (exit " ++ U32.show(code) ++ "): " ++ Tx.trim_nl(out)})) : Selected}

def reviewed_source_selector_separates_absence_from_operation_failure(commit, out, code):
  {==}

# Only the selected object id crosses into the landing pipeline.
law reviewed_source_passes_only_the_selected_object:
  for +oid: String
  {selected_or_die(SelPicked{oid}, "player") == IO.pure(String, oid) : IO(String)}

def reviewed_source_passes_only_the_selected_object(oid):
  {==}

# A refusal crosses as exit 2 with its reason.
law reviewed_source_refusal_exits_two:
  for +reason: String
  {selected_or_die(SelRefused{reason}, "player") == IO.die(String, 2, reason) : IO(String)}

def reviewed_source_refusal_exits_two(reason):
  {==}

# --- operative laws over the actual reviewed callers -------------------------
#
# Each reviewed caller is equated with the exact IO composition it runs, so the
# order of the steps and the argument each step is given are part of the law: a
# caller that drops the association, drops the selection or its refusal, or hands
# the landing stage the recorded branch name instead of the object the selection
# resolved, is no longer the expression stated here and the compile refuses it.

# The registered Player lookup, the recorded branch lookup, the association with
# the landing repository, the reviewed selection of the caller's commit, and the
# object that selection resolved passed alone to the fast-forward landing.
law land_player_at_runs_the_reviewed_source_in_order:
  for +db: String
  for +player: String
  for +repo: String
  for target: String
  for commit: String
  {land_player_at(db, player, repo, target, commit) == (do IO<Unit>:
    player_row : String <- IO.try(String,Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String,DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    associated : Unit <- require_association(db, player, repo)
    picked : Selected <- select_reviewed(repo, branch, commit)
    oid : String <- selected_or_die(picked, player)
    outcome : G.LandOutcome <- GitLand.land_fast_forward_at(repo, oid, target)
    show_outcome(outcome)) : IO(Unit)}

def land_player_at_runs_the_reviewed_source_in_order(db, player, repo, target, commit):
  {==}

# The same four steps, then the object into the checked landing with the declared
# check and files.
law land_checked_player_at_runs_the_reviewed_source_in_order:
  for +db: String
  for +player: String
  for +repo: String
  for target: String
  for check: String
  for files: String
  for commit: String
  {land_checked_player_at(db, player, repo, target, check, files, commit) == (do IO<Unit>:
    player_row : String <- IO.try(String,Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String,DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    associated : Unit <- require_association(db, player, repo)
    picked : Selected <- select_reviewed(repo, branch, commit)
    oid : String <- selected_or_die(picked, player)
    run_checked(db, player, repo, target, check, files, oid)) : IO(Unit)}

def land_checked_player_at_runs_the_reviewed_source_in_order(db, player, repo, target, check, files, commit):
  {==}

# --- operative laws over the reviewed selection chain ------------------------
#
# Each step of the reviewed selection is equated with the exact IO composition it
# runs, the literal Git argv it hands to git and the object it passes on, so a
# step that is skipped, given different arguments or handed a different object is
# no longer the expression stated here.

# The requested commit is resolved by rev-parse with the commit peel, and the
# caller's own text is the only value that reaches the command.
law sel_commit_reads_the_requested_commit_with_the_literal_argv:
  for repo: String
  for +commit: String
  {sel_commit(repo, commit) == (do IO<Selected>:
    r : G.GitOut <- Git.runGit(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", Tx.str_cat(commit, "^{commit}")])
    IO.pure(Selected, sel_commit_pick(r, commit))) : IO(Selected)}

def sel_commit_reads_the_requested_commit_with_the_literal_argv(repo, commit):
  {==}

# The recorded branch is resolved as a branch ref of the landing repository.
law sel_branch_reads_the_recorded_branch_with_the_literal_argv:
  for repo: String
  for +branch: String
  {sel_branch(repo, branch) == (do IO<Selected>:
    r : G.GitOut <- Git.runGit(repo, ["rev-parse", "--verify", "--quiet", Tx.str_cat("refs/heads/", branch)])
    IO.pure(Selected, sel_branch_pick(r, branch))) : IO(Selected)}

def sel_branch_reads_the_recorded_branch_with_the_literal_argv(repo, branch):
  {==}

# Ancestry is asked with the selected object first and the recorded branch tip
# second, which is the order merge-base --is-ancestor is defined on.
law sel_ancestor_runs_the_literal_ancestry_argv:
  for repo: String
  for +oid: String
  for +branchOid: String
  {sel_ancestor(repo, oid, branchOid) == (do IO<Selected>:
    r : G.GitOut <- Git.runGit(repo, ["merge-base", "--is-ancestor", oid, branchOid])
    IO.pure(Selected, sel_ancestor_pick(r, oid, branchOid))) : IO(Selected)}

def sel_ancestor_runs_the_literal_ancestry_argv(repo, oid, branchOid):
  {==}

# A picked commit reaches the ancestry read against the resolved branch tip; a
# result that is not picked is passed on unchanged.
law sel_ancestor_after_branch_picked_continues_into_the_ancestry_read:
  for +repo: String
  for +oid: String
  for +branchOid: String
  {sel_ancestor_after_branch(SelPicked{branchOid}, repo, oid) == sel_ancestor(repo, oid, branchOid) : IO(Selected)}

def sel_ancestor_after_branch_picked_continues_into_the_ancestry_read(repo, oid, branchOid):
  {==}

# The resolved commit is carried into the recorded-branch lookup and then into
# the ancestry read: nothing is answered before both reads have run.
law sel_branch_after_commit_picked_resolves_the_recorded_branch_then_the_ancestry:
  for +repo: String
  for +branch: String
  for +commitOid: String
  for commit: String
  {sel_branch_after_commit(SelPicked{commitOid}, repo, branch, commit) == (do IO<Selected>:
    b : Selected <- sel_branch(repo, branch)
    sel_ancestor_after_branch(b, repo, commitOid)) : IO(Selected)}

def sel_branch_after_commit_picked_resolves_the_recorded_branch_then_the_ancestry(repo, branch, commitOid, commit):
  {==}

# The reviewed selection is the requested-commit read followed by that same
# chain; it answers nothing before both have run.
law select_reviewed_resolves_then_checks_against_the_recorded_branch:
  for +repo: String
  for +branch: String
  for +commit: String
  {select_reviewed(repo, branch, commit) == (do IO<Selected>:
    c : Selected <- sel_commit(repo, commit)
    sel_branch_after_commit(c, repo, branch, commit)) : IO(Selected)}

def select_reviewed_resolves_then_checks_against_the_recorded_branch(repo, branch, commit):
  {==}
