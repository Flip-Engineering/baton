# Fixture entry for the reviewed-source landing.
#
# Isolated module entry: it calls the real Land functions directly, so it
# measures landing behaviour rather than the public grammar. The public grammar is
# composed separately by the interfaces owner, so a parser refusal of an unknown
# option is a different observation from anything printed here.
#
#   bend bend2/test/land-reviewed-commit.bend -o OUT.c
#   clang -O1 -pthread OUT.c -lsqlite3 -lm -o OUT
#
# Modes, all arguments positional:
#   sel-commit REPO SELECTOR...                       one line per selector, naming
#                                                     the decision it produced
#   land-player DB PLAYER REPO TARGET                 the default landing
#   land-player-at DB PLAYER REPO TARGET COMMIT       the reviewed-source landing
#   land-checked-player DB PLAYER REPO TARGET CHECK FILES
#   land-checked-player-at DB PLAYER REPO TARGET CHECK FILES COMMIT
#
# The whole-operation modes print the Land outcome JSON themselves, and a refusal
# ends the process with the refusal's own status, so the caller asserts on the
# exit status and on the Git state rather than on this entry's wording.
import Base
import ../src/coordinator/land.bend as Land
import ../src/json/canonical.bend as J

def report(+selector: String, s: Land.Selected) -> IO(Unit):
  match s:
    case Land.SelPicked{oid}:
      IO.print("{\"selector\":" ++ J.string_literal(selector) ++ ",\"decision\":\"picked\",\"oid\":" ++ J.string_literal(oid) ++ "}")
    case Land.SelRefused{reason}:
      IO.print("{\"selector\":" ++ J.string_literal(selector) ++ ",\"decision\":\"refused\",\"reason\":" ++ J.string_literal(reason) ++ "}")
    case Land.SelFailed{code, detail}:
      IO.print("{\"selector\":" ++ J.string_literal(selector) ++ ",\"decision\":\"failed\",\"code\":" ++ J.string_literal(U32.show(code)) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}")

def each(+repo: String, selectors: List<String>) -> IO(Unit):
  match selectors:
    case Nil{}: IO.pure(Unit, Unit{})
    case Con{+selector, rest}:
      do IO<Unit>:
        s : Land.Selected <- Land.sel_commit(repo, selector)
        _line : Unit <- report(selector, s)
        each(repo, rest)

def sel_mode(args: List<String>) -> IO(Unit):
  match args:
    case Con{+repo, rest}: each(repo, rest)
    case Nil{}: IO.print("usage: sel-commit REPO SELECTOR...")

def land_player_mode(args: List<String>) -> IO(Unit):
  match args:
    case Con{+db, Con{+player, Con{+repo, Con{+target, Nil{}}}}}:
      Land.land_player(db, player, repo, target)
    case _:
      IO.print("usage: land-player DB PLAYER REPO TARGET")

def land_player_at_mode(args: List<String>) -> IO(Unit):
  match args:
    case Con{+db, Con{+player, Con{+repo, Con{+target, Con{+commit, Nil{}}}}}}:
      Land.land_player_at(db, player, repo, target, commit)
    case _:
      IO.print("usage: land-player-at DB PLAYER REPO TARGET COMMIT")

def land_checked_mode(args: List<String>) -> IO(Unit):
  match args:
    case Con{+db, Con{+player, Con{+repo, Con{+target, Con{+check, Con{+files, Nil{}}}}}}}:
      Land.land_checked_player(db, player, repo, target, check, files)
    case _:
      IO.print("usage: land-checked-player DB PLAYER REPO TARGET CHECK FILES")

def land_checked_at_mode(args: List<String>) -> IO(Unit):
  match args:
    case Con{+db, Con{+player, Con{+repo, Con{+target, Con{+check, Con{+files, Con{+commit, Nil{}}}}}}}}:
      Land.land_checked_player_at(db, player, repo, target, check, files, commit)
    case _:
      IO.print("usage: land-checked-player-at DB PLAYER REPO TARGET CHECK FILES COMMIT")

def route(mode: String, rest: List<String>) -> IO(Unit):
  match mode:
    case "sel-commit": sel_mode(rest)
    case "land-player": land_player_mode(rest)
    case "land-player-at": land_player_at_mode(rest)
    case "land-checked-player": land_checked_mode(rest)
    case "land-checked-player-at": land_checked_at_mode(rest)
    case _: IO.print("unknown mode: " ++ mode)

def run(args: List<String>) -> IO(Unit):
  match args:
    case Con{+mode, rest}: route(mode, rest)
    case Nil{}: IO.print("usage: land-reviewed-commit MODE ARGS...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
