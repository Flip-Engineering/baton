import Base
import ../host/codex-proxy.bend as Native
import ../host/instance.bend as Custody
import ../host/sqlite.bend as DB
import ../coordinator/commands.bend as C
import ../git/text.bend as Tx
import ../context/request.bend as Req
import ../json/canonical.bend as J

# One event consumer owns RPC correlation and the complete notification queue.
type CodexEvent is Type:
  Frame{value: Result<&1,&1,U32 & String,String>}
  Changed{value: Result<&1,&1,U32 & String,String>}

type Link is Data:
  Link{proxy: U32, subscription: U32, events: Chan(CodexEvent)}

type Pending is Data:
  Pending{sequence: U32, frames: String}

def proxy(+link: Link) -> U32:
  match link:
    case Link{handle,subscription,events}: handle

def events(+link: Link) -> Chan(CodexEvent):
  match link:
    case Link{handle,subscription,value}: value

def subscription(+link: Link) -> U32:
  match link:
    case Link{handle,value,events}: value

def sequence(+pending: Pending) -> U32:
  match pending:
    case Pending{value,frames}: value

def frames(+pending: Pending) -> String:
  match pending:
    case Pending{sequence,value}: value

def empty() -> Pending:
  Pending{0,"[]"}

def json(+sql: String) -> IO(String):
  do IO<String>:
    +output : String <- IO.try(String,DB.Sql.query(":memory:",sql))
    IO.pure(String,Tx.trim_nl(output))

def value(+document: String, +path: String) -> IO(String):
  json("SELECT coalesce(" ++ C.q(document) ++ " -> " ++ C.q(path) ++ ",'null');")

def text_decoded(value: Req.Scalar) -> String:
  match value:
    case Req.ScalarText{text}: text
    case other: ""

def text(+document: String, +path: String) -> IO(String):
  do IO<String>:
    +encoded : String <- json("SELECT hex(coalesce(json_extract(" ++ C.q(document) ++ "," ++ C.q(path) ++ "),''));")
    IO.pure(String,text_decoded(Req.decode_scalar_utf8(Tx.hex_decode(encoded))))

def truth(+document: String, +expression: String) -> IO(Bool):
  do IO<Bool>:
    +answer : String <- json("WITH item(value) AS (SELECT " ++ C.q(document) ++ ") SELECT coalesce((" ++ expression ++ "),0) FROM item;")
    IO.pure(Bool,String.eq(answer,"1"))

def record(+value: String) -> IO(Unit):
  IO.write(value ++ "\n")

def queued(+pending: Pending, +frame: String) -> IO(Pending):
  match pending:
    case Pending{sequence,frames}: do IO<Pending>:
      +updated : String <- json("SELECT json_insert(" ++ C.q(frames) ++ ",'$[#]',json(" ++ C.q(frame) ++ "));")
      IO.pure(Pending,Pending{sequence,updated})

def relay(chan: Chan(CodexEvent), event: CodexEvent) -> IO(Unit):
  do IO<Unit>:
    +sent : Bool <- Chan.send(CodexEvent,chan,event)
    IO.pure(Unit,Unit{})

@unsafe
def native_wait(+link: Link) -> IO(Unit):
  do IO<Unit>:
    frame : Result<&1,&1,U32 & String,String> <- Native.CodexProxy.next(proxy(link))
    relay(events(link),Frame{frame})

@unsafe
def notice_wait(+link: Link) -> IO(Unit):
  do IO<Unit>:
    change : Result<&1,&1,U32 & String,String> <- Custody.Instance.notice(subscription(link))
    relay(events(link),Changed{change})

def discard(task: Chan(Unit)) -> IO(Unit):
  IO.pure(Unit,Unit{})

def arm_native(+link: Link) -> IO(Unit):
  do IO<Unit>:
    task : Chan(Unit) <- IO.fork(Unit,native_wait(link))
    discard(task)

def arm_notice(+link: Link, +enabled: Bool) -> IO(Unit):
  match enabled:
    case False{}: IO.pure(Unit,Unit{})
    case True{}: do IO<Unit>:
      task : Chan(Unit) <- IO.fork(Unit,notice_wait(link))
      discard(task)

def receive_event(+link: Link, event: CodexEvent) -> IO(String):
  match event:
    case Frame{result}: do IO<String>:
      +frame : String <- IO.pass(String,result)
      armed : Unit <- arm_native(link)
      IO.pure(String,frame)
    case Changed{result}: do IO<String>:
      +notice : String <- IO.pass(String,result)
      armed : Unit <- arm_notice(link,True{})
      IO.pure(String,"{\"change\":" ++ notice ++ "}")

def receive_maybe(+link: Link, event: Maybe<&1,CodexEvent>) -> IO(String):
  match event:
    case None{}: IO.die(String,1,"The Codex inbox event channel closed.")
    case Some{value}: receive_event(link,value)

def receive(+link: Link) -> IO(String):
  do IO<String>:
    event : Maybe<&1,CodexEvent> <- Chan.recv(CodexEvent,events(link))
    receive_maybe(link,event)

