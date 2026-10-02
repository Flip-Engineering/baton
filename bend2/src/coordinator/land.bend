# Coordinator landing: look up a player's branch from the database and land
# its committed tip onto a target branch with a fast-forward update-ref.

import Base
import ./commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
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
