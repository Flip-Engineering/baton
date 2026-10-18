import Base
import ./agent-actions.bend as A
import ./agent-route.bend as Route
import ./agent-native.bend as Native
import ./agent-input.bend as AgentInput
import ./repl.bend as Repl
import ../coordinator/commands.bend as C
import ./store.bend as Store
import ./message-batch.bend as Batch
import ./project.bend as Project
import ../host/sqlite.bend as DB
import ../context/raw.bend as Raw
import ../context/request.bend as Req
import ../git/text.bend as Tx

type ContextSource is Data:
  Direct{db: String, session: String}
  Registered{path: String, session: String}
  Current{session: String}
  Implicit{path: String, registered: Bool}
  Database{db: String}

type ParsedRequest is Type:
  Parsed{source: ContextSource, action: A.Action}

type PreparedRequest is Type:
  Prepared{db: String, session: String, action: A.Action}

def ack_result(+index: String, +id: String, result: Result<&1,&1,U32 & String,String>) -> String:
  match result:
    case Fail{(code,cause)}: Batch.read_failed(index,id,code,cause)
    case Done{+saved}:
      Bool.pick(String,String.is_empty(saved),
        Batch.item_prefix(index,id) ++ ",\"status\":\"absent\",\"cause\":\"No matching message owned by SESSION.\"}",
        Batch.item_prefix(index,id) ++ ",\"status\":\"acknowledged\",\"acknowledgement\":" ++ Tx.trim_nl(saved) ++ "}")

def read_or_ack(+db: String, +session: String, +id: String, +index: U32,
                receipt: String, ack: Bool) -> IO(String):
  match ack:
    case False{}: Batch.read_one(db,U32.show(index),id)
    case True{}: do IO<String>:
      result : Result<&1,&1,U32 & String,String> <- Store.apply(db,C.Ack{id,session,receipt})
      IO.pure(String,ack_result(U32.show(index),id,result))

def ids_tail(+db: String, +session: String, ids: List<String>, +index: U32,
             +receipt: String, +ack: Bool) -> IO(String):
  match ids:
    case Nil{}: IO.pure(String,"]")
    case id <> rest: do IO<String>:
      item : String <- read_or_ack(db,session,id,index,receipt,ack)
      tail : String <- ids_tail(db,session,rest,U32.add(index,1),receipt,ack)
      IO.pure(String,"," ++ item ++ tail)

def ids_json(+db: String, +session: String, ids: List<String>,
             +receipt: String, +ack: Bool) -> IO(String):
  match ids:
    case Nil{}: IO.pure(String,"[]")
    case id <> rest: do IO<String>:
      item : String <- read_or_ack(db,session,id,0,receipt,ack)
      tail : String <- ids_tail(db,session,rest,1,receipt,ack)
      IO.pure(String,"[" ++ item ++ tail)

def generated_id(+session: String, result: Result<&1,&1,U32 & String,String>) -> Result<&1,&1,U32 & String,String>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: Done{"message:" ++ session ++ ":" ++ Tx.trim_nl(value)}

def message_id(+db: String, +session: String, +id: String) -> IO(Result<&1,&1,U32 & String,String>):
  Bool.pick(IO(Result<&1,&1,U32 & String,String>),String.is_empty(id),
    (do IO<Result<&1,&1,U32 & String,String>>:
      random : Result<&1,&1,U32 & String,String> <- DB.Sql.read(db,"SELECT lower(hex(randomblob(16)));")
      IO.pure(Result<&1,&1,U32 & String,String>,generated_id(session,random))),
    IO.pure(Result<&1,&1,U32 & String,String>,Done{id}))

def handling_condition(+session: String, +attempt: String, +native: String, identity: String, current: String) -> String:
  "r.recipient=" ++ C.q(session) ++ " AND r.attempt=" ++ C.q(attempt) ++ " AND r.native=" ++ C.q(native) ++ " AND r.identity=" ++ C.q(identity)
  ++ " AND EXISTS(SELECT 1 FROM sessions s WHERE s.id=r.recipient AND s.native=r.native) AND NOT EXISTS(SELECT 1 FROM session_stops WHERE session=" ++ C.q(session) ++ ") AND " ++ current

