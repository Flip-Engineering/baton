import Base
import ../../src/host/process.bend as Process

def show(result: Result<&1,&1,U32 & String,Maybe<String>>) -> String:
  match result:
    case Fail{(code,text)}: "error:" ++ U32.show(code) ++ ":" ++ text
    case Done{None{}}: "no-recovery-command"
    case Done{Some{command}}: "recovery-command:" ++ command

def inspect(directory: String) -> IO(Unit):
  do IO<Unit>:
    result : Result<&1,&1,U32 & String,Maybe<String>> <- Process.ProcessChild.recovery_argv(directory)
    IO.print(show(result))

def cli(args: List<String>) -> IO(Unit):
  match args:
    case Con{directory,Nil{}}: inspect(directory)
    case other: IO.die(Unit,2,"Expected attempt directory.")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args
    cli(args)
