import Base
import ../src/git/process.bend as P
import ../src/git/text.bend as Tx
import ../src/host/text.bend as Text
# D5 env-delta vectors (spec rewrite-native/spawn-env-proposal.md at
# da3537 semantics, review-approved). Each case runs /usr/bin/env through
# Process.run with one delta and writes the child's captured stdout - or
# fail:<code> - to its own results file, so multi-line child output never
# straddles records. The driver controls the parent environment.
def outcome(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: value
    case Fail{(code, message)}: "fail:" ++ U32.show(code)

def run_env(delta: String) -> IO(String):
  do IO<String>:
    ran : Result<&1,&1,U32 & String,String> <-
      P.Process.run(Tx.str_rev(Tx.str_rev(Tx.enc_argv(Con{"/usr/bin/env",Nil{}}))), ".", delta)
    IO.pure(String,outcome(ran))

def main() -> IO(Unit):
  do IO<Unit>:
    one : String <- run_env("FOO")
    IO.try(Unit,Text.Text.append("results-1",one))
    two : String <- run_env("CHILD_BAR=2")
    IO.try(Unit,Text.Text.append("results-2",two))
    three : String <- run_env("FOO=9")
    IO.try(Unit,Text.Text.append("results-3",three))
    four : String <- run_env("")
    IO.try(Unit,Text.Text.append("results-4",four))
    five : String <- run_env("=bad")
    IO.try(Unit,Text.Text.append("results-5",five))
    six : String <- run_env("K=V=W")
    IO.try(Unit,Text.Text.append("results-6",six))
    seven : String <- run_env("FOO" ++ SCon{Char.from_u32(0),SNil{}} ++ "FOO=9")
    IO.try(Unit,Text.Text.append("results-7",seven))
    eight : String <- run_env("FOO=9" ++ SCon{Char.from_u32(0),SNil{}} ++ "FOO")
    IO.try(Unit,Text.Text.append("results-8",eight))
