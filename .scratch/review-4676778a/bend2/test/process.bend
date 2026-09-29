import Base
import ../src/host/process.bend as P

def finish(handle: U32) -> IO(Unit):
  do IO<Unit>:
    result : String <- IO.try(String,P.ProcessChild.wait(handle))
    IO.print(result)

@unsafe
def lines(+handle: U32, line: Maybe<String>) -> IO(Unit):
  match line:
    case None{}: finish(handle)
    case Some{text}:
      do IO<Unit>:
        printed : Unit <- IO.print(text)
        next : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
        lines(handle,next)

def closed(+handle: U32) -> IO(Unit):
  do IO<Unit>:
    done : String <- IO.try(String,P.ProcessChild.wait(handle))
    IO.try(Unit,P.ProcessChild.write(handle,"closed stdin"))

def start_read(+handle: U32, should_write: Bool) -> IO(Unit):
  match should_write:
    case True{}: closed(handle)
    case False{}:
      do IO<Unit>:
        close : Unit <- IO.try(Unit,P.ProcessChild.close_stdin(handle))
        line : Maybe<String> <- IO.try(Maybe<String>,P.ProcessChild.read_line(handle))
        lines(handle,line)

def cli(args: List<String>) -> IO(Unit):
  match args:
    case mode <> cwd <> log <> program:
      do IO<Unit>:
        handle : U32 <- IO.try(U32,P.ProcessChild.spawn(P.argv(program),cwd,log))
        start_read(handle,String.eq(mode,"closed"))
    case _: IO.die(Unit,2,"MODE CWD STDERR PROGRAM ARGS...")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    cli(args)
