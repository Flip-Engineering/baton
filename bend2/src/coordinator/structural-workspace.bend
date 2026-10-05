import Base
import ../host/control.bend as Host
import ../git/process.bend as Git
import ../git/text.bend as Tx
import ../git/types.bend as G
import ../json/canonical.bend as J

type Failure is Data:
  HostFailure{stage: String, code: U32, detail: String}

type Observation is Data:
  Observed{repository: String, root: String, path: String, branch: String, head: String, dirty: Bool}

def status_result(stage: String, stderr: String, status: G.RunRes) -> Result<&1,&1,Failure,String>:
  match status:
    case G.RRun{G.SExit{0},out}: Done{out}
    case G.RRun{G.SExit{code},out}: Fail{HostFailure{stage,code,stderr ++ out}}
    case G.RRun{G.SSignal{num},out}: Fail{HostFailure{stage,U32.add(128,num),stderr ++ out}}
    case G.RSpawn{detail}: Fail{HostFailure{stage,1,detail}}

def captured(stage: String, result: Result<&1,&1,U32 & String,String & String>) -> Result<&1,&1,Failure,String>:
  match result:
    case Fail{(code,detail)}: Fail{HostFailure{stage,code,detail}}
    case Done{(stdout,stderr)}: status_result(stage,stderr,Tx.run_res(Done{stdout}))

def run(+stage: String, repo: String, args: List<String>) -> IO(Result<&1,&1,Failure,String>):
  do IO<Result<&1,&1,Failure,String>>:
    result : Result<&1,&1,U32 & String,String & String> <- Git.Process.capture(Tx.enc_argv("git" <> "-C" <> repo <> args),".")
    IO.pure(Result<&1,&1,Failure,String>,captured(stage,result))

def continue(-A: Type, result: Result<&1,&1,Failure,String>, next: String -> IO(Result<&1,&1,Failure,A>)) -> IO(Result<&1,&1,Failure,A>):
  match result:
    case Fail{error}: IO.pure(Result<&1,&1,Failure,A>,Fail{error})
    case Done{value}: next(value)

def bind(-A: Type, operation: IO(Result<&1,&1,Failure,String>), next: String -> IO(Result<&1,&1,Failure,A>)) -> IO(Result<&1,&1,Failure,A>):
  do IO<Result<&1,&1,Failure,A>>:
    result : Result<&1,&1,Failure,String> <- operation
    continue(A,result,next)

def canonical_result(stage: String, result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,Failure,String>:
  match result:
    case Done{path}: Done{path}
    case Fail{(code,detail)}: Fail{HostFailure{stage,code,detail}}

def canonical(+stage: String, path: String) -> IO(Result<&1,&1,Failure,String>):
  do IO<Result<&1,&1,Failure,String>>:
    result : Result<&1,&1,U32 & String,String> <- Host.Control.workspace(path)
    IO.pure(Result<&1,&1,Failure,String>,canonical_result(stage,result))

def observed(repo: String, root: String, path: String, branch: String, head: String, dirty: String) -> IO(Result<&1,&1,Failure,Observation>):
  IO.pure(Result<&1,&1,Failure,Observation>,Done{Observed{Tx.trim_nl(repo),root,path,Tx.trim_nl(branch),Tx.trim_nl(head),Bool.not(String.is_empty(dirty))}})

def inspect_canonical(+path: String) -> IO(Result<&1,&1,Failure,Observation>):
  bind(Observation,run("inspect.root",path,["rev-parse","--show-toplevel"]),root =>
    bind(Observation,canonical("inspect.root.canonical",Tx.trim_nl(root)),root =>
      bind(Observation,run("inspect.repository",path,["rev-parse","--path-format=absolute","--git-common-dir"]),repo =>
        bind(Observation,run("inspect.branch",path,["rev-parse","--abbrev-ref","HEAD"]),branch =>
          bind(Observation,run("inspect.head",path,["rev-parse","--verify","HEAD"]),head =>
            bind(Observation,run("inspect.dirty",path,["status","--porcelain"]),dirty => observed(repo,root,path,branch,head,dirty)))))))

def inspect(path: String) -> IO(Result<&1,&1,Failure,Observation>):
  bind(Observation,canonical("inspect.path",path),path => inspect_canonical(path))

def observation_json(observation: Observation) -> String:
  match observation:
    case Observed{repo,root,path,branch,head,dirty}:
      "{\"repositoryIdentity\":\"git-common-dir\",\"repository\":" ++ J.string_literal(repo) ++ ",\"root\":" ++ J.string_literal(root) ++ ",\"canonicalPath\":" ++ J.string_literal(path) ++ ",\"branch\":" ++ J.string_literal(branch) ++ ",\"head\":" ++ J.string_literal(head) ++ ",\"dirty\":" ++ Bool.pick(String,dirty,"true","false") ++ "}"

def failure_json(error: Failure) -> String:
  match error:
    case HostFailure{stage,code,detail}: "{\"stage\":" ++ J.string_literal(stage) ++ ",\"code\":" ++ U32.show(code) ++ ",\"detail\":" ++ J.string_literal(detail) ++ "}"

law capture_preserves_failed_exit_and_diagnostics:
  for stderr: String
  for stdout: String
  {status_result("git",stderr,G.RRun{G.SExit{19},stdout}) == Fail{HostFailure{"git",19,stderr ++ stdout}} : Result<&1,&1,Failure,String>}

def capture_preserves_failed_exit_and_diagnostics(stderr,stdout):
  {==}

law capture_keeps_success_stdout_separate:
  for stderr: String
  for stdout: String
  {status_result("git",stderr,G.RRun{G.SExit{0},stdout}) == Done{stdout} : Result<&1,&1,Failure,String>}

def capture_keeps_success_stdout_separate(stderr,stdout):
  {==}
