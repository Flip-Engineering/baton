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

def configured_runtime(configured: String) -> IO(Result<&1,&1,U32 & String,String>):
  match is_absolute(configured):
    case False{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"BATON2_NODE must be an absolute executable path; unset it to use the packaged runtime or set it to a Node executable.")})
    case True{}: do IO<Result<&1,&1,U32 & String,String>>:
      found : Result<&1,&1,U32 & String,String> <- Host.Control.command(configured)
      match found:
        case Done{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{configured})
        case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"BATON2_NODE is set to " ++ configured ++ ", but that path is not an executable Node runtime. Point it at an absolute executable path or unset it to use the packaged runtime.")})

def try_installed(candidates: List<String>, executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  match candidates:
    case Nil{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,missing_runtime(executable))})
    case candidate <> rest: do IO<Result<&1,&1,U32 & String,String>>:
      found : Result<&1,&1,U32 & String,String> <- Host.Control.command(candidate)
      match found:
        case Done{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
        case Fail{error}: try_installed(rest,executable)

def path_runtime(executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    found : Result<&1,&1,U32 & String,String> <- Host.Control.command("node")
    match found:
      case Done{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{"node"})
      case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,missing_runtime(executable))})

def resolve(executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    configured : Result<&1,&1,U32 & String,String> <- IO.get_env("BATON2_NODE")
    match configured:
      case Done{value}:
        match String.is_empty(value):
          case True{}: installed_runtime(executable)
          case False{}: configured_runtime(value)
      case Fail{error}: installed_runtime(executable)

def installed_runtime(executable: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +base : String = directory(executable)
    candidates = [base ++ "node",base ++ "../libexec/baton2/repl/bun"]
    found : Result<&1,&1,U32 & String,String> <- try_installed(candidates,executable)
    match found:
      case Done{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
      case Fail{error}: path_runtime(executable)
