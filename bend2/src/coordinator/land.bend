# Coordinator landing: look up a worker's branch from the database and land
# its committed tip onto a target branch with a fast-forward update-ref.

import Base
import ./commands.bend as C
import ./store.bend as Store
import ../host/sqlite.bend as DB
import ../git/land.bend as GitLand
import ../git/types.bend as G
import ../git/text.bend as Tx
import ../json/canonical.bend as J

def require_worker(found: Bool) -> IO(Unit):
  match found:
    case True{}: IO.pure(Unit, Unit{})
    case False{}: IO.die(Unit, 2, "The worker session is not registered.")

def require_branch_pick(empty: Bool, branch: String) -> IO(String):
  match empty:
    case True{}: IO.die(String, 2, "The worker has no recorded branch.")
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

def land_worker(+db: String, +worker: String, +repo: String, +target: String) -> IO(Unit):
  do IO<Unit>:
    worker_row : String <- IO.try(String, Store.apply(db, C.Session{worker}))
    present : Unit <- require_worker(Bool.not(String.is_empty(worker_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(worker) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    outcome : G.LandOutcome <- GitLand.land(repo, branch, target)
    show_outcome(outcome)

def show_checked(r: Result<&1, &1, G.GitFail, G.LandOutcome>) -> IO(Unit):
  match r:
    case Fail{error}: IO.die(Unit, 1, G.fail_text(error))
    case Done{value}: show_outcome(value)

def land_checked_worker(+db: String, +worker: String, +repo: String, +target: String, +script: String, +scratch: String, +filesContent: String) -> IO(Unit):
  do IO<Unit>:
    worker_row : String <- IO.try(String, Store.apply(db, C.Session{worker}))
    present : Unit <- require_worker(Bool.not(String.is_empty(worker_row)))
    branch_raw : String <- IO.try(String, DB.Sql.query(db, "SELECT branch FROM sessions WHERE id=" ++ C.q(worker) ++ ";"))
    branch : String <- require_branch(line(branch_raw))
    result : Result<&1, &1, G.GitFail, G.LandOutcome> <- GitLand.land_checked(repo, target, branch, script, Tx.split_lines(filesContent), scratch)
    show_checked(result)
