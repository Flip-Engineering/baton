import Base
import ../src/host/text.bend as Text
import ../src/host/exec.bend as Exec
import ../src/git/text.bend as Tx

# Exec.run_capture vectors (bend2/src/host/exec.bend): captured stdout,
# the child's stderr recorded verbatim in the caller-named path, the
# status line carrying the child's exit code, and the empty-name env
# refusal. Each outcome lands in its own results file.
def line_of(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: value ++ "\n"
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def main() -> IO(Unit):
  do IO<Unit>:
    ran : Result<&1,&1,U32 & String,String> <-
      Exec.Exec.run_capture(
        Tx.enc_argv(Con{"/bin/sh", Con{"-c", Con{"echo out-y; echo err-y >&2; exit 3", Nil{}}}}),
        ".", "", "captured-err")
    IO.try(Unit,Text.Text.append("results-x1",line_of(ran)))
    refused : Result<&1,&1,U32 & String,String> <-
      Exec.Exec.run_capture(
        Tx.enc_argv(Con{"/bin/true", Nil{}}), ".", "=bad", "captured-err2")
    IO.try(Unit,Text.Text.append("results-x2",line_of(refused)))
