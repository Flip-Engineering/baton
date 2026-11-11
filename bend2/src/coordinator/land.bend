# Coordinator landing: look up a player's branch from the database and land
# its committed tip onto a target branch with a fast-forward update-ref.

import Base
import ../coordinator/commands.bend as C
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

def require_branch_pick(empty: Bool, branch: String) -> IO(String):
  match empty:
    case True{}: IO.die(String, 2, "The player has no recorded branch.")
    case False{}: IO.pure(String, branch)

def require_branch(+branch: String) -> IO(String):
  require_branch_pick(String.is_empty(branch), branch)

def line_tail(rest: String, original: String, newline: Bool) -> String:
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

# One attempt's scratch path comes from the Git landing module; earlier refused
# or conflicted attempt trees remain available to the player.
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

def push_ok(ok: Bool, branch: String, remote: String) -> IO(Unit):
  match ok:
    case True{}: IO.print("{\"status\":\"pushed\",\"branch\":" ++ J.string_literal(branch) ++ ",\"remote\":" ++ J.string_literal(remote) ++ "}")
    case False{}: IO.print("{\"status\":\"rejected\",\"reason\":" ++ J.string_literal(Tx.cmd_failed(Tx.str_cat("git push to ", remote))) ++ "}")

def push_pick(r: G.GitOut, branch: String, remote: String) -> IO(Unit):
  match r:
    case G.GRun{code, out}: push_ok(U32.is_eq(code, 0), branch, remote)
    case G.GBroken{detail}: IO.die(Unit, 1, detail)

def push_branch(+repo: String, +branch: String, +remote: String) -> IO(Unit):
  do IO<Unit>:
    r : G.GitOut <- GitLand.push_git(repo, branch, remote)
    push_pick(r, branch, remote)

# The declared remote read's answer. The status names which outcome the read
# reached, and every answer names the declared repository, branch and remote.
def tip_json(status: String, tail: String, repo: String, branch: String, remote: String) -> IO(Unit):
  IO.print("{\"status\":" ++ J.string_literal(status) ++ ",\"repo\":" ++ J.string_literal(repo) ++ ",\"branch\":" ++ J.string_literal(branch) ++ ",\"remote\":" ++ J.string_literal(remote) ++ tail)

def tip_object_tail(object: String) -> String:
  ",\"objectId\":" ++ J.string_literal(object) ++ "}"

# A failed read names the command whose message is in the coordinator log and
# the status git exited with. Nothing here reads a local ref.
def tip_exit_tail(code: U32, remote: String) -> String:
  ",\"exit\":" ++ U32.show(code) ++ ",\"reason\":" ++ J.string_literal(Tx.cmd_failed(Tx.str_cat("git ls-remote ", remote))) ++ "}"

def tip_present(present: Bool, object: String, +repo: String, +branch: String, +remote: String) -> IO(Unit):
  match present:
    case True{}: tip_json("advertised", tip_object_tail(object), repo, branch, remote)
    case False{}: tip_json("absent", "}", repo, branch, remote)

def tip_zero(zero: Bool, code: U32, +object: String, +repo: String, +branch: String, +remote: String) -> IO(Unit):
  match zero:
    case True{}: tip_present(Bool.not(String.is_empty(object)), object, repo, branch, remote)
    case False{}: tip_json("failed", tip_exit_tail(code, remote), repo, branch, remote)

def tip_run(+code: U32, object: String, +repo: String, +branch: String, +remote: String) -> IO(Unit):
  tip_zero(U32.is_eq(code, 0), code, object, repo, branch, remote)

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
# and only its immutable object ID reaches the existing landing pipeline.
# The existing outcome type and target update remain in the landing pipeline.
# A nonancestor source returns a selection refusal before any landing effect.

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

def sel_branch_after_commit(s: Selected, +repo: String, +branch: String) -> IO(Selected):
  match s:
    case SelPicked{commitOid}:
      do IO<Selected>:
        b : Selected <- sel_branch(repo, branch)
        sel_ancestor_after_branch(b, repo, commitOid)
    case other: IO.pure(Selected, other)

def select_reviewed(+repo: String, +branch: String, +commit: String) -> IO(Selected):
  do IO<Selected>:
    c : Selected <- sel_commit(repo, commit)
    sel_branch_after_commit(c, repo, branch)

# The refusal crosses as exit 2 with its specific reason; an operation failure
# crosses with its own non-zero status and detail.
def selected_or_die(s: Selected) -> IO(String):
  match s:
    case SelPicked{oid}: IO.pure(String, oid)
    case SelRefused{reason}: IO.die(String, 2, reason)
    case SelFailed{code, detail}: IO.die(String, code, detail)

# Git reports a common directory shared by worktrees of one repository.
# The reviewed entry compares Player workspace and landing repository identity
# before it accepts the selected commit.
# A recorded workspace is required for this association.
# The selected commit must also be reachable from the Player's recorded branch.
# Selection runs before the landing pipeline creates scratch state.
def assoc_same(w: String, r: String, +workspace: String, +repo: String) -> IO(Unit):
  Bool.pick(IO(Unit), String.eq(w, r),
    IO.pure(Unit, Unit{}),
    IO.die(Unit, 2, "The recorded workspace belongs to a different repository than " ++ repo ++ ": " ++ workspace))

# The host realpath canonicalizes the git-reported directory, so a symlinked
# spelling and its resolved spelling compare equal.
def assoc_real_pick(resolved: Result<&1,&1,U32 & String,String>, +directory: String) -> IO(String):
  match resolved:
    case Done{value}: IO.pure(String, value)
    case Fail{(code, detail)}: IO.die(String, code, "Cannot resolve recorded workspace directory " ++ directory ++ ": " ++ detail)

def assoc_real(+directory: String) -> IO(String):
  do IO<String>:
    resolved : Result<&1,&1,U32 & String,String> <- Host.Control.workspace(directory)
    assoc_real_pick(resolved, directory)

def assoc_canonical(+workspace: String, +repo: String, wdir: String, rdir: String) -> IO(Unit):
  do IO<Unit>:
    w : String <- assoc_real(wdir)
    r : String <- assoc_real(rdir)
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

# The reviewed entry requires a recorded workspace to identify the source
# repository. It returns a refusal when workspace metadata is absent.
# This check runs before commit selection and landing effects.
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
    oid : String <- selected_or_die(picked)
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
    oid : String <- selected_or_die(picked)
    run_checked(db, player, repo, target, check, files, oid)
