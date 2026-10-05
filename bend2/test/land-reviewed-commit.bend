# Fixture entry for the reviewed-source landing selection.
#
# Isolated module entry: it calls the real Land selection functions directly, so
# it measures landing behaviour. The public grammar is composed separately by the
# interfaces owner, so a parser refusal of an unknown option is a different
# observation from anything printed here.
#
#   bend bend2/test/land-reviewed-commit.bend -o OUT.c
#   clang -O1 -pthread OUT.c -lsqlite3 -lm -o OUT
#   OUT REPOSITORY SELECTOR...
#
# Each selector prints one line naming the selector and the decision the
# implementation actually produced for it. Repository, commit, blob, missing and
# malformed selectors are expected to separate into picked, refused (absence) and
# failed (operation failure), and the observed statuses are the evidence.
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

def start(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}:
      IO.print("usage: land-reviewed-commit REPOSITORY SELECTOR...")
    case Con{+repo, rest}:
      each(repo, rest)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    start(args)
