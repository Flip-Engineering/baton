import Base
import ./codex-inbox-result.bend as Outcome
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

def json(+sql: String) -> Outcome.Checked(String):
  do Outcome.Checked<String>:
    +output : String <- DB.Sql.query(":memory:",sql)
    Outcome.Checked.pure(String,Tx.trim_nl(output))

def value(+document: String, +path: String) -> Outcome.Checked(String):
  json("SELECT coalesce(" ++ C.q(document) ++ " -> " ++ C.q(path) ++ ",'null');")

def text_decoded(value: Req.Scalar) -> String:
  match value:
    case Req.ScalarText{text}: text
    case other: ""

def text(+document: String, +path: String) -> Outcome.Checked(String):
  do Outcome.Checked<String>:
    +encoded : String <- json("SELECT hex(coalesce(json_extract(" ++ C.q(document) ++ "," ++ C.q(path) ++ "),''));")
    Outcome.Checked.pure(String,text_decoded(Req.decode_scalar_utf8(Tx.hex_decode(encoded))))

def truth(+document: String, +expression: String) -> Outcome.Checked(Bool):
  do Outcome.Checked<Bool>:
    +answer : String <- json("WITH item(value) AS (SELECT " ++ C.q(document) ++ ") SELECT coalesce((" ++ expression ++ "),0) FROM item;")
    Outcome.Checked.pure(Bool,String.eq(answer,"1"))

def record(+value: String) -> Outcome.Checked(Unit):
  Outcome.Checked.lift(Unit,IO.write(value ++ "\n"))

def queued(+pending: Pending, +frame: String) -> Outcome.Checked(Pending):
  match pending:
    case Pending{sequence,frames}: do Outcome.Checked<Pending>:
      +updated : String <- json("SELECT json_insert(" ++ C.q(frames) ++ ",'$[#]',json(" ++ C.q(frame) ++ "));")
      Outcome.Checked.pure(Pending,Pending{sequence,updated})

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

def receive_event(+link: Link, event: CodexEvent) -> Outcome.Checked(String):
  match event:
    case Frame{result}: do Outcome.Checked<String>:
      +frame : String <- Outcome.Checked.from_result(String,result)
      armed : Unit <- Outcome.Checked.lift(Unit,arm_native(link))
      Outcome.Checked.pure(String,frame)
    case Changed{result}: do Outcome.Checked<String>:
      +notice : String <- Outcome.Checked.from_result(String,result)
      armed : Unit <- Outcome.Checked.lift(Unit,arm_notice(link,True{}))
      Outcome.Checked.pure(String,"{\"change\":" ++ notice ++ "}")

def receive_maybe(+link: Link, event: Maybe<&1,CodexEvent>) -> Outcome.Checked(String):
  match event:
    case None{}: Outcome.Checked.fail(String,1,"The Codex inbox event channel closed.")
    case Some{value}: receive_event(link,value)

def receive(+link: Link) -> Outcome.Checked(String):
  do Outcome.Checked<String>:
    event : Maybe<&1,CodexEvent> <- Outcome.Checked.lift(Maybe<&1,CodexEvent>,Chan.recv(CodexEvent,events(link)))
    receive_maybe(link,event)

def rpc_checked(+method: String, +frame: String, +refused: Bool, +has_result: Bool) -> Outcome.Checked(Result<&1,&1,U32 & String,String>):
  match refused:
    case True{}: Outcome.Checked.pure(Result<&1,&1,U32 & String,String>,Fail{(1,"Public Codex " ++ method ++ " refused input: " ++ frame)})
    case False{}:
      Bool.pick(Outcome.Checked(Result<&1,&1,U32 & String,String>),has_result,
        (do Outcome.Checked<Result<&1,&1,U32 & String,String>>:
          result : String <- value(frame,"$.result")
          Outcome.Checked.pure(Result<&1,&1,U32 & String,String>,Done{result})),
        Outcome.Checked.pure(Result<&1,&1,U32 & String,String>,Fail{(1,"Public Codex " ++ method ++ " returned no result: " ++ frame)}))

def rpc_response(+method: String, +frame: String) -> Outcome.Checked(Result<&1,&1,U32 & String,String>):
  do Outcome.Checked<Result<&1,&1,U32 & String,String>>:
    +refused : Bool <- truth(frame,"json_type(value,'$.error') IS NOT NULL AND json_type(value,'$.error')<>'null'")
    +present : Bool <- truth(frame,"json_type(value,'$.result') IS NOT NULL")
    rpc_checked(method,frame,refused,present)

