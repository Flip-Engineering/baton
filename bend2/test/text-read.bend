import Base
import ../src/host/text.bend as Text

# U1 Text.read backend parity: the native-backend vectors (spec
# rewrite-native/text-read-parity-spec.md at 2036666). One line per
# vector in the results file: ok:<value> or fail:<code>. The message is
# dropped here: code equality is the whole cross-backend contract and
# no harness may branch on the message.
def outcome(result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Done{value}: "ok:" ++ value ++ "\n"
    case Fail{(code, message)}: "fail:" ++ U32.show(code) ++ "\n"

def main() -> IO(Unit):
  do IO<Unit>:
    missing : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/absent")
    first : String <- IO.pure(String,outcome(missing))
    directory : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/dir")
    second : String <- IO.pure(String,outcome(directory))
    nulled : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/nul" ++ SCon{Char.from_u32(0),SNil{}})
    third : String <- IO.pure(String,outcome(nulled))
    decoded : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/utf8")
    fourth : String <- IO.pure(String,outcome(decoded))
    streamed : Result<&1,&1,U32 & String,String> <- Text.Text.read("-")
    fifth : String <- IO.pure(String,outcome(streamed))
    vacant : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/empty")
    sixth : String <- IO.pure(String,outcome(vacant))
    locked : Result<&1,&1,U32 & String,String> <- Text.Text.read("cases/locked")
    seventh : String <- IO.pure(String,outcome(locked))
    IO.try(Unit,Text.Text.append("results",first ++ second ++ third ++ fourth ++ fifth ++ sixth ++ seventh))