def rpc_checked(+method: String, +frame: String, +refused: Bool, +has_result: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match refused:
    case True{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(1,"Public Codex " ++ method ++ " refused input: " ++ frame)})
    case False{}:
      Bool.pick(IO(Result<&1,&1,U32 & String,String>),has_result,
        (do IO<Result<&1,&1,U32 & String,String>>:
          result : String <- value(frame,"$.result")
          IO.pure(Result<&1,&1,U32 & String,String>,Done{result})),
        IO.pure(Result<&1,&1,U32 & String,String>,Fail{(1,"Public Codex " ++ method ++ " returned no result: " ++ frame)}))

def rpc_response(+method: String, +frame: String) -> IO(Result<&1,&1,U32 & String,String>):
  do IO<Result<&1,&1,U32 & String,String>>:
    +refused : Bool <- truth(frame,"json_type(value,'$.error') IS NOT NULL AND json_type(value,'$.error')<>'null'")
    +present : Bool <- truth(frame,"json_type(value,'$.result') IS NOT NULL")
    rpc_checked(method,frame,refused,present)

def rpc_dispatch(+link: Link, +pending: Pending, +id: U32, +method: String, +frame: String, +response: Bool, again: Pending -> IO(Pending & Result<&1,&1,U32 & String,String>)) -> IO(Pending & Result<&1,&1,U32 & String,String>):
  match response:
    case True{}: do IO<Pending & Result<&1,&1,U32 & String,String>>:
      result : Result<&1,&1,U32 & String,String> <- rpc_response(method,frame)
      IO.pure(Pending & Result<&1,&1,U32 & String,String>,(pending,result))
    case False{}: do IO<Pending & Result<&1,&1,U32 & String,String>>:
      updated : Pending <- queued(pending,frame)
      again(updated)

@unsafe
def rpc_wait(+link: Link, +pending: Pending, +id: U32, +method: String) -> IO(Pending & Result<&1,&1,U32 & String,String>):
  do IO<Pending & Result<&1,&1,U32 & String,String>>:
    +frame : String <- receive(link)
    +response : Bool <- truth(frame,"json_type(value,'$.method') IS NULL AND json_extract(value,'$.id')=" ++ U32.show(id))
    rpc_dispatch(link,pending,id,method,frame,response,next => rpc_wait(link,next,id,method))

def rpc_result(+link: Link, +pending: Pending, +method: String, +params: String) -> IO(Pending & Result<&1,&1,U32 & String,String>):
  match pending:
    case Pending{previous,frames}: do IO<Pending & Result<&1,&1,U32 & String,String>>:
      +id : U32 = U32.add(previous,1)
      sent : Unit <- IO.try(Unit,Native.CodexProxy.send(proxy(link),"{\"id\":" ++ U32.show(id) ++ ",\"method\":" ++ J.string_literal(method) ++ ",\"params\":" ++ params ++ "}"))
      rpc_wait(link,Pending{id,frames},id,method)

def rpc_pass(result: Pending & Result<&1,&1,U32 & String,String>) -> IO(Pending & String):
  match result:
    case (pending,result): do IO<Pending & String>:
      response : String <- IO.pass(String,result)
      IO.pure(Pending & String,(pending,response))

def rpc(+link: Link, +pending: Pending, +method: String, +params: String) -> IO(Pending & String):
  do IO<Pending & String>:
    result : Pending & Result<&1,&1,U32 & String,String> <- rpc_result(link,pending,method,params)
    rpc_pass(result)

def initialize_result(+link: Link, result: Pending & String) -> IO(Pending):
  match result:
    case (pending,response): do IO<Pending>:
      sent : Unit <- IO.try(Unit,Native.CodexProxy.send(proxy(link),"{\"method\":\"initialized\",\"params\":{}}"))
      IO.pure(Pending,pending)

def initialize(+link: Link) -> IO(Pending):
  do IO<Pending>:
    result : Pending & String <- rpc(link,empty(),"initialize","{\"clientInfo\":{\"name\":\"baton_inbox_wake\",\"title\":\"Baton inbox wake\",\"version\":\"1\"},\"capabilities\":{\"experimentalApi\":true,\"optOutNotificationMethods\":[\"item/started\",\"item/agentMessage/delta\",\"item/plan/delta\",\"item/reasoning/summaryTextDelta\",\"item/reasoning/summaryPartAdded\",\"item/reasoning/textDelta\",\"item/commandExecution/outputDelta\",\"turn/diff/updated\",\"turn/plan/updated\",\"thread/tokenUsage/updated\"]}}")
    initialize_result(link,result)

def pop(+pending: Pending) -> IO(Pending & String):
  match pending:
    case Pending{sequence,frames}: do IO<Pending & String>:
      +first : String <- value(frames,"$[0]")
      +tail : String <- json("SELECT json_remove(" ++ C.q(frames) ++ ",'$[0]');")
      IO.pure(Pending & String,(Pending{sequence,tail},first))

def next_selected(+link: Link, +pending: Pending, +queued: Bool) -> IO(Pending & String):
  match queued:
    case True{}: pop(pending)
    case False{}: do IO<Pending & String>:
      +frame : String <- receive(link)
      IO.pure(Pending & String,(pending,frame))

def next(+link: Link, +pending: Pending) -> IO(Pending & String):
  do IO<Pending & String>:
    +queued : Bool <- truth(frames(pending),"json_array_length(value)>0")
    next_selected(link,pending,queued)
