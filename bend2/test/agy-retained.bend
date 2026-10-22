# Bounded retained receive path for agy. It resumes a native conversation through
# the real player launcher, writes one user frame with `input`, and reads stdout to
# EOF. The fixture adds no stdin close of its own: when `input` leaves stdin open,
# the fake agy waits for EOF, this fixture waits for stdout, and the test times out.
import Base
import ../src/harness/agy-player.bend as Agy
import ../src/host/process.bend as P
import ../src/git/text.bend as Tx

def stdout_lines(+handle: U32, next: Maybe<String>) -> IO(Unit):
  match next:
    case None{}: IO.pure(Unit,Unit{})
    case Some{text}: do IO<Unit>:
      IO.print("out\t" ++ Tx.trim_nl(text))
      following : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
      stdout_lines(handle,following)

def sent(+handle: U32, text: String) -> IO(Unit):
  do IO<Unit>:
    written : Result<&1,&1,U32 & String,Unit> <- Agy.input(handle,text)
    first : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
    stdout_lines(handle,first)

def launched(result: Result<&1,&1,U32 & String,U32>, text: String) -> IO(Unit):
  match result:
    case Fail{error}: IO.die(Unit,2,"agy resume launch failed")
    case Done{+handle}: sent(handle,text)

def run(args: List<String>) -> IO(Unit):
  match args:
    case cmd <> directory <> session <> text <> Nil{}: do IO<Unit>:
      spawned : Result<&1,&1,U32 & String,U32> <- Agy.resume_player(cmd,"agy-model-test","high",directory,directory ++ "/agy.stderr",session)
      launched(spawned,text)
    case other: IO.die(Unit,2,"usage: agy-retained CMD DIRECTORY SESSION TEXT")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
