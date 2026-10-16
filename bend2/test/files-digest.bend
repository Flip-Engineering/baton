import Base
import ../src/host/text.bend as Text
import ../src/host/files.bend as Files

# Files.digest vectors (bend2/src/host/files.bend): the streamed SHA-256
# of a text file, of an empty file, and the ENOENT refusal. Expected hex
# values are hardcoded independently in the driver.
def text_of(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: "ok:" ++ value ++ "\n"
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def main() -> IO(Unit):
  do IO<Unit>:
    payload : Result<&1,&1,U32 & String,String> <- Files.Files.digest("cases/source")
    IO.try(Unit,Text.Text.append("results-d1",text_of(payload)))
    vacant : Result<&1,&1,U32 & String,String> <- Files.Files.digest("cases/empty")
    IO.try(Unit,Text.Text.append("results-d2",text_of(vacant)))
    missing : Result<&1,&1,U32 & String,String> <- Files.Files.digest("cases/absent")
    IO.try(Unit,Text.Text.append("results-d3",text_of(missing)))