def handling_sql(+session: String, +condition: String, +receipt: String) -> String:
  "BEGIN IMMEDIATE;UPDATE message_reads AS r SET handled=coalesce(handled," ++ C.q(receipt) ++ ") WHERE " ++ condition ++ ";"
  ++ "UPDATE messages SET receipt=coalesce(receipt," ++ C.q(receipt) ++ ") WHERE recipient=" ++ C.q(session) ++ " AND id IN(SELECT r.message FROM message_reads r WHERE " ++ condition ++ ");"
  ++ "DELETE FROM wake_claims WHERE session=" ++ C.q(session) ++ " AND EXISTS(SELECT 1 FROM message_reads r WHERE " ++ condition ++ ") AND NOT EXISTS(SELECT 1 FROM messages WHERE recipient=" ++ C.q(session) ++ " AND receipt IS NULL);"
  ++ "SELECT coalesce(json_group_array(json(item)),'[]') FROM (SELECT json_object('index',row_number() OVER (ORDER BY m.seq)-1,'id',m.id,'status','acknowledged','acknowledgement',json_object('id',m.id,'receipt',m.receipt)) AS item FROM message_reads r JOIN messages m ON m.id=r.message WHERE " ++ condition ++ " ORDER BY m.seq);COMMIT;"

def acknowledge_scope(scope: AgentInput.HandlingScope, +db: String, +session: String, +receipt: String) -> IO(String):
  match scope:
    case AgentInput.NoHandling{}:
      IO.die(String,2,"{\"error\":\"handling-context\",\"condition\":\"No live recipient-owned native read context is available. Select the handled message explicitly for an administrative acknowledgement.\"}")
    case AgentInput.Handling{+attempt,native,identity,current}: do IO<String>:
      actual : String = Bool.pick(String,String.is_empty(receipt),"native-turn:" ++ attempt,receipt)
      saved : String <- IO.try(String,Store.transact_sql(db,handling_sql(session,handling_condition(session,attempt,native,identity,current),actual)))
      IO.pure(String,Tx.trim_nl(saved))

def selected_receipt(scope: AgentInput.HandlingScope, +db: String, session: String) -> IO(String):
  match scope:
    case AgentInput.Handling{attempt,native,identity,current}: IO.pure(String,"native-turn:" ++ attempt)
    case AgentInput.NoHandling{}: do IO<String>:
      id : String <- IO.try(String,message_id(db,session,""))
      IO.pure(String,"handled:" ++ id)

def acknowledge_selected_if(empty: Bool, +db: String, +session: String, ids: List<String>, receipt: String) -> IO(String):
  match empty:
    case True{}: do IO<String>:
      scope : AgentInput.HandlingScope <- AgentInput.handling_scope(db,session)
      generated : String <- selected_receipt(scope,db,session)
      ids_json(db,session,ids,generated,True{})
    case False{}: ids_json(db,session,ids,receipt,True{})

def acknowledge_selected(+db: String, +session: String, ids: List<String>, +receipt: String) -> IO(String):
  acknowledge_selected_if(String.is_empty(receipt),db,session,ids,receipt)

def acknowledge(+db: String, +session: String, ids: List<String>, receipt: String) -> IO(String):
  match ids:
    case Nil{}: do IO<String>:
      scope : AgentInput.HandlingScope <- AgentInput.handling_scope(db,session)
      acknowledge_scope(scope,db,session,receipt)
    case selected: acknowledge_selected(db,session,selected,receipt)

def raw_body(read: Raw.RawRead) -> Result<&1,&1,U32 & String,String>:
  match read:
    case Raw.RawText{value}: Done{value}
    case Raw.RawInvalidUtf8{offset}: Fail{(2,"invalidUtf8 byte " ++ offset)}
    case Raw.RawNul{offset}: Fail{(2,"embeddedNul byte " ++ offset)}
    case Raw.RawBom{}: Fail{(2,"leadingBom")}

