import Base
import ../src/host/text.bend as Text
import ../src/host/files.bend as Files

# Files.mode and Files.executable vectors (bend2/src/host/files.bend):
# octal permission text with no leading zero, the executable predicate,
# and cause retention for a missing path. Outcomes are newline-safe
# values, so one results file with one line per vector is unambiguous.
def outcome(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: "ok:" ++ value ++ "\n"
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def main() -> IO(Unit):
  do IO<Unit>:
    plain : Result<&1,&1,U32 & String,String> <- Files.Files.mode("cases/plain")
    first : String <- IO.pure(String,outcome(plain))
    runnable : Result<&1,&1,U32 & String,String> <- Files.Files.mode("cases/runnable")
    second : String <- IO.pure(String,outcome(runnable))
    sealed : Result<&1,&1,U32 & String,String> <- Files.Files.mode("cases/sealed")
    third : String <- IO.pure(String,outcome(sealed))
    place : Result<&1,&1,U32 & String,String> <- Files.Files.mode("cases/dir")
    fourth : String <- IO.pure(String,outcome(place))
    absent : Result<&1,&1,U32 & String,String> <- Files.Files.mode("cases/absent")
    fifth : String <- IO.pure(String,outcome(absent))
    may : Result<&1,&1,U32 & String,String> <- Files.Files.executable("cases/runnable")
    sixth : String <- IO.pure(String,outcome(may))
    may_not : Result<&1,&1,U32 & String,String> <- Files.Files.executable("cases/plain")
    seventh : String <- IO.pure(String,outcome(may_not))
    sealed_run : Result<&1,&1,U32 & String,String> <- Files.Files.executable("cases/sealed")
    eighth : String <- IO.pure(String,outcome(sealed_run))
    gone : Result<&1,&1,U32 & String,String> <- Files.Files.executable("cases/absent")
    ninth : String <- IO.pure(String,outcome(gone))
    IO.try(Unit,Text.Text.append("results",first ++ second ++ third ++ fourth ++ fifth ++ sixth ++ seventh ++ eighth ++ ninth))
