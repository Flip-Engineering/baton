# Coordinator landing: look up a player's branch from the database and land
# its committed tip onto a target branch with a fast-forward update-ref.

import Base
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../host/control.bend as Host
import ../host/session-lock.bend as Lock
import ./control.bend as Control
import ../git/process.bend as Git
import ../git/land.bend as GitLand
import ../git/types.bend as G
import ../git/text.bend as Tx
import ../json/canonical.bend as J
import ../storage/lifecycle.bend as StoragePolicy

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

# A landed or already-contained target is a successful consolidation. Triggered
# collection for the player then drains its settled scratch, build-output,
# export and log-evidence candidates under the collector's own locks and
# leases. Checkout candidates stay for an explicit operator apply.
def collect_landed(+db: String, +player: String, ok: Bool) -> IO(Unit):
  Bool.pick(IO(Unit), ok, StoragePolicy.collect_settled(db, player), IO.pure(Unit, Unit{}))

def shown_pair(pair: Bool & String) -> IO(Bool):
  (advanced, text) = pair
  do IO<Bool>:
    printed : Unit <- IO.print(text)
    IO.pure(Bool, advanced)

def show_outcome(o: G.LandOutcome) -> IO(Bool):
  shown_pair(GitLand.outcome_json_success(o))

# The native agent shell records BATON_SESSION. When the series registry
# resolves that session's model, the landing re-enters itself through the
# existing git-series launcher, so every Git child of the landing carries the
# verified bot author and committer instead of an inherited shared-config
# identity. The guard stops the child from wrapping a second time.
def identity_environment_value(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Done{value}: IO.pure(String,value)
    case Fail{(+code,detail)}:
      Bool.pick(IO(String),U32.is_eq(code,2),IO.pure(String,""),IO.die(String,code,detail))

def identity_environment(name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    identity_environment_value(result)

def identity_model_value(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Done{value}: IO.pure(String,Tx.trim_nl(value))
    case Fail{error}: IO.pure(String,"")

def identity_actor_model(+db: String, +actor: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(actor),IO.pure(String,""),
    (do IO<String>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT model FROM sessions WHERE id=" ++ C.q(actor) ++ ";")
      identity_model_value(result)))

def identity_actor_workspace(+db: String, +actor: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(actor),IO.pure(String,""),
    (do IO<String>:
      result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT workspace FROM sessions WHERE id=" ++ C.q(actor) ++ ";")
      identity_model_value(result)))

def identity_write(+out: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(out),IO.pure(Unit,Unit{}),IO.write(out))

def identity_run_value(result: G.RunRes) -> IO(Bool):
  match result:
    case G.RRun{G.SExit{+code}, +out}:
      Bool.pick(IO(Bool),U32.is_eq(code,0),
        do IO<Bool>:
          _written : Unit <- identity_write(out)
          IO.pure(Bool,True{}),
        do IO<Bool>:
          _written : Unit <- identity_write(out)
          IO.die(Bool,code,"The configured landing identity wrapper exited " ++ U32.show(code) ++ "."))
    case G.RRun{G.SSignal{+num}, +out}:
      do IO<Bool>:
        _written : Unit <- identity_write(out)
        IO.die(Bool,U32.add(num,128),"The configured landing identity wrapper was killed by a signal.")
    case G.RSpawn{detail}: IO.die(Bool,1,detail)

def identity_result(result: Result<&1,&1,U32 & String,String>) -> IO(Bool):
  identity_run_value(Tx.run_res(result))

def identity_wrapped_as(+db: String, +actor: String, verb: String, args: List<String>) -> IO(Bool):
  do IO<Bool>:
    applied : String <- identity_environment("BATON2_GIT_IDENTITY_APPLIED")
    Bool.pick(IO(Bool),Bool.not(String.is_empty(applied)),IO.pure(Bool,False{}),
    (do IO<Bool>:
      +model : String <- identity_actor_model(db,actor)
      +workspace : String <- identity_actor_workspace(db,actor)
      +repository : String <- Control.workspace_repository(workspace)
      Bool.pick(IO(Bool),Bool.or(String.is_empty(actor),String.is_empty(model)),IO.pure(Bool,False{}),
      (do IO<Bool>:
        +executable : String <- IO.try(String,Lock.SessionLock.executable())
        identity : String & String <- IO.try(String & String,Host.Control.identity(executable))
        launch : List<String> = Control.identity_args(Con{executable,Con{db,Con{verb,args}}},model,identity,repository)
        guarded : List<String> = Con{"/usr/bin/env",Con{"BATON2_GIT_IDENTITY_APPLIED=1",launch}}
        result : Result<&1,&1,U32 & String,String> <- Git.Process.run(Tx.enc_argv(guarded),".")
        identity_result(result)))))

def identity_wrapped(+db: String, verb: String, args: List<String>) -> IO(Bool):
  do IO<Bool>:
    +actor : String <- identity_environment("BATON_SESSION")
    identity_wrapped_as(db,actor,verb,args)

# An operator wrap-up shell records no BATON_SESSION. The session recorded for
# the pushed checkout supplies the model, and a session on the pushed branch
# wins over another session that shares the checkout.
def identity_owner(+db: String, +repo: String, +branch: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT id FROM sessions WHERE workspace=" ++ C.q(repo) ++ " ORDER BY branch=" ++ C.q(branch) ++ " DESC,rowid DESC LIMIT 1;")
    identity_model_value(result)

def identity_actor(+db: String, +repo: String, +branch: String) -> IO(String):
  do IO<String>:
    +selected : String <- identity_environment("BATON_SESSION")
    Bool.pick(IO(String),String.is_empty(selected),identity_owner(db,repo,branch),IO.pure(String,selected))

def land_player_body(+db: String, +player: String, +repo: String, +target: String) -> IO(Unit):
  do IO<Unit>:
    player_row : String <- IO.try(String, Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    outcome : G.LandOutcome <- GitLand.land(repo, branch, target)
    shown : Bool <- show_outcome(outcome)
    collected : Unit <- collect_landed(db, player, shown)
    IO.pure(Unit, collected)

def land_player(+db: String, +player: String, +repo: String, +target: String) -> IO(Unit):
  do IO<Unit>:
    wrapped : Bool <- identity_wrapped(db,"land",[player,repo,target])
    Bool.pick(IO(Unit),wrapped,IO.pure(Unit,Unit{}),land_player_body(db,player,repo,target))

def show_checked_outcome(result: Result<&1,&1,G.GitFail,G.LandOutcome>) -> IO(Bool):
  match result:
    case Fail{error}: IO.die(Bool,1,G.fail_text(error))
    case Done{outcome}: show_outcome(outcome)

# One attempt's scratch path comes from the Git landing module; earlier refused
# or conflicted attempt trees remain available to the player.
def run_checked(+db: String, +player: String, +repo: String, +target: String, +check: String, +files: String, +branch: String) -> IO(Unit):
  do IO<Unit>:
    ts_raw : String <- IO.try(String, DB.Sql.query(db, "" ++ "SELECT hex(randomblob(8));"))
    ts : String <- IO.pure(String, line(ts_raw))
    scratch : String <- GitLand.open_scratch(repo, player, ts)
    result : Result<&1,&1,G.GitFail,G.LandOutcome> <- GitLand.land_checked(repo, target, branch, check, Tx.split_spaces(files), scratch)
    shown : Bool <- show_checked_outcome(result)
    collected : Unit <- collect_landed(db, player, shown)
    IO.pure(Unit, collected)

# The checked landing: the player's branch is squashed onto the target and
# the selected checks run on the candidate and on the target before the
# target advances. FILES is space-separated; CHECK runs as /bin/sh CHECK
# FILE inside each checked tree.
def land_checked_player_body(+db: String, +player: String, +repo: String, +target: String, +check: String, +files: String) -> IO(Unit):
  do IO<Unit>:
    player_row : String <- IO.try(String, Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    run_checked(db, player, repo, target, check, files, branch)

def land_checked_player(+db: String, +player: String, +repo: String, +target: String, +check: String, +files: String) -> IO(Unit):
  do IO<Unit>:
    wrapped : Bool <- identity_wrapped(db,"land-checked",[player,repo,target,check,files])
    Bool.pick(IO(Unit),wrapped,IO.pure(Unit,Unit{}),land_checked_player_body(db,player,repo,target,check,files))

def push_ok(ok: Bool, branch: String, remote: String) -> IO(Unit):
  match ok:
    case True{}: IO.print("{\"status\":\"pushed\",\"branch\":" ++ J.string_literal(branch) ++ ",\"remote\":" ++ J.string_literal(remote) ++ "}")
    case False{}: IO.print("{\"status\":\"rejected\",\"reason\":" ++ J.string_literal(Tx.cmd_failed(Tx.str_cat("git push to ", remote))) ++ "}")

def push_pick(r: G.GitOut, branch: String, remote: String) -> IO(Unit):
  match r:
    case G.GRun{code, out}: push_ok(U32.is_eq(code, 0), branch, remote)
    case G.GBroken{detail}: IO.die(Unit, 1, detail)

# A rejected push states whether a series identity was applied. A push that
# ran without one has no GitHub App credential, so the missing context is named
# apart from a refusal by the helper, which prints its own cause on standard error.
def push_context(applied: String, +actor: String) -> String:
  Bool.pick(String,Bool.not(String.is_empty(applied)),
    "series identity applied; a Series Git operation refused line on standard error names a registry, installation or permission cause",
    Bool.pick(String,String.is_empty(actor),
      "no series identity: BATON_SESSION is unset and no recorded session has this checkout as its workspace",
      "no series identity for session " ++ actor ++ ": its model has no entry in the series registry or no registry is configured"))

def push_ok_context(ok: Bool, branch: String, remote: String, context: String) -> IO(Unit):
  match ok:
    case True{}: push_ok(True{}, branch, remote)
    case False{}: IO.print("{\"status\":\"rejected\",\"reason\":" ++ J.string_literal(Tx.cmd_failed(Tx.str_cat("git push to ", remote))) ++ ",\"identity\":" ++ J.string_literal(context) ++ "}")

def push_pick_context(r: G.GitOut, branch: String, remote: String, context: String) -> IO(Unit):
  match r:
    case G.GRun{code, out}: push_ok_context(U32.is_eq(code, 0), branch, remote, context)
    case G.GBroken{detail}: IO.die(Unit, 1, detail)

def push_branch_body(+repo: String, +branch: String, +remote: String, +actor: String) -> IO(Unit):
  do IO<Unit>:
    applied : String <- identity_environment("BATON2_GIT_IDENTITY_APPLIED")
    r : G.GitOut <- GitLand.push_git(repo, branch, remote)
    push_pick_context(r, branch, remote, push_context(applied, actor))

def push_branch(+db: String, +repo: String, +branch: String, +remote: String) -> IO(Unit):
  do IO<Unit>:
    +actor : String <- identity_actor(db,repo,branch)
    wrapped : Bool <- identity_wrapped_as(db,actor,"push",[repo,branch,remote])
    Bool.pick(IO(Unit),wrapped,IO.pure(Unit,Unit{}),push_branch_body(repo,branch,remote,actor))

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
def land_player_at_body(+db: String, +player: String, +repo: String, +target: String, +commit: String) -> IO(Unit):
  do IO<Unit>:
    player_row : String <- IO.try(String, Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    associated : Unit <- require_association(db, player, repo)
    picked : Selected <- select_reviewed(repo, branch, commit)
    oid : String <- selected_or_die(picked)
    outcome : G.LandOutcome <- GitLand.land_fast_forward_at(repo, oid, target)
    shown : Bool <- show_outcome(outcome)
    collected : Unit <- collect_landed(db, player, shown)
    IO.pure(Unit, collected)

def land_player_at(+db: String, +player: String, +repo: String, +target: String, +commit: String) -> IO(Unit):
  do IO<Unit>:
    wrapped : Bool <- identity_wrapped(db,"land",[player,repo,target,"--commit",commit])
    Bool.pick(IO(Unit),wrapped,IO.pure(Unit,Unit{}),land_player_at_body(db,player,repo,target,commit))

def land_checked_player_at_body(+db: String, +player: String, +repo: String, +target: String, +check: String, +files: String, +commit: String) -> IO(Unit):
  do IO<Unit>:
    player_row : String <- IO.try(String, Store.apply(db, C.Session{player}))
    present : Unit <- require_player(Bool.not(String.is_empty(player_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(player) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    associated : Unit <- require_association(db, player, repo)
    picked : Selected <- select_reviewed(repo, branch, commit)
    oid : String <- selected_or_die(picked)
    run_checked(db, player, repo, target, check, files, oid)

def land_checked_player_at(+db: String, +player: String, +repo: String, +target: String, +check: String, +files: String, +commit: String) -> IO(Unit):
  do IO<Unit>:
    wrapped : Bool <- identity_wrapped(db,"land-checked",[player,repo,target,check,files,"--commit",commit])
    Bool.pick(IO(Unit),wrapped,IO.pure(Unit,Unit{}),land_checked_player_at_body(db,player,repo,target,check,files,commit))
