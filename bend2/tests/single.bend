import Base

def Process.run(argv: String, cwd: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./process.c"

def GitOut1(r: Result<&1, &1, U32 & String, String>) -> String:
  match r:
    case Fail{error}:
      (code, text) = error
      "fail"
    case Done{value}: value

def main() -> IO(Unit):
  do IO<Unit>:
    r1 : Result<&1, &1, U32 & String, String> <- Process.run("6:rev-p4:arse", ".")
    IO.print(GitOut1(r1))