def raw_result(result: Result<&1,&1,U32 & String,Raw.RawRead>) -> Result<&1,&1,U32 & String,String>:
  match result:
    case Fail{error}: Fail{error}
    case Done{value}: raw_body(value)

def body_value(body: A.Body) -> IO(Result<&1,&1,U32 & String,String>):
  match body:
    case A.Text{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
    case A.File{path}: do IO<Result<&1,&1,U32 & String,String>>:
      read : Result<&1,&1,U32 & String,Raw.RawRead> <- Raw.Raw.read_text_utf8(path)
      IO.pure(Result<&1,&1,U32 & String,String>,raw_result(read))
    case A.Missing{}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,"send body is missing.")})
    case A.Bad{cause}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(2,cause)})

def captured_body_value(stdin: Native.Stdin, body: A.Body) -> IO(Result<&1,&1,U32 & String,String>):
  match stdin:
    case Native.Captured{value}: IO.pure(Result<&1,&1,U32 & String,String>,Done{value})
    case Native.CaptureFailed{code,cause}: IO.pure(Result<&1,&1,U32 & String,String>,Fail{(code,"stdin: " ++ cause)})
    case Native.Unused{}: body_value(body)

def captured_body(body: A.Body, stdin: Native.Stdin, wanted: Bool) -> IO(Result<&1,&1,U32 & String,String>):
  match wanted:
    case False{}: body_value(body)
    case True{}: captured_body_value(stdin,body)

def stdin_body(body: A.Body) -> Bool:
  match body:
    case A.File{path}: String.eq(path,"-")
    case other: False{}

def send_body(+db: String, +session: String, +index: String, +id: String,
              +recipient: String, +kind: String, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,Batch.send_refused(index,id,session,recipient,kind,code,cause))
    case Done{body}: Batch.send_one(db,index,id,session,recipient,kind,body)

