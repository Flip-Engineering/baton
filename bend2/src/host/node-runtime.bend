import Base
import ./control.bend as Host

# An installed package may carry Node beside the router, Bun below libexec, or
# no runtime on PATH. The selection order matches the native dispatch resolver:
# BATON2_NODE, sibling bin/node, bundled libexec/baton2/repl/bun, then PATH node.
def directory_step(+rest: String, +current: String, +last: String) -> String:
  match rest:
    case SNil{}: last
    case SCon{+head,+tail}:
      +next = current ++ SCon{head,SNil{}}
      directory_step(tail,next,Bool.pick(String,Char.is_eq(head,Char.from_u32(47)),next,last))

def directory(executable: String) -> String:
  directory_step(executable,"","")

def is_absolute(path: String) -> Bool:
  match path:
    case SCon{+head,+tail}: Char.is_eq(head,Char.from_u32(47))
    case SNil{}: False{}

def missing_runtime(executable: String) -> String:
  "No Node runtime is available for " ++ executable ++ ": BATON2_NODE is unset, no sibling bin/node or bundled libexec/baton2/repl/bun is executable, and node is not on PATH. Install the complete Baton package or set BATON2_NODE to an absolute executable Node runtime."

def configured_result(+configured: String, found: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match found:
    case Done{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{configured})
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"BATON2_NODE is set to " ++ configured ++ ", but that path is not an executable Node runtime. Point it at an absolute executable path or unset it to use the packaged runtime.")})

def configured_absolute(+configured: String, absolute: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match absolute:
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"BATON2_NODE must be an absolute executable path; unset it to use the packaged runtime or set it to a Node executable.")})
    case True{}: do IO<Result<&1,&1,U32 & String,String>>:
      found : Result<&1,&1,U32 & String,String> <- Host.Control.command(configured)
      configured_result(configured,found)

def configured_runtime(+configured: String) -> IO(Result<&1,&1,U32 & String,String>):
  configured_absolute(configured,is_absolute(configured))

def path_result(executable: String, found: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match found:
    case Done{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{"node"})
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,missing_runtime(executable))})

def path_runtime(executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    found : Result<&1,&1,U32 & String,String> <- Host.Control.command("node")
    path_result(executable,found)

def bundled_result(executable: String, found: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match found:
    case Done{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
    case Fail{error}: path_runtime(executable)

def bundled_runtime(executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    found : Result<&1,&1,U32 & String,String> <- Host.Control.command(directory(executable) ++ "../libexec/baton2/repl/bun")
    bundled_result(executable,found)

def sibling_result(executable: String, found: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match found:
    case Done{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
    case Fail{error}: bundled_runtime(executable)

def sibling_runtime(executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    found : Result<&1,&1,U32 & String,String> <- Host.Control.command(directory(executable) ++ "node")
    sibling_result(executable,found)

def installed_runtime(executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  sibling_runtime(executable)

def environment_value(+executable: String, +value: String, empty: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match empty:
    case True{}: installed_runtime(executable)
    case False{}: configured_runtime(value)

def environment_result(+executable: String, configured: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match configured:
    case Done{+value}: environment_value(executable,value,String.is_empty(value))
    case Fail{error}: installed_runtime(executable)

def resolve(+executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    configured : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON2_NODE")
    environment_result(executable,configured)