def rpc_dispatch(+link: Link, +pending: Pending, +id: U32, +method: String, +frame: String, +response: Bool, again: Pending -> Outcome.Checked(Pending & Result<&1,&1,U32 & String,String>)) -> Outcome.Checked(Pending & Result<&1,&1,U32 & String,String>):
  match response:
    case True{}: do Outcome.Checked<Pending & Result<&1,&1,U32 & String,String>>:
      result : Result<&1,&1,U32 & String,String> <- rpc_response(method,frame)
      Outcome.Checked.pure(Pending & Result<&1,&1,U32 & String,String>,(pending,result))
    case False{}: do Outcome.Checked<Pending & Result<&1,&1,U32 & String,String>>:
      updated : Pending <- queued(pending,frame)
      again(updated)

@unsafe
def rpc_wait(+link: Link, +pending: Pending, +id: U32, +method: String) -> Outcome.Checked(Pending & Result<&1,&1,U32 & String,String>):
  do Outcome.Checked<Pending & Result<&1,&1,U32 & String,String>>:
    +frame : String <- receive(link)
    +response : Bool <- truth(frame,"json_type(value,'$.method') IS NULL AND json_extract(value,'$.id')=" ++ U32.show(id))
    rpc_dispatch(link,pending,id,method,frame,response,next => rpc_wait(link,next,id,method))

def rpc_result(+link: Link, +pending: Pending, +method: String, +params: String) -> Outcome.Checked(Pending & Result<&1,&1,U32 & String,String>):
  match pending:
    case Pending{previous,frames}: do Outcome.Checked<Pending & Result<&1,&1,U32 & String,String>>:
      +id : U32 = U32.add(previous,1)
      sent : Unit <- Native.CodexProxy.send(proxy(link),"{\"id\":" ++ U32.show(id) ++ ",\"method\":" ++ J.string_literal(method) ++ ",\"params\":" ++ params ++ "}")
      rpc_wait(link,Pending{id,frames},id,method)

def rpc_pass(result: Pending & Result<&1,&1,U32 & String,String>) -> Outcome.Checked(Pending & String):
  match result:
    case (pending,result): do Outcome.Checked<Pending & String>:
      response : String <- Outcome.Checked.from_result(String,result)
      Outcome.Checked.pure(Pending & String,(pending,response))

def rpc(+link: Link, +pending: Pending, +method: String, +params: String) -> Outcome.Checked(Pending & String):
  do Outcome.Checked<Pending & String>:
    result : Pending & Result<&1,&1,U32 & String,String> <- rpc_result(link,pending,method,params)
    rpc_pass(result)

def initialize_result(+link: Link, result: Pending & String) -> Outcome.Checked(Pending):
  match result:
    case (pending,response): do Outcome.Checked<Pending>:
      sent : Unit <- Native.CodexProxy.send(proxy(link),"{\"method\":\"initialized\",\"params\":{}}")
      Outcome.Checked.pure(Pending,pending)

def initialize(+link: Link) -> Outcome.Checked(Pending):
  do Outcome.Checked<Pending>:
    result : Pending & String <- rpc(link,empty(),"initialize","{\"clientInfo\":{\"name\":\"baton_inbox_wake\",\"title\":\"Baton inbox wake\",\"version\":\"1\"},\"capabilities\":{\"experimentalApi\":true,\"optOutNotificationMethods\":[\"item/started\",\"item/agentMessage/delta\",\"item/plan/delta\",\"item/reasoning/summaryTextDelta\",\"item/reasoning/summaryPartAdded\",\"item/reasoning/textDelta\",\"item/commandExecution/outputDelta\",\"turn/diff/updated\",\"turn/plan/updated\",\"thread/tokenUsage/updated\"]}}")
    initialize_result(link,result)

def pop(+pending: Pending) -> Outcome.Checked(Pending & String):
  match pending:
    case Pending{sequence,frames}: do Outcome.Checked<Pending & String>:
      +first : String <- value(frames,"$[0]")
      +tail : String <- json("SELECT json_remove(" ++ C.q(frames) ++ ",'$[0]');")
      Outcome.Checked.pure(Pending & String,(Pending{sequence,tail},first))

def next_selected(+link: Link, +pending: Pending, +queued: Bool) -> Outcome.Checked(Pending & String):
  match queued:
    case True{}: pop(pending)
    case False{}: do Outcome.Checked<Pending & String>:
      +frame : String <- receive(link)
      Outcome.Checked.pure(Pending & String,(pending,frame))

def next(+link: Link, +pending: Pending) -> Outcome.Checked(Pending & String):
  do Outcome.Checked<Pending & String>:
    +queued : Bool <- truth(frames(pending),"json_array_length(value)>0")
    next_selected(link,pending,queued)
