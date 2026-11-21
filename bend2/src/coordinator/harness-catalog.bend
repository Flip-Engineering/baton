import Base
import ./harness-process.bend as P
import ../coordinator/commands.bend as C
import ../git/text.bend as Tx
import ../git/types.bend as T
import ../host/files.bend as F
import ../host/process.bend as Child
import ../host/sqlite.bend as DB

def arguments(harness: String) -> List<String>:
  match harness:
    case "claude-code": ["-p","--input-format","stream-json","--output-format","stream-json","--verbose","--no-session-persistence","--setting-sources",""]
    case other: ["serve","--no-session-log"]

type Request is Data:
  ClaudeInitialize{}
  MuseInitialize{}
  MuseModels{}

def predicate(request: Request) -> String:
  match request:
    case ClaudeInitialize{}: "j->>'type'='control_response' AND j->>'$.response.request_id'='models'"
    case MuseInitialize{}: "j->>'id'=1"
    case MuseModels{}: "j->>'id'=2"

def response(request: Request) -> String:
  match request:
    case ClaudeInitialize{}:
      "CASE WHEN j->>'$.response.subtype'='success' AND json_type(j,'$.response.response.models') IS NOT NULL THEN 'done'||json_object('models',j->'$.response.response.models') ELSE 'error'||j END"
    case MuseInitialize{}:
      "CASE WHEN json_type(j,'$.error') IS NULL THEN 'done' ELSE 'error'||j END"
    case MuseModels{}:
      "CASE WHEN json_type(j,'$.error') IS NULL AND json_type(j,'$.result') IS NOT NULL THEN 'done'||(j->'$.result') ELSE 'error'||j END"

def frame_sql(+request: Request, line: String) -> String:
  "WITH f(j) AS (VALUES(" ++ C.q(line) ++ ")) SELECT CASE WHEN NOT json_valid(j) THEN 'errorInvalid JSON from client: '||j WHEN " ++ predicate(request) ++ " THEN " ++ response(request) ++ " ELSE 'skip' END FROM f;"

@unsafe
def decided(~again_receive: (@+db: String -> @+handle: U32 -> @+request: Request -> IO(Result<&1,&1,U32 & String,String>)), +db: String, +handle: U32, +request: Request, +answer: String) -> IO(Result<&1,&1,U32 & String,String>):
  match answer:
    case "skip": again_receive(db,handle,request)
    case other: IO.pure(Result<&1,&1,U32 & String,String>,Bool.pick(Result<&1,&1,U32 & String,String>,String.starts_with(answer,"done"),Done{String.drop(answer,4n)},Fail{(1,String.drop(answer,5n))}))

@unsafe
def decoded(~again_receive: (@+db: String -> @+handle: U32 -> @+request: Request -> IO(Result<&1,&1,U32 & String,String>)), +db: String, +handle: U32, +request: Request, line: Maybe<String>) -> IO(Result<&1,&1,U32 & String,String>):
  match line:
    case None{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(1,"client closed the stream before replying")})
    case Some{frame}:
      P.bind_result(String,String,DB.Sql.read(db,frame_sql(request,frame)),
        answer => decided(again_receive,db,handle,request,Tx.trim_nl(answer)))

@unsafe
def receive(+db: String, +handle: U32, +request: Request) -> IO(Result<&1,&1,U32 & String,String>):
  P.bind_result(Maybe<String>,String,Child.ProcessChild.read_line(handle),line => decoded(receive,db,handle,request,line))

def request_frame(request: Request) -> String:
  match request:
    case ClaudeInitialize{}: "{\"type\":\"control_request\",\"request_id\":\"models\",\"request\":{\"subtype\":\"initialize\"}}\n"
    case MuseInitialize{}: "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"clientInfo\":{\"name\":\"baton\",\"version\":\"1\"},\"capabilities\":{\"experimentalApi\":true}}}\n"
    case MuseModels{}: "{\"jsonrpc\":\"2.0\",\"method\":\"initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"model/list\",\"params\":{}}\n"

def send(+db: String, +handle: U32, +request: Request) -> IO(Result<&1,&1,U32 & String,String>):
  P.bind_result(Unit,String,Child.ProcessChild.write(handle,request_frame(request)),written => receive(db,handle,request))

def exchange(+db: String, harness: String, +handle: U32) -> IO(Result<&1,&1,U32 & String,String>):
  match harness:
    case "claude-code": send(db,handle,ClaudeInitialize{})
    case other:
      P.bind_result(String,String,send(db,handle,MuseInitialize{}),initialized => send(db,handle,MuseModels{}))

def child_result(+harness: String, +command: String, protocol: Result<&1,&1,U32 & String,String>, waited: Result<&1,&1,U32 & String,P.Capture>) -> T.RunRes:
  match protocol:
    case Fail{(code,detail)}: T.RRun{T.SExit{1},harness ++ ": " ++ detail ++ "\n"}
    case Done{answer}:
      match waited:
        case Fail{(code,detail)}: T.RSpawn{detail}
        case Done{P.Captured{status,out,err}}:
          match status:
            case "exit 0": T.RRun{T.SExit{0},answer ++ "\n"}
            case other: T.RRun{T.SExit{1},harness ++ ": " ++ command ++ " " ++ other ++ ": " ++ err ++ "\n"}

def read_child(+db: String, +harness: String, +command: String, +stderr: String, started: Result<&1,&1,U32 & String,U32>) -> IO(T.RunRes):
  match started:
    case Fail{(code,detail)}: IO.pure(T.RunRes,T.RRun{T.SExit{1},harness ++ ": " ++ detail ++ "\n"})
    case Done{+handle}: do IO<T.RunRes>:
      protocol : Result<&1,&1,U32 & String,String> <- exchange(db,harness,handle)
      waited : Result<&1,&1,U32 & String,P.Capture> <- P.settle(handle,stderr)
      IO.pure(T.RunRes,child_result(harness,command,protocol,waited))

def read_staged(+db: String, +harness: String, +command: String, cwd: String, stage: Result<&1,&1,U32 & String,String>) -> IO(T.RunRes):
  match stage:
    case Fail{(code,detail)}: IO.pure(T.RunRes,T.RSpawn{detail})
    case Done{+dir}: do IO<T.RunRes>:
      +stderr : String = dir ++ "/stderr"
      args : List<String> = List.append(&1,String,["/usr/bin/env","MUSE_NO_AUTO_UPDATE=1","DISABLE_AUTOUPDATER=1",command],arguments(harness))
      started : Result<&1,&1,U32 & String,U32> <- Child.ProcessChild.spawn(Child.argv(args),cwd,stderr)
      answer : T.RunRes <- read_child(db,harness,command,stderr,started)
      removed : Result<&1,&1,U32 & String,Unit> <- F.Files.remove(stderr)
      cleared : Result<&1,&1,U32 & String,Unit> <- F.Files.rmdir(dir)
      IO.pure(T.RunRes,answer)

def catalog(+db: String, +harness: String, +command: String, +cwd: String) -> IO(T.RunRes):
  do IO<T.RunRes>:
    env : Result<&1,&1,U32 & String,String> <- IO.get_env("TMPDIR")
    stage : Result<&1,&1,U32 & String,String> <- P.directory(P.value_or(env,"/tmp") ++ "/baton-catalog-XXXXXXXXXX",".")
    read_staged(db,harness,command,cwd,stage)
