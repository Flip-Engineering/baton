import Base
import ../src/host/text.bend as Text
import ../src/host/files.bend as Files

# Files.entries vectors: dot exclusion, NUL joining with an LF inside a
# name, empty directory, missing directory. Each raw outcome is appended
# to its own results file, so the driver compares exact bytes without
# record-boundary ambiguity.
def outcome(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: value
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def main() -> IO(Unit):
  do IO<Unit>:
    listed : Result<&1,&1,U32 & String,String> <- Files.Files.entries("cases")
    first : String <- IO.pure(String,outcome(listed))
    vacant : Result<&1,&1,U32 & String,String> <- Files.Files.entries("cases/empty-dir")
    second : String <- IO.pure(String,outcome(vacant))
    missing : Result<&1,&1,U32 & String,String> <- Files.Files.entries("cases/absent-dir")
    third : String <- IO.pure(String,outcome(missing))
    IO.try(Unit,Text.Text.append("results-listed",first))
    IO.try(Unit,Text.Text.append("results-empty",second))
    IO.try(Unit,Text.Text.append("results-missing",third))
