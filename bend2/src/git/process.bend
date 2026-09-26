# The one foreign effect of the Git operations module and its typed wrappers.
# Process.run spawns a process with no shell anywhere: the Bend side passes
# the argv as a length-prefixed string (Tx.enc_argv) and the C half forks,
# execs and waits on a helper thread. runFull keeps the exit/signal
# distinction the landing gate needs; runGit flattens a git command to its
# exit code and output.

import Base
import ./types.bend as T
import ./text.bend as Tx

def Process.run(argv: String, cwd: String) -> IO(Result<&1, &1, U32 & String, String>):
  import "./process.c"

def runFull(args: List<String>, cwd: String) -> IO(T.RunRes):
  IO.bind(Result<&1, &1, U32 & String, String>, T.RunRes,
    Process.run(Tx.str_rev(Tx.str_rev(Tx.enc_argv(args))), cwd),
    x => IO.pure(T.RunRes, Tx.run_res(x)))

def git_out(r: T.RunRes) -> T.GitOut:
  match r:
    case T.RRun{T.SExit{code}, out}: T.GRun{code, out}
    case T.RRun{T.SSignal{num}, out}: T.GBroken{"git killed by signal"}
    case T.RSpawn{detail}: T.GBroken{detail}

def runGit(dir: String, args: List<String>) -> IO(T.GitOut):
  +d2 = dir
  IO.bind(T.RunRes, T.GitOut,
    runFull(Con{"git", Con{"-C", Con{d2, args}}}, "."),
    r => IO.pure(T.GitOut, git_out(r)))
