# The Claude Code Stop hook entry and the Claude launch arguments (#1054,
# instance B1). '--stop-hook' runs the hook; 'arguments' prints the Claude argv
# one argument per line.
import Base
import ../src/coordinator/stop-hook.bend as StopHook
import ../src/harness/claude-player.bend as Claude

def lines(args: List<String>) -> IO(Unit):
  match args:
    case Nil{}: IO.pure(Unit,Unit{})
    case head <> tail: do IO<Unit>:
      printed : Unit <- IO.print(head)
      lines(tail)

def route(args: List<String>) -> IO(Unit):
  match args:
    case "--stop-hook" <> Nil{}: StopHook.run()
    case "arguments" <> Nil{}: lines(Claude.arguments("claude","claude-opus-5-5","high"))
    case other: IO.die(Unit,2,"usage: stop-hook-entry --stop-hook|arguments")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    route(args)
