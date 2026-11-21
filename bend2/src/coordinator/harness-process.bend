import Base
import ../git/process.bend as Process
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../host/process.bend as Child
import ../host/text.bend as Text

type Capture is Data:
  Captured{status: String, stdout: String, stderr: String}

def continue_result(-A: Type, -B: Type, result: Result<&1,&1,U32 & String,A>, next: A -> IO(Result<&1,&1,U32 & String,B>)) -> IO(Result<&1,&1,U32 & String,B>):
  match result:
    case Done{value}: next(value)
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,B>,Fail{error})

def bind_result(-A: Type, -B: Type, effect: IO(Result<&1,&1,U32 & String,A>), next: A -> IO(Result<&1,&1,U32 & String,B>)) -> IO(Result<&1,&1,U32 & String,B>):
  IO.bind(Result<&1,&1,U32 & String,A>,Result<&1,&1,U32 & String,B>,effect,result => continue_result(A,B,result,next))

def value_or(result: Result<&1,&1,U32 & String,String>, fallback: String) -> String:
  match result:
    case Done{value}: value
    case Fail{error}: fallback

def unit_result(result: T.RunRes) -> Result<&1,&1,U32 & String,Unit>:
  match result:
    case T.RRun{T.SExit{0},out}: Done{Unit{}}
    case T.RRun{T.SExit{code},out}: Fail{(code,"exit " ++ U32.show(code) ++ " " ++ out)}
    case T.RRun{T.SSignal{signal},out}: Fail{(signal,"signal " ++ U32.show(signal))}
    case T.RSpawn{detail}: Fail{(1,detail)}

def run(args: List<String>, cwd: String) -> IO(Result<&1,&1,U32 & String,Unit>):
  do IO<Result<&1,&1,U32 & String,Unit>>:
    result : T.RunRes <- Process.runFull(args,cwd)
    IO.pure(Result<&1,&1,U32 & String,Unit>,unit_result(result))

def directory_result(result: T.RunRes) -> Result<&1,&1,U32 & String,String>:
  match result:
    case T.RRun{T.SExit{0},out}: Done{Tx.trim_nl(out)}
    case T.RRun{T.SExit{code},out}: Fail{(code,"mktemp exited " ++ U32.show(code) ++ " " ++ out)}
    case T.RRun{T.SSignal{signal},out}: Fail{(signal,"mktemp killed by signal " ++ U32.show(signal))}
    case T.RSpawn{detail}: Fail{(1,detail)}

def directory(template: String, cwd: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    result : T.RunRes <- Process.runFull(["/usr/bin/mktemp","-d",template],cwd)
    IO.pure(Result<&1,&1,U32 & String,String>,directory_result(result))

@unsafe
def drain_line(~again_drain: (@+handle: U32 -> @+reversed: List<&2,String> -> IO(Result<&1,&1,U32 & String,String>)), line: Result<&1,&1,U32 & String,Maybe<String>>, +handle: U32, +reversed: List<&2,String>) -> IO(Result<&1,&1,U32 & String,String>):
  match line:
    case Done{Some{text}}: again_drain(handle,text <> reversed)
    case Done{None{}}: IO.pure(Result<&1,&1,U32 & String,String>,Done{String.join(List.reverse(&2,String,reversed),"")})
    case Fail{error}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{error})

@unsafe
def drain(+handle: U32, +reversed: List<&2,String>) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    line : Result<&1,&1,U32 & String,Maybe<String>> <- Child.ProcessChild.read_text_line(handle)
    drain_line(drain,line,handle,reversed)

def settled(status: Result<&1,&1,U32 & String,String>, stdout: Result<&1,&1,U32 & String,String>, stderr: Result<&1,&1,U32 & String,String>) -> IO(Result<&1,&1,U32 & String,Capture>):
  continue_result(String,Capture,status,code =>
    continue_result(String,Capture,stdout,out =>
      continue_result(String,Capture,stderr,err =>
        IO.pure(Result<&1,&1,U32 & String,Capture>,Done{Captured{code,out,err}}))))

def settle(+handle: U32, +stderr: String) -> IO(Result<&1,&1,U32 & String,Capture>):
  do IO<Result<&1,&1,U32 & String,Capture>>:
    closed : Result<&1,&1,U32 & String,Unit> <- Child.ProcessChild.close_stdin(handle)
    stdout : Result<&1,&1,U32 & String,String> <- drain(handle,Nil{})
    waited : Result<&1,&1,U32 & String,String> <- Child.ProcessChild.wait(handle)
    errors : Result<&1,&1,U32 & String,String> <- Text.Text.read(stderr)
    settled(waited,stdout,errors)

def capture(args: List<String>, cwd: String, +stderr: String) -> IO(Result<&1,&1,U32 & String,Capture>):
  bind_result(U32,Capture,Child.ProcessChild.spawn(Child.argv(args),cwd,stderr),handle => settle(handle,stderr))
