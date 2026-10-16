import Base
import ../src/host/text.bend as Text
import ../src/host/files.bend as Files

# Files.copy and Files.which vectors (bend2/src/host/files.bend). Each
# outcome lands in its own results file. The which cases read PATH from
# the process environment, which the driver sets to two fixture
# directories. The copy cases cover a plain copy with mode, the two
# absence failures, same-inode alias refusals (same path, hardlink,
# symlink) with both sides preserved, a directory source with an existing
# destination preserved, a writerless FIFO that must not wait, and an
# executable-mode copy.
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
    selfcopy : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/source","cases/source")
    IO.try(Unit,Text.Text.append("results-c6",unit_of(selfcopy)))
    hardcopy : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/source","cases/alias-hard")
    IO.try(Unit,Text.Text.append("results-c7",unit_of(hardcopy)))
    symcopy : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/source","cases/alias-sym")
    IO.try(Unit,Text.Text.append("results-c8",unit_of(symcopy)))
    dircopy : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/dir","cases/dest-full")
    IO.try(Unit,Text.Text.append("results-c9",unit_of(dircopy)))
    fifocopy : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/pipe","cases/dest-fifo")
    IO.try(Unit,Text.Text.append("results-c10",unit_of(fifocopy)))
    execcopy : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/runme","cases/runme-copy")
    IO.try(Unit,Text.Text.append("results-c11",unit_of(execcopy)))
    execmode : Result<&1,&1,U32 & String,String> <- Files.Files.mode("cases/runme-copy")
    IO.try(Unit,Text.Text.append("results-c12",text_of(execmode)))
    preserved : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/source")
    IO.try(Unit,Text.Text.append("results-c13",text_of(preserved)))
    kept : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/dest-full")
    IO.try(Unit,Text.Text.append("results-c14",text_of(kept)))
    sourcemode : Result<&1,&1,U32 & String,String> <- Files.Files.mode("cases/source")
    IO.try(Unit,Text.Text.append("results-c15",text_of(sourcemode)))
    fifodest : Result<&1,&1,U32 & String,Unit> <- Files.Files.copy("cases/source","cases/pipe")
    IO.try(Unit,Text.Text.append("results-c16",unit_of(fifodest)))
    through : Result<&1,&1,U32 & String,String> <- Files.Files.kind("cases/dirlink")
    IO.try(Unit,Text.Text.append("results-k1",text_of(through)))
    itself : Result<&1,&1,U32 & String,String> <- Files.Files.kind_link("cases/dirlink")
    IO.try(Unit,Text.Text.append("results-k2",text_of(itself)))
    broken_kind : Result<&1,&1,U32 & String,String> <- Files.Files.kind("cases/brokenlink")
    IO.try(Unit,Text.Text.append("results-k3",text_of(broken_kind)))
    broken_self : Result<&1,&1,U32 & String,String> <- Files.Files.kind_link("cases/brokenlink")
    IO.try(Unit,Text.Text.append("results-k4",text_of(broken_self)))