def send_id(+db: String, +session: String, +index: String, +recipient: String,
            +kind: String, +body: A.Body, stdin: Native.Stdin, result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Fail{(code,cause)}: IO.pure(String,Batch.send_refused(index,"",session,recipient,kind,code,cause))
    case Done{id}: do IO<String>:
      value : Result<&1,&1,U32 & String,String> <- captured_body(body,stdin,stdin_body(body))
      send_body(db,session,index,id,recipient,kind,value)

def stdin_messages(items: List<&2,A.Message>) -> Bool:
  match items:
    case Nil{}: False{}
    case A.Item{recipient,id,kind,body} <> rest: Bool.or(stdin_body(body),stdin_messages(rest))

def send_item(+db: String, +session: String, index: U32, stdin: Native.Stdin, item: A.Message) -> IO(String):
  match item:
    case A.Item{recipient,id,kind,+body}: do IO<String>:
      actual : Result<&1,&1,U32 & String,String> <- message_id(db,session,id)
      send_id(db,session,U32.show(index),recipient,kind,body,stdin,actual)

def sends_tail(+db: String, +session: String, items: List<&2,A.Message>, +index: U32, +stdin: Native.Stdin) -> IO(String):
  match items:
    case Nil{}: IO.pure(String,"]")
    case item <> rest: do IO<String>:
      saved : String <- send_item(db,session,index,stdin,item)
      tail : String <- sends_tail(db,session,rest,U32.add(index,1),stdin)
      IO.pure(String,"," ++ saved ++ tail)

def sends_json(+db: String, +session: String, items: List<&2,A.Message>) -> IO(String):
  match items:
    case Nil{}: IO.pure(String,"[]")
    case +item <> +rest: do IO<String>:
      +stdin : Native.Stdin <- Native.capture_shared(db,stdin_messages(Con{item,rest}))
      saved : String <- send_item(db,session,0,stdin,item)
      tail : String <- sends_tail(db,session,rest,1,stdin)
      IO.pure(String,"[" ++ saved ++ tail)

def inspection_result(+saved: String) -> IO(Unit):
  Bool.pick(IO(Unit),String.is_empty(saved),
    IO.die(Unit,1,"No matching session or Player; inspect the requested ID."),
    IO.write(saved))

def completion_request(+db: String, +session: String, +id: String, body: A.Body) -> IO(String):
  do IO<String>:
    raw_parent : String <- IO.try(String,DB.Sql.read(db,
      "SELECT coalesce(parent,'') FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    +parent : String = Tx.trim_nl(raw_parent)
    Bool.pick(IO(String),String.is_empty(parent),
      IO.pure(String,"[" ++ Batch.send_refused("0",id,session,"","completion-request",2,
        "The current session has no recorded immediate parent.") ++ "]"),
      (do IO<String>:
        item : String <- send_item(db,session,0,Native.Unused{},A.Item{parent,id,"completion-request",body})
        IO.pure(String,"[" ++ item ++ "]")))

def confirmation_refused(+session: String, +recipient: String, +id: String,
                          +cause: String) -> IO(String):
  IO.pure(String,"[" ++ Batch.send_refused("0",id,session,recipient,
    "completion-confirmed",2,cause) ++ "]")

def confirmation_target(+db: String, +session: String, +recipient: String,
                        +request: String, +id: String, +target_hex: String) -> IO(String):
  match target_hex:
    case "": confirmation_refused(session,recipient,id,
      "No retained completion-request has the supplied ID.")
    case "wrong-kind": confirmation_refused(session,recipient,id,
      "The supplied message is not a completion-request.")
    case "wrong-coordinator": confirmation_refused(session,recipient,id,
      "The completion-request is addressed to another coordinator.")
    case encoded: do IO<String>:
      +target : String = Req.scalar_value(Req.decode_scalar_utf8(Tx.hex_decode(encoded)))
      matches : Bool = Bool.or(String.is_empty(recipient),String.eq(recipient,target))
      Bool.pick(IO(String),Bool.not(matches),
        confirmation_refused(session,recipient,id,
          "--to does not match the author of the completion-request."),
        (do IO<String>:
          item : String <- send_item(db,session,0,Native.Unused{},
            A.Item{target,id,"completion-confirmed",A.Text{request}})
          IO.pure(String,"[" ++ item ++ "]")))

def completion_confirmed_exact(+db: String, +session: String, +recipient: String,
                         +request: String, +id: String) -> IO(String):
  do IO<String>:
    row : String <- IO.try(String,DB.Sql.read(db,
      "SELECT CASE WHEN kind<>'completion-request' THEN 'wrong-kind' WHEN recipient<>" ++
      C.q(session) ++ " THEN 'wrong-coordinator' ELSE hex(CAST(sender AS TEXT)) END FROM messages WHERE id=" ++
      C.q(request) ++ ";"))
    confirmation_target(db,session,recipient,request,id,Tx.trim_nl(row))

def confirmation_requests_sql(+session: String, +recipient: String) -> String:
  "SELECT hex(" ++ C.task_request_sql("worker.id") ++ ") FROM sessions worker WHERE worker.parent=" ++ C.q(session)
  ++ " AND (" ++ C.q(recipient) ++ "='' OR worker.id=" ++ C.q(recipient) ++ ") AND " ++ C.task_request_sql("worker.id") ++ " IS NOT NULL"
  ++ " AND NOT " ++ C.task_confirmed_sql("worker.id") ++ " ORDER BY worker.id;"

def confirmation_inferred(rows: List<String>, +db: String, +session: String, +recipient: String, +id: String) -> IO(String):
  match rows:
    case encoded <> Nil{}: do IO<String>:
      request : String <- AgentInput.field(encoded)
      completion_confirmed_exact(db,session,recipient,request,id)
    case Nil{}: confirmation_refused(session,recipient,id,"No current completion request is addressed to this coordinator for the selected Player.")
    case other: confirmation_refused(session,recipient,id,"Multiple Players have current completion requests. Select the Player with --to.")

def completion_confirmed(+db: String, +session: String, +recipient: String, +request: String, +id: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(request),
    (do IO<String>:
      rows : String <- IO.try(String,DB.Sql.read(db,confirmation_requests_sql(session,recipient)))
      confirmation_inferred(Tx.split_lines(rows),db,session,recipient,id)),
    completion_confirmed_exact(db,session,recipient,request,id))

def execute(+db: String, +session: String, action: A.Action) -> IO(Unit):
  match action:
    case A.Help{+action}: IO.write(Bool.pick(String,String.eq(action,"repl"),Repl.help(),A.help(action)))
    case A.Invalid{cause}: IO.die(Unit,2,cause ++ "\n" ++ A.help(""))
    case A.Inbox{}: do IO<Unit>:
      saved : String <- IO.try(String,Store.read(db,C.Inbox{session}))
      AgentInput.output(db,session,saved,False{})
    case A.Read{ids}: do IO<Unit>:
      saved : String <- ids_json(db,session,ids,"",False{})
      AgentInput.output(db,session,saved,True{})
    case A.Acknowledge{ids,receipt}: do IO<Unit>:
      saved : String <- acknowledge(db,session,ids,receipt)
      IO.write(saved)
    case A.CompletionRequest{id,body}: do IO<Unit>:
      saved : String <- completion_request(db,session,id,body)
      IO.write(saved)
    case A.CompletionConfirmed{+recipient,+request,+id}: do IO<Unit>:
      saved : String <- completion_confirmed(db,session,recipient,request,id)
      IO.write(saved)
    case A.Session{+id}: do IO<Unit>:
      target : String = Bool.pick(String,String.is_empty(id),session,id)
      saved : String <- IO.try(String,Store.read(db,C.Session{target}))
      inspection_result(saved)
    case A.Player{id}: do IO<Unit>:
      saved : String <- IO.try(String,Store.read(db,C.PlayerRead{id}))
      inspection_result(saved)
    case A.Players{}: do IO<Unit>:
      saved : String <- IO.try(String,Store.read(db,C.Players{}))
      IO.write(saved)
    case A.Assignment{+id}: do IO<Unit>:
      target : String = Bool.pick(String,String.is_empty(id),session,id)
      saved : String <- IO.try(String,Store.read(db,C.Session{target}))
      inspection_result(saved)
    case A.Send{items}: do IO<Unit>:
      saved : String <- sends_json(db,session,items)
      IO.write(saved)
    case A.Repl{args}: Repl.execute(db,session,args)
    case A.Native{items}: do IO<Unit>:
      saved : String <- Native.operations(db,session,items)
      IO.write(saved)

def help() -> String:
  A.help("")

def environment_result(result: Result<&1,&1,U32 & String,String>) -> IO(String):
  match result:
    case Done{value}: IO.pure(String,value)
    case Fail{(+code,detail)}:
      Bool.pick(IO(String),U32.is_eq(code,2),IO.pure(String,""),IO.die(String,code,detail))

def environment(name: String) -> IO(String):
  do IO<String>:
    result : Result<&1,&1,U32 & String,String> <- IO.get_env(name)
    environment_result(result)

def native_rows(rows: List<String>) -> IO(String):
  match rows:
    case id <> Nil{}: Project.field(id)
    case Nil{}: IO.die(String,2,"The current native conversation has no Baton session in this project. Launch the agent through Baton or use as SESSION.\n")
    case other: IO.die(String,2,"The current native conversation matches multiple Baton sessions in this project. Use as SESSION to select one.\n")

def native_session(+db: String, +native: String) -> IO(String):
  Bool.pick(IO(String),String.is_empty(native),
    IO.die(String,2,"No Baton agent context is available. Launch the agent through Baton or use as SESSION.\n"),
    (do IO<String>:
      rows : String <- IO.try(String,DB.Sql.read(db,"SELECT hex(id) FROM sessions WHERE harness='codex' AND native=" ++ C.q(native) ++ ";"))
      native_rows(Tx.split_lines(rows))))

def implicit_session(+db: String) -> IO(String):
  do IO<String>:
    +session : String <- environment("BATON_SESSION")
    Bool.pick(IO(String),String.is_empty(session),
      (do IO<String>:
        native : String <- environment("CODEX_THREAD_ID")
        native_session(db,native)),IO.pure(String,session))

def current_session(+db: String) -> IO(Unit):
  do IO<Unit>:
    session : String <- implicit_session(db)
    +saved : String <- IO.try(String,DB.Sql.read(db,"SELECT json_object('id',id) FROM sessions WHERE id=" ++ C.q(session) ++ ";"))
    Bool.pick(IO(Unit),String.is_empty(saved),IO.die(Unit,2,"No recorded session matches the current agent context."),IO.write(saved))

def implicit_database(+path: String, registered: Bool) -> IO(String):
  match registered:
    case True{}: Project.database(path)
    case False{}: do IO<String>:
      +db : String <- environment("BATON_DATABASE")
      Bool.pick(IO(String),String.is_empty(db),Project.database(path),IO.pure(String,db))

def parsed_session_result(source: ContextSource, args: List<String>, cause: String, empty: Bool) -> ParsedRequest:
  match empty:
    case True{}: Parsed{Direct{"",""},A.Invalid{cause}}
    case False{}: Parsed{source,A.parse(args)}

def parsed_session(source: ContextSource, session: String, args: List<String>, cause: String) -> ParsedRequest:
  parsed_session_result(source,args,cause,String.is_empty(session))

def parsed_request(request: Route.Context) -> ParsedRequest:
  match request:
    case Route.Explicit{db,+session,args}: parsed_session(Direct{db,session},session,args,"as requires SESSION; use baton as SESSION help.")
    case Route.Project{path,+session,args}: parsed_session(Registered{path,session},session,args,"as requires SESSION; use baton as SESSION help.")
    case Route.Current{+session,args}: parsed_session(Current{session},session,args,"as requires SESSION; use baton help.")
    case Route.Implicit{path,registered,action}: Parsed{Implicit{path,registered},action}
    case Route.InDatabase{db,action}: Parsed{Database{db},action}

def resolve_source(source: ContextSource) -> IO(String & String):
  match source:
    case Direct{db,session}: IO.pure(String & String,(db,session))
    case Registered{path,session}: do IO<String & String>:
      db : String <- Project.database(path)
      IO.pure(String & String,(db,session))
    case Current{session}: do IO<String & String>:
      db : String <- implicit_database(".",False{})
      IO.pure(String & String,(db,session))
    case Implicit{path,registered}: do IO<String & String>:
      +db : String <- implicit_database(path,registered)
      session : String <- implicit_session(db)
      IO.pure(String & String,(db,session))
    case Database{+db}: do IO<String & String>:
      session : String <- implicit_session(db)
      IO.pure(String & String,(db,session))

def prepared_context(context: String & String, action: A.Action) -> PreparedRequest:
  (db,session)=context
  Prepared{db,session,action}

def prepare_valid(source: ContextSource, action: A.Action) -> IO(PreparedRequest):
  do IO<PreparedRequest>:
    context : String & String <- resolve_source(source)
    IO.pure(PreparedRequest,prepared_context(context,action))

def prepare_parsed(parsed: ParsedRequest) -> IO(PreparedRequest):
  match parsed:
    case Parsed{source,action}:
      match action:
        case A.Help{action}: IO.pure(PreparedRequest,Prepared{"","",A.Help{action}})
        case A.Invalid{cause}: IO.pure(PreparedRequest,Prepared{"","",A.Invalid{cause}})
        case valid: prepare_valid(source,valid)

def prepare_request(request: Route.Context) -> IO(PreparedRequest):
  prepare_parsed(parsed_request(request))

def route_prepared(prepared: PreparedRequest) -> IO(Unit):
  match prepared:
    case Prepared{db,session,action}: execute(db,session,action)

def route(request: Route.Context) -> IO(Unit):
  do IO<Unit>:
    prepared : PreparedRequest <- prepare_request(request)
    route_prepared(prepared)
