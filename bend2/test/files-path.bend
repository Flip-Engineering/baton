import Base
import ../src/host/text.bend as Text
import ../src/host/files.bend as Files

# Files.copy and Files.which vectors (bend2/src/host/files.bend). Each
# outcome lands in its own results file. The which cases read PATH from
# the process environment, which the driver sets to two fixture
# directories.
def text_of(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: "ok:" ++ value
    case Fail{(code, message)}: "fail:" ++ U32.show(code)

def unit_of(result: Result<&1,&1,U32 & String,Unit>) -> String:
  match result:
    case Done{unit}: "ok:"
    case Fail{(code, message)}: "fail:" ++ U32.show(code)

def main() -> IO(Unit):
  do IO<Unit>:
    found : Result<&1,&1,U32 & String,String> <- Files.Files.which("probe-exec")
    IO.try(Unit,Text.Text.append("results-we",text_of(found)))
    plain : Result<&1,&1,U32 & String,String> <- Files.Files.which("probe-plain")
    IO.try(Unit,Text.Text.append("results-wn",text_of(plain)))
    absent : Result<&1,&1,U32 & String,String> <- Files.Files.which("no-such-tool")
    IO.try(Unit,Text.Text.append("results-wa",text_of(absent)))
    copied : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/source","cases/dest")
    IO.try(Unit,Text.Text.append("results-c1",unit_of(copied)))
    content : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/dest")
    IO.try(Unit,Text.Text.append("results-c2",text_of(content)))
    mode : Result<&1,&1,U32 & String,String> <- Files.Files.mode("cases/dest")
    IO.try(Unit,Text.Text.append("results-c3",text_of(mode)))
    missing : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/absent","cases/dest2")
    IO.try(Unit,Text.Text.append("results-c4",unit_of(missing)))
    nodir : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/source","cases/nodir/dest")
    IO.try(Unit,Text.Text.append("results-c5",unit_of(nodir)))
