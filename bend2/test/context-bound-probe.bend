# The bound-database probe: prints the canonical binding of the coordination
# database named on the command line, runs SELECT 1 through Sql.query_bound, and
# shows that a healthy expected binding executes its caller SQL while an
# altered, token-carrying, trailing, duplicate or malformed one executes none: one
# `key=value` per line, creating no file. Run from the repository root:
#   $BEND bend2/test/context-bound-probe.bend -o .scratch/context-bound-probe/probe.c
#   clang -O1 -pthread .scratch/context-bound-probe/probe.c -lsqlite3 -lm -o .scratch/context-bound-probe/probe
#   ./.scratch/context-bound-probe/probe DATABASE [FOREIGN]

import Base
import ../src/host/sqlite.bend as DB
import ../src/git/text.bend as Tx

# The `"file"` member gains a leading digit: its value changes while the text
# keeps the same members. The text splits on commas, so the path must not hold one.
def bump(xs: List<&2, String>) -> List<&2, String>:
  match xs:
    case Nil{}: Nil{}
    case Con{+h, t}:
      +found = String.starts_with(h, "\"file\":")
      Con{Bool.pick(String, found, "\"file\":1" ++ String.drop(h, 7n), h), bump(t)}
def altered(binding: String) -> String:
  String.join(bump(String.split(binding, Char.from_u32(44))), ",")
# unbrace drops the closing brace, so a case can append a member or omit it.
def unbrace(binding: String) -> String:
  String.reverse(String.drop(String.reverse(binding), 1n))
def line(key: String, kind: String, result: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match result:
    case Done{value}: IO.print(key ++ "." ++ kind ++ "=" ++ Tx.trim_nl(value))
    case Fail{(code,message)}: IO.print(key ++ ".error=" ++ message)

# Caller SQL runs only when `expected` passes the binding check.
def run_case(path: String, label: String, expected: String, sql: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.query_bound(path, expected, sql)
    line(label, "rows", result)
def cross_after(rest: List<String>, binding: String) -> IO(Unit):
  match rest:
    case Nil{}: IO.print("cross.skipped=no-foreign-path")
    case +foreign <> more: run_case(foreign, "cross", binding, "SELECT 1;")
def missing_line(path: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.binding(path ++ "/context-bound-probe-missing.sqlite")
    line("missing", "binding", result)
def bound_cases(path: String, rest: List<String>, binding: String) -> IO(Unit):
  +p = path
  +b = binding
  do IO<Unit>:
    shown : Unit <- IO.print("binding=" ++ b)
    bound : Unit <- run_case(p, "bound", b, "SELECT 1;")
    marker : Unit <- run_case(p, "marker", b, "INSERT INTO t VALUES(2);")
    legacy : Result<&1,&1,U32 & String,String> <- DB.Sql.query(p, "SELECT 1;")
    older : Unit <- line("legacy", "rows", legacy)
    mismatch : Unit <- run_case(p, "mismatch", altered(b), "INSERT INTO t VALUES(2);")
    token : Unit <- run_case(p, "token", unbrace(b) ++ ",\"token\":\"must-match\"}", "INSERT INTO t VALUES(2);")
    trailing : Unit <- run_case(p, "trailing", b ++ "junk", "INSERT INTO t VALUES(2);")
    duplicate : Unit <- run_case(p, "duplicate", unbrace(b) ++ ",\"device\":0}", "INSERT INTO t VALUES(2);")
    malformed : Unit <- run_case(p, "malformed", unbrace(b), "INSERT INTO t VALUES(2);")
    cross : Unit <- cross_after(rest, b)
    missing_line(p)
def probe_after(path: String, rest: List<String>, binding: Result<&1,&1,U32 & String,String>) -> IO(Unit):
  match binding:
    case Done{value}: bound_cases(path, rest, value)
    case Fail{(code,message)}: IO.print("binding.error=" ++ message)
def probe(path: String, rest: List<String>) -> IO(Unit):
  +p = path
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,String> <- DB.Sql.binding(p)
    probe_after(p, rest, result)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case +path <> rest: probe(path, rest)
    case Nil{}: IO.die(Unit,2,"context-bound-probe DATABASE [FOREIGN]")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
